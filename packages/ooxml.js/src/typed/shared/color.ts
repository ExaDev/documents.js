import type { Color } from "document-schema.js";

// The Color/ColorSchema shape (and COLOR_BLACK/rgbHexToColor/colorToRgbHex) now live in document-schema.js -- this file keeps only the DrawingML colour-transform cascade below, which is genuinely OOXML-specific logic, not a content-model shape.

// DrawingML colour-transform child elements (a:shade, a:tint, a:lumMod, a:lumOff), applied to a base a:srgbClr or theme-resolved a:schemeClr colour. Values are the raw OOXML thousandths-of-a-percent integers (e.g. a:lumMod val="60000" means 60.000%), per ECMA-376 Part 1 20.1.10.55 (ST_Percentage) -- callers read the attribute string and parse it with Number(), passing the result straight through.
const OOXML_PERCENT_SCALE = 100_000;

export interface ColorTransform {
  readonly kind: "shade" | "tint" | "lumMod" | "lumOff";
  readonly value: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// The sRGB electro-optical transfer function (IEC 61966-2-1): gamma-encoded 0..1 component -> linear light. DrawingML's shade/tint transforms operate in this linear (scRGB) space, not directly on the gamma-encoded byte values -- verified against Apache POI's DrawPaint.java (RGB2SCRGB/SCRGB2RGB), a mature, independent OOXML rendering implementation, since guessing this from memory risks silently applying shade/tint in the wrong colour space.
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

// shade: 10% shade is 10% of the (linearised) input colour combined with 90% black -- i.e. linear *= pct. tint: 10% tint is 10% of the (linearised) input colour combined with 90% white -- i.e. linear = 1 - (1 - linear) * pct. Both formulas and the linear-space requirement are verified against Apache POI's DrawPaint.applyColorTransform.
function applyShadeOrTint(
  color: Color,
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

interface Hsl {
  readonly h: number; // degrees, [0, 360)
  readonly s: number; // [0, 1]
  readonly l: number; // [0, 1]
}

// Standard sRGB <-> HSL conversion (CSS Color Module Level 3 / W3C), operating on the gamma-encoded components directly -- distinct from, and applied after, the linear-space shade/tint transform above, matching Apache POI's own RGB2HSL/HSL2RGB (which run on the already-gamma-corrected result of any preceding shade/tint pass).
function rgbToHsl(color: Color): Hsl {
  const { r, g, b } = color;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
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
  let t = hue;
  if (t < 0) {
    t += 1;
  }
  if (t > 1) {
    t -= 1;
  }
  if (t < 1 / 6) {
    return p + (q - p) * 6 * t;
  }
  if (t < 1 / 2) {
    return q;
  }
  if (t < 2 / 3) {
    return p + (q - p) * (2 / 3 - t) * 6;
  }
  return p;
}

function hslToRgb(hsl: Hsl): Color {
  const { h, s, l } = hsl;
  if (s === 0) {
    return { r: l, g: l, b: l };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
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
  color: Color,
  kind: "lumMod" | "lumOff",
  value: number,
): Color {
  const hsl = rgbToHsl(color);
  const pct = value / OOXML_PERCENT_SCALE;
  const l = clamp01(kind === "lumMod" ? hsl.l * pct : hsl.l + pct);
  return hslToRgb({ ...hsl, l });
}

// Applies a sequence of DrawingML colour-transform children to a base colour (an a:srgbClr's own value, or an a:schemeClr's theme-resolved value). Shade/tint are applied first, in linear space; lumMod/lumOff second, in HSL space -- a two-pass model (rather than processing each child strictly in its own XML document order) matching Apache POI's DrawPaint.applyColorTransform, a mature, independently-verified OOXML renderer.
export function applyColorTransforms(
  base: Color,
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
