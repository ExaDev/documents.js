import { s as MarkdownDocumentNode } from "../ast-DbjiuYr8.cjs";
import { i as MarkdownDiagnosticSink } from "../diagnostics-B72W0P_E.cjs";
import { n as LinkReferenceMap } from "../link-Dv4kxVjk.cjs";
import { t as InlineParseOptions } from "../inline-uVHJ5xzT.cjs";
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