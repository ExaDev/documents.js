import type {
  Color,
  ContentBlock,
  ContentBorder,
  ContentCellBorders,
  ContentParagraph,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";
import { DocFormatError, DocUnsupportedError } from "../errors";
import type { ParagraphEntry } from "../read";
import {
  HORZ_MERGE_CONTINUATION,
  VERT_MERGE_CONTINUATION,
  applyTableSprms,
  type TableRowDefinition,
} from "./tap";
import {
  cellBordersFrom,
  type CellBorderSide,
  type TableBordersSet,
} from "./decoration";
import { CELL_MARK } from "../text/special";

// Groups the flat paragraph-entry sequence read.ts produces into the final ContentBlock list, folding every contiguous run of table-depth-1 paragraphs into a real ContentTable with row/cell/merge structure -- [MS-DOC] 2.4.3's own Overview of Tables model: a table is a run of paragraphs each marked sprmPFInTable, cells delimited by cell-mark (0x07) characters (a cell holding more than one paragraph ends every paragraph but its last with an ordinary 0x0D mark), and each row closed by a row-ending mark of its own (sprmPFTtp, itself a 0x07 mark) that carries the row's TAP -- its column layout and every physical cell's own horizontal/vertical merge state, resolved by tap.ts. A non-table entry passes through untouched. A run whose TAP this reader cannot resolve degrades to its own paragraphs rather than failing the whole document -- see tryAssembleTable's own note.
//
// Column layout is derived per row, never assumed shared: [MS-DOC] 2.6.3 permits each row of a table to declare its own independent rgdxaCenter, and a real, independent [MS-DOC] implementation (LibreOffice 26.2.5.2) was confirmed to rely on exactly this for a horizontal merge -- a merged row's own TDefTableOperand simply has fewer, wider physical cells, with no TCGRF.horzMerge or sprmTMerge signal at all (ExaDev/documents.js#895; see table/write.ts's own top-of-file note for the full ground-truth finding). buildRows below reconstructs the table's shared grid as the union of every row's own column boundaries -- taken within one point rather than by exact integer equality, since rows stating the identical grid independently may legally disagree by a twip or two (see isSameColumnBoundary's own note) -- then expresses each physical cell's own colSpan as however many of that shared grid's segments its own boundaries cover -- folding in this writer's own legacy TCGRF.horzMerge-flagged continuation cells (a spec-conformant encoding this reader still honours, in case a genuine third-party producer uses it) exactly as before. A column boundary that no row in the table ever states on its own -- every row happens to merge across it identically -- cannot be recovered from the physical bytes at all; this is a real limitation of [MS-DOC]'s own physical model, not an approximation this reader is choosing to make. table/write.ts's own writer no longer produces this gap for an ordinary merge (ExaDev/documents.js#992: it falls back to a horizontal-merge continuation cell precisely when every row would otherwise merge across a boundary identically) -- but its own lost-boundary fallback now genuinely reopens it: when a row's assigned split would overflow either the row-ending mark's own byte budget or the format's 63-cell ceiling, flattenTable (table/write.ts) trims the excess boundaries rather than throwing (ExaDev/documents.js#1013), and a boundary it trims away is exactly as unrecoverable on the next read as one no row ever stated at all. That trim is now the most likely source of this shape; a table hand-built for a test, or produced by a genuine third-party [MS-DOC] implementation that happens to encode a merge the identical way on every row, are the two remaining, rarer sources (see the README's own note on this).
//
// tryAssembleTable runs applyRowLevelBorderCascade over the whole set of rows it has just collected, once the table's own shared column grid is known: a table decorated purely through sprmTTableBorders/sprmTTableBorders80 (a row/table-wide border set, [MS-DOC] 2.6.3) rather than per-cell TC80/sprmTSetBrc would otherwise read with no cell borders at all, since tap.ts deliberately only captures that cascade unresolved (see its own top-of-file note on why) -- this is the only place in the pipeline that knows a cell's position in the WHOLE table, which first/last row and first/last physical cell for that cascade's own six fields all depend on. The grid is needed, and not just the row's own physical layout, because a vertically-merged anchor's own bottom edge is the table's real bottom edge whenever its vertMerge continuation chain -- matched by grid position across rows, the identical matching buildRows' own rowSpan computation performs -- reaches a continuation cell physically sitting in the table's last row, regardless of which (non-final) row the anchor itself is written in. See applyRowLevelBorderCascade's own note for the precedence rule and the one genuine ambiguity it cannot resolve.

const TWIPS_PER_POINT = 20;

// Whether two column boundaries, stated independently by two of a table's own rows, name the same boundary of its shared grid rather than two distinct columns, within toleranceTwips -- effectiveColumnBoundaryTolerance's own result, never the bare TWIPS_PER_POINT constant, since a table that itself states a narrower real column needs a narrower fuzz (see that function's own note).
//
// A real, independent [MS-DOC] implementation applies an analogous fuzz to an analogous computation: LibreOffice's own table model is per-row too (SwTableLine -> SwTableBox, each box carrying its own width), so its own ODF export -- the point at which it projects that per-row model onto one shared grid, sw/source/filter/xml/xmltble.cxx's SwXMLTableColumn_Impl -- faces the same reconstruct-one-shared-grid-from-N-per-row-arrays problem this function exists for, and sw/source/filter/inc/wrtswtbl.hxx answers it with `#define COLFUZZY 20` twips: SwWriteTableCol::operator== compares two column positions as equal when they differ by at most that. Round-tripping a single patched int16 through LibreOffice 26.2.5.2 (.doc import, then its own ODF export) confirms the threshold empirically and exactly: a second row's boundary drifting 1 to 20 twips from the first's reads back as one shared 3-column grid, 21 and beyond as 4 columns with a real table:covered-table-cell. See ExaDev/documents.js#898.
function isSameColumnBoundary(
  left: number,
  right: number,
  toleranceTwips: number,
): boolean {
  return Math.abs(left - right) <= toleranceTwips;
}

// The tolerance isSameColumnBoundary actually uses for one table, never wider than TWIPS_PER_POINT and never wide enough to fold two boundaries the SAME row states as genuinely distinct into one: this reader's own writer has no equivalent of LibreOffice's MINLAY minimum-cell-width widening, so nothing stops a real producer's own table from stating a column narrower than a point, and treating that column's own two boundaries as "the same" would silently delete it -- a real narrow column, not phantom drift, since a single row's own rgdxaCenter entries are never ambiguous about how many columns that row states. Clamping to one twip below the narrowest strictly-positive gap any row states between two of its own adjacent boundaries makes that impossible: two boundaries closer together than the tightest real column this table declares are never merged, whichever rows they came from. A zero-width gap is a legal adjacent-duplicate boundary (a genuine zero-width cell, see logicalCellsForRow's own note) rather than a column at all, and is excluded so one zero-width cell in a table does not collapse every other boundary to exact matching.
function effectiveColumnBoundaryTolerance(
  definitions: readonly TableRowDefinition[],
): number {
  let narrowestRealGapTwips: number | undefined;
  for (const definition of definitions) {
    const boundaries = definition.columnBoundariesTwips;
    for (let index = 1; index < boundaries.length; index += 1) {
      const left = boundaries[index - 1];
      const right = boundaries[index];
      if (left === undefined || right === undefined) continue;
      const gap = right - left;
      if (
        gap > 0 &&
        (narrowestRealGapTwips === undefined || gap < narrowestRealGapTwips)
      ) {
        narrowestRealGapTwips = gap;
      }
    }
  }
  return narrowestRealGapTwips === undefined
    ? TWIPS_PER_POINT
    : Math.min(TWIPS_PER_POINT, narrowestRealGapTwips - 1);
}

interface RawCell {
  readonly horzMerge: number;
  readonly vertMerge: number;
  readonly borders: ContentCellBorders | undefined;
  /** Sides this cell's own sprmTSetBrc/sprmTSetBrc80 has explicitly cleared to a NilBrc/NilBrc80, threaded from tap.ts's TableCellProperties.clearedSides -- see applyRowLevelBorderCascade's own note for why cascadeRowBorders must never re-fill one of these. */
  readonly clearedSides: ReadonlySet<CellBorderSide> | undefined;
  readonly background: Color | undefined;
  readonly blocks: ContentBlock[];
}

export function assembleBlocks(
  entries: readonly ParagraphEntry[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    if (entry === undefined) break;
    if (entry.properties.inTable !== true) {
      blocks.push(entry.paragraph);
      index += 1;
      continue;
    }
    const { runEntries, nextIndex } = collectTableRun(entries, index);
    const table = tryAssembleTable(runEntries);
    blocks.push(
      ...(table !== undefined
        ? [table]
        : runEntries.map((run) => run.paragraph)),
    );
    index = nextIndex;
  }
  return blocks;
}

// Collects one contiguous run of table-depth-1 paragraphs -- up to but not including the first entry that has left the table -- refusing a nested table (table depth greater than 1) immediately, since that is a genuinely unimplemented feature this reader cannot represent at all, unlike the TAP-resolution gaps tryAssembleTable degrades around below. Boundary detection lives here, once, so a row this reader ends up unable to resolve still degrades to flat paragraphs across the SAME span a successfully parsed table would have occupied, rather than needing its own separate boundary logic.
function collectTableRun(
  entries: readonly ParagraphEntry[],
  start: number,
): { runEntries: ParagraphEntry[]; nextIndex: number } {
  const runEntries: ParagraphEntry[] = [];
  let index = start;
  while (index < entries.length) {
    const entry = entries[index];
    if (entry?.properties.inTable !== true) break;
    if (
      (entry.properties.tableDepth !== undefined &&
        entry.properties.tableDepth > 1) ||
      entry.properties.nestedTableMark === true
    ) {
      throw new DocUnsupportedError(
        "doc-codec does not support a table nested inside a table cell (table depth greater than 1)",
      );
    }
    runEntries.push(entry);
    index += 1;
  }
  return { runEntries, nextIndex: index };
}

// Attempts to fold one contiguous run of table-depth paragraphs into a real ContentTable, per [MS-DOC] 2.4.3's own Overview of Tables: cell boundaries at each cell mark, a row closed by its own row-ending mark whose TAP (tap.ts's applyTableSprms) supplies the row's column layout and every physical cell's merge state. Returns undefined -- never throws -- when a row's own TAP cannot be resolved this way, rather than refusing the whole document: a real producer's own row mark can state its TAP indirectly (sprmPTableProps pointing at a PrcData of incremental sprmT* operations, [MS-DOC] 2.4.3's own worked example) rather than through the direct sprmTDefTable this reader follows, or a row's cell marks can simply not agree with what its TAP declares -- both genuinely legal constructs this reader does not implement, exactly the "reads with fewer properties than it states" degrade the README's scope table already documents for an indirect Papx elsewhere in this package, not corruption. The run's own paragraphs read as paragraphs instead, the same as any other property this reader does not convert. A row ending mid-cell with no terminating mark at all, by contrast, is genuine corruption (the stream itself is truncated, not merely using an unsupported mechanism) and still throws.
function tryAssembleTable(
  runEntries: readonly ParagraphEntry[],
): ContentTable | undefined {
  const rawRows: RawCell[][] = [];
  const rowDefinitions: TableRowDefinition[] = [];
  const rowHeights: (number | undefined)[] = [];

  let cellParagraphs: ContentParagraph[] = [];
  let rowCells: { blocks: ContentBlock[] }[] = [];

  for (const entry of runEntries) {
    cellParagraphs.push(entry.paragraph);

    if (entry.properties.tableRowEnd === true) {
      const rowProperties = applyTableSprms(entry.grpprl, {});
      const definition = rowProperties.definition;
      if (definition === undefined) return undefined;
      if (rowCells.length !== definition.cells.length) return undefined;
      rawRows.push(
        rowCells.map((cell, cellIndex): RawCell => {
          const merge = definition.cells[cellIndex];
          if (merge === undefined) {
            throw new DocFormatError(
              `internal defect: table row cell ${cellIndex} has no TAP merge entry despite the length check above`,
            );
          }
          return {
            horzMerge: merge.horzMerge,
            vertMerge: merge.vertMerge,
            borders: merge.borders,
            clearedSides: merge.clearedSides,
            background: merge.background,
            blocks: cell.blocks,
          };
        }),
      );
      rowDefinitions.push(definition);
      rowHeights.push(rowProperties.heightPt);
      rowCells = [];
      cellParagraphs = [];
      continue;
    }

    if (entry.terminator === CELL_MARK) {
      // An ordinary cell mark -- not the row's own -- closes the cell that was accumulating: everything from the last cell (or row) boundary up to and including this paragraph.
      rowCells.push({ blocks: cellParagraphs });
      cellParagraphs = [];
    }
  }

  if (cellParagraphs.length > 0 || rowCells.length > 0) {
    throw new DocFormatError(
      "a table's paragraphs end without a row-ending mark to close the row's last cell",
    );
  }

  const toleranceTwips = effectiveColumnBoundaryTolerance(rowDefinitions);
  const columnBoundariesTwips = canonicalColumnBoundariesTwips(
    rowDefinitions,
    toleranceTwips,
  );
  const cascadedRows = applyRowLevelBorderCascade(
    rawRows,
    rowDefinitions,
    columnBoundariesTwips,
    toleranceTwips,
  );
  return {
    kind: "table",
    rows: buildRows(
      cascadedRows,
      rowDefinitions,
      columnBoundariesTwips,
      rowHeights,
      toleranceTwips,
    ),
    columnWidthsPt: columnWidthsFromBoundaries(columnBoundariesTwips),
  };
}

// [MS-DOC] 2.6.3's own sprmTTableBorders/sprmTTableBorders80: "specifies the borders for this row unless modified by other Sprms applied to the cells" -- an explicit, order-independent fallback beneath TC80's own per-cell Brc80 (sprmTDefTable) and sprmTSetBrc/sprmTSetBrc80's exact-colour and palette-indexed overrides, all already folded into each RawCell's own borders by tap.ts's ordinary last-Prl-wins pass by the time this runs (see tap.ts's own top-of-file note on why the cascade itself is captured, unresolved, there rather than applied there). Applied here, once every row of the table is known, because which of a row's own six TableBordersOperand fields reaches a given cell depends on the cell's position in the WHOLE table: brcTop only for the table's own first row; brcBottom for a cell reaching the table's real bottom edge through one of the two paths this cascade actually checks -- the table's own last physical row directly, or an earlier row's vertically-merged anchor whose own continuation chain reaches a cell physically sitting in that last row -- justified by [MS-DOC] 2.4.3's own Overview of Tables, whose Figure 2 caption states that "the vertically merged cells act as one cell", which is precisely why the group's real bottom edge, not each physical row's own, is where brcBottom belongs (ExaDev/documents.js#945's own follow-up fix; see cascadeRowBorders' own note below for the full mechanism); brcLeft/brcRight only for a row's own first/last physical cell; and brcHorizontalInside/brcVerticalInside for every interior edge -- exactly the ECMA-376 tblBorders/tcBorders precedence [MS-DOC]'s own Overview of Tables (2.4.3) defers to ("To determine which borders are displayed, see the following sections from [ECMA-376] Part 1: Section 17.4.66 tcBorders (Table Cell Borders), Section 17.4.39 tblBorders (Table Border Exceptions), Section 17.4.38 tblBorders (Table Borders)").
//
// A genuine format-level ambiguity remains for TC80 alone: its own Brc80 fields are mandatory for every physical cell, so a cell whose own TC80 states "no border" on a side (the all-bits-set Brc80MayBeNil sentinel, or a real producer's own BrcType 0x00) is byte-for-byte indistinguishable from a cell whose TC80 was never touched at all -- there is no way to tell "this cell's TC80 explicitly punches a hole in the row's cascade" from "this cell defers to it" from TC80's bytes alone. Neither sprmTSetBrc's nor sprmTSetBrc80's own explicit clear is part of that ambiguity: naming a side with a NilBrc/NilBrc80 is an unambiguous, out-of-band statement, tap.ts's applyBrcToCell records it on RawCell.clearedSides rather than folding it indistinguishably into RawCell.borders, and cascadeRowBorders below never re-fills a side that set names. What this cascade actually fills, then, is every side that is BOTH absent from a cell's own resolved borders (RawCell.borders) and not in its clearedSides -- the correct, common-case behaviour ExaDev/documents.js#945 exists to fix (a table decorated purely through the row-level cascade now reads with the borders it actually shows).
//
// TC80's own byte-level ambiguity is not, however, the only remaining case this cascade can get wrong -- it is the only one that is a genuine ambiguity in the FORMAT itself, the same kind of narrow, inherent physical-model limit the README's own Tables section already documents for a table-wide merge or a shared leading indent. [MS-DOC] 2.6.3 also defines sprmTCellBrcType (0xD662, a TCellBrcTypeOperand -- one BrcType byte per side for each of a row's leading cells) and the sprmTBrcTopCv/sprmTBrcLeftCv/sprmTBrcBottomCv/sprmTBrcRightCv family (0xD61A-0xD61D, each a BrcCvOperand -- one exact COLORREF per cell for that one side, an all-bits-set entry stating "there is no corresponding border" for that cell), neither of which this reader reads at all. Both are capable of making the identical unambiguous "this side has a border"/"this side has none" statement sprmTSetBrc/80's own NilBrc(80) already makes -- TCellBrcTypeOperand names a side's BrcType 0x00 directly, and a BrcCvOperand's own all-bits-set COLORREF sentinel is the identical "no corresponding border" statement, just per side rather than per cell range -- so a producer stating a cell's border (or its explicit absence) through either of these sprms, rather than through TC80/sprmTSetBrc/sprmTSetBrc80, has that statement silently overwritten by this cascade exactly as if the cell had never mentioned the side at all. This is a genuine reader gap, not a format ambiguity: unlike TC80's own case, the bytes here are not ambiguous, this reader simply does not look at them.
//
// Resolved on the table's own shared grid (canonicalBoundariesTwips/toleranceTwips -- computed by tryAssembleTable before this runs, precisely so this cascade can tell a vertically-merged anchor's real bottom row apart from its own physical row; see this module's own top-of-file note) rather than on each row's raw physical cells alone. Grid position and vertMerge state are both read straight off RawCell before any border is resolved, so computing this "pre-cascade" logical view first is safe: it depends on nothing cascadeRowBorders below is about to fill in.
function applyRowLevelBorderCascade(
  rows: readonly (readonly RawCell[])[],
  definitions: readonly TableRowDefinition[],
  canonicalBoundariesTwips: readonly number[],
  toleranceTwips: number,
): RawCell[][] {
  const lastRowIndex = rows.length - 1;
  const lastRowBorders = definitions[lastRowIndex]?.rowBorders;
  const logicalRows = rows.map((row, rowIndex): LogicalCell[] => {
    const definition = definitions[rowIndex];
    if (definition === undefined) {
      throw new DocFormatError(
        `internal defect: table row ${rowIndex} has no TAP definition despite the earlier length check`,
      );
    }
    return logicalCellsForRow(
      row,
      definition.columnBoundariesTwips,
      canonicalBoundariesTwips,
      toleranceTwips,
    );
  });
  return rows.map((cells, rowIndex) => {
    const rowBorders = definitions[rowIndex]?.rowBorders;
    if (rowBorders === undefined) return [...cells];
    const rowBoundariesTwips = definitions[rowIndex]?.columnBoundariesTwips;
    return cascadeRowBorders(
      cells,
      rowBorders,
      lastRowBorders,
      rowIndex === 0,
      rowIndex,
      lastRowIndex,
      rowBoundariesTwips,
      canonicalBoundariesTwips,
      toleranceTwips,
      logicalRows,
    );
  });
}

// One row's own physical cells against its own rowBorders: brcLeft/brcRight land on the row's own first/last physical cell (which, since a physical cell's own boundaries always span from the table's left edge to its right edge regardless of any merge within the row, always IS the row's own outer edge); brcTop lands on every cell when this is the table's first row; and brcHorizontalInside/brcVerticalInside land everywhere else. brcBottom is the one field NOT drawn from this row's own rowBorders: [MS-DOC] 2.9.302's own field text is explicit that brcBottom "specifies the bottom border of the row, if it is the last row in the table" -- a row's own brcBottom describes the table's true bottom edge only when that row genuinely IS the table's last physical row, so this always reads it off lastRowBorders (the table's real last row's own TableBordersOperand), never off rowBorders (this row's own), even when this row happens to be the one being cascaded (the two are then the identical value). A cell gets that value whenever it reaches the table's real bottom edge through one of the two paths cellReachesTableBottom checks -- the table's own last physical row directly, or a vertically-merged anchor whose own continuation chain reaches into it -- resolved on the vertical axis by walking that chain rather than by checking the row's own index alone, justified by [MS-DOC] 2.4.3's own Overview of Tables, whose Figure 2 caption states that "the vertically merged cells act as one cell": the group's real bottom edge, not each physical row's own, is where brcBottom belongs. Walking the chain is what lets a vertically-merged anchor reach the table's real bottom edge even when the anchor's own physical row is not the table's last one -- the bug ExaDev/documents.js#945's own follow-up fixes, since a merge anchor sitting in a non-final row previously always got that row's insideHorizontal border on its bottom side (and, even once that much was fixed, still its own row's brcBottom rather than the table's real last row's, which [MS-DOC] 2.9.302's own text never licenses for a non-final row), and the continuation cell that actually sits in the table's last row has its own decoration dropped by buildRows regardless (a vertical-merge continuation is `{blocks: []}` by the shared schema's own convention), so the table's real bottom border was never carried by anything in the output at all. "Last physical cell" is resolved the same way on the horizontal axis, through any trailing sprmTMerge/TCGRF.horzMerge continuation cells (isRightmostPhysicalCell), so a legacy-encoded horizontal merge's own anchor still reaches the row's real right edge; this package's own writer states a horizontal merge as a genuinely narrower, wider physical cell instead, for which physicalIndex === cells.length - 1 already holds directly. A side in the cell's own clearedSides is left out of `sides` entirely regardless of what the cascade would otherwise supply -- an explicit sprmTSetBrc/sprmTSetBrc80 clear always wins, exactly as tap.ts's own applyBrcToCell states it should (ExaDev/documents.js#945).
function cascadeRowBorders(
  cells: readonly RawCell[],
  rowBorders: TableBordersSet,
  lastRowBorders: TableBordersSet | undefined,
  isFirstRow: boolean,
  rowIndex: number,
  lastRowIndex: number,
  rowBoundariesTwips: readonly number[] | undefined,
  canonicalBoundariesTwips: readonly number[],
  toleranceTwips: number,
  logicalRows: readonly (readonly LogicalCell[])[],
): RawCell[] {
  return cells.map((cell, cellIndex): RawCell => {
    const isFirstCell = cellIndex === 0;
    const isLastCell = isRightmostPhysicalCell(cells, cellIndex);
    const isLastRow = cellReachesTableBottom(
      cell,
      cellIndex,
      rowIndex,
      lastRowIndex,
      rowBoundariesTwips,
      canonicalBoundariesTwips,
      toleranceTwips,
      logicalRows,
    );
    const sides: Record<CellBorderSide, ContentBorder | undefined> = {
      top: cell.clearedSides?.has("top")
        ? undefined
        : (cell.borders?.top ??
          (isFirstRow ? rowBorders.top : rowBorders.insideHorizontal)),
      left: cell.clearedSides?.has("left")
        ? undefined
        : (cell.borders?.left ??
          (isFirstCell ? rowBorders.left : rowBorders.insideVertical)),
      bottom: cell.clearedSides?.has("bottom")
        ? undefined
        : (cell.borders?.bottom ??
          (isLastRow ? lastRowBorders?.bottom : rowBorders.insideHorizontal)),
      right: cell.clearedSides?.has("right")
        ? undefined
        : (cell.borders?.right ??
          (isLastCell ? rowBorders.right : rowBorders.insideVertical)),
    };
    return {
      ...cell,
      borders: cellBordersFrom(sides),
      clearedSides: undefined,
    };
  });
}

// Whether one row's own physical cell's visual bottom edge is the table's real bottom edge: true directly when this IS the table's own last row, and true for a vertically-merged anchor sitting in an earlier row whenever its own vertMerge continuation chain -- walked on the table's shared grid by vertMergeChainLastRow, the identical matching buildRows' own rowSpan computation performs -- reaches a continuation cell physically sitting in the table's last row. A horzMerge-continuation or vertMerge-continuation physical cell's own answer is never actually observed downstream (logicalCellsForRow folds a horzMerge continuation into its anchor's span without consulting this cell's own borders at all, and buildRows drops a vertMerge continuation's own borders unconditionally -- see cascadeRowBorders' own note), so grid-index resolution for either is never asked to be more than merely non-throwing.
function cellReachesTableBottom(
  cell: RawCell,
  cellIndex: number,
  rowIndex: number,
  lastRowIndex: number,
  rowBoundariesTwips: readonly number[] | undefined,
  canonicalBoundariesTwips: readonly number[],
  toleranceTwips: number,
  logicalRows: readonly (readonly LogicalCell[])[],
): boolean {
  if (rowIndex === lastRowIndex) return true;
  if (cell.vertMerge === VERT_MERGE_CONTINUATION) return false;
  const left = rowBoundariesTwips?.[cellIndex];
  if (left === undefined) {
    throw new DocFormatError(
      "a table row's own column-boundary array has fewer entries than its physical cell count requires",
    );
  }
  const startGridIndex = gridIndexFor(
    canonicalBoundariesTwips,
    left,
    toleranceTwips,
  );
  return (
    vertMergeChainLastRow(logicalRows, rowIndex, startGridIndex) ===
    lastRowIndex
  );
}

function isRightmostPhysicalCell(
  cells: readonly RawCell[],
  index: number,
): boolean {
  for (let cursor = index + 1; cursor < cells.length; cursor += 1) {
    if (cells[cursor]?.horzMerge !== HORZ_MERGE_CONTINUATION) return false;
  }
  return true;
}

// The table's own shared column grid, reconstructed as the union of every row's own rgdxaCenter boundary values rather than assumed from any single row -- see this module's own top-of-file note on why a merged row's own boundaries are a genuine subset of the table's full grid, not the whole thing. The union is taken within isSameColumnBoundary's own tolerance rather than by exact integer equality: [MS-DOC] states each row's boundaries independently, so two rows meaning the identical grid can differ by a twip or two without either being wrong, and an exact union would turn that drift into a phantom hairline column plus a spurious colSpan on every row (ExaDev/documents.js#898). Sorting before clustering makes the result depend only on the boundary values themselves, never on which row happened to be read first -- unlike LibreOffice's own insertion-ordered fuzzy set -- and taking each cluster's smallest member as its representative keeps the canonical array non-decreasing and anchored on the leftmost row's own left edge.
function canonicalColumnBoundariesTwips(
  definitions: readonly TableRowDefinition[],
  toleranceTwips: number,
): number[] {
  const sorted = definitions
    .flatMap((definition) => definition.columnBoundariesTwips)
    .sort((left, right) => left - right);
  const canonical: number[] = [];
  for (const boundary of sorted) {
    const representative = canonical[canonical.length - 1];
    if (
      representative === undefined ||
      !isSameColumnBoundary(representative, boundary, toleranceTwips)
    ) {
      canonical.push(boundary);
    }
  }
  return canonical;
}

// The index of the canonical grid boundary one row's own raw boundary belongs to. A raw boundary need not appear in the canonical array at all once boundaries are clustered, so this snaps rather than looks up. The first match is always its own cluster's: canonicalColumnBoundariesTwips opens a new canonical entry only beyond the tolerance, so consecutive canonical entries are further apart than it, and every canonical entry below the one this boundary was absorbed into is therefore further than the tolerance from it. Finding no match at all cannot happen for a boundary that went into building the grid -- which is every boundary this is ever asked about -- so it is an internal invariant, not a malformed-input case.
function gridIndexFor(
  canonicalBoundariesTwips: readonly number[],
  boundary: number,
  toleranceTwips: number,
): number {
  const index = canonicalBoundariesTwips.findIndex((candidate) =>
    isSameColumnBoundary(candidate, boundary, toleranceTwips),
  );
  if (index === -1) {
    throw new DocFormatError(
      `internal defect: a table row's column boundary ${String(boundary)} matches no boundary on the table's own reconstructed grid, which was built from that boundary among others`,
    );
  }
  return index;
}

function columnWidthsFromBoundaries(boundaries: readonly number[]): number[] {
  const widths: number[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const left = boundaries[index];
    const right = boundaries[index + 1];
    if (left === undefined || right === undefined) continue;
    widths.push((right - left) / TWIPS_PER_POINT);
  }
  return widths;
}

/** One row's own physical cell, already resolved to its position and span on the table's shared canonical grid (canonicalColumnBoundariesTwips) rather than a raw physical-array index -- the position two rows can actually be compared by, since they may have genuinely different physical cell counts (see this module's own top-of-file note). */
interface LogicalCell {
  readonly startGridIndex: number;
  readonly colSpan: number;
  readonly vertMerge: number;
  readonly borders: ContentCellBorders | undefined;
  readonly background: Color | undefined;
  readonly blocks: ContentBlock[];
}

// Folds one row's own raw physical cells into LogicalCell entries positioned on the table's shared canonical grid: a run of this writer's own legacy TCGRF.horzMerge continuation cells is folded into its preceding anchor exactly as buildRows always did (each contributing exactly one grid segment, since that encoding never widens a physical cell's own boundaries), and -- the case #895 exists for -- a single physical cell whose own boundaries already span more than one canonical grid segment (a real producer's genuinely narrower, wider physical cell, no flag involved) resolves to a colSpan greater than 1 directly from those boundaries. Both mechanisms produce the identical LogicalCell shape, so buildRows handles every row uniformly regardless of which one produced it. An orphaned continuation cell with no anchor before it (malformed input) is skipped rather than treated as its own anchor, mirroring this function's own pre-existing behaviour.
function logicalCellsForRow(
  cells: readonly RawCell[],
  rowBoundariesTwips: readonly number[],
  canonicalBoundariesTwips: readonly number[],
  toleranceTwips: number,
): LogicalCell[] {
  const logical: LogicalCell[] = [];
  let physicalIndex = 0;
  while (physicalIndex < cells.length) {
    const cell = cells[physicalIndex];
    if (cell === undefined) break;
    if (cell.horzMerge === HORZ_MERGE_CONTINUATION) {
      physicalIndex += 1;
      continue;
    }
    let consumed = 1;
    while (
      cells[physicalIndex + consumed]?.horzMerge === HORZ_MERGE_CONTINUATION
    ) {
      consumed += 1;
    }
    const left = rowBoundariesTwips[physicalIndex];
    const right = rowBoundariesTwips[physicalIndex + consumed];
    if (left === undefined || right === undefined) {
      throw new DocFormatError(
        "a table row's own column-boundary array has fewer entries than its physical cell count requires",
      );
    }
    const startGridIndex = gridIndexFor(
      canonicalBoundariesTwips,
      left,
      toleranceTwips,
    );
    const endGridIndex = gridIndexFor(
      canonicalBoundariesTwips,
      right,
      toleranceTwips,
    );
    logical.push({
      startGridIndex,
      // A physical cell whose own boundaries snap to one canonical entry covers no segment of the shared grid at all. That is a legal cell, not corruption: [MS-DOC] 2.9.321 requires rgdxaCenter only to be "in non-decreasing order", so two adjacent entries may be equal (a genuine zero-width cell) or -- now that the union snaps -- within the tolerance of each other. ContentTableCell has no way to say "zero columns wide", so such a cell is carried with its content as an ordinary un-spanned cell, and the cell following it keeps its own start index rather than being displaced by a span this one never occupied.
      colSpan:
        endGridIndex > startGridIndex ? endGridIndex - startGridIndex : 1,
      vertMerge: cell.vertMerge,
      // A horizontal-merge group's decoration is the anchor's own: [MS-DOC] renders a continuation cell's contents and formatting not at all ("its contents and formatting are not applied", sprmTMerge), so the anchor's Brc80s and Shd are what the merged region actually shows.
      borders: cell.borders,
      background: cell.background,
      blocks: cell.blocks,
    });
    physicalIndex += consumed;
  }
  return logical;
}

// The last row index a vertical-merge chain, anchored at (rowIndex, startGridIndex) on the table's own shared grid, actually reaches: walking forward through subsequent rows' own LogicalCell at the identical grid position for as long as each one keeps stating VERT_MERGE_CONTINUATION there, and returning rowIndex itself for an anchor with no continuation following it (a chain of length one). Grid position, never a raw physical-array index, is what two rows are matched by, because two rows may genuinely have different physical cell counts (a horizontal merge in one row and not the other) and still need their vertical merges to line up correctly. Shared by buildRows' own rowSpan computation and cascadeRowBorders' own bottom-edge determination (via cellReachesTableBottom) above -- both need to know which physical row a vertically-merged anchor's own bottom edge actually falls in, one to count how many rows it spans, the other to decide whether that edge is the table's real bottom border or an interior one.
function vertMergeChainLastRow(
  logicalRows: readonly (readonly LogicalCell[])[],
  rowIndex: number,
  startGridIndex: number,
): number {
  let lastRow = rowIndex;
  for (let r = rowIndex + 1; r < logicalRows.length; r += 1) {
    const below = logicalRows[r]?.find(
      (candidate) => candidate.startGridIndex === startGridIndex,
    );
    if (below?.vertMerge !== VERT_MERGE_CONTINUATION) break;
    lastRow = r;
  }
  return lastRow;
}

// Folds each row's LogicalCell list into the shared schema's own anchor-carries-the-span convention: a vertical-continuation cell is kept as its own `{blocks: []}` entry, mirroring ooxml.js's own docx table reader, which the shared schema's colSpan/rowSpan fields were designed to hold either format's cousin of. rowSpan is matched by each cell's own startGridIndex on the canonical grid, never a raw physical-array position, because two rows may genuinely have different physical cell counts (a horizontal merge in one row and not the other) and still need their vertical merges to line up correctly.
function buildRows(
  rawRows: readonly RawCell[][],
  rowDefinitions: readonly TableRowDefinition[],
  canonicalBoundariesTwips: readonly number[],
  rowHeights: readonly (number | undefined)[],
  toleranceTwips: number,
): ContentTableRow[] {
  const logicalRows = rawRows.map((row, rowIndex): LogicalCell[] => {
    const definition = rowDefinitions[rowIndex];
    if (definition === undefined) {
      throw new DocFormatError(
        `internal defect: table row ${rowIndex} has no TAP definition despite the earlier length check`,
      );
    }
    return logicalCellsForRow(
      row,
      definition.columnBoundariesTwips,
      canonicalBoundariesTwips,
      toleranceTwips,
    );
  });

  return logicalRows.map((row, rowIndex): ContentTableRow => {
    const cells: ContentTableCell[] = [];
    for (const cell of row) {
      const colSpan = cell.colSpan > 1 ? cell.colSpan : undefined;
      if (cell.vertMerge === VERT_MERGE_CONTINUATION) {
        // A vertical continuation combined with a horizontal merge in the same row still carries its own colSpan, so a later write (whose own active-merge tracking otherwise trusts the anchor's span, never a continuation's own) still has it if this row is ever read back on its own. Its own decoration is deliberately dropped rather than carried: the merged region renders the anchor's, and a continuation cell is `{blocks: []}` by the shared schema's own convention -- giving it a background or borders would make it indistinguishable from a real, decorated, genuinely blank cell on the way back out.
        cells.push({ blocks: [], colSpan });
        continue;
      }
      const lastRowInChain = vertMergeChainLastRow(
        logicalRows,
        rowIndex,
        cell.startGridIndex,
      );
      const rowSpan = lastRowInChain - rowIndex + 1;
      cells.push({
        blocks: cell.blocks,
        colSpan,
        rowSpan: rowSpan > 1 ? rowSpan : undefined,
        background: cell.background,
        borders: cell.borders,
      });
    }
    const heightPt = rowHeights[rowIndex];
    return heightPt !== undefined ? { cells, heightPt } : { cells };
  });
}
