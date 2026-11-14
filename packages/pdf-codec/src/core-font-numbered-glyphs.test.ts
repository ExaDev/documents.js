import { describe, expect, it } from "vitest";
import type { PdfDiagnosticSink } from "./diagnostics";
import {
  coreFaceNameOfFontName,
  coreFaceTextsOfNumberedGlyphs,
} from "./core-font-glyph-orders";
import { createFontResolver } from "./font-read";
import type { PdfObjectResolver } from "./interpret-types";
import type { PdfDict, PdfObject } from "./objects";
import { asDict, pdfArray, pdfDict, pdfName, pdfNum } from "./objects";

const NO_DIAGNOSTICS: PdfDiagnosticSink = () => undefined;

// The glyphs of a Times New Roman subset as Acrobat's optimiser names them (G<glyph id in the face>), with the widths its font dictionary gives them: the space, the digit one, capitals G and A, and the letters e, o and r.
const SUBSET = [
  { name: "G3", width: 250 },
  { name: "G20", width: 507 },
  { name: "G42", width: 717 },
  { name: "G36", width: 717 },
  { name: "G72", width: 446 },
  { name: "G82", width: 500 },
  { name: "G85", width: 337 },
] as const;

describe("coreFaceNameOfFontName", () => {
  it.each([
    ["BNBJJO+TimesNewRoman", "TimesNewRomanPSMT"],
    ["TimesNewRoman,Bold", "TimesNewRomanPS-BoldMT"],
    ["EBLIGF+Times.New.Roman092", "TimesNewRomanPSMT"],
    ["EBMBLE+Times.New.Roman.Italic092", "TimesNewRomanPS-ItalicMT"],
    ["CIHFHB+Arial.Bold0133", "Arial-BoldMT"],
    ["EBLKKG+Arial086.75", "ArialMT"],
    ["ArialMT", "ArialMT"],
    ["CourierNewPS-BoldItalicMT", "CourierNewPS-BoldItalicMT"],
    ["LHMEIK+CenturySchoolbook-Bold", "CenturySchoolbook-Bold"],
    ["CenturySchoolbook,Italic", "CenturySchoolbook-Italic"],
  ])("reads %s as %s", (fontName, face) => {
    expect(coreFaceNameOfFontName(fontName)).toBe(face);
  });

  it.each(["Helvetica", "Symbol092", "Calibri", "TT12A7o00"])(
    "reads %s as no core face",
    (fontName) => {
      expect(coreFaceNameOfFontName(fontName)).toBeUndefined();
    },
  );
});

describe("coreFaceTextsOfNumberedGlyphs", () => {
  it("reads each numbered glyph as the character the face draws at that glyph id, when the widths agree", () => {
    const texts = coreFaceTextsOfNumberedGlyphs(
      "EBLIGF+Times.New.Roman092",
      SUBSET,
    );

    expect(texts?.get("G3")).toBe(" ");
    expect(texts?.get("G20")).toBe("1");
    expect(texts?.get("G36")).toBe("A");
    expect(texts?.get("G42")).toBe("G");
    expect(texts?.get("G72")).toBe("e");
  });

  it("refuses a font whose widths are another face's: the same glyph ids under Arial's name", () => {
    expect(
      coreFaceTextsOfNumberedGlyphs("EBLKKG+Arial086.75", SUBSET),
    ).toBeUndefined();
  });

  it("refuses a font that names too few glyphs to tell one face from another, and a font that is not a core face", () => {
    expect(
      coreFaceTextsOfNumberedGlyphs(
        "EBLIGF+Times.New.Roman092",
        SUBSET.slice(0, 3),
      ),
    ).toBeUndefined();
    expect(coreFaceTextsOfNumberedGlyphs("Helvetica", SUBSET)).toBeUndefined();
  });

  it("refuses a font most of whose widths disagree with the face's", () => {
    const wrong = SUBSET.map(({ name }) => ({ name, width: 900 }));

    expect(
      coreFaceTextsOfNumberedGlyphs("EBLIGF+Times.New.Roman092", wrong),
    ).toBeUndefined();
  });
});

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined => obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict: (obj) => resolveDict(obj ?? objects.get(0)) };
}

describe("a CFF subset that numbers its glyphs after a core face", () => {
  it("is read through the face, in the order its /Differences assigns the glyphs", () => {
    const names = SUBSET.map(({ name }) => pdfName(name));
    const fontDict = pdfDict({
      Type: pdfName("Font"),
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("EBLIGF+Times.New.Roman092"),
      FirstChar: pdfNum(1),
      LastChar: pdfNum(SUBSET.length),
      Widths: pdfArray(SUBSET.map(({ width }) => pdfNum(width))),
      Encoding: pdfDict({
        Differences: pdfArray([pdfNum(1), ...names]),
      }),
    });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink: NO_DIAGNOSTICS,
    });

    const font = resolve("F1", pdfDict({ Font: pdfDict({ F1: fontDict }) }));

    // Codes 4, 5, 6 and 7 are G36 (A), G72 (e), G82 (o) and G85 (r).
    expect(font?.decodeToUnicode(new Uint8Array([4, 5, 6, 7, 1, 2]))).toBe(
      "Aeor 1",
    );
  });
});

describe("a CFF subset Acrobat Distiller numbers after Century Schoolbook", () => {
  // Distiller names each glyph g<glyph id in the face>, lower case. The glyphs of a made-up line in Century Schoolbook Bold, with the widths the face gives them: B, R, I, D, G, E, the space, T and S.
  const DISTILLED = [
    { name: "g37", width: 778 },
    { name: "g53", width: 815 },
    { name: "g44", width: 444 },
    { name: "g39", width: 833 },
    { name: "g42", width: 833 },
    { name: "g40", width: 759 },
    { name: "g3", width: 287 },
    { name: "g55", width: 722 },
    { name: "g54", width: 667 },
  ] as const;

  function read(
    baseFont: string,
    codes: readonly number[],
  ): string | undefined {
    const fontDict = pdfDict({
      Type: pdfName("Font"),
      Subtype: pdfName("Type1"),
      BaseFont: pdfName(baseFont),
      FirstChar: pdfNum(1),
      LastChar: pdfNum(DISTILLED.length),
      Widths: pdfArray(DISTILLED.map(({ width }) => pdfNum(width))),
      Encoding: pdfDict({
        Differences: pdfArray([
          pdfNum(1),
          ...DISTILLED.map(({ name }) => pdfName(name)),
        ]),
      }),
    });
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink: NO_DIAGNOSTICS,
    });
    return resolve(
      "F1",
      pdfDict({ Font: pdfDict({ F1: fontDict }) }),
    )?.decodeToUnicode(new Uint8Array(codes));
  }

  // Codes 1 to 9 are the glyphs in the order above.
  const LINE = [1, 2, 3, 4, 5, 6, 7, 8, 6, 9, 8];

  it("is read through the face's glyph order", () => {
    expect(read("LHMEIK+CenturySchoolbook-Bold", LINE)).toBe("BRIDGE TEST");
  });

  it("is refused under another face's name, whose advances disagree", () => {
    expect(read("LHMEIK+CenturySchoolbook-Italic", LINE)).toBe(
      "\uFFFD".repeat(LINE.length),
    );
  });
});
