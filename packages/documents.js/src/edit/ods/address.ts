import type { XmlElement } from "odf.js";
import { el } from "../../xml/fragment";
import {
  CELL_TAG,
  COLUMN_REPEAT_ATTR,
  collectRunMembers,
  isCellOrCoveredCell,
  isElementWithTag,
  readRunRepeatCount,
  replaceRun,
  ROW_REPEAT_ATTR,
  ROW_TAG,
  validateIndex,
  withRepeatCount,
} from "../odf-repeated-runs";

// The write-side mirror of odf.js's own read-side repeat-count hazard (see its typed/shared/a1.ts and typed/ods/read.ts top-of-file notes): table:number-rows-repeated/table:number-columns-repeated routinely compress a run of thousands or millions of identical rows/columns/cells into ONE XML element. Reading already has to walk past a huge run in O(1) without materializing it (odf.js's own TableCursor); writing into a SPECIFIC position -- e.g. a caller setting row 500's column 50 on an otherwise-empty sheet, or editing row 500,000 of a real spreadsheet whose trailing area is one giant repeated placeholder -- has the mirror-image obligation: never materialize every position between the sheet's current content and the target, either by expanding an existing repeated run element-by-element or by padding the gap with one throwaway element per skipped position. The individuation algorithm itself (replaceRun and its supporting pieces) is generic across ODF table users and now lives in ../odf-repeated-runs, shared with the odt table editor (ExaDev/documents.js#1374) -- every caller that used to import it from here now imports it from there directly (this repo's own barrel-policy lint rule forbids re-exporting a value through a non-barrel file), and this file keeps only what is genuinely ODS-specific: the header-wrapper tags/attribute, and ensureColumnCoverage/resolveCellNode below.
//
// table:table-header-rows/table:table-header-columns (odf.js's own typed/ods/read.ts readTable: the wrapper ContentSheetPrintSettings.repeatRows/repeatColumns are recovered from) nest a contiguous run of real table:table-row/table:table-column elements ONE level inside a wrapper element, rather than leaving them as direct table:table children -- print-settings.ts's own writeSheetPrintSettings moves rows/columns into exactly this wrapper when a caller sets repeatRows/repeatColumns. ensureColumnCoverage below therefore takes an optional headerWrapperTag (via collectRunMembers): when given, a member search also descends one level into any matching wrapper, so a row/column already living inside a repeat-header is found and individuated in place rather than spuriously duplicated outside it. Passing no headerWrapperTag (the cell-within-a-row case, which has no such wrapper concept at all) reproduces the original flat, single-level behaviour exactly.

export const COLUMN_TAG = "table:table-column";
export const HEADER_ROWS_TAG = "table:table-header-rows";
export const HEADER_COLUMNS_TAG = "table:table-header-columns";

// Extends `tableElement`'s own declared table:table-column coverage to at least `minCount` columns, WITHOUT individuating any specific one -- unlike rows/cells, a column is never itself addressed by this editor (there is no per-column getter on OdsSheet), so there is nothing to return and no reason to split an existing run; only the LAST declared column run needs its own repeat count extended (or, if no columns exist yet, a single new one appended before the first row). Called on every cell write so a sheet's declared column count always covers the widest cell address any caller has actually used -- keeping the file genuinely well-formed for a real consumer (LibreOffice renders a grid sized off the declared columns, not off the highest cell address it happens to encounter) without ever growing the element count proportionally to how sparse or wide the addressed cells are. Header-wrapper-aware (see this file's own top-of-file note): a column already living inside a table:table-header-columns wrapper (print-settings.ts's own repeatColumns) still counts toward coverage, and the new run is always inserted as tableElement's own direct child immediately after whichever column (wrapped or not) currently covers the highest index -- never inside the wrapper itself, since a freshly gap-filled column was never declared to repeat.
export function ensureColumnCoverage(
  tableElement: XmlElement,
  minCount: number,
): void {
  if (minCount <= 0) {
    return;
  }
  const columnMembers = collectRunMembers(
    tableElement.children,
    isElementWithTag(COLUMN_TAG),
    HEADER_COLUMNS_TAG,
  );
  const covered = columnMembers.reduce(
    (sum, member) => sum + readRunRepeatCount(member.node, COLUMN_REPEAT_ATTR),
    0,
  );
  if (covered >= minCount) {
    return;
  }
  const additional = minCount - covered;
  const newColumn = withRepeatCount(
    el(COLUMN_TAG),
    COLUMN_REPEAT_ATTR,
    additional,
  );
  const lastColumn = columnMembers[columnMembers.length - 1];
  if (lastColumn === undefined) {
    const firstRowOrHeaderPosition = tableElement.children.findIndex(
      (node) =>
        isElementWithTag(ROW_TAG)(node) ||
        isElementWithTag(HEADER_ROWS_TAG)(node),
    );
    const insertAt =
      firstRowOrHeaderPosition === -1
        ? tableElement.children.length
        : firstRowOrHeaderPosition;
    tableElement.children.splice(insertAt, 0, newColumn);
  } else {
    tableElement.children.splice(lastColumn.outerPosition + 1, 0, newColumn);
  }
}

// Resolves (individuating and gap-filling as needed, per replaceRun above) the table:table-cell/table:covered-table-cell element at (row, column) within `tableElement`, first ensuring the table's own declared columns cover at least column + 1 (ensureColumnCoverage above). This is the single entry point every cell-level operation in this editor goes through -- OdsSheet.cell/cellAt route ordinary access through it (and reject a resolved table:covered-table-cell, since that position belongs to another cell's merge), OdsSheet.mergeCells routes both the anchor lookup and every covered position it stamps through it too. Header-wrapper-aware for the row lookup, so a row already living inside a repeatRows wrapper (print-settings.ts) resolves to its real, existing element rather than a spurious duplicate; a table:table-cell within a row is never itself wrapped by anything, so the column-within-a-row lookup passes no wrapper tag, exactly as before.
export function resolveCellNode(
  tableElement: XmlElement,
  row: number,
  column: number,
): XmlElement {
  validateIndex(row, "row");
  validateIndex(column, "column");
  ensureColumnCoverage(tableElement, column + 1);
  const rowElement = replaceRun(
    tableElement.children,
    isElementWithTag(ROW_TAG),
    row,
    ROW_REPEAT_ATTR,
    () => el(ROW_TAG),
    HEADER_ROWS_TAG,
  );
  return replaceRun(
    rowElement.children,
    isCellOrCoveredCell,
    column,
    COLUMN_REPEAT_ATTR,
    () => el(CELL_TAG),
  );
}
