import { MarkdownBulletListMarker, MarkdownCodeFenceChar, MarkdownEmphasisMarker, MarkdownHeadingStyle, MarkdownLineEnding, MarkdownOrderedListDelimiter, MarkdownThematicBreakChar } from "../options/options.cjs";
import { Margins } from "document-schema.js";
//#region src/defaults/defaults.d.ts
declare const DEFAULT_MARGINS: Margins;
declare const DEFAULT_MAX_BLOCK_NESTING = 250;
declare const DEFAULT_RAW_HTML_MODE: 'preserve' | 'drop';
declare const DEFAULT_FRONT_MATTER = false;
declare const DEFAULT_HEADING_STYLE: MarkdownHeadingStyle;
declare const DEFAULT_BULLET_LIST_MARKER: MarkdownBulletListMarker;
declare const DEFAULT_ORDERED_LIST_DELIMITER: MarkdownOrderedListDelimiter;
declare const DEFAULT_EMPHASIS_MARKER: MarkdownEmphasisMarker;
declare const DEFAULT_CODE_FENCE_CHAR: MarkdownCodeFenceChar;
declare const DEFAULT_THEMATIC_BREAK_CHAR: MarkdownThematicBreakChar;
declare const DEFAULT_LINE_ENDING: MarkdownLineEnding;
//#endregion
export { DEFAULT_BULLET_LIST_MARKER, DEFAULT_CODE_FENCE_CHAR, DEFAULT_EMPHASIS_MARKER, DEFAULT_FRONT_MATTER, DEFAULT_HEADING_STYLE, DEFAULT_LINE_ENDING, DEFAULT_MARGINS, DEFAULT_MAX_BLOCK_NESTING, DEFAULT_ORDERED_LIST_DELIMITER, DEFAULT_RAW_HTML_MODE, DEFAULT_THEMATIC_BREAK_CHAR };