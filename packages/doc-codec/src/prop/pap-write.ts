import type { Alignment, ContentParagraph } from "document-schema.js";
import { DocFormatError } from "../errors";

// The inverse of pap.ts's applyParagraphSprms: a ContentParagraph's direct paragraph formatting to a PapxInFkp grpprl. Each property emits the LOGICAL sprm pap.ts reads (sprmPJc rather than sprmPJc80, sprmPDxaLeft rather than sprmPDxaLeft80) -- the "80" spellings exist for pre-2000 producers this package has no reason to imitate, and pap.ts's own last-Prl-wins fold means writing only the logical form round-trips exactly.
//
// Opcodes are restated as local constants rather than imported from pap.ts, for the same reason chp-write.ts restates chp.ts's: this module's exports are coupled to the specification's own opcode table, not to a sibling module's private switch-case names.

/** sprmPJc: a 1-byte logical justification. */
const SPRM_P_JC = 0x2461;
/** sprmPDxaLeft / sprmPDxaLeft1 / sprmPDxaRight: 2-byte signed twips. */
const SPRM_P_DXA_LEFT = 0x845e;
const SPRM_P_DXA_LEFT1 = 0x8460;
const SPRM_P_DXA_RIGHT = 0x845d;
/** sprmPDyaBefore / sprmPDyaAfter: 2-byte unsigned twips. */
const SPRM_P_DYA_BEFORE = 0xa413;
const SPRM_P_DYA_AFTER = 0xa414;
/** sprmPDyaLine: a 4-byte LSPD (dyaLine int16, fMultLinespace uint16). */
const SPRM_P_DYA_LINE = 0x6412;
/** sprmPFPageBreakBefore: a 1-byte Bool8. */
const SPRM_P_F_PAGE_BREAK_BEFORE = 0x2407;

const TWIPS_PER_POINT = 20;
const LSPD_MULTIPLE_DIVISOR = 240;
const LSPD_MAX_MULTIPLE_DYA_LINE = 0x7bc0;
/** sprmPDxaLeft/Right/Left1's signed 2-byte operand range. */
const MIN_INT16 = -0x8000;
const MAX_INT16 = 0x7fff;
/** sprmPDyaBefore/After's unsigned 2-byte operand range. */
const MAX_UINT16 = 0xffff;

const JC_VALUE: Record<Alignment, number> = {
  left: 0,
  center: 1,
  right: 2,
  justify: 3,
};

function pushSprm(
  bytes: number[],
  opcode: number,
  operand: readonly number[],
): void {
  bytes.push(opcode & 0xff, (opcode >> 8) & 0xff, ...operand);
}

function int16(value: number, what: string): number[] {
  const rounded = Math.round(value);
  if (rounded < MIN_INT16 || rounded > MAX_INT16) {
    throw new DocFormatError(
      `${what} is ${rounded} twips, outside the ${MIN_INT16}..${MAX_INT16} range a signed 2-byte sprm operand can hold`,
    );
  }
  const unsigned = rounded < 0 ? rounded + 0x10000 : rounded;
  return [unsigned & 0xff, (unsigned >> 8) & 0xff];
}

function uint16(value: number, what: string): number[] {
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > MAX_UINT16) {
    throw new DocFormatError(
      `${what} is ${rounded} twips, outside the 0..${MAX_UINT16} range an unsigned 2-byte sprm operand can hold`,
    );
  }
  return [rounded & 0xff, (rounded >> 8) & 0xff];
}

function pointsToTwips(pt: number): number {
  return pt * TWIPS_PER_POINT;
}

// Builds the PapxInFkp grpprl for one paragraph's direct formatting (excluding istd, which write.ts's caller places in GrpPrlAndIstd's own field rather than as a sprm -- see prop/fkp-write.ts). Returns an empty array for a paragraph with no direct formatting at all.
export function encodeParagraphGrpprl(
  paragraph: Pick<
    ContentParagraph,
    | "alignment"
    | "indentLeftPt"
    | "indentRightPt"
    | "indentFirstLinePt"
    | "spacingBeforePt"
    | "spacingAfterPt"
    | "lineSpacing"
    | "pageBreakBefore"
  >,
): number[] {
  const bytes: number[] = [];
  if (paragraph.alignment !== undefined) {
    pushSprm(bytes, SPRM_P_JC, [JC_VALUE[paragraph.alignment]]);
  }
  if (paragraph.indentLeftPt !== undefined) {
    pushSprm(
      bytes,
      SPRM_P_DXA_LEFT,
      int16(pointsToTwips(paragraph.indentLeftPt), "paragraph indentLeftPt"),
    );
  }
  if (paragraph.indentRightPt !== undefined) {
    pushSprm(
      bytes,
      SPRM_P_DXA_RIGHT,
      int16(pointsToTwips(paragraph.indentRightPt), "paragraph indentRightPt"),
    );
  }
  if (paragraph.indentFirstLinePt !== undefined) {
    pushSprm(
      bytes,
      SPRM_P_DXA_LEFT1,
      int16(
        pointsToTwips(paragraph.indentFirstLinePt),
        "paragraph indentFirstLinePt",
      ),
    );
  }
  if (paragraph.spacingBeforePt !== undefined) {
    pushSprm(
      bytes,
      SPRM_P_DYA_BEFORE,
      uint16(
        pointsToTwips(paragraph.spacingBeforePt),
        "paragraph spacingBeforePt",
      ),
    );
  }
  if (paragraph.spacingAfterPt !== undefined) {
    pushSprm(
      bytes,
      SPRM_P_DYA_AFTER,
      uint16(
        pointsToTwips(paragraph.spacingAfterPt),
        "paragraph spacingAfterPt",
      ),
    );
  }
  if (paragraph.lineSpacing !== undefined) {
    const dyaLine = Math.round(paragraph.lineSpacing * LSPD_MULTIPLE_DIVISOR);
    if (dyaLine < 0 || dyaLine > LSPD_MAX_MULTIPLE_DYA_LINE) {
      throw new DocFormatError(
        `paragraph lineSpacing ${paragraph.lineSpacing} produces an LSPD.dyaLine of ${dyaLine}, outside the 0..${LSPD_MAX_MULTIPLE_DYA_LINE} range the multiplier form permits`,
      );
    }
    pushSprm(bytes, SPRM_P_DYA_LINE, [
      ...int16(dyaLine, "paragraph lineSpacing"),
      0x01,
      0x00, // fMultLinespace = 1: the multiplier form.
    ]);
  }
  if (paragraph.pageBreakBefore === true) {
    pushSprm(bytes, SPRM_P_F_PAGE_BREAK_BEFORE, [0x01]);
  }
  return bytes;
}
