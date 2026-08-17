import { t as MarkdownDiagnostic } from "./diagnostics-B72W0P_E.cjs";
import { ReadMarkdownOptions } from "./options/options.cjs";
import { ContentDocument } from "document-schema.js";
//#region src/read.d.ts
interface ReadMarkdownResult {
  readonly document: ContentDocument;
  readonly diagnostics: readonly MarkdownDiagnostic[];
}
declare function readMarkdown(text: string, options?: ReadMarkdownOptions): ReadMarkdownResult;
//#endregion
export { ReadMarkdownResult, readMarkdown };