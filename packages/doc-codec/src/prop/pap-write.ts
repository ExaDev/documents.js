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
/** sprmPIlfo: a 2-byte signed one-based index into PlfLfo.rgLfo -- which list membership names. */
const SPRM_P_ILFO = 0x460b;
/** sprmPIlvl: a 1-byte zero-based list level. */
const SPRM_P_ILVL = 0x260a;
/** sprmPIlvl's own 0..8 range: a non-simple list's LSTF always carries exactly nine LVLs ([MS-DOC] 2.9.148), so a level outside it names a depth this format cannot express at all. */
const MAX_LIST_LEVEL = 8;

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
//
// `ilfoOf` resolves a paragraph's own ContentListMembership.numId to the one-based ilfo write.ts's own list/numbering-write.ts minted for it (every distinct numId in the document, in first-occurrence order -- see that module's own top comment) -- required whenever ANY paragraph in the call's document carries `list`, even one whose own numId this particular paragraph does not use, since the caller mints the whole map once up front. A paragraph whose `list` names a level but no numId (document-schema.js's own "a source format carries only a depth" case, e.g. an OOXML drawing paragraph's a:pPr/@lvl) writes neither sprm: [MS-DOC] has no way to state a list level without a list to belong to, so this is a genuine, permanent format gap rather than something to approximate -- the identical silent-drop precedent this writer already applies to hyperlinks and fields (see the README's own Writing scope table).
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
    | "list"
  >,
  ilfoOf: (numId: string) => number,
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
  if (paragraph.list?.numId !== undefined) {
    if (paragraph.list.level > MAX_LIST_LEVEL) {
      throw new DocFormatError(
        `paragraph list level ${paragraph.list.level} is outside the 0..${MAX_LIST_LEVEL} range a non-simple LSTF's fixed nine LVLs can address`,
      );
    }
    // sprmPIlvl is written before sprmPIlfo -- not because [MS-DOC] itself states an ordering constraint here (it doesn't: nothing in the spec's own sprm field tables requires one Prl to precede the other), but because a real consumer's own list-formatting code does, confirmed directly against a real LibreOffice-authored .doc's own paragraph grpprl, which always states level before id. A real consumer applies a paragraph's list membership at the moment it sees the id sprm, using whatever level the grpprl has already set by that point, so id-before-level silently flattens every level back to 0 on read by any consumer but this package's own. This package's own reader cannot catch a regression here: prop/pap.ts folds sprms by last-Prl-wins regardless of the order they arrived in, so a round trip through this package alone reads back correctly either way -- the identical shape of self-blind-spot bug ExaDev/documents.js#892 was (a lenient reader tolerating bytes a real, stricter consumer rejects), just for an sprm's own operand order rather than a missing trailing byte.
    pushSprm(bytes, SPRM_P_ILVL, [paragraph.list.level]);
    pushSprm(
      bytes,
      SPRM_P_ILFO,
      int16(ilfoOf(paragraph.list.numId), "paragraph list ilfo"),
    );
  }
  return bytes;
}
