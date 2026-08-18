import { matchFootnoteDefinitionMarker } from "../inline/footnote.js";
import "../defaults/defaults.js";
import { MarkdownDiagnosticCodes, MarkdownNestingLimitExceededError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from "../diagnostics/diagnostics.js";
import { matchHtmlBlockStart, matchesHtmlBlockEnd } from "../html/html.js";
import { unescapeString } from "../inline/entity.js";
import { parseInlines } from "../inline/inline.js";
import { extractDefinitions } from "./definitions.js";
import { LineCursor } from "./line.js";
import { finalizeListTightness, listsMatch, parseListMarker } from "./list.js";
import { BlockNode, acceptsLines, canContain } from "./node.js";
import { fitRowToColumns, parseTableDelimiterRow, splitTableRow } from "./table.js";
//#region src/block/block.ts
const TASK_LIST_MARKER_PATTERN = /^\[([ xX])\][ \t]/;
const NUL_REPLACEMENT = "�";
const NUL_PATTERN = /\0/g;
const LINE_ENDING_PATTERN = /\r\n|\n|\r/;
const MAYBE_SPECIAL_PATTERN = /^[#$`~*+_=<>[0-9|:-]/;
const ATX_MARKER_PATTERN = /^#{1,6}(?:[ \t]+|$)/;
const ATX_ONLY_CLOSING_SEQUENCE_PATTERN = /^[ \t]*#+[ \t]*$/;
const ATX_TRAILING_CLOSING_SEQUENCE_PATTERN = /[ \t]+#+[ \t]*$/;
const CODE_FENCE_PATTERN = /^`{3,}(?!.*`)|^~{3,}/;
const CLOSING_CODE_FENCE_PATTERN = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;
const MATH_BLOCK_MARKER_PATTERN = /^\$\$[ \t]*$/;
const MATH_BLOCK_MARKER_LENGTH = 2;
const SETEXT_UNDERLINE_PATTERN = /^(?:=+|-+)[ \t]*$/;
const THEMATIC_BREAK_PATTERN = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
const BLANK_CONTENT_PATTERN = /^[ \t\n]*$/;
const TRAILING_BLANK_LINES_PATTERN = /(?:\n[ \t]*)+$/;
const TRAILING_HTML_BLANK_LINES_PATTERN = /(?:\n *)+$/;
const MAX_HEADING_LEVEL = 6;
const SETEXT_LEVEL_1 = 1;
const SETEXT_LEVEL_2 = 2;
const HTML_BLOCK_BLANK_LINE_END_TYPES = [6, 7];
function isBlankContent(content) {
	return BLANK_CONTENT_PATTERN.test(content);
}
function headingLevelOf(hashes) {
	switch (hashes) {
		case 1: return 1;
		case 2: return 2;
		case 3: return 3;
		case 4: return 4;
		case 5: return 5;
		default: return MAX_HEADING_LEVEL;
	}
}
var BlockParser = class {
	references = /* @__PURE__ */ new Map();
	footnotes = /* @__PURE__ */ new Set();
	document = new BlockNode("document", 1);
	tables;
	footnotesEnabled;
	sink;
	maxNesting;
	tip = this.document;
	oldTip = this.document;
	lastMatchedContainer = this.document;
	allClosed = true;
	line = new LineCursor("");
	lineNumber = 0;
	nestingDepth = 0;
	constructor(options) {
		this.tables = options.gfmTables ?? true;
		this.footnotesEnabled = options.footnotes ?? true;
		this.sink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
		this.maxNesting = options.maxNesting ?? 250;
	}
	parse(source) {
		const lines = source.split(LINE_ENDING_PATTERN);
		const count = source.endsWith("\n") || source.endsWith("\r") ? lines.length - 1 : lines.length;
		for (let index = 0; index < count; index += 1) {
			const text = lines[index];
			if (text !== void 0) this.incorporateLine(text);
		}
		while (this.tip.open) {
			this.reportUnterminatedAtEof(this.tip);
			this.finalize(this.tip);
		}
		return this.document;
	}
	reportUnterminatedAtEof(node) {
		if (node.kind === "codeBlock" && node.fenced) {
			this.sink({
				code: MarkdownDiagnosticCodes.UNCLOSED_FENCE,
				severity: "warning",
				message: `fenced code block starting at line ${String(node.startLine)} was never closed by a matching closing fence before the end of the document`,
				line: node.startLine
			});
			return;
		}
		if (node.kind === "htmlBlock" && !HTML_BLOCK_BLANK_LINE_END_TYPES.includes(node.htmlBlockType)) {
			this.sink({
				code: MarkdownDiagnosticCodes.UNTERMINATED_HTML_BLOCK,
				severity: "warning",
				message: `HTML block (type ${String(node.htmlBlockType)}) starting at line ${String(node.startLine)} never met its own end condition before the end of the document`,
				line: node.startLine
			});
			return;
		}
		if (node.kind === "mathBlock") this.sink({
			code: MarkdownDiagnosticCodes.UNCLOSED_MATH_BLOCK,
			severity: "warning",
			message: `math block starting at line ${String(node.startLine)} was never closed by a matching closing $$ before the end of the document`,
			line: node.startLine
		});
	}
	incorporateLine(rawText) {
		this.lineNumber += 1;
		this.line = new LineCursor(rawText.replace(NUL_PATTERN, NUL_REPLACEMENT));
		this.oldTip = this.tip;
		const matched = this.walkOpenBlocks();
		if (matched === void 0) return;
		this.allClosed = matched === this.oldTip;
		this.lastMatchedContainer = matched;
		this.addTextToContainer(this.openNewBlocks(matched));
	}
	walkOpenBlocks() {
		let container = this.document;
		for (;;) {
			const lastChild = container.lastChild;
			if (lastChild?.open !== true) return container;
			this.line.findNextNonspace();
			const result = this.continueBlock(lastChild);
			if (result === "finished") return;
			if (result === "not-matched") return container;
			container = lastChild;
		}
	}
	continueBlock(node) {
		switch (node.kind) {
			case "document":
			case "list": return "matched";
			case "blockquote": return this.continueBlockquote();
			case "listItem": return this.continueListItem(node);
			case "footnoteDefinition": return this.continueFootnoteDefinition(node);
			case "codeBlock": return this.continueCodeBlock(node);
			case "mathBlock": return this.continueMathBlock(node);
			case "htmlBlock": return this.line.blank && HTML_BLOCK_BLANK_LINE_END_TYPES.includes(node.htmlBlockType) ? "not-matched" : "matched";
			case "paragraph":
			case "table": return this.line.blank ? "not-matched" : "matched";
			case "heading":
			case "thematicBreak": return "not-matched";
		}
	}
	continueBlockquote() {
		if (!this.consumeBlockquoteMarker()) return "not-matched";
		return "matched";
	}
	consumeBlockquoteMarker() {
		if (this.line.indented || this.line.peekNextNonspace() !== ">") return false;
		this.line.advanceToNextNonspace();
		this.line.advance(1);
		if (this.line.peek() === " ") this.line.advance(1);
		return true;
	}
	continueListItem(node) {
		const listData = node.listData;
		if (listData === void 0) return "not-matched";
		if (this.line.blank) {
			if (node.children.length === 0) return "not-matched";
			this.line.advanceToNextNonspace();
			return "matched";
		}
		if (this.line.indent >= listData.markerOffset + listData.padding) {
			this.line.advance(listData.markerOffset + listData.padding);
			return "matched";
		}
		return "not-matched";
	}
	continueFootnoteDefinition(node) {
		if (this.line.blank) {
			if (node.children.length === 0) return "not-matched";
			this.line.advanceToNextNonspace();
			return "matched";
		}
		if (this.line.indent >= 4) {
			this.line.advance(4);
			return "matched";
		}
		return "not-matched";
	}
	continueCodeBlock(node) {
		if (!node.fenced) {
			if (this.line.indent >= 4) {
				this.line.advance(4);
				return "matched";
			}
			if (this.line.blank) {
				this.line.advanceToNextNonspace();
				return "matched";
			}
			return "not-matched";
		}
		const rest = this.line.restFromNextNonspace();
		const closing = this.line.indented || !rest.startsWith(node.fenceChar) ? null : CLOSING_CODE_FENCE_PATTERN.exec(rest);
		if (closing !== null && closing[0].length >= node.fenceLength) {
			this.finalize(node);
			return "finished";
		}
		for (let remaining = node.fenceOffset; remaining > 0 && this.line.peek() === " "; remaining -= 1) this.line.advance(1);
		return "matched";
	}
	continueMathBlock(node) {
		if (!this.line.indented && MATH_BLOCK_MARKER_PATTERN.test(this.line.restFromNextNonspace())) {
			this.finalize(node);
			return "finished";
		}
		return "matched";
	}
	openNewBlocks(matchedContainer) {
		let container = matchedContainer;
		let matchedLeaf = container.kind !== "paragraph" && container.kind !== "table" && acceptsLines(container.kind);
		while (!matchedLeaf) {
			this.line.findNextNonspace();
			if (!this.line.indented && !MAYBE_SPECIAL_PATTERN.test(this.line.restFromNextNonspace())) {
				this.line.advanceToNextNonspace();
				break;
			}
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
	tryBlockStart(container) {
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
			() => this.tryIndentedCodeStart()
		];
		for (const start of starts) {
			const result = start();
			if (result !== "none") return result;
		}
		return "none";
	}
	tryBlockquoteStart() {
		if (!this.consumeBlockquoteMarker()) return "none";
		this.closeUnmatchedBlocks();
		this.addChild("blockquote");
		return "container";
	}
	tryAtxHeadingStart() {
		if (this.line.indented) return "none";
		const rest = this.line.restFromNextNonspace();
		const match = ATX_MARKER_PATTERN.exec(rest);
		if (match === null) return "none";
		this.line.advanceToNextNonspace();
		this.closeUnmatchedBlocks();
		const heading = this.addChild("heading");
		heading.level = headingLevelOf(match[0].trim().length);
		heading.content = rest.slice(match[0].length).replace(ATX_ONLY_CLOSING_SEQUENCE_PATTERN, "").replace(ATX_TRAILING_CLOSING_SEQUENCE_PATTERN, "");
		this.line.advanceToEndOfLine();
		return "leaf";
	}
	tryCodeFenceStart() {
		if (this.line.indented) return "none";
		const match = CODE_FENCE_PATTERN.exec(this.line.restFromNextNonspace());
		if (match === null) return "none";
		const fence = match[0];
		const fenceChar = fence.charAt(0);
		if (fenceChar !== "`" && fenceChar !== "~") return "none";
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
	tryMathBlockStart() {
		if (this.line.indented) return "none";
		if (!MATH_BLOCK_MARKER_PATTERN.test(this.line.restFromNextNonspace())) return "none";
		this.closeUnmatchedBlocks();
		this.addChild("mathBlock");
		this.line.advanceToNextNonspace();
		this.line.advance(MATH_BLOCK_MARKER_LENGTH);
		return "leaf";
	}
	tryFootnoteDefinitionStart(container) {
		if (!this.footnotesEnabled || this.line.indented || container.kind !== "document") return "none";
		const marker = matchFootnoteDefinitionMarker(this.line.restFromNextNonspace());
		if (marker === void 0) return "none";
		if (this.footnotes.has(marker.label)) this.sink({
			code: MarkdownDiagnosticCodes.DUPLICATE_FOOTNOTE_DEFINITION,
			severity: "warning",
			message: `footnote "${marker.label}" was already defined earlier in the document; every reference resolves to the first definition, and both definitions are kept as written`,
			line: this.lineNumber
		});
		this.footnotes.add(marker.label);
		this.line.advanceToNextNonspace();
		this.closeUnmatchedBlocks();
		const node = this.addChild("footnoteDefinition");
		node.footnoteLabel = marker.label;
		this.line.advance(marker.markerLength);
		return "container";
	}
	tryHtmlBlockStart(container) {
		if (this.line.indented || this.line.peekNextNonspace() !== "<") return "none";
		const interruptsParagraph = container.kind === "paragraph" || !this.allClosed && !this.line.blank && this.tip.kind === "paragraph";
		const type = matchHtmlBlockStart(this.line.restFromNextNonspace(), interruptsParagraph);
		if (type === void 0) return "none";
		this.closeUnmatchedBlocks();
		this.addChild("htmlBlock").htmlBlockType = type;
		return "leaf";
	}
	tryPromoteParagraph(container) {
		if (this.line.indented || container.kind !== "paragraph") return "none";
		const setext = this.trySetextHeading(container);
		return setext === "none" ? this.tryTableHeader(container) : setext;
	}
	trySetextHeading(paragraph) {
		const match = SETEXT_UNDERLINE_PATTERN.exec(this.line.restFromNextNonspace());
		if (match === null) return "none";
		this.closeUnmatchedBlocks();
		paragraph.content = extractDefinitions(paragraph.content, this.references, this.sink, paragraph.startLine);
		if (isBlankContent(paragraph.content)) return "none";
		const heading = new BlockNode("heading", paragraph.startLine);
		heading.level = match[0].startsWith("=") ? SETEXT_LEVEL_1 : SETEXT_LEVEL_2;
		heading.setext = true;
		heading.content = paragraph.content;
		paragraph.replaceWith(heading);
		this.tip = heading;
		this.line.advanceToEndOfLine();
		return "leaf";
	}
	tryTableHeader(paragraph) {
		if (!this.tables) return "none";
		const alignments = parseTableDelimiterRow(this.line.restFromNextNonspace());
		if (alignments === void 0) return "none";
		const lines = paragraph.content.split("\n");
		const headerLine = lines.at(-2);
		if (headerLine === void 0 || splitTableRow(headerLine).length !== alignments.length) return "none";
		this.closeUnmatchedBlocks();
		paragraph.content = lines.slice(0, -2).map((text) => `${text}\n`).join("");
		this.finalize(paragraph);
		const table = this.addChild("table");
		table.alignments = alignments;
		table.headerLine = headerLine;
		this.line.advanceToEndOfLine();
		return "leaf";
	}
	tryThematicBreakStart() {
		if (this.line.indented || !THEMATIC_BREAK_PATTERN.test(this.line.restFromNextNonspace())) return "none";
		this.closeUnmatchedBlocks();
		this.addChild("thematicBreak");
		this.line.advanceToEndOfLine();
		return "leaf";
	}
	tryListItemStart(container) {
		const data = parseListMarker(this.line, container.kind === "paragraph");
		if (data === void 0) return "none";
		this.closeUnmatchedBlocks();
		const openList = this.tip.listData;
		if (this.tip.kind !== "list" || openList === void 0 || !listsMatch(openList, data)) this.addChild("list").listData = data;
		this.addChild("listItem").listData = data;
		return "container";
	}
	tryIndentedCodeStart() {
		if (!this.line.indented || this.tip.kind === "paragraph" || this.line.blank) return "none";
		this.line.advance(4);
		this.closeUnmatchedBlocks();
		this.addChild("codeBlock");
		return "leaf";
	}
	addTextToContainer(container) {
		if (!this.allClosed && !this.line.blank && this.tip.kind === "paragraph") {
			this.addLine();
			return;
		}
		this.closeUnmatchedBlocks();
		const lastChild = container.lastChild;
		if (this.line.blank && lastChild !== void 0) lastChild.lastLineBlank = true;
		this.recordBlankLineForTightness(container);
		if (acceptsLines(container.kind)) {
			this.addLine();
			if (container.kind === "htmlBlock" && matchesHtmlBlockEnd(this.line.rest(), container.htmlBlockType)) this.finalize(container);
			return;
		}
		if (!this.line.atEnd && !this.line.blank) {
			this.addChild("paragraph");
			this.line.advanceToNextNonspace();
			this.addLine();
		}
	}
	recordBlankLineForTightness(container) {
		const blank = this.line.blank && !(container.kind === "blockquote" || container.kind === "codeBlock" && container.fenced || container.kind === "listItem" && container.children.length === 0 && container.startLine === this.lineNumber);
		for (let node = container; node !== void 0; node = node.parent) node.lastLineBlank = blank;
	}
	addLine() {
		this.tip.content += `${this.line.rest()}\n`;
	}
	addChild(kind) {
		while (!canContain(this.tip.kind, kind)) this.finalize(this.tip);
		if (this.nestingDepth >= this.maxNesting) throw new MarkdownNestingLimitExceededError(this.maxNesting);
		const node = new BlockNode(kind, this.lineNumber);
		this.tip.appendChild(node);
		this.tip = node;
		this.nestingDepth += 1;
		return node;
	}
	closeUnmatchedBlocks() {
		if (this.allClosed) return;
		while (this.oldTip !== this.lastMatchedContainer) {
			const parent = this.oldTip.parent;
			this.finalize(this.oldTip);
			if (parent === void 0) break;
			this.oldTip = parent;
		}
		this.allClosed = true;
	}
	finalize(node) {
		const above = node.parent;
		node.open = false;
		this.finalizeContent(node);
		if (node !== this.document) this.nestingDepth -= 1;
		this.tip = above ?? this.document;
	}
	finalizeContent(node) {
		switch (node.kind) {
			case "paragraph":
				node.content = extractDefinitions(node.content, this.references, this.sink, node.startLine);
				if (isBlankContent(node.content)) node.unlink();
				return;
			case "codeBlock":
				this.finalizeCodeBlock(node);
				return;
			case "mathBlock":
				this.finalizeMathBlock(node);
				return;
			case "htmlBlock":
				node.literal = node.content.replace(TRAILING_HTML_BLANK_LINES_PATTERN, "");
				return;
			case "list":
				finalizeListTightness(node);
				return;
			default: return;
		}
	}
	finalizeCodeBlock(node) {
		if (!node.fenced) {
			node.literal = node.content.replace(TRAILING_BLANK_LINES_PATTERN, "\n");
			return;
		}
		const breakIndex = node.content.indexOf("\n");
		node.infoString = unescapeString(node.content.slice(0, breakIndex).trim());
		node.literal = node.content.slice(breakIndex + 1);
	}
	finalizeMathBlock(node) {
		const breakIndex = node.content.indexOf("\n");
		node.literal = breakIndex === -1 ? "" : node.content.slice(breakIndex + 1);
	}
};
function toInlineChildren(content, context) {
	return parseInlines(content.trim(), context.references, context.footnotes, context.options);
}
function toHeadingNode(node, context) {
	return {
		type: "heading",
		level: node.level,
		style: node.setext ? "setext" : "atx",
		children: toInlineChildren(node.content, context)
	};
}
function extractTaskListMarker(itemChildren) {
	const first = itemChildren[0];
	if (first?.kind !== "paragraph") return;
	const match = TASK_LIST_MARKER_PATTERN.exec(first.content);
	if (match === null) return;
	first.content = first.content.slice(match[0].length);
	return match[1] !== " ";
}
function toListItemNode(item, context) {
	const checked = context.options.gfmTaskLists ?? true ? extractTaskListMarker(item.children) : void 0;
	return checked === void 0 ? {
		type: "listItem",
		children: toAstBlocks(item.children, context)
	} : {
		type: "listItem",
		checked,
		children: toAstBlocks(item.children, context)
	};
}
function toListNode(node, context) {
	const children = node.children.map((item) => toListItemNode(item, context));
	const data = node.listData;
	if (data?.type === "ordered") return {
		type: "list",
		markerType: "ordered",
		orderedDelimiter: data.delimiter,
		start: data.start,
		tight: node.tight,
		children
	};
	return {
		type: "list",
		markerType: "bullet",
		bulletMarker: data?.bulletChar,
		tight: node.tight,
		children
	};
}
function toTableRow(cells, header, context) {
	return {
		type: "tableRow",
		header,
		children: cells.map((cell) => ({
			type: "tableCell",
			children: toInlineChildren(cell, context)
		}))
	};
}
function toTableNode(node, context) {
	const sink = context.options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
	const columnCount = node.alignments.length;
	const rows = [toTableRow(fitRowToColumns(splitTableRow(node.headerLine), columnCount), true, context)];
	for (const rowLine of node.content.split("\n")) {
		if (rowLine.trim().length === 0) continue;
		const cells = splitTableRow(rowLine);
		if (cells.length !== columnCount) sink({
			code: MarkdownDiagnosticCodes.TABLE_CELL_COUNT_MISMATCH,
			severity: "warning",
			message: `table row has ${String(cells.length)} cell(s), but the header row declares ${String(columnCount)}; the row is padded with empty cells or truncated to fit`,
			line: node.startLine
		});
		rows.push(toTableRow(fitRowToColumns(cells, columnCount), false, context));
	}
	return {
		type: "table",
		alignments: node.alignments,
		children: rows
	};
}
function toAstBlock(node, context) {
	switch (node.kind) {
		case "paragraph": return {
			type: "paragraph",
			children: toInlineChildren(node.content, context)
		};
		case "heading": return toHeadingNode(node, context);
		case "blockquote": return {
			type: "blockquote",
			children: toAstBlocks(node.children, context)
		};
		case "list": return toListNode(node, context);
		case "footnoteDefinition": return {
			type: "footnoteDefinition",
			label: node.footnoteLabel,
			children: toAstBlocks(node.children, context)
		};
		case "codeBlock": return node.fenced ? {
			type: "codeBlock",
			fenced: true,
			fenceChar: node.fenceChar,
			infoString: node.infoString,
			literal: node.literal
		} : {
			type: "codeBlock",
			fenced: false,
			literal: node.literal
		};
		case "htmlBlock": return {
			type: "htmlBlock",
			literal: node.literal
		};
		case "thematicBreak": return { type: "thematicBreak" };
		case "mathBlock": return {
			type: "mathBlock",
			literal: node.literal
		};
		case "table": return toTableNode(node, context);
		case "document":
		case "listItem": return;
	}
}
function toAstBlocks(nodes, context) {
	const blocks = [];
	for (const node of nodes) {
		const converted = toAstBlock(node, context);
		if (converted !== void 0) blocks.push(converted);
	}
	return blocks;
}
function parseMarkdown(source, options = {}) {
	const parser = new BlockParser(options);
	const root = parser.parse(source);
	const context = {
		references: parser.references,
		footnotes: parser.footnotes,
		options
	};
	return {
		document: {
			type: "document",
			children: toAstBlocks(root.children, context)
		},
		references: context.references,
		footnotes: context.footnotes
	};
}
//#endregion
export { parseMarkdown };
