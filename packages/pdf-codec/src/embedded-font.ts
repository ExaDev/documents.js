import type { CmapLookup } from './cmap-table';
import { buildCmapLookup } from './cmap-table';
import { parseHead, parseMaxp, parseName, parseOs2, parsePost } from './font-tables';
import { parseGlyf } from './glyf';
import type { HmtxTable } from './hmtx-table';
import { parseHmtx } from './hmtx-table';
import type { SfntFont } from './sfnt';
import { hasBytes, i16, sfntTableBytes, u16 } from './sfnt';

// A parsed, ready-to-embed TrueType-outline text face: everything the PDF write path needs to state a font's metrics in a /FontDescriptor, to resolve a string's characters to glyph IDs, and to measure that string -- read once from the font's own 'cmap'/'hmtx'/'head'/'hhea'/'OS/2'/'post'/'name' tables and cached, the same shape math-font.ts's own loadMathFont provides for the vendored math font.
//
// The one thing this module gets right that a naive port of math-font.ts would not: every geometry field here is converted into PDF's 1000-units-per-em glyph space (ISO 32000-1 9.8.1), which a font's own design grid frequently is NOT. STIX Two Math happens to be drawn on a 1000-unit em, so math-font-write.ts's own `1000 / unitsPerEm` factor is an identity there; Carlito is drawn on a 2048-unit em and Caladea on a 1000-unit one, so the same factor is genuinely 0.48828125 for one vendored family and 1 for the other. Getting that scale wrong is silent rather than loud -- a font declaring a 2048-unit ascent as if it were glyph-space would simply render with roughly twice the intended metrics, with nothing anywhere reporting an error -- so the conversion is applied once, here, and every consumer of an EmbeddedFace reads glyph-space values only.
//
// Italic angle is the one deliberately unscaled field: it is an angle in degrees, not a length on the design grid.

// PDF glyph space, the unit every /FontDescriptor geometry field and every /W width is expressed in regardless of the font's own design grid (ISO 32000-1 9.8.1).
const GLYPH_SPACE_UNITS_PER_EM = 1000;

// The glyph every sfnt reserves at index 0 for "no glyph for this character" -- what a face with no coverage for a character is shown with, and what a PDF consumer renders as a notdef box.
export const NOTDEF_GLYPH_ID = 0;

// The 'H' whose outline supplies a cap height for a font whose 'OS/2' table is too old (version 0 or 1) to declare one -- the same measurement every font tool makes for that case, rather than a guessed constant.
const CAP_HEIGHT_REFERENCE_CODE_POINT = 0x48;

// PANOSE (a font's own ten-byte design classification, 'OS/2' bytes 32..41): byte 0 is the family kind and byte 1, for a Latin text family, the serif style. Serif styles 2..10 (Cove through Triangle) are the serif designs; 11..15 (Normal Sans through Rounded) are the sans ones, and 0/1 are "any"/"no fit". Reading the font's own declaration is what lets a serif flag be derived rather than hardcoded against a family name -- and it gives the right answer for both vendored families: Caladea declares 2,4 (Latin text, square cove) and Carlito 2,15 (Latin text, rounded sans).
const PANOSE_FAMILY_KIND_OFFSET = 0;
const PANOSE_SERIF_STYLE_OFFSET = 1;
const PANOSE_FAMILY_KIND_LATIN_TEXT = 2;
const PANOSE_FIRST_SERIF_STYLE = 2;
const PANOSE_LAST_SERIF_STYLE = 10;

export interface EmbeddedFaceMetrics {
  // The font's own design grid, kept for callers that need to convert a raw design-unit value themselves. Every other field below is already in glyph space.
  readonly unitsPerEm: number;
  readonly ascentGlyphSpace: number;
  readonly descentGlyphSpace: number; // negative, per the sfnt hhea convention PDF's own /Descent shares
  readonly capHeightGlyphSpace: number;
  readonly xHeightGlyphSpace: number | undefined; // only where 'OS/2' is version 2 or later, which alone declares it
  readonly bboxGlyphSpace: readonly [number, number, number, number]; // xMin, yMin, xMax, yMax -- /FontBBox's own order
  readonly italicAngleDegrees: number; // an angle, never scaled into glyph space
  readonly underlinePositionGlyphSpace: number;
  readonly underlineThicknessGlyphSpace: number;
  // Whether the face's own PANOSE classification calls it a serif design -- the /FontDescriptor /Flags serif bit, derived from the font rather than from its name.
  readonly serif: boolean;
}

export interface EmbeddedFace {
  readonly font: SfntFont;
  // nameID 6, the font's own PostScript name ("Carlito-Bold") -- family and face in one string, which is what a /BaseFont entry carries and what a subset tag is derived over.
  readonly postScriptName: string;
  readonly numGlyphs: number;
  readonly metrics: EmbeddedFaceMetrics;
  glyphId(codePoint: number): number | undefined;
  // This glyph's advance width in glyph space -- the value a /W entry carries, and the one both measurement and content-stream emission below are driven by.
  glyphSpaceWidth(glyphId: number): number;
}

// One EmbeddedFace per font, parsed at most once. Keyed on the byte array's own identity rather than on a name: a caller handing the same vendored asset's bytes back gets the same parse, and a font that is genuinely a different object is genuinely re-read, with no registry to invalidate and no way for two different fonts sharing a family name to collide.
const cache = new WeakMap<Uint8Array<ArrayBuffer>, EmbeddedFace | undefined>();

function scaleToGlyphSpace(designUnits: number, unitsPerEm: number): number {
  return (designUnits * GLYPH_SPACE_UNITS_PER_EM) / unitsPerEm;
}

// The cap height a /FontDescriptor must carry for a nonsymbolic font (ISO 32000-1 Table 122). 'OS/2' version 2 and later declares it outright; for an older table it is measured off the 'H' glyph's own outline, which is exactly what that field means. A face with neither -- no 'H' at all, or an unreadable one -- falls back to its ascent, the only remaining value the font itself states.
function resolveCapHeight(font: SfntFont, cmap: CmapLookup, declared: number | undefined, ascent: number): number {
  if (declared !== undefined) {
    return declared;
  }
  const head = parseHead(font);
  const maxp = parseMaxp(font);
  const glyphId = cmap(CAP_HEIGHT_REFERENCE_CODE_POINT);
  if (head === undefined || maxp === undefined || glyphId === undefined) {
    return ascent;
  }
  const glyf = parseGlyf(font, { numGlyphs: maxp.numGlyphs, indexToLocFormat: head.indexToLocFormat });
  return glyf?.glyphHeader(glyphId)?.yMax ?? ascent;
}

function isSerifByPanose(panose: readonly number[] | undefined): boolean {
  if (panose?.[PANOSE_FAMILY_KIND_OFFSET] !== PANOSE_FAMILY_KIND_LATIN_TEXT) {
    return false;
  }
  const serifStyle = panose[PANOSE_SERIF_STYLE_OFFSET];
  return serifStyle !== undefined && serifStyle >= PANOSE_FIRST_SERIF_STYLE && serifStyle <= PANOSE_LAST_SERIF_STYLE;
}

// Reads `font` into an EmbeddedFace, or returns `undefined` for a font this package cannot describe in a PDF font dictionary at all: one with no readable 'head' (no design grid), no 'cmap' (no way to resolve a character to a glyph), no 'hhea'/'hmtx' (no advance widths), or no PostScript name (nothing legal to write as /BaseFont). Every one of those is a font the caller must substitute another face for rather than embed -- the same "degrade around this font, don't abort the document" contract sfnt-subset.ts's own `undefined` return carries.
export function loadEmbeddedFace(font: SfntFont): EmbeddedFace | undefined {
  const cached = cache.get(font.bytes);
  if (cached !== undefined || cache.has(font.bytes)) {
    return cached;
  }
  const face = readEmbeddedFace(font);
  cache.set(font.bytes, face);
  return face;
}

function readEmbeddedFace(font: SfntFont): EmbeddedFace | undefined {
  const head = parseHead(font);
  const maxp = parseMaxp(font);
  const name = parseName(font);
  const cmap = buildCmapLookup(font);
  if (head === undefined || maxp === undefined || cmap === undefined || name?.postScriptName === undefined) {
    return undefined;
  }
  // hhea's own ascender/descender, matching math-font.ts's own choice: they are the vertical extents the font itself declares for line layout, and unlike 'OS/2's several competing pairs there is only one of them. Reading this here also establishes every precondition parseHmtx would otherwise throw on, so its failure case is the same `undefined` every other missing-table branch here returns rather than an exception escaping this module.
  const hhea = parseHhea(font);
  const hmtxBytes = sfntTableBytes(font, 'hmtx');
  if (hhea === undefined || hmtxBytes === undefined || !hasBytes(hmtxBytes, 0, hhea.numberOfHMetrics * LONG_HOR_METRIC_SIZE)) {
    return undefined;
  }
  const hmtx: HmtxTable = parseHmtx(font);

  const os2 = parseOs2(font);
  const post = parsePost(font);
  const { unitsPerEm } = head;
  const scale = (designUnits: number): number => scaleToGlyphSpace(designUnits, unitsPerEm);
  const capHeight = resolveCapHeight(font, cmap, os2?.sCapHeight, hhea.ascent);

  return {
    font,
    postScriptName: name.postScriptName,
    numGlyphs: maxp.numGlyphs,
    metrics: {
      unitsPerEm,
      ascentGlyphSpace: scale(hhea.ascent),
      descentGlyphSpace: scale(hhea.descent),
      capHeightGlyphSpace: scale(capHeight),
      xHeightGlyphSpace: os2?.sxHeight === undefined ? undefined : scale(os2.sxHeight),
      bboxGlyphSpace: [scale(head.xMin), scale(head.yMin), scale(head.xMax), scale(head.yMax)],
      italicAngleDegrees: post?.italicAngle ?? 0,
      underlinePositionGlyphSpace: scale(post?.underlinePosition ?? 0),
      underlineThicknessGlyphSpace: scale(post?.underlineThickness ?? 0),
      serif: isSerifByPanose(os2?.panose),
    },
    glyphId: (codePoint: number) => cmap(codePoint),
    glyphSpaceWidth: (glyphId: number) => scale(hmtx.advanceWidth(glyphId)),
  };
}

const HHEA_TABLE_SIZE = 36;
const HHEA_ASCENDER_OFFSET = 4;
const HHEA_DESCENDER_OFFSET = 6;
const HHEA_NUMBER_OF_HMETRICS_OFFSET = 34;
const LONG_HOR_METRIC_SIZE = 4; // advanceWidth (uint16) + leftSideBearing (int16)

// 'hhea' (ISO/IEC 14496-22 clause 5.2.3): the two vertical metrics a /FontDescriptor is built from, plus the metric count that bounds 'hmtx'. font-tables.ts parses the whole-font tables a FontDescriptor otherwise needs but not this one, since nothing before now needed a general 'hhea' reader -- hmtx-table.ts reads only numberOfHMetrics out of it, and math-font.ts reaches into its raw bytes directly.
function parseHhea(font: SfntFont): { readonly ascent: number; readonly descent: number; readonly numberOfHMetrics: number } | undefined {
  const bytes = sfntTableBytes(font, 'hhea');
  if (bytes === undefined || !hasBytes(bytes, 0, HHEA_TABLE_SIZE)) {
    return undefined;
  }
  const numberOfHMetrics = u16(bytes, HHEA_NUMBER_OF_HMETRICS_OFFSET);
  if (numberOfHMetrics === 0) {
    return undefined;
  }
  return { ascent: i16(bytes, HHEA_ASCENDER_OFFSET), descent: i16(bytes, HHEA_DESCENDER_OFFSET), numberOfHMetrics };
}

// A character the face has no glyph for at all. Reported rather than silently swallowed -- .notdef was shown in its place, and only the caller can decide whether that means substituting another face or accepting a notdef box. Deliberately not WinAnsiSubstitution's own { from, to } shape: nothing visible was chosen as a replacement here, so there is no honest `to` to state.
export interface EmbeddedFaceSubstitution {
  readonly from: string;
}

export interface EmbeddedShow {
  readonly codes: Uint8Array<ArrayBuffer>; // two bytes per character: the glyph ID, big-endian, which is the CID an Identity-H Tj operand carries
  readonly width1000: number; // total advance in glyph space, i.e. at font size 1000
  readonly substitutions: readonly EmbeddedFaceSubstitution[];
}

// The single code path both measurement and content-stream emission must go through for text drawn in an embedded face -- exactly winansi.ts's own encodeForShow rationale, for exactly the same reason: encoding and measuring a string in two separate steps risks the two disagreeing about which characters resolved to which glyph, which silently desyncs a line's computed wrap point from what is actually drawn on the page. Substituted characters advance by .notdef's own real width, so the measurement stays true to the glyphs that will be shown rather than to the ones that were asked for.
export function encodeForShowEmbedded(text: string, face: EmbeddedFace): EmbeddedShow {
  const glyphIds: number[] = [];
  const substitutions: EmbeddedFaceSubstitution[] = [];
  let width1000 = 0;
  for (const character of text) {
    const glyphId = face.glyphId(character.codePointAt(0)!);
    if (glyphId === undefined) {
      substitutions.push({ from: character });
    }
    const shown = glyphId ?? NOTDEF_GLYPH_ID;
    glyphIds.push(shown);
    width1000 += face.glyphSpaceWidth(shown);
  }
  const codes = new Uint8Array(glyphIds.length * 2);
  glyphIds.forEach((glyphId, index) => {
    codes[index * 2] = (glyphId >> 8) & 0xff;
    codes[index * 2 + 1] = glyphId & 0xff;
  });
  return { codes, width1000, substitutions };
}

// Every code point across `texts` that `face` has a glyph for, keyed by that glyph ID -- the CID -> Unicode pairs a ToUnicode CMap needs, collected across every run a document draws in this one face. Mirrors math-content-write.ts's own collectUsedGlyphs, and shares its assumption: a face's 'cmap' is an injective Unicode-to-glyph mapping in practice, so the first code point seen for a glyph is the one that glyph represents. Characters the face cannot map contribute nothing -- .notdef stands for no Unicode text at all, and claiming otherwise in a ToUnicode CMap would make a copy/paste recover a character the page never showed.
export function collectEmbeddedGlyphs(texts: Iterable<string>, face: EmbeddedFace): ReadonlyMap<number, number> {
  const used = new Map<number, number>();
  for (const text of texts) {
    for (const character of text) {
      const codePoint = character.codePointAt(0)!;
      const glyphId = face.glyphId(codePoint);
      if (glyphId !== undefined && !used.has(glyphId)) {
        used.set(glyphId, codePoint);
      }
    }
  }
  return used;
}
