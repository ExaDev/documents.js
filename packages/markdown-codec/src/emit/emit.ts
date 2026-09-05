// ContentDocument -> markdown text: writeMarkdown's own build-side half, the structural inverse of src/lower/lower.ts. Every mapping mirrors that module's own top-of-file table in reverse:
//
//  - "Heading{1..6}" styleId -> ATX heading, "#" repeated to the level, clamped through document-schema.js's own shared clampHeadingLevel (one heading-range clamp across the ecosystem instead of a private copy here) -- MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED when the level exceeds 6 (a markdown-produced document never carries one, but ContentDocument is a shared cross-format pivot; a paragraph from, say, odt's own unbounded readOutlineLevel can).
//  - 'CodeBlock'/'HorizontalRule'/'HTMLPreformatted' styleId -> a fenced code block / a thematic break / literal, unescaped text. A CodeBlock paragraph's own codeLanguage re-emits as the fence's info word, with any markdown-residue remainder (src/lower/lower.ts's splitInfoString) re-emitted verbatim after it -- one space between fence and info line, the spec's own canonical spacing, which also keeps an info word that begins with the fence character from fusing into the fence itself.
//  - a division construct pair whose wrapped paragraphs carry the quote indent (this package's own dual carry) -> one '> ' blockquote wrapper per nesting level, with the blocks' own indentLeftPt suppressed so the fact is counted once. A paragraph outside any division still recovers its quote depth from indentLeftPt alone: 'Quote' styleId, or ANY of the four styleIds below while indentLeftPt is also set, -> '> ' repeated per recovered nesting level (Math.round(indentLeftPt / QUOTE_INDENT_PT)) prefixed to every line -- the cross-format path for a document this package never produced. A paragraph with indentLeftPt set but none of these five styleIds is a genuine cross-format ambiguity this package cannot resolve (is it a quote, or just some other format's own paragraph indentation?) -- MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED; the indent is dropped, the paragraph still renders.
//  - ContentListMembership -> a bullet/ordered/task-list item, decoded from its own numId string (src/shared/list-id.ts) -- MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK for a numId this package never minted itself, or a depth-only membership carrying no numId at all (both fall back to a plain, tight, non-task bullet, per that module's own documented cross-format contract). A membership's own itemId groups every block sharing it back into one item's marker line plus continuation blocks (renderListRegion below), alternating with any nested sub-list content in between and with any construct (most commonly a blockquote's division pair) directly interrupting the item's own contiguous run -- ListRegionItem generalises renderListRegion/collectListItem's own input to that heterogeneous shape (plain blocks and constructs alike) precisely so a construct belonging to the running item, whether it directly shares that itemId or the item's own itemId simply resumes once the construct's extent ends (constructCarriesListItemId / itemIdResumesAfter below), stays nested inside it rather than fracturing out as separate top-level content.
//  - ContentTable -> a GFM table, src/emit/table.ts.
//  - ContentImageBlock -> a markdown image, src/emit/image.ts.
//  - ContentRun[] -> inline text, src/emit/inline.ts.
//
// ContentPageBreak and ContentEmbeddedObjectBlock have no markdown representation of any kind (this package's own src/lower never produces either, but ContentDocument is a shared pivot a caller can construct directly) -- both are silently dropped, contributing no output at all; this is not one of this package's own named mapping gaps (there was never a markdown construct to lose fidelity from), so it carries no diagnostic code.

import type {
  ConstructDescriptor,
  ContentBlock,
  ContentConstructEnd,
  ContentConstructStart,
  ContentDocument,
  ContentListMembership,
  ContentParagraph,
} from "document-schema.js";
import {
  clampHeadingLevel,
  findConstructMarkerImbalance,
  findRunConstructFault,
} from "document-schema.js";
import {
  MarkdownInvalidRunConstructExtentError,
  MarkdownUnbalancedConstructMarkersError,
  MarkdownUnsupportedDocumentKindError,
} from "../diagnostics/diagnostics";
import type { MarkdownDiagnosticSink } from "../diagnostics/diagnostics";
import {
  MarkdownDiagnosticCodes,
  NOOP_MARKDOWN_DIAGNOSTIC_SINK,
} from "../diagnostics/diagnostics";
import {
  DEFAULT_BULLET_LIST_MARKER,
  DEFAULT_CODE_FENCE_CHAR,
  DEFAULT_EMPHASIS_MARKER,
  DEFAULT_HEADING_STYLE,
  DEFAULT_LINE_ENDING,
  DEFAULT_ORDERED_LIST_DELIMITER,
  DEFAULT_THEMATIC_BREAK_CHAR,
} from "../defaults/defaults";
import { isValidFootnoteLabel } from "../inline/footnote";
import type {
  MarkdownHeadingStyle,
  WriteMarkdownOptions,
} from "../options/options";
import type { ListNumIdInfo } from "../shared/list-id";
import { parseListNumId } from "../shared/list-id";
import {
  CODE_BLOCK_STYLE_ID,
  HORIZONTAL_RULE_STYLE_ID,
  HTML_PREFORMATTED_STYLE_ID,
  MATH_BLOCK_STYLE_ID,
  QUOTE_INDENT_PT,
  QUOTE_STYLE_ID,
  TASK_CHECKBOX_CHECKED,
  TASK_CHECKBOX_UNCHECKED,
  parseHeadingStyleId,
} from "../shared/style-constants";
import { emitFrontMatter } from "./front-matter";
import { emitImage } from "./image";
import type { InlineEmitContext } from "./inline";
import {
  emitRuns,
  escapeLinkDestination,
  escapeMarkdownText,
  renderLinkTitle,
} from "./inline";
import type { TableEmitContext } from "./table";
import { emitTable } from "./table";

// Whether an image destination is itself an embedded-bytes spelling -- the one case where re-emitting the destination verbatim would re-embed the very bytes WriteMarkdownOptions.images: false asks to omit.
function isDataUri(destination: string): boolean {
  return destination.startsWith("data:");
}

interface EmitContext extends TableEmitContext {
  readonly bulletMarker: string;
  readonly orderedDelimiter: string;
  readonly codeFenceChar: string;
  readonly thematicBreakChar: string;
  readonly headingStyle: MarkdownHeadingStyle;
  readonly embedImages: boolean;
  readonly orderedCounters: Map<string, number>;
  readonly reportedFallbackNumIds: Set<string>;
  // One-shot latch for the no-numId-at-all fallback diagnostic -- reportedFallbackNumIds cannot key an absent numId without inventing a sentinel string, so this is a mutable flag where its sibling is a mutable-by-reference collection.
  reportedAbsentNumIdFallback: boolean;
  // How many blockquote-rendered division constructs currently enclose the block being rendered. Inside one, the '> ' prefixes come from the divisions themselves and a paragraph's own indentLeftPt is NOT also read back as quote depth -- the indent is the division's materialised formatting, counted once, not twice. Mutable for the same reason the counters are: it is render position, not configuration.
  divisionDepth: number;
  // The itemId of the list item whose own construct is CURRENTLY being rendered, when there is one -- set by listRegionItemBody around a construct absorbed into a list region, restored to whatever it was straight after. src/lower/lower.ts's lowerBlockquote threads the enclosing item's OWN membership straight through every paragraph a quote directly wraps (the same context-carrying dual carry the quote indent itself uses), so a paragraph inside the quote sharing this exact itemId is NOT a list item of its own -- it is ordinary prose that merely inherited the enclosing item's membership so renderItems' own region-collection scan could recognise the construct as belonging to that item in the first place (see constructCarriesListItemId). Rendering it as a fresh marker line would invent a bullet the source never had; renderItems checks this field to render such a paragraph as plain content instead. A GENUINE nested list directly inside the same quote (its own freshly-minted numId/itemId, independent of anything outside) never matches this field and renders with its own marker exactly as before.
  enclosingItemId: string | undefined;
}

// setext's own grammar (spec 0.31.2, "Setext headings") only distinguishes two levels (a run of '=' for level 1, of '-' for level 2) -- there is no setext spelling for level 3 and deeper, so headingStyle: 'setext' still falls back to ATX there.
const MAX_SETEXT_LEVEL = 2;
const SETEXT_LEVEL_1_CHAR = "=";
const SETEXT_LEVEL_2_CHAR = "-";
const MIN_SETEXT_UNDERLINE_LENGTH = 1;

function renderSetextHeading(level: number, text: string): string {
  const underlineChar = level === 1 ? SETEXT_LEVEL_1_CHAR : SETEXT_LEVEL_2_CHAR;
  // A setext underline's own length has no semantic meaning beyond "one or more" -- matching the heading text's own rendered length keeps the output visually tidy without claiming any significance for the exact count.
  const firstLine = text.split("\n")[0] ?? "";
  const underline = underlineChar.repeat(
    Math.max(MIN_SETEXT_UNDERLINE_LENGTH, firstLine.length),
  );
  return `${text}\n${underline}`;
}

// A fenced code block's own closing condition (spec 0.31.2, "Fenced code blocks") is "a code fence of the same type as the code block that opened it, of length AT LEAST as great as the opening fence" -- so a fence of exactly 3 characters closes prematurely the moment the code block's own literal content happens to contain a run of 3-or-more of that same character on its own line (a real, common case: this package always re-renders a code block as fenced regardless of whether it was originally fenced or indented, so an indented block whose own text happens to contain a backtick fence is exactly the scenario this guards). The fix real fenced-code-block writers already use: pick a fence one character longer than the longest run of the fence character anywhere in the content, so no line inside the block can ever be mistaken for the closing fence.
const MIN_CODE_FENCE_LENGTH = 3;

function longestRunLength(text: string, char: string): number {
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

function codeFenceFor(literal: string, fenceChar: string): string {
  return fenceChar.repeat(
    Math.max(MIN_CODE_FENCE_LENGTH, longestRunLength(literal, fenceChar) + 1),
  );
}

const QUOTABLE_STYLE_IDS: ReadonlySet<string> = new Set([
  QUOTE_STYLE_ID,
  CODE_BLOCK_STYLE_ID,
  HORIZONTAL_RULE_STYLE_ID,
  HTML_PREFORMATTED_STYLE_ID,
  MATH_BLOCK_STYLE_ID,
]);

function isQuotableStyle(styleId: string | undefined): boolean {
  if (styleId === undefined) {
    return false;
  }
  return (
    QUOTABLE_STYLE_IDS.has(styleId) ||
    parseHeadingStyleId(styleId) !== undefined
  );
}

// Whether a rendered block of this styleId closes itself unambiguously -- so a non-blank line immediately following it is always scanned by a reparse as a FRESH block rather than being absorbed backward into this one as ordinary continuation text. This is the "safe as PREVIOUS" half of requiresBlankLineBefore's compound check below, and unlike canInterruptOpenParagraph it does not depend on any emit option: a fenced code block and a math block each close at their own explicit closing delimiter, a thematic break and an ATX heading are each a single complete line, and a SETEXT heading's own underline line closes it exactly as definitively -- nothing can lazily continue a heading once its underline has been read, so the setext spelling is only unsafe on the OTHER side, as something that ITSELF follows an open paragraph (see canInterruptOpenParagraph). Deliberately false for QUOTE_STYLE_ID (renders through the same prefix-free renderParagraphBody as a plain paragraph here, so carries no boundary of its own) and for HTML_PREFORMATTED_STYLE_ID (this package re-emits raw HTML as a bare literal with no record of which CommonMark HTML-block start condition produced it, and several of those seven conditions close only at a blank line -- with no closing condition of its own to fall back to, anything following without one keeps being read as more of the same literal HTML content).
function terminatesCleanly(styleId: string | undefined): boolean {
  if (
    styleId === undefined ||
    styleId === QUOTE_STYLE_ID ||
    styleId === HTML_PREFORMATTED_STYLE_ID
  ) {
    return false;
  }
  return (
    styleId === CODE_BLOCK_STYLE_ID ||
    styleId === MATH_BLOCK_STYLE_ID ||
    styleId === HORIZONTAL_RULE_STYLE_ID ||
    parseHeadingStyleId(styleId) !== undefined
  );
}

// Whether a rendered block of this styleId can safely open right where an OPEN (non-terminated) paragraph left off, per CommonMark's own "these constructs interrupt a paragraph" rules, rather than being read as more of that paragraph's own text. This is the "safe as NEXT" half, and -- unlike terminatesCleanly -- genuinely depends on the emit options actually in force: a fenced code block and a math block always interrupt (their own opening delimiter is unambiguous either way); a thematic break interrupts UNLESS its rendered character is SETEXT_LEVEL_2_CHAR ('-'), which a reparse reads as a setext level-2 underline for the paragraph it follows instead of a fresh thematic break (context.thematicBreakChar's other two legal values, '_' and '*', are never a setext underline character and interrupt cleanly); an ATX heading always interrupts, but a SETEXT-rendered one (headingStyle 'setext', level <= MAX_SETEXT_LEVEL) is the opposite of an interrupt -- its own text line reads as more of the preceding paragraph, which the underline line then retroactively converts whole into the heading, exactly the case this function exists to catch. HTML_PREFORMATTED_STYLE_ID never interrupts: CommonMark's own HTML-block start condition 7 (a lone start/end tag on its own line) is explicitly barred from interrupting a paragraph, and this package cannot tell that condition apart from the other six that can, at the point this needs an answer, so it always assumes the unsafe one.
function canInterruptOpenParagraph(
  styleId: string | undefined,
  context: EmitContext,
): boolean {
  if (
    styleId === undefined ||
    styleId === QUOTE_STYLE_ID ||
    styleId === HTML_PREFORMATTED_STYLE_ID
  ) {
    return false;
  }
  if (styleId === CODE_BLOCK_STYLE_ID || styleId === MATH_BLOCK_STYLE_ID) {
    return true;
  }
  if (styleId === HORIZONTAL_RULE_STYLE_ID) {
    return context.thematicBreakChar !== SETEXT_LEVEL_2_CHAR;
  }
  const headingLevel = parseHeadingStyleId(styleId);
  if (headingLevel !== undefined) {
    return !(
      context.headingStyle === "setext" && headingLevel <= MAX_SETEXT_LEVEL
    );
  }
  return false;
}

function quoteDepthOf(paragraph: ContentParagraph): number {
  if (paragraph.indentLeftPt === undefined || paragraph.indentLeftPt <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(paragraph.indentLeftPt / QUOTE_INDENT_PT));
}

// One paragraph's OWN construct-specific rendering -- heading/code-block/rule/preformatted-HTML/plain -- with no blockquote or list-marker wrapping applied yet (renderParagraph below layers those on afterwards, uniformly, regardless of which of these five shapes produced the body).
function renderParagraphBody(
  paragraph: ContentParagraph,
  context: EmitContext,
): string {
  if (paragraph.styleId === HORIZONTAL_RULE_STYLE_ID) {
    return context.thematicBreakChar.repeat(3);
  }
  if (paragraph.styleId === CODE_BLOCK_STYLE_ID) {
    const literal = paragraph.runs.map((run) => run.text).join("");
    const fence = codeFenceFor(literal, context.codeFenceChar);
    // The inverse of src/lower/lower.ts's splitInfoString: the language word and the quarantined remainder rejoin as the fence's info line, one space between them. Both halves re-emit verbatim -- the language is a source-format identifier, not something to re-spell, and the remainder is this package's own markdown residue, which a same-format writer re-emits as-is (the residue channel's restorable tier).
    const remainder =
      paragraph.source?.format === "markdown"
        ? paragraph.source.xml
        : undefined;
    const info = [paragraph.codeLanguage, remainder]
      .filter((part) => part !== undefined && part.length > 0)
      .join(" ");
    const opening = info.length > 0 ? `${fence} ${info}` : fence;
    // An empty code block ("```\n```\n", zero content lines) must not gain a spurious blank content line here -- the middle `\n${literal}\n` template below would otherwise insert one, which a reparse reads back as ONE literal blank line of content rather than none at all.
    return literal.length === 0
      ? `${opening}\n${fence}`
      : `${opening}\n${literal}\n${fence}`;
  }
  if (paragraph.styleId === HTML_PREFORMATTED_STYLE_ID) {
    // The quarantined original wins when present (src/lower/lower.ts's rawHtml carry): the runs hold the block-separator-trimmed literal, the residue the verbatim source, and a same-format writer re-emits its own residue as-is.
    return paragraph.source?.format === "markdown"
      ? paragraph.source.xml
      : paragraph.runs.map((run) => run.text).join("");
  }
  if (paragraph.styleId === MATH_BLOCK_STYLE_ID) {
    // A fresh $$ pair regenerated around the preserved literal -- src/lower/lower.ts's own lowerMathBlock never kept the original delimiter lines either, exactly mirroring how a fenced code block regenerates its own fence (codeFenceFor) rather than preserving the source fence's exact character/length.
    const literal = paragraph.runs.map((run) => run.text).join("");
    return `$$\n${literal}\n$$`;
  }
  const headingLevel =
    paragraph.styleId === undefined
      ? undefined
      : parseHeadingStyleId(paragraph.styleId);
  if (headingLevel !== undefined) {
    const level = clampHeadingLevel(headingLevel);
    if (level !== headingLevel) {
      context.sink({
        code: MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED,
        severity: "info",
        message: `heading level ${String(headingLevel)} exceeds ATX's own six-"#" ceiling and is clamped to ${String(level)}`,
      });
    }
    const text = emitRuns(paragraph.runs, context, paragraph.constructs);
    if (context.headingStyle === "setext" && level <= MAX_SETEXT_LEVEL) {
      return renderSetextHeading(level, text);
    }
    return `${"#".repeat(level)} ${text}`;
  }
  return emitRuns(paragraph.runs, context, paragraph.constructs);
}

// Applies blockquote wrapping ('> ' repeated per recovered nesting level, on every line of the body) on top of renderParagraphBody's own construct-specific rendering -- see this module's own top-of-file note for exactly which styleIds this applies to, and MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED for the ones it does not. A paragraph already inside a blockquote-rendered division construct does NOT re-enter here: the division's own rendering prefixes '> ' per level, and reading the indent back as depth on top of that would double-count the same fact.
function renderParagraph(
  paragraph: ContentParagraph,
  context: EmitContext,
): string {
  const body = renderParagraphBody(paragraph, context);
  const depth = context.divisionDepth > 0 ? 0 : quoteDepthOf(paragraph);
  if (depth === 0) {
    return body;
  }
  if (!isQuotableStyle(paragraph.styleId)) {
    context.sink({
      code: MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED,
      severity: "info",
      message: `paragraph carries indentLeftPt (${String(paragraph.indentLeftPt)}pt) with no styleId this package recognises as quotable; the indent has no other markdown representation and is dropped`,
    });
    return body;
  }
  const prefix = "> ".repeat(depth);
  return body
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

// Every ContentBlock kind that renders as content in its own right -- the whole union MINUS the two construct boundary markers, which are structure rather than content and are consumed by groupConstructItems below before any block reaches here. Spelled as a type rather than as two unreachable switch arms so the compiler, not a comment, is what guarantees a marker never arrives.
type RenderableBlock = Exclude<
  ContentBlock,
  ContentConstructStart | ContentConstructEnd
>;

function renderTopLevelBlock(
  block: RenderableBlock,
  context: EmitContext,
): string {
  switch (block.kind) {
    case "paragraph":
      return renderParagraph(block, context);
    case "table":
      return emitTable(block, context);
    case "image":
      return emitImage(block, context.embedImages);
    case "embeddedObject":
      // The inverse of src/lower/lower.ts's lowerMathBlock: an embedded FORMULA whose presentation layer carries LaTeX re-renders as a fresh $$ pair around that verbatim string (an empty LaTeX spelling an empty block, matching how the old MathBlock paragraph emitted one). Any other embedded object -- another document kind, or a formula with no presentation LaTeX (an ODF equation carrying only MathML) -- has no markdown spelling at all and is silently dropped, as it always was: this package never had a construct to lose fidelity from there.
      if (
        block.objectKind === "formula" &&
        block.document.kind === "formula" &&
        block.document.formula.presentation !== undefined
      ) {
        const latex = block.document.formula.presentation.latex;
        return latex.length === 0 ? "$$\n$$" : `$$\n${latex}\n$$`;
      }
      return "";
    case "pageBreak":
      return "";
  }
}

// --- List rendering: every ContentParagraph carrying .list is its own list item (see src/lower/lower.ts's own top-of-file note on why ContentListMembership cannot distinguish a continuation paragraph from a fresh sibling item -- this package resolves that ambiguity the same way on both sides, consistently). A construct (most commonly a blockquote's division pair) sitting directly inside an item shares that item's own membership on its own wrapped paragraphs -- src/lower/lower.ts's lowerBlockquote threads the enclosing BlockLowerContext.list straight through a quote's own children -- so ListRegionItem below generalises every function in this section from plain ContentParagraph blocks to that heterogeneous shape (a plain list-tagged paragraph, or a construct carrying one), letting a construct stay nested inside the item it interrupts rather than fracturing it into separate top-level content (renderItems' own region-collection scan is where that heterogeneous run is actually assembled, via constructCarriesListItemId below). ---

// numId undefined is a depth-only ContentListMembership -- document-schema.js 3.3.0+ makes numId optional for sources that carry a level but no numbering identity of their own (OOXML drawing paragraphs' a:pPr/@lvl being the motivating case) -- and it lands in the same documented cross-format fallback as a foreign numId string: with no marker type, task-ness, or loose-ness to recover, the item renders as an ordinary, tight, non-task bullet at its own level.
function listInfoFor(
  numId: string | undefined,
  context: EmitContext,
): ListNumIdInfo | undefined {
  if (numId === undefined) {
    if (!context.reportedAbsentNumIdFallback) {
      context.reportedAbsentNumIdFallback = true;
      context.sink({
        code: MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
        severity: "info",
        message:
          "a list membership with no numId of its own (a depth-only ContentListMembership) has no marker type, task-ness, or loose-ness to recover and falls back to an ordinary, tight, non-task bullet list",
      });
    }
    return undefined;
  }
  const info = parseListNumId(numId);
  if (info === undefined && !context.reportedFallbackNumIds.has(numId)) {
    context.reportedFallbackNumIds.add(numId);
    context.sink({
      code: MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
      severity: "info",
      message: `numId "${numId}" was not minted by this package's own src/lower and falls back to an ordinary, tight, non-task bullet list`,
    });
  }
  return info;
}

// Strips the leading checkbox glyph run the pre-field lowering prepended, so renderParagraphBody does not ALSO print the raw glyph character in the item's own body text -- the marker rendered by renderListItemMarker below carries the equivalent `[x]`/`[ ]` text instead. Reached only for the legacy glyph spelling; the membership-field spelling has no glyph run to strip.
function stripCheckboxRun(item: ContentParagraph): ContentParagraph {
  const first = item.runs[0];
  const checked = first?.text.startsWith(`${TASK_CHECKBOX_CHECKED} `);
  const glyphPrefix = checked
    ? `${TASK_CHECKBOX_CHECKED} `
    : `${TASK_CHECKBOX_UNCHECKED} `;
  if (!first?.text.startsWith(glyphPrefix)) {
    return item;
  }
  const strippedText = first.text.slice(glyphPrefix.length);
  const runs =
    strippedText.length === 0
      ? item.runs.slice(1)
      : [{ ...first, text: strippedText }, ...item.runs.slice(1)];
  return { ...item, runs };
}

// One item of a list region once its own list identity is known: either a plain list-tagged paragraph, or a construct (a division, almost always) directly interrupting the item -- see the region-collection scan in renderItems for how a construct's own membership is resolved (always inherited from the paragraph it interrupts, via constructCarriesListItemId, never independently re-derived from the construct's own subtree). `list` is carried directly on every variant rather than re-read from `block`/`item` on each access, since a construct has no membership of its own to re-read in the first place.
type ListRegionItem =
  | {
      readonly kind: "paragraph";
      readonly block: ContentParagraph;
      readonly list: ContentListMembership;
    }
  | {
      readonly kind: "construct";
      readonly item: ConstructItem;
      readonly list: ContentListMembership;
    };

// Recovers the plain EmitItem shape underneath a ListRegionItem, for the two helpers below (emitItemCanInterrupt/lastStyleIdOf) that already know how to recurse through a construct's own children and have no need for the list identity ListRegionItem adds on top.
function toEmitItem(item: ListRegionItem): EmitItem {
  return item.kind === "paragraph" ? { block: item.block } : item.item;
}

// One item's first-block preparation: the checkbox text its marker line carries, and whether that block's own leading run is a legacy checkbox glyph that must be stripped from the body. The membership's own checked field is the current spelling and needs no task-flagged numId behind it; the glyph sniff is gated on the numId's task flag AND on the first block actually being a paragraph (a construct has no runs of its own to sniff a glyph from), so an ordinary item whose text happens to begin with a ballot-box glyph is never misread as a checkbox.
interface FirstBlockCheckbox {
  readonly checkboxText: string;
  readonly stripGlyph: boolean;
}

function firstBlockCheckbox(
  first: ListRegionItem,
  taskNumId: boolean,
): FirstBlockCheckbox {
  if (first.list.checked !== undefined) {
    return {
      checkboxText: first.list.checked ? "[x] " : "[ ] ",
      stripGlyph: false,
    };
  }
  if (!taskNumId || first.kind !== "paragraph") {
    return { checkboxText: "", stripGlyph: false };
  }
  const leading = first.block.runs[0]?.text ?? "";
  if (leading.startsWith(`${TASK_CHECKBOX_CHECKED} `)) {
    return { checkboxText: "[x] ", stripGlyph: true };
  }
  if (leading.startsWith(`${TASK_CHECKBOX_UNCHECKED} `)) {
    return { checkboxText: "[ ] ", stripGlyph: true };
  }
  return { checkboxText: "", stripGlyph: false };
}

interface RenderedListMarker {
  // The visible marker text prepended to the item's own first line -- bullet/ordinal glyph AND, for a task item, its checkbox text.
  readonly full: string;
  // The bullet/ordinal glyph's own width alone (glyph + one space), EXCLUDING any checkbox text -- what CommonMark's own list-item continuation rule actually measures (spec 0.31.2, "List items": the marker plus its own padding, not whatever content happens to follow on the first line). Using `full.length` for a nested list's own indent would over-indent it past what a real reparse recognises as still belonging to this item, since a task item's checkbox glyph is ordinary FIRST-LINE CONTENT, not part of the marker.
  readonly bareLength: number;
}

function renderListItemMarker(
  numId: string | undefined,
  info: ListNumIdInfo | undefined,
  checkboxText: string,
  context: EmitContext,
): RenderedListMarker {
  // Only a parsed numId string can carry type 'ordered', so the ordered-counter key is present exactly when this branch is live.
  if (info?.type === "ordered" && numId !== undefined) {
    const next = context.orderedCounters.get(numId) ?? info.start ?? 1;
    context.orderedCounters.set(numId, next + 1);
    const bare = `${String(next)}${context.orderedDelimiter} `;
    return { full: `${bare}${checkboxText}`, bareLength: bare.length };
  }
  const bare = `${context.bulletMarker} `;
  return { full: `${bare}${checkboxText}`, bareLength: bare.length };
}

interface ListItemPart {
  // undefined = a depth-only membership with no numId of its own; consecutive such parts share that absence as their list identity, rendering as one tight bullet list.
  readonly numId: string | undefined;
  readonly text: string;
}

// One item's own contiguous run of same-level, same-itemId blocks (kind 'own') -- a plain paragraph, or a construct renderItems' own region-collection scan already verified shares this exact itemId -- or the deeper-level blocks of a nested sub-list sitting between two such runs (kind 'nested') -- see collectListItem below for why an item can carry more than one 'own' run.
interface ItemOwnSegment {
  readonly kind: "own";
  readonly blocks: readonly ListRegionItem[];
}
interface ItemNestedSegment {
  readonly kind: "nested";
  readonly blocks: readonly ListRegionItem[];
}
type ItemSegment = ItemOwnSegment | ItemNestedSegment;

// The contiguous run, starting at `from`, of items sharing this exact level and itemId. collectListItem's own leading call is the ONLY call site where `items[from]` is guaranteed to already match (it reads level/itemId from items[from] itself before calling), so there the result is always at least `from + 1`; the resume call inside its loop has no such guarantee -- `from` sits right after a nested sub-list run, and the next item there may belong to a different item, a different level, or not exist at all -- so a result equal to `from` (no match at all) is a real, expected outcome that caller explicitly checks for rather than something this function rules out.
function consumeSameItemRun(
  items: readonly ListRegionItem[],
  from: number,
  level: number,
  itemId: string,
): number {
  let end = from;
  while (end < items.length) {
    const candidate = items[end];
    if (candidate?.list.level !== level || candidate.list.itemId !== itemId) {
      break;
    }
    end += 1;
  }
  return end;
}

// Collects one list item's FULL run starting at `start`: its own leading same-level/same-itemId run (plain blocks and any directly-interrupting construct alike), then any nested (deeper-level) sub-list content, then -- when the item's own blocks resume immediately after that nested content, sharing the same itemId -- another own-level run, alternating for as long as the pattern repeats. This is the write-side shape CommonMark spec 0.31.2 example 325 names directly ("* foo\n  * bar\n\n  baz"): a nested sub-list can sit in the MIDDLE of one item's own blocks, not only after all of them, and only itemId (never numId+level alone) can tell that "baz" belongs to the same item as "foo" rather than starting a new sibling. A membership with no itemId at all never resumes: its own segment is always exactly the one item at `start`, exactly as this writer always treated a cross-format item.
function collectListItem(
  items: readonly ListRegionItem[],
  start: number,
  level: number,
  itemId: string | undefined,
): { readonly segments: readonly ItemSegment[]; readonly next: number } {
  const segments: ItemSegment[] = [];
  let index = start;

  const ownEnd =
    itemId === undefined
      ? index + 1
      : consumeSameItemRun(items, index, level, itemId);
  segments.push({ kind: "own", blocks: items.slice(index, ownEnd) });
  index = ownEnd;

  for (;;) {
    let nestedEnd = index;
    while (nestedEnd < items.length) {
      const candidateLevel = items[nestedEnd]?.list.level;
      if (candidateLevel === undefined || candidateLevel <= level) {
        break;
      }
      nestedEnd += 1;
    }
    if (nestedEnd === index) {
      break;
    }
    segments.push({ kind: "nested", blocks: items.slice(index, nestedEnd) });
    index = nestedEnd;

    if (itemId === undefined) {
      break;
    }
    const resumedEnd = consumeSameItemRun(items, index, level, itemId);
    if (resumedEnd === index) {
      break;
    }
    segments.push({ kind: "own", blocks: items.slice(index, resumedEnd) });
    index = resumedEnd;
  }

  return { segments, next: index };
}

// Whether an EmitItem's own rendered spelling unconditionally interrupts an open paragraph when it immediately follows one, with no blank line between them -- generalises canInterruptOpenParagraph (styleId-keyed, paragraph-only) to a construct too. A materialised division's '> ' marker interrupts regardless of what it wraps (CommonMark spec 0.31.2's own list of blocks that can interrupt a paragraph includes block quotes -- confirmed directly by spec example 245, "foo\n> bar\n", where "> bar" opens a fresh blockquote with no blank line needed). A construct rendering TRANSPARENTLY (no marker of its own to interrupt with -- see isMaterialisedDivision) is not itself a boundary at all, so the question passes straight through, recursively, to its own first child.
function emitItemCanInterrupt(item: EmitItem, context: EmitContext): boolean {
  if (!isConstructItem(item)) {
    return item.block.kind === "paragraph"
      ? canInterruptOpenParagraph(item.block.styleId, context)
      : true;
  }
  if (isMaterialisedDivision(item)) {
    return true;
  }
  const first = item.children[0];
  return first === undefined ? true : emitItemCanInterrupt(first, context);
}

// The styleId of the last paragraph an EmitItem's own rendering actually ends on, looking straight through any construct wrapper (marked or transparent) to find it. A construct's own '> ' marker (or the lack of one) changes whether IT interrupts whatever follows (emitItemCanInterrupt above), but not whether what it wraps leaves an open paragraph behind for CommonMark's own lazy-continuation rule to absorb a following unmarked line into -- that risk is a property of the innermost content alone, at any nesting depth, since laziness itself cascades through nested containers unchanged. Feeding this straight into the existing terminatesCleanly/requiresBlankLineBefore therefore needs no change to either for a construct to be handled exactly as safely, or unsafely, as a bare paragraph already was.
function lastStyleIdOf(item: EmitItem): string | undefined {
  if (isConstructItem(item)) {
    const last = item.children[item.children.length - 1];
    return last === undefined ? undefined : lastStyleIdOf(last);
  }
  return item.block.kind === "paragraph" ? item.block.styleId : undefined;
}

function regionItemCanInterrupt(
  item: ListRegionItem,
  context: EmitContext,
): boolean {
  return emitItemCanInterrupt(toEmitItem(item), context);
}

function lastStyleIdOfRegionItem(item: ListRegionItem): string | undefined {
  return lastStyleIdOf(toEmitItem(item));
}

// One list-region item's own rendered body, with no marker/indent applied yet. A plain paragraph renders through renderParagraphBody exactly as before (optionally with its checkbox glyph stripped); a construct renders through renderConstruct -- the SAME function renderItems reaches for a construct that is NOT part of any list region, so a construct's own markdown spelling never diverges depending on whether it happens to sit inside a list item, EXCEPT for context.enclosingItemId, set here for the duration of that one call: it is what lets renderItems' own recursive walk over the construct's children tell inherited pass-through membership (this exact item, see EmitContext's own field comment) apart from a genuinely fresh nested list.
function listRegionItemBody(
  item: ListRegionItem,
  context: EmitContext,
  stripGlyph: boolean,
): string {
  if (item.kind === "paragraph") {
    return renderParagraphBody(
      stripGlyph ? stripCheckboxRun(item.block) : item.block,
      context,
    );
  }
  const previousEnclosingItemId = context.enclosingItemId;
  context.enclosingItemId = item.list.itemId;
  const body = renderConstruct(item.item, context);
  context.enclosingItemId = previousEnclosingItemId;
  return body;
}

// Whether a list-region item immediately following `previousStyleId`, with no blank line between them, risks CommonMark's own lazy-continuation rule silently absorbing it into the PRECEDING block instead of starting a fresh one. HTML_PREFORMATTED_STYLE_ID as `previousStyleId` is checked unconditionally, first, regardless of `next`: an open HTML block (CommonMark start conditions 1-7) is not a paragraph at all, and regionItemCanInterrupt answers a different question -- "does this item interrupt an open PARAGRAPH" -- that has no bearing on what interrupts an open HTML block, which several of those seven conditions close only at a blank line (and, per terminatesCleanly's own note, this package cannot tell which of the seven conditions it produced, so it always assumes the least permissive). Past that, "can this ever go wrong" and "is this item itself safe to follow with" are different properties (see terminatesCleanly and regionItemCanInterrupt above), and a blank line is required only when BOTH answers are unfavourable: terminatesCleanly(previousStyleId) means there is no open paragraph left for anything to absorb into, regardless of what `next` is; regionItemCanInterrupt(next, context) means `next` starts fresh unconditionally when `previousStyleId` IS an open paragraph (never an open HTML block, handled above) -- true unconditionally for a materialised construct (a '>' marker always interrupts), and deferring to canInterruptOpenParagraph for a plain paragraph exactly as before. `previousStyleId` for an item immediately following a nested sub-list, or a construct, is that run's own LAST rendered paragraph's styleId found by looking straight through it (lastStyleIdOfRegionItem) rather than treating "just finished a nested list" or "just finished a construct" as blanket-safe -- a plain paragraph ending either is exactly as open as any other, and a following line at the outer item's own continuation indent is CommonMark's own lazy continuation of THAT paragraph, not something the outer item's markers (or the construct's own marker) make safe (spec 0.31.2 example 325 is this exact shape for a nested sub-list, and is why it requires the blank line it has). Two blocks that are BOTH plain (or one/both Quote-styled) are genuinely ambiguous without a blank line: for two plain paragraphs specifically, src/lower/lower.ts's own reader can only ever produce that pair when a real source blank line separated them in the first place (two adjacent non-blank plain-text lines are read as ONE multi-line paragraph, never two), so re-inserting the blank line here is not merely safe, it is what the source actually had.
function requiresBlankLineBefore(
  next: ListRegionItem,
  previousStyleId: string | undefined,
  context: EmitContext,
): boolean {
  if (previousStyleId === HTML_PREFORMATTED_STYLE_ID) {
    return true;
  }
  return (
    !terminatesCleanly(previousStyleId) &&
    !regionItemCanInterrupt(next, context)
  );
}

// Renders one contiguous, flat run of list-region items -- plain .list-carrying paragraphs, and any construct directly interrupting one of them -- possibly spanning several sibling top-level lists back to back, and arbitrarily nested sub-lists (an item whose own level is deeper than its predecessor's is that predecessor's own nested list content, recursed into here via collectListItem's 'nested' segments). One ITEM is every block sharing one itemId -- the write-side inverse of src/lower/lower.ts's minted item identity -- so a multi-block item renders one marker line with every later block of its own continued on the continuation indent, any nested sub-list content indented in place between them, and any interrupting construct rendered (and indented) exactly where it falls in that same run. A membership with no itemId at all is the cross-format shape: each paragraph is its own item, exactly as this writer always treated them. Spacing between two items of the SAME item run is a blank line whenever requiresBlankLineBefore says one is structurally required (see that function), and OTHERWISE only when the item's own numId was minted loose (info.loose) -- never unconditionally: forcing a blank line onto every continuation would silently turn a tight list loose on the way out (spec 0.31.2 example 300's own regression, a heading directly followed by a plain paragraph with no blank line between them in a tight list). Loose/tight spacing between two SIBLING items sharing the same numId is read from that same numId's own `loose` flag; a boundary between two DIFFERENT numIds always gets a blank line, matching how two genuinely separate lists always render with visual separation.
function renderListRegion(
  items: readonly ListRegionItem[],
  context: EmitContext,
): string {
  const parts: ListItemPart[] = [];
  let index = 0;
  while (index < items.length) {
    const item = items[index];
    if (item === undefined) {
      break;
    }
    const { numId, level, itemId } = item.list;
    const info = listInfoFor(numId, context);
    const loose = info?.loose === true;

    const { segments, next } = collectListItem(items, index, level, itemId);
    const first = segments[0]?.blocks[0];
    if (first === undefined) {
      break;
    }
    const { checkboxText, stripGlyph } = firstBlockCheckbox(
      first,
      info?.task === true,
    );
    const marker = renderListItemMarker(numId, info, checkboxText, context);
    const indent = " ".repeat(marker.bareLength);

    let text = "";
    let renderedFirstLine = false;
    let previousStyleId: string | undefined;
    for (const segment of segments) {
      if (segment.kind === "nested") {
        const nested = renderListRegion(segment.blocks, context)
          .split("\n")
          .map((line) => (line.length === 0 ? line : `${indent}${line}`))
          .join("\n");
        text += `\n${nested}`;
        // segment.blocks is the flat, in-order slice of every deeper-level item this nested run rendered, regardless of how many further nesting levels it recursed through -- rendering always processes that slice front to back, so its LAST element is exactly the last content this nested call above actually produced. Looking straight through it to the real last styleId (lastStyleIdOfRegionItem), not blanket "just finished a nested list, always safe", is what requiresBlankLineBefore needs next.
        const lastNested = segment.blocks[segment.blocks.length - 1];
        previousStyleId =
          lastNested === undefined
            ? undefined
            : lastStyleIdOfRegionItem(lastNested);
        continue;
      }
      for (const block of segment.blocks) {
        if (!renderedFirstLine) {
          const bodyLines = listRegionItemBody(
            block,
            context,
            stripGlyph,
          ).split("\n");
          const [firstLine = "", ...restLines] = bodyLines;
          text = [
            `${marker.full}${firstLine}`,
            ...restLines.map((line) => `${indent}${line}`),
          ].join("\n");
          renderedFirstLine = true;
          previousStyleId = lastStyleIdOfRegionItem(block);
          continue;
        }
        const rendered = listRegionItemBody(block, context, false)
          .split("\n")
          .map((line) => (line.length === 0 ? line : `${indent}${line}`))
          .join("\n");
        const blank =
          loose || requiresBlankLineBefore(block, previousStyleId, context);
        text += blank ? `\n\n${rendered}` : `\n${rendered}`;
        previousStyleId = lastStyleIdOfRegionItem(block);
      }
    }

    parts.push({ numId, text });
    index = next;
  }

  let out = "";
  for (const [partIndex, part] of parts.entries()) {
    if (partIndex > 0) {
      const previous = parts[partIndex - 1]!;
      const sameList = previous.numId === part.numId;
      const loose =
        sameList &&
        previous.numId !== undefined &&
        (parseListNumId(previous.numId)?.loose ?? false);
      out += sameList && !loose ? "\n" : "\n\n";
    }
    out += part.text;
  }
  return out;
}

// --- Construct boundary markers (document-schema.js 4.2.0): the flat form encodes a construct as a MATCHED PAIR of markers bracketing the blocks it spans, so the writer's first job over any block list is to recover that bracketing as a tree before rendering anything. ---

// One item of a block list once the markers have been resolved: either an ordinary content block, or a construct with its own extent recovered as children (which may themselves contain further constructs, at any nesting depth).
type EmitItem = { readonly block: RenderableBlock } | ConstructItem;

interface ConstructItem {
  readonly descriptor: ConstructDescriptor;
  readonly children: readonly EmitItem[];
}

function isConstructItem(item: EmitItem): item is ConstructItem {
  return "descriptor" in item;
}

// Whether a construct's own rendered spelling opens with a self-delimiting marker on every line ('> ' for a division, per renderConstruct below) rather than rendering transparently as its own children's content with nothing distinguishing it -- see renderConstruct's own comment for why the blockquote spelling is gated on the wrapped paragraphs' own indentLeftPt dual carry rather than on descriptor.kind alone (a division whose paragraphs carry no such indent is a FOREIGN one, and renders transparently). This same test doubles as the write-side "does this construct's own marker unconditionally interrupt an open paragraph" signal renderListRegion below needs (a materialised division's '> ' does, per CommonMark spec 0.31.2's own list of blocks that can interrupt a paragraph; a transparent construct instead defers to whatever its own first child renders as).
function isMaterialisedDivision(item: ConstructItem): boolean {
  return (
    item.descriptor.kind === "division" &&
    item.children.every((child) => {
      if (isConstructItem(child)) {
        return true;
      }
      return (
        child.block.kind !== "paragraph" ||
        (child.block.indentLeftPt !== undefined &&
          child.block.indentLeftPt >= QUOTE_INDENT_PT)
      );
    })
  );
}

// Bracket matching, per document-schema.js's own contract: a constructEnd closes the nearest preceding still-open constructStart in the SAME block list, and the blocks between them are that construct's extent. emitMarkdown validates the whole list's balance up front (findConstructMarkerImbalance -- the one shared definition of that check, which this writer, every sibling codec, and documents.js's decompose all have to agree on exactly), so by the time this runs a closing marker for every open one is known to exist.
function groupConstructItems(
  blocks: readonly ContentBlock[],
  start: number,
): { readonly items: EmitItem[]; readonly next: number } {
  const items: EmitItem[] = [];
  let index = start;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block === undefined) {
      break;
    }
    index += 1;
    if (block.kind === "constructEnd") {
      return { items, next: index };
    }
    if (block.kind === "constructStart") {
      const nested = groupConstructItems(blocks, index);
      items.push({ descriptor: block.descriptor, children: nested.items });
      index = nested.next;
      continue;
    }
    items.push({ block });
  }
  return { items, next: index };
}

// Columns of indentation a footnote definition's own continuation lines carry -- the same four src/block/block.ts's continueFootnoteDefinition strips back off, and the same four Pandoc and GitHub both write. Deliberately NOT the rendered `[^label]: ` marker's own width (which varies with the label): a reader measures the continuation indent against a fixed column, not against whatever the marker happened to occupy.
const FOOTNOTE_CONTINUATION_INDENT = 4;

// The write-side inverse of src/lower/lower.ts's lowerFootnoteDefinition: the anchor's own name becomes the `[^label]:` marker, and its extent becomes the definition's body, every line after the first indented to the continuation column. An empty extent (the point anchor a bodyless `[^1]:` lowers to) emits the bare marker rather than a marker followed by a trailing space.
function renderFootnoteDefinition(name: string, body: string): string {
  const marker = `[^${name}]:`;
  if (body.length === 0) {
    return marker;
  }
  const indent = " ".repeat(FOOTNOTE_CONTINUATION_INDENT);
  const [firstLine = "", ...restLines] = body.split("\n");
  return [
    `${marker} ${firstLine}`,
    ...restLines.map((line) => (line.length === 0 ? line : `${indent}${line}`)),
  ].join("\n");
}

// A construct markdown has a syntax for renders as that syntax; one it does not is TRANSPARENT -- its extent still renders in place, and only the construct's own identity is lost. That is the correct degrade rather than dropping the extent: a ContentDocument reaching this writer from another codec (an odt division, a docx content control, a tracked-change wrapper) carries real content inside markers markdown cannot spell, and dropping the wrapper's content along with the wrapper would lose the document, not just the construct.
//
// `anchor` has a markdown spelling for its footnote arm, and `link` for exactly one shape: the titled resolved image src/lower/lower.ts brackets with a pair -- `![alt](dest "title")`, the destination restored verbatim from the descriptor's target instead of re-embedded as a data: URI. Everything else (a bookmark, an endnote, a comment, an internal-target link, any other descriptor kind) has no CommonMark or GFM syntax at all.
function renderConstruct(item: ConstructItem, context: EmitContext): string {
  const { descriptor } = item;
  if (descriptor.kind === "anchor" && descriptor.anchorType === "footnote") {
    const body = renderItems(item.children, context);
    if (isValidFootnoteLabel(descriptor.name)) {
      return renderFootnoteDefinition(descriptor.name, body);
    }
    context.sink({
      code: MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      severity: "info",
      message: `a footnote anchor's own name "${descriptor.name}" cannot be spelled as a "[^label]:" marker (whitespace or "]" would reparse as something else); its own extent still renders in place, but the construct itself is not represented`,
    });
    return body;
  }
  if (descriptor.kind === "division") {
    // The blockquote spelling is gated on this package's own dual carry, not on the descriptor alone -- see isMaterialisedDivision above for exactly what that gate checks and why. A division whose paragraphs carry no such indent is a FOREIGN one -- an ODF text:section, a tagged-PDF /Sect -- and renders transparently below: a named section is not a markdown blockquote, and rendering it as one would invent a construct the source never had.
    if (isMaterialisedDivision(item)) {
      context.divisionDepth += 1;
      const body = renderItems(item.children, context);
      context.divisionDepth -= 1;
      return body
        .split("\n")
        .map((line) => (line.length === 0 ? ">" : `> ${line}`))
        .join("\n");
    }
  }
  if (descriptor.kind === "link" && descriptor.target.kind === "external") {
    // The mint condition is exact -- a pair around precisely one image block, the shape this package's own read side mints. A link construct of any other shape (an annotated block extent from another codec, a run-level pair flattened into a block list) renders transparently below rather than being guessed at.
    const onlyChild =
      item.children.length === 1 && !isConstructItem(item.children[0]!)
        ? item.children[0]!.block
        : undefined;
    if (onlyChild?.kind === "image" && !isDataUri(descriptor.target.uri)) {
      const alt = escapeMarkdownText(onlyChild.altText ?? "");
      return `![${alt}](${escapeLinkDestination(descriptor.target.uri)}${descriptor.title === undefined ? "" : ` "${renderLinkTitle(descriptor.title)}"`})`;
    }
    if (
      onlyChild?.kind === "image" &&
      isDataUri(descriptor.target.uri) &&
      !context.embedImages
    ) {
      // The destination IS the bytes and the caller asked for no bytes -- the pair falls back to the plain no-bytes rendering and the construct goes unrepresented for it.
      return emitImage(onlyChild, false);
    }
  }
  const body = renderItems(item.children, context);
  const detail =
    descriptor.kind === "anchor"
      ? `${descriptor.kind} (${descriptor.anchorType})`
      : descriptor.kind;
  context.sink({
    code: MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
    severity: "info",
    message: `a "${detail}" construct has no markdown syntax; its own extent still renders in place, but the construct itself is not represented`,
  });
  return body;
}

// Whether a construct's own recursive extent contains a plain block carrying the given list itemId -- ONE of the two tests renderItems' own region-collection loop below uses to decide whether a construct immediately following a list-region run genuinely belongs to the item it interrupts (absorbed into the SAME ListRegionItem run, staying nested inside that item on write) or is a genuinely separate, unrelated construct (left to render as ordinary top-level content); see itemIdResumesAfter below for the other. Matching is scoped to the SPECIFIC itemId of the item currently open, not "any list identity found inside" -- a construct's own subtree can legitimately contain an item at a DIFFERENT list level sharing no itemId with the one currently open (a fresh nested sub-list one level deeper, minted with its own itemId), and only an exact itemId match tells "genuinely this item's own content" apart from that.
function constructCarriesListItemId(
  item: ConstructItem,
  itemId: string,
): boolean {
  return item.children.some((child) =>
    isConstructItem(child)
      ? constructCarriesListItemId(child, itemId)
      : child.block.kind === "paragraph" && child.block.list?.itemId === itemId,
  );
}

// The OTHER of the two region-collection tests: whether the currently-open item's own itemId resumes as the very next element of `items` once this construct's own extent ends -- true for a blockquote sitting directly inside a list item that itself wraps a COMPLETELY FRESH nested list of its own (fresh numId/itemId, minted independently by src/lower/lower.ts's lowerList since a list directly inside a blockquote is always lowered as a fresh top-level list, never as a continuation of whatever item enclosed the quote -- ExaDev/documents.js#990). constructCarriesListItemId alone cannot see this case: the quote's own subtree carries no paragraph sharing the open item's itemId at all, since every paragraph inside it belongs to the nested list instead. Resumption is the other half of the same fact a genuinely UNRELATED construct never satisfies -- once a real top-level construct ends the list entirely (CommonMark closes the list item the moment content dedents past its continuation indent), nothing after it can mint a fresh block sharing an itemId a closed item already owns, so a match here is never a false positive against a real parse; only a plain paragraph can resume an item this way, since an item's own contiguous run at a given level is made of paragraphs, not of a construct immediately following another construct with no paragraph between them.
function itemIdResumesAfter(
  items: readonly EmitItem[],
  afterIndex: number,
  itemId: string,
): boolean {
  const next = items[afterIndex];
  return (
    next !== undefined &&
    !isConstructItem(next) &&
    next.block.kind === "paragraph" &&
    next.block.list?.itemId === itemId
  );
}

// Whether a paragraph's own list membership is INHERITED pass-through rather than a list identity of its own -- true exactly when its itemId matches context.enclosingItemId (see that field's own comment): the paragraph sits inside a construct whose extent was absorbed into an already-open list item purely so that item could be recognised as such, not because the paragraph is itself a fresh list item. renderItems checks this before treating a .list-carrying paragraph as the start (or continuation) of a marker-bearing list region -- rendering one as a marker line would invent a bullet the source never had.
function isInheritedListMembership(
  list: ContentListMembership,
  context: EmitContext,
): boolean {
  return list.itemId !== undefined && list.itemId === context.enclosingItemId;
}

// A consecutive run of quoted top-level blocks at the SAME depth is genuinely ambiguous once lowered -- ContentParagraph.indentLeftPt has no field distinguishing "one blockquote containing several blocks" from "several independent blockquotes back to back at the same depth" (document-schema.js carries no ContentBlockquote container of its own; src/lower/lower.ts flattens both shapes identically). Joining every top-level block with a bare blank line, as below, resolves that ambiguity by always choosing the "independent blockquotes" reading -- the correctness-preserving default, since re-joining two ADJACENT SAME-depth quoted blocks into one blockquote (tried and reverted here) fixed no example this package's own soft-line-break handling (src/lower/inline.ts's own softBreak -> ' ' mapping, see src/test-support/conformance-exclusions.ts) did not already fail on for an unrelated reason, while genuinely breaking two real cases (two independent same-depth blockquotes with nothing between them) that this simpler join gets right.
function renderItems(items: readonly EmitItem[], context: EmitContext): string {
  const parts: string[] = [];
  let index = 0;
  while (index < items.length) {
    const item = items[index];
    if (item === undefined) {
      break;
    }
    if (isConstructItem(item)) {
      const rendered = renderConstruct(item, context);
      if (rendered.length > 0) {
        parts.push(rendered);
      }
      index += 1;
      continue;
    }
    if (
      item.block.kind === "paragraph" &&
      item.block.list !== undefined &&
      !isInheritedListMembership(item.block.list, context)
    ) {
      // The region can span several items (a plain paragraph is always absorbed unconditionally -- renderListRegion's own collectListItem is what tells a continuation of the SAME item apart from a fresh sibling), so `runningList` tracks whichever item's own membership is "open" right now -- always the most recently absorbed PLAIN paragraph's own membership, which is exactly what a following construct needs to match to belong to that same item rather than to some earlier, already-closed one.
      const region: ListRegionItem[] = [];
      let end = index;
      let runningList: ContentListMembership | undefined;
      for (;;) {
        const candidate = items[end];
        if (candidate === undefined) {
          break;
        }
        if (isConstructItem(candidate)) {
          if (runningList?.itemId === undefined) {
            break;
          }
          const itemId = runningList.itemId;
          const belongsToOpenItem =
            constructCarriesListItemId(candidate, itemId) ||
            itemIdResumesAfter(items, end + 1, itemId);
          if (!belongsToOpenItem) {
            break;
          }
          region.push({
            kind: "construct",
            item: candidate,
            list: runningList,
          });
          end += 1;
          continue;
        }
        if (
          candidate.block.kind !== "paragraph" ||
          candidate.block.list === undefined ||
          isInheritedListMembership(candidate.block.list, context)
        ) {
          break;
        }
        runningList = candidate.block.list;
        region.push({
          kind: "paragraph",
          block: candidate.block,
          list: runningList,
        });
        end += 1;
      }
      parts.push(renderListRegion(region, context));
      index = end;
      continue;
    }
    const rendered = renderTopLevelBlock(item.block, context);
    if (rendered.length > 0) {
      parts.push(rendered);
    }
    index += 1;
  }
  return parts.join("\n\n");
}

function emitBlocks(
  blocks: readonly ContentBlock[],
  context: EmitContext,
): string {
  const imbalance = findConstructMarkerImbalance(blocks);
  if (imbalance !== undefined) {
    throw new MarkdownUnbalancedConstructMarkersError(
      imbalance.kind,
      imbalance.index,
    );
  }
  validateRunConstructExtents(blocks);
  return renderItems(groupConstructItems(blocks, 0).items, context);
}

// A paragraph's run-level construct extents must name real runs before anything renders them -- the run-level twin of the marker-balance check above, through document-schema.js's own findRunConstructFault so every codec and consumer agree on one definition of well-formed. Tables are walked into because a cell's block list holds its own paragraphs (and nothing else descends further: a table inside a table cell is not a shape GFM or this model produces).
function validateRunConstructExtents(blocks: readonly ContentBlock[]): void {
  for (const block of blocks) {
    if (block.kind === "paragraph" && block.constructs !== undefined) {
      const fault = findRunConstructFault(block);
      if (fault !== undefined) {
        throw new MarkdownInvalidRunConstructExtentError(
          fault.kind,
          fault.index,
        );
      }
    }
    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          validateRunConstructExtents(cell.blocks);
        }
      }
    }
  }
}

export function emitMarkdown(
  document: ContentDocument,
  options: WriteMarkdownOptions = {},
): string {
  if (document.kind !== "wordprocessing") {
    throw new MarkdownUnsupportedDocumentKindError(document.kind);
  }

  const sink: MarkdownDiagnosticSink =
    options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
  const inlineContext: InlineEmitContext = {
    sink,
    emphasisMarker: options.emphasisMarker ?? DEFAULT_EMPHASIS_MARKER,
  };
  const context: EmitContext = {
    ...inlineContext,
    bulletMarker: options.bulletListMarker ?? DEFAULT_BULLET_LIST_MARKER,
    orderedDelimiter:
      options.orderedListDelimiter ?? DEFAULT_ORDERED_LIST_DELIMITER,
    codeFenceChar: options.codeFenceChar ?? DEFAULT_CODE_FENCE_CHAR,
    thematicBreakChar: options.thematicBreakChar ?? DEFAULT_THEMATIC_BREAK_CHAR,
    headingStyle: options.headingStyle ?? DEFAULT_HEADING_STYLE,
    embedImages: options.images ?? true,
    orderedCounters: new Map(),
    reportedFallbackNumIds: new Set(),
    reportedAbsentNumIdFallback: false,
    divisionDepth: 0,
    enclosingItemId: undefined,
  };

  const sections = document.sections.map((section) =>
    emitBlocks(section.blocks, context),
  );
  const body = sections.join("\n\n");

  const frontMatter =
    options.frontMatter === true
      ? emitFrontMatter(document.metadata)
      : undefined;
  const text = frontMatter === undefined ? body : `${frontMatter}\n\n${body}`;

  const lineEnding = options.lineEnding ?? DEFAULT_LINE_ENDING;
  return lineEnding === "crlf" ? text.replaceAll("\n", "\r\n") : text;
}
