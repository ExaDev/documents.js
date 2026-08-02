// The whole parser -- block phase and inline phase together -- measured against the REAL CommonMark 0.31.2 conformance corpus (assets/commonmark/spec.json), every example in every section, not a subset.
//
// Each example is parsed by parseMarkdown (src/block/block.ts) and rendered back to HTML by src/test-support/render-html.ts, then compared byte for byte against the corpus's own `html` field. GFM's own extensions are switched OFF here: a bare `http://example.com` in paragraph text is plain text under CommonMark and a link under GFM, a `~~x~~` is literal tildes, and a delimiter row is ordinary paragraph text -- this suite measures CommonMark, and src/gfm-conformance.test.ts measures the extensions against their own corpus.
//
// Anything not yet passing is named individually in src/test-support/conformance-exclusions.ts, with a test below asserting that every excluded example genuinely still fails -- see that file for why the list can only shrink.

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './block/block';
import { COMMONMARK_EXCLUSIONS } from './test-support/conformance-exclusions';
import { renderDocumentToHtml } from './test-support/render-html';
import type { SpecExample } from './test-support/spec-corpus';
import { loadSpecExamples } from './test-support/spec-corpus';

// CommonMark, not CommonMark+GFM -- see this file's own top-of-file note.
const COMMONMARK_ONLY = { gfmAutolinks: false, gfmStrikethrough: false, gfmTables: false };

function render(example: SpecExample): string {
  return renderDocumentToHtml(parseMarkdown(example.markdown, COMMONMARK_ONLY).document);
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
