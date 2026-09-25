import type { LinkReferenceMap } from "../inline/link";
import { type BlockNode } from "./node";

// The block phase: markdown source text -> src/ast's block tree, with each leaf block's own inline content parsed afterwards by src/inline.
//
// This is CommonMark 0.31.2's own "Phase 1: block structure" algorithm (spec appendix A, "A parsing strategy"), which is not a recursive descent and cannot be written as one. Each line is processed in three steps against a STACK OF OPEN BLOCKS:
//
//  1. Continuation matching — walk down the chain of currently-open blocks from the document, asking each whether this line continues it (a block quote wants its `>`, a list item wants its content indent, a fenced code block wants anything that is not its closing fence) and consuming that block's own prefix from the line as we go. The walk stops at the first block that says no.
//  2. New block starts — with whatever prefix remains, try each block start in a FIXED precedence order until one matches, adding the new block to the last block that did match in step 1. A container start (block quote, list item) leaves the loop running so `> - foo` opens both; a leaf start (heading, code block, table, HTML block, thematic break) ends it.
//  3. Text — whatever is left of the line becomes the content of the block now at the top of the stack, either as a continuation of an open leaf block or as a new paragraph.
//
// The precedence order in step 2 is fixed and load-bearing: blockquote, ATX heading, fenced code, HTML block, PARAGRAPH PROMOTION, thematic break, list item, indented code. Two consequences that look like special cases but are really just this ordering:
//
//  - `- - -` is a thematic break, not a three-item list, because the thematic-break matcher runs before the list-item matcher. Nothing anywhere in this package special-cases that input.
//  - `Foo` followed by `---` is a setext heading, not a paragraph followed by a thematic break, because paragraph promotion runs before the thematic-break matcher.
//
// PARAGRAPH PROMOTION is the one step that is not a block start at all, which is why it is a separate hook rather than another entry in the same list. A block start creates a NEW block from the current line; a promotion REPLACES an already-open paragraph because of the line that follows it. Two constructs work that way — a setext heading underline and a GFM table delimiter row — and both need the paragraph's own accumulated content, not just the current line. Their mutual precedence is settled in tryPromoteParagraph below.
//
// LAZY CONTINUATION falls out of steps 1 and 3 together rather than being a rule of its own: when step 1 stops early but the block at the top of the stack is a paragraph and the line is neither blank nor the start of a new block, step 3 adds the line to that paragraph anyway, without closing anything. That is what lets a paragraph inside a block quote continue across a line with no `>`, while a setext underline or a table delimiter row on such a line does not promote it — step 2 sees the last MATCHED container, which is no longer the paragraph.
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
} from "../ast/ast";
import type { FootnoteLabelSet } from "../inline/footnote";

import type { MarkdownDiagnosticSink } from "../diagnostics/diagnostics";
import {
  MarkdownDiagnosticCodes,
  NOOP_MARKDOWN_DIAGNOSTIC_SINK,
} from "../diagnostics/diagnostics";

import type { InlineParseOptions } from "../inline/inline";
import { parseInlines } from "../inline/inline";

import type { BlockHeadingLevel } from "./node";
import { BlockParser } from "./parser";

import { fitRowToColumns, splitTableRow } from "./table";

// GFM 'Task list items (extension)': a list item is a task item when the first block directly inside it is a paragraph whose raw content begins with a task-list-item marker — an optional-content left bracket, a space or `x`/`X`, a right bracket, then at least one space or tab before anything else. Matched against the paragraph's own accumulated raw content (leading indentation already stripped by the block phase), never against already-parsed inline nodes.
export const TASK_LIST_MARKER_PATTERN = /^\[([ xX])\][ \t]/;

// spec 0.31.2, "Insecure characters": U+0000 must be replaced with U+FFFD.
export const NUL_REPLACEMENT = "�";
export const NUL_PATTERN = /\0/g;

// spec 0.31.2, "ATX headings": one to six `#` characters, followed by spaces/tabs or the end of the line. Exported for src/emit/emit.ts's own setext-safety check (the setext grammar's third clause, spec 0.31.2 "Setext headings": a non-first line of a would-be setext heading's text may not itself be interpretable as an ATX heading among other constructs) — reusing this pattern rather than restating it there is what keeps the write side's promotion refusal and this module's own reparse from ever drifting apart.
export const ATX_MARKER_PATTERN = /^#{1,6}(?:[ \t]+|$)/;
export const ATX_ONLY_CLOSING_SEQUENCE_PATTERN = /^[ \t]*#+[ \t]*$/;
export const ATX_TRAILING_CLOSING_SEQUENCE_PATTERN = /[ \t]+#+[ \t]*$/;

// spec 0.31.2, "Fenced code blocks": at least three backticks or tildes. A backtick fence's own info string may not contain a backtick, which the lookahead enforces at the point of matching rather than after the fact. Exported for the same setext-safety reuse as ATX_MARKER_PATTERN above.
export const CODE_FENCE_PATTERN = /^`{3,}(?!.*`)|^~{3,}/;
export const CLOSING_CODE_FENCE_PATTERN = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;

// Pandoc/GitHub math-extension display math (ExaDev/markdown-codec#53): a line consisting of exactly $$, optionally followed by trailing spaces/tabs and nothing else — deliberately stricter than the code-fence pattern above (no "info string", no variable length): both the opening and the closing line must match this exact shape, which is what makes a bare "$$" line on its own unambiguous rather than colliding with GFM's own single-dollar-free inline math (this package never adds inline $$ recognition at all, only \( \)). Exported for the same setext-safety reuse as ATX_MARKER_PATTERN above: a $$ line interrupts an open paragraph exactly as a code fence does (see src/emit/emit.ts's own canInterruptOpenParagraph), so a would-be setext heading's own line matching it is just as much a paragraph-interrupting construct as the six CommonMark names explicitly.
export const MATH_BLOCK_MARKER_PATTERN = /^\$\$[ \t]*$/;

// The line ending addLine puts after every line it accumulates, whatever the source line itself ended with (see addLine, and the note on BLOCK_EDGE_SPACE_OR_TAB_PATTERN below for why it is there at all).
export const ACCUMULATED_LINE_ENDING = "\n";

// spec 0.31.2, "Setext headings": a sequence of `=` or of `-`, optionally followed by spaces/tabs, and nothing else.
export const SETEXT_UNDERLINE_PATTERN = /^(?:=+|-+)[ \t]*$/;

// spec 0.31.2, "Thematic breaks": three or more matching `*`, `-`, or `_` characters, with optional spaces/tabs between and after them. Exported for the same setext-safety reuse as ATX_MARKER_PATTERN above.
export const THEMATIC_BREAK_PATTERN =
  /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;

const BLANK_CONTENT_PATTERN = /^[ \t\n]*$/;

// An indented code block's own trailing blank lines are not part of it; the same is true of an HTML block, which additionally may not keep the trailing line ending at all.
export const TRAILING_BLANK_LINES_PATTERN = /(?:\n[ \t]*)+$/;
export const TRAILING_HTML_BLANK_LINES_PATTERN = /(?:\n *)+$/;

const MAX_HEADING_LEVEL = 6;
export const SETEXT_LEVEL_1 = 1;
export const SETEXT_LEVEL_2 = 2;

// The two HTML block types whose end condition is a blank line rather than anything in the line's own text (spec 0.31.2, conditions 6 and 7).
const HTML_BLOCK_TYPE_CONDITION_6 = 6;
const HTML_BLOCK_TYPE_CONDITION_7 = 7;
export const HTML_BLOCK_BLANK_LINE_END_TYPES: readonly number[] = [
  HTML_BLOCK_TYPE_CONDITION_6,
  HTML_BLOCK_TYPE_CONDITION_7,
];

export type BlockStartResult = "none" | "container" | "leaf";
// 'finished' is a fenced code block consuming its own closing fence: the line is fully accounted for and the block is already closed, so the line's processing ends there.
export type ContinueResult = "matched" | "not-matched" | "finished";

export interface MarkdownParseOptions extends InlineParseOptions {
  // GFM's table extension. Enabled by default, matching this package's CommonMark+GFM target; the CommonMark conformance suite switches it off along with the other GFM toggles, since a delimiter row is ordinary paragraph text under CommonMark alone.
  readonly gfmTables?: boolean;
  // GFM's task-list-item extension (`- [ ] foo` / `- [x] bar`). Enabled by default for the same reason; with it off, a leading `[ ]`/`[x]` is ordinary paragraph text, matching CommonMark's own reading (task lists are not part of CommonMark proper).
  readonly gfmTaskLists?: boolean;
  // GitHub's footnote extension (`[^label]` markers with `[^label]: body` definitions, ExaDev/markdown-codec#66). Enabled by default like the four above; with it off, both spellings are ordinary text, which is what CommonMark and the GFM spec document itself both say (neither defines footnotes at all — see src/inline/footnote.ts).
  readonly footnotes?: boolean;
  // Throws MarkdownNestingLimitExceededError (src/diagnostics) rather than opening a block past this many levels deep in the open-block stack — defaults to DEFAULT_MAX_BLOCK_NESTING (src/defaults), matching cmark's own reference-implementation guard against pathological/adversarial nesting.
  readonly maxNesting?: number;
  readonly sink?: MarkdownDiagnosticSink;
}

export interface ParsedMarkdown {
  readonly document: MarkdownDocumentNode;
  // The document-global link-reference-definition table, complete before any inline was parsed against it.
  readonly references: LinkReferenceMap;
  // The document-global set of footnote labels a definition was found for, complete before any inline was parsed against it — the same forward-visibility guarantee `references` carries, for the same structural reason.
  readonly footnotes: FootnoteLabelSet;
}

export function isBlankContent(content: string): boolean {
  return BLANK_CONTENT_PATTERN.test(content);
}

export function headingLevelOf(hashes: number): BlockHeadingLevel {
  // Below MAX_HEADING_LEVEL (6), hashes maps to its own level 1:1; MAX_HEADING_LEVEL itself and anything outside the 1..5 range both collapse to MAX_HEADING_LEVEL, matching this function's original switch-per-level shape.
  if (hashes >= 1 && hashes < MAX_HEADING_LEVEL) {
    // hashes is now known to be 1-5 inclusive, exactly one of BlockHeadingLevel's own remaining members. The assertion is unavoidable, since no runtime range check narrows a plain `number` to a literal union on its own.
    return hashes as BlockHeadingLevel;
  }
  return MAX_HEADING_LEVEL;
}

// The two document-global tables the inline phase resolves against, plus the parse options, threaded through the AST conversion as one value rather than as three parallel parameters on every function below.
interface AstConversionContext {
  readonly references: LinkReferenceMap;
  readonly footnotes: FootnoteLabelSet;
  readonly options: MarkdownParseOptions;
}

// Every line addLine appends (including a leaf block's own LAST line) carries a synthetic trailing '\n' — bookkeeping internal to accumulation, present unconditionally whether or not the ORIGINAL source line it came from was itself followed by one (see Parser.parse above: the source's own final line ending, if any, is deliberately excluded from the split before a single addLine call ever runs). Left in place, that trailing artifact reaches parseInlines indistinguishable from a genuine line ending BETWEEN two real lines of content, and parseLineBreak has no way to tell "nothing follows, this is bookkeeping" apart from "another line of this same block follows, this is a real soft/hard break" — so a block ending exactly at end-of-input would mint a spurious trailing softBreak/hardBreak node with nothing on its far side (ExaDev/documents.js#940's own debug-softbreak.mjs exploration: `parseLineBreak` fires unconditionally on any '\n' it scans, with no end-of-content lookahead). A leaf block built by some other path than addLine (an ATX heading's single-line content, sliced directly off its own source line — tryAtxHeadingStart above) never carries this artifact in the first place, so stripping it is conditional on it actually being present, not an unconditional slice.
//
// Once that artifact is gone, what remains is spec 0.31.2's own "Paragraphs" rule: the raw content is formed "by concatenating the lines and removing initial and final spaces or tabs" — ASCII space (U+0020) and tab (U+0009) ONLY, not the broader Unicode whitespace category JavaScript's own String.prototype.trim() strips (NBSP U+00A0, the various em/en spaces, line/paragraph separators, BOM...). That distinction is load-bearing too: an entity reference decodes to its literal character during INLINE parsing, which runs AFTER this trim — but this package's own writer re-emits that decoded character verbatim, so a paragraph or heading whose rendered markdown happens to START or END with, say, a &nbsp;-derived U+00A0 reaches this exact trim again on reparse, this time as a literal character already sitting at the block's own edge. A plain .trim() would silently swallow it there, misreading real content as insignificant padding.
const BLOCK_EDGE_SPACE_OR_TAB_PATTERN = /^[ \t]+|[ \t]+$/g;

export function trimBlockContent(text: string): string {
  const withoutTrailingArtifactNewline = text.endsWith("\n")
    ? text.slice(0, -1)
    : text;
  return withoutTrailingArtifactNewline.replace(
    BLOCK_EDGE_SPACE_OR_TAB_PATTERN,
    "",
  );
}

function toInlineChildren(
  content: string,
  context: AstConversionContext,
): MarkdownInlineNode[] {
  // A leaf block's accumulated content keeps the line endings that separated its source lines but not the whitespace around the block itself: leading indentation was stripped as each line was added, and trailing whitespace at the very end of the block is not a hard line break.
  return parseInlines(
    trimBlockContent(content),
    context.references,
    context.footnotes,
    context.options,
  );
}

function toHeadingNode(
  node: BlockNode,
  context: AstConversionContext,
): MarkdownHeadingNode {
  return {
    type: "heading",
    level: node.level,
    style: node.setext ? "setext" : "atx",
    children: toInlineChildren(node.content, context),
  };
}

// Extracts a task-list-item marker from the FIRST child of a list item, mutating that child's own raw content in place to strip the marker (so the paragraph's own inline content, parsed afterwards, never sees it). Returns undefined — never a false/absent sentinel — when the item is not a task item at all, matching MarkdownListItemNode.checked's own "absent, not false" convention.
function extractTaskListMarker(
  itemChildren: readonly BlockNode[],
): boolean | undefined {
  const first = itemChildren[0];
  if (first?.kind !== "paragraph") {
    return undefined;
  }
  const match = TASK_LIST_MARKER_PATTERN.exec(first.content);
  if (match === null) {
    return undefined;
  }
  first.content = first.content.slice(match[0].length);
  return match[1] !== " ";
}

function toListItemNode(
  item: BlockNode,
  context: AstConversionContext,
): MarkdownListItemNode {
  const taskLists = context.options.gfmTaskLists ?? true;
  const checked = taskLists ? extractTaskListMarker(item.children) : undefined;
  return checked === undefined
    ? { type: "listItem", children: toAstBlocks(item.children, context) }
    : {
        type: "listItem",
        checked,
        children: toAstBlocks(item.children, context),
      };
}

function toListNode(
  node: BlockNode,
  context: AstConversionContext,
): MarkdownListNode {
  const children: MarkdownListItemNode[] = node.children.map((item) =>
    toListItemNode(item, context),
  );
  const data = node.listData;
  if (data?.type === "ordered") {
    return {
      type: "list",
      markerType: "ordered",
      orderedDelimiter: data.delimiter,
      start: data.start,
      tight: node.tight,
      children,
    };
  }
  return {
    type: "list",
    markerType: "bullet",
    bulletMarker: data?.bulletChar,
    tight: node.tight,
    children,
  };
}

function toTableRow(
  cells: readonly string[],
  header: boolean,
  context: AstConversionContext,
): MarkdownTableRowNode {
  const children: MarkdownTableCellNode[] = cells.map((cell) => ({
    type: "tableCell",
    children: toInlineChildren(cell, context),
  }));
  return { type: "tableRow", header, children };
}

function toTableNode(
  node: BlockNode,
  context: AstConversionContext,
): MarkdownTableNode {
  const sink = context.options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
  const columnCount = node.alignments.length;
  const rows: MarkdownTableRowNode[] = [
    toTableRow(
      fitRowToColumns(splitTableRow(node.headerLine), columnCount),
      true,
      context,
    ),
  ];
  for (const rowLine of node.content.split(ACCUMULATED_LINE_ENDING)) {
    // The only empty elements here are the delimiter row's own consumed line and the one the final line ending leaves after it: a blank line does not continue a table at all (see continueBlock), so no line the table actually accumulated is ever whitespace-only.
    if (rowLine.length === 0) {
      continue;
    }
    const cells = splitTableRow(rowLine);
    if (cells.length !== columnCount) {
      sink({
        code: MarkdownDiagnosticCodes.TABLE_CELL_COUNT_MISMATCH,
        severity: "warning",
        message: `table row has ${String(cells.length)} cell(s), but the header row declares ${String(columnCount)}; the row is padded with empty cells or truncated to fit`,
        line: node.startLine,
      });
    }
    rows.push(toTableRow(fitRowToColumns(cells, columnCount), false, context));
  }
  return { type: "table", alignments: node.alignments, children: rows };
}

function toAstBlock(
  node: BlockNode,
  context: AstConversionContext,
): MarkdownBlockNode | undefined {
  switch (node.kind) {
    case "paragraph":
      return {
        type: "paragraph",
        children: toInlineChildren(node.content, context),
      };
    case "heading":
      return toHeadingNode(node, context);
    case "blockquote":
      return {
        type: "blockquote",
        children: toAstBlocks(node.children, context),
      };
    case "list":
      return toListNode(node, context);
    case "footnoteDefinition":
      return {
        type: "footnoteDefinition",
        label: node.footnoteLabel,
        children: toAstBlocks(node.children, context),
      };
    case "codeBlock":
      return node.fenced
        ? {
            type: "codeBlock",
            fenced: true,
            fenceChar: node.fenceChar,
            infoString: node.infoString,
            literal: node.literal,
          }
        : { type: "codeBlock", fenced: false, literal: node.literal };
    case "htmlBlock":
      return { type: "htmlBlock", literal: node.literal };
    case "thematicBreak":
      return { type: "thematicBreak" };
    case "mathBlock":
      return { type: "mathBlock", literal: node.literal };
    case "table":
      return toTableNode(node, context);
    case "document":
    case "listItem":
      // Neither can appear as a child of anything toAstBlocks walks: a document is the root, and a list item is only ever reached through its own list.
      return undefined;
  }
  return assertNeverBlockKind(node.kind);
}

function toAstBlocks(
  nodes: readonly BlockNode[],
  context: AstConversionContext,
): MarkdownBlockNode[] {
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
export function parseMarkdown(
  source: string,
  options: MarkdownParseOptions = {},
): ParsedMarkdown {
  const parser = new BlockParser(options);
  const root = parser.parse(source);
  const context: AstConversionContext = {
    references: parser.references,
    footnotes: parser.footnotes,
    options,
  };
  return {
    document: {
      type: "document",
      children: toAstBlocks(root.children, context),
    },
    references: context.references,
    footnotes: context.footnotes,
  };
}

// Reached only if BlockNodeKind ever gains a member continueBlock's and toAstBlock's own switches do not match: every current member has a case in both, so `node.kind` narrows to `never` at each call, and adding an uncovered member makes that narrowing fail and the call stop compiling. Exists so the switch's exhaustiveness, proven by the type checker rather than by a catch-all default that would silently drop a genuinely new member, still gives consistent-return an explicit statement to see past the switch. Exported so the tests can exercise the throw directly with a forced-invalid cast, since it is otherwise unreachable.
export function assertNeverBlockKind(kind: never): never {
  throw new Error(
    `markdown-codec: unhandled block kind ${JSON.stringify(kind)}`,
  );
}
