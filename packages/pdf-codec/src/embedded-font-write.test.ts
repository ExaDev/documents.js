import { describe, expect, it } from 'vitest';
import { ByteWriter } from './bytes/writer';
import { NOOP_DIAGNOSTIC_SINK } from './diagnostics';
import { openPdfDocument } from './document';
import { collectEmbeddedGlyphs, encodeForShowEmbedded, loadEmbeddedFace } from './embedded-font';
import type { EmbeddedFace } from './embedded-font';
import { buildEmbeddedFontObjects, embeddedSubsetTag } from './embedded-font-write';
import { decodeStream } from './filters';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asName, asNumber, dictGet, pdfArray, pdfDict, pdfHexString, pdfName, pdfNum, pdfRef, pdfStream } from './objects';
import { readPdf } from './read';
import { writeObject } from './serialize';
import type { SfntSubsetResult } from './sfnt-subset';
import { subsetSfnt } from './sfnt-subset';
import { parseSfnt } from './sfnt';
import { carlitoRegularBytes } from './test-support/fonts';

// The end-to-end proof this module exists for: take a real vendored face, cut a real subset of it for a real string, build the whole PDF object group, assemble a genuine PDF file around it by hand, and read that file back with this package's own readPdf. Nothing here is a synthetic fixture -- the font is the checked-in Carlito Regular, the subset is sfnt-subset.ts's own output, and the file is a complete, well-formed PDF with a real cross-reference table.
//
// The PDF is assembled here rather than through writePdf deliberately: writePdf has no embedded-text-font path yet (that is the next phase's work), and adding one purely so this test could call it would put the thing under test on both sides of the assertion. The assembly below is the minimum a conforming file needs -- Catalog, Pages, Page, a content stream, and the five font objects -- written through the same serialize.ts every real PDF this package emits goes through.
//
// The string is chosen for what it forces rather than for being pretty: 'ö' and the digits are composite glyphs in Carlito, so their components have to survive the subset for those characters to render at all -- and those components are glyphs no character maps to, which is what makes the /W array and the ToUnicode CMap genuinely different sets rather than the same one twice.
const TEXT = 'Hello, wörld! 42';
const FONT_SIZE_PT = 24;
const TEXT_X_PT = 72;
const TEXT_Y_PT = 700;
const PAGE_WIDTH_PT = 612;
const PAGE_HEIGHT_PT = 792;
const FONT_RESOURCE_NAME = 'F1';

interface AllocatedObject {
  readonly num: number;
  readonly value: PdfObject;
}

// A complete classic-cross-reference PDF file around an already-built object list -- the same shape write.ts's own tail emits, written out here so this test owns every byte of the file it then reads back.
function assemblePdf(objects: readonly AllocatedObject[], rootNum: number): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.writeAscii('%PDF-1.7\n');
  const offsets = new Map<number, number>();
  for (const { num, value } of objects) {
    offsets.set(num, writer.length);
    writer.writeAscii(`${num} 0 obj\n`);
    writeObject(writer, value);
    writer.writeAscii('\nendobj\n');
  }
  const maxObjNum = Math.max(...objects.map((object) => object.num));
  const xrefOffset = writer.length;
  writer.writeAscii('xref\n');
  writer.writeAscii(`0 ${maxObjNum + 1}\n`);
  writer.writeAscii('0000000000 65535 f \n');
  for (let num = 1; num <= maxObjNum; num++) {
    const offset = offsets.get(num);
    if (offset === undefined) {
      throw new Error(`object ${String(num)} was never written`);
    }
    writer.writeAscii(`${offset.toString().padStart(10, '0')} 00000 n \n`);
  }
  writer.writeAscii('trailer\n');
  writeObject(writer, pdfDict({ Size: pdfNum(maxObjNum + 1), Root: pdfRef(rootNum, 0) }));
  writer.writeAscii('\nstartxref\n');
  writer.writeAscii(`${xrefOffset}\n`);
  writer.writeAscii('%%EOF');
  return writer.toBytes();
}

// The one text-showing sequence the page draws: the string's CIDs, big-endian, as a hex-string Tj operand against the embedded composite font -- exactly what math-content-write.ts already emits for the math font, and the only content-stream shape an Identity-H font can be shown with.
function buildContentStream(codes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.writeAscii('BT\n');
  writer.writeAscii(`/${FONT_RESOURCE_NAME} ${String(FONT_SIZE_PT)} Tf\n`);
  writer.writeAscii(`1 0 0 1 ${String(TEXT_X_PT)} ${String(TEXT_Y_PT)} Tm\n`);
  writeObject(writer, pdfHexString(codes));
  writer.writeAscii(' Tj\nET\n');
  return writer.toBytes();
}

interface BuiltDocument {
  readonly pdfBytes: Uint8Array<ArrayBuffer>;
  readonly face: EmbeddedFace;
  readonly subset: SfntSubsetResult;
  readonly usedGlyphs: ReadonlyMap<number, number>;
  readonly baseFont: string;
}

const CATALOG_NUM = 1;
const PAGES_NUM = 2;
const PAGE_NUM = 3;
const CONTENTS_NUM = 4;
const TYPE0_NUM = 5;
const CID_FONT_NUM = 6;
const DESCRIPTOR_NUM = 7;
const FONT_FILE_NUM = 8;
const TO_UNICODE_NUM = 9;

function buildDocument(text: string = TEXT, compress = true): BuiltDocument {
  const sfnt = parseSfnt(carlitoRegularBytes());
  if (sfnt === undefined) {
    throw new Error('the vendored Carlito Regular failed to parse as an sfnt container');
  }
  const face = loadEmbeddedFace(sfnt);
  if (face === undefined) {
    throw new Error('the vendored Carlito Regular failed to load as an embeddable face');
  }
  const codePoints = [...new Set([...text].map((character) => character.codePointAt(0)!))];
  const subset = subsetSfnt(sfnt, codePoints);
  if (subset === undefined) {
    throw new Error('subsetting the vendored Carlito Regular failed');
  }
  const usedGlyphs = collectEmbeddedGlyphs([text], face);
  const built = buildEmbeddedFontObjects(
    face,
    subset,
    usedGlyphs,
    { cidFontRef: pdfRef(CID_FONT_NUM, 0), descriptorRef: pdfRef(DESCRIPTOR_NUM, 0), fontFileRef: pdfRef(FONT_FILE_NUM, 0), toUnicodeRef: pdfRef(TO_UNICODE_NUM, 0) },
    compress,
  );

  const contentBytes = buildContentStream(encodeForShowEmbedded(text, face).codes);
  const objects: AllocatedObject[] = [
    { num: CATALOG_NUM, value: pdfDict({ Type: pdfName('Catalog'), Pages: pdfRef(PAGES_NUM, 0) }) },
    { num: PAGES_NUM, value: pdfDict({ Type: pdfName('Pages'), Kids: pdfArray([pdfRef(PAGE_NUM, 0)]), Count: pdfNum(1) }) },
    {
      num: PAGE_NUM,
      value: pdfDict({
        Type: pdfName('Page'),
        Parent: pdfRef(PAGES_NUM, 0),
        MediaBox: pdfArray([0, 0, PAGE_WIDTH_PT, PAGE_HEIGHT_PT].map((n) => pdfNum(n))),
        Resources: pdfDict({ Font: pdfDict({ [FONT_RESOURCE_NAME]: pdfRef(TYPE0_NUM, 0) }) }),
        Contents: pdfRef(CONTENTS_NUM, 0),
      }),
    },
    { num: CONTENTS_NUM, value: pdfStream(pdfDict({}), contentBytes) },
    { num: TYPE0_NUM, value: built.type0 },
    { num: CID_FONT_NUM, value: built.cidFont },
    { num: DESCRIPTOR_NUM, value: built.descriptor },
    { num: FONT_FILE_NUM, value: built.fontFile },
    { num: TO_UNICODE_NUM, value: built.toUnicode },
  ];

  return { pdfBytes: assemblePdf(objects, CATALOG_NUM), face, subset, usedGlyphs, baseFont: built.baseFont };
}

function fontDictOf(pdfBytes: Uint8Array<ArrayBuffer>): PdfDict {
  const document = openPdfDocument(pdfBytes, NOOP_DIAGNOSTIC_SINK);
  const page = document.pages()[0];
  expect(page).toBeDefined();
  const resources = document.resolveDict(dictGet(page!, 'Resources'));
  const fonts = document.resolveDict(resources === undefined ? undefined : dictGet(resources, 'Font'));
  const font = document.resolveDict(fonts === undefined ? undefined : dictGet(fonts, FONT_RESOURCE_NAME));
  if (font === undefined) {
    throw new Error('the assembled PDF has no font resource');
  }
  return font;
}

describe('a real PDF carrying an embedded, subsetted Carlito, read back by this package own readPdf', () => {
  it('recovers the drawn text, its size, and its position', () => {
    const { pdfBytes } = buildDocument();
    const document = readPdf(pdfBytes);
    expect(document.pages.length).toBe(1);
    const items = document.pages[0]!.items;
    expect(items.length).toBe(1);
    const item = items[0]!;
    expect(item.kind).toBe('text');
    if (item.kind !== 'text') {
      throw new Error('unreachable');
    }
    // The text comes back only through the ToUnicode CMap: an Identity-H composite font's own character codes are glyph indices, which carry no Unicode meaning of their own at all.
    expect(item.text).toBe(TEXT);
    expect(item.sizePt).toBe(FONT_SIZE_PT);
    expect(item.xPt).toBeCloseTo(TEXT_X_PT, 6);
    expect(item.yPt).toBeCloseTo(TEXT_Y_PT, 6);
  });

  it('recovers the face family from /BaseFont, past its subset tag', () => {
    const { pdfBytes } = buildDocument();
    const item = readPdf(pdfBytes).pages[0]!.items[0]!;
    if (item.kind !== 'text') {
      throw new Error('unreachable');
    }
    expect(item.font.family).toBe('Carlito');
    expect(item.font.weight).toBe('normal');
    expect(item.font.style).toBe('normal');
  });

  it('advances the drawn text by the widths the /W array declares, not by a default', () => {
    const { pdfBytes, face } = buildDocument();
    const item = readPdf(pdfBytes).pages[0]!.items[0]!;
    if (item.kind !== 'text') {
      throw new Error('unreachable');
    }
    // The recovered width is the font's own measurement of this string at this size, which is only true if every /W entry survived the round trip -- /DW alone would put every glyph at 1000 and inflate this by roughly two thirds.
    const expectedWidthPt = (encodeForShowEmbedded(TEXT, face).width1000 / 1000) * FONT_SIZE_PT;
    expect(item.widthPt).toBeCloseTo(expectedWidthPt, 4);
    expect(item.widthPt).not.toBeCloseTo(([...TEXT].length * 1000 * FONT_SIZE_PT) / 1000, 0);
  });

  it('is a genuine Type0 / Identity-H / CIDFontType2 / FontFile2 font resource, not merely something readPdf tolerated', () => {
    const { pdfBytes, baseFont } = buildDocument();
    const document = openPdfDocument(pdfBytes, NOOP_DIAGNOSTIC_SINK);
    const font = fontDictOf(pdfBytes);
    expect(asName(dictGet(font, 'Type'))).toBe('Font');
    expect(asName(dictGet(font, 'Subtype'))).toBe('Type0');
    expect(asName(dictGet(font, 'Encoding'))).toBe('Identity-H');
    expect(asName(dictGet(font, 'BaseFont'))).toBe(baseFont);

    const descendants = asArray(dictGet(font, 'DescendantFonts'));
    expect(descendants?.length).toBe(1);
    const cidFont = document.resolveDict(descendants?.[0]);
    expect(cidFont).toBeDefined();
    expect(asName(dictGet(cidFont!, 'Subtype'))).toBe('CIDFontType2');
    expect(asName(dictGet(cidFont!, 'BaseFont'))).toBe(baseFont);
    expect(asNumber(dictGet(cidFont!, 'DW'))).toBe(1000);
    // Explicit, even though /Identity is this key's own default for a CIDFontType2: it states outright the CID == GID invariant sfnt-subset.ts's GID-preserving design exists to guarantee.
    expect(asName(dictGet(cidFont!, 'CIDToGIDMap'))).toBe('Identity');
    const cidSystemInfo = document.resolveDict(dictGet(cidFont!, 'CIDSystemInfo'));
    expect(asNumber(dictGet(cidSystemInfo!, 'Supplement'))).toBe(0);

    const descriptor = document.resolveDict(dictGet(cidFont!, 'FontDescriptor'));
    expect(descriptor).toBeDefined();
    expect(asName(dictGet(descriptor!, 'FontName'))).toBe(baseFont);
    expect(dictGet(descriptor!, 'FontFile2')).toBeDefined();
    expect(dictGet(descriptor!, 'FontFile3')).toBeUndefined(); // a glyf-outline program is never a FontFile3
    expect(dictGet(descriptor!, 'FontFile')).toBeUndefined();
  });

  it('embeds the subset font program itself, with /Length1 stating its UNCOMPRESSED length', () => {
    const { pdfBytes, subset } = buildDocument();
    const document = openPdfDocument(pdfBytes, NOOP_DIAGNOSTIC_SINK);
    const font = fontDictOf(pdfBytes);
    const cidFont = document.resolveDict(asArray(dictGet(font, 'DescendantFonts'))?.[0]);
    const descriptor = document.resolveDict(dictGet(cidFont!, 'FontDescriptor'));
    const fontFile = document.resolve(dictGet(descriptor!, 'FontFile2'));
    expect(fontFile?.kind).toBe('stream');
    if (fontFile?.kind !== 'stream') {
      throw new Error('unreachable');
    }

    expect(asName(dictGet(fontFile.dict, 'Filter'))).toBe('FlateDecode');
    const declaredLength = asNumber(dictGet(fontFile.dict, 'Length'));
    const declaredLength1 = asNumber(dictGet(fontFile.dict, 'Length1'));
    // The whole point of /Length1: it is the length of the font program itself, before compression -- never the stream's own /Length, which is what a compressed stream's bytes actually measure.
    expect(declaredLength1).toBe(subset.bytes.length);
    expect(declaredLength).toBeLessThan(declaredLength1!);
    // Not vacuous: the subset really is smaller than the face it was cut from, and really did compress.
    expect(subset.bytes.length).toBeLessThan(carlitoRegularBytes().length / 20);

    // And the embedded bytes are the subset, byte for byte, after the declared filter is undone.
    const decoded = decodeStream(fontFile.raw, fontFile.dict, NOOP_DIAGNOSTIC_SINK);
    expect(decoded.bytes.length).toBe(declaredLength1);
    expect([...decoded.bytes]).toEqual([...subset.bytes]);
  });

  it('states /Length1 as the plain stream length when nothing is compressed', () => {
    const { pdfBytes, subset } = buildDocument(TEXT, false);
    const document = openPdfDocument(pdfBytes, NOOP_DIAGNOSTIC_SINK);
    const font = fontDictOf(pdfBytes);
    const cidFont = document.resolveDict(asArray(dictGet(font, 'DescendantFonts'))?.[0]);
    const descriptor = document.resolveDict(dictGet(cidFont!, 'FontDescriptor'));
    const fontFile = document.resolve(dictGet(descriptor!, 'FontFile2'));
    if (fontFile?.kind !== 'stream') {
      throw new Error('unreachable');
    }
    expect(dictGet(fontFile.dict, 'Filter')).toBeUndefined();
    expect(asNumber(dictGet(fontFile.dict, 'Length1'))).toBe(subset.bytes.length);
    expect([...fontFile.raw]).toEqual([...subset.bytes]);
  });

  it('writes one /W entry per glyph the subset carries, ascending, at the face own glyph-space widths', () => {
    const { pdfBytes, subset, face } = buildDocument();
    const document = openPdfDocument(pdfBytes, NOOP_DIAGNOSTIC_SINK);
    const cidFont = document.resolveDict(asArray(dictGet(fontDictOf(pdfBytes), 'DescendantFonts'))?.[0]);
    const w = asArray(dictGet(cidFont!, 'W'));
    expect(w?.length).toBe(subset.glyphIds.length * 2);
    subset.glyphIds.forEach((glyphId, index) => {
      expect(asNumber(w?.[index * 2])).toBe(glyphId);
      // Serialised through serialize.ts's own fixed decimal formatting, so an exact equality would be asserting that formatter's precision rather than this writer's arithmetic.
      expect(asNumber(asArray(w?.[index * 2 + 1])?.[0])).toBeCloseTo(face.glyphSpaceWidth(glyphId), 4);
    });
    // Ascending, which is what makes the output byte-identical across runs rather than dependent on a Set's iteration order.
    const cids = subset.glyphIds.map((_, index) => asNumber(w?.[index * 2])!);
    expect(cids).toEqual([...cids].sort((a, b) => a - b));
  });

  it('describes the face metrics in glyph space, with the flags a Latin sans text face warrants', () => {
    const { pdfBytes, face } = buildDocument();
    const document = openPdfDocument(pdfBytes, NOOP_DIAGNOSTIC_SINK);
    const cidFont = document.resolveDict(asArray(dictGet(fontDictOf(pdfBytes), 'DescendantFonts'))?.[0]);
    const descriptor = document.resolveDict(dictGet(cidFont!, 'FontDescriptor'));
    expect(asNumber(dictGet(descriptor!, 'Ascent'))).toBeCloseTo(face.metrics.ascentGlyphSpace, 4);
    expect(asNumber(dictGet(descriptor!, 'Descent'))).toBeCloseTo(face.metrics.descentGlyphSpace, 4);
    expect(asNumber(dictGet(descriptor!, 'CapHeight'))).toBeCloseTo(face.metrics.capHeightGlyphSpace, 4);
    expect(asNumber(dictGet(descriptor!, 'XHeight'))).toBeCloseTo(face.metrics.xHeightGlyphSpace!, 4);
    expect(asNumber(dictGet(descriptor!, 'ItalicAngle'))).toBe(0);
    // Every geometry field is in 1000-unit glyph space, not Carlito's own 2048-unit design grid -- so the bounding box read back here is roughly half the raw head-table one.
    asArray(dictGet(descriptor!, 'FontBBox'))?.forEach((entry, index) => {
      expect(asNumber(entry)).toBeCloseTo(face.metrics.bboxGlyphSpace[index]!, 4);
    });
    expect(asNumber(asArray(dictGet(descriptor!, 'FontBBox'))?.[2])).not.toBe(2351);
    // NONSYMBOLIC only: Carlito is a sans design (no SERIF bit) drawn upright (no ITALIC bit).
    expect(asNumber(dictGet(descriptor!, 'Flags'))).toBe(32);
  });
});

describe('the ToUnicode CMap of an embedded subset', () => {
  it('maps exactly the glyphs that stand for a character, and nothing else', () => {
    const { pdfBytes, usedGlyphs } = buildDocument();
    const document = openPdfDocument(pdfBytes, NOOP_DIAGNOSTIC_SINK);
    const toUnicode = document.resolve(dictGet(fontDictOf(pdfBytes), 'ToUnicode'));
    if (toUnicode?.kind !== 'stream') {
      throw new Error('the assembled PDF has no ToUnicode stream');
    }
    const text = new TextDecoder().decode(decodeStream(toUnicode.raw, toUnicode.dict, NOOP_DIAGNOSTIC_SINK).bytes);
    expect(text).toContain('beginbfchar');
    // One entry per glyph that stands for a character, and none for a glyph pulled in only as a composite's component.
    expect(text.split('\n').filter((line) => /^<[0-9a-f]{4}> <[0-9a-f]+>$/.test(line)).length).toBe(usedGlyphs.size);
    // 'ö' (U+00F6) is Carlito glyph 2142: 0x85e.
    expect(text).toContain('<085e> <00f6>');
  });
});

describe('the subset tag', () => {
  it('is six uppercase letters, and identical for identical input', () => {
    expect(embeddedSubsetTag('Carlito-Regular', [0, 15, 59])).toMatch(/^[A-Z]{6}$/);
    expect(embeddedSubsetTag('Carlito-Regular', [0, 15, 59])).toBe(embeddedSubsetTag('Carlito-Regular', [0, 15, 59]));
    expect(buildDocument().baseFont).toBe(buildDocument().baseFont);
    expect(buildDocument().baseFont).toMatch(/^[A-Z]{6}\+Carlito-Regular$/);
  });

  it('differs when the glyph set differs, which is the whole reason it exists', () => {
    // Two subsets of one face carrying different glyphs must not be mistaken for one another -- when documents are merged, a shared tag would let one subset's font program answer for the other's CIDs.
    expect(embeddedSubsetTag('Carlito-Regular', [0, 15, 59])).not.toBe(embeddedSubsetTag('Carlito-Regular', [0, 15, 60]));
    expect(embeddedSubsetTag('Carlito-Regular', [0, 15])).not.toBe(embeddedSubsetTag('Carlito-Regular', [0, 15, 59]));
    expect(buildDocument('Hello').baseFont).not.toBe(buildDocument('Goodbye').baseFont);
  });

  it('differs between two faces of the same family', () => {
    expect(embeddedSubsetTag('Carlito-Regular', [0, 15])).not.toBe(embeddedSubsetTag('Carlito-Bold', [0, 15]));
  });
});
