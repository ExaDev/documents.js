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
import { readMarkdownContent } from './read';
import { GFM_EXCLUSIONS } from './test-support/conformance-exclusions';
import type { SpecExample } from './test-support/spec-corpus';
import { loadGfmExtensionExamples } from './test-support/spec-corpus';
import { writeMarkdownContent } from './write';

const GFM_EXTENSIONS = ['table', 'strikethrough', 'autolink', 'disabled'];

// read -> write -> reparse -> render, all through this package's real public surface -- the identical bar src/conformance.test.ts holds the CommonMark corpus to, applied here to the GFM extensions (all four toggles default on, matching this package's own CommonMark+GFM target). See that file's own top-of-file note for the full rationale.
function render(example: SpecExample): string {
  const { document } = readMarkdownContent(example.markdown);
  const rewritten = writeMarkdownContent(document);
  return renderDocumentToHtml(parseMarkdown(rewritten).document);
}

describe.each(GFM_EXTENSIONS)('GFM %s extension conformance', (extension) => {
  const examples = loadGfmExtensionExamples(extension);

  it('finds tagged examples for this extension in the vendored spec source', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  const covered = examples.filter((example) => !GFM_EXCLUSIONS.has(example.example));
  it.each(covered.map((example) => [`example ${String(example.example)} (${example.section})`, example] as const))('%s', (_name, example) => {
    expect(render(example)).toBe(example.html);
  });

  // The shrink-only guarantee, mirroring src/conformance.test.ts's own -- an excluded example that starts passing must be removed from the list in the same change that fixes it.
  const excluded = examples.filter((example) => GFM_EXCLUSIONS.has(example.example));
  it.each(excluded.map((example) => [`example ${String(example.example)} (${example.section})`, example] as const))('excluded %s still fails', (_name, example) => {
    expect(render(example)).not.toBe(example.html);
  });
});
