import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocx, createOdt } from 'documents.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../program';
import { EXIT_SUCCESS } from '../runtime/exit-codes';
import { FIXTURE_FONT_FAMILY, FIXTURE_FONT_POSTSCRIPT_NAME, fixtureCalibriFontBytes } from '../test-support/font-fixture';

// Drives the real assembled commander program end to end -- a real docx/odt asking for Calibri in, a real PDF out, read back and inspected for which typeface actually got embedded. Without --font-file, documents.js's own default behaviour must be untouched by any of this: a Calibri run still resolves through its vendored-substitute table to Carlito, and this CLI adds nothing that could change that. With --font-file, the supplied face wins and is embedded under its own PostScript name -- which also proves the family was derived from the font file's own 'name' table, since nothing on the command line ever said the word "Calibri" about that file. The assertion target is the PDF's own /BaseFont entry (ISO 32000-1 9.6.2.1, "<six-letter subset tag>+<PostScript name>"), read as literal bytes: writePdf leaves font dictionaries uncompressed, so a substring check here is checking the real, shipped font resource rather than a proxy for it.

const VENDORED_SUBSTITUTE_POSTSCRIPT_NAME = 'Carlito';

// A six-letter subset tag, a '+', then the PostScript name of whichever face was embedded.
const BASE_FONT_PATTERN = /\/BaseFont\s*\/[A-Z]{6}\+([^\s/>\]]+)/g;

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

async function embeddedFontNames(pdfPath: string): Promise<string[]> {
  const pdf = new TextDecoder('latin1').decode(await readFile(pdfPath));
  return [...pdf.matchAll(BASE_FONT_PATTERN)].map((match) => match[1] ?? '');
}

function docxAskingForCalibri(): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: 'A paragraph set in Calibri', fontFamily: FIXTURE_FONT_FAMILY });
  return editor.toBytes();
}

function odtAskingForCalibri(): Uint8Array<ArrayBuffer> {
  const editor = createOdt();
  editor.body.appendParagraph().appendRun({ text: 'A paragraph set in Calibri', fontFamily: FIXTURE_FONT_FAMILY });
  return editor.toBytes();
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'document-cli-fonts-'));
  await writeFile(join(workspace, 'calibri.docx'), docxAskingForCalibri());
  await writeFile(join(workspace, 'calibri.odt'), odtAskingForCalibri());
  await writeFile(join(workspace, 'fixture-face.ttf'), fixtureCalibriFontBytes());
  await writeFile(join(workspace, 'not-a-font.txt'), 'plain text, definitely not a font\n');
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

describe('docx-to-pdf with no --font-file', () => {
  it("embeds documents.js's own vendored Carlito substitute for a Calibri run", async () => {
    const output = join(workspace, 'default.pdf');
    const { exitCode } = await runCli(['docx-to-pdf', join(workspace, 'calibri.docx'), output]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const names = await embeddedFontNames(output);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toContain(VENDORED_SUBSTITUTE_POSTSCRIPT_NAME);
    }
  });

  it('reports the fallback as a diagnostic even with no font flags at all', async () => {
    const { stderr } = await runCli(['docx-to-pdf', join(workspace, 'calibri.docx'), join(workspace, 'default-diagnostics.pdf')]);

    expect(stderr).toContain('font/substituted');
    expect(stderr).toContain('"Calibri" is not available');
  });
});

describe('docx-to-pdf --font-file', () => {
  it('embeds the supplied face instead of the vendored substitute, matching it by the family the font file itself declares', async () => {
    const output = join(workspace, 'supplied.pdf');
    const { exitCode } = await runCli(['docx-to-pdf', join(workspace, 'calibri.docx'), output, '--font-file', join(workspace, 'fixture-face.ttf')]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const names = await embeddedFontNames(output);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toBe(FIXTURE_FONT_POSTSCRIPT_NAME);
    }
    // Not merely "the supplied face is present too": the vendored substitute is gone entirely, which is the difference between the supplied font being used and it being embedded alongside a substitute that is still doing the drawing.
    const pdf = new TextDecoder('latin1').decode(await readFile(output));
    expect(pdf).not.toContain(VENDORED_SUBSTITUTE_POSTSCRIPT_NAME);
  });

  it('reports no substitution at all once the requested family is genuinely available', async () => {
    const { stderr } = await runCli(['docx-to-pdf', join(workspace, 'calibri.docx'), join(workspace, 'supplied-quiet.pdf'), '--font-file', join(workspace, 'fixture-face.ttf')]);

    expect(stderr).not.toContain('font/substituted');
  });

  it('fails, naming the file, when a --font-file path is not a font', async () => {
    const { exitCode, stderr } = await runCli(['docx-to-pdf', join(workspace, 'calibri.docx'), join(workspace, 'never-written.pdf'), '--font-file', join(workspace, 'not-a-font.txt')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('not-a-font.txt is not a TrueType/OpenType font file');
  });
});

describe('odt-to-pdf --font-file', () => {
  // The same two halves against the ODF side of the identical wordprocessing pivot -- odtToPdf reaches the same layout engine and the same FontRegistry, so a flag registered per command rather than per format would show up here as a missing option rather than as a wrong font.
  it('substitutes Carlito by default and the supplied face when one is given', async () => {
    const defaultOutput = join(workspace, 'odt-default.pdf');
    const suppliedOutput = join(workspace, 'odt-supplied.pdf');

    expect((await runCli(['odt-to-pdf', join(workspace, 'calibri.odt'), defaultOutput])).exitCode).toBe(EXIT_SUCCESS);
    expect((await runCli(['odt-to-pdf', join(workspace, 'calibri.odt'), suppliedOutput, '--font-file', join(workspace, 'fixture-face.ttf')])).exitCode).toBe(EXIT_SUCCESS);

    for (const name of await embeddedFontNames(defaultOutput)) {
      expect(name).toContain(VENDORED_SUBSTITUTE_POSTSCRIPT_NAME);
    }
    for (const name of await embeddedFontNames(suppliedOutput)) {
      expect(name).toBe(FIXTURE_FONT_POSTSCRIPT_NAME);
    }
  });
});

describe('--report-font-substitutions', () => {
  it('prints the structured substitution event as it happens', async () => {
    const { exitCode, stderr } = await runCli(['docx-to-pdf', join(workspace, 'calibri.docx'), join(workspace, 'reported.pdf'), '--report-font-substitutions']);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toContain('[docx-to-pdf] font substitution: "Calibri" -> "carlito" (vendored-substitute)');
  });

  it('emits the substitution as its own NDJSON record under --json, with every structured field intact', async () => {
    const { stderr } = await runCli(['docx-to-pdf', join(workspace, 'calibri.docx'), join(workspace, 'reported.json.pdf'), '--report-font-substitutions', '--json']);

    const lines = stderr.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => {
        // A statement rather than an expression body: JSON.parse returns `any`, and returning it from the arrow would be the one unsafe value in this file. Whether it throws is the whole assertion; the parsed value itself is checked as text below.
        JSON.parse(line);
      }).not.toThrow();
    }
    // Asserted against the serialised text rather than by narrowing each parsed value field by field: JSON.parse succeeding above already proves every line is well-formed JSON, matching how src/commands/odb.test.ts checks its own --json output.
    expect(stderr).toContain('"type":"font-substitution"');
    expect(stderr).toContain('"requestedFamily":"Calibri"');
    expect(stderr).toContain('"requestedBold":false');
    expect(stderr).toContain('"reason":"vendored-substitute"');
    expect(stderr).toContain('"resolvedFamily":"carlito"');
  });

  it('stays silent when the requested family resolved exactly', async () => {
    const { stderr } = await runCli([
      'docx-to-pdf',
      join(workspace, 'calibri.docx'),
      join(workspace, 'reported-exact.pdf'),
      '--font-file',
      join(workspace, 'fixture-face.ttf'),
      '--report-font-substitutions',
    ]);

    expect(stderr).not.toContain('font substitution');
  });
});

describe('font flag registration', () => {
  it('offers the font flags on every conversion that lays text out, and on none that does not', () => {
    const helpFor = (name: string): string => {
      const command = createProgram().commands.find((candidate) => candidate.name() === name);
      if (command === undefined) {
        throw new Error(`the program registers no '${name}' command`);
      }
      return command.helpInformation();
    };

    for (const name of ['docx-to-pdf', 'pptx-to-pdf', 'odt-to-pdf', 'odp-to-pdf', 'ods-to-pdf', 'odg-to-pdf', 'odf-to-pdf', 'xlsx-to-pdf', 'markdown-to-pdf', 'convert', 'odm-to-pdf']) {
      expect(helpFor(name)).toContain('--font-file');
      expect(helpFor(name)).toContain('--report-font-substitutions');
    }
    // A reconstruction reads a PDF's own already-positioned glyphs and a bridge runs no layout engine, so neither has any face to resolve -- advertising the flags there would offer an option that could not do anything.
    for (const name of ['pdf-to-docx', 'pdf-to-odt', 'odt-to-docx', 'ods-to-xlsx']) {
      expect(helpFor(name)).not.toContain('--font-file');
    }
  });
});
