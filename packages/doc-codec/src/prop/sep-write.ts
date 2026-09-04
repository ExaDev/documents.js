import type { ContentSection } from "document-schema.js";
import { DocFormatError } from "../errors";

// The inverse of sep.ts's applySectionSprms: a ContentSection's pageSize/margins to a Sepx grpprl. Every margin is written in the positive, minimum-margin form of its YAS operand (see sep.ts's own marginFromYas comment) -- the same form the specification's own worked example uses, and the one a plain point value naturally maps to, since this writer has no header/footer geometry to grow a minimum margin against.

/** sprmSXaPage / sprmSYaPage: unsigned 2-byte twips, each constrained to [MS-DOC]'s own [144, 31680] page-dimension range. */
const SPRM_S_XA_PAGE = 0xb01f;
const SPRM_S_YA_PAGE = 0xb020;
/** sprmSDxaLeft / sprmSDxaRight: an unsigned 2-byte twips margin. */
const SPRM_S_DXA_LEFT = 0xb021;
const SPRM_S_DXA_RIGHT = 0xb022;
/** sprmSDyaTop / sprmSDyaBottom: a signed 2-byte twips margin, written positive (minimum-margin form). */
const SPRM_S_DYA_TOP = 0x9023;
const SPRM_S_DYA_BOTTOM = 0x9024;

const TWIPS_PER_POINT = 20;
/** sprmSXaPage/sprmSYaPage's own stated operand range, in twips. */
const MIN_PAGE_DIMENSION_TWIPS = 144;
const MAX_PAGE_DIMENSION_TWIPS = 31680;
/** sprmSDxaLeft/sprmSDxaRight's unsigned 2-byte operand range. */
const MAX_UINT16 = 0xffff;
/** sprmSDyaTop/sprmSDyaBottom's own stated magnitude range: "MUST be less than or equal to 31665 and greater than or equal to -31665." */
const MAX_MARGIN_TWIPS = 31665;

function pushSprm(
  bytes: number[],
  opcode: number,
  operand: readonly number[],
): void {
  bytes.push(opcode & 0xff, (opcode >> 8) & 0xff, ...operand);
}

function pointsToTwips(pt: number): number {
  return Math.round(pt * TWIPS_PER_POINT);
}

function uint16(
  value: number,
  min: number,
  max: number,
  what: string,
): number[] {
  if (value < min || value > max) {
    throw new DocFormatError(
      `${what} is ${value} twips, outside the ${min}..${max} range its sprm operand can hold`,
    );
  }
  return [value & 0xff, (value >> 8) & 0xff];
}

// Builds the Sepx grpprl for one section's page size and margins -- both required fields of ContentSection (document-schema.js), so this always emits all six sprms.
export function encodeSectionGrpprl(
  section: Pick<ContentSection, "pageSize" | "margins">,
): number[] {
  const bytes: number[] = [];
  pushSprm(
    bytes,
    SPRM_S_XA_PAGE,
    uint16(
      pointsToTwips(section.pageSize.widthPt),
      MIN_PAGE_DIMENSION_TWIPS,
      MAX_PAGE_DIMENSION_TWIPS,
      "section pageSize.widthPt",
    ),
  );
  pushSprm(
    bytes,
    SPRM_S_YA_PAGE,
    uint16(
      pointsToTwips(section.pageSize.heightPt),
      MIN_PAGE_DIMENSION_TWIPS,
      MAX_PAGE_DIMENSION_TWIPS,
      "section pageSize.heightPt",
    ),
  );
  pushSprm(
    bytes,
    SPRM_S_DXA_LEFT,
    uint16(
      pointsToTwips(section.margins.leftPt),
      0,
      MAX_UINT16,
      "section margins.leftPt",
    ),
  );
  pushSprm(
    bytes,
    SPRM_S_DXA_RIGHT,
    uint16(
      pointsToTwips(section.margins.rightPt),
      0,
      MAX_UINT16,
      "section margins.rightPt",
    ),
  );
  pushSprm(
    bytes,
    SPRM_S_DYA_TOP,
    uint16(
      pointsToTwips(section.margins.topPt),
      0,
      MAX_MARGIN_TWIPS,
      "section margins.topPt",
    ),
  );
  pushSprm(
    bytes,
    SPRM_S_DYA_BOTTOM,
    uint16(
      pointsToTwips(section.margins.bottomPt),
      0,
      MAX_MARGIN_TWIPS,
      "section margins.bottomPt",
    ),
  );
  return bytes;
}

/** Sepx, [MS-DOC] 2.9.279: a 2-byte cb (grpprl's own length) followed by the grpprl itself. */
export function buildSepx(grpprl: readonly number[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2 + grpprl.length);
  new DataView(bytes.buffer).setUint16(0, grpprl.length, true);
  bytes.set(grpprl, 2);
  return bytes;
}

/** PlcfSed for exactly one section: two CPs (0 and ccpText) bracketing the single Sed ([MS-DOC] 2.9.269) this writer ever emits, whose fcSepx names where buildSepx's own bytes were placed in the WordDocument stream and whose fn/fnMpr/fcMpr fields carry the values [MS-DOC] states are ignored. */
export function buildPlcfSed(
  ccpText: number,
  fcSepx: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4 + 4 + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0, true); // cp[0]: the section starts at the beginning of the main document.
  view.setUint32(4, ccpText, true); // cp[1]: the terminating CP, at or beyond the end of the main document.
  view.setUint16(8, 0, true); // sed.fn -- ignored.
  view.setUint32(10, fcSepx, true); // sed.fcSepx.
  view.setUint16(14, 0, true); // sed.fnMpr -- ignored.
  view.setUint32(16, 0xffffffff, true); // sed.fcMpr -- ignored.
  return bytes;
}
