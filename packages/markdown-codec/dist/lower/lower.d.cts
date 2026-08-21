import { LinkReferenceMap } from "../inline/link.cjs";
import { ParsedMarkdown } from "../block/block.cjs";
import { ReadMarkdownOptions } from "../options/options.cjs";
import { ContentDocument, LayoutMetadata } from "document-schema.js";
//#region src/lower/lower.d.ts
declare function lowerParsedMarkdown(parsed: ParsedMarkdown, options?: ReadMarkdownOptions, metadata?: LayoutMetadata): ContentDocument;
interface LoweredMarkdownDetail {
  readonly document: ContentDocument;
  readonly references: LinkReferenceMap;
  readonly frontMatterSource: string | undefined;
}
declare function lowerMarkdownDetailed(source: string, options?: ReadMarkdownOptions): LoweredMarkdownDetail;
declare function lowerMarkdown(source: string, options?: ReadMarkdownOptions): ContentDocument;
//#endregion
export { LoweredMarkdownDetail, lowerMarkdown, lowerMarkdownDetailed, lowerParsedMarkdown };