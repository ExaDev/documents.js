// Byte-level [MS-DOC] table sprm builders and content-navigation helpers shared by every table/read*.test.ts file, none of which write tables through tap-write.ts: each hand-assembles the sgc-5 (table) grpprl bytes straight from the specification's own field tables, independently of this package's own writer.
//
// Test-support only: excluded from the published dist per the family convention (tsdown.config.ts drops src/test-support/**), and never imported by src/index.ts.

import type { ContentBorder } from "document-schema.js";
import type { readDocContent } from "../read";

/** sprmPFInTable (0x2416), Bool8 true — every table paragraph carries it. */
export const SPRM_P_F_IN_TABLE = [0x16, 0x24, 0x01];
/** sprmPFTtp (0x2417), Bool8 true — marks a cell mark as a row's own terminating mark. */
export const SPRM_P_F_TTP = [0x17, 0x24, 0x01];

export function le16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

/** A single Brc80MayBeNil field's own no-border sentinel, [MS-DOC] 2.9.18: all four bytes set. */
export const NIL_BRC80 = new Array<number>(4).fill(0xff);

// TC80, [MS-DOC] 2.9.313: tcgrf (2 bytes — horzMerge in bits 0-1, vertMerge in bits 5-6, per TCGRF 2.9.317) + wWidth (2, unused by this reader) + four Brc80 border fields (4 bytes each). Each defaults to Brc80MayBeNil ("no border", all bits set) unless `borders` names a real Brc80 for that side — used by the sprmTTableBorders precedence tests, where one cell's own TC80 states a real border that must win over the row-level cascade.
export function tc80(
  horzMerge: number,
  vertMerge: number,
  borders?: {
    top?: readonly number[];
    left?: readonly number[];
    bottom?: readonly number[];
    right?: readonly number[];
  },
): number[] {
  const tcgrf = (horzMerge & 0x3) | ((vertMerge & 0x3) << 5);
  return [
    ...le16(tcgrf),
    0x00,
    0x00,
    ...(borders?.top ?? NIL_BRC80),
    ...(borders?.left ?? NIL_BRC80),
    ...(borders?.bottom ?? NIL_BRC80),
    ...(borders?.right ?? NIL_BRC80),
  ];
}

// sprmTDefTable, [MS-DOC] 2.6.3 (0xD608): TDefTableOperand's own cb (2 bytes — "the number of bytes used by the remainder of this structure, incremented by 1"), NumberOfColumns, rgdxaCenter (NumberOfColumns + 1 signed 2-byte boundaries), then one TC80 per column.
export function sprmTDefTable(
  columnBoundariesTwips: readonly number[],
  cells: readonly {
    horzMerge: number;
    vertMerge: number;
    borders?: {
      top?: readonly number[];
      left?: readonly number[];
      bottom?: readonly number[];
      right?: readonly number[];
    };
  }[],
): number[] {
  const remainder = [
    cells.length,
    ...columnBoundariesTwips.flatMap(le16),
    ...cells.flatMap((cell) =>
      tc80(cell.horzMerge, cell.vertMerge, cell.borders),
    ),
  ];
  const cb = remainder.length + 1;
  return [0x08, 0xd6, ...le16(cb), ...remainder];
}

// sprmTMerge, [MS-DOC] 2.6.3 (0x5624): an ItcFirstLim range naming the physical cells to horizontally merge, the first becoming the anchor — a spec-conformant mechanism this reader still honours for a genuine third-party producer's row, even though this package's own writer states a horizontal merge purely through a merged row's own narrower, wider physical cells instead (see tap.ts's own note and ExaDev/documents.js#895).
export function sprmTMerge(itcFirst: number, itcLim: number): number[] {
  return [0x24, 0x56, itcFirst, itcLim];
}

/** sprmPItap (0x6649): the paragraph's own table depth, a 4-byte operand. */
export function sprmPItap(depth: number): number[] {
  return [0x49, 0x66, depth & 0xff, 0, 0, 0];
}

/** sprmPFInnerTableCell (0x244b), Bool8 true — a nested table's own cell-ending paragraph mark. */
export const sprmPFInnerTableCell = [0x4b, 0x24, 0x01];
/** sprmPFInnerTtp (0x244c), Bool8 true — a nested table's own row-ending paragraph mark. */
export const sprmPFInnerTtp = [0x4c, 0x24, 0x01];

// sprmTVertMerge, [MS-DOC] 2.6.3 (0xD62B): a VertMergeOperand naming one cell (itc) and its own VerticalMergeFlag — the incremental per-cell mechanism for a vertical merge, the vertical analogue of sprmTMerge.
export function sprmTVertMerge(itc: number, vertMergeFlags: number): number[] {
  return [0x2b, 0xd6, 0x02, itc, vertMergeFlags];
}

/** A Brc80 field's own four bytes, [MS-DOC] 2.9.17: dptLineWidth (1/8-point increments), brcType (BRC_TYPE_SINGLE, 0x01, throughout these tests), ico (an Ico palette index, [MS-DOC] 2.9.119), then a zeroed dptSpace/fShadow/fFrame byte. */
export function brc80(dptLineWidthEighths: number, ico: number): number[] {
  return [dptLineWidthEighths, 0x01, ico, 0x00];
}

/** A Brc field's own eight bytes, [MS-DOC] 2.9.16: an exact COLORREF (r, g, b, fAuto — 2.9.43), dptLineWidth, brcType (BRC_TYPE_SINGLE throughout), then a zeroed reserved word. */
export function brc(
  rgb: readonly [number, number, number],
  dptLineWidthEighths: number,
): number[] {
  return [rgb[0], rgb[1], rgb[2], 0x00, dptLineWidthEighths, 0x01, 0x00, 0x00];
}

/** A BrcMayBeNil field's own no-border sentinel, [MS-DOC] 2.9.20: the last four bytes — dptLineWidth/brcType/reserved — all set (the cv COLORREF ahead of them is not part of the sentinel, so it is left zeroed here). */
export const NIL_BRC = [0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff];

// sprmTSetBrc, [MS-DOC] 2.6.3 (0xD62F): a TableBrcOperand ([MS-DOC] 2.9.305) — cb (1 byte, MUST be 11), an ItcFirstLim (itcFirst, itcLim), a bordersToApply bitmask, then a single BrcMayBeNil applied to every side the mask names.
export function sprmTSetBrc(
  itcFirst: number,
  itcLim: number,
  bordersToApply: number,
  brcBytes: readonly number[],
): number[] {
  const remainder = [itcFirst, itcLim, bordersToApply, ...brcBytes];
  return [0x2f, 0xd6, remainder.length, ...remainder];
}

// sprmTSetBrc80, [MS-DOC] 2.6.3 (0xD620): the Word 97-era sibling of sprmTSetBrc, a TableBrc80Operand ([MS-DOC] 2.9.304) — the identical cb/ItcFirstLim/bordersToApply header (cb MUST be 7 here, one byte narrower than sprmTSetBrc's own 11 because a Brc80MayBeNil is four bytes against Brc's eight), then a single Brc80MayBeNil applied to every side the mask names.
export function sprmTSetBrc80(
  itcFirst: number,
  itcLim: number,
  bordersToApply: number,
  brc80Bytes: readonly number[],
): number[] {
  const remainder = [itcFirst, itcLim, bordersToApply, ...brc80Bytes];
  return [0x20, 0xd6, remainder.length, ...remainder];
}

export interface TableBordersSides {
  readonly top?: readonly number[];
  readonly left?: readonly number[];
  readonly bottom?: readonly number[];
  readonly right?: readonly number[];
  readonly insideHorizontal?: readonly number[];
  readonly insideVertical?: readonly number[];
}

// sprmTTableBorders, [MS-DOC] 2.6.3 (0xD613): a TableBordersOperand ([MS-DOC] 2.9.302) — cb (1 byte, MUST be 0x30) then six real 8-byte Brc fields in brcTop/brcLeft/brcBottom/brcRight/brcHorizontalInside/brcVerticalInside order, a side defaulting to NIL_BRC ("no border") when the caller does not name it.
export function sprmTTableBorders(sides: TableBordersSides): number[] {
  const remainder = [
    ...(sides.top ?? NIL_BRC),
    ...(sides.left ?? NIL_BRC),
    ...(sides.bottom ?? NIL_BRC),
    ...(sides.right ?? NIL_BRC),
    ...(sides.insideHorizontal ?? NIL_BRC),
    ...(sides.insideVertical ?? NIL_BRC),
  ];
  return [0x13, 0xd6, remainder.length, ...remainder];
}

// sprmTTableBorders80, [MS-DOC] 2.6.3 (0xD605): the Word 97-era TableBordersOperand80 ([MS-DOC] 2.9.303) — the same six-field layout as sprmTTableBorders, but each field a 4-byte Brc80MayBeNil rather than an 8-byte Brc.
export function sprmTTableBorders80(sides: TableBordersSides): number[] {
  const remainder = [
    ...(sides.top ?? NIL_BRC80),
    ...(sides.left ?? NIL_BRC80),
    ...(sides.bottom ?? NIL_BRC80),
    ...(sides.right ?? NIL_BRC80),
    ...(sides.insideHorizontal ?? NIL_BRC80),
    ...(sides.insideVertical ?? NIL_BRC80),
  ];
  return [0x05, 0xd6, remainder.length, ...remainder];
}

/** One Shd's own ten bytes, [MS-DOC] 2.9.247, as a flat ipatAuto background: cvFore automatic (fAuto set), cvBack the stated colour, ipat 0x0000. */
export function shdBackground(
  rgb: readonly [number, number, number],
): number[] {
  return [0x00, 0x00, 0x00, 0xff, rgb[0], rgb[1], rgb[2], 0x00, 0x00, 0x00];
}

// sprmTSetShdTable, [MS-DOC] 2.6.3 (0xD660): a SHDOperand ([MS-DOC] 2.9.249) — cb (1 byte, MUST be 10) then one Shd (10 bytes) applied to every cell in the row.
export function sprmTSetShdTable(shd: readonly number[]): number[] {
  return [0x60, 0xd6, shd.length, ...shd];
}

export function tableBlock(document: ReturnType<typeof readDocContent>) {
  if (document.kind !== "wordprocessing") {
    throw new Error("a .doc always reads as a wordprocessing document");
  }
  const block = document.sections[0]?.blocks[0];
  if (block?.kind !== "table") throw new Error("expected a table block");
  return block;
}

export function cellText(
  cell:
    ReturnType<typeof tableBlock>["rows"][number]["cells"][number] | undefined,
): string {
  if (cell === undefined) throw new Error("expected a cell");
  return cell.blocks
    .map((paragraphBlock) => {
      if (paragraphBlock.kind !== "paragraph") {
        throw new Error(`expected a paragraph, got '${paragraphBlock.kind}'`);
      }
      return paragraphBlock.runs.map((run) => run.text).join("");
    })
    .join(",");
}

// The row/table-level cascade fixture both read-border-cascade.test.ts and read-border-merge.test.ts exercise (ExaDev/documents.js#945): a table decorated only through sprmTTableBorders, with no cell ever stating its own TC80 border.
export const TOP: ContentBorder = { color: { r: 1, g: 0, b: 0 }, widthPt: 1 };
export const LEFT: ContentBorder = {
  color: { r: 0, g: 0, b: 1 },
  widthPt: 0.5,
};
export const BOTTOM: ContentBorder = {
  color: { r: 0, g: 1, b: 0 },
  widthPt: 1.5,
};
export const RIGHT: ContentBorder = { color: { r: 1, g: 1, b: 0 }, widthPt: 2 };
export const INSIDE_H: ContentBorder = {
  color: { r: 0, g: 1, b: 1 },
  widthPt: 0.75,
};
export const INSIDE_V: ContentBorder = {
  color: { r: 1, g: 0, b: 1 },
  widthPt: 1.25,
};

export const tableBordersSprm = sprmTTableBorders({
  top: brc([0xff, 0x00, 0x00], 8),
  left: brc([0x00, 0x00, 0xff], 4),
  bottom: brc([0x00, 0xff, 0x00], 12),
  right: brc([0xff, 0xff, 0x00], 16),
  insideHorizontal: brc([0x00, 0xff, 0xff], 6),
  insideVertical: brc([0xff, 0x00, 0xff], 10),
});
