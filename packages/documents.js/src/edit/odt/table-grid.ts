import {
  COLUMN_REPEAT_ATTR,
  collectRunMembers,
  isCellOrCoveredCell,
  readRunRepeatCount,
  replaceRun,
} from "../odf-repeated-runs";
import type { ContentTableCell } from "document-schema.js";
import type { LiveTableGrid, PlacedLiveCell } from "../table-grid";
import type { Package, XmlElement } from "odf.js";
import { resolveLiveTableGrid } from "../table-grid";
import { tableCellColumnSpan, tableCellRowSpan } from "document-schema.js";
import {
  OdtTableCell,
  retagAsCovered,
  tableColumnElements,
  tableRowEntries,
} from "./table";
import type { XmlNode } from "odf.js";
import { ensureAutomaticStyles, nextStyleName } from "./automatic-styles";
import { attr } from "ooxml.js";
import { el } from "../../xml/fragment";
import { TABLE_ROW_STYLE_PREFIX } from "./table";
import { findStyleElement } from "odf.js";
// The grid-element, merge and row-properties machinery of OdtTable, split from table.ts: walking and individuating grid columns, resolving the occupied grid, the region algebra (cover, intersect, contain) that plans and applies a cell merge, and row-properties interning/cloning. table.ts keeps the cell, row and table classes and their XML emission.
// A row's own true grid columns, one entry per logical position, in document order: BOTH real table:table-cell and placeholder table:covered-table-cell children, each expanded by its own table:number-columns-repeated (ExaDev/documents.js#1374) — a repeated element stands for that many IDENTICAL adjacent grid columns (ODF's own repeat semantics, matching odf.js's read-side expansion in typed/shared/table.ts's readTableRow), not one, so this is the count every grid-addressed read or write in this file must reckon against, never a row's own physical child count. Every entry past the first for a given element shares that SAME element: the row genuinely has fewer physical children than grid columns until something individuates one of them (individuateGridColumn below).
export function gridColumnElements(
  row: XmlElement,
): { readonly columnIndex: number; readonly element: XmlElement }[] {
  const out: { columnIndex: number; element: XmlElement }[] = [];
  let columnIndex = 0;
  for (const member of collectRunMembers(
    row.children,
    isCellOrCoveredCell,
    undefined,
  )) {
    const repeat = readRunRepeatCount(member.node, COLUMN_REPEAT_ATTR);
    for (let offset = 0; offset < repeat; offset++) {
      out.push({ columnIndex: columnIndex + offset, element: member.node });
    }
    columnIndex += repeat;
  }
  return out;
}

// The row's own grid width: the count of logical positions its real and covered cells together stand for, honouring repeats — the bound every grid-column-addressed read or write in this file validates against, never the row's own physical child count.
export function rowGridColumnCount(row: XmlElement): number {
  return collectRunMembers(row.children, isCellOrCoveredCell, undefined).reduce(
    (sum, member) => sum + readRunRepeatCount(member.node, COLUMN_REPEAT_ATTR),
    0,
  );
}

// Reads the element at grid column `columnIndex` of `row` without mutating anything, even when that column falls inside a repeated run — used for a check (planMerge's anchor lookup) that must inspect a position's tag before deciding whether the operation is even valid, so that a refusal leaves the table exactly as it found it. Returns undefined for a negative or out-of-range columnIndex, matching this file's own established "does not exist" error wording at every call site.
export function locateGridColumnElement(
  row: XmlElement,
  columnIndex: number,
): XmlElement | undefined {
  if (columnIndex < 0) {
    return undefined;
  }
  let cursor = 0;
  for (const member of collectRunMembers(
    row.children,
    isCellOrCoveredCell,
    undefined,
  )) {
    const count = readRunRepeatCount(member.node, COLUMN_REPEAT_ATTR);
    if (columnIndex < cursor + count) {
      return member.node;
    }
    cursor += count;
  }
  return undefined;
}

// Individuates grid column `columnIndex` of `row`: when it falls inside a repeated run, splits that run in place (odf-repeated-runs.ts's replaceRun) into an optional shortened "before" run, a single un-repeated element at exactly this column, and an optional shortened "after" run — the un-repeat an edit to one repeated column needs, applied only to the column the edit actually touches, so the rest of the run (and whatever content it carries) survives untouched. Callers must bounds-check columnIndex against rowGridColumnCount first: replaceRun's own gap-filling fallback (its third case, for ODS's sparse-sheet addressing) would otherwise silently grow this row with a placeholder cell it was never asked to have, which is never correct for an ODT table — every grid column an odt row states already has a real backing element, repeated or not, so an out-of-range column is always a caller error, not a gap to fill.
export function individuateGridColumn(
  row: XmlElement,
  columnIndex: number,
): XmlElement {
  return replaceRun(
    row.children,
    isCellOrCoveredCell,
    columnIndex,
    COLUMN_REPEAT_ATTR,
    () => {
      throw new Error(
        `individuateGridColumn: column ${columnIndex} has no existing element to individuate in this row — callers must bounds-check against rowGridColumnCount first`,
      );
    },
  );
}

// Every table:table-row of a table:table element, in document order, found through the row wrappers as well as among the table's own direct children (tableRowEntries below states the wrapper rule and which of them mark a header row).
export function tableRowElements(table: XmlElement): XmlElement[] {
  return tableRowEntries(table).map((entry) => entry.element);
}

// The real cells of one row, each with the grid column its element sits at. A covered position has no cell of its own to place: the anchor that covers it owns it. A cell carrying its own table:number-columns-repeated (ExaDev/documents.js#1374) places once per logical column it stands for (gridColumnElements above), each entry wrapping the SAME underlying element — reading any of those positions reads the same live content, exactly as ODF's repeat semantics say they are the same cell repeated, until an edit that touches one of them individuates it (OdtTableRow.mergeCellsHorizontally/markCellCovered, OdtTable.mergeCells).
export function placedCells(
  row: XmlElement,
  pkg: Package,
): PlacedLiveCell<OdtTableCell>[] {
  return gridColumnElements(row).flatMap(({ columnIndex, element }) => {
    if (element.tag !== "table:table-cell") {
      return [];
    }
    const cell = new OdtTableCell(element, pkg);
    return [
      { columnIndex, cell, colSpan: cell.colSpan, rowSpan: cell.rowSpan },
    ];
  });
}

// The grid of one table:table element: its declared table:table-column count (honouring a column's own table:number-columns-repeated, exactly like a row's cells) and every table:table-row's real cells, resolved through the same walkTableGrid classification the content pivot uses.
export function resolveOdtGrid(
  table: XmlElement,
  pkg: Package,
): LiveTableGrid<OdtTableCell> {
  const placedRows: PlacedLiveCell<OdtTableCell>[][] = [];
  // Columns are collected through the wrappers rather than from the table's own direct children, so a table whose columns sit inside a table:table-header-columns (or any other column wrapper) still states its whole declared width here. This is the identical reasoning the row collection immediately below already applies.
  let declaredColumns = 0;
  for (const column of tableColumnElements(table)) {
    declaredColumns += readRunRepeatCount(column, COLUMN_REPEAT_ATTR);
  }
  // Rows are collected through the wrappers rather than from the table's own direct children, so a table whose rows sit inside a table:table-header-rows (or any other row wrapper) still states its whole grid here.
  for (const row of tableRowElements(table)) {
    placedRows.push(placedCells(row, pkg));
  }
  return resolveLiveTableGrid(placedRows, declaredColumns);
}

// A block of grid positions: the rows from `row` up to `row + rowSpan` and the columns from `column` up to `column + columnSpan`.
export interface GridRegion {
  readonly row: number;
  readonly column: number;
  readonly rowSpan: number;
  readonly columnSpan: number;
}

export function regionCovers(
  region: GridRegion,
  rowIndex: number,
  columnIndex: number,
): boolean {
  return (
    region.row <= rowIndex &&
    rowIndex < region.row + region.rowSpan &&
    region.column <= columnIndex &&
    columnIndex < region.column + region.columnSpan
  );
}

export function regionsIntersect(a: GridRegion, b: GridRegion): boolean {
  return (
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan &&
    a.column < b.column + b.columnSpan &&
    b.column < a.column + a.columnSpan
  );
}

export function regionContains(outer: GridRegion, inner: GridRegion): boolean {
  return (
    outer.row <= inner.row &&
    outer.column <= inner.column &&
    inner.row + inner.rowSpan <= outer.row + outer.rowSpan &&
    inner.column + inner.columnSpan <= outer.column + outer.columnSpan
  );
}

// The region every anchor of the grid occupies, from the spans its own element states: an unmerged cell is a one-position region. A covered position is never an anchor, so a position no anchor's region reaches is one no merge owns.
export function anchorRegions(grid: LiveTableGrid<OdtTableCell>): GridRegion[] {
  return grid.rows.flatMap((positions, row) =>
    positions.flatMap((position, column) => {
      if (position?.isAnchor !== true) {
        return [];
      }
      const spans: ContentTableCell = {
        blocks: [],
        colSpan: position.cell.colSpan,
        rowSpan: position.cell.rowSpan,
      };
      return [
        {
          row,
          column,
          rowSpan: tableCellRowSpan(spans),
          columnSpan: tableCellColumnSpan(spans),
        },
      ];
    }),
  );
}

// Whether merging `target` over `region` would change nothing: a rectangle one row high over a region anchored at the rectangle's own first column that already spans exactly the rectangle's columns. Such a merge states the anchor's column span again and consumes nothing, whatever the region's row span. The region is anchored in the rectangle's row because it reaches that row and the rectangle's first position is not one a merge covers, which planMerge has already established.
export function isUnchangedAnchor(
  region: GridRegion,
  target: GridRegion,
): boolean {
  return (
    target.rowSpan === 1 &&
    region.column === target.column &&
    region.columnSpan === target.columnSpan
  );
}

// Names a merge by the grid position it is anchored at.
export function describeRegionAnchor(region: GridRegion): string {
  return `the merge anchored at row ${region.row}, column ${region.column}`;
}

// A single grid position: the table:table-row element it belongs to and its grid column within that row. planMerge below resolves a merge's anchor and every consumed position to positions rather than to elements, since a position inside a repeated run (ExaDev/documents.js#1374) has no element of its own until applyMerge's own individuateGridColumn call gives it one — resolving straight to an element here, the way this used to, would mutate whichever OTHER grid columns happened to share that element's repeat run at the time planMerge ran.
export interface GridPosition {
  readonly row: XmlElement;
  readonly column: number;
}

// A merge the table allows: the grid position that becomes the merged region's anchor and the positions the merge retags to table:covered-table-cell.
export interface MergeAllowed {
  readonly anchor: GridPosition;
  readonly consumed: readonly GridPosition[];
  readonly refusal?: never;
}

// A merge the table refuses, the row of the rectangle it was found in, and why, phrased to follow the name of the operation that refused it.
export interface MergeRefused {
  readonly refusal: { readonly rowIndex: number; readonly reason: string };
  readonly anchor?: never;
  readonly consumed?: never;
}

export type MergePlan = MergeAllowed | MergeRefused;

export function refuseMerge(rowIndex: number, reason: string): MergeRefused {
  return { refusal: { rowIndex, reason } };
}

// Decides the merge of `target` without changing anything, so that a merge covering several rows finds out that a later row refuses before any earlier row has changed. `rows` are the table:table-row elements of the rectangle, top row first.
//
// A merge is refused when it would leave the grid rule broken, which is when its rectangle cuts through a merged region: a region the rectangle reaches that is not wholly inside it would either keep positions the new merge takes while losing its anchor, or lose positions to the new merge while keeping its anchor. A merged region wholly inside the rectangle is swallowed whole, as any unmerged cell in it is, so it leaves no orphan behind. The one merge that reaches a region without being wholly around it is one that changes nothing: a rectangle one row high over an anchor that already spans exactly its columns.
//
// The refusal names the row of the rectangle it was found in, the grid column, and the anchor of the region in the way. Every column this reads is a GRID column (locateGridColumnElement/rowGridColumnCount, honouring table:number-columns-repeated — ExaDev/documents.js#1374): a position an earlier repeated cell stands for is reached the same way any other position is. Nothing here mutates the row: the anchor and every consumed position are resolved to plain (row, column) pairs, never to an element, so a refusal leaves the table exactly as it found it and a later individuation (applyMerge) is the only thing that ever splits a repeated run.
export function planMerge(
  table: XmlElement,
  pkg: Package,
  target: GridRegion,
  rows: readonly [XmlElement, ...XmlElement[]],
): MergePlan {
  const [anchorRow, ...coveredRows] = rows;
  const anchorElement = locateGridColumnElement(anchorRow, target.column);
  if (anchorElement === undefined) {
    return refuseMerge(
      target.row,
      `column ${target.column} does not exist in this row`,
    );
  }
  const endColumn = target.column + target.columnSpan;
  for (const [offset, row] of rows.entries()) {
    const totalColumns = rowGridColumnCount(row);
    if (endColumn > totalColumns) {
      return refuseMerge(
        target.row + offset,
        `colSpan ${target.columnSpan} starting at column ${target.column} exceeds this row's own ${totalColumns} grid columns`,
      );
    }
  }
  const regions = anchorRegions(resolveOdtGrid(table, pkg));
  if (anchorElement.tag === "table:covered-table-cell") {
    const covering = regions.find((region) =>
      regionCovers(region, target.row, target.column),
    );
    return refuseMerge(
      target.row,
      covering === undefined
        ? `column ${target.column} is a covered position that no merge anchors`
        : `column ${target.column} is covered by ${describeRegionAnchor(covering)}`,
    );
  }
  const cutting = regions.find(
    (region) =>
      regionsIntersect(region, target) &&
      !regionContains(target, region) &&
      !isUnchangedAnchor(region, target),
  );
  if (cutting !== undefined) {
    const column = Math.max(cutting.column, target.column);
    return refuseMerge(
      Math.max(cutting.row, target.row),
      `column ${column} belongs to ${describeRegionAnchor(cutting)}, which reaches outside the region being merged and cannot be merged over`,
    );
  }
  const consumed: GridPosition[] = [];
  for (let column = target.column + 1; column < endColumn; column++) {
    consumed.push({ row: anchorRow, column });
  }
  for (const row of coveredRows) {
    for (let column = target.column; column < endColumn; column++) {
      consumed.push({ row, column });
    }
  }
  return { anchor: { row: anchorRow, column: target.column }, consumed };
}

// Carries out a merge planMerge allowed: individuates and retags every consumed position (individuateGridColumn, un-repeating exactly the columns this merge touches — ExaDev/documents.js#1374 — and leaving the rest of any repeated run, and whatever content it carries, untouched) and states the region's spans on its own individuated anchor. A rectangle one row high leaves the anchor's row span alone, since it is either unstated or a vertical merge the rectangle leaves as it is.
export function applyMerge(
  plan: MergeAllowed,
  target: GridRegion,
  pkg: Package,
): OdtTableCell {
  for (const position of plan.consumed) {
    retagAsCovered(individuateGridColumn(position.row, position.column));
  }
  const anchorElement = individuateGridColumn(
    plan.anchor.row,
    plan.anchor.column,
  );
  const anchor = new OdtTableCell(anchorElement, pkg);
  anchor.colSpan = target.columnSpan;
  if (target.rowSpan > 1) {
    anchor.rowSpan = target.rowSpan;
  }
  return anchor;
}

// The row wrappers ODF's table grammar allows between a table:table and its table:table-row children (OASIS ODF 1.3 part 1, 9.1.2 to 9.1.9), the same set odf.js's own readOdfTable descends through: a row inside one is a real row of this table, in its own document-order position, and a table:table-header-rows additionally says the rows it holds are header rows.

// The row's own CURRENT style:table-row-properties element — via table:style-name -> style:style[family="table-row"] -> style:table-row-properties — or undefined when the row carries no style, or its style has no such properties element. findStyleElement itself resolves across BOTH content.xml and styles.xml (including office:styles' common/named styles), so a row referencing a shared named style rather than its own automatic one still resolves here — but cloneCurrentRowProperties below copies only the resolved style's own style:table-row-properties element, discarding that style's own style:parent-style-name and any sibling properties element a named style might also carry (style:table-cell-properties and the like); harmless within this ecosystem, since a table-row family style never carries anything but style:table-row-properties in practice and odf.js's own table-row resolution does no parent-chain walk either (typed/shared/table.ts's own resolveRowHeightPt convention, for the identical "standalone in practice" reason).
export function currentRowPropertiesElement(
  pkg: Package,
  rowElement: XmlElement,
): XmlElement | undefined {
  const styleName = attr(rowElement, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, "table-row", pkg);
  return styleElement === undefined
    ? undefined
    : styleElement.children.find(
        (c): c is XmlElement =>
          c.type === "element" && c.tag === "style:table-row-properties",
      );
}

// A structural clone of the row's own current style:table-row-properties element (currentRowPropertiesElement above), or a fresh empty one when the row has none — structuredClone is safe here exactly as it is at src/edit/ods/address.ts's own identical use: an XmlElement is plain, serializable data with no methods or non-cloneable values. Cloning the WHOLE element, rather than reconstructing it attribute-by-attribute the way this file's own previous version did, is what lets every OTHER property already on it survive a heightPt write untouched — fo:break-before, fo:keep-together, and fo:background-color are all properties this file has NO dedicated getter/setter for at all (heightPt/style:row-height is the only one), which is exactly why cloning the whole element, rather than enumerating named properties one at a time, is the right approach; it also carries across this element's one permitted CHILD, style:background-image (OASIS ODF 1.3 RelaxNG: style:table-row-properties-content permits exactly that one optional child), without this file ever needing to enumerate each one by name. style:use-optimal-row-height is the one exception: the caller deliberately mutates it (alongside style:row-height itself) on the returned clone; see the heightPt setter below for why.
export function cloneCurrentRowProperties(
  pkg: Package,
  rowElement: XmlElement,
): XmlElement {
  const props = currentRowPropertiesElement(pkg, rowElement);
  return props === undefined
    ? el("style:table-row-properties")
    : structuredClone(props);
}

// Structural equality between two XML nodes — used by xmlElementsEqual below to compare a style:table-row-properties element's CHILDREN, not just its attributes. style:background-image, the one child the schema permits here, is itself an element, so the element branch is the one that actually matters; text/cdata/comment are covered too since a hand-pretty-printed source document could carry whitespace between an opening tag and its child. An XmlDeclaration/XmlPi can never occur as an element's own child in a tree odf.js's parser produces (both appear only at the document root), so either one simply compares unequal to anything here rather than this function pretending to model a case that cannot arise.
export function xmlNodesEqual(a: XmlNode, b: XmlNode): boolean {
  if (a.type === "element" && b.type === "element") {
    return xmlElementsEqual(a, b);
  }
  if (a.type === "text" && b.type === "text") {
    return a.value === b.value;
  }
  if (a.type === "cdata" && b.type === "cdata") {
    return a.value === b.value;
  }
  if (a.type === "comment" && b.type === "comment") {
    return a.value === b.value;
  }
  return false;
}

// Structural equality between two elements: the same tag, the identical set of attributes (order-independent, mirroring this file's own established attribute-set comparison), and the identical children in the same document order. internTableRowProperties below uses this to decide whether an existing automatic style's own style:table-row-properties element can be reused for a new request — comparing attributes alone (this file's previous rowStylePropertiesMatch) let a plain height-only row reuse a style that also carried an extra child element such as style:background-image, silently importing it onto a row that never had one. Comparing the WHOLE element closes that generally, for any property or child this file has never enumerated by name, rather than special-casing style:background-image specifically.
export function xmlElementsEqual(a: XmlElement, b: XmlElement): boolean {
  if (a.tag !== b.tag || a.attributes.length !== b.attributes.length) {
    return false;
  }
  if (
    !a.attributes.every(
      (candidate) => attr(b, candidate.name) === candidate.value,
    )
  ) {
    return false;
  }
  if (a.children.length !== b.children.length) {
    return false;
  }
  for (let index = 0; index < a.children.length; index++) {
    const childA = a.children[index];
    const childB = b.children[index];
    if (childA === undefined || childB === undefined) {
      return false;
    }
    if (!xmlNodesEqual(childA, childB)) {
      return false;
    }
  }
  return true;
}

// The row-height counterpart to internTableColumnWidth above, generalised beyond a single attribute: mints (or reuses) a style:style[family="table-row"] carrying `properties` — already a full style:table-row-properties element, attributes and any children both — as its own child. Reuse requires the FULL element to match (xmlElementsEqual above: same attributes, same children, same order), never attributes alone, so a request carrying no extra child never reuses a style whose element carries one. Callers pass a clone of the row's own current properties element with heightPt's own change already applied (cloneCurrentRowProperties plus the heightPt setter's own mutation below) — never mutate an existing automatic style in place, since other rows may still reference it.
export function internTableRowProperties(
  pkg: Package,
  properties: XmlElement,
): string {
  const automaticStyles = ensureAutomaticStyles(pkg);
  for (const child of automaticStyles.children) {
    if (
      child.type !== "element" ||
      child.tag !== "style:style" ||
      attr(child, "style:family") !== "table-row"
    ) {
      continue;
    }
    const props = child.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:table-row-properties",
    );
    if (props !== undefined && xmlElementsEqual(props, properties)) {
      const existingName = attr(child, "style:name");
      if (existingName !== undefined) {
        return existingName;
      }
    }
  }
  const name = nextStyleName(
    automaticStyles,
    "style:style",
    TABLE_ROW_STYLE_PREFIX,
  );
  automaticStyles.children.push(
    el("style:style", { "style:name": name, "style:family": "table-row" }, [
      properties,
    ]),
  );
  return name;
}
