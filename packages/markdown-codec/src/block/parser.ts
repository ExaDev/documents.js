// The block walker split from block.ts: the BlockParser class itself, one pass over the document producing the MarkdownBlockNode tree. The module-level patterns and helpers it consumes stay exported from block.ts.

import type { ContinueResult, MarkdownParseOptions } from "./block";
import { assertNeverBlockKind } from "./block";
import type { LinkReferenceDefinition } from "../inline/link";
import type { MarkdownDiagnosticSink } from "../diagnostics/diagnostics";
import {
  MarkdownDiagnosticCodes,
  MarkdownNestingLimitExceededError,
  NOOP_MARKDOWN_DIAGNOSTIC_SINK,
} from "../diagnostics/diagnostics";
import { LINE_ENDING_PATTERN } from "../shared/line-ending";
import { DEFAULT_MAX_BLOCK_NESTING } from "../defaults/defaults";
import type { BlockStartResult } from "./block";
import {
  ACCUMULATED_LINE_ENDING,
  ATX_MARKER_PATTERN,
  ATX_ONLY_CLOSING_SEQUENCE_PATTERN,
  ATX_TRAILING_CLOSING_SEQUENCE_PATTERN,
  headingLevelOf,
  SETEXT_UNDERLINE_PATTERN,
  SETEXT_LEVEL_1,
  SETEXT_LEVEL_2,
  isBlankContent,
  CLOSING_CODE_FENCE_PATTERN,
  MATH_BLOCK_MARKER_PATTERN,
  THEMATIC_BREAK_PATTERN,
  TRAILING_BLANK_LINES_PATTERN,
  TRAILING_HTML_BLANK_LINES_PATTERN,
  HTML_BLOCK_BLANK_LINE_END_TYPES,
  NUL_PATTERN,
  NUL_REPLACEMENT,
  CODE_FENCE_PATTERN,
} from "./block";
import {
  BlockNode,
  type BlockNodeKind,
  canContain,
  suppressesBlockStarts,
} from "./node";
import { finalizeListTightness, listsMatch, parseListMarker } from "./list";
import { parseTableDelimiterRow, splitTableRow } from "./table";
import { CODE_INDENT_COLUMNS, LineCursor } from "./line";
import { matchFootnoteDefinitionMarker } from "../inline/footnote";
import { unescapeString } from "../inline/entity";
import { extractDefinitions } from "./definitions";
import { matchHtmlBlockStart, matchesHtmlBlockEnd } from "../html/html";

export class BlockParser {
  readonly references = new Map<string, LinkReferenceDefinition>();
  readonly footnotes = new Set<string>();
  private readonly document = new BlockNode("document", 1);
  private readonly tables: boolean;
  private readonly footnotesEnabled: boolean;
  private readonly sink: MarkdownDiagnosticSink;
  private readonly maxNesting: number;
  private tip: BlockNode = this.document;
  // The tip as it stood before the current line was processed, and the deepest block that line matched — together they say exactly which blocks the line failed to continue, which closeUnmatchedBlocks then closes.
  private oldTip: BlockNode = this.document;
  private lastMatchedContainer: BlockNode = this.document;
  // No initial value: incorporateLine constructs the line's own cursor as its first act, so every read below happens against the line currently being processed and a seed here could never be observed. LineCursor.lineIsBlank carries no default for the same reason (src/block/line.ts).
  private line!: LineCursor;
  private lineNumber = 0;
  // Depth of `this.tip` below `this.document` — maintained incrementally (incremented in addChild, decremented in finalize) rather than walked from `parent` on every check, so the guard costs nothing per line for ordinary, shallow documents.
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
    const count =
      source.endsWith("\n") || source.endsWith("\r")
        ? lines.length - 1
        : lines.length;
    for (let index = 0; index < count; index += 1) {
      const text = lines[index];
      if (text !== undefined) {
        this.incorporateLine(text);
      }
    }
    // Close every block the input left open, innermost first: finalize moves the tip to the closed block's own parent, so this walks up the open chain and stops at the document. The document itself is deliberately never finalised: it is the one block that never went through addChild, so leaving it out is what lets finalize decrement the nesting depth unconditionally, and its own finalizeContent case does nothing anyway.
    while (this.tip !== this.document) {
      this.reportUnterminatedAtEof(this.tip);
      this.finalize(this.tip);
    }
    return this.document;
  }

  // Recover-tier diagnostics for a leaf block that reached end-of-input without ever meeting its own proper closing condition: a fenced code block whose closing fence never arrived, or an HTML block of type 1-5 (whose end condition is a pattern in the line's own text, not a blank line) that reached EOF without ever matching it. Types 6/7 end at a blank line OR at EOF alike — both are the block's own ordinary, spec-legal end condition, so EOF is not a diagnostic there.
  private reportUnterminatedAtEof(node: BlockNode): void {
    // `fenced` is set by the fenced-code start and by nothing else, so it identifies the block on its own, with no kind to test alongside it.
    if (node.fenced) {
      this.sink({
        code: MarkdownDiagnosticCodes.UNCLOSED_FENCE,
        severity: "warning",
        message: `fenced code block starting at line ${String(node.startLine)} was never closed by a matching closing fence before the end of the document`,
        line: node.startLine,
      });
      return;
    }
    if (
      node.kind === "htmlBlock" &&
      !HTML_BLOCK_BLANK_LINE_END_TYPES.includes(node.htmlBlockType)
    ) {
      this.sink({
        code: MarkdownDiagnosticCodes.UNTERMINATED_HTML_BLOCK,
        severity: "warning",
        message: `HTML block (type ${String(node.htmlBlockType)}) starting at line ${String(node.startLine)} never met its own end condition before the end of the document`,
        line: node.startLine,
      });
      return;
    }
    if (node.kind === "mathBlock") {
      this.sink({
        code: MarkdownDiagnosticCodes.UNCLOSED_MATH_BLOCK,
        severity: "warning",
        message: `math block starting at line ${String(node.startLine)} was never closed by a matching closing $$ before the end of the document`,
        line: node.startLine,
      });
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
      if (result !== "matched") {
        // 'finished': the block took this line as its own closing delimiter and closed itself on it, so there is nothing left of the line for anything to see. 'not-matched': the line does not continue `lastChild`, so `container` is the deepest block it does continue.
        return result === "finished" ? undefined : container;
      }
      container = lastChild;
    }
  }

  private continueBlock(node: BlockNode): ContinueResult {
    switch (node.kind) {
      case "document":
      case "list":
        return "matched";
      case "blockquote":
        return this.continueBlockquote();
      case "listItem":
        return this.continueListItem(node);
      case "footnoteDefinition":
        return this.continueFootnoteDefinition(node);
      case "codeBlock":
        return this.continueCodeBlock(node);
      case "mathBlock":
        return this.continueMathBlock(node);
      case "htmlBlock":
        // Types 1-5 end on a line whose own text meets their end condition, checked once that line's text has been added (see addTextToContainer); types 6 and 7 end at a blank line instead.
        return this.line.blank &&
          HTML_BLOCK_BLANK_LINE_END_TYPES.includes(node.htmlBlockType)
          ? "not-matched"
          : "matched";
      case "paragraph":
      case "table":
        return this.line.blank ? "not-matched" : "matched";
      case "heading":
      case "thematicBreak":
        // Both own exactly one line and close as soon as the next one arrives.
        return "not-matched";
    }
    return assertNeverBlockKind(node.kind);
  }

  // spec 0.31.2: "A block quote marker consists of 0-3 spaces of initial indent, plus the character `>` together with a following space, or a single character `>` not followed by a space."
  private continueBlockquote(): ContinueResult {
    if (!this.consumeBlockquoteMarker()) {
      return "not-matched";
    }
    return "matched";
  }

  private consumeBlockquoteMarker(): boolean {
    if (this.line.indented || this.line.peekNextNonspace() !== ">") {
      return false;
    }
    this.line.advanceToNextNonspace();
    this.line.advance(1);
    // A tab following the marker counts as ONE column here, with the rest of its expansion left as content indentation — exactly what MarkdownScanCursor's partial tab consumption models (src/scan).
    if (this.line.peek() === " ") {
      this.line.advance(1);
    }
    return true;
  }

  private continueListItem(node: BlockNode): ContinueResult {
    const listData = node.listData;
    if (listData === undefined) {
      return "not-matched";
    }
    if (this.line.blank) {
      // spec 0.31.2: "A list item can begin with at most one blank line" — an item whose first line was blank and that still has no content ends at a second blank line.
      if (node.children.length === 0) {
        return "not-matched";
      }
      this.line.advanceToNextNonspace();
      return "matched";
    }
    if (this.line.indent >= listData.markerOffset + listData.padding) {
      this.line.advance(listData.markerOffset + listData.padding);
      return "matched";
    }
    return "not-matched";
  }

  // A definition's body continues on any line indented at least four columns — the same continuation indent Pandoc and GitHub both use for a multi-block footnote, and the same one src/emit/emit.ts writes back out. A blank line continues it too (a definition may hold several paragraphs), except when the definition still has no content at all, mirroring the "a list item can begin with at most one blank line" rule one function up: `[^1]:` on a line of its own followed by a blank line is an empty definition, not the opening of one that swallows the rest of the document.
  private continueFootnoteDefinition(node: BlockNode): ContinueResult {
    if (this.line.blank) {
      if (node.children.length === 0) {
        return "not-matched";
      }
      this.line.advanceToNextNonspace();
      return "matched";
    }
    if (this.line.indent >= CODE_INDENT_COLUMNS) {
      this.line.advance(CODE_INDENT_COLUMNS);
      return "matched";
    }
    return "not-matched";
  }

  private continueCodeBlock(node: BlockNode): ContinueResult {
    if (!node.fenced) {
      if (this.line.indent >= CODE_INDENT_COLUMNS) {
        this.line.advance(CODE_INDENT_COLUMNS);
        return "matched";
      }
      if (this.line.blank) {
        this.line.advanceToNextNonspace();
        return "matched";
      }
      return "not-matched";
    }

    const rest = this.line.restFromNextNonspace();
    const closing =
      this.line.indented || !rest.startsWith(node.fenceChar)
        ? null
        : CLOSING_CODE_FENCE_PATTERN.exec(rest);
    if (closing !== null && closing[0].length >= node.fenceLength) {
      this.finalize(node);
      return "finished";
    }
    // Not a closing fence: strip up to as many columns of indentation as the opening fence itself carried.
    for (
      let remaining = node.fenceOffset;
      remaining > 0 && this.line.peek() === " ";
      remaining -= 1
    ) {
      this.line.advance(1);
    }
    return "matched";
  }

  // A closing $$ line is never added to the block's own content (matching continueCodeBlock's own closing-fence handling) — finalize runs directly off the line the closer matched, and the line's processing ends there ('finished').
  private continueMathBlock(node: BlockNode): ContinueResult {
    if (
      !this.line.indented &&
      MATH_BLOCK_MARKER_PATTERN.test(this.line.restFromNextNonspace())
    ) {
      this.finalize(node);
      return "finished";
    }
    return "matched";
  }

  // Step 2: try block starts against the deepest matched container until one produces a leaf block, none matches, or the line is plainly ordinary text.
  private openNewBlocks(matchedContainer: BlockNode): BlockNode {
    let container = matchedContainer;
    // A paragraph and a GFM table both accept lines AND still let block starts be tried, so a `>` or a heading on the next line breaks out of either. Neither is named here: suppressesBlockStarts answers false for both already, a table by its own definition and a paragraph because addTextToContainer has already dealt with one.
    let matchedLeaf = suppressesBlockStarts(container.kind);
    while (!matchedLeaf) {
      this.line.findNextNonspace();
      const result = this.tryBlockStart(container);
      if (result === "none") {
        this.line.advanceToNextNonspace();
        break;
      }
      container = this.tip;
      matchedLeaf = result === "leaf";
    }
    return container;
  }

  // The fixed precedence order. See this module's own top-of-file note for what depends on it. Each start declines on its own, on the line's indentation or on its first character, before doing any real work, so the list is a complete answer for every line, ordinary paragraph text included.
  private tryBlockStart(container: BlockNode): BlockStartResult {
    const starts = [
      () => this.tryBlockquoteStart(),
      () => this.tryAtxHeadingStart(),
      () => this.tryCodeFenceStart(),
      () => this.tryMathBlockStart(),
      () => this.tryFootnoteDefinitionStart(container),
      () => this.tryHtmlBlockStart(),
      () => this.tryPromoteParagraph(container),
      () => this.tryThematicBreakStart(),
      () => this.tryListItemStart(container),
      () => this.tryIndentedCodeStart(),
    ];
    for (const start of starts) {
      const result = start();
      if (result !== "none") {
        return result;
      }
    }
    return "none";
  }

  private tryBlockquoteStart(): BlockStartResult {
    if (!this.consumeBlockquoteMarker()) {
      return "none";
    }
    this.closeUnmatchedBlocks();
    this.addChild("blockquote");
    return "container";
  }

  private tryAtxHeadingStart(): BlockStartResult {
    if (this.line.indented) {
      return "none";
    }
    const rest = this.line.restFromNextNonspace();
    const match = ATX_MARKER_PATTERN.exec(rest);
    if (match === null) {
      return "none";
    }
    this.closeUnmatchedBlocks();
    const heading = this.addChild("heading");
    heading.level = headingLevelOf(match[0].trim().length);
    // spec 0.31.2: "The optional closing sequence of #s must be preceded by spaces and may be followed by spaces only" — and a heading that is nothing but a closing sequence has empty content.
    heading.content = rest
      .slice(match[0].length)
      .replace(ATX_ONLY_CLOSING_SEQUENCE_PATTERN, "")
      .replace(ATX_TRAILING_CLOSING_SEQUENCE_PATTERN, "");
    // The whole line is the heading, its own leading indentation included, so there is nothing left for any later step to read a position out of.
    this.line.advanceToEndOfLine();
    return "leaf";
  }

  private tryCodeFenceStart(): BlockStartResult {
    if (this.line.indented) {
      return "none";
    }
    const match = CODE_FENCE_PATTERN.exec(this.line.restFromNextNonspace());
    if (match === null) {
      return "none";
    }
    const fence = match[0];
    const fenceChar = fence.charAt(0);
    if (fenceChar !== "`" && fenceChar !== "~") {
      return "none";
    }
    this.closeUnmatchedBlocks();
    const block = this.addChild("codeBlock");
    block.fenced = true;
    block.fenceChar = fenceChar;
    block.fenceLength = fence.length;
    block.fenceOffset = this.line.indent;
    this.line.advanceToNextNonspace();
    this.line.advance(fence.length);
    return "leaf";
  }

  // A $$ line, meaning the whole line and nothing else (MATH_BLOCK_MARKER_PATTERN), opens a math block, interrupting an open paragraph exactly as a code fence does. The whole opening line is consumed here, unlike a code fence's own opening line: the marker pattern has already matched the line to its end, so there is nothing after the marker that could be an info string or content. What the block accumulates is therefore exactly its literal, once the line ending addLine appends to that consumed opening line is dropped (finalizeMathBlock).
  private tryMathBlockStart(): BlockStartResult {
    if (this.line.indented) {
      return "none";
    }
    if (!MATH_BLOCK_MARKER_PATTERN.test(this.line.restFromNextNonspace())) {
      return "none";
    }
    this.closeUnmatchedBlocks();
    this.addChild("mathBlock");
    this.line.advanceToEndOfLine();
    return "leaf";
  }

  // A footnote definition (ExaDev/markdown-codec#66) opens a CONTAINER, exactly as a list item does: the rest of the marker's own line, and every following line indented four columns, is its body.
  //
  // One restriction, deliberate, about what the ContentDocument mapping downstream can actually represent rather than about markdown's own grammar: it may not interrupt a paragraph, matching a link reference definition (which is only ever recognised at the FRONT of a paragraph's accumulated content, src/block/definitions.ts) and matching Pandoc. A `[^1]: note` line directly under a line of prose is lazy paragraph continuation text.
  //
  // A definition may open directly inside a block quote or a list item (ExaDev/markdown-codec#957) — previously refused, on the reasoning that a definition's own construct pair would need to carry its enclosing container's own scope (ContentListMembership, or the quote's own indent) across the pair with nowhere to attach it. That reasoning predates two mechanisms that already solve exactly this for a blockquote's own division pair, and generalise here unchanged: lowerBlockquote's dual carry threads BlockLowerContext.list straight through a quote's own children regardless of what construct sits among them, and lowerListItem's own placeholder paragraph (ExaDev/documents.js#1012) covers an item whose own first block is ANY construct, not only a blockquote's. A footnote definition's own constructStart/constructEnd pair nests inside the quote's or item's own extent exactly as a nested blockquote already does — see footnoteDefinitionMayOpenIn below for the container check itself.
  private tryFootnoteDefinitionStart(container: BlockNode): BlockStartResult {
    if (
      !this.footnotesEnabled ||
      this.line.indented ||
      !this.footnoteDefinitionMayOpenIn(container)
    ) {
      return "none";
    }
    const marker = matchFootnoteDefinitionMarker(
      this.line.restFromNextNonspace(),
    );
    if (marker === undefined) {
      return "none";
    }
    if (this.footnotes.has(marker.label)) {
      this.sink({
        code: MarkdownDiagnosticCodes.DUPLICATE_FOOTNOTE_DEFINITION,
        severity: "warning",
        message: `footnote "${marker.label}" was already defined earlier in the document; every reference resolves to the first definition, and both definitions are kept as written`,
        line: this.lineNumber,
      });
    }
    this.footnotes.add(marker.label);
    this.line.advanceToNextNonspace();
    this.closeUnmatchedBlocks();
    const node = this.addChild("footnoteDefinition");
    node.footnoteLabel = marker.label;
    this.line.advance(marker.markerLength);
    return "container";
  }

  // Whether `container` — the deepest block the current line matched in step 1 — sits at the document's own top level, directly inside a block quote, or directly inside a list item, walking up through any still-open `list` ancestors first. `continueBlock` treats a `list` node as unconditionally continued no matter what the line is (a list only actually closes when something tries to become its child and can't), so a line right after a list's last item reports its matched container as that LIST, not whatever encloses it, even though the list itself is about to close. Skipping over `list` ancestors here mirrors what `addChild` does a few lines below once a definition is actually opened: it walks up finalising whatever the tip can't contain, which closes a list the same way any other block start does, landing the definition on the list's own enclosing container (the document, a quote, or an item) exactly as if the list had already closed. `footnoteDefinition` is deliberately NOT one of the three permitted kinds: a definition nested inside another definition's own body has no cross-format shape (document-schema.js's `anchor` descriptor names one body per marker pair) and Pandoc/GitHub give no grammar for it either, so a `[^2]:` line inside a `[^1]:` body stays ordinary body text, matching every OTHER unrecognised-here container.
  private footnoteDefinitionMayOpenIn(container: BlockNode): boolean {
    let node: BlockNode | undefined = container;
    while (node?.kind === "list") {
      node = node.parent;
    }
    return (
      node?.kind === "document" ||
      node?.kind === "blockquote" ||
      node?.kind === "listItem"
    );
  }

  private tryHtmlBlockStart(): BlockStartResult {
    if (this.line.indented) {
      return "none";
    }
    // Start condition 7 may not interrupt a paragraph: neither the paragraph this line would break out of, nor one this line could instead continue lazily. One test covers both, because a paragraph is a leaf. While one is open it IS the tip, whether the line reached it (the first case) or stopped at some container above it (the second).
    const interruptsParagraph = this.tip.kind === "paragraph";
    const type = matchHtmlBlockStart(
      this.line.restFromNextNonspace(),
      interruptsParagraph,
    );
    if (type === undefined) {
      return "none";
    }
    this.closeUnmatchedBlocks();
    // The cursor is deliberately not advanced: an HTML block's own leading spaces are part of its literal content.
    this.addChild("htmlBlock").htmlBlockType = type;
    return "leaf";
  }

  // The paragraph-promotion hook. Both constructs it covers convert an ALREADY-OPEN paragraph because of the line that follows it, rather than starting a block of their own from that line.
  //
  // Neither promotion closes unmatched blocks, and neither needs to: a paragraph is a leaf, so an open one is always the tip, and this hook only runs when the line's own continuation walk reached that very paragraph, which is to say when there is nothing left open below the deepest block the line matched.
  //
  // Precedence between the two, and against the thematic-break matcher that runs after this hook: a bare `---` is genuinely ambiguous between a thematic break, a setext level-2 underline, and — on the face of the GFM prose, which defines a row as cells "separated by pipes" and so allows a one-cell row with no pipe at all — a single-column table delimiter row. It is resolved by testing the setext underline FIRST and by requiring a delimiter row to contain a pipe (see src/block/table.ts), which between them make the three cases disjoint rather than merely ordered: `---` is never a delimiter row, `--- | ---` is never a setext underline, and a thematic break is only ever reached when the open paragraph rejected both.
  private tryPromoteParagraph(container: BlockNode): BlockStartResult {
    if (this.line.indented || container.kind !== "paragraph") {
      return "none";
    }
    const setext = this.trySetextHeading(container);
    return setext === "none" ? this.tryTableHeader(container) : setext;
  }

  private trySetextHeading(paragraph: BlockNode): BlockStartResult {
    const match = SETEXT_UNDERLINE_PATTERN.exec(
      this.line.restFromNextNonspace(),
    );
    if (match === null) {
      return "none";
    }
    // Definitions at the front of the paragraph are consumed here rather than at paragraph finalisation, since what is left decides whether there is a heading at all: `[foo]: /url` followed by `---` is a definition and a thematic break, not an empty heading.
    paragraph.content = extractDefinitions(
      paragraph.content,
      this.references,
      this.sink,
      paragraph.startLine,
    );
    if (isBlankContent(paragraph.content)) {
      return "none";
    }
    const heading = new BlockNode("heading", paragraph.startLine);
    heading.level = match[0].startsWith("=") ? SETEXT_LEVEL_1 : SETEXT_LEVEL_2;
    heading.setext = true;
    heading.content = paragraph.content;
    paragraph.replaceWith(heading);
    this.tip = heading;
    this.line.advanceToEndOfLine();
    return "leaf";
  }

  // github.github.com/gfm, "Tables (extension)": the delimiter row promotes the paragraph's own LAST line into a table header, leaving any earlier lines behind as a paragraph in their own right.
  private tryTableHeader(paragraph: BlockNode): BlockStartResult {
    if (!this.tables) {
      return "none";
    }
    const alignments = parseTableDelimiterRow(this.line.restFromNextNonspace());
    if (alignments === undefined) {
      return "none";
    }
    const lines = paragraph.content.split("\n");
    // A paragraph's content always ends with a line ending, so the last element is empty and the header is the one before it.
    const secondToLastLineOffset = -2;
    const headerLine = lines.at(secondToLastLineOffset);
    if (
      headerLine === undefined ||
      splitTableRow(headerLine).length !== alignments.length
    ) {
      return "none";
    }

    paragraph.content = lines
      .slice(0, secondToLastLineOffset)
      .map((text) => `${text}\n`)
      .join("");
    // The paragraph is closed by addChild rather than here: a paragraph cannot contain a table, so the table's own start walks the tip up past it, finalising it on the way and leaving whatever is left of the paragraph as the table's preceding sibling.
    const table = this.addChild("table");
    table.alignments = alignments;
    table.headerLine = headerLine;
    this.line.advanceToEndOfLine();
    return "leaf";
  }

  private tryThematicBreakStart(): BlockStartResult {
    if (
      this.line.indented ||
      !THEMATIC_BREAK_PATTERN.test(this.line.restFromNextNonspace())
    ) {
      return "none";
    }
    this.closeUnmatchedBlocks();
    this.addChild("thematicBreak");
    this.line.advanceToEndOfLine();
    return "leaf";
  }

  private tryListItemStart(container: BlockNode): BlockStartResult {
    const data = parseListMarker(this.line, container.kind === "paragraph");
    if (data === undefined) {
      return "none";
    }
    this.closeUnmatchedBlocks();
    const openList = this.tip.listData;
    if (
      this.tip.kind !== "list" ||
      openList === undefined ||
      !listsMatch(openList, data)
    ) {
      this.addChild("list").listData = data;
    }
    this.addChild("listItem").listData = data;
    return "container";
  }

  private tryIndentedCodeStart(): BlockStartResult {
    // An indented code block cannot interrupt a paragraph (spec 0.31.2, "Indented code blocks") — such a line is paragraph continuation text, indentation and all.
    if (
      !this.line.indented ||
      this.tip.kind === "paragraph" ||
      this.line.blank
    ) {
      return "none";
    }
    this.line.advance(CODE_INDENT_COLUMNS);
    this.closeUnmatchedBlocks();
    this.addChild("codeBlock");
    return "leaf";
  }

  // Step 3: whatever is left of the line becomes content.
  private addTextToContainer(container: BlockNode): void {
    // An open paragraph is always the tip, so any non-blank line reaching this point is that paragraph's own next line: either the continuation walk reached the paragraph itself, or it stopped at some container above it and this is LAZY CONTINUATION, where the paragraph absorbs the line and nothing closes. The two are one step, not two: neither closes anything, and neither records a blank line, since the line is not one.
    if (this.tip.kind === "paragraph" && !this.line.blank) {
      this.addLine();
      return;
    }

    this.closeUnmatchedBlocks();
    const lastChild = container.lastChild;
    if (this.line.blank && lastChild !== undefined) {
      lastChild.lastLineBlank = true;
    }
    this.recordBlankLineForTightness(container);

    // The table is named alongside the predicate rather than inside it: a table takes this line as its own content here, but unlike the three literal-content kinds it still lets a block start be tried against the NEXT line, which is the distinction suppressesBlockStarts draws.
    if (suppressesBlockStarts(container.kind) || container.kind === "table") {
      this.addLine();
      if (
        container.kind === "htmlBlock" &&
        matchesHtmlBlockEnd(this.line.rest(), container.htmlBlockType)
      ) {
        this.finalize(container);
      }
      return;
    }
    if (!this.line.atEnd && !this.line.blank) {
      // No advanceToNextNonspace before the line is added: this branch is only ever reached through openNewBlocks' own "nothing starts here" exit, which has already moved the cursor to the line's first non-space character.
      this.addChild("paragraph");
      this.addLine();
    }
  }

  // A block quote's own lines are never blank (they start with `>`), a fenced block's blank lines are content rather than separators (`fenced` is set by the fenced-code start and by nothing else, so it names that block on its own), and a list item is never itself the block a blank line separates. None of the three may make a list loose. Every other blank line is recorded on the whole open chain, since a blank line deep inside a list separates the blocks of every ancestor it sits in.
  //
  // The list-item case covers both halves of the spec's own rule with one test, because a blank line reaches this function with an item as its deepest matched container in exactly two situations. An item that already has content records the blank line on its own last child instead (the lastLineBlank assignment in addTextToContainer above), which is the block the separation is really between and the one endsWithBlankLine finds by descending (src/block/list.ts). An item with no content at all can only be one whose own marker is on this very line, since continueListItem refuses a blank line for a childless item, and that first blank line is the one the spec explicitly allows an item to begin with.
  private recordBlankLineForTightness(container: BlockNode): void {
    const blank =
      this.line.blank &&
      !(
        container.kind === "blockquote" ||
        container.fenced ||
        container.kind === "listItem"
      );
    for (
      let node: BlockNode | undefined = container;
      node !== undefined;
      node = node.parent
    ) {
      node.lastLineBlank = blank;
    }
  }

  private addLine(): void {
    this.tip.content += `${this.line.rest()}${ACCUMULATED_LINE_ENDING}`;
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

  // Closes every block the current line failed to continue, innermost first. The walk up from `oldTip` stops at the deepest block the line did match, so calling this twice in one line is safe: the second call finds the two already equal and does nothing.
  private closeUnmatchedBlocks(): void {
    while (this.oldTip !== this.lastMatchedContainer) {
      const parent = this.oldTip.parent;
      this.finalize(this.oldTip);
      if (parent === undefined) {
        break;
      }
      this.oldTip = parent;
    }
  }

  private finalize(node: BlockNode): void {
    const above = node.parent;
    node.open = false;
    this.finalizeContent(node);
    // Every block that reaches here was pushed through addChild, which is what incremented nestingDepth. The document, the one block that was not, is never finalised (see parse).
    this.nestingDepth -= 1;
    // A node whose own parent is gone, as a paragraph replaced in place by a promotion is, leaves the tip on the document rather than nowhere.
    this.tip = above ?? this.document;
  }

  private finalizeContent(node: BlockNode): void {
    switch (node.kind) {
      case "paragraph":
        node.content = extractDefinitions(
          node.content,
          this.references,
          this.sink,
          node.startLine,
        );
        // A paragraph that held nothing but link reference definitions leaves no block behind at all. The same is true of one truncated to nothing by a table promotion, which is why this tests the remaining content rather than whether any definition was found.
        if (isBlankContent(node.content)) {
          node.unlink();
        }
        return;
      case "codeBlock":
        this.finalizeCodeBlock(node);
        return;
      case "mathBlock":
        this.finalizeMathBlock(node);
        return;
      case "htmlBlock":
        node.literal = node.content.replace(
          TRAILING_HTML_BLANK_LINES_PATTERN,
          "",
        );
        return;
      case "list":
        finalizeListTightness(node);
        return;
      // Every other block kind is finalized entirely by its own parser and carries nothing to settle once its lines have been consumed, so reaching the end of one is the ordinary case rather than a gap.
      default:
        return;
    }
  }

  private finalizeCodeBlock(node: BlockNode): void {
    if (!node.fenced) {
      node.literal = node.content.replace(TRAILING_BLANK_LINES_PATTERN, "\n");
      return;
    }
    // The opening fence's own line carries the info string, and it is always present in the content: a fenced block's start always falls through to addLine on that same line.
    const breakIndex = node.content.indexOf("\n");
    node.infoString = unescapeString(node.content.slice(0, breakIndex).trim());
    node.literal = node.content.slice(breakIndex + 1);
  }

  // The opening "$$" line is consumed in full by tryMathBlockStart, so the only thing it leaves behind in `content` is the line ending addLine appends to every line it accumulates. Dropping that one character is the whole of the conversion: there is no info-string line to find and slice past, as there is for a fenced code block.
  private finalizeMathBlock(node: BlockNode): void {
    node.literal = node.content.slice(ACCUMULATED_LINE_ENDING.length);
  }
}
