import { WriteMarkdownOptions } from "../options/options.cjs";
import { ContentDocument } from "document-schema.js";
//#region src/emit/emit.d.ts
declare function emitMarkdown(document: ContentDocument, options?: WriteMarkdownOptions): string;
//#endregion
export { emitMarkdown };