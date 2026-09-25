import { describe, expect, it } from "vitest";
import { applyColorTransforms, hslToRgb, rgbToHsl } from "./color";

// Ported verbatim from documents.js's src/model/color.test.ts. rgbHexToColor/colorToRgbHex/ColorSchema/COLOR_BLACK coverage now lives in document-schema.js's own test suite — this file keeps only applyColorTransforms, the DrawingML-specific logic that stayed here.

// toBeCloseTo's precision argument used throughout the applyColorTransforms and hslToRgb tests below: 12 decimal digits is tight enough that a wrong branch, operator, or boundary condition (each of which typically misses by far more than 1e-12) fails the assertion, while still tolerating the ordinary floating-point rounding a correct computation produces.
const CLOSE_TO_DECIMAL_PRECISION = 12;

// A looser precision than CLOSE_TO_DECIMAL_PRECISION above, used only by expectHsl below: rgbToHsl chains more floating-point operations (a division, an absolute value, several branches) end to end than the direct shade/tint or hslToRgb assertions elsewhere in this file, so its results drift slightly further from an exact decimal at the same number of digits.
const HSL_CLOSE_TO_DECIMAL_PRECISION = 10;

// The result of a 50% shade or tint applied through the linear-space transform, not the naive 0.5 a direct multiply on the gamma-encoded value would give. Shade(white, 50%) and tint(black, 50%) are symmetric under the transform (darkening white 50% towards black in linear space mirrors lightening black 50% towards white), so both tests below that exercise it expect this identical value.
const SHADE_TINT_50_PERCENT_LINEAR_RESULT = 0.7353569830524495;

describe("applyColorTransforms", () => {
  it("lumMod halves luminance for a fully-desaturated colour without touching hue/saturation", () => {
    const white = { r: 1, g: 1, b: 1 };
    expect(
      applyColorTransforms(white, [{ kind: "lumMod", value: 50_000 }]),
    ).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });

  it("lumOff shifts luminance additively", () => {
    const black = { r: 0, g: 0, b: 0 };
    expect(
      applyColorTransforms(black, [{ kind: "lumOff", value: 25_000 }]),
    ).toEqual({ r: 0.25, g: 0.25, b: 0.25 });
  });

  it("shade darkens in linear (gamma-decoded) space, not by a naive direct multiply", () => {
    const white = { r: 1, g: 1, b: 1 };
    const result = applyColorTransforms(white, [
      { kind: "shade", value: 50_000 },
    ]);
    // The naive (wrong) direct-multiply result this test explicitly rules out.
    const NAIVE_DIRECT_MULTIPLY_RESULT = 0.5;
    expect(result.r).toBeCloseTo(
      SHADE_TINT_50_PERCENT_LINEAR_RESULT,
      CLOSE_TO_DECIMAL_PRECISION,
    );
    expect(result.r).not.toBeCloseTo(NAIVE_DIRECT_MULTIPLY_RESULT, 2);
    expect(result.g).toBe(result.r);
    expect(result.b).toBe(result.r);
  });

  it("tint lightens in linear space, symmetric to shade for the opposite base colour", () => {
    const black = { r: 0, g: 0, b: 0 };
    const result = applyColorTransforms(black, [
      { kind: "tint", value: 50_000 },
    ]);
    expect(result.r).toBeCloseTo(
      SHADE_TINT_50_PERCENT_LINEAR_RESULT,
      CLOSE_TO_DECIMAL_PRECISION,
    );
  });

  it("applies shade/tint before lumMod/lumOff regardless of array order", () => {
    const grey = { r: 0.5, g: 0.5, b: 0.5 };
    const orderA = applyColorTransforms(grey, [
      { kind: "lumMod", value: 80_000 },
      { kind: "shade", value: 60_000 },
    ]);
    const orderB = applyColorTransforms(grey, [
      { kind: "shade", value: 60_000 },
      { kind: "lumMod", value: 80_000 },
    ]);
    expect(orderA).toEqual(orderB);
  });

  it("returns the base colour unchanged for an empty transform list", () => {
    const color = { r: 0.2, g: 0.4, b: 0.6 };
    expect(applyColorTransforms(color, [])).toEqual(color);
  });

  it("clamps luminance to [0, 1] rather than overflowing", () => {
    const white = { r: 1, g: 1, b: 1 };
    const result = applyColorTransforms(white, [
      { kind: "lumMod", value: 200_000 },
    ]);
    expect(result).toEqual({ r: 1, g: 1, b: 1 });
  });

  // The sRGB gamma functions' own thresholds and arithmetic, exercised through a 100% shade — an identity transform on the linearised value (linear * 1 === linear) that isolates srgbToLinear/linearToSrgb's own round trip from the shade/tint blend formula. Expected numbers are the real (unmutated) formula's own output, computed independently rather than asserted as a bare round trip back to the input — the sRGB standard's own published gamma/linear thresholds (0.04045 and 0.0031308) are decimal roundings of the true curve intersection, not exact inverses of one another, so even correct code does not always reproduce its input bit-for-bit at these exact boundaries.
  describe("the sRGB gamma functions shade/tint apply the linear-space transform through", () => {
    it("keeps a channel comfortably below both gamma/linear thresholds exactly round-tripped by a 100% shade", () => {
      // Below srgbToLinear's 0.04045 threshold, and (this value)/12.92 is below linearToSrgb's own 0.0031308 threshold too, so a 100% shade (identity on the linearised value) must reconstruct it exactly via the two thresholds' matching low-value (division/multiplication) branches — a wrong arithmetic operator in either function breaks that exact reconstruction.
      const LOW_VALUE_BELOW_BOTH_GAMMA_THRESHOLDS = 0.02;
      const result = applyColorTransforms(
        {
          r: LOW_VALUE_BELOW_BOTH_GAMMA_THRESHOLDS,
          g: LOW_VALUE_BELOW_BOTH_GAMMA_THRESHOLDS,
          b: LOW_VALUE_BELOW_BOTH_GAMMA_THRESHOLDS,
        },
        [{ kind: "shade", value: 100_000 }],
      );
      expect(result.r).toBe(LOW_VALUE_BELOW_BOTH_GAMMA_THRESHOLDS);
    });

    it("takes srgbToLinear's low-value branch for a channel exactly at its 0.04045 threshold", () => {
      const SRGB_TO_LINEAR_THRESHOLD_INPUT = 0.04045;
      const result = applyColorTransforms(
        {
          r: SRGB_TO_LINEAR_THRESHOLD_INPUT,
          g: SRGB_TO_LINEAR_THRESHOLD_INPUT,
          b: SRGB_TO_LINEAR_THRESHOLD_INPUT,
        },
        [{ kind: "shade", value: 100_000 }],
      );
      // The real (inclusive-boundary) low branch reconstructs this specific value; an exclusive-boundary mutant would instead take the high (gamma-curve) branch for this exact input, landing measurably away from it.
      const EXPECTED_LOW_BRANCH_ROUNDTRIP = 0.040449970408122;
      expect(result.r).toBeCloseTo(
        EXPECTED_LOW_BRANCH_ROUNDTRIP,
        CLOSE_TO_DECIMAL_PRECISION,
      );
    });

    it("takes linearToSrgb's low-value branch for a linearised value exactly at its 0.0031308 threshold", () => {
      // srgbToLinear's low branch's own exact preimage of 0.0031308 (this value / 12.92), so a 100% shade feeds linearToSrgb precisely its own threshold value on the way back out.
      const SRGB_TO_LINEAR_THRESHOLD_PREIMAGE = 0.040449936;
      const result = applyColorTransforms(
        {
          r: SRGB_TO_LINEAR_THRESHOLD_PREIMAGE,
          g: SRGB_TO_LINEAR_THRESHOLD_PREIMAGE,
          b: SRGB_TO_LINEAR_THRESHOLD_PREIMAGE,
        },
        [{ kind: "shade", value: 100_000 }],
      );
      expect(result.r).toBeCloseTo(
        SRGB_TO_LINEAR_THRESHOLD_PREIMAGE,
        CLOSE_TO_DECIMAL_PRECISION,
      );
    });

    it("blends towards white by subtracting the linearised channel from 1, not adding it", () => {
      // A mid-grey base gives a non-zero, non-degenerate linearised channel (0.02's near-black linear value collapses (1-linear) and (1+linear) together too closely to distinguish the sign).
      const result = applyColorTransforms({ r: 0.5, g: 0.5, b: 0.5 }, [
        { kind: "tint", value: 50_000 },
      ]);
      const EXPECTED_MID_GREY_50_PERCENT_TINT = 0.8018810657319997;
      expect(result.r).toBeCloseTo(
        EXPECTED_MID_GREY_50_PERCENT_TINT,
        CLOSE_TO_DECIMAL_PRECISION,
      );
    });
  });
});

// Asserts each field with toBeCloseTo rather than a single toEqual: the saturation formula below combines a subtraction and an absolute value, which for these inputs lands a bit off an exact decimal (e.g. 0.5 becomes 0.49999999999999994) — an inherent property of the correct floating-point computation, not a bug either the formula or the test needs to route around.
function expectHsl(
  color: Readonly<{ r: number; g: number; b: number }>,
  hsl: Readonly<{ h: number; s: number; l: number }>,
): void {
  const result = rgbToHsl(color);
  expect(result.h).toBeCloseTo(hsl.h, HSL_CLOSE_TO_DECIMAL_PRECISION);
  expect(result.s).toBeCloseTo(hsl.s, HSL_CLOSE_TO_DECIMAL_PRECISION);
  expect(result.l).toBeCloseTo(hsl.l, HSL_CLOSE_TO_DECIMAL_PRECISION);
}

describe("rgbToHsl", () => {
  it("reads hue from the red channel's own offset when red is the max, without the g<b wrap term", () => {
    expectHsl({ r: 0.8, g: 0.6, b: 0.4 }, { h: 30, s: 0.5, l: 0.6 });
  });

  it("adds the g<b wrap term to red's hue offset when green sits below blue", () => {
    expectHsl({ r: 0.8, g: 0.4, b: 0.6 }, { h: 330, s: 0.5, l: 0.6 });
  });

  it("reads hue from the blue-relative offset when green is the max", () => {
    expectHsl({ r: 0.4, g: 0.8, b: 0.6 }, { h: 150, s: 0.5, l: 0.6 });
  });

  it("reads hue from the green-relative offset when blue is the max", () => {
    expectHsl({ r: 0.4, g: 0.6, b: 0.8 }, { h: 210, s: 0.5, l: 0.6 });
  });

  it("computes the same saturation formula below the lightness midpoint as above it", () => {
    expectHsl({ r: 0.6, g: 0.4, b: 0.2 }, { h: 30, s: 0.5, l: 0.4 });
  });

  it("does not add the g<b wrap term when green exactly equals blue", () => {
    // An inclusive "g <= b" would add the wrap term here too, giving h=360 instead of h=0 — the same point on the colour wheel, but a different raw value this function is responsible for not returning.
    expectHsl(
      { r: 0.8, g: 0.5, b: 0.5 },
      { h: 0, s: 0.42857142857142866, l: 0.65 },
    );
  });
});

describe("hslToRgb", () => {
  it("returns the flat grey (r=g=b=l) for zero saturation, without touching hue", () => {
    expect(hslToRgb({ h: 200, s: 0, l: 0.4 })).toEqual({
      r: 0.4,
      g: 0.4,
      b: 0.4,
    });
  });

  it("wraps a negative hue offset forward and reads the q/p-boundary and final-else branches at hue 0", () => {
    const result = hslToRgb({ h: 0, s: 0.8, l: 0.6 });
    // At hue 0 (pure red), the max channel (r) lands at l+s*(1-l) and the achromatic pair (g, b) lands at l-s*l, verified independently against the CSS Color Module Level 3 reference algorithm.
    const EXPECTED_R = 0.92;
    const EXPECTED_G = 0.28;
    const EXPECTED_B = 0.28;
    expect(result.r).toBeCloseTo(EXPECTED_R, CLOSE_TO_DECIMAL_PRECISION);
    expect(result.g).toBeCloseTo(EXPECTED_G, CLOSE_TO_DECIMAL_PRECISION);
    expect(result.b).toBeCloseTo(EXPECTED_B, CLOSE_TO_DECIMAL_PRECISION);
  });

  it("reads the 2/3-boundary branch at hue 90", () => {
    const result = hslToRgb({ h: 90, s: 0.8, l: 0.6 });
    // At hue 90, red's own hue argument lands exactly on the piecewise function's t < 2/3 boundary, green is the max channel, and blue is the min.
    const EXPECTED_R = 0.6;
    const EXPECTED_G = 0.92;
    const EXPECTED_B = 0.28;
    expect(result.r).toBeCloseTo(EXPECTED_R, CLOSE_TO_DECIMAL_PRECISION);
    expect(result.g).toBeCloseTo(EXPECTED_G, CLOSE_TO_DECIMAL_PRECISION);
    expect(result.b).toBeCloseTo(EXPECTED_B, CLOSE_TO_DECIMAL_PRECISION);
  });

  it("wraps a hue offset past 1 forward at hue 270", () => {
    const result = hslToRgb({ h: 270, s: 0.8, l: 0.6 });
    // At hue 270, blue's own hue argument (hk - 1/3) would land below 0 without the forward wrap, blue is the max channel, and green is the min.
    const EXPECTED_R = 0.6;
    const EXPECTED_G = 0.28;
    const EXPECTED_B = 0.92;
    expect(result.r).toBeCloseTo(EXPECTED_R, CLOSE_TO_DECIMAL_PRECISION);
    expect(result.g).toBeCloseTo(EXPECTED_G, CLOSE_TO_DECIMAL_PRECISION);
    expect(result.b).toBeCloseTo(EXPECTED_B, CLOSE_TO_DECIMAL_PRECISION);
  });

  it("uses l*(1+s) for lightness below the midpoint, distinct from the at-or-above formula", () => {
    const result = hslToRgb({ h: 200, s: 0.8, l: 0.3 });
    // l=0.3 is below the s/l midpoint of 0.5, so q is computed as l*(1+s) rather than l+s-l*s.
    const EXPECTED_R = 0.06;
    const EXPECTED_G = 0.38;
    const EXPECTED_B = 0.54;
    expect(result.r).toBeCloseTo(EXPECTED_R, CLOSE_TO_DECIMAL_PRECISION);
    expect(result.g).toBeCloseTo(EXPECTED_G, CLOSE_TO_DECIMAL_PRECISION);
    expect(result.b).toBeCloseTo(EXPECTED_B, CLOSE_TO_DECIMAL_PRECISION);
  });

  // Exact (not toBeCloseTo) equality: hueToRgbComponent's own piece boundaries at exactly t === 1/6 and t === 1/2 land the real (strict "<") formula and its inclusive-boundary mutant a floating-point epsilon apart (0.92 vs 0.9199999999999999) — a tolerance loose enough to call a real bug "close enough" would defeat the point of testing the boundary at all.
  it("takes the q-branch, not the low-piece formula, at hue's green channel exactly on the 1/6 boundary", () => {
    // h=60 puts hk (the green channel's own hue argument) at exactly 60/360 === 1/6. s=0.73/l=0.29 is one of the (l, s) pairs where the low-piece formula's own floating-point rounding at this exact t measurably misses q, rather than coincidentally landing back on it (many nearby pairs do coincide).
    const EXPECTED_GREEN_AT_ONE_SIXTH_BOUNDARY = 0.5016999999999999;
    expect(hslToRgb({ h: 60, s: 0.73, l: 0.29 }).g).toBe(
      EXPECTED_GREEN_AT_ONE_SIXTH_BOUNDARY,
    );
  });

  it("takes the q-branch, not the final clamped formula, at hue's blue channel exactly on the 1/2 boundary", () => {
    // h=300 puts hk-1/3 (the blue channel's own hue argument) at exactly 300/360 - 1/3 === 0.5.
    const EXPECTED_BLUE_AT_ONE_HALF_BOUNDARY = 0.9199999999999998;
    expect(hslToRgb({ h: 300, s: 0.8, l: 0.6 }).b).toBe(
      EXPECTED_BLUE_AT_ONE_HALF_BOUNDARY,
    );
  });
});
