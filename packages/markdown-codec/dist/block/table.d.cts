import { j as MarkdownTableAlignment } from "../ast-DbjiuYr8.cjs";
//#region src/block/table.d.ts
declare function splitTableRow(line: string): string[];
declare function parseTableDelimiterRow(line: string): MarkdownTableAlignment[] | undefined;
declare function fitRowToColumns(cells: readonly string[], columnCount: number): string[];
//#endregion
export { fitRowToColumns, parseTableDelimiterRow, splitTableRow };