// Smoke test: the real built dist/bin.js runs correctly as a genuine subprocess speaking the actual MCP stdio protocol -- not an in-process InMemoryTransport pair (every src/tools/*.test.ts file already proves the in-process wiring) and not a handler function called directly. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to the "smoke" project), never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. Every test here connects a real @modelcontextprotocol/client Client over a real StdioClientTransport spawning `node dist/bin.js`, matching document-cli's own test/smoke.test.mjs convention (spawn the built artifact, assert on genuine output) adapted from argv/exit-code assertions to a real JSON-RPC tools/list + tools/call round trip.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { bytesToBase64, createDocx } from 'documents.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BIN_PATH = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

// The one real .odb fixture this repo checks in (src/test-support/odb-fixture.ts's own source) -- referenced by path directly here rather than through that helper, since this file deliberately stays outside tsconfig's "src" program (it tests build output, matching document-cli's identical exclusion) and so cannot import a .ts module.
const FORM_AND_REPORT_ODB_PATH = fileURLToPath(new URL('../src/test-support/fixtures/form-and-report.odb', import.meta.url));

// Every tool src/server.ts's createServer() actually registers, across all ten tool modules -- kept as an explicit sorted list (rather than merely asserting a count) so a renamed or dropped tool fails this test by name, not just by a number changing.
const EXPECTED_TOOL_NAMES = [
  'convert_document',
  'describe_font_file',
  'docx_extras',
  'fonts',
  'from_package',
  'list_document_conversions',
  'metadata_read',
  'metadata_write',
  'odb_forms',
  'odb_query',
  'odb_render_report',
  'odb_reports',
  'odb_tables',
  'odb_to_csv',
  'odb_to_xlsx',
  'odm_to_pdf',
  'outline_document',
  'pdf_inspect',
].sort();

// A tiny, real docx fixture built through documents.js's own live-view editor (already a dependency of this package) -- exercised as genuine input bytes, matching document-cli's own smoke test convention, not a hand-crafted stub.
function buildFixtureDocxBytes() {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: 'Hello from the document-mcp smoke test.' });
  return editor.toBytes();
}

function isPdfBytes(bytes) {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 5)) === '%PDF-';
}

// odb_tables returns a bare array as structuredContent, matching what its own callback hands back to registerTool -- but the 2025-11-25 wire era's own SEP-2106 projection boxes a non-object structuredContent value as `{ result: [...] }` before it reaches a client (the 2026-07-28 era codec does not). Unwraps either shape, mirroring src/tools/odb.test.ts's own arrayStructuredContent helper.
function unwrapArrayStructuredContent(structuredContent) {
  return Array.isArray(structuredContent) ? structuredContent : structuredContent.result;
}

describe('document-mcp stdio smoke test', () => {
  let client;
  let transport;

  beforeAll(async () => {
    // process.execPath rather than relying on dist/bin.js's own shebang/chmod bit, so this doesn't depend on the host OS honouring executable permissions -- matches document-cli's own spawnCli helper.
    transport = new StdioClientTransport({ command: process.execPath, args: [BIN_PATH] });
    client = new Client({ name: 'document-mcp-smoke-test', version: '0.0.0' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
  });

  it('lists exactly the real registered tool set, by name, over a genuine stdio connection', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('list_document_conversions reports real (source, target) pairs from the built DocumentConverter port', async () => {
    const result = await client.callTool({ name: 'list_document_conversions', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.conversions).toContainEqual({ source: 'docx', target: 'pdf' });
    expect(result.structuredContent.conversions).toContainEqual({ source: 'markdown', target: 'pdf' });
  });

  it('convert_document converts a real inline docx fixture to a genuine PDF, then metadata_read reads it back', async () => {
    const docxBytes = buildFixtureDocxBytes();

    const convertResult = await client.callTool({
      name: 'convert_document',
      arguments: { source: { bytesBase64: bytesToBase64(docxBytes), format: 'docx' }, targetFormat: 'pdf' },
    });
    expect(convertResult.isError).toBeFalsy();
    expect(convertResult.structuredContent.targetFormat).toBe('pdf');
    const pdfBase64 = convertResult.structuredContent.output.bytesBase64;
    expect(typeof pdfBase64).toBe('string');
    expect(isPdfBytes(Buffer.from(pdfBase64, 'base64'))).toBe(true);

    const metadataResult = await client.callTool({
      name: 'metadata_read',
      arguments: { source: { bytesBase64: pdfBase64, format: 'pdf' } },
    });
    expect(metadataResult.isError).toBeFalsy();
    expect(metadataResult.structuredContent.producer).toBe('documents.js');
  });

  it('odb_tables reads the real embedded-Firebird .odb fixture from a filesystem path', async () => {
    // Confirms both the fixture itself is real (checked in bytes, read here directly rather than through src/test-support/odb-fixture.ts) and the { path } half of the hybrid DocumentInput contract works over a genuine stdio connection, not just inline base64.
    expect(readFileSync(FORM_AND_REPORT_ODB_PATH).byteLength).toBeGreaterThan(0);

    const result = await client.callTool({ name: 'odb_tables', arguments: { source: { path: FORM_AND_REPORT_ODB_PATH } } });
    expect(result.isError).toBeFalsy();
    const tables = unwrapArrayStructuredContent(result.structuredContent);
    const salesTable = tables.find((table) => table.tableName === 'SALES');
    expect(salesTable).toBeDefined();
    expect(salesTable.rows.length).toBeGreaterThan(0);
  });
});

// The line src/bin.ts writes to stderr once the HTTP listener is actually bound -- matched against the spawned child's real stderr output below rather than assumed, so this test fails honestly if the startup log ever stops matching what the server actually reports.
const HTTP_LISTENING_LINE = /^document-mcp listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp$/m;

// Waits for the spawned document-mcp child to report its bound port on stderr, rejecting if it exits first (a real startup failure, e.g. a port already in use) or if the line never appears within the timeout.
function waitForHttpPort(child) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onStderr = (chunk) => {
      buffer += chunk.toString('utf8');
      const match = HTTP_LISTENING_LINE.exec(buffer);
      if (match) {
        child.stderr.off('data', onStderr);
        child.off('exit', onExit);
        resolve(Number(match[1]));
      }
    };
    const onExit = (code) => {
      reject(new Error(`document-mcp --transport http exited before reporting a listening port (code ${code})`));
    };
    child.stderr.on('data', onStderr);
    child.once('exit', onExit);
  });
}

describe('document-mcp http smoke test', () => {
  let child;
  let client;
  let port;

  beforeAll(async () => {
    // --port 0 asks the OS for a free port rather than hardcoding one, so this test cannot collide with anything else already listening on the host -- the real port is read back from the child's own startup log line via waitForHttpPort.
    child = spawn(process.execPath, [BIN_PATH, '--transport', 'http', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    port = await waitForHttpPort(child);

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    client = new Client({ name: 'document-mcp-http-smoke-test', version: '0.0.0' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    child?.kill();
  });

  it('lists exactly the real registered tool set, by name, over a genuine Streamable HTTP connection', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('convert_document converts a real inline docx fixture to a genuine PDF over HTTP', async () => {
    const docxBytes = buildFixtureDocxBytes();

    const convertResult = await client.callTool({
      name: 'convert_document',
      arguments: { source: { bytesBase64: bytesToBase64(docxBytes), format: 'docx' }, targetFormat: 'pdf' },
    });
    expect(convertResult.isError).toBeFalsy();
    expect(convertResult.structuredContent.targetFormat).toBe('pdf');
    expect(isPdfBytes(Buffer.from(convertResult.structuredContent.output.bytesBase64, 'base64'))).toBe(true);
  });

  it('requests to a path other than /mcp 404, proving the listener actually routes rather than accepting anything', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/not-mcp`);
    expect(response.status).toBe(404);
  });
});
