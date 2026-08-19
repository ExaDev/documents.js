import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocx, createOdg, createOds, docxToPdf } from 'documents.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../program';
import { EXIT_SUCCESS, EXIT_USAGE_ERROR } from '../runtime/exit-codes';

// Drives the real assembled commander program against real source files, one per interesting outline shape: a markdown source for heading and list nesting (the wordprocessing projection), an ods source for per-sheet groups (the spreadsheet projection), a pdf source for the reconstruction path (the one source that cannot be bridged), and a --json run pinning the machine-readable tree to document-outline.js's own shape rather than a CLI-private one.

let workspace: string;

// Commander's action sets `process.exitCode` on the real process; a command that failed would otherwise leave a non-zero code behind and fail the whole vitest run for reasons unrelated to any assertion here.
let savedExitCode: typeof process.exitCode;

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

// Narrows a JSON.parse result into a property bag without a type assertion: the values below come off the wire as `unknown`, and the lint bans `as` casts, so each access site guards with this instead.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The array counterpart of isRecord, needed for the same reason and one step less obvious: TypeScript's own Array.isArray narrows an `unknown` to `any[]`, not `unknown[]`, so indexing straight off a bare Array.isArray check hands back `any` and trips no-unsafe-assignment at the very access sites isRecord then guards. Restating the identical runtime check behind a `readonly unknown[]` predicate keeps every element `unknown` all the way to its own guard.
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'document-cli-outline-'));
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

describe('outline', () => {
  it('renders a markdown document as indented text: headings nested by level, list items nested under their heading, plain paragraphs as leaf lines', async () => {
    const sourcePath = join(workspace, 'notes.md');
    await writeFile(sourcePath, '# Introduction\n\nIntro paragraph.\n\n## Details\n\n- First item\n- Second item\n');

    const { exitCode, stdout, stderr } = await runCli(['outline', sourcePath]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    // 'Details' is indented once because buildOutline's stack semantics nest an H2 under the open H1; the list items are groups (not leaves) under it; the plain paragraph is a leaf line inside the Introduction group.
    expect(stdout).toBe('Introduction\n  Intro paragraph.\n  Details\n    First item\n    Second item\n');
  });

  it('renders a spreadsheet as one group per sheet, labelled with the sheet names in order', async () => {
    const sheetPath = join(workspace, 'budget.ods');
    const editor = createOds();
    const first = editor.sheets()[0];
    if (first === undefined) {
      throw new Error('createOds() did not produce a default sheet');
    }
    first.name = 'Q1';
    editor.addSheet('Q2');
    await writeFile(sheetPath, editor.toBytes());

    const { exitCode, stdout } = await runCli(['outline', sheetPath]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    // Cells are addressable data, not outline content -- a sheet's group carries its images and embedded objects, so a cell-only sheet renders as a bare label with nothing under it.
    expect(stdout).toBe('Q1\nQ2\n');
  });

  // Regression coverage for OUTLINE_CONVERSION_TARGET.odg: it used to bridge to 'svg', and buildSvgText refuses to write a multi-page document at all (SvgMultiPageNotSpecifiedError) since this command has no --page flag to answer it with -- every multi-page .odg failed outright with an error naming a target format ('svg') the caller never asked for. The bridge target is 'odp' now (a registered odg conversion pair with no per-document page-selection constraint), so this exercises the one source format the original entry made impossible to outline past a single page.
  it('outlines a multi-page odg as one group per page, with no --page selection needed', async () => {
    const drawingPath = join(workspace, 'slides.odg');
    const editor = createOdg();
    editor.addPage().addTextBox({ frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 20 }, text: 'First page text' });
    editor.addPage().addTextBox({ frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 20 }, text: 'Second page text' });
    editor.addPage().addTextBox({ frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 20 }, text: 'Third page text' });
    await writeFile(drawingPath, editor.toBytes());

    const { exitCode, stdout, stderr } = await runCli(['outline', drawingPath]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    // odp is a presentation-variant bridge, so each drawing page becomes a slide group -- "Slide N", document-outline.js's own presentation convention, rather than the "Page N" a same-variant drawing bridge would use.
    expect(stdout).toBe('Slide 1\n  First page text\nSlide 2\n  Second page text\nSlide 3\n  Third page text\n');
  });

  it('outlines a pdf source through its reconstruction, printing recovered paragraph text as flat leaf lines', async () => {
    const paragraphText = 'A paragraph whose outline survives the reconstruction.';
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: paragraphText });
    const pdfPath = join(workspace, 'source.pdf');
    await writeFile(pdfPath, docxToPdf(editor.toBytes()));

    const { exitCode, stdout } = await runCli(['outline', pdfPath]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    // A PDF carries no heading signal, so the reconstruction yields plain paragraph leaves at the root rather than any grouping -- the honest outline of a format with no structure of its own.
    expect(stdout).toBe(`${paragraphText}\n`);
  });

  it('emits document-outline.js own tree shape under --json, not a CLI-private projection', async () => {
    const sourcePath = join(workspace, 'json.md');
    await writeFile(sourcePath, '# Title\n\nBody text.\n');

    const { exitCode, stdout } = await runCli(['outline', sourcePath, '--json']);

    expect(exitCode).toBe(EXIT_SUCCESS);

    const outline: unknown = JSON.parse(stdout);
    if (!isUnknownArray(outline) || outline.length !== 1) {
      throw new Error(`expected a one-element root array, got ${JSON.stringify(outline)}`);
    }
    // The group arm: { text, level, children } with the heading's own text and headingLevel as the level signal.
    const group = outline[0];
    if (!isRecord(group)) {
      throw new Error(`expected a group object at the root, got ${JSON.stringify(group)}`);
    }
    expect(group.text).toBe('Title');
    expect(group.level).toBe(1);
    // The leaf arm: the package leaf itself (kind 'paragraph', its runs), not a summarised copy.
    const children = group.children;
    if (!isUnknownArray(children) || children.length !== 1) {
      throw new Error(`expected one child under the heading, got ${JSON.stringify(children)}`);
    }
    const leaf = children[0];
    if (!isRecord(leaf)) {
      throw new Error(`expected a leaf object under the heading, got ${JSON.stringify(leaf)}`);
    }
    expect(leaf.kind).toBe('paragraph');
  });

  it('fails with a usage error naming the recognised extensions when the input has none', async () => {
    const barePath = join(workspace, 'notes.txt');
    await writeFile(barePath, 'no outline signal here\n');

    const { exitCode, stderr } = await runCli(['outline', barePath]);

    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain('cannot infer a source format');
  });

  it('prints nothing at all for a document with no outline content, rather than one stray blank line', async () => {
    const emptyPath = join(workspace, 'empty.md');
    await writeFile(emptyPath, '');

    const { exitCode, stdout, stderr } = await runCli(['outline', emptyPath]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    // Not '\n' -- joining zero lines and then appending a trailing newline unconditionally would still write one blank line for a document with nothing to outline at all.
    expect(stdout).toBe('');
  });

  it('--json still emits an empty array for the same empty document', async () => {
    const emptyPath = join(workspace, 'empty-json.md');
    await writeFile(emptyPath, '');

    const { exitCode, stdout } = await runCli(['outline', emptyPath, '--json']);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toBe('[]\n');
  });
});
