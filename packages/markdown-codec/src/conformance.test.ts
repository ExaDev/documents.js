// The whole pipeline -- read, write, and reparse together -- measured against the REAL CommonMark 0.31.2 conformance corpus (assets/commonmark/spec.json), every example in every section, not a subset.
//
// Each example is run end to end through the real PUBLIC readMarkdown/writeMarkdown surface, not just the bare parser: readMarkdown (src/read.ts, itself src/block/block.ts's parseMarkdown plus src/lower/lower.ts's lowering to a ContentDocument) produces the document-schema.js pivot; writeMarkdown (src/write.ts, src/emit/emit.ts) renders that pivot back to markdown text; parseMarkdown reads that rewritten text a second time, under the identical CommonMark-only options, back to this package's own internal AST; and src/html/render.ts (the real CommonMark-HTML conformance oracle) renders that AST to HTML, compared byte for byte against the corpus's own `html` field. This is deliberately a stricter bar than measuring the bare parser alone: a round trip through the ContentDocument pivot has to survive src/lower's own semantic mapping AND src/emit's own inverse rendering with no loss the reparse can detect, which is exactly the wiring this test exists to prove now that read/write/codec are assembled -- see src/lower/ and src/emit/'s own top-of-file comments for what each stage is documented to gain or lose.
//
// GFM's own extensions are switched OFF for both the read and the reparse: a bare `http://example.com` in paragraph text is plain text under CommonMark and a link under GFM, a `~~x~~` is literal tildes, a delimiter row is ordinary paragraph text, and a leading `[ ]`/`[x]` is ordinary paragraph text rather than a task-list marker -- this suite measures CommonMark, and src/gfm-conformance.test.ts measures the extensions (through the identical read -> write -> reparse -> render path) against their own corpus. writeMarkdown itself has no GFM toggle of its own to match: it emits whatever markdown syntax a given ContentDocument construct needs (a ContentTable always becomes a GFM table, a strike run always becomes `~~x~~`), and with the extensions off on the read side no such construct is ever produced from a CommonMark-only example in the first place.
//
// Anything not yet passing is named individually in src/test-support/conformance-exclusions.ts, with a test below asserting that every excluded example genuinely still fails -- see that file for why the list can only shrink.

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './block/block';
import { renderDocumentToHtml } from './html/render';
import { readMarkdown } from './read';
import { COMMONMARK_EXCLUSIONS } from './test-support/conformance-exclusions';
import type { SpecExample } from './test-support/spec-corpus';
import { loadSpecExamples } from './test-support/spec-corpus';
import { writeMarkdown } from './write';

// CommonMark, not CommonMark+GFM -- see this file's own top-of-file note.
const COMMONMARK_ONLY = { gfmAutolinks: false, gfmStrikethrough: false, gfmTables: false, gfmTaskLists: false };

// read -> write -> reparse -> render, all through this package's real public surface -- see this file's own top-of-file note for why this is the bar now, not a direct parseMarkdown -> render measurement.
function render(example: SpecExample): string {
  const { document } = readMarkdown(example.markdown, COMMONMARK_ONLY);
  const rewritten = writeMarkdown(document);
  return renderDocumentToHtml(parseMarkdown(rewritten, COMMONMARK_ONLY).document);
}

const examples = loadSpecExamples();

describe('CommonMark 0.31.2 conformance', () => {
  it('loads the whole vendored corpus, not a section of it', () => {
    expect(examples.length).toBeGreaterThan(0);
    expect(new Set(examples.map((example) => example.section)).size).toBeGreaterThan(1);
  });

  const covered = examples.filter((example) => !COMMONMARK_EXCLUSIONS.has(example.example));
  it.each(covered.map((example) => [`example ${String(example.example)} (${example.section})`, example] as const))('%s', (_name, example) => {
    expect(render(example)).toBe(example.html);
  });

  // The shrink-only guarantee. An excluded example that starts passing must be removed from the list in the same change that fixes it, so the list can never hide an example that is already green.
  const excluded = examples.filter((example) => COMMONMARK_EXCLUSIONS.has(example.example));
  it.each(excluded.map((example) => [`example ${String(example.example)} (${example.section})`, example] as const))('excluded %s still fails', (_name, example) => {
    expect(render(example)).not.toBe(example.html);
  });

  it('names only examples that exist in the corpus', () => {
    const numbers = new Set(examples.map((example) => example.example));
    expect([...COMMONMARK_EXCLUSIONS.keys()].filter((number) => !numbers.has(number))).toEqual([]);
  });
});
