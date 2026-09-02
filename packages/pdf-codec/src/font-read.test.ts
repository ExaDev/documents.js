import { describe, expect, it } from "vitest";
import { widthOfCode } from "./afm-widths";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import { createFontResolver } from "./font-read";
import type { PdfObjectResolver } from "./interpret";
import type { PdfDict, PdfObject } from "./objects";
import {
  asDict,
  pdfArray,
  pdfDict,
  pdfName,
  pdfNum,
  pdfRef,
  pdfStream,
} from "./objects";

function collectDiagnostics(): {
  sink: PdfDiagnosticSink;
  diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict };
}

describe("createFontResolver: simple fonts", () => {
  it("reads widths from an explicit /Widths array, falling back to /FontDescriptor /MissingWidth outside its range", () => {
    const { sink } = collectDiagnostics();
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Arial-Bold"),
      FirstChar: pdfNum(65),
      LastChar: pdfNum(66),
      Widths: pdfArray([pdfNum(700), pdfNum(650)]),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.widthOf(65)).toBe(700);
    expect(font?.widthOf(66)).toBe(650);
    expect(font?.widthOf(67)).toBe(0); // outside FirstChar..LastChar, no FontDescriptor -> MissingWidth defaults to 0
  });

  it("derives family and bold/italic from /BaseFont", () => {
    const { sink } = collectDiagnostics();
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("ABCDEF+Arial-BoldItalic"),
      Widths: pdfArray([]),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font).toMatchObject({
      composite: false,
      family: "Arial",
      bold: true,
      italic: true,
    });
  });

  it("falls back to standard-14 AFM widths when /Widths is entirely absent, matching a recognised family", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Helvetica"),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.widthOf(0x41)).toBe(widthOfCode("Helvetica", 0x41));
    expect(diagnostics.some((d) => d.code === "pdf/font-widths-missing")).toBe(
      false,
    );
  });

  it("reports a diagnostic when falling back for a family that does not match any standard-14 face", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("SomeVeryObscureFont"),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    resolve("F1", resources);
    expect(diagnostics.some((d) => d.code === "pdf/font-widths-missing")).toBe(
      true,
    );
  });

  it("decodes text via a /ToUnicode CMap when present", () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([
      [
        9,
        pdfStream(
          pdfDict({}),
          textBytes("beginbfchar\n<0041> <0058>\nendbfchar"),
        ),
      ],
    ]);
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Helvetica"),
      ToUnicode: pdfRef(9, 0),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([0x41]))).toBe("X");
  });

  it("decodes text via /Encoding /Differences when no /ToUnicode is present", () => {
    const { sink } = collectDiagnostics();
    const encodingDict = pdfDict({
      Differences: pdfArray([pdfNum(65), pdfName("B")]),
    });
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Helvetica"),
      Encoding: encodingDict,
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([65]))).toBe("B");
  });

  it("falls back to the WinAnsi base encoding for a code /Differences does not override", () => {
    const { sink } = collectDiagnostics();
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Helvetica"),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([65]))).toBe("A");
  });

  it("reports a diagnostic and substitutes the replacement character for a genuinely unmappable code", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Helvetica"),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([1]))).toBe("�");
    expect(diagnostics.some((d) => d.code === "text/unmapped-encoding")).toBe(
      true,
    );
  });

  it("resolves a /Differences glyph name outside WinAnsi's own repertoire via the Symbol/ZapfDingbats glyph-name table, on an ordinary Latin font", () => {
    // A ordinary Latin-family font with one code repurposed via /Differences for a single symbol character -- a common real-world pattern (an engineering document splicing an Ohm symbol into otherwise Latin body text) rather than a whole font switching character sets. Before this glyph-name table existed, "Omega" resolved to nothing (glyphNameToUnicode only knew WinAnsi's own glyph names), so this code fell through to the replacement character even though /Differences correctly named the glyph.
    const { sink, diagnostics } = collectDiagnostics();
    const encodingDict = pdfDict({
      Differences: pdfArray([pdfNum(87), pdfName("Omega")]),
    });
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Helvetica"),
      Encoding: encodingDict,
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    // The Adobe Glyph List maps the PostScript name "Omega" to U+2126 OHM SIGN, not U+03A9 GREEK CAPITAL LETTER OMEGA -- see encoding.ts's own header comment on SYMBOL_AND_ZAPFDINGBATS_GLYPH_UNICODE for why.
    expect(font?.decodeToUnicode(new Uint8Array([87]))).toBe("Ω");
    expect(diagnostics.some((d) => d.code === "text/unmapped-encoding")).toBe(
      false,
    );
  });

  it('resolves a /Differences glyph name from the ZapfDingbats "aNNN" namespace via the same glyph-name table', () => {
    const { sink } = collectDiagnostics();
    const encodingDict = pdfDict({
      Differences: pdfArray([pdfNum(200), pdfName("a1")]),
    });
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Helvetica"),
      Encoding: encodingDict,
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([200]))).toBe("✁"); // UPPER BLADE SCISSORS
  });
});

describe("createFontResolver: simple fonts with a Symbol/ZapfDingbats built-in encoding", () => {
  it("decodes via the Symbol font's own built-in encoding when no /Encoding or /ToUnicode covers a code", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const descriptor = pdfDict({ Flags: pdfNum(4) }); // Symbolic bit (ISO 32000-1 Table 123, bit 3)
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Symbol"),
      FontDescriptor: descriptor,
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    // Code 0x57 in the Symbol font's own built-in encoding is glyph "Omega" (U+2126 OHM SIGN per the AGL) -- pre-fix, this code silently fell back to WinAnsiEncoding instead and produced "W" (0x57's WinAnsi glyph), with no diagnostic at all.
    expect(font?.decodeToUnicode(new Uint8Array([0x57]))).toBe("Ω");
    expect(diagnostics.some((d) => d.code === "text/unmapped-encoding")).toBe(
      false,
    );
  });

  it("recognises the Symbol/ZapfDingbats built-in encoding by /BaseFont alone, even with no /FontDescriptor to carry a Symbolic flag", () => {
    const { sink } = collectDiagnostics();
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("ABCDEF+Symbol"), // a subsetted embed still names the same standard-14 face once its subset tag is stripped
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([0x57]))).toBe("Ω");
  });

  it("decodes ZapfDingbats via its own built-in encoding", () => {
    const { sink } = collectDiagnostics();
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("ZapfDingbats"),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([0x21]))).toBe("✁"); // code 0x21 = "a1" = UPPER BLADE SCISSORS
  });

  it("does not silently substitute a plausible-looking Latin letter for a Symbolic font this codec cannot identify", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const descriptor = pdfDict({ Flags: pdfNum(4) }); // Symbolic bit, but /BaseFont is neither Symbol nor ZapfDingbats
    const fontDict = pdfDict({
      Subtype: pdfName("TrueType"),
      BaseFont: pdfName("ABCDEF+CustomSymbolSubset"),
      FontDescriptor: descriptor,
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    // Previously this fell back to WinAnsiEncoding and produced "W" -- a plausible but wrong letter with no diagnostic. This codec has no way to know this font's real built-in encoding without parsing its embedded program, so it now reports honest "unmapped" (the replacement character plus a diagnostic) instead of guessing.
    expect(font?.decodeToUnicode(new Uint8Array([0x57]))).toBe("�");
    expect(diagnostics.some((d) => d.code === "text/unmapped-encoding")).toBe(
      true,
    );
  });

  it("still falls back to WinAnsi when /FontDescriptor explicitly clears the Symbolic flag", () => {
    const { sink } = collectDiagnostics();
    const descriptor = pdfDict({ Flags: pdfNum(32) }); // Nonsymbolic bit (bit 6) only -- Symbolic bit (4) is unset
    const fontDict = pdfDict({
      Subtype: pdfName("TrueType"),
      BaseFont: pdfName("Arial"),
      FontDescriptor: descriptor,
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([65]))).toBe("A");
  });

  it("still prefers /ToUnicode over the Symbol built-in encoding when both are present", () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([
      [
        9,
        pdfStream(
          pdfDict({}),
          textBytes("beginbfchar\n<0057> <03A9>\nendbfchar"),
        ),
      ],
    ]);
    const descriptor = pdfDict({ Flags: pdfNum(4) });
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Symbol"),
      FontDescriptor: descriptor,
      ToUnicode: pdfRef(9, 0),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    const font = resolve("F1", resources);
    // The document's own /ToUnicode CMap here deliberately picks the "genuine" Greek Omega (U+03A9) rather than the built-in table's AGL-conventional U+2126, and it wins: /ToUnicode is always the most specific, most authoritative source when present.
    expect(font?.decodeToUnicode(new Uint8Array([0x57]))).toBe("Ω");
  });
});

describe("createFontResolver: composite (Type0) fonts", () => {
  it("reads CID widths from both array and range forms of /W, with /DW as the default", () => {
    const { sink } = collectDiagnostics();
    const descendant = pdfDict({
      Subtype: pdfName("CIDFontType2"),
      DW: pdfNum(600),
      W: pdfArray([
        pdfNum(3),
        pdfArray([pdfNum(500), pdfNum(600)]),
        pdfNum(10),
        pdfNum(12),
        pdfNum(1000),
      ]),
    });
    const fontDict = pdfDict({
      Subtype: pdfName("Type0"),
      BaseFont: pdfName("ABCDEF+Calibri"),
      Encoding: pdfName("Identity-H"),
      DescendantFonts: pdfArray([descendant]),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.composite).toBe(true);
    expect(font?.widthOf(3)).toBe(500);
    expect(font?.widthOf(4)).toBe(600);
    expect(font?.widthOf(10)).toBe(1000);
    expect(font?.widthOf(12)).toBe(1000);
    expect(font?.widthOf(999)).toBe(600); // falls back to /DW
  });

  it("decodes 2-byte codes via /ToUnicode", () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([
      [
        9,
        pdfStream(
          pdfDict({}),
          textBytes("beginbfchar\n<0003> <0041>\nendbfchar"),
        ),
      ],
    ]);
    const descendant = pdfDict({ Subtype: pdfName("CIDFontType2") });
    const fontDict = pdfDict({
      Subtype: pdfName("Type0"),
      BaseFont: pdfName("Calibri"),
      DescendantFonts: pdfArray([descendant]),
      ToUnicode: pdfRef(9, 0),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([0x00, 0x03]))).toBe("A");
  });

  it("substitutes the replacement character with a diagnostic when there is no /ToUnicode at all", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const descendant = pdfDict({ Subtype: pdfName("CIDFontType2") });
    const fontDict = pdfDict({
      Subtype: pdfName("Type0"),
      BaseFont: pdfName("Calibri"),
      DescendantFonts: pdfArray([descendant]),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([0x00, 0x03]))).toBe("�");
    expect(diagnostics.some((d) => d.code === "text/unmapped-encoding")).toBe(
      true,
    );
  });
});

describe("createFontResolver: the FontMetricsPort adapter", () => {
  it("reports the correct byte length and width for a simple font", () => {
    const { sink } = collectDiagnostics();
    const fontDict = pdfDict({
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("Helvetica"),
      FirstChar: pdfNum(65),
      LastChar: pdfNum(65),
      Widths: pdfArray([pdfNum(700)]),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { metrics } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(
      metrics.glyphAdvance("F1", resources, new Uint8Array([65]), 0),
    ).toEqual({ widthPer1000: 700, byteLengthConsumed: 1 });
  });

  it("reports 2-byte consumption for a composite font", () => {
    const { sink } = collectDiagnostics();
    const descendant = pdfDict({
      Subtype: pdfName("CIDFontType2"),
      DW: pdfNum(1000),
    });
    const fontDict = pdfDict({
      Subtype: pdfName("Type0"),
      BaseFont: pdfName("Calibri"),
      DescendantFonts: pdfArray([descendant]),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { metrics } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(
      metrics.glyphAdvance("F1", resources, new Uint8Array([0x00, 0x41]), 0),
    ).toEqual({ widthPer1000: 1000, byteLengthConsumed: 2 });
  });

  it("returns undefined for a font resource that does not resolve", () => {
    const { sink } = collectDiagnostics();
    const resources = pdfDict({ Font: pdfDict({}) });
    const { metrics } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(
      metrics.glyphAdvance("Missing", resources, new Uint8Array([65]), 0),
    ).toBeUndefined();
  });
});
