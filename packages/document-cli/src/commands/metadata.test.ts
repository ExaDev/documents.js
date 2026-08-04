import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocx } from 'documents.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../program';
import { EXIT_SUCCESS } from '../runtime/exit-codes';
import { buildDocxWithMetadata, buildOdtWithMetadata, buildPdfWithMetadata, METADATA_FIXTURE } from '../test-support/metadata-fixture';

// Drives the real assembled commander program against real fixtures across several formats -- proving the `metadata` command dispatches to the right reader per source format (docx via ooxml.js's decodePackage, odt via odf.js's, pdf directly via readPdf) rather than exercising formatMetadataLines in isolation, which src/runtime/metadata-format.test.ts already covers on its own.

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

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'document-cli-metadata-'));
  await writeFile(join(workspace, 'fixture.docx'), buildDocxWithMetadata());
  await writeFile(join(workspace, 'fixture.odt'), buildOdtWithMetadata());
  await writeFile(join(workspace, 'fixture.pdf'), buildPdfWithMetadata());
  const plain = createDocx();
  plain.body.appendParagraph().appendRun({ text: 'No metadata here.' });
  await writeFile(join(workspace, 'plain.docx'), plain.toBytes());
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

describe('metadata', () => {
  it("prints a docx's own metadata as a human-readable report", async () => {
    const { exitCode, stdout, stderr } = await runCli(['metadata', join(workspace, 'fixture.docx')]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain(`title: ${METADATA_FIXTURE.title}`);
    expect(stdout).toContain(`author: ${METADATA_FIXTURE.author}`);
    expect(stdout).toContain(`subject: ${METADATA_FIXTURE.subject}`);
    expect(stdout).toContain(`keywords: ${METADATA_FIXTURE.keywords?.join(', ')}`);
  });

  it("prints an odt's own metadata, decoded through odf.js rather than ooxml.js", async () => {
    const { exitCode, stdout, stderr } = await runCli(['metadata', join(workspace, 'fixture.odt')]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain(`title: ${METADATA_FIXTURE.title}`);
    expect(stdout).toContain(`author: ${METADATA_FIXTURE.author}`);
  });

  it("prints a pdf's own metadata directly via readPdf, with no ContentDocument involved", async () => {
    const { exitCode, stdout, stderr } = await runCli(['metadata', join(workspace, 'fixture.pdf')]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain(`title: ${METADATA_FIXTURE.title}`);
    expect(stdout).toContain(`subject: ${METADATA_FIXTURE.subject}`);
  });

  it('emits the bare LayoutMetadata object as parseable JSON under --json', async () => {
    const { exitCode, stdout, stderr } = await runCli(['metadata', join(workspace, 'fixture.docx'), '--json']);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toMatchObject({ title: METADATA_FIXTURE.title, author: METADATA_FIXTURE.author, subject: METADATA_FIXTURE.subject, keywords: METADATA_FIXTURE.keywords });
  });

  it('omits every field the document does not set, even though createDocx always stamps created/modified timestamps', async () => {
    const { exitCode, stdout } = await runCli(['metadata', join(workspace, 'plain.docx')]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).not.toContain('title:');
    expect(stdout).not.toContain('author:');
    expect(stdout).not.toContain('subject:');
    expect(stdout).not.toContain('keywords:');
    // A fresh createDocx() document always carries real timestamps -- this is not the "no metadata at all" empty-array case, which src/runtime/metadata-format.test.ts covers directly.
    expect(stdout).toContain('createdIso:');
  });

  it('fails with a usage error when the source format cannot be inferred from the input path', async () => {
    const { exitCode, stderr } = await runCli(['metadata', join(workspace, 'fixture.unknownext')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('cannot infer a source format');
  });
});
