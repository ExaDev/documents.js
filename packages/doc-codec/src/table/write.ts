import type {
  ContentBlock,
  ContentParagraph,
  ContentRun,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { DocFormatError, DocUnsupportedError } from "../errors";
import { CELL_MARK, PARAGRAPH_MARK } from "../text/special";
import { encodeTableRowGrpprl, type TableCellMergeToWrite } from "./tap-write";

// The inverse of table/read.ts: a section's own ContentBlock list to the flat sequence of paragraphs writeDocContent's own text-layout pass consumes, expanding each ContentTable into its real [MS-DOC] physical-cell stream. Each ContentTableCell -- real content or a vertical-merge continuation's own `{blocks: []}` -- becomes exactly ONE physical cell, ending in its own cell mark exactly as [MS-DOC] 2.4.3 requires: a horizontally-merged (colSpan > 1) cell is never expanded into extra synthetic continuation cells, because a real, independent [MS-DOC] implementation (LibreOffice 26.2.5.2) was confirmed not to read a horizontal merge back from TCGRF.horzMerge/sprmTMerge continuation cells at all -- it states one purely as a row's own narrower, wider physical-cell layout (ExaDev/documents.js#895; see tap-write.ts's own top-of-file note for the full ground-truth finding). flattenRow instead merges the table-wide column grid's own boundaries across a cell's colSpan to compute that one physical cell's width, so the row's own rgdxaCenter genuinely has fewer entries than the table's full column count whenever a merge is present, matching what LibreOffice's own writer produces byte-for-byte. A vertical-merge continuation cell is never inferred from a bare `{blocks: []}` alone -- a genuinely blank cell has the identical shape -- so flattenTable tracks which columns carry a vertical merge actually in progress (an `active` map keyed by column position, walked top to bottom exactly as ooxml.js's own buildTable tracks its identical `active` map), and only a `{blocks: []}` cell landing on a column with a merge genuinely active there becomes a continuation; every other cell, blank or not, is ordinary. The same map supplies a continuation's own physical column span from the anchor's recorded span, since the continuation cell's own (typically absent) colSpan is never the source of truth for it. Every physical cell's own grpprl carries sprmPFInTable; the row's own trailing mark additionally carries sprmPFTtp plus the row's whole TAP (tap-write.ts's encodeTableRowGrpprl).

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

// The row's own trailing mark: sprmPFInTable (every table paragraph carries it), sprmPFTtp (marking this one as the row's own Table Terminating Paragraph mark), then the row's whole TAP (sprmTDefTable, and a row height if it has one) -- no separate horizontal-merge signal, since flattenRow's own physical-cell boundaries already state a merge the way a real [MS-DOC] producer does (see this module's own top-of-file note).
function rowMarkExtraGrpprl(
  boundaries: readonly number[],
  merges: readonly TableCellMergeToWrite[],
  heightPt: number | undefined,
): number[] {
  const bytes = inTableGrpprl();
  pushSprm(bytes, SPRM_P_F_TTP, [0x01]);
  bytes.push(...encodeTableRowGrpprl(boundaries, merges, heightPt));
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

// Expands one output row's own cells (colSpan-anchored; a vertical continuation is a bare `{blocks: []}`, disambiguated from a genuinely blank cell by whether `active` shows a merge actually in progress at this column -- see this module's own top-of-file note) into the row's real physical-cell stream: exactly ONE physical cell per ContentTableCell, its own boundary computed by merging the table-wide grid's boundary points across the cell's colSpan (never expanded into extra synthetic continuation cells -- see this module's own top-of-file note on why). Mutates `active` as it walks the row, exactly as ooxml.js's own buildTable does for the identical disambiguation.
function flattenRow(
  cells: readonly ContentTableCell[],
  columnCount: number,
  boundaries: readonly number[],
  active: Map<number, ActiveVerticalMerge>,
): {
  paragraphs: WriteParagraph[];
  merges: TableCellMergeToWrite[];
  rowBoundariesTwips: number[];
} {
  const paragraphs: WriteParagraph[] = [];
  const merges: TableCellMergeToWrite[] = [];
  const firstBoundary = boundaries[0];
  if (firstBoundary === undefined) {
    throw new DocFormatError(
      "internal defect: a table's own column-boundary array is empty despite the columnCount guard above",
    );
  }
  const rowBoundariesTwips: number[] = [firstBoundary];
  let column = 0;
  for (const cell of cells) {
    const covered = active.get(column);
    const isContinuation =
      cell.blocks.length === 0 &&
      covered !== undefined &&
      covered.remaining > 0;

    let span: number;
    let vertMerge: TableCellMergeToWrite["vertMerge"];
    let blocks: readonly ContentBlock[];
    if (isContinuation) {
      covered.remaining -= 1;
      span = covered.span;
      vertMerge = 1;
      blocks = [];
    } else {
      span = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;
      vertMerge = rowSpan > 1 ? 3 : 0;
      if (rowSpan > 1) {
        active.set(column, { span, remaining: rowSpan - 1 });
      }
      blocks = cell.blocks;
    }

    paragraphs.push(...cellParagraphs(blocks));
    merges.push({ vertMerge });
    column += span;
    const rightBoundary = boundaries[column];
    if (rightBoundary === undefined) {
      throw new DocFormatError(
        `a table cell's own colSpan runs past the table's ${columnCount}-column grid`,
      );
    }
    rowBoundariesTwips.push(rightBoundary);
  }
  if (column !== columnCount) {
    throw new DocFormatError(
      `a table row's own cells cover ${column} columns (via colSpan), but the table declares ${columnCount} in columnWidthsPt`,
    );
  }
  return { paragraphs, merges, rowBoundariesTwips };
}

function flattenTable(table: ContentTable): WriteParagraph[] {
  const columnCount = table.columnWidthsPt.length;
  if (columnCount === 0 || table.rows.length === 0) {
    throw new DocFormatError(
      "a table must have at least one column and one row to write",
    );
  }
  const boundaries = columnBoundariesTwips(table.columnWidthsPt);
  const active = new Map<number, ActiveVerticalMerge>();
  const output: WriteParagraph[] = [];
  for (const row of table.rows) {
    const { paragraphs, merges, rowBoundariesTwips } = flattenRow(
      row.cells,
      columnCount,
      boundaries,
      active,
    );
    output.push(...paragraphs);
    output.push({
      runs: [],
      properties: {},
      extraGrpprl: rowMarkExtraGrpprl(rowBoundariesTwips, merges, row.heightPt),
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
