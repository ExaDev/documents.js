import "../defaults/defaults.js";
import { MarkdownDiagnosticCodes, MarkdownUnsupportedDocumentKindError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from "../diagnostics/diagnostics.js";
import { parseListNumId } from "../shared/list-id.js";
import { CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, MATH_BLOCK_STYLE_ID, QUOTE_STYLE_ID, parseHeadingStyleId } from "../shared/style-constants.js";
import { emitFrontMatter } from "./front-matter.js";
import { emitRuns } from "./inline.js";
import { emitImage } from "./image.js";
import { emitTable } from "./table.js";
//#region src/emit/emit.ts
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
		return literal.length === 0 ? `${fence}\n${fence}` : `${fence}\n${literal}\n${fence}`;
	}
	if (paragraph.styleId === "HTMLPreformatted") return paragraph.runs.map((run) => run.text).join("");
	if (paragraph.styleId === "MathBlock") return `$$\n${paragraph.runs.map((run) => run.text).join("")}\n$$`;
	const headingLevel = paragraph.styleId === void 0 ? void 0 : parseHeadingStyleId(paragraph.styleId);
	if (headingLevel !== void 0) {
		let level = headingLevel;
		if (level > 6) {
			context.sink({
				code: MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED,
				severity: "info",
				message: `heading level ${String(level)} exceeds ATX's own six-"#" ceiling and is clamped to ${String(6)}`
			});
			level = 6;
		}
		const text = emitRuns(paragraph.runs, context);
		if (context.headingStyle === "setext" && level <= MAX_SETEXT_LEVEL) return renderSetextHeading(level, text);
		return `${"#".repeat(level)} ${text}`;
	}
	return emitRuns(paragraph.runs, context);
}
function renderParagraph(paragraph, context) {
	const body = renderParagraphBody(paragraph, context);
	const depth = quoteDepthOf(paragraph);
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
		case "pageBreak":
		case "embeddedObject": return "";
	}
}
function listInfoFor(numId, context) {
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
function checkboxPrefixFor(item) {
	const first = item.runs[0];
	if (first === void 0) return;
	if (first.text.startsWith(`☒ `)) return "[x] ";
	if (first.text.startsWith(`☐ `)) return "[ ] ";
}
function stripCheckboxRun(item, checkboxPrefix) {
	if (checkboxPrefix === void 0) return item;
	const first = item.runs[0];
	const glyphPrefix = checkboxPrefix === "[x] " ? `☒ ` : `☐ `;
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
function renderListItemMarker(numId, info, item, context) {
	const checkboxText = (info?.task === true ? checkboxPrefixFor(item) : void 0) ?? "";
	if (info?.type === "ordered") {
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
		const { numId, level } = item.list;
		const info = listInfoFor(numId, context);
		let lookahead = index + 1;
		while (lookahead < items.length && (items[lookahead]?.list?.level ?? -1) > level) lookahead += 1;
		const nestedItems = items.slice(index + 1, lookahead);
		const checkboxPrefix = info?.task === true ? checkboxPrefixFor(item) : void 0;
		const marker = renderListItemMarker(numId, info, item, context);
		const bodyLines = renderParagraphBody(stripCheckboxRun(item, checkboxPrefix), context).split("\n");
		const indent = " ".repeat(marker.bareLength);
		const [firstLine = "", ...restLines] = bodyLines;
		let text = [`${marker.full}${firstLine}`, ...restLines.map((line) => `${indent}${line}`)].join("\n");
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
			const loose = sameList && (parseListNumId(previous.numId)?.loose ?? false);
			out += sameList && !loose ? "\n" : "\n\n";
		}
		out += part.text;
	}
	return out;
}
function emitBlocks(blocks, context) {
	const parts = [];
	let index = 0;
	while (index < blocks.length) {
		const block = blocks[index];
		if (block === void 0) break;
		if (block.kind === "paragraph" && block.list !== void 0) {
			const region = [];
			let end = index;
			for (let candidate = blocks[end]; candidate?.kind === "paragraph" && candidate.list !== void 0; candidate = blocks[end]) {
				region.push(candidate);
				end += 1;
			}
			parts.push(renderListRegion(region, context));
			index = end;
			continue;
		}
		const rendered = renderTopLevelBlock(block, context);
		if (rendered.length > 0) parts.push(rendered);
		index += 1;
	}
	return parts.join("\n\n");
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
		reportedFallbackNumIds: /* @__PURE__ */ new Set()
	};
	const body = document.sections.map((section) => emitBlocks(section.blocks, context)).join("\n\n");
	const frontMatter = options.frontMatter === true ? emitFrontMatter(document.metadata) : void 0;
	const text = frontMatter === void 0 ? body : `${frontMatter}\n\n${body}`;
	return (options.lineEnding ?? "lf") === "crlf" ? text.replaceAll("\n", "\r\n") : text;
}
//#endregion
export { emitMarkdown };
