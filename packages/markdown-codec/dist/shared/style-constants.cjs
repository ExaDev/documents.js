Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/shared/style-constants.ts
const HEADING_STYLE_PREFIX = "Heading";
function headingStyleId(level) {
	return `${HEADING_STYLE_PREFIX}${String(level)}`;
}
const MAX_HEADING_STYLE_LEVEL = 6;
const HEADING_STYLE_ID_PATTERN = /^Heading([0-9]+)$/;
function parseHeadingStyleId(styleId) {
	const levelText = HEADING_STYLE_ID_PATTERN.exec(styleId)?.[1];
	if (levelText === void 0) return;
	const level = Number.parseInt(levelText, 10);
	return Number.isInteger(level) && level > 0 ? level : void 0;
}
const QUOTE_STYLE_ID = "Quote";
const CODE_BLOCK_STYLE_ID = "CodeBlock";
const HORIZONTAL_RULE_STYLE_ID = "HorizontalRule";
const HTML_PREFORMATTED_STYLE_ID = "HTMLPreformatted";
const MATH_BLOCK_STYLE_ID = "MathBlock";
const MONOSPACE_FONT_FAMILY = "Courier New";
const MATH_INLINE_FONT_MARKER = "Cambria Math";
const FOOTNOTE_REFERENCE_FONT_MARKER = "Footnote Reference";
const QUOTE_INDENT_PT = 36;
const TASK_CHECKBOX_UNCHECKED = "☐";
const TASK_CHECKBOX_CHECKED = "☒";
//#endregion
exports.CODE_BLOCK_STYLE_ID = CODE_BLOCK_STYLE_ID;
exports.FOOTNOTE_REFERENCE_FONT_MARKER = FOOTNOTE_REFERENCE_FONT_MARKER;
exports.HORIZONTAL_RULE_STYLE_ID = HORIZONTAL_RULE_STYLE_ID;
exports.HTML_PREFORMATTED_STYLE_ID = HTML_PREFORMATTED_STYLE_ID;
exports.MATH_BLOCK_STYLE_ID = MATH_BLOCK_STYLE_ID;
exports.MATH_INLINE_FONT_MARKER = MATH_INLINE_FONT_MARKER;
exports.MAX_HEADING_STYLE_LEVEL = MAX_HEADING_STYLE_LEVEL;
exports.MONOSPACE_FONT_FAMILY = MONOSPACE_FONT_FAMILY;
exports.QUOTE_INDENT_PT = QUOTE_INDENT_PT;
exports.QUOTE_STYLE_ID = QUOTE_STYLE_ID;
exports.TASK_CHECKBOX_CHECKED = TASK_CHECKBOX_CHECKED;
exports.TASK_CHECKBOX_UNCHECKED = TASK_CHECKBOX_UNCHECKED;
exports.headingStyleId = headingStyleId;
exports.parseHeadingStyleId = parseHeadingStyleId;
