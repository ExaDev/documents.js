import { inflateSync } from "fflate";
import { base64ToBytes } from "byte-codec";
import { CORE_FONT_GLYPH_ORDERS_DEFLATED_BASE64 } from "./glyph-data/core-font-glyph-orders";

// The glyph order of the core faces producers most often embed (the Arial, Times New Roman and Courier New families), for a program that keeps a face's own glyph numbering but carries nothing that says what any glyph draws: no 'cmap', no glyph names. A composite font's CIDs then address glyphs whose characters only the face's published order states, and readers such as Acrobat carry the same knowledge for the same reason.
//
// Knowing the order by the face's name alone would be a guess the first time a subsetter renumbered the glyphs, a producer embedded another face under that name, or a release of the face moved one glyph. So each glyph is accepted only where the program's own advance width for it equals the face's (in the same units per em), which every one of those cases breaks: a renumbered or foreign program puts other widths at those glyph ids, and a glyph a release redrew to a different width stops matching. Compared across two releases of each of these faces, a few glyph ids per face changed advance width and every other glyph kept both its id and its width, so the check refuses those few and costs nothing else.
//
// The data is generated from installed copies of the faces by scripts/generate-core-font-glyph-orders.mjs, whose header describes the binary layout read below.

interface CoreFace {
  readonly unitsPerEm: number;
  // Per glyph id, the text the glyph draws, or undefined where the face states none.
  readonly texts: readonly (string | undefined)[];
  readonly advances: Uint16Array;
}

// Field sizes of the binary layout, in bytes.
const FACE_COUNT_SIZE = 2;
const NAME_LENGTH_SIZE = 1;
const FACE_HEADER_SIZE = 4; // unitsPerEm uint16, glyph count uint16
const CODE_POINT_COUNT_SIZE = 1;
const CODE_POINT_SIZE = 3; // uint24
const ADVANCE_SIZE = 2;
const BITS_PER_BYTE = 8;

let faces: ReadonlyMap<string, CoreFace> | undefined;

function readFaces(): ReadonlyMap<string, CoreFace> {
  if (faces !== undefined) {
    return faces;
  }
  const bytes = inflateSync(
    base64ToBytes(CORE_FONT_GLYPH_ORDERS_DEFLATED_BASE64),
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = new Map<string, CoreFace>();
  let at = FACE_COUNT_SIZE;
  for (let face = 0; face < view.getUint16(0); face++) {
    const nameLength = view.getUint8(at);
    at += NAME_LENGTH_SIZE;
    const name = String.fromCharCode(...bytes.subarray(at, at + nameLength));
    at += nameLength;
    const unitsPerEm = view.getUint16(at);
    const glyphCount = view.getUint16(at + 2);
    at += FACE_HEADER_SIZE;
    const texts: (string | undefined)[] = [];
    const advances = new Uint16Array(glyphCount);
    for (let glyphId = 0; glyphId < glyphCount; glyphId++) {
      const codePointCount = view.getUint8(at);
      at += CODE_POINT_COUNT_SIZE;
      const codePoints: number[] = [];
      for (let i = 0; i < codePointCount; i++) {
        codePoints.push(
          (view.getUint8(at) << (2 * BITS_PER_BYTE)) | view.getUint16(at + 1),
        );
        at += CODE_POINT_SIZE;
      }
      texts.push(
        codePoints.length === 0
          ? undefined
          : String.fromCodePoint(...codePoints),
      );
      advances[glyphId] = view.getUint16(at);
      at += ADVANCE_SIZE;
    }
    read.set(name, { unitsPerEm, texts, advances });
  }
  faces = read;
  return read;
}

/**
 * The glyph order of a core face, checked glyph by glyph against the program that claims to be it.
 * @param postScriptName - the face's PostScript name without any subset tag, as the program's own 'name' table states it or, for a program with none, as the font dictionary's /BaseFont does
 * @param unitsPerEm - the program's own design grid; a program on another grid is not the face, whatever its name
 * @returns a lookup from a glyph id and the program's own advance width for that glyph to the character the face draws there, answering undefined wherever the width disagrees with the face's or the face draws no character; or undefined when the name is not a core face or the grid is not the face's
 */
export function coreFaceGlyphOrder(
  postScriptName: string,
  unitsPerEm: number,
): ((glyphId: number, advanceWidth: number) => string | undefined) | undefined {
  const face = readFaces().get(postScriptName);
  if (face?.unitsPerEm !== unitsPerEm) {
    return undefined;
  }
  return (glyphId, advanceWidth) =>
    face.advances[glyphId] === advanceWidth ? face.texts[glyphId] : undefined;
}

/** The PostScript names of the core faces, by the family and style a font name spells with its punctuation, subset tag and Distiller size suffix taken off. */
const CORE_FACE_BY_SPELLING: ReadonlyMap<string, string> = new Map([
  ["arial", "ArialMT"],
  ["arialmt", "ArialMT"],
  ["arialbold", "Arial-BoldMT"],
  ["arialboldmt", "Arial-BoldMT"],
  ["arialitalic", "Arial-ItalicMT"],
  ["arialitalicmt", "Arial-ItalicMT"],
  ["arialbolditalic", "Arial-BoldItalicMT"],
  ["arialbolditalicmt", "Arial-BoldItalicMT"],
  ["timesnewroman", "TimesNewRomanPSMT"],
  ["timesnewromanpsmt", "TimesNewRomanPSMT"],
  ["timesnewromanbold", "TimesNewRomanPS-BoldMT"],
  ["timesnewromanpsboldmt", "TimesNewRomanPS-BoldMT"],
  ["timesnewromanitalic", "TimesNewRomanPS-ItalicMT"],
  ["timesnewromanpsitalicmt", "TimesNewRomanPS-ItalicMT"],
  ["timesnewromanbolditalic", "TimesNewRomanPS-BoldItalicMT"],
  ["timesnewromanpsbolditalicmt", "TimesNewRomanPS-BoldItalicMT"],
  ["couriernew", "CourierNewPSMT"],
  ["couriernewpsmt", "CourierNewPSMT"],
  ["couriernewbold", "CourierNewPS-BoldMT"],
  ["couriernewpsboldmt", "CourierNewPS-BoldMT"],
  ["couriernewitalic", "CourierNewPS-ItalicMT"],
  ["couriernewpsitalicmt", "CourierNewPS-ItalicMT"],
  ["couriernewbolditalic", "CourierNewPS-BoldItalicMT"],
  ["couriernewpsbolditalicmt", "CourierNewPS-BoldItalicMT"],
]);

const ZERO_CODE = 48; // "0"
const NINE_CODE = 57; // "9"
const FULL_STOP_CODE = 46; // "."

function isDigitAt(name: string, index: number): boolean {
  const code = name.charCodeAt(index);
  return code >= ZERO_CODE && code <= NINE_CODE;
}

// The index the run of digits ending just before `end` starts at, or `end` when no digit precedes it.
function digitRunStart(name: string, end: number): number {
  let start = end;
  while (start > 0 && isDigitAt(name, start - 1)) {
    start -= 1;
  }
  return start;
}

/**
 * `name` without a trailing size or version number a producer appends to a font name ("Arial.Bold0133", "Arial086.75"): digits, optionally a fraction. Found by one scan back from the end, so the work is the length of the number and not of the name: the end-anchored pattern this replaces (a digit run followed by an optional fraction, then the end) is retried from every offset of a long digit run that a letter follows, which takes time quadratic in its length.
 * @param name - A `/BaseFont` name.
 * @returns The name with its trailing number cut off, or the name itself when it does not end in one.
 */
export function withoutTrailingNumber(name: string): string {
  const fractionStart = digitRunStart(name, name.length);
  if (fractionStart === name.length) {
    return name;
  }
  const point = fractionStart - 1;
  if (point > 0 && name.charCodeAt(point) === FULL_STOP_CODE) {
    const wholeStart = digitRunStart(name, point);
    if (wholeStart < point) {
      return name.slice(0, wholeStart);
    }
  }
  return name.slice(0, fractionStart);
}

/**
 * The PostScript name of the core face a font name spells, or `undefined` when it spells none: `TimesNewRoman` and `Times.New.Roman.Bold092` are `TimesNewRomanPSMT` and `TimesNewRomanPS-BoldMT`. A spelling is only a candidate: the glyph order is accepted per glyph, against the font dictionary's own widths (`coreFaceTextOfNumberedGlyph`).
 * @param fontName - A `/BaseFont` name, with or without its subset tag.
 * @returns The face's PostScript name, or `undefined`.
 */
export function coreFaceNameOfFontName(fontName: string): string | undefined {
  const spelled = withoutTrailingNumber(fontName.replace(/^[A-Z]{6}\+/u, ""))
    .replace(/[^A-Za-z]/gu, "")
    .toLowerCase();
  return CORE_FACE_BY_SPELLING.get(spelled);
}

// Adobe Acrobat's optimiser converts a TrueType face to a CFF subset and names each glyph G followed by its glyph id in the face: G36 is the glyph the face numbers 36.
const NUMBERED_GLYPH_NAME = /^G(\d+)$/u;

// How far, in thousandths of an em, a font dictionary's width for a glyph may be from the face's advance for it and still agree: the dictionary's widths are the converted program's, which this producer rounds and hints, and measured against the face they differ by up to 22 (a 489 for a 500, a 507 for a 500); two core faces differ by far more on most letters (a capital G is 722 in Times New Roman and 778 in Arial).
const WIDTH_AGREEMENT_TOLERANCE = 25;
const THOUSANDTHS_PER_EM = 1000;
// A font is taken for a core face only when at least this share of its numbered glyphs agree in width, over at least `MIN_NUMBERED_GLYPHS` glyphs: a share, because a glyph or two (a ligature, a width the producer rounded the other way) may disagree, and a count, because one or two widths cannot tell one face from another.
const MIN_AGREEING_SHARE = 0.9;
const MIN_NUMBERED_GLYPHS = 5;

/**
 * What a core face draws at the glyphs of a CFF subset that names each `G<id>`, accepted for the whole font only when the font dictionary's widths agree with the face's advances over at least `MIN_NUMBERED_GLYPHS` glyphs and `MIN_AGREEING_SHARE` of them, so a subset of any other face, or of another release of this one, is read as before.
 * @param fontName - The font's `/BaseFont`.
 * @param glyphs - Each glyph of the font a `/Differences` array names, with the width, in thousandths of an em, the dictionary gives its code.
 * @returns The character each numbered glyph name draws, or `undefined` when the font is not taken for a core face.
 */
export function coreFaceTextsOfNumberedGlyphs(
  fontName: string,
  glyphs: readonly { readonly name: string; readonly width: number }[],
): ReadonlyMap<string, string> | undefined {
  const faceName = coreFaceNameOfFontName(fontName);
  const face = faceName === undefined ? undefined : readFaces().get(faceName);
  if (face === undefined) {
    return undefined;
  }
  const texts = new Map<string, string>();
  let numbered = 0;
  let agreeing = 0;
  for (const { name, width } of glyphs) {
    const id = NUMBERED_GLYPH_NAME.exec(name)?.[1];
    const advance =
      id === undefined ? undefined : face.advances[Number.parseInt(id, 10)];
    if (id === undefined || advance === undefined) {
      continue;
    }
    numbered++;
    const text = face.texts[Number.parseInt(id, 10)];
    if (
      Math.abs((advance * THOUSANDTHS_PER_EM) / face.unitsPerEm - width) <=
      WIDTH_AGREEMENT_TOLERANCE
    ) {
      agreeing++;
      if (text !== undefined) {
        texts.set(name, text);
      }
    }
  }
  return numbered >= MIN_NUMBERED_GLYPHS &&
    agreeing >= numbered * MIN_AGREEING_SHARE
    ? texts
    : undefined;
}
