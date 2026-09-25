// Generated from Unicode's own UnicodeData.txt (https://www.unicode.org/Public/UCD/latest/ucd/UnicodeData.txt) by cross-referencing every "MATHEMATICAL <STYLE> CAPITAL/SMALL <LETTER>" codepoint name in the Mathematical Alphanumeric Symbols block (U+1D400-U+1D7FF), then filling the block's own well-known holes (italic small h, and eleven Script/Fraktur/Double-struck capitals plus three Script smalls) with the older Letterlike Symbols block's own matching codepoints (U+2100-U+214F, e.g. PLANCK CONSTANT for italic small h) by cross-referencing THEIR names the same way. Every mapping below was verified against the authoritative Unicode data file, not transcribed from memory; the exact 24 hole substitutions are the ones this module's own generation script hard-codes. The six Greek "symbol variant" base characters (GREEK LUNATE EPSILON SYMBOL U+03F5, GREEK THETA SYMBOL U+03D1, GREEK KAPPA SYMBOL U+03F0, GREEK PHI SYMBOL U+03D5, GREEK RHO SYMBOL U+03F1, GREEK PI SYMBOL U+03D6) and their five styled Mathematical Alphanumeric Symbols forms (bold, italic, bold-italic, bold-sans-serif, sans-serif-bold-italic — the same five variants the rest of the Greek table covers, since Unicode never assigned symbol-variant glyphs for plain sans-serif, script, fraktur, or double-struck) were verified the identical way: downloading UnicodeData.txt directly and reading the "MATHEMATICAL <STYLE> <NAME> SYMBOL" entries at U+1D6DC-U+1D6E1 (bold), U+1D716-U+1D71B (italic), U+1D750-U+1D755 (bold-italic), U+1D78A-U+1D78F (bold-sans-serif), and U+1D7C4-U+1D7C9 (sans-serif-bold-italic) — each range confirmed to contain exactly EPSILON/THETA/KAPPA/PHI/RHO/PI SYMBOL in that order, immediately following that style's own "partial differential" codepoint and immediately preceding the next style's capital-alpha codepoint (or, for sans-serif-bold-italic, MATHEMATICAL BOLD CAPITAL/SMALL DIGAMMA at U+1D7CA-U+1D7CB followed by two genuinely unassigned codepoints at U+1D7CC-U+1D7CD).

export type MathVariant =
  | "normal"
  | "bold"
  | "italic"
  | "bold-italic"
  | "double-struck"
  | "bold-fraktur"
  | "script"
  | "bold-script"
  | "fraktur"
  | "sans-serif"
  | "bold-sans-serif"
  | "sans-serif-italic"
  | "sans-serif-bold-italic"
  | "monospace";

// Every table below is generated from a single base codepoint per variant rather than listed literal by literal: within the Mathematical Alphanumeric Symbols block each variant's uppercase run, lowercase run, and (for Greek) trailing symbols occupy one unbroken sequence of codepoints, so the sequence is computed from its first codepoint plus the block's own well-known holes, not transcribed.
const LATIN_CASE_LETTER_COUNT = 26; // A-Z or a-z
const GREEK_LETTER_COUNT = 24; // Alpha..Omega, the reserved final-sigma slot counted as a gap rather than a 25th letter
// Position, within a 24-letter Greek run, of the codepoint immediately after Rho that Unicode leaves unassigned (there is no capital "final sigma", mirroring the ordinary Greek alphabet's own reserved slot). Every Greek run this module builds, styled or plain, carries the identical gap here.
const GREEK_SIGMA_GAP_INDEX = 17;
const GREEK_SYMBOL_VARIANT_COUNT = 6; // lunate epsilon, theta, kappa, phi, rho, pi symbol variants; see this module's own header comment
const DIGIT_COUNT = 10; // 0-9

// Builds `count` consecutive Unicode codepoints starting at `base`.
function consecutiveCodepoints(base: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => base + index);
}

// Applies `holes` (array index -> replacement codepoint) on top of a consecutive run, for the handful of Mathematical Alphanumeric Symbols slots Unicode left unassigned and re-pointed at an older, pre-existing Letterlike Symbols codepoint instead (see this module's own header comment for the exact substitutions and their citation).
function withHoles(
  codepoints: readonly number[],
  holes: Readonly<Record<number, number>>,
): number[] {
  const result = [...codepoints];
  for (const [index, replacement] of Object.entries(holes)) {
    result[Number(index)] = replacement;
  }
  return result;
}

// Builds a 24-codepoint Greek letter run starting at `base`, skipping the one reserved codepoint at GREEK_SIGMA_GAP_INDEX. Shared by the plain Greek base tables and every styled Mathematical Alphanumeric Symbols Greek variant, since Unicode preserves the same positional gap in both.
function greekAlphabetRun(base: number, count: number): number[] {
  const result: number[] = [];
  let codePoint = base;
  for (let index = 0; index < count; index++) {
    if (index === GREEK_SIGMA_GAP_INDEX) {
      codePoint += 1;
    }
    result.push(codePoint);
    codePoint += 1;
  }
  return result;
}

// Builds a variant's [uppercase, lowercase] Latin pair from its uppercase run's own first codepoint: the lowercase run always begins exactly LATIN_CASE_LETTER_COUNT codepoints after the uppercase run's start, immediately following it in the block.
function latinPair(
  upperBase: number,
  upperHoles?: Readonly<Record<number, number>>,
  lowerHoles?: Readonly<Record<number, number>>,
): readonly [readonly number[], readonly number[]] {
  const lowerBase = upperBase + LATIN_CASE_LETTER_COUNT;
  const upper = consecutiveCodepoints(upperBase, LATIN_CASE_LETTER_COUNT);
  const lower = consecutiveCodepoints(lowerBase, LATIN_CASE_LETTER_COUNT);
  return [
    upperHoles === undefined ? upper : withHoles(upper, upperHoles),
    lowerHoles === undefined ? lower : withHoles(lower, lowerHoles),
  ];
}

// Each variant's uppercase run start within the Mathematical Alphanumeric Symbols block (U+1D400-U+1D7FF); see this module's own header comment for how every value here was cross-checked against UnicodeData.txt.
const MATH_BOLD_UPPER_BASE = 0x1d400;
const MATH_ITALIC_UPPER_BASE = 0x1d434;
const MATH_BOLD_ITALIC_UPPER_BASE = 0x1d468;
const MATH_SCRIPT_UPPER_BASE = 0x1d49c;
const MATH_BOLD_SCRIPT_UPPER_BASE = 0x1d4d0;
const MATH_FRAKTUR_UPPER_BASE = 0x1d504;
const MATH_DOUBLE_STRUCK_UPPER_BASE = 0x1d538;
const MATH_BOLD_FRAKTUR_UPPER_BASE = 0x1d56c;
const MATH_SANS_SERIF_UPPER_BASE = 0x1d5a0;
const MATH_BOLD_SANS_SERIF_UPPER_BASE = 0x1d5d4;
const MATH_SANS_SERIF_ITALIC_UPPER_BASE = 0x1d608;
const MATH_SANS_SERIF_BOLD_ITALIC_UPPER_BASE = 0x1d63c;
const MATH_MONOSPACE_UPPER_BASE = 0x1d670;

// variant -> [26 uppercase codepoints A-Z, 26 lowercase codepoints a-z]. 'normal' is deliberately absent (mathvariant='normal' — or no mathvariant at all — always means the plain ASCII letter itself, never a Mathematical Alphanumeric Symbols codepoint).
const LATIN_VARIANTS: Partial<
  Record<MathVariant, readonly [readonly number[], readonly number[]]>
> = {
  bold: latinPair(MATH_BOLD_UPPER_BASE),
  italic: latinPair(
    MATH_ITALIC_UPPER_BASE,
    undefined,
    { 7: 0x210e }, // italic small h -> PLANCK CONSTANT
  ),
  "bold-italic": latinPair(MATH_BOLD_ITALIC_UPPER_BASE),
  script: latinPair(
    MATH_SCRIPT_UPPER_BASE,
    {
      1: 0x212c, // SCRIPT CAPITAL B
      4: 0x2130, // SCRIPT CAPITAL E
      5: 0x2131, // SCRIPT CAPITAL F
      7: 0x210b, // SCRIPT CAPITAL H
      8: 0x2110, // SCRIPT CAPITAL I
      11: 0x2112, // SCRIPT CAPITAL L
      12: 0x2133, // SCRIPT CAPITAL M
      17: 0x211b, // SCRIPT CAPITAL R
    },
    {
      4: 0x212f, // SCRIPT SMALL E
      6: 0x210a, // SCRIPT SMALL G
      14: 0x2134, // SCRIPT SMALL O
    },
  ),
  "bold-script": latinPair(MATH_BOLD_SCRIPT_UPPER_BASE),
  fraktur: latinPair(MATH_FRAKTUR_UPPER_BASE, {
    2: 0x212d, // BLACK-LETTER CAPITAL C
    7: 0x210c, // BLACK-LETTER CAPITAL H
    8: 0x2111, // BLACK-LETTER CAPITAL I
    17: 0x211c, // BLACK-LETTER CAPITAL R
    25: 0x2128, // BLACK-LETTER CAPITAL Z
  }),
  "double-struck": latinPair(MATH_DOUBLE_STRUCK_UPPER_BASE, {
    2: 0x2102, // DOUBLE-STRUCK CAPITAL C
    7: 0x210d, // DOUBLE-STRUCK CAPITAL H
    13: 0x2115, // DOUBLE-STRUCK CAPITAL N
    15: 0x2119, // DOUBLE-STRUCK CAPITAL P
    16: 0x211a, // DOUBLE-STRUCK CAPITAL Q
    17: 0x211d, // DOUBLE-STRUCK CAPITAL R
    25: 0x2124, // DOUBLE-STRUCK CAPITAL Z
  }),
  "bold-fraktur": latinPair(MATH_BOLD_FRAKTUR_UPPER_BASE),
  "sans-serif": latinPair(MATH_SANS_SERIF_UPPER_BASE),
  "bold-sans-serif": latinPair(MATH_BOLD_SANS_SERIF_UPPER_BASE),
  "sans-serif-italic": latinPair(MATH_SANS_SERIF_ITALIC_UPPER_BASE),
  "sans-serif-bold-italic": latinPair(MATH_SANS_SERIF_BOLD_ITALIC_UPPER_BASE),
  monospace: latinPair(MATH_MONOSPACE_UPPER_BASE),
};

interface GreekVariantEntry {
  readonly upper: readonly number[]; // index-aligned with GREEK_UPPER_BASE
  readonly lower: readonly number[]; // index-aligned with GREEK_LOWER_BASE
  readonly nabla: number;
  readonly partial: number;
  // The five OpenType/Unicode Greek "symbol variant" glyphs Unicode actually styled in this block — lunate epsilon (U+03F5), theta (U+03D1), kappa (U+03F0), phi (U+03D5), rho (U+03F1), and pi (U+03D6) symbols. Every one of the five variants below carries all six; Unicode never assigned styled symbol-variant glyphs for the other Greek-bearing variants (plain sans-serif, script, fraktur, double-struck all lack a Greek table entirely, so the question doesn't arise for them).
  readonly epsilon: number;
  readonly theta: number;
  readonly kappa: number;
  readonly phi: number;
  readonly rho: number;
  readonly pi: number;
}

// Builds a variant's full GreekVariantEntry from its uppercase run's own first codepoint. Within each variant's Greek block, the uppercase run (GREEK_LETTER_COUNT codepoints, sigma-gapped) is followed immediately by nabla; the lowercase run starts LATIN_CASE_LETTER_COUNT codepoints after the uppercase run's start (matching the Latin blocks' own case spacing) and is itself followed immediately by partial differential; and the six symbol-variant glyphs (epsilon, theta, kappa, phi, rho, pi, in that fixed order) run consecutively right after partial differential.
function greekVariantEntry(upperBase: number): GreekVariantEntry {
  const upper = greekAlphabetRun(upperBase, GREEK_LETTER_COUNT);
  const nabla = upperBase + GREEK_LETTER_COUNT + 1;
  const lowerBase = upperBase + LATIN_CASE_LETTER_COUNT;
  const lower = greekAlphabetRun(lowerBase, GREEK_LETTER_COUNT);
  const partial = lowerBase + GREEK_LETTER_COUNT + 1;
  const [epsilon, theta, kappa, phi, rho, pi] = consecutiveCodepoints(
    partial + 1,
    GREEK_SYMBOL_VARIANT_COUNT,
  ) as [number, number, number, number, number, number];
  return { upper, lower, nabla, partial, epsilon, theta, kappa, phi, rho, pi };
}

// Each variant's Greek uppercase run start; see greekVariantEntry's own comment for how the rest of that variant's entry (lowercase run, nabla, partial differential, symbol variants) is derived from this one codepoint.
const MATH_GREEK_BOLD_UPPER_BASE = 0x1d6a8;
const MATH_GREEK_ITALIC_UPPER_BASE = 0x1d6e2;
const MATH_GREEK_BOLD_ITALIC_UPPER_BASE = 0x1d71c;
const MATH_GREEK_BOLD_SANS_SERIF_UPPER_BASE = 0x1d756;
const MATH_GREEK_SANS_SERIF_BOLD_ITALIC_UPPER_BASE = 0x1d790;

// variant -> Greek uppercase/lowercase codepoints, nabla (U+2207), partial differential (U+2202), and the six Greek "symbol variant" codepoints (lunate epsilon/theta/kappa/phi/rho/pi symbols) — every one confirmed against UnicodeData.txt directly (see this module's own top-of-file generation note for the exact ranges and cross-check).
const GREEK_VARIANTS: Partial<Record<MathVariant, GreekVariantEntry>> = {
  bold: greekVariantEntry(MATH_GREEK_BOLD_UPPER_BASE),
  italic: greekVariantEntry(MATH_GREEK_ITALIC_UPPER_BASE),
  "bold-italic": greekVariantEntry(MATH_GREEK_BOLD_ITALIC_UPPER_BASE),
  "bold-sans-serif": greekVariantEntry(MATH_GREEK_BOLD_SANS_SERIF_UPPER_BASE),
  "sans-serif-bold-italic": greekVariantEntry(
    MATH_GREEK_SANS_SERIF_BOLD_ITALIC_UPPER_BASE,
  ),
};

const GREEK_LUNATE_EPSILON_SYMBOL = 0x3f5;
const GREEK_THETA_SYMBOL = 0x3d1;
const GREEK_KAPPA_SYMBOL = 0x3f0;
const GREEK_PHI_SYMBOL = 0x3d5;
const GREEK_RHO_SYMBOL = 0x3f1;
const GREEK_PI_SYMBOL = 0x3d6;

// Base Greek "symbol variant" codepoints -> the GreekVariantEntry field carrying their styled Mathematical Alphanumeric Symbols form. GREEK LUNATE EPSILON SYMBOL (U+03F5), GREEK THETA SYMBOL (U+03D1), GREEK KAPPA SYMBOL (U+03F0), GREEK PHI SYMBOL (U+03D5), GREEK RHO SYMBOL (U+03F1), GREEK PI SYMBOL (U+03D6) — confirmed against UnicodeData.txt's own character names, not the ordinary (non-symbol) Greek letters GREEK_UPPER_BASE/GREEK_LOWER_BASE already cover.
const GREEK_SYMBOL_BASES: ReadonlyMap<
  number,
  keyof Pick<
    GreekVariantEntry,
    "epsilon" | "theta" | "kappa" | "phi" | "rho" | "pi"
  >
> = new Map([
  [GREEK_LUNATE_EPSILON_SYMBOL, "epsilon"],
  [GREEK_THETA_SYMBOL, "theta"],
  [GREEK_KAPPA_SYMBOL, "kappa"],
  [GREEK_PHI_SYMBOL, "phi"],
  [GREEK_RHO_SYMBOL, "rho"],
  [GREEK_PI_SYMBOL, "pi"],
]);

const GREEK_CAPITAL_ALPHA = 0x391;
const GREEK_SMALL_ALPHA = 0x3b1;

const GREEK_UPPER_BASE: readonly number[] = greekAlphabetRun(
  GREEK_CAPITAL_ALPHA,
  GREEK_LETTER_COUNT,
);
const GREEK_LOWER_BASE: readonly number[] = greekAlphabetRun(
  GREEK_SMALL_ALPHA,
  GREEK_LETTER_COUNT,
);

const MATH_BOLD_DIGIT_BASE = 0x1d7ce;
const MATH_DOUBLE_STRUCK_DIGIT_BASE = 0x1d7d8;
const MATH_SANS_SERIF_DIGIT_BASE = 0x1d7e2;
const MATH_BOLD_SANS_SERIF_DIGIT_BASE = 0x1d7ec;
const MATH_MONOSPACE_DIGIT_BASE = 0x1d7f6;

// variant -> [10 digit codepoints 0-9]. No 'italic' entry: Unicode defines no distinct math-italic digit codepoints (MathML mathvariant='italic' on <mn> has no glyph to map to), so italic digits fall back to the plain ASCII digit like 'normal' does — the same "no mapping -> use the base character" rule this module applies uniformly.
const DIGIT_VARIANTS: Partial<Record<MathVariant, readonly number[]>> = {
  bold: consecutiveCodepoints(MATH_BOLD_DIGIT_BASE, DIGIT_COUNT),
  "double-struck": consecutiveCodepoints(
    MATH_DOUBLE_STRUCK_DIGIT_BASE,
    DIGIT_COUNT,
  ),
  "sans-serif": consecutiveCodepoints(MATH_SANS_SERIF_DIGIT_BASE, DIGIT_COUNT),
  "bold-sans-serif": consecutiveCodepoints(
    MATH_BOLD_SANS_SERIF_DIGIT_BASE,
    DIGIT_COUNT,
  ),
  monospace: consecutiveCodepoints(MATH_MONOSPACE_DIGIT_BASE, DIGIT_COUNT),
};

const LATIN_UPPER_A = 0x41;
const LATIN_UPPER_Z = 0x5a;
const LATIN_LOWER_A = 0x61;
const LATIN_LOWER_Z = 0x7a;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;
const NABLA = 0x2207;
const PARTIAL_DIFFERENTIAL = 0x2202;

// Maps one code point through `variant`, returning the Mathematical Alphanumeric Symbols (or Letterlike Symbols hole-filler) codepoint when one exists for this exact (variant, character) pair, or `codePoint` itself unchanged otherwise — covering three genuinely different "no mapping" cases identically: variant is 'normal', variant has no table for this character class at all (e.g. 'double-struck' has no Greek table), or this specific character isn't a Latin letter/digit/Greek letter/nabla/partial (punctuation, an operator, an already-styled symbol) and mathvariant simply never applies to it. Never throws: an unmappable input is not a formula-layout error, it is MathML's own documented fallback behaviour — render the base glyph, unstyled.
export function mapMathVariant(
  codePoint: number,
  variant: MathVariant,
): number {
  if (variant === "normal") {
    return codePoint;
  }

  if (codePoint >= LATIN_UPPER_A && codePoint <= LATIN_UPPER_Z) {
    return LATIN_VARIANTS[variant]?.[0][codePoint - LATIN_UPPER_A] ?? codePoint;
  }
  if (codePoint >= LATIN_LOWER_A && codePoint <= LATIN_LOWER_Z) {
    return LATIN_VARIANTS[variant]?.[1][codePoint - LATIN_LOWER_A] ?? codePoint;
  }
  if (codePoint >= DIGIT_ZERO && codePoint <= DIGIT_NINE) {
    return DIGIT_VARIANTS[variant]?.[codePoint - DIGIT_ZERO] ?? codePoint;
  }

  const greekUpperIndex = GREEK_UPPER_BASE.indexOf(codePoint);
  if (greekUpperIndex !== -1) {
    return GREEK_VARIANTS[variant]?.upper[greekUpperIndex] ?? codePoint;
  }
  const greekLowerIndex = GREEK_LOWER_BASE.indexOf(codePoint);
  if (greekLowerIndex !== -1) {
    return GREEK_VARIANTS[variant]?.lower[greekLowerIndex] ?? codePoint;
  }
  if (codePoint === NABLA) {
    return GREEK_VARIANTS[variant]?.nabla ?? codePoint;
  }
  if (codePoint === PARTIAL_DIFFERENTIAL) {
    return GREEK_VARIANTS[variant]?.partial ?? codePoint;
  }

  const symbolField = GREEK_SYMBOL_BASES.get(codePoint);
  if (symbolField !== undefined) {
    const entry = GREEK_VARIANTS[variant];
    return entry === undefined ? codePoint : entry[symbolField];
  }

  return codePoint;
}

// Applies mapMathVariant to every code point in `text`, iterated by Unicode code point rather than UTF-16 code unit — the target codepoints live in the supplementary Mathematical Alphanumeric Symbols plane, so a naive per-code-unit loop would split their surrogate pairs.
export function applyMathVariant(text: string, variant: MathVariant): string {
  if (variant === "normal") {
    return text;
  }
  let out = "";
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    out +=
      codePoint === undefined
        ? ch
        : String.fromCodePoint(mapMathVariant(codePoint, variant));
  }
  return out;
}

// The MathML mathvariant attribute's own string values, mapped to this module's MathVariant union — 'bold-sans-serif' etc. are MathML3's actual spelling (https://www.w3.org/TR/MathML3/chapter3.html#presm.mathvariant), reused verbatim as this module's own type where the spelling already matches.
const MATHVARIANT_ATTRIBUTE_VALUES: ReadonlySet<string> = new Set<MathVariant>([
  "normal",
  "bold",
  "italic",
  "bold-italic",
  "double-struck",
  "bold-fraktur",
  "script",
  "bold-script",
  "fraktur",
  "sans-serif",
  "bold-sans-serif",
  "sans-serif-italic",
  "sans-serif-bold-italic",
  "monospace",
]);

export function isMathVariant(value: string): value is MathVariant {
  return MATHVARIANT_ATTRIBUTE_VALUES.has(value);
}
