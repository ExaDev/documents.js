// The inline phase measured against the REAL CommonMark 0.31.2 conformance corpus (assets/commonmark/spec.json), for every inline-focused section: Backslash escapes, Entity and numeric character references, Code spans, Emphasis and strong emphasis, Links, Images, Autolinks, Raw HTML, Hard line breaks, Soft line breaks.
//
// Each example is block-parsed by the deliberately trivial paragraph-only harness in src/test-support/parse-markdown.ts, inline-parsed by parseInlines, rendered back to HTML by src/test-support/render-html.ts, and compared byte for byte against the corpus's own `html` field. GFM's own extensions are switched OFF here: a bare `http://example.com` in paragraph text is plain text under CommonMark and a link under GFM, and this suite measures CommonMark.
//
// Anything not yet passing is named individually in src/inline/conformance-exclusions.ts, with a test below asserting that every excluded example genuinely still fails -- see that file for why the list can only shrink.

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../test-support/parse-markdown';
import { renderDocumentToHtml } from '../test-support/render-html';
import type { SpecExample } from '../test-support/spec-corpus';
import { INLINE_SPEC_SECTIONS, loadInlineSpecExamples } from '../test-support/spec-corpus';
import { COMMONMARK_INLINE_EXCLUSIONS } from './conformance-exclusions';

// CommonMark, not CommonMark+GFM -- see this file's own top-of-file note.
const COMMONMARK_ONLY = { gfmAutolinks: false, gfmStrikethrough: false };

function render(example: SpecExample): string {
  return renderDocumentToHtml(parseMarkdown(example.markdown, COMMONMARK_ONLY).document);
}

const examples = loadInlineSpecExamples();

describe('CommonMark 0.31.2 inline conformance', () => {
  it('loads every inline-focused section from the vendored corpus', () => {
    expect(examples.length).toBeGreaterThan(0);
    expect(new Set(examples.map((example) => example.section))).toEqual(new Set(INLINE_SPEC_SECTIONS));
  });

  const covered = examples.filter((example) => !COMMONMARK_INLINE_EXCLUSIONS.has(example.example));
  it.each(covered.map((example) => [`example ${String(example.example)} (${example.section})`, example] as const))('%s', (_name, example) => {
    expect(render(example)).toBe(example.html);
  });

  // The shrink-only guarantee. An excluded example that starts passing must be removed from the list in the same change that fixes it, so the list can never hide an example that is already green.
  const excluded = examples.filter((example) => COMMONMARK_INLINE_EXCLUSIONS.has(example.example));
  it.each(excluded.map((example) => [`example ${String(example.example)} (${example.section})`, example] as const))('excluded %s still fails', (_name, example) => {
    expect(render(example)).not.toBe(example.html);
  });

  it('names only examples that exist in the corpus', () => {
    const numbers = new Set(examples.map((example) => example.example));
    expect([...COMMONMARK_INLINE_EXCLUSIONS.keys()].filter((number) => !numbers.has(number))).toEqual([]);
  });
});
