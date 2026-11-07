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
import { styleFromBaseFontName } from "./font-style";
import { pageText } from "./test-support/page-text";
import type { PdfDiagnostic } from "./diagnostics";
import { readPdf } from "./read";
import {
  compositeSymbolFontPdf,
  sharedProgramFontsPdf,
  simpleSymbolFontPdf,
} from "./test-support/pdf-symbol-fonts";
import { buildSfnt } from "./test-support/sfnt";
import { buildNameTable } from "./test-support/sfnt-tables";
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

  it.each([
    ["Wingdings 2", "wingdings2"],
    ["Wingdings2", "wingdings2"],
    ["Wingdings-2", "wingdings2"],
    ["Wingdings 3", "wingdings3"],
    ["Wingdings3", "wingdings3"],
    ["Webdings", "webdings"],
    ["AbcdefWingdings3", "wingdings3"],
  ])("reads %s as the %s font", (family, font) => {
    expect(symbolFontOf(family)).toBe(font);
  });

  it.each(["Arial", "ZapfDingbats", "Wingdings4", "Wingdings 23"])(
    "leaves %s alone",
    (family) => {
      expect(symbolFontOf(family)).toBeUndefined();
    },
  );

  // Each /BaseFont as a producer writes it, read through styleFromBaseFontName first as the font reader does.
  it.each([
    ["SymbolOOEnc", "the name some producers give Symbol re-encoded"],
    ["EuclidSymbol", "MathType's Euclid Symbol, laid out in Symbol's order"],
    ["SymbolMT-OV-JQGJHA", "a font name carrying an -OV- variant tag"],
    ["Symbol-OV-UQGJHA", "Symbol with an -OV- variant tag"],
    ["SmmfqrSymbol", "a mixed-case pseudo subset tag with no plus sign"],
    ["GycxflSymbol", "another such pseudo tag"],
    ["JFTKML+VvdtfySymbolMT", "a subset tag before a pseudo tag"],
    ["Symbol,Bold", "a style suffix"],
  ])("reads %s (%s) as the Symbol font", (baseFont) => {
    expect(symbolFontOf(styleFromBaseFontName(baseFont).baseFamily)).toBe(
      "symbol",
    );
  });

  it.each([
    ["SymbolicSans", "a family that only begins with the word"],
    ["SegoeUISymbol", "a Unicode-encoded font whose name ends in it"],
    ["OpenSymbol", "a font with its own private-use layout"],
    ["SYMBOLS+Symbol", "nothing but its six letters can be a tag"],
    ["Symbol-OV-JQGJ", "an -OV- tag of other than six capitals"],
    ["SmmfqrSymbolic", "a pseudo tag before a name that is not Symbol's"],
    [
      "SmmFqrSymbol",
      "six letters that are not one capital and five small ones",
    ],
    ["Symbol-OV-JQGJHA-Extra", "an -OV- tag that is not at the end"],
    ["Lucida Symbol", "a family word and a space before the name"],
    ["Tahoma-Symbol", "a family word and a hyphen before the name"],
    ["Abcdef_Symbol", "six letters and an underscore before the name"],
    [
      "Impact Webdings",
      "a family word and a space before a dingbat font's name",
    ],
  ])("leaves %s (%s) alone", (baseFont) => {
    expect(
      symbolFontOf(styleFromBaseFontName(baseFont).baseFamily),
    ).toBeUndefined();
  });

  it("reads a Wingdings name carrying a pseudo tag or an -OV- tag as Wingdings", () => {
    expect(symbolFontOf("AbcdefWingdings")).toBe("wingdings");
    expect(symbolFontOf("Wingdings-OV-ABCDEF")).toBe("wingdings");
  });
});

describe("a Symbol-encoded font under another name, read through its /ToUnicode CMap", () => {
  const symbolCodes = new Map([
    [0x01, 0xf03d],
    [0x02, 0xf0b7],
    [0x03, 0xf0ea],
  ]);

  it.each([
    "SymbolOOEnc",
    "EuclidSymbol",
    "SymbolMT-OV-JQGJHA",
    "VvdtfySymbolMT",
  ])(
    "reads the 0xF000 code points of /BaseFont %s as Symbol's glyphs",
    (baseFont) => {
      const pdf = simpleSymbolFontPdf({
        baseFont,
        codes: [0x01, 0x02, 0x03],
        toUnicode: symbolCodes,
      });
      expect(pageText(pdf)).toBe("=\u2022\u23A2");
    },
  );

  // A TrueType program with nothing but a 'name' table stating `postScriptName`.
  function namedProgram(postScriptName: string): Uint8Array<ArrayBuffer> {
    return buildSfnt(
      new Map([
        [
          "name",
          buildNameTable([
            { platformId: 3, encodingId: 1, nameId: 6, text: postScriptName },
          ]),
        ],
      ]),
    );
  }

  it("reads a font whose /BaseFont names no family through the PostScript name of its embedded program", () => {
    const pdf = simpleSymbolFontPdf({
      subtype: "TrueType",
      baseFont: "CIDFont+F1",
      codes: [0x01, 0x02, 0x03],
      toUnicode: symbolCodes,
      program: namedProgram("ABCDEF+SymbolMT"),
    });
    expect(pageText(pdf)).toBe("=\u2022\u23A2");
  });

  it("reads a composite font whose /BaseFont names no family through the PostScript name of its embedded program", () => {
    const pdf = compositeSymbolFontPdf({
      baseFont: "CIDFont+F2",
      cids: [0x01],
      toUnicode: new Map([[0x01, 0xf0fc]]),
      program: namedProgram("Wingdings-Regular"),
    });
    expect(pageText(pdf)).toBe("\u2713");
  });

  it("reads the name of a program many font dictionaries share once, however many of them need it", () => {
    const fontCount = 5;
    const diagnostics: PdfDiagnostic[] = [];
    // A filter this reader does not know reports itself each time the stream is decoded and leaves the bytes as they are, so the program is still read and every decode shows.
    const pdf = sharedProgramFontsPdf({
      fontCount,
      program: namedProgram("SymbolMT"),
      codePoint: 0xf03d,
      filter: "UnknownDecode",
    });
    const document = readPdf(pdf, {
      sink: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    const text = document.pages[0]?.items.flatMap((item) =>
      item.kind === "text" ? [item.text] : [],
    );
    expect(text).toEqual(Array.from({ length: fontCount }, () => "="));
    expect(
      diagnostics.filter(
        (diagnostic) => diagnostic.code === "pdf/unsupported-filter",
      ),
    ).toHaveLength(1);
  });

  it("leaves the private-use text of a font whose program names an ordinary face as written", () => {
    const pdf = simpleSymbolFontPdf({
      subtype: "TrueType",
      baseFont: "CIDFont+F1",
      codes: [0x01],
      toUnicode: new Map([[0x01, 0xf03d]]),
      program: namedProgram("ArialMT"),
    });
    expect(pageText(pdf)).toBe("\uF03D");
  });

  it("reads a font through its program's name when /BaseFont names an ordinary face, since the program states what it is", () => {
    const pdf = simpleSymbolFontPdf({
      subtype: "TrueType",
      baseFont: "Calibri",
      codes: [0x01],
      toUnicode: new Map([[0x01, 0xf03d]]),
      program: namedProgram("SymbolMT"),
    });
    expect(pageText(pdf)).toBe("=");
  });

  it("reads /BaseFont's symbol font over another one the program names", () => {
    const pdf = simpleSymbolFontPdf({
      subtype: "TrueType",
      baseFont: "Wingdings",
      codes: [0x01],
      toUnicode: new Map([[0x01, 0xf0fc]]),
      program: namedProgram("SymbolMT"),
    });
    expect(pageText(pdf)).toBe("\u2713");
  });
});

describe("SymbolMT's own encoding, with no /ToUnicode", () => {
  it("reads a code of a SymbolMT font through Symbol's built-in encoding, as it does for Symbol", () => {
    const pdf = simpleSymbolFontPdf({
      baseFont: "SymbolMT",
      codes: [0xe6, 0x61],
    });
    expect(pageText(pdf)).toBe("\u239B\u03B1");
  });
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

describe("Wingdings 2, Wingdings 3 and Webdings, read through a /ToUnicode CMap", () => {
  it.each([
    ["Wingdings2", 0xf050, "\u{1F5F8}"],
    ["Wingdings3", 0xf0ea, "\u{1F892}"],
    ["Webdings", 0xf03d, "\u23FA"],
  ])(
    "reads /BaseFont %s's private-use code point as the font's own glyph",
    (baseFont, codePoint, text) => {
      const pdf = simpleSymbolFontPdf({
        subtype: "TrueType",
        baseFont,
        codes: [0x01],
        toUnicode: new Map([[0x01, codePoint]]),
      });
      expect(pageText(pdf)).toBe(text);
    },
  );

  it("reads the same code differently in each font, as each font draws it", () => {
    expect(withSymbolFontCharacters("wingdings", "\uF050")).toBe("\u{1F3F1}");
    expect(withSymbolFontCharacters("wingdings2", "\uF050")).toBe("\u{1F5F8}");
    expect(withSymbolFontCharacters("wingdings2", "\uF06C")).toBe("\u2462");
  });

  it("leaves a code the source references give no character as it was written", () => {
    expect(withSymbolFontCharacters("wingdings2", "\uF0FA")).toBe("\uF0FA");
    expect(withSymbolFontCharacters("wingdings3", "\uF0F1")).toBe("\uF0F1");
    expect(withSymbolFontCharacters("webdings", "\uF07F")).toBe("\uF07F");
  });
});
