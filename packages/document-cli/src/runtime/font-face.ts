// What `--font-file <path>` (and the TUI's own font-file field) needs and nothing else: the family/bold/italic triple a ProvidedFont must carry, read out of the font file's own tables rather than asked of the user through a parallel --font-family/--font-bold/--font-italic flag set. That parallel-flag design was the alternative considered and rejected: three repeatable flags whose values have to stay index-aligned with a fourth repeatable flag is a silent-misalignment hazard (pass two font files and one --font-family and the second face is mis-declared with nothing reporting it), and every real font already states all three facts itself.
//
// Deriving them cannot go through documents.js/pdf-codec: pdf-codec parses these exact tables internally (its own font-tables.ts) but deliberately does not export that parser, and the one font-naming value it does surface -- EmbeddedFace.postScriptName -- is the wrong field for this job, since a PostScript name is a naming convention rather than a structured family+style pair ("ArialMT", "TimesNewRomanPS-BoldMT") and recovering a family from one is guesswork where the 'name' table states it outright.
//
// Field offsets are from ISO/IEC 14496-22 ("OpenType font format"): clause 4 (the sfnt table directory), 5.2.7 ('name'), 5.2.8 ('OS/2' fsSelection), and 5.2.2 ('head' macStyle). Every read goes through a DataView, whose accessors return a plain `number` and throw on an out-of-range offset, rather than through Uint8Array indexing, which under noUncheckedIndexedAccess would return `number | undefined` and push a non-null assertion into every byte read.

export interface FontFaceDescription {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

export class FontFaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontFaceError';
  }
}

// The four sfnt version tags a single-font file can carry (clause 4.1). 'ttcf' is deliberately absent and diagnosed separately below: a TrueType Collection wraps several table directories behind its own header, so reading its first four bytes as a directory would produce nonsense rather than an error.
const SFNT_VERSION_TRUETYPE = 0x00010000;
const SFNT_VERSION_CFF = 0x4f54544f; // 'OTTO'
const SFNT_VERSION_APPLE_TRUE = 0x74727565; // 'true'
const SFNT_VERSION_APPLE_TYP1 = 0x74797031; // 'typ1'
const SFNT_VERSION_COLLECTION = 0x74746366; // 'ttcf'
const SFNT_VERSIONS: ReadonlySet<number> = new Set([SFNT_VERSION_TRUETYPE, SFNT_VERSION_CFF, SFNT_VERSION_APPLE_TRUE, SFNT_VERSION_APPLE_TYP1]);

const TABLE_DIRECTORY_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;
const TABLE_TAG_SIZE = 4;

const NAME_HEADER_SIZE = 6;
const NAME_RECORD_SIZE = 12;
// nameID 16 is the typographic (preferred) family, which groups a large family's optical/weight variants under one name; nameID 1 is the basic family every font declares. 16 first, then 1 -- the same precedence pdf-codec's own name-table reader applies, so a face named here matches a face documents.js extracted from a source package by the same rule.
const NAME_ID_FAMILY = 1;
const NAME_ID_TYPOGRAPHIC_FAMILY = 16;

const PLATFORM_UNICODE = 0;
const PLATFORM_MACINTOSH = 1;
const PLATFORM_WINDOWS = 3;
const MACINTOSH_ENCODING_ROMAN = 0;

// 'OS/2' version 0 is 78 bytes and already carries fsSelection at offset 62, so every version of the table this check accepts declares it.
const OS2_FS_SELECTION_OFFSET = 62;
const OS2_MINIMUM_SIZE = OS2_FS_SELECTION_OFFSET + 2;
const OS2_FS_SELECTION_ITALIC = 0x0001;
const OS2_FS_SELECTION_BOLD = 0x0020;

const HEAD_MAC_STYLE_OFFSET = 44;
const HEAD_MINIMUM_SIZE = HEAD_MAC_STYLE_OFFSET + 2;
const HEAD_MAC_STYLE_BOLD = 0x0001;
const HEAD_MAC_STYLE_ITALIC = 0x0002;

interface SfntTable {
  readonly offset: number;
  readonly length: number;
}

interface NameRecord {
  readonly platformId: number;
  readonly encodingId: number;
  readonly nameId: number;
  readonly length: number;
  readonly stringOffset: number;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeTag(view: DataView, offset: number): string {
  let tag = '';
  for (let i = 0; i < TABLE_TAG_SIZE; i++) {
    tag += String.fromCharCode(view.getUint8(offset + i));
  }
  return tag;
}

// A JS string is itself UTF-16, so appending each big-endian code unit directly reproduces astral characters through their own surrogate pair without any explicit surrogate handling -- and avoids depending on TextDecoder('utf-16be'), which needs a full-ICU Node build.
function decodeUtf16Be(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i + 1 < length; i += 2) {
    text += String.fromCharCode(view.getUint16(offset + i));
  }
  return text;
}

// Macintosh/Roman records are accepted only where every byte is ASCII, which every real Latin family name in one is. Decoding a byte above 0x7e as if it were Latin-1 would silently mis-name the face (Mac Roman's upper half is not Latin-1), so such a record is declined here and the next-best record is tried instead.
function decodeMacintoshAscii(view: DataView, offset: number, length: number): string | undefined {
  let text = '';
  for (let i = 0; i < length; i++) {
    const byte = view.getUint8(offset + i);
    if (byte > 0x7e) {
      return undefined;
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

function readTableDirectory(view: DataView, source: string): ReadonlyMap<string, SfntTable> {
  if (view.byteLength < TABLE_DIRECTORY_HEADER_SIZE) {
    throw new FontFaceError(`${source} is too short to be a font file (${String(view.byteLength)} bytes)`);
  }
  const sfntVersion = view.getUint32(0);
  if (sfntVersion === SFNT_VERSION_COLLECTION) {
    throw new FontFaceError(`${source} is a TrueType Collection (.ttc), which packs several faces into one file; extract the single face you want and pass that instead`);
  }
  if (!SFNT_VERSIONS.has(sfntVersion)) {
    throw new FontFaceError(`${source} is not a TrueType/OpenType font file (no recognised sfnt version); a .woff/.woff2 file must be converted to .ttf/.otf first`);
  }

  const numTables = view.getUint16(4);
  if (view.byteLength < TABLE_DIRECTORY_HEADER_SIZE + numTables * TABLE_RECORD_SIZE) {
    throw new FontFaceError(`${source} declares ${String(numTables)} tables but is too short to hold that many table records`);
  }

  const tables = new Map<string, SfntTable>();
  for (let i = 0; i < numTables; i++) {
    const recordOffset = TABLE_DIRECTORY_HEADER_SIZE + i * TABLE_RECORD_SIZE;
    const tag = decodeTag(view, recordOffset);
    const offset = view.getUint32(recordOffset + 8);
    const length = view.getUint32(recordOffset + 12);
    // A record reaching past the end of the file, or a duplicate tag, drops that one table rather than the whole font -- exactly how pdf-codec's own reader treats the same two cases, so a font it will happily embed is not rejected here first.
    if (offset + length > view.byteLength || tables.has(tag)) {
      continue;
    }
    tables.set(tag, { offset, length });
  }
  return tables;
}

function tableView(bytes: Uint8Array, table: SfntTable): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset + table.offset, table.length);
}

function readNameRecords(name: DataView): readonly NameRecord[] {
  if (name.byteLength < NAME_HEADER_SIZE) {
    return [];
  }
  const count = name.getUint16(2);
  const storageOffset = name.getUint16(4);
  if (name.byteLength < NAME_HEADER_SIZE + count * NAME_RECORD_SIZE) {
    return [];
  }

  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const recordOffset = NAME_HEADER_SIZE + i * NAME_RECORD_SIZE;
    records.push({
      platformId: name.getUint16(recordOffset),
      encodingId: name.getUint16(recordOffset + 2),
      nameId: name.getUint16(recordOffset + 6),
      length: name.getUint16(recordOffset + 8),
      stringOffset: storageOffset + name.getUint16(recordOffset + 10),
    });
  }
  return records;
}

// Windows records first (every font a caller is realistically passing has them, and they are unambiguously UTF-16BE), then platform-independent Unicode records, then Macintosh/Roman as the last resort for an older Mac-only TrueType that carries nothing else.
function platformPreference(record: NameRecord): number {
  if (record.platformId === PLATFORM_WINDOWS) {
    return 0;
  }
  if (record.platformId === PLATFORM_UNICODE) {
    return 1;
  }
  if (record.platformId === PLATFORM_MACINTOSH && record.encodingId === MACINTOSH_ENCODING_ROMAN) {
    return 2;
  }
  return Number.POSITIVE_INFINITY;
}

function readNameString(name: DataView, records: readonly NameRecord[], nameId: number): string | undefined {
  const candidates = records.filter((record) => record.nameId === nameId && Number.isFinite(platformPreference(record))).sort((left, right) => platformPreference(left) - platformPreference(right));
  for (const record of candidates) {
    if (record.stringOffset + record.length > name.byteLength) {
      continue; // a record whose string runs past its own table: try the next-best platform rather than abandoning the name
    }
    const text = record.platformId === PLATFORM_MACINTOSH ? decodeMacintoshAscii(name, record.stringOffset, record.length) : decodeUtf16Be(name, record.stringOffset, record.length);
    if (text !== undefined && text.length > 0) {
      return text;
    }
  }
  return undefined;
}

// 'OS/2' fsSelection is the field the OpenType spec designates as authoritative for a face's own weight/slope, and 'head' macStyle is the older field it is required to agree with -- so fsSelection is read where the table exists and macStyle only where it does not (a legacy Mac TrueType with no 'OS/2' at all). A font carrying neither table is not a font pdf-codec could embed either, so it fails here rather than being declared regular by default.
function readStyleBits(bytes: Uint8Array, tables: ReadonlyMap<string, SfntTable>, source: string): { readonly bold: boolean; readonly italic: boolean } {
  const os2 = tables.get('OS/2');
  if (os2 !== undefined && os2.length >= OS2_MINIMUM_SIZE) {
    const fsSelection = tableView(bytes, os2).getUint16(OS2_FS_SELECTION_OFFSET);
    return { bold: (fsSelection & OS2_FS_SELECTION_BOLD) !== 0, italic: (fsSelection & OS2_FS_SELECTION_ITALIC) !== 0 };
  }
  const head = tables.get('head');
  if (head !== undefined && head.length >= HEAD_MINIMUM_SIZE) {
    const macStyle = tableView(bytes, head).getUint16(HEAD_MAC_STYLE_OFFSET);
    return { bold: (macStyle & HEAD_MAC_STYLE_BOLD) !== 0, italic: (macStyle & HEAD_MAC_STYLE_ITALIC) !== 0 };
  }
  throw new FontFaceError(`${source} declares neither a readable 'OS/2' nor a readable 'head' table, so its weight and slope cannot be determined`);
}

// `source` names the file in every error this throws -- a caller passing several --font-file paths needs to know which one is unreadable, and the bytes themselves carry no such label.
export function describeFontFace(bytes: Uint8Array, source: string): FontFaceDescription {
  const tables = readTableDirectory(viewOf(bytes), source);

  const nameTable = tables.get('name');
  if (nameTable === undefined) {
    throw new FontFaceError(`${source} declares no 'name' table, so the font family it provides cannot be determined`);
  }
  const name = tableView(bytes, nameTable);
  const records = readNameRecords(name);
  const family = readNameString(name, records, NAME_ID_TYPOGRAPHIC_FAMILY) ?? readNameString(name, records, NAME_ID_FAMILY);
  if (family === undefined) {
    throw new FontFaceError(`${source} declares no family name in its 'name' table, so the font family it provides cannot be determined`);
  }

  const { bold, italic } = readStyleBits(bytes, tables, source);
  return { family, bold, italic };
}
