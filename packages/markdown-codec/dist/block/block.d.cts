import { s as MarkdownDocumentNode } from "../ast-8XCbjRQT.cjs";
import { r as FootnoteLabelSet } from "../footnote-CKk4JbLk.cjs";
import { i as MarkdownDiagnosticSink } from "../diagnostics-CUMLtGHJ.cjs";
import { LinkReferenceMap } from "../inline/link.cjs";
import { t as InlineParseOptions } from "../inline-CoS1JzxI.cjs";
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