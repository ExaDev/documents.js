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
import type { FootnoteLabelSet } from '../inline/footnote';
import { matchFootnoteDefinitionMarker } from '../inline/footnote';
import type { MarkdownDiagnosticSink } from '../diagnostics/diagnostics';
import { DEFAULT_MAX_BLOCK_NESTING } from '../defaults/defaults';
import { MarkdownDiagnosticCodes, MarkdownNestingLimitExceededError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from '../diagnostics/diagnostics';
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

// GFM 'Task list items (extension)': a list item is a task item when the first block directly inside it is a paragraph whose raw content begins with a task-list-item marker -- an optional-content left bracket, a space or `x`/`X`, a right bracket, then at least one space or tab before anything else. Matched against the paragraph's own accumulated raw content (leading indentation already stripped by the block phase), never against already-parsed inline nodes.
const TASK_LIST_MARKER_PATTERN = /^\[([ xX])\][ \t]/;

// spec 0.31.2, "Insecure characters": U+0000 must be replaced with U+FFFD.
const NUL_REPLACEMENT = '�';
const NUL_PATTERN = /\0/g;

const LINE_ENDING_PATTERN = /\r\n|\n|\r/;

// A cheap first filter before the block-start list is tried at all: no block start, and no paragraph promotion, can begin with any other character. `|` and `:` are here for the GFM table delimiter row (`| --- |`, `:-: | ---:`), the only construct in this package that can start with either. `$` is here for a $$ math block's own opening line (ExaDev/markdown-codec#53), and `[` for a footnote definition's own `[^label]:` marker (ExaDev/markdown-codec#66).
const MAYBE_SPECIAL_PATTERN = /^[#$`~*+_=<>[0-9|:-]/;

// spec 0.31.2, "ATX headings": one to six `#` characters, followed by spaces/tabs or the end of the line.
const ATX_MARKER_PATTERN = /^#{1,6}(?:[ \t]+|$)/;
const ATX_ONLY_CLOSING_SEQUENCE_PATTERN = /^[ \t]*#+[ \t]*$/;
const ATX_TRAILING_CLOSING_SEQUENCE_PATTERN = /[ \t]+#+[ \t]*$/;

// spec 0.31.2, "Fenced code blocks": at least three backticks or tildes. A backtick fence's own info string may not contain a backtick, which the lookahead enforces at the point of matching rather than after the fact.
const CODE_FENCE_PATTERN = /^`{3,}(?!.*`)|^~{3,}/;
const CLOSING_CODE_FENCE_PATTERN = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;

// Pandoc/GitHub math-extension display math (ExaDev/markdown-codec#53): a line consisting of exactly $$, optionally followed by trailing spaces/tabs and nothing else -- deliberately stricter than the code-fence pattern above (no "info string", no variable length): both the opening and the closing line must match this exact shape, which is what makes a bare "$$" line on its own unambiguous rather than colliding with GFM's own single-dollar-free inline math (this package never adds inline $$ recognition at all, only \( \)).
const MATH_BLOCK_MARKER_PATTERN = /^\$\$[ \t]*$/;
const MATH_BLOCK_MARKER_LENGTH = 2;

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
  // GFM's task-list-item extension (`- [ ] foo` / `- [x] bar`). Enabled by default for the same reason; with it off, a leading `[ ]`/`[x]` is ordinary paragraph text, matching CommonMark's own reading (task lists are not part of CommonMark proper).
  readonly gfmTaskLists?: boolean;
  // GitHub's footnote extension (`[^label]` markers with `[^label]: body` definitions, ExaDev/markdown-codec#66). Enabled by default like the four above; with it off, both spellings are ordinary text, which is what CommonMark and the GFM spec document itself both say (neither defines footnotes at all -- see src/inline/footnote.ts).
  readonly footnotes?: boolean;
  // Throws MarkdownNestingLimitExceededError (src/diagnostics) rather than opening a block past this many levels deep in the open-block stack -- defaults to DEFAULT_MAX_BLOCK_NESTING (src/defaults), matching cmark's own reference-implementation guard against pathological/adversarial nesting.
  readonly maxNesting?: number;
  readonly sink?: MarkdownDiagnosticSink;
}

export interface ParsedMarkdown {
  readonly document: MarkdownDocumentNode;
  // The document-global link-reference-definition table, complete before any inline was parsed against it.
  readonly references: LinkReferenceMap;
  // The document-global set of footnote labels a definition was found for, complete before any inline was parsed against it -- the same forward-visibility guarantee `references` carries, for the same structural reason.
  readonly footnotes: FootnoteLabelSet;
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
  readonly footnotes = new Set<string>();
  private readonly document = new BlockNode('document', 1);
  private readonly tables: boolean;
  private readonly footnotesEnabled: boolean;
  private readonly sink: MarkdownDiagnosticSink;
  private readonly maxNesting: number;
  private tip: BlockNode = this.document;
  // The tip as it stood before the current line was processed, and the deepest block that line matched -- together they say exactly which blocks the line failed to continue, which closeUnmatchedBlocks then closes.
  private oldTip: BlockNode = this.document;
  private lastMatchedContainer: BlockNode = this.document;
  private allClosed = true;
  private line = new LineCursor('');
  private lineNumber = 0;
  // Depth of `this.tip` below `this.document` -- maintained incrementally (incremented in addChild, decremented in finalize) rather than walked from `parent` on every check, so the guard costs nothing per line for ordinary, shallow documents.
  private nestingDepth = 0;

  constructor(options: MarkdownParseOptions) {
    this.tables = options.gfmTables ?? true;
    this.footnotesEnabled = options.footnotes ?? true;
    this.sink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
    this.maxNesting = options.maxNesting ?? DEFAULT_MAX_BLOCK_NESTING;
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
      this.reportUnterminatedAtEof(this.tip);
      this.finalize(this.tip);
    }
    return this.document;
  }

  // Recover-tier diagnostics for a leaf block that reached end-of-input without ever meeting its own proper closing condition: a fenced code block whose closing fence never arrived, or an HTML block of type 1-5 (whose end condition is a pattern in the line's own text, not a blank line) that reached EOF without ever matching it. Types 6/7 end at a blank line OR at EOF alike -- both are the block's own ordinary, spec-legal end condition, so EOF is not a diagnostic there.
  private reportUnterminatedAtEof(node: BlockNode): void {
    if (node.kind === 'codeBlock' && node.fenced) {
      this.sink({ code: MarkdownDiagnosticCodes.UNCLOSED_FENCE, severity: 'warning', message: `fenced code block starting at line ${String(node.startLine)} was never closed by a matching closing fence before the end of the document`, line: node.startLine });
      return;
    }
    if (node.kind === 'htmlBlock' && !HTML_BLOCK_BLANK_LINE_END_TYPES.includes(node.htmlBlockType)) {
      this.sink({ code: MarkdownDiagnosticCodes.UNTERMINATED_HTML_BLOCK, severity: 'warning', message: `HTML block (type ${String(node.htmlBlockType)}) starting at line ${String(node.startLine)} never met its own end condition before the end of the document`, line: node.startLine });
      return;
    }
    if (node.kind === 'mathBlock') {
      this.sink({ code: MarkdownDiagnosticCodes.UNCLOSED_MATH_BLOCK, severity: 'warning', message: `math block starting at line ${String(node.startLine)} was never closed by a matching closing $$ before the end of the document`, line: node.startLine });
    }
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
      case 'footnoteDefinition':
        return this.continueFootnoteDefinition(node);
      case 'codeBlock':
        return this.continueCodeBlock(node);
      case 'mathBlock':
        return this.continueMathBlock(node);
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

  // A definition's body continues on any line indented at least four columns -- the same continuation indent Pandoc and GitHub both use for a multi-block footnote, and the same one src/emit/emit.ts writes back out. A blank line continues it too (a definition may hold several paragraphs), except when the definition still has no content at all, mirroring the "a list item can begin with at most one blank line" rule one function up: `[^1]:` on a line of its own followed by a blank line is an empty definition, not the opening of one that swallows the rest of the document.
  private continueFootnoteDefinition(node: BlockNode): ContinueResult {
    if (this.line.blank) {
      if (node.children.length === 0) {
        return 'not-matched';
      }
      this.line.advanceToNextNonspace();
      return 'matched';
    }
    if (this.line.indent >= CODE_INDENT_COLUMNS) {
      this.line.advance(CODE_INDENT_COLUMNS);
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

  // A closing $$ line is never added to the block's own content (matching continueCodeBlock's own closing-fence handling) -- finalize runs directly off the line the closer matched, and the line's processing ends there ('finished').
  private continueMathBlock(node: BlockNode): ContinueResult {
    if (!this.line.indented && MATH_BLOCK_MARKER_PATTERN.test(this.line.restFromNextNonspace())) {
      this.finalize(node);
      return 'finished';
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
      () => this.tryMathBlockStart(),
      () => this.tryFootnoteDefinitionStart(container),
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

  // A $$ line -- the whole line, nothing else (MATH_BLOCK_MARKER_PATTERN) -- opens a math block, interrupting an open paragraph exactly as a code fence does. The cursor advances past "$$" only, not to end of line, leaving whatever (should only be trailing whitespace) remains as the block's own first content line -- finalizeMathBlock strips that first line back off, mirroring finalizeCodeBlock's own info-string slot.
  private tryMathBlockStart(): BlockStartResult {
    if (this.line.indented) {
      return 'none';
    }
    if (!MATH_BLOCK_MARKER_PATTERN.test(this.line.restFromNextNonspace())) {
      return 'none';
    }
    this.closeUnmatchedBlocks();
    this.addChild('mathBlock');
    this.line.advanceToNextNonspace();
    this.line.advance(MATH_BLOCK_MARKER_LENGTH);
    return 'leaf';
  }

  // A footnote definition (ExaDev/markdown-codec#66) opens a CONTAINER, exactly as a list item does: the rest of the marker's own line, and every following line indented four columns, is its body.
  //
  // Two restrictions, both deliberate and both about what the ContentDocument mapping downstream can actually represent rather than about markdown's own grammar:
  //
  //  - It may not interrupt a paragraph, matching a link reference definition (which is only ever recognised at the FRONT of a paragraph's accumulated content, src/block/definitions.ts) and matching Pandoc. A `[^1]: note` line directly under a line of prose is lazy paragraph continuation text.
  //  - It is recognised ONLY as a direct child of the document -- never inside a block quote or a list item. src/lower/lower.ts lowers a definition to a construct boundary-marker pair (document-schema.js 4.2.0) bracketing its own body, and that pair's extent may not cross a scope its enclosing container had already opened: a definition inside a list item would have to carry the item's own ContentListMembership on every body block, which a body table or image cannot carry at all, closing the item's list scope from INSIDE the pair -- precisely what the flat form's bracket-matching contract forbids a producer from emitting. A block quote is the same shape one level along: its own `> ` prefix is recovered on the way out from each paragraph's indentLeftPt, and a definition's label line has no paragraph of its own to carry it. Inside either container the `[^1]: ...` text stays an ordinary paragraph, exactly as it did before footnotes existed here.
  private tryFootnoteDefinitionStart(container: BlockNode): BlockStartResult {
    if (!this.footnotesEnabled || this.line.indented || !this.footnoteDefinitionMayOpenIn(container)) {
      return 'none';
    }
    const marker = matchFootnoteDefinitionMarker(this.line.restFromNextNonspace());
    if (marker === undefined) {
      return 'none';
    }
    if (this.footnotes.has(marker.label)) {
      this.sink({ code: MarkdownDiagnosticCodes.DUPLICATE_FOOTNOTE_DEFINITION, severity: 'warning', message: `footnote "${marker.label}" was already defined earlier in the document; every reference resolves to the first definition, and both definitions are kept as written`, line: this.lineNumber });
    }
    this.footnotes.add(marker.label);
    this.line.advanceToNextNonspace();
    this.closeUnmatchedBlocks();
    const node = this.addChild('footnoteDefinition');
    node.footnoteLabel = marker.label;
    this.line.advance(marker.markerLength);
    return 'container';
  }

  // Whether `container` -- the deepest block the current line matched in step 1 -- sits at the document's own top level, walking up through any still-open `list` ancestors first. `continueBlock` treats a `list` node as unconditionally continued no matter what the line is (a list only actually closes when something tries to become its child and can't), so a line right after a top-level list's last item reports its matched container as that LIST, not the document, even though the list itself is about to close. Skipping over `list` ancestors here mirrors what `addChild` does a few lines below once a definition is actually opened: it walks up finalising whatever the tip can't contain, which closes a bare top-level list the same way any other block start does. A list nested inside a block quote or a list item still walks up to THAT container rather than the document, so the existing restriction on those two holds.
  private footnoteDefinitionMayOpenIn(container: BlockNode): boolean {
    let node: BlockNode | undefined = container;
    while (node?.kind === 'list') {
      node = node.parent;
    }
    return node?.kind === 'document';
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
    paragraph.content = extractDefinitions(paragraph.content, this.references, this.sink, paragraph.startLine);
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
    if (this.nestingDepth >= this.maxNesting) {
      throw new MarkdownNestingLimitExceededError(this.maxNesting);
    }
    const node = new BlockNode(kind, this.lineNumber);
    this.tip.appendChild(node);
    this.tip = node;
    this.nestingDepth += 1;
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
    // The document itself is never pushed through addChild, so it never incremented nestingDepth -- only a real child's own close pays back the push that opened it.
    if (node !== this.document) {
      this.nestingDepth -= 1;
    }
    // The document has no parent: closing it leaves the tip on the now-closed root, which is exactly the terminating condition parse()'s own close-everything loop tests.
    this.tip = above ?? this.document;
  }

  private finalizeContent(node: BlockNode): void {
    switch (node.kind) {
      case 'paragraph':
        node.content = extractDefinitions(node.content, this.references, this.sink, node.startLine);
        // A paragraph that held nothing but link reference definitions leaves no block behind at all. The same is true of one truncated to nothing by a table promotion, which is why this tests the remaining content rather than whether any definition was found.
        if (isBlankContent(node.content)) {
          node.unlink();
        }
        return;
      case 'codeBlock':
        this.finalizeCodeBlock(node);
        return;
      case 'mathBlock':
        this.finalizeMathBlock(node);
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

  // Mirrors finalizeCodeBlock's own fenced branch: the opening "$$" line's own (whitespace-only) remainder is always present as content's first line -- see tryMathBlockStart -- and is stripped off here the same way an opening fence's info-string line is.
  private finalizeMathBlock(node: BlockNode): void {
    const breakIndex = node.content.indexOf('\n');
    node.literal = breakIndex === -1 ? '' : node.content.slice(breakIndex + 1);
  }
}

// The two document-global tables the inline phase resolves against, plus the parse options, threaded through the AST conversion as one value rather than as three parallel parameters on every function below.
interface AstConversionContext {
  readonly references: LinkReferenceMap;
  readonly footnotes: FootnoteLabelSet;
  readonly options: MarkdownParseOptions;
}

function toInlineChildren(content: string, context: AstConversionContext): MarkdownInlineNode[] {
  // A leaf block's accumulated content keeps the line endings that separated its source lines but not the whitespace around the block itself: leading indentation was stripped as each line was added, and trailing whitespace at the very end of the block is not a hard line break.
  return parseInlines(content.trim(), context.references, context.footnotes, context.options);
}

function toHeadingNode(node: BlockNode, context: AstConversionContext): MarkdownHeadingNode {
  return { type: 'heading', level: node.level, style: node.setext ? 'setext' : 'atx', children: toInlineChildren(node.content, context) };
}

// Extracts a task-list-item marker from the FIRST child of a list item, mutating that child's own raw content in place to strip the marker (so the paragraph's own inline content, parsed afterwards, never sees it). Returns undefined -- never a false/absent sentinel -- when the item is not a task item at all, matching MarkdownListItemNode.checked's own "absent, not false" convention.
function extractTaskListMarker(itemChildren: readonly BlockNode[]): boolean | undefined {
  const first = itemChildren[0];
  if (first?.kind !== 'paragraph') {
    return undefined;
  }
  const match = TASK_LIST_MARKER_PATTERN.exec(first.content);
  if (match === null) {
    return undefined;
  }
  first.content = first.content.slice(match[0].length);
  return match[1] !== ' ';
}

function toListItemNode(item: BlockNode, context: AstConversionContext): MarkdownListItemNode {
  const taskLists = context.options.gfmTaskLists ?? true;
  const checked = taskLists ? extractTaskListMarker(item.children) : undefined;
  return checked === undefined
    ? { type: 'listItem', children: toAstBlocks(item.children, context) }
    : { type: 'listItem', checked, children: toAstBlocks(item.children, context) };
}

function toListNode(node: BlockNode, context: AstConversionContext): MarkdownListNode {
  const children: MarkdownListItemNode[] = node.children.map((item) => toListItemNode(item, context));
  const data = node.listData;
  if (data?.type === 'ordered') {
    return { type: 'list', markerType: 'ordered', orderedDelimiter: data.delimiter, start: data.start, tight: node.tight, children };
  }
  return { type: 'list', markerType: 'bullet', bulletMarker: data?.bulletChar, tight: node.tight, children };
}

function toTableRow(cells: readonly string[], header: boolean, context: AstConversionContext): MarkdownTableRowNode {
  const children: MarkdownTableCellNode[] = cells.map((cell) => ({ type: 'tableCell', children: toInlineChildren(cell, context) }));
  return { type: 'tableRow', header, children };
}

function toTableNode(node: BlockNode, context: AstConversionContext): MarkdownTableNode {
  const sink = context.options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
  const columnCount = node.alignments.length;
  const rows: MarkdownTableRowNode[] = [toTableRow(fitRowToColumns(splitTableRow(node.headerLine), columnCount), true, context)];
  for (const rowLine of node.content.split('\n')) {
    if (rowLine.trim().length === 0) {
      continue;
    }
    const cells = splitTableRow(rowLine);
    if (cells.length !== columnCount) {
      sink({ code: MarkdownDiagnosticCodes.TABLE_CELL_COUNT_MISMATCH, severity: 'warning', message: `table row has ${String(cells.length)} cell(s), but the header row declares ${String(columnCount)}; the row is padded with empty cells or truncated to fit`, line: node.startLine });
    }
    rows.push(toTableRow(fitRowToColumns(cells, columnCount), false, context));
  }
  return { type: 'table', alignments: node.alignments, children: rows };
}

function toAstBlock(node: BlockNode, context: AstConversionContext): MarkdownBlockNode | undefined {
  switch (node.kind) {
    case 'paragraph':
      return { type: 'paragraph', children: toInlineChildren(node.content, context) };
    case 'heading':
      return toHeadingNode(node, context);
    case 'blockquote':
      return { type: 'blockquote', children: toAstBlocks(node.children, context) };
    case 'list':
      return toListNode(node, context);
    case 'footnoteDefinition':
      return { type: 'footnoteDefinition', label: node.footnoteLabel, children: toAstBlocks(node.children, context) };
    case 'codeBlock':
      return node.fenced
        ? { type: 'codeBlock', fenced: true, fenceChar: node.fenceChar, infoString: node.infoString, literal: node.literal }
        : { type: 'codeBlock', fenced: false, literal: node.literal };
    case 'htmlBlock':
      return { type: 'htmlBlock', literal: node.literal };
    case 'thematicBreak':
      return { type: 'thematicBreak' };
    case 'mathBlock':
      return { type: 'mathBlock', literal: node.literal };
    case 'table':
      return toTableNode(node, context);
    case 'document':
    case 'listItem':
      // Neither can appear as a child of anything toAstBlocks walks: a document is the root, and a list item is only ever reached through its own list.
      return undefined;
  }
}

function toAstBlocks(nodes: readonly BlockNode[], context: AstConversionContext): MarkdownBlockNode[] {
  const blocks: MarkdownBlockNode[] = [];
  for (const node of nodes) {
    const converted = toAstBlock(node, context);
    if (converted !== undefined) {
      blocks.push(converted);
    }
  }
  return blocks;
}

// Parses a whole markdown document: block structure first, to completion, then every leaf block's own inline content against the finished link-reference-definition table and footnote-label set. See this module's own top-of-file note on why that ordering is structural rather than a matter of convenience.
export function parseMarkdown(source: string, options: MarkdownParseOptions = {}): ParsedMarkdown {
  const parser = new BlockParser(options);
  const root = parser.parse(source);
  const context: AstConversionContext = { references: parser.references, footnotes: parser.footnotes, options };
  return { document: { type: 'document', children: toAstBlocks(root.children, context) }, references: context.references, footnotes: context.footnotes };
}
