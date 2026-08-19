import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { bytesToBase64, encodeMarkdownText } from 'documents.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../../src';

// Drives the real createServer() -- the same constructor src/bin.ts wires to @modelcontextprotocol/server/stdio -- through an in-memory client/server JSON-RPC pair (InMemoryTransport, no stdio transport, no node:fs) under the Cloudflare Workers runtime (workerd, via @cloudflare/vitest-pool-workers). document-mcp is a stdio MCP server by design, so this does not attempt a full workerd run of the server's own entry point; it exercises the convert_document tool handler's body via inline base64 fixtures (no filesystem), proving the wrapped documents.js logic it delegates to -- resolveDocumentInput's bytesBase64 path -> createLocalDocumentConverter().convert() over the markdown -> docx PDF-bypassing bridge -> resolveDocumentOutput's inline path -- executes inside a workerd isolate with no Node-only API actually invoked on the exercised path. The MCP server SDK carries no node: imports in its core (the stdio transport is isolated to /stdio, deliberately not imported here), and documents.js's markdown -> docx bridge is the identical isomorphic path documents.js's own workerd suite already proves. If any exercised path touched node:fs/Buffer/process.stdin at module top level or on the call path, the workerd isolate would throw at import or invocation rather than these passing.

async function connect() {
  const server = createServer();
  const client = new Client({ name: 'workers-test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: async () => client.close() };
}

describe('convert_document (markdown -> docx) under the Cloudflare Workers runtime', () => {
  it('returns non-empty inline docx bytes through the in-memory MCP round trip', async () => {
    const pair = await connect();
    try {
      const markdownBytes = encodeMarkdownText('# Heading\n\nA paragraph with **bold** text.\n');
      const result = await pair.client.callTool({
        name: 'convert_document',
        arguments: {
          source: { bytesBase64: bytesToBase64(markdownBytes), format: 'markdown' },
          targetFormat: 'docx',
        },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { output: { bytesBase64?: string; byteLength?: number } };
      expect(structured.output.bytesBase64).toBeTruthy();
      expect(structured.output.byteLength).toBeGreaterThan(0);

      // The docx is a zip package, so its decoded bytes begin with the OPC/ZIP local-file-header signature 'PK'.
      expect(atob(structured.output.bytesBase64 as string).charCodeAt(0)).toBe(0x50); // 'P'
    } finally {
      await pair.close();
    }
  });

  it('list_document_conversions returns the converter dispatch table the server built at registration', async () => {
    const pair = await connect();
    try {
      const result = await pair.client.callTool({ name: 'list_document_conversions', arguments: {} });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { conversions: Array<{ source: string; target: string }> };
      expect(structured.conversions.length).toBeGreaterThan(0);
      // The markdown -> docx bridge is one of the pairs the dispatch table advertises.
      expect(structured.conversions).toContainEqual({ source: 'markdown', target: 'docx' });
    } finally {
      await pair.close();
    }
  });
});
