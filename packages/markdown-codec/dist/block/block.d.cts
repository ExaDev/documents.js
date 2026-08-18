import { s as MarkdownDocumentNode } from "../ast-8XCbjRQT.cjs";
import { r as FootnoteLabelSet } from "../footnote-BrIWhACz.cjs";
import { i as MarkdownDiagnosticSink } from "../diagnostics-BuO5-SW1.cjs";
import { n as LinkReferenceMap } from "../link-Dv4kxVjk.cjs";
import { t as InlineParseOptions } from "../inline-CBvN1_YL.cjs";
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