import { N as MarkdownTableNode } from "../ast-DbjiuYr8.js";
import { InlineLowerContext } from "./inline.js";
import { ContentTable } from "document-schema.js";
//#region src/lower/table.d.ts
declare function lowerTable(node: MarkdownTableNode, contentWidthPt: number, context: InlineLowerContext): ContentTable;
//#endregion
export { lowerTable };