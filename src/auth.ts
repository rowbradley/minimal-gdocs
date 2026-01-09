import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import open from 'open';

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
];

const CREDENTIALS_PATH = path.join(import.meta.dirname, '..', 'credentials.json');
const TOKEN_PATH = path.join(import.meta.dirname, '..', 'token.json');

interface Credentials {
  installed: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

export async function getAuthClient(): Promise<OAuth2Client> {
  const credentials: Credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_id, client_secret } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'http://localhost:3000/oauth2callback'
  );

  // Check for existing token
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oAuth2Client.setCredentials(token);

    // Check if token is expired and refresh if needed
    if (token.expiry_date && token.expiry_date < Date.now()) {
      try {
        const { credentials } = await oAuth2Client.refreshAccessToken();
        oAuth2Client.setCredentials(credentials);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials));
      } catch (error) {
        // Token refresh failed, need to re-authenticate
        return await authenticateWithBrowser(oAuth2Client);
      }
    }
    return oAuth2Client;
  }

  // No token, need to authenticate
  return await authenticateWithBrowser(oAuth2Client);
}

async function authenticateWithBrowser(oAuth2Client: OAuth2Client): Promise<OAuth2Client> {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    });

    // Create a simple server to receive the callback
    const server = http.createServer(async (req, res) => {
      if (req.url?.startsWith('/oauth2callback')) {
        const url = new URL(req.url, 'http://localhost:3000');
        const code = url.searchParams.get('code');

        if (code) {
          try {
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>');

            server.close();
            resolve(oAuth2Client);
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Authentication failed</h1></body></html>');
            server.close();
            reject(error);
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>No code received</h1></body></html>');
        }
      }
    });

    server.listen(3000, () => {
      console.error('Opening browser for authentication...');
      open(authUrl);
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out'));
    }, 120000);
  });
}
