import { isValidFootnoteLabel } from "../inline/footnote.js";
import "../defaults/defaults.js";
import { MarkdownDiagnosticCodes, MarkdownInvalidRunConstructExtentError, MarkdownUnbalancedConstructMarkersError, MarkdownUnsupportedDocumentKindError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from "../diagnostics/diagnostics.js";
import { parseListNumId } from "../shared/list-id.js";
import { CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, MATH_BLOCK_STYLE_ID, QUOTE_STYLE_ID, parseHeadingStyleId } from "../shared/style-constants.js";
import { emitFrontMatter } from "./front-matter.js";
import { emitRuns, escapeLinkDestination, escapeMarkdownText, renderLinkTitle } from "./inline.js";
import { emitImage } from "./image.js";
import { emitTable } from "./table.js";
import { clampHeadingLevel, findConstructMarkerImbalance, findRunConstructFault } from "document-schema.js";
//#region src/emit/emit.ts
function isDataUri(destination) {
	return destination.startsWith("data:");
}
const MAX_SETEXT_LEVEL = 2;
const SETEXT_LEVEL_1_CHAR = "=";
const SETEXT_LEVEL_2_CHAR = "-";
const MIN_SETEXT_UNDERLINE_LENGTH = 1;
function renderSetextHeading(level, text) {
	const underlineChar = level === 1 ? SETEXT_LEVEL_1_CHAR : SETEXT_LEVEL_2_CHAR;
	const firstLine = text.split("\n")[0] ?? "";
	return `${text}\n${underlineChar.repeat(Math.max(MIN_SETEXT_UNDERLINE_LENGTH, firstLine.length))}`;
}
const MIN_CODE_FENCE_LENGTH = 3;
function longestRunLength(text, char) {
	let longest = 0;
	let current = 0;
	for (const candidate of text) if (candidate === char) {
		current += 1;
		longest = Math.max(longest, current);
	} else current = 0;
	return longest;
}
function codeFenceFor(literal, fenceChar) {
	return fenceChar.repeat(Math.max(MIN_CODE_FENCE_LENGTH, longestRunLength(literal, fenceChar) + 1));
}
const QUOTABLE_STYLE_IDS = /* @__PURE__ */ new Set([
	QUOTE_STYLE_ID,
	CODE_BLOCK_STYLE_ID,
	HORIZONTAL_RULE_STYLE_ID,
	HTML_PREFORMATTED_STYLE_ID,
	MATH_BLOCK_STYLE_ID
]);
function isQuotableStyle(styleId) {
	if (styleId === void 0) return false;
	return QUOTABLE_STYLE_IDS.has(styleId) || parseHeadingStyleId(styleId) !== void 0;
}
function quoteDepthOf(paragraph) {
	if (paragraph.indentLeftPt === void 0 || paragraph.indentLeftPt <= 0) return 0;
	return Math.max(1, Math.round(paragraph.indentLeftPt / 36));
}
function renderParagraphBody(paragraph, context) {
	if (paragraph.styleId === "HorizontalRule") return context.thematicBreakChar.repeat(3);
	if (paragraph.styleId === "CodeBlock") {
		const literal = paragraph.runs.map((run) => run.text).join("");
		const fence = codeFenceFor(literal, context.codeFenceChar);
		const remainder = paragraph.source?.format === "markdown" ? paragraph.source.xml : void 0;
		const info = [paragraph.codeLanguage, remainder].filter((part) => part !== void 0 && part.length > 0).join(" ");
		const opening = info.length > 0 ? `${fence} ${info}` : fence;
		return literal.length === 0 ? `${opening}\n${fence}` : `${opening}\n${literal}\n${fence}`;
	}
	if (paragraph.styleId === "HTMLPreformatted") return paragraph.runs.map((run) => run.text).join("");
	if (paragraph.styleId === "MathBlock") return `$$\n${paragraph.runs.map((run) => run.text).join("")}\n$$`;
	const headingLevel = paragraph.styleId === void 0 ? void 0 : parseHeadingStyleId(paragraph.styleId);
	if (headingLevel !== void 0) {
		const level = clampHeadingLevel(headingLevel);
		if (level !== headingLevel) context.sink({
			code: MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED,
			severity: "info",
			message: `heading level ${String(headingLevel)} exceeds ATX's own six-"#" ceiling and is clamped to ${String(level)}`
		});
		const text = emitRuns(paragraph.runs, context, paragraph.constructs);
		if (context.headingStyle === "setext" && level <= MAX_SETEXT_LEVEL) return renderSetextHeading(level, text);
		return `${"#".repeat(level)} ${text}`;
	}
	return emitRuns(paragraph.runs, context, paragraph.constructs);
}
function renderParagraph(paragraph, context) {
	const body = renderParagraphBody(paragraph, context);
	const depth = context.divisionDepth > 0 ? 0 : quoteDepthOf(paragraph);
	if (depth === 0) return body;
	if (!isQuotableStyle(paragraph.styleId)) {
		context.sink({
			code: MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED,
			severity: "info",
			message: `paragraph carries indentLeftPt (${String(paragraph.indentLeftPt)}pt) with no styleId this package recognises as quotable; the indent has no other markdown representation and is dropped`
		});
		return body;
	}
	const prefix = "> ".repeat(depth);
	return body.split("\n").map((line) => `${prefix}${line}`).join("\n");
}
function renderTopLevelBlock(block, context) {
	switch (block.kind) {
		case "paragraph": return renderParagraph(block, context);
		case "table": return emitTable(block, context);
		case "image": return emitImage(block, context.embedImages);
		case "embeddedObject":
			if (block.objectKind === "formula" && block.document.kind === "formula" && block.document.formula.presentation !== void 0) {
				const latex = block.document.formula.presentation.latex;
				return latex.length === 0 ? "$$\n$$" : `$$\n${latex}\n$$`;
			}
			return "";
		case "pageBreak": return "";
	}
}
function listInfoFor(numId, context) {
	if (numId === void 0) {
		if (!context.reportedAbsentNumIdFallback) {
			context.reportedAbsentNumIdFallback = true;
			context.sink({
				code: MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
				severity: "info",
				message: "a list membership with no numId of its own (a depth-only ContentListMembership) has no marker type, task-ness, or loose-ness to recover and falls back to an ordinary, tight, non-task bullet list"
			});
		}
		return;
	}
	const info = parseListNumId(numId);
	if (info === void 0 && !context.reportedFallbackNumIds.has(numId)) {
		context.reportedFallbackNumIds.add(numId);
		context.sink({
			code: MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK,
			severity: "info",
			message: `numId "${numId}" was not minted by this package's own src/lower and falls back to an ordinary, tight, non-task bullet list`
		});
	}
	return info;
}
function stripCheckboxRun(item) {
	const first = item.runs[0];
	const glyphPrefix = first?.text.startsWith(`☒ `) ? `☒ ` : `☐ `;
	if (!first?.text.startsWith(glyphPrefix)) return item;
	const strippedText = first.text.slice(glyphPrefix.length);
	const runs = strippedText.length === 0 ? item.runs.slice(1) : [{
		...first,
		text: strippedText
	}, ...item.runs.slice(1)];
	return {
		...item,
		runs
	};
}
function firstBlockCheckbox(first, taskNumId) {
	if (first.list?.checked !== void 0) return {
		checkboxText: first.list.checked ? "[x] " : "[ ] ",
		stripGlyph: false
	};
	if (!taskNumId) return {
		checkboxText: "",
		stripGlyph: false
	};
	const leading = first.runs[0]?.text ?? "";
	if (leading.startsWith(`☒ `)) return {
		checkboxText: "[x] ",
		stripGlyph: true
	};
	if (leading.startsWith(`☐ `)) return {
		checkboxText: "[ ] ",
		stripGlyph: true
	};
	return {
		checkboxText: "",
		stripGlyph: false
	};
}
function renderListItemMarker(numId, info, checkboxText, context) {
	if (info?.type === "ordered" && numId !== void 0) {
		const next = context.orderedCounters.get(numId) ?? info.start ?? 1;
		context.orderedCounters.set(numId, next + 1);
		const bare = `${String(next)}${context.orderedDelimiter} `;
		return {
			full: `${bare}${checkboxText}`,
			bareLength: bare.length
		};
	}
	const bare = `${context.bulletMarker} `;
	return {
		full: `${bare}${checkboxText}`,
		bareLength: bare.length
	};
}
function renderListRegion(items, context) {
	const parts = [];
	let index = 0;
	while (index < items.length) {
		const item = items[index];
		if (item?.list === void 0) break;
		const { numId, level, itemId } = item.list;
		const info = listInfoFor(numId, context);
		let ownEnd = index + 1;
		if (itemId !== void 0) while (ownEnd < items.length) {
			const candidate = items[ownEnd];
			if (candidate?.list?.level !== level || candidate.list?.itemId !== itemId) break;
			ownEnd += 1;
		}
		const ownBlocks = items.slice(index, ownEnd);
		let lookahead = ownEnd;
		while (lookahead < items.length && (items[lookahead]?.list?.level ?? -1) > level) lookahead += 1;
		const nestedItems = items.slice(ownEnd, lookahead);
		const first = ownBlocks[0];
		if (first === void 0) break;
		const { checkboxText, stripGlyph } = firstBlockCheckbox(first, info?.task === true);
		const marker = renderListItemMarker(numId, info, checkboxText, context);
		const indent = " ".repeat(marker.bareLength);
		const [firstLine = "", ...restLines] = renderParagraphBody(stripGlyph ? stripCheckboxRun(first) : first, context).split("\n");
		let text = [`${marker.full}${firstLine}`, ...restLines.map((line) => `${indent}${line}`)].join("\n");
		for (const extra of ownBlocks.slice(1)) {
			const rendered = renderParagraphBody(extra, context).split("\n").map((line) => line.length === 0 ? line : `${indent}${line}`).join("\n");
			text += `\n\n${rendered}`;
		}
		if (nestedItems.length > 0) {
			const nested = renderListRegion(nestedItems, context).split("\n").map((line) => line.length === 0 ? line : `${indent}${line}`).join("\n");
			text += `\n${nested}`;
		}
		parts.push({
			numId,
			text
		});
		index = lookahead;
	}
	let out = "";
	for (const [partIndex, part] of parts.entries()) {
		if (partIndex > 0) {
			const previous = parts[partIndex - 1];
			const sameList = previous.numId === part.numId;
			const loose = sameList && previous.numId !== void 0 && (parseListNumId(previous.numId)?.loose ?? false);
			out += sameList && !loose ? "\n" : "\n\n";
		}
		out += part.text;
	}
	return out;
}
function isConstructItem(item) {
	return "descriptor" in item;
}
function groupConstructItems(blocks, start) {
	const items = [];
	let index = start;
	while (index < blocks.length) {
		const block = blocks[index];
		if (block === void 0) break;
		index += 1;
		if (block.kind === "constructEnd") return {
			items,
			next: index
		};
		if (block.kind === "constructStart") {
			const nested = groupConstructItems(blocks, index);
			items.push({
				descriptor: block.descriptor,
				children: nested.items
			});
			index = nested.next;
			continue;
		}
		items.push({ block });
	}
	return {
		items,
		next: index
	};
}
const FOOTNOTE_CONTINUATION_INDENT = 4;
function renderFootnoteDefinition(name, body) {
	const marker = `[^${name}]:`;
	if (body.length === 0) return marker;
	const indent = " ".repeat(FOOTNOTE_CONTINUATION_INDENT);
	const [firstLine = "", ...restLines] = body.split("\n");
	return [`${marker} ${firstLine}`, ...restLines.map((line) => line.length === 0 ? line : `${indent}${line}`)].join("\n");
}
function renderConstruct(item, context) {
	const { descriptor } = item;
	if (descriptor.kind === "anchor" && descriptor.anchorType === "footnote") {
		const body = renderItems(item.children, context);
		if (isValidFootnoteLabel(descriptor.name)) return renderFootnoteDefinition(descriptor.name, body);
		context.sink({
			code: MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
			severity: "info",
			message: `a footnote anchor's own name "${descriptor.name}" cannot be spelled as a "[^label]:" marker (whitespace or "]" would reparse as something else); its own extent still renders in place, but the construct itself is not represented`
		});
		return body;
	}
	if (descriptor.kind === "division") {
		if (item.children.every((child) => {
			if (isConstructItem(child)) return true;
			return child.block.kind !== "paragraph" || child.block.indentLeftPt !== void 0 && child.block.indentLeftPt >= 36;
		})) {
			context.divisionDepth += 1;
			const body = renderItems(item.children, context);
			context.divisionDepth -= 1;
			return body.split("\n").map((line) => line.length === 0 ? ">" : `> ${line}`).join("\n");
		}
	}
	if (descriptor.kind === "link" && descriptor.target.kind === "external") {
		const onlyChild = item.children.length === 1 && !isConstructItem(item.children[0]) ? item.children[0].block : void 0;
		if (onlyChild?.kind === "image" && !isDataUri(descriptor.target.uri)) return `![${escapeMarkdownText(onlyChild.altText ?? "")}](${escapeLinkDestination(descriptor.target.uri)}${descriptor.title === void 0 ? "" : ` "${renderLinkTitle(descriptor.title)}"`})`;
		if (onlyChild?.kind === "image" && isDataUri(descriptor.target.uri) && !context.embedImages) return emitImage(onlyChild, false);
	}
	const body = renderItems(item.children, context);
	const detail = descriptor.kind === "anchor" ? `${descriptor.kind} (${descriptor.anchorType})` : descriptor.kind;
	context.sink({
		code: MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
		severity: "info",
		message: `a "${detail}" construct has no markdown syntax; its own extent still renders in place, but the construct itself is not represented`
	});
	return body;
}
function renderItems(items, context) {
	const parts = [];
	let index = 0;
	while (index < items.length) {
		const item = items[index];
		if (item === void 0) break;
		if (isConstructItem(item)) {
			const rendered = renderConstruct(item, context);
			if (rendered.length > 0) parts.push(rendered);
			index += 1;
			continue;
		}
		if (item.block.kind === "paragraph" && item.block.list !== void 0) {
			const region = [];
			let end = index;
			for (let candidate = items[end]; candidate !== void 0 && !isConstructItem(candidate) && candidate.block.kind === "paragraph" && candidate.block.list !== void 0; candidate = items[end]) {
				region.push(candidate.block);
				end += 1;
			}
			parts.push(renderListRegion(region, context));
			index = end;
			continue;
		}
		const rendered = renderTopLevelBlock(item.block, context);
		if (rendered.length > 0) parts.push(rendered);
		index += 1;
	}
	return parts.join("\n\n");
}
function emitBlocks(blocks, context) {
	const imbalance = findConstructMarkerImbalance(blocks);
	if (imbalance !== void 0) throw new MarkdownUnbalancedConstructMarkersError(imbalance.kind, imbalance.index);
	validateRunConstructExtents(blocks);
	return renderItems(groupConstructItems(blocks, 0).items, context);
}
function validateRunConstructExtents(blocks) {
	for (const block of blocks) {
		if (block.kind === "paragraph" && block.constructs !== void 0) {
			const fault = findRunConstructFault(block);
			if (fault !== void 0) throw new MarkdownInvalidRunConstructExtentError(fault.kind, fault.index);
		}
		if (block.kind === "table") for (const row of block.rows) for (const cell of row.cells) validateRunConstructExtents(cell.blocks);
	}
}
function emitMarkdown(document, options = {}) {
	if (document.kind !== "wordprocessing") throw new MarkdownUnsupportedDocumentKindError(document.kind);
	const context = {
		sink: options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK,
		emphasisMarker: options.emphasisMarker ?? "_",
		bulletMarker: options.bulletListMarker ?? "-",
		orderedDelimiter: options.orderedListDelimiter ?? ".",
		codeFenceChar: options.codeFenceChar ?? "`",
		thematicBreakChar: options.thematicBreakChar ?? "-",
		headingStyle: options.headingStyle ?? "atx",
		embedImages: options.images ?? true,
		orderedCounters: /* @__PURE__ */ new Map(),
		reportedFallbackNumIds: /* @__PURE__ */ new Set(),
		reportedAbsentNumIdFallback: false,
		divisionDepth: 0
	};
	const body = document.sections.map((section) => emitBlocks(section.blocks, context)).join("\n\n");
	const frontMatter = options.frontMatter === true ? emitFrontMatter(document.metadata) : void 0;
	const text = frontMatter === void 0 ? body : `${frontMatter}\n\n${body}`;
	return (options.lineEnding ?? "lf") === "crlf" ? text.replaceAll("\n", "\r\n") : text;
}
//#endregion
export { emitMarkdown };
