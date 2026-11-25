import { describe, expect, it } from "vitest";
import type { PdfDiagnosticSink } from "./diagnostics";
import { coreFaceTextsOfType3Glyphs } from "./core-font-glyph-orders";
import { createFontResolver } from "./font-read";
import type { PdfObjectResolver } from "./interpret-types";
import type { PdfDict, PdfObject } from "./objects";
import { asDict, pdfArray, pdfDict, pdfName, pdfNum } from "./objects";
import { unbudgetedResolver } from "./test-support/resolver";

const NO_DIAGNOSTICS: PdfDiagnosticSink = () => undefined;

// One glyph-space unit of these bitmap fonts is one pixel at 72 pixels per em, which the font matrix scales to text space.
const PIXEL = 0.01389;
const THOUSANDTHS = 1000;
// In every core face the glyph for a printable ASCII character has the id of its code less this.
const ASCII_CODE_LESS_GLYPH_ID = 29;

// The glyphs of a Type 3 font made by rendering Arial to 72-pixel bitmaps, each named c and its glyph id in the face, with its width in pixels: the space, =, C, I, L, R, S, Z, a, c, d, e, i, l, m, n, o, p, r, s, t and u.
const ARIAL_BITMAPS = [
  [3, 20],
  [32, 42],
  [38, 52],
  [44, 20],
  [47, 40],
  [53, 52],
  [54, 48],
  [61, 44],
  [68, 40],
  [70, 36],
  [71, 40],
  [72, 40],
  [76, 16],
  [79, 16],
  [80, 59],
  [81, 40],
  [82, 40],
  [83, 40],
  [85, 24],
  [86, 36],
  [87, 20],
  [88, 40],
] as const;

function inThousandths(
  glyphs: readonly (readonly [number, number])[],
): { name: string; width: number }[] {
  return glyphs.map(([id, pixels]) => ({
    name: `c${String(id)}`,
    width: pixels * PIXEL * THOUSANDTHS,
  }));
}

describe("coreFaceTextsOfType3Glyphs", () => {
  it("reads each c<id> glyph as the character the face its widths identify draws at that id", () => {
    const texts = coreFaceTextsOfType3Glyphs(inThousandths(ARIAL_BITMAPS));

    expect(texts?.get("c3")).toBe(" ");
    expect(texts?.get("c32")).toBe("=");
    expect(texts?.get("c38")).toBe("C");
    expect(texts?.get("c80")).toBe("m");
  });

  it("reads a glyph past the ASCII ids only where every face the widths fit draws the same character there", () => {
    // Arial and Arial Italic share their advances, so both fit. Glyph 131 is the degree sign in both; glyph 1728 is 556 wide in both but a different letter in each.
    const texts = coreFaceTextsOfType3Glyphs(
      inThousandths([...ARIAL_BITMAPS, [131, 29], [1728, 40]]),
    );

    expect(texts?.get("c131")).toBe("°");
    expect(texts?.has("c1728")).toBe(false);
    expect(texts?.get("c38")).toBe("C");
  });

  it("refuses a font whose names are character codes, not glyph ids: the same letters named c70, c97 and so on", () => {
    const byCode = ARIAL_BITMAPS.map(
      ([id, pixels]) => [id + ASCII_CODE_LESS_GLYPH_ID, pixels] as const,
    );

    expect(coreFaceTextsOfType3Glyphs(inThousandths(byCode))).toBeUndefined();
  });

  it("refuses a font whose widths fit both readings of its names, glyph ids and character codes alike", () => {
    // In Arial, glyph 44 (I) and the comma are both 278 wide, glyph 73 (f) and I both 278, and so on for each of these numbers, so the widths cannot say which reading the names follow.
    const either = [
      [44, 20],
      [73, 20],
      [96, 24],
      [110, 40],
      [112, 40],
      [113, 40],
      [116, 20],
    ] as const;

    expect(coreFaceTextsOfType3Glyphs(inThousandths(either))).toBeUndefined();
  });

  it("refuses a font all of whose glyphs share one width, which only a fixed-pitch face fits and whose widths therefore identify nothing", () => {
    const monospaced = [3, 4, 5, 6, 7, 8, 9].map(
      (id) => [id, 600 / (PIXEL * THOUSANDTHS)] as const,
    );

    expect(
      coreFaceTextsOfType3Glyphs(inThousandths(monospaced)),
    ).toBeUndefined();
  });

  it("refuses a font with too few glyphs to tell, and one whose names are not c<id>", () => {
    expect(
      coreFaceTextsOfType3Glyphs(inThousandths(ARIAL_BITMAPS.slice(0, 4))),
    ).toBeUndefined();
    expect(
      coreFaceTextsOfType3Glyphs(
        inThousandths(ARIAL_BITMAPS).map(({ name, width }) => ({
          name: name.toUpperCase(),
          width,
        })),
      ),
    ).toBeUndefined();
  });
});

function makeResolver(): PdfObjectResolver {
  return unbudgetedResolver({
    resolve: (obj) => obj,
    resolveDict: (obj: PdfObject | undefined): PdfDict | undefined =>
      asDict(obj),
  });
}

function type3Font(matrixScale: number, skew: number): PdfDict {
  const [firstChar] = ARIAL_BITMAPS[0];
  const lastChar = Math.max(...ARIAL_BITMAPS.map(([id]) => id));
  const widths = Array.from({ length: lastChar - firstChar + 1 }, (_, index) =>
    pdfNum(ARIAL_BITMAPS.find(([id]) => id === index + firstChar)?.[1] ?? 0),
  );
  return pdfDict({
    Type: pdfName("Font"),
    Subtype: pdfName("Type3"),
    FontMatrix: pdfArray(
      [matrixScale, skew, 0, matrixScale, 0, 0].map((n) => pdfNum(n)),
    ),
    FirstChar: pdfNum(firstChar),
    LastChar: pdfNum(lastChar),
    Widths: pdfArray(widths),
    Encoding: pdfDict({
      Type: pdfName("Encoding"),
      Differences: pdfArray(
        ARIAL_BITMAPS.flatMap(([id]) => [
          pdfNum(id),
          pdfName(`c${String(id)}`),
        ]),
      ),
    }),
  });
}

function decode(fontDict: PdfDict, text: string): string | undefined {
  const { resolve } = createFontResolver({
    resolver: makeResolver(),
    sink: NO_DIAGNOSTICS,
  });
  const font = resolve("T1", pdfDict({ Font: pdfDict({ T1: fontDict }) }));
  // Each code is the glyph id of the character it draws.
  return font?.decodeToUnicode(
    new Uint8Array(
      [...text].map((ch) => ch.charCodeAt(0) - ASCII_CODE_LESS_GLYPH_ID),
    ),
  );
}

describe("a Type 3 font of core-face bitmaps named c<id>", () => {
  it("is read through the face its widths, scaled by its /FontMatrix, identify", () => {
    expect(decode(type3Font(PIXEL, 0), "Zs = Source Impedance")).toBe(
      "Zs = Source Impedance",
    );
  });

  it("is not read when its widths, taken in glyph space without the /FontMatrix, fit no face", () => {
    expect(decode(type3Font(1 / THOUSANDTHS, 0), "Source")).toBe(
      "�".repeat("Source".length),
    );
  });

  it("is not read when its /FontMatrix skews the glyphs, so a width is no longer a horizontal distance alone", () => {
    expect(decode(type3Font(PIXEL, PIXEL), "Source")).toBe(
      "�".repeat("Source".length),
    );
  });
});
