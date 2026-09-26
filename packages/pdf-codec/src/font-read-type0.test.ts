import { describe, expect, it } from "vitest";
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
import { buildCmapTable, buildSfnt } from "./test-support/sfnt";

function collectDiagnostics(): {
  sink: PdfDiagnosticSink;
  diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return {
    sink: (d) => {
      diagnostics.push(d);
    },
    diagnostics,
  };
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

  it("skips a malformed /W entry (a non-numeric leading operand) rather than losing the rest of the array", () => {
    const { sink } = collectDiagnostics();
    const descendant = pdfDict({
      Subtype: pdfName("CIDFontType2"),
      W: pdfArray([
        pdfName("not-a-cid"), // malformed leading operand: skipped, not a c/cFirst
        pdfNum(3),
        pdfArray([pdfNum(500), pdfNum(600)]),
      ]),
    });
    const fontDict = pdfDict({
      Subtype: pdfName("Type0"),
      BaseFont: pdfName("Calibri"),
      Encoding: pdfName("Identity-H"),
      DescendantFonts: pdfArray([descendant]),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.widthOf(3)).toBe(500);
    expect(font?.widthOf(4)).toBe(600);
  });

  it("defaults a composite font with no /BaseFont at all to Helvetica", () => {
    const { sink } = collectDiagnostics();
    const descendant = pdfDict({ Subtype: pdfName("CIDFontType2") });
    const fontDict = pdfDict({
      Subtype: pdfName("Type0"),
      Encoding: pdfName("Identity-H"),
      DescendantFonts: pdfArray([descendant]),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font).toMatchObject({
      composite: true,
      family: "Helvetica",
      bold: false,
      italic: false,
    });
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

  it("identifies a CID through the embedded program's own Unicode cmap when /ToUnicode is absent", () => {
    const { sink, diagnostics } = collectDiagnostics();
    // Identity-H with the default /CIDToGIDMap makes a CID the embedded program's own glyph ID, so the program's Unicode cmap — read backwards — says what that glyph is, without guessing anything.
    const program = buildSfnt(
      new Map([
        [
          "cmap",
          buildCmapTable([
            {
              platformId: 3,
              encodingId: 1,
              format: 4,
              mappings: new Map([[0x2126, 3]]),
            },
          ]),
        ],
      ]),
    );
    const objects = new Map<number, PdfObject>([
      [7, pdfStream(pdfDict({}), program)],
    ]);
    const descendant = pdfDict({
      Subtype: pdfName("CIDFontType2"),
      FontDescriptor: pdfDict({ FontFile2: pdfRef(7, 0) }),
    });
    const fontDict = pdfDict({
      Subtype: pdfName("Type0"),
      BaseFont: pdfName("CIDFont+F3"),
      Encoding: pdfName("Identity-H"),
      DescendantFonts: pdfArray([descendant]),
    });
    const resources = pdfDict({ Font: pdfDict({ F1: fontDict }) });
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([0x00, 0x03]))).toBe("Ω");
    expect(diagnostics.some((d) => d.code === "text/unmapped-encoding")).toBe(
      false,
    );
  });

  // The identity of CID and glyph id is what makes reading the program legitimate at all, and two things break it: an /Encoding that is not one of the two Identity CMaps, and a /CIDToGIDMap that is neither absent nor /Identity. Each is checked below against the same program the test above reads successfully, so a failure to decode is the guard working rather than a broken fixture.
  function decodeThroughProgram(overrides: {
    readonly encoding: PdfObject;
    readonly cidToGidMap?: PdfObject;
  }): string | undefined {
    const program = buildSfnt(
      new Map([
        [
          "cmap",
          buildCmapTable([
            {
              platformId: 3,
              encodingId: 1,
              format: 4,
              mappings: new Map([[0x2126, 3]]),
            },
          ]),
        ],
      ]),
    );
    const objects = new Map<number, PdfObject>([
      [7, pdfStream(pdfDict({}), program)],
      [8, pdfStream(pdfDict({}), new Uint8Array([0, 0, 0, 3]))],
    ]);
    const descendant = pdfDict({
      Subtype: pdfName("CIDFontType2"),
      FontDescriptor: pdfDict({ FontFile2: pdfRef(7, 0) }),
      ...(overrides.cidToGidMap === undefined
        ? {}
        : { CIDToGIDMap: overrides.cidToGidMap }),
    });
    const fontDict = pdfDict({
      Subtype: pdfName("Type0"),
      BaseFont: pdfName("CIDFont+F3"),
      Encoding: overrides.encoding,
      DescendantFonts: pdfArray([descendant]),
    });
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink: () => undefined,
    });
    return resolve(
      "F1",
      pdfDict({ Font: pdfDict({ F1: fontDict }) }),
    )?.decodeToUnicode(new Uint8Array([0x00, 0x03]));
  }

  it("identifies a CID through the program under Identity-V too, the same identity mapping set vertically", () => {
    expect(decodeThroughProgram({ encoding: pdfName("Identity-V") })).toBe(
      "\u2126",
    );
  });

  it("does not consult the program under a CMap that is not an Identity one", () => {
    // A predefined CMap remaps codes to CIDs through its own tables, so a CID is no longer the program's glyph id and reading the program would answer about the wrong glyph.
    expect(decodeThroughProgram({ encoding: pdfName("90ms-RKSJ-V") })).toBe(
      "\ufffd",
    );
  });

  it("does not consult the program under a /CIDToGIDMap stream", () => {
    // An explicit map breaks the identity just as surely as a non-Identity CMap does.
    expect(
      decodeThroughProgram({
        encoding: pdfName("Identity-H"),
        cidToGidMap: pdfRef(8, 0),
      }),
    ).toBe("\ufffd");
  });

  it("still consults the program when /CIDToGIDMap says /Identity explicitly", () => {
    expect(
      decodeThroughProgram({
        encoding: pdfName("Identity-H"),
        cidToGidMap: pdfName("Identity"),
      }),
    ).toBe("\u2126");
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
