import type {
  ContentBlock,
  ContentParagraph,
  ContentRun,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { DocFormatError, DocUnsupportedError } from "../errors";
import { CELL_MARK, PARAGRAPH_MARK } from "../text/special";
import {
  encodeMergeGrpprl,
  encodeTableRowGrpprl,
  type HorizontalMergeRange,
  type TableCellMergeToWrite,
} from "./tap-write";

// The inverse of table/read.ts: a section's own ContentBlock list to the flat sequence of paragraphs writeDocContent's own text-layout pass consumes, expanding each ContentTable into its real [MS-DOC] physical-cell stream -- a horizontally-merged cell's colSpan becomes one real cell plus (colSpan - 1) synthetic continuation cells, each ending in its own cell mark exactly as [MS-DOC] 2.4.3 requires; a vertical-merge continuation cell (the shared schema's own `{blocks: []}` convention, mirroring ooxml.js's docx reader) becomes a single empty paragraph. Every physical cell's own grpprl carries sprmPFInTable; the row's own trailing mark additionally carries sprmPFTtp plus the row's whole TAP (tap-write.ts's encodeTableRowGrpprl).

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

// The row's own trailing mark: sprmPFInTable (every table paragraph carries it), sprmPFTtp (marking this one as the row's own Table Terminating Paragraph mark), the row's whole TAP (sprmTDefTable, and a row height if it has one), then one sprmTMerge per horizontal-merge range -- see tap-write.ts's own note on why a horizontal merge is written both ways.
function rowMarkExtraGrpprl(
  boundaries: readonly number[],
  merges: readonly TableCellMergeToWrite[],
  mergeRanges: readonly HorizontalMergeRange[],
  heightPt: number | undefined,
): number[] {
  const bytes = inTableGrpprl();
  pushSprm(bytes, SPRM_P_F_TTP, [0x01]);
  bytes.push(...encodeTableRowGrpprl(boundaries, merges, heightPt));
  bytes.push(...encodeMergeGrpprl(mergeRanges));
  return bytes;
}

// Derives each horizontal-merge range from the row's own already-expanded physical-cell merge array: a run starting at horzMerge 2 (this writer's own "first cell of a set" spelling) followed by one or more horzMerge-1 continuations.
function mergeRangesFromCells(
  merges: readonly TableCellMergeToWrite[],
): HorizontalMergeRange[] {
  const ranges: HorizontalMergeRange[] = [];
  let index = 0;
  while (index < merges.length) {
    if (merges[index]?.horzMerge !== 2) {
      index += 1;
      continue;
    }
    const itcFirst = index;
    let itcLim = index + 1;
    while (merges[itcLim]?.horzMerge === 1) itcLim += 1;
    ranges.push({ itcFirst, itcLim });
    index = itcLim;
  }
  return ranges;
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

// Expands one output row's own cells (colSpan-anchored, vertical continuations already present as `{blocks: []}`) into the row's real physical-cell stream, one WriteParagraph group and one TableCellMergeToWrite per physical cell.
function flattenRow(
  cells: readonly ContentTableCell[],
  columnCount: number,
): { paragraphs: WriteParagraph[]; merges: TableCellMergeToWrite[] } {
  const paragraphs: WriteParagraph[] = [];
  const merges: TableCellMergeToWrite[] = [];
  for (const cell of cells) {
    const colSpan = cell.colSpan ?? 1;
    let vertMerge: TableCellMergeToWrite["vertMerge"] = 0;
    if (cell.blocks.length === 0) {
      vertMerge = 1;
    } else if ((cell.rowSpan ?? 1) > 1) {
      vertMerge = 3;
    }
    paragraphs.push(...cellParagraphs(cell.blocks));
    merges.push({ horzMerge: colSpan > 1 ? 2 : 0, vertMerge });
    for (let extra = 1; extra < colSpan; extra += 1) {
      paragraphs.push({
        runs: [],
        properties: {},
        extraGrpprl: inTableGrpprl(),
        terminator: CELL_MARK,
      });
      merges.push({ horzMerge: 1, vertMerge: 0 });
    }
  }
  if (merges.length !== columnCount) {
    throw new DocFormatError(
      `a table row's own cells expand to ${merges.length} physical columns (via colSpan), but the table declares ${columnCount} in columnWidthsPt`,
    );
  }
  return { paragraphs, merges };
}

function flattenTable(table: ContentTable): WriteParagraph[] {
  const columnCount = table.columnWidthsPt.length;
  if (columnCount === 0 || table.rows.length === 0) {
    throw new DocFormatError(
      "a table must have at least one column and one row to write",
    );
  }
  const boundaries = columnBoundariesTwips(table.columnWidthsPt);
  const output: WriteParagraph[] = [];
  for (const row of table.rows) {
    const { paragraphs, merges } = flattenRow(row.cells, columnCount);
    output.push(...paragraphs);
    output.push({
      runs: [],
      properties: {},
      extraGrpprl: rowMarkExtraGrpprl(
        boundaries,
        merges,
        mergeRangesFromCells(merges),
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
