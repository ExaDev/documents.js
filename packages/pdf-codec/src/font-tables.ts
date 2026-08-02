import type { SfntFont } from './sfnt';
import { hasBytes, i16, i32, sfntTableBytes, u16, u32 } from './sfnt';

// Parsers for the five sfnt tables that describe a font as a whole rather than a single glyph: 'head' (design grid, bounding box, and the loca format glyf.ts needs), 'maxp' (glyph count), 'OS/2' (the vertical metrics and style bits a PDF FontDescriptor is built from), 'post' (italic angle and underline geometry), and 'name' (the PostScript and family names a /BaseFont entry and any font-matching step need). Field offsets are from ISO/IEC 14496-22 clauses 5.2.2 ('head'), 5.2.6 ('maxp'), 5.2.5 ('post'), 5.2.7 ('name'), and the OS/2 table's own clause 5.2.8, and were cross-checked against the real vendored fonts (assets/fonts/{carlito,caladea}/*.ttf) while this module was built rather than transcribed from the spec alone.
//
// Every parser returns `undefined` for a missing or truncated table rather than throwing: the fonts this module reads include ones extracted from arbitrary source documents, where a missing 'post' must cost the caller an italic angle, not the whole document.

export interface HeadTable {
  readonly unitsPerEm: number;
  readonly checkSumAdjustment: number;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
  readonly indexToLocFormat: 0 | 1; // 0 = short 'loca' (uint16 offsets, halved), 1 = long (uint32 offsets) -- see glyf.ts
}

const HEAD_TABLE_SIZE = 54;
const HEAD_MAGIC_NUMBER = 0x5f0f3cf5;
// The design grid a font's own outlines are expressed on. The spec's stated bounds (clause 5.2.2): a power of two between 16 and 16384 is required for TrueType outlines, and any value in that range is permitted for CFF ones -- a value outside it means these are not head-table bytes at all.
const MIN_UNITS_PER_EM = 16;
const MAX_UNITS_PER_EM = 16384;

export function parseHead(font: SfntFont): HeadTable | undefined {
  const bytes = sfntTableBytes(font, 'head');
  if (bytes === undefined || !hasBytes(bytes, 0, HEAD_TABLE_SIZE)) {
    return undefined;
  }
  if (u32(bytes, 12) !== HEAD_MAGIC_NUMBER) {
    return undefined;
  }
  const unitsPerEm = u16(bytes, 18);
  if (unitsPerEm < MIN_UNITS_PER_EM || unitsPerEm > MAX_UNITS_PER_EM) {
    return undefined;
  }
  const indexToLocFormat = i16(bytes, 50);
  if (indexToLocFormat !== 0 && indexToLocFormat !== 1) {
    return undefined;
  }
  return {
    unitsPerEm,
    checkSumAdjustment: u32(bytes, 8),
    xMin: i16(bytes, 36),
    yMin: i16(bytes, 38),
    xMax: i16(bytes, 40),
    yMax: i16(bytes, 42),
    indexToLocFormat,
  };
}

export interface MaxpTable {
  readonly numGlyphs: number;
}

const MAXP_HEADER_SIZE = 6; // version (Fixed) + numGlyphs -- the whole of a version 0.5 'maxp', and the only part of a version 1.0 one anything here reads

export function parseMaxp(font: SfntFont): MaxpTable | undefined {
  const bytes = sfntTableBytes(font, 'maxp');
  if (bytes === undefined || !hasBytes(bytes, 0, MAXP_HEADER_SIZE)) {
    return undefined;
  }
  return { numGlyphs: u16(bytes, 4) };
}

export interface Os2Table {
  readonly version: number;
  // The style/selection bit field (clause 5.2.8 "fsSelection"): bit 0 ITALIC, bit 5 BOLD, bit 6 REGULAR, bit 7 USE_TYPO_METRICS, bit 8 WWS, bit 9 OBLIQUE. Exposed raw rather than decoded, since which bits a consumer cares about depends entirely on what it is matching on.
  readonly fsSelection: number;
  // The ten-byte PANOSE design classification (clause 5.2.8 "panose"), exposed raw: byte 0 is the family kind, byte 1 the serif style for a Latin text family, and the remaining eight weight/proportion/contrast traits nothing here interprets. A font's own answer to "is this a serif design", which is otherwise only guessable from its name.
  readonly panose: readonly number[];
  readonly sTypoAscender: number;
  readonly sTypoDescender: number;
  readonly sTypoLineGap: number;
  readonly usWinAscent: number;
  readonly usWinDescent: number;
  readonly sxHeight: number | undefined; // version 2 and later only
  readonly sCapHeight: number | undefined; // version 2 and later only
}

const OS2_VERSION_0_SIZE = 78; // through usWinDescent, the last field every version carries
const OS2_VERSION_2_SIZE = 96; // through usMaxContext, covering sxHeight/sCapHeight
const OS2_VERSION_WITH_HEIGHTS = 2;
const OS2_PANOSE_OFFSET = 32;
const OS2_PANOSE_SIZE = 10;

export function parseOs2(font: SfntFont): Os2Table | undefined {
  const bytes = sfntTableBytes(font, 'OS/2');
  if (bytes === undefined || !hasBytes(bytes, 0, OS2_VERSION_0_SIZE)) {
    return undefined;
  }
  const version = u16(bytes, 0);
  const hasHeights = version >= OS2_VERSION_WITH_HEIGHTS && hasBytes(bytes, 0, OS2_VERSION_2_SIZE);
  return {
    version,
    fsSelection: u16(bytes, 62),
    panose: [...bytes.subarray(OS2_PANOSE_OFFSET, OS2_PANOSE_OFFSET + OS2_PANOSE_SIZE)],
    sTypoAscender: i16(bytes, 68),
    sTypoDescender: i16(bytes, 70),
    sTypoLineGap: i16(bytes, 72),
    usWinAscent: u16(bytes, 74),
    usWinDescent: u16(bytes, 76),
    sxHeight: hasHeights ? i16(bytes, 86) : undefined,
    sCapHeight: hasHeights ? i16(bytes, 88) : undefined,
  };
}

export interface PostTable {
  readonly version: number; // 0x00010000 / 0x00020000 / 0x00025000 / 0x00030000, as a raw Version16Dot16 -- which of these a font declares decides whether per-glyph names follow the header
  readonly italicAngle: number; // degrees counter-clockwise from vertical, negative for the usual forward slant
  readonly underlinePosition: number; // design units, the top of the underline stroke relative to the baseline
  readonly underlineThickness: number; // design units
}

const POST_HEADER_SIZE = 32;
const FIXED_16_16_SCALE = 65536;

export function parsePost(font: SfntFont): PostTable | undefined {
  const bytes = sfntTableBytes(font, 'post');
  if (bytes === undefined || !hasBytes(bytes, 0, POST_HEADER_SIZE)) {
    return undefined;
  }
  return {
    version: u32(bytes, 0),
    italicAngle: i32(bytes, 4) / FIXED_16_16_SCALE, // a Fixed 16.16, not an integer degree count
    underlinePosition: i16(bytes, 8),
    underlineThickness: i16(bytes, 10),
  };
}

export interface NameTable {
  readonly postScriptName: string | undefined; // nameID 6
  readonly familyName: string | undefined; // nameID 16 (typographic family) where present, else nameID 1
}

const NAME_HEADER_SIZE = 6; // version, count, storageOffset
const NAME_RECORD_SIZE = 12;
const NAME_ID_FAMILY = 1;
const NAME_ID_POSTSCRIPT = 6;
const NAME_ID_TYPOGRAPHIC_FAMILY = 16;
const PLATFORM_UNICODE = 0;
const PLATFORM_MACINTOSH = 1;
const PLATFORM_WINDOWS = 3;
const WINDOWS_ENCODING_UNICODE_BMP = 1;
const MACINTOSH_ENCODING_ROMAN = 0;

interface NameRecord {
  readonly platformId: number;
  readonly encodingId: number;
  readonly nameId: number;
  readonly stringOffset: number; // absolute, within the name table's own bytes
  readonly length: number;
}

// UTF-16BE, the string encoding of every Windows-platform and Unicode-platform name record.
function decodeUtf16Be(bytes: Uint8Array<ArrayBuffer>, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i + 1 < length; i += 2) {
    text += String.fromCharCode((bytes[offset + i]! << 8) | bytes[offset + i + 1]!);
  }
  return text;
}

// A Macintosh/Roman name record. Mac Roman and Latin-1 agree exactly below U+0080 and diverge above it; font family and PostScript names are ASCII in practice (a PostScript name is required to be, clause 5.2.7), so no Mac Roman transcoding table is carried here -- a byte at or above 0x80 in such a record decodes as its Latin-1 character rather than its Mac Roman one.
function decodeMacRoman(bytes: Uint8Array<ArrayBuffer>, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i++) {
    text += String.fromCharCode(bytes[offset + i]!);
  }
  return text;
}

// Windows/Unicode UTF-16BE records are preferred over Macintosh/Roman ones: they are what every modern font tool writes, and the Mac records some fonts still carry alongside them are the legacy copy.
function platformRank(record: NameRecord): number {
  if (record.platformId === PLATFORM_WINDOWS && record.encodingId === WINDOWS_ENCODING_UNICODE_BMP) {
    return 0;
  }
  if (record.platformId === PLATFORM_UNICODE) {
    return 1;
  }
  if (record.platformId === PLATFORM_MACINTOSH && record.encodingId === MACINTOSH_ENCODING_ROMAN) {
    return 2;
  }
  return 3;
}

function readName(bytes: Uint8Array<ArrayBuffer>, records: readonly NameRecord[], nameId: number): string | undefined {
  const matches = records.filter((record) => record.nameId === nameId && platformRank(record) < 3).sort((a, b) => platformRank(a) - platformRank(b));
  for (const record of matches) {
    if (!hasBytes(bytes, record.stringOffset, record.length)) {
      continue; // a record whose string runs past the table: try the next-best platform rather than giving up on the name
    }
    const text = record.platformId === PLATFORM_MACINTOSH ? decodeMacRoman(bytes, record.stringOffset, record.length) : decodeUtf16Be(bytes, record.stringOffset, record.length);
    if (text.length > 0) {
      return text;
    }
  }
  return undefined;
}

export function parseName(font: SfntFont): NameTable | undefined {
  const bytes = sfntTableBytes(font, 'name');
  if (bytes === undefined || !hasBytes(bytes, 0, NAME_HEADER_SIZE)) {
    return undefined;
  }
  const count = u16(bytes, 2);
  const storageOffset = u16(bytes, 4);
  if (!hasBytes(bytes, NAME_HEADER_SIZE, count * NAME_RECORD_SIZE)) {
    return undefined;
  }

  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const recordOffset = NAME_HEADER_SIZE + i * NAME_RECORD_SIZE;
    records.push({
      platformId: u16(bytes, recordOffset),
      encodingId: u16(bytes, recordOffset + 2),
      nameId: u16(bytes, recordOffset + 6),
      length: u16(bytes, recordOffset + 8),
      stringOffset: storageOffset + u16(bytes, recordOffset + 10),
    });
  }

  return {
    postScriptName: readName(bytes, records, NAME_ID_POSTSCRIPT),
    familyName: readName(bytes, records, NAME_ID_TYPOGRAPHIC_FAMILY) ?? readName(bytes, records, NAME_ID_FAMILY),
  };
}
