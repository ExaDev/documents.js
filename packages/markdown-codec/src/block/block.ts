// The block phase: markdown source text -> src/ast's block tree, with each leaf block's own inline content parsed afterwards by src/inline.
//
// This is CommonMark 0.31.2's own "Phase 1: block structure" algorithm (spec appendix A, "A parsing strategy"), which is not a recursive descent and cannot be written as one. Each line is processed in three steps against a STACK OF OPEN BLOCKS:
//
//  1. Continuation matching -- walk down the chain of currently-open blocks from the document, asking each whether this line continues it (a block quote wants its `>`, a list item wants its content indent, a fenced code block wants anything that is not its closing fence) and consuming that block's own prefix from the line as we go. The walk stops at the first block that says no.
//  2. New block starts -- with whatever prefix remains, try each block start in a FIXED precedence order until one matches, adding the new block to the last block that did match in step 1. A container start (block quote, list item) leaves the loop running so `> - foo` opens both; a leaf start (heading, code block, table, HTML block, thematic break) ends it.
//  3. Text -- whatever is left of the line becomes the content of the block now at the top of the stack, either as a continuation of an open leaf block or as a new paragraph.
//
// The precedence order in step 2 is fixed and load-bearing: blockquote, ATX heading, fenced code, HTML block, PARAGRAPH PROMOTION, thematic break, list item, indented code. Two consequences that look like special cases but are really just this ordering:
//
//  - `- - -` is a thematic break, not a three-item list, because the thematic-break matcher runs before the list-item matcher. Nothing anywhere in this package special-cases that input.
//  - `Foo` followed by `---` is a setext heading, not a paragraph followed by a thematic break, because paragraph promotion runs before the thematic-break matcher.
//
// PARAGRAPH PROMOTION is the one step that is not a block start at all, which is why it is a separate hook rather than another entry in the same list. A block start creates a NEW block from the current line; a promotion REPLACES an already-open paragraph because of the line that follows it. Two constructs work that way -- a setext heading underline and a GFM table delimiter row -- and both need the paragraph's own accumulated content, not just the current line. Their mutual precedence is settled in tryPromoteParagraph below.
//
// LAZY CONTINUATION falls out of steps 1 and 3 together rather than being a rule of its own: when step 1 stops early but the block at the top of the stack is a paragraph and the line is neither blank nor the start of a new block, step 3 adds the line to that paragraph anyway, without closing anything. That is what lets a paragraph inside a block quote continue across a line with no `>`, while a setext underline or a table delimiter row on such a line does not promote it -- step 2 sees the last MATCHED container, which is no longer the paragraph.
//
// Link reference definitions are collected as paragraphs close, and the whole document is parsed to completion before a single inline is parsed. That ordering is structural, not incidental: a definition is forward-visible, so `[foo]` in the first paragraph resolves against a `[foo]: /url` on the last line, including one nested inside a block quote or a list item.

import type {
  MarkdownBlockNode,
  MarkdownDocumentNode,
  MarkdownHeadingNode,
  MarkdownInlineNode,
  MarkdownListItemNode,
  MarkdownListNode,
  MarkdownTableCellNode,
  MarkdownTableNode,
  MarkdownTableRowNode,
} from '../ast/ast';
import { matchHtmlBlockStart, matchesHtmlBlockEnd } from '../html/html';
import { unescapeString } from '../inline/entity';
import type { InlineParseOptions } from '../inline/inline';
import { parseInlines } from '../inline/inline';
import type { LinkReferenceDefinition, LinkReferenceMap } from '../inline/link';
import { extractDefinitions } from './definitions';
import { CODE_INDENT_COLUMNS, LineCursor } from './line';
import { finalizeListTightness, listsMatch, parseListMarker } from './list';
import type { BlockHeadingLevel, BlockNodeKind } from './node';
import { BlockNode, acceptsLines, canContain } from './node';
import { fitRowToColumns, parseTableDelimiterRow, splitTableRow } from './table';

// spec 0.31.2, "Insecure characters": U+0000 must be replaced with U+FFFD.
const NUL_REPLACEMENT = '�';
const NUL_PATTERN = /\0/g;

const LINE_ENDING_PATTERN = /\r\n|\n|\r/;

// A cheap first filter before the block-start list is tried at all: no block start, and no paragraph promotion, can begin with any other character. `|` and `:` are here for the GFM table delimiter row (`| --- |`, `:-: | ---:`), the only construct in this package that can start with either.
const MAYBE_SPECIAL_PATTERN = /^[#`~*+_=<>0-9|:-]/;

// spec 0.31.2, "ATX headings": one to six `#` characters, followed by spaces/tabs or the end of the line.
const ATX_MARKER_PATTERN = /^#{1,6}(?:[ \t]+|$)/;
const ATX_ONLY_CLOSING_SEQUENCE_PATTERN = /^[ \t]*#+[ \t]*$/;
const ATX_TRAILING_CLOSING_SEQUENCE_PATTERN = /[ \t]+#+[ \t]*$/;

// spec 0.31.2, "Fenced code blocks": at least three backticks or tildes. A backtick fence's own info string may not contain a backtick, which the lookahead enforces at the point of matching rather than after the fact.
const CODE_FENCE_PATTERN = /^`{3,}(?!.*`)|^~{3,}/;
const CLOSING_CODE_FENCE_PATTERN = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;

// spec 0.31.2, "Setext headings": a sequence of `=` or of `-`, optionally followed by spaces/tabs, and nothing else.
const SETEXT_UNDERLINE_PATTERN = /^(?:=+|-+)[ \t]*$/;

// spec 0.31.2, "Thematic breaks": three or more matching `*`, `-`, or `_` characters, with optional spaces/tabs between and after them.
const THEMATIC_BREAK_PATTERN = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;

const BLANK_CONTENT_PATTERN = /^[ \t\n]*$/;

// An indented code block's own trailing blank lines are not part of it; the same is true of an HTML block, which additionally may not keep the trailing line ending at all.
const TRAILING_BLANK_LINES_PATTERN = /(?:\n[ \t]*)+$/;
const TRAILING_HTML_BLANK_LINES_PATTERN = /(?:\n *)+$/;

const MAX_HEADING_LEVEL = 6;
const SETEXT_LEVEL_1 = 1;
const SETEXT_LEVEL_2 = 2;

// The two HTML block types whose end condition is a blank line rather than anything in the line's own text (spec 0.31.2, conditions 6 and 7).
const HTML_BLOCK_BLANK_LINE_END_TYPES: readonly number[] = [6, 7];

type BlockStartResult = 'none' | 'container' | 'leaf';
// 'finished' is a fenced code block consuming its own closing fence: the line is fully accounted for and the block is already closed, so the line's processing ends there.
type ContinueResult = 'matched' | 'not-matched' | 'finished';

export interface MarkdownParseOptions extends InlineParseOptions {
  // GFM's table extension. Enabled by default, matching this package's CommonMark+GFM target; the CommonMark conformance suite switches it off along with the other GFM toggles, since a delimiter row is ordinary paragraph text under CommonMark alone.
  readonly gfmTables?: boolean;
}

export interface ParsedMarkdown {
  readonly document: MarkdownDocumentNode;
  // The document-global link-reference-definition table, complete before any inline was parsed against it.
  readonly references: LinkReferenceMap;
}

function isBlankContent(content: string): boolean {
  return BLANK_CONTENT_PATTERN.test(content);
}

function headingLevelOf(hashes: number): BlockHeadingLevel {
  switch (hashes) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 3;
    case 4:
      return 4;
    case 5:
      return 5;
    default:
      return MAX_HEADING_LEVEL;
  }
}

class BlockParser {
  readonly references = new Map<string, LinkReferenceDefinition>();
  private readonly document = new BlockNode('document', 1);
  private readonly tables: boolean;
  private tip: BlockNode = this.document;
  // The tip as it stood before the current line was processed, and the deepest block that line matched -- together they say exactly which blocks the line failed to continue, which closeUnmatchedBlocks then closes.
  private oldTip: BlockNode = this.document;
  private lastMatchedContainer: BlockNode = this.document;
  private allClosed = true;
  private line = new LineCursor('');
  private lineNumber = 0;

  constructor(options: MarkdownParseOptions) {
    this.tables = options.gfmTables ?? true;
  }

  parse(source: string): BlockNode {
    const lines = source.split(LINE_ENDING_PATTERN);
    // The line ending that ends the last real line produces a trailing empty element, which is not a blank line of the document.
    const count = source.endsWith('\n') || source.endsWith('\r') ? lines.length - 1 : lines.length;
    for (let index = 0; index < count; index += 1) {
      const text = lines[index];
      if (text !== undefined) {
        this.incorporateLine(text);
      }
    }
    while (this.tip.open) {
      this.finalize(this.tip);
    }
    return this.document;
  }

  private incorporateLine(rawText: string): void {
    this.lineNumber += 1;
    this.line = new LineCursor(rawText.replace(NUL_PATTERN, NUL_REPLACEMENT));
    this.oldTip = this.tip;

    const matched = this.walkOpenBlocks();
    if (matched === undefined) {
      return;
    }

    this.allClosed = matched === this.oldTip;
    this.lastMatchedContainer = matched;

    this.addTextToContainer(this.openNewBlocks(matched));
  }

  // Step 1: descend the chain of open blocks, consuming each one's own line prefix, and return the deepest one this line continues. Returns undefined when the line was fully consumed by a block that closed on it (a fenced code block's closing fence).
  private walkOpenBlocks(): BlockNode | undefined {
    let container = this.document;
    for (;;) {
      const lastChild = container.lastChild;
      if (lastChild?.open !== true) {
        return container;
      }
      this.line.findNextNonspace();
      const result = this.continueBlock(lastChild);
      if (result === 'finished') {
        return undefined;
      }
      if (result === 'not-matched') {
        return container;
      }
      container = lastChild;
    }
  }

  private continueBlock(node: BlockNode): ContinueResult {
    switch (node.kind) {
      case 'document':
      case 'list':
        return 'matched';
      case 'blockquote':
        return this.continueBlockquote();
      case 'listItem':
        return this.continueListItem(node);
      case 'codeBlock':
        return this.continueCodeBlock(node);
      case 'htmlBlock':
        // Types 1-5 end on a line whose own text meets their end condition, checked once that line's text has been added (see addTextToContainer); types 6 and 7 end at a blank line instead.
        return this.line.blank && HTML_BLOCK_BLANK_LINE_END_TYPES.includes(node.htmlBlockType) ? 'not-matched' : 'matched';
      case 'paragraph':
      case 'table':
        return this.line.blank ? 'not-matched' : 'matched';
      case 'heading':
      case 'thematicBreak':
        // Both own exactly one line and close as soon as the next one arrives.
        return 'not-matched';
    }
  }

  // spec 0.31.2: "A block quote marker consists of 0-3 spaces of initial indent, plus the character `>` together with a following space, or a single character `>` not followed by a space."
  private continueBlockquote(): ContinueResult {
    if (!this.consumeBlockquoteMarker()) {
      return 'not-matched';
    }
    return 'matched';
  }

  private consumeBlockquoteMarker(): boolean {
    if (this.line.indented || this.line.peekNextNonspace() !== '>') {
      return false;
    }
    this.line.advanceToNextNonspace();
    this.line.advance(1);
    // A tab following the marker counts as ONE column here, with the rest of its expansion left as content indentation -- exactly what MarkdownScanCursor's partial tab consumption models (src/scan).
    if (this.line.peek() === ' ') {
      this.line.advance(1);
    }
    return true;
  }

  private continueListItem(node: BlockNode): ContinueResult {
    const listData = node.listData;
    if (listData === undefined) {
      return 'not-matched';
    }
    if (this.line.blank) {
      // spec 0.31.2: "A list item can begin with at most one blank line" -- an item whose first line was blank and that still has no content ends at a second blank line.
      if (node.children.length === 0) {
        return 'not-matched';
      }
      this.line.advanceToNextNonspace();
      return 'matched';
    }
    if (this.line.indent >= listData.markerOffset + listData.padding) {
      this.line.advance(listData.markerOffset + listData.padding);
      return 'matched';
    }
    return 'not-matched';
  }

  private continueCodeBlock(node: BlockNode): ContinueResult {
    if (!node.fenced) {
      if (this.line.indent >= CODE_INDENT_COLUMNS) {
        this.line.advance(CODE_INDENT_COLUMNS);
        return 'matched';
      }
      if (this.line.blank) {
        this.line.advanceToNextNonspace();
        return 'matched';
      }
      return 'not-matched';
    }

    const rest = this.line.restFromNextNonspace();
    const closing = this.line.indented || !rest.startsWith(node.fenceChar) ? null : CLOSING_CODE_FENCE_PATTERN.exec(rest);
    if (closing !== null && closing[0].length >= node.fenceLength) {
      this.finalize(node);
      return 'finished';
    }
    // Not a closing fence: strip up to as many columns of indentation as the opening fence itself carried.
    for (let remaining = node.fenceOffset; remaining > 0 && this.line.peek() === ' '; remaining -= 1) {
      this.line.advance(1);
    }
    return 'matched';
  }

  // Step 2: try block starts against the deepest matched container until one produces a leaf block, none matches, or the line is plainly ordinary text.
  private openNewBlocks(matchedContainer: BlockNode): BlockNode {
    let container = matchedContainer;
    // A paragraph and a GFM table both accept lines AND still let block starts be tried, so a `>` or a heading on the next line breaks out of either. A code block or an HTML block accepts lines and suppresses starts entirely, which is what makes their own content literal.
    let matchedLeaf = container.kind !== 'paragraph' && container.kind !== 'table' && acceptsLines(container.kind);
    while (!matchedLeaf) {
      this.line.findNextNonspace();
      if (!this.line.indented && !MAYBE_SPECIAL_PATTERN.test(this.line.restFromNextNonspace())) {
        this.line.advanceToNextNonspace();
        break;
      }
      const result = this.tryBlockStart(container);
      if (result === 'none') {
        this.line.advanceToNextNonspace();
        break;
      }
      container = this.tip;
      matchedLeaf = result === 'leaf';
    }
    return container;
  }

  // The fixed precedence order. See this module's own top-of-file note for what depends on it.
  private tryBlockStart(container: BlockNode): BlockStartResult {
    const starts = [
      () => this.tryBlockquoteStart(),
      () => this.tryAtxHeadingStart(),
      () => this.tryCodeFenceStart(),
      () => this.tryHtmlBlockStart(container),
      () => this.tryPromoteParagraph(container),
      () => this.tryThematicBreakStart(),
      () => this.tryListItemStart(container),
      () => this.tryIndentedCodeStart(),
    ];
    for (const start of starts) {
      const result = start();
      if (result !== 'none') {
        return result;
      }
    }
    return 'none';
  }

  private tryBlockquoteStart(): BlockStartResult {
    if (!this.consumeBlockquoteMarker()) {
      return 'none';
    }
    this.closeUnmatchedBlocks();
    this.addChild('blockquote');
    return 'container';
  }

  private tryAtxHeadingStart(): BlockStartResult {
    if (this.line.indented) {
      return 'none';
    }
    const rest = this.line.restFromNextNonspace();
    const match = ATX_MARKER_PATTERN.exec(rest);
    if (match === null) {
      return 'none';
    }
    this.line.advanceToNextNonspace();
    this.closeUnmatchedBlocks();
    const heading = this.addChild('heading');
    heading.level = headingLevelOf(match[0].trim().length);
    // spec 0.31.2: "The optional closing sequence of #s must be preceded by spaces and may be followed by spaces only" -- and a heading that is nothing but a closing sequence has empty content.
    heading.content = rest.slice(match[0].length).replace(ATX_ONLY_CLOSING_SEQUENCE_PATTERN, '').replace(ATX_TRAILING_CLOSING_SEQUENCE_PATTERN, '');
    this.line.advanceToEndOfLine();
    return 'leaf';
  }

  private tryCodeFenceStart(): BlockStartResult {
    if (this.line.indented) {
      return 'none';
    }
    const match = CODE_FENCE_PATTERN.exec(this.line.restFromNextNonspace());
    if (match === null) {
      return 'none';
    }
    const fence = match[0];
    const fenceChar = fence.charAt(0);
    if (fenceChar !== '`' && fenceChar !== '~') {
      return 'none';
    }
    this.closeUnmatchedBlocks();
    const block = this.addChild('codeBlock');
    block.fenced = true;
    block.fenceChar = fenceChar;
    block.fenceLength = fence.length;
    block.fenceOffset = this.line.indent;
    this.line.advanceToNextNonspace();
    this.line.advance(fence.length);
    return 'leaf';
  }

  private tryHtmlBlockStart(container: BlockNode): BlockStartResult {
    if (this.line.indented || this.line.peekNextNonspace() !== '<') {
      return 'none';
    }
    // Start condition 7 may not interrupt a paragraph -- neither the paragraph this line would break out of, nor one this line could instead continue lazily.
    const interruptsParagraph = container.kind === 'paragraph' || (!this.allClosed && !this.line.blank && this.tip.kind === 'paragraph');
    const type = matchHtmlBlockStart(this.line.restFromNextNonspace(), interruptsParagraph);
    if (type === undefined) {
      return 'none';
    }
    this.closeUnmatchedBlocks();
    // The cursor is deliberately not advanced: an HTML block's own leading spaces are part of its literal content.
    this.addChild('htmlBlock').htmlBlockType = type;
    return 'leaf';
  }

  // The paragraph-promotion hook. Both constructs it covers convert an ALREADY-OPEN paragraph because of the line that follows it, rather than starting a block of their own from that line.
  //
  // Precedence between the two, and against the thematic-break matcher that runs after this hook: a bare `---` is genuinely ambiguous between a thematic break, a setext level-2 underline, and -- on the face of the GFM prose, which defines a row as cells "separated by pipes" and so allows a one-cell row with no pipe at all -- a single-column table delimiter row. It is resolved by testing the setext underline FIRST and by requiring a delimiter row to contain a pipe (see src/block/table.ts), which between them make the three cases disjoint rather than merely ordered: `---` is never a delimiter row, `--- | ---` is never a setext underline, and a thematic break is only ever reached when the open paragraph rejected both.
  private tryPromoteParagraph(container: BlockNode): BlockStartResult {
    if (this.line.indented || container.kind !== 'paragraph') {
      return 'none';
    }
    const setext = this.trySetextHeading(container);
    return setext === 'none' ? this.tryTableHeader(container) : setext;
  }

  private trySetextHeading(paragraph: BlockNode): BlockStartResult {
    const match = SETEXT_UNDERLINE_PATTERN.exec(this.line.restFromNextNonspace());
    if (match === null) {
      return 'none';
    }
    this.closeUnmatchedBlocks();
    // Definitions at the front of the paragraph are consumed here rather than at paragraph finalisation, since what is left decides whether there is a heading at all: `[foo]: /url` followed by `---` is a definition and a thematic break, not an empty heading.
    paragraph.content = extractDefinitions(paragraph.content, this.references);
    if (isBlankContent(paragraph.content)) {
      return 'none';
    }
    const heading = new BlockNode('heading', paragraph.startLine);
    heading.level = match[0].startsWith('=') ? SETEXT_LEVEL_1 : SETEXT_LEVEL_2;
    heading.setext = true;
    heading.content = paragraph.content;
    paragraph.replaceWith(heading);
    this.tip = heading;
    this.line.advanceToEndOfLine();
    return 'leaf';
  }

  // github.github.com/gfm, "Tables (extension)": the delimiter row promotes the paragraph's own LAST line into a table header, leaving any earlier lines behind as a paragraph in their own right.
  private tryTableHeader(paragraph: BlockNode): BlockStartResult {
    if (!this.tables) {
      return 'none';
    }
    const alignments = parseTableDelimiterRow(this.line.restFromNextNonspace());
    if (alignments === undefined) {
      return 'none';
    }
    const lines = paragraph.content.split('\n');
    // A paragraph's content always ends with a line ending, so the last element is empty and the header is the one before it.
    const headerLine = lines.at(-2);
    if (headerLine === undefined || splitTableRow(headerLine).length !== alignments.length) {
      return 'none';
    }

    this.closeUnmatchedBlocks();
    paragraph.content = lines.slice(0, -2).map((text) => `${text}\n`).join('');
    this.finalize(paragraph);
    const table = this.addChild('table');
    table.alignments = alignments;
    table.headerLine = headerLine;
    this.line.advanceToEndOfLine();
    return 'leaf';
  }

  private tryThematicBreakStart(): BlockStartResult {
    if (this.line.indented || !THEMATIC_BREAK_PATTERN.test(this.line.restFromNextNonspace())) {
      return 'none';
    }
    this.closeUnmatchedBlocks();
    this.addChild('thematicBreak');
    this.line.advanceToEndOfLine();
    return 'leaf';
  }

  private tryListItemStart(container: BlockNode): BlockStartResult {
    const data = parseListMarker(this.line, container.kind === 'paragraph');
    if (data === undefined) {
      return 'none';
    }
    this.closeUnmatchedBlocks();
    const openList = this.tip.listData;
    if (this.tip.kind !== 'list' || openList === undefined || !listsMatch(openList, data)) {
      this.addChild('list').listData = data;
    }
    this.addChild('listItem').listData = data;
    return 'container';
  }

  private tryIndentedCodeStart(): BlockStartResult {
    // An indented code block cannot interrupt a paragraph (spec 0.31.2, "Indented code blocks") -- such a line is paragraph continuation text, indentation and all.
    if (!this.line.indented || this.tip.kind === 'paragraph' || this.line.blank) {
      return 'none';
    }
    this.line.advance(CODE_INDENT_COLUMNS);
    this.closeUnmatchedBlocks();
    this.addChild('codeBlock');
    return 'leaf';
  }

  // Step 3: whatever is left of the line becomes content.
  private addTextToContainer(container: BlockNode): void {
    if (!this.allClosed && !this.line.blank && this.tip.kind === 'paragraph') {
      // Lazy continuation: the line failed to continue some enclosing container, but it is ordinary paragraph text, so the paragraph absorbs it and nothing closes.
      this.addLine();
      return;
    }

    this.closeUnmatchedBlocks();
    const lastChild = container.lastChild;
    if (this.line.blank && lastChild !== undefined) {
      lastChild.lastLineBlank = true;
    }
    this.recordBlankLineForTightness(container);

    if (acceptsLines(container.kind)) {
      this.addLine();
      if (container.kind === 'htmlBlock' && matchesHtmlBlockEnd(this.line.rest(), container.htmlBlockType)) {
        this.finalize(container);
      }
      return;
    }
    if (!this.line.atEnd && !this.line.blank) {
      this.addChild('paragraph');
      this.line.advanceToNextNonspace();
      this.addLine();
    }
  }

  // A block quote's own lines are never blank (they start with `>`), a fenced code block's blank lines are content rather than separators, and an empty list item's first blank line is the one the spec explicitly allows -- none of the three may make a list loose. Every other blank line is recorded on the whole open chain, since a blank line deep inside a list separates the blocks of every ancestor it sits in.
  private recordBlankLineForTightness(container: BlockNode): void {
    const blank =
      this.line.blank &&
      !(
        container.kind === 'blockquote' ||
        (container.kind === 'codeBlock' && container.fenced) ||
        (container.kind === 'listItem' && container.children.length === 0 && container.startLine === this.lineNumber)
      );
    for (let node: BlockNode | undefined = container; node !== undefined; node = node.parent) {
      node.lastLineBlank = blank;
    }
  }

  private addLine(): void {
    this.tip.content += `${this.line.rest()}\n`;
  }

  private addChild(kind: BlockNodeKind): BlockNode {
    while (!canContain(this.tip.kind, kind)) {
      this.finalize(this.tip);
    }
    const node = new BlockNode(kind, this.lineNumber);
    this.tip.appendChild(node);
    this.tip = node;
    return node;
  }

  private closeUnmatchedBlocks(): void {
    if (this.allClosed) {
      return;
    }
    while (this.oldTip !== this.lastMatchedContainer) {
      const parent = this.oldTip.parent;
      this.finalize(this.oldTip);
      if (parent === undefined) {
        break;
      }
      this.oldTip = parent;
    }
    this.allClosed = true;
  }

  private finalize(node: BlockNode): void {
    const above = node.parent;
    node.open = false;
    this.finalizeContent(node);
    // The document has no parent: closing it leaves the tip on the now-closed root, which is exactly the terminating condition parse()'s own close-everything loop tests.
    this.tip = above ?? this.document;
  }

  private finalizeContent(node: BlockNode): void {
    switch (node.kind) {
      case 'paragraph':
        node.content = extractDefinitions(node.content, this.references);
        // A paragraph that held nothing but link reference definitions leaves no block behind at all. The same is true of one truncated to nothing by a table promotion, which is why this tests the remaining content rather than whether any definition was found.
        if (isBlankContent(node.content)) {
          node.unlink();
        }
        return;
      case 'codeBlock':
        this.finalizeCodeBlock(node);
        return;
      case 'htmlBlock':
        node.literal = node.content.replace(TRAILING_HTML_BLANK_LINES_PATTERN, '');
        return;
      case 'list':
        finalizeListTightness(node);
        return;
      default:
        return;
    }
  }

  private finalizeCodeBlock(node: BlockNode): void {
    if (!node.fenced) {
      node.literal = node.content.replace(TRAILING_BLANK_LINES_PATTERN, '\n');
      return;
    }
    // The opening fence's own line carries the info string, and it is always present in the content: a fenced block's start always falls through to addLine on that same line.
    const breakIndex = node.content.indexOf('\n');
    node.infoString = unescapeString(node.content.slice(0, breakIndex).trim());
    node.literal = node.content.slice(breakIndex + 1);
  }
}

function toInlineChildren(content: string, references: LinkReferenceMap, options: MarkdownParseOptions): MarkdownInlineNode[] {
  // A leaf block's accumulated content keeps the line endings that separated its source lines but not the whitespace around the block itself: leading indentation was stripped as each line was added, and trailing whitespace at the very end of the block is not a hard line break.
  return parseInlines(content.trim(), references, options);
}

function toHeadingNode(node: BlockNode, references: LinkReferenceMap, options: MarkdownParseOptions): MarkdownHeadingNode {
  return { type: 'heading', level: node.level, style: node.setext ? 'setext' : 'atx', children: toInlineChildren(node.content, references, options) };
}

function toListNode(node: BlockNode, references: LinkReferenceMap, options: MarkdownParseOptions): MarkdownListNode {
  const children: MarkdownListItemNode[] = node.children.map((item) => ({ type: 'listItem', children: toAstBlocks(item.children, references, options) }));
  const data = node.listData;
  if (data?.type === 'ordered') {
    return { type: 'list', markerType: 'ordered', orderedDelimiter: data.delimiter, start: data.start, tight: node.tight, children };
  }
  return { type: 'list', markerType: 'bullet', bulletMarker: data?.bulletChar, tight: node.tight, children };
}

function toTableRow(cells: readonly string[], header: boolean, references: LinkReferenceMap, options: MarkdownParseOptions): MarkdownTableRowNode {
  const children: MarkdownTableCellNode[] = cells.map((cell) => ({ type: 'tableCell', children: toInlineChildren(cell, references, options) }));
  return { type: 'tableRow', header, children };
}

function toTableNode(node: BlockNode, references: LinkReferenceMap, options: MarkdownParseOptions): MarkdownTableNode {
  const columnCount = node.alignments.length;
  const rows: MarkdownTableRowNode[] = [toTableRow(fitRowToColumns(splitTableRow(node.headerLine), columnCount), true, references, options)];
  for (const rowLine of node.content.split('\n')) {
    if (rowLine.trim().length === 0) {
      continue;
    }
    rows.push(toTableRow(fitRowToColumns(splitTableRow(rowLine), columnCount), false, references, options));
  }
  return { type: 'table', alignments: node.alignments, children: rows };
}

function toAstBlock(node: BlockNode, references: LinkReferenceMap, options: MarkdownParseOptions): MarkdownBlockNode | undefined {
  switch (node.kind) {
    case 'paragraph':
      return { type: 'paragraph', children: toInlineChildren(node.content, references, options) };
    case 'heading':
      return toHeadingNode(node, references, options);
    case 'blockquote':
      return { type: 'blockquote', children: toAstBlocks(node.children, references, options) };
    case 'list':
      return toListNode(node, references, options);
    case 'codeBlock':
      return node.fenced
        ? { type: 'codeBlock', fenced: true, fenceChar: node.fenceChar, infoString: node.infoString, literal: node.literal }
        : { type: 'codeBlock', fenced: false, literal: node.literal };
    case 'htmlBlock':
      return { type: 'htmlBlock', literal: node.literal };
    case 'thematicBreak':
      return { type: 'thematicBreak' };
    case 'table':
      return toTableNode(node, references, options);
    case 'document':
    case 'listItem':
      // Neither can appear as a child of anything toAstBlocks walks: a document is the root, and a list item is only ever reached through its own list.
      return undefined;
  }
}

function toAstBlocks(nodes: readonly BlockNode[], references: LinkReferenceMap, options: MarkdownParseOptions): MarkdownBlockNode[] {
  const blocks: MarkdownBlockNode[] = [];
  for (const node of nodes) {
    const converted = toAstBlock(node, references, options);
    if (converted !== undefined) {
      blocks.push(converted);
    }
  }
  return blocks;
}

// Parses a whole markdown document: block structure first, to completion, then every leaf block's own inline content against the finished link-reference-definition table. See this module's own top-of-file note on why that ordering is structural rather than a matter of convenience.
export function parseMarkdown(source: string, options: MarkdownParseOptions = {}): ParsedMarkdown {
  const parser = new BlockParser(options);
  const root = parser.parse(source);
  const references: LinkReferenceMap = parser.references;
  return { document: { type: 'document', children: toAstBlocks(root.children, references, options) }, references };
}
