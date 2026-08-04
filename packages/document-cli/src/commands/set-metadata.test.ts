import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOds, decodeDocumentPackage, decodePackage, odsToXlsx, readDocxContent, readDocxExtras, readOdsContent, readPdf, xlsxToOds } from 'documents.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../program';
import { EXIT_SUCCESS } from '../runtime/exit-codes';
import { buildDocxWithExtras } from '../test-support/docx-extras-fixture';
import { BODY_TEXT, buildDocxWithMetadata, buildPdfWithMetadata, METADATA_FIXTURE } from '../test-support/metadata-fixture';

// Drives the real assembled commander program end to end against real fixtures, proving both write paths set-metadata.ts implements: the ContentDocument full rebuild (docx here, standing in for pptx/odt/odp/ods/odg/markdown, which all go through the identical readXContent -> buildXPackage shape) -- including the documented lossy-for-docx-extras caveat -- and the direct pdf metadata patch, which runs no layout engine at all and must leave every other page item untouched.

let savedExitCode: typeof process.exitCode;
let workspace: string;

interface CapturedRun {
  readonly exitCode: typeof process.exitCode;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCli(args: readonly string[]): Promise<CapturedRun> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
  try {
    await createProgram().parseAsync(['node', 'document-cli', ...args]);
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  return { exitCode: process.exitCode, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

const SHEET_CELL_TEXT = 'A cell surviving an xlsx metadata patch';

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'document-cli-set-metadata-'));
  await writeFile(join(workspace, 'source.docx'), buildDocxWithMetadata());
  await writeFile(join(workspace, 'extras.docx'), buildDocxWithExtras());
  await writeFile(join(workspace, 'source.pdf'), buildPdfWithMetadata());
  // setDocumentMetadata (documents.js) validates its own source/target format pair internally rather than the CLI pre-checking it, so the input file is now genuinely read before that rejection fires -- unlike a placeholder path, this needs to exist. Its content is never parsed: the rejection below fires purely on the '.odf' extension, before any real ODF decoding is attempted.
  await writeFile(join(workspace, 'formula.odf'), new Uint8Array([0]));

  const odsEditor = createOds();
  const sheet = odsEditor.sheets()[0];
  if (sheet === undefined) {
    throw new Error('createOds() did not produce a default sheet');
  }
  sheet.cell(0, 0).value = { kind: 'string', value: SHEET_CELL_TEXT };
  // See from-package.test.ts's own identical note: a cell()-materialized column/row otherwise reads back with no width/height style at all, which is irrelevant here but kept for consistency with the other xlsx fixture.
  sheet.setColumnWidth(0, 72);
  sheet.setRowHeight(0, 14);
  await writeFile(join(workspace, 'source.xlsx'), odsToXlsx(odsEditor.toBytes()));
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

describe('set-metadata', () => {
  it('rebuilds a docx with only the given fields overridden, leaving everything else untouched', async () => {
    const outputPath = join(workspace, 'rebuilt.docx');
    const { exitCode, stderr } = await runCli(['set-metadata', join(workspace, 'source.docx'), outputPath, '--set-title', 'New Title', '--set-keywords', ' gamma, delta ,, ', '--quiet']);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);

    const rebuilt = readDocxContent(decodePackage(new Uint8Array(await readFile(outputPath))));
    expect(rebuilt.metadata.title).toBe('New Title');
    // Author/subject were never overridden, so they survive the merge from the source's own metadata.
    expect(rebuilt.metadata.author).toBe(METADATA_FIXTURE.author);
    expect(rebuilt.metadata.subject).toBe(METADATA_FIXTURE.subject);
    // --set-keywords splits on comma, trims, and drops empty entries.
    expect(rebuilt.metadata.keywords).toStrictEqual(['gamma', 'delta']);
    // The paragraph itself survives the rebuild -- only metadata changed.
    expect(rebuilt.kind).toBe('wordprocessing');
    const survived = rebuilt.kind === 'wordprocessing' && rebuilt.sections[0]?.blocks.some((block) => block.kind === 'paragraph' && block.runs.some((run) => run.text === BODY_TEXT));
    expect(survived).toBe(true);
  });

  it('genuinely drops docx-extras data (a comment) when rebuilding, matching the documented lossy caveat', async () => {
    const before = readDocxExtras(decodePackage(new Uint8Array(await readFile(join(workspace, 'extras.docx')))));
    expect(before.comments.length).toBeGreaterThan(0);

    const outputPath = join(workspace, 'extras-rebuilt.docx');
    const { exitCode } = await runCli(['set-metadata', join(workspace, 'extras.docx'), outputPath, '--set-author', 'New Author']);
    expect(exitCode).toBe(EXIT_SUCCESS);

    const after = readDocxExtras(decodePackage(new Uint8Array(await readFile(outputPath))));
    expect(after.comments).toStrictEqual([]);

    // The metadata edit itself still landed.
    const rebuiltContent = readDocxContent(decodePackage(new Uint8Array(await readFile(outputPath))));
    expect(rebuiltContent.metadata.author).toBe('New Author');
  });

  it('patches a pdf directly, leaving every other page item byte-for-byte untouched', async () => {
    const sourceBytes = new Uint8Array(await readFile(join(workspace, 'source.pdf')));
    const sourceLayout = readPdf(sourceBytes);

    const outputPath = join(workspace, 'patched.pdf');
    const { exitCode, stderr } = await runCli(['set-metadata', join(workspace, 'source.pdf'), outputPath, '--set-subject', 'A new subject', '--quiet']);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);

    const patchedLayout = readPdf(new Uint8Array(await readFile(outputPath)));
    expect(patchedLayout.metadata.subject).toBe('A new subject');
    expect(patchedLayout.metadata.title).toBe(METADATA_FIXTURE.title);
    // No layout engine runs for the pdf path -- the page geometry and every item on it survive unchanged.
    expect(patchedLayout.pages).toStrictEqual(sourceLayout.pages);
  });

  it('patches an xlsx file in place now that documents.js wires a real xlsx content codec, leaving its cells untouched', async () => {
    // xlsx used to be rejected outright here -- documents.js's own DOCUMENT_FORMAT_CODECS registry gained a real xlsx content codec this session, and setDocumentMetadata now rebuilds xlsx through the identical readXContent -> buildXPackage shape every other REBUILD_FORMATS member already used.
    const outputPath = join(workspace, 'rebuilt.xlsx');
    const { exitCode, stderr } = await runCli(['set-metadata', join(workspace, 'source.xlsx'), outputPath, '--set-title', 'New xlsx title', '--quiet']);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);

    // Round-trips the patched xlsx back through the real xlsx-to-ods bridge to prove the bytes are a genuine, readable xlsx workbook carrying both the new title and the original cell.
    const odsBackBytes = xlsxToOds(new Uint8Array(await readFile(outputPath)));
    const content = readOdsContent(decodeDocumentPackage('ods', odsBackBytes));
    if (content.kind !== 'spreadsheet') {
      throw new Error(`expected a spreadsheet ContentDocument, got ${content.kind}`);
    }
    expect(content.metadata.title).toBe('New xlsx title');
    expect(content.sheets[0]?.cells[0]?.value).toEqual({ kind: 'string', value: SHEET_CELL_TEXT });
  });

  it('still rejects a cross-format request into xlsx -- set-metadata patches metadata in place, it does not convert format', async () => {
    const { exitCode, stderr } = await runCli(['set-metadata', join(workspace, 'source.docx'), join(workspace, 'never.xlsx'), '--set-title', 'x']);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('does not convert format');
  });

  it('rejects a standalone odf formula document as a source, naming the missing write path', async () => {
    const { exitCode, stderr } = await runCli(['set-metadata', join(workspace, 'formula.odf'), join(workspace, 'never.odf'), '--set-title', 'x']);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("'odf' (a standalone formula document) is not a supported setDocumentMetadata source or target");
  });

  it('rejects a cross-format request -- set-metadata patches metadata in place, it does not convert format', async () => {
    const { exitCode, stderr } = await runCli(['set-metadata', join(workspace, 'source.docx'), join(workspace, 'never.odt'), '--set-title', 'x']);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('does not convert format');
  });

  it('leaves metadata entirely unchanged when no --set-* flag is given at all', async () => {
    const outputPath = join(workspace, 'untouched.docx');
    const { exitCode } = await runCli(['set-metadata', join(workspace, 'source.docx'), outputPath]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const rebuilt = readDocxContent(decodePackage(new Uint8Array(await readFile(outputPath))));
    expect(rebuilt.metadata.title).toBe(METADATA_FIXTURE.title);
    expect(rebuilt.metadata.author).toBe(METADATA_FIXTURE.author);
    expect(rebuilt.metadata.subject).toBe(METADATA_FIXTURE.subject);
    expect(rebuilt.metadata.keywords).toStrictEqual(METADATA_FIXTURE.keywords);
  });
});
