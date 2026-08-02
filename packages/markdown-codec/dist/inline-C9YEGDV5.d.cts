import { g as MarkdownInlineNode } from "./ast-BXYwy08e.cjs";
import { n as LinkReferenceMap } from "./link-Dv4kxVjk.cjs";
//#region src/inline/inline.d.ts
interface InlineParseOptions {
  readonly gfmAutolinks?: boolean;
  readonly gfmStrikethrough?: boolean;
}
declare function parseInlines(content: string, references: LinkReferenceMap, options?: InlineParseOptions): MarkdownInlineNode[];
//#endregion
export { parseInlines as n, InlineParseOptions as t };