import { t as MarkdownDiagnostic } from "./diagnostics-DmuWc7d8.js";
import { ReadMarkdownOptions } from "./options/options.js";
import { ContentDocument } from "document-schema.js";
//#region src/read.d.ts
interface ReadMarkdownResult {
  readonly document: ContentDocument;
  readonly diagnostics: readonly MarkdownDiagnostic[];
}
declare function readMarkdown(text: string, options?: ReadMarkdownOptions): ReadMarkdownResult;
//#endregion
export { ReadMarkdownResult, readMarkdown };