import { readInt16LE, readUint16LE, readUint8 } from "../bytes";
import { SGC, type Prl } from "../prop/sprm";

// Table row properties (TAP), [MS-DOC] 2.4.3 (Overview of Tables) and 2.6.4 (Table Properties) -- the row-ending mark's own grpprl carries sgc-5 (table) sprms alongside the ordinary sgc-1 (paragraph) sprms pap.ts already folds. Of the roughly seventy table sprms 2.6.4 names, this reader acts on exactly four: sprmTDefTable, which alone carries the row's own column boundaries and every physical cell's horizontal/vertical merge state (via TC80.tcgrf -- [MS-DOC] 2.9.341's TC80, 2.9.339's TCGRF); sprmTMerge, an ItcFirstLim range this package's own writer additionally emits for a horizontal merge because TC80.tcgrf.horzMerge alone -- though genuinely spec-conformant -- was verified against a real, independent [MS-DOC] implementation (LibreOffice) not to be honoured for horizontal merging (its own vertMerge from the identical TC80 array was), so a real producer's own choice of mechanism is read here too, folded on top of whatever sprmTDefTable already established; sprmTVertMerge, the incremental per-cell equivalent for a vertical merge (this package's own writer states a vertical merge only through TC80.tcgrf, but a real producer may equally state it incrementally, the same asymmetry sprmTMerge exists to cover on the horizontal side); and sprmTDyaRowHeight, the row's own height. Every other sgc-5 sprm -- borders, shading, table style, absolute position, cell padding, and the rest -- is a genuine TAP layer this package does not implement; see the README's own scope note for what that leaves unread.

const SPRM_T_DEF_TABLE = 0xd608;
const SPRM_T_DYA_ROW_HEIGHT = 0x9407;
/** sprmTMerge: an ItcFirstLim naming a range of cells to horizontally merge, the first cell becoming the anchor -- the mechanism a real Word producer actually uses for a horizontal merge (see tap-write.ts's own note on why this reader also honours it, not only TC80.tcgrf.horzMerge). */
const SPRM_T_MERGE = 0x5624;
/** sprmTVertMerge (0xD62B): a VertMergeOperand naming one cell (itc) and its own VerticalMergeFlag, the incremental per-cell equivalent of sprmTMerge for a vertical merge. */
const SPRM_T_VERT_MERGE = 0xd62b;

const TWIPS_PER_POINT = 20;
/** TC80's own fixed size, [MS-DOC] 2.9.341: tcgrf (2) + wWidth (2) + brcTop/brcLeft/brcBottom/brcRight (4 each). */
const TC80_SIZE = 20;

/** TCGRF.horzMerge, [MS-DOC] 2.9.339: 0 not merged, 1 a continuation cell (contributes its layout region, its own contents are not rendered), 2 or 3 the first cell of a horizontally merged set. */
export const HORZ_MERGE_CONTINUATION = 1;
/** VerticalMergeFlag's fvmMerge: TCGRF.vertMerge continuation (fvmClear=0, fvmMerge=1, fvmRestart=3 -- 2 is not a defined member). */
export const VERT_MERGE_CONTINUATION = 1;
export const VERT_MERGE_RESTART = 3;

export interface TableCellMerge {
  readonly horzMerge: number;
  readonly vertMerge: number;
}

export interface TableRowDefinition {
  /** rgdxaCenter, in twips: one more entry than there are physical cells in the row -- column i's width is boundaries[i + 1] - boundaries[i]. */
  readonly columnBoundariesTwips: readonly number[];
  /** One entry per physical cell in the row, in document order -- every physical cell the row's own cell marks delimit, horizontally- and vertically-merged-away cells included, exactly as [MS-DOC]'s own model keeps them all present. */
  readonly cells: readonly TableCellMerge[];
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
  const cells: TableCellMerge[] = [];
  for (let index = 0; index < numberOfColumns; index += 1) {
    const tc80Offset = tc80Start + index * TC80_SIZE;
    // "If there are fewer TC80s than columns, the remaining columns are formatted with the default TC80 formatting" -- an all-zero TCGRF, i.e. no merge in either direction.
    if (tc80Offset + 2 > operand.length) {
      cells.push({ horzMerge: 0, vertMerge: 0 });
      continue;
    }
    const tcgrf = readUint16LE(operand, tc80Offset);
    cells.push({ horzMerge: tcgrf & 0x3, vertMerge: (tcgrf >> 5) & 0x3 });
  }
  return { columnBoundariesTwips, cells };
}

// Folds a row-ending mark's own grpprl into its TAP, the same last-Prl-wins convention pap.ts's applyParagraphSprms uses for paragraph sprms. sprmTDefTable is resolved in its own first pass, before sprmTMerge/sprmTVertMerge are folded on top in a second: neither means anything until a column layout exists to fold it onto, and nothing in [MS-DOC] guarantees a real producer's own row mark writes them in any particular relative order within the grpprl, so the fold genuinely does not depend on which comes first rather than merely claiming not to.
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
        into.definition = {
          columnBoundariesTwips: into.definition.columnBoundariesTwips,
          cells: into.definition.cells.map((cell, index) => {
            if (index < itcFirst || index >= itcLim) return cell;
            return {
              horzMerge: index === itcFirst ? 2 : HORZ_MERGE_CONTINUATION,
              vertMerge: cell.vertMerge,
            };
          }),
        };
        break;
      }
      case SPRM_T_VERT_MERGE: {
        // VertMergeOperand: cb (MUST be 2, not read here since operandSize already used it to size the operand), itc (the one cell this Prl names), vertMergeFlags (VerticalMergeFlag -- fvmClear 0, fvmMerge 1, fvmRestart 3). Applies on top of whatever sprmTDefTable established, exactly like sprmTMerge; a definition-less grpprl has nothing to fold onto.
        if (into.definition === undefined) break;
        const itc = readUint8(prl.operand, 1);
        const vertMergeFlags = readUint8(prl.operand, 2);
        into.definition = {
          columnBoundariesTwips: into.definition.columnBoundariesTwips,
          cells: into.definition.cells.map((cell, index) =>
            index === itc
              ? { horzMerge: cell.horzMerge, vertMerge: vertMergeFlags }
              : cell,
          ),
        };
        break;
      }
      default:
        // Every other table sprm is a TAP layer this reader does not convert; see this module's own top-of-file note.
        break;
    }
  }
  return into;
}
