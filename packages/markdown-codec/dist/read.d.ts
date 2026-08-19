import { t as MarkdownDiagnostic } from "./diagnostics-BWK1iGy7.js";
import { ReadMarkdownOptions } from "./options/options.js";
import { ContentDocument, DocumentPackage } from "document-schema.js";
//#region src/read.d.ts
interface ReadMarkdownResult {
  readonly documentPackage: DocumentPackage;
  readonly diagnostics: readonly MarkdownDiagnostic[];
}
interface ReadMarkdownContentResult {
  readonly document: ContentDocument;
  readonly diagnostics: readonly MarkdownDiagnostic[];
}
declare function readMarkdown(text: string, options?: ReadMarkdownOptions): ReadMarkdownResult;
declare function readMarkdownContent(text: string, options?: ReadMarkdownOptions): ReadMarkdownContentResult;
//#endregion
export { ReadMarkdownContentResult, ReadMarkdownResult, readMarkdown, readMarkdownContent };