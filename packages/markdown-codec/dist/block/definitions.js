import { MarkdownDiagnosticCodes, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from "../diagnostics/diagnostics.js";
import { isBlankRemainderOfLine, matchLinkLabel, normalizeLinkLabel, parseLinkDestination, parseLinkTitle, skipInlineWhitespace } from "../inline/link.js";
//#region src/block/definitions.ts
const MIN_DEFINITION_LABEL_LENGTH = 3;
function parseDefinition(content, start) {
	const labelLength = matchLinkLabel(content, start);
	if (labelLength < MIN_DEFINITION_LABEL_LENGTH) return;
	const label = normalizeLinkLabel(content.slice(start, start + labelLength));
	if (label.length === 0) return;
	let cursor = start + labelLength;
	if (content.charAt(cursor) !== ":") return;
	cursor = skipInlineWhitespace(content, cursor + 1);
	const destination = parseLinkDestination(content, cursor);
	if (destination === void 0) return;
	const afterDestination = destination.end;
	let title;
	cursor = afterDestination;
	const beforeTitle = skipInlineWhitespace(content, afterDestination);
	if (beforeTitle > afterDestination) {
		const parsedTitle = parseLinkTitle(content, beforeTitle);
		if (parsedTitle !== void 0 && isBlankRemainderOfLine(content, parsedTitle.end)) {
			title = parsedTitle.value;
			cursor = parsedTitle.end;
		}
	}
	if (!isBlankRemainderOfLine(content, cursor)) return;
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
function extractDefinitions(content, references, sink = NOOP_MARKDOWN_DIAGNOSTIC_SINK, startLine = 0) {
	let cursor = 0;
	for (;;) {
		const parsed = parseDefinition(content, cursor);
		if (parsed === void 0) return content.slice(cursor);
		if (references.has(parsed.label)) sink({
			code: MarkdownDiagnosticCodes.DUPLICATE_LINK_REFERENCE,
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
export { extractDefinitions };
