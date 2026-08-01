import { deflate } from './bytes/flate';
import type { MathFont } from './math-font';
import type { PdfDict, PdfObject } from './objects';
import { pdfArray, pdfDict, pdfHexString, pdfName, pdfNum, pdfStream } from './objects';

// The FontDescriptor /Flags bit for "font contains glyphs outside the Adobe standard Latin character set" (ISO 32000-1 Table 123, bit position 3, value 4) -- true of essentially every glyph a math font contributes (operators, Greek, blackboard-bold letters, ...), unlike src/pdf/write.ts's own standard-14 FLAG_NONSYMBOLIC.
const FLAG_SYMBOLIC = 4;
const NOMINAL_STEM_V = 80; // matches write.ts's own NOMINAL_STEM_V_REGULAR -- a nominal, spec-required value no conforming reader actually consults for an embedded font (it reads real hinting/stem data from the embedded program itself).

export interface MathFontObjectRefs {
  readonly cidFontRef: PdfObject;
  readonly descriptorRef: PdfObject;
  readonly fontFileRef: PdfObject;
  readonly toUnicodeRef: PdfObject;
}

export interface MathFontObjects {
  readonly type0: PdfDict;
  readonly cidFont: PdfDict;
  readonly descriptor: PdfDict;
  readonly fontFile: PdfObject;
  readonly toUnicode: PdfObject;
}

function buildWidthsArray(font: MathFont, usedGlyphs: ReadonlyMap<number, number>): PdfObject {
  const entries: PdfObject[] = [];
  // Sorted by glyph ID for deterministic, byte-identical output across runs with the same input -- matching write.ts's own "objects allocated in a fixed order" determinism guarantee (see that module's own top-of-writePdf comment).
  for (const glyphId of [...usedGlyphs.keys()].sort((a, b) => a - b)) {
    entries.push(pdfNum(glyphId), pdfArray([pdfNum(font.glyphSpaceWidth(glyphId))]));
  }
  return pdfArray(entries);
}

function buildFontDescriptor(font: MathFont, fontFileRef: PdfObject): PdfDict {
  const d = font.descriptor;
  const scale = 1000 / d.unitsPerEm; // FontDescriptor geometry fields are always expressed in a 1000-units-per-em glyph space regardless of the font's own unitsPerEm (ISO 32000-1 9.8.1) -- STIX Two Math already uses 1000, so this is an identity scale in practice, but computed for real rather than assumed.
  return pdfDict({
    Type: pdfName('FontDescriptor'),
    FontName: pdfName('STIXTwoMath-Regular'),
    Flags: pdfNum(FLAG_SYMBOLIC),
    FontBBox: pdfArray([d.bboxMin[0] * scale, d.bboxMin[1] * scale, d.bboxMax[0] * scale, d.bboxMax[1] * scale].map((n) => pdfNum(n))),
    ItalicAngle: pdfNum(d.italicAngle),
    Ascent: pdfNum(d.ascent * scale),
    Descent: pdfNum(d.descent * scale),
    CapHeight: pdfNum(d.capHeight * scale),
    StemV: pdfNum(NOMINAL_STEM_V),
    FontFile3: fontFileRef,
  });
}

function buildFontFileStream(font: MathFont, compress: boolean): PdfObject {
  // The embedded font program: the ENTIRE 'CFF ' table, unmodified -- see math-font.ts's own module comment for why this is a documented, deliberate simplification rather than a genuine glyph subset. /Subtype /CIDFontType0C is the PDF spec's own name (ISO 32000-1 9.9) for exactly this shape: a bare (non-sfnt-wrapped) CFF program, embedded for a /CIDFontType0 descendant font.
  const dict = pdfDict(compress ? { Subtype: pdfName('CIDFontType0C'), Filter: pdfName('FlateDecode') } : { Subtype: pdfName('CIDFontType0C') });
  return pdfStream(dict, compress ? deflate(font.cffBytes) : font.cffBytes);
}

// A codepoint above U+FFFF (every Mathematical Alphanumeric Symbols character this package's own mathvariant mapping produces) needs a genuine UTF-16BE surrogate pair in a ToUnicode CMap's own bfchar target -- JS's String.fromCodePoint + charCodeAt already does exactly this encoding, so this reuses it rather than hand-rolling the surrogate math.
function codePointToUtf16BEHex(codePoint: number): string {
  const text = String.fromCodePoint(codePoint);
  let hex = '';
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return hex;
}

// A standard bfchar ToUnicode CMap (ISO 32000-1 9.10.3): a plain-text PostScript-syntax resource mapping each used CID (= glyph ID, Identity-H) back to the Unicode text it represents, so copy/paste and screen readers recover real characters from an embedded font's own arbitrary glyph numbering.
function buildToUnicodeCMap(usedGlyphs: ReadonlyMap<number, number>): PdfObject {
  const sortedGids = [...usedGlyphs.keys()].sort((a, b) => a - b);
  const lines: string[] = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    `${sortedGids.length} beginbfchar`,
  ];
  for (const gid of sortedGids) {
    const codePoint = usedGlyphs.get(gid);
    if (codePoint === undefined) {
      continue;
    }
    lines.push(`<${gid.toString(16).padStart(4, '0')}> <${codePointToUtf16BEHex(codePoint)}>`);
  }
  lines.push('endbfchar', 'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  const text = `${lines.join('\n')}\n`;
  const bytes = new TextEncoder().encode(text);
  return pdfStream(pdfDict({}), bytes);
}

// Builds the five PDF objects a single embedded math composite font needs (/Type0, /CIDFontType0 descendant, /FontDescriptor, /FontFile3, ToUnicode CMap) -- write.ts allocates the five object numbers up front (matching its own existing font/image allocation pattern) and passes the resulting refs in so each object can point at the others; this function's own job is purely to build the dict/stream VALUES, not to decide numbering or write bytes to the file.
export function buildMathFontObjects(font: MathFont, usedGlyphs: ReadonlyMap<number, number>, refs: MathFontObjectRefs, compress: boolean): MathFontObjects {
  const cidFont = pdfDict({
    Type: pdfName('Font'),
    Subtype: pdfName('CIDFontType0'),
    BaseFont: pdfName('STIXTwoMath-Regular'),
    CIDSystemInfo: pdfDict({ Registry: pdfHexString(new TextEncoder().encode('Adobe')), Ordering: pdfHexString(new TextEncoder().encode('Identity')), Supplement: pdfNum(0) }),
    FontDescriptor: refs.descriptorRef,
    DW: pdfNum(0),
    W: buildWidthsArray(font, usedGlyphs),
  });

  const type0 = pdfDict({
    Type: pdfName('Font'),
    Subtype: pdfName('Type0'),
    BaseFont: pdfName('STIXTwoMath-Regular'),
    Encoding: pdfName('Identity-H'),
    DescendantFonts: pdfArray([refs.cidFontRef]),
    ToUnicode: refs.toUnicodeRef,
  });

  return {
    type0,
    cidFont,
    descriptor: buildFontDescriptor(font, refs.fontFileRef),
    fontFile: buildFontFileStream(font, compress),
    toUnicode: buildToUnicodeCMap(usedGlyphs),
  };
}
