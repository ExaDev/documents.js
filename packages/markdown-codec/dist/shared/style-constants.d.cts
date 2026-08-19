//#region src/shared/style-constants.d.ts
declare function headingStyleId(level: number): string;
declare const MAX_HEADING_STYLE_LEVEL = 6;
declare function parseHeadingStyleId(styleId: string): number | undefined;
declare const QUOTE_STYLE_ID = "Quote";
declare const CODE_BLOCK_STYLE_ID = "CodeBlock";
declare const HORIZONTAL_RULE_STYLE_ID = "HorizontalRule";
declare const HTML_PREFORMATTED_STYLE_ID = "HTMLPreformatted";
declare const MATH_BLOCK_STYLE_ID = "MathBlock";
declare const MONOSPACE_FONT_FAMILY = "Courier New";
declare const MATH_INLINE_FONT_MARKER = "Cambria Math";
declare const FOOTNOTE_REFERENCE_FONT_MARKER = "Footnote Reference";
declare const QUOTE_INDENT_PT = 36;
declare const TASK_CHECKBOX_UNCHECKED = "☐";
declare const TASK_CHECKBOX_CHECKED = "☒";
//#endregion
export { CODE_BLOCK_STYLE_ID, FOOTNOTE_REFERENCE_FONT_MARKER, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, MATH_BLOCK_STYLE_ID, MATH_INLINE_FONT_MARKER, MAX_HEADING_STYLE_LEVEL, MONOSPACE_FONT_FAMILY, QUOTE_INDENT_PT, QUOTE_STYLE_ID, TASK_CHECKBOX_CHECKED, TASK_CHECKBOX_UNCHECKED, headingStyleId, parseHeadingStyleId };