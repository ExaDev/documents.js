Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_diagnostics_diagnostics = require("../diagnostics/diagnostics.cjs");
const require_inline_link = require("../inline/link.cjs");
//#region src/block/definitions.ts
const MIN_DEFINITION_LABEL_LENGTH = 3;
function parseDefinition(content, start) {
	const labelLength = require_inline_link.matchLinkLabel(content, start);
	if (labelLength < MIN_DEFINITION_LABEL_LENGTH) return;
	const label = require_inline_link.normalizeLinkLabel(content.slice(start, start + labelLength));
	if (label.length === 0) return;
	let cursor = start + labelLength;
	if (content.charAt(cursor) !== ":") return;
	cursor = require_inline_link.skipInlineWhitespace(content, cursor + 1);
	const destination = require_inline_link.parseLinkDestination(content, cursor);
	if (destination === void 0) return;
	const afterDestination = destination.end;
	let title;
	cursor = afterDestination;
	const beforeTitle = require_inline_link.skipInlineWhitespace(content, afterDestination);
	if (beforeTitle > afterDestination) {
		const parsedTitle = require_inline_link.parseLinkTitle(content, beforeTitle);
		if (parsedTitle !== void 0 && require_inline_link.isBlankRemainderOfLine(content, parsedTitle.end)) {
			title = parsedTitle.value;
			cursor = parsedTitle.end;
		}
	}
	if (!require_inline_link.isBlankRemainderOfLine(content, cursor)) return;
	const lineEnd = content.indexOf("\n", cursor);
	return {
		label,
		definition: title === void 0 ? { destination: destination.value } : {
			destination: destination.value,
			title
		},
		end: lineEnd === -1 ? content.length : lineEnd + 1
	};
}
function extractDefinitions(content, references, sink = require_diagnostics_diagnostics.NOOP_MARKDOWN_DIAGNOSTIC_SINK, startLine = 0) {
	let cursor = 0;
	for (;;) {
		const parsed = parseDefinition(content, cursor);
		if (parsed === void 0) return content.slice(cursor);
		if (references.has(parsed.label)) sink({
			code: require_diagnostics_diagnostics.MarkdownDiagnosticCodes.DUPLICATE_LINK_REFERENCE,
			severity: "warning",
			message: `link reference definition "${parsed.label}" was already defined earlier in the document; this later definition is ignored`,
			line: startLine + countNewlines(content, cursor)
		});
		else references.set(parsed.label, parsed.definition);
		cursor = parsed.end;
	}
}
function countNewlines(content, upTo) {
	let count = 0;
	for (let index = 0; index < upTo && index < content.length; index += 1) if (content.charAt(index) === "\n") count += 1;
	return count;
}
//#endregion
exports.extractDefinitions = extractDefinitions;
