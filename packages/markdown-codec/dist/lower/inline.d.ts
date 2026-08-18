import { v as MarkdownInlineNode } from "../ast-8XCbjRQT.js";
import { i as MarkdownDiagnosticSink } from "../diagnostics-BuO5-SW1.js";
import { ContentRun } from "document-schema.js";
//#region src/lower/inline.d.ts
interface InlineLowerContext {
  readonly sink: MarkdownDiagnosticSink;
  readonly rawHtml: 'preserve' | 'drop';
}
interface RunStyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly strike?: boolean;
  readonly hyperlink?: string;
}
declare function lowerInlineNode(node: MarkdownInlineNode, style: RunStyle, context: InlineLowerContext): ContentRun[];
declare function lowerInlineNodes(nodes: readonly MarkdownInlineNode[], context: InlineLowerContext): ContentRun[];
declare function lowerCodeBlockRun(literal: string): ContentRun;
//#endregion
export { InlineLowerContext, lowerCodeBlockRun, lowerInlineNode, lowerInlineNodes };