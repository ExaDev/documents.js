import { i as MarkdownBulletMarker, j as MarkdownTableAlignment, w as MarkdownOrderedListDelimiter } from "../ast-DbjiuYr8.js";
import { t as HtmlBlockType } from "../html-bkz2QTuq.js";
//#region src/block/node.d.ts
type BlockNodeKind = 'document' | 'paragraph' | 'heading' | 'blockquote' | 'list' | 'listItem' | 'codeBlock' | 'htmlBlock' | 'thematicBreak' | 'table' | 'mathBlock';
type BlockHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
interface ListMarkerData {
  readonly type: 'bullet' | 'ordered';
  readonly bulletChar?: MarkdownBulletMarker;
  readonly delimiter?: MarkdownOrderedListDelimiter;
  readonly start?: number;
  readonly padding: number;
  readonly markerOffset: number;
}
declare class BlockNode {
  readonly kind: BlockNodeKind;
  parent: BlockNode | undefined;
  readonly children: BlockNode[];
  open: boolean;
  startLine: number;
  content: string;
  lastLineBlank: boolean;
  lastLineChecked: boolean;
  level: BlockHeadingLevel;
  setext: boolean;
  fenced: boolean;
  fenceChar: '`' | '~';
  fenceLength: number;
  fenceOffset: number;
  infoString: string;
  literal: string;
  htmlBlockType: HtmlBlockType;
  listData: ListMarkerData | undefined;
  tight: boolean;
  alignments: MarkdownTableAlignment[];
  headerLine: string;
  constructor(kind: BlockNodeKind, startLine: number);
  get lastChild(): BlockNode | undefined;
  appendChild(child: BlockNode): void;
  replaceWith(replacement: BlockNode): void;
  unlink(): void;
}
declare function canContain(parent: BlockNodeKind, child: BlockNodeKind): boolean;
declare function acceptsLines(kind: BlockNodeKind): boolean;
//#endregion
export { BlockHeadingLevel, BlockNode, BlockNodeKind, ListMarkerData, acceptsLines, canContain };