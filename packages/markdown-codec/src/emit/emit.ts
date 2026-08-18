// ContentDocument -> markdown text: writeMarkdown's own build-side half, the structural inverse of src/lower/lower.ts. Every mapping mirrors that module's own top-of-file table in reverse:
//
//  - "Heading{1..6}" styleId -> ATX heading, "#" repeated to the level, clamped through document-schema.js's own shared clampHeadingLevel (one heading-range clamp across the ecosystem instead of a private copy here) -- MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED when the level exceeds 6 (a markdown-produced document never carries one, but ContentDocument is a shared cross-format pivot; a paragraph from, say, odt's own unbounded readOutlineLevel can).
//  - 'CodeBlock'/'HorizontalRule'/'HTMLPreformatted' styleId -> a fenced code block / a thematic break / literal, unescaped text.
//  - 'Quote' styleId, or ANY of the four styleIds above while indentLeftPt is also set (a heading/code-block/rule/preformatted-HTML block that sat inside a blockquote when this package's own src/lower produced it) -> '> ' repeated per recovered nesting level (Math.round(indentLeftPt / QUOTE_INDENT_PT)) prefixed to every line of the block's own rendering. A paragraph with indentLeftPt set but none of these five styleIds is a genuine cross-format ambiguity this package cannot resolve (is it a quote, or just some other format's own paragraph indentation?) -- MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED; the indent is dropped, the paragraph still renders.
//  - ContentListMembership -> a bullet/ordered/task-list item, decoded from its own numId string (src/shared/list-id.ts) -- MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK for a numId this package never minted itself, or a depth-only membership carrying no numId at all (both fall back to a plain, tight, non-task bullet, per that module's own documented cross-format contract).
//  - ContentTable -> a GFM table, src/emit/table.ts.
//  - ContentImageBlock -> a markdown image, src/emit/image.ts.
//  - ContentRun[] -> inline text, src/emit/inline.ts.
//
// ContentPageBreak and ContentEmbeddedObjectBlock have no markdown representation of any kind (this package's own src/lower never produces either, but ContentDocument is a shared pivot a caller can construct directly) -- both are silently dropped, contributing no output at all; this is not one of this package's own named mapping gaps (there was never a markdown construct to lose fidelity from), so it carries no diagnostic code.

import type { ContentBlock, ContentDocument, ContentParagraph } from 'document-schema.js';
import { clampHeadingLevel } from 'document-schema.js';
import { MarkdownUnsupportedDocumentKindError } from '../diagnostics/diagnostics';
import type { MarkdownDiagnosticSink } from '../diagnostics/diagnostics';
import { MarkdownDiagnosticCodes, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from '../diagnostics/diagnostics';
import { DEFAULT_BULLET_LIST_MARKER, DEFAULT_CODE_FENCE_CHAR, DEFAULT_EMPHASIS_MARKER, DEFAULT_HEADING_STYLE, DEFAULT_LINE_ENDING, DEFAULT_ORDERED_LIST_DELIMITER, DEFAULT_THEMATIC_BREAK_CHAR } from '../defaults/defaults';
import type { MarkdownHeadingStyle, WriteMarkdownOptions } from '../options/options';
import type { ListNumIdInfo } from '../shared/list-id';
import { parseListNumId } from '../shared/list-id';
import { CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, MATH_BLOCK_STYLE_ID, QUOTE_INDENT_PT, QUOTE_STYLE_ID, TASK_CHECKBOX_CHECKED, TASK_CHECKBOX_UNCHECKED, parseHeadingStyleId } from '../shared/style-constants';
import { emitFrontMatter } from './front-matter';
import { emitImage } from './image';
import type { InlineEmitContext } from './inline';
import { emitRuns } from './inline';
import type { TableEmitContext } from './table';
import { emitTable } from './table';

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
}

// setext's own grammar (spec 0.31.2, "Setext headings") only distinguishes two levels (a run of '=' for level 1, of '-' for level 2) -- there is no setext spelling for level 3 and deeper, so headingStyle: 'setext' still falls back to ATX there.
const MAX_SETEXT_LEVEL = 2;
const SETEXT_LEVEL_1_CHAR = '=';
const SETEXT_LEVEL_2_CHAR = '-';
const MIN_SETEXT_UNDERLINE_LENGTH = 1;

function renderSetextHeading(level: number, text: string): string {
  const underlineChar = level === 1 ? SETEXT_LEVEL_1_CHAR : SETEXT_LEVEL_2_CHAR;
  // A setext underline's own length has no semantic meaning beyond "one or more" -- matching the heading text's own rendered length keeps the output visually tidy without claiming any significance for the exact count.
  const firstLine = text.split('\n')[0] ?? '';
  const underline = underlineChar.repeat(Math.max(MIN_SETEXT_UNDERLINE_LENGTH, firstLine.length));
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
  return fenceChar.repeat(Math.max(MIN_CODE_FENCE_LENGTH, longestRunLength(literal, fenceChar) + 1));
}

const QUOTABLE_STYLE_IDS: ReadonlySet<string> = new Set([QUOTE_STYLE_ID, CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, MATH_BLOCK_STYLE_ID]);

function isQuotableStyle(styleId: string | undefined): boolean {
  if (styleId === undefined) {
    return false;
  }
  return QUOTABLE_STYLE_IDS.has(styleId) || parseHeadingStyleId(styleId) !== undefined;
}

function quoteDepthOf(paragraph: ContentParagraph): number {
  if (paragraph.indentLeftPt === undefined || paragraph.indentLeftPt <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(paragraph.indentLeftPt / QUOTE_INDENT_PT));
}

// One paragraph's OWN construct-specific rendering -- heading/code-block/rule/preformatted-HTML/plain -- with no blockquote or list-marker wrapping applied yet (renderParagraph below layers those on afterwards, uniformly, regardless of which of these five shapes produced the body).
function renderParagraphBody(paragraph: ContentParagraph, context: EmitContext): string {
  if (paragraph.styleId === HORIZONTAL_RULE_STYLE_ID) {
    return context.thematicBreakChar.repeat(3);
  }
  if (paragraph.styleId === CODE_BLOCK_STYLE_ID) {
    const literal = paragraph.runs.map((run) => run.text).join('');
    const fence = codeFenceFor(literal, context.codeFenceChar);
    // An empty code block ("```\n```\n", zero content lines) must not gain a spurious blank content line here -- the middle `\n${literal}\n` template below would otherwise insert one, which a reparse reads back as ONE literal blank line of content rather than none at all.
    return literal.length === 0 ? `${fence}\n${fence}` : `${fence}\n${literal}\n${fence}`;
  }
  if (paragraph.styleId === HTML_PREFORMATTED_STYLE_ID) {
    return paragraph.runs.map((run) => run.text).join('');
  }
  if (paragraph.styleId === MATH_BLOCK_STYLE_ID) {
    // A fresh $$ pair regenerated around the preserved literal -- src/lower/lower.ts's own lowerMathBlock never kept the original delimiter lines either, exactly mirroring how a fenced code block regenerates its own fence (codeFenceFor) rather than preserving the source fence's exact character/length.
    const literal = paragraph.runs.map((run) => run.text).join('');
    return `$$\n${literal}\n$$`;
  }
  const headingLevel = paragraph.styleId === undefined ? undefined : parseHeadingStyleId(paragraph.styleId);
  if (headingLevel !== undefined) {
    const level = clampHeadingLevel(headingLevel);
    if (level !== headingLevel) {
      context.sink({ code: MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED, severity: 'info', message: `heading level ${String(headingLevel)} exceeds ATX's own six-"#" ceiling and is clamped to ${String(level)}` });
    }
    const text = emitRuns(paragraph.runs, context);
    if (context.headingStyle === 'setext' && level <= MAX_SETEXT_LEVEL) {
      return renderSetextHeading(level, text);
    }
    return `${'#'.repeat(level)} ${text}`;
  }
  return emitRuns(paragraph.runs, context);
}

// Applies blockquote wrapping ('> ' repeated per recovered nesting level, on every line of the body) on top of renderParagraphBody's own construct-specific rendering -- see this module's own top-of-file note for exactly which styleIds this applies to, and MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED for the ones it does not.
function renderParagraph(paragraph: ContentParagraph, context: EmitContext): string {
  const body = renderParagraphBody(paragraph, context);
  const depth = quoteDepthOf(paragraph);
  if (depth === 0) {
    return body;
  }
  if (!isQuotableStyle(paragraph.styleId)) {
    context.sink({ code: MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED, severity: 'info', message: `paragraph carries indentLeftPt (${String(paragraph.indentLeftPt)}pt) with no styleId this package recognises as quotable; the indent has no other markdown representation and is dropped` });
    return body;
  }
  const prefix = '> '.repeat(depth);
  return body
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function renderTopLevelBlock(block: ContentBlock, context: EmitContext): string {
  switch (block.kind) {
    case 'paragraph':
      return renderParagraph(block, context);
    case 'table':
      return emitTable(block, context);
    case 'image':
      return emitImage(block, context.embedImages);
    case 'pageBreak':
    case 'embeddedObject':
      return '';
  }
}

// --- List rendering: every ContentParagraph carrying .list is its own list item (see src/lower/lower.ts's own top-of-file note on why ContentListMembership cannot distinguish a continuation paragraph from a fresh sibling item -- this package resolves that ambiguity the same way on both sides, consistently). ---

// numId undefined is a depth-only ContentListMembership -- document-schema.js 3.3.0+ makes numId optional for sources that carry a level but no numbering identity of their own (OOXML drawing paragraphs' a:pPr/@lvl being the motivating case) -- and it lands in the same documented cross-format fallback as a foreign numId string: with no marker type, task-ness, or loose-ness to recover, the item renders as an ordinary, tight, non-task bullet at its own level.
function listInfoFor(numId: string | undefined, context: EmitContext): ListNumIdInfo | undefined {
  if (numId === undefined) {
    if (!context.reportedAbsentNumIdFallback) {
      context.reportedAbsentNumIdFallback = true;
      context.sink({ code: MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK, severity: 'info', message: 'a list membership with no numId of its own (a depth-only ContentListMembership) has no marker type, task-ness, or loose-ness to recover and falls back to an ordinary, tight, non-task bullet list' });
    }
    return undefined;
  }
  const info = parseListNumId(numId);
  if (info === undefined && !context.reportedFallbackNumIds.has(numId)) {
    context.reportedFallbackNumIds.add(numId);
    context.sink({ code: MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK, severity: 'info', message: `numId "${numId}" was not minted by this package's own src/lower and falls back to an ordinary, tight, non-task bullet list` });
  }
  return info;
}

function checkboxPrefixFor(item: ContentParagraph): string | undefined {
  const first = item.runs[0];
  if (first === undefined) {
    return undefined;
  }
  if (first.text.startsWith(`${TASK_CHECKBOX_CHECKED} `)) {
    return '[x] ';
  }
  if (first.text.startsWith(`${TASK_CHECKBOX_UNCHECKED} `)) {
    return '[ ] ';
  }
  return undefined;
}

// Strips the leading checkbox glyph src/lower/lower.ts's own applyTaskCheckbox prepended, so renderParagraphBody does not ALSO print the raw glyph character in the item's own body text -- the marker rendered by renderListItemMarker below carries the equivalent `[x]`/`[ ]` text instead.
function stripCheckboxRun(item: ContentParagraph, checkboxPrefix: string | undefined): ContentParagraph {
  if (checkboxPrefix === undefined) {
    return item;
  }
  const first = item.runs[0];
  const glyphPrefix = checkboxPrefix === '[x] ' ? `${TASK_CHECKBOX_CHECKED} ` : `${TASK_CHECKBOX_UNCHECKED} `;
  if (!first?.text.startsWith(glyphPrefix)) {
    return item;
  }
  const strippedText = first.text.slice(glyphPrefix.length);
  const runs = strippedText.length === 0 ? item.runs.slice(1) : [{ ...first, text: strippedText }, ...item.runs.slice(1)];
  return { ...item, runs };
}

interface RenderedListMarker {
  // The visible marker text prepended to the item's own first line -- bullet/ordinal glyph AND, for a task item, its checkbox text.
  readonly full: string;
  // The bullet/ordinal glyph's own width alone (glyph + one space), EXCLUDING any checkbox text -- what CommonMark's own list-item continuation rule actually measures (spec 0.31.2, "List items": the marker plus its own padding, not whatever content happens to follow on the first line). Using `full.length` for a nested list's own indent would over-indent it past what a real reparse recognises as still belonging to this item, since a task item's checkbox glyph is ordinary FIRST-LINE CONTENT, not part of the marker.
  readonly bareLength: number;
}

function renderListItemMarker(numId: string | undefined, info: ListNumIdInfo | undefined, item: ContentParagraph, context: EmitContext): RenderedListMarker {
  const checkboxPrefix = info?.task === true ? checkboxPrefixFor(item) : undefined;
  const checkboxText = checkboxPrefix ?? '';
  // Only a parsed numId string can carry type 'ordered', so the ordered-counter key is present exactly when this branch is live.
  if (info?.type === 'ordered' && numId !== undefined) {
    const next = context.orderedCounters.get(numId) ?? (info.start ?? 1);
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

// Renders one contiguous, flat run of .list-carrying paragraphs -- possibly spanning several sibling top-level lists back to back, and arbitrarily nested sub-lists (a paragraph whose own level is deeper than its predecessor's is that predecessor's own nested list content, recursed into here). Loose/tight spacing between two SIBLING items sharing the same numId is read from that numId's own `loose` flag; a boundary between two DIFFERENT numIds always gets a blank line, matching how two genuinely separate lists always render with visual separation.
function renderListRegion(items: readonly ContentParagraph[], context: EmitContext): string {
  const parts: ListItemPart[] = [];
  let index = 0;
  while (index < items.length) {
    const item = items[index];
    if (item?.list === undefined) {
      break;
    }
    const { numId, level } = item.list;
    const info = listInfoFor(numId, context);

    let lookahead = index + 1;
    while (lookahead < items.length && (items[lookahead]?.list?.level ?? -1) > level) {
      lookahead += 1;
    }
    const nestedItems = items.slice(index + 1, lookahead);

    const checkboxPrefix = info?.task === true ? checkboxPrefixFor(item) : undefined;
    const marker = renderListItemMarker(numId, info, item, context);
    const bodyLines = renderParagraphBody(stripCheckboxRun(item, checkboxPrefix), context).split('\n');
    const indent = ' '.repeat(marker.bareLength);
    const [firstLine = '', ...restLines] = bodyLines;
    let text = [`${marker.full}${firstLine}`, ...restLines.map((line) => `${indent}${line}`)].join('\n');
    if (nestedItems.length > 0) {
      const nested = renderListRegion(nestedItems, context)
        .split('\n')
        .map((line) => (line.length === 0 ? line : `${indent}${line}`))
        .join('\n');
      text += `\n${nested}`;
    }

    parts.push({ numId, text });
    index = lookahead;
  }

  let out = '';
  for (const [partIndex, part] of parts.entries()) {
    if (partIndex > 0) {
      const previous = parts[partIndex - 1]!;
      const sameList = previous.numId === part.numId;
      const loose = sameList && previous.numId !== undefined && (parseListNumId(previous.numId)?.loose ?? false);
      out += sameList && !loose ? '\n' : '\n\n';
    }
    out += part.text;
  }
  return out;
}

// A consecutive run of quoted top-level blocks at the SAME depth is genuinely ambiguous once lowered -- ContentParagraph.indentLeftPt has no field distinguishing "one blockquote containing several blocks" from "several independent blockquotes back to back at the same depth" (document-schema.js carries no ContentBlockquote container of its own; src/lower/lower.ts flattens both shapes identically). Joining every top-level block with a bare blank line, as below, resolves that ambiguity by always choosing the "independent blockquotes" reading -- the correctness-preserving default, since re-joining two ADJACENT SAME-depth quoted blocks into one blockquote (tried and reverted here) fixed no example this package's own soft-line-break handling (src/lower/inline.ts's own softBreak -> ' ' mapping, see src/test-support/conformance-exclusions.ts) did not already fail on for an unrelated reason, while genuinely breaking two real cases (two independent same-depth blockquotes with nothing between them) that this simpler join gets right.
function emitBlocks(blocks: readonly ContentBlock[], context: EmitContext): string {
  const parts: string[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block === undefined) {
      break;
    }
    if (block.kind === 'paragraph' && block.list !== undefined) {
      const region: ContentParagraph[] = [];
      let end = index;
      for (let candidate = blocks[end]; candidate?.kind === 'paragraph' && candidate.list !== undefined; candidate = blocks[end]) {
        region.push(candidate);
        end += 1;
      }
      parts.push(renderListRegion(region, context));
      index = end;
      continue;
    }
    const rendered = renderTopLevelBlock(block, context);
    if (rendered.length > 0) {
      parts.push(rendered);
    }
    index += 1;
  }
  return parts.join('\n\n');
}

export function emitMarkdown(document: ContentDocument, options: WriteMarkdownOptions = {}): string {
  if (document.kind !== 'wordprocessing') {
    throw new MarkdownUnsupportedDocumentKindError(document.kind);
  }

  const sink: MarkdownDiagnosticSink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
  const inlineContext: InlineEmitContext = { sink, emphasisMarker: options.emphasisMarker ?? DEFAULT_EMPHASIS_MARKER };
  const context: EmitContext = {
    ...inlineContext,
    bulletMarker: options.bulletListMarker ?? DEFAULT_BULLET_LIST_MARKER,
    orderedDelimiter: options.orderedListDelimiter ?? DEFAULT_ORDERED_LIST_DELIMITER,
    codeFenceChar: options.codeFenceChar ?? DEFAULT_CODE_FENCE_CHAR,
    thematicBreakChar: options.thematicBreakChar ?? DEFAULT_THEMATIC_BREAK_CHAR,
    headingStyle: options.headingStyle ?? DEFAULT_HEADING_STYLE,
    embedImages: options.images ?? true,
    orderedCounters: new Map(),
    reportedFallbackNumIds: new Set(),
    reportedAbsentNumIdFallback: false,
  };

  const sections = document.sections.map((section) => emitBlocks(section.blocks, context));
  const body = sections.join('\n\n');

  const frontMatter = options.frontMatter === true ? emitFrontMatter(document.metadata) : undefined;
  const text = frontMatter === undefined ? body : `${frontMatter}\n\n${body}`;

  const lineEnding = options.lineEnding ?? DEFAULT_LINE_ENDING;
  return lineEnding === 'crlf' ? text.replaceAll('\n', '\r\n') : text;
}
