// The read-path counterpart to fonts.ts's write-side family lookup: recovers a cleaned-up family name plus bold/italic from a /BaseFont name (optionally cross-checked against /FontDescriptor's own flags), since a PDF font dictionary carries style information in its name, not as separate structured fields the way OOXML does.

export interface FontStyleFlags {
  // /FontDescriptor /Flags bit 19 (ForceBold) and bit 7 (Italic), plus /ItalicAngle — all optional, since not every font dictionary carries a /FontDescriptor at all (a bare standard-14 reference, for instance).
  readonly forceBold?: boolean;
  readonly italicFlag?: boolean;
  readonly italicAngle?: number;
}

export interface FontNameStyle {
  readonly baseFamily: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

function stripStyleSuffix(name: string): string {
  // Longer, more specific suffixes are listed before the shorter suffixes they contain (BoldItalic before Bold), though the end-anchored regexes below make the order not strictly load-bearing — "-Bold$" cannot match a string ending in "-BoldItalic". Declared inside this function, rather than as a module-level constant, so each element is evaluated fresh on every call: a top-level array literal is built exactly once at import time, which puts every one of its entries beyond the reach of Stryker's per-test mutation switch for the rest of the process's life (see the config comment on `ignoreStatic` in ../../stryker.shared.ts for the general shape of this limitation).
  const knownStyleSuffixes = [
    "BoldItalic",
    "BoldOblique",
    "Bold",
    "Italic",
    "Oblique",
    "Regular",
  ];
  for (const suffix of knownStyleSuffixes) {
    const commaPattern = new RegExp(`,${suffix}$`, "i");
    const hyphenPattern = new RegExp(`-${suffix}$`, "i");
    if (commaPattern.test(name)) {
      return name.replace(commaPattern, "");
    }
    if (hyphenPattern.test(name)) {
      return name.replace(hyphenPattern, "");
    }
  }
  return name;
}

/**
 * A font name with any subset tag removed.
 *
 * Exactly six uppercase letters followed by '+' (ISO 32000-1 9.6.4) marks a subsetted font's unique tag, meaningless to a reader and never part of the real font name. The same tag prefixes the PostScript name inside the embedded program a producer subsetted.
 * @param fontName - a /BaseFont value or an embedded program's own PostScript name
 * @returns the name without its leading subset tag, or the name unchanged when it carries none
 */
export function withoutSubsetTag(fontName: string): string {
  // Declared here rather than as a module-level constant for the same reachability reason as knownStyleSuffixes in stripStyleSuffix above.
  const subsetTagPattern = /^[A-Z]{6}\+/;
  return fontName.replace(subsetTagPattern, "");
}

export function styleFromBaseFontName(
  baseFont: string,
  flags?: FontStyleFlags,
): FontNameStyle {
  const withoutSubset = withoutSubsetTag(baseFont);
  const lower = withoutSubset.toLowerCase();
  const nameBold = lower.includes("bold");
  const nameItalic = /italic|oblique/.test(lower);
  const bold = nameBold || (flags?.forceBold ?? false);
  const italic =
    nameItalic ||
    (flags?.italicFlag ?? false) ||
    (flags?.italicAngle !== undefined && flags.italicAngle !== 0);
  return { baseFamily: stripStyleSuffix(withoutSubset), bold, italic };
}
