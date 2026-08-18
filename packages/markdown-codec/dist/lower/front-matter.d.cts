import { i as MarkdownDiagnosticSink } from "../diagnostics-BuO5-SW1.cjs";
import { LayoutMetadata } from "document-schema.js";
//#region src/lower/front-matter.d.ts
interface FrontMatterResult {
  readonly metadata: LayoutMetadata;
  readonly rest: string;
}
declare function extractFrontMatter(source: string, sink?: MarkdownDiagnosticSink): FrontMatterResult;
//#endregion
export { FrontMatterResult, extractFrontMatter };