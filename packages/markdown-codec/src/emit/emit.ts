// ContentDocument -> markdown text: writeMarkdown's own build-side half, the structural inverse of src/lower/lower.ts. Every mapping mirrors that module's own top-of-file table in reverse:
//
//  - "Heading{1..6}" styleId -> ATX heading, "#" repeated to the level, clamped through document-schema.js's own shared clampHeadingLevel (one heading-range clamp across the ecosystem instead of a private copy here) — MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED when the level exceeds 6 (a markdown-produced document never carries one, but ContentDocument is a shared cross-format pivot; a paragraph from, say, odt's own unbounded readOutlineLevel can).
//  - 'CodeBlock'/'HorizontalRule'/'HTMLPreformatted' styleId -> a fenced code block / a thematic break / literal, unescaped text. A CodeBlock paragraph's own codeLanguage re-emits as the fence's info word, with any markdown-residue remainder (src/lower/lower.ts's splitInfoString) re-emitted verbatim after it — one space between fence and info line, the spec's own canonical spacing, which also keeps an info word that begins with the fence character from fusing into the fence itself.
//  - a division construct pair whose wrapped paragraphs carry the quote indent (this package's own dual carry) -> one '> ' blockquote wrapper per nesting level, with the blocks' own indentLeftPt suppressed so the fact is counted once. A paragraph outside any division still recovers its quote depth from indentLeftPt alone: 'Quote' styleId, or ANY of the four styleIds below while indentLeftPt is also set, -> '> ' repeated per recovered nesting level (Math.round(indentLeftPt / QUOTE_INDENT_PT)) prefixed to every line — the cross-format path for a document this package never produced. A paragraph with indentLeftPt set but none of these five styleIds is a genuine cross-format ambiguity this package cannot resolve (is it a quote, or just some other format's own paragraph indentation?) — MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED; the indent is dropped, the paragraph still renders.

//  - ContentTable -> a GFM table, src/emit/table.ts.
//  - ContentImageBlock -> a markdown image, src/emit/image.ts.
//  - ContentRun[] -> inline text, src/emit/inline.ts.
//
// ContentPageBreak and ContentEmbeddedObjectBlock have no markdown representation of any kind (this package's own src/lower never produces either, but ContentDocument is a shared pivot a caller can construct directly) — both are silently dropped, contributing no output at all; this is not one of this package's own named mapping gaps (there was never a markdown construct to lose fidelity from), so it carries no diagnostic code.

import type {
  ContentBlock,
  ContentConstructEnd,
  ContentConstructStart,
  ContentDocument,
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

import type {
  MarkdownHeadingStyle,
  WriteMarkdownOptions,
} from "../options/options";
import { LINE_ENDING_PATTERN } from "../shared/line-ending";

import {
  CODE_BLOCK_STYLE_ID,
  HORIZONTAL_RULE_STYLE_ID,
  HTML_PREFORMATTED_STYLE_ID,
  MATH_BLOCK_STYLE_ID,
  QUOTE_INDENT_PT,
  parseHeadingStyleId,
} from "../shared/style-constants";
import { emitFrontMatter } from "./front-matter";
import { emitImage } from "./image";
import type { InlineEmitContext } from "./inline";
import { emitRuns } from "./inline";
import type { TableEmitContext } from "./table";
import { emitTable } from "./table";

import { groupConstructItems, renderItems } from "./list-render";
import {
  MAX_SETEXT_LEVEL,
  SETEXT_LEVEL_2_CHAR,
  THEMATIC_BREAK_CHAR_COUNT,
  codeFenceFor,
  firstContentLineIndex,
  isQuotableStyle,
  renderAtxHeading,
  renderSetextHeading,
  unsafeSetextBreakReason,
  unsafeSetextDiagnosticMessage,
  willRenderAsSetext,
} from "./setext";

// Whether an image destination is itself an embedded-bytes spelling — the one case where re-emitting the destination verbatim would re-embed the very bytes WriteMarkdownOptions.images: false asks to omit.
export function isDataUri(destination: string): boolean {
  return destination.startsWith("data:");
}

export interface EmitContext extends TableEmitContext {
  readonly bulletMarker: string;
  readonly orderedDelimiter: string;
  readonly codeFenceChar: string;
  readonly thematicBreakChar: string;
  readonly headingStyle: MarkdownHeadingStyle;
  readonly orderedCounters: Map<string, number>;
  // The bullet character (for a numId minted type 'bullet') or ordered delimiter (type 'ordered') CHOSEN for this numId, memoised the first time renderListRegion reaches it — see resolveListGlyph below for why this can diverge from bulletMarker/orderedDelimiter.
  readonly resolvedListGlyphs: Map<string, string>;
  readonly reportedFallbackNumIds: Set<string>;
  // One-shot latch for the no-numId-at-all fallback diagnostic — reportedFallbackNumIds cannot key an absent numId without inventing a sentinel string, so this is a mutable flag where its sibling is a mutable-by-reference collection.
  reportedAbsentNumIdFallback: boolean;
  // How many blockquote-rendered division constructs currently enclose the block being rendered. Inside one, the '> ' prefixes come from the divisions themselves and a paragraph's own indentLeftPt is NOT also read back as quote depth — the indent is the division's materialised formatting, counted once, not twice. Mutable for the same reason the counters are: it is render position, not configuration.
  divisionDepth: number;
  // The itemId of the list item whose own construct is CURRENTLY being rendered, when there is one — set by listRegionItemBody around a construct absorbed into a list region, restored to whatever it was straight after. src/lower/lower.ts's lowerBlockquote threads the enclosing item's OWN membership straight through every paragraph a quote directly wraps (the same context-carrying dual carry the quote indent itself uses), so a paragraph inside the quote sharing this exact itemId is NOT a list item of its own — it is ordinary prose that merely inherited the enclosing item's membership so renderItems' own region-collection scan could recognise the construct as belonging to that item in the first place (see constructCarriesListItemId). Rendering it as a fresh marker line would invent a bullet the source never had; renderItems checks this field to render such a paragraph as plain content instead. A GENUINE nested list directly inside the same quote (its own freshly-minted numId/itemId, independent of anything outside) never matches this field and renders with its own marker exactly as before.
  enclosingItemId: string | undefined;
}

// setext's own grammar (spec 0.31.2, "Setext headings") only distinguishes two levels (a run of '=' for level 1, of '-' for level 2) — there is no setext spelling for level 3 and deeper, so headingStyle: 'setext' still falls back to ATX there.
export function canInterruptOpenParagraph(
  paragraph: ContentParagraph,
  context: EmitContext,
): boolean {
  const styleId = paragraph.styleId;
  // Undefined needs its own early return purely so parseHeadingStyleId below gets a definite string — QUOTE_STYLE_ID and HTML_PREFORMATTED_STYLE_ID need no explicit check of their own alongside it, since neither matches any of the positive branches below (parseHeadingStyleId included), so both already fall out to the final `return false` on their own.
  if (styleId === undefined) {
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
    return !willRenderAsSetext(
      paragraph,
      clampHeadingLevel(headingLevel),
      context,
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

// One paragraph's OWN construct-specific rendering — heading/code-block/rule/preformatted-HTML/plain — with no blockquote or list-marker wrapping applied yet (renderParagraph below layers those on afterwards, uniformly, regardless of which of these five shapes produced the body).
export function renderParagraphBody(
  paragraph: ContentParagraph,
  context: EmitContext,
): string {
  if (paragraph.styleId === HORIZONTAL_RULE_STYLE_ID) {
    return context.thematicBreakChar.repeat(THEMATIC_BREAK_CHAR_COUNT);
  }
  if (paragraph.styleId === CODE_BLOCK_STYLE_ID) {
    const literal = paragraph.runs.map((run) => run.text).join("");
    const fence = codeFenceFor(literal, context.codeFenceChar);
    // The inverse of src/lower/lower.ts's splitInfoString: the language word and the quarantined remainder rejoin as the fence's info line, one space between them. Both halves re-emit verbatim — the language is a source-format identifier, not something to re-spell, and the remainder is this package's own markdown residue, which a same-format writer re-emits as-is (the residue channel's restorable tier).
    const remainder =
      paragraph.source?.format === "markdown"
        ? paragraph.source.xml
        : undefined;
    const info = [paragraph.codeLanguage, remainder]
      .filter((part) => part !== undefined && part.length > 0)
      .join(" ");
    const opening = info.length > 0 ? `${fence} ${info}` : fence;
    // An empty code block ("```\n```\n", zero content lines) must not gain a spurious blank content line here — the middle `\n${literal}\n` template below would otherwise insert one, which a reparse reads back as ONE literal blank line of content rather than none at all.
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
    // A fresh $$ pair regenerated around the preserved literal — src/lower/lower.ts's own lowerMathBlock never kept the original delimiter lines either, exactly mirroring how a fenced code block regenerates its own fence (codeFenceFor) rather than preserving the source fence's exact character/length.
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
    // ATX is a single physical line; a hard OR soft break embedded in this heading's own runs (src/emit/inline.ts's renderLeaf) leaves a genuine CommonMark line ending in `text` regardless of the configured headingStyle, and ATX has no way to hold it — writing it out anyway would split the ATX line in two on reparse rather than lose formatting, which is strictly worse. This is detected via LINE_ENDING_PATTERN, not a bare '\n' check: this package's own hard-break escaping (escapeMarkdownText) and soft-break residue always use LF, but a run's plain text field or a foreign producer's own markdown residue (src/emit/inline.ts's renderLeaf, the run.source.xml case) can carry a bare CR or CRLF just as legitimately, and an un-widened check would leave such a heading treated as break-free throughout: never a setext candidate whose own grammar could have held the break, and collapsed by renderAtxHeading below with no HEADING_LINE_BREAK_COLLAPSED diagnostic reporting that anything was lost. Setext's own grammar is exactly "one or more lines of heading text", so promote to it whenever the level admits one (<=2), overriding the configured style; only a genuinely unrepresentable level 3-6 heading, OR a level<=2 heading whose own break placement would leave a blank line setext cannot survive (embedsUnsafeBreakForSetext above), falls through to the collapse-with-diagnostic path below. A level<=2 heading with NO embedded break at all can still fall through the same unsafe path: headingStyle: 'setext' is itself a second, independent trigger for candidacy (setextRequested below), so an explicit caller request against an already-unsafe break-free heading (a 4+-column-indented or wholly blank first line) is refused with the identical diagnostic rather than being silently written as an unmarked ATX fallback.
    const embedsLineBreak = LINE_ENDING_PATTERN.test(text);
    const unsafeSetextReason = unsafeSetextBreakReason(text);
    const unsafeForSetext = unsafeSetextReason !== undefined;
    // Setext is even a candidate rendering here under either of two independent triggers — an explicit headingStyle: 'setext' request, or (regardless of the configured style) the text embedding a break ATX cannot hold at all — and unsafeForSetext can refuse EITHER trigger, not just the break one: a break-free heading explicitly requesting setext is exactly as capable of being unsafe (a 4+-column-indented or wholly blank first line) as one forced into candidacy by its own embedded break.
    const setextRequested =
      context.headingStyle === "setext" || embedsLineBreak;
    if (setextRequested && level <= MAX_SETEXT_LEVEL && !unsafeForSetext) {
      if (context.headingStyle !== "setext") {
        // A break at the very START of the heading's own text is the one case setext promotion does not actually reproduce: firstContentLineIndex > 0 means a genuinely blank leading line was exempted from embedsUnsafeBreakForSetext's own check above, and that line is absorbed as ordinary inter-block whitespace ahead of the heading on read-back, not carried inside it (unlike an escaped hard break's own non-blank backslash line, which never needs the exemption and round-trips inside the heading losslessly).
        const leadingBreakAbsorbed = firstContentLineIndex(text) > 0;
        context.sink({
          code: MarkdownDiagnosticCodes.HEADING_STYLE_OVERRIDDEN_FOR_LINE_BREAK,
          severity: "info",
          message: leadingBreakAbsorbed
            ? `the effective WriteMarkdownOptions.headingStyle is 'atx' (its own default, or an explicit caller choice), but this level ${String(level)} heading's own content contains a line break ATX has no way to hold — rendered as setext instead, though the heading's own leading blank line is absorbed as ordinary space ahead of it on read-back rather than reproduced inside it`
            : `the effective WriteMarkdownOptions.headingStyle is 'atx' (its own default, or an explicit caller choice), but this level ${String(level)} heading's own content contains a line break ATX has no way to hold — rendered as setext instead so the break survives`,
        });
      }
      return renderSetextHeading(level, text);
    }
    if (setextRequested && level <= MAX_SETEXT_LEVEL && unsafeForSetext) {
      // Setext was a genuine candidate here (an explicit caller request, an embedded break, or both) but unsafeSetextBreakReason refused it — report the hazard regardless of which of the two triggers brought this heading here, rather than only when an embedded break is also present (a caller-requested setext against an already-unsafe break-free heading is silently overridden exactly as unsafely otherwise).
      context.sink({
        code: MarkdownDiagnosticCodes.HEADING_LINE_BREAK_UNSAFE_FOR_SETEXT,
        severity: "info",
        message: unsafeSetextDiagnosticMessage(
          level,
          unsafeSetextReason,
          embedsLineBreak,
        ),
      });
      // No separate break-free return: the hazard here can just as well be the break-free heading's own first-line indentation or wholly blank text, and such a text carries no CommonMark line ending for either collapse step to act on, so renderAtxHeading leaves it exactly as it stands.
      return renderAtxHeading(level, text);
    }
    if (embedsLineBreak) {
      context.sink({
        code: MarkdownDiagnosticCodes.HEADING_LINE_BREAK_COLLAPSED,
        severity: "info",
        message: `a level ${String(level)} heading's own content contains a line break; only setext's own level-1/2 grammar can hold one, so ATX collapses it to a single space`,
      });
    }
    return renderAtxHeading(level, text);
  }
  return emitRuns(paragraph.runs, context, paragraph.constructs);
}

// Applies blockquote wrapping ('> ' repeated per recovered nesting level, on every line of the body) on top of renderParagraphBody's own construct-specific rendering — see this module's own top-of-file note for exactly which styleIds this applies to, and MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED for the ones it does not. A paragraph already inside a blockquote-rendered division construct does NOT re-enter here: the division's own rendering prefixes '> ' per level, and reading the indent back as depth on top of that would double-count the same fact.
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

// Every ContentBlock kind that renders as content in its own right — the whole union MINUS the two construct boundary markers, which are structure rather than content and are consumed by groupConstructItems below before any block reaches here. Spelled as a type rather than as two unreachable switch arms so the compiler, not a comment, is what guarantees a marker never arrives.
export type RenderableBlock = Exclude<
  ContentBlock,
  ContentConstructStart | ContentConstructEnd
>;

export function renderTopLevelBlock(
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
      // The inverse of src/lower/lower.ts's lowerMathBlock: an embedded FORMULA whose presentation layer carries LaTeX re-renders as a fresh $$ pair around that verbatim string (an empty LaTeX spelling an empty block, matching how the old MathBlock paragraph emitted one). Any other embedded object — another document kind, or a formula with no presentation LaTeX (an ODF equation carrying only MathML) — has no markdown spelling at all and is silently dropped, as it always was: this package never had a construct to lose fidelity from there.
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
  return assertNeverRenderableBlock(block);
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

// A paragraph's run-level construct extents must name real runs before anything renders them — the run-level twin of the marker-balance check above, through document-schema.js's own findRunConstructFault so every codec and consumer agree on one definition of well-formed. Tables are walked into because a cell's block list holds its own paragraphs (and nothing else descends further: a table inside a table cell is not a shape GFM or this model produces). No separate `block.constructs !== undefined` guard here: findRunConstructFault already checks that itself and returns undefined immediately, so a paragraph with no constructs at all is exactly as safe to pass through unconditionally.
function validateRunConstructExtents(blocks: readonly ContentBlock[]): void {
  for (const block of blocks) {
    if (block.kind === "paragraph") {
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
    resolvedListGlyphs: new Map(),
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

// Reached only if RenderableBlock ever gains a member renderTopLevelBlock's own switch does not match: every current member has a case there, so `block` narrows to `never` at the call, and adding an uncovered member makes that narrowing fail and the call stop compiling. Exists so the switch's exhaustiveness, proven by the type checker rather than by a catch-all default that would silently drop a genuinely new member, still gives consistent-return an explicit statement to see past the switch. Exported so the tests can exercise the throw directly with a forced-invalid cast, since it is otherwise unreachable.
export function assertNeverRenderableBlock(block: never): never {
  throw new Error(
    `markdown-codec: unhandled renderable block ${JSON.stringify(block)}`,
  );
}
