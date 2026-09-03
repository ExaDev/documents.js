import type { Color } from "document-schema.js";
import { readUint16LE, readUint8 } from "../bytes";
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

/** ToggleOperand, [MS-DOC] 2.9.336. 0x80 and 0x81 are relative to the style's own value rather than absolute. */
const TOGGLE_OFF = 0x00;
const TOGGLE_ON = 0x01;
const TOGGLE_INHERIT_FROM_STYLE = 0x80;
const TOGGLE_INVERT_STYLE = 0x81;

const HALF_POINTS_PER_POINT = 2;
const COLOR_COMPONENT_MAX = 255;

export interface CharacterProperties {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sizePt?: number;
  color?: Color;
  /** The istd of a character style applied by sprmCIstd, carried so a caller can resolve the style's own name. */
  istd?: number;
}

// The Ico palette, [MS-DOC] 2.9.126, reproduced exactly as published. Entry 0x00 is the one with fAuto set -- "the default color for the application" -- so it names no concrete colour and this reader leaves the run's colour unset rather than choosing black on the format's behalf.
//
// Entries 0x0C and 0x0D carry identical RGB values (0x80/0x00/0x80) in the published table, where the surrounding entries' pattern and every other palette of this shape would put dark red at 0x0D. That is reproduced rather than corrected: the table above is the normative statement of what the value means, and silently substituting a different colour would make this reader disagree with the specification it claims to implement on a point no test could catch. If a real-world corpus ever shows producers meaning dark red, that is the evidence to change it on.
const ICO_PALETTE: readonly (readonly [number, number, number] | undefined)[] =
  [
    undefined, // 0x00, fAuto -- automatic, no concrete colour.
    [0x00, 0x00, 0x00], // 0x01
    [0x00, 0x00, 0xff], // 0x02
    [0x00, 0xff, 0xff], // 0x03
    [0x00, 0xff, 0x00], // 0x04
    [0xff, 0x00, 0xff], // 0x05
    [0xff, 0x00, 0x00], // 0x06
    [0xff, 0xff, 0x00], // 0x07
    [0xff, 0xff, 0xff], // 0x08
    [0x00, 0x00, 0x80], // 0x09
    [0x00, 0x80, 0x80], // 0x0A
    [0x00, 0x80, 0x00], // 0x0B
    [0x80, 0x00, 0x80], // 0x0C
    [0x80, 0x00, 0x80], // 0x0D -- as published; see the note above.
    [0x80, 0x80, 0x00], // 0x0E
    [0x80, 0x80, 0x80], // 0x0F
    [0xc0, 0xc0, 0xc0], // 0x10
  ];

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

function icoColor(value: number): Color | undefined {
  if (value >= ICO_PALETTE.length) {
    throw new DocFormatError(
      `Ico value 0x${value.toString(16)} is not less than 0x11, the bound [MS-DOC] 2.9.126 places on the palette`,
    );
  }
  const entry = ICO_PALETTE[value];
  if (entry === undefined) return undefined;
  const [r, g, b] = entry;
  return {
    r: r / COLOR_COMPONENT_MAX,
    g: g / COLOR_COMPONENT_MAX,
    b: b / COLOR_COMPONENT_MAX,
  };
}

// COLORREF, [MS-DOC] 2.9.53: red, green and blue bytes followed by fAuto, where fAuto set means the application's default colour rather than the stated components.
function colorRefColor(operand: Uint8Array): Color | undefined {
  if (readUint8(operand, 3) !== 0x00) return undefined;
  return {
    r: readUint8(operand, 0) / COLOR_COMPONENT_MAX,
    g: readUint8(operand, 1) / COLOR_COMPONENT_MAX,
    b: readUint8(operand, 2) / COLOR_COMPONENT_MAX,
  };
}

// Folds a grpprl's character sprms into `into`, in order. [MS-DOC] 2.6's Applying Properties states the precedence rule the in-order fold implements directly: "it is valid for multiple Prls to modify the same property. In this event, the last Prl applied determines the value of that property."
//
// Mutating an accumulator rather than returning a fresh object is deliberate: the caller layers a style's own grpprl and then the direct CHPX exception onto the same value, which is exactly the order [MS-DOC] 2.4.6.6 prescribes, and a toggle sprm's 0x80/0x81 operands are defined relative to whatever the earlier layers left behind.
export function applyCharacterSprms(
  prls: readonly Prl[],
  into: CharacterProperties,
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
        into.color = colorRefColor(prl.operand);
        break;
      default:
        // Every other character sprm is a property this reader does not convert. Left alone rather than recorded: the package's scope is stated once, in its README, not restated as a per-property diagnostic on every run of every document.
        break;
    }
  }
  return into;
}
