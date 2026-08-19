Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_diagnostics_diagnostics = require("../diagnostics/diagnostics.cjs");
//#region src/lower/front-matter.ts
const LEADING_DELIMITER_PATTERN = /^---[ \t]*$/;
const CLOSING_DELIMITER_PATTERN = /^(?:---|\.\.\.)[ \t]*$/;
const KEY_VALUE_LINE_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const LINE_ENDING_PATTERN = /\r\n|\n|\r/;
function parseScalar(raw) {
	const trimmed = raw.trim();
	const isDoubleQuoted = trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"");
	const isSingleQuoted = trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'");
	return isDoubleQuoted || isSingleQuoted ? trimmed.slice(1, -1) : trimmed;
}
function parseKeywordList(raw) {
	const trimmed = raw.trim();
	return (trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed).split(",").map((item) => parseScalar(item)).filter((item) => item.length > 0);
}
function extractFrontMatter(source, sink = require_diagnostics_diagnostics.NOOP_MARKDOWN_DIAGNOSTIC_SINK) {
	const lines = source.split(LINE_ENDING_PATTERN);
	const firstLine = lines[0];
	if (firstLine === void 0 || !LEADING_DELIMITER_PATTERN.test(firstLine)) return {
		metadata: {},
		rest: source
	};
	let closingIndex = -1;
	for (let index = 1; index < lines.length; index += 1) if (CLOSING_DELIMITER_PATTERN.test(lines[index] ?? "")) {
		closingIndex = index;
		break;
	}
	if (closingIndex === -1) return {
		metadata: {},
		rest: source
	};
	const metadata = {};
	for (let index = 1; index < closingIndex; index += 1) {
		const line = lines[index] ?? "";
		if (line.trim().length === 0) continue;
		const match = KEY_VALUE_LINE_PATTERN.exec(line);
		const key = match?.[1];
		const value = match?.[2];
		if (key === void 0 || value === void 0) continue;
		switch (key) {
			case "title":
				metadata.title = parseScalar(value);
				break;
			case "author":
				metadata.author = parseScalar(value);
				break;
			case "subject":
				metadata.subject = parseScalar(value);
				break;
			case "creator":
				metadata.creator = parseScalar(value);
				break;
			case "date":
				metadata.createdIso = parseScalar(value);
				break;
			case "keywords":
				metadata.keywords = [...parseKeywordList(value)];
				break;
			default: sink({
				code: require_diagnostics_diagnostics.MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED,
				severity: "info",
				message: `front matter key "${key}" has no LayoutMetadata equivalent and was dropped`,
				line: index + 1
			});
		}
	}
	return {
		metadata,
		rest: lines.slice(closingIndex + 1).join("\n")
	};
}
//#endregion
exports.extractFrontMatter = extractFrontMatter;
