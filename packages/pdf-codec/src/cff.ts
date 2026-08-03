import { hasBytes, u8, u16, u24, u32 } from './sfnt';

// The two container structures every CFF (Compact Font Format 1.0) font is built out of -- the INDEX (spec section 5) and the DICT (section 4) -- and nothing else. Both readers here are format plumbing shared by the two CFF consumers in this package: cff-probe.ts (is this font CID-keyed?) and cff-bounds.ts (what does this glyph's charstring actually draw?). Neither structure is specific to either question, and a second hand-rolled copy of the INDEX offset arithmetic or the DICT operand encoding is exactly the kind of drift that produces a reader which is subtly right about one font and wrong about the next.
//
// Input everywhere in this module is a BARE CFF program, i.e. the contents of an sfnt 'CFF ' table or of a PDF /FontFile3 stream -- not an 'OTTO' sfnt container. sfnt.ts already slices a table out of a container.

export interface CffIndex {
  readonly count: number;
  readonly endOffset: number; // the absolute offset of the first byte past this INDEX -- how a caller walks from one INDEX to the next, since a CFF's Name/Top DICT/String/Global Subr INDEXes are stored back to back with no offsets pointing at them
  entry(index: number): Uint8Array<ArrayBuffer> | undefined;
}

// A DICT's operators keyed to their operand list, in the order the operands appeared. A two-byte escaped operator (12 x) is keyed as CFF_ESCAPED_OPERATOR_BASE + x, so `12 30` (ROS) is 1230 and can never collide with a one-byte operator (0..21).
export type CffDict = ReadonlyMap<number, readonly number[]>;

export const CFF_ESCAPED_OPERATOR_BASE = 1200;

// The Top DICT operators this package reads (spec Table 9 and Table 10). Everything else in a Top DICT -- the encoding, the font matrix, the copyright strings, the CID-keyed FDArray/FDSelect pair -- is skipped by the readers built on this module rather than modelled here.
export const CFF_DICT_OP_CHARSET = 15;
export const CFF_DICT_OP_CHARSTRINGS = 17;
export const CFF_DICT_OP_PRIVATE = 18;
export const CFF_DICT_OP_SUBRS = 19; // Private DICT: an offset RELATIVE to that Private DICT's own start, not to the start of the font
export const CFF_DICT_OP_ROS = CFF_ESCAPED_OPERATOR_BASE + 30;

const INDEX_COUNT_SIZE = 2;
const INDEX_OFF_SIZE_SIZE = 1;
const MIN_OFF_SIZE = 1;
const MAX_OFF_SIZE = 4;

// DICT operand and operator encodings (spec Table 3 and section 4). Operators are 0..21, with 12 introducing a two-byte escaped operator; everything from 28 upward is operand data, and 22..27, 31, and 255 are reserved and appear in no valid DICT.
const DICT_OPERATOR_MAX = 21;
const DICT_OPERATOR_ESCAPE = 12;
const DICT_OPERAND_INT16 = 28;
const DICT_OPERAND_INT32 = 29;
const DICT_OPERAND_REAL = 30;
const DICT_OPERAND_SMALL_FIRST = 32;
const DICT_OPERAND_SMALL_LAST = 246;
const DICT_OPERAND_MEDIUM_FIRST = 247;
const DICT_OPERAND_MEDIUM_LAST = 250;
const DICT_OPERAND_NEGATIVE_MEDIUM_FIRST = 251;
const DICT_OPERAND_NEGATIVE_MEDIUM_LAST = 254;
const DICT_OPERAND_SMALL_BIAS = 139;
const DICT_OPERAND_MEDIUM_BIAS = 108;
const DICT_OPERAND_MEDIUM_FIRST_BYTE_BIAS = 247;
const DICT_OPERAND_NEGATIVE_MEDIUM_FIRST_BYTE_BIAS = 251;
const BYTE_RADIX = 256;

// A real number is a nibble stream (Table 5), each nibble either a digit, one of '.', 'E', 'E-', '-', or the terminator 0xf. Nibble 0xd is reserved and appears in no valid real.
const REAL_NIBBLE_DECIMAL_POINT = 0xa;
const REAL_NIBBLE_EXPONENT = 0xb;
const REAL_NIBBLE_NEGATIVE_EXPONENT = 0xc;
const REAL_NIBBLE_RESERVED = 0xd;
const REAL_NIBBLE_MINUS = 0xe;
const REAL_NIBBLE_TERMINATOR = 0xf;
const NIBBLES_PER_BYTE = 2;
const HIGH_NIBBLE_SHIFT = 4;
const LOW_NIBBLE_MASK = 0xf;

function readOffsetAt(bytes: Uint8Array<ArrayBuffer>, offset: number, offSize: number): number {
  if (offSize === 1) {
    return u8(bytes, offset);
  }
  if (offSize === 2) {
    return u16(bytes, offset);
  }
  if (offSize === 3) {
    return u24(bytes, offset);
  }
  return u32(bytes, offset);
}

// A CFF INDEX: a count, an offset size, count+1 offsets of that size, then the data those offsets carve up. The offsets are 1-based relative to the byte immediately BEFORE the data block, which is why `dataOrigin` below is one short of where the data actually starts -- a genuine off-by-one in the format itself rather than in this reader. Returns `undefined` for anything that is not a well-formed INDEX at `offset`.
export function readCffIndex(bytes: Uint8Array<ArrayBuffer>, offset: number): CffIndex | undefined {
  if (!hasBytes(bytes, offset, INDEX_COUNT_SIZE)) {
    return undefined;
  }
  const count = u16(bytes, offset);
  if (count === 0) {
    // An empty INDEX is just its own two count bytes -- no offset size and no offset array follow (spec section 5).
    return { count: 0, endOffset: offset + INDEX_COUNT_SIZE, entry: () => undefined };
  }
  if (!hasBytes(bytes, offset + INDEX_COUNT_SIZE, INDEX_OFF_SIZE_SIZE)) {
    return undefined;
  }
  const offSize = u8(bytes, offset + INDEX_COUNT_SIZE);
  if (offSize < MIN_OFF_SIZE || offSize > MAX_OFF_SIZE) {
    return undefined;
  }
  const offsetArrayStart = offset + INDEX_COUNT_SIZE + INDEX_OFF_SIZE_SIZE;
  const offsetArrayLength = (count + 1) * offSize;
  if (!hasBytes(bytes, offsetArrayStart, offsetArrayLength)) {
    return undefined;
  }

  const offsets: number[] = [];
  for (let i = 0; i <= count; i++) {
    offsets.push(readOffsetAt(bytes, offsetArrayStart + i * offSize, offSize));
  }
  if (offsets[0] !== 1) {
    return undefined; // the first offset is 1 by definition; anything else means these are not INDEX offsets
  }
  for (let i = 1; i <= count; i++) {
    if (offsets[i]! < offsets[i - 1]!) {
      return undefined; // offsets are non-decreasing; a descending pair would carve out a negative-length entry
    }
  }

  const dataOrigin = offsetArrayStart + offsetArrayLength - 1;
  const dataLength = offsets[count]! - 1;
  if (!hasBytes(bytes, dataOrigin + 1, dataLength)) {
    return undefined;
  }
  return {
    count,
    endOffset: dataOrigin + 1 + dataLength,
    entry: (index: number) => (index < 0 || index >= count ? undefined : bytes.subarray(dataOrigin + offsets[index]!, dataOrigin + offsets[index + 1]!)),
  };
}

interface RealOperand {
  readonly value: number;
  readonly endOffset: number;
}

// Decodes a real-number operand starting at `start` (the first byte after the 30 marker): one packed nibble pair per byte, ending at the first 0xf nibble in either position.
//
// A nibble stream that terminates cleanly but does not spell a finite number (say "0E-1-", which the byte pair 0x0c 0x1e produces) yields NaN rather than failing the whole DICT. Where the stream ENDS is unambiguous either way -- that is what the terminator nibble is for -- so one unreadable operand value costs a caller nothing unless it actually reads that operand, and every caller in this package validates the operands it uses. Refusing the DICT outright would instead throw away the operators around it, which is how a font with one odd real number in a string-valued entry would end up unembeddable for no reason.
function readRealOperand(data: Uint8Array<ArrayBuffer>, start: number): RealOperand | undefined {
  let text = '';
  for (let i = start; i < data.length; i++) {
    const byte = data[i]!;
    for (let n = 0; n < NIBBLES_PER_BYTE; n++) {
      const nibble = n === 0 ? byte >> HIGH_NIBBLE_SHIFT : byte & LOW_NIBBLE_MASK;
      if (nibble === REAL_NIBBLE_TERMINATOR) {
        return { value: Number(text), endOffset: i + 1 };
      }
      if (nibble === REAL_NIBBLE_RESERVED) {
        return undefined;
      }
      if (nibble <= 9) {
        text += String(nibble);
      } else if (nibble === REAL_NIBBLE_DECIMAL_POINT) {
        text += '.';
      } else if (nibble === REAL_NIBBLE_EXPONENT) {
        text += 'E';
      } else if (nibble === REAL_NIBBLE_NEGATIVE_EXPONENT) {
        text += 'E-';
      } else if (nibble === REAL_NIBBLE_MINUS) {
        text += '-';
      }
    }
  }
  return undefined; // a real number running off the end of the DICT
}

// Parses a whole DICT into its operator -> operands map, or `undefined` for a stream that is not a well-formed DICT: a truncated operand, an escape byte with no second byte, a malformed real, or one of the reserved first bytes (22..27, 31, 255) that appear in no valid DICT.
export function parseCffDict(data: Uint8Array<ArrayBuffer>): CffDict | undefined {
  const dict = new Map<number, readonly number[]>();
  let operands: number[] = [];
  let i = 0;
  while (i < data.length) {
    const b0 = data[i]!;
    if (b0 <= DICT_OPERATOR_MAX) {
      let operator = b0;
      i += 1;
      if (b0 === DICT_OPERATOR_ESCAPE) {
        if (i >= data.length) {
          return undefined;
        }
        operator = CFF_ESCAPED_OPERATOR_BASE + data[i]!;
        i += 1;
      }
      dict.set(operator, operands);
      operands = [];
      continue;
    }
    if (b0 === DICT_OPERAND_INT16) {
      if (!hasBytes(data, i + 1, 2)) {
        return undefined;
      }
      const raw = u16(data, i + 1);
      operands.push(raw >= 0x8000 ? raw - 0x1_0000 : raw);
      i += 3;
      continue;
    }
    if (b0 === DICT_OPERAND_INT32) {
      if (!hasBytes(data, i + 1, 4)) {
        return undefined;
      }
      operands.push(u32(data, i + 1) | 0); // a 32-bit DICT integer is signed (Table 3); the bitwise-or reinterprets the unsigned read as two's complement
      i += 5;
      continue;
    }
    if (b0 === DICT_OPERAND_REAL) {
      const real = readRealOperand(data, i + 1);
      if (real === undefined) {
        return undefined;
      }
      operands.push(real.value);
      i = real.endOffset;
      continue;
    }
    if (b0 >= DICT_OPERAND_SMALL_FIRST && b0 <= DICT_OPERAND_SMALL_LAST) {
      operands.push(b0 - DICT_OPERAND_SMALL_BIAS);
      i += 1;
      continue;
    }
    if (b0 >= DICT_OPERAND_MEDIUM_FIRST && b0 <= DICT_OPERAND_MEDIUM_LAST) {
      if (!hasBytes(data, i + 1, 1)) {
        return undefined;
      }
      operands.push((b0 - DICT_OPERAND_MEDIUM_FIRST_BYTE_BIAS) * BYTE_RADIX + u8(data, i + 1) + DICT_OPERAND_MEDIUM_BIAS);
      i += 2;
      continue;
    }
    if (b0 >= DICT_OPERAND_NEGATIVE_MEDIUM_FIRST && b0 <= DICT_OPERAND_NEGATIVE_MEDIUM_LAST) {
      if (!hasBytes(data, i + 1, 1)) {
        return undefined;
      }
      operands.push(-(b0 - DICT_OPERAND_NEGATIVE_MEDIUM_FIRST_BYTE_BIAS) * BYTE_RADIX - u8(data, i + 1) - DICT_OPERAND_MEDIUM_BIAS);
      i += 2;
      continue;
    }
    return undefined; // 22..27, 31, 255: reserved, and present in no valid DICT
  }
  return dict;
}
