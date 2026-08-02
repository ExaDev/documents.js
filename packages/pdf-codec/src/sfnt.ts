// A minimal sfnt (TrueType/OpenType container) table-directory reader: enough to locate and slice out individual tables by tag ('CFF ', 'cmap', 'hmtx', 'hhea', 'head', 'maxp', 'glyf', 'loca', 'name', 'post', 'OS/2', 'MATH', ...) from a font's raw bytes. This module knows nothing about any specific table's own internal layout -- cmap-table.ts/hmtx-table.ts/font-tables.ts/glyf.ts/math-table.ts each parse their own table's bytes once sfnt.ts has handed them the right slice. Both sfnt flavours are read: a CFF-flavoured 'OTTO' OpenType font (what this package's own embedded math font is -- see math-font.ts) and a glyf-flavoured TrueType font (what the embedded text fonts are, and what a source-embedded font extracted from an arbitrary input document usually is); the table-directory format itself (ISO/IEC 14496-22, "OpenType font format" clause 4) is identical for both.
//
// Every read here is bounds-checked against the byte range it is given, because this module's input is no longer only the one trusted, vendored math font it was originally written for: a font embedded in a source document is untrusted input, and a font whose table directory claims more tables than the file holds -- or whose table records point past its end -- must degrade rather than read whatever memory happens to follow. `parseSfnt` returns `undefined` for a font whose container is not readable at all (the "throw" tier of this package's own three-tier read-failure policy applied at a boundary where the caller is expected to give up on the font, not on the document), skips an individual table record that points outside the file (the "degrade" tier -- a truncated optional table must not cost the caller every other table), and the primitive readers below throw on an out-of-range offset, since reaching one means a table parser skipped its own length check rather than that the font was merely unusual.

export interface SfntTable {
  readonly offset: number;
  readonly length: number;
}

export interface SfntFont {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly tables: ReadonlyMap<string, SfntTable>;
}

const TABLE_DIRECTORY_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;
const TABLE_TAG_SIZE = 4;

// The four sfnt version tags a single-font file can legitimately carry (ISO/IEC 14496-22 clause 4.1): 0x00010000 TrueType outlines, 'OTTO' CFF outlines, 'true'/'typ1' the two legacy Apple variants. 'ttcf' (TrueType Collection) is deliberately absent -- a collection's own header wraps several table directories at offsets this reader never looks for, so treating its first four bytes as a directory would read nonsense rather than fail.
const SFNT_VERSION_TRUETYPE = 0x00010000;
const SFNT_VERSION_CFF = 0x4f54544f; // 'OTTO'
const SFNT_VERSION_APPLE_TRUE = 0x74727565; // 'true'
const SFNT_VERSION_APPLE_TYP1 = 0x74797031; // 'typ1'
const SFNT_VERSIONS: ReadonlySet<number> = new Set([SFNT_VERSION_TRUETYPE, SFNT_VERSION_CFF, SFNT_VERSION_APPLE_TRUE, SFNT_VERSION_APPLE_TYP1]);

// Whether `length` bytes starting at `offset` lie wholly inside `bytes` -- the pre-check every table parser in this package calls before reading a fixed-size record, so a malformed font degrades to `undefined` at the parser's own boundary instead of throwing out of a primitive reader.
export function hasBytes(bytes: Uint8Array<ArrayBuffer>, offset: number, length: number): boolean {
  return Number.isInteger(offset) && Number.isInteger(length) && offset >= 0 && length >= 0 && offset + length <= bytes.length;
}

function requireBytes(bytes: Uint8Array<ArrayBuffer>, offset: number, length: number): void {
  if (!hasBytes(bytes, offset, length)) {
    throw new Error(`sfnt read of ${String(length)} byte(s) at offset ${String(offset)} is outside the ${String(bytes.length)}-byte range`);
  }
}

function readUint16(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint32(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

// A table tag is four bytes of printable ASCII (clause 4.2); decoding by character code rather than through a TextDecoder avoids constructing one per table record, and a byte outside printable ASCII marks a directory this reader should not trust as a directory at all.
function decodeTag(bytes: Uint8Array<ArrayBuffer>, offset: number): string | undefined {
  let tag = '';
  for (let i = 0; i < TABLE_TAG_SIZE; i++) {
    const byte = bytes[offset + i]!;
    if (byte < 0x20 || byte > 0x7e) {
      return undefined;
    }
    tag += String.fromCharCode(byte);
  }
  return tag;
}

export function parseSfnt(bytes: Uint8Array<ArrayBuffer>): SfntFont | undefined {
  if (!hasBytes(bytes, 0, TABLE_DIRECTORY_HEADER_SIZE)) {
    return undefined;
  }
  if (!SFNT_VERSIONS.has(readUint32(bytes, 0))) {
    return undefined;
  }
  const numTables = readUint16(bytes, 4);
  if (!hasBytes(bytes, 0, TABLE_DIRECTORY_HEADER_SIZE + numTables * TABLE_RECORD_SIZE)) {
    return undefined;
  }

  const tables = new Map<string, SfntTable>();
  for (let i = 0; i < numTables; i++) {
    const recordOffset = TABLE_DIRECTORY_HEADER_SIZE + i * TABLE_RECORD_SIZE;
    const tag = decodeTag(bytes, recordOffset);
    if (tag === undefined) {
      return undefined;
    }
    const offset = readUint32(bytes, recordOffset + 8);
    const length = readUint32(bytes, recordOffset + 12);
    if (!hasBytes(bytes, offset, length)) {
      continue; // a table record pointing past the end of the file: drop this one table rather than the whole font, so a font whose (say) 'DSIG' is truncated still renders
    }
    if (tables.has(tag)) {
      continue; // tags are unique by spec; keep the first so a duplicate appended later cannot shadow a legitimate earlier table
    }
    tables.set(tag, { offset, length });
  }
  return { bytes, tables };
}

export function sfntTableBytes(font: SfntFont, tag: string): Uint8Array<ArrayBuffer> | undefined {
  const table = font.tables.get(tag);
  return table === undefined ? undefined : font.bytes.subarray(table.offset, table.offset + table.length);
}

// Big-endian primitive readers shared by every sfnt table parser in this package -- sfnt tables are exclusively big-endian (ISO/IEC 14496-22 clause 4), unlike this package's own PDF byte format, which is why these live here rather than being reused from src/bytes/ (that module's own ByteReader has no fixed-width integer readers at all -- see its own module comment on why: the PDF lexer tokenizes ASCII syntax, it never needs to read a binary uint16). Each throws rather than returning a sentinel for an out-of-range offset: a caller reaching one has skipped its own `hasBytes` length check, which is a defect in that parser, not a property of the font.
export function u8(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  requireBytes(bytes, offset, 1);
  return bytes[offset]!;
}

export function u16(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  requireBytes(bytes, offset, 2);
  return readUint16(bytes, offset);
}

export function i16(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  const value = u16(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

// A 3-byte big-endian unsigned integer -- the sfnt/CFF primitive an INDEX with offSize 3 uses for its own offset array (CFF 1.0 spec section 5), the one width between uint16 and uint32 the container format actually mixes in.
export function u24(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  requireBytes(bytes, offset, 3);
  return (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!;
}

export function u32(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  requireBytes(bytes, offset, 4);
  return readUint32(bytes, offset);
}

export function i32(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return u32(bytes, offset) | 0; // a bitwise OR reinterprets the 32-bit pattern as signed, which is exactly the sfnt int32/Fixed convention
}

// An F2Dot14: a 16-bit signed fixed-point number with two integer bits and fourteen fraction bits (clause 4.4), used for the scale/2x2 transform entries in a composite glyph's own component records.
const F2DOT14_SCALE = 1 << 14;

export function f2dot14(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return i16(bytes, offset) / F2DOT14_SCALE;
}
