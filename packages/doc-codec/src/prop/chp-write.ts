import type { ContentRun } from "document-schema.js";
import { colorRefBytes } from "../color";
import { DocFormatError } from "../errors";

// The inverse of chp.ts's applyCharacterSprms: a ContentRun's direct character formatting to a Chpx grpprl -- the bytes a ChpxFkp entry carries (see prop/fkp-write.ts). Each property this package's reader folds gets exactly the sprm chp.ts itself reads back, so a round trip through readDocContent(writeDocContent(x)) recovers the identical value rather than a lossy approximation through a different (but readable) encoding -- sprmCCv for colour rather than the fixed 17-entry sprmCIco palette, for instance, since sprmCCv carries the colour exactly and sprmCIco would have to snap it to the nearest palette entry.
//
// Opcodes are restated as local constants rather than imported from chp.ts: that module names them for its OWN switch cases, and importing them here would couple this file's exports to chp.ts's private naming rather than to the specification both independently cite.

/** sprmCFBold, sprmCFItalic, sprmCFStrike: a 1-byte ToggleOperand, [MS-DOC] 2.9.336. 0x00 and 0x01 are the only values this writer emits -- 0x80/0x81 (inherit/invert relative to a style) have no meaning here, since this package writes no style sheet for a run's character properties to inherit from. */
const SPRM_C_F_BOLD = 0x0835;
const SPRM_C_F_ITALIC = 0x0836;
const SPRM_C_F_STRIKE = 0x0837;
/** sprmCKul: a 1-byte Kul value. 0x00 is "none"; 0x01 is kulSingle, the only underline style ContentRun.underline can express (a plain boolean, not a style enum). */
const SPRM_C_KUL = 0x2a3e;
const KUL_NONE = 0x00;
const KUL_SINGLE = 0x01;
/** sprmCHps: a 2-byte unsigned half-point size. */
const SPRM_C_HPS = 0x4a43;
/** sprmCCv: a 4-byte COLORREF (r, g, b, fAuto). fAuto 0x00 means "use these components", the only form this writer emits. */
const SPRM_C_CV = 0x6870;
/** sprmCRgFtc0: a 2-byte signed index into the font table, [MS-DOC] 2.6.2 -- see style/fonts.ts. */
const SPRM_C_RG_FTC_0 = 0x4a4f;

const HALF_POINTS_PER_POINT = 2;
/** sprmCHps's own operand range: an unsigned 2-byte half-point value. */
const MAX_HPS = 0xffff;

function pushSprm(
  bytes: number[],
  opcode: number,
  operand: readonly number[],
): void {
  bytes.push(opcode & 0xff, (opcode >> 8) & 0xff, ...operand);
}

function toggle(value: boolean): number[] {
  return [value ? 0x01 : 0x00];
}

function uint16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

// Builds the Chpx grpprl for one run's direct formatting. Returns an empty array for a run with no formatting at all, which the caller (write.ts) treats as "no exception" -- exactly the rgb-zero case parseChpxFkp reads back as undefined.
export function encodeCharacterGrpprl(
  run: Pick<
    ContentRun,
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "sizePt"
    | "color"
    | "fontFamily"
  >,
  fontIndexOf: (name: string) => number,
): number[] {
  const bytes: number[] = [];
  if (run.bold !== undefined) pushSprm(bytes, SPRM_C_F_BOLD, toggle(run.bold));
  if (run.italic !== undefined) {
    pushSprm(bytes, SPRM_C_F_ITALIC, toggle(run.italic));
  }
  if (run.strike !== undefined) {
    pushSprm(bytes, SPRM_C_F_STRIKE, toggle(run.strike));
  }
  if (run.underline !== undefined) {
    pushSprm(bytes, SPRM_C_KUL, [run.underline ? KUL_SINGLE : KUL_NONE]);
  }
  if (run.sizePt !== undefined) {
    const halfPoints = Math.round(run.sizePt * HALF_POINTS_PER_POINT);
    if (halfPoints < 0 || halfPoints > MAX_HPS) {
      throw new DocFormatError(
        `run sizePt ${run.sizePt} is ${halfPoints} half-points, outside the 0..${MAX_HPS} range sprmCHps's unsigned 2-byte operand can hold`,
      );
    }
    pushSprm(bytes, SPRM_C_HPS, uint16(halfPoints));
  }
  if (run.color !== undefined) {
    pushSprm(bytes, SPRM_C_CV, colorRefBytes(run.color));
  }
  if (run.fontFamily !== undefined) {
    pushSprm(bytes, SPRM_C_RG_FTC_0, uint16(fontIndexOf(run.fontFamily)));
  }
  return bytes;
}
