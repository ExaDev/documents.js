import { describe, expect, it } from "vitest";
import type { PdfDiagnosticSink } from "./diagnostics";
import { createFontResolver } from "./font-read";
import type { PdfObjectResolver } from "./interpret-types";
import type { PdfDict, PdfObject } from "./objects";
import {
  asDict,
  pdfArray,
  pdfDict,
  pdfName,
  pdfRef,
  pdfStream,
} from "./objects";
import {
  symbolFontOf,
  withSymbolFontCharacters,
} from "./symbol-font-private-use";
import { pageText } from "./test-support/page-text";
import {
  compositeSymbolFontPdf,
  simpleSymbolFontPdf,
} from "./test-support/pdf-symbol-fonts";
import { WINGDINGS_CHARACTERS } from "./wingdings-characters";

const NO_DIAGNOSTICS: PdfDiagnosticSink = () => undefined;

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict };
}

/** A /ToUnicode CMap sending each two-byte code to the code point given. */
function toUnicodeStream(codes: Readonly<Record<number, number>>): PdfObject {
  const hex = (value: number): string =>
    value.toString(16).toUpperCase().padStart(4, "0");
  const lines = Object.entries(codes).map(
    ([code, codePoint]) => `<${hex(Number(code))}> <${hex(codePoint)}>`,
  );
  return pdfStream(
    pdfDict({}),
    new TextEncoder().encode(`beginbfchar\n${lines.join("\n")}\nendbfchar`),
  );
}

/** What `decodeToUnicode` gives for one code of an embedded CID font named `baseFont` whose /ToUnicode sends it to U+F0xx, the way Word writes a symbol font. */
function compositeSymbolText(
  baseFont: string,
  byte: number,
): string | undefined {
  const objects = new Map<number, PdfObject>([
    [9, toUnicodeStream({ 1: 0xf000 + byte })],
  ]);
  const fontDict = pdfDict({
    Subtype: pdfName("Type0"),
    BaseFont: pdfName(baseFont),
    Encoding: pdfName("Identity-H"),
    DescendantFonts: pdfArray([pdfDict({ Subtype: pdfName("CIDFontType2") })]),
    ToUnicode: pdfRef(9, 0),
  });
  const { resolve } = createFontResolver({
    resolver: makeResolver(objects),
    sink: NO_DIAGNOSTICS,
  });
  return resolve(
    "F1",
    pdfDict({ Font: pdfDict({ F1: fontDict }) }),
  )?.decodeToUnicode(new Uint8Array([0x00, 0x01]));
}

describe("symbolFontOf", () => {
  it.each([
    ["Symbol", "symbol"],
    ["SymbolMT", "symbol"],
    ["Wingdings", "wingdings"],
  ])("reads %s as the %s font", (family, font) => {
    expect(symbolFontOf(family)).toBe(font);
  });

  it.each(["Arial", "Wingdings2", "Wingdings3", "Webdings", "ZapfDingbats"])(
    "leaves %s alone",
    (family) => {
      expect(symbolFontOf(family)).toBeUndefined();
    },
  );
});

describe("withSymbolFontCharacters", () => {
  it("reads the same private-use code point as the font's own glyph, a tick in Wingdings and a brace piece in Symbol", () => {
    expect(withSymbolFontCharacters("wingdings", "")).toBe("✓");
    expect(withSymbolFontCharacters("symbol", "")).toBe("⎫");
  });

  it("reads every Symbol assembly piece as the Unicode character of the same glyph, and leaves the radical extension as written", () => {
    const pieces = [
      [0xe6, "\u239B"],
      [0xec, "\u23A7"],
      [0xef, "\u23AA"],
      [0xf4, "\u23AE"],
      [0xfe, "\u23AD"],
      [0xbd, "\u23D0"],
      [0xbe, "\u23AF"],
      [0xd2, "\u00AE"],
      [0xe4, "\u2122"],
    ] as const;
    for (const [code, expected] of pieces) {
      expect(
        withSymbolFontCharacters("symbol", String.fromCodePoint(0xf000 + code)),
      ).toBe(expected);
    }
    expect(withSymbolFontCharacters("symbol", "\uF060")).toBe("\uF060");
  });

  it("reads the Symbol bullet and the Wingdings square at their own codes", () => {
    expect(withSymbolFontCharacters("symbol", "")).toBe("•");
    expect(withSymbolFontCharacters("wingdings", "")).toBe("▪");
  });

  it("changes nothing for any other font, nor for a character outside the font's 8-bit codes", () => {
    expect(withSymbolFontCharacters(undefined, "")).toBe("");
    expect(withSymbolFontCharacters("wingdings", "A→")).toBe("A→");
  });

  it("leaves a code the font has no character at as it was written", () => {
    expect(withSymbolFontCharacters("wingdings", "")).toBe("");
    expect(withSymbolFontCharacters("wingdings", "")).toBe("");
  });

  it("maps every Wingdings code that holds a character to a code point outside the Private Use Area", () => {
    const privateUse = /\p{Co}/u;
    for (const character of WINGDINGS_CHARACTERS) {
      expect(privateUse.test(character)).toBe(false);
    }
  });
});

describe("a composite symbol font read through its /ToUnicode CMap", () => {
  it("reads the tick Word writes into a document header as U+2713, whatever the subset tag and style", () => {
    expect(compositeSymbolText("VJEZJC+Wingdings-Regular", 0xfc)).toBe("✓");
  });

  it("reads the same code of the Symbol font as its own glyph, not as a tick", () => {
    expect(compositeSymbolText("VJEZJC+SymbolMT", 0xfc)).toBe("⎫");
  });

  it("leaves another font's private-use text as the producer wrote it", () => {
    expect(compositeSymbolText("VJEZJC+Calibri", 0xfc)).toBe("");
  });
});

describe("the pieces of Symbol's tall brackets and braces, by every route a page reaches them", () => {
  it("reads the Symbol font's own encoding of a tall parenthesis as its Unicode pieces", () => {
    const pdf = simpleSymbolFontPdf({
      baseFont: "Symbol",
      codes: [0xe6, 0xe7, 0xe8],
    });
    expect(pageText(pdf)).toBe("\u239B\u239C\u239D");
  });

  it("reads the Adobe private-use code point a /ToUnicode CMap gives a Symbol piece as the piece", () => {
    const pdf = simpleSymbolFontPdf({
      baseFont: "Symbol",
      codes: [0x01, 0x02, 0x03],
      toUnicode: new Map([
        [0x01, 0xf8eb],
        [0x02, 0xf8fe],
        [0x03, 0xf6d9],
      ]),
    });
    expect(pageText(pdf)).toBe("\u239B\u23AD\u00A9");
  });

  it("leaves the radical extension, which Unicode does not encode, as the CMap wrote it", () => {
    const pdf = simpleSymbolFontPdf({
      baseFont: "Symbol",
      codes: [0x01],
      toUnicode: new Map([[0x01, 0xf8e5]]),
    });
    expect(pageText(pdf)).toBe("\uF8E5");
  });

  it("reads a piece /Differences names, in any font, as the piece", () => {
    const pdf = simpleSymbolFontPdf({
      baseFont: "Times-Roman",
      codes: [0x01, 0x02],
      encoding: "<< /Differences [1 /parenlefttp /bracerighttp] >>",
    });
    expect(pageText(pdf)).toBe("\u239B\u23AB");
  });

  it("reads the Adobe private-use code point of a piece in a composite SymbolMT subset as the piece", () => {
    const pdf = compositeSymbolFontPdf({
      baseFont: "ABCDEF+SymbolMT",
      cids: [0xa7],
      toUnicode: new Map([[0xa7, 0xf8eb]]),
    });
    expect(pageText(pdf)).toBe("\u239B");
  });

  it("reads the piece Word writes at the font's own code in the 0xF000 range", () => {
    const pdf = simpleSymbolFontPdf({
      baseFont: "Symbol",
      codes: [0x01],
      toUnicode: new Map([[0x01, 0xf0e6]]),
    });
    expect(pageText(pdf)).toBe("\u239B");
  });

  it("leaves an Adobe private-use code point another font's CMap gives as it was written", () => {
    const pdf = simpleSymbolFontPdf({
      baseFont: "Calibri",
      codes: [0x01],
      toUnicode: new Map([[0x01, 0xf8eb]]),
    });
    expect(pageText(pdf)).toBe("\uF8EB");
  });
});
