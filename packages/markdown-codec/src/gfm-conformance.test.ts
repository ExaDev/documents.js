// The GFM extensions measured against the REAL GitHub Flavored Markdown Spec's own examples (assets/gfm/spec.txt), extracted from the spec source rather than from a second vendored corpus -- see src/test-support/spec-corpus.ts for why.
//
// Only the examples the spec source itself TAGS with an extension name are run: `table` (the block phase's own GFM construct), `strikethrough`, and `autolink` (both the inline phase's). The untagged examples in that file are the CommonMark base at GFM's own pinned spec version, which src/conformance.test.ts already covers against the newer, machine-readable CommonMark 0.31.2 corpus.
//
// The remaining two tagged extensions are deliberately not run. `tagfilter` is an output-sanitisation pass over already-parsed raw HTML, not a parsing rule at all, and this package's read side has no HTML output to sanitise. `disabled` tests that an extension can be turned off through cmark-gfm's own command-line flags, which is a property of that binary rather than of the grammar.

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './block/block';
import { renderDocumentToHtml } from './test-support/render-html';
import type { SpecExample } from './test-support/spec-corpus';
import { loadGfmExtensionExamples } from './test-support/spec-corpus';

const GFM_EXTENSIONS = ['table', 'strikethrough', 'autolink'];

function render(example: SpecExample): string {
  return renderDocumentToHtml(parseMarkdown(example.markdown).document);
}

describe.each(GFM_EXTENSIONS)('GFM %s extension conformance', (extension) => {
  const examples = loadGfmExtensionExamples(extension);

  it('finds tagged examples for this extension in the vendored spec source', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples.map((example) => [`example ${String(example.example)} (${example.section})`, example] as const))('%s', (_name, example) => {
    expect(render(example)).toBe(example.html);
  });
});
