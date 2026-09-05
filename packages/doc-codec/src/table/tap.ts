import type {
  Color,
  ContentBorder,
  ContentCellBorders,
} from "document-schema.js";
import { readInt16LE, readUint16LE, readUint8 } from "../bytes";
import { SGC, type Prl } from "../prop/sprm";
import {
  BORDERS_TO_APPLY,
  BRC80_SIZE,
  CELL_BORDER_SIDES,
  SHD80_SIZE,
  SHD_SIZE,
  cellBordersFrom,
  readBrc,
  readBrc80,
  readShd,
  readShd80,
  readTableBordersOperand,
  readTableBordersOperand80,
  type CellBorderSide,
  type TableBordersSet,
} from "./decoration";

// Table row properties (TAP), [MS-DOC] 2.4.3 (Overview of Tables) and 2.6.3 (Table Properties) -- the row-ending mark's own grpprl carries sgc-5 (table) sprms alongside the ordinary sgc-1 (paragraph) sprms pap.ts already folds. Of the roughly seventy table sprms 2.6.3 names, this reader acts on the following, in three groups.
//
// Structure and merge state: sprmTDefTable, which alone carries the row's own column boundaries, every physical cell's horizontal/vertical merge state (via TC80.tcgrf -- [MS-DOC] 2.9.313's TC80, 2.9.317's TCGRF) and every physical cell's own four Brc80 borders, and which this package's own writer now uses for a horizontal merge too, purely through a merged row's own narrower, wider physical cells rather than any TCGRF/sprmTMerge flag (ExaDev/documents.js#895; see table/write.ts's own top-of-file note); sprmTMerge, an ItcFirstLim range this reader still folds on top of sprmTDefTable's own column layout in case a genuine third-party producer states a horizontal merge that way instead -- a spec-conformant encoding, and the one a real, independent [MS-DOC] implementation (LibreOffice) was verified NOT to honour on its own read side either (its own vertMerge from the identical TC80 array was honoured, but not horzMerge), which is exactly why this package's own writer no longer emits it; sprmTVertMerge, the incremental per-cell equivalent for a vertical merge (this package's own writer states a vertical merge only through TC80.tcgrf, but a real producer may equally state it incrementally, the same asymmetry sprmTMerge exists to cover on the horizontal side); and sprmTDyaRowHeight, the row's own height.
//
// Cell decoration: sprmTSetBrc, whose TableBrcOperand restates a named cell range's borders with an exact COLORREF rather than TC80's own palette-indexed Brc80, and which therefore folds on top of sprmTDefTable's border layer exactly as sprmTMerge folds on top of its merge layer; and the row's background shading, which has no TC80 field at all and rides its own sprms instead -- sprmTDefTableShd/2nd/3rd and their sprmTDefTableShdRaw counterparts (one Shd per cell, covering cells 1-22, 23-44 and 45-63 respectively), sprmTDefTableShd80 (the Word 97-era Shd80 spelling of the same array), and sprmTSetShd/sprmTSetShdOdd (a TableShadeOperand naming one cell range). Every one of these was confirmed against real LibreOffice 26.2.5.2 output rather than implemented from the specification alone; see table/decoration.ts's own top-of-file note for the captured bytes.
//
// Row/table cascade: sprmTTableBorders/sprmTTableBorders80 (a TableBordersOperand(80), [MS-DOC] 2.9.302/2.9.303) states one border for each of the row's four physical edges plus the two "inside" edges between cells and between this row and its neighbours, and its own text is explicit that it is a fallback rather than an ordinary direct-formatting sprm: "specifies the borders for this row unless modified by other Sprms applied to the cells" -- unlike every sprm above, which folds in grpprl order (a later Prl overriding an earlier one, exactly as pap.ts's own applyParagraphSprms does), this one must never override a cell's own TC80/sprmTSetBrc border regardless of which comes first in the grpprl. Because of that, this function only captures the row's own six-field operand here, on TableRowDefinition.rowBorders, entirely unresolved onto any cell: which of the six fields reaches a given cell/side depends on that cell's position in the WHOLE table (the table's own first/last row, this row's own first/last physical cell) -- context only table/read.ts's own cross-row assembly has, which is why its applyRowLevelBorderCascade is what actually applies it, once every row is known, filling in only the sides Pass 1/2 above left unstated. sprmTSetShdTable, by contrast, carries no such "unless modified" text, so it is read as an ordinary sprm here: a SHDOperand ([MS-DOC] 2.9.249) applied to every cell in the row, folded in grpprl order like every other shading sprm above.
//
// Deliberately not read: sprmTCellShdStyle, despite [MS-DOC] 2.6.3 listing it right beside sprmTSetShdTable. Its own text -- "the background shading to be applied to an entire table defined by a Table style" -- already places it inside a table STYLE's own definition (STSH's LPStd), never inside a row's own direct-formatting grpprl this function walks; sprmTCellNoWrapStyle, its other neighbour, is the one whose own text is explicit that "this Sprm is used by table styles and MUST NOT appear outside of the grpprlTapx array of UpxTapx" (sprmTCellVertAlignStyle, despite sitting between the two, carries no such restriction in its own text -- it is scoped to a table style only by its own "as defined by a Table style" wording, [MS-DOC] 2.6.3) -- and this package does not read table styles at all, so there is no real byte stream in which sprmTCellShdStyle could reach this function for it to act on.
//
// Every other sgc-5 sprm -- table style, absolute position, cell padding, cell spacing, vertical alignment, and the rest -- is a genuine TAP layer this package does not implement; see the README's own scope note for what that leaves unread.

const SPRM_T_DEF_TABLE = 0xd608;
const SPRM_T_DYA_ROW_HEIGHT = 0x9407;
/** sprmTMerge: an ItcFirstLim naming a range of cells to horizontally merge, the first cell becoming the anchor -- a spec-conformant mechanism this reader still honours for a genuine third-party producer, even though this package's own writer no longer emits it (see this module's own top-of-file note and table/write.ts's). */
const SPRM_T_MERGE = 0x5624;
/** sprmTVertMerge (0xD62B): a VertMergeOperand naming one cell (itc) and its own VerticalMergeFlag, the incremental per-cell equivalent of sprmTMerge for a vertical merge. */
const SPRM_T_VERT_MERGE = 0xd62b;
/** sprmTSetBrc (0xD62F): a TableBrcOperand ([MS-DOC] 2.9.305) restating one cell range's borders on the named sides, with an exact COLORREF rather than TC80's own Ico index. */
const SPRM_T_SET_BRC = 0xd62f;
/** sprmTDefTableShd80 (0xD609): a DefTableShd80Operand ([MS-DOC] 2.9.52), the Word 97-era array of one Shd80 per cell starting at the row's first. */
const SPRM_T_DEF_TABLE_SHD80 = 0xd609;
/** sprmTDefTableShd3rd (0xD60C): a DefTableShdOperand ([MS-DOC] 2.9.53) shading cells 45-63 -- index 44 onward. */
const SPRM_T_DEF_TABLE_SHD_3RD = 0xd60c;
/** sprmTDefTableShd (0xD612): a DefTableShdOperand shading cells 1-22 -- index 0 onward. */
const SPRM_T_DEF_TABLE_SHD = 0xd612;
/** sprmTDefTableShd2nd (0xD616): a DefTableShdOperand shading cells 23-44 -- index 22 onward. */
const SPRM_T_DEF_TABLE_SHD_2ND = 0xd616;
/** sprmTSetShd (0xD62D): a TableShadeOperand ([MS-DOC] 2.9.308) shading one ItcFirstLim cell range. */
const SPRM_T_SET_SHD = 0xd62d;
/** sprmTSetShdOdd (0xD62E): the same TableShadeOperand, applied to every other cell of the range starting at itcFirst -- [MS-DOC] 2.6.3's own worked example, "if the set of cells is 0 through 5, then this sets the background shading for cells 0, 2 and 4". */
const SPRM_T_SET_SHD_ODD = 0xd62e;
/** sprmTDefTableShdRaw/Raw2nd/Raw3rd (0xD670-0xD672): the same three DefTableShdOperand arrays, differing from the sprms above only in how ShdNil is treated inside a table style -- which this package neither reads nor writes, so all six resolve identically here. A real producer (LibreOffice) writes both families for the same row. */
const SPRM_T_DEF_TABLE_SHD_RAW = 0xd670;
const SPRM_T_DEF_TABLE_SHD_RAW_2ND = 0xd671;
const SPRM_T_DEF_TABLE_SHD_RAW_3RD = 0xd672;
/** sprmTTableBorders80 (0xD605): the Word 97-era spelling of the row/table border cascade, a TableBordersOperand80 ([MS-DOC] 2.9.303) over Brc80MayBeNil fields. */
const SPRM_T_TABLE_BORDERS_80 = 0xd605;
/** sprmTTableBorders (0xD613): a TableBordersOperand ([MS-DOC] 2.9.302) over real Brc fields with an exact COLORREF, the modern spelling of the same cascade. */
const SPRM_T_TABLE_BORDERS = 0xd613;
/** sprmTSetShdTable (0xD660): a SHDOperand ([MS-DOC] 2.9.249) stating the whole row/table's own background shading, folded in grpprl order like every other shading sprm above -- its own spec text carries none of sprmTTableBorders's "unless modified" exception. */
const SPRM_T_SET_SHD_TABLE = 0xd660;

/** The first cell index each of the three DefTableShdOperand sprms shades, [MS-DOC] 2.6.3: "Cells 1 - 22 are shaded by sprmTDefTableShd, and cells 23 - 44 are shaded by sprmTDefTableShd2nd" and 45-63 by the third -- one-based there, so zero-based here. */
const SHD_ARRAY_FIRST_CELL: Readonly<Record<number, number>> = {
  [SPRM_T_DEF_TABLE_SHD]: 0,
  [SPRM_T_DEF_TABLE_SHD_RAW]: 0,
  [SPRM_T_DEF_TABLE_SHD_2ND]: 22,
  [SPRM_T_DEF_TABLE_SHD_RAW_2ND]: 22,
  [SPRM_T_DEF_TABLE_SHD_3RD]: 44,
  [SPRM_T_DEF_TABLE_SHD_RAW_3RD]: 44,
};

const TWIPS_PER_POINT = 20;
/** TC80's own fixed size, [MS-DOC] 2.9.313: tcgrf (2) + wWidth (2) + brcTop/brcLeft/brcBottom/brcRight (4 each). */
const TC80_SIZE = 20;
/** The offset of TC80's own first border field, brcTop, past tcgrf and wWidth. The four follow it back to back in CELL_BORDER_SIDES order. */
const TC80_BORDERS_OFFSET = 4;

/** TCGRF.horzMerge, [MS-DOC] 2.9.317: 0 not merged, 1 a continuation cell (contributes its layout region, its own contents are not rendered), 2 or 3 the first cell of a horizontally merged set. */
export const HORZ_MERGE_CONTINUATION = 1;
/** VerticalMergeFlag's fvmMerge: TCGRF.vertMerge continuation (fvmClear=0, fvmMerge=1, fvmRestart=3 -- 2 is not a defined member). */
export const VERT_MERGE_CONTINUATION = 1;
export const VERT_MERGE_RESTART = 3;

export interface TableCellProperties {
  readonly horzMerge: number;
  readonly vertMerge: number;
  /** The cell's own four borders, absent when it states none on any side. */
  readonly borders?: ContentCellBorders;
  /** Sides sprmTSetBrc has explicitly named with a NilBrc -- a real "this cell has no border here" statement, distinct from a side this cell's own TAP has simply never mentioned. `borders` alone cannot carry that distinction (an absent side means the same thing either way once cellBordersFrom has dropped it), so table/read.ts's own row-level border cascade (applyRowLevelBorderCascade) consults this set too: a side listed here is never filled from the row's cascade, no matter what `borders` says. See applyBrcToCell's own note for why only sprmTSetBrc, never TC80's own Brc80 fields, can state this. */
  readonly clearedSides?: ReadonlySet<CellBorderSide>;
  /** The cell's own flat background colour, absent when it states no shading or states a pattern Color cannot express (see decoration.ts's readShd). */
  readonly background?: Color;
}

export interface TableRowDefinition {
  /** rgdxaCenter, in twips: one more entry than there are physical cells in the row -- column i's width is boundaries[i + 1] - boundaries[i]. */
  readonly columnBoundariesTwips: readonly number[];
  /** One entry per physical cell in the row, in document order -- every physical cell the row's own cell marks delimit, horizontally- and vertically-merged-away cells included, exactly as [MS-DOC]'s own model keeps them all present. */
  readonly cells: readonly TableCellProperties[];
  /** This row's own sprmTTableBorders/sprmTTableBorders80 cascade, unresolved onto any cell -- see this module's own top-of-file note on why table/read.ts's applyRowLevelBorderCascade, not this function, is what actually applies it. */
  readonly rowBorders?: TableBordersSet;
}

export interface TableRowProperties {
  definition?: TableRowDefinition;
  heightPt?: number;
}

function readTdefTableOperand(operand: Uint8Array): TableRowDefinition {
  const numberOfColumns = readUint8(operand, 2);
  const boundariesStart = 3;
  const columnBoundariesTwips: number[] = [];
  for (let index = 0; index <= numberOfColumns; index += 1) {
    columnBoundariesTwips.push(
      readInt16LE(operand, boundariesStart + index * 2),
    );
  }
  const tc80Start = boundariesStart + (numberOfColumns + 1) * 2;
  const cells: TableCellProperties[] = [];
  for (let index = 0; index < numberOfColumns; index += 1) {
    const tc80Offset = tc80Start + index * TC80_SIZE;
    // "If there are fewer TC80s than columns, the remaining columns are formatted with the default TC80 formatting" -- an all-zero TC80, i.e. no merge in either direction and no border on any side (brcType 0x00).
    if (tc80Offset + TC80_SIZE > operand.length) {
      cells.push({ horzMerge: 0, vertMerge: 0 });
      continue;
    }
    const tcgrf = readUint16LE(operand, tc80Offset);
    const sides: Record<CellBorderSide, ContentBorder | undefined> = {
      top: undefined,
      left: undefined,
      bottom: undefined,
      right: undefined,
    };
    CELL_BORDER_SIDES.forEach((side, sideIndex) => {
      sides[side] = readBrc80(
        operand,
        tc80Offset + TC80_BORDERS_OFFSET + sideIndex * BRC80_SIZE,
      );
    });
    cells.push({
      horzMerge: tcgrf & 0x3,
      vertMerge: (tcgrf >> 5) & 0x3,
      borders: cellBordersFrom(sides),
    });
  }
  return { columnBoundariesTwips, cells };
}

/** Replaces one cell's own entry in a definition, keeping every other cell and the row's boundaries untouched -- the shape every incremental sprm below folds through, so none of them has to restate how a definition is rebuilt. */
function withCells(
  definition: TableRowDefinition,
  next: (cell: TableCellProperties, index: number) => TableCellProperties,
): TableRowDefinition {
  return {
    columnBoundariesTwips: definition.columnBoundariesTwips,
    cells: definition.cells.map(next),
    rowBorders: definition.rowBorders,
  };
}

/** Overlays the sides one TableBrcOperand names onto a cell's existing borders, leaving every side it does not name as TC80's own Brc80 stated it. A named side whose Brc is a NilBrc explicitly clears that side -- how a producer states "this cell has no top border" over a row-level one it would otherwise inherit -- and is recorded in `clearedSides` so table/read.ts's own row-level cascade can tell that apart from a side this cell has simply never mentioned. TC80's own Brc80 fields cannot state this distinction on their own (they are mandatory for every cell, so "no border" and "never stated" are the identical bytes -- table/read.ts's own applyRowLevelBorderCascade note); only an explicit sprmTSetBrc naming the side carries an unambiguous "clear" signal. A later sprmTSetBrc restating a real border on a previously cleared side un-clears it, matching the ordinary last-Prl-wins fold every sprm in this module already follows. */
function applyBrcToCell(
  cell: TableCellProperties,
  bordersToApply: number,
  border: ContentBorder | undefined,
): TableCellProperties {
  const sides: Record<CellBorderSide, ContentBorder | undefined> = {
    top: cell.borders?.top,
    left: cell.borders?.left,
    bottom: cell.borders?.bottom,
    right: cell.borders?.right,
  };
  const clearedSides = new Set(cell.clearedSides);
  for (const side of CELL_BORDER_SIDES) {
    if ((bordersToApply & BORDERS_TO_APPLY[side]) === 0) continue;
    sides[side] = border;
    if (border === undefined) {
      clearedSides.add(side);
    } else {
      clearedSides.delete(side);
    }
  }
  return {
    horzMerge: cell.horzMerge,
    vertMerge: cell.vertMerge,
    borders: cellBordersFrom(sides),
    clearedSides: clearedSides.size > 0 ? clearedSides : undefined,
    background: cell.background,
  };
}

function withBackground(
  cell: TableCellProperties,
  background: Color | undefined,
): TableCellProperties {
  return {
    horzMerge: cell.horzMerge,
    vertMerge: cell.vertMerge,
    borders: cell.borders,
    clearedSides: cell.clearedSides,
    background,
  };
}

/** Applies a DefTableShdOperand's ([MS-DOC] 2.9.53) rgShd array from `firstCell` onward. The array carries "only ... elements necessary to define all shaded cells in the row", so cells past its end keep whatever an earlier sprm left them -- an entry that is present and states ShdAuto/ShdNil genuinely clears its own cell, which is how a real producer's full-length array turns a row's unshaded cells back off. */
function applyShdArray(
  definition: TableRowDefinition,
  operand: Uint8Array,
  firstCell: number,
  entrySize: number,
  colorAt: (operand: Uint8Array, offset: number) => Color | undefined,
): TableRowDefinition {
  const cb = readUint8(operand, 0);
  const count = Math.floor(cb / entrySize);
  return withCells(definition, (cell, index) => {
    const entry = index - firstCell;
    if (entry < 0 || entry >= count) return cell;
    return withBackground(cell, colorAt(operand, 1 + entry * entrySize));
  });
}

/** Applies a TableShadeOperand ([MS-DOC] 2.9.308): cb, an ItcFirstLim naming the range, then a single Shd applied to every cell the range covers -- not one Shd per cell. `step` is 1 for sprmTSetShd and 2 for sprmTSetShdOdd, whose own range covers every other cell from itcFirst. */
function applyTableShade(
  definition: TableRowDefinition,
  operand: Uint8Array,
  step: number,
): TableRowDefinition {
  const itcFirst = readUint8(operand, 1);
  const itcLim = readUint8(operand, 2);
  const background = readShd(operand, 3);
  return withCells(definition, (cell, index) => {
    if (index < itcFirst || index >= itcLim) return cell;
    if ((index - itcFirst) % step !== 0) return cell;
    return withBackground(cell, background);
  });
}

// Folds a row-ending mark's own grpprl into its TAP, the same last-Prl-wins convention pap.ts's applyParagraphSprms uses for paragraph sprms. sprmTDefTable is resolved in its own first pass, before every incremental sprm is folded on top in a second: none of them means anything until a column layout exists to fold it onto, and nothing in [MS-DOC] guarantees a real producer's own row mark writes them in any particular relative order within the grpprl, so the fold genuinely does not depend on which comes first rather than merely claiming not to. Within the second pass, order is honoured exactly as written, which is what makes a later sprmTSetBrc override the Brc80 sprmTDefTable already supplied and a later sprmTDefTableShdRaw override the sprmTDefTableShd before it -- the precedence a real producer relies on when it writes both.
export function applyTableSprms(
  prls: readonly Prl[],
  into: TableRowProperties,
): TableRowProperties {
  for (const prl of prls) {
    if (prl.sprm.sgc === SGC.table && prl.sprm.value === SPRM_T_DEF_TABLE) {
      into.definition = readTdefTableOperand(prl.operand);
    }
  }
  for (const prl of prls) {
    if (prl.sprm.sgc !== SGC.table) continue;
    switch (prl.sprm.value) {
      case SPRM_T_DEF_TABLE:
        break; // Already resolved above.
      case SPRM_T_DYA_ROW_HEIGHT: {
        // YAS: positive is "at least", negative is "exact" (the absolute value in either case); the shared schema's heightPt carries no such distinction, so both fold to the same plain height.
        const dyaRowHeight = readInt16LE(prl.operand, 0);
        const heightPt = Math.abs(dyaRowHeight) / TWIPS_PER_POINT;
        into.heightPt = heightPt > 0 ? heightPt : undefined;
        break;
      }
      case SPRM_T_MERGE: {
        // Applies on top of whatever sprmTDefTable established: the first cell in [itcFirst, itcLim) becomes the merge's anchor, every following cell in the range a continuation. Absent a definition at all (no sprmTDefTable anywhere in this grpprl), there is nothing to fold onto.
        if (into.definition === undefined) break;
        const itcFirst = readUint8(prl.operand, 0);
        const itcLim = readUint8(prl.operand, 1);
        into.definition = withCells(into.definition, (cell, index) => {
          if (index < itcFirst || index >= itcLim) return cell;
          return {
            horzMerge: index === itcFirst ? 2 : HORZ_MERGE_CONTINUATION,
            vertMerge: cell.vertMerge,
            borders: cell.borders,
            clearedSides: cell.clearedSides,
            background: cell.background,
          };
        });
        break;
      }
      case SPRM_T_VERT_MERGE: {
        // VertMergeOperand: cb (MUST be 2, not read here since operandSize already used it to size the operand), itc (the one cell this Prl names), vertMergeFlags (VerticalMergeFlag -- fvmClear 0, fvmMerge 1, fvmRestart 3). Applies on top of whatever sprmTDefTable established, exactly like sprmTMerge; a definition-less grpprl has nothing to fold onto.
        if (into.definition === undefined) break;
        const itc = readUint8(prl.operand, 1);
        const vertMergeFlags = readUint8(prl.operand, 2);
        into.definition = withCells(into.definition, (cell, index) =>
          index === itc
            ? {
                horzMerge: cell.horzMerge,
                vertMerge: vertMergeFlags,
                borders: cell.borders,
                clearedSides: cell.clearedSides,
                background: cell.background,
              }
            : cell,
        );
        break;
      }
      case SPRM_T_SET_BRC: {
        // TableBrcOperand: cb (MUST be 11), an ItcFirstLim, a bordersToApply bitmask, then one BrcMayBeNil for every side the mask names.
        if (into.definition === undefined) break;
        const itcFirst = readUint8(prl.operand, 1);
        const itcLim = readUint8(prl.operand, 2);
        const bordersToApply = readUint8(prl.operand, 3);
        const border = readBrc(prl.operand, 4);
        into.definition = withCells(into.definition, (cell, index) =>
          index < itcFirst || index >= itcLim
            ? cell
            : applyBrcToCell(cell, bordersToApply, border),
        );
        break;
      }
      case SPRM_T_DEF_TABLE_SHD:
      case SPRM_T_DEF_TABLE_SHD_2ND:
      case SPRM_T_DEF_TABLE_SHD_3RD:
      case SPRM_T_DEF_TABLE_SHD_RAW:
      case SPRM_T_DEF_TABLE_SHD_RAW_2ND:
      case SPRM_T_DEF_TABLE_SHD_RAW_3RD: {
        if (into.definition === undefined) break;
        const firstCell = SHD_ARRAY_FIRST_CELL[prl.sprm.value];
        if (firstCell === undefined) break;
        into.definition = applyShdArray(
          into.definition,
          prl.operand,
          firstCell,
          SHD_SIZE,
          readShd,
        );
        break;
      }
      case SPRM_T_DEF_TABLE_SHD80: {
        if (into.definition === undefined) break;
        into.definition = applyShdArray(
          into.definition,
          prl.operand,
          0,
          SHD80_SIZE,
          (operand, offset) => readShd80(readUint16LE(operand, offset)),
        );
        break;
      }
      case SPRM_T_SET_SHD: {
        if (into.definition === undefined) break;
        into.definition = applyTableShade(into.definition, prl.operand, 1);
        break;
      }
      case SPRM_T_SET_SHD_ODD: {
        if (into.definition === undefined) break;
        into.definition = applyTableShade(into.definition, prl.operand, 2);
        break;
      }
      case SPRM_T_TABLE_BORDERS_80: {
        if (into.definition === undefined) break;
        into.definition = {
          ...into.definition,
          rowBorders: readTableBordersOperand80(prl.operand),
        };
        break;
      }
      case SPRM_T_TABLE_BORDERS: {
        if (into.definition === undefined) break;
        into.definition = {
          ...into.definition,
          rowBorders: readTableBordersOperand(prl.operand),
        };
        break;
      }
      case SPRM_T_SET_SHD_TABLE: {
        if (into.definition === undefined) break;
        const background = readShd(prl.operand, 1);
        into.definition = withCells(into.definition, (cell) =>
          withBackground(cell, background),
        );
        break;
      }
      default:
        // Every other table sprm is a TAP layer this reader does not convert; see this module's own top-of-file note.
        break;
    }
  }
  return into;
}
