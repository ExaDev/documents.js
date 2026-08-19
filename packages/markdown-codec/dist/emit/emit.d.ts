import { WriteMarkdownOptions } from "../options/options.js";
import { ContentDocument } from "document-schema.js";
//#region src/emit/emit.d.ts
declare function emitMarkdown(document: ContentDocument, options?: WriteMarkdownOptions): string;
//#endregion
export { emitMarkdown };