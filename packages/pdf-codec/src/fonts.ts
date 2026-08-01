import type { StandardFontName } from './afm-widths';

type StandardFamily = 'helvetica' | 'times' | 'courier';

// Every family name maps to one of the three standard-14 proportional/monospace families. Word's current default body font is Aptos (2024-), which replaced Calibri -- both map to Helvetica, along with every other mainstream UI/sans-serif family. This table is shared by both the docx and pptx write paths (src/layout/engine.ts and src/layout/slides.ts).
const FAMILY_BY_NORMALIZED_NAME: ReadonlyMap<string, StandardFamily> = new Map([
  // Sans-serif -> Helvetica
  ['helvetica', 'helvetica'],
  ['helveticaneue', 'helvetica'],
  ['arial', 'helvetica'],
  ['arialnarrow', 'helvetica'],
  ['arialblack', 'helvetica'],
  ['calibri', 'helvetica'],
  ['aptos', 'helvetica'],
  ['aptosdisplay', 'helvetica'],
  ['segoeui', 'helvetica'],
  ['tahoma', 'helvetica'],
  ['verdana', 'helvetica'],
  ['trebuchetms', 'helvetica'],
  ['centurygothic', 'helvetica'],
  ['franklingothicbook', 'helvetica'],
  ['gillsans', 'helvetica'],
  ['futura', 'helvetica'],
  ['roboto', 'helvetica'],
  ['opensans', 'helvetica'],
  ['lato', 'helvetica'],
  ['montserrat', 'helvetica'],
  ['poppins', 'helvetica'],
  ['inter', 'helvetica'],
  ['notosans', 'helvetica'],
  ['dejavusans', 'helvetica'],
  ['sourcesanspro', 'helvetica'],
  ['sansserif', 'helvetica'],
  ['liberationsans', 'helvetica'],
  ['nimbussans', 'helvetica'],
  // Serif -> Times-Roman
  ['times', 'times'],
  ['timesnewroman', 'times'],
  ['liberationserif', 'times'],
  ['nimbusroman', 'times'],
  ['georgia', 'times'],
  ['cambria', 'times'],
  ['constantia', 'times'],
  ['garamond', 'times'],
  ['bookantiqua', 'times'],
  ['palatino', 'times'],
  ['palatinolinotype', 'times'],
  ['bookmanoldstyle', 'times'],
  ['century', 'times'],
  ['centuryschoolbook', 'times'],
  ['minionpro', 'times'],
  ['merriweather', 'times'],
  ['notoserif', 'times'],
  ['dejavuserif', 'times'],
  ['serif', 'times'],
  // Monospace -> Courier
  ['courier', 'courier'],
  ['couriernew', 'courier'],
  ['liberationmono', 'courier'],
  ['nimbusmono', 'courier'],
  ['consolas', 'courier'],
  ['monaco', 'courier'],
  ['menlo', 'courier'],
  ['lucidaconsole', 'courier'],
  ['andalemono', 'courier'],
  ['cascadiacode', 'courier'],
  ['cascadiamono', 'courier'],
  ['sfmono', 'courier'],
  ['jetbrainsmono', 'courier'],
  ['firacode', 'courier'],
  ['sourcecodepro', 'courier'],
  ['notosansmono', 'courier'],
  ['dejavusansmono', 'courier'],
  ['monospace', 'courier'],
]);

const DEFAULT_FAMILY: StandardFamily = 'helvetica';

function normalizeFamilyName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface FontFamilyResolution {
  readonly family: StandardFamily;
  // False when the name matched nothing (including the includes('mono')/includes('serif') heuristics) and fell all the way back to the default -- callers can use this to raise a font-substitution diagnostic.
  readonly matched: boolean;
}

export function resolveFontFamily(rawFamily: string): FontFamilyResolution {
  const normalized = normalizeFamilyName(rawFamily);
  const exact = FAMILY_BY_NORMALIZED_NAME.get(normalized);
  if (exact !== undefined) {
    return { family: exact, matched: true };
  }
  if (normalized.includes('mono')) {
    return { family: 'courier', matched: true };
  }
  if (normalized.includes('serif') && !normalized.includes('sansserif')) {
    return { family: 'times', matched: true };
  }
  return { family: DEFAULT_FAMILY, matched: false };
}

interface FamilyVariants {
  readonly regular: StandardFontName;
  readonly bold: StandardFontName;
  readonly italic: StandardFontName;
  readonly boldItalic: StandardFontName;
}

// Times uses "Italic" where Helvetica and Courier use "Oblique" -- a real asymmetry in the standard 14's own naming, not an inconsistency in this table.
const VARIANTS: Readonly<Record<StandardFamily, FamilyVariants>> = {
  helvetica: {
    regular: 'Helvetica',
    bold: 'Helvetica-Bold',
    italic: 'Helvetica-Oblique',
    boldItalic: 'Helvetica-BoldOblique',
  },
  times: {
    regular: 'Times-Roman',
    bold: 'Times-Bold',
    italic: 'Times-Italic',
    boldItalic: 'Times-BoldItalic',
  },
  courier: {
    regular: 'Courier',
    bold: 'Courier-Bold',
    italic: 'Courier-Oblique',
    boldItalic: 'Courier-BoldOblique',
  },
};

export interface ResolvedFont {
  readonly standardName: StandardFontName;
  readonly matched: boolean;
}

export function resolveStandardFont(family: string, bold: boolean, italic: boolean): ResolvedFont {
  const { family: standardFamily, matched } = resolveFontFamily(family);
  const variants = VARIANTS[standardFamily];
  const standardName = bold && italic ? variants.boldItalic : bold ? variants.bold : italic ? variants.italic : variants.regular;
  return { standardName, matched };
}
