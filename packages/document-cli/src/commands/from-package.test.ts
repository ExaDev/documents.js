import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocx, openDocx } from 'documents.js';
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

    const fromPackageRun = await runCli(['from-package', packagePath, rebuiltPath]);
    expect(fromPackageRun.exitCode).toBe(EXIT_SUCCESS);

    const rebuilt = openDocx(new Uint8Array(await readFile(rebuiltPath)));
    const paragraphs = rebuilt.paragraphs();
    expect(paragraphs.some((paragraph) => paragraph.text === PARAGRAPH_TEXT)).toBe(true);
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

  it('rejects xlsx as a target outright, naming the ods-to-xlsx workaround', async () => {
    const packagePath = join(workspace, 'dumped-for-xlsx.package.json');
    await runCli(['docx-to-pdf', join(workspace, 'source.docx'), join(workspace, 'unused3.pdf'), '--dump-package', packagePath]);

    const { exitCode, stderr } = await runCli(['from-package', packagePath, join(workspace, 'never-written.xlsx')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("'xlsx' cannot be built from a DocumentPackage directly");
  });

  it('rejects a plain JSON file with no recognised $schema', async () => {
    const plainPath = join(workspace, 'plain.json');
    await writeFile(plainPath, JSON.stringify({ hello: 'world' }));

    const { exitCode, stderr } = await runCli(['from-package', plainPath, join(workspace, 'never-written2.docx')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('no recognised $schema');
  });

  it("rejects 'pdf' as the target when the dumped package came from a bridge conversion with no layout half at all", async () => {
    const packagePath = join(workspace, 'dumped-from-bridge.package.json');
    // A bridge conversion (odt-to-docx) runs no layout engine at all -- its own dumped package always carries a real ContentDocument but layout left undefined (see documents.js's own DocumentBridgeOptions.onDocument comment), unlike every docx-to-pdf/pdf-to-docx dump the other tests in this file use.
    await runCli(['docx-to-odt', join(workspace, 'source.docx'), join(workspace, 'source.odt')]);
    const bridgeRun = await runCli(['odt-to-docx', join(workspace, 'source.odt'), join(workspace, 'unused-bridge.docx'), '--dump-package', packagePath]);
    expect(bridgeRun.exitCode).toBe(EXIT_SUCCESS);

    const { exitCode, stderr } = await runCli(['from-package', packagePath, join(workspace, 'never-written4.pdf')]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain('this DocumentPackage has no layout');
  });
});
