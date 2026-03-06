#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { getAuthClient } from './auth.js';
import { markdownToDocsRequests } from './utils/markdown-to-docs.js';

const server = new Server(
  { name: 'gdocs-minimal', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Tool definitions
const TOOLS = [
  {
    name: 'create_google_doc',
    description: 'Create a new Google Doc from markdown content',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Markdown content for the document' },
        folderId: { type: 'string', description: 'Optional Google Drive folder ID to create the doc in' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'update_google_doc',
    description: 'Update an existing Google Doc with new markdown content',
    inputSchema: {
      type: 'object',
      properties: {
        docId: { type: 'string', description: 'Google Doc ID' },
        content: { type: 'string', description: 'New markdown content' },
        mode: { type: 'string', enum: ['replace', 'append'], description: 'Replace all content or append to end' }
      },
      required: ['docId', 'content']
    }
  },
  {
    name: 'list_recent_docs',
    description: 'List recent Google Docs from your Drive',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of docs to return (default 10)' },
        query: { type: 'string', description: 'Optional search query to filter docs by name' }
      }
    }
  },
  {
    name: 'get_doc_url',
    description: 'Get the URL for a Google Doc',
    inputSchema: {
      type: 'object',
      properties: {
        docId: { type: 'string', description: 'Google Doc ID' }
      },
      required: ['docId']
    }
  }
];

// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const auth = await getAuthClient();
    const docs = google.docs({ version: 'v1', auth });
    const drive = google.drive({ version: 'v3', auth });

    switch (name) {
      case 'create_google_doc': {
        const { title, content, folderId } = args as { title: string; content: string; folderId?: string };

        // Create the document
        const createResponse = await docs.documents.create({
          requestBody: { title }
        });

        const docId = createResponse.data.documentId!;

        // Convert markdown to Docs API requests and apply
        const requests = markdownToDocsRequests(content);
        if (requests.length > 0) {
          await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
          });
        }

        // Move to folder if specified
        if (folderId) {
          await drive.files.update({
            fileId: docId,
            addParents: folderId,
            fields: 'id, parents'
          });
        }

        const url = `https://docs.google.com/document/d/${docId}/edit`;
        return {
          content: [{ type: 'text', text: JSON.stringify({ docId, url, title }, null, 2) }]
        };
      }

      case 'update_google_doc': {
        const { docId, content, mode = 'replace' } = args as { docId: string; content: string; mode?: string };

        if (mode === 'replace') {
          // Get current document to find content length
          const doc = await docs.documents.get({ documentId: docId });
          const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

          // Delete existing content (except the trailing newline)
          if (endIndex > 2) {
            await docs.documents.batchUpdate({
              documentId: docId,
              requestBody: {
                requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }]
              }
            });
          }
        }

        // Insert new content
        const requests = markdownToDocsRequests(content);
        if (requests.length > 0) {
          // For append mode, we need to get the current end index
          if (mode === 'append') {
            const doc = await docs.documents.get({ documentId: docId });
            const endIndex = (doc.data.body?.content?.slice(-1)[0]?.endIndex || 1) - 1;
            // Adjust all request indices
            for (const req of requests) {
              if (req.insertText?.location?.index != null) {
                (req.insertText.location as { index: number }).index += endIndex;
              }
              if (req.updateTextStyle?.range) {
                (req.updateTextStyle.range as { startIndex: number }).startIndex += endIndex;
                (req.updateTextStyle.range as { endIndex: number }).endIndex += endIndex;
              }
              if (req.updateParagraphStyle?.range) {
                (req.updateParagraphStyle.range as { startIndex: number }).startIndex += endIndex;
                (req.updateParagraphStyle.range as { endIndex: number }).endIndex += endIndex;
              }
              if (req.createParagraphBullets?.range) {
                (req.createParagraphBullets.range as { startIndex: number }).startIndex += endIndex;
                (req.createParagraphBullets.range as { endIndex: number }).endIndex += endIndex;
              }
              if (req.insertTable?.location?.index != null) {
                (req.insertTable.location as { index: number }).index += endIndex;
              }
            }
          }

          await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
          });
        }

        const url = `https://docs.google.com/document/d/${docId}/edit`;
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, docId, url }, null, 2) }]
        };
      }

      case 'list_recent_docs': {
        const { limit = 10, query } = args as { limit?: number; query?: string };

        let q = "mimeType='application/vnd.google-apps.document'";
        if (query) {
          q += ` and name contains '${query}'`;
        }

        const response = await drive.files.list({
          q,
          pageSize: limit,
          orderBy: 'modifiedTime desc',
          fields: 'files(id, name, modifiedTime, webViewLink)'
        });

        const docs = response.data.files?.map(file => ({
          id: file.id,
          title: file.name,
          modifiedTime: file.modifiedTime,
          url: file.webViewLink
        })) || [];

        return {
          content: [{ type: 'text', text: JSON.stringify({ docs }, null, 2) }]
        };
      }

      case 'get_doc_url': {
        const { docId } = args as { docId: string };
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              url: `https://docs.google.com/document/d/${docId}/edit`,
              viewUrl: `https://docs.google.com/document/d/${docId}/view`,
              exportPdfUrl: `https://docs.google.com/document/d/${docId}/export?format=pdf`
            }, null, 2)
          }]
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GDocs Minimal MCP server running');
}

main().catch(console.error);
