// The read-path counterpart to fonts.ts's write-side family lookup: recovers a cleaned-up family name plus bold/italic from a /BaseFont name (optionally cross-checked against /FontDescriptor's own flags), since a PDF font dictionary carries style information in its name, not as separate structured fields the way OOXML does.

export interface FontStyleFlags {
  // /FontDescriptor /Flags bit 19 (ForceBold) and bit 7 (Italic), plus /ItalicAngle -- all optional, since not every font dictionary carries a /FontDescriptor at all (a bare standard-14 reference, for instance).
  readonly forceBold?: boolean;
  readonly italicFlag?: boolean;
  readonly italicAngle?: number;
}

export interface FontNameStyle {
  readonly baseFamily: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

// Exactly six uppercase letters followed by '+' (ISO 32000-1 9.6.4) marks a subsetted font's unique tag -- meaningless to a reader and never part of the real family name.
const SUBSET_TAG_PATTERN = /^[A-Z]{6}\+/;

// Longer, more specific suffixes are listed before the shorter suffixes they contain (BoldItalic before Bold), though the end-anchored regexes below make the order not strictly load-bearing -- "-Bold$" cannot match a string ending in "-BoldItalic".
const KNOWN_STYLE_SUFFIXES = ['BoldItalic', 'BoldOblique', 'Bold', 'Italic', 'Oblique', 'Regular'];

function stripStyleSuffix(name: string): string {
  for (const suffix of KNOWN_STYLE_SUFFIXES) {
    const commaPattern = new RegExp(`,${suffix}$`, 'i');
    const hyphenPattern = new RegExp(`-${suffix}$`, 'i');
    if (commaPattern.test(name)) {
      return name.replace(commaPattern, '');
    }
    if (hyphenPattern.test(name)) {
      return name.replace(hyphenPattern, '');
    }
  }
  return name;
}

export function styleFromBaseFontName(baseFont: string, flags?: FontStyleFlags): FontNameStyle {
  const withoutSubset = baseFont.replace(SUBSET_TAG_PATTERN, '');
  const lower = withoutSubset.toLowerCase();
  const nameBold = lower.includes('bold');
  const nameItalic = /italic|oblique/.test(lower);
  const bold = nameBold || (flags?.forceBold ?? false);
  const italic = nameItalic || (flags?.italicFlag ?? false) || (flags?.italicAngle !== undefined && flags.italicAngle !== 0);
  return { baseFamily: stripStyleSuffix(withoutSubset), bold, italic };
}
