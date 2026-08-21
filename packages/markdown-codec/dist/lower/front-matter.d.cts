import { i as MarkdownDiagnosticSink } from "../diagnostics-CUMLtGHJ.cjs";
import { LayoutMetadata } from "document-schema.js";
//#region src/lower/front-matter.d.ts
interface FrontMatterResult {
  readonly metadata: LayoutMetadata;
  readonly rest: string;
  readonly source: string | undefined;
}
declare function extractFrontMatter(source: string, sink?: MarkdownDiagnosticSink): FrontMatterResult;
//#endregion
export { FrontMatterResult, extractFrontMatter };