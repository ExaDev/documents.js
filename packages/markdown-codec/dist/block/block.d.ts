import { s as MarkdownDocumentNode } from "../ast-8XCbjRQT.js";
import { r as FootnoteLabelSet } from "../footnote-CKk4JbLk.js";
import { i as MarkdownDiagnosticSink } from "../diagnostics-CUMLtGHJ.js";
import { LinkReferenceMap } from "../inline/link.js";
import { t as InlineParseOptions } from "../inline-OGXVE6hB.js";
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