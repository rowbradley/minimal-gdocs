# minimal-gdocs

A minimal MCP server for creating and updating Google Docs from markdown. Built for [Claude Code](https://claude.ai/claude-code).

## Features

- **Create Google Docs** from markdown with native formatting
- **Update existing docs** (replace or append)
- **List recent docs** with optional search
- **Full markdown support:**
  - Headings (H1-H6)
  - Bold, italic, and **nested *formatting***
  - Bullet and numbered lists
  - Links
  - Horizontal rules
  - Code blocks (monospace)

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/minimal-gdocs.git
cd minimal-gdocs
npm install
npm run build
```

Or via npm (once published):
```bash
npx minimal-gdocs
```

## Google Cloud Setup

You need Google OAuth credentials. Choose **one** of these methods:

### Option A: Google Cloud Console (Web)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Google Docs API**:
   - Go to "APIs & Services" → "Library"
   - Search "Google Docs API" → Enable
4. Create OAuth credentials:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: **Desktop app**
   - Download the JSON file
5. Rename it to `credentials.json` and place in project root

### Option B: gcloud CLI

```bash
# Install gcloud if needed: https://cloud.google.com/sdk/docs/install

# Login and set project
gcloud auth login
gcloud projects create minimal-gdocs-project --name="Minimal GDocs"
gcloud config set project minimal-gdocs-project

# Enable Docs API
gcloud services enable docs.googleapis.com

# Create OAuth credentials
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/drive.file

# For MCP server, you still need OAuth client credentials:
# Go to console.cloud.google.com → APIs & Services → Credentials
# Create "OAuth client ID" → Desktop app → Download JSON
```

## Claude Code Configuration

Add to your Claude Code `settings.json`:

```json
{
  "mcpServers": {
    "gdocs": {
      "command": "node",
      "args": ["/path/to/minimal-gdocs/dist/index.js"]
    }
  }
}
```

Or if installed globally via npm:
```json
{
  "mcpServers": {
    "gdocs": {
      "command": "npx",
      "args": ["minimal-gdocs"]
    }
  }
}
```

## First Run

On first use, the server will:
1. Open your browser for Google OAuth consent
2. Ask you to authorize access to Google Docs
3. Save the token locally (in `token.json`)

Subsequent runs use the saved token automatically.

## Usage

Once configured, Claude Code can use these tools:

### create_google_doc
```
Create a Google Doc from markdown:
- title: Document title
- content: Markdown content
- folderId: (optional) Google Drive folder ID
```

### update_google_doc
```
Update an existing doc:
- docId: The Google Doc ID
- content: New markdown content
- mode: "replace" or "append"
```

### list_recent_docs
```
List your recent Google Docs:
- limit: (optional) Max docs to return
- query: (optional) Search filter
```

### get_doc_url
```
Get URLs for a doc:
- docId: The Google Doc ID
Returns: edit URL, view URL, PDF export URL
```

## Example

In Claude Code:
```
"Publish this to Google Docs"

# My Document

Here's some **bold** and *italic* text.

- Bullet one
- Bullet two

1. Numbered item
2. Another item
```

Creates a properly formatted Google Doc with native styling.

## License

MIT
