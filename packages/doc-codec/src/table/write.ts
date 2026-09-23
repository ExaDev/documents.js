import {
  describeTableGridFault,
  findTableGridFault,
  tableCellColumnSpan,
  tableCellRowSpan,
  walkTableGrid,
  type ContentBlock,
  type ContentImageBlock,
  type ContentParagraph,
  type ContentRun,
  type ContentTable,
  type ContentTableCell,
  type TableGridPosition,
} from "document-schema.js";
import { type DataStreamBuilder } from "../data-stream";
import { DocFormatError, DocUnsupportedError } from "../errors";
import { buildInlinePicture } from "../pictures-write";
import { fitsAloneOnPapxPage } from "../prop/fkp-write";
import {
  FIELD_BEGIN,
  FIELD_END,
  FIELD_SEPARATOR,
  INLINE_PICTURE,
  CELL_MARK,
  PARAGRAPH_MARK,
  SECTION_MARK,
} from "../text/special";
import {
  encodeTableRowGrpprl,
  MAX_TABLE_ROW_CELLS,
  type TableCellToWrite,
} from "./tap-write";

/** Reports a non-fatal write-time degradation — this package's own analogue of byte-codec's/pdf-codec's `onWarning`, adopted here rather than a new shape of its own so a caller already handling one already handles the other. */
export type WriteWarning = (message: string) => void;

// The inverse of table/read.ts: a section's own ContentBlock list to the flat sequence of paragraphs writeDocContent's own text-layout pass consumes, expanding each ContentTable into its real [MS-DOC] physical-cell stream. The table's dense rows (ContentTableCell's grid rule: one entry per grid column, a merged region's anchor plus a block-less entry at every other position it covers) are classified by walkTableGrid, and each anchor becomes ONE physical cell ending in its own cell mark exactly as [MS-DOC] 2.4.3 requires, in the ordinary case: the entries a horizontally-merged (colSpan > 1) anchor covers along its own row contribute no physical cells of their own, and the anchor is not expanded into extra synthetic continuation cells, because a real, independent [MS-DOC] implementation (LibreOffice 26.2.5.2) was confirmed not to read a horizontal merge back from TCGRF.horzMerge/sprmTMerge continuation cells at all — it states one purely as a row's own narrower, wider physical-cell layout (ExaDev/documents.js#895; see tap-write.ts's own top-of-file note for the full ground-truth finding). flattenRow instead merges the table-wide column grid's own boundaries across an anchor's colSpan to compute that one physical cell's width, so the row's own rgdxaCenter genuinely has fewer entries than the table's full column count whenever a merge is present, matching the merge-encoding strategy LibreOffice's own writer uses — not its bytes, which still differ in what the row mark carries beyond the facts both state (this writer emits no cell padding, cell spacing or table-style sprm, and no legacy Shd80 array). Each ContentTableCell's own background and borders ride along to tap-write.ts, which states them the same two ways that implementation does — TC80's own Brc80 fields plus a sprmTSetBrc for a colour the Brc80 palette cannot hold, and a sprmTDefTableShd array of one Shd per cell. A vertical-merge continuation is never inferred from a bare `{blocks: []}` alone — a genuinely blank cell has the identical shape — but from walkTableGrid's derivation that the position lies inside a region anchored in an earlier row; the adjacent positions one anchor covers in a row become one continuation physical cell as wide as that region, and a covered entry's own blocks and decoration are ignored, since they belong to the anchor. Every physical cell's own grpprl carries sprmPFInTable; the row's own trailing mark additionally carries sprmPFTtp plus the row's whole TAP (tap-write.ts's encodeTableRowGrpprl).
//
// The one exception to "one physical cell per ContentTableCell" is the lost-boundary fallback (ExaDev/documents.js#992): table/read.ts reconstructs the table's shared column grid as the union of every row's own physical boundaries, so a boundary every row happens to merge across identically is never stated anywhere and cannot be recovered — the simplest case is a single-row table with one merged cell, which by definition has no other row to compare against. `recoverableBoundaries` computes, before any row is flattened, exactly which of the table's own internal grid boundaries at least one row's ordinary (un-split) physical layout would state; every boundary outside that set is one no row would otherwise reveal at all. `distributeLostBoundaries` then assigns each lost boundary to exactly one row, round-robin, rather than to every row that crosses it (that function's own note has the full reasoning: every row crosses a lost boundary by definition, so any one of them can state it, and spreading the work keeps a wide, uniformly-merged table's own rows under the format's per-row size ceiling). `splitAtLostBoundaries` then breaks a cell's span at the boundaries its OWN row was assigned — and only those — into extra physical sub-cells: the first carries the cell's real content and decoration exactly as before, every further sub-cell is an empty TCGRF.horzMerge continuation ([MS-DOC] 2.9.317's own TCGRF: horzMerge value 1, "the cell is one of a set of horizontally merged cells. It contributes its layout region to the set and its own contents are not rendered"), so the boundary is physically present in that row's own rgdxaCenter without changing what the table renders as. A boundary some other row already states, or that this particular row was not assigned, is left exactly as flattenRow always encoded it — unsplit, via the narrower/wider physical-cell layout above — so the fallback changes nothing for the common case a real producer's own table already exercises (see the "narrows the table's columns" test's replacement in write.test.ts for the fixed round trip, and the README's own Tables section for the third-party-fidelity trade-off this fallback makes only for the rows it actually applies to).

/** sprmPFInTable (0x2416): a Bool8, "MUST be 1 any time the table depth is greater than zero". */
const SPRM_P_F_IN_TABLE = 0x2416;
/** sprmPFTtp (0x2417): a Bool8 marking a cell mark as the row's own Table Terminating Paragraph mark. */
const SPRM_P_F_TTP = 0x2417;

const TWIPS_PER_POINT = 20;

// sprmCFSpec (0x0855, ispmd 0x55 / sgc 2 / spra 0) with its 1-byte toggle operand set: the mark that tells a consumer a run's characters are special rather than glyphs — applied to the field characters (0x13/0x14/0x15) this module injects, exactly as [MS-DOC] 2.6.1's own sprmCFSpec entry enumerates them. Byte layout is the sprm's little-endian opcode followed by the operand, the same pushSprm layout chp-write.ts uses internally.
const FSPEC_GRPPRL: readonly number[] = [0x55, 0x08, 0x01];

/** One run to write, alongside grpprl bytes appended after encodeCharacterGrpprl's own output for it — the run-level analogue of WriteParagraph.extraGrpprl below. Every ordinary run carries none (its whole grpprl comes from its own ContentRun fields); imageParagraph's own picture-anchor run is the one exception, since sprmCPicLocation is not a ContentRun field encodeCharacterGrpprl could ever derive on its own. */
export interface WriteRun {
  readonly run: ContentRun;
  readonly extraGrpprl: readonly number[];
}

function plainRuns(runs: readonly ContentRun[]): WriteRun[] {
  const output: WriteRun[] = [];
  // The URI of the field whose result runs are accumulating in `field`, undefined while no field is open — consecutive runs sharing one hyperlink join a single field, a run whose hyperlink differs closes the open one and opens its own, and a run carrying none can never sit inside another's result.
  let openUri: string | undefined;
  let field: WriteRun[] = [];
  // A run carrying a hyperlink is the result half of a HYPERLINK field: [MS-DOC] 2.8.25's field characters (0x13/0x14/0x15) around the instruction ` HYPERLINK "<uri>" ` and the visible result, the exact spelling a real producer writes (confirmed against LibreOffice 26.2's own Word 97 export: 0x13, the instruction text, 0x14, the result runs, 0x15).
  const closeField = (): void => {
    if (openUri === undefined) return;
    output.push(
      {
        run: { text: String.fromCharCode(FIELD_BEGIN) },
        extraGrpprl: FSPEC_GRPPRL,
      },
      { run: { text: ` HYPERLINK "${openUri}" ` }, extraGrpprl: [] },
      {
        run: { text: String.fromCharCode(FIELD_SEPARATOR) },
        extraGrpprl: FSPEC_GRPPRL,
      },
      ...field,
      {
        run: { text: String.fromCharCode(FIELD_END) },
        extraGrpprl: FSPEC_GRPPRL,
      },
    );
  };
  for (const run of runs) {
    if (run.hyperlink !== openUri) {
      closeField();
      openUri = run.hyperlink;
      field = [];
    }
    if (run.hyperlink === undefined) {
      output.push({ run, extraGrpprl: [] });
      continue;
    }
    field.push({ run, extraGrpprl: [] });
  }
  closeField();
  return output;
}

export interface WriteParagraph {
  readonly runs: readonly WriteRun[];
  readonly properties: Pick<
    ContentParagraph,
    | "alignment"
    | "indentLeftPt"
    | "indentRightPt"
    | "indentFirstLinePt"
    | "spacingBeforePt"
    | "spacingAfterPt"
    | "lineSpacing"
    | "pageBreakBefore"
    | "list"
    | "styleId"
    | "headingLevel"
  >;
  /** Extra grpprl bytes appended after encodeParagraphGrpprl's own output — sprmPFInTable on every table paragraph, plus sprmPFTtp and the row's own TAP on a row's trailing mark. */
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

// The row's own trailing mark: sprmPFInTable (every table paragraph carries it), sprmPFTtp (marking this one as the row's own Table Terminating Paragraph mark), then the row's whole TAP (sprmTDefTable, and a row height if it has one) — an ordinary merge needs no separate horizontal-merge signal, since flattenRow's own physical-cell boundaries already state it the way a real [MS-DOC] producer does, and the lost-boundary fallback's own TCGRF.horzMerge rides in `cellsToWrite` itself rather than as an extra grpprl entry here (see this module's own top-of-file note).
function rowMarkExtraGrpprl(
  boundaries: readonly number[],
  cellsToWrite: readonly TableCellToWrite[],
  heightPt: number | undefined,
  isHeader: boolean,
): number[] {
  const bytes = inTableGrpprl();
  pushSprm(bytes, SPRM_P_F_TTP, [0x01]);
  bytes.push(
    ...encodeTableRowGrpprl(boundaries, cellsToWrite, heightPt, isHeader),
  );
  return bytes;
}

// A cell's own paragraphs as WriteParagraph entries: every paragraph but the last terminates with an ordinary paragraph mark (a multi-paragraph cell), the last with a cell mark — [MS-DOC] 2.4.3's "the last paragraph in a table cell is terminated by a cell mark". An empty cell (the shared schema's vertical-merge-continuation convention, `blocks: []`) still needs the one paragraph [MS-DOC] requires to carry its own cell mark.
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
        `doc-codec's writer does not support a '${block.kind}' block inside a table cell (only paragraphs are; nested tables are a separately-tracked gap — see the README's scope note)`,
      );
    }
    return {
      runs: plainRuns(block.runs),
      properties: block,
      extraGrpprl: inTableGrpprl(),
      terminator: index === blocks.length - 1 ? CELL_MARK : PARAGRAPH_MARK,
    };
  });
}

function columnBoundariesTwips(widthsPt: readonly number[]): number[] {
  const boundaries: number[] = [0];
  let cumulative = 0;
  for (const widthPt of widthsPt) {
    cumulative += widthPt * TWIPS_PER_POINT;
    boundaries.push(cumulative);
  }
  return boundaries;
}

/** One physical cell of a row, as [MS-DOC] states it: `span` grid columns wide, either the anchor of its own region (carrying the cell's content and decoration) or a vertical continuation of the anchor above it, whose `anchorColumn` names that anchor's own column. */
interface PhysicalCell {
  readonly span: number;
  readonly cell: ContentTableCell;
  readonly anchorColumn: number | undefined;
}

// One row's physical cells, derived from walkTableGrid's classification of its dense entries rather than from any state carried between rows: an anchor is one physical cell as wide as its colSpan, so the entries it covers along its own row collapse into it and contribute no physical cell of their own (the wider-cell encoding the note above describes), while the entries a region anchored in an earlier row covers become that region's vertical continuation — one physical cell per anchor however many adjacent columns it spans, since entries covered by the same anchor are adjacent in the row and two different anchors never share an anchor column. A covered entry may not carry blocks, since the region's content belongs to its anchor and would otherwise be silently lost; its own decoration is not written, for the same reason a continuation states none.
function physicalCellsForRow(
  positions: readonly TableGridPosition[],
  rowIndex: number,
): PhysicalCell[] {
  const physical: PhysicalCell[] = [];
  for (const position of positions) {
    if (position.anchorRowIndex === undefined) {
      physical.push({
        span: tableCellColumnSpan(position.cell),
        cell: position.cell,
        anchorColumn: undefined,
      });
      continue;
    }
    if (position.anchorRowIndex === rowIndex) continue;
    const previous = physical[physical.length - 1];
    if (previous?.anchorColumn === position.anchorColumnIndex) {
      physical[physical.length - 1] = { ...previous, span: previous.span + 1 };
      continue;
    }
    physical.push({
      span: 1,
      cell: position.cell,
      anchorColumn: position.anchorColumnIndex,
    });
  }
  return physical;
}

// Every internal grid-column index (1..columnCount-1) that at least one row's own ordinary, unsplit physical layout would state on its own — exactly the boundaries table/read.ts's union-based reconstruction could recover without this module's own lost-boundary fallback. A vertical-merge continuation states the identical boundaries its anchor did, which is correct: the same physical columns are what a continuation cell actually occupies, so it contributes the same evidence a plain unmerged row would.
function recoverableBoundaries(
  rows: readonly (readonly PhysicalCell[])[],
): Set<number> {
  const stated = new Set<number>();
  for (const row of rows) {
    let column = 0;
    for (const { span } of row) {
      column += span;
      stated.add(column);
    }
  }
  return stated;
}

// Assigns each of the table's own lost boundaries (recoverableBoundaries' own complement) to exactly one row, round-robin, rather than to every row: a boundary is only ever "lost" because every row of the table merges across it identically (recoverableBoundaries' own definition), so by construction every row's own cells already cross it and any one of them can be the row that states it — there is no row this could pick that would be structurally wrong. Cycling through the table's own rows one boundary at a time keeps each row's own count of assigned boundaries to roughly (lost boundary count / row count), which is what makes a wide, uniformly-merged table writable at all: splitting every row at every lost boundary, this function's own original #992 behaviour, makes every row pay the full column count regardless of how many rows exist to share the work, which alone can exceed a single PapxInFkp's own 510-byte GrpPrlAndIstd ceiling (see the README's own 15 + 22 × columns <= 487 arithmetic, which gives 21 columns as the exact per-row ceiling) even though no individual row needed to state more than a handful of boundaries. A single-row table still pays the full cost, since there is only one row to assign any boundary to at all — the format's own per-row ceiling is unavoidable there, not a further gap this function could close.
/** distributeLostBoundaries's own internal-defect message: `perRow` is built with exactly `rowCount` buckets, so an index derived from `index % rowCount` can never miss one — exported only so this exact wording is directly testable (a literal-equality check against a hardcoded duplicate) without needing to actually trigger the throw, which nothing reachable through the public write path ever can. */
export const DISTRIBUTE_LOST_BOUNDARIES_FEWER_BUCKETS_MESSAGE =
  "internal defect: distributeLostBoundaries built fewer row buckets than the row count it was given";

function distributeLostBoundaries(
  lostBoundaries: readonly number[],
  rowCount: number,
): Set<number>[] {
  const perRow = Array.from({ length: rowCount }, () => new Set<number>());
  lostBoundaries.forEach((boundary, index) => {
    const bucket = perRow[index % rowCount];
    if (bucket === undefined) {
      throw new DocFormatError(
        DISTRIBUTE_LOST_BOUNDARIES_FEWER_BUCKETS_MESSAGE,
      );
    }
    bucket.add(boundary);
  });
  return perRow;
}

// Splits one logical cell's own [column, column + span) grid range into the physical sub-spans its row must actually carry: a break at every boundary strictly inside the range that `lostBoundaries` names, so a boundary this row was assigned to state (distributeLostBoundaries) stays physically present in it (ExaDev/documents.js#992). A range crossing no lost boundary this row was assigned — because it crosses none at all, or because another row was assigned the ones it does cross — returns as its own single sub-span unchanged, the encoding this writer always used before #992 and still the only one an ordinary merge (recoverable via some other row) ever needs.
function splitAtLostBoundaries(
  column: number,
  span: number,
  lostBoundaries: ReadonlySet<number>,
): number[] {
  const subSpans: number[] = [];
  let start = column;
  // Every column position across the cell's own span, column itself included rather than filtered out separately: length span (not span - 1) already leaves nothing to mutate arithmetically (it stops one short of column + span on its own, with no offset to shift), and column needs no exclusion of its own either, since it is always this row's own already-stated left edge (every cell's own left/right edge is trivially "recoverable" from its own row) and so can never itself be a member of lostBoundaries — checking it here answers `false` regardless, exactly as an excluded position would have.
  Array.from({ length: span }, (_ignored, index) => column + index).forEach(
    (position) => {
      if (lostBoundaries.has(position)) {
        subSpans.push(position - start);
        start = position;
      }
    },
  );
  subSpans.push(column + span - start);
  return subSpans;
}

/** flattenRow's own internal-defect message: `boundaries` always has at least one entry (columnBoundariesTwips always seeds it with 0), so `boundaries[0]` can never be undefined — exported only so this exact wording is directly testable via literal equality, without needing to actually trigger the throw. */
export const EMPTY_COLUMN_BOUNDARY_ARRAY_MESSAGE =
  "internal defect: a table's own column-boundary array is empty despite the columnCount guard above";

// Expands one row's physical cells (physicalCellsForRow) into the row's real physical-cell stream: ordinarily exactly ONE physical cell per PhysicalCell, its own boundary computed by merging the table-wide grid's boundary points across the cell's span — except at a boundary `lostBoundaries` names, where the cell is split into extra physical sub-cells so that boundary stays physically present in this row too (see this module's own top-of-file note on why, and ExaDev/documents.js#992). The row's spans must add up to the table's grid width: a row whose cells cover fewer or more columns than the table's own columns array declares is refused, whether that is a dense row of the wrong length or an anchor whose colSpan reaches past the last column.
function flattenRow(
  physicalCells: readonly PhysicalCell[],
  columnCount: number,
  boundaries: readonly number[],
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
    throw new DocFormatError(EMPTY_COLUMN_BOUNDARY_ARRAY_MESSAGE);
  }
  const rowBoundariesTwips: number[] = [firstBoundary];
  let column = 0;
  for (const physicalCell of physicalCells) {
    const startColumn = column;
    const { span, cell } = physicalCell;
    const isContinuation = physicalCell.anchorColumn !== undefined;
    const vertMerge: TableCellToWrite["vertMerge"] = isContinuation
      ? 1
      : tableCellRowSpan(cell) > 1
        ? 3
        : 0;
    const blocks = isContinuation ? [] : cell.blocks;

    const subSpans = splitAtLostBoundaries(startColumn, span, lostBoundaries);
    subSpans.forEach((subSpan, subIndex) => {
      // Writing `blocks` here for every subIndex rather than just the first could never be observed through any round trip either: logicalCellsForRow (table/read.ts) skips a physical cell whose own horzMerge === HORZ_MERGE_CONTINUATION entirely — its own `blocks` field is never even read, let alone surfaced — so a lost-boundary continuation sub-cell's own real content, however much of it there was, is discarded exactly as the decoration comment just below states for its borders and background.
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
      `a table row's own cells cover ${column} columns (via colSpan), but the table declares ${columnCount} columns`,
    );
  }
  return { paragraphs, cellsToWrite, rowBoundariesTwips };
}

// Builds the row-ending mark's own WriteParagraph from a flattened row's own three products (see flattenRow), the one shape both the ordinary path and the per-row budget fallback below need.
function rowMarkParagraph(
  rowBoundariesTwips: readonly number[],
  cellsToWrite: readonly TableCellToWrite[],
  heightPt: number | undefined,
  isHeader: boolean,
): WriteParagraph {
  return {
    runs: [],
    properties: {},
    extraGrpprl: rowMarkExtraGrpprl(
      rowBoundariesTwips,
      cellsToWrite,
      heightPt,
      isHeader,
    ),
    terminator: CELL_MARK,
  };
}

/** Whether a trial cell count already exceeds the format's own hard per-row ceiling (MAX_TABLE_ROW_CELLS, [MS-DOC] 2.4.3's "between 1 and 63 table cells"): exported so its own boundary (63 itself still fits, 64 does not) is directly testable, since no real trial from flattenTable's own splitting search ever reaches this ceiling in the first place — rowSplitFits' own note explains why — so nothing in a round-trip test ever observes `>` swapped for `>=` here. */
export function exceedsMaxTableRowCells(cellCount: number): boolean {
  return cellCount > MAX_TABLE_ROW_CELLS;
}

// Whether a candidate lost-boundary split — a subset of a row's own assigned boundaries, tried on a throwaway clone of `active` so a rejected candidate cannot leak its placeCell mutations anywhere — can actually be written for this row: both the format's own hard ceiling on physical cells per row (exceedsMaxTableRowCells) and the row-ending mark's own PapxInFkp byte budget (fitsAloneOnPapxPage). The cell-count check runs first and returns false directly, entirely so this never calls rowMarkExtraGrpprl (and, through it, encodeTableRowGrpprl) with a cell count past that ceiling: that function throws unconditionally there for every OTHER caller, since the row actually committed has a genuine internal defect if it ever produces one, but a split this wide is only ever a spending trial here and must be treated as "doesn't fit" so the caller can keep trimming, not crash (ExaDev/documents.js#992). A split that clears the cell-count check almost always still has to clear the byte budget too — 63 physical cells alone costs far more than any row-ending mark's own ~487-byte allowance — so the two checks are cheap-first, not redundant. (every physical cell costs a fixed 22 bytes, tap-write.ts's own rgdxaCenter-boundary-plus-TC80 figure, never lower whatever a cell's own decoration is, against fitsAloneOnPapxPage's 487-byte ceiling, so a trial ever reaching the 63-cell ceiling already costs 15 + 22 x 63 = 1401 bytes — and the smallest cell count the byte budget alone rejects, 23 (15 + 22 x 23 = 521), is already far below 63.)
function rowSplitFits(
  physicalCells: readonly PhysicalCell[],
  columnCount: number,
  boundaries: readonly number[],
  candidateBoundaries: ReadonlySet<number>,
  heightPt: number | undefined,
  isHeader: boolean,
): boolean {
  const trial = flattenRow(
    physicalCells,
    columnCount,
    boundaries,
    candidateBoundaries,
  );
  if (exceedsMaxTableRowCells(trial.cellsToWrite.length)) return false;
  const trialGrpprl = rowMarkExtraGrpprl(
    trial.rowBoundariesTwips,
    trial.cellsToWrite,
    heightPt,
    isHeader,
  );
  return fitsAloneOnPapxPage(trialGrpprl);
}

/** flattenTable's own internal-defect message: distributeLostBoundaries always returns exactly `table.rows.length` buckets, so indexing it by `rowIndex` while iterating one entry per table row can never miss one — exported only so this exact wording is directly testable via literal equality, without needing to actually trigger the throw. */
export const LOST_BOUNDARIES_FEWER_ROW_BUCKETS_MESSAGE =
  "internal defect: distributeLostBoundaries returned fewer buckets than the table has rows";

// A column's own isHeader (ContentTableColumn, document-schema.js, ExaDev/documents.js#1381) is reported through onWarning rather than written: [MS-DOC]'s own table grid ([MS-DOC] 2.9.328's TAP, and the rgdxaCenter boundaries every row states) has no element for a column repeating at the left of each printed page at all — unlike a row's own isHeader, which sprmTTableHeader states directly per row, there is no column-axis counterpart anywhere in the format's table vocabulary (ExaDev/documents.js#1398). The column's own cells are written exactly like any other column; only the flag itself is dropped. Reported once per flagged column, naming the table's own block index and the column's index, matching this function's own lost-boundary warnings below for the identical "doc-codec: table at block N, ..." wording convention.
function reportDroppedHeaderColumns(
  table: ContentTable,
  blockIndex: number,
  onWarning: WriteWarning | undefined,
): void {
  table.columns.forEach((column, columnIndex) => {
    if (column.isHeader === true) {
      onWarning?.(
        `doc-codec: table at block ${blockIndex}, column ${columnIndex} is a header column, and that is dropped; this format's table grid has no header-column marker, so the column is written exactly as any other`,
      );
    }
  });
}

function flattenTable(
  table: ContentTable,
  blockIndex: number,
  onWarning: WriteWarning | undefined,
): WriteParagraph[] {
  const columnCount = table.columns.length;
  if (columnCount === 0 || table.rows.length === 0) {
    throw new DocFormatError(
      "a table must have at least one column and one row to write",
    );
  }
  const gridFault = findTableGridFault(table);
  if (gridFault !== undefined) {
    throw new DocFormatError(
      `doc-codec: table at block ${blockIndex} breaks the grid rule: ${describeTableGridFault(gridFault)}`,
    );
  }
  reportDroppedHeaderColumns(table, blockIndex, onWarning);
  const boundaries = columnBoundariesTwips(table.columns.map((c) => c.widthPt));
  const physicalRows = walkTableGrid(table).map((positions, rowIndex) =>
    physicalCellsForRow(positions, rowIndex),
  );
  const heightsPt = table.rows.map((row) => row.heightPt);
  const headerFlags = table.rows.map((row) => row.isHeader === true);
  const stated = recoverableBoundaries(physicalRows);
  // Every internal boundary (1..columnCount - 1), by construction rather than by a loop condition a mutant could push one step past columnCount: `stated` always contains columnCount itself (every row's own last cell necessarily reaches it, the identical invariant flattenRow's own column !== columnCount check enforces below for every row that write ever reaches), so an off-by-one here would check `stated.has(columnCount)`, already always true.
  const lostBoundaries = Array.from(
    { length: columnCount - 1 },
    (_ignored, index) => index + 1,
  ).filter((index) => !stated.has(index));
  const lostBoundariesByRow = distributeLostBoundaries(
    lostBoundaries,
    table.rows.length,
  );
  const output: WriteParagraph[] = [];
  physicalRows.forEach((physicalCells, rowIndex) => {
    const heightPt = heightsPt[rowIndex];
    // The row's own sprmTTableHeader costs three bytes of the same PapxInFkp budget the split search below spends, so it is part of every trial rather than added after one was accepted.
    const isHeader = headerFlags[rowIndex] === true;
    const rowLostBoundaries = lostBoundariesByRow[rowIndex];
    if (rowLostBoundaries === undefined) {
      throw new DocFormatError(LOST_BOUNDARIES_FEWER_ROW_BUCKETS_MESSAGE);
    }
    // The row's own assigned split (ExaDev/documents.js#992) can itself overflow either of two ceilings on a table wide enough, or short enough on rows to share the work with: this row-ending mark's own PapxInFkp byte budget, and the format's own hard 63-physical-cell-per-row limit — splitting states more of the table's own lost boundaries in physical form than #992's own fix ever needed to. rowSplitFits tries a candidate split against both without duplicating fkp-write.ts's own page-packing arithmetic or encodeTableRowGrpprl's own cell-count check as a second, driftable copy of either here.
    let rowLostBoundariesToApply = rowLostBoundaries;
    if (
      rowLostBoundaries.size > 0 &&
      !rowSplitFits(
        physicalCells,
        columnCount,
        boundaries,
        rowLostBoundaries,
        heightPt,
        isHeader,
      )
    ) {
      // The row's own full assigned split doesn't fit. Rather than drop every one of its assigned boundaries — this fallback's own original, all-or-nothing behaviour — trim it down: `rowLostBoundaries` is a Set whose insertion order tracks distributeLostBoundaries' own ascending boundary order, so dropping from the end drops the row's highest-valued (and, since #992's own round-robin assignment is otherwise arbitrary, no more or less significant) boundaries first. The loop below is an exhaustive downward scan trying every prefix length in turn, not a binary search over boundary count, because a downward scan finds the true largest fitting prefix by construction regardless of whether fitting behaves monotonically as boundaries are dropped — it never has to assume monotonicity to be correct, only to try every candidate in order. The record's own encoded byte size genuinely isn't monotonic in how many boundaries a split states: dropping one boundary always removes exactly one physical cell — 22 bytes (a 2-byte rgdxaCenter boundary plus its cell's own 20-byte TC80, tap-write.ts's own per-column cost) — but it also shifts every later cell's index down by one, and tap-write.ts's shadingPrls packs a row's shading into one DefTableShdOperand per 22-cell window whose rgShd array runs from the window's own first cell up to its last SHADED cell; shifting a shaded cell out of the cheap head of one window and into the tail of the previous window forces that window's own array to stretch across up to all 22 of its cells (SHD_SIZE, 10 bytes each) to reach it, up to 210 bytes where before that cell needed only its own single 10-byte entry — net worst case, -22 bytes from the removed cell against +210 bytes from the shifted shading array, is +188 bytes LARGER for removing a boundary. That jump can never actually reach a candidate this loop accepts, though: the second shading window's own first cell (tap-write.ts's SHD_ARRAYS, `first: 22`) only exists once a row holds at least 23 physical cells, and 23 cells alone — with no shading, no exact-colour border overrides, no row height, nothing but the bare sprmTDefTable — already cost 15 fixed bytes (sprmPFInTable and sprmPFTtp at 3 bytes each, sprmTDefTable's own opcode and cb at 2 bytes each with no istd field of its own, TDefTableOperand's own NumberOfColumns byte and the extra (n+1)th rgdxaCenter boundary every row's TAP carries beyond the per-cell figure below, and GrpPrlAndIstd's own istd prefix that buildPapxPage adds ahead of any paragraph's grpprl) plus 22 bytes per cell: 15+22*23 = 521 bytes, 34 bytes past the 487-byte grpPrlAndIstd ceiling a lone paragraph can claim (fitsAloneOnPapxPage) before a single shading byte is even counted. Every byte this format can add past that bare minimum only grows the record further, so no 23-cell-or-wider candidate can ever fit no matter how its shading falls, and rowSplitFits rejects it on cell count and base size alone long before the cross-window shift above could matter — the non-monotonicity is real, but it lives entirely past the cell count any row within this budget can reach, so the scan below never needs to worry it will stop on a candidate a larger, skipped-past one would also have fit.
      const ordered = Array.from(rowLostBoundaries);
      let kept = ordered;
      while (
        kept.length > 0 &&
        !rowSplitFits(
          physicalCells,
          columnCount,
          boundaries,
          new Set(kept),
          heightPt,
          isHeader,
        )
      ) {
        kept = kept.slice(0, -1);
      }
      // A row that still will not fit even fully unsplit (kept.length === 0) is not this fallback's concern: it throws exactly the DocFormatError it always has, from the real buildPapxPages call in write.ts, for the same "row is too wide or too decorated" reason #992 never touched.
      rowLostBoundariesToApply = new Set(kept);
      const droppedCount = ordered.length - kept.length;
      onWarning?.(
        kept.length === 0
          ? `doc-codec: table at block ${blockIndex}, row ${rowIndex} could not state ${rowLostBoundaries.size === 1 ? "its assigned lost column boundary" : `any of its ${rowLostBoundaries.size} assigned lost column boundaries`} without exceeding a PapxInFkp record's own byte budget or the format's own ${MAX_TABLE_ROW_CELLS}-cell-per-row ceiling; attempting to write it unsplit instead, which narrows the table's columns on read exactly as this writer's own pre-#992 behaviour did — if this row's own unsplit encoding also overflows this same budget, writeDocContent can still throw its usual DocFormatError further down this same pipeline, after any remaining rows have reported their own warnings`
          : `doc-codec: table at block ${blockIndex}, row ${rowIndex} could only state ${kept.length} of its ${ordered.length} assigned lost column boundaries without exceeding a PapxInFkp record's own byte budget or the format's own ${MAX_TABLE_ROW_CELLS}-cell-per-row ceiling; dropping the other ${droppedCount} (narrowing the table's columns on read for those boundaries alone)`,
      );
    }
    const { paragraphs, cellsToWrite, rowBoundariesTwips } = flattenRow(
      physicalCells,
      columnCount,
      boundaries,
      rowLostBoundariesToApply,
    );
    output.push(...paragraphs);
    output.push(
      rowMarkParagraph(rowBoundariesTwips, cellsToWrite, heightPt, isHeader),
    );
  });
  return output;
}

// An inline picture is block-level in document-schema.js's own model but character-anchored in [MS-DOC] — a single U+0001 character carrying sprmCPicLocation, per pictures.ts's own read-side resolveInlinePicture. flattenSectionBlocks therefore writes a ContentImageBlock as its own one-run, one-paragraph WriteParagraph: buildParagraphBlocks (text/paragraphs.ts) will split that run straight back out into an ContentImageBlock of its own on read, since a paragraph carrying no text before or after the anchor produces no synthetic empty paragraph either side of it (that function's own comment). dataStream accumulates the picture's own PICFAndOfficeArtData bytes (pictures-write.ts's buildInlinePicture) across the whole document — shared across every section and image, not created per call, so offsets stay correct regardless of how many pictures came before this one.
function imageParagraph(
  image: ContentImageBlock,
  dataStream: DataStreamBuilder,
): WriteParagraph {
  const { data, buildGrpprl } = buildInlinePicture(image);
  const offset = dataStream.append(data);
  return {
    runs: [
      {
        run: { text: String.fromCharCode(INLINE_PICTURE) },
        extraGrpprl: buildGrpprl(offset),
      },
    ],
    properties: {},
    extraGrpprl: [],
    terminator: PARAGRAPH_MARK,
  };
}

// A manual page break is the end-of-section character (0x000C) put where no section ends: [MS-DOC]'s own PlcfSed.aCP text — "An end-of-section character (0x0C) which occurs at a CP and which is not the last character in a section specifies a manual page break" — and read.ts's markManualPageBreaks decodes exactly that shape back into a pageBreak block. The writer's inverse is the mirror image of that read: a pageBreak block retargets the terminator of the paragraph before it from an ordinary paragraph mark to 0x000C, so "alpha, pageBreak, beta" lays out as "alpha" + 0x000C + "beta" + 0x000D — the byte sequence a re-read turns straight back into [paragraph alpha, pageBreak, paragraph beta] with no stray empty paragraph, because 0x000C is itself a paragraph terminator ([MS-DOC] 2.4.2) and the break rides on one that is already there. A page break with no ordinary paragraph before it to carry it (the first block of a section, directly after a table whose row mark is a cell mark rather than a paragraph mark, or directly after another page break) cannot retarget anything, so it becomes its own empty 0x000C-terminated paragraph instead — the one spelling the format has for a break with no preceding text, and the same shape a real producer's own leading page break has. That empty paragraph is genuinely visible in the round trip (a re-read yields [paragraph "", pageBreak, ...] where the input had [pageBreak, ...]), which is a faithful statement of the format's own limit rather than a loss: a page break in [MS-DOC] always terminates SOME paragraph, so a modelled break with nothing before it necessarily mints one.
function appendPageBreak(output: WriteParagraph[]): void {
  const previous = output[output.length - 1];
  if (previous?.terminator === PARAGRAPH_MARK) {
    output[output.length - 1] = { ...previous, terminator: SECTION_MARK };
    return;
  }
  output.push({
    runs: [],
    properties: {},
    extraGrpprl: [],
    terminator: SECTION_MARK,
  });
}

// Flattens a section's whole block list into the paragraph sequence writeDocContent's own text-layout pass consumes: an ordinary paragraph passes through as one WriteParagraph, a table expands into its own real cell/row-mark stream, an inline picture becomes its own one-run paragraph carrying the picture anchor (see imageParagraph above), and a page break retargets the preceding paragraph's terminator to the manual-page-break spelling of 0x000C (see appendPageBreak above). `onWarning`, when given, is reported a message for a non-fatal write-time degradation — today, only flattenTable's own per-row lost-boundary-budget fallback (see its own note) — naming the degraded table by its own position in `blocks` (`blockIndex`), since a document with more than one table would otherwise report every warning as an indistinguishable "table row N", with no way for a caller to tell which table it came from.
export function flattenSectionBlocks(
  blocks: readonly ContentBlock[],
  dataStream: DataStreamBuilder,
  onWarning?: WriteWarning,
): WriteParagraph[] {
  const output: WriteParagraph[] = [];
  blocks.forEach((block, blockIndex) => {
    if (block.kind === "paragraph") {
      output.push({
        runs: plainRuns(block.runs),
        properties: block,
        extraGrpprl: [],
        terminator: PARAGRAPH_MARK,
      });
      return;
    }
    if (block.kind === "table") {
      output.push(...flattenTable(block, blockIndex, onWarning));
      return;
    }
    if (block.kind === "image") {
      output.push(imageParagraph(block, dataStream));
      return;
    }
    if (block.kind === "pageBreak") {
      appendPageBreak(output);
      return;
    }
    throw new DocUnsupportedError(
      `doc-codec's writer does not yet support '${block.kind}' blocks (see README's scope note)`,
    );
  });
  return output;
}
