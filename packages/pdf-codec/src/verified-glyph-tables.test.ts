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

describe("the verified glyph tables", () => {
  it("name the families they were checked for", () => {
    expect([...VERIFIED_GLYPH_FAMILIES].sort()).toEqual([
      "AdvMT_MI",
      "AdvMT_SY",
      "AdvP4C4E46",
      "AdvP4C4E51",
      "AdvP4C4E59",
      "AdvP4C4E74",
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
