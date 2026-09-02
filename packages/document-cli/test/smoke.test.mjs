// Smoke test: the real built dist/cli.js runs correctly as a genuine subprocess -- argv parsing, exit codes, and stdout/stderr separation, not just the in-process command tree. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to the "smoke" project), never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. Every test here spawns dist/cli.js with node:child_process rather than importing it (it is a bin script, not designed to be imported) or calling src/program.ts's createProgram() directly (that would exercise the in-process command tree, not the actual shipped CLI's argv/exit-code/stdio behaviour this file exists to prove).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDocx, createFontRegistry, createOdg, createOds } from 'documents.js';
// dist/index.js is this package's own deliberately-importable barrel (see its own top-of-file comment: "so an external consumer -- or a test -- can call this CLI's conversion logic directly"), unlike dist/cli.js -- pulling the exit-code constants from the built artifact avoids hardcoding magic exit-code numbers in this file while still proving the barrel build itself is sound.
import { EXIT_INPUT_ERROR, EXIT_NEEDS_INFO, EXIT_SUCCESS, EXIT_USAGE_ERROR } from '../dist/index.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

// Every invocation in this file goes through this one helper: spawns `node dist/cli.js <args>` as a real child process (via process.execPath rather than relying on the shebang/chmod bit, so this doesn't depend on the host OS honouring executable permissions), collects stdout/stderr as raw Buffers (never decoded as text up front -- the PDF-piping test below needs the exact bytes), and resolves once the process exits.
function spawnCli(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code, stdout: Buffer.concat(stdoutChunks), stderr: Buffer.concat(stderrChunks) });
    });
    child.stdin.end(input);
  });
}

function isPdfBytes(bytes) {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 5)) === '%PDF-';
}

// A tiny, real docx fixture built through documents.js's own live-view editor (already a dependency of this package) -- exercised as genuine input bytes, not a hand-crafted stub, for both the file-based round trip and the stdin-piping test below.
function buildFixtureDocxBytes() {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: 'Hello from the document-cli smoke test' });
  return editor.toBytes();
}

describe('dist/cli.js --help', () => {
  it('exits 0 and lists the real subcommands', async () => {
    const { code, stdout } = await spawnCli(['--help']);
    expect(code).toBe(EXIT_SUCCESS);
    const text = stdout.toString('utf8');
    // markdown-to-pdf is not registered by any code in this package -- it exists only because documents.js's own createLocalDocumentConverter().conversions now includes a markdown edge, and registerConversionCommands (src/commands/convert.ts) loops over that array unmodified. Its presence here is the end-to-end proof that registering a new format entirely inside documents.js is enough.
    for (const name of ['docx-to-pdf', 'markdown-to-pdf', 'convert', 'formats', 'odm-to-pdf', 'odb-tables', 'odb-forms', 'odb-reports', 'pdf-inspect', 'outline', 'tui']) {
      expect(text).toContain(name);
    }
  });
});

describe('dist/cli.js --version', () => {
  it('exits 0 and prints a real version string', async () => {
    const { code, stdout } = await spawnCli(['--version']);
    expect(code).toBe(EXIT_SUCCESS);
    // Not a fixed literal -- semantic-release rewrites package.json's version at release time, so only the shape is checked, not a specific value.
    expect(stdout.toString('utf8').trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('dist/cli.js formats --json', () => {
  it('exits 0 and prints a valid JSON array of source/target conversion pairs', async () => {
    const { code, stdout } = await spawnCli(['formats', '--json']);
    expect(code).toBe(EXIT_SUCCESS);
    const parsed = JSON.parse(stdout.toString('utf8'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    for (const entry of parsed) {
      expect(typeof entry.source).toBe('string');
      expect(typeof entry.target).toBe('string');
    }
  });
});

describe('dist/cli.js docx-to-pdf: real file round trip', () => {
  it('converts a genuine docx fixture on disk to a real PDF', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const inputPath = join(tmpDir, 'fixture.docx');
      const outputPath = join(tmpDir, 'fixture.pdf');
      await writeFile(inputPath, buildFixtureDocxBytes());

      const { code } = await spawnCli(['docx-to-pdf', inputPath, outputPath]);
      expect(code).toBe(EXIT_SUCCESS);

      const outputBytes = await readFile(outputPath);
      expect(outputBytes.length).toBeGreaterThan(0);
      expect(isPdfBytes(outputBytes)).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('dist/cli.js docx-to-pdf -: stdin/stdout piping', () => {
  it('writes only PDF bytes to stdout, with the diagnostic summary going to stderr instead', async () => {
    const { code, stdout, stderr } = await spawnCli(['docx-to-pdf', '-', '-'], { input: buildFixtureDocxBytes() });
    expect(code).toBe(EXIT_SUCCESS);

    expect(isPdfBytes(stdout)).toBe(true);
    expect(stderr.length).toBeGreaterThan(0);

    // The single most important guarantee this CLI's stdout/stderr separation depends on: stdout is the PDF bytes and nothing else. Cross-checked against the byte count the summary line itself reports on stderr, rather than merely trusting the %PDF- prefix above -- if any diagnostic text had leaked into stdout, this count would no longer match stdout's own actual length.
    const stderrText = stderr.toString('utf8');
    const summaryMatch = /wrote (\d+) bytes to -/.exec(stderrText);
    expect(summaryMatch).not.toBeNull();
    expect(stdout.length).toBe(Number(summaryMatch[1]));
  });
});

// The one real binary fixture in the repo, checked in under src/ so both the unit suite and this smoke test read the identical file (see src/test-support/odb-fixture.ts for its provenance). Referenced by path rather than through the built bundle because these two commands take a file path as their input argument, which is exactly what is being exercised.
const FORM_AND_REPORT_ODB_PATH = fileURLToPath(new URL('../src/test-support/fixtures/form-and-report.odb', import.meta.url));

describe('dist/cli.js odb-forms and odb-reports: real .odb structure extraction', () => {
  it("prints the fixture's own form, its table command, and its sub-form's separate query command", async () => {
    const { code, stdout } = await spawnCli(['odb-forms', FORM_AND_REPORT_ODB_PATH]);
    expect(code).toBe(EXIT_SUCCESS);
    const text = stdout.toString('utf8');
    expect(text).toContain('form SalesForm on table "SALES"');
    expect(text).toContain('form:text txtCustomer -> CUSTOMER');
    expect(text).toContain('subform HighValueSubForm on query "HighValueSales"');
  });

  it("prints the fixture's own report bands, group expressions, and rpt: formulas", async () => {
    const { code, stdout } = await spawnCli(['odb-reports', FORM_AND_REPORT_ODB_PATH]);
    expect(code).toBe(EXIT_SUCCESS);
    const text = stdout.toString('utf8');
    expect(text).toContain('data source: query "HighValueSales"');
    expect(text).toContain('group rpt:HASCHANGED("REGION")');
    expect(text).toContain('rpt:SUM([AMOUNT])');
    expect(text).toContain('LEFT_QUARTER = rpt:LEFT([QUARTER];2)');
  });

  it('emits parseable JSON under --json, from the built bundle', async () => {
    const { code, stdout } = await spawnCli(['odb-reports', FORM_AND_REPORT_ODB_PATH, '--json']);
    expect(code).toBe(EXIT_SUCCESS);
    const parsed = JSON.parse(stdout.toString('utf8'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('SalesByRegion');
  });
});

const MARKDOWN_FIXTURE = '# Hello\n\nThis is **markdown** from the document-cli smoke test.\n';

describe('dist/cli.js markdown-to-pdf: real file round trip', () => {
  it('converts a genuine markdown fixture on disk to a real PDF', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const inputPath = join(tmpDir, 'fixture.md');
      const outputPath = join(tmpDir, 'fixture.pdf');
      await writeFile(inputPath, MARKDOWN_FIXTURE, 'utf8');

      const { code } = await spawnCli(['markdown-to-pdf', inputPath, outputPath]);
      expect(code).toBe(EXIT_SUCCESS);

      const outputBytes = await readFile(outputPath);
      expect(outputBytes.length).toBeGreaterThan(0);
      expect(isPdfBytes(outputBytes)).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('dist/cli.js docx-to-markdown: real file round trip', () => {
  it("converts a genuine docx fixture to markdown whose output text contains the fixture's own known string", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const inputPath = join(tmpDir, 'fixture.docx');
      const outputPath = join(tmpDir, 'fixture.md');
      const editor = createDocx();
      editor.body.appendParagraph().appendRun({ text: 'DocxToMarkdownSmokeMarker' });
      await writeFile(inputPath, editor.toBytes());

      const { code } = await spawnCli(['docx-to-markdown', inputPath, outputPath]);
      expect(code).toBe(EXIT_SUCCESS);

      // Markdown is the one directly human-readable target format in this whole family -- unlike a PDF or an OOXML/ODF zip, the output can be asserted on as plain text, so this is the one round-trip test in this file that checks the actual converted CONTENT rather than only a byte-signature/length check.
      const outputText = await readFile(outputPath, 'utf8');
      expect(outputText).toContain('DocxToMarkdownSmokeMarker');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('dist/cli.js docx-to-pdf: a nonexistent input file', () => {
  it('exits non-zero with one clean stderr line, not a raw stack trace', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const bogusInput = join(tmpDir, 'does-not-exist.docx');
      const bogusOutput = join(tmpDir, 'out.pdf');

      const { code, stderr } = await spawnCli(['docx-to-pdf', bogusInput, bogusOutput]);
      expect(code).toBe(EXIT_INPUT_ERROR);

      const stderrText = stderr.toString('utf8');
      const lines = stderrText.split('\n').filter((line) => line.length > 0);
      expect(lines).toHaveLength(1);
      // A raw, unhandled Node stack trace always includes a "    at <name> (<file>:<line>:<col>)" frame line -- absence of that shape is the simple heuristic distinguishing this CLI's own one-line formatError output from an escaped exception.
      expect(stderrText).not.toMatch(/at .*:\d+:\d+/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// A genuine font file on disk for --font-file to point at, without shipping one in this repository: the vendored Caladea face documents.js already carries, recovered through the public createFontRegistry API (its own substitute table maps Cambria to Caladea). Real font-tool output, so the family/weight/slope dist/ derives from it are derived from a real 'name'/'OS/2' table pair rather than from anything this test wrote.
function vendoredCaladeaFaceBytes() {
  const resolved = createFontRegistry().resolve({ family: 'Cambria', weight: 'normal', style: 'normal' });
  if (resolved.kind !== 'embedded') {
    throw new Error(`expected the vendored substitute table to embed a face for Cambria, got a ${resolved.kind} face`);
  }
  return resolved.face.font.bytes;
}

// A six-letter subset tag, a '+', then the PostScript name of whichever face was embedded (ISO 32000-1 9.6.2.1); a standard-14 face carries the bare name with no tag.
function baseFontNames(pdfBytes) {
  const text = new TextDecoder('latin1').decode(pdfBytes);
  return [...text.matchAll(/\/BaseFont\s*\/([^\s/>\]]+)/g)].map((match) => match[1]);
}

function docxAskingFor(fontFamily) {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: 'A paragraph in a named font family', fontFamily });
  return editor.toBytes();
}

describe('dist/cli.js docx-to-pdf --font-file', () => {
  it('embeds a real font file supplied on the command line, matched by the family that file itself declares', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const inputPath = join(tmpDir, 'caladea.docx');
      const fontPath = join(tmpDir, 'face.ttf');
      // Caladea is deliberately a family documents.js has NO vendored substitute for (its table maps Calibri and Cambria, not Caladea), so without a --font-file this run has nothing to fall back to but a standard-14 face -- which is exactly what makes the two outputs below distinguishable.
      await writeFile(inputPath, docxAskingFor('Caladea'));
      await writeFile(fontPath, vendoredCaladeaFaceBytes());

      const withoutFont = join(tmpDir, 'without-font.pdf');
      const withFont = join(tmpDir, 'with-font.pdf');
      expect((await spawnCli(['docx-to-pdf', inputPath, withoutFont])).code).toBe(EXIT_SUCCESS);
      expect((await spawnCli(['docx-to-pdf', inputPath, withFont, '--font-file', fontPath])).code).toBe(EXIT_SUCCESS);

      // Nothing on the command line ever said "Caladea" about that file: the family it is matched on came out of the font's own 'name' table, inside the built bundle.
      for (const name of baseFontNames(await readFile(withoutFont))) {
        expect(name).not.toContain('Caladea');
      }
      const suppliedNames = baseFontNames(await readFile(withFont));
      expect(suppliedNames.length).toBeGreaterThan(0);
      for (const name of suppliedNames) {
        expect(name).toContain('Caladea');
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('prints the structured substitution event under --report-font-substitutions, and names a bad font file outright', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const inputPath = join(tmpDir, 'calibri.docx');
      const notAFont = join(tmpDir, 'not-a-font.txt');
      await writeFile(inputPath, docxAskingFor('Calibri'));
      await writeFile(notAFont, 'plain text, definitely not a font\n');

      const reported = await spawnCli(['docx-to-pdf', inputPath, join(tmpDir, 'reported.pdf'), '--report-font-substitutions']);
      expect(reported.code).toBe(EXIT_SUCCESS);
      expect(reported.stderr.toString('utf8')).toContain('font substitution: "Calibri" -> "carlito" (vendored-substitute)');

      const rejected = await spawnCli(['docx-to-pdf', inputPath, join(tmpDir, 'never-written.pdf'), '--font-file', notAFont]);
      expect(rejected.code).not.toBe(EXIT_SUCCESS);
      expect(rejected.stderr.toString('utf8')).toContain('not-a-font.txt is not a TrueType/OpenType font file');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('dist/cli.js csv and svg conversions', () => {
  // The same two fixtures the unit suite's src/commands/convert-selection.test.ts builds: a multi-sheet .ods (a csv target has to be told which sheet) and a multi-page .odg whose pages carry one rect each at disjoint coordinates (buildSvgText draws vectors only, so coordinates are how the emitted SVG tells the pages apart).
  function buildMultiSheetOdsBytes() {
    const editor = createOds();
    const first = editor.sheets()[0];
    first.cell(0, 0).value = { kind: 'string', value: 'AlphaCell' };
    first.cell(0, 1).value = { kind: 'number', value: 42 };
    const beta = editor.addSheet('Beta');
    beta.cell(0, 0).value = { kind: 'string', value: 'BetaCell' };
    beta.cell(0, 1).value = { kind: 'number', value: 7 };
    return editor.toBytes();
  }

  function buildMultiPageOdgBytes() {
    const editor = createOdg();
    editor.addPage().addRect({ frame: { xPt: 20, yPt: 20, widthPt: 100, heightPt: 50 } });
    editor.addPage().addRect({ frame: { xPt: 300, yPt: 400, widthPt: 100, heightPt: 50 } });
    return editor.toBytes();
  }

  it('formats --json lists the csv and svg conversion pairs', async () => {
    const { code, stdout } = await spawnCli(['formats', '--json']);
    expect(code).toBe(EXIT_SUCCESS);
    const pairs = JSON.parse(stdout.toString('utf8')).map((entry) => `${entry.source}->${entry.target}`);
    expect(pairs).toContain('ods->csv');
    expect(pairs).toContain('csv->pdf');
    expect(pairs).toContain('odg->svg');
    expect(pairs).toContain('svg->pdf');
  });

  it('converts a csv source to a real PDF through the generic convert command', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const inputPath = join(tmpDir, 'table.csv');
      const outputPath = join(tmpDir, 'table.pdf');
      await writeFile(inputPath, 'Left,Right\nfirst,second\n');

      const { code } = await spawnCli(['convert', inputPath, outputPath]);
      expect(code).toBe(EXIT_SUCCESS);
      expect(isPdfBytes(await readFile(outputPath))).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('exits 3 on an ambiguous csv target, then writes the picked sheet with --sheet', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const inputPath = join(tmpDir, 'multi.ods');
      await writeFile(inputPath, buildMultiSheetOdsBytes());

      const unpicked = await spawnCli(['ods-to-csv', inputPath, join(tmpDir, 'unpicked.csv')]);
      expect(unpicked.code).toBe(EXIT_NEEDS_INFO);
      expect(unpicked.stderr.toString('utf8')).toContain('Beta');

      const outputPath = join(tmpDir, 'beta.csv');
      const picked = await spawnCli(['ods-to-csv', inputPath, outputPath, '--sheet', 'Beta', '--delimiter', ';']);
      expect(picked.code).toBe(EXIT_SUCCESS);
      await expect(readFile(outputPath, 'utf8')).resolves.toContain('BetaCell;7');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('exits 3 on an ambiguous svg target, then draws the picked page with --page', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const inputPath = join(tmpDir, 'multi.odg');
      await writeFile(inputPath, buildMultiPageOdgBytes());

      const unpicked = await spawnCli(['odg-to-svg', inputPath, join(tmpDir, 'unpicked.svg')]);
      expect(unpicked.code).toBe(EXIT_NEEDS_INFO);

      const outputPath = join(tmpDir, 'page1.svg');
      const picked = await spawnCli(['odg-to-svg', inputPath, outputPath, '--page', '1']);
      expect(picked.code).toBe(EXIT_SUCCESS);
      const svg = await readFile(outputPath, 'utf8');
      expect(svg).toContain('<rect x="300" y="400"');
      expect(svg).not.toContain('<rect x="20" y="20"');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('dist/cli.js outline: real file round trip', () => {
  it('prints an indented outline for a genuine docx fixture through the actual built binary', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const inputPath = join(tmpDir, 'fixture.docx');
      await writeFile(inputPath, buildFixtureDocxBytes());

      const { code, stdout, stderr } = await spawnCli(['outline', inputPath]);
      expect(code).toBe(EXIT_SUCCESS);
      expect(stderr.length).toBe(0);
      expect(stdout.toString('utf8')).toBe('Hello from the document-cli smoke test\n');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('dist/cli.js outline: multi-page odg', () => {
  // Regression coverage for multi-page odg outlining: outline used to bridge every source to a same-variant sibling purely to obtain a package (OUTLINE_CONVERSION_TARGET), and odg's own bridge target, svg, refuses a multi-page document outright (SvgMultiPageNotSpecifiedError) since outline has no --page flag to answer it with -- every multi-page .odg failed outright. outline now reads a source's own native tree directly (readNativeDocumentTree, documents.js), so there is no bridge and no per-page write constraint to dodge at all -- each drawing page reports as its own "Page N" draw-page group, document-outline.js's own drawing-variant convention, straight off odg's own native 'drawing' content.
  it('outlines a multi-page odg as one group per page, with no --page flag needed', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'document-cli-smoke-'));
    try {
      const inputPath = join(tmpDir, 'multi.odg');
      const editor = createOdg();
      editor.addPage().addTextBox({ frame: { xPt: 20, yPt: 20, widthPt: 100, heightPt: 50 }, text: 'First page text' });
      editor.addPage().addTextBox({ frame: { xPt: 20, yPt: 20, widthPt: 100, heightPt: 50 }, text: 'Second page text' });
      await writeFile(inputPath, editor.toBytes());

      const { code, stdout } = await spawnCli(['outline', inputPath]);
      expect(code).toBe(EXIT_SUCCESS);
      expect(stdout.toString('utf8')).toBe('Page 1\n  First page text\nPage 2\n  Second page text\n');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('dist/cli.js outline: --from and stdin', () => {
  it('fails with a stdin-specific usage error naming --from, not the file-rename advice meant for a real path', async () => {
    const { code, stdout, stderr } = await spawnCli(['outline', '-'], { input: buildFixtureDocxBytes() });
    expect(code).toBe(EXIT_USAGE_ERROR);
    expect(stdout.length).toBe(0);
    expect(stderr.toString('utf8')).toContain('cannot infer a source format from stdin; pass --from <format>');
  });

  it('outlines a document piped in on stdin once --from names its format', async () => {
    const { code, stdout, stderr } = await spawnCli(['outline', '-', '--from', 'docx'], { input: buildFixtureDocxBytes() });
    expect(code).toBe(EXIT_SUCCESS);
    expect(stderr.length).toBe(0);
    expect(stdout.toString('utf8')).toBe('Hello from the document-cli smoke test\n');
  });
});

describe('dist/cli.js tui: non-interactive stdout', () => {
  it('exits with a clear, non-crashing error about needing a TTY, never launching Ink at all', async () => {
    const { code, stdout, stderr } = await spawnCli(['tui']);
    expect(code).toBe(EXIT_USAGE_ERROR);
    expect(stdout.length).toBe(0);
    expect(stderr.toString('utf8')).toBe('the TUI requires an interactive terminal (TTY); stdout is currently redirected\n');
  });
});
