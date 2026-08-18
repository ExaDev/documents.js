import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocx, createOds, decodeDocumentPackage, openDocx, readOdsContent, xlsxToOds } from 'documents.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../program';
import { EXIT_SUCCESS } from '../runtime/exit-codes';

// Drives the real assembled commander program end to end, closing the round trip --dump-package otherwise has no return path for: a real docx-to-pdf conversion dumps its own intermediate DocumentPackage to a JSON file, from-package reads that exact file back in via documentFromJson, and the docx it rebuilds from the package's own ContentDocument is opened again and checked for the original paragraph text -- proving the JSON this CLI writes is genuinely the JSON this CLI can read back, not just two independently-plausible-looking halves that happen to share a name.

let workspace: string;

// Commander's action sets `process.exitCode` on the real process; a command that failed would otherwise leave a non-zero code behind and fail the whole vitest run for reasons unrelated to any assertion here.
let savedExitCode: typeof process.exitCode;

interface CapturedRun {
  readonly exitCode: typeof process.exitCode;
  readonly stderr: string;
}

async function runCli(args: readonly string[]): Promise<CapturedRun> {
  const stderrChunks: string[] = [];
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
  try {
    await createProgram().parseAsync(['node', 'document-cli', ...args]);
  } finally {
    stderrSpy.mockRestore();
  }
  return { exitCode: process.exitCode, stderr: stderrChunks.join('') };
}

const PARAGRAPH_TEXT = 'A paragraph dumped to a DocumentPackage and read back again';
const SHEET_CELL_TEXT = 'A cell dumped to a DocumentPackage and rebuilt as xlsx';

function docxWithParagraph(): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: PARAGRAPH_TEXT });
  return editor.toBytes();
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'document-cli-from-package-'));
  await writeFile(join(workspace, 'source.docx'), docxWithParagraph());
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  savedExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = savedExitCode;
});

describe('from-package', () => {
  it('reads a --dump-package JSON file back in and rebuilds a real docx from its ContentDocument', async () => {
    const packagePath = join(workspace, 'dumped.package.json');
    const rebuiltPath = join(workspace, 'rebuilt.docx');

    const dumpRun = await runCli(['docx-to-pdf', join(workspace, 'source.docx'), join(workspace, 'source.pdf'), '--dump-package', packagePath]);
    expect(dumpRun.exitCode).toBe(EXIT_SUCCESS);

    // The dumped file is tagged with a $schema documentFromJson can identify -- not merely well-formed JSON matching DocumentPackage's own shape.
    const dumpedText = await readFile(packagePath, 'utf-8');
    expect(dumpedText).toContain('"$schema"');
    expect(dumpedText).toContain('document-package.schema.json');
    // The dump carries the tree form -- container groups under children, content nodes with their own rendered frames, page sizes at the root -- and neither the retired formatVersion integer nor the old separate layout half.
    expect(dumpedText).toContain('"children"');
    expect(dumpedText).toContain('"pages"');
    expect(dumpedText).toContain('"frames"');
    expect(dumpedText).not.toContain('"formatVersion"');
    expect(dumpedText).not.toContain('"layout"');

    const fromPackageRun = await runCli(['from-package', packagePath, rebuiltPath]);
    expect(fromPackageRun.exitCode).toBe(EXIT_SUCCESS);

    const rebuilt = openDocx(new Uint8Array(await readFile(rebuiltPath)));
    const paragraphs = rebuilt.paragraphs();
    expect(paragraphs.some((paragraph) => paragraph.text === PARAGRAPH_TEXT)).toBe(true);
  });

  it("rebuilds a pdf from a dumped package's own frames and page sizes", async () => {
    const packagePath = join(workspace, 'dumped-for-pdf.package.json');
    const rebuiltPdfPath = join(workspace, 'rebuilt.pdf');

    // docx-to-pdf is the conversion whose dump carries a fully frame-stamped content tree, so its package is the honest input for the pdf target's rebuild-from-frames path (documents.js's layoutDocumentFromPackage -> writePdf, replacing the old stored-layout-half read).
    const dumpRun = await runCli(['docx-to-pdf', join(workspace, 'source.docx'), join(workspace, 'source-for-pdf.pdf'), '--dump-package', packagePath]);
    expect(dumpRun.exitCode).toBe(EXIT_SUCCESS);

    const fromPackageRun = await runCli(['from-package', packagePath, rebuiltPdfPath]);
    expect(fromPackageRun.exitCode).toBe(EXIT_SUCCESS);

    const rebuiltPdfBytes = new Uint8Array(await readFile(rebuiltPdfPath));
    expect(rebuiltPdfBytes.byteLength).toBeGreaterThan(0);
    // The minimal honest check on the rebuilt pdf itself: a real PDF file, not an empty or mislabelled write.
    expect(rebuiltPdfBytes[0]).toBe(0x25); // '%'
    expect(new TextDecoder().decode(rebuiltPdfBytes.subarray(0, 5))).toBe('%PDF-');
  });

  it('infers the target format from the output extension, matching --to explicitly given', async () => {
    const packagePath = join(workspace, 'dumped-for-markdown.package.json');
    await runCli(['docx-to-pdf', join(workspace, 'source.docx'), join(workspace, 'unused.pdf'), '--dump-package', packagePath]);

    const viaExtension = join(workspace, 'via-extension.md');
    const viaToOutput = join(workspace, 'via-to-output');

    expect((await runCli(['from-package', packagePath, viaExtension])).exitCode).toBe(EXIT_SUCCESS);
    expect((await runCli(['from-package', packagePath, viaToOutput, '--to', 'markdown'])).exitCode).toBe(EXIT_SUCCESS);

    const viaExtensionText = await readFile(viaExtension, 'utf-8');
    expect(viaExtensionText).toContain(PARAGRAPH_TEXT);
    const viaToText = await readFile(viaToOutput, 'utf-8');
    expect(viaToText).toBe(viaExtensionText);
  });

  it('fails with a usage error naming the incompatible target when a package built from wordprocessing content is asked for a spreadsheet format', async () => {
    const packagePath = join(workspace, 'dumped-for-ods.package.json');
    await runCli(['docx-to-pdf', join(workspace, 'source.docx'), join(workspace, 'unused2.pdf'), '--dump-package', packagePath]);

    const { exitCode, stderr } = await runCli(['from-package', packagePath, join(workspace, 'never-written.ods')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('requires a');
  });

  it('builds a real xlsx from a spreadsheet-kind DocumentPackage now that documents.js wires a real xlsx content codec', async () => {
    // xlsx used to be rejected outright here -- documents.js's own DOCUMENT_FORMAT_CODECS registry gained a real xlsx content codec (wrapping ooxml.js's readXlsxContent/buildXlsxPackage) this session, and buildDocumentBytes was simplified to dispatch through it like every other format instead of naming xlsx as a special exception.
    const sheetPath = join(workspace, 'source-for-xlsx.ods');
    const editor = createOds();
    // createOds() already starts with one default sheet -- reuse it rather than addSheet('Sheet1'), which would create a second, identically-named sheet and leave the first (empty) one at sheets[0].
    const sheet = editor.sheets()[0];
    if (sheet === undefined) {
      throw new Error('createOds() did not produce a default sheet');
    }
    sheet.cell(0, 0).value = { kind: 'string', value: SHEET_CELL_TEXT };
    // A cell()-materialized column/row otherwise reads back with no width/height style at all (widthPt/heightPt 0), which fails DocumentPackage's own schema validation once the dumped package round-trips through JSON below.
    sheet.setColumnWidth(0, 72);
    sheet.setRowHeight(0, 14);
    await writeFile(sheetPath, editor.toBytes());

    const packagePath = join(workspace, 'dumped-for-xlsx.package.json');
    await runCli(['ods-to-pdf', sheetPath, join(workspace, 'unused3.pdf'), '--dump-package', packagePath]);

    const xlsxPath = join(workspace, 'rebuilt.xlsx');
    const { exitCode } = await runCli(['from-package', packagePath, xlsxPath]);
    expect(exitCode).toBe(EXIT_SUCCESS);

    // Round-trips the rebuilt xlsx back through the real xlsx-to-ods bridge to prove the bytes are a genuine, readable xlsx workbook carrying the original cell, not just a file that happened to get written.
    const xlsxBytes = new Uint8Array(await readFile(xlsxPath));
    const odsBackBytes = xlsxToOds(xlsxBytes);
    const content = readOdsContent(decodeDocumentPackage('ods', odsBackBytes));
    if (content.kind !== 'spreadsheet') {
      throw new Error(`expected a spreadsheet ContentDocument, got ${content.kind}`);
    }
    expect(content.sheets[0]?.cells[0]?.value).toEqual({ kind: 'string', value: SHEET_CELL_TEXT });
  });

  it('rejects a plain JSON file with no recognised $schema', async () => {
    const plainPath = join(workspace, 'plain.json');
    await writeFile(plainPath, JSON.stringify({ hello: 'world' }));

    const { exitCode, stderr } = await runCli(['from-package', plainPath, join(workspace, 'never-written2.docx')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('no recognised $schema');
  });

  it("rejects 'pdf' as the target when the dumped package came from a bridge conversion with no page sizes at all", async () => {
    const packagePath = join(workspace, 'dumped-from-bridge.package.json');
    // A bridge conversion (odt-to-docx) runs no layout engine at all -- its own dumped package always carries a real ContentDocument but pages left undefined (see documents.js's own DocumentBridgeOptions.onDocument comment), unlike every docx-to-pdf/pdf-to-docx dump the other tests in this file use.
    await runCli(['docx-to-odt', join(workspace, 'source.docx'), join(workspace, 'source.odt')]);
    const bridgeRun = await runCli(['odt-to-docx', join(workspace, 'source.odt'), join(workspace, 'unused-bridge.docx'), '--dump-package', packagePath]);
    expect(bridgeRun.exitCode).toBe(EXIT_SUCCESS);

    const { exitCode, stderr } = await runCli(['from-package', packagePath, join(workspace, 'never-written4.pdf')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('this DocumentPackage has no pages');
  });

  it('rejects a pre-4.0.0 flat-shape dump (a documents.js 2.x --dump-package file) with an error naming the tree change and the remedy', async () => {
    const oldDumpPath = join(workspace, 'old-flat.package.json');
    // A user-provided old dump: the exact shape documents.js 2.x wrote via --dump-package -- $schema-tagged by a document-schema.js 3.x release, the flat { formatVersion, content, pages } envelope. Hand-built here rather than generated, since nothing in this tree can still produce that shape; documentFromJson's version gate refuses it on the URI's major alone (a dump only parses under the major that wrote it), so the body's own fields never even reach schema validation.
    const oldDump = {
      $schema: 'https://cdn.jsdelivr.net/npm/document-schema.js@3.9.9/schemas/document-package.schema.json',
      formatVersion: 2,
      content: {
        kind: 'wordprocessing',
        formatVersion: 2,
        metadata: {},
        sections: [{ blocks: [{ kind: 'paragraph', styleId: 'Heading1', runs: [{ text: PARAGRAPH_TEXT }] }] }],
      },
      pages: [{ widthPt: 595, heightPt: 842 }],
    };
    await writeFile(oldDumpPath, JSON.stringify(oldDump, undefined, 2));

    const { exitCode, stderr } = await runCli(['from-package', oldDumpPath, join(workspace, 'never-written5.docx')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    // The readable surfacing of SchemaVersionMismatchError: the pinned release, the installed major, the flat-to-tree change, and the CLI's own remedy.
    expect(stderr).toContain('document-schema.js@3.9.9');
    expect(stderr).toContain('tree-form DocumentPackage');
    expect(stderr).toContain('--dump-package');
  });

  it('rejects a formatVersion 1 dump (a documents.js 1.x --dump-package file) through the same version gate, naming the pinned release', async () => {
    const v1DumpPath = join(workspace, 'old-v1.package.json');
    // The one wrong-version case a real user hits after upgrading, kept as its own test because its dump is the oldest shape out there: formatVersion 1, content plus a separate layout half, tagged by a document-schema.js 1.x release. The same version gate refuses it -- the CLI-level intercept this command used to carry existed only because the old dispatch had no gate at all.
    const v1Dump = {
      $schema: 'https://cdn.jsdelivr.net/npm/document-schema.js@1.9.9/schemas/document-package.schema.json',
      formatVersion: 1,
      content: { kind: 'wordprocessing', formatVersion: 2, metadata: {}, sections: [{ blocks: [{ kind: 'paragraph', runs: [{ text: PARAGRAPH_TEXT }] }] }] },
      layout: { formatVersion: 1, metadata: {}, images: {}, pages: [{ widthPt: 595, heightPt: 842, items: [] }] },
    };
    await writeFile(v1DumpPath, JSON.stringify(v1Dump, undefined, 2));

    const { exitCode, stderr } = await runCli(['from-package', v1DumpPath, join(workspace, 'never-written6.docx')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('document-schema.js@1.9.9');
    expect(stderr).toContain('--dump-package');
  });

  it('rejects a layout-document dump (an old pdf-inspect --full output) with the demotion pointer', async () => {
    const layoutDumpPath = join(workspace, 'old-layout.dump.json');
    // A document-schema.js 3.x layoutDocumentWithSchema artefact: documentFromJson answers its URI with the LayoutSchemaDemotedError tombstone (the kind moved to pdf-codec), which this command surfaces as its own readable line rather than an unrecognised-schema wall.
    const layoutDump = {
      $schema: 'https://cdn.jsdelivr.net/npm/document-schema.js@3.9.9/schemas/layout-document.schema.json',
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [],
    };
    await writeFile(layoutDumpPath, JSON.stringify(layoutDump, undefined, 2));

    const { exitCode, stderr } = await runCli(['from-package', layoutDumpPath, join(workspace, 'never-written7.docx')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('LayoutDocument dump');
    expect(stderr).toContain('pdf-codec');
  });
});
