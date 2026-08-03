// The vendored-substitute table a FontRegistry (font-registry.ts) consults as its step 4, after both a source-document face and a caller-supplied face have already failed to resolve: a small, exact-normalized-name-match table pointing a handful of common proprietary-metric-compatible-alternative families at the real, vendored, metric-compatible TrueType families this package already embeds in full (src/assets/{carlito,caladea}-*.ts -- Carlito for Calibri, Caladea for Cambria, both OFL-1.1, see assets/fonts/{carlito,caladea}/NOTICE.md).
//
// Matching is deliberately EXACT on the normalized family name, never prefix- or substring-matched: 'cambriamath' must NOT reach Caladea here, because a math run always renders through the wholly separate STIX Two Math pipeline (src/math-font.ts) regardless of whatever font family a text run around it claims -- this table has no business ever being consulted for math content, and a prefix match on 'cambria' would wrongly pull it in. Equally, 'aptosdisplay' must not inherit whatever mapping is declared for the plain 'aptos' family: they are two distinct normalized keys, and only 'aptos' itself (if ever added) would be listed.
import { normalizeFamilyName } from './fonts';

export type VendoredFamily = 'carlito' | 'caladea';

// Keyed by normalizeFamilyName(rawFamily) -- an exact match, and nothing else.
const SUBSTITUTE_FAMILY_BY_NORMALIZED_NAME: ReadonlyMap<string, VendoredFamily> = new Map([
  ['calibri', 'carlito'],
  // Carlito ships only one weight per style axis (regular/bold/italic/bolditalic) -- there is no distinct Light face to embed, so 'Calibri Light' substitutes to ordinary-weight Carlito rather than a genuinely lighter one. An honest, documented approximation, not a faithful weight match.
  ['calibrilight', 'carlito'],
  ['cambria', 'caladea'],
]);

// Looks up `rawFamily` in the vendored-substitute table by its exact normalized name. Returns `undefined` for anything not listed -- including a family that merely starts with or contains a listed name -- so a caller (font-registry.ts) never has to guard against an accidental prefix/fuzzy match itself.
export function resolveVendoredSubstituteFamily(rawFamily: string): VendoredFamily | undefined {
  return SUBSTITUTE_FAMILY_BY_NORMALIZED_NAME.get(normalizeFamilyName(rawFamily));
}
