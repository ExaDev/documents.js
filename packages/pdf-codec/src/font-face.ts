// What a caller inspecting a standalone TrueType/OpenType font FILE needs before using it as a ProvidedFont (src/font-registry.ts): the family/bold/italic triple a font declares about itself, read out of its own 'name'/'OS/2'/'head' tables. This is a thin public wrapper over sfnt.ts's parseSfnt and font-tables.ts's parseName/parseOs2/parseHead -- every one of those already parses the tables this needs; nothing here re-reads a table those modules do not already expose. embedded-font.ts's own EmbeddedFace.postScriptName is the wrong field for this job even though it is already public: a PostScript name is a naming convention rather than a structured family+style pair ("ArialMT", "TimesNewRomanPS-BoldMT"), and recovering a family from one is guesswork where the 'name' table states it outright.
import type { HeadTable, NameTable, Os2Table } from './font-tables';
import { parseHead, parseName, parseOs2 } from './font-tables';
import { hasBytes, parseSfnt, u32 } from './sfnt';

export interface FontFace {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

// The font file could not be read as the font-face triple above: not a recognised sfnt container, no usable family name, or no table this codec can read a weight/slope from. `message` always names what was wrong and, where the caller passed one, the `source` label -- the same shape font-tables.ts's own parsers report through (undefined, degrade-and-continue) is not available here, since a caller asking specifically "what face is this file" has nothing useful left to do with a result that has no family name at all.
export class FontFaceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontFaceParseError';
  }
}

// 'ttcf' (TrueType Collection, ISO/IEC 14496-22 clause 4.1): a container for several table directories behind its own header, not the single-face file this function reads. parseSfnt already declines it (it recognises only the four single-font version tags), so it fails the same generic "not a recognised sfnt" check every other malformed input does; this peek exists purely to give that specific, actionable case its own message rather than a bare "unreadable" one.
const SFNT_VERSION_COLLECTION = 0x74746366;

function isTrueTypeCollection(bytes: Uint8Array<ArrayBuffer>): boolean {
  return hasBytes(bytes, 0, 4) && u32(bytes, 0) === SFNT_VERSION_COLLECTION;
}

// 'OS/2' fsSelection (clause 5.2.8): bit 0 ITALIC, bit 5 BOLD.
const OS2_FS_SELECTION_ITALIC = 0x0001;
const OS2_FS_SELECTION_BOLD = 0x0020;

// 'head' macStyle (clause 5.2.2): bit 0 BOLD, bit 1 ITALIC -- a different bit layout from fsSelection above, not a typo repeating it.
const HEAD_MAC_STYLE_BOLD = 0x0001;
const HEAD_MAC_STYLE_ITALIC = 0x0002;

// 'OS/2' fsSelection is the field the OpenType spec designates as authoritative for a face's own weight/slope; 'head' macStyle is the older field required to agree with it, and the only one a legacy Mac-only TrueType with no 'OS/2' table still declares. fsSelection is read wherever the table exists (parseOs2 already requires enough bytes for it) and macStyle only as the fallback.
function readStyle(head: HeadTable | undefined, os2: Os2Table | undefined, source: string): { readonly bold: boolean; readonly italic: boolean } {
  if (os2 !== undefined) {
    return { bold: (os2.fsSelection & OS2_FS_SELECTION_BOLD) !== 0, italic: (os2.fsSelection & OS2_FS_SELECTION_ITALIC) !== 0 };
  }
  if (head !== undefined) {
    return { bold: (head.macStyle & HEAD_MAC_STYLE_BOLD) !== 0, italic: (head.macStyle & HEAD_MAC_STYLE_ITALIC) !== 0 };
  }
  throw new FontFaceParseError(`${source} declares neither a readable 'OS/2' nor a readable 'head' table, so its weight and slope cannot be determined`);
}

function readFamily(name: NameTable | undefined, source: string): string {
  if (name?.familyName === undefined) {
    throw new FontFaceParseError(`${source} declares no family name in its 'name' table, so the font family it provides cannot be determined`);
  }
  return name.familyName;
}

// Reads a standalone font file's own family/bold/italic declaration -- for a caller holding the raw bytes of a .ttf/.otf a user supplied (e.g. as a ProvidedFont candidate), not a font already extracted from a source document. `source` names the file in every error this throws, matching every other multi-input read path in this package's own callers, since the bytes alone carry no such label.
export function readFontFace(bytes: Uint8Array<ArrayBuffer>, source: string): FontFace {
  const font = parseSfnt(bytes);
  if (font === undefined) {
    if (isTrueTypeCollection(bytes)) {
      throw new FontFaceParseError(`${source} is a TrueType Collection (.ttc), which packs several faces into one file; extract the single face you want and pass that instead`);
    }
    throw new FontFaceParseError(`${source} is not a TrueType/OpenType font file (no recognised sfnt version); a .woff/.woff2 file must be converted to .ttf/.otf first`);
  }

  const family = readFamily(parseName(font), source);
  const { bold, italic } = readStyle(parseHead(font), parseOs2(font), source);
  return { family, bold, italic };
}
