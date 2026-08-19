Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/inline/footnote.ts
const FOOTNOTE_LABEL_PATTERN = /\[\^([^\s[\]]+)\]/y;
const FOOTNOTE_LABEL_ONLY_PATTERN = /^[^\s[\]]+$/;
function matchFootnoteLabel(text, start) {
	FOOTNOTE_LABEL_PATTERN.lastIndex = start;
	const match = FOOTNOTE_LABEL_PATTERN.exec(text);
	if (match === null) return;
	const label = match[1];
	if (label === void 0) return;
	return {
		label,
		end: start + match[0].length
	};
}
function matchFootnoteDefinitionMarker(lineText) {
	const match = matchFootnoteLabel(lineText, 0);
	if (match === void 0 || lineText.charAt(match.end) !== ":") return;
	return {
		label: match.label,
		markerLength: match.end + 1
	};
}
function isValidFootnoteLabel(label) {
	return FOOTNOTE_LABEL_ONLY_PATTERN.test(label);
}
//#endregion
exports.isValidFootnoteLabel = isValidFootnoteLabel;
exports.matchFootnoteDefinitionMarker = matchFootnoteDefinitionMarker;
exports.matchFootnoteLabel = matchFootnoteLabel;
