import { F as MarkdownTableNode } from "../ast-8XCbjRQT.cjs";
import { InlineLowerContext } from "./inline.cjs";
import { ContentTable } from "document-schema.js";
//#region src/lower/table.d.ts
declare function lowerTable(node: MarkdownTableNode, contentWidthPt: number, context: InlineLowerContext): ContentTable;
//#endregion
export { lowerTable };