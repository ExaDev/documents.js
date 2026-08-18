import { v as MarkdownInlineNode } from "./ast-8XCbjRQT.js";
import { r as FootnoteLabelSet } from "./footnote-CKk4JbLk.js";
import { n as LinkReferenceMap } from "./link-Dv4kxVjk.js";
//#region src/inline/inline.d.ts
interface InlineParseOptions {
  readonly gfmAutolinks?: boolean;
  readonly gfmStrikethrough?: boolean;
}
declare function parseInlines(content: string, references: LinkReferenceMap, footnotes: FootnoteLabelSet, options?: InlineParseOptions): MarkdownInlineNode[];
//#endregion
export { parseInlines as n, InlineParseOptions as t };