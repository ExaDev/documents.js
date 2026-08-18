import { N as MarkdownTableAlignment } from "../ast-8XCbjRQT.cjs";
//#region src/block/table.d.ts
declare function splitTableRow(line: string): string[];
declare function parseTableDelimiterRow(line: string): MarkdownTableAlignment[] | undefined;
declare function fitRowToColumns(cells: readonly string[], columnCount: number): string[];
//#endregion
export { fitRowToColumns, parseTableDelimiterRow, splitTableRow };