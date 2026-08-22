import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocx } from 'documents.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../program';
import { EXIT_SUCCESS } from '../runtime/exit-codes';
import { buildDocxWithExtras, DOCX_EXTRAS_FIXTURE } from '../test-support/docx-extras-fixture';

// Drives the real assembled commander program against a real docx fixture (test-support/docx-extras-fixture.ts), not formatDocxExtrasLines in isolation -- that half is covered by src/docx-extras-format.test.ts. What this file proves is the wiring: that `docx-extras` is registered under that name, that it reads and decodes a genuine docx through ooxml.js's decodePackage (re-exported from documents.js) rather than odf.js's same-named function, that the structure reaches stdout, and that `--json` emits the bare DocxExtras object verbatim.

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
  workspace = await mkdtemp(join(tmpdir(), 'document-cli-docx-extras-'));
  await writeFile(join(workspace, 'extras.docx'), buildDocxWithExtras());
  const plain = createDocx();
  plain.body.appendParagraph().appendRun({ text: 'Nothing extra here.' });
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

describe('docx-extras', () => {
  it("prints the fixture's own comments, footnotes, headers, footers, and numbering as a human-readable report", async () => {
    const { exitCode, stdout, stderr } = await runCli(['docx-extras', join(workspace, 'extras.docx')]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('comments');
    expect(stdout).toContain(`[1] ${DOCX_EXTRAS_FIXTURE.commentAuthor}: ${DOCX_EXTRAS_FIXTURE.commentWithAuthorText}`);
    expect(stdout).toContain('footnotes');
    expect(stdout).toContain(`[1] ${DOCX_EXTRAS_FIXTURE.footnoteText}`);
    expect(stdout).toContain('headers');
    expect(stdout).toContain(DOCX_EXTRAS_FIXTURE.headerText);
    expect(stdout).toContain('footers');
    expect(stdout).toContain(DOCX_EXTRAS_FIXTURE.footerText);
    expect(stdout).toContain('numbering');
    expect(stdout).toContain(`numId ${DOCX_EXTRAS_FIXTURE.numId}`);
  });

  it('emits the bare DocxExtras object as parseable JSON under --json, decoded through ooxml.js rather than odf.js', async () => {
    const { exitCode, stdout, stderr } = await runCli(['docx-extras', join(workspace, 'extras.docx'), '--json']);

    expect(stderr).toBe('');
    expect(exitCode).toBe(EXIT_SUCCESS);
    // Asserted as one plain-object equality rather than by narrowing the parsed `unknown` field by field: JSON.parse succeeding above already proves the payload is well-formed JSON, matching commands/odb.test.ts's own --json convention.
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toStrictEqual({
      // Each comment and note carries its own w:id, the key a comment extent's or note reference's anchor name joins its body back through.
      comments: [
        { id: '0', author: DOCX_EXTRAS_FIXTURE.commentAuthor, text: DOCX_EXTRAS_FIXTURE.commentWithAuthorText },
        { id: '1', text: DOCX_EXTRAS_FIXTURE.commentWithoutAuthorText },
      ],
      footnotes: [{ id: '1', text: DOCX_EXTRAS_FIXTURE.footnoteText }],
      // The fixture writes word/header1.xml/word/footer1.xml with no relationships at all, so these parts surface through the unreferenced-part walk; its scaffold styles.xml has no docDefaults, so the part runs resolve bare. sectionHeaderFooters is positional -- createDocx's single sectPr spells no references, hence [{}].
      headerFooterParts: [
        { path: 'word/footer1.xml', kind: 'footer', blocks: [{ kind: 'paragraph', runs: [{ text: DOCX_EXTRAS_FIXTURE.footerText }] }] },
        { path: 'word/header1.xml', kind: 'header', blocks: [{ kind: 'paragraph', runs: [{ text: DOCX_EXTRAS_FIXTURE.headerText }] }] },
      ],
      sectionHeaderFooters: [{}],
      numbering: {
        [DOCX_EXTRAS_FIXTURE.numId]: {
          levels: { '0': { format: DOCX_EXTRAS_FIXTURE.numberingLevel.format, text: DOCX_EXTRAS_FIXTURE.numberingLevel.text, startAt: 1 } },
        },
      },
    });
  });

  it('says so plainly for a plain docx with none of the five kinds of extra data', async () => {
    const { exitCode, stdout } = await runCli(['docx-extras', join(workspace, 'plain.docx')]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('This document carries no comments, footnotes, headers, footers, or numbering definitions.');
  });
});
