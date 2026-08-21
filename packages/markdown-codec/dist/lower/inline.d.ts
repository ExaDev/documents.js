import { v as MarkdownInlineNode } from "../ast-8XCbjRQT.js";
import { i as MarkdownDiagnosticSink } from "../diagnostics-DVFklCTL.js";
import { ContentRun, RunConstructExtent } from "document-schema.js";
//#region src/lower/inline.d.ts
interface InlineLowerContext {
  readonly sink: MarkdownDiagnosticSink;
  readonly rawHtml: 'preserve' | 'drop';
}
interface InlineLowerResult {
  readonly runs: ContentRun[];
  readonly linkTitleExtents: readonly RunConstructExtent[];
}
declare function lowerInlineNodes(nodes: readonly MarkdownInlineNode[], context: InlineLowerContext): InlineLowerResult;
declare function lowerCodeBlockRun(literal: string): ContentRun;
//#endregion
export { InlineLowerContext, InlineLowerResult, lowerCodeBlockRun, lowerInlineNodes };