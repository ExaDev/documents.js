// Inline \( \) math span recognition (ExaDev/markdown-codec#53), mirroring src/html/html.ts's own matchHtmlTag exactly: a bounded RECOGNISER, not a LaTeX parser -- the span's raw content is carried verbatim and never interpreted.
//
// Consumed by the read side only (src/inline/inline.ts's parseBackslash, which dispatches here on \(). The write side does NOT use pattern-matching to recognise a preserved math run on the way back out -- that was tried and reverted: escapeMarkdownText (src/emit/inline.ts) backslash-escapes ordinary literal '(' and ')' characters, so any ordinary parenthetical remark escapes to the identical \(...\) shape a pattern matcher would misrecognise as math. src/lower/inline.ts marks a lowered math run with a dedicated ContentRun.fontFamily instead (MATH_INLINE_FONT_MARKER, src/shared/style-constants.ts), the same non-pattern-based, opportunistic-reuse trick a code span's own Courier New marker already plays.
//
// Deliberately NOT single-dollar $...$ or block-level $$ (block math is its own construct, src/block/block.ts's tryMathBlockStart) -- see this package's own issue #53 for why single-dollar inline is out of scope (the classic currency false-positive). Never recognised inside a code span or a fenced code block, with no exclusion logic needed here at all: a code span's own content is sliced directly by src/inline/inline.ts's parseCodeSpan without ever being re-dispatched through step() (so this scanner never runs over it), and a fenced code block's own literal never reaches inline parsing in the first place (src/block/block.ts's toAstBlock passes a codeBlock's literal straight through with no toInlineChildren call).
//
// Closes at the FIRST literal '\)' -- no nested-\(-awareness and no escape handling inside the span, matching src/inline/inline.ts's own code-span precedent (a code span closes at the first backtick run of the matching length, with nothing inside it re-interpreted). An unmatched \( (no \) anywhere in the remaining text) is not math at all; the caller falls back to today's ordinary backslash-escape reading of a lone \(.
//
// Returns the FULL matched span, delimiters included (e.g. '\(x^2\)') -- the caller strips the two-character \( / \) delimiters off to build MarkdownMathInlineNode's own literal (inner content only, matching MarkdownCodeSpanNode's convention), while using the full span's own length to advance the scan position past it.
export function matchMathInlineSpan(text: string, index: number): string | undefined {
  if (text.charAt(index) !== '\\' || text.charAt(index + 1) !== '(') {
    return undefined;
  }
  const closeIndex = text.indexOf('\\)', index + 2);
  if (closeIndex === -1) {
    return undefined;
  }
  return text.slice(index, closeIndex + 2);
}
