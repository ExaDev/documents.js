// The SHRINK-ONLY exclusion list for src/inline/conformance.test.ts: CommonMark 0.31.2 examples from the inline-focused sections that the inline phase is not yet checked against.
//
// "Shrink-only" is enforced mechanically, not by convention: conformance.test.ts asserts that every example named here currently FAILS. Fixing one and forgetting to delete its entry turns the suite red, so the list can never quietly accumulate examples that already pass, and can never be padded to hide a regression.
//
// Every entry below is here for the SAME reason -- the example's expected output is a block-level construct (an indented or fenced code block, an HTML block, a list, an ATX heading) that the trivial paragraph-only block parser this suite runs against (src/test-support/parse-markdown.ts) cannot produce at all. Not one is an inline-phase defect: in each case the inline content itself is handled correctly and only the surrounding block wrapper is wrong. They live in these sections because the spec files each example under whichever feature it ILLUSTRATES (that backslash escapes do not apply inside code, that character references do not apply inside code, that a trailing backslash is literal at the end of a heading), not under the block construct it happens to need. When src/block/ lands, this list should empty out entirely.
export const COMMONMARK_INLINE_EXCLUSIONS: ReadonlyMap<number, string> = new Map([
  [18, 'Backslash escapes: expects an indented code block'],
  [19, 'Backslash escapes: expects a tilde-fenced code block'],
  [21, 'Backslash escapes: expects a raw HTML block'],
  [24, 'Backslash escapes: expects a fenced code block with an info string'],
  [31, 'Entity and numeric character references: expects a raw HTML block'],
  [34, 'Entity and numeric character references: expects a fenced code block with an info string'],
  [36, 'Entity and numeric character references: expects an indented code block'],
  [38, 'Entity and numeric character references: expects a bullet list'],
  [646, 'Hard line breaks: expects an ATX heading'],
  [647, 'Hard line breaks: expects an ATX heading'],
]);
