// This package's own markdown AST node types -- the intermediate representation src/block/src/inline build and src/lower/ consumes to produce a ContentDocument. Every block node type carries its own children shape (a document/paragraph/blockquote/listItem holds further block or inline children; a table/tableRow/tableCell holds the GFM table shape specifically); every inline node type is a leaf or holds further inline children.
//
// Deliberately NO Zod schema here, matching pdf-codec's own PdfObject precedent exactly (see that package's src/objects.ts top-of-file comment): this type never crosses a public boundary, never round-trips through JSON, and is constructed and consumed exclusively by this package's own scan/block/inline/lower pipeline -- validating it would be validating our own output. Narrowing is plain TypeScript control flow on each node's own `type` discriminant (a switch or `===` check), the same reason PdfObject picks a hand-written discriminant over z.lazy/z.discriminatedUnion for its own recursive type.

export interface MarkdownPosition {
  // 1-based line/column, matching src/scan's own ScanPosition convention. Column is tab-expanded (see src/scan) -- it measures the position a human editor would show, not a raw string index.
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export type MarkdownNode = MarkdownBlockNode | MarkdownInlineNode;

// --- Block nodes ---

export type MarkdownBlockNode =
  | MarkdownDocumentNode
  | MarkdownParagraphNode
  | MarkdownHeadingNode
  | MarkdownBlockquoteNode
  | MarkdownListNode
  | MarkdownListItemNode
  | MarkdownCodeBlockNode
  | MarkdownThematicBreakNode
  | MarkdownHtmlBlockNode
  | MarkdownTableNode
  | MarkdownTableRowNode
  | MarkdownTableCellNode
  | MarkdownMathBlockNode;

export interface MarkdownDocumentNode {
  readonly type: 'document';
  readonly children: MarkdownBlockNode[];
  readonly position?: MarkdownPosition;
}

export interface MarkdownParagraphNode {
  readonly type: 'paragraph';
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}

export type MarkdownHeadingStyle = 'atx' | 'setext';

export interface MarkdownHeadingNode {
  readonly type: 'heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly style: MarkdownHeadingStyle;
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}

export interface MarkdownBlockquoteNode {
  readonly type: 'blockquote';
  readonly children: MarkdownBlockNode[];
  readonly position?: MarkdownPosition;
}

export type MarkdownListMarkerType = 'bullet' | 'ordered';
export type MarkdownBulletMarker = '-' | '*' | '+';
export type MarkdownOrderedListDelimiter = '.' | ')';

export interface MarkdownListNode {
  readonly type: 'list';
  readonly markerType: MarkdownListMarkerType;
  // Present only when markerType is 'bullet'.
  readonly bulletMarker?: MarkdownBulletMarker;
  // Present only when markerType is 'ordered'.
  readonly orderedDelimiter?: MarkdownOrderedListDelimiter;
  readonly start?: number;
  // CommonMark's own tight/loose distinction: a list is loose if any constituent list item is separated from its neighbours by a blank line, or if any item directly contains two block-level elements with a blank line between them.
  readonly tight: boolean;
  readonly children: MarkdownListItemNode[];
  readonly position?: MarkdownPosition;
}

export interface MarkdownListItemNode {
  readonly type: 'listItem';
  // GFM task list item checkbox state ([ ] / [x]) -- undefined when the item is not a task list item at all, matching how MarkdownImageNode.widthPx/heightPx are undefined rather than a sentinel when unresolved.
  readonly checked?: boolean;
  readonly children: MarkdownBlockNode[];
  readonly position?: MarkdownPosition;
}

export interface MarkdownCodeBlockNode {
  readonly type: 'codeBlock';
  readonly fenced: boolean;
  // Present only when fenced is true.
  readonly fenceChar?: '`' | '~';
  // The fence's own info string (e.g. the language after ```), present only when fenced and non-empty.
  readonly infoString?: string;
  readonly literal: string;
  readonly position?: MarkdownPosition;
}

export interface MarkdownThematicBreakNode {
  readonly type: 'thematicBreak';
  readonly position?: MarkdownPosition;
}

export interface MarkdownHtmlBlockNode {
  readonly type: 'htmlBlock';
  // The block's literal source text, verbatim -- CommonMark does not require block HTML to be balanced or otherwise valid, so this is never parsed as markup, only recognised by its own start/end conditions (src/html).
  readonly literal: string;
  readonly position?: MarkdownPosition;
}

export type MarkdownTableAlignment = 'left' | 'right' | 'center' | 'none';

export interface MarkdownTableNode {
  readonly type: 'table';
  // One entry per column, in column order, from the table's own delimiter row.
  readonly alignments: MarkdownTableAlignment[];
  // The first row is always the header row (its own `header` field is true); every subsequent row is a body row.
  readonly children: MarkdownTableRowNode[];
  readonly position?: MarkdownPosition;
}

export interface MarkdownTableRowNode {
  readonly type: 'tableRow';
  readonly header: boolean;
  readonly children: MarkdownTableCellNode[];
  readonly position?: MarkdownPosition;
}

export interface MarkdownTableCellNode {
  readonly type: 'tableCell';
  // A GFM table cell holds inline content only -- no nested block content, unlike a docx/odt table cell.
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}

// Pandoc/GitHub math-extension display math: a $$ line, raw LaTeX content, a closing $$ line (ExaDev/markdown-codec#53). Modelled on MarkdownCodeBlockNode's own fenced convention -- literal is the content BETWEEN the two delimiter lines, never including them (src/block/block.ts's tryMathBlockStart/finalizeMathBlock regenerate a fresh $$ pair on the way back out, exactly as a fenced code block regenerates its own fence rather than preserving the original). Never parsed as LaTeX or converted to MathML by this package -- src/lower/lower.ts preserves it as literal text; that conversion is a documents.js question (ExaDev/documents.js#563).
export interface MarkdownMathBlockNode {
  readonly type: 'mathBlock';
  readonly literal: string;
  readonly position?: MarkdownPosition;
}

// --- Inline nodes ---

export type MarkdownInlineNode =
  | MarkdownTextNode
  | MarkdownEmphasisNode
  | MarkdownStrongNode
  | MarkdownStrikethroughNode
  | MarkdownCodeSpanNode
  | MarkdownLinkNode
  | MarkdownImageNode
  | MarkdownAutolinkNode
  | MarkdownHardBreakNode
  | MarkdownSoftBreakNode
  | MarkdownRawHtmlNode
  | MarkdownEntityNode
  | MarkdownMathInlineNode;

export type MarkdownEmphasisMarker = '_' | '*';

export interface MarkdownTextNode {
  readonly type: 'text';
  readonly value: string;
  readonly position?: MarkdownPosition;
}

export interface MarkdownEmphasisNode {
  readonly type: 'emphasis';
  readonly marker: MarkdownEmphasisMarker;
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}

export interface MarkdownStrongNode {
  readonly type: 'strong';
  readonly marker: MarkdownEmphasisMarker;
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}

export interface MarkdownStrikethroughNode {
  readonly type: 'strikethrough';
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}

export interface MarkdownCodeSpanNode {
  readonly type: 'codeSpan';
  readonly literal: string;
  readonly position?: MarkdownPosition;
}

export interface MarkdownLinkNode {
  readonly type: 'link';
  readonly destination: string;
  readonly title?: string;
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}

export interface MarkdownImageNode {
  readonly type: 'image';
  readonly destination: string;
  readonly title?: string;
  // The image description flattened to plain text, per CommonMark's own rule that an image's inline content becomes its alt text rather than being rendered as nested inline markup.
  readonly alt: string;
  // Resolved by src/image's readImageDimensions for a data: URI image, only when ReadMarkdownOptions.images is enabled -- undefined for a remote (http/https/relative-path) image src/lower has no bytes to inspect, or when dimension resolution is disabled or the image bytes could not be measured.
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly position?: MarkdownPosition;
}

export interface MarkdownAutolinkNode {
  readonly type: 'autolink';
  // The URI or email address exactly as written between < and > -- CommonMark autolinks are never re-encoded.
  readonly destination: string;
  readonly email: boolean;
  readonly position?: MarkdownPosition;
}

export interface MarkdownHardBreakNode {
  readonly type: 'hardBreak';
  readonly position?: MarkdownPosition;
}

export interface MarkdownSoftBreakNode {
  readonly type: 'softBreak';
  readonly position?: MarkdownPosition;
}

export interface MarkdownRawHtmlNode {
  readonly type: 'rawHtml';
  readonly literal: string;
  readonly position?: MarkdownPosition;
}

export interface MarkdownEntityNode {
  readonly type: 'entity';
  // The literal source text, e.g. '&amp;', '&#169;', or '&#x3C;'.
  readonly raw: string;
  // The resolved character(s) the entity decodes to -- may be more than one UTF-16 code unit (a named reference can map to more than one codepoint, e.g. '&NotEqualTilde;').
  readonly value: string;
  readonly position?: MarkdownPosition;
}

// Pandoc/GitHub math-extension inline math: \( \) (ExaDev/markdown-codec#53). Deliberately NOT single-dollar $...$ -- the classic currency false-positive failure mode. Modelled on MarkdownCodeSpanNode's own convention: literal is the INNER LaTeX only, \( and \) excluded -- src/lower/inline.ts marks the lowered run with a dedicated ContentRun.fontFamily (MATH_INLINE_FONT_MARKER, src/shared/style-constants.ts, the same opportunistic-reuse trick a code span's own Courier New marker already plays) rather than folding the delimiters into the run's own text, because escapeMarkdownText (src/emit/inline.ts) backslash-escapes literal '(' and ')' in ORDINARY text -- a self-describing "\(...\) in the text is always math" rule would misrecognise any ordinary escaped parenthetical remark as math on reparse. Never parsed as LaTeX or converted to MathML by this package -- that conversion is a documents.js question (ExaDev/documents.js#563).
export interface MarkdownMathInlineNode {
  readonly type: 'mathInline';
  readonly literal: string;
  readonly position?: MarkdownPosition;
}

const BLOCK_NODE_TYPES: ReadonlySet<string> = new Set<MarkdownBlockNode['type']>([
  'document',
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'listItem',
  'codeBlock',
  'thematicBreak',
  'htmlBlock',
  'table',
  'tableRow',
  'tableCell',
  'mathBlock',
]);

export function isMarkdownBlockNode(node: MarkdownNode): node is MarkdownBlockNode {
  return BLOCK_NODE_TYPES.has(node.type);
}

export function isMarkdownInlineNode(node: MarkdownNode): node is MarkdownInlineNode {
  return !BLOCK_NODE_TYPES.has(node.type);
}
