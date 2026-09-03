import { readUint16LE, readUint8, slice } from "../bytes";
import { DocFormatError, DocUnsupportedError } from "../errors";

// The Sprm ("Single Property Modifier"), [MS-DOC] 2.6.1 and 2.9.244 -- the two-byte opcode every formatting change in the format is expressed as, and the Prl that pairs it with an operand. A grpprl is just a run of Prls back to back, with nothing marking where one ends: the only way to find the next is to size the current one's operand from its own opcode. Get one size wrong and every Prl after it in that grpprl is read from the wrong offset, so the operand-size table below is the single most load-bearing piece of arithmetic in this package after the piece table.

export interface Sprm {
  /** The raw 16-bit opcode, which is what the property tables in [MS-DOC] 2.6.1-2.6.5 are keyed on. */
  readonly value: number;
  readonly ispmd: number;
  readonly fSpec: 0 | 1;
  readonly sgc: number;
  readonly spra: number;
}

export interface Prl {
  readonly sprm: Sprm;
  readonly operand: Uint8Array;
}

/** Sprm.sgc, [MS-DOC] 2.6.1 -- which property family the opcode belongs to. */
export const SGC = {
  paragraph: 1,
  character: 2,
  picture: 3,
  section: 4,
  table: 5,
} as const;

// sprmTDefTable and sprmPChgTabs are the two opcodes [MS-DOC] 2.6.1's spra table singles out by name: "Operand is of variable length. The first byte of the operand indicates the size of the rest of the operand, except in the cases of sprmTDefTable and sprmPChgTabs." Both are named here rather than pattern-matched, because their exceptions differ in kind from each other as well as from the rule.
const SPRM_T_DEF_TABLE = 0xd608;
const SPRM_P_CHG_TABS = 0xc615;
/** PChgTabsOperand.cb: "A value of 255 specifies that this instance of sprmPChgTabs MAY be ignored and that the size of the remainder of this operand ... is calculated by using the following formula". */
const P_CHG_TABS_COMPUTED_SIZE = 0xff;

export function decodeSprm(value: number): Sprm {
  return {
    value,
    ispmd: value & 0x01ff,
    fSpec: ((value >> 9) & 0x0001) === 1 ? 1 : 0,
    sgc: (value >> 10) & 0x0007,
    spra: (value >> 13) & 0x0007,
  };
}

// The number of bytes this sprm's operand occupies, starting at `offset` in `bytes`. Fixed for six of the eight spra values; for spra 6 the operand carries its own length, in one of three different spellings.
export function operandSize(
  sprm: Sprm,
  bytes: Uint8Array,
  offset: number,
): number {
  switch (sprm.spra) {
    // "Operand is a ToggleOperand (which is 1 byte in size)" and "Operand is 1 byte".
    case 0:
    case 1:
      return 1;
    // spra 2, 4 and 5 are each documented as a 2-byte operand; they differ in what the two bytes mean, not in how many there are.
    case 2:
    case 4:
    case 5:
      return 2;
    case 3:
      return 4;
    case 7:
      return 3;
    case 6:
      return variableOperandSize(sprm, bytes, offset);
    default:
      throw new DocFormatError(
        `sprm 0x${sprm.value.toString(16)} has spra ${sprm.spra}, which is outside the 0..7 range a 3-bit field can hold`,
      );
  }
}

function variableOperandSize(
  sprm: Sprm,
  bytes: Uint8Array,
  offset: number,
): number {
  if (sprm.value === SPRM_T_DEF_TABLE) {
    // TDefTableOperand.cb is two bytes and counts "the number of bytes that are used by the remainder of this structure, incremented by 1" -- so the bytes after cb number cb - 1, and the whole operand is 2 + (cb - 1).
    const cb = readUint16LE(bytes, offset);
    if (cb < 1) {
      throw new DocFormatError(
        `sprmTDefTable declares cb ${cb}, which cannot be a remainder length incremented by 1`,
      );
    }
    return cb + 1;
  }

  const cb = readUint8(bytes, offset);
  if (sprm.value === SPRM_P_CHG_TABS && cb === P_CHG_TABS_COMPUTED_SIZE) {
    // The sentinel says the operand's real length is not stored but computed from the tab-stop counts inside PChgTabsDelClose and PChgTabsAdd. doc-codec does not read custom tab stops, so it has no need for the operand itself -- but it does need its length to find the next Prl, and guessing would silently mis-read every property after it in this paragraph. Refusing names the one construct that stopped the read.
    throw new DocUnsupportedError(
      "this paragraph carries a sprmPChgTabs whose cb is the 255 sentinel, so its operand length is computed from tab-stop counts doc-codec does not yet parse; the grpprl cannot be walked past it without guessing",
    );
  }
  // The general rule: "The first byte of the operand indicates the size of the rest of the operand", so the whole operand is that byte plus what it counts.
  return 1 + cb;
}

// Splits a grpprl into its Prls. [MS-DOC] 2.9.137: "An array of Prl. ... MUST contain a whole number of Prls" -- so bytes left over that cannot form one are corruption, not padding, and are reported rather than dropped.
export function readGrpprl(bytes: Uint8Array): Prl[] {
  const prls: Prl[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    if (cursor + 2 > bytes.length) {
      throw new DocFormatError(
        `grpprl has ${bytes.length - cursor} trailing byte(s) at offset ${cursor}, too few for a sprm's own two`,
      );
    }
    const sprm = decodeSprm(readUint16LE(bytes, cursor));
    const size = operandSize(sprm, bytes, cursor + 2);
    prls.push({
      sprm,
      operand: slice(
        bytes,
        cursor + 2,
        size,
        `operand of sprm 0x${sprm.value.toString(16)} at grpprl offset ${cursor}`,
      ),
    });
    cursor += 2 + size;
  }
  return prls;
}
