import { WriteMarkdownOptions } from "./options/options.js";
import { ContentDocument, DocumentPackage } from "document-schema.js";
//#region src/write.d.ts
declare function writeMarkdown(documentPackage: DocumentPackage, options?: WriteMarkdownOptions): string;
declare function writeMarkdownContent(document: ContentDocument, options?: WriteMarkdownOptions): string;
//#endregion
export { writeMarkdown, writeMarkdownContent };