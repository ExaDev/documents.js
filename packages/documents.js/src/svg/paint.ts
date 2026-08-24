import type { Color } from "document-schema.js";

// SVG paint and colour parsing: the presentation-attribute vocabulary the reader consumes (fill, stroke, stroke-width, stroke-dasharray, fill-rule, opacity). CSS-wide syntax (the style attribute, selectors, inherited CSS rules) is deliberately out of scope -- a style attribute is reported through the svg/css-style-ignored diagnostic instead of being half-parsed, because a partial CSS implementation that honours some declarations and drops others silently misrepresents the document.

// The CSS/SVG named-colour keywords (CSS Color Module Level 4's named-colour table, which SVG 2 incorporates wholesale). Keys are matched case-insensitively per CSS identifier rules; values are the sRGB 8-bit triplets normalised to the 0..1 floats ColorSchema carries.
const NAMED_COLORS: Readonly<
  Record<string, readonly [number, number, number]>
> = {
  aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215],
  aqua: [0, 255, 255],
  aquamarine: [127, 255, 212],
  azure: [240, 255, 255],
  beige: [245, 245, 220],
  bisque: [255, 228, 196],
  black: [0, 0, 0],
  blanchedalmond: [255, 235, 205],
  blue: [0, 0, 255],
  blueviolet: [138, 43, 226],
  brown: [165, 42, 42],
  burlywood: [222, 184, 135],
  cadetblue: [95, 158, 160],
  chartreuse: [127, 255, 0],
  chocolate: [210, 105, 30],
  coral: [255, 127, 80],
  cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220],
  crimson: [220, 20, 60],
  cyan: [0, 255, 255],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkgoldenrod: [184, 134, 11],
  darkgray: [169, 169, 169],
  darkgreen: [0, 100, 0],
  darkgrey: [169, 169, 169],
  darkkhaki: [189, 183, 107],
  darkmagenta: [139, 0, 139],
  darkolivegreen: [85, 107, 47],
  darkorange: [255, 140, 0],
  darkorchid: [153, 50, 204],
  darkred: [139, 0, 0],
  darksalmon: [233, 150, 122],
  darkseagreen: [143, 188, 143],
  darkslateblue: [72, 61, 139],
  darkslategray: [47, 79, 79],
  darkslategrey: [47, 79, 79],
  darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34],
  floralwhite: [255, 250, 240],
  forestgreen: [34, 139, 34],
  fuchsia: [255, 0, 255],
  gainsboro: [220, 220, 220],
  ghostwhite: [248, 248, 255],
  gold: [255, 215, 0],
  goldenrod: [218, 165, 32],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  greenyellow: [173, 255, 47],
  grey: [128, 128, 128],
  honeydew: [240, 255, 240],
  hotpink: [255, 105, 180],
  indianred: [205, 92, 92],
  indigo: [75, 0, 130],
  ivory: [255, 255, 240],
  khaki: [240, 230, 140],
  lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245],
  lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgoldenrodyellow: [250, 250, 210],
  lightgray: [211, 211, 211],
  lightgreen: [144, 238, 144],
  lightgrey: [211, 211, 211],
  lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122],
  lightseagreen: [32, 178, 170],
  lightskyblue: [135, 206, 250],
  lightslategray: [119, 136, 153],
  lightslategrey: [119, 136, 153],
  lightsteelblue: [176, 196, 222],
  lightyellow: [255, 255, 224],
  lime: [0, 255, 0],
  limegreen: [50, 205, 50],
  linen: [250, 240, 230],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  mediumaquamarine: [102, 205, 170],
  mediumblue: [0, 0, 205],
  mediumorchid: [186, 85, 211],
  mediumpurple: [147, 112, 219],
  mediumseagreen: [60, 179, 113],
  mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154],
  mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250],
  mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181],
  navajowhite: [255, 222, 173],
  navy: [0, 0, 128],
  oldlace: [253, 245, 230],
  olive: [128, 128, 0],
  olivedrab: [107, 142, 35],
  orange: [255, 165, 0],
  orangered: [255, 69, 0],
  orchid: [218, 112, 214],
  palegoldenrod: [238, 232, 170],
  palegreen: [152, 251, 152],
  paleturquoise: [175, 238, 238],
  palevioletred: [219, 112, 147],
  papayawhip: [255, 239, 213],
  peachpuff: [255, 218, 185],
  peru: [205, 133, 63],
  pink: [255, 192, 203],
  plum: [221, 160, 221],
  powderblue: [176, 224, 230],
  purple: [128, 0, 128],
  rebeccapurple: [102, 51, 153],
  red: [255, 0, 0],
  rosybrown: [188, 143, 143],
  royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19],
  salmon: [250, 128, 114],
  sandybrown: [244, 164, 96],
  seagreen: [46, 139, 87],
  seashell: [255, 245, 238],
  sienna: [160, 82, 45],
  silver: [192, 192, 192],
  skyblue: [135, 206, 235],
  slateblue: [106, 90, 205],
  slategray: [112, 128, 144],
  slategrey: [112, 128, 144],
  snow: [255, 250, 250],
  springgreen: [0, 255, 127],
  steelblue: [70, 130, 180],
  tan: [210, 180, 140],
  teal: [0, 128, 128],
  thistle: [216, 191, 216],
  tomato: [255, 99, 71],
  turquoise: [64, 224, 208],
  violet: [238, 130, 238],
  wheat: [245, 222, 179],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245],
  yellow: [255, 255, 0],
  yellowgreen: [154, 205, 50],
};

function from8Bit(r: number, g: number, b: number): Color {
  return { r: r / 255, g: g / 255, b: b / 255 };
}

// One CSS colour value: a named keyword (case-insensitive), #rgb/#rgba/#rrggbb/#rrggbbaa hexadecimal, or rgb()/rgba() in either the 0-255 or percentage form. Alpha is parsed for validity but NOT returned -- this reader models no transparency, and the reader's own opacity diagnostic is the honest channel for that limit (a colour's alpha is reported there rather than silently flattened).
const HEX_PATTERN = /^#([0-9a-fA-F]{3,8})$/;
const FUNCTION_COLOR_PATTERN = /^rgba?\(\s*([^)]*)\)$/;
const SPLIT_COMPONENTS = /[\s,]+/;

export function parseSvgColor(raw: string): Color | undefined {
  const value = raw.trim();
  const named = NAMED_COLORS[value.toLowerCase()];
  if (named !== undefined) {
    return from8Bit(named[0], named[1], named[2]);
  }
  const hex = HEX_PATTERN.exec(value);
  if (hex !== null) {
    const digits = hex[1]!;
    if (digits.length === 3 || digits.length === 4) {
      const expand = (char: string) => Number.parseInt(char + char, 16);
      return from8Bit(
        expand(digits[0]!),
        expand(digits[1]!),
        expand(digits[2]!),
      );
    }
    if (digits.length === 6 || digits.length === 8) {
      return from8Bit(
        Number.parseInt(digits.slice(0, 2), 16),
        Number.parseInt(digits.slice(2, 4), 16),
        Number.parseInt(digits.slice(4, 6), 16),
      );
    }
    return undefined;
  }
  const fn = FUNCTION_COLOR_PATTERN.exec(value);
  if (fn !== null) {
    const parts = fn[1]!
      .trim()
      .split(SPLIT_COMPONENTS)
      .filter((part) => part !== "");
    if (parts.length !== 3 && parts.length !== 4) {
      return undefined;
    }
    const channel = (part: string): number | undefined => {
      if (part.endsWith("%")) {
        const pct = Number(part.slice(0, -1));
        return Number.isFinite(pct) ? (pct / 100) * 255 : undefined;
      }
      const num = Number(part);
      return Number.isFinite(num) ? Math.min(255, Math.max(0, num)) : undefined;
    };
    const r = channel(parts[0]!);
    const g = channel(parts[1]!);
    const b = channel(parts[2]!);
    if (r === undefined || g === undefined || b === undefined) {
      return undefined;
    }
    return from8Bit(r, g, b);
  }
  return undefined;
}

// One SVG <paint> value (SVG 2, "Fill Properties"): 'none', 'currentColor', a colour, or a url(#id) reference to a paint server (gradient/pattern). The url form carries the fragment so the caller can decide what to do with it (this reader reports it as the gradient diagnostic rather than pretending it is a colour); 'inherit' is folded into the caller's inheritance walk rather than resolved here.
export type SvgPaint =
  | { readonly kind: "none" }
  | { readonly kind: "currentColor" }
  | { readonly kind: "color"; readonly color: Color }
  | { readonly kind: "url"; readonly fragment: string };

const URL_PAINT_PATTERN = /^url\(\s*['"]?#([^'")\s]*)['"]?\s*\)$/;

export function parseSvgPaint(raw: string): SvgPaint | undefined {
  const value = raw.trim();
  if (value === "none") {
    return { kind: "none" };
  }
  if (value === "currentColor") {
    return { kind: "currentColor" };
  }
  const url = URL_PAINT_PATTERN.exec(value);
  if (url !== null) {
    return { kind: "url", fragment: url[1]! };
  }
  const color = parseSvgColor(value);
  return color === undefined ? undefined : { kind: "color", color };
}

// The stroke-dasharray vocabulary reduced to the two stroke styles ContentStroke's own enum carries: a pattern whose every on-length is at most one user unit reads as 'dotted' (dot-style patterns are "0.5 1", "1 3", "0 4"...), anything else dash-shaped reads as 'dashed'. 'none' (and a malformed value) is undefined -- a solid stroke, which is also the attribute's default.
export type SvgDashStyle = "dashed" | "dotted";

export function parseSvgDashStyle(
  raw: string | undefined,
): SvgDashStyle | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim();
  if (value === "" || value === "none") {
    return undefined;
  }
  const numbers = value.split(/[\s,]+/).filter((part) => part !== "");
  if (numbers.length === 0) {
    return undefined;
  }
  const lengths = numbers.map((part) => Number(part));
  if (!lengths.every((length) => Number.isFinite(length) && length >= 0)) {
    return undefined;
  }
  return lengths.filter((_, index) => index % 2 === 0).every((on) => on <= 1)
    ? "dotted"
    : "dashed";
}
