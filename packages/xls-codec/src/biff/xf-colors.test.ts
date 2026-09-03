import { colorToRgbHex } from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
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
    expect(resolveIcvColor(0, undefined)).toEqual({ r: 0, g: 0, b: 0 }); // Black
    expect(resolveIcvColor(2, undefined)).toEqual({ r: 1, g: 0, b: 0 }); // Red
    expect(resolveIcvColor(7, undefined)).toEqual({ r: 0, g: 1, b: 1 }); // Cyan
  });

  it("resolves icv 8-63 through the fixed default table when no Palette is given", () => {
    // icv 8: rgColor[0]'s own default (0,0,0); icv 24 (0x18): rgColor[16]'s own default (153,153,255) -- [MS-XLS] "Icv"'s own table.
    expect(resolveIcvColor(8, undefined)).toEqual({ r: 0, g: 0, b: 0 });
    expect(resolveIcvColor(24, undefined)).toEqual({
      r: 153 / 255,
      g: 153 / 255,
      b: 1,
    });
  });

  it("resolves icv 8-63 through a real Palette's own entries when one is given", () => {
    const palette = Array.from({ length: 56 }, () => ({ r: 0, g: 0, b: 0 }));
    palette[0] = { r: 1, g: 0.5, b: 0 };
    expect(resolveIcvColor(8, palette)).toEqual({ r: 1, g: 0.5, b: 0 });
  });

  it("does not resolve the Automatic foreground/background special values", () => {
    expect(resolveIcvColor(0x40, undefined)).toBeUndefined();
    expect(resolveIcvColor(0x41, undefined)).toBeUndefined();
  });

  it("does not resolve a value outside every documented range", () => {
    expect(resolveIcvColor(0x7fff, undefined)).toBeUndefined();
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
      ).toEqual(color);
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
    ).toEqual({ color: { r: 1, g: 0, b: 0 }, widthPt: 0.75 });
  });

  it("resolves a double border with its own style member", () => {
    expect(
      resolveBorderEdge({ style: BORDER_STYLE_DOUBLE, icv: 10 }, undefined),
    ).toEqual({ color: { r: 1, g: 0, b: 0 }, widthPt: 0.75, style: "double" });
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
    expect(resolveFillBackground(FILL_PATTERN_SOLID, 10, undefined)).toEqual({
      r: 1,
      g: 0,
      b: 0,
    });
  });

  it("resolves nothing for FLSNULL (no fill pattern)", () => {
    expect(
      resolveFillBackground(FILL_PATTERN_NONE, 10, undefined),
    ).toBeUndefined();
  });

  it("resolves nothing for a fill pattern beyond solid -- a deliberate information-loss case, not an oversight", () => {
    const GRAY_50_PERCENT = 0x02;
    expect(
      resolveFillBackground(GRAY_50_PERCENT, 10, undefined),
    ).toBeUndefined();
  });
});

describe("packXfDecorationWords / unpackXfDecoration", () => {
  it("round-trips a full decoration through pack then unpack", () => {
    const decoration = {
      fillPattern: FILL_PATTERN_SOLID,
      fillForegroundIcv: 12,
      left: { style: BORDER_STYLE_THIN, icv: 10 },
      right: { style: BORDER_STYLE_MEDIUM, icv: 11 },
      top: { style: BORDER_STYLE_DOUBLE, icv: 13 },
      bottom: { style: BORDER_STYLE_NONE, icv: 0 },
    };
    const { word2, word3, word4 } = packXfDecorationWords(decoration);
    expect(unpackXfDecoration(word2, word3, word4)).toEqual(decoration);
  });

  it("packs the exact undecorated defaults ([MS-XLS]'s own 'no border, no fill' state) with no argument", () => {
    const { word2, word3, word4 } = packXfDecorationWords();
    expect(word2).toBe(0);
    // word3's own fls field (bits 26-31) is 0 -- FLSNULL; icvTop/icvBottom (bits 0-13) are also 0.
    expect(word3).toBe(0);
    // word4: icvFore (0x40, Automatic foreground) | icvBack (0x41, Automatic background) << 7.
    expect(word4).toBe(0x40 | (0x41 << 7));
    expect(unpackXfDecoration(word2, word3, word4).left).toEqual({
      style: BORDER_STYLE_NONE,
      icv: 0,
    });
  });

  it("forces icvFore back to Automatic when fillPattern is not solid, even if fillForegroundIcv is set", () => {
    const { word4 } = packXfDecorationWords({
      ...UNDECORATED_XF_FIELDS,
      fillPattern: FILL_PATTERN_NONE,
      fillForegroundIcv: 30,
    });
    expect(word4 & 0x7f).toBe(0x40);
  });
});
