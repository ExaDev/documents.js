import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../program';
import { EXIT_SUCCESS } from '../runtime/exit-codes';
import { createFilesystemMarkdownImageResolver } from '../runtime/markdown-images';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Walks the dumped DocumentPackage JSON for any image block -- a narrowing guard rather than a typed parse, so this test never needs a type assertion over the raw JSON shape.
function dumpHasImageBlock(pkg: unknown): boolean {
  if (!isRecord(pkg) || !isRecord(pkg.content)) {
    return false;
  }
  const sections = pkg.content.sections;
  if (!Array.isArray(sections)) {
    return false;
  }
  return sections.some((section) => isRecord(section) && Array.isArray(section.blocks) && section.blocks.some((block) => isRecord(block) && block.kind === 'image'));
}

// A CLI `convert notes.md` resolves a relative-path image against notes.md's own directory and embeds it, rather than degrading it to alt text -- the end-to-end proof that the filesystem MarkdownImageResolver wired into buildConversionAction (commands/shared.ts) reaches documents.js's port and through it markdown-codec's resolver.

// A real 1x1 PNG (the same one markdown-codec's own test suite uses), decoded from base64.
const ONE_PIXEL_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), (char) => char.codePointAt(0)!);

let workspace: string;
let savedExitCode: typeof process.exitCode;

async function runCli(args: readonly string[]): Promise<{ exitCode: typeof process.exitCode; stderr: string }> {
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

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'document-cli-markdown-images-'));
  await writeFile(join(workspace, 'image.png'), ONE_PIXEL_PNG);
  await writeFile(join(workspace, 'notes.md'), '![a local image](./image.png)\n');
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

describe('filesystem MarkdownImageResolver', () => {
  it('resolves a relative path against its base directory and returns the bytes', () => {
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver('./image.png')?.bytes).toEqual(ONE_PIXEL_PNG);
  });

  it('returns undefined for a scheme-prefixed URL (http/file) and a missing file, never throwing', () => {
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver('https://example.org/image.png')).toBeUndefined();
    expect(resolver('data:image/png;base64,abc')).toBeUndefined();
    expect(resolver('./does-not-exist.png')).toBeUndefined();
  });
});

describe('CLI markdown image embedding', () => {
  it('a markdown-to-pdf conversion embeds a relative-path image from the input file\'s directory', async () => {
    const dumpPath = join(workspace, 'package.json');
    const result = await runCli(['markdown-to-pdf', join(workspace, 'notes.md'), '--dump-package', dumpPath]);
    expect(result.exitCode).toBe(EXIT_SUCCESS);

    const hasImage = dumpHasImageBlock(JSON.parse(await readFile(dumpPath, 'utf8')));
    expect(hasImage).toBe(true);
  });
});
