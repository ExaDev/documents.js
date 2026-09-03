import type { Alignment } from "document-schema.js";
import { readInt16LE, readUint16LE, readUint32LE, readUint8 } from "../bytes";
import { SGC, type Prl } from "./sprm";

// Paragraph properties, [MS-DOC] 2.6.3 -- the subset of the paragraph-property sprm table this reader converts. As with the character side, an opcode this package does not act on is absent rather than present-and-ignored.
//
// Several properties exist in two spellings: a "physical" or "80" form kept for compatibility with pre-2000 producers, and a "logical" form that supersedes it. Both are read, in the table order the specification lists them, so a later logical sprm naturally wins over an earlier physical one through the same last-Prl-wins fold every other property uses -- no precedence special case needed.

/** sprmPIstd: the istd of the paragraph style. */
const SPRM_P_ISTD = 0x4600;
/** sprmPJc80: physical justification, six values. */
const SPRM_P_JC_80 = 0x2403;
/** sprmPJc: logical justification, ten values aligned with ECMA-376's ST_Jc. */
const SPRM_P_JC = 0x2461;
/** sprmPFPageBreakBefore: a Bool8. */
const SPRM_P_F_PAGE_BREAK_BEFORE = 0x2407;
/** sprmPDxaLeft80 / sprmPDxaLeft: the left indent in twips. */
const SPRM_P_DXA_LEFT_80 = 0x840f;
const SPRM_P_DXA_LEFT = 0x845e;
/** sprmPDxaRight80 / sprmPDxaRight: the right indent in twips. */
const SPRM_P_DXA_RIGHT_80 = 0x840e;
const SPRM_P_DXA_RIGHT = 0x845d;
/** sprmPDxaLeft180 / sprmPDxaLeft1: the first line's indent relative to the rest of the paragraph. */
const SPRM_P_DXA_LEFT1_80 = 0x8411;
const SPRM_P_DXA_LEFT1 = 0x8460;
/** sprmPDyaBefore / sprmPDyaAfter: spacing in twips. */
const SPRM_P_DYA_BEFORE = 0xa413;
const SPRM_P_DYA_AFTER = 0xa414;
/** sprmPDyaLine: an LSPD. */
const SPRM_P_DYA_LINE = 0x6412;
/** sprmPOutLvl: the zero-based outline level, or 0x9 for body text. */
const SPRM_P_OUT_LVL = 0x2640;
/** sprmPFInTable: a Bool8 that "MUST be 1 any time the table depth is greater than zero". */
const SPRM_P_F_IN_TABLE = 0x2416;
/** sprmPFTtp: marks a cell mark as a table-terminating-paragraph mark, i.e. the end of a row. */
const SPRM_P_F_TTP = 0x2417;
/** sprmPIlvl: the zero-based list level, or 0xC for a paragraph the list skips. */
const SPRM_P_ILVL = 0x260a;
/** sprmPIlfo: which list the paragraph is in, as an index into PlfLfo.rgLfo. */
const SPRM_P_ILFO = 0x460b;
/** sprmPItap: the paragraph's own table depth -- read only far enough to detect a depth greater than 1 (a table nested inside a table cell), which this package refuses rather than mis-reads. */
const SPRM_P_ITAP = 0x6649;
/** sprmPFInnerTableCell / sprmPFInnerTtp: a nested table's own cell-ending or row-ending mark. Neither is acted on beyond refusing the nested table it signals. */
const SPRM_P_F_INNER_TABLE_CELL = 0x244b;
const SPRM_P_F_INNER_TTP = 0x244c;

const TWIPS_PER_POINT = 20;
/** LSPD: "The spacing multiplier is dyaLine/240." */
const LSPD_MULTIPLE_DIVISOR = 240;
/** LSPD.dyaLine's multiplier form applies only "when dyaLine is between 0x0000 and 0x7BC0". */
const LSPD_MAX_MULTIPLE_DYA_LINE = 0x7bc0;
/** sprmPOutLvl's "0x9 - The paragraph at any outline level; instead, the paragraph is body text." */
const OUT_LVL_BODY_TEXT = 0x9;
/** sprmPIlvl's "0xC - The list skips this paragraph and does not include it in its numbering." */
const ILVL_SKIPPED = 0xc;
/** sprmPIlfo's two "not in a list" values: "0x0000 - This paragraph is not in a list" and "0xF801 - This paragraph is not in a list." */
const ILFO_NOT_IN_LIST = 0x0000;
const ILFO_NOT_IN_LIST_ALT = -2047; // 0xF801 read as a 16-bit signed integer.

export interface ParagraphProperties {
  istd?: number;
  alignment?: Alignment;
  indentLeftPt?: number;
  indentRightPt?: number;
  indentFirstLinePt?: number;
  spacingBeforePt?: number;
  spacingAfterPt?: number;
  lineSpacing?: number;
  pageBreakBefore?: boolean;
  /** sprmPOutLvl's zero-based level, present only when the paragraph is genuinely in an outline level rather than body text. */
  outlineLevel?: number;
  inTable?: boolean;
  /** True on the cell mark that terminates a table row. */
  tableRowEnd?: boolean;
  listLevel?: number;
  /** The list identifier (sprmPIlfo), present only when the paragraph is in a list at all. */
  listId?: number;
  /** sprmPItap's own table depth, present only when the sprm is; a value greater than 1 marks a table nested inside a table cell. */
  tableDepth?: number;
  /** True when sprmPFInnerTableCell or sprmPFInnerTtp is set -- a nested table's own cell/row-ending mark, carried purely as a refusal signal since this package's table support does not descend into a nested table. */
  nestedTableMark?: boolean;
}

function twipsToPoints(twips: number): number {
  return twips / TWIPS_PER_POINT;
}

// Both justification sprms share the first four values with ECMA-376's ST_Jc. The remaining values are compression-ratio and Kashida variants of justified text, all of which the shared content schema spells "justify" -- there is no finer alignment vocabulary to map them onto, and mapping them to "left" would be a visible layout change rather than a lost nuance.
function alignmentFromJc(value: number): Alignment | undefined {
  switch (value) {
    case 0:
      return "left";
    case 1:
      return "center";
    case 2:
      return "right";
    case 3:
    case 4:
    case 5:
    case 7:
    case 8:
    case 9:
      return "justify";
    // sprmPJc's 6 is "Paragraph is indented", which names an indent rather than an alignment and has no ST_Jc equivalent; left unmapped rather than approximated.
    default:
      return undefined;
  }
}

// LSPD, [MS-DOC] 2.9.150. Only the multiplier form maps onto the shared schema's `lineSpacing`, which is documented as a multiple of the single line height. The absolute forms -- "the line spacing, in twips, is exactly 0x10000 minus dyaLine" for an exact value, and "dyaLine or the number of twips necessary for single spacing, whichever value is greater" for an at-least value -- are spacing in absolute units, which that field cannot express, so they are left unset rather than converted through a font size this reader does not know.
function lineSpacingFromLspd(operand: Uint8Array): number | undefined {
  const dyaLine = readInt16LE(operand, 0);
  const fMultLinespace = readUint16LE(operand, 2);
  if (fMultLinespace !== 0x0001) return undefined;
  if (dyaLine < 0 || dyaLine > LSPD_MAX_MULTIPLE_DYA_LINE) return undefined;
  const multiple = dyaLine / LSPD_MULTIPLE_DIVISOR;
  return multiple > 0 ? multiple : undefined;
}

// Folds a grpprl's paragraph sprms into `into`, in order, so the last Prl to touch a property determines it -- the precedence rule [MS-DOC] 2.6's Applying Properties states. The caller layers the paragraph style's own grpprl first and the direct PAPX exception second, matching [MS-DOC] 2.4.6.6.
export function applyParagraphSprms(
  prls: readonly Prl[],
  into: ParagraphProperties,
): ParagraphProperties {
  for (const prl of prls) {
    if (prl.sprm.sgc !== SGC.paragraph) continue;
    switch (prl.sprm.value) {
      case SPRM_P_ISTD:
        into.istd = readUint16LE(prl.operand, 0);
        break;
      case SPRM_P_JC_80:
      case SPRM_P_JC:
        into.alignment = alignmentFromJc(readUint8(prl.operand, 0));
        break;
      case SPRM_P_F_PAGE_BREAK_BEFORE:
        into.pageBreakBefore = readUint8(prl.operand, 0) !== 0;
        break;
      case SPRM_P_DXA_LEFT_80:
      case SPRM_P_DXA_LEFT:
        into.indentLeftPt = twipsToPoints(readInt16LE(prl.operand, 0));
        break;
      case SPRM_P_DXA_RIGHT_80:
      case SPRM_P_DXA_RIGHT:
        into.indentRightPt = twipsToPoints(readInt16LE(prl.operand, 0));
        break;
      case SPRM_P_DXA_LEFT1_80:
      case SPRM_P_DXA_LEFT1:
        into.indentFirstLinePt = twipsToPoints(readInt16LE(prl.operand, 0));
        break;
      case SPRM_P_DYA_BEFORE:
        into.spacingBeforePt = twipsToPoints(readUint16LE(prl.operand, 0));
        break;
      case SPRM_P_DYA_AFTER:
        into.spacingAfterPt = twipsToPoints(readUint16LE(prl.operand, 0));
        break;
      case SPRM_P_DYA_LINE:
        into.lineSpacing = lineSpacingFromLspd(prl.operand);
        break;
      case SPRM_P_OUT_LVL: {
        const level = readUint8(prl.operand, 0);
        into.outlineLevel = level === OUT_LVL_BODY_TEXT ? undefined : level;
        break;
      }
      case SPRM_P_F_IN_TABLE:
        into.inTable = readUint8(prl.operand, 0) !== 0;
        break;
      case SPRM_P_F_TTP:
        into.tableRowEnd = readUint8(prl.operand, 0) !== 0;
        break;
      case SPRM_P_ILVL: {
        const level = readUint8(prl.operand, 0);
        into.listLevel = level === ILVL_SKIPPED ? undefined : level;
        break;
      }
      case SPRM_P_ILFO: {
        const ilfo = readInt16LE(prl.operand, 0);
        into.listId =
          ilfo === ILFO_NOT_IN_LIST || ilfo === ILFO_NOT_IN_LIST_ALT
            ? undefined
            : Math.abs(ilfo);
        break;
      }
      case SPRM_P_ITAP:
        into.tableDepth = readUint32LE(prl.operand, 0);
        break;
      case SPRM_P_F_INNER_TABLE_CELL:
      case SPRM_P_F_INNER_TTP:
        if (readUint8(prl.operand, 0) !== 0) into.nestedTableMark = true;
        break;
      default:
        // Every other paragraph sprm is a property this reader does not convert; see the README's scope note.
        break;
    }
  }
  return into;
}
