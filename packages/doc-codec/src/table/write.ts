import type {
  ContentBlock,
  ContentParagraph,
  ContentRun,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from "document-schema.js";
import { DocFormatError, DocUnsupportedError } from "../errors";
import { CELL_MARK, PARAGRAPH_MARK } from "../text/special";
import { encodeTableRowGrpprl, type TableCellToWrite } from "./tap-write";

// The inverse of table/read.ts: a section's own ContentBlock list to the flat sequence of paragraphs writeDocContent's own text-layout pass consumes, expanding each ContentTable into its real [MS-DOC] physical-cell stream. Each ContentTableCell -- real content or a vertical-merge continuation's own `{blocks: []}` -- becomes ONE physical cell ending in its own cell mark exactly as [MS-DOC] 2.4.3 requires, in the ordinary case: a horizontally-merged (colSpan > 1) cell is not expanded into extra synthetic continuation cells, because a real, independent [MS-DOC] implementation (LibreOffice 26.2.5.2) was confirmed not to read a horizontal merge back from TCGRF.horzMerge/sprmTMerge continuation cells at all -- it states one purely as a row's own narrower, wider physical-cell layout (ExaDev/documents.js#895; see tap-write.ts's own top-of-file note for the full ground-truth finding). flattenRow instead merges the table-wide column grid's own boundaries across a cell's colSpan to compute that one physical cell's width, so the row's own rgdxaCenter genuinely has fewer entries than the table's full column count whenever a merge is present, matching the merge-encoding strategy LibreOffice's own writer uses -- not its bytes, which still differ in what the row mark carries beyond the facts both state (this writer emits no cell padding, cell spacing or table-style sprm, and no legacy Shd80 array). Each ContentTableCell's own background and borders ride along to tap-write.ts, which states them the same two ways that implementation does -- TC80's own Brc80 fields plus a sprmTSetBrc for a colour the Brc80 palette cannot hold, and a sprmTDefTableShd array of one Shd per cell. A vertical-merge continuation cell is never inferred from a bare `{blocks: []}` alone -- a genuinely blank cell has the identical shape -- so flattenTable tracks which columns carry a vertical merge actually in progress (an `active` map keyed by column position, walked top to bottom exactly as ooxml.js's own buildTable tracks its identical `active` map), and only a `{blocks: []}` cell landing on a column with a merge genuinely active there becomes a continuation; every other cell, blank or not, is ordinary. The same map supplies a continuation's own physical column span from the anchor's recorded span, since the continuation cell's own (typically absent) colSpan is never the source of truth for it. Every physical cell's own grpprl carries sprmPFInTable; the row's own trailing mark additionally carries sprmPFTtp plus the row's whole TAP (tap-write.ts's encodeTableRowGrpprl).
//
// The one exception to "one physical cell per ContentTableCell" is the lost-boundary fallback (ExaDev/documents.js#992): table/read.ts reconstructs the table's shared column grid as the union of every row's own physical boundaries, so a boundary every row happens to merge across identically is never stated anywhere and cannot be recovered -- the simplest case is a single-row table with one merged cell, which by definition has no other row to compare against. `recoverableBoundaries` computes, before any row is flattened, exactly which of the table's own internal grid boundaries at least one row's ordinary (un-split) physical layout would state; every boundary outside that set is one no row would otherwise reveal at all. `splitAtLostBoundaries` then breaks a cell's span at those boundaries specifically -- and only those -- into extra physical sub-cells: the first carries the cell's real content and decoration exactly as before, every further sub-cell is an empty TCGRF.horzMerge continuation ([MS-DOC] 2.4.3: "the contents and formatting are not applied" to one), so the boundary is physically present in this row's own rgdxaCenter without changing what the table renders as. A boundary some other row already states is left exactly as flattenRow always encoded it -- unsplit, via the narrower/wider physical-cell layout above -- so the fallback changes nothing for the common case a real producer's own table already exercises (see the "narrows columnWidthsPt" test's replacement in write.test.ts for the fixed round trip, and the README's own Tables section for the third-party-fidelity trade-off this fallback makes only for the rows it actually applies to).

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

// Splits one logical cell's own [column, column + span) grid range into the physical sub-spans its row must actually carry: a break at every boundary strictly inside the range that `lostBoundaries` names, so a boundary every row would otherwise merge across identically stays physically present in every row that crosses it (ExaDev/documents.js#992). A range crossing no lost boundary returns as its own single sub-span unchanged -- the encoding this writer always used before #992, and still the only one an ordinary merge (recoverable via some other row) ever needs.
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
      // A vertical-merge continuation states no decoration of its own: [MS-DOC] renders the anchor's, and table/read.ts drops a continuation's own on the way in for the same reason, so writing this cell's (typically absent) background/borders would be inventing a fact the round trip cannot preserve. A lost-boundary continuation sub-cell (subIndex > 0) is the identical case one level down: [MS-DOC] 2.4.3 does not render a horizontal-merge continuation's own contents or formatting either, so it carries neither.
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

function flattenTable(table: ContentTable): WriteParagraph[] {
  const columnCount = table.columnWidthsPt.length;
  if (columnCount === 0 || table.rows.length === 0) {
    throw new DocFormatError(
      "a table must have at least one column and one row to write",
    );
  }
  const boundaries = columnBoundariesTwips(table.columnWidthsPt);
  const stated = recoverableBoundaries(table.rows);
  const lostBoundaries = new Set<number>();
  for (let index = 1; index < columnCount; index += 1) {
    if (!stated.has(index)) lostBoundaries.add(index);
  }
  const active = new Map<number, ActiveVerticalMerge>();
  const output: WriteParagraph[] = [];
  for (const row of table.rows) {
    const { paragraphs, cellsToWrite, rowBoundariesTwips } = flattenRow(
      row.cells,
      columnCount,
      boundaries,
      active,
      lostBoundaries,
    );
    output.push(...paragraphs);
    output.push({
      runs: [],
      properties: {},
      extraGrpprl: rowMarkExtraGrpprl(
        rowBoundariesTwips,
        cellsToWrite,
        row.heightPt,
      ),
      terminator: CELL_MARK,
    });
  }
  return output;
}

// Flattens a section's whole block list into the paragraph sequence writeDocContent's own text-layout pass consumes: an ordinary paragraph passes through as one WriteParagraph, a table expands into its own real cell/row-mark stream.
export function flattenSectionBlocks(
  blocks: readonly ContentBlock[],
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
      output.push(...flattenTable(block));
      continue;
    }
    throw new DocUnsupportedError(
      `doc-codec's writer does not yet support '${block.kind}' blocks (see README's scope note)`,
    );
  }
  return output;
}
