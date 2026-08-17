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
  type DocumentPackage,
  documentPackageWithSchema,
  odsToPdf,
  openDocx,
  readOdsContent,
  readPdf,
  xlsxToOds,
} from 'documents.js';
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
const SHEET_CELL_TEXT = 'A cell dumped to a DocumentPackage and rebuilt as xlsx';

describe('from_package', () => {
  let workspace: string;
  let packagePath: string;
  let sheetPackagePath: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'document-mcp-from-package-'));

    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: PARAGRAPH_TEXT });

    // docxToPdf's own onDocument hands back the exact DocumentPackage (content + pages, with per-node frames) a real docx-to-pdf conversion built internally -- the same value document-cli's --dump-package writes to disk, reused here rather than hand-built, since a hand-built DocumentPackage would need to fabricate a plausible frame set from scratch.
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

    const odsEditor = createOds();
    const sheet = odsEditor.sheets()[0];
    if (sheet === undefined) {
      throw new Error('createOds() did not produce a default sheet');
    }
    sheet.cell(0, 0).value = { kind: 'string', value: SHEET_CELL_TEXT };
    // A cell()-materialized column/row otherwise reads back with no width/height style at all (widthPt/heightPt 0), which fails DocumentPackage's own schema validation once the dumped package round-trips through JSON below.
    sheet.setColumnWidth(0, 72);
    sheet.setRowHeight(0, 14);

    let capturedSheetPackage: DocumentPackage | undefined;
    odsToPdf(odsEditor.toBytes(), {
      onDocument: (pkg) => {
        capturedSheetPackage = pkg;
      },
    });
    if (capturedSheetPackage === undefined) {
      throw new Error('odsToPdf never invoked onDocument -- fixture setup is broken');
    }

    sheetPackagePath = join(workspace, 'dumped-sheet.package.json');
    await writeFile(sheetPackagePath, JSON.stringify(documentPackageWithSchema(capturedSheetPackage)));
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

  it('builds a real xlsx from a spreadsheet-kind DocumentPackage now that documents.js wires a real xlsx content codec', async () => {
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

  it('rejects a pre-documents.js-2.0.0 package dump with an error naming the shape change', async () => {
    // Hand-built rather than captured: documents.js 2.0.0's own conversions can no longer produce this shape (formatVersion 1, a 'layout' half beside 'content'), and rejection keys on the $schema + formatVersion/layout signals alone, before any content is validated. The $schema URI is the 2.7.17-era one a real old dump carries -- documentFromJson recognises document-package URIs from any document-schema.js release, so this dump reaches DocumentPackageSchema.parse and dies there on formatVersion.
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
    expect(text).toContain('old formatVersion 1');
    expect(text).toContain('regenerate the dump');
  });

  it('also rejects a legacy dump whose formatVersion is missing but which still carries the layout half', async () => {
    const legacyPath = join(workspace, 'legacy-no-version.package.json');
    await writeFile(
      legacyPath,
      JSON.stringify({
        $schema: 'https://cdn.jsdelivr.net/npm/document-schema.js@2.7.17/schemas/document-package.schema.json',
        content: { kind: 'wordprocessing', formatVersion: 2, metadata: {}, sections: [] },
        layout: { formatVersion: 1, pages: [] },
      }),
    );

    const result = await pair.client.callTool({ name: 'from_package', arguments: { source: { path: legacyPath }, targetFormat: 'docx' } });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type === 'text' ? block.text : undefined).toContain('old formatVersion 1');
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
