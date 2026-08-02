import { s as MarkdownDocumentNode } from "../ast-BXYwy08e.cjs";
import { i as MarkdownDiagnosticSink } from "../diagnostics-DmuWc7d8.cjs";
import { n as LinkReferenceMap } from "../link-Dv4kxVjk.cjs";
import { t as InlineParseOptions } from "../inline-C9YEGDV5.cjs";
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