import { i as MarkdownDiagnosticSink } from "../diagnostics-B72W0P_E.js";
import { n as MarkdownImageResolver } from "../image-Cm3hT5PS.js";
import { Margins, PageSize } from "document-schema.js";
//#region src/options/options.d.ts
interface ReadMarkdownOptions {
  readonly sink?: MarkdownDiagnosticSink;
  readonly signal?: AbortSignal;
  readonly pageSize?: PageSize;
  readonly margins?: Margins;
  readonly images?: MarkdownImageResolver;
  readonly rawHtml?: 'preserve' | 'drop';
  readonly frontMatter?: boolean;
  readonly gfmTables?: boolean;
  readonly gfmAutolinks?: boolean;
  readonly gfmStrikethrough?: boolean;
  readonly gfmTaskLists?: boolean;
  readonly maxInputBytes?: number;
  readonly maxBlockNesting?: number;
}
type MarkdownHeadingStyle = 'atx' | 'setext';
type MarkdownBulletListMarker = '-' | '*' | '+';
type MarkdownOrderedListDelimiter = '.' | ')';
type MarkdownEmphasisMarker = '_' | '*';
type MarkdownCodeFenceChar = '`' | '~';
type MarkdownThematicBreakChar = '-' | '_' | '*';
type MarkdownLineEnding = 'lf' | 'crlf';
interface WriteMarkdownStyleOptions {
  readonly headingStyle?: MarkdownHeadingStyle;
  readonly bulletListMarker?: MarkdownBulletListMarker;
  readonly orderedListDelimiter?: MarkdownOrderedListDelimiter;
  readonly emphasisMarker?: MarkdownEmphasisMarker;
  readonly codeFenceChar?: MarkdownCodeFenceChar;
  readonly thematicBreakChar?: MarkdownThematicBreakChar;
}
interface WriteMarkdownOptions extends WriteMarkdownStyleOptions {
  readonly sink?: MarkdownDiagnosticSink;
  readonly signal?: AbortSignal;
  readonly images?: boolean;
  readonly lineEnding?: MarkdownLineEnding;
  readonly frontMatter?: boolean;
}
//#endregion
export { MarkdownBulletListMarker, MarkdownCodeFenceChar, MarkdownEmphasisMarker, MarkdownHeadingStyle, MarkdownLineEnding, MarkdownOrderedListDelimiter, MarkdownThematicBreakChar, ReadMarkdownOptions, WriteMarkdownOptions, WriteMarkdownStyleOptions };