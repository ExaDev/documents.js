Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_diagnostics_diagnostics = require("../diagnostics/diagnostics.cjs");
const require_html_html = require("../html/html.cjs");
require("../shared/style-constants.cjs");
//#region src/emit/inline.ts
const ESCAPE_CHARS = /* @__PURE__ */ new Set([
	"!",
	"\"",
	"#",
	"$",
	"%",
	"&",
	"'",
	"*",
	"+",
	",",
	"-",
	".",
	"/",
	":",
	";",
	"<",
	"=",
	">",
	"?",
	"@",
	"[",
	"\\",
	"]",
	"^",
	"_",
	"`",
	"{",
	"|",
	"}",
	"~"
]);
function escapeMarkdownText(text) {
	let out = "";
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "<") {
			const tag = require_html_html.matchHtmlTag(text, index);
			if (tag !== void 0) {
				out += tag;
				index += tag.length;
				continue;
			}
		}
		if (char === "\n") {
			out += "\\\n";
			index += 1;
			continue;
		}
		if (ESCAPE_CHARS.has(char)) {
			out += `\\${char}`;
			index += 1;
			continue;
		}
		out += char;
		index += 1;
	}
	return out;
}
function renderCodeSpan(text) {
	let longestBacktickRun = 0;
	let current = 0;
	for (const char of text) if (char === "`") {
		current += 1;
		longestBacktickRun = Math.max(longestBacktickRun, current);
	} else current = 0;
	const fence = "`".repeat(longestBacktickRun + 1);
	const isAllSpaces = text.length > 0 && text.trim().length === 0;
	const risksFenceCollision = text.startsWith("`") || text.endsWith("`");
	const wouldBeStrippedOnReparse = !isAllSpaces && text.startsWith(" ") && text.endsWith(" ");
	return risksFenceCollision || wouldBeStrippedOnReparse ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}
function renderLeaf(run, context) {
	if (run.fontFamily === "Courier New") {
		context.sink({
			code: require_diagnostics_diagnostics.MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN,
			severity: "info",
			message: "a run styled with the Courier New font family is rendered as a code span; a genuinely monospace run from another format is indistinguishable from a real markdown code span on the way back out"
		});
		return renderCodeSpan(run.text);
	}
	if (run.fontFamily === "Cambria Math") return `\\(${run.text}\\)`;
	return escapeMarkdownText(run.text);
}
const STYLE_KEYS = [
	"bold",
	"italic",
	"strike"
];
function styleActive(run, key) {
	return run[key] === true;
}
const WORD_CHAR_PATTERN = /[\p{L}\p{N}]/u;
function isIntrawordRisk(body) {
	if (body.length === 0) return false;
	return WORD_CHAR_PATTERN.test(body.charAt(0)) || WORD_CHAR_PATTERN.test(body.charAt(body.length - 1));
}
function hasMarkerConflict(body, candidate, precedingText) {
	if (candidate === "_" && isIntrawordRisk(body)) return true;
	if (body.length > 0 && (body.startsWith(candidate) || body.endsWith(candidate))) return true;
	return precedingText.endsWith(candidate);
}
function pickEmphasisMarker(body, configured, precedingText) {
	if (!hasMarkerConflict(body, configured, precedingText)) return configured;
	const alternate = configured === "_" ? "*" : "_";
	return hasMarkerConflict(body, alternate, precedingText) ? configured : alternate;
}
function wrapForStyle(body, key, context, precedingText) {
	if (key === "strike") return `~~${body}~~`;
	const marker = pickEmphasisMarker(body, context.emphasisMarker, precedingText);
	const delimiter = key === "bold" ? marker.repeat(2) : marker;
	return `${delimiter}${body}${delimiter}`;
}
function renderNestedStyles(runs, depth, context) {
	if (depth >= STYLE_KEYS.length) return runs.map((run) => renderLeaf(run, context)).join("");
	const key = STYLE_KEYS[depth];
	let out = "";
	let index = 0;
	while (index < runs.length) {
		const current = runs[index];
		if (current === void 0) break;
		const active = styleActive(current, key);
		let end = index + 1;
		while (end < runs.length && styleActive(runs[end], key) === active) end += 1;
		const inner = renderNestedStyles(runs.slice(index, end), depth + 1, context);
		out += active ? wrapForStyle(inner, key, context, out) : inner;
		index = end;
	}
	return out;
}
function isPlainAutolink(run) {
	if (run.hyperlink === void 0 || run.hyperlink.length === 0 || run.bold === true || run.italic === true || run.strike === true || run.fontFamily === "Courier New" || run.fontFamily === "Cambria Math") return false;
	return run.text === run.hyperlink || run.hyperlink === `mailto:${run.text}`;
}
function escapeLinkDestination(destination) {
	if (!/[\s()]/.test(destination)) return destination;
	return `<${destination.replace(/[<>]/g, (char) => `\\${char}`)}>`;
}
function emitRuns(runs, context) {
	let out = "";
	let index = 0;
	while (index < runs.length) {
		const run = runs[index];
		if (run === void 0) break;
		if (run.hyperlink === void 0) {
			let end = index + 1;
			while (end < runs.length && runs[end]?.hyperlink === void 0) end += 1;
			out += renderNestedStyles(runs.slice(index, end), 0, context);
			index = end;
			continue;
		}
		const hyperlink = run.hyperlink;
		let groupEnd = index + 1;
		while (groupEnd < runs.length && runs[groupEnd]?.hyperlink === hyperlink) groupEnd += 1;
		const group = runs.slice(index, groupEnd);
		if (group.length > 1) context.sink({
			code: require_diagnostics_diagnostics.MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED,
			severity: "info",
			message: `${String(group.length)} adjacent runs share the hyperlink "${hyperlink}"; markdown has no way to place two link boundaries back to back, so they render as one link spanning their combined text`
		});
		if (group.length === 1 && isPlainAutolink(group[0])) out += `<${group[0].text}>`;
		else {
			const linkText = renderNestedStyles(group, 0, context);
			out += `[${linkText}](${escapeLinkDestination(hyperlink)})`;
		}
		index = groupEnd;
	}
	return out;
}
function emitRunsSingleLine(runs, context) {
	return emitRuns(runs, context).replace(/\\\n/g, " ");
}
//#endregion
exports.emitRuns = emitRuns;
exports.emitRunsSingleLine = emitRunsSingleLine;
exports.escapeMarkdownText = escapeMarkdownText;
