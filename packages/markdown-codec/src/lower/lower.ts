// The AST -> ContentDocument lowering stage: this package's own counterpart to ooxml.js's readDocx/readPptx and odf.js's readOdt/readOdp -- a thin adapter from parseMarkdown's own AST onto document-schema.js's shared ContentDocument pivot, not a second parser. Every mapping below, and the stable diagnostic code its own gap is recorded under (MarkdownDiagnosticCodes, src/diagnostics/diagnostics.ts), mirrors this package's own construct-by-construct design table:
//
//  - document envelope -> one ContentSection, A4 + 1in default page geometry, overridable via ReadMarkdownOptions.pageSize/margins -- MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY (markdown has no page concept of its own; this ALWAYS fires, once per lowered document).
//  - ATX/setext heading -> styleId "Heading1".."Heading6", mirroring odf.js's readOdt convention exactly (src/shared/style-constants.ts's headingStyleId), plus the canonical ContentParagraph.headingLevel document-schema.js defines -- the level number itself (always 1-6 here: ATX/setext cap at six), so a consumer that never learned this package's own styleId spelling still knows the heading's depth.
//  - emphasis/strong/strikethrough -> italic/bold/strike ContentRun fields; links/autolinks -> ContentRun.hyperlink; code spans -> a Courier New run; hard/soft breaks -> literal '\n'/' ' -- all in src/lower/inline.ts, alongside MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED and LINK_TITLE_DROPPED.
//  - fenced/indented code block -> one paragraph, styleId 'CodeBlock', '\n'-joined literal, monospace -- MarkdownDiagnosticCodes.CODE_BLOCK_INFO_STRING_DROPPED when a fence's own info string is non-empty.
//  - blockquote -> styleId 'Quote' (a real Word built-in style name) plus indentLeftPt per nesting level; a heading inside a quote keeps its own Heading{N} styleId (decorateParagraph below only applies 'Quote' when nothing more specific already set a styleId) -- MarkdownDiagnosticCodes.BLOCKQUOTE_NESTED_DEPTH beyond level 1.
//  - thematic break -> an empty paragraph, styleId 'HorizontalRule' -- deliberately NOT ContentPageBreak (would inject a spurious page break into every generated PDF/docx this ContentDocument later feeds). Whether a consumer that does not resolve styleId at all renders this invisibly is a property of THAT consumer, not something this package's own read pipeline can detect or diagnose, so it carries no code of its own.
//  - lists (bullet/ordered/task) -> flat ContentListMembership numId/level, encoding ordered-vs-unordered/task/tight-loose into the numId string itself (src/shared/list-id.ts) -- MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT (a nested list's own marker type disagrees with its numId's minted type), LIST_ITEM_BLOCK_UNLISTED (a table or a resolved image directly inside an item -- ContentListMembership lives only on ContentParagraph), LIST_ITEM_MULTI_BLOCK_FLATTENED (more than one non-nested-list block directly inside one item loses its own item-boundary identity).
//  - GFM tables -> ContentTable, src/lower/table.ts.
//  - images -> ContentImageBlock via a synchronous MarkdownImageResolver port (src/lower/image.ts) -- MarkdownDiagnosticCodes.IMAGE_UNRESOLVED when the resolver (or native data: URI decoding) cannot produce a real PNG/JPEG; the image degrades to a text run of alt text + hyperlink, NEVER an invalid ContentImageBlock. A top-level image (a direct child of a paragraph) splits that paragraph precisely at the point it occurs; a nested one (inside emphasis/a link) never resolves at all -- see src/lower/inline.ts's own top-of-file note.
//  - raw HTML -> preserved as literal text by default (styleId 'HTMLPreformatted' for block-level HTML), a rawHtml: 'drop' option available -- MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT / RAW_HTML_DROPPED.
//  - $$ display math / \( \) inline math (ExaDev/markdown-codec#53) -> preserved as literal raw LaTeX text (styleId 'MathBlock' for the block form; the inline form keeps its own \( \) delimiters in the run text so src/emit/inline.ts's escapeMarkdownText can recognise and pass it through unescaped -- see src/inline/math.ts) -- MarkdownDiagnosticCodes.MATH_BLOCK_PRESERVED_AS_TEXT / MATH_INLINE_PRESERVED_AS_TEXT. Never parsed as LaTeX or converted to MathML here -- that is a documents.js question (ExaDev/documents.js#563).
//  - front matter (src/lower/front-matter.ts) -> a flat-scalar-only LayoutMetadata subset -- MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED.

import type { ContentBlock, ContentDocument, ContentParagraph, ContentRun, LayoutMetadata } from 'document-schema.js';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import type { MarkdownBlockNode, MarkdownHeadingNode, MarkdownListItemNode, MarkdownListNode, MarkdownParagraphNode } from '../ast/ast';
import type { MarkdownParseOptions, ParsedMarkdown } from '../block/block';
import { parseMarkdown } from '../block/block';
import { DEFAULT_FRONT_MATTER, DEFAULT_MARGINS, DEFAULT_RAW_HTML_MODE } from '../defaults/defaults';
import type { MarkdownDiagnosticSink } from '../diagnostics/diagnostics';
import { MarkdownDiagnosticCodes, MarkdownInputTooLargeError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from '../diagnostics/diagnostics';
import type { ReadMarkdownOptions } from '../options/options';
import type { NumIdMintState } from '../shared/list-id';
import { createNumIdMintState, mintedListType, mintListNumId } from '../shared/list-id';
import { CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, MATH_BLOCK_STYLE_ID, QUOTE_INDENT_PT, QUOTE_STYLE_ID, TASK_CHECKBOX_CHECKED, TASK_CHECKBOX_UNCHECKED, headingStyleId } from '../shared/style-constants';
import { extractFrontMatter } from './front-matter';
import type { MarkdownImageResolver } from './image';
import { resolveMarkdownImage } from './image';
import type { InlineLowerContext } from './inline';
import { lowerCodeBlockRun, lowerInlineNodes } from './inline';
import { lowerTable } from './table';

// lowerMarkdown/lowerParsedMarkdown accept ReadMarkdownOptions (src/options/options.ts) directly -- the same relationship src/emit/emit.ts's emitMarkdown already has with WriteMarkdownOptions, rather than a second, drift-prone options type of this module's own. src/read.ts's readMarkdown is consequently a thin wrapper over lowerMarkdown: diagnostics collection plus a signal check over this function's own real work.

interface ListMembership {
  readonly numId: string;
  readonly level: number;
}

interface BlockLowerContext {
  readonly sink: MarkdownDiagnosticSink;
  readonly images: MarkdownImageResolver | undefined;
  readonly rawHtmlMode: 'preserve' | 'drop';
  readonly numIdState: NumIdMintState;
  readonly quoteDepth: number;
  readonly list: ListMembership | undefined;
}

function inlineContext(context: BlockLowerContext): InlineLowerContext {
  return { sink: context.sink, rawHtml: context.rawHtmlMode };
}

// Applies the two cross-cutting decorations every leaf paragraph-shaped block picks up from its own enclosing context: blockquote nesting (indentLeftPt, and a 'Quote' styleId ONLY when the block did not already set a more specific one -- a heading, code block, thematic break, or preserved-HTML paragraph keeps its own styleId even while quoted) and list membership (ContentListMembership, when directly inside a list item).
function decorateParagraph(paragraph: ContentParagraph, context: BlockLowerContext): ContentParagraph {
  let result = paragraph;
  if (context.quoteDepth > 0) {
    result = { ...result, indentLeftPt: context.quoteDepth * QUOTE_INDENT_PT, ...(result.styleId === undefined ? { styleId: QUOTE_STYLE_ID } : {}) };
  }
  if (context.list !== undefined) {
    result = { ...result, list: { numId: context.list.numId, level: context.list.level } };
  }
  return result;
}

function lowerHeading(node: MarkdownHeadingNode, context: BlockLowerContext): ContentBlock[] {
  const paragraph: ContentParagraph = { kind: 'paragraph', runs: lowerInlineNodes(node.children, inlineContext(context)), styleId: headingStyleId(node.level), headingLevel: node.level };
  return [decorateParagraph(paragraph, context)];
}

// A top-level image (a direct child of the paragraph's own children, not nested inside emphasis/a link) splits the paragraph precisely at that point when it resolves to real bytes -- the full AST is already in hand at lowering time, so this is exact, unlike a reader that has to append images at the end as a fallback. An unresolved image (native data: URI decoding failed, no resolver was supplied, or the resolver itself returned undefined) is left IN its surrounding text segment, where src/lower/inline.ts's own 'image' case degrades it to an ordinary text run of alt text + hyperlink -- never a partially-invalid ContentImageBlock.
function lowerParagraph(node: MarkdownParagraphNode, context: BlockLowerContext): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const inlineCtx = inlineContext(context);
  let segment: MarkdownParagraphNode['children'] = [];

  const flushSegment = (force: boolean): void => {
    if (segment.length === 0 && !force) {
      return;
    }
    blocks.push(decorateParagraph({ kind: 'paragraph', runs: lowerInlineNodes(segment, inlineCtx) }, context));
    segment = [];
  };

  for (const child of node.children) {
    if (child.type !== 'image') {
      segment.push(child);
      continue;
    }
    const resolved = resolveMarkdownImage(child.destination, { alt: child.alt, title: child.title }, context.images);
    if (resolved === undefined) {
      context.sink({ code: MarkdownDiagnosticCodes.IMAGE_UNRESOLVED, severity: 'info', message: `image "${child.destination}" could not be resolved to real bytes; it degrades to a text run of its own alt text, hyperlinked at its own destination` });
      segment.push(child);
      continue;
    }
    if (child.title !== undefined) {
      context.sink({ code: MarkdownDiagnosticCodes.LINK_TITLE_DROPPED, severity: 'info', message: `image title "${child.title}" has no ContentImageBlock equivalent and was dropped` });
    }
    flushSegment(false);
    if (context.list !== undefined) {
      context.sink({ code: MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED, severity: 'info', message: 'a resolved image block directly inside a list item has no ContentListMembership field of its own -- only ContentParagraph carries .list -- so its association with the enclosing list item is lost' });
    }
    blocks.push({
      kind: 'image',
      format: resolved.format,
      base64: resolved.base64,
      widthPt: resolved.widthPt,
      heightPt: resolved.heightPt,
      ...(child.alt.length > 0 ? { altText: child.alt } : {}),
    });
  }
  flushSegment(blocks.length === 0);
  return blocks;
}

function lowerCodeBlock(node: Extract<MarkdownBlockNode, { type: 'codeBlock' }>, context: BlockLowerContext): ContentBlock[] {
  if (node.fenced && node.infoString !== undefined && node.infoString.length > 0) {
    context.sink({ code: MarkdownDiagnosticCodes.CODE_BLOCK_INFO_STRING_DROPPED, severity: 'info', message: `fenced code block's own info string "${node.infoString}" has no ContentParagraph equivalent and was dropped` });
  }
  const paragraph: ContentParagraph = { kind: 'paragraph', runs: [lowerCodeBlockRun(node.literal.replace(/\n$/, ''))], styleId: CODE_BLOCK_STYLE_ID };
  return [decorateParagraph(paragraph, context)];
}

function lowerThematicBreak(context: BlockLowerContext): ContentBlock[] {
  const paragraph: ContentParagraph = { kind: 'paragraph', runs: [], styleId: HORIZONTAL_RULE_STYLE_ID };
  return [decorateParagraph(paragraph, context)];
}

function lowerHtmlBlock(node: Extract<MarkdownBlockNode, { type: 'htmlBlock' }>, context: BlockLowerContext): ContentBlock[] {
  if (context.rawHtmlMode === 'drop') {
    context.sink({ code: MarkdownDiagnosticCodes.RAW_HTML_DROPPED, severity: 'info', message: 'block-level raw HTML was dropped per the rawHtml: "drop" option' });
    return [];
  }
  context.sink({ code: MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT, severity: 'info', message: 'block-level raw HTML was preserved as literal text (styleId "HTMLPreformatted"); it will not be rendered as HTML by any consumer of the resulting ContentDocument' });
  const literal = node.literal.replace(/\n+$/, '');
  const runs: ContentRun[] = literal.length === 0 ? [] : [{ text: literal }];
  const paragraph: ContentParagraph = { kind: 'paragraph', runs, styleId: HTML_PREFORMATTED_STYLE_ID };
  return [decorateParagraph(paragraph, context)];
}

// $$...$$ display math (ExaDev/markdown-codec#53) preserved as literal raw LaTeX text, styleId 'MathBlock' -- see src/emit/emit.ts's own inverse. Not parsed as LaTeX or converted to MathML here: that is a documents.js question (ExaDev/documents.js#563), and this package's own scope stops at recognising and round-tripping the syntax.
function lowerMathBlock(node: Extract<MarkdownBlockNode, { type: 'mathBlock' }>, context: BlockLowerContext): ContentBlock[] {
  context.sink({ code: MarkdownDiagnosticCodes.MATH_BLOCK_PRESERVED_AS_TEXT, severity: 'info', message: 'block math ($$...$$) was preserved as literal raw LaTeX text (styleId "MathBlock"); it is not parsed as LaTeX or converted to MathML by this package' });
  const literal = node.literal.replace(/\n$/, '');
  const runs: ContentRun[] = literal.length === 0 ? [] : [{ text: literal }];
  const paragraph: ContentParagraph = { kind: 'paragraph', runs, styleId: MATH_BLOCK_STYLE_ID };
  return [decorateParagraph(paragraph, context)];
}

function lowerBlockquote(node: Extract<MarkdownBlockNode, { type: 'blockquote' }>, context: BlockLowerContext, contentWidthPt: number): ContentBlock[] {
  if (context.quoteDepth >= 1) {
    context.sink({ code: MarkdownDiagnosticCodes.BLOCKQUOTE_NESTED_DEPTH, severity: 'info', message: `blockquote nesting beyond level 1 is represented only as a larger indentLeftPt (${String((context.quoteDepth + 1) * QUOTE_INDENT_PT)}pt); recovering the exact nesting depth back out is an approximation, not an exact inverse` });
  }
  const nested: BlockLowerContext = { ...context, quoteDepth: context.quoteDepth + 1 };
  const blocks = node.children.flatMap((child) => lowerBlock(child, nested, contentWidthPt));
  if (blocks.length === 0) {
    // An otherwise-empty blockquote (every child consumed away -- most commonly a lone link reference definition, which src/block/definitions.ts strips out entirely, leaving no paragraph behind) still needs a placeholder: there is no ContentBlock shape for "a bare blockquote container with nothing in it" other than an empty, indented paragraph.
    return [decorateParagraph({ kind: 'paragraph', runs: [] }, nested)];
  }
  return blocks;
}

// Prepends a GFM task-list checkbox glyph to the first block among `blocks` that is a ContentParagraph -- the item's own leading task-list-item marker was already stripped from the source text by src/block/block.ts's own extractTaskListMarker, so this is the only place that state (MarkdownListItemNode.checked) still needs to be represented. Returns whether a paragraph was found to apply it to; a `false` result (the item's own first block is a table or a resolved image, neither of which can carry a leading run at all) leaves the checkbox state unrepresented entirely -- a narrower, more severe version of the same LIST_ITEM_BLOCK_UNLISTED gap already reported for that block.
function applyTaskCheckbox(blocks: ContentBlock[], checked: boolean): boolean {
  const first = blocks[0];
  if (first?.kind !== 'paragraph') {
    return false;
  }
  const glyph = checked ? TASK_CHECKBOX_CHECKED : TASK_CHECKBOX_UNCHECKED;
  const checkboxRun: ContentRun = { text: `${glyph} ` };
  blocks[0] = { ...first, runs: [checkboxRun, ...first.runs] };
  return true;
}

function lowerListItem(item: MarkdownListItemNode, numId: string, level: number, context: BlockLowerContext, contentWidthPt: number): ContentBlock[] {
  const nonListChildCount = item.children.filter((child) => child.type !== 'list').length;
  if (nonListChildCount > 1) {
    context.sink({ code: MarkdownDiagnosticCodes.LIST_ITEM_MULTI_BLOCK_FLATTENED, severity: 'info', message: 'a list item directly containing more than one block loses its own item boundary once lowered -- ContentListMembership carries only numId/level, with no field distinguishing "one item, several blocks" from "several items sharing this numId/level"' });
  }

  const itemContext: BlockLowerContext = { ...context, list: { numId, level } };
  const blocks: ContentBlock[] = [];
  let checkboxApplied = item.checked === undefined;
  let ownLevelBlockCount = 0;
  for (const child of item.children) {
    if (child.type === 'list') {
      blocks.push(...lowerList(child, numId, level + 1, context, contentWidthPt));
      continue;
    }
    const childBlocks = lowerBlock(child, itemContext, contentWidthPt);
    ownLevelBlockCount += childBlocks.length;
    if (!checkboxApplied) {
      checkboxApplied = applyTaskCheckbox(childBlocks, item.checked === true);
    }
    blocks.push(...childBlocks);
  }
  if (ownLevelBlockCount === 0) {
    // A truly empty item (no children at all), or one whose sole content is a nested list, has nothing of its own to carry ContentListMembership(numId, level) on -- without a placeholder paragraph here, the item's own existence (and, when a nested list follows, that list's own nesting anchor) is lost entirely rather than degraded.
    const placeholder: ContentBlock[] = [decorateParagraph({ kind: 'paragraph', runs: [] }, itemContext)];
    if (!checkboxApplied) {
      applyTaskCheckbox(placeholder, item.checked === true);
    }
    blocks.unshift(...placeholder);
  }
  return blocks;
}

// Mints a fresh numId for a TOP-LEVEL list (ancestorNumId undefined) or reuses its enclosing list's numId, incrementing only `level`, for a nested one -- see src/shared/list-id.ts's own top-of-file note for the full grammar and why nesting never mints again.
function lowerList(node: MarkdownListNode, ancestorNumId: string | undefined, level: number, context: BlockLowerContext, contentWidthPt: number): ContentBlock[] {
  let numId: string;
  if (ancestorNumId === undefined) {
    const task = node.children.some((item) => item.checked !== undefined);
    numId = mintListNumId(context.numIdState, { type: node.markerType, start: node.start, task, loose: !node.tight });
  } else {
    numId = ancestorNumId;
    const mintedType = mintedListType(numId);
    if (mintedType !== undefined && mintedType !== node.markerType) {
      context.sink({ code: MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT, severity: 'warning', message: `a nested ${node.markerType} list sits under a list minted as ${mintedType}; the enclosing list's own marker type is kept (first-wins) and this nested list's own type is not separately represented` });
    }
  }
  return node.children.flatMap((item) => lowerListItem(item, numId, level, context, contentWidthPt));
}

function lowerBlock(node: MarkdownBlockNode, context: BlockLowerContext, contentWidthPt: number): ContentBlock[] {
  switch (node.type) {
    case 'paragraph':
      return lowerParagraph(node, context);
    case 'heading':
      return lowerHeading(node, context);
    case 'blockquote':
      return lowerBlockquote(node, context, contentWidthPt);
    case 'list':
      return lowerList(node, undefined, 0, context, contentWidthPt);
    case 'codeBlock':
      return lowerCodeBlock(node, context);
    case 'thematicBreak':
      return lowerThematicBreak(context);
    case 'htmlBlock':
      return lowerHtmlBlock(node, context);
    case 'mathBlock':
      return lowerMathBlock(node, context);
    case 'table': {
      if (context.list !== undefined) {
        context.sink({ code: MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED, severity: 'info', message: 'a table directly inside a list item has no ContentListMembership field of its own -- only ContentParagraph carries .list -- so its association with the enclosing list item is lost' });
      }
      return [lowerTable(node, contentWidthPt, inlineContext(context))];
    }
    case 'document':
    case 'listItem':
    case 'tableRow':
    case 'tableCell':
      // Unreachable through parseMarkdown's own toAstBlocks -- none of these four ever appears as a direct child of document/blockquote/listItem the way this function is called (a list's own items and a table's own rows are walked by lowerList/lowerTable directly, never handed to lowerBlock).
      return [];
  }
}

export function lowerParsedMarkdown(parsed: ParsedMarkdown, options: ReadMarkdownOptions = {}, metadata: LayoutMetadata = {}): ContentDocument {
  const sink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
  sink({ code: MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY, severity: 'info', message: 'markdown carries no page geometry of its own; the resulting ContentSection uses a synthesised page size and margins (ReadMarkdownOptions.pageSize/margins, or document-schema.js\'s own PAGE_SIZE_A4 default)' });

  const pageSize = options.pageSize ?? PAGE_SIZE_A4;
  const margins = options.margins ?? DEFAULT_MARGINS;
  const contentWidthPt = pageSize.widthPt - margins.leftPt - margins.rightPt;

  const context: BlockLowerContext = {
    sink,
    images: options.images,
    rawHtmlMode: options.rawHtml ?? DEFAULT_RAW_HTML_MODE,
    numIdState: createNumIdMintState(),
    quoteDepth: 0,
    list: undefined,
  };

  const blocks = parsed.document.children.flatMap((child) => lowerBlock(child, context, contentWidthPt));

  return {
    kind: 'wordprocessing',
    metadata,
    sections: [{ pageSize, margins, blocks }],
  };
}

// The convenience, read.ts-independent entry point this package's own test suite (and src/read.ts's real readMarkdown) drives: input-size enforcement, front matter extraction (when requested), block parsing, and lowering, composed in one call over raw markdown TEXT rather than an already-parsed AST.
export function lowerMarkdown(source: string, options: ReadMarkdownOptions = {}): ContentDocument {
  if (options.maxInputBytes !== undefined) {
    const actualBytes = new TextEncoder().encode(source).length;
    if (actualBytes > options.maxInputBytes) {
      throw new MarkdownInputTooLargeError(options.maxInputBytes, actualBytes);
    }
  }

  const sink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
  const { metadata, rest } = (options.frontMatter ?? DEFAULT_FRONT_MATTER) ? extractFrontMatter(source, sink) : { metadata: {}, rest: source };
  const parseOptions: MarkdownParseOptions = {
    gfmTables: options.gfmTables,
    gfmAutolinks: options.gfmAutolinks,
    gfmStrikethrough: options.gfmStrikethrough,
    gfmTaskLists: options.gfmTaskLists,
    maxNesting: options.maxBlockNesting,
    sink,
  };
  const parsed = parseMarkdown(rest, parseOptions);
  return lowerParsedMarkdown(parsed, options, metadata);
}
