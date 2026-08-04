import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocx, docxToPdf, documentFromJson, readPdf, UnrecognizedDocumentSchemaError, type LayoutDocument } from 'documents.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../program';
import { EXIT_SUCCESS } from '../runtime/exit-codes';

// Drives the real assembled commander program against a real PDF (docxToPdf's own real output, not a hand-built LayoutDocument), proving `--full` writes a tagged, genuinely round-trippable dump rather than the bare `JSON.stringify(layout)` it used to.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

let savedExitCode: typeof process.exitCode;
let workspace: string;
let pdfPath: string;

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

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'document-cli-pdf-inspect-'));
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: 'A paragraph of ordinary body text.' });
  const pdfBytes = docxToPdf(editor.toBytes());
  pdfPath = join(workspace, 'sample.pdf');
  await writeFile(pdfPath, pdfBytes);
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

describe('pdf-inspect --full', () => {
  it('writes a $schema-tagged dump, unreadable as such before the fix', async () => {
    const { exitCode, stdout, stderr } = await runCli(['pdf-inspect', pdfPath, '--full']);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed: unknown = JSON.parse(stdout);
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) {
      throw new Error('expected the --full dump to parse as a JSON object');
    }
    expect(typeof parsed.$schema).toBe('string');

    // The defect this test guards against: a bare `JSON.stringify(layout)` (this command's own prior behaviour) carries no `$schema` marker at all, so `documentFromJson` cannot identify it as anything and throws `UnrecognizedDocumentSchemaError` -- proven directly here, against the parsed dump with its own `$schema` property stripped (built via a plain Object.entries filter, never a type assertion), rather than asserted from memory of the old code path.
    const withoutSchema: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== '$schema') {
        withoutSchema[key] = value;
      }
    }
    expect(() => documentFromJson(withoutSchema)).toThrow(UnrecognizedDocumentSchemaError);
  });

  it('round-trips through documentFromJson back to a LayoutDocument matching a direct readPdf of the same bytes', async () => {
    const { exitCode, stdout } = await runCli(['pdf-inspect', pdfPath, '--full']);
    expect(exitCode).toBe(EXIT_SUCCESS);

    const parsed: unknown = JSON.parse(stdout);
    const result = documentFromJson(parsed);

    expect(result.kind).toBe('LayoutDocument');
    if (result.kind !== 'LayoutDocument') {
      throw new Error(`expected a LayoutDocument, got a ${result.kind}`);
    }

    // `toEqual`, not `toStrictEqual`: a JSON round trip cannot distinguish an explicitly-`undefined` optional field (how `readPdf`'s own in-memory value carries an absent one) from a genuinely missing key (what `JSON.stringify`/`JSON.parse` produces for it instead) -- an inherent property of JSON itself, not a defect in the tagging fix this test exists to prove.
    const directRead: LayoutDocument = readPdf(new Uint8Array(await readFile(pdfPath)));
    expect(result.value).toEqual(directRead);
  });
});
