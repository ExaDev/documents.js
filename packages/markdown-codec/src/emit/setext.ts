// The setext-promotion safety analysis split from emit.ts: every predicate that decides whether a level-1/2 heading may render as setext (the #940 rules), plus the heading renderers, none touching the document walk.

import type { ContentParagraph } from "document-schema.js";
import { emitRuns } from "./inline";
import { NOOP_MARKDOWN_DIAGNOSTIC_SINK } from "../diagnostics/diagnostics";
import type { EmitContext } from "./emit";
import {
  ESCAPED_HARD_BREAK_PATTERN,
  LINE_ENDING_PATTERN,
} from "../shared/line-ending";
import {
  parseHeadingStyleId,
  CODE_BLOCK_STYLE_ID,
  HORIZONTAL_RULE_STYLE_ID,
  HTML_PREFORMATTED_STYLE_ID,
  MATH_BLOCK_STYLE_ID,
  QUOTE_STYLE_ID,
} from "../shared/style-constants";
import {
  ATX_MARKER_PATTERN,
  CODE_FENCE_PATTERN,
  MATH_BLOCK_MARKER_PATTERN,
  THEMATIC_BREAK_PATTERN,
} from "../block/block";
import { CODE_INDENT_COLUMNS, LineCursor } from "../block/line";
import { matchHtmlBlockStart } from "../html/html";
import { parseListMarker } from "../block/list";
import { parseTableDelimiterRow, splitTableRow } from "../block/table";

export const MAX_SETEXT_LEVEL = 2;
export const SETEXT_LEVEL_1_CHAR = "=";
export const SETEXT_LEVEL_2_CHAR = "-";
export const MIN_SETEXT_UNDERLINE_LENGTH = 1;

// String.prototype.split never returns an empty array for any input, even the empty string ("".split(x) === [""]) — so a split result's own first line is always genuinely present. Returning a tuple type here, rather than a plain string[], lets every call site destructure or index its own first element directly: TypeScript already knows a tuple's fixed leading position is defined regardless of noUncheckedIndexedAccess, so no call site needs a dead "?? ''"/"= ''" fallback for a branch this invariant guarantees it can never actually take. The non-null assertion below is the one place that invariant is asserted, rather than repeated at every call site.
export function splitLines(
  text: string,
  pattern: string | RegExp,
): readonly [string, ...string[]] {
  const [first, ...rest] = text.split(pattern);
  return [first!, ...rest];
}

export function renderSetextHeading(level: number, text: string): string {
  const underlineChar = level === 1 ? SETEXT_LEVEL_1_CHAR : SETEXT_LEVEL_2_CHAR;
  // A setext underline's own length has no semantic meaning beyond "one or more" — matching the heading text's own rendered length keeps the output visually tidy without claiming any significance for the exact count, so a CR- or CRLF-delimited first line (LINE_ENDING_PATTERN, not a bare '\n' split) still measures the SAME first line the rest of this module's own line-ending-aware checks agree on, rather than treating the whole multi-line text as a single "line" whenever its own first break is not an LF.
  const [firstLine] = splitLines(text, LINE_ENDING_PATTERN);
  const underline = underlineChar.repeat(
    Math.max(MIN_SETEXT_UNDERLINE_LENGTH, firstLine.length),
  );
  return `${text}\n${underline}`;
}

// The ATX spelling of a heading, with every line ending in its own rendered text collapsed to a single space. ATX is a single physical line, and writing a line ending into one would split it in two on reparse rather than merely lose formatting. The escaped hard-break spelling (a backslash immediately before the line ending) is stripped first via ESCAPED_HARD_BREAK_PATTERN, together with the line ending it precedes, in one collapse: this package's own escapeMarkdownText always spells it with a trailing LF, but a run's own markdown residue can carry the identical backslash-escape spelling against a CRLF or lone CR just as legitimately, and an LF-only strip would leave that backslash behind as a stray literal character once the LINE_ENDING_PATTERN split below removes the CRLF/CR out from under it. Everything left over is then split on LINE_ENDING_PATTERN and rejoined with spaces, collapsing every remaining line ending (a bare soft-break LF, plus a bare CR or CRLF a run's own text or markdown residue can carry) to the single space ATX's own grammar requires. A text with no line ending in it at all passes through both steps unchanged, which is why every ATX return below goes through here rather than only the break-carrying ones.
export function renderAtxHeading(level: number, text: string): string {
  const collapsed = text
    .replace(ESCAPED_HARD_BREAK_PATTERN, " ")
    .split(LINE_ENDING_PATTERN)
    .join(" ");
  return `${"#".repeat(level)} ${collapsed}`;
}

// A fenced code block's own closing condition (spec 0.31.2, "Fenced code blocks") is "a code fence of the same type as the code block that opened it, of length AT LEAST as great as the opening fence" — so a fence of exactly 3 characters closes prematurely the moment the code block's own literal content happens to contain a run of 3-or-more of that same character on its own line (a real, common case: this package always re-renders a code block as fenced regardless of whether it was originally fenced or indented, so an indented block whose own text happens to contain a backtick fence is exactly the scenario this guards). The fix real fenced-code-block writers already use: pick a fence one character longer than the longest run of the fence character anywhere in the content, so no line inside the block can ever be mistaken for the closing fence.
export const MIN_CODE_FENCE_LENGTH = 3;
// CommonMark's own minimum thematic-break rule count: three or more of the same character.
export const THEMATIC_BREAK_CHAR_COUNT = 3;

export function longestRunLength(text: string, char: string): number {
  let longest = 0;
  let current = 0;
  for (const candidate of text) {
    if (candidate === char) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function codeFenceFor(literal: string, fenceChar: string): string {
  return fenceChar.repeat(
    Math.max(MIN_CODE_FENCE_LENGTH, longestRunLength(literal, fenceChar) + 1),
  );
}

export const QUOTABLE_STYLE_IDS: ReadonlySet<string> = new Set([
  QUOTE_STYLE_ID,
  CODE_BLOCK_STYLE_ID,
  HORIZONTAL_RULE_STYLE_ID,
  HTML_PREFORMATTED_STYLE_ID,
  MATH_BLOCK_STYLE_ID,
]);

export function isQuotableStyle(styleId: string | undefined): boolean {
  if (styleId === undefined) {
    return false;
  }
  return (
    QUOTABLE_STYLE_IDS.has(styleId) ||
    parseHeadingStyleId(styleId) !== undefined
  );
}

// Whether a rendered block of this styleId closes itself unambiguously — so a non-blank line immediately following it is always scanned by a reparse as a FRESH block rather than being absorbed backward into this one as ordinary continuation text. This is the "safe as PREVIOUS" half of requiresBlankLineBefore's compound check below, and unlike canInterruptOpenParagraph it does not depend on any emit option: a fenced code block and a math block each close at their own explicit closing delimiter, a thematic break and an ATX heading are each a single complete line, and a SETEXT heading's own underline line closes it exactly as definitively — nothing can lazily continue a heading once its underline has been read, so the setext spelling is only unsafe on the OTHER side, as something that ITSELF follows an open paragraph (see canInterruptOpenParagraph). False for QUOTE_STYLE_ID (renders through the same prefix-free renderParagraphBody as a plain paragraph here, so carries no boundary of its own) and for HTML_PREFORMATTED_STYLE_ID (this package re-emits raw HTML as a bare literal with no record of which CommonMark HTML-block start condition produced it, and several of those seven conditions close only at a blank line — with no closing condition of its own to fall back to, anything following without one keeps being read as more of the same literal HTML content) — neither needs its own explicit branch, since neither matches any of the four positive checks below either, so both already fall out to false on their own.
export function terminatesCleanly(styleId: string | undefined): boolean {
  return (
    styleId === CODE_BLOCK_STYLE_ID ||
    styleId === MATH_BLOCK_STYLE_ID ||
    styleId === HORIZONTAL_RULE_STYLE_ID ||
    (styleId !== undefined && parseHeadingStyleId(styleId) !== undefined)
  );
}

// Whether promoting a level<=2 heading's own rendered TEXT to setext would violate any of the three clauses CommonMark's own setext grammar packs into one sentence (spec 0.31.2, "Setext headings"): "one or more lines of text, not interrupted by a blank line, of which the first line does not have more than 3 spaces of indentation, followed by a setext heading underline. The lines of text must be such that, were they not followed by the setext heading underline, they would be interpreted as a paragraph: they cannot be interpretable as a code fence, ATX heading, block quote, thematic break, list item, or HTML block." This checks all three: no line in the run renderSetextHeading treats as one unit may be blank (see the blank-line half below); the run's own first content line may not open with 4 or more columns of indentation (leadingIndentColumns below, against CODE_INDENT_COLUMNS — src/block/line.ts's own indented-code-block threshold, so the write side's promotion decision and the read side's reparse agree on exactly the same boundary); and, the spec's own third clause, no line — including the first — may itself be interpretable as one of the six constructs the spec names, plus two of this package's own GFM/math extensions that behave the same way for a non-first line (interruptsSetextParagraph below, and tableDelimiterRowPromotesPrecedingLine for the table case specifically, which is a paragraph PROMOTION rather than a block start and so never applies to the first line, which has no preceding line of its own to promote). The first line is checked against the stricter, genuine BLOCK-START sense of that test (atBlockStart: true below), not the paragraph-continuation sense a non-first line gets: canInterruptOpenParagraph/requiresBlankLineBefore already guarantee a setext-rendered heading's own first line is never left lazily continuing a PRECEDING open block on reparse (a blank line is always forced ahead of it when that would otherwise happen), so it starts a fresh block exactly as a document's own first line would, with none of CommonMark's paragraph-interruption exceptions (HTML block condition 7, an ordered list not starting at 1, an empty list item) in play. An earlier version of this check skipped the first line entirely, reasoning that a first line matching one of these constructs would never have opened as a paragraph to begin with — true of an already-existing document being READ, but backwards for this WRITE-side decision about whether to promote freshly rendered content into a paragraph at all: a bold or strikethrough run emptied by a LEADING break (rather than a trailing one) renders its empty-emphasis shape as the heading's own first line, with real heading text only arriving after the break, and promoting it reads back as a single fenced code block or thematic break swallowing the heading, its underline, and every block that follows it — reproduced directly against this package's own reader, and strictly worse than the merge-base's own ATX-fallback output for the identical input. A first line indented 4+ columns reparses as an indented code block instead of heading text — with the heading's own remaining lines and underline then read back as a stray paragraph and a spurious "===="/"----" of their own — corrupting the heading exactly as an unsafe blank line does, just via a different CommonMark construct. The third clause's own hazard is REACHABLE from a real document, not merely a corpus edge case: a bold or strikethrough run that becomes empty immediately after a soft or hard break lowers to a bare pair of emphasis markers with nothing between them — "____"/"****" (a thematic break) or "~~~~" (a code-fence opener) — exactly the shape documents.js's own docx-to-markdown path produces for a Word run that becomes empty after a manual line break; left unchecked, that line's own construct-start reading destroys the heading on reparse (into a HorizontalRule/CodeBlock plus a stray paragraph) rather than merely losing fidelity the way an unpromoted ATX collapse would, which is why this is a genuine regression against the merge-base behaviour for the identical input, not just an inherited gap. CommonMark's own blank-line definition (spec 0.31.2, "Blank lines") is "a line containing no characters, or only spaces or tabs", not merely a zero-length one, so the blank-line check below splits the rendered text on CommonMark's own line-ending grammar (LINE_ENDING_PATTERN — LF, CRLF, or a lone CR, spec 0.31.2 "Lines"; a plain split on '\n' alone misses a classic-Mac-style lone-CR line ending the exact same way a literal-empty-line check misses a residual line of pure spaces or tabs) and tests every line the run of leading blank lines below does not already exempt against that same whitespace-only pattern. A TRAILING one (the run's own last line is blank) is the reachable, real-world case: an ordinary Word heading ending in a manual line break or page break lowers to a run whose literal '\n' escapeMarkdownText spells as a trailing '\\\n', and the identical hazard reappears whenever that trailing line is not fully empty but only whitespace — a single trailing space is a routine Word artefact on exactly this shape of heading. Reparsing sees the real text close early into its own plain paragraph at the blank line, with the underline surviving as a spurious "===="/"----" paragraph of its own (or, when the underline character is '-', an outright thematic break instead) — the heading itself is gone, not merely reformatted. An INTERIOR one (a blank or whitespace-only line sitting between two embedded breaks) fractures the heading into two blocks on reparse the same way, with only the LAST fragment keeping the heading-ness the underline actually attaches to and the first losing it outright; unlike the trailing case, this needs two breaks in a row to produce a genuinely empty interior line, since a single hard break's own escaping backslash sits at the END of the line the break TERMINATES, never on the line that follows it — it protects nothing about that following line's own content, so a hard break immediately followed by incidental whitespace-only text hits this exact hazard too. A LEADING RUN of blank lines is exempt from the blank-line check, but ONLY UP TO A SINGLE LINE (MAX_LEADING_BLANK_LINES_FOR_SETEXT below) — despite reading like the whole run should fall under the identical spec wording, one leading blank line sits BEFORE this run of lines even starts, so a reparse treats it as ordinary inter-block whitespace ahead of the heading, exactly as a blank line ahead of any other block already works, verified directly (this module's own test suite) across every context this renders through: top-level, inside a blockquote, and as a list item's own marker line — the heading always comes back intact, with its own list membership retained, in each. A SECOND consecutive leading blank line is NOT exempt, even though it is equally harmless at top level and inside a blockquote: CommonMark's own list-item grammar (spec 0.31.2, section 5.2 "List items") is "a list item can begin with at most one blank line" — a second one instead closes the item as empty right there, spilling the heading's own real text and underline out as unrelated top-level content that has LOST the list membership entirely (verified directly: this module's own test suite constructs exactly this two-blank-line shape inside a list item and confirms the pre-fix corruption). This function has no visibility into which of the three contexts its own caller is about to render through, so the tighter, list-item-driven bound of one line is applied universally rather than per-context — always safe (a second leading blank line falling through to the ATX-collapse path is merely a missed optimisation at top level or in a blockquote, never a correctness bug there), and it is what actually prevents the list-item corruption the unbounded original version had. escapeMarkdownText never emits a bare leading '\n' for a hard break in the first place (its own backslash always precedes the newline it escapes), so a heading beginning with an escaped hard break round-trips losslessly rather than merely safely, and its own non-blank backslash line 0 never enters the exempt leading line at all; a heading beginning with a bare soft-break newline instead relies on the leading-line exemption itself, refusing it would be a real regression (ATX cannot represent the break at all), but the exemption is NOT lossless for that spelling — the leading blank line is genuinely absorbed as ordinary space ahead of the heading on read-back rather than reproduced inside it (renderParagraphBody's own diagnostic message reflects this). The exemption has an outer bound the ORIGINAL index-0-only version missed entirely: if the leading blank line(s) consume every line with nothing genuinely non-blank left afterwards — the whole heading's own rendered text is blank, whether that is a single wholly-blank line or several — there is no heading content left for the underline to attach to at all, and promoting still corrupts the reparse exactly as a trailing or interior blank would.
//
// CommonMark's own blank-line definition (spec 0.31.2, "Blank lines"): a line containing no characters, or only spaces or tabs.
export const BLANK_OR_WHITESPACE_ONLY_LINE = /^[ \t]*$/;

// The index, in text's own CommonMark line-ending split, of the first line that is NOT blank — or -1 when every line is (including the single-line, wholly-blank case). Used by renderParagraphBody's own setext-promotion diagnostic (did a genuine, content-free leading line get silently absorbed rather than the break surviving as heading content?); unsafeSetextBreakReason below answers a related but distinct question (does the run this index starts contain a hazard?) with its own single forward pass, rather than re-deriving a line at this index, since a plain string[] index access cannot be narrowed away from `string | undefined` without either an assertion or a redundant re-scan.
export function firstContentLineIndex(text: string): number {
  return text
    .split(LINE_ENDING_PATTERN)
    .findIndex((line) => !BLANK_OR_WHITESPACE_ONLY_LINE.test(line));
}

// Whether a line's own leading run of spaces and tabs reaches CommonMark's own 4-column indented-code-block threshold (spec 0.31.2, "Tabs": "in contexts where spaces help to define block structure, tabs behave as if they were replaced by spaces with a tab stop of 4 characters", counted from the start of the LINE, not the whole document). Shares MARKDOWN_TAB_STOP_WIDTH with src/scan/scan.ts's own MarkdownScanCursor so a tab's width agrees with the read side's parse of the very text this function is predicting the reparse of. The sole caller below only ever asks a >= CODE_INDENT_COLUMNS boundary question, never the exact column count beyond it, so this returns that boundary directly. Once the leading run of plain spaces ends, only the SINGLE character right after it can still change the answer: a tab there is always itself sufficient to reach the threshold (CODE_INDENT_COLUMNS <= MARKDOWN_TAB_STOP_WIDTH means expanding a tab from any column short of the threshold already lands exactly on it), and anything else stops the leading run outright — so this needs no loop-exhausted fallback the way a step-by-step scan through every remaining character would: `line[column]` reads as `undefined` past the string's own end, which compares unequal to "\t" exactly as a real non-tab character would.
export function leadingIndentReachesCodeThreshold(line: string): boolean {
  let column = 0;
  // No separate `column < line.length` bound: `line[column]` running off the end reads as undefined, which compares unequal to " " exactly as a real non-space character does, so the leading run's own end is the only bound this needs.
  while (line[column] === " ") {
    column += 1;
  }
  if (column >= CODE_INDENT_COLUMNS) {
    return true;
  }
  return line[column] === "\t";
}

// CommonMark's own list-item grammar (spec 0.31.2, section 5.2 "List items"): "A list item can begin with at most one blank line." — the bound the leading-run exemption above is held to, applied universally regardless of which context (top-level, blockquote, list item) the heading being checked is actually about to render through, since this function cannot see that and the bound is harmless where it is not strictly required.
export const MAX_LEADING_BLANK_LINES_FOR_SETEXT = 1;

// Whether `line` would itself be read as one of CommonMark's block-start constructs, checked in whichever of the two senses the setext grammar's third clause needs (spec 0.31.2, "Setext headings", the clause immediately quoted on unsafeSetextBreakReason above): for a NON-FIRST line of a would-be setext heading's own text (`atBlockStart: false`), whether it can INTERRUPT the paragraph the earlier lines have already opened, rather than being lazily absorbed as more of the paragraph the underline is about to convert — CommonMark's own paragraph-interruption exceptions (HTML block condition 7, an ordered list not starting at 1, an empty list item) correctly leave a line matching only one of those absorbed as continuation text instead, confirmed directly against the reference implementation ("Foo\n    bar\n---" and "Foo\n<a>\n---" both still parse as one intact setext heading, indented/tag line included verbatim); for the run's own FIRST line (`atBlockStart: true`), whether it would be read as that construct at genuine BLOCK-START position instead, where none of those paragraph-interruption exceptions apply — see unsafeSetextBreakReason's own comment above for why the first line is never itself a paragraph-continuation position on reparse. Reuses the read side's own matchers rather than re-deriving the grammars locally — src/block/block.ts's ATX_MARKER_PATTERN/CODE_FENCE_PATTERN/THEMATIC_BREAK_PATTERN/MATH_BLOCK_MARKER_PATTERN, src/block/list.ts's parseListMarker, src/html/html.ts's matchHtmlBlockStart — against a throwaway LineCursor for this one line, so the write side's promotion refusal and the read side's actual reparse can never drift apart. Indented code (4+ columns) is excluded from both senses: absorbed as ordinary paragraph continuation mid-heading exactly as CommonMark's own paragraph-interruption exceptions require, and for the first line this package's own leading-indentation clause (unsafeSetextBreakReason's own dedicated check, against the same CODE_INDENT_COLUMNS threshold) has already answered that question before this function is ever consulted for it, so `cursor.indented` is always false on the one call this function gets for a first line. `matchHtmlBlockStart`'s own `interruptsParagraph` parameter and `parseListMarker`'s own `containerIsParagraph` parameter are exactly this atBlockStart/non-atBlockStart distinction, so each is passed the negation of `atBlockStart` directly rather than re-deriving the same split locally.
export function interruptsSetextParagraph(
  line: string,
  atBlockStart: boolean,
): boolean {
  const cursor = new LineCursor(line);
  if (cursor.indented) {
    return false;
  }
  if (cursor.peekNextNonspace() === ">") {
    return true;
  }
  const rest = cursor.restFromNextNonspace();
  if (
    ATX_MARKER_PATTERN.test(rest) ||
    CODE_FENCE_PATTERN.test(rest) ||
    THEMATIC_BREAK_PATTERN.test(rest) ||
    MATH_BLOCK_MARKER_PATTERN.test(rest) ||
    matchHtmlBlockStart(rest, !atBlockStart) !== undefined
  ) {
    return true;
  }
  // Last, since parseListMarker mutates the cursor it is given (advancing past the marker on a match) and nothing here reads `cursor` again afterwards.
  return parseListMarker(cursor, !atBlockStart) !== undefined;
}

// Whether `line` is a GFM table delimiter row that would PROMOTE `precedingLine` — the line immediately before it in a would-be setext heading's own text — into a table header, converting the open paragraph exactly as src/block/block.ts's own tryTableHeader does (github.github.com/gfm, "Tables (extension)"): the header row and the delimiter row must share the same number of cells, or no table is recognised at all and the delimiter row stays ordinary paragraph text (src/block/table.ts's own top-of-file note on why a bare `---` line can never itself be a delimiter row). Unlike interruptsSetextParagraph above, this is never checked for the run's own first line: a table delimiter row is a paragraph PROMOTION, not a block start (src/block/block.ts's own top-of-file note on the distinction) — it converts a line that came before it, and the first line has none.
export function tableDelimiterRowPromotesPrecedingLine(
  line: string,
  precedingLine: string,
): boolean {
  const cursor = new LineCursor(line);
  if (cursor.indented) {
    return false;
  }
  const alignments = parseTableDelimiterRow(cursor.restFromNextNonspace());
  return alignments?.length === splitTableRow(precedingLine).length;
}

// Which clause of the setext grammar (if any) a promotion would violate — undefined when promotion is safe. A single forward pass over text's own CommonMark line-ending split, rather than firstContentLineIndex above plus a slice/some pass: an indexed lookup back into the split for "the first content line's own text" is exactly the array access noUncheckedIndexedAccess cannot narrow to a definite string without an unjustified assertion, so this walks the lines once with a plain `for...of`, checking, the moment a non-blank line is reached, both the first-line-indentation clause and the interrupting-construct clause in its genuine-block-start sense (interruptsSetextParagraph below, atBlockStart: true), and on every line after it, the blank-line clause (now including the leading-run's own MAX_LEADING_BLANK_LINES_FOR_SETEXT bound), the interrupting-construct clause in its paragraph-continuation sense (interruptsSetextParagraph, atBlockStart: false), and the table-delimiter-row promotion clause (tableDelimiterRowPromotesPrecedingLine above) together.
type UnsafeSetextBreakReason =
  "leading-indentation" | "blank-line" | "interrupting-line" | undefined;

export function unsafeSetextBreakReason(text: string): UnsafeSetextBreakReason {
  let leadingBlankLines = 0;
  // The immediately preceding CONTENT line's own text, undefined until the run's first content line is reached and updated on every content line thereafter, so tableDelimiterRowPromotesPrecedingLine can check a delimiter row against the exact line it would promote, the same pairing src/block/block.ts's own tryTableHeader checks at reparse. Its own undefined-ness doubles as the "no content line seen yet" state, rather than a second flag moving in lockstep with it: a line can only be checked against a preceding content line once one actually exists, which is the very same condition.
  let precedingLine: string | undefined;
  for (const line of text.split(LINE_ENDING_PATTERN)) {
    const isBlank = BLANK_OR_WHITESPACE_ONLY_LINE.test(line);
    if (precedingLine === undefined) {
      if (isBlank) {
        leadingBlankLines += 1;
        if (leadingBlankLines > MAX_LEADING_BLANK_LINES_FOR_SETEXT) {
          // A second consecutive leading blank line closes a list item as empty (CommonMark spec 0.31.2, section 5.2), spilling this heading's own real text and underline out as separate content that has lost the item's own list membership entirely — unsafe universally, not just inside a list item, since this function has no visibility into which context it is actually about to render through.
          return "blank-line";
        }
        continue;
      }
      if (leadingIndentReachesCodeThreshold(line)) {
        return "leading-indentation";
      }
      if (interruptsSetextParagraph(line, true)) {
        return "interrupting-line";
      }
      precedingLine = line;
      continue;
    }
    if (isBlank) {
      return "blank-line";
    }
    if (
      interruptsSetextParagraph(line, false) ||
      tableDelimiterRowPromotesPrecedingLine(line, precedingLine)
    ) {
      return "interrupting-line";
    }
    precedingLine = line;
  }
  // Every line was blank — nothing survives as heading content for the underline to attach to, the same corruption a trailing blank line causes.
  return precedingLine === undefined ? "blank-line" : undefined;
}

export function embedsUnsafeBreakForSetext(text: string): boolean {
  return unsafeSetextBreakReason(text) !== undefined;
}

// The MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT message for whichever of the two ways this path is actually reached: a level<=2 heading whose own embedded break placement setext cannot survive (embedsLineBreak true — the break itself is the reason setext was even attempted), or — just as unsafe, but with no break anywhere in the text — an explicit headingStyle: 'setext' request against heading text that is already unsafe on its own (the first line, or any line after it, that itself starts an interrupting construct or a table-delimiter-row promotion; a first line indented 4+ columns; or wholly blank text with nothing for the underline to attach to); a break-free heading only ever reaches this function when headingStyle: 'setext' was requested outright, since willRenderAsSetext's own eligibility check requires either that option or an embedded break. unsafeSetextBreakReason's own "blank-line" result already covers both an interior/trailing break's own blank line AND a heading whose entire rendered text is blank (see that function's own comment), so the blank-line half of this message is phrased to cover either shape rather than presuming a break exists.
export function unsafeSetextDiagnosticMessage(
  level: number,
  reason: UnsafeSetextBreakReason,
  embedsLineBreak: boolean,
): string {
  const hazard =
    reason === "leading-indentation"
      ? `the line that would become the setext heading's own first line of text opens with 4 or more columns of space/tab indentation — setext's own grammar (spec 0.31.2) requires the first line to have "not more than 3 spaces of indentation", so promoting would read that line back as an indented code block instead of heading text`
      : reason === "interrupting-line"
        ? `a line of the heading's own text — including possibly its first — would itself be interpretable as a code fence, ATX heading, block quote, thematic break, list item, HTML block, math block, or GFM table delimiter row — setext's own grammar (spec 0.31.2) requires every one of the heading's lines to instead read as ordinary paragraph text, so promoting would read that line back as the start of a fresh, unrelated block (or, for a table delimiter row, a conversion of the line before it) rather than more of the heading`
        : `promoting would leave the setext underline with no heading text of its own to attach to — either a blank line immediately before it (a trailing break), a blank line in the middle of the heading's own text (a genuinely interior break), or the heading's own rendered text being entirely blank to begin with — setext's own grammar requires "one or more lines of text, not interrupted by a blank line"`;
  return embedsLineBreak
    ? `a level ${String(level)} heading's own content contains a line break, but ${hazard}; ATX collapses the break to a single space instead of promoting into a corrupt reparse`
    : `the effective WriteMarkdownOptions.headingStyle is 'setext' (an explicit caller choice — a break-free heading only reaches this path when requested outright), but ${hazard}; rendered as ATX instead of promoting into a corrupt reparse`;
}

// Whether a level<=2 heading paragraph will ACTUALLY be written as a setext heading rather than ATX — exactly mirroring renderParagraphBody's own promotion rule below (headingStyle: 'setext', OR the heading's own rendered text embeds a hard/soft break that ATX has no way to hold, AND EITHER WAY only when the resulting break placement is actually safe — see embedsUnsafeBreakForSetext above), so canInterruptOpenParagraph can answer against the real spelling the heading is about to be written in, not just the configured style. This deliberately calls emitRuns a SECOND time, through a throwaway, diagnostic-free InlineEmitContext: this is a look-ahead check on content renderParagraphBody itself re-emits (through the real sink) moments later at the actual render call, and reporting the same run-level diagnostic (a monospace-styled code span, adjacent merged links) twice for one piece of content would be a duplicate finding, not a second real one — emitRuns/renderNestedStyles read only InlineEmitContext's own two fields (sink, emphasisMarker) and mutate nothing on the wider EmitContext, so the two calls are independent and always agree on the text they produce. The blank-line safety check needs `text` even when headingStyle is explicitly 'setext', so unlike before, that branch no longer short-circuits ahead of computing it — an explicit caller preference for setext still cannot promote a heading whose own break placement would corrupt the reparse.
export function willRenderAsSetext(
  paragraph: ContentParagraph,
  level: number,
  context: EmitContext,
): boolean {
  if (level > MAX_SETEXT_LEVEL) {
    return false;
  }
  const text = emitRuns(
    paragraph.runs,
    {
      sink: NOOP_MARKDOWN_DIAGNOSTIC_SINK,
      emphasisMarker: context.emphasisMarker,
    },
    paragraph.constructs,
  );
  if (embedsUnsafeBreakForSetext(text)) {
    return false;
  }
  return context.headingStyle === "setext" || LINE_ENDING_PATTERN.test(text);
}

// Whether a rendered block of this paragraph's own styleId can safely open right where an OPEN (non-terminated) paragraph left off, per CommonMark's own "these constructs interrupt a paragraph" rules, rather than being read as more of that paragraph's own text. This is the "safe as NEXT" half, and — unlike terminatesCleanly — genuinely depends on the emit options actually in force: a fenced code block and a math block always interrupt (their own opening delimiter is unambiguous either way); a thematic break interrupts UNLESS its rendered character is SETEXT_LEVEL_2_CHAR ('-'), which a reparse reads as a setext level-2 underline for the paragraph it follows instead of a fresh thematic break (context.thematicBreakChar's other two legal values, '_' and '*', are never a setext underline character and interrupt cleanly); an ATX heading always interrupts, but one that will actually be WRITTEN as setext (willRenderAsSetext above — either headingStyle: 'setext', or a level<=2 heading whose own content embeds a break that forces the promotion regardless of the configured style) is the opposite of an interrupt — its own text line reads as more of the preceding paragraph, which the underline line then retroactively converts whole into the heading, exactly the case this function exists to catch. Keying this off the paragraph's actual embedded-break state, not merely the configured headingStyle, is load-bearing: a level 1/2 heading forced into setext by its own content is exactly as unsafe to follow an open paragraph with, unmarked, as one setext by explicit configuration — treating it as an always-interrupting ATX heading (the configured style alone) lets its own first line get silently absorbed as a continuation of whatever precedes it, with the setext underline then retroactively swallowing that preceding block into the heading on reparse. HTML_PREFORMATTED_STYLE_ID never interrupts: CommonMark's own HTML-block start condition 7 (a lone start/end tag on its own line) is explicitly barred from interrupting a paragraph, and this package cannot tell that condition apart from the other six that can, at the point this needs an answer, so it always assumes the unsafe one.
