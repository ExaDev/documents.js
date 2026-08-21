// The AST -> ContentDocument lowering stage: this package's own counterpart to ooxml.js's readDocx/readPptx and odf.js's readOdt/readOdp -- a thin adapter from parseMarkdown's own AST onto document-schema.js's shared ContentDocument pivot, not a second parser. Every mapping below, and the stable diagnostic code its own gap is recorded under (MarkdownDiagnosticCodes, src/diagnostics/diagnostics.ts), mirrors this package's own construct-by-construct design table:
//
//  - document envelope -> one ContentSection, A4 + 1in default page geometry, overridable via ReadMarkdownOptions.pageSize/margins -- MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY (markdown has no page concept of its own; this ALWAYS fires, once per lowered document).
//  - ATX/setext heading -> styleId "Heading1".."Heading6", mirroring odf.js's readOdt convention exactly (src/shared/style-constants.ts's headingStyleId), plus the canonical ContentParagraph.headingLevel document-schema.js defines -- the level number itself (always 1-6 here: ATX/setext cap at six), so a consumer that never learned this package's own styleId spelling still knows the heading's depth.
//  - emphasis/strong/strikethrough -> italic/bold/strike ContentRun fields; links/autolinks -> ContentRun.hyperlink; code spans -> a Courier New run; hard/soft breaks -> literal '\n'/' ' -- all in src/lower/inline.ts, alongside MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED and LINK_TITLE_DROPPED.
//  - fenced/indented code block -> one paragraph, styleId 'CodeBlock', '\n'-joined literal, monospace. A fence's info string splits at its first word (splitInfoString below): the language word rides ContentParagraph.codeLanguage semantically, and any pandoc-style attribute remainder quarantines as markdown residue on the same paragraph for this package's own writer to re-emit verbatim -- nothing is dropped, so the row carries no diagnostic code of its own any more.
//  - blockquote -> a `division` construct's boundary-marker pair (one per nesting level, the container boundary and exact depth the indent alone never carried) wrapping blocks that keep styleId 'Quote' plus indentLeftPt per level as the materialised formatting; a heading inside a quote keeps its own Heading{N} styleId (decorateParagraph below only applies 'Quote' when nothing more specific already set a styleId) -- MarkdownDiagnosticCodes.BLOCKQUOTE_CONTAINER_SKIPPED for the one quote shape that cannot carry the pair (see lowerBlockquote).
//  - thematic break -> an empty paragraph, styleId 'HorizontalRule' -- deliberately NOT ContentPageBreak (would inject a spurious page break into every generated PDF/docx this ContentDocument later feeds). Whether a consumer that does not resolve styleId at all renders this invisibly is a property of THAT consumer, not something this package's own read pipeline can detect or diagnose, so it carries no code of its own.
//  - lists (bullet/ordered/task) -> flat ContentListMembership numId/level, encoding ordered-vs-unordered/task/tight-loose into the numId string itself (src/shared/list-id.ts) -- MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT (a nested list's own marker type disagrees with its numId's minted type), LIST_ITEM_BLOCK_UNLISTED (a table or a resolved image directly inside an item -- ContentListMembership lives only on ContentParagraph), LIST_ITEM_MULTI_BLOCK_FLATTENED (more than one non-nested-list block directly inside one item loses its own item-boundary identity).
//  - GFM tables -> ContentTable, src/lower/table.ts.
//  - images -> ContentImageBlock via a synchronous MarkdownImageResolver port (src/lower/image.ts) -- MarkdownDiagnosticCodes.IMAGE_UNRESOLVED when the resolver (or native data: URI decoding) cannot produce a real PNG/JPEG; the image degrades to a text run of alt text + hyperlink, NEVER an invalid ContentImageBlock. A top-level image (a direct child of a paragraph) splits that paragraph precisely at the point it occurs; a nested one (inside emphasis/a link) never resolves at all -- see src/lower/inline.ts's own top-of-file note.
//  - raw HTML -> preserved as literal text by default (styleId 'HTMLPreformatted' for block-level HTML), a rawHtml: 'drop' option available -- MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT / RAW_HTML_DROPPED.
//  - $$ display math (ExaDev/markdown-codec#53) -> one embedded FORMULA object whose presentation layer carries the LaTeX verbatim (lowerMathBlock below); \( \) inline math stays a Cambria-Math-marked run (src/lower/inline.ts, the run-level extent a formula is not) -- MarkdownDiagnosticCodes.MATH_INLINE_PRESERVED_AS_TEXT for the inline half. Neither is parsed as LaTeX or converted to MathML here -- that is a documents.js question (ExaDev/documents.js#563).
//  - front matter (src/lower/front-matter.ts) -> a flat-scalar-only LayoutMetadata subset -- MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED.
//  - footnote definition (ExaDev/markdown-codec#66) -> an `anchor` construct's boundary-marker pair (document-schema.js 4.2.0) bracketing its own lowered body blocks; the reference site is a point run-level `anchor` extent on the paragraph it sits inside (src/lower/inline.ts) -- MarkdownDiagnosticCodes.FOOTNOTE_BODY_HEADING_FLATTENED. See lowerFootnoteDefinition below for why the body rides the construct's extent rather than AnchorDescriptor's own `definition` field.

import type { AnchorDescriptor, ContentBlock, ContentDocument, ContentParagraph, ContentRun, LayoutMetadata, RunConstructExtent } from 'document-schema.js';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import type { MarkdownBlockNode, MarkdownFootnoteDefinitionNode, MarkdownHeadingNode, MarkdownListItemNode, MarkdownListNode, MarkdownParagraphNode } from '../ast/ast';
import type { MarkdownParseOptions, ParsedMarkdown } from '../block/block';
import type { LinkReferenceMap } from '../inline/link';
import { parseMarkdown } from '../block/block';
import { DEFAULT_FRONT_MATTER, DEFAULT_MARGINS, DEFAULT_RAW_HTML_MODE } from '../defaults/defaults';
import type { MarkdownDiagnosticSink } from '../diagnostics/diagnostics';
import { MarkdownDiagnosticCodes, MarkdownInputTooLargeError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from '../diagnostics/diagnostics';
import type { ReadMarkdownOptions } from '../options/options';
import type { NumIdMintState } from '../shared/list-id';
import { createNumIdMintState, mintListItemId, mintedListType, mintListNumId } from '../shared/list-id';
import { CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, QUOTE_INDENT_PT, QUOTE_STYLE_ID, headingStyleId } from '../shared/style-constants';
import type { FrontMatterResult } from './front-matter';
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
  readonly checked?: boolean;
  readonly itemId?: string;
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
    result = { ...result, list: { ...context.list } };
  }
  return result;
}

// Splices a lowered inline sequence's run-level construct extents (a titled link's annotation extent, a footnote reference's point anchor) onto the paragraph being built, as that paragraph's own constructs field -- absent when the sequence opened none, which is the overwhelming common case.
function paragraphWithConstructs(runs: ContentRun[], runConstructExtents: readonly RunConstructExtent[]): Pick<ContentParagraph, 'runs' | 'constructs'> {
  return { runs, ...(runConstructExtents.length > 0 ? { constructs: [...runConstructExtents] } : {}) };
}

function lowerHeading(node: MarkdownHeadingNode, context: BlockLowerContext): ContentBlock[] {
  const inline = lowerInlineNodes(node.children, inlineContext(context));
  const paragraph: ContentParagraph = { kind: 'paragraph', ...paragraphWithConstructs(inline.runs, inline.runConstructExtents), styleId: headingStyleId(node.level), headingLevel: node.level };
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
    const inline = lowerInlineNodes(segment, inlineCtx);
    blocks.push(decorateParagraph({ kind: 'paragraph', ...paragraphWithConstructs(inline.runs, inline.runConstructExtents) }, context));
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
    flushSegment(false);
    if (context.list !== undefined) {
      context.sink({ code: MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED, severity: 'info', message: 'a resolved image block directly inside a list item has no ContentListMembership field of its own -- only ContentParagraph carries .list -- so its association with the enclosing list item is lost' });
    }
    const image: ContentBlock = {
      kind: 'image',
      format: resolved.format,
      base64: resolved.base64,
      widthPt: resolved.widthPt,
      heightPt: resolved.heightPt,
      ...(child.alt.length > 0 ? { altText: child.alt } : {}),
    };
    // The resolved-image title is the block-scoped arm of the same `link`-construct annotation an inline title rides: ContentImageBlock has no title field and no constructs field, so the pair brackets the image itself, and the descriptor's target carries the ORIGINAL destination into the bargain -- a fact even a title-less resolved image loses today (its bytes re-embed as a data: URI on the way out), but scoped here to the titled case this row is about.
    if (child.title === undefined) {
      blocks.push(image);
      continue;
    }
    blocks.push({ kind: 'constructStart', descriptor: { kind: 'link', target: { kind: 'external', uri: child.destination }, title: child.title } }, image, { kind: 'constructEnd' });
  }
  flushSegment(blocks.length === 0);
  return blocks;
}

// A fence's info string splits at its first word: that word is the language (CommonMark's own "the first word of the info string is typically used to specify the language") and lands semantically on ContentParagraph.codeLanguage; everything after it is pandoc-style attribute syntax with no cross-format meaning and quarantines as markdown residue on the same paragraph, restorable verbatim by this package's own writer. One carve-out: an info string opening with `{` is an attribute block with no language word at all, so the whole string rides the residue and codeLanguage stays absent -- a language vocabulary never starts with an attribute opener. The AST's own info string is already unescaped and trimmed, so the split works on cleaned text and the writer re-emits the two halves joined by one space (a run of whitespace between them normalises to that single space -- the only reconstruction choice this makes).
function splitInfoString(infoString: string): { readonly language: string | undefined; readonly remainder: string | undefined } {
  const firstWhitespace = infoString.search(/\s/);
  if (firstWhitespace === -1) {
    return infoString.startsWith('{') ? { language: undefined, remainder: infoString } : { language: infoString, remainder: undefined };
  }
  const firstWord = infoString.slice(0, firstWhitespace);
  const remainder = infoString.slice(firstWhitespace).trim();
  if (firstWord.startsWith('{')) {
    return { language: undefined, remainder: infoString.trim() };
  }
  return { language: firstWord, remainder: remainder.length > 0 ? remainder : undefined };
}

function lowerCodeBlock(node: Extract<MarkdownBlockNode, { type: 'codeBlock' }>, context: BlockLowerContext): ContentBlock[] {
  const info = node.fenced && node.infoString !== undefined && node.infoString.length > 0 ? splitInfoString(node.infoString) : { language: undefined, remainder: undefined };
  const paragraph: ContentParagraph = {
    kind: 'paragraph',
    runs: [lowerCodeBlockRun(node.literal.replace(/\n$/, ''))],
    styleId: CODE_BLOCK_STYLE_ID,
    ...(info.language !== undefined ? { codeLanguage: info.language } : {}),
    ...(info.remainder !== undefined ? { source: { format: 'markdown', xml: info.remainder } } : {}),
  };
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
  context.sink({ code: MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT, severity: 'info', message: 'block-level raw HTML was preserved as literal text (styleId "HTMLPreformatted"); it will not be rendered as HTML by any consumer of the resulting ContentDocument, and its verbatim original rides the paragraph\'s own markdown residue for this package\'s writer to re-emit as-is' });
  const literal = node.literal.replace(/\n+$/, '');
  const runs: ContentRun[] = literal.length === 0 ? [] : [{ text: literal }];
  // The residue carries the UNTRIMMED literal: the runs strip trailing newlines because those are block separators, not content, but the restorable tier re-emits the block exactly as it stood.
  const paragraph: ContentParagraph = { kind: 'paragraph', runs, styleId: HTML_PREFORMATTED_STYLE_ID, source: { format: 'markdown', xml: node.literal } };
  return [decorateParagraph(paragraph, context)];
}

// $$...$$ display math (ExaDev/markdown-codec#53) becomes an embedded FORMULA object -- the one block-level carrier a wordprocessing ContentDocument has for a ContentFormula -- with the literal LaTeX verbatim in the formula's rendering-authoritative presentation layer, no MathML (markdown carried none to read), and no semantic content layer (nobody has lowered this LaTeX to semantics; that is a documents.js question, ExaDev/documents.js#563, not something this package does on the way past). The frame is the zero box: an in-flow markdown block has no page position or intrinsic size to record, and ContentEmbeddedObjectBlock's frame is required -- origin-and-zero is the same "positioned by the flow, no size fact" spelling ooxml.js's own inline OLE reader established for the identical constraint.
function lowerMathBlock(node: Extract<MarkdownBlockNode, { type: 'mathBlock' }>, context: BlockLowerContext): ContentBlock[] {
  if (context.list !== undefined) {
    context.sink({ code: MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED, severity: 'info', message: 'a display-math block directly inside a list item has no ContentListMembership field of its own -- only ContentParagraph carries .list -- so its association with the enclosing list item is lost' });
  }
  return [
    {
      kind: 'embeddedObject',
      objectKind: 'formula',
      document: { kind: 'formula', metadata: {}, formula: { mathml: [], presentation: { latex: node.literal.replace(/\n$/, '') } } },
      frame: { xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 },
    },
  ];
}

// Whether a blockquote's own subtree holds a heading anywhere (directly, or nested inside a further quote or a list item). A heading inside a construct extent ALWAYS leaves a heading scope standing at the extent's closing marker -- the last heading in the extent can never be closed by a shallower one also inside it -- and document-schema.js forbids a producer from emitting a pair whose extent opens or closes a heading scope (decompose is the enforcement point and rejects rather than repairs). A quote containing a heading therefore cannot carry the division pair at all; its structure stays approximated by the indent alone, exactly as every quote was before the division carry landed, and the heading itself keeps its heading fidelity.
function blockquoteSubtreeContainsHeading(node: Extract<MarkdownBlockNode, { type: 'blockquote' }>): boolean {
  const walk = (block: MarkdownBlockNode): boolean => {
    switch (block.type) {
      case 'heading':
        return true;
      case 'blockquote':
      case 'list':
      case 'listItem':
        return block.children.some(walk);
      default:
        return false;
    }
  };
  return node.children.some(walk);
}

// A blockquote becomes a `division` construct pair (document-schema.js's arbitrarily nestable grouping of block flow -- tagged PDF /Sect is the cross-format analogue) bracketing the quote's lowered blocks, one pair per nesting level for a quoted quote: the pair is what carries the CONTAINER boundary and the exact depth, both of which indentLeftPt alone never held (same-depth adjacent quotes were indistinguishable from one multi-block quote; depth beyond level 1 was an approximation). The indent and 'Quote' styleId stay on the inner blocks as the materialised formatting, the same dual-carry a titled link's runs play -- a consumer that ignores constructs still sees an indented, Quote-styled paragraph, and this package's own writer recognises the pair-plus-indent pair as its own spelling rather than guessing at a foreign division.
function lowerBlockquote(node: Extract<MarkdownBlockNode, { type: 'blockquote' }>, context: BlockLowerContext, contentWidthPt: number): ContentBlock[] {
  const nested: BlockLowerContext = { ...context, quoteDepth: context.quoteDepth + 1 };
  const blocks = node.children.flatMap((child) => lowerBlock(child, nested, contentWidthPt));
  // An otherwise-empty blockquote (every child consumed away -- most commonly a lone link reference definition, which src/block/definitions.ts strips out entirely, leaving no paragraph behind) still needs a placeholder: there is no ContentBlock shape for "a bare blockquote container with nothing in it" other than an empty, indented paragraph.
  const inner = blocks.length === 0 ? [decorateParagraph({ kind: 'paragraph', runs: [] }, nested)] : blocks;
  if (blockquoteSubtreeContainsHeading(node)) {
    context.sink({ code: MarkdownDiagnosticCodes.BLOCKQUOTE_CONTAINER_SKIPPED, severity: 'info', message: 'a blockquote containing a heading cannot carry its division construct -- a marker extent may not open a heading scope, and the last heading inside an extent always leaves one standing -- so this quote degrades to indent-only structure while the heading keeps its heading fidelity' });
    return inner;
  }
  return [{ kind: 'constructStart', descriptor: { kind: 'division' } }, ...inner, { kind: 'constructEnd' }];
}

// Lowering one list item: every block the item directly contains carries the SAME membership -- numId, level, a minted itemId identifying this one item across those blocks, and the GFM checkbox state when the item is a task item (document-schema.js's ContentListMembership.checked, the field that retired this package's old checkbox-glyph prepend: the state now rides the membership instead of a text run, so it survives even when the item's first block is one the glyph could never be prepended to). A table or resolved image directly inside the item still carries no membership of its own -- only ContentParagraph has the field -- which remains LIST_ITEM_BLOCK_UNLISTED's gap.
function lowerListItem(item: MarkdownListItemNode, numId: string, level: number, context: BlockLowerContext, contentWidthPt: number): ContentBlock[] {
  const membership: ListMembership = {
    numId,
    level,
    ...(item.checked !== undefined ? { checked: item.checked } : {}),
    itemId: mintListItemId(context.numIdState),
  };
  const itemContext: BlockLowerContext = { ...context, list: membership };
  const blocks: ContentBlock[] = [];
  let ownLevelBlockCount = 0;
  for (const child of item.children) {
    if (child.type === 'list') {
      blocks.push(...lowerList(child, numId, level + 1, context, contentWidthPt));
      continue;
    }
    const childBlocks = lowerBlock(child, itemContext, contentWidthPt);
    ownLevelBlockCount += childBlocks.length;
    blocks.push(...childBlocks);
  }
  if (ownLevelBlockCount === 0) {
    // A truly empty item (no children at all), or one whose sole content is a nested list, has nothing of its own to carry ContentListMembership(numId, level) on -- without a placeholder paragraph here, the item's own existence (and, when a nested list follows, that list's own nesting anchor) is lost entirely rather than degraded. The placeholder carries the full membership, checked state included, so a task item wrapping only a nested list keeps its checkbox.
    blocks.unshift(decorateParagraph({ kind: 'paragraph', runs: [] }, itemContext));
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

// Rewrites every heading inside a footnote definition's own body into an ordinary paragraph carrying the heading's ATX spelling as leading literal text, recursively through the containers a body may hold.
//
// This is the one thing a footnote body cannot carry, and the reason is the construct boundary markers' own binding contract rather than anything about markdown: a marker pair's extent may not cross a heading-group scope boundary, and a heading INSIDE the extent both closes whatever heading scope was open outside it when the pair started (a `# H` in a footnote written under a `## Section`) and opens one that would still be standing at the closing marker. document-schema.js states that a producer must never emit such a pair, and that decompose rejects rather than repairs one -- so the choice here is between emitting a pair no consumer may accept and carrying the heading as text. The text form round-trips: `#` is escaped on the way out and unescaped identically on the way back in, so a second pass through this pipeline reproduces the same document.
//
// Deliberately unconditional rather than "only when a shallower heading is actually open outside": the level comparison would make one footnote's fidelity depend on which heading happens to precede it, so the same body would lower two different ways in two documents. A heading inside a footnote is a degenerate shape in the first place; a single, position-independent rule is the one a consumer can reason about.
function flattenFootnoteBodyHeadings(node: MarkdownBlockNode, context: BlockLowerContext): MarkdownBlockNode {
  switch (node.type) {
    case 'heading':
      context.sink({ code: MarkdownDiagnosticCodes.FOOTNOTE_BODY_HEADING_FLATTENED, severity: 'info', message: `a level-${String(node.level)} heading inside a footnote definition's body is carried as literal ATX text: a construct boundary marker's extent may not contain a block that opens or closes a heading scope, so the heading cannot stay a heading inside the anchor construct the definition lowers to` });
      return { type: 'paragraph', children: [{ type: 'text', value: `${'#'.repeat(node.level)} ` }, ...node.children] };
    case 'blockquote':
      return { type: 'blockquote', children: node.children.map((child) => flattenFootnoteBodyHeadings(child, context)) };
    case 'list':
      return { ...node, children: node.children.map((item) => flattenFootnoteBodyHeadingsInItem(item, context)) };
    case 'listItem':
      return flattenFootnoteBodyHeadingsInItem(node, context);
    default:
      return node;
  }
}

function flattenFootnoteBodyHeadingsInItem(item: MarkdownListItemNode, context: BlockLowerContext): MarkdownListItemNode {
  return { ...item, children: item.children.map((child) => flattenFootnoteBodyHeadings(child, context)) };
}

// A footnote definition becomes an `anchor` construct: a constructStart carrying the descriptor, the definition's own lowered body blocks, and a constructEnd -- document-schema.js 4.2.0's flat-form encoding of the construct group its package tree already had.
//
// Why the body rides the construct's EXTENT rather than AnchorDescriptor's own `definition` field: that field is documented as "the definitions-table key holding this marker's body", and a definitions table is a DocumentPackage root field. A flat ContentDocument -- the only shape any codec in this family produces -- has no root to carry one, so there is no key to name and the field stays absent. The extent is not a workaround for that: a footnote body is genuinely block content (several paragraphs, a code block, a table), which a string field could not have held either way, and AnchorDescriptor's own note says outright that a ranged anchor "wraps the blocks it spans". A consumer that later factors these documents into a package is free to move the body into a definitions entry and populate `definition` then; nothing here has to be undone for it to.
//
// A definition with an empty body (`[^1]:` and nothing else) lowers to a pair with no blocks between the markers -- the point anchor the same descriptor note describes, not a special case.
function lowerFootnoteDefinition(node: MarkdownFootnoteDefinitionNode, context: BlockLowerContext, contentWidthPt: number): ContentBlock[] {
  const descriptor: AnchorDescriptor = { kind: 'anchor', anchorType: 'footnote', name: node.label };
  const body = node.children.flatMap((child) => lowerBlock(flattenFootnoteBodyHeadings(child, context), context, contentWidthPt));
  return [{ kind: 'constructStart', descriptor }, ...body, { kind: 'constructEnd' }];
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
    case 'footnoteDefinition':
      return lowerFootnoteDefinition(node, context, contentWidthPt);
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
// What one full text -> ContentDocument lowering run produced BESIDES the document itself: the document-global link reference definition table src/block/definitions.ts built (a fact the flat ContentDocument has no root to carry -- the tree-level readMarkdown splices it into the package's own definitions table), and the verbatim front-matter block when one was extracted (the same story for the package-level source residue table).
export interface LoweredMarkdownDetail {
  readonly document: ContentDocument;
  readonly references: LinkReferenceMap;
  readonly frontMatterSource: string | undefined;
}

// The convenience, read.ts-independent entry point this package's own test suite (and src/read.ts's real readMarkdown) drives: input-size enforcement, front matter extraction (when requested), block parsing, and lowering, composed in one call over raw markdown TEXT rather than an already-parsed AST. The detailed variant additionally surfaces the reference table and the raw front-matter block for the tree-level read to carry; lowerMarkdown itself returns the document alone, exactly as it always has.
export function lowerMarkdownDetailed(source: string, options: ReadMarkdownOptions = {}): LoweredMarkdownDetail {
  if (options.maxInputBytes !== undefined) {
    const actualBytes = new TextEncoder().encode(source).length;
    if (actualBytes > options.maxInputBytes) {
      throw new MarkdownInputTooLargeError(options.maxInputBytes, actualBytes);
    }
  }

  const sink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
  const frontMatter = options.frontMatter ?? DEFAULT_FRONT_MATTER;
  const untouched: FrontMatterResult = { metadata: {}, rest: source, source: undefined };
  const extracted = frontMatter ? extractFrontMatter(source, sink) : untouched;
  const parseOptions: MarkdownParseOptions = {
    gfmTables: options.gfmTables,
    gfmAutolinks: options.gfmAutolinks,
    gfmStrikethrough: options.gfmStrikethrough,
    gfmTaskLists: options.gfmTaskLists,
    footnotes: options.footnotes,
    maxNesting: options.maxBlockNesting,
    sink,
  };
  const parsed = parseMarkdown(extracted.rest, parseOptions);
  return { document: lowerParsedMarkdown(parsed, options, extracted.metadata), references: parsed.references, frontMatterSource: extracted.source };
}

export function lowerMarkdown(source: string, options: ReadMarkdownOptions = {}): ContentDocument {
  return lowerMarkdownDetailed(source, options).document;
}
