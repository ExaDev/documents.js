import type {
  ContentBlock,
  ContentParagraph,
  ContentRun,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";
import { DocFormatError, DocUnsupportedError } from "../errors";
import { fitsAloneOnPapxPage } from "../prop/fkp-write";
import { CELL_MARK, PARAGRAPH_MARK } from "../text/special";
import {
  encodeTableRowGrpprl,
  MAX_TABLE_ROW_CELLS,
  type TableCellToWrite,
} from "./tap-write";

/** Reports a non-fatal write-time degradation -- this package's own analogue of byte-codec's/pdf-codec's `onWarning`, adopted here rather than a new shape of its own so a caller already handling one already handles the other. */
export type WriteWarning = (message: string) => void;

// The inverse of table/read.ts: a section's own ContentBlock list to the flat sequence of paragraphs writeDocContent's own text-layout pass consumes, expanding each ContentTable into its real [MS-DOC] physical-cell stream. Each ContentTableCell -- real content or a vertical-merge continuation's own `{blocks: []}` -- becomes ONE physical cell ending in its own cell mark exactly as [MS-DOC] 2.4.3 requires, in the ordinary case: a horizontally-merged (colSpan > 1) cell is not expanded into extra synthetic continuation cells, because a real, independent [MS-DOC] implementation (LibreOffice 26.2.5.2) was confirmed not to read a horizontal merge back from TCGRF.horzMerge/sprmTMerge continuation cells at all -- it states one purely as a row's own narrower, wider physical-cell layout (ExaDev/documents.js#895; see tap-write.ts's own top-of-file note for the full ground-truth finding). flattenRow instead merges the table-wide column grid's own boundaries across a cell's colSpan to compute that one physical cell's width, so the row's own rgdxaCenter genuinely has fewer entries than the table's full column count whenever a merge is present, matching the merge-encoding strategy LibreOffice's own writer uses -- not its bytes, which still differ in what the row mark carries beyond the facts both state (this writer emits no cell padding, cell spacing or table-style sprm, and no legacy Shd80 array). Each ContentTableCell's own background and borders ride along to tap-write.ts, which states them the same two ways that implementation does -- TC80's own Brc80 fields plus a sprmTSetBrc for a colour the Brc80 palette cannot hold, and a sprmTDefTableShd array of one Shd per cell. A vertical-merge continuation cell is never inferred from a bare `{blocks: []}` alone -- a genuinely blank cell has the identical shape -- so flattenTable tracks which columns carry a vertical merge actually in progress (an `active` map keyed by column position, walked top to bottom exactly as ooxml.js's own buildTable tracks its identical `active` map), and only a `{blocks: []}` cell landing on a column with a merge genuinely active there becomes a continuation; every other cell, blank or not, is ordinary. The same map supplies a continuation's own physical column span from the anchor's recorded span, since the continuation cell's own (typically absent) colSpan is never the source of truth for it. Every physical cell's own grpprl carries sprmPFInTable; the row's own trailing mark additionally carries sprmPFTtp plus the row's whole TAP (tap-write.ts's encodeTableRowGrpprl).
//
// The one exception to "one physical cell per ContentTableCell" is the lost-boundary fallback (ExaDev/documents.js#992): table/read.ts reconstructs the table's shared column grid as the union of every row's own physical boundaries, so a boundary every row happens to merge across identically is never stated anywhere and cannot be recovered -- the simplest case is a single-row table with one merged cell, which by definition has no other row to compare against. `recoverableBoundaries` computes, before any row is flattened, exactly which of the table's own internal grid boundaries at least one row's ordinary (un-split) physical layout would state; every boundary outside that set is one no row would otherwise reveal at all. `distributeLostBoundaries` then assigns each lost boundary to exactly one row, round-robin, rather than to every row that crosses it (that function's own note has the full reasoning: every row crosses a lost boundary by definition, so any one of them can state it, and spreading the work keeps a wide, uniformly-merged table's own rows under the format's per-row size ceiling). `splitAtLostBoundaries` then breaks a cell's span at the boundaries its OWN row was assigned -- and only those -- into extra physical sub-cells: the first carries the cell's real content and decoration exactly as before, every further sub-cell is an empty TCGRF.horzMerge continuation ([MS-DOC] 2.9.317's own TCGRF: horzMerge value 1, "the cell is one of a set of horizontally merged cells. It contributes its layout region to the set and its own contents are not rendered"), so the boundary is physically present in that row's own rgdxaCenter without changing what the table renders as. A boundary some other row already states, or that this particular row was not assigned, is left exactly as flattenRow always encoded it -- unsplit, via the narrower/wider physical-cell layout above -- so the fallback changes nothing for the common case a real producer's own table already exercises (see the "narrows columnWidthsPt" test's replacement in write.test.ts for the fixed round trip, and the README's own Tables section for the third-party-fidelity trade-off this fallback makes only for the rows it actually applies to).

/** sprmPFInTable (0x2416): a Bool8, "MUST be 1 any time the table depth is greater than zero". */
const SPRM_P_F_IN_TABLE = 0x2416;
/** sprmPFTtp (0x2417): a Bool8 marking a cell mark as the row's own Table Terminating Paragraph mark. */
const SPRM_P_F_TTP = 0x2417;

const TWIPS_PER_POINT = 20;

export interface WriteParagraph {
  readonly runs: readonly ContentRun[];
  readonly properties: Pick<
    ContentParagraph,
    | "alignment"
    | "indentLeftPt"
    | "indentFirstLinePt"
    | "spacingBeforePt"
    | "spacingAfterPt"
    | "lineSpacing"
    | "pageBreakBefore"
  >;
  /** Extra grpprl bytes appended after encodeParagraphGrpprl's own output -- sprmPFInTable on every table paragraph, plus sprmPFTtp and the row's own TAP on a row's trailing mark. */
  readonly extraGrpprl: readonly number[];
  /** The character terminating this paragraph in the text stream: PARAGRAPH_MARK normally, CELL_MARK for a table cell or row mark. */
  readonly terminator: number;
}

function pushSprm(
  bytes: number[],
  opcode: number,
  operand: readonly number[],
): void {
  bytes.push(opcode & 0xff, (opcode >> 8) & 0xff, ...operand);
}

function inTableGrpprl(): number[] {
  const bytes: number[] = [];
  pushSprm(bytes, SPRM_P_F_IN_TABLE, [0x01]);
  return bytes;
}

// The row's own trailing mark: sprmPFInTable (every table paragraph carries it), sprmPFTtp (marking this one as the row's own Table Terminating Paragraph mark), then the row's whole TAP (sprmTDefTable, and a row height if it has one) -- an ordinary merge needs no separate horizontal-merge signal, since flattenRow's own physical-cell boundaries already state it the way a real [MS-DOC] producer does, and the lost-boundary fallback's own TCGRF.horzMerge rides in `cellsToWrite` itself rather than as an extra grpprl entry here (see this module's own top-of-file note).
function rowMarkExtraGrpprl(
  boundaries: readonly number[],
  cellsToWrite: readonly TableCellToWrite[],
  heightPt: number | undefined,
): number[] {
  const bytes = inTableGrpprl();
  pushSprm(bytes, SPRM_P_F_TTP, [0x01]);
  bytes.push(...encodeTableRowGrpprl(boundaries, cellsToWrite, heightPt));
  return bytes;
}

// A cell's own paragraphs as WriteParagraph entries: every paragraph but the last terminates with an ordinary paragraph mark (a multi-paragraph cell), the last with a cell mark -- [MS-DOC] 2.4.3's "the last paragraph in a table cell is terminated by a cell mark". An empty cell (the shared schema's vertical-merge-continuation convention, `blocks: []`) still needs the one paragraph [MS-DOC] requires to carry its own cell mark.
function cellParagraphs(blocks: readonly ContentBlock[]): WriteParagraph[] {
  if (blocks.length === 0) {
    return [
      {
        runs: [],
        properties: {},
        extraGrpprl: inTableGrpprl(),
        terminator: CELL_MARK,
      },
    ];
  }
  return blocks.map((block, index): WriteParagraph => {
    if (block.kind !== "paragraph") {
      throw new DocUnsupportedError(
        `doc-codec's writer does not support a '${block.kind}' block inside a table cell (only paragraphs are; nested tables are a separately-tracked gap -- see the README's scope note)`,
      );
    }
    return {
      runs: block.runs,
      properties: block,
      extraGrpprl: inTableGrpprl(),
      terminator: index === blocks.length - 1 ? CELL_MARK : PARAGRAPH_MARK,
    };
  });
}

function columnBoundariesTwips(columnWidthsPt: readonly number[]): number[] {
  const boundaries: number[] = [0];
  let cumulative = 0;
  for (const widthPt of columnWidthsPt) {
    cumulative += widthPt * TWIPS_PER_POINT;
    boundaries.push(cumulative);
  }
  return boundaries;
}

/** A vertical merge genuinely in progress at a given column: the anchor's own physical column span (so a continuation's column count comes from the anchor, never from the continuation cell's own usually-absent colSpan), and how many further rows it still covers. */
interface ActiveVerticalMerge {
  span: number;
  remaining: number;
}

/** A deep copy of `active` -- a fresh Map holding a fresh object per entry, never the same ActiveVerticalMerge instances. flattenTable's own per-row budget check (see its own note below) has to try flattening a row's lost-boundary split as a dry run before committing to it, and placeCell mutates `covered.remaining` on the object a Map entry already holds -- a shallow copy would let that dry run's own mutation bleed into the real, committed state for every row after it. */
function cloneActive(
  active: ReadonlyMap<number, ActiveVerticalMerge>,
): Map<number, ActiveVerticalMerge> {
  return new Map(
    Array.from(active, ([column, merge]) => [column, { ...merge }]),
  );
}

/** Where one logical cell lands on the row's own grid, before any lost-boundary splitting: its span in grid columns, and whether it is a vertical-merge continuation of a cell above. `active`'s own cross-row state must evolve identically wherever this runs, since recoverableBoundaries and flattenRow each walk every row with their own fresh map and have to land on the same columns for the second pass's splitting decisions to mean anything. */
function placeCell(
  cell: ContentTableCell,
  column: number,
  active: Map<number, ActiveVerticalMerge>,
): { span: number; isContinuation: boolean } {
  const covered = active.get(column);
  const isContinuation =
    cell.blocks.length === 0 && covered !== undefined && covered.remaining > 0;
  if (isContinuation) {
    covered.remaining -= 1;
    return { span: covered.span, isContinuation: true };
  }
  const span = cell.colSpan ?? 1;
  const rowSpan = cell.rowSpan ?? 1;
  if (rowSpan > 1) {
    active.set(column, { span, remaining: rowSpan - 1 });
  }
  return { span, isContinuation: false };
}

// Every internal grid-column index (1..columnCount-1) that at least one row's own ordinary, unsplit physical layout would state on its own -- exactly the boundaries table/read.ts's union-based reconstruction could recover without this module's own lost-boundary fallback. A vertical-merge continuation row states the identical boundaries its anchor did (via placeCell's own `covered.span`), which is correct: the same physical columns are what a continuation row's own cells actually occupy, so it contributes the same evidence a plain unmerged row would.
function recoverableBoundaries(rows: readonly ContentTableRow[]): Set<number> {
  const stated = new Set<number>();
  const active = new Map<number, ActiveVerticalMerge>();
  for (const row of rows) {
    let column = 0;
    for (const cell of row.cells) {
      const { span } = placeCell(cell, column, active);
      column += span;
      stated.add(column);
    }
  }
  return stated;
}

// Assigns each of the table's own lost boundaries (recoverableBoundaries' own complement) to exactly one row, round-robin, rather than to every row: a boundary is only ever "lost" because every row of the table merges across it identically (recoverableBoundaries' own definition), so by construction every row's own cells already cross it and any one of them can be the row that states it -- there is no row this could pick that would be structurally wrong. Cycling through the table's own rows one boundary at a time keeps each row's own count of assigned boundaries to roughly (lost boundary count / row count), which is what makes a wide, uniformly-merged table writable at all: splitting every row at every lost boundary, this function's own original #992 behaviour, makes every row pay the full column count regardless of how many rows exist to share the work, which alone can exceed a single PapxInFkp's own 510-byte GrpPrlAndIstd ceiling (see the README's "about 22 columns" note) even though no individual row needed to state more than a handful of boundaries. A single-row table still pays the full cost, since there is only one row to assign any boundary to at all -- the format's own per-row ceiling is unavoidable there, not a further gap this function could close.
function distributeLostBoundaries(
  lostBoundaries: readonly number[],
  rowCount: number,
): Set<number>[] {
  const perRow = Array.from({ length: rowCount }, () => new Set<number>());
  lostBoundaries.forEach((boundary, index) => {
    const bucket = perRow[index % rowCount];
    if (bucket === undefined) {
      throw new DocFormatError(
        "internal defect: distributeLostBoundaries built fewer row buckets than the row count it was given",
      );
    }
    bucket.add(boundary);
  });
  return perRow;
}

// Splits one logical cell's own [column, column + span) grid range into the physical sub-spans its row must actually carry: a break at every boundary strictly inside the range that `lostBoundaries` names, so a boundary this row was assigned to state (distributeLostBoundaries) stays physically present in it (ExaDev/documents.js#992). A range crossing no lost boundary this row was assigned -- because it crosses none at all, or because another row was assigned the ones it does cross -- returns as its own single sub-span unchanged, the encoding this writer always used before #992 and still the only one an ordinary merge (recoverable via some other row) ever needs.
function splitAtLostBoundaries(
  column: number,
  span: number,
  lostBoundaries: ReadonlySet<number>,
): number[] {
  const subSpans: number[] = [];
  let start = column;
  for (let position = column + 1; position < column + span; position += 1) {
    if (lostBoundaries.has(position)) {
      subSpans.push(position - start);
      start = position;
    }
  }
  subSpans.push(column + span - start);
  return subSpans;
}

// Expands one output row's own cells (colSpan-anchored; a vertical continuation is a bare `{blocks: []}`, disambiguated from a genuinely blank cell by whether `active` shows a merge actually in progress at this column -- see this module's own top-of-file note) into the row's real physical-cell stream: ordinarily exactly ONE physical cell per ContentTableCell, its own boundary computed by merging the table-wide grid's boundary points across the cell's colSpan -- except at a boundary `lostBoundaries` names, where the cell is split into extra physical sub-cells so that boundary stays physically present in this row too (see this module's own top-of-file note on why, and ExaDev/documents.js#992). Mutates `active` as it walks the row, exactly as ooxml.js's own buildTable does for the identical disambiguation.
function flattenRow(
  cells: readonly ContentTableCell[],
  columnCount: number,
  boundaries: readonly number[],
  active: Map<number, ActiveVerticalMerge>,
  lostBoundaries: ReadonlySet<number>,
): {
  paragraphs: WriteParagraph[];
  cellsToWrite: TableCellToWrite[];
  rowBoundariesTwips: number[];
} {
  const paragraphs: WriteParagraph[] = [];
  const cellsToWrite: TableCellToWrite[] = [];
  const firstBoundary = boundaries[0];
  if (firstBoundary === undefined) {
    throw new DocFormatError(
      "internal defect: a table's own column-boundary array is empty despite the columnCount guard above",
    );
  }
  const rowBoundariesTwips: number[] = [firstBoundary];
  let column = 0;
  for (const cell of cells) {
    const startColumn = column;
    const { span, isContinuation } = placeCell(cell, startColumn, active);
    const rowSpan = cell.rowSpan ?? 1;
    const vertMerge: TableCellToWrite["vertMerge"] = isContinuation
      ? 1
      : rowSpan > 1
        ? 3
        : 0;
    const blocks = isContinuation ? [] : cell.blocks;

    const subSpans = splitAtLostBoundaries(startColumn, span, lostBoundaries);
    subSpans.forEach((subSpan, subIndex) => {
      paragraphs.push(...cellParagraphs(subIndex === 0 ? blocks : []));
      // A vertical-merge continuation states no decoration of its own: [MS-DOC] renders the anchor's, and table/read.ts drops a continuation's own on the way in for the same reason, so writing this cell's (typically absent) background/borders would be inventing a fact the round trip cannot preserve. A lost-boundary continuation sub-cell (subIndex > 0) is the identical case one level down: [MS-DOC] 2.9.317's own TCGRF states that a horzMerge continuation cell's "own contents are not rendered", so it carries neither.
      cellsToWrite.push(
        subIndex === 0
          ? isContinuation
            ? { vertMerge, horzMerge: subSpans.length > 1 ? 2 : 0 }
            : {
                vertMerge,
                horzMerge: subSpans.length > 1 ? 2 : 0,
                borders: cell.borders,
                background: cell.background,
              }
          : { vertMerge, horzMerge: 1 },
      );
      column += subSpan;
      const rightBoundary = boundaries[column];
      if (rightBoundary === undefined) {
        throw new DocFormatError(
          `a table cell's own colSpan runs past the table's ${columnCount}-column grid`,
        );
      }
      rowBoundariesTwips.push(rightBoundary);
    });
  }
  if (column !== columnCount) {
    throw new DocFormatError(
      `a table row's own cells cover ${column} columns (via colSpan), but the table declares ${columnCount} in columnWidthsPt`,
    );
  }
  return { paragraphs, cellsToWrite, rowBoundariesTwips };
}

// Builds the row-ending mark's own WriteParagraph from a flattened row's own three products (see flattenRow), the one shape both the ordinary path and the per-row budget fallback below need.
function rowMarkParagraph(
  rowBoundariesTwips: readonly number[],
  cellsToWrite: readonly TableCellToWrite[],
  heightPt: number | undefined,
): WriteParagraph {
  return {
    runs: [],
    properties: {},
    extraGrpprl: rowMarkExtraGrpprl(rowBoundariesTwips, cellsToWrite, heightPt),
    terminator: CELL_MARK,
  };
}

// Whether a candidate lost-boundary split -- a subset of a row's own assigned boundaries, tried on a throwaway clone of `active` so a rejected candidate cannot leak its placeCell mutations anywhere -- can actually be written for this row: both the format's own hard ceiling on physical cells per row (MAX_TABLE_ROW_CELLS, [MS-DOC] 2.4.3's "between 1 and 63 table cells") and the row-ending mark's own PapxInFkp byte budget (fitsAloneOnPapxPage). The cell-count check runs first and returns false directly, entirely so this never calls rowMarkExtraGrpprl (and, through it, encodeTableRowGrpprl) with a cell count past that ceiling: that function throws unconditionally there for every OTHER caller, since the row actually committed has a genuine internal defect if it ever produces one, but a split this wide is only ever a spending trial here and must be treated as "doesn't fit" so the caller can keep trimming, not crash (ExaDev/documents.js#992). A split that clears the cell-count check almost always still has to clear the byte budget too -- 63 physical cells alone costs far more than any row-ending mark's own ~487-byte allowance -- so the two checks are cheap-first, not redundant.
function rowSplitFits(
  row: ContentTableRow,
  columnCount: number,
  boundaries: readonly number[],
  active: ReadonlyMap<number, ActiveVerticalMerge>,
  candidateBoundaries: ReadonlySet<number>,
  heightPt: number | undefined,
): boolean {
  const trial = flattenRow(
    row.cells,
    columnCount,
    boundaries,
    cloneActive(active),
    candidateBoundaries,
  );
  if (trial.cellsToWrite.length > MAX_TABLE_ROW_CELLS) return false;
  const trialGrpprl = rowMarkExtraGrpprl(
    trial.rowBoundariesTwips,
    trial.cellsToWrite,
    heightPt,
  );
  return fitsAloneOnPapxPage(trialGrpprl);
}

function flattenTable(
  table: ContentTable,
  onWarning: WriteWarning | undefined,
): WriteParagraph[] {
  const columnCount = table.columnWidthsPt.length;
  if (columnCount === 0 || table.rows.length === 0) {
    throw new DocFormatError(
      "a table must have at least one column and one row to write",
    );
  }
  const boundaries = columnBoundariesTwips(table.columnWidthsPt);
  const stated = recoverableBoundaries(table.rows);
  const lostBoundaries: number[] = [];
  for (let index = 1; index < columnCount; index += 1) {
    if (!stated.has(index)) lostBoundaries.push(index);
  }
  const lostBoundariesByRow = distributeLostBoundaries(
    lostBoundaries,
    table.rows.length,
  );
  const active = new Map<number, ActiveVerticalMerge>();
  const output: WriteParagraph[] = [];
  table.rows.forEach((row, rowIndex) => {
    const rowLostBoundaries = lostBoundariesByRow[rowIndex];
    if (rowLostBoundaries === undefined) {
      throw new DocFormatError(
        "internal defect: distributeLostBoundaries returned fewer buckets than the table has rows",
      );
    }
    // The row's own assigned split (ExaDev/documents.js#992) can itself overflow either of two ceilings on a table wide enough, or short enough on rows to share the work with: this row-ending mark's own PapxInFkp byte budget, and the format's own hard 63-physical-cell-per-row limit -- splitting states more of the table's own lost boundaries in physical form than #992's own fix ever needed to. rowSplitFits tries a candidate split against both without duplicating fkp-write.ts's own page-packing arithmetic or encodeTableRowGrpprl's own cell-count check as a second, driftable copy of either here.
    let rowLostBoundariesToApply = rowLostBoundaries;
    if (
      rowLostBoundaries.size > 0 &&
      !rowSplitFits(
        row,
        columnCount,
        boundaries,
        active,
        rowLostBoundaries,
        row.heightPt,
      )
    ) {
      // The row's own full assigned split doesn't fit. Rather than drop every one of its assigned boundaries -- this fallback's own original, all-or-nothing behaviour -- trim it down: `rowLostBoundaries` is a Set whose insertion order tracks distributeLostBoundaries' own ascending boundary order, so dropping from the end drops the row's highest-valued (and, since #992's own round-robin assignment is otherwise arbitrary, no more or less significant) boundaries first. The loop below is an exhaustive downward scan trying every prefix length in turn, not a binary search over boundary count, because a downward scan finds the true largest fitting prefix by construction regardless of whether fitting behaves monotonically as boundaries are dropped -- it never has to assume monotonicity to be correct, only to try every candidate in order. The record's own encoded byte size genuinely isn't monotonic in how many boundaries a split states: dropping one boundary always removes exactly one physical cell -- 22 bytes (a 2-byte rgdxaCenter boundary plus its cell's own 20-byte TC80, tap-write.ts's own per-column cost) -- but it also shifts every later cell's index down by one, and tap-write.ts's shadingPrls packs a row's shading into one DefTableShdOperand per 22-cell window whose rgShd array runs from the window's own first cell up to its last SHADED cell; shifting a shaded cell out of the cheap head of one window and into the tail of the previous window forces that window's own array to stretch across up to all 22 of its cells (SHD_SIZE, 10 bytes each) to reach it, up to 210 bytes where before that cell needed only its own single 10-byte entry -- net worst case, -22 bytes from the removed cell against +210 bytes from the shifted shading array, is +188 bytes LARGER for removing a boundary. That jump can never actually reach a candidate this loop accepts, though: the second shading window's own first cell (tap-write.ts's SHD_ARRAYS, `first: 22`) only exists once a row holds at least 23 physical cells, and 23 cells alone -- with no shading, no exact-colour border overrides, no row height, nothing but the bare sprmTDefTable -- already cost 15 fixed bytes (sprmPFInTable+sprmPFTtp+sprmTDefTable's own opcode/cb/istd) plus 22 bytes per cell: 15+22*23 = 521 bytes, 34 bytes past the 487-byte grpPrlAndIstd ceiling a lone paragraph can claim (fitsAloneOnPapxPage) before a single shading byte is even counted. Every byte this format can add past that bare minimum only grows the record further, so no 23-cell-or-wider candidate can ever fit no matter how its shading falls, and rowSplitFits rejects it on cell count and base size alone long before the cross-window shift above could matter -- the non-monotonicity is real, but it lives entirely past the cell count any row within this budget can reach, so the scan below never needs to worry it will stop on a candidate a larger, skipped-past one would also have fit.
      const ordered = Array.from(rowLostBoundaries);
      let kept = ordered;
      while (
        kept.length > 0 &&
        !rowSplitFits(
          row,
          columnCount,
          boundaries,
          active,
          new Set(kept),
          row.heightPt,
        )
      ) {
        kept = kept.slice(0, -1);
      }
      // A row that still will not fit even fully unsplit (kept.length === 0) is not this fallback's concern: it throws exactly the DocFormatError it always has, from the real buildPapxPages call in write.ts, for the same "row is too wide or too decorated" reason #992 never touched.
      rowLostBoundariesToApply = new Set(kept);
      const droppedCount = ordered.length - kept.length;
      onWarning?.(
        kept.length === 0
          ? `doc-codec: table row ${rowIndex} could not state ${rowLostBoundaries.size === 1 ? "its assigned lost column boundary" : `any of its ${rowLostBoundaries.size} assigned lost column boundaries`} without exceeding a PapxInFkp record's own byte budget or the format's own ${MAX_TABLE_ROW_CELLS}-cell-per-row ceiling; writing it unsplit instead, which narrows columnWidthsPt on read for this table exactly as this writer's own pre-#992 behaviour did`
          : `doc-codec: table row ${rowIndex} could only state ${kept.length} of its ${ordered.length} assigned lost column boundaries without exceeding a PapxInFkp record's own byte budget or the format's own ${MAX_TABLE_ROW_CELLS}-cell-per-row ceiling; dropping the other ${droppedCount} (narrowing columnWidthsPt on read for those boundaries alone)`,
      );
    }
    const { paragraphs, cellsToWrite, rowBoundariesTwips } = flattenRow(
      row.cells,
      columnCount,
      boundaries,
      active,
      rowLostBoundariesToApply,
    );
    output.push(...paragraphs);
    output.push(
      rowMarkParagraph(rowBoundariesTwips, cellsToWrite, row.heightPt),
    );
  });
  return output;
}

// Flattens a section's whole block list into the paragraph sequence writeDocContent's own text-layout pass consumes: an ordinary paragraph passes through as one WriteParagraph, a table expands into its own real cell/row-mark stream. `onWarning`, when given, is reported a message for a non-fatal write-time degradation -- today, only flattenTable's own per-row lost-boundary-budget fallback (see its own note).
export function flattenSectionBlocks(
  blocks: readonly ContentBlock[],
  onWarning?: WriteWarning,
): WriteParagraph[] {
  const output: WriteParagraph[] = [];
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      output.push({
        runs: block.runs,
        properties: block,
        extraGrpprl: [],
        terminator: PARAGRAPH_MARK,
      });
      continue;
    }
    if (block.kind === "table") {
      output.push(...flattenTable(block, onWarning));
      continue;
    }
    throw new DocUnsupportedError(
      `doc-codec's writer does not yet support '${block.kind}' blocks (see README's scope note)`,
    );
  }
  return output;
}
