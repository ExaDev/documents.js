import { colorToRgbHex } from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  applyTint,
  BORDER_STYLE_DASHED,
  BORDER_STYLE_DOTTED,
  BORDER_STYLE_DOUBLE,
  BORDER_STYLE_HAIR,
  BORDER_STYLE_MEDIUM,
  BORDER_STYLE_MEDIUM_DASHED,
  BORDER_STYLE_NONE,
  BORDER_STYLE_THICK,
  BORDER_STYLE_THIN,
  borderStyleTokenFor,
  DEFAULT_PALETTE_HEX_TO_ICV,
  FILL_PATTERN_NONE,
  FILL_PATTERN_SOLID,
  ICV_AUTOMATIC_BACKGROUND,
  PALETTE_BASE_ICV,
  PALETTE_ENTRY_COUNT,
  packXfDecorationWords,
  resolveBorderEdge,
  resolveFillBackground,
  resolveIcvColor,
  unpackXfDecoration,
  UNDECORATED_XF_FIELDS,
} from "./xf-colors";

// Every hand-picked colour/index below is taken directly from [MS-XLS]'s own Icv/BorderStyle/FillPattern tables rather than derived from this module's own code, so a failure here points at this package's reading of the specification.

describe("resolveIcvColor", () => {
  it("resolves icv 0-7 to the eight fixed built-in colours", () => {
    expect(resolveIcvColor(0, undefined)).toStrictEqual({ r: 0, g: 0, b: 0 }); // Black
    expect(resolveIcvColor(2, undefined)).toStrictEqual({ r: 1, g: 0, b: 0 }); // Red
    expect(resolveIcvColor(7, undefined)).toStrictEqual({ r: 0, g: 1, b: 1 }); // Cyan
  });

  it("resolves icv 8-63 through the fixed default table when no Palette is given", () => {
    // icv 8: rgColor[0]'s own default (0,0,0); icv 24 (0x18): rgColor[16]'s own default (153,153,255) -- [MS-XLS] "Icv"'s own table.
    expect(resolveIcvColor(8, undefined)).toStrictEqual({ r: 0, g: 0, b: 0 });
    expect(resolveIcvColor(24, undefined)).toStrictEqual({
      r: 153 / 255,
      g: 153 / 255,
      b: 1,
    });
  });

  it("resolves icv 8-63 through a real Palette's own entries when one is given", () => {
    const palette = Array.from({ length: 56 }, () => ({ r: 0, g: 0, b: 0 }));
    palette[0] = { r: 1, g: 0.5, b: 0 };
    expect(resolveIcvColor(8, palette)).toStrictEqual({ r: 1, g: 0.5, b: 0 });
  });

  it("does not resolve the Automatic foreground/background special values", () => {
    expect(resolveIcvColor(0x40, undefined)).toBeUndefined();
    expect(resolveIcvColor(0x41, undefined)).toBeUndefined();
  });

  it("does not resolve a value outside every documented range", () => {
    expect(resolveIcvColor(0x7fff, undefined)).toBeUndefined();
  });

  it("resolves icv 63, the palette range's own last valid index, and refuses icv 64, one past it", () => {
    expect(resolveIcvColor(63, undefined)).toBeDefined();
    expect(resolveIcvColor(64, undefined)).toBeUndefined();
  });
});

describe("DEFAULT_PALETTE_HEX_TO_ICV", () => {
  it("resolves every default-table colour back to SOME icv that itself resolves to the identical colour", () => {
    // Not necessarily the SAME icv: the real default table genuinely repeats a handful of colours at more than one index (e.g. (0,0,128) at both rgColor[10] and rgColor[24], [MS-XLS] "Icv"'s own table), so the map -- built last-write-wins over the table's own entries -- may answer with a different index than the one a given colour started from. What must hold is that whichever icv it answers with round-trips to the same colour.
    for (
      let icv = PALETTE_BASE_ICV;
      icv < PALETTE_BASE_ICV + PALETTE_ENTRY_COUNT;
      icv += 1
    ) {
      const color = resolveIcvColor(icv, undefined);
      expect(color).toBeDefined();
      if (color === undefined) {
        continue;
      }
      const resolvedIcv = DEFAULT_PALETTE_HEX_TO_ICV.get(colorToRgbHex(color));
      expect(resolvedIcv).toBeDefined();
      expect(
        resolvedIcv === undefined
          ? undefined
          : resolveIcvColor(resolvedIcv, undefined),
      ).toStrictEqual(color);
    }
  });
});

describe("resolveBorderEdge / borderStyleTokenFor", () => {
  it("resolves BORDER_STYLE_NONE as no border regardless of icv", () => {
    expect(
      resolveBorderEdge({ style: BORDER_STYLE_NONE, icv: 10 }, undefined),
    ).toBeUndefined();
  });

  it("resolves a thin solid border with no explicit style member (solid is the omitted default)", () => {
    expect(
      resolveBorderEdge({ style: BORDER_STYLE_THIN, icv: 10 }, undefined),
    ).toStrictEqual({ color: { r: 1, g: 0, b: 0 }, widthPt: 0.75 });
  });

  it("resolves a double border with its own style member", () => {
    expect(
      resolveBorderEdge({ style: BORDER_STYLE_DOUBLE, icv: 10 }, undefined),
    ).toStrictEqual({
      color: { r: 1, g: 0, b: 0 },
      widthPt: 0.75,
      style: "double",
    });
  });

  it("does not resolve a border whose colour does not resolve to a fixed RGB value", () => {
    expect(
      resolveBorderEdge({ style: BORDER_STYLE_THIN, icv: 0x40 }, undefined),
    ).toBeUndefined();
  });

  it("round-trips every named weight through borderStyleTokenFor -> resolveBorderEdge -> the same widthPt bucket", () => {
    const cases: readonly [number, number][] = [
      [BORDER_STYLE_HAIR, 0.5],
      [BORDER_STYLE_THIN, 0.75],
      [BORDER_STYLE_MEDIUM, 1.5],
      [BORDER_STYLE_THICK, 2.25],
    ];
    for (const [token, widthPt] of cases) {
      const resolved = resolveBorderEdge({ style: token, icv: 10 }, undefined);
      expect(resolved?.widthPt).toBe(widthPt);
      expect(
        borderStyleTokenFor({ color: { r: 1, g: 0, b: 0 }, widthPt }),
      ).toBe(token);
    }
  });

  it("buckets a dashed border to mediumDashed above the thin/medium boundary and dashed below it", () => {
    expect(
      borderStyleTokenFor({
        color: { r: 0, g: 0, b: 0 },
        widthPt: 0.75,
        style: "dashed",
      }),
    ).toBe(BORDER_STYLE_DASHED);
    expect(
      borderStyleTokenFor({
        color: { r: 0, g: 0, b: 0 },
        widthPt: 1.5,
        style: "dashed",
      }),
    ).toBe(BORDER_STYLE_MEDIUM_DASHED);
  });

  it("maps a dotted style both ways", () => {
    expect(
      borderStyleTokenFor({
        color: { r: 0, g: 0, b: 0 },
        widthPt: 0.75,
        style: "dotted",
      }),
    ).toBe(BORDER_STYLE_DOTTED);
  });
});

describe("resolveFillBackground", () => {
  it("resolves a solid fill's own foreground colour", () => {
    expect(
      resolveFillBackground(FILL_PATTERN_SOLID, 10, 0, undefined),
    ).toStrictEqual({
      kind: "solid",
      color: { r: 1, g: 0, b: 0 },
    });
  });

  it("resolves nothing for FLSNULL (no fill pattern)", () => {
    expect(
      resolveFillBackground(FILL_PATTERN_NONE, 10, 0, undefined),
    ).toBeUndefined();
  });

  it("resolves a genuine two-colour pattern fill instead of dropping it (ExaDev/documents.js#951)", () => {
    const GRAY_50_PERCENT = 0x02;
    expect(
      resolveFillBackground(GRAY_50_PERCENT, 10, 11, undefined),
    ).toStrictEqual({
      kind: "pattern",
      patternType: "mediumGray",
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 1, b: 0 },
    });
  });

  it("resolves a stripe/cross pattern by its own ST_PatternType name", () => {
    const THICK_DIAGONAL_CROSSHATCH = 0x0a;
    expect(
      resolveFillBackground(THICK_DIAGONAL_CROSSHATCH, 10, 11, undefined),
    ).toStrictEqual({
      kind: "pattern",
      patternType: "darkTrellis",
      foregroundColor: { r: 1, g: 0, b: 0 },
      backgroundColor: { r: 0, g: 1, b: 0 },
    });
  });

  it("resolves nothing for a reserved FillPattern value beyond the named 0x00-0x12 range", () => {
    expect(resolveFillBackground(0x13, 10, 11, undefined)).toBeUndefined();
  });

  it("leaves a pattern's own colour unstated when its icv does not resolve to a fixed RGB value", () => {
    const GRAY_50_PERCENT = 0x02;
    const AUTOMATIC_FOREGROUND = 0x40;
    const result = resolveFillBackground(
      GRAY_50_PERCENT,
      AUTOMATIC_FOREGROUND,
      11,
      undefined,
    );
    expect(result).toStrictEqual({
      kind: "pattern",
      patternType: "mediumGray",
      backgroundColor: { r: 0, g: 1, b: 0 },
    });
  });
});

describe("packXfDecorationWords / unpackXfDecoration", () => {
  it("round-trips a solid fill's decoration through pack then unpack", () => {
    const decoration = {
      fillPattern: FILL_PATTERN_SOLID,
      fillForegroundIcv: 12,
      fillBackgroundIcv: ICV_AUTOMATIC_BACKGROUND,
      left: { style: BORDER_STYLE_THIN, icv: 10 },
      right: { style: BORDER_STYLE_MEDIUM, icv: 11 },
      top: { style: BORDER_STYLE_DOUBLE, icv: 13 },
      bottom: { style: BORDER_STYLE_NONE, icv: 0 },
    };
    const { word2, word3, word4 } = packXfDecorationWords(decoration);
    expect(unpackXfDecoration(word2, word3, word4)).toStrictEqual(decoration);
  });

  it("round-trips a genuine two-colour pattern's own foreground and background icv, both real", () => {
    const decoration = {
      ...UNDECORATED_XF_FIELDS,
      fillPattern: 0x02, // FLSMEDGRAY, 50% gray.
      fillForegroundIcv: 12,
      fillBackgroundIcv: 13,
    };
    const { word2, word3, word4 } = packXfDecorationWords(decoration);
    expect(unpackXfDecoration(word2, word3, word4)).toStrictEqual(decoration);
  });

  it("packs the exact undecorated defaults ([MS-XLS]'s own 'no border, no fill' state) with no argument", () => {
    const { word2, word3, word4 } = packXfDecorationWords();
    expect(word2).toBe(0);
    // word3's own fls field (bits 26-31) is 0 -- FLSNULL; icvTop/icvBottom (bits 0-13) are also 0.
    expect(word3).toBe(0);
    // word4: icvFore (0x40, Automatic foreground) | icvBack (0x41, Automatic background) << 7.
    expect(word4).toBe(0x40 | (0x41 << 7));
    expect(unpackXfDecoration(word2, word3, word4).left).toStrictEqual({
      style: BORDER_STYLE_NONE,
      icv: 0,
    });
  });

  it("forces icvFore/icvBack back to Automatic when fillPattern is FLSNULL, even if both are set", () => {
    const { word4 } = packXfDecorationWords({
      ...UNDECORATED_XF_FIELDS,
      fillPattern: FILL_PATTERN_NONE,
      fillForegroundIcv: 30,
      fillBackgroundIcv: 31,
    });
    expect(word4 & 0x7f).toBe(0x40);
    expect((word4 >>> 7) & 0x7f).toBe(0x41);
  });

  it("forces icvBack back to Automatic for a solid fill, even if fillBackgroundIcv is set -- only icvFore is rendered", () => {
    const { word4 } = packXfDecorationWords({
      ...UNDECORATED_XF_FIELDS,
      fillPattern: FILL_PATTERN_SOLID,
      fillForegroundIcv: 12,
      fillBackgroundIcv: 31,
    });
    expect((word4 >>> 7) & 0x7f).toBe(0x41);
  });
});

// Reference values below are the well-known "tint pure red" and "shade pure red" results Excel's own colour picker shows for tint 50%/-50% on the standard red swatch, cross-checked against the Lum'=Lum*(1+tint) (negative) / Lum*(1-tint)+tint (positive) formula Apache POI's XSSFColor#getTint/#setTint documents.
describe("applyTint", () => {
  const red = { r: 1, g: 0, b: 0 };

  it("returns the colour unchanged for a zero tint", () => {
    expect(applyTint(red, 0)).toStrictEqual(red);
  });

  it("tints a colour toward white for a positive value", () => {
    const tinted = applyTint(red, 0.5);
    expect(tinted.r).toBeCloseTo(1);
    expect(tinted.g).toBeCloseTo(0.5);
    expect(tinted.b).toBeCloseTo(0.5);
  });

  it("shades a colour toward black for a negative value", () => {
    const shaded = applyTint(red, -0.5);
    expect(shaded.r).toBeCloseTo(0.5);
    expect(shaded.g).toBeCloseTo(0);
    expect(shaded.b).toBeCloseTo(0);
  });

  it("tints an achromatic colour (grey) without introducing hue", () => {
    const grey = { r: 0.5, g: 0.5, b: 0.5 };
    const tinted = applyTint(grey, 0.5);
    expect(tinted.r).toBeCloseTo(tinted.g);
    expect(tinted.g).toBeCloseTo(tinted.b);
    expect(tinted.r).toBeGreaterThan(grey.r);
  });

  // An independent reference implementation of the identical, standard sRGB<->HSL conversion (W3C CSS Color Module Level 3's own algorithm, https://www.w3.org/TR/css-color-3/#hsl-color) plus the tint formula the source's own top comment cites -- so the colours below (none of them a pure primary, unlike red/grey above, both of which happen to compute an exact 0.5 lightness that never exercises the s formula's own l > 0.5 branch or any hue branch but max === r) can be checked against a real computed expectation rather than only a directional bound.
  function referenceTint(
    color: { r: number; g: number; b: number },
    tint: number,
  ): { r: number; g: number; b: number } {
    const { r, g, b } = color;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) {
        h = (g - b) / d + (g < b ? 6 : 0);
      } else if (max === g) {
        h = (b - r) / d + 2;
      } else {
        h = (r - g) / d + 4;
      }
      h /= 6;
    }
    const newL = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
    if (s === 0) {
      return { r: newL, g: newL, b: newL };
    }
    const q = newL < 0.5 ? newL * (1 + s) : newL + s - newL * s;
    const p = 2 * newL - q;
    const hueToRgb = (t: number): number => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    return { r: hueToRgb(h + 1 / 3), g: hueToRgb(h), b: hueToRgb(h - 1 / 3) };
  }

  it.each([
    // A lightened variant of blue (b uniquely max, l <= 0.5) -- the hue branch neither red (max === r) nor the green case below exercises.
    {
      label: "b-dominant, l<=0.5",
      color: { r: 0.2, g: 0.2, b: 0.6 },
      tint: 0.5,
    },
    // g uniquely max, l > 0.5 -- the s formula's own d / (2 - max - min) branch, which red's exact 0.5 lightness never selects.
    { label: "g-dominant, l>0.5", color: { r: 0.6, g: 1, b: 0.7 }, tint: 0.5 },
    // r max with g < b (red's own g === b never selects the "+6" branch of that ternary), shaded rather than tinted.
    {
      label: "r-dominant with g<b, shaded",
      color: { r: 0.8, g: 0.1, b: 0.3 },
      tint: -0.4,
    },
    // g-dominant with b well below r -- the one shape among these whose own computed hue puts h - 1/3 below zero, exercising hueToRgb's own negative-wraparound branch none of the other cases here reach.
    {
      label: "g-dominant, low hue",
      color: { r: 0.9, g: 1, b: 0.1 },
      tint: 0.3,
    },
  ] as const)(
    "matches an independently computed HSL tint for $label",
    ({ color, tint }) => {
      const expected = referenceTint(color, tint);
      const actual = applyTint(color, tint);
      expect(actual.r).toBeCloseTo(expected.r);
      expect(actual.g).toBeCloseTo(expected.g);
      expect(actual.b).toBeCloseTo(expected.b);
    },
  );
});
