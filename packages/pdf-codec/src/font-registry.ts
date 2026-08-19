// A swappable font-resolution port sitting in front of resolveStandardFont (fonts.ts): where that function always maps a requested family straight onto one of the 14 standard PDF faces, a FontRegistry tries progressively more specific, real embeddable faces first, and only falls through to the standard-14 mapping -- today's behavior -- when nothing more specific is available. This is a strictly additive capability: with no registry supplied at all, every caller that already calls resolveStandardFont directly keeps doing exactly that, byte for byte; a FontRegistry only changes anything for a caller that explicitly constructs one and threads it through its own write path.
//
// Resolution order, most specific first:
//   1. an exact-face match (same normalized family, same bold, same italic) in `sourceFonts` -- fonts genuinely embedded in or extracted from the document being converted;
//   2. an exact-face match in caller-supplied `fonts` -- fonts a caller hands in explicitly (e.g. a house font pack);
//   3. a family match (same normalized family, but the exact bold/italic combination requested is missing) in `sourceFonts` then `fonts` -- substitutes that family's own regular face, since some real face in the right family beats falling all the way through to a standard-14 substitute, and reports the substitution via `onSubstitution`;
//   4. an exact match in the vendored substitute table (font-substitutes.ts) -- embeds the matching Carlito/Caladea face and reports the substitution;
//   5. resolveStandardFont(family, bold, italic) -- unconditional, and never skipped: every LayoutFont this registry is ever asked to resolve gets *some* ResolvedFace back, even when nothing above matched anything.
// ProvidedFont/FontRegistryOptions are owned by document-schema.js (the neutral shared-schema package); imported here for the resolution logic below. FontSubstitution is document-schema.js-owned too and is not otherwise used in this module -- all three are consumed directly from document-schema.js by other callers. The FontRegistry interface and its PDF-specific ResolvedFace return type stay defined below.
import type { LayoutFont, ProvidedFont, FontRegistryOptions } from 'document-schema.js';
import { inflateSync } from 'fflate';
import type { StandardFontName } from './afm-widths';
import { CALADEA_BOLD_FONT_DEFLATED_BASE64 } from './assets/caladea-bold';
import { CALADEA_BOLDITALIC_FONT_DEFLATED_BASE64 } from './assets/caladea-bolditalic';
import { CALADEA_ITALIC_FONT_DEFLATED_BASE64 } from './assets/caladea-italic';
import { CALADEA_REGULAR_FONT_DEFLATED_BASE64 } from './assets/caladea-regular';
import { CARLITO_BOLD_FONT_DEFLATED_BASE64 } from './assets/carlito-bold';
import { CARLITO_BOLDITALIC_FONT_DEFLATED_BASE64 } from './assets/carlito-bolditalic';
import { CARLITO_ITALIC_FONT_DEFLATED_BASE64 } from './assets/carlito-italic';
import { CARLITO_REGULAR_FONT_DEFLATED_BASE64 } from './assets/carlito-regular';
import type { EmbeddedFace } from './embedded-font';
import { loadEmbeddedFace } from './embedded-font';
import type { VendoredFamily } from './font-substitutes';
import { resolveVendoredSubstituteFamily } from './font-substitutes';
import { normalizeFamilyName, resolveStandardFont } from './fonts';
import type { SfntFont } from './sfnt';
import { parseSfnt } from './sfnt';
import { base64ToBytes } from './util/base64';

// What FontRegistry.resolve settled on for one LayoutFont: either a real embeddable face (steps 1-4 above), or the standard-14 fallback (step 5) -- the same ResolvedFont shape resolveStandardFont already returns, carried through unchanged so a caller who only wants the standard-14 case can narrow on `kind` and read it exactly as before.
export type ResolvedFace =
  | { readonly kind: 'embedded'; readonly face: EmbeddedFace }
  | { readonly kind: 'standard'; readonly standardName: StandardFontName; readonly matched: boolean };

export interface FontRegistry {
  resolve(font: LayoutFont): ResolvedFace;
}

function faceCacheKey(family: string, bold: boolean, italic: boolean): string {
  return `${normalizeFamilyName(family)}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
}

// Reads `bytes` as an sfnt and loads it into an EmbeddedFace, or `undefined` for bytes that aren't a usable font at all (not a readable sfnt, or missing a table loadEmbeddedFace requires) -- the same "degrade around this font, don't abort" contract loadEmbeddedFace itself already documents. A caller with unusable bytes at a given step is treated exactly as if that step had found nothing, falling through to the next one.
function embedFace(bytes: Uint8Array<ArrayBuffer>): EmbeddedFace | undefined {
  const sfnt: SfntFont | undefined = parseSfnt(bytes);
  if (sfnt === undefined) {
    return undefined;
  }
  return loadEmbeddedFace(sfnt);
}

function findExactFace(list: readonly ProvidedFont[], family: string, bold: boolean, italic: boolean): ProvidedFont | undefined {
  const normalized = normalizeFamilyName(family);
  return list.find((candidate) => normalizeFamilyName(candidate.family) === normalized && candidate.bold === bold && candidate.italic === italic);
}

// The face step 3 substitutes for a family match with no exact bold/italic hit: that family's own genuinely unstyled (regular) face when one is present, otherwise -- a family only supplied in, say, bold -- whichever face of that family was supplied, since some real face in the right family is still a closer substitute than falling through to a standard-14 face in a wholly different family.
function findFamilyRegular(list: readonly ProvidedFont[], family: string): ProvidedFont | undefined {
  const normalized = normalizeFamilyName(family);
  const familyFaces = list.filter((candidate) => normalizeFamilyName(candidate.family) === normalized);
  if (familyFaces.length === 0) {
    return undefined;
  }
  return familyFaces.find((candidate) => !candidate.bold && !candidate.italic) ?? familyFaces[0];
}

// One process-wide cache of the inflated (real, uncompressed) sfnt bytes for each of the eight vendored Carlito/Caladea faces -- mirrors test-support/fonts.ts's own caching rationale (a Carlito face is several hundred KB inflated, and every FontRegistry instance in a process reusing the vendored table would otherwise re-inflate it from scratch on every resolve call).
const vendoredFaceBytesCache = new Map<string, Uint8Array<ArrayBuffer>>();

interface VendoredFaceSet {
  readonly regular: string;
  readonly bold: string;
  readonly italic: string;
  readonly boldItalic: string;
}

const VENDORED_FACE_BASE64: Readonly<Record<VendoredFamily, VendoredFaceSet>> = {
  carlito: {
    regular: CARLITO_REGULAR_FONT_DEFLATED_BASE64,
    bold: CARLITO_BOLD_FONT_DEFLATED_BASE64,
    italic: CARLITO_ITALIC_FONT_DEFLATED_BASE64,
    boldItalic: CARLITO_BOLDITALIC_FONT_DEFLATED_BASE64,
  },
  caladea: {
    regular: CALADEA_REGULAR_FONT_DEFLATED_BASE64,
    bold: CALADEA_BOLD_FONT_DEFLATED_BASE64,
    italic: CALADEA_ITALIC_FONT_DEFLATED_BASE64,
    boldItalic: CALADEA_BOLDITALIC_FONT_DEFLATED_BASE64,
  },
};

// Inflates (and caches) the raw sfnt bytes for one vendored family/bold/italic combination. The vendored assets are DEFLATE-compressed (fflate's raw deflateSync, RFC 1951 -- see src/assets/carlito-regular.ts's own header comment) rather than zlib-framed, so this is fflate's inflateSync, not src/bytes/flate.ts's zlib-aware inflate().
function loadVendoredFaceBytes(family: VendoredFamily, bold: boolean, italic: boolean): Uint8Array<ArrayBuffer> {
  const faceKey = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
  const cacheKey = `${family}-${faceKey}`;
  const cached = vendoredFaceBytesCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const deflatedBase64 = VENDORED_FACE_BASE64[family][faceKey];
  const inflated = inflateSync(base64ToBytes(deflatedBase64));
  // Copying into a fresh Uint8Array gives the ArrayBuffer-backed type parseSfnt (and every other sfnt reader in this package) requires -- fflate's own return type is ArrayBufferLike-backed, which is not guaranteed to be a real ArrayBuffer.
  const bytes = new Uint8Array(inflated.length);
  bytes.set(inflated);
  vendoredFaceBytesCache.set(cacheKey, bytes);
  return bytes;
}

// Builds a FontRegistry. With no options at all, `resolve` is equivalent to calling resolveStandardFont(family, bold, italic) directly for every LayoutFont -- steps 1-4 all have nothing to match against (no sourceFonts, no fonts, and step 4 still runs against the vendored table by default, matching real families like Calibri/Cambria exactly as documented; pass `substitutes: 'none'` to disable even that and fall straight through to step 5 for every family).
export function createFontRegistry(options: FontRegistryOptions = {}): FontRegistry {
  const sourceFonts = options.sourceFonts ?? [];
  const fonts = options.fonts ?? [];
  const substitutesEnabled = (options.substitutes ?? 'vendored') === 'vendored';
  const onSubstitution = options.onSubstitution;
  const cache = new Map<string, ResolvedFace>();

  function resolveUncached(family: string, bold: boolean, italic: boolean): ResolvedFace {
    // Step 1: an exact face already present in the source document.
    const sourceExact = findExactFace(sourceFonts, family, bold, italic);
    if (sourceExact !== undefined) {
      const face = embedFace(sourceExact.bytes);
      if (face !== undefined) {
        return { kind: 'embedded', face };
      }
    }

    // Step 2: an exact face the caller supplied explicitly.
    const callerExact = findExactFace(fonts, family, bold, italic);
    if (callerExact !== undefined) {
      const face = embedFace(callerExact.bytes);
      if (face !== undefined) {
        return { kind: 'embedded', face };
      }
    }

    // Step 3: a family match with the exact bold/italic combination missing -- sourceFonts first, then fonts, matching the same source-before-caller precedence steps 1/2 already established.
    const sourceFamilyRegular = findFamilyRegular(sourceFonts, family);
    const callerFamilyRegular = sourceFamilyRegular === undefined ? findFamilyRegular(fonts, family) : undefined;
    const familyRegular = sourceFamilyRegular ?? callerFamilyRegular;
    if (familyRegular !== undefined) {
      const face = embedFace(familyRegular.bytes);
      if (face !== undefined) {
        onSubstitution?.({ requestedFamily: family, requestedBold: bold, requestedItalic: italic, reason: 'missing-face', resolvedFamily: family });
        return { kind: 'embedded', face };
      }
    }

    // Step 4: the vendored substitute table.
    if (substitutesEnabled) {
      const vendoredFamily = resolveVendoredSubstituteFamily(family);
      if (vendoredFamily !== undefined) {
        const face = embedFace(loadVendoredFaceBytes(vendoredFamily, bold, italic));
        if (face !== undefined) {
          onSubstitution?.({ requestedFamily: family, requestedBold: bold, requestedItalic: italic, reason: 'vendored-substitute', resolvedFamily: vendoredFamily });
          return { kind: 'embedded', face };
        }
      }
    }

    // Step 5: the unconditional standard-14 fallback -- today's behavior, unchanged.
    const standard = resolveStandardFont(family, bold, italic);
    return { kind: 'standard', standardName: standard.standardName, matched: standard.matched };
  }

  return {
    resolve(font: LayoutFont): ResolvedFace {
      const bold = font.weight === 'bold';
      const italic = font.style === 'italic';
      const key = faceCacheKey(font.family, bold, italic);
      const cached = cache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const resolved = resolveUncached(font.family, bold, italic);
      cache.set(key, resolved);
      return resolved;
    },
  };
}

// The single resolution step every caller that OPTIONALLY accepts a FontRegistry shares (measure.ts's createFontMeasurer and write.ts's writePdf, which must agree exactly on which face a given LayoutFont resolves to or a line's measured width and its drawn glyphs come from two different fonts). With a registry, its own five-step order above; with none, resolveStandardFont directly -- deliberately NOT a default registry, since createFontRegistry() with no options still consults the vendored substitute table, so defaulting one in would silently start embedding Carlito for every Calibri run in a document whose caller supplied no font configuration at all.
export function resolveFaceWithRegistry(registry: FontRegistry | undefined, font: LayoutFont): ResolvedFace {
  if (registry !== undefined) {
    return registry.resolve(font);
  }
  const standard = resolveStandardFont(font.family, font.weight === 'bold', font.style === 'italic');
  return { kind: 'standard', standardName: standard.standardName, matched: standard.matched };
}
