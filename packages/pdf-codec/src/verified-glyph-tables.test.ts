import { createHash } from "node:crypto";
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
  pdfNum,
  pdfRef,
  pdfStream,
} from "./objects";
import { cffFontWithBuiltinEncoding } from "./test-support/cff";
import {
  VERIFIED_GLYPH_FAMILIES,
  VERIFIED_SOURCES,
  verifiedGlyphTableFor,
  type VerifiedGlyphTableSource,
} from "./verified-glyph-tables";

const NO_DIAGNOSTICS: PdfDiagnosticSink = () => undefined;

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict };
}

function programBytes(label: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(label);
}

function sha256Of(bytes: Uint8Array<ArrayBuffer>): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The font dictionary the typesetter writes for a math symbol subset: `/Differences` assigns the program's glyphs to codes by their own names, and `/ToUnicode` reads each name as the character it spells (the glyph named `/onequarter`, which draws an equals sign, as U+00BC), with no entry for a glyph named `/C0`. `assignments` is the `/Differences` array, so a test can give one program to dictionaries that assign its glyphs to different codes, as these books do.
 */
function symbolSubsetFont(
  program: Uint8Array<ArrayBuffer>,
  assignments: readonly (number | string)[],
): { readonly resolver: PdfObjectResolver; readonly fontDict: PdfDict } {
  const objects = new Map<number, PdfObject>([
    [
      9,
      pdfStream(
        pdfDict({}),
        new TextEncoder().encode("beginbfchar\n<BC> <00BC>\nendbfchar"),
      ),
    ],
    [
      10,
      pdfDict({
        Type: pdfName("FontDescriptor"),
        FontName: pdfName("ABCDEF+AdvMT_SY"),
        Flags: pdfNum(4),
        FontFile3: pdfRef(11, 0),
      }),
    ],
    [11, pdfStream(pdfDict({ Subtype: pdfName("Type1C") }), program)],
  ]);
  const fontDict = pdfDict({
    Type: pdfName("Font"),
    Subtype: pdfName("Type1"),
    BaseFont: pdfName("ABCDEF+AdvMT_SY"),
    FirstChar: pdfNum(1),
    LastChar: pdfNum(255),
    Widths: pdfArray(Array.from({ length: 255 }, () => pdfNum(500))),
    FontDescriptor: pdfRef(10, 0),
    ToUnicode: pdfRef(9, 0),
    Encoding: pdfDict({
      Differences: pdfArray(
        assignments.map((entry) =>
          typeof entry === "number" ? pdfNum(entry) : pdfName(entry),
        ),
      ),
    }),
  });
  return { resolver: makeResolver(objects), fontDict };
}

function decode(
  program: Uint8Array<ArrayBuffer>,
  tables: ReadonlyMap<string, VerifiedGlyphTableSource>,
  assignments: readonly (number | string)[],
  codes: readonly number[],
): string | undefined {
  const { resolver, fontDict } = symbolSubsetFont(program, assignments);
  const { resolve } = createFontResolver({
    resolver,
    sink: NO_DIAGNOSTICS,
    verifiedGlyphTables: tables,
  });
  return resolve(
    "F1",
    pdfDict({ Font: pdfDict({ F1: fontDict }) }),
  )?.decodeToUnicode(new Uint8Array(codes));
}

const CHECKED_PROGRAM = programBytes("the exact subset that was checked");
const CHECKED_TABLES: ReadonlyMap<string, VerifiedGlyphTableSource> = new Map([
  [
    sha256Of(CHECKED_PROGRAM),
    { family: "AdvMT_SY", glyphs: { onequarter: "=", exclam: "→" } },
  ],
]);
const ASSIGNED_AT_BC = [0xbc, "onequarter", 0x01, "C0"];
const ASSIGNED_AT_01 = [0x01, "onequarter", 0x02, "C0"];

describe("a font subset with a verified glyph table", () => {
  it("reads a listed glyph as the symbol it draws, not as what the font dictionary's tables say", () => {
    expect(
      decode(CHECKED_PROGRAM, CHECKED_TABLES, ASSIGNED_AT_BC, [0xbc]),
    ).toBe("=");
  });

  it("selects the glyph by the name the dictionary gives the code, so a dictionary that puts it at another code reads it too", () => {
    expect(
      decode(CHECKED_PROGRAM, CHECKED_TABLES, ASSIGNED_AT_01, [0x01]),
    ).toBe("=");
    expect(
      decode(CHECKED_PROGRAM, CHECKED_TABLES, ASSIGNED_AT_01, [0xbc]),
    ).toBe("¼");
  });

  it("selects the glyph by the named base encoding when /Differences does not name the code, as a one-glyph subset written with /WinAnsiEncoding does", () => {
    const { resolver, fontDict } = symbolSubsetFont(CHECKED_PROGRAM, []);
    const winAnsi = pdfDict(
      new Map([...fontDict.entries, ["Encoding", pdfName("WinAnsiEncoding")]]),
    );
    const { resolve } = createFontResolver({
      resolver,
      sink: NO_DIAGNOSTICS,
      verifiedGlyphTables: CHECKED_TABLES,
    });

    const font = resolve("F1", pdfDict({ Font: pdfDict({ F1: winAnsi }) }));

    // Code 0xBC is /onequarter in WinAnsi, which the table lists as an equals sign.
    expect(font?.decodeToUnicode(new Uint8Array([0xbc]))).toBe("=");
  });

  it("reads a glyph the table does not list as it always was: through /ToUnicode, else the replacement character", () => {
    expect(decode(CHECKED_PROGRAM, new Map(), ASSIGNED_AT_BC, [0xbc])).toBe(
      "¼",
    );
    expect(
      decode(CHECKED_PROGRAM, CHECKED_TABLES, ASSIGNED_AT_BC, [0x01]),
    ).toBe("�");
  });

  it("reads a different subset of the same family, and a different family's subset, as it always was", () => {
    const another = programBytes("another subset of the same font family");
    expect(decode(another, CHECKED_TABLES, ASSIGNED_AT_BC, [0xbc])).toBe("¼");
    expect(
      verifiedGlyphTableFor("Arial", CHECKED_PROGRAM, CHECKED_TABLES),
    ).toBe(undefined);
  });
});

describe("a verified subset whose font dictionary names no encoding", () => {
  // The math italic subset's shape: the program's own encoding puts its glyphs `colon` and `semicolon` at 0x3A and 0x3B, where they draw a full stop and a comma, the font dictionary carries no /Encoding, and /ToUnicode reads each code as the character the glyph's name spells.
  const MATH_ITALIC = cffFontWithBuiltinEncoding({
    name: "ABCDEF+AdvP4C4E51",
    glyphNames: ["colon", "semicolon"],
    encoding: new Map([
      [0x3a, 1],
      [0x3b, 2],
    ]),
  });
  const COLON_AND_SEMICOLON = [0x3a, 0x3b];

  function readThroughBuiltinEncoding(
    tables: ReadonlyMap<string, VerifiedGlyphTableSource>,
  ): string | undefined {
    const objects = new Map<number, PdfObject>([
      [
        9,
        pdfStream(
          pdfDict({}),
          new TextEncoder().encode(
            "beginbfchar\n<3A> <003A>\n<3B> <003B>\nendbfchar",
          ),
        ),
      ],
      [
        10,
        pdfDict({
          Type: pdfName("FontDescriptor"),
          FontName: pdfName("ABCDEF+AdvP4C4E51"),
          Flags: pdfNum(4),
          FontFile3: pdfRef(11, 0),
        }),
      ],
      [11, pdfStream(pdfDict({ Subtype: pdfName("Type1C") }), MATH_ITALIC)],
    ]);
    const fontDict = pdfDict({
      Type: pdfName("Font"),
      Subtype: pdfName("Type1"),
      BaseFont: pdfName("ABCDEF+AdvP4C4E51"),
      FirstChar: pdfNum(0x3a),
      LastChar: pdfNum(0x3b),
      Widths: pdfArray([pdfNum(278), pdfNum(278)]),
      FontDescriptor: pdfRef(10, 0),
      ToUnicode: pdfRef(9, 0),
    });
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink: NO_DIAGNOSTICS,
      verifiedGlyphTables: tables,
    });
    return resolve(
      "F1",
      pdfDict({ Font: pdfDict({ F1: fontDict }) }),
    )?.decodeToUnicode(new Uint8Array(COLON_AND_SEMICOLON));
  }

  it("selects the glyph by the name the program's own encoding gives the code", () => {
    const tables = new Map([
      [
        sha256Of(MATH_ITALIC),
        { family: "AdvP4C4E51", glyphs: { colon: ".", semicolon: "," } },
      ],
    ]);
    expect(readThroughBuiltinEncoding(tables)).toBe(".,");
  });

  it("reads the same program through /ToUnicode when no table lists it", () => {
    expect(readThroughBuiltinEncoding(new Map())).toBe(":;");
  });
});

describe("many font dictionaries sharing one embedded program", () => {
  const SHARING_FONTS = 30;

  it("decodes and hashes the program once, however many dictionaries name it", () => {
    let programReads = 0;
    const stream: PdfObject = {
      kind: "stream",
      dict: pdfDict({ Subtype: pdfName("Type1C") }),
      get raw(): Uint8Array<ArrayBuffer> {
        programReads += 1;
        return CHECKED_PROGRAM;
      },
    };
    const objects = new Map<number, PdfObject>([
      [
        9,
        pdfStream(
          pdfDict({}),
          new TextEncoder().encode("beginbfchar\n<BC> <00BC>\nendbfchar"),
        ),
      ],
      [
        10,
        pdfDict({
          Type: pdfName("FontDescriptor"),
          FontName: pdfName("ABCDEF+AdvMT_SY"),
          Flags: pdfNum(4),
          FontFile3: pdfRef(11, 0),
        }),
      ],
      [11, stream],
    ]);
    const fonts = new Map(
      Array.from({ length: SHARING_FONTS }, (_, index) => [
        `F${String(index)}`,
        pdfDict({
          Type: pdfName("Font"),
          Subtype: pdfName("Type1"),
          BaseFont: pdfName("ABCDEF+AdvMT_SY"),
          FirstChar: pdfNum(1),
          LastChar: pdfNum(255),
          Widths: pdfArray(Array.from({ length: 255 }, () => pdfNum(500))),
          FontDescriptor: pdfRef(10, 0),
          ToUnicode: pdfRef(9, 0),
          Encoding: pdfDict({
            Differences: pdfArray([pdfNum(0xbc), pdfName("onequarter")]),
          }),
        }),
      ]),
    );
    const { resolve } = createFontResolver({
      resolver: makeResolver(objects),
      sink: NO_DIAGNOSTICS,
      verifiedGlyphTables: CHECKED_TABLES,
    });
    const resources = pdfDict({ Font: pdfDict(fonts) });

    const read = [...fonts.keys()].map((name) =>
      resolve(name, resources)?.decodeToUnicode(new Uint8Array([0xbc])),
    );

    expect(read).toEqual(Array.from({ length: SHARING_FONTS }, () => "="));
    expect(programReads).toBe(1);
  });
});

describe("the verified glyph tables", () => {
  it("name the families they were checked for", () => {
    expect([...VERIFIED_GLYPH_FAMILIES].sort()).toEqual([
      "AdvMT_EX",
      "AdvMT_MI",
      "AdvMT_RM",
      "AdvMT_SY",
      "AdvP4C4E46",
      "AdvP4C4E51",
      "AdvP4C4E59",
      "AdvP4C4E74",
      "MT.Extra091.688",
      "Symbol092",
      "TT12A7o00",
      "TT12AAo00",
      "TT12AEo00",
      "TT12D2o00",
      "TT12D7o00",
      "TT12DBo00",
      "TT12DFo00",
      "TT12EFo00",
      "TT12F7o00",
      "TT12FCo00",
      "TT12FFo00",
      "TT1300o00",
      "TT1303o00",
      "TT1304o00",
      "TT1307o00",
      "TT130Co00",
      "TT1313o00",
      "TT1317o00",
      "TT131Bo00",
      "TT131Co00",
      "TT131Fo00",
      "TT1320o00",
      "TT1321o00",
      "TT1324o00",
      "TT1328o00",
      "TT1331o00",
      "TT1334o00",
      "TT1338o00",
    ]);
  });

  it("are keyed by a 64-digit program hash and list glyphs by name", () => {
    for (const [hash, source] of VERIFIED_SOURCES) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/u);
      expect(Object.keys(source.glyphs).length).toBeGreaterThan(0);
    }
  });

  it("read every glyph as a character that is not private-use, not the replacement character and not a control", () => {
    for (const source of VERIFIED_SOURCES.values()) {
      for (const character of Object.values(source.glyphs)) {
        expect(character).not.toMatch(/[\p{Co}\p{Cc}\p{Cn}�]/u);
      }
    }
  });
});

describe("the MathTime extension and roman programs", () => {
  const EXTENSION_PROGRAM =
    "2ca2dba1e1e9b00e0910f1ac2f9c042f54e7a786d4feab4cbe85755a68f77fb1";
  const ROMAN_PROGRAM =
    "f705a315e1683ec7d00aae0d42861ee3610923a1057995017d2253dbf5a3a996";

  it("are each filed once, whatever the number of subsets a document embeds them in", () => {
    expect(VERIFIED_SOURCES.get(EXTENSION_PROGRAM)?.family).toBe("AdvMT_EX");
    expect(VERIFIED_SOURCES.get(ROMAN_PROGRAM)?.family).toBe("AdvMT_RM");
    expect(
      Object.keys(VERIFIED_SOURCES.get(EXTENSION_PROGRAM)?.glyphs ?? {}),
    ).toHaveLength(48);
    expect(
      Object.keys(VERIFIED_SOURCES.get(ROMAN_PROGRAM)?.glyphs ?? {}),
    ).toHaveLength(9);
  });

  it("read the extension program's delimiters and operators as the characters they draw, not as the letters and digits their glyph names spell, and a bare bar of a tall delimiter as the vertical line extension rather than as a pipe, which a Markdown table would read as a cell separator", () => {
    const glyphs = VERIFIED_SOURCES.get(EXTENSION_PROGRAM)?.glyphs;
    expect(glyphs).toMatchObject({
      parenleft: "{",
      parenright: "}",
      space: "(",
      exclam: ")",
      seven: "\u23d0",
      eth: "\u222b",
      P: "\u2211",
      Q: "\u220f",
      t: "\u221a",
      two: "\u2308",
      five: "\u230b",
    });
  });

  it("read the roman program's capital Greek letters and accents, which no /ToUnicode entry names", () => {
    const glyphs = VERIFIED_SOURCES.get(ROMAN_PROGRAM)?.glyphs;
    expect(glyphs).toMatchObject({
      C0: "\u0393",
      C1: "\u0394",
      C10: "\u03a9",
      C2: "\u0398",
      C5: "\u03a0",
      C8: "\u03a6",
      C18: "`",
      C22: "\u00af",
      underscore: "\u00b7",
    });
  });
});

/**
 * Decodes codes 1 to `glyphNames.length` through the dictionary a numbered subset comes in: a symbolic Type 1C font whose `/Differences` names each glyph `G` and a number, with no `/ToUnicode`, and whose program is filed with `source` under its own hash, or with no table at all.
 * @param source - The table to file the program under, or `undefined` for none.
 * @param baseFont - The font's `/BaseFont`, subset tag included.
 * @param glyphNames - The glyph names `/Differences` assigns to codes 1, 2 and so on.
 * @returns The decoded text, or `undefined` if the font did not resolve.
 */
function decodeNumberedSubset(
  source: VerifiedGlyphTableSource | undefined,
  baseFont: string,
  glyphNames: readonly string[],
): string | undefined {
  const program = programBytes(`a numbered subset ${baseFont}`);
  const objects = new Map<number, PdfObject>([
    [
      10,
      pdfDict({
        Type: pdfName("FontDescriptor"),
        FontName: pdfName(baseFont),
        Flags: pdfNum(4),
        FontFile3: pdfRef(11, 0),
      }),
    ],
    [11, pdfStream(pdfDict({ Subtype: pdfName("Type1C") }), program)],
  ]);
  const fontDict = pdfDict({
    Type: pdfName("Font"),
    Subtype: pdfName("Type1"),
    BaseFont: pdfName(baseFont),
    FirstChar: pdfNum(1),
    LastChar: pdfNum(glyphNames.length),
    Widths: pdfArray(glyphNames.map(() => pdfNum(500))),
    FontDescriptor: pdfRef(10, 0),
    Encoding: pdfDict({
      Differences: pdfArray([
        pdfNum(1),
        ...glyphNames.map((name) => pdfName(name)),
      ]),
    }),
  });
  const { resolve } = createFontResolver({
    resolver: makeResolver(objects),
    sink: NO_DIAGNOSTICS,
    verifiedGlyphTables: new Map(
      source === undefined ? [] : [[sha256Of(program), source]],
    ),
  });
  return resolve(
    "F1",
    pdfDict({ Font: pdfDict({ F1: fontDict }) }),
  )?.decodeToUnicode(Uint8Array.from(glyphNames, (_, index) => index + 1));
}

describe("the Symbol subset with glyphs named by their TrueType glyph id", () => {
  const SYMBOL_PROGRAM =
    "988c6d2ea90959baf5ed8f013f6dd21b6e4137145a2e2f75c117591aeca44927";

  /** Decodes the three codes of a `Symbol092` subset through `source` filed under the program's own hash, or through no table at all. */
  function decodeSymbol(
    source: VerifiedGlyphTableSource | undefined,
  ): string | undefined {
    return decodeNumberedSubset(source, "EBLJBD+Symbol092", [
      "G156",
      "G32",
      "G65",
    ]);
  }

  it("is filed under the family the font's /BaseFont gives, so the table reaches the font", () => {
    const source = VERIFIED_SOURCES.get(SYMBOL_PROGRAM);
    expect(source?.family).toBe("Symbol092");
    expect(Object.keys(source?.glyphs ?? {})).toHaveLength(19);
    expect(decodeSymbol(source)).toBe("\u2022 A");
  });

  it("reads every one of its numbered glyphs as replacement characters without the table", () => {
    expect(decodeSymbol(undefined)).toBe("\ufffd\ufffd\ufffd");
  });

  it("reads the operators, the angle, the degree sign and the parenthesis pieces as what they draw", () => {
    expect(VERIFIED_SOURCES.get(SYMBOL_PROGRAM)?.glyphs).toMatchObject({
      G40: "(",
      G41: ")",
      G43: "+",
      G45: "\u2212",
      G61: "=",
      G87: "\u03a9",
      G149: "\u00b0",
      G181: "\u2220",
      G187: "\u221a",
      G203: "\u239b",
      G205: "\u239d",
      G215: "\u222b",
      G221: "\u23a0",
    });
  });
});

describe("the second Symbol subset and the MT Extra subset with glyphs named by their TrueType glyph id", () => {
  const SYMBOL_PROGRAM =
    "90f381fe91a54ffae79ddfee19b113e0ffadaed6d3890d12c8a4df45383830ed";
  const MT_EXTRA_PROGRAM =
    "728661ecaa3cbaef8c895a915c3c76b2935367c136c7eb26b8a353f285cc0212";

  it("read through the font's own /Differences, where no table would leave replacement characters", () => {
    const names = ["G106", "G136", "G162", "G188", "G206"];
    expect(
      decodeNumberedSubset(
        VERIFIED_SOURCES.get(SYMBOL_PROGRAM),
        "CIHHAP+Symbol092",
        names,
      ),
    ).toBe("\u03c6\u2264\u23d0\u22c5\u23a1");
    expect(decodeNumberedSubset(undefined, "CIHHAP+Symbol092", names)).toBe(
      "\ufffd".repeat(names.length),
    );
  });

  it("read the MT Extra arrow and harpoon as what they draw", () => {
    expect(
      decodeNumberedSubset(
        VERIFIED_SOURCES.get(MT_EXTRA_PROGRAM),
        "CIHNKG+MT.Extra091.688",
        ["G114", "G118"],
      ),
    ).toBe("\u2192\u21c0");
  });
});

describe("the driver-made subsets that name glyphs by hexadecimal character code", () => {
  /** Each subset's family and program hash: each subset embeds its own program, so each has its own table. */
  const SUBSETS: readonly (readonly [string, string])[] = [
    [
      "TT12A7o00",
      "0db0d89765377c3faf742c1e1a3ad73823128f0a2570ca1af7c2bc517f952f3e",
    ],
    [
      "TT12AAo00",
      "4ca2b840262ffe3c171b00e3356e3fab6d04ace072ea568e6202549d7100b727",
    ],
    [
      "TT12AEo00",
      "646432883704ba9f450e7a1e6ff247829f19b60e3595e118c9b211152d3db699",
    ],
    [
      "TT12D2o00",
      "e4526f7726da741bd4e1a99ad4fc9a0c04cff02f2d7a82e6b938db3169c3d4b0",
    ],
    [
      "TT12D7o00",
      "5b5d223146fa5724e0a8afffa63e394be63f755316d1303a5420bbb6e8d65b75",
    ],
    [
      "TT12DBo00",
      "e408c862d05e45940b9a974058c26d1360f42bf16a42307a673527758d9f6d87",
    ],
    [
      "TT12DFo00",
      "5593358aab776f8d487b6dde885f3788e56d5e75a735c86831f47f377d4535db",
    ],
    [
      "TT12EFo00",
      "af29d9f37c771777175646fd7c6c1e69b83b18f9d386f78b5188b32c0a42453a",
    ],
    [
      "TT12F7o00",
      "bd09bd5781669cd16c43948d576492b88f3bf25bc7bf29ccd00869600d2fd6e0",
    ],
    [
      "TT12FCo00",
      "6ea84d1d7702aae80a56a3f57a9affb8544dd96032d966c072907b2a9440864a",
    ],
    [
      "TT12FFo00",
      "f97066d39c54f545475079ac6e484258a531229975daa6014dfa4f4f193bc383",
    ],
    [
      "TT1300o00",
      "edc03a7b3bf6f15b10635df37770908c01ba32687f909761c9cad76f58f59afa",
    ],
    [
      "TT1303o00",
      "6c41c38d0b6c8698a7bf5333a15894b4db9f177dcfeaa9f1971309fa51f376bd",
    ],
    [
      "TT1304o00",
      "94f7e1bbaf3e7da51d7b4b65199e6d963f82a390537377545957a962d9ba5a5c",
    ],
    [
      "TT1307o00",
      "da06617d8c2c4445e2e11639bdb3dcca62811a775bf34d229134c30dd89e528a",
    ],
    [
      "TT130Co00",
      "cc8ad4a35dd0e215cd15dfd80f52ba91b074b74a4fda352dd80be6a0dc602bbf",
    ],
    [
      "TT1313o00",
      "1ef72730c1b71ed62a11d31b7ed3dc912f38520cc090c1bbc904c794a5944d83",
    ],
    [
      "TT1317o00",
      "2c947df380df6956d442f19c25a742260d0c5aac91f8af4c4ab2eb746e3ceac0",
    ],
    [
      "TT131Bo00",
      "83d2e57a6beab6f5df0cea284c1f3d66d25d260e49254b8fb7a2c96f92874b5a",
    ],
    [
      "TT131Co00",
      "c6b1340534f3a58ceb3f56fed4d80383ed9d9989114cf9eac9ce167ddd0ede8f",
    ],
    [
      "TT131Fo00",
      "ce9eff390029478b06e117c5b68bf1da1fd0cca9659c6d61ece6b937556025bd",
    ],
    [
      "TT1320o00",
      "c5195941a7009b4597ec52e233992992039d9fae3396fa0a9b15f84b23e67ccc",
    ],
    [
      "TT1321o00",
      "6c00a703d6f1cc3dbc324abd95435e969c0214d4b439c7e56ce4d72d4dedc583",
    ],
    [
      "TT1324o00",
      "35f13b81da794c34c2e62a06712266c04c1b6551298d864b900bbe80966958c5",
    ],
    [
      "TT1328o00",
      "1d02b45af3ff403db40f2d3e106c463fc10fb48e1b420bf8f4b98fe9e91ffd25",
    ],
    [
      "TT1331o00",
      "2436edce94d4d707b2e99beddd800fe70c6afad89fb236f871d744ca0689dfec",
    ],
    [
      "TT1334o00",
      "ce01e817bf6c2f2574e88e2a22330592aca21d8b1d7dab183dd120a0b17fa45a",
    ],
    [
      "TT1338o00",
      "cec0ab70aa79dfa4a1a46d4d37bb6b9ca3385a8c040acab7cd9f9c7ec3dd3a9f",
    ],
  ];

  /** What each glyph name draws in every one of these subsets: the Symbol encoding's parenthesis and bracket pieces at their codes, and the arrow and harpoon set over a phasor. */
  const DRAWN: Readonly<Record<string, string>> = {
    G72: "\u2192",
    G76: "\u21c0",
    Ge6: "\u239b",
    Ge7: "\u239c",
    Ge8: "\u239d",
    Ge9: "\u23a1",
    Gea: "\u23a2",
    Geb: "\u23a3",
    Gf6: "\u239e",
    Gf7: "\u239f",
    Gf8: "\u23a0",
    Gf9: "\u23a4",
    Gfa: "\u23a5",
    Gfb: "\u23a6",
  };

  it("are each filed under the family their /BaseFont gives and read every glyph they list as the same drawn character", () => {
    for (const [family, program] of SUBSETS) {
      const source = VERIFIED_SOURCES.get(program);
      expect(source?.family).toBe(family);
      for (const [name, character] of Object.entries(source?.glyphs ?? {})) {
        expect([name, character]).toEqual([name, DRAWN[name]]);
      }
    }
  });

  it("read a subset's bracket pieces through its /Differences, where no table would leave replacement characters", () => {
    const names = ["Ge9", "Gea", "Geb", "Gf6", "Gf7", "Gf8"];
    expect(
      decodeNumberedSubset(
        VERIFIED_SOURCES.get(
          "6ea84d1d7702aae80a56a3f57a9affb8544dd96032d966c072907b2a9440864a",
        ),
        "BNCDPG+TT12FCo00",
        names,
      ),
    ).toBe("\u23a1\u23a2\u23a3\u239e\u239f\u23a0");
    expect(decodeNumberedSubset(undefined, "BNCDPG+TT12FCo00", names)).toBe(
      "\ufffd".repeat(names.length),
    );
  });
});
