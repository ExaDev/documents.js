import { s as MarkdownDocumentNode } from "../ast-DbjiuYr8.js";
import { i as MarkdownDiagnosticSink } from "../diagnostics-B72W0P_E.js";
import { n as LinkReferenceMap } from "../link-Dv4kxVjk.js";
import { t as InlineParseOptions } from "../inline-TuBQ2TUr.js";
//#region src/block/block.d.ts
interface MarkdownParseOptions extends InlineParseOptions {
  readonly gfmTables?: boolean;
  readonly gfmTaskLists?: boolean;
  readonly maxNesting?: number;
  readonly sink?: MarkdownDiagnosticSink;
}
interface ParsedMarkdown {
  readonly document: MarkdownDocumentNode;
  readonly references: LinkReferenceMap;
}
declare function parseMarkdown(source: string, options?: MarkdownParseOptions): ParsedMarkdown;
//#endregion
export { MarkdownParseOptions, ParsedMarkdown, parseMarkdown };