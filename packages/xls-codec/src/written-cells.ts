import type { ContentSheetCell } from "document-schema.js";

import { cellFontDiffersFromNormal } from "./biff/font";

// Which of a sheet's cells the writer emits a cell record for, and whether a cell carries real formatting (decoration, alignment, or font) at all -- the two predicates the whole write path has to agree on, in one place because it previously did not.
//
// Four separate passes consult it: write.ts's number-format scan, its palette-colour scan, and its (format, font, alignment, decoration) -> XF interning pass, then workbook/sheet-writer.ts's own record emission. Every one of them has to reach the identical answer for a given cell, and the two failures a disagreement produces are both silent. The palette scan reading wider than the XF pass spent colour-table slots on colours nothing ever wrote, so a workbook was refused for exceeding a 56-entry budget it was nowhere near using; a disagreement the other way would write a cell record pointing at an XF index no XF record exists for, which no later read can detect as wrong. Neither is visible in the bytes afterwards, so the predicate is shared rather than restated per pass.

/**
 * Whether a cell carries real formatting beyond General/bottom-aligned/undecorated/default-font: a background fill, a border on at least one side, a non-default horizontal alignment, a non-default vertical alignment, or a font that differs from the workbook's own Normal font.
 *
 * A present `borders` object is not enough on its own -- one with no side set describes no border at all, and treating it as formatting would mint an XF byte-identical to the undecorated one and, for an empty cell, a Blank record the reader would then correctly drop again. write.ts's own resolveDecorationForCell answers "no decoration" for exactly this set through this same predicate, so the two cannot disagree about what an empty-but-present borders object means. A font is held to the identical standard through biff/font.ts's cellFontDiffersFromNormal, so a ContentFont that merely restates a default value (fontFamily "Arial", sizePt 10, bold false) is none either, for the same reason.
 */
export function cellCarriesFormatting(cell: ContentSheetCell): boolean {
  if (cell.background !== undefined) {
    return true;
  }
  if (cell.alignment !== undefined) {
    return true;
  }
  if (cell.verticalAlignment !== undefined) {
    return true;
  }
  if (cell.font !== undefined && cellFontDiffersFromNormal(cell.font)) {
    return true;
  }
  const { borders } = cell;
  if (borders === undefined) {
    return false;
  }
  return (
    borders.left !== undefined ||
    borders.right !== undefined ||
    borders.top !== undefined ||
    borders.bottom !== undefined
  );
}

/**
 * Whether the writer emits a cell record for this cell: a value record for anything carrying a value, a Formula record for anything carrying a formula, or a Blank record for an `empty`-kind cell whose formatting is the only thing it has to say.
 *
 * An unformatted empty cell with no formula is written as nothing at all, which is what round-trips: content.ts's reader drops an unformatted blank cell, and a merged range's empty anchor is reconstructed from the MergeCells record alone. A formatted one is not that case -- its fill, borders, and alignment live only in the XF a cell record points at, so writing nothing for it discards them. A formula is the identical case one level up: it lives only in a Formula record, so a cell carrying one is never dropped regardless of what its own cached `value` resolves to, even where that value alone would otherwise not have earned a record.
 */
export function writesCellRecord(cell: ContentSheetCell): boolean {
  return (
    cell.value.kind !== "empty" ||
    cellCarriesFormatting(cell) ||
    cell.formula !== undefined
  );
}
