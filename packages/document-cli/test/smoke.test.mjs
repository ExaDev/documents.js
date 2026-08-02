// Smoke test: the real built dist/cli.js runs correctly as a genuine subprocess -- argv parsing, exit codes, and stdout/stderr separation, not just the in-process command tree. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to the "smoke" project), never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. Every test here spawns dist/cli.js with node:child_process rather than importing it (it is a bin script, not designed to be imported) or calling src/program.ts's createProgram() directly (that would exercise the in-process command tree, not the actual shipped CLI's argv/exit-code/stdio behaviour this file exists to prove).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDocx } from 'documents.js';
// dist/index.js is this package's own deliberately-importable barrel (see its own top-of-file comment: "so an external consumer -- or a test -- can call this CLI's conversion logic directly"), unlike dist/cli.js -- pulling the exit-code constants from the built artifact avoids hardcoding magic exit-code numbers in this file while still proving the barrel build itself is sound.
import { EXIT_INPUT_ERROR, EXIT_SUCCESS, EXIT_USAGE_ERROR } from '../dist/index.js';

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
    for (const name of ['docx-to-pdf', 'convert', 'formats', 'odm-to-pdf', 'odb-tables', 'pdf-inspect', 'tui']) {
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

describe('dist/cli.js tui: non-interactive stdout', () => {
  it('exits with a clear, non-crashing error about needing a TTY, never launching Ink at all', async () => {
    const { code, stdout, stderr } = await spawnCli(['tui']);
    expect(code).toBe(EXIT_USAGE_ERROR);
    expect(stdout.length).toBe(0);
    expect(stderr.toString('utf8')).toBe('the TUI requires an interactive terminal (TTY); stdout is currently redirected\n');
  });
});
