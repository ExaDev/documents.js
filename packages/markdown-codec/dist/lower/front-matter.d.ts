import { i as MarkdownDiagnosticSink } from "../diagnostics-DmuWc7d8.js";
import { LayoutMetadata } from "document-schema.js";
//#region src/lower/front-matter.d.ts
interface FrontMatterResult {
  readonly metadata: LayoutMetadata;
  readonly rest: string;
}
declare function extractFrontMatter(source: string, sink?: MarkdownDiagnosticSink): FrontMatterResult;
//#endregion
export { FrontMatterResult, extractFrontMatter };