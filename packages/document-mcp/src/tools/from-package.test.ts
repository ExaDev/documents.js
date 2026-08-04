import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { base64ToBytes, createDocx, docxToPdf, type DocumentPackage, documentPackageWithSchema, openDocx, readPdf } from 'documents.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../server';

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- proving `from_package` is registered under that name, reads a real DocumentPackage back in via documentFromJson, and rebuilds real bytes from it via documents.js's own buildDocumentBytes. Mirrors document-cli's own src/commands/from-package.test.ts, which proves the identical round trip for the CLI's --dump-package/from-package pair.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({ name: 'from-package-test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: async () => client.close() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PARAGRAPH_TEXT = 'A paragraph dumped to a DocumentPackage and read back again';

describe('from_package', () => {
  let workspace: string;
  let packagePath: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'document-mcp-from-package-'));

    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: PARAGRAPH_TEXT });

    // docxToPdf's own onDocument hands back the exact DocumentPackage (content + layout) a real docx-to-pdf conversion built internally -- the same value document-cli's --dump-package writes to disk, reused here rather than hand-built, since a hand-built DocumentPackage would need to fabricate a plausible LayoutDocument from scratch.
    let capturedPackage: DocumentPackage | undefined;
    docxToPdf(editor.toBytes(), {
      onDocument: (pkg) => {
        capturedPackage = pkg;
      },
    });
    if (capturedPackage === undefined) {
      throw new Error('docxToPdf never invoked onDocument -- fixture setup is broken');
    }

    packagePath = join(workspace, 'dumped.package.json');
    await writeFile(packagePath, JSON.stringify(documentPackageWithSchema(capturedPackage)));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  let pair: ConnectedPair;

  beforeEach(async () => {
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
  });

  it('rebuilds a real docx from the dumped DocumentPackage, written to a path', async () => {
    const rebuiltPath = join(workspace, 'rebuilt.docx');

    const result = await pair.client.callTool({
      name: 'from_package',
      arguments: { source: { path: packagePath }, targetFormat: 'docx', output: { outputPath: rebuiltPath } },
    });

    expect(result.isError).toBeFalsy();
    const rebuilt = openDocx(new Uint8Array(await readFile(rebuiltPath)));
    expect(rebuilt.paragraphs().some((paragraph) => paragraph.text === PARAGRAPH_TEXT)).toBe(true);
  });

  it('rebuilds a real pdf from the dumped DocumentPackage, returned inline', async () => {
    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: packagePath }, targetFormat: 'pdf' } });

    expect(result.isError).toBeFalsy();
    if (!isRecord(result.structuredContent) || typeof result.structuredContent.bytesBase64 !== 'string') {
      throw new Error('expected an inline bytesBase64 result');
    }
    const layout = readPdf(base64ToBytes(result.structuredContent.bytesBase64));
    expect(layout.pages.length).toBeGreaterThan(0);
  });

  it('rejects xlsx as a target outright, naming the ods-to-xlsx workaround', async () => {
    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: packagePath }, targetFormat: 'xlsx' } });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === 'text' ? block.text : undefined).toContain("'xlsx' cannot be built from a DocumentPackage directly");
  });

  it('rejects a source with no recognised $schema', async () => {
    const plainPath = join(workspace, 'plain.json');
    await writeFile(plainPath, JSON.stringify({ hello: 'world' }));

    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: plainPath }, targetFormat: 'docx' } });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === 'text' ? block.text : undefined).toContain('no recognised $schema');
  });

  it('rejects source text that is not valid JSON', async () => {
    const brokenPath = join(workspace, 'broken.json');
    await writeFile(brokenPath, '{not valid json');

    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: brokenPath }, targetFormat: 'docx' } });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === 'text' ? block.text : undefined).toContain('not valid JSON');
  });
});
