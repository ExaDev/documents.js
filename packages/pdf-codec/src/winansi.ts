import type { StandardFontName } from "./afm-widths";
import { widthOfCode } from "./afm-widths";

// Unicode code point -> WinAnsi (CP1252) byte, for every code point WinAnsi can represent. Derived programmatically from the platform's own `TextDecoder('windows-1252')` (i.e. verified against a real, independent CP1252 implementation, not transcribed by hand), excluding the handful of genuinely-unassigned CP1252 byte positions (0x81, 0x8D, 0x8F, 0x90, 0x9D) that decoders conventionally fall back to mapping onto their own byte value as a C1 control code — never a legitimate target for encoding real text.
//
// CP1252 is identity with Unicode across two contiguous byte ranges: printable ASCII, and the Latin-1 supplement range CP1252 also assigns identically. The C1 control range in between (0x80-0x9F) is exactly where CP1252 diverges from Latin-1, assigning its own printable characters instead of control codes there, which is why that range cannot be generated the same way and is listed explicitly below.
const ASCII_PRINTABLE_START = 0x20; // ' '
const ASCII_PRINTABLE_END = 0x7f; // DEL
const LATIN1_SUPPLEMENT_START = 0xa0; // NBSP
const LATIN1_SUPPLEMENT_END = 0xff; // ydieresis

// One [unicode, winAnsi] entry per code point in an identity range: both the byte read and the byte written are the same value, over an inclusive range.
function identityRangeEntries(
  start: number,
  end: number,
): readonly (readonly [number, number])[] {
  const entries: (readonly [number, number])[] = [];
  for (let code = start; code <= end; code++) {
    entries.push([code, code]);
  }
  return entries;
}

// The code points CP1252 assigns in its own C1 control byte range (0x80-0x9F), replacing what Latin-1 reserves there for control codes. Each entry is an object rather than a [unicode, winAnsi] tuple, so its two numbers are object-literal property values rather than array elements: the same table, laid out to read as data.
const CP1252_EXTENDED_MAPPINGS: readonly {
  readonly unicode: number;
  readonly winAnsi: number;
}[] = [
  { unicode: 0x152, winAnsi: 0x8c }, // OE
  { unicode: 0x153, winAnsi: 0x9c }, // oe
  { unicode: 0x160, winAnsi: 0x8a }, // Scaron
  { unicode: 0x161, winAnsi: 0x9a }, // scaron
  { unicode: 0x178, winAnsi: 0x9f }, // Ydieresis
  { unicode: 0x17d, winAnsi: 0x8e }, // Zcaron
  { unicode: 0x17e, winAnsi: 0x9e }, // zcaron
  { unicode: 0x192, winAnsi: 0x83 }, // florin
  { unicode: 0x2c6, winAnsi: 0x88 }, // circumflex
  { unicode: 0x2dc, winAnsi: 0x98 }, // tilde
  { unicode: 0x2013, winAnsi: 0x96 }, // endash
  { unicode: 0x2014, winAnsi: 0x97 }, // emdash
  { unicode: 0x2018, winAnsi: 0x91 }, // quoteleft
  { unicode: 0x2019, winAnsi: 0x92 }, // quoteright
  { unicode: 0x201a, winAnsi: 0x82 }, // quotesinglbase
  { unicode: 0x201c, winAnsi: 0x93 }, // quotedblleft
  { unicode: 0x201d, winAnsi: 0x94 }, // quotedblright
  { unicode: 0x201e, winAnsi: 0x84 }, // quotedblbase
  { unicode: 0x2020, winAnsi: 0x86 }, // dagger
  { unicode: 0x2021, winAnsi: 0x87 }, // daggerdbl
  { unicode: 0x2022, winAnsi: 0x95 }, // bullet
  { unicode: 0x2026, winAnsi: 0x85 }, // ellipsis
  { unicode: 0x2030, winAnsi: 0x89 }, // perthousand
  { unicode: 0x2039, winAnsi: 0x8b }, // guilsinglleft
  { unicode: 0x203a, winAnsi: 0x9b }, // guilsinglright
  { unicode: 0x20ac, winAnsi: 0x80 }, // Euro
  { unicode: 0x2122, winAnsi: 0x99 }, // trademark
];

const UNICODE_TO_WINANSI: ReadonlyMap<number, number> = new Map([
  ...identityRangeEntries(ASCII_PRINTABLE_START, ASCII_PRINTABLE_END),
  ...identityRangeEntries(LATIN1_SUPPLEMENT_START, LATIN1_SUPPLEMENT_END),
  ...CP1252_EXTENDED_MAPPINGS.map((entry): readonly [number, number] => [
    entry.unicode,
    entry.winAnsi,
  ]),
]);

let winAnsiCodeToUnicodeTable: ReadonlyMap<number, number> | undefined;

// The inverse of UNICODE_TO_WINANSI, built once on first use: WinAnsi code (0-255) -> Unicode code point. Used by the read path (encoding.ts's glyphNameToUnicode, font-read.ts's simple-font fallback decoding) to recover text when no /ToUnicode CMap is present — the write path never needs this direction.
export function winAnsiCodeToUnicode(code: number): number | undefined {
  if (winAnsiCodeToUnicodeTable === undefined) {
    const inverted = new Map<number, number>();
    for (const [unicode, winAnsiCode] of UNICODE_TO_WINANSI) {
      inverted.set(winAnsiCode, unicode);
    }
    winAnsiCodeToUnicodeTable = inverted;
  }
  return winAnsiCodeToUnicodeTable.get(code);
}

// The byte substituted for any character with no WinAnsi representation — '?' (0x3F), always representable, and visually signals "something was lost" rather than silently vanishing.
const FALLBACK_BYTE = 0x3f;
const FALLBACK_CHAR = "?";

export interface WinAnsiSubstitution {
  readonly from: string;
  readonly to: string;
}

export interface SanitizeResult {
  readonly codes: Uint8Array<ArrayBuffer>; // one WinAnsi byte per character
  readonly substitutions: readonly WinAnsiSubstitution[];
}

// Converts `text` to WinAnsi bytes, substituting FALLBACK_CHAR for any character outside what the standard-14 fonts' WinAnsiEncoding can represent (any script outside Latin-1 plus the CP1252 extensions: CJK, Cyrillic, Greek, emoji, etc.). This is mandatory before every drawn text string — the alternative (throwing on the first unencodable character, as a naive implementation would) would abort an entire multi-page conversion over a single foreign name or symbol.
export function sanitizeToWinAnsi(text: string): SanitizeResult {
  const codes: number[] = [];
  const substitutions: WinAnsiSubstitution[] = [];
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    const code =
      codePoint === undefined ? undefined : UNICODE_TO_WINANSI.get(codePoint);
    if (code !== undefined) {
      codes.push(code);
      continue;
    }
    codes.push(FALLBACK_BYTE);
    substitutions.push({ from: ch, to: FALLBACK_CHAR });
  }
  return { codes: new Uint8Array(codes), substitutions };
}

export interface EncodedShow {
  readonly codes: Uint8Array<ArrayBuffer>;
  readonly width1000: number; // total advance width in 1000-unit em space, at size 1000
  readonly substitutions: readonly WinAnsiSubstitution[];
}

// The single code path both measurement (src/pdf/measure.ts) and content-stream emission (src/pdf/content-write.ts) go through: sanitizing and measuring in two separate steps risks the two disagreeing about which characters were substituted, which would silently desync a wrap point from what's actually drawn.
export function encodeForShow(
  text: string,
  font: StandardFontName,
): EncodedShow {
  const { codes, substitutions } = sanitizeToWinAnsi(text);
  let width1000 = 0;
  for (const code of codes) {
    width1000 += widthOfCode(font, code);
  }
  return { codes, width1000, substitutions };
}
