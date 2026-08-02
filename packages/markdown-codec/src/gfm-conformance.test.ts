// The GFM extensions measured against the REAL GitHub Flavored Markdown Spec's own examples (assets/gfm/spec.txt), extracted from the spec source rather than from a second vendored corpus -- see src/test-support/spec-corpus.ts for why.
//
// Only the examples the spec source itself TAGS with an extension name are run: `table` (the block phase's own GFM construct), `strikethrough` and `autolink` (both the inline phase's), and `disabled`. The untagged examples in that file are the CommonMark base at GFM's own pinned spec version, which src/conformance.test.ts already covers against the newer, machine-readable CommonMark 0.31.2 corpus.
//
// `disabled` is not, on inspection of this pinned spec version, a generic "an extension can be turned off" tag at all -- every one of its two occurrences in assets/gfm/spec.txt is a "Task list items (extension)" example (confirmed by reading the file directly: both are the two examples under that section's own heading, and no other section uses the tag). Running it here IS running task-list conformance, not a distinct concept; the name is simply what this spec snapshot's own source happened to tag those two examples with, most plausibly because cmark-gfm's own test harness does not hold its checkbox HTML to the same byte-for-byte bar as the rest of the corpus (the spec prose itself says implementors are free to render the checkbox however they like). This package's own renderer (src/html/render.ts) chooses to match the two given examples exactly, so they are exercised here rather than excluded.
//
// The one remaining tagged extension, `tagfilter`, is genuinely out of scope: it is an output-sanitisation pass over already-parsed raw HTML, not a parsing rule at all, and this package's read side has no HTML output to sanitise.

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './block/block';
import { renderDocumentToHtml } from './html/render';
import type { SpecExample } from './test-support/spec-corpus';
import { loadGfmExtensionExamples } from './test-support/spec-corpus';

const GFM_EXTENSIONS = ['table', 'strikethrough', 'autolink', 'disabled'];

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
