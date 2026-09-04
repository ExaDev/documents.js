import type {
  ContentBlock,
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
import { CELL_MARK } from "../text/special";

// Groups the flat paragraph-entry sequence read.ts produces into the final ContentBlock list, folding every contiguous run of table-depth-1 paragraphs into a real ContentTable with row/cell/merge structure -- [MS-DOC] 2.4.3's own Overview of Tables model: a table is a run of paragraphs each marked sprmPFInTable, cells delimited by cell-mark (0x07) characters (a cell holding more than one paragraph ends every paragraph but its last with an ordinary 0x0D mark), and each row closed by a row-ending mark of its own (sprmPFTtp, itself a 0x07 mark) that carries the row's TAP -- its column layout and every physical cell's own horizontal/vertical merge state, resolved by tap.ts. A non-table entry passes through untouched. A run whose TAP this reader cannot resolve degrades to its own paragraphs rather than failing the whole document -- see tryAssembleTable's own note.
//
// Column layout is derived per row, never assumed shared: [MS-DOC] 2.6.4 permits each row of a table to declare its own independent rgdxaCenter, and a real, independent [MS-DOC] implementation (LibreOffice 26.2.5.2) was confirmed to rely on exactly this for a horizontal merge -- a merged row's own TDefTableOperand simply has fewer, wider physical cells, with no TCGRF.horzMerge or sprmTMerge signal at all (ExaDev/documents.js#895; see table/write.ts's own top-of-file note for the full ground-truth finding). buildRows below reconstructs the table's shared grid as the union of every row's own column boundaries -- taken within one point rather than by exact integer equality, since rows stating the identical grid independently may legally disagree by a twip or two (see isSameColumnBoundary's own note) -- then expresses each physical cell's own colSpan as however many of that shared grid's segments its own boundaries cover -- folding in this writer's own legacy TCGRF.horzMerge-flagged continuation cells (a spec-conformant encoding this reader still honours, in case a genuine third-party producer uses it) exactly as before. A column boundary that no row in the table ever states on its own -- every row happens to merge across it identically -- cannot be recovered from the physical bytes at all; this is a real limitation of [MS-DOC]'s own physical model, not an approximation this reader is choosing to make (see the README's own note on this).

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
  return {
    kind: "table",
    rows: buildRows(
      rawRows,
      rowDefinitions,
      columnBoundariesTwips,
      rowHeights,
      toleranceTwips,
    ),
    columnWidthsPt: columnWidthsFromBoundaries(columnBoundariesTwips),
  };
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
      blocks: cell.blocks,
    });
    physicalIndex += consumed;
  }
  return logical;
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
        // A vertical continuation combined with a horizontal merge in the same row still carries its own colSpan, so a later write (whose own active-merge tracking otherwise trusts the anchor's span, never a continuation's own) still has it if this row is ever read back on its own.
        cells.push({ blocks: [], colSpan });
        continue;
      }
      let rowSpan = 1;
      for (let r = rowIndex + 1; r < logicalRows.length; r += 1) {
        const below = logicalRows[r]?.find(
          (candidate) => candidate.startGridIndex === cell.startGridIndex,
        );
        if (below?.vertMerge !== VERT_MERGE_CONTINUATION) break;
        rowSpan += 1;
      }
      cells.push({
        blocks: cell.blocks,
        colSpan,
        rowSpan: rowSpan > 1 ? rowSpan : undefined,
      });
    }
    const heightPt = rowHeights[rowIndex];
    return heightPt !== undefined ? { cells, heightPt } : { cells };
  });
}
