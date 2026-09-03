import type { ContentSheetCell } from "document-schema.js";

// Which of a sheet's cells the writer emits a cell record for -- the one predicate the whole write path has to agree on, in one place because it previously did not.
//
// Four separate passes consult it: write.ts's number-format scan, its palette-colour scan, and its (format, decoration) -> XF interning pass, then workbook/sheet-writer.ts's own record emission. Every one of them has to reach the identical answer for a given cell, and the two failures a disagreement produces are both silent. The palette scan reading wider than the XF pass spent colour-table slots on colours nothing ever wrote, so a workbook was refused for exceeding a 56-entry budget it was nowhere near using; a disagreement the other way would write a cell record pointing at an XF index no XF record exists for, which no later read can detect as wrong. Neither is visible in the bytes afterwards, so the predicate is shared rather than restated per pass.

/**
 * Whether the writer emits a cell record for this cell.
 *
 * An `empty`-kind cell is written as nothing at all, which is what round-trips: content.ts's reader drops a blank cell, and a merged range's empty anchor is reconstructed from the MergeCells record alone.
 */
export function writesCellRecord(cell: ContentSheetCell): boolean {
  return cell.value.kind !== "empty";
}
