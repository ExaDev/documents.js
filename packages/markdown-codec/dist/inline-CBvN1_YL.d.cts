import { v as MarkdownInlineNode } from "./ast-8XCbjRQT.cjs";
import { r as FootnoteLabelSet } from "./footnote-BrIWhACz.cjs";
import { n as LinkReferenceMap } from "./link-Dv4kxVjk.cjs";
//#region src/inline/inline.d.ts
interface InlineParseOptions {
  readonly gfmAutolinks?: boolean;
  readonly gfmStrikethrough?: boolean;
}
declare function parseInlines(content: string, references: LinkReferenceMap, footnotes: FootnoteLabelSet, options?: InlineParseOptions): MarkdownInlineNode[];
//#endregion
export { parseInlines as n, InlineParseOptions as t };