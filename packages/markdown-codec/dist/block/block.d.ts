import { s as MarkdownDocumentNode } from "../ast-8XCbjRQT.js";
import { r as FootnoteLabelSet } from "../footnote-BrIWhACz.js";
import { i as MarkdownDiagnosticSink } from "../diagnostics-BuO5-SW1.js";
import { n as LinkReferenceMap } from "../link-Dv4kxVjk.js";
import { t as InlineParseOptions } from "../inline-BzFbXWuR.js";
//#region src/block/block.d.ts
interface MarkdownParseOptions extends InlineParseOptions {
  readonly gfmTables?: boolean;
  readonly gfmTaskLists?: boolean;
  readonly footnotes?: boolean;
  readonly maxNesting?: number;
  readonly sink?: MarkdownDiagnosticSink;
}
interface ParsedMarkdown {
  readonly document: MarkdownDocumentNode;
  readonly references: LinkReferenceMap;
  readonly footnotes: FootnoteLabelSet;
}
declare function parseMarkdown(source: string, options?: MarkdownParseOptions): ParsedMarkdown;
//#endregion
export { MarkdownParseOptions, ParsedMarkdown, parseMarkdown };