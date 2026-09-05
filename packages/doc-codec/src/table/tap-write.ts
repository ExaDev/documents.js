import type {
  ContentBorder,
  ContentCellBorders,
  ContentCellFill,
} from "document-schema.js";
import { DocFormatError } from "../errors";
import {
  BORDERS_TO_APPLY,
  CELL_BORDER_SIDES,
  borderNeedsExactColor,
  writeBrc,
  writeBrc80,
  writeShd,
} from "./decoration";

// The inverse of tap.ts's applyTableSprms: a row's own column boundaries, every physical cell's merge state and decoration, and its optional height, to the row-ending mark's own sgc-5 grpprl -- a single sprmTDefTable (which alone carries the column layout, every cell's TCGRF, and every cell's four Brc80 borders), a sprmTDefTableShd array whenever any cell in the row states a background, a sprmTSetBrc for each border whose colour the Brc80 palette cannot state exactly, and, when the row states one, a sprmTDyaRowHeight. Opcodes are restated as local constants rather than imported from tap.ts, for the same reason chp-write.ts/pap-write.ts restate their own siblings' -- this module's exports are coupled to the specification's own opcode table, not to a sibling module's private constants.
//
// A horizontal merge is ordinarily not stated here at all: table/write.ts's own flattenRow collapses a colSpan>1 cell into one physical cell whose own rgdxaCenter boundaries (passed in here as `columnBoundariesTwips`) span the merged columns' combined width, exactly the encoding a real, independent [MS-DOC] implementation (LibreOffice 26.2.5.2) was confirmed to produce and read back: a merged row simply carries fewer, wider physical cells through its own row-specific TDefTableOperand, with every TCGRF.horzMerge left at 0 and no sprmTMerge anywhere in the row mark's grpprl (ExaDev/documents.js#895; ground truth reproduced by round-tripping a LibreOffice-authored horizontal merge through its own `.doc` writer and parsing the result's raw TAP bytes with this package's own primitives). The one exception is table/write.ts's own lost-boundary fallback (ExaDev/documents.js#992): when every row in a table would otherwise merge across the identical column boundary, leaving no row's own rgdxaCenter to state it at all, flattenRow instead keeps that boundary physically present and marks the cell(s) either side of it with a genuine TCGRF.horzMerge -- 2 for the anchor, 1 (`fvmMerge`'s horizontal cousin) for a contentless continuation -- via `TableCellToWrite.horzMerge`, so this module still writes only what it is handed rather than deciding when the fallback applies. Vertical merge is unaffected and still stated exactly as before, through TC80.tcgrf.vertMerge alone.
//
// Borders are written twice, deliberately, matching what that same implementation writes for the identical input: TC80's own Brc80 fields carry every border with its colour snapped to [MS-DOC]'s fixed Ico palette, and a sprmTSetBrc carries the exact COLORREF for whichever borders that palette cannot state. Emitting the second layer only where it changes something is what keeps an ordinary black-bordered table's row mark the same size it would be without it, which matters because a PapxInFkp's whole GrpPrlAndIstd has to fit in 510 bytes (prop/fkp-write.ts) -- see this package's README for the column counts that bound.

/** sprmTDefTable, [MS-DOC] 2.6.3 (0xD608). */
const SPRM_T_DEF_TABLE = 0xd608;
/** sprmTDyaRowHeight (0x9407). */
const SPRM_T_DYA_ROW_HEIGHT = 0x9407;
/** sprmTDefTableShd (0xD612): a DefTableShdOperand ([MS-DOC] 2.9.53) shading cells 1-22 of the row, then sprmTDefTableShd2nd (0xD616) for 23-44 and sprmTDefTableShd3rd (0xD60C) for 45-63. Three sprms rather than one because a DefTableShdOperand's own cb is a single byte and its rgShd "MUST NOT exceed 22 elements", which is exactly why [MS-DOC] splits a row's shading across three opcodes at all. */
const SPRM_T_DEF_TABLE_SHD = 0xd612;
const SPRM_T_DEF_TABLE_SHD_2ND = 0xd616;
const SPRM_T_DEF_TABLE_SHD_3RD = 0xd60c;
/** sprmTSetBrc (0xD62F): a TableBrcOperand ([MS-DOC] 2.9.305) restating one cell's borders on the named sides with an exact COLORREF. */
const SPRM_T_SET_BRC = 0xd62f;

/** The three DefTableShdOperand sprms in cell order, each with the cell index its own rgShd starts at -- [MS-DOC] 2.6.3's own "Cells 1 - 22 ... cells 23 - 44 ... cells 45 - 63", one-based there and zero-based here. */
const SHD_ARRAYS: readonly {
  readonly opcode: number;
  readonly first: number;
}[] = [
  { opcode: SPRM_T_DEF_TABLE_SHD, first: 0 },
  { opcode: SPRM_T_DEF_TABLE_SHD_2ND, first: 22 },
  { opcode: SPRM_T_DEF_TABLE_SHD_3RD, first: 44 },
];
/** A DefTableShdOperand's own rgShd bound, [MS-DOC] 2.9.53: "The number of elements is equal to cb / 10 and MUST NOT exceed 22." */
const MAX_SHD_PER_ARRAY = 22;

const TWIPS_PER_POINT = 20;
/** A table row has "between 1 and 63 table cells" ([MS-DOC] 2.4.3), and TDefTableOperand.NumberOfColumns is itself a single byte "MUST NOT exceed 63". Exported so table/write.ts's own lost-boundary fallback can check a trial split's cell count against this format ceiling BEFORE calling encodeTableRowGrpprl with it -- that function still throws unconditionally past this limit for every other caller (the row actually committed has a genuine internal defect if it ever produces one), but a speculative trial split needs to treat the ceiling as "doesn't fit" and keep trimming rather than crash (ExaDev/documents.js#992). */
export const MAX_TABLE_ROW_CELLS = 63;
/** sprmPDyaBefore/After's unsigned 2-byte operand range, reused here for XAS column boundaries (also an unsigned 2-byte field in practice for the non-negative widths this writer produces). */
const MIN_INT16 = -0x8000;
const MAX_INT16 = 0x7fff;
/** TableBrcOperand.cb, [MS-DOC] 2.9.305: "This value MUST be 11" -- the ItcFirstLim (2), bordersToApply (1) and Brc (8) that follow it. */
const TABLE_BRC_OPERAND_CB = 11;

export interface TableCellToWrite {
  /** VerticalMergeFlag: 0 fvmClear, 1 fvmMerge (continuation), 3 fvmRestart (first cell). */
  readonly vertMerge: 0 | 1 | 3;
  /** TCGRF.horzMerge, [MS-DOC] 2.9.317: 0 not merged (the ordinary case, see this module's own top-of-file note), 1 a continuation cell of the lost-boundary fallback's own physical split, 2 the anchor of one. Every one of table/write.ts's own flattenRow construction branches states this explicitly -- 0 for an ordinary cell, 2 for a split anchor, 1 for its continuation -- so this field carries no default of its own; the only fallback flattenRow ever applies for the ExaDev/documents.js#992 fallback is deciding WHICH row of a table states a given lost boundary at all, not what a stated cell's own horzMerge value is. */
  readonly horzMerge: 0 | 1 | 2;
  /** The cell's own four borders, from ContentTableCell.borders; an absent side is written as the Brc80MayBeNil no-border sentinel. */
  readonly borders?: ContentCellBorders;
  /** The cell's own background fill, from ContentTableCell.background. */
  readonly background?: ContentCellFill;
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

function buildTc80(cell: TableCellToWrite): number[] {
  // TCGRF.horzMerge's own low 2 bits are 0 for an ordinary merge -- see this module's own top-of-file note on why a horizontal merge is normally stated through this row's own boundaries instead -- and only ever non-zero when table/write.ts's own lost-boundary fallback hands one in.
  const tcgrf = ((cell.vertMerge & 0x3) << 5) | cell.horzMerge;
  return [
    ...le16(tcgrf),
    0x00,
    0x00, // wWidth: 0, with ftsWidth left at its own default (ftsNil, encoded in tcgrf's own zero bits) -- the row's rgdxaCenter is this writer's authoritative width, so wWidth carries nothing a reader needs.
    ...CELL_BORDER_SIDES.flatMap((side) => writeBrc80(cell.borders?.[side])),
  ];
}

/** Groups a cell's sides by the border they carry, so four identical sides become one TableBrcOperand rather than four -- bordersToApply is a bitmask of "any subset" of the edges precisely so a producer can state them together, and the row mark's grpprl has a 510-byte ceiling to stay under. Only sides whose colour the Brc80 palette cannot state exactly are grouped at all; every other side is already exact in TC80 itself. */
function exactColorBorderGroups(
  borders: ContentCellBorders | undefined,
): { bordersToApply: number; border: ContentBorder }[] {
  const groups: { bordersToApply: number; border: ContentBorder }[] = [];
  for (const side of CELL_BORDER_SIDES) {
    const border = borders?.[side];
    if (border === undefined || !borderNeedsExactColor(border)) continue;
    const existing = groups.find((group) => sameBorder(group.border, border));
    if (existing === undefined) {
      groups.push({ bordersToApply: BORDERS_TO_APPLY[side], border });
      continue;
    }
    existing.bordersToApply |= BORDERS_TO_APPLY[side];
  }
  return groups;
}

function sameBorder(left: ContentBorder, right: ContentBorder): boolean {
  return (
    left.widthPt === right.widthPt &&
    (left.style ?? "solid") === (right.style ?? "solid") &&
    left.color.r === right.color.r &&
    left.color.g === right.color.g &&
    left.color.b === right.color.b
  );
}

/** One cell's sprmTSetBrc Prls: an ItcFirstLim naming that cell alone, the sides sharing one border, and that border's exact Brc. */
function setBrcPrls(cell: TableCellToWrite, index: number): number[] {
  const bytes: number[] = [];
  for (const group of exactColorBorderGroups(cell.borders)) {
    bytes.push(
      ...le16(SPRM_T_SET_BRC),
      TABLE_BRC_OPERAND_CB,
      index,
      index + 1,
      group.bordersToApply,
      ...writeBrc(group.border),
    );
  }
  return bytes;
}

/** The row's shading Prls: one DefTableShdOperand per 22-cell window that contains at least one shaded cell. A window with none is omitted entirely rather than written as an array of ShdAuto entries, since "no cells are shaded" is already the row's default -- so an undecorated table's row mark is byte-identical to what it was before shading was written at all. */
function shadingPrls(cells: readonly TableCellToWrite[]): number[] {
  const bytes: number[] = [];
  for (const { opcode, first } of SHD_ARRAYS) {
    const window = cells.slice(first, first + MAX_SHD_PER_ARRAY);
    if (window.length === 0) continue;
    // "rgShd only contains elements necessary to define all shaded cells in the row. Non-shaded cells that follow the last shaded cell in the row are omitted from the array" -- so the array stops at the last shaded cell, and cells past it stay unshaded by default.
    let lastShaded = -1;
    window.forEach((cell, index) => {
      if (cell.background !== undefined) lastShaded = index;
    });
    if (lastShaded === -1) continue;
    const shd = window
      .slice(0, lastShaded + 1)
      .flatMap((cell) => writeShd(cell.background));
    bytes.push(...le16(opcode), shd.length, ...shd);
  }
  return bytes;
}

// Builds the sprmTDefTable Prl (opcode plus its TDefTableOperand) that defines a table row's entire physical cell layout, merge state and Brc80 borders in one sprm, followed by the row's shading arrays, each cell's exact-colour border overrides, and -- when heightPt is given -- a trailing sprmTDyaRowHeight: the row-ending mark's own extra grpprl bytes, appended after its ordinary sprmPFInTable/sprmPFTtp. `columnBoundariesTwips` must carry exactly one more entry than `cells`, matching TDefTableOperand's own rgdxaCenter/NumberOfColumns relationship.
export function encodeTableRowGrpprl(
  columnBoundariesTwips: readonly number[],
  cells: readonly TableCellToWrite[],
  heightPt: number | undefined,
): number[] {
  if (columnBoundariesTwips.length !== cells.length + 1) {
    throw new DocFormatError(
      `a table row's column-boundary array must carry exactly one more entry than its cell count (got ${columnBoundariesTwips.length} boundaries for ${cells.length} cells)`,
    );
  }
  if (cells.length < 1 || cells.length > MAX_TABLE_ROW_CELLS) {
    throw new DocFormatError(
      `a table row must have between 1 and ${MAX_TABLE_ROW_CELLS} cells, got ${cells.length}`,
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
  bytes.push(...shadingPrls(cells));
  cells.forEach((cell, index) => {
    bytes.push(...setBrcPrls(cell, index));
  });
  if (heightPt !== undefined) {
    const dyaRowHeight = Math.round(heightPt * TWIPS_PER_POINT);
    bytes.push(
      ...le16(SPRM_T_DYA_ROW_HEIGHT),
      ...int16(dyaRowHeight, "table row heightPt"),
    );
  }
  return bytes;
}
