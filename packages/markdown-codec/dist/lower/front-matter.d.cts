import { i as MarkdownDiagnosticSink } from "../diagnostics-B72W0P_E.cjs";
import { LayoutMetadata } from "document-schema.js";
//#region src/lower/front-matter.d.ts
interface FrontMatterResult {
  readonly metadata: LayoutMetadata;
  readonly rest: string;
}
declare function extractFrontMatter(source: string, sink?: MarkdownDiagnosticSink): FrontMatterResult;
//#endregion
export { FrontMatterResult, extractFrontMatter };