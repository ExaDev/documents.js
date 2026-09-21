import type { ContentTable } from "document-schema.js";
import { describeTableGridFault, findTableGridFault } from "document-schema.js";

/**
 * Throws when `table` breaks the grid rule (ContentTableCell in document-schema.js), naming `entryPoint` and the fault. ODF writes a covered position as a `table:covered-table-cell` that holds no content, so a table whose covered positions carry blocks or spans, whose rows disagree about the grid, or whose regions run past the grid or into each other has no faithful spelling: the writer would drop what a covered position held, or guess which of two regions a position belongs to.
 */
export function assertTableObeysGridRule(
  table: ContentTable,
  entryPoint: string,
): void {
  const fault = findTableGridFault(table);
  if (fault !== undefined) {
    throw new Error(
      `${entryPoint}: table breaks the grid rule (${describeTableGridFault(fault)})`,
    );
  }
}
