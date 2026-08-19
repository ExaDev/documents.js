Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/inline/chars.ts
const ASCII_PUNCTUATION = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".split(""));
function isAsciiPunctuation(char) {
	return ASCII_PUNCTUATION.has(char);
}
const UNICODE_WHITESPACE_PATTERN = /^[\p{Zs}\t\n\f\r]$/u;
function isUnicodeWhitespace(char) {
	return UNICODE_WHITESPACE_PATTERN.test(char);
}
const UNICODE_PUNCTUATION_PATTERN = /^[\p{P}\p{S}]$/u;
function isUnicodePunctuation(char) {
	return UNICODE_PUNCTUATION_PATTERN.test(char);
}
function isAsciiControl(char) {
	const code = char.codePointAt(0);
	if (code === void 0) return false;
	return code <= 31 || code === 127;
}
function containsAsciiControlOrSpace(text) {
	for (let index = 0; index < text.length; index += 1) if (isAsciiControl(text.charAt(index)) || text.charAt(index) === " ") return true;
	return false;
}
function isMarkdownSpace(char) {
	return char === " " || char === "	" || char === "\n" || char === "\r";
}
function codePointBefore(text, index) {
	if (index <= 0) return "\n";
	const low = text.charCodeAt(index - 1);
	if (index >= 2 && low >= 56320 && low <= 57343) {
		const high = text.charCodeAt(index - 2);
		if (high >= 55296 && high <= 56319) return text.slice(index - 2, index);
	}
	return text.slice(index - 1, index);
}
function codePointAt(text, index) {
	if (index >= text.length) return "\n";
	const code = text.codePointAt(index);
	if (code === void 0) return "\n";
	return String.fromCodePoint(code);
}
//#endregion
exports.codePointAt = codePointAt;
exports.codePointBefore = codePointBefore;
exports.containsAsciiControlOrSpace = containsAsciiControlOrSpace;
exports.isAsciiControl = isAsciiControl;
exports.isAsciiPunctuation = isAsciiPunctuation;
exports.isMarkdownSpace = isMarkdownSpace;
exports.isUnicodePunctuation = isUnicodePunctuation;
exports.isUnicodeWhitespace = isUnicodeWhitespace;
