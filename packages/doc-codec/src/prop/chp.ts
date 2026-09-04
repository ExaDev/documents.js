import type { Color } from "document-schema.js";
import { readInt16LE, readUint16LE, readUint8 } from "../bytes";
import { icoColor, readColorRef } from "../color";
import { DocFormatError } from "../errors";
import { SGC, type Prl } from "./sprm";

// Character properties, [MS-DOC] 2.6.2 -- the subset of the character-property sprm table this reader converts. Every opcode below was read off the specification's own table rather than recalled, and the ones this package does not yet act on (font selection through the font table, spacing, kerning, borders, revision marks, East Asian typography) are simply absent: an opcode present but ignored would read as support this package does not have.

/** sprmCFBold: a ToggleOperand switching bold. */
const SPRM_C_F_BOLD = 0x0835;
/** sprmCFItalic. */
const SPRM_C_F_ITALIC = 0x0836;
/** sprmCFStrike. */
const SPRM_C_F_STRIKE = 0x0837;
/** sprmCKul: a Kul value giving the underline style; anything but 0x00 is some kind of underline. */
const SPRM_C_KUL = 0x2a3e;
/** sprmCHps: "an unsigned 2-byte integer, in half-points", so points are the operand halved. */
const SPRM_C_HPS = 0x4a43;
/** sprmCIstd: the istd of a character style to apply. */
const SPRM_C_ISTD = 0x4a30;
/** sprmCIco: an Ico value, an index into [MS-DOC] 2.9.126's fixed 17-entry palette. */
const SPRM_C_ICO = 0x2a42;
/** sprmCCv: a COLORREF, the richer colour sprm that supersedes sprmCIco where both appear. */
const SPRM_C_CV = 0x6870;
/** sprmCRgFtc0: a 2-byte signed index into the font table (SttbfFfn) naming the font used "only if the conditions for using [sprmCRgFtc1/sprmCRgFtc2/sprmCFtcBi] do not apply" -- the default (non-East-Asian, non-complex-script) font, which is the only one this package reads or writes. */
const SPRM_C_RG_FTC_0 = 0x4a4f;

/** ToggleOperand, [MS-DOC] 2.9.336. 0x80 and 0x81 are relative to the style's own value rather than absolute. */
const TOGGLE_OFF = 0x00;
const TOGGLE_ON = 0x01;
const TOGGLE_INHERIT_FROM_STYLE = 0x80;
const TOGGLE_INVERT_STYLE = 0x81;

const HALF_POINTS_PER_POINT = 2;

export interface CharacterProperties {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sizePt?: number;
  color?: Color;
  fontFamily?: string;
  /** The istd of a character style applied by sprmCIstd, carried so a caller can resolve the style's own name. */
  istd?: number;
}

function toggle(operand: Uint8Array, current: boolean | undefined): boolean {
  const value = readUint8(operand, 0);
  switch (value) {
    case TOGGLE_OFF:
      return false;
    case TOGGLE_ON:
      return true;
    // "The Boolean property is set to match the value of the property in the current style that is applied to the text" -- since properties are layered style-first, the style's value is already what `current` holds.
    case TOGGLE_INHERIT_FROM_STYLE:
      return current ?? false;
    // "The Boolean property is set to the opposite of the value of the property in the current style."
    case TOGGLE_INVERT_STYLE:
      return !(current ?? false);
    default:
      throw new DocFormatError(
        `ToggleOperand value 0x${value.toString(16)} is none of the four [MS-DOC] 2.9.336 defines (0x00, 0x01, 0x80, 0x81)`,
      );
  }
}

// Folds a grpprl's character sprms into `into`, in order. [MS-DOC] 2.6's Applying Properties states the precedence rule the in-order fold implements directly: "it is valid for multiple Prls to modify the same property. In this event, the last Prl applied determines the value of that property."
//
// Mutating an accumulator rather than returning a fresh object is deliberate: the caller layers a style's own grpprl and then the direct CHPX exception onto the same value, which is exactly the order [MS-DOC] 2.4.6.6 prescribes, and a toggle sprm's 0x80/0x81 operands are defined relative to whatever the earlier layers left behind.
export function applyCharacterSprms(
  prls: readonly Prl[],
  into: CharacterProperties,
  // The font table (SttbfFfn, see ../style/fonts.ts) sprmCRgFtc0's operand indexes into. Threaded through rather than resolved by the caller after the fact, because folding is the one place every character sprm's precedence rule (last Prl wins) is already applied -- resolving fontFamily anywhere else would need this same in-order walk repeated.
  fonts?: readonly string[],
): CharacterProperties {
  for (const prl of prls) {
    if (prl.sprm.sgc !== SGC.character) continue;
    switch (prl.sprm.value) {
      case SPRM_C_F_BOLD:
        into.bold = toggle(prl.operand, into.bold);
        break;
      case SPRM_C_F_ITALIC:
        into.italic = toggle(prl.operand, into.italic);
        break;
      case SPRM_C_F_STRIKE:
        into.strike = toggle(prl.operand, into.strike);
        break;
      case SPRM_C_KUL:
        into.underline = readUint8(prl.operand, 0) !== 0x00;
        break;
      case SPRM_C_HPS:
        into.sizePt = readUint16LE(prl.operand, 0) / HALF_POINTS_PER_POINT;
        break;
      case SPRM_C_ISTD:
        into.istd = readUint16LE(prl.operand, 0);
        break;
      case SPRM_C_ICO:
        into.color = icoColor(readUint8(prl.operand, 0));
        break;
      case SPRM_C_CV:
        into.color = readColorRef(prl.operand, 0);
        break;
      case SPRM_C_RG_FTC_0: {
        const index = readInt16LE(prl.operand, 0);
        const name = fonts?.[index];
        if (name !== undefined) into.fontFamily = name;
        break;
      }
      default:
        // Every other character sprm is a property this reader does not convert. Left alone rather than recorded: the package's scope is stated once, in its README, not restated as a per-property diagnostic on every run of every document.
        break;
    }
  }
  return into;
}
