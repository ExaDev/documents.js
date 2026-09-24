import type { Color } from "document-schema.js";

// The Color/ColorSchema shape (and COLOR_BLACK/rgbHexToColor/colorToRgbHex) now live in document-schema.js — this file keeps only the DrawingML colour-transform cascade below, which is genuinely OOXML-specific logic, not a content-model shape.

// DrawingML colour-transform child elements (a:shade, a:tint, a:lumMod, a:lumOff), applied to a base a:srgbClr or theme-resolved a:schemeClr colour. Values are the raw OOXML thousandths-of-a-percent integers (e.g. a:lumMod val="60000" means 60.000%), per ECMA-376 Part 1 20.1.10.55 (ST_Percentage) — callers read the attribute string and parse it with Number(), passing the result straight through.
const OOXML_PERCENT_SCALE = 100_000;

export interface ColorTransform {
  readonly kind: "shade" | "tint" | "lumMod" | "lumOff";
  readonly value: number;
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// The sRGB electro-optical transfer function (IEC 61966-2-1): gamma-encoded 0..1 component -> linear light. DrawingML's shade/tint transforms operate in this linear (scRGB) space, not directly on the gamma-encoded byte values — verified against Apache POI's DrawPaint.java (RGB2SCRGB/SCRGB2RGB), a mature, independent OOXML rendering implementation, since guessing this from memory risks silently applying shade/tint in the wrong colour space.
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

// shade: 10% shade is 10% of the (linearised) input colour combined with 90% black — i.e. linear *= pct. tint: 10% tint is 10% of the (linearised) input colour combined with 90% white — i.e. linear = 1 - (1 - linear) * pct. Both formulas and the linear-space requirement are verified against Apache POI's DrawPaint.applyColorTransform.
function applyShadeOrTint(
  color: Readonly<Color>,
  kind: "shade" | "tint",
  value: number,
): Color {
  const pct = value / OOXML_PERCENT_SCALE;
  const transform =
    kind === "shade"
      ? (linear: number) => linear * pct
      : (linear: number) => 1 - (1 - linear) * pct;
  return {
    r: clamp01(linearToSrgb(transform(srgbToLinear(color.r)))),
    g: clamp01(linearToSrgb(transform(srgbToLinear(color.g)))),
    b: clamp01(linearToSrgb(transform(srgbToLinear(color.b)))),
  };
}

export interface Hsl {
  readonly h: number; // degrees, [0, 360)
  readonly s: number; // [0, 1]
  readonly l: number; // [0, 1]
}

// Standard sRGB <-> HSL conversion (CSS Color Module Level 3 / W3C), operating on the gamma-encoded components directly — distinct from, and applied after, the linear-space shade/tint transform above, matching Apache POI's own RGB2HSL/HSL2RGB (which run on the already-gamma-corrected result of any preceding shade/tint pass).
export function rgbToHsl(color: Readonly<Color>): Hsl {
  const { r, g, b } = color;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  // Unconditional equivalent of the textbook piecewise "d / (max+min) below the midpoint, d / (2-max-min) above it": at l === 0.5 exactly, max+min === 2*l === 1 always, which forces 2-max-min === 1 too — so the two branches necessarily agree at the boundary regardless of which side "l > 0.5" is written to include, and a strict-vs-inclusive comparison there can never be told apart by this result. This form (a standard alternate derivation of HSL saturation) sidesteps the boundary comparison entirely:
  // 1 - |2l - 1| equals max+min when l <= 0.5 and 2-max-min when l >= 0.5, matching both branches exactly
  // by construction rather than needing to pick one at the one point where they coincide anyway.
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return { h: h * 60, s, l };
}

function hueToRgbComponent(p: number, q: number, hue: number): number {
  // Wraps into [0, 1) via a floor-based mod rather than a pair of "< 0 add 1" / "> 1 subtract 1" guards: this function is only ever called (from hslToRgb below) with hue already within one turn of that range (hk-1/3 .. hk+1/3, hk itself in [0, 1)), so a single wrap always suffices — but AT hue exactly 0 or exactly 1, an explicit guard's own two branches evaluate to the SAME final result regardless of which one runs (both ultimately reach the p+(q-p)*6*0 === p case below, since 0 and 1 are the same point on the wheel), making a strict-vs-inclusive choice between "< 0"/"> 1" and their own inclusive counterparts genuinely untestable there. hue - Math.floor(hue) needs no such comparison at all, and — unlike the more familiar ((hue % 1) + 1) % 1 double-mod — leaves an already-in-range value bit- exact rather than perturbing it by a rounding epsilon, which matters just below: the two remaining (genuinely non-equivalent) piece boundaries at t === 1/6 and t === 1/2 are tested at that exact value.
  const t = hue - Math.floor(hue);
  if (t < 1 / 6) {
    return p + (q - p) * 6 * t;
  }
  if (t < 1 / 2) {
    return q;
  }
  // The final two pieces (t < 2/3 vs t >= 2/3) meet at the SAME value by construction — the piecewise interpolation is continuous there, so (2/3 - t) is exactly 0 at t === 2/3 and the two formulas agree regardless of which side of that single point "< 2/3" is written to include. Clamping (2/3 - t) to never go negative folds both pieces into one expression without a boundary comparison to mutate: for t < 2/3 the max is a no-op (2/3 - t is already positive) and this is the earlier formula unchanged; for t >= 2/3, 2/3 - t is zero or negative, so the clamp collapses the whole term to p, matching the former "return p" fallback exactly.
  return p + (q - p) * Math.max(0, 2 / 3 - t) * 6;
}

export function hslToRgb(hsl: Hsl): Color {
  const { h, s, l } = hsl;
  // No explicit "s === 0" achromatic shortcut is needed: at s === 0, q below is l + 0 * anything === l regardless of which side of Math.min it lands on, so p === q === l too — and hueToRgbComponent's own formulas, given p === q, collapse to l on every one of its branches (l + (l-l)*x === l; returning q directly is l too), for any hue. The general computation already reaches exactly {r:l,g:l,b:l} for a fully-desaturated colour on its own; the shortcut only ever skipped arithmetic that was going to produce the identical result.
  //
  // Unconditional equivalent of the textbook piecewise "l*(1+s) below the midpoint, l+s-l*s at or above it": at l === 0.5 exactly, both give l+0.5*s, the same value HSL's "L=0.5" pivot is defined to produce — so a strict-vs-inclusive boundary comparison there is untestable by this result no matter which side of 0.5 it is written to include. Math.min(l, 1-l) is l below the midpoint and 1-l at or above it, matching both branches exactly (l + s*l === l*(1+s); l + s*(1-l) === l+s-l*s) without ever comparing l to 0.5 at all.
  const q = l + s * Math.min(l, 1 - l);
  const p = 2 * l - q;
  const hk = h / 360;
  return {
    r: clamp01(hueToRgbComponent(p, q, hk + 1 / 3)),
    g: clamp01(hueToRgbComponent(p, q, hk)),
    b: clamp01(hueToRgbComponent(p, q, hk - 1 / 3)),
  };
}

// lumMod: multiplies luminance by the given percentage (50% halves it, 200% doubles it). lumOff: shifts luminance by the given percentage, additively, with hue/saturation unchanged (a 10% offset to 20% luminance yields 30%). Both operate in HSL space, per ECMA-376's own description of these transforms and Apache POI's DrawPaint implementation.
function applyLumModOrOff(
  color: Readonly<Color>,
  kind: "lumMod" | "lumOff",
  value: number,
): Color {
  const hsl = rgbToHsl(color);
  const pct = value / OOXML_PERCENT_SCALE;
  const l = clamp01(kind === "lumMod" ? hsl.l * pct : hsl.l + pct);
  return hslToRgb({ ...hsl, l });
}

// Applies a sequence of DrawingML colour-transform children to a base colour (an a:srgbClr's own value, or an a:schemeClr's theme-resolved value). Shade/tint are applied first, in linear space; lumMod/lumOff second, in HSL space — a two-pass model (rather than processing each child strictly in its own XML document order) matching Apache POI's DrawPaint.applyColorTransform, a mature, independently-verified OOXML renderer.
export function applyColorTransforms(
  base: Readonly<Color>,
  transforms: readonly ColorTransform[],
): Color {
  let color = base;
  for (const t of transforms) {
    if (t.kind === "shade" || t.kind === "tint") {
      color = applyShadeOrTint(color, t.kind, t.value);
    }
  }
  for (const t of transforms) {
    if (t.kind === "lumMod" || t.kind === "lumOff") {
      color = applyLumModOrOff(color, t.kind, t.value);
    }
  }
  return color;
}
