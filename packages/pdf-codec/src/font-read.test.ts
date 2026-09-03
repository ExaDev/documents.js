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
import { cffFontWithBuiltinEncoding } from "./test-support/cff";
import {
  buildCmapTable,
  buildPostV2Table,
  buildPostV3Table,
  buildSfnt,
} from "./test-support/sfnt";

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

// A symbol-encoded font subset -- a handful of glyphs embedded specifically to draw Ω, µ, ± or ≤ at whatever codes the producing tool happened to pick -- carries its own built-in encoding inside the embedded font program and nowhere else. Reading it is the only way to know what code 0x57 actually draws in a font that is neither the standard-14 Symbol face nor covered by /ToUnicode or /Differences; guessing WinAnsi there yields "W", a plausible-looking wrong letter (ExaDev/documents.js#834).
describe("createFontResolver: a font's own built-in encoding, read from its embedded program", () => {
  // Written as an escape rather than the character itself: U+2126 OHM SIGN and U+03A9 GREEK CAPITAL LETTER OMEGA are visually identical, and the Adobe Glyph List deliberately maps the glyph name "Omega" to the former.
  const OHM_SIGN = "Ω";

  // A TrueType program whose (3,0) Microsoft Symbol cmap subtable maps a character code (offset into the 0xF000 private-use range, as ISO 32000-1 9.6.6.4 describes) onto a glyph, with that glyph named by the font's own 'post' table.
  function symbolTrueTypeProgram(options: {
    readonly symbolCmapFormat?: 0 | 4 | 6;
    readonly postNames?: readonly string[];
    readonly unicodeCmap?: ReadonlyMap<number, number>;
  }): Uint8Array<ArrayBuffer> {
    const subtables = [
      {
        platformId: 3,
        encodingId: 0,
        format: options.symbolCmapFormat ?? 4,
        mappings: new Map([[0xf057, 3]]),
      } as const,
    ];
    return buildSfnt(
      new Map([
        [
          "cmap",
          buildCmapTable(
            options.unicodeCmap === undefined
              ? subtables
              : [
                  ...subtables,
                  {
                    platformId: 3,
                    encodingId: 1,
                    format: 4,
                    mappings: options.unicodeCmap,
                  } as const,
                ],
          ),
        ],
        [
          "post",
          options.postNames === undefined
            ? buildPostV3Table()
            : buildPostV2Table(options.postNames),
        ],
      ]),
    );
  }

  function fontWithProgram(
    programKey: string,
    program: Uint8Array<ArrayBuffer>,
    extraFontEntries: Record<string, PdfObject> = {},
    descriptorEntries: Record<string, PdfObject> = {},
  ): {
    readonly resources: PdfDict;
    readonly objects: Map<number, PdfObject>;
  } {
    const objects = new Map<number, PdfObject>([
      [7, pdfStream(pdfDict({}), program)],
    ]);
    const descriptor = pdfDict({
      ...descriptorEntries,
      [programKey]: pdfRef(7, 0),
    });
    const fontDict = pdfDict({
      Subtype: pdfName("TrueType"),
      BaseFont: pdfName("CIDFont+F3"),
      FontDescriptor: descriptor,
      ...extraFontEntries,
    });
    return { resources: pdfDict({ Font: pdfDict({ F1: fontDict }) }), objects };
  }

  it("maps a code through an embedded TrueType program's own (3,0) symbol cmap and 'post' glyph names", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const { resources, objects } = fontWithProgram(
      "FontFile2",
      symbolTrueTypeProgram({ postNames: ["", "", "", "Omega"] }),
      {},
      { Flags: pdfNum(4) }, // Symbolic
    );
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    const font = resolve("F1", resources);
    expect(font?.decodeToUnicode(new Uint8Array([0x57]))).toBe(OHM_SIGN);
    expect(diagnostics.some((d) => d.code === "text/unmapped-encoding")).toBe(
      false,
    );
  });

  it("reads the built-in encoding even when the font descriptor never sets the Symbolic flag", () => {
    const { sink } = collectDiagnostics();
    // The reported case: a subset font drawing nothing but ohm signs, whose /Flags omits the Symbolic bit. Without its own program's encoding this fell through to WinAnsiEncoding and decoded as "W".
    const { resources, objects } = fontWithProgram(
      "FontFile2",
      symbolTrueTypeProgram({ postNames: ["", "", "", "Omega"] }),
    );
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    expect(
      resolve("F1", resources)?.decodeToUnicode(new Uint8Array([0x57])),
    ).toBe(OHM_SIGN);
  });

  it("reads a (3,0) subtable in the byte-encoding format, where codes are unshifted", () => {
    const { sink } = collectDiagnostics();
    const program = buildSfnt(
      new Map([
        [
          "cmap",
          buildCmapTable([
            {
              platformId: 3,
              encodingId: 0,
              format: 0,
              mappings: new Map([[0x57, 3]]),
            },
          ]),
        ],
        ["post", buildPostV2Table(["", "", "", "Omega"])],
      ]),
    );
    const { resources, objects } = fontWithProgram("FontFile2", program);
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    expect(
      resolve("F1", resources)?.decodeToUnicode(new Uint8Array([0x57])),
    ).toBe(OHM_SIGN);
  });

  it("falls back to the program's own Unicode cmap for a glyph the 'post' table does not name", () => {
    const { sink } = collectDiagnostics();
    // A subsetter that strips glyph names (version 3.0 'post') usually leaves the Unicode subtable in place, so the glyph the symbol subtable selects can still be identified by reversing it.
    const { resources, objects } = fontWithProgram(
      "FontFile2",
      symbolTrueTypeProgram({ unicodeCmap: new Map([[0x2126, 3]]) }),
    );
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    expect(
      resolve("F1", resources)?.decodeToUnicode(new Uint8Array([0x57])),
    ).toBe(OHM_SIGN);
  });

  it("maps a code through an embedded CFF program's own Encoding and charset", () => {
    const { sink } = collectDiagnostics();
    const program = cffFontWithBuiltinEncoding({
      name: "CIDFont+F3",
      glyphNames: ["Omega"],
      encoding: new Map([[0x57, 1]]),
    });
    const { resources, objects } = fontWithProgram("FontFile3", program);
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    expect(
      resolve("F1", resources)?.decodeToUnicode(new Uint8Array([0x57])),
    ).toBe(OHM_SIGN);
  });

  it("maps a code through an embedded Type 1 program's own cleartext /Encoding array", () => {
    const { sink } = collectDiagnostics();
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: SymbolSubset 001.000",
        "/FontName /CIDFont+F3 def",
        "/Encoding 256 array",
        "0 1 255 {1 index exch /.notdef put} for",
        "dup 87 /Omega put",
        "readonly def",
        "currentdict end",
        "currentfile eexec",
        "",
      ].join("\n"),
    );
    const { resources, objects } = fontWithProgram("FontFile", program);
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    expect(
      resolve("F1", resources)?.decodeToUnicode(new Uint8Array([0x57])),
    ).toBe(OHM_SIGN);
  });

  it("still prefers an explicitly named base encoding over the embedded program's own", () => {
    const { sink } = collectDiagnostics();
    // A non-symbolic font that names its base encoding has said what its codes mean; the program's built-in encoding is the fallback for a font that does not (ISO 32000-1 9.6.6.2), not an override of one that does.
    const { resources, objects } = fontWithProgram(
      "FontFile2",
      symbolTrueTypeProgram({ postNames: ["", "", "", "Omega"] }),
      { Encoding: pdfName("WinAnsiEncoding") },
    );
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    expect(
      resolve("F1", resources)?.decodeToUnicode(new Uint8Array([0x57])),
    ).toBe("W");
  });

  it("still prefers /Differences over the embedded program's own encoding", () => {
    const { sink } = collectDiagnostics();
    const { resources, objects } = fontWithProgram(
      "FontFile2",
      symbolTrueTypeProgram({ postNames: ["", "", "", "Omega"] }),
      {
        Encoding: pdfDict({
          Differences: pdfArray([pdfNum(0x57), pdfName("mu")]),
        }),
      },
    );
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    expect(
      resolve("F1", resources)?.decodeToUnicode(new Uint8Array([0x57])),
    ).toBe("µ");
  });

  it("reports an unmapped code rather than guessing when the embedded program yields no encoding at all", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const { resources, objects } = fontWithProgram(
      "FontFile2",
      buildSfnt(new Map([["post", buildPostV3Table()]])), // no 'cmap' at all: nothing to recover an encoding from
      {},
      { Flags: pdfNum(4) },
    );
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink,
    });
    expect(
      resolve("F1", resources)?.decodeToUnicode(new Uint8Array([0x57])),
    ).toBe("�");
    expect(diagnostics.some((d) => d.code === "text/unmapped-encoding")).toBe(
      true,
    );
  });
});

describe("createFontResolver: named base encodings", () => {
  function fontWithBaseEncoding(name: string): PdfDict {
    return pdfDict({
      Font: pdfDict({
        F1: pdfDict({
          Subtype: pdfName("Type1"),
          BaseFont: pdfName("Helvetica"),
          Encoding: pdfName(name),
        }),
      }),
    });
  }

  it("decodes /MacRomanEncoding through its own table rather than approximating it as WinAnsi", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", fontWithBaseEncoding("MacRomanEncoding"));
    // Code 0xBD is "Omega" in MacRomanEncoding and "onehalf" in WinAnsi -- the two disagree across most of the upper half. The expected character is U+2126 OHM SIGN, the Adobe Glyph List's own mapping for that name, not the visually identical U+03A9.
    expect(font?.decodeToUnicode(new Uint8Array([0xbd]))).toBe("Ω");
    expect(
      diagnostics.some((d) => d.code === "char/encoding-approximated"),
    ).toBe(false);
  });

  it("decodes /StandardEncoding through its own table", () => {
    const { sink } = collectDiagnostics();
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    const font = resolve("F1", fontWithBaseEncoding("StandardEncoding"));
    // Code 0xA9 is "quotesingle" in StandardEncoding, where WinAnsi has the copyright sign.
    expect(font?.decodeToUnicode(new Uint8Array([0xa9]))).toBe("'");
  });

  it("still reports an approximation for a base encoding this codec has no table for", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const { resolve } = createFontResolver({
      resolver: makeResolver(new Map()),
      sink,
    });
    resolve("F1", fontWithBaseEncoding("MacExpertEncoding"));
    expect(
      diagnostics.some((d) => d.code === "char/encoding-approximated"),
    ).toBe(true);
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

  it("identifies a CID through the embedded program's own Unicode cmap when /ToUnicode is absent", () => {
    const { sink, diagnostics } = collectDiagnostics();
    // Identity-H with the default /CIDToGIDMap makes a CID the embedded program's own glyph ID, so the program's Unicode cmap -- read backwards -- says what that glyph is, without guessing anything.
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
