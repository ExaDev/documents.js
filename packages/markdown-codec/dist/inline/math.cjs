Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/inline/math.ts
function matchMathInlineSpan(text, index) {
	if (text.charAt(index) !== "\\" || text.charAt(index + 1) !== "(") return;
	const closeIndex = text.indexOf("\\)", index + 2);
	if (closeIndex === -1) return;
	return text.slice(index, closeIndex + 2);
}
//#endregion
exports.matchMathInlineSpan = matchMathInlineSpan;
