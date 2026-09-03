import type { CffIndex } from "./cff";
import {
  CFF_DICT_OP_CHARSET,
  CFF_DICT_OP_CHARSTRINGS,
  CFF_DICT_OP_ENCODING,
  CFF_DICT_OP_ROS,
  cffStringForSid,
  parseCffDict,
  readCffIndex,
} from "./cff";
import type { CmapSubtable } from "./cmap-table";
import { readCmapSubtables } from "./cmap-table";
import { glyphNameToUnicode, standardGlyphName } from "./encoding";
import { parsePostGlyphNames } from "./font-tables";
import type { SfntFont } from "./sfnt";
import { hasBytes, parseSfnt, sfntTableBytes, u8, u16 } from "./sfnt";

// A font's *built-in* encoding: the character-code-to-glyph mapping the embedded font program carries inside itself, as opposed to the one the PDF font dictionary states through /Encoding or /ToUnicode. For a symbol-encoded font -- a subset embedded to draw Ω, µ, ± or ≤ at whatever codes its producer happened to pick -- the program is the only place that mapping exists at all, and ISO 32000-1 9.6.6.2 makes it the base encoding whenever the font dictionary names none. Reading it is what separates "code 0x57 in this font draws an ohm sign" from the WinAnsi guess that silently yields "W" (ExaDev/documents.js#834).
//
// Three program shapes carry an encoding, and this module reads all three because a PDF may embed any of them for the same font:
//   - TrueType (/FontFile2, or an sfnt-wrapped /FontFile3 /OpenType): the 'cmap' table's (3, 0) Microsoft Symbol or (1, 0) Macintosh subtable maps codes to glyph IDs (9.6.6.4), and the glyph is then identified by the 'post' table's own name for it, or by reversing the font's Unicode subtable.
//   - CFF (/FontFile3 /Type1C, or an sfnt 'CFF ' table): the Top DICT's Encoding operator maps codes to glyphs and its charset names each glyph, both directly (CFF 1.0 spec, sections 12 and 13).
//   - Type 1 (/FontFile): the /Encoding array in the program's own cleartext header names a glyph per code outright.
//
// Every route ends at a PostScript glyph name resolved through the Adobe Glyph List, or -- where a subsetting tool has stripped the names -- at a code point recovered by reading the program's Unicode mapping backwards. Where neither is available the answer is `undefined`, never a guess: the caller reports an honestly unmapped code rather than a plausible wrong character.

export interface BuiltinEncoding {
  // The program's own character code -> Unicode code point. Always undefined for a program that states no code-keyed encoding at all (a CID-keyed CFF, or a TrueType with no symbolic subtable), which is exactly the case a simple font must fall back from.
  codeToUnicode(code: number): number | undefined;
  // Glyph ID -> Unicode code point, for a composite font whose CIDs address the program's own glyphs directly.
  glyphIdToUnicode(glyphId: number): number | undefined;
}

// The private-use planes, which name no character: reversing a Unicode subtable that maps only these (what a symbol font's own (3, 1) subtable usually is) yields a code point that identifies the glyph within that one font and nothing beyond it, so it is treated as no answer rather than a wrong one.
function isPrivateUse(codePoint: number): boolean {
  return (
    (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
    (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
    (codePoint >= 0x100000 && codePoint <= 0x10fffd)
  );
}

// The sources a program can supply, each independently optional: a code -> glyph mapping, a glyph -> name mapping, and a glyph -> code point mapping recovered from a Unicode subtable. A Type 1 program supplies a code -> name mapping directly instead, with no glyph IDs anywhere in it.
interface ProgramSources {
  readonly codeToGlyphId?: (code: number) => number | undefined;
  readonly codeToName?: (code: number) => string | undefined;
  readonly glyphIdToName?: (glyphId: number) => string | undefined;
  readonly glyphIdToUnicode?: (glyphId: number) => number | undefined;
}

function encodingFromSources(
  sources: ProgramSources,
): BuiltinEncoding | undefined {
  const { codeToGlyphId, codeToName, glyphIdToName, glyphIdToUnicode } =
    sources;
  const glyphUnicode = (glyphId: number): number | undefined => {
    const name = glyphIdToName?.(glyphId);
    const named = name !== undefined ? glyphNameToUnicode(name) : undefined;
    return named ?? glyphIdToUnicode?.(glyphId);
  };
  const codeUnicode = (code: number): number | undefined => {
    const name = codeToName?.(code);
    if (name !== undefined) {
      const named = glyphNameToUnicode(name);
      if (named !== undefined) {
        return named;
      }
    }
    const glyphId = codeToGlyphId?.(code);
    return glyphId === undefined ? undefined : glyphUnicode(glyphId);
  };
  const stated =
    codeToName !== undefined ||
    codeToGlyphId !== undefined ||
    glyphIdToName !== undefined ||
    glyphIdToUnicode !== undefined;
  return stated
    ? { codeToUnicode: codeUnicode, glyphIdToUnicode: glyphUnicode }
    : undefined;
}

const SYMBOL_CMAP_CODE_BASE = 0xf000; // ISO 32000-1 9.6.6.4: a (3, 0) subtable's codes are the font's own 8-bit codes offset into the 0xF000 private-use range

function symbolSubtable(
  subtables: readonly CmapSubtable[],
): CmapSubtable | undefined {
  return (
    subtables.find((s) => s.platformId === 3 && s.encodingId === 0) ??
    subtables.find((s) => s.platformId === 1 && s.encodingId === 0)
  );
}

function unicodeSubtable(
  subtables: readonly CmapSubtable[],
): CmapSubtable | undefined {
  return (
    subtables.find((s) => s.platformId === 3 && s.encodingId === 10) ??
    subtables.find((s) => s.platformId === 3 && s.encodingId === 1) ??
    subtables.find((s) => s.platformId === 0)
  );
}

// Inverts a Unicode subtable, built once on first use. A glyph reachable from several code points keeps the first non-private-use one found, so a symbol glyph that a font maps both from a real code point and from its own private-use alias is identified by the real one.
function invertUnicodeSubtable(
  subtable: CmapSubtable,
): (glyphId: number) => number | undefined {
  let inverse: Map<number, number> | undefined;
  return (glyphId) => {
    if (inverse === undefined) {
      const built = new Map<number, number>();
      subtable.forEachMapping((code, mappedGlyphId) => {
        if (!isPrivateUse(code) && !built.has(mappedGlyphId)) {
          built.set(mappedGlyphId, code);
        }
      });
      inverse = built;
    }
    return inverse.get(glyphId);
  };
}

function trueTypeSources(font: SfntFont): ProgramSources {
  const subtables = readCmapSubtables(font);
  const symbol = symbolSubtable(subtables);
  const unicode = unicodeSubtable(subtables);
  const symbolLookup =
    symbol !== undefined
      ? (code: number): number | undefined =>
          symbol.lookup(SYMBOL_CMAP_CODE_BASE | code) ?? symbol.lookup(code)
      : // A font with no symbolic subtable at all may still have put its symbol glyphs in the private-use range of its Unicode subtable, which some producers do instead of writing a (3, 0) table. An ordinary Latin font maps nothing at 0xF041, so this can only fire for a font that genuinely encoded itself that way.
        unicode !== undefined
        ? (code: number): number | undefined =>
            unicode.lookup(SYMBOL_CMAP_CODE_BASE | code)
        : undefined;
  return {
    codeToGlyphId: symbolLookup,
    glyphIdToName: parsePostGlyphNames(font),
    glyphIdToUnicode:
      unicode !== undefined ? invertUnicodeSubtable(unicode) : undefined,
  };
}

const CFF_HEADER_SIZE = 4;
const CFF_MAJOR_VERSION = 1;
const CFF_PREDEFINED_CHARSET_ISO_ADOBE = 0;
const CFF_PREDEFINED_ENCODING_STANDARD = 0;
const CFF_ENCODING_FORMAT_MASK = 0x7f;
const CFF_ENCODING_SUPPLEMENT_FLAG = 0x80;

// A CFF charset (spec section 13): glyph ID -> SID, for glyphs 1..nGlyphs-1 (glyph 0 is always .notdef). The predefined ISOAdobe charset numbers SIDs to match glyph order; the Expert charsets (1 and 2) are not read, so a font using one is left nameless rather than misnamed.
function readCffCharset(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
  glyphCount: number,
): Map<number, number> | undefined {
  const sidByGlyph = new Map<number, number>();
  if (offset === CFF_PREDEFINED_CHARSET_ISO_ADOBE) {
    for (let glyphId = 1; glyphId < glyphCount; glyphId++) {
      sidByGlyph.set(glyphId, glyphId);
    }
    return sidByGlyph;
  }
  if (offset < CFF_HEADER_SIZE || !hasBytes(bytes, offset, 1)) {
    return undefined;
  }
  const format = u8(bytes, offset);
  let cursor = offset + 1;
  if (format === 0) {
    for (let glyphId = 1; glyphId < glyphCount; glyphId++) {
      if (!hasBytes(bytes, cursor, 2)) {
        return sidByGlyph;
      }
      sidByGlyph.set(glyphId, u16(bytes, cursor));
      cursor += 2;
    }
    return sidByGlyph;
  }
  if (format !== 1 && format !== 2) {
    return undefined;
  }
  const nLeftSize = format === 1 ? 1 : 2;
  let glyphId = 1;
  while (glyphId < glyphCount) {
    if (!hasBytes(bytes, cursor, 2 + nLeftSize)) {
      return sidByGlyph;
    }
    const firstSid = u16(bytes, cursor);
    const nLeft = format === 1 ? u8(bytes, cursor + 2) : u16(bytes, cursor + 2);
    for (let i = 0; i <= nLeft && glyphId < glyphCount; i++) {
      sidByGlyph.set(glyphId, firstSid + i);
      glyphId++;
    }
    cursor += 2 + nLeftSize;
  }
  return sidByGlyph;
}

// A CFF custom encoding (spec section 12): character code -> glyph ID, either as one code per glyph (format 0) or as ranges of consecutive codes (format 1), optionally followed by supplementary codes that address a glyph by its SID instead.
function readCffEncoding(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
  glyphCount: number,
  glyphBySid: ReadonlyMap<number, number>,
): Map<number, number> | undefined {
  if (offset < CFF_HEADER_SIZE || !hasBytes(bytes, offset, 2)) {
    return undefined;
  }
  const formatByte = u8(bytes, offset);
  const format = formatByte & CFF_ENCODING_FORMAT_MASK;
  const glyphByCode = new Map<number, number>();
  let cursor = offset + 1;
  if (format === 0) {
    const nCodes = u8(bytes, cursor);
    cursor += 1;
    for (let i = 0; i < nCodes; i++) {
      if (!hasBytes(bytes, cursor, 1)) {
        return glyphByCode;
      }
      const glyphId = i + 1;
      if (glyphId < glyphCount) {
        glyphByCode.set(u8(bytes, cursor), glyphId);
      }
      cursor += 1;
    }
  } else if (format === 1) {
    const nRanges = u8(bytes, cursor);
    cursor += 1;
    let glyphId = 1;
    for (let i = 0; i < nRanges; i++) {
      if (!hasBytes(bytes, cursor, 2)) {
        return glyphByCode;
      }
      const first = u8(bytes, cursor);
      const nLeft = u8(bytes, cursor + 1);
      for (let j = 0; j <= nLeft && glyphId < glyphCount; j++) {
        glyphByCode.set(first + j, glyphId);
        glyphId++;
      }
      cursor += 2;
    }
  } else {
    return undefined;
  }

  if ((formatByte & CFF_ENCODING_SUPPLEMENT_FLAG) !== 0) {
    if (!hasBytes(bytes, cursor, 1)) {
      return glyphByCode;
    }
    const nSups = u8(bytes, cursor);
    cursor += 1;
    for (let i = 0; i < nSups; i++) {
      if (!hasBytes(bytes, cursor, 3)) {
        return glyphByCode;
      }
      const glyphId = glyphBySid.get(u16(bytes, cursor + 1));
      if (glyphId !== undefined) {
        glyphByCode.set(u8(bytes, cursor), glyphId);
      }
      cursor += 3;
    }
  }
  return glyphByCode;
}

// `predefinedEncodingApplies` is false for a CFF wrapped in an sfnt: an OpenType font states its encoding in the container's own 'cmap' table and leaves the CFF Encoding operator absent, so reading that absence as "Adobe StandardEncoding" would override the real encoding with a Latin one.
function cffSources(
  bytes: Uint8Array<ArrayBuffer>,
  predefinedEncodingApplies: boolean,
): ProgramSources | undefined {
  if (!hasBytes(bytes, 0, CFF_HEADER_SIZE)) {
    return undefined;
  }
  const headerSize = u8(bytes, 2);
  if (u8(bytes, 0) !== CFF_MAJOR_VERSION || headerSize < CFF_HEADER_SIZE) {
    return undefined;
  }
  const nameIndex = readCffIndex(bytes, headerSize);
  if (nameIndex === undefined) {
    return undefined;
  }
  const topDictIndex = readCffIndex(bytes, nameIndex.endOffset);
  const topDictBytes = topDictIndex?.entry(0);
  if (topDictIndex === undefined || topDictBytes === undefined) {
    return undefined;
  }
  const topDict = parseCffDict(topDictBytes);
  // A CID-keyed font has no built-in encoding at all: its codes reach glyphs through the PDF's own CMap, and its charset holds CIDs rather than name SIDs, so nothing here would name a glyph correctly.
  if (topDict === undefined || topDict.has(CFF_DICT_OP_ROS)) {
    return undefined;
  }
  const stringIndex: CffIndex | undefined = readCffIndex(
    bytes,
    topDictIndex.endOffset,
  );

  const charStringsOffset = topDict.get(CFF_DICT_OP_CHARSTRINGS)?.[0];
  const glyphCount =
    charStringsOffset === undefined
      ? undefined
      : readCffIndex(bytes, charStringsOffset)?.count;
  if (glyphCount === undefined) {
    return undefined;
  }

  const sidByGlyph = readCffCharset(
    bytes,
    topDict.get(CFF_DICT_OP_CHARSET)?.[0] ?? CFF_PREDEFINED_CHARSET_ISO_ADOBE,
    glyphCount,
  );
  const glyphIdToName =
    sidByGlyph === undefined
      ? undefined
      : (glyphId: number): string | undefined => {
          const sid = sidByGlyph.get(glyphId);
          return sid === undefined
            ? undefined
            : cffStringForSid(sid, stringIndex);
        };

  const encodingOffset =
    topDict.get(CFF_DICT_OP_ENCODING)?.[0] ?? CFF_PREDEFINED_ENCODING_STANDARD;
  if (encodingOffset === CFF_PREDEFINED_ENCODING_STANDARD) {
    // Predefined encoding 0 is Adobe StandardEncoding itself, which names a glyph per code with no reference to this font's own glyph order.
    return predefinedEncodingApplies
      ? { codeToName: standardGlyphName, glyphIdToName }
      : { glyphIdToName };
  }
  const glyphBySid = new Map<number, number>();
  for (const [glyphId, sid] of sidByGlyph ?? []) {
    if (!glyphBySid.has(sid)) {
      glyphBySid.set(sid, glyphId);
    }
  }
  const glyphByCode = readCffEncoding(
    bytes,
    encodingOffset,
    glyphCount,
    glyphBySid,
  );
  return glyphByCode === undefined
    ? { glyphIdToName }
    : { codeToGlyphId: (code) => glyphByCode.get(code), glyphIdToName };
}

function matchesAscii(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
  text: string,
): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

const TYPE1_CLEARTEXT_TERMINATOR = "eexec"; // the keyword ending a Type 1 program's cleartext header, after which the rest is encrypted (Type 1 Font Format, chapter 7)
const PFB_SEGMENT_MARKER = 0x80;
const PFB_SEGMENT_HEADER_SIZE = 6;
const POSTSCRIPT_MAGIC = "%!"; // every Type 1 program opens with this document-structuring comment

// A Type 1 program's own /Encoding array, read out of the cleartext header: either the literal name StandardEncoding, or a run of `dup <code> /<name> put` assignments into a 256-element array (Type 1 Font Format, section 5.3). The encrypted portion after `eexec` holds only the charstrings, never the encoding, so no decryption is needed to read this.
function type1Sources(
  bytes: Uint8Array<ArrayBuffer>,
): ProgramSources | undefined {
  // A PFB-segmented program, if a producer embedded one rather than the bare PFA form a PDF /FontFile normally carries, opens with a six-byte binary segment header before the same ASCII text.
  const start = bytes[0] === PFB_SEGMENT_MARKER ? PFB_SEGMENT_HEADER_SIZE : 0;
  if (!matchesAscii(bytes, start, POSTSCRIPT_MAGIC)) {
    return undefined;
  }
  let cleartextEnd = bytes.length;
  for (
    let i = start;
    i + TYPE1_CLEARTEXT_TERMINATOR.length <= bytes.length;
    i++
  ) {
    if (matchesAscii(bytes, i, TYPE1_CLEARTEXT_TERMINATOR)) {
      cleartextEnd = i;
      break;
    }
  }
  let header = "";
  for (let i = start; i < cleartextEnd; i++) {
    header += String.fromCharCode(bytes[i] ?? 0);
  }
  if (!header.includes("/Encoding")) {
    return undefined;
  }
  if (/\/Encoding\s+StandardEncoding\s+def/.test(header)) {
    return { codeToName: standardGlyphName };
  }
  const nameByCode = new Map<number, string>();
  for (const match of header.matchAll(
    /dup\s+(\d+)\s*\/([^\s/[\]{}<>()%]+)\s+put/g,
  )) {
    const code = Number(match[1]);
    const name = match[2];
    if (name !== undefined && Number.isInteger(code)) {
      nameByCode.set(code, name);
    }
  }
  return nameByCode.size === 0
    ? undefined
    : { codeToName: (code) => nameByCode.get(code) };
}

// Reads whatever encoding an embedded font program carries in itself. `undefined` means this program states nothing this codec can read -- a program in a format not read here, or one too damaged to parse -- and the caller must fall back rather than treat the absence as a mapping.
export function readFontProgramEncoding(
  program: Uint8Array<ArrayBuffer>,
): BuiltinEncoding | undefined {
  const font = parseSfnt(program);
  if (font !== undefined) {
    const cff = sfntTableBytes(font, "CFF ");
    const container = trueTypeSources(font);
    // A CFF-flavoured OpenType font carries both halves: the CFF program names the glyphs where the container's 'post' table does not, while the container's own 'cmap' remains what says which codes reach them.
    const outlines = cff === undefined ? undefined : cffSources(cff, false);
    return encodingFromSources({
      codeToGlyphId: container.codeToGlyphId ?? outlines?.codeToGlyphId,
      glyphIdToName: container.glyphIdToName ?? outlines?.glyphIdToName,
      glyphIdToUnicode: container.glyphIdToUnicode,
    });
  }
  const cff = cffSources(program, true);
  if (cff !== undefined) {
    return encodingFromSources(cff);
  }
  const type1 = type1Sources(program);
  return type1 === undefined ? undefined : encodingFromSources(type1);
}
