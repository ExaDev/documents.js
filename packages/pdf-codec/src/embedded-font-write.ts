import { crc32 } from "./bytes/crc32";
import { deflate } from "./bytes/flate";
import type { EmbeddedFace } from "./embedded-font";
import type { PdfDict, PdfObject } from "./objects";
import {
  pdfArray,
  pdfDict,
  pdfHexString,
  pdfName,
  pdfNum,
  pdfStream,
} from "./objects";
import type { SfntSubsetResult } from "./sfnt-subset";
import { buildToUnicodeCMap } from "./tounicode";

// The PDF object group for an embedded, subsetted TrueType-outline text face: a /Type0 composite font shown through Identity-H, its /CIDFontType2 descendant, that descendant's /FontDescriptor, the /FontFile2 stream carrying the subset font program itself, and a ToUnicode CMap. The direct counterpart to math-font-write.ts's own five-object group for the vendored math font, and deliberately shaped the same way: this module builds dictionary and stream VALUES only, and the caller (write.ts, which allocates object numbers in a fixed order for determinism) passes in the references each object needs to point at the others.
//
// Where it genuinely differs from the math-font group, and why:
//   - /CIDFontType2 rather than /CIDFontType0, because the embedded program is a real sfnt with 'glyf' outlines rather than a bare CFF one, and /FontFile2 rather than /FontFile3 for the same reason (ISO 32000-1 Table 126).
//   - /CIDToGIDMap /Identity is written explicitly. It is that key's own default, but only for a /CIDFontType2 -- writing it states outright the invariant sfnt-subset.ts is built to preserve (glyph IDs are never renumbered, so CID == GID), rather than leaving a reader to infer it from an absent key.
//   - /Length1 on the /FontFile2 stream, which /FontFile3 has no analogue of: the length of the UNCOMPRESSED font program (Table 127). It is the single most commonly mis-set key in TrueType embedding, because the obvious-looking value -- the stream's own /Length, i.e. the compressed length -- is silently accepted by lenient readers and rejected by strict ones. It is set here from the subset's own byte length, before compression is even applied.
//   - A subset tag on /BaseFont and /FontName ("ABCDEF+Carlito-Regular"), required of any font program carrying fewer glyphs than the face it was cut from (9.6.4). Derived deterministically from the face and its own glyph set, so the same input always produces the same tag.

// FontDescriptor /Flags bit values (ISO 32000-1 Table 123). Both vendored families are ordinary Latin text faces whose glyphs all sit inside the Adobe standard Latin set, which is what NONSYMBOLIC asserts -- the opposite of math-font-write.ts's own SYMBOLIC, and the correct claim for a text face.
const FLAG_SERIF = 2;
const FLAG_NONSYMBOLIC = 32;
const FLAG_ITALIC = 64;

// A nominal /StemV, matching write.ts's own NOMINAL_STEM_V_REGULAR and math-font-write.ts's own NOMINAL_STEM_V: the key is required, but no conforming reader consults it for an embedded font, since the real stem data is in the font program itself.
const NOMINAL_STEM_V = 80;

// The default width every CID with no /W entry takes (ISO 32000-1 9.7.4.3). /W below covers every glyph the subset actually carries, so this only ever applies to a CID the document never shows -- 1000 is the spec's own stated default and the conventional value to write.
const DEFAULT_WIDTH = 1000;

// A subset tag is exactly six uppercase letters followed by '+' (ISO 32000-1 9.6.4). It exists so two subsets of the same face, carrying different glyph sets, cannot be mistaken for one another when both are present in a document (or when documents are merged) -- so it must vary with the glyph set, not merely with the face.
const SUBSET_TAG_LENGTH = 6;
const SUBSET_TAG_ALPHABET_SIZE = 26;
const SUBSET_TAG_CODE_SPACE = SUBSET_TAG_ALPHABET_SIZE ** SUBSET_TAG_LENGTH;
const UPPERCASE_A_CHAR_CODE = 65;

// The tag for one subset of one face: a CRC32 over the face's own PostScript name (family and style in one string) and the exact ascending glyph-ID list the subset carries, folded into six letters. Deterministic by construction -- identical input yields a byte-identical tag, and therefore byte-identical output for the whole document, which is the same guarantee write.ts's own fixed object-allocation order exists to give. A hash rather than a counter precisely because a counter would depend on how many other fonts a particular document happened to embed first.
export function embeddedSubsetTag(
  postScriptName: string,
  glyphIds: readonly number[],
): string {
  let value =
    crc32(new TextEncoder().encode(`${postScriptName} ${glyphIds.join(",")}`)) %
    SUBSET_TAG_CODE_SPACE;
  let tag = "";
  for (let i = 0; i < SUBSET_TAG_LENGTH; i++) {
    tag =
      String.fromCharCode(
        UPPERCASE_A_CHAR_CODE + (value % SUBSET_TAG_ALPHABET_SIZE),
      ) + tag;
    value = Math.floor(value / SUBSET_TAG_ALPHABET_SIZE);
  }
  return tag;
}

export interface EmbeddedFontObjectRefs {
  readonly cidFontRef: PdfObject;
  readonly descriptorRef: PdfObject;
  readonly fontFileRef: PdfObject;
  readonly toUnicodeRef: PdfObject;
}

export interface EmbeddedFontObjects {
  readonly baseFont: string; // 'ABCDEF+Carlito-Regular' -- the tagged name written into both /BaseFont entries and /FontName
  readonly type0: PdfDict;
  readonly cidFont: PdfDict;
  readonly descriptor: PdfDict;
  readonly fontFile: PdfObject;
  readonly toUnicode: PdfObject;
}

function computeFlags(face: EmbeddedFace): number {
  let flags = FLAG_NONSYMBOLIC;
  if (face.metrics.serif) {
    flags |= FLAG_SERIF;
  }
  // The italic bit follows the font's own drawn slant rather than its name: a face whose 'post' declares a non-zero italic angle is italic whatever it happens to be called.
  if (face.metrics.italicAngleDegrees !== 0) {
    flags |= FLAG_ITALIC;
  }
  return flags;
}

// One /W entry per glyph the subset carries, in ascending glyph-ID order. sfnt-subset.ts already returns its glyph IDs sorted, and this preserves that order rather than re-deriving one -- the same "sorted for deterministic, byte-identical output" reasoning math-font-write.ts's own buildWidthsArray states. Every glyph in the subset gets an entry, including .notdef: a document that shows a character the face has no glyph for advances by .notdef's own real width (see embedded-font.ts's encodeForShowEmbedded), which would otherwise silently fall back to /DW.
function buildWidthsArray(
  face: EmbeddedFace,
  glyphIds: readonly number[],
): PdfObject {
  const entries: PdfObject[] = [];
  for (const glyphId of glyphIds) {
    entries.push(
      pdfNum(glyphId),
      pdfArray([pdfNum(face.glyphSpaceWidth(glyphId))]),
    );
  }
  return pdfArray(entries);
}

function buildFontDescriptor(
  face: EmbeddedFace,
  baseFont: string,
  fontFileRef: PdfObject,
): PdfDict {
  const m = face.metrics;
  const entries = new Map<string, PdfObject>([
    ["Type", pdfName("FontDescriptor")],
    ["FontName", pdfName(baseFont)],
    ["Flags", pdfNum(computeFlags(face))],
    ["FontBBox", pdfArray(m.bboxGlyphSpace.map((n) => pdfNum(n)))],
    ["ItalicAngle", pdfNum(m.italicAngleDegrees)],
    ["Ascent", pdfNum(m.ascentGlyphSpace)],
    ["Descent", pdfNum(m.descentGlyphSpace)],
    ["CapHeight", pdfNum(m.capHeightGlyphSpace)],
    ["StemV", pdfNum(NOMINAL_STEM_V)],
  ]);
  // /XHeight is optional (Table 122) and only some 'OS/2' versions declare it -- written when the font states it, omitted rather than invented when it does not.
  if (m.xHeightGlyphSpace !== undefined) {
    entries.set("XHeight", pdfNum(m.xHeightGlyphSpace));
  }
  entries.set("FontFile2", fontFileRef);
  return pdfDict(entries);
}

// The embedded font program: the subset sfnt, whole. /Length1 is the length of these bytes as they stand here, BEFORE any compression -- serialize.ts derives the stream's own /Length from what actually follows the `stream` keyword, so the two are independently correct and cannot be confused for one another.
function buildFontFileStream(
  subsetBytes: Uint8Array<ArrayBuffer>,
  compress: boolean,
): PdfObject {
  const entries = new Map<string, PdfObject>([
    ["Length1", pdfNum(subsetBytes.length)],
  ]);
  if (compress) {
    entries.set("Filter", pdfName("FlateDecode"));
  }
  return pdfStream(
    pdfDict(entries),
    compress ? deflate(subsetBytes) : subsetBytes,
  );
}

// Builds the five PDF objects one embedded text face needs. `subset` is that face's own sfnt-subset.ts output (its glyph IDs drive /W, its bytes are the /FontFile2 program, and both feed the subset tag); `usedGlyphs` is the glyph-ID -> Unicode mapping the ToUnicode CMap is built from -- a subset of `subset.glyphIds`, since a glyph pulled in only as a composite's component represents no character of its own.
export function buildEmbeddedFontObjects(
  face: EmbeddedFace,
  subset: SfntSubsetResult,
  usedGlyphs: ReadonlyMap<number, number>,
  refs: EmbeddedFontObjectRefs,
  compress: boolean,
): EmbeddedFontObjects {
  const baseFont = `${embeddedSubsetTag(face.postScriptName, subset.glyphIds)}+${face.postScriptName}`;

  const cidFont = pdfDict({
    Type: pdfName("Font"),
    Subtype: pdfName("CIDFontType2"),
    BaseFont: pdfName(baseFont),
    CIDSystemInfo: pdfDict({
      Registry: pdfHexString(new TextEncoder().encode("Adobe")),
      Ordering: pdfHexString(new TextEncoder().encode("Identity")),
      Supplement: pdfNum(0),
    }),
    FontDescriptor: refs.descriptorRef,
    DW: pdfNum(DEFAULT_WIDTH),
    W: buildWidthsArray(face, subset.glyphIds),
    CIDToGIDMap: pdfName("Identity"),
  });

  const type0 = pdfDict({
    Type: pdfName("Font"),
    Subtype: pdfName("Type0"),
    BaseFont: pdfName(baseFont),
    Encoding: pdfName("Identity-H"),
    DescendantFonts: pdfArray([refs.cidFontRef]),
    ToUnicode: refs.toUnicodeRef,
  });

  return {
    baseFont,
    type0,
    cidFont,
    descriptor: buildFontDescriptor(face, baseFont, refs.fontFileRef),
    fontFile: buildFontFileStream(subset.bytes, compress),
    toUnicode: buildToUnicodeCMap(usedGlyphs),
  };
}
