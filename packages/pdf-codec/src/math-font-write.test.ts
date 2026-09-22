import { describe, expect, it } from "vitest";
import { NOOP_DIAGNOSTIC_SINK } from "./diagnostics";
import { decodeStream } from "./filters";
import type { MathFont, MathFontDescriptorMetrics } from "./math-font";
import { loadMathFont } from "./math-font";
import type { MathFontObjectRefs } from "./math-font-write";
import { buildMathFontObjects } from "./math-font-write";
import type { PdfObject } from "./objects";
import {
  asArray,
  asDict,
  asName,
  asNumber,
  dictGet,
  pdfArray,
  pdfRef,
} from "./objects";

const REFS: MathFontObjectRefs = {
  cidFontRef: pdfRef(6, 0),
  descriptorRef: pdfRef(7, 0),
  fontFileRef: pdfRef(8, 0),
  toUnicodeRef: pdfRef(9, 0),
};

// A deliberately non-1000-unitsPerEm descriptor: STIX Two Math (loadMathFont's real vendored font) happens to be drawn on a 1000-unit em, which makes buildFontDescriptor's own `1000 / unitsPerEm` scale factor an identity (1) — a font with any other em size is what actually distinguishes "multiply by scale" from "divide by scale" or "ignore scale entirely". 2048 is chosen because it is a power of two, so every scaled value below (design-unit field * 1000/2048) lands on an exactly representable IEEE-754 double — exact `toBe` assertions rather than `toBeCloseTo`, which would tolerate an Arithmetic mutator changing the operator to one that happens to land close by.
const DESCRIPTOR: MathFontDescriptorMetrics = {
  unitsPerEm: 2048,
  ascent: 1900,
  descent: -500,
  capHeight: 1400,
  bboxMin: [-200, -600],
  bboxMax: [1800, 2000],
  italicAngle: -12.5,
};
const SCALE = 1000 / DESCRIPTOR.unitsPerEm;

// A minimal synthetic MathFont: buildMathFontObjects reads only .descriptor, .cffBytes, and .glyphSpaceWidth(), so the remaining members are stubs no test here ever calls — `metrics` reuses the real vendored font's own already-built value rather than hand-stubbing MathFontMetrics's large, otherwise-irrelevant shape.
function fakeFont(
  descriptor: MathFontDescriptorMetrics,
  cffBytes: Uint8Array<ArrayBuffer>,
  glyphSpaceWidth: (glyphId: number) => number,
): MathFont {
  return {
    metrics: loadMathFont().font.metrics,
    cffBytes,
    descriptor,
    glyphId: () => undefined,
    glyphSpaceWidth,
    glyphInkBounds: () => undefined,
    minConnectorOverlap: 0,
    stretchyConstruction: () => undefined,
  };
}

function utf8Of(obj: PdfObject | undefined): string | undefined {
  return obj?.kind === "string"
    ? new TextDecoder().decode(obj.bytes)
    : undefined;
}

describe("buildMathFontObjects: Type0 / CIDFontType0 shape and refs", () => {
  it("builds an Identity-H composite font naming STIXTwoMath-Regular and pointing at the given refs", () => {
    const font = fakeFont(DESCRIPTOR, new Uint8Array([1]), () => 0);
    const built = buildMathFontObjects(font, new Map(), REFS, false);

    expect(asName(dictGet(built.type0, "Type"))).toBe("Font");
    expect(asName(dictGet(built.type0, "Subtype"))).toBe("Type0");
    expect(asName(dictGet(built.type0, "BaseFont"))).toBe(
      "STIXTwoMath-Regular",
    );
    expect(asName(dictGet(built.type0, "Encoding"))).toBe("Identity-H");
    expect(dictGet(built.type0, "DescendantFonts")).toEqual(
      pdfArray([REFS.cidFontRef]),
    );
    expect(dictGet(built.type0, "ToUnicode")).toEqual(REFS.toUnicodeRef);

    expect(asName(dictGet(built.cidFont, "Type"))).toBe("Font");
    expect(asName(dictGet(built.cidFont, "Subtype"))).toBe("CIDFontType0");
    expect(asName(dictGet(built.cidFont, "BaseFont"))).toBe(
      "STIXTwoMath-Regular",
    );
    expect(dictGet(built.cidFont, "FontDescriptor")).toEqual(
      REFS.descriptorRef,
    );
    expect(asNumber(dictGet(built.cidFont, "DW"))).toBe(0);
  });

  it("declares CIDSystemInfo as Adobe-Identity-0, the registry a bare (non-CID-keyed) CFF program is read under", () => {
    const font = fakeFont(DESCRIPTOR, new Uint8Array([1]), () => 0);
    const { cidFont } = buildMathFontObjects(font, new Map(), REFS, false);
    const cidSystemInfo = asDict(dictGet(cidFont, "CIDSystemInfo"));
    expect(cidSystemInfo).toBeDefined();
    expect(utf8Of(dictGet(cidSystemInfo!, "Registry"))).toBe("Adobe");
    expect(utf8Of(dictGet(cidSystemInfo!, "Ordering"))).toBe("Identity");
    expect(asNumber(dictGet(cidSystemInfo!, "Supplement"))).toBe(0);
  });
});

describe("buildFontDescriptor", () => {
  it("scales every geometry field from the font's own design units into PDF's fixed 1000-unit glyph space", () => {
    const font = fakeFont(DESCRIPTOR, new Uint8Array([1]), () => 0);
    const { descriptor } = buildMathFontObjects(font, new Map(), REFS, false);

    expect(asName(dictGet(descriptor, "Type"))).toBe("FontDescriptor");
    expect(asName(dictGet(descriptor, "FontName"))).toBe("STIXTwoMath-Regular");
    // The one FontDescriptor flag this module ever sets — bit 3 (value 4), "contains glyphs outside the Adobe standard Latin set", true of essentially everything a math font contributes.
    expect(asNumber(dictGet(descriptor, "Flags"))).toBe(4);
    expect(asNumber(dictGet(descriptor, "ItalicAngle"))).toBe(
      DESCRIPTOR.italicAngle,
    );
    expect(asNumber(dictGet(descriptor, "Ascent"))).toBe(
      DESCRIPTOR.ascent * SCALE,
    );
    expect(asNumber(dictGet(descriptor, "Descent"))).toBe(
      DESCRIPTOR.descent * SCALE,
    );
    expect(asNumber(dictGet(descriptor, "CapHeight"))).toBe(
      DESCRIPTOR.capHeight * SCALE,
    );
    // A nominal, spec-required value no conforming reader actually consults for an embedded font — see the module's own top comment.
    expect(asNumber(dictGet(descriptor, "StemV"))).toBe(80);
    expect(dictGet(descriptor, "FontFile3")).toEqual(REFS.fontFileRef);

    const bbox = asArray(dictGet(descriptor, "FontBBox"));
    expect(bbox?.length).toBe(4);
    expect(asNumber(bbox?.[0])).toBe(DESCRIPTOR.bboxMin[0] * SCALE);
    expect(asNumber(bbox?.[1])).toBe(DESCRIPTOR.bboxMin[1] * SCALE);
    expect(asNumber(bbox?.[2])).toBe(DESCRIPTOR.bboxMax[0] * SCALE);
    expect(asNumber(bbox?.[3])).toBe(DESCRIPTOR.bboxMax[1] * SCALE);
  });

  it("leaves geometry fields unscaled for a font already drawn on a 1000-unit em, proving the scale is computed rather than a fixed constant", () => {
    const thousandEm: MathFontDescriptorMetrics = {
      ...DESCRIPTOR,
      unitsPerEm: 1000,
    };
    const font = fakeFont(thousandEm, new Uint8Array([1]), () => 0);
    const { descriptor } = buildMathFontObjects(font, new Map(), REFS, false);
    expect(asNumber(dictGet(descriptor, "Ascent"))).toBe(thousandEm.ascent);
    expect(asNumber(dictGet(descriptor, "CapHeight"))).toBe(
      thousandEm.capHeight,
    );
  });
});

describe("buildFontFileStream", () => {
  it("embeds the font's raw CFF bytes verbatim, uncompressed, with no Filter when compress is false", () => {
    const cffBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const font = fakeFont(DESCRIPTOR, cffBytes, () => 0);
    const { fontFile } = buildMathFontObjects(font, new Map(), REFS, false);
    expect(fontFile.kind).toBe("stream");
    if (fontFile.kind !== "stream") {
      throw new Error("unreachable");
    }
    expect(asName(dictGet(fontFile.dict, "Subtype"))).toBe("CIDFontType0C");
    expect(dictGet(fontFile.dict, "Filter")).toBeUndefined();
    expect([...fontFile.raw]).toEqual([...cffBytes]);
  });

  it("deflates the font's raw CFF bytes and declares FlateDecode when compress is true", () => {
    // Large and varied enough that deflate genuinely shrinks it — proving compression actually ran rather than merely being declared.
    const cffBytes = new Uint8Array(400).map((_, i) => (i * 37) % 251);
    const font = fakeFont(DESCRIPTOR, cffBytes, () => 0);
    const { fontFile } = buildMathFontObjects(font, new Map(), REFS, true);
    if (fontFile.kind !== "stream") {
      throw new Error("unreachable");
    }
    expect(asName(dictGet(fontFile.dict, "Subtype"))).toBe("CIDFontType0C");
    expect(asName(dictGet(fontFile.dict, "Filter"))).toBe("FlateDecode");
    expect(fontFile.raw.length).toBeLessThan(cffBytes.length);
    const decoded = decodeStream(
      fontFile.raw,
      fontFile.dict,
      NOOP_DIAGNOSTIC_SINK,
    );
    expect([...decoded.bytes]).toEqual([...cffBytes]);
  });
});

describe("buildWidthsArray, via the CIDFont's own /W entry", () => {
  it("writes one CID/width pair per used glyph, ascending by glyph ID regardless of insertion order", () => {
    const widthByGlyph = new Map([
      [50, 500],
      [7, 70],
      [200, 2000],
    ]);
    const font = fakeFont(DESCRIPTOR, new Uint8Array([1]), (glyphId) =>
      widthByGlyph.get(glyphId)!,
    );
    // Inserted deliberately out of ascending order — the output is sorted by the function under test, not by whatever order happened to reach it.
    const usedGlyphs = new Map<number, number | undefined>([
      [50, undefined],
      [7, undefined],
      [200, undefined],
    ]);
    const { cidFont } = buildMathFontObjects(font, usedGlyphs, REFS, false);
    const w = asArray(dictGet(cidFont, "W"));
    expect(w?.length).toBe(6);
    expect(asNumber(w?.[0])).toBe(7);
    expect(asNumber(asArray(w?.[1])?.[0])).toBe(70);
    expect(asNumber(w?.[2])).toBe(50);
    expect(asNumber(asArray(w?.[3])?.[0])).toBe(500);
    expect(asNumber(w?.[4])).toBe(200);
    expect(asNumber(asArray(w?.[5])?.[0])).toBe(2000);
  });

  it("writes an empty /W array when no glyph is used", () => {
    const font = fakeFont(DESCRIPTOR, new Uint8Array([1]), () => 0);
    const { cidFont } = buildMathFontObjects(font, new Map(), REFS, false);
    expect(asArray(dictGet(cidFont, "W"))).toEqual([]);
  });
});

describe("toUnicodeEntries, via the built ToUnicode CMap", () => {
  // A real STIX glyph ID standing in for an assembly-piece placement with no code point of its own (see math-content-write.ts's own collectUsedGlyphs): what this module does with such a glyph is independent of which glyph ID it is, so any glyph ID the font doesn't otherwise use is representative.
  const UNMAPPED_GLYPH = 4862;

  function cmapTextOf(toUnicode: PdfObject): string {
    expect(toUnicode.kind).toBe("stream");
    if (toUnicode.kind !== "stream") {
      throw new Error("unreachable");
    }
    // buildToUnicodeCMap never compresses its own output — plain UTF-8 text, readable with no filter decoding.
    return new TextDecoder().decode(toUnicode.raw);
  }

  it("maps a glyph with a code point, in a bfchar entry naming that code point", () => {
    const font = fakeFont(DESCRIPTOR, new Uint8Array([1]), () => 0);
    const usedGlyphs = new Map<number, number | undefined>([[65, 0x41]]);
    const { toUnicode } = buildMathFontObjects(font, usedGlyphs, REFS, false);
    const text = cmapTextOf(toUnicode);
    expect(text).toContain("1 beginbfchar");
    expect(text).toContain("<0041> <0041>");
  });

  it("drops a glyph with no code point from the CMap entirely, rather than mapping it to nothing", () => {
    const font = fakeFont(DESCRIPTOR, new Uint8Array([1]), () => 0);
    const usedGlyphs = new Map<number, number | undefined>([
      [UNMAPPED_GLYPH, undefined],
    ]);
    const { toUnicode } = buildMathFontObjects(font, usedGlyphs, REFS, false);
    const text = cmapTextOf(toUnicode);
    // No bfchar block at all: the only glyph in the map has nothing to map to.
    expect(text).not.toContain("beginbfchar");
  });

  it("keeps the code-point-bearing glyph and drops the code-point-less one when both are used together", () => {
    const font = fakeFont(DESCRIPTOR, new Uint8Array([1]), () => 0);
    const usedGlyphs = new Map<number, number | undefined>([
      [65, 0x41],
      [UNMAPPED_GLYPH, undefined],
    ]);
    const { toUnicode } = buildMathFontObjects(font, usedGlyphs, REFS, false);
    const text = cmapTextOf(toUnicode);
    expect(text).toContain("1 beginbfchar");
    expect(text).toContain("<0041> <0041>");
    expect(text).not.toContain(
      `<${UNMAPPED_GLYPH.toString(16).padStart(4, "0")}>`,
    );
  });
});

describe("buildMathFontObjects, against the real vendored STIX Two Math font", () => {
  it("produces a widths array whose entries match the real font's own glyph-space measurements", () => {
    const font = loadMathFont().font;
    const latinX = font.glyphId(0x78);
    expect(latinX).toBeDefined();
    const usedGlyphs = new Map<number, number | undefined>([[latinX!, 0x78]]);
    const { cidFont } = buildMathFontObjects(font, usedGlyphs, REFS, true);
    const w = asArray(dictGet(cidFont, "W"));
    expect(w?.length).toBe(2);
    expect(asNumber(w?.[0])).toBe(latinX);
    expect(asNumber(asArray(w?.[1])?.[0])).toBe(font.glyphSpaceWidth(latinX!));
  });

  it("embeds the real font's own CFF table, byte for byte, compressed", () => {
    const font = loadMathFont().font;
    const { fontFile } = buildMathFontObjects(font, new Map(), REFS, true);
    if (fontFile.kind !== "stream") {
      throw new Error("unreachable");
    }
    const decoded = decodeStream(
      fontFile.raw,
      fontFile.dict,
      NOOP_DIAGNOSTIC_SINK,
    );
    expect([...decoded.bytes]).toEqual([...font.cffBytes]);
  });
});
