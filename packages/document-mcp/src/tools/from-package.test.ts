import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import {
  base64ToBytes,
  createDocx,
  createOds,
  decodeDocumentPackage,
  docxToPdf,
  type DocumentTree,
  documentTreeWithSchema,
  odsToPdf,
  openDocx,
  readOdsContent,
  readPdf,
  xlsxToOds,
} from 'documents.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../server';

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- proving `from_package` is registered under that name, reads a real DocumentTree back in via documentFromJson, and rebuilds real bytes from it via documents.js's own buildDocumentBytes. Mirrors document-cli's own src/commands/from-package.test.ts, which proves the identical round trip for the CLI's --dump-package/from-package pair.

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

const PARAGRAPH_TEXT = 'A paragraph dumped to a DocumentTree and read back again';
const SHEET_CELL_TEXT = 'A cell dumped to a DocumentTree and rebuilt as xlsx';

describe('from_package', () => {
  let workspace: string;
  let packagePath: string;
  let sheetPackagePath: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'document-mcp-from-package-'));

    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: PARAGRAPH_TEXT });

    // docxToPdf's own onDocument hands back the exact DocumentTree (content + pages, with per-node frames) a real docx-to-pdf conversion built internally -- the same value document-cli's --dump-package writes to disk, reused here rather than hand-built, since a hand-built DocumentTree would need to fabricate a plausible frame set from scratch.
    let capturedPackage: DocumentTree | undefined;
    docxToPdf(editor.toBytes(), {
      onDocument: (pkg) => {
        capturedPackage = pkg;
      },
    });
    if (capturedPackage === undefined) {
      throw new Error('docxToPdf never invoked onDocument -- fixture setup is broken');
    }

    packagePath = join(workspace, 'dumped.package.json');
    await writeFile(packagePath, JSON.stringify(documentTreeWithSchema(capturedPackage)));

    const odsEditor = createOds();
    const sheet = odsEditor.sheets()[0];
    if (sheet === undefined) {
      throw new Error('createOds() did not produce a default sheet');
    }
    sheet.cell(0, 0).value = { kind: 'string', value: SHEET_CELL_TEXT };
    // A cell()-materialized column/row otherwise reads back with no width/height style at all (widthPt/heightPt 0), which fails DocumentTree's own schema validation once the dumped package round-trips through JSON below.
    sheet.setColumnWidth(0, 72);
    sheet.setRowHeight(0, 14);

    let capturedSheetPackage: DocumentTree | undefined;
    odsToPdf(odsEditor.toBytes(), {
      onDocument: (pkg) => {
        capturedSheetPackage = pkg;
      },
    });
    if (capturedSheetPackage === undefined) {
      throw new Error('odsToPdf never invoked onDocument -- fixture setup is broken');
    }

    sheetPackagePath = join(workspace, 'dumped-sheet.package.json');
    await writeFile(sheetPackagePath, JSON.stringify(documentTreeWithSchema(capturedSheetPackage)));
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

  it('rebuilds a real docx from the dumped DocumentTree, written to a path', async () => {
    const rebuiltPath = join(workspace, 'rebuilt.docx');

    const result = await pair.client.callTool({
      name: 'from_package',
      arguments: { source: { path: packagePath }, targetFormat: 'docx', output: { outputPath: rebuiltPath } },
    });

    expect(result.isError).toBeFalsy();
    const rebuilt = openDocx(new Uint8Array(await readFile(rebuiltPath)));
    expect(rebuilt.paragraphs().some((paragraph) => paragraph.text === PARAGRAPH_TEXT)).toBe(true);
  });

  it('rebuilds a real pdf from the dumped DocumentTree, returned inline', async () => {
    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: packagePath }, targetFormat: 'pdf' } });

    expect(result.isError).toBeFalsy();
    if (!isRecord(result.structuredContent) || typeof result.structuredContent.bytesBase64 !== 'string') {
      throw new Error('expected an inline bytesBase64 result');
    }
    const layout = readPdf(base64ToBytes(result.structuredContent.bytesBase64));
    expect(layout.pages.length).toBeGreaterThan(0);
  });

  it('builds a real xlsx from a spreadsheet-kind DocumentTree now that documents.js wires a real xlsx content codec', async () => {
    // xlsx used to be rejected outright here -- documents.js's own DOCUMENT_FORMAT_CODECS registry gained a real xlsx content codec (wrapping ooxml.js's readXlsxContent/buildXlsxPackage), and buildDocumentBytes now dispatches through it like every other format instead of naming xlsx as a special exception.
    const rebuiltPath = join(workspace, 'rebuilt.xlsx');

    const result = await pair.client.callTool({
      name: 'from_package',
      arguments: { source: { path: sheetPackagePath }, targetFormat: 'xlsx', output: { outputPath: rebuiltPath } },
    });

    expect(result.isError).toBeFalsy();

    // Round-trips the rebuilt xlsx back through the real xlsx-to-ods bridge to prove the bytes are a genuine, readable xlsx workbook carrying the original cell, not just a file that happened to get written.
    const odsBackBytes = xlsxToOds(new Uint8Array(await readFile(rebuiltPath)));
    const content = readOdsContent(decodeDocumentPackage('ods', odsBackBytes));
    if (content.kind !== 'spreadsheet') {
      throw new Error(`expected a spreadsheet ContentDocument, got ${content.kind}`);
    }
    expect(content.sheets[0]?.cells[0]?.value).toEqual({ kind: 'string', value: SHEET_CELL_TEXT });
  });

  it('still rejects xlsx when the dumped package is the wrong ContentDocument kind', async () => {
    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: packagePath }, targetFormat: 'xlsx' } });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === 'text' ? block.text : undefined).toContain('expected a ContentDocument of kind "spreadsheet", got "wordprocessing"');
  });

  it('rejects a source with no recognised $schema', async () => {
    const plainPath = join(workspace, 'plain.json');
    await writeFile(plainPath, JSON.stringify({ hello: 'world' }));

    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: plainPath }, targetFormat: 'docx' } });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === 'text' ? block.text : undefined).toContain('no recognised $schema');
  });

  it('rejects a pre-schema-4 package dump (formatVersion 1, layout half) through the rename tombstone', async () => {
    // Hand-built rather than captured: no current documents.js conversion can produce this shape any more (documents.js 1.x's formatVersion 1, a 'layout' half beside 'content'), under the document-package.schema.json name every release before ExaDev/documents.js#661's rename used. documentFromJson refuses any document-package-stemmed URI outright, by name alone, before it ever reaches the version-major gate -- so this dies in the rename tombstone, not the version gate, and the tool surfaces that error's message verbatim.
    const legacyPath = join(workspace, 'legacy.package.json');
    await writeFile(
      legacyPath,
      JSON.stringify({
        $schema: 'https://cdn.jsdelivr.net/npm/document-schema.js@2.7.17/schemas/document-package.schema.json',
        formatVersion: 1,
        content: { kind: 'wordprocessing', formatVersion: 2, metadata: {}, sections: [] },
        layout: { formatVersion: 1, pages: [] },
      }),
    );

    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: legacyPath }, targetFormat: 'docx' } });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    const text = block?.type === 'text' ? block.text : undefined;
    expect(text).toContain('document-schema.js@2.7.17');
    expect(text).toContain('DocumentPackage was renamed to DocumentTree');
  });

  it('also rejects the fused formatVersion 2 shape (schema 3.x flat content+pages) through the same rename tombstone', async () => {
    // The other pre-tree shape: documents.js 2.x (on document-schema.js 3.x, here pinned @3.0.0) dumped formatVersion 2 with flat content+pages -- also under the document-package.schema.json name, so it hits the identical rename tombstone the formatVersion-1 dump above does, regardless of how much further back its own shape sits.
    const legacyPath = join(workspace, 'legacy-fused.package.json');
    await writeFile(
      legacyPath,
      JSON.stringify({
        $schema: 'https://cdn.jsdelivr.net/npm/document-schema.js@3.0.0/schemas/document-package.schema.json',
        formatVersion: 2,
        content: { kind: 'wordprocessing', formatVersion: 2, metadata: {}, sections: [] },
        pages: [],
      }),
    );

    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: legacyPath }, targetFormat: 'docx' } });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    const text = block?.type === 'text' ? block.text : undefined;
    expect(text).toContain('DocumentPackage was renamed to DocumentTree');
  });

  it('rejects a layout-document dump with the demotion error naming where the schema moved', async () => {
    // A layout-document dump was never a DocumentTree, but its $schema URI is still recognised -- answered by the demotion tombstone rather than the no-recognised-$schema branch, so a caller holding one learns the schema moved to pdf-codec instead of hearing the value is unrecognised.
    const layoutPath = join(workspace, 'legacy-layout.package.json');
    await writeFile(
      layoutPath,
      JSON.stringify({
        $schema: 'https://cdn.jsdelivr.net/npm/document-schema.js@3.0.0/schemas/layout-document.schema.json',
        formatVersion: 1,
        pages: [],
      }),
    );

    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: layoutPath }, targetFormat: 'docx' } });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    const text = block?.type === 'text' ? block.text : undefined;
    expect(text).toContain('layout-document dump');
    expect(text).toContain('moved to pdf-codec');
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
