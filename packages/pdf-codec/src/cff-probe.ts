import { hasBytes, u8, u16, u24, u32 } from './sfnt';

// A deliberately shallow reader for a CFF (Compact Font Format 1.0) font program: its header, its Name INDEX, and just enough of its Top DICT to answer one question -- is this font CID-keyed?
//
// Why that one question is worth a module of its own. This package embeds a TrueType-outline face by preserving glyph IDs and showing text through Identity-H, so a character code in a content stream IS the glyph index in the embedded program (see sfnt-subset.ts and embedded-font-write.ts). Reusing that machinery for a CFF-flavoured font extracted from a source document is only valid while CID == GID holds, and for a CID-keyed CFF it does not: such a font carries its own charset mapping CIDs onto glyph indices, and the two coincide only by accident. Showing text through Identity-H against one anyway produces no error anywhere -- the file is structurally valid, every reader accepts it, and the page simply renders the WRONG GLYPHS. That is precisely the failure this probe exists to prevent: a font it reports as CID-keyed (or cannot read at all) must be refused by the embedding path, which falls back to a vendored substitute face or a standard-14 font instead.
//
// A CID-keyed CFF is marked by the ROS operator in its Top DICT (CFF 1.0 spec, Appendix H and Table 10): the escaped two-byte operator 12 30, whose presence alone is the definition -- "CIDFont operators ... the presence of the ROS operator identifies a CFF FontSet as containing CIDFonts".
//
// Deliberately not parsed: the charset, the CharStrings INDEX, the Private DICT, the FDArray/FDSelect a CID-keyed font carries, and every other Top DICT operator. This is a probe, not a CFF reader -- there is no CFF subsetter or CFF rasteriser in this package for a fuller parse to feed.
//
// Input is a BARE CFF program, i.e. the contents of an sfnt 'CFF ' table or of a PDF /FontFile3 stream -- not an 'OTTO' sfnt container. sfnt.ts already slices a table out of a container, and duplicating that here would be a second, driftable copy of it.

const CFF_HEADER_SIZE = 4; // major, minor, hdrSize, offSize
const CFF_MAJOR_VERSION = 1;

const INDEX_COUNT_SIZE = 2;
const INDEX_OFF_SIZE_SIZE = 1;
const MIN_OFF_SIZE = 1;
const MAX_OFF_SIZE = 4;

// DICT operand and operator encodings (CFF 1.0 spec Table 3 and section 4). Operators are 0..21, with 12 introducing a two-byte escaped operator; everything from 28 upward is operand data, and 22..27, 31, and 255 are reserved and appear in no valid DICT.
const DICT_OPERATOR_MAX = 21;
const DICT_OPERATOR_ESCAPE = 12;
const DICT_ROS_ESCAPED_OPERATOR = 30;
const DICT_OPERAND_INT16 = 28;
const DICT_OPERAND_INT32 = 29;
const DICT_OPERAND_REAL = 30;
const DICT_OPERAND_INT16_SIZE = 3;
const DICT_OPERAND_INT32_SIZE = 5;
const DICT_OPERAND_SMALL_FIRST = 32;
const DICT_OPERAND_SMALL_LAST = 246;
const DICT_OPERAND_MEDIUM_FIRST = 247;
const DICT_OPERAND_MEDIUM_LAST = 254;
const DICT_OPERAND_MEDIUM_SIZE = 2;
// A real number is a nibble stream terminated by the nibble 0xf (Table 5), so its length is not knowable from its first byte alone.
const DICT_REAL_TERMINATOR_NIBBLE = 0xf;

export interface CffProbeResult {
  readonly majorVersion: number;
  readonly minorVersion: number;
  // The first Name INDEX entry: the font's own PostScript name. A CFF FontSet may in principle hold several fonts, but every one embedded in a PDF or wrapped in an sfnt holds exactly one, so this is that font's name.
  readonly name: string;
  // True where the Top DICT carries the ROS operator. The embedding path must refuse a font for which this is true -- see this module's own header comment for what embedding one anyway would silently produce.
  readonly cidKeyed: boolean;
}

interface CffIndex {
  readonly count: number;
  readonly endOffset: number; // the absolute offset of the first byte past this INDEX
  entry(index: number): Uint8Array<ArrayBuffer> | undefined;
}

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

// A CFF INDEX (spec section 5): a count, an offset size, count+1 offsets of that size, then the data those offsets carve up. The offsets are 1-based relative to the byte immediately BEFORE the data block, which is why `dataOrigin` below is one short of where the data actually starts -- a genuine off-by-one in the format itself rather than in this reader.
function readIndex(bytes: Uint8Array<ArrayBuffer>, offset: number): CffIndex | undefined {
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

// Walks a DICT's operand/operator stream far enough to say whether the ROS operator appears in it, or `undefined` for a stream that is not a well-formed DICT at all. Operand VALUES are skipped rather than decoded: nothing here needs them, and the only thing that could go wrong by skipping is misjudging an operand's length, which each branch below takes directly from the spec's own encoding table.
function dictDeclaresRos(data: Uint8Array<ArrayBuffer>): boolean | undefined {
  let i = 0;
  while (i < data.length) {
    const b0 = data[i]!;
    if (b0 <= DICT_OPERATOR_MAX) {
      if (b0 !== DICT_OPERATOR_ESCAPE) {
        i += 1;
        continue;
      }
      if (i + 1 >= data.length) {
        return undefined; // an escape byte with no second byte to complete the operator
      }
      if (data[i + 1] === DICT_ROS_ESCAPED_OPERATOR) {
        return true;
      }
      i += 2;
      continue;
    }
    if (b0 === DICT_OPERAND_INT16) {
      if (i + DICT_OPERAND_INT16_SIZE > data.length) {
        return undefined;
      }
      i += DICT_OPERAND_INT16_SIZE;
      continue;
    }
    if (b0 === DICT_OPERAND_INT32) {
      if (i + DICT_OPERAND_INT32_SIZE > data.length) {
        return undefined;
      }
      i += DICT_OPERAND_INT32_SIZE;
      continue;
    }
    if (b0 === DICT_OPERAND_REAL) {
      const end = findRealOperandEnd(data, i + 1);
      if (end === undefined) {
        return undefined;
      }
      i = end;
      continue;
    }
    if (b0 >= DICT_OPERAND_SMALL_FIRST && b0 <= DICT_OPERAND_SMALL_LAST) {
      i += 1;
      continue;
    }
    if (b0 >= DICT_OPERAND_MEDIUM_FIRST && b0 <= DICT_OPERAND_MEDIUM_LAST) {
      if (i + DICT_OPERAND_MEDIUM_SIZE > data.length) {
        return undefined;
      }
      i += DICT_OPERAND_MEDIUM_SIZE;
      continue;
    }
    return undefined; // 22..27, 31, 255: reserved, and present in no valid DICT
  }
  return false;
}

// The offset just past a real-number operand starting at `start`: one packed nibble pair per byte, ending at the first 0xf nibble in either position (spec Table 5).
function findRealOperandEnd(data: Uint8Array<ArrayBuffer>, start: number): number | undefined {
  for (let i = start; i < data.length; i++) {
    const byte = data[i]!;
    if ((byte >> 4) === DICT_REAL_TERMINATOR_NIBBLE || (byte & 0xf) === DICT_REAL_TERMINATOR_NIBBLE) {
      return i + 1;
    }
  }
  return undefined; // a real number running off the end of the DICT
}

// CFF names are ASCII (spec section 7: "the character set is restricted to printable ASCII"), so a per-byte decode is exact rather than an approximation.
function decodeAscii(bytes: Uint8Array<ArrayBuffer>): string {
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}

// Probes a bare CFF font program. Returns `undefined` for anything this cannot read confidently -- a truncated header, a major version other than 1 (CFF2 has an incompatible header and no Name INDEX at all, and is not a legal PDF /FontFile3 program either), an unreadable Name INDEX or Top DICT INDEX, an empty FontSet, or a malformed Top DICT. The embedding path treats `undefined` and `cidKeyed: true` identically: refuse this font program, substitute a face this package can embed correctly.
export function probeCff(bytes: Uint8Array<ArrayBuffer>): CffProbeResult | undefined {
  if (!hasBytes(bytes, 0, CFF_HEADER_SIZE)) {
    return undefined;
  }
  const majorVersion = u8(bytes, 0);
  const minorVersion = u8(bytes, 1);
  const headerSize = u8(bytes, 2);
  if (majorVersion !== CFF_MAJOR_VERSION || headerSize < CFF_HEADER_SIZE) {
    return undefined;
  }

  const nameIndex = readIndex(bytes, headerSize);
  if (nameIndex === undefined || nameIndex.count === 0) {
    return undefined;
  }
  const nameBytes = nameIndex.entry(0);
  if (nameBytes === undefined) {
    return undefined;
  }

  const topDictIndex = readIndex(bytes, nameIndex.endOffset);
  const topDict = topDictIndex?.entry(0);
  if (topDict === undefined) {
    return undefined;
  }
  const cidKeyed = dictDeclaresRos(topDict);
  if (cidKeyed === undefined) {
    return undefined;
  }

  return { majorVersion, minorVersion, name: decodeAscii(nameBytes), cidKeyed };
}
