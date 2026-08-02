import { ParsedMarkdown } from "../block/block.js";
import { ReadMarkdownOptions } from "../options/options.js";
import { ContentDocument, LayoutMetadata } from "document-schema.js";
//#region src/lower/lower.d.ts
declare function lowerParsedMarkdown(parsed: ParsedMarkdown, options?: ReadMarkdownOptions, metadata?: LayoutMetadata): ContentDocument;
declare function lowerMarkdown(source: string, options?: ReadMarkdownOptions): ContentDocument;
//#endregion
export { lowerMarkdown, lowerParsedMarkdown };