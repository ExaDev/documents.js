// A minimal sfnt (TrueType/OpenType container) table-directory reader: enough to locate and slice out individual tables by tag ('CFF ', 'cmap', 'hmtx', 'hhea', 'head', 'maxp', 'MATH', ...) from a font's raw bytes. This module knows nothing about any specific table's own internal layout -- math-cmap.ts/math-hmtx.ts/math-table.ts each parse their own table's bytes once sfnt.ts has handed them the right slice. Reads only the one sfnt flavour this package's own embedded font actually is (a CFF-flavoured 'OTTO' OpenType font -- see math-font.ts's own module comment) but the table-directory format itself (ISO/IEC 14496-22, "OpenType font format" clause 4) is identical for a glyf-flavoured font too, so this reader is not itself CFF-specific.

export interface SfntTable {
  readonly offset: number;
  readonly length: number;
}

export interface SfntFont {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly tables: ReadonlyMap<string, SfntTable>;
}

function readUint16(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint32(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

const TABLE_DIRECTORY_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;

export function parseSfnt(bytes: Uint8Array<ArrayBuffer>): SfntFont {
  const numTables = readUint16(bytes, 4);
  const tables = new Map<string, SfntTable>();
  for (let i = 0; i < numTables; i++) {
    const recordOffset = TABLE_DIRECTORY_HEADER_SIZE + i * TABLE_RECORD_SIZE;
    const tag = new TextDecoder('ascii').decode(bytes.subarray(recordOffset, recordOffset + 4));
    const offset = readUint32(bytes, recordOffset + 8);
    const length = readUint32(bytes, recordOffset + 12);
    tables.set(tag, { offset, length });
  }
  return { bytes, tables };
}

export function sfntTableBytes(font: SfntFont, tag: string): Uint8Array<ArrayBuffer> | undefined {
  const table = font.tables.get(tag);
  return table === undefined ? undefined : font.bytes.subarray(table.offset, table.offset + table.length);
}

// Big-endian primitive readers shared by every src/pdf/math-*.ts table parser -- sfnt tables are exclusively big-endian (ISO/IEC 14496-22 clause 4), unlike this package's own PDF byte format, which is why these live here rather than being reused from src/bytes/ (that module's own ByteReader has no fixed-width integer readers at all -- see its own module comment on why: the PDF lexer tokenizes ASCII syntax, it never needs to read a binary uint16).
export function u8(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return bytes[offset]!;
}

export function u16(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return readUint16(bytes, offset);
}

export function i16(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  const value = readUint16(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

export function u32(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return readUint32(bytes, offset);
}
