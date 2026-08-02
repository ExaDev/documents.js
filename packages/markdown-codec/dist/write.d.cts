import { WriteMarkdownOptions } from "./options/options.cjs";
import { ContentDocument } from "document-schema.js";
//#region src/write.d.ts
declare function writeMarkdown(document: ContentDocument, options?: WriteMarkdownOptions): string;
//#endregion
export { writeMarkdown };