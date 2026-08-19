import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { base64ToBytes, bytesToBase64, createDocx, createOds, decodeDocumentPackage, odsToXlsx, readOdsContent, xlsxToOds } from 'documents.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../server';

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- not the tool callbacks in isolation -- so this proves the wiring: that `metadata_read`/`metadata_write` are registered under those names, that they reach documents.js's real readDocumentMetadata/setDocumentMetadata, and that a rejection documents.js throws (an unsupported xlsx target, say) reaches the caller as an isError result carrying documents.js's own message text verbatim. Mirrors src/tools/docx-extras.test.ts's own connection harness.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({ name: 'metadata-test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: async () => client.close() };
}

// A tool result's structuredContent is typed `unknown` on the wire (the MCP schema has no way to know a given tool's real output shape ahead of time), so every assertion below narrows through this guard first rather than reaching for a type assertion.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('metadata_read / metadata_write', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'document-mcp-metadata-'));
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

  it("reads a freshly created docx's own metadata via inline base64 bytes", async () => {
    const bytes = createDocx().toBytes();

    const result = await pair.client.callTool({ name: 'metadata_read', arguments: { source: { bytesBase64: bytesToBase64(bytes), format: 'docx' } } });

    expect(result.isError).toBeFalsy();
    const metadata = result.structuredContent;
    if (!isRecord(metadata)) {
      throw new Error('expected metadata_read to return a structured LayoutMetadata object');
    }
    // A freshly created docx has real creation/modification timestamps but no title/author/subject/keywords set yet.
    expect(typeof metadata.createdIso).toBe('string');
    expect(typeof metadata.modifiedIso).toBe('string');
    expect(metadata.title).toBeUndefined();
    expect(metadata.author).toBeUndefined();
    expect(metadata.subject).toBeUndefined();
    expect(metadata.keywords).toBeUndefined();

    // content mirrors structuredContent as JSON text -- the same "content is JSON.stringify(structuredContent)" convention every other tool in this package follows. toEqual (not toStrictEqual): JSON.stringify drops metadata's own explicit-undefined title/author/subject/keywords/creator keys, so the parsed text legitimately has fewer keys than structuredContent while still being value-equal.
    const [block] = result.content;
    expect(block?.type).toBe('text');
    expect(block?.type === 'text' ? JSON.parse(block.text) : undefined).toEqual(result.structuredContent);
  });

  it('writes title/author/subject/keywords to a file on disk, then reads them back from that same file', async () => {
    const sourcePath = join(workspace, 'round-trip-source.docx');
    const patchedPath = join(workspace, 'round-trip-patched.docx');
    await writeFile(sourcePath, createDocx().toBytes());

    const writeResult = await pair.client.callTool({
      name: 'metadata_write',
      arguments: {
        source: { path: sourcePath },
        targetFormat: 'docx',
        output: { outputPath: patchedPath },
        setTitle: 'Round Trip Title',
        setAuthor: 'Ada Lovelace',
        setSubject: 'Metadata round trip test',
        setKeywords: ['metadata', 'round-trip'],
      },
    });

    expect(writeResult.isError).toBeFalsy();
    const writeOutput = writeResult.structuredContent;
    if (!isRecord(writeOutput)) {
      throw new Error('expected metadata_write to return a structured WrittenDocumentOutput object');
    }
    expect(writeOutput.path).toBe(patchedPath);
    expect(typeof writeOutput.byteLength).toBe('number');

    const readResult = await pair.client.callTool({ name: 'metadata_read', arguments: { source: { path: patchedPath } } });

    expect(readResult.isError).toBeFalsy();
    const readMetadata = readResult.structuredContent;
    if (!isRecord(readMetadata)) {
      throw new Error('expected metadata_read to return a structured LayoutMetadata object');
    }
    expect(readMetadata.title).toBe('Round Trip Title');
    expect(readMetadata.author).toBe('Ada Lovelace');
    expect(readMetadata.subject).toBe('Metadata round trip test');
    expect(readMetadata.keywords).toStrictEqual(['metadata', 'round-trip']);
    expect(typeof readMetadata.createdIso).toBe('string');
    expect(typeof readMetadata.modifiedIso).toBe('string');
  });

  it('patches an xlsx file in place now that documents.js wires a real xlsx content codec, leaving its cells untouched', async () => {
    // xlsx used to be rejected outright here -- documents.js's own DOCUMENT_FORMAT_CODECS registry gained a real xlsx content codec, and setDocumentMetadata now rebuilds xlsx through the identical readXContent -> buildXPackage shape every other REBUILD_FORMATS member already used.
    const sheetCellText = 'A cell surviving an xlsx metadata patch via document-mcp';
    const odsEditor = createOds();
    const sheet = odsEditor.sheets()[0];
    if (sheet === undefined) {
      throw new Error('createOds() did not produce a default sheet');
    }
    sheet.cell(0, 0).value = { kind: 'string', value: sheetCellText };
    sheet.setColumnWidth(0, 72);
    sheet.setRowHeight(0, 14);
    const xlsxBytes = odsToXlsx(odsEditor.toBytes());

    const result = await pair.client.callTool({
      name: 'metadata_write',
      arguments: { source: { bytesBase64: bytesToBase64(xlsxBytes), format: 'xlsx' }, targetFormat: 'xlsx', setTitle: 'New xlsx title' },
    });

    expect(result.isError).toBeFalsy();
    if (!isRecord(result.structuredContent) || typeof result.structuredContent.bytesBase64 !== 'string') {
      throw new Error('expected an inline bytesBase64 result');
    }

    // Round-trips the patched xlsx back through the real xlsx-to-ods bridge to prove the bytes are a genuine, readable xlsx workbook carrying both the new title and the original cell.
    const odsBackBytes = xlsxToOds(base64ToBytes(result.structuredContent.bytesBase64));
    const content = readOdsContent(decodeDocumentPackage('ods', odsBackBytes));
    if (content.kind !== 'spreadsheet') {
      throw new Error(`expected a spreadsheet ContentDocument, got ${content.kind}`);
    }
    expect(content.metadata.title).toBe('New xlsx title');
    expect(content.sheets[0]?.cells[0]?.value).toEqual({ kind: 'string', value: sheetCellText });
  });

  it('still rejects a cross-format request into xlsx -- metadata_write patches metadata in place, it does not convert format', async () => {
    const bytes = createDocx().toBytes();

    const result = await pair.client.callTool({
      name: 'metadata_write',
      arguments: { source: { bytesBase64: bytesToBase64(bytes), format: 'docx' }, targetFormat: 'xlsx', setTitle: 'Should never apply' },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type).toBe('text');
    expect(block?.type === 'text' ? block.text : undefined).toContain('does not convert format');
  });
});
