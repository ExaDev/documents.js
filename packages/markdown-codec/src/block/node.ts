// The MUTABLE working block node the block phase builds while it scans, before converting to src/ast's own readonly MarkdownBlockNode union at the end (src/block/block.ts's toAstBlocks). The block-level counterpart to src/inline/node.ts's InlineNode, and it exists for the same reason that one does: CommonMark's block algorithm is not a recursive descent over a finished structure, it is an OPEN-BLOCK STACK that mutates a partially-built tree line by line -- a block accumulates raw content across many lines, is reparented when a container closes, is REPLACED in place when a paragraph is promoted to a setext heading or a GFM table, and can be unlinked entirely after the fact when it turns out to have held nothing but link reference definitions. None of that is expressible against readonly arrays without rebuilding an enclosing array on every line.
//
// Deliberately no Zod schema, matching src/ast/ast.ts's own precedent (and pdf-codec's PdfObject before it): this type never crosses a public boundary, never round-trips through JSON, and is discarded the moment toAstBlocks has walked it.

import type { MarkdownBulletMarker, MarkdownOrderedListDelimiter, MarkdownTableAlignment } from '../ast/ast';
import type { HtmlBlockType } from '../html/html';

export type BlockNodeKind =
  | 'document'
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'list'
  | 'listItem'
  | 'codeBlock'
  | 'htmlBlock'
  | 'thematicBreak'
  | 'table'
  | 'mathBlock'
  | 'footnoteDefinition';

export type BlockHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

// Everything a list item's own marker determined, shared by the item and by the list that holds it: the list copies its first item's data (so `listsMatch` can decide whether a later item continues the same list or starts a new one) and each item keeps its own copy (so its continuation rule knows how far to strip).
export interface ListMarkerData {
  readonly type: 'bullet' | 'ordered';
  // Present only when type is 'bullet'.
  readonly bulletChar?: MarkdownBulletMarker;
  // Present only when type is 'ordered'.
  readonly delimiter?: MarkdownOrderedListDelimiter;
  readonly start?: number;
  // Columns from the item's own content indent back to the marker: the marker's own width plus the spaces following it. A continuation line must be indented at least `markerOffset + padding` columns to belong to this item.
  readonly padding: number;
  // Columns of indentation the marker itself sat at, relative to the enclosing container's content column.
  readonly markerOffset: number;
}

export class BlockNode {
  readonly kind: BlockNodeKind;
  parent: BlockNode | undefined;
  readonly children: BlockNode[] = [];
  // Whether this block is still accepting lines. The block phase's whole algorithm is "walk the chain of open blocks, close the ones this line no longer continues".
  open = true;
  // 1-based source line this block started on -- the one piece of position tracking the algorithm itself needs (a list item that started on the current line is exempt from the "a blank line ends a list item" rule, spec 0.31.2's own "a list item can begin with at most one blank line").
  startLine = 0;
  // Raw source text accumulated for a leaf block, one line per line, each with its own trailing line feed. Converted to the node's final content at finalize time (a code block's literal, a paragraph's inline source, a table's rows).
  content = '';
  // Set when the line just incorporated was blank AT THIS BLOCK'S level -- the signal list tightness is computed from (see src/block/list.ts).
  lastLineBlank = false;
  // Scratch flag for endsWithBlankLine's own memoised descent (src/block/list.ts) -- a list/item is descended into at most once per finalisation.
  lastLineChecked = false;

  level: BlockHeadingLevel = 1;
  setext = false;

  fenced = false;
  fenceChar: '`' | '~' = '`';
  fenceLength = 0;
  // Columns of indentation the opening fence sat at -- the same number of leading spaces are stripped from each of the block's own content lines (spec 0.31.2: "if the leading code fence is indented N spaces, then up to N spaces of indentation are removed from each line of the content").
  fenceOffset = 0;
  infoString = '';
  literal = '';

  htmlBlockType: HtmlBlockType = 1;

  listData: ListMarkerData | undefined;
  // A list is tight unless some blank line separates its items or their blocks -- computed once at finalize (src/block/list.ts's finalizeListTightness), never incrementally.
  tight = true;

  // The GFM table's own column alignments, from its delimiter row.
  alignments: MarkdownTableAlignment[] = [];
  // The table's header row, as raw source text; the body rows arrive through `content` like any other line-accepting leaf block.
  headerLine = '';

  // A footnote definition's own label, from its `[^label]:` opening marker.
  footnoteLabel = '';

  constructor(kind: BlockNodeKind, startLine: number) {
    this.kind = kind;
    this.startLine = startLine;
  }

  get lastChild(): BlockNode | undefined {
    return this.children.at(-1);
  }

  appendChild(child: BlockNode): void {
    child.parent = this;
    this.children.push(child);
  }

  // Replaces this node with `replacement` in its own parent, in place -- the paragraph-promotion hook's own primitive (src/block/block.ts), where an open paragraph becomes a setext heading or a GFM table without the surrounding tree noticing.
  replaceWith(replacement: BlockNode): void {
    const parent = this.parent;
    if (parent === undefined) {
      return;
    }
    const index = parent.children.indexOf(this);
    if (index === -1) {
      return;
    }
    parent.children[index] = replacement;
    replacement.parent = parent;
    this.parent = undefined;
  }

  // Detaches this node from its parent entirely -- used for a paragraph that turned out to hold nothing but link reference definitions, which leaves no block behind at all.
  unlink(): void {
    const parent = this.parent;
    if (parent === undefined) {
      return;
    }
    const index = parent.children.indexOf(this);
    if (index !== -1) {
      parent.children.splice(index, 1);
    }
    this.parent = undefined;
  }
}

// Which block kinds may hold which children, per CommonMark's own container/leaf split. A list holds only items; an item (like a blockquote or the document) holds anything except a bare item; every leaf block holds no blocks at all.
//
// A footnote definition is a container of the same shape as a list item -- its body is ordinary block content, continued by indentation -- with one further restriction: it may not hold another footnote definition. Nesting one inside another has no meaning (a definition is addressed by a document-global label, not by its position), and src/block/block.ts's own start rule already refuses to open one anywhere but at the document's own top level, so this is the type-level statement of a rule the parser never reaches the other way round.
export function canContain(parent: BlockNodeKind, child: BlockNodeKind): boolean {
  switch (parent) {
    case 'footnoteDefinition':
      return child !== 'listItem' && child !== 'footnoteDefinition';
    case 'document':
    case 'blockquote':
    case 'listItem':
      return child !== 'listItem';
    case 'list':
      return child === 'listItem';
    default:
      return false;
  }
}

// Whether a block accepts raw source lines as its own content. A paragraph and a GFM table accept lines AND still let new block starts be tried against each line (a `>` after a table opens a blockquote and breaks the table); a code block, an HTML block, and a math block accept lines and suppress block starts entirely, which is what makes their content literal.
export function acceptsLines(kind: BlockNodeKind): boolean {
  return kind === 'paragraph' || kind === 'codeBlock' || kind === 'htmlBlock' || kind === 'table' || kind === 'mathBlock';
}
