import type { Color } from "document-schema.js";

// SVG paint and colour parsing: the presentation-attribute vocabulary the reader consumes (fill, stroke, stroke-width, stroke-dasharray, fill-rule, opacity). CSS-wide syntax (the style attribute, selectors, inherited CSS rules) is deliberately out of scope — a style attribute is reported through the svg/css-style-ignored diagnostic instead of being half-parsed, because a partial CSS implementation that honours some declarations and drops others silently misrepresents the document.

// The CSS/SVG named-colour keywords (CSS Color Module Level 4's named-colour table, which SVG 2 incorporates wholesale), one CSS hex triplet per name, matching each keyword's own canonical hex notation in the spec. Keys are matched case-insensitively per CSS identifier rules.
const NAMED_COLOR_HEX: Readonly<Record<string, string>> = {
  aliceblue: "#f0f8ff",
  antiquewhite: "#faebd7",
  aqua: "#00ffff",
  aquamarine: "#7fffd4",
  azure: "#f0ffff",
  beige: "#f5f5dc",
  bisque: "#ffe4c4",
  black: "#000000",
  blanchedalmond: "#ffebcd",
  blue: "#0000ff",
  blueviolet: "#8a2be2",
  brown: "#a52a2a",
  burlywood: "#deb887",
  cadetblue: "#5f9ea0",
  chartreuse: "#7fff00",
  chocolate: "#d2691e",
  coral: "#ff7f50",
  cornflowerblue: "#6495ed",
  cornsilk: "#fff8dc",
  crimson: "#dc143c",
  cyan: "#00ffff",
  darkblue: "#00008b",
  darkcyan: "#008b8b",
  darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9",
  darkgreen: "#006400",
  darkgrey: "#a9a9a9",
  darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b",
  darkolivegreen: "#556b2f",
  darkorange: "#ff8c00",
  darkorchid: "#9932cc",
  darkred: "#8b0000",
  darksalmon: "#e9967a",
  darkseagreen: "#8fbc8f",
  darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
  darkturquoise: "#00ced1",
  darkviolet: "#9400d3",
  deeppink: "#ff1493",
  deepskyblue: "#00bfff",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1e90ff",
  firebrick: "#b22222",
  floralwhite: "#fffaf0",
  forestgreen: "#228b22",
  fuchsia: "#ff00ff",
  gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff",
  gold: "#ffd700",
  goldenrod: "#daa520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#adff2f",
  grey: "#808080",
  honeydew: "#f0fff0",
  hotpink: "#ff69b4",
  indianred: "#cd5c5c",
  indigo: "#4b0082",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  lavender: "#e6e6fa",
  lavenderblush: "#fff0f5",
  lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd",
  lightblue: "#add8e6",
  lightcoral: "#f08080",
  lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2",
  lightgray: "#d3d3d3",
  lightgreen: "#90ee90",
  lightgrey: "#d3d3d3",
  lightpink: "#ffb6c1",
  lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#b0c4de",
  lightyellow: "#ffffe0",
  lime: "#00ff00",
  limegreen: "#32cd32",
  linen: "#faf0e6",
  magenta: "#ff00ff",
  maroon: "#800000",
  mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd",
  mediumorchid: "#ba55d3",
  mediumpurple: "#9370db",
  mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee",
  mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585",
  midnightblue: "#191970",
  mintcream: "#f5fffa",
  mistyrose: "#ffe4e1",
  moccasin: "#ffe4b5",
  navajowhite: "#ffdead",
  navy: "#000080",
  oldlace: "#fdf5e6",
  olive: "#808000",
  olivedrab: "#6b8e23",
  orange: "#ffa500",
  orangered: "#ff4500",
  orchid: "#da70d6",
  palegoldenrod: "#eee8aa",
  palegreen: "#98fb98",
  paleturquoise: "#afeeee",
  palevioletred: "#db7093",
  papayawhip: "#ffefd5",
  peachpuff: "#ffdab9",
  peru: "#cd853f",
  pink: "#ffc0cb",
  plum: "#dda0dd",
  powderblue: "#b0e0e6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#ff0000",
  rosybrown: "#bc8f8f",
  royalblue: "#4169e1",
  saddlebrown: "#8b4513",
  salmon: "#fa8072",
  sandybrown: "#f4a460",
  seagreen: "#2e8b57",
  seashell: "#fff5ee",
  sienna: "#a0522d",
  silver: "#c0c0c0",
  skyblue: "#87ceeb",
  slateblue: "#6a5acd",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#fffafa",
  springgreen: "#00ff7f",
  steelblue: "#4682b4",
  tan: "#d2b48c",
  teal: "#008080",
  thistle: "#d8bfd8",
  tomato: "#ff6347",
  turquoise: "#40e0d0",
  violet: "#ee82ee",
  wheat: "#f5deb3",
  white: "#ffffff",
  whitesmoke: "#f5f5f5",
  yellow: "#ffff00",
  yellowgreen: "#9acd32",
};

// Offsets of each channel's end within a "#rrggbb" string (the leading '#' occupies index 0).
const HEX_RED_END = 3;
const HEX_GREEN_END = 5;
const HEX_BLUE_END = 7;

// Parses a "#rrggbb" hex triplet (as every NAMED_COLOR_HEX value is written) into its 8-bit channels. Not the general hex-colour parser: parseSvgColor's own HEX_PATTERN handles the full #rgb/#rgba/#rrggbb/#rrggbbaa surface a document can write. This only decodes the fixed, always-6-digit form this module generates for itself.
function hexTriplet(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, HEX_RED_END), 16),
    Number.parseInt(hex.slice(HEX_RED_END, HEX_GREEN_END), 16),
    Number.parseInt(hex.slice(HEX_GREEN_END, HEX_BLUE_END), 16),
  ];
}

const NAMED_COLORS: Readonly<
  Record<string, readonly [number, number, number]>
> = Object.fromEntries(
  Object.entries(NAMED_COLOR_HEX).map(([name, hex]) => [name, hexTriplet(hex)]),
);

// The maximum value of a single sRGB channel expressed as an 8-bit integer (0-255), as both a hex-pair and an rgb()-function colour value carries it.
const EIGHT_BIT_CHANNEL_MAX = 255;

function from8Bit(r: number, g: number, b: number): Color {
  return {
    r: r / EIGHT_BIT_CHANNEL_MAX,
    g: g / EIGHT_BIT_CHANNEL_MAX,
    b: b / EIGHT_BIT_CHANNEL_MAX,
  };
}

// One CSS colour value: a named keyword (case-insensitive), #rgb/#rgba/#rrggbb/#rrggbbaa hexadecimal, or rgb()/rgba() in either the 0-255 or percentage form. Alpha is parsed for validity but NOT returned — this reader models no transparency, and the reader's own opacity diagnostic is the honest channel for that limit (a colour's alpha is reported there rather than silently flattened).
const HEX_PATTERN = /^#([0-9a-fA-F]{3,8})$/;
const FUNCTION_COLOR_PATTERN = /^rgba?\(\s*([^)]*)\)$/;
const SPLIT_COMPONENTS = /[\s,]+/;

// #rgb/#rgba and #rrggbb/#rrggbbaa digit counts (the leading '#' is not part of `digits`).
const SHORT_HEX_DIGIT_COUNT = 3;
const SHORT_HEX_ALPHA_DIGIT_COUNT = 4;
const LONG_HEX_DIGIT_COUNT = 6;
const LONG_HEX_ALPHA_DIGIT_COUNT = 8;
const LONG_HEX_GREEN_END = 4;

// rgb()/rgba() function-form argument counts, and the scale a percentage channel (e.g. "50%") is expressed against before converting to an 8-bit value.
const RGB_COMPONENT_COUNT = 3;
const RGBA_COMPONENT_COUNT = 4;
const PERCENT_SCALE = 100;

export function parseSvgColor(raw: string): Color | undefined {
  const value = raw.trim();
  const named = NAMED_COLORS[value.toLowerCase()];
  if (named !== undefined) {
    return from8Bit(named[0], named[1], named[2]);
  }
  const hex = HEX_PATTERN.exec(value);
  if (hex !== null) {
    const digits = hex[1]!;
    if (
      digits.length === SHORT_HEX_DIGIT_COUNT ||
      digits.length === SHORT_HEX_ALPHA_DIGIT_COUNT
    ) {
      const expand = (char: string) => Number.parseInt(char + char, 16);
      return from8Bit(
        expand(digits[0]!),
        expand(digits[1]!),
        expand(digits[2]!),
      );
    }
    if (
      digits.length === LONG_HEX_DIGIT_COUNT ||
      digits.length === LONG_HEX_ALPHA_DIGIT_COUNT
    ) {
      return from8Bit(
        Number.parseInt(digits.slice(0, 2), 16),
        Number.parseInt(digits.slice(2, LONG_HEX_GREEN_END), 16),
        Number.parseInt(
          digits.slice(LONG_HEX_GREEN_END, LONG_HEX_DIGIT_COUNT),
          16,
        ),
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
    if (
      parts.length !== RGB_COMPONENT_COUNT &&
      parts.length !== RGBA_COMPONENT_COUNT
    ) {
      return undefined;
    }
    const channel = (part: string): number | undefined => {
      if (part.endsWith("%")) {
        const pct = Number(part.slice(0, -1));
        return Number.isFinite(pct)
          ? (pct / PERCENT_SCALE) * EIGHT_BIT_CHANNEL_MAX
          : undefined;
      }
      const num = Number(part);
      return Number.isFinite(num)
        ? Math.min(EIGHT_BIT_CHANNEL_MAX, Math.max(0, num))
        : undefined;
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

// The stroke-dasharray vocabulary reduced to the two stroke styles ContentStroke's own enum carries: a pattern whose every on-length is at most one user unit reads as 'dotted' (dot-style patterns are "0.5 1", "1 3", "0 4"...), anything else dash-shaped reads as 'dashed'. 'none' (and a malformed value) is undefined — a solid stroke, which is also the attribute's default.
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
