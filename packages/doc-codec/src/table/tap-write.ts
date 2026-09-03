import { DocFormatError } from "../errors";

// The inverse of tap.ts's applyTableSprms: a row's own column boundaries, every physical cell's merge state, and its optional height, to the row-ending mark's own sgc-5 grpprl -- a single sprmTDefTable (which alone carries the column layout and every cell's TCGRF) plus, when the row states one, a sprmTDyaRowHeight. Opcodes are restated as local constants rather than imported from tap.ts, for the same reason chp-write.ts/pap-write.ts restate their own siblings' -- this module's exports are coupled to the specification's own opcode table, not to a sibling module's private constants.

/** sprmTDefTable, [MS-DOC] 2.6.4 (0xD608). */
const SPRM_T_DEF_TABLE = 0xd608;
/** sprmTDyaRowHeight (0x9407). */
const SPRM_T_DYA_ROW_HEIGHT = 0x9407;
/** sprmTMerge (0x5624): an ItcFirstLim naming a range of cells to horizontally merge. Written in addition to TC80.tcgrf.horzMerge (sprmTDefTable's own rgTc80 already carries it, spec-conformantly) because a real, independent [MS-DOC] implementation (LibreOffice) was verified not to honour horzMerge from TC80 for a horizontal merge, while it does honour the identical TC80 array's own vertMerge -- so this is the mechanism a real producer actually relies on for this half of the merge model, not a workaround for a bug of this writer's own. */
const SPRM_T_MERGE = 0x5624;

const TWIPS_PER_POINT = 20;
/** A table row has "between 1 and 63 table cells" ([MS-DOC] 2.4.3), and TDefTableOperand.NumberOfColumns is itself a single byte "MUST NOT exceed 63". */
const MAX_COLUMNS = 63;
/** Brc80MayBeNil, [MS-DOC] 2.9.18: "When all bits are set... this structure specifies that the region in question has no border" -- written on every cell's four border fields, since cell borders are out of this package's scope (see the README). */
const NO_BORDER: readonly number[] = [0xff, 0xff, 0xff, 0xff];
/** sprmPDyaBefore/After's unsigned 2-byte operand range, reused here for XAS column boundaries (also an unsigned 2-byte field in practice for the non-negative widths this writer produces). */
const MIN_INT16 = -0x8000;
const MAX_INT16 = 0x7fff;

export interface TableCellMergeToWrite {
  /** 0: not merged. 2: the first cell of a horizontally merged set (TCGRF's own "2, 3" both mean this; this writer always emits 2). 1: a continuation cell. */
  readonly horzMerge: 0 | 1 | 2;
  /** VerticalMergeFlag: 0 fvmClear, 1 fvmMerge (continuation), 3 fvmRestart (first cell). */
  readonly vertMerge: 0 | 1 | 3;
}

function int16(value: number, what: string): number[] {
  const rounded = Math.round(value);
  if (rounded < MIN_INT16 || rounded > MAX_INT16) {
    throw new DocFormatError(
      `${what} is ${rounded}, outside the ${MIN_INT16}..${MAX_INT16} range a signed 2-byte sprm operand can hold`,
    );
  }
  const unsigned = rounded < 0 ? rounded + 0x10000 : rounded;
  return [unsigned & 0xff, (unsigned >> 8) & 0xff];
}

function le16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function buildTc80(cell: TableCellMergeToWrite): number[] {
  const tcgrf = (cell.horzMerge & 0x3) | ((cell.vertMerge & 0x3) << 5);
  return [
    ...le16(tcgrf),
    0x00,
    0x00, // wWidth: 0, with ftsWidth left at its own default (ftsNil, encoded in tcgrf's own zero bits) -- the row's rgdxaCenter is this writer's authoritative width, so wWidth carries nothing a reader needs.
    ...NO_BORDER,
    ...NO_BORDER,
    ...NO_BORDER,
    ...NO_BORDER,
  ];
}

// Builds the sprmTDefTable Prl (opcode plus its TDefTableOperand) that defines a table row's entire physical cell layout in one sprm, plus, when heightPt is given, a trailing sprmTDyaRowHeight Prl -- the row-ending mark's own extra grpprl bytes, appended after its ordinary sprmPFInTable/sprmPFTtp. `columnBoundariesTwips` must carry exactly one more entry than `cells`, matching TDefTableOperand's own rgdxaCenter/NumberOfColumns relationship.
export function encodeTableRowGrpprl(
  columnBoundariesTwips: readonly number[],
  cells: readonly TableCellMergeToWrite[],
  heightPt: number | undefined,
): number[] {
  if (columnBoundariesTwips.length !== cells.length + 1) {
    throw new DocFormatError(
      `a table row's column-boundary array must carry exactly one more entry than its cell count (got ${columnBoundariesTwips.length} boundaries for ${cells.length} cells)`,
    );
  }
  if (cells.length < 1 || cells.length > MAX_COLUMNS) {
    throw new DocFormatError(
      `a table row must have between 1 and ${MAX_COLUMNS} cells, got ${cells.length}`,
    );
  }
  const remainder = [
    cells.length,
    ...columnBoundariesTwips.flatMap((boundary) =>
      int16(boundary, "table column boundary"),
    ),
    ...cells.flatMap(buildTc80),
  ];
  const cb = remainder.length + 1;
  const bytes = [...le16(SPRM_T_DEF_TABLE), ...le16(cb), ...remainder];
  if (heightPt !== undefined) {
    const dyaRowHeight = Math.round(heightPt * TWIPS_PER_POINT);
    bytes.push(
      ...le16(SPRM_T_DYA_ROW_HEIGHT),
      ...int16(dyaRowHeight, "table row heightPt"),
    );
  }
  return bytes;
}

export interface HorizontalMergeRange {
  readonly itcFirst: number;
  readonly itcLim: number;
}

// One sprmTMerge Prl per horizontal-merge range -- see this module's own top-of-file note on why it is written alongside TC80.tcgrf.horzMerge rather than instead of it.
export function encodeMergeGrpprl(
  ranges: readonly HorizontalMergeRange[],
): number[] {
  const bytes: number[] = [];
  for (const range of ranges) {
    bytes.push(
      ...le16(SPRM_T_MERGE),
      range.itcFirst & 0xff,
      range.itcLim & 0xff,
    );
  }
  return bytes;
}
