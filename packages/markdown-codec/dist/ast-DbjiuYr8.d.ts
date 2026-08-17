//#region src/ast/ast.d.ts
interface MarkdownPosition {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}
type MarkdownNode = MarkdownBlockNode | MarkdownInlineNode;
type MarkdownBlockNode = MarkdownDocumentNode | MarkdownParagraphNode | MarkdownHeadingNode | MarkdownBlockquoteNode | MarkdownListNode | MarkdownListItemNode | MarkdownCodeBlockNode | MarkdownThematicBreakNode | MarkdownHtmlBlockNode | MarkdownTableNode | MarkdownTableRowNode | MarkdownTableCellNode | MarkdownMathBlockNode;
interface MarkdownDocumentNode {
  readonly type: 'document';
  readonly children: MarkdownBlockNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownParagraphNode {
  readonly type: 'paragraph';
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}
type MarkdownHeadingStyle = 'atx' | 'setext';
interface MarkdownHeadingNode {
  readonly type: 'heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly style: MarkdownHeadingStyle;
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownBlockquoteNode {
  readonly type: 'blockquote';
  readonly children: MarkdownBlockNode[];
  readonly position?: MarkdownPosition;
}
type MarkdownListMarkerType = 'bullet' | 'ordered';
type MarkdownBulletMarker = '-' | '*' | '+';
type MarkdownOrderedListDelimiter = '.' | ')';
interface MarkdownListNode {
  readonly type: 'list';
  readonly markerType: MarkdownListMarkerType;
  readonly bulletMarker?: MarkdownBulletMarker;
  readonly orderedDelimiter?: MarkdownOrderedListDelimiter;
  readonly start?: number;
  readonly tight: boolean;
  readonly children: MarkdownListItemNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownListItemNode {
  readonly type: 'listItem';
  readonly checked?: boolean;
  readonly children: MarkdownBlockNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownCodeBlockNode {
  readonly type: 'codeBlock';
  readonly fenced: boolean;
  readonly fenceChar?: '`' | '~';
  readonly infoString?: string;
  readonly literal: string;
  readonly position?: MarkdownPosition;
}
interface MarkdownThematicBreakNode {
  readonly type: 'thematicBreak';
  readonly position?: MarkdownPosition;
}
interface MarkdownHtmlBlockNode {
  readonly type: 'htmlBlock';
  readonly literal: string;
  readonly position?: MarkdownPosition;
}
type MarkdownTableAlignment = 'left' | 'right' | 'center' | 'none';
interface MarkdownTableNode {
  readonly type: 'table';
  readonly alignments: MarkdownTableAlignment[];
  readonly children: MarkdownTableRowNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownTableRowNode {
  readonly type: 'tableRow';
  readonly header: boolean;
  readonly children: MarkdownTableCellNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownTableCellNode {
  readonly type: 'tableCell';
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownMathBlockNode {
  readonly type: 'mathBlock';
  readonly literal: string;
  readonly position?: MarkdownPosition;
}
type MarkdownInlineNode = MarkdownTextNode | MarkdownEmphasisNode | MarkdownStrongNode | MarkdownStrikethroughNode | MarkdownCodeSpanNode | MarkdownLinkNode | MarkdownImageNode | MarkdownAutolinkNode | MarkdownHardBreakNode | MarkdownSoftBreakNode | MarkdownRawHtmlNode | MarkdownEntityNode | MarkdownMathInlineNode;
type MarkdownEmphasisMarker = '_' | '*';
interface MarkdownTextNode {
  readonly type: 'text';
  readonly value: string;
  readonly position?: MarkdownPosition;
}
interface MarkdownEmphasisNode {
  readonly type: 'emphasis';
  readonly marker: MarkdownEmphasisMarker;
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownStrongNode {
  readonly type: 'strong';
  readonly marker: MarkdownEmphasisMarker;
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownStrikethroughNode {
  readonly type: 'strikethrough';
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownCodeSpanNode {
  readonly type: 'codeSpan';
  readonly literal: string;
  readonly position?: MarkdownPosition;
}
interface MarkdownLinkNode {
  readonly type: 'link';
  readonly destination: string;
  readonly title?: string;
  readonly children: MarkdownInlineNode[];
  readonly position?: MarkdownPosition;
}
interface MarkdownImageNode {
  readonly type: 'image';
  readonly destination: string;
  readonly title?: string;
  readonly alt: string;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly position?: MarkdownPosition;
}
interface MarkdownAutolinkNode {
  readonly type: 'autolink';
  readonly destination: string;
  readonly email: boolean;
  readonly position?: MarkdownPosition;
}
interface MarkdownHardBreakNode {
  readonly type: 'hardBreak';
  readonly position?: MarkdownPosition;
}
interface MarkdownSoftBreakNode {
  readonly type: 'softBreak';
  readonly position?: MarkdownPosition;
}
interface MarkdownRawHtmlNode {
  readonly type: 'rawHtml';
  readonly literal: string;
  readonly position?: MarkdownPosition;
}
interface MarkdownEntityNode {
  readonly type: 'entity';
  readonly raw: string;
  readonly value: string;
  readonly position?: MarkdownPosition;
}
interface MarkdownMathInlineNode {
  readonly type: 'mathInline';
  readonly literal: string;
  readonly position?: MarkdownPosition;
}
declare function isMarkdownBlockNode(node: MarkdownNode): node is MarkdownBlockNode;
declare function isMarkdownInlineNode(node: MarkdownNode): node is MarkdownInlineNode;
//#endregion
export { MarkdownStrongNode as A, MarkdownNode as C, MarkdownRawHtmlNode as D, MarkdownPosition as E, MarkdownTextNode as F, MarkdownThematicBreakNode as I, isMarkdownBlockNode as L, MarkdownTableCellNode as M, MarkdownTableNode as N, MarkdownSoftBreakNode as O, MarkdownTableRowNode as P, isMarkdownInlineNode as R, MarkdownMathInlineNode as S, MarkdownParagraphNode as T, MarkdownLinkNode as _, MarkdownCodeBlockNode as a, MarkdownListNode as b, MarkdownEmphasisMarker as c, MarkdownHardBreakNode as d, MarkdownHeadingNode as f, MarkdownInlineNode as g, MarkdownImageNode as h, MarkdownBulletMarker as i, MarkdownTableAlignment as j, MarkdownStrikethroughNode as k, MarkdownEmphasisNode as l, MarkdownHtmlBlockNode as m, MarkdownBlockNode as n, MarkdownCodeSpanNode as o, MarkdownHeadingStyle as p, MarkdownBlockquoteNode as r, MarkdownDocumentNode as s, MarkdownAutolinkNode as t, MarkdownEntityNode as u, MarkdownListItemNode as v, MarkdownOrderedListDelimiter as w, MarkdownMathBlockNode as x, MarkdownListMarkerType as y };