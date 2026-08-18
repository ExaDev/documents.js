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
export { CODE_BLOCK_STYLE_ID, FOOTNOTE_REFERENCE_FONT_MARKER, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, MATH_BLOCK_STYLE_ID, MATH_INLINE_FONT_MARKER, MAX_HEADING_STYLE_LEVEL, MONOSPACE_FONT_FAMILY, QUOTE_INDENT_PT, QUOTE_STYLE_ID, TASK_CHECKBOX_CHECKED, TASK_CHECKBOX_UNCHECKED, headingStyleId, parseHeadingStyleId };
