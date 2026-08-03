import type { LayoutFont } from 'document-schema.js';
import { STANDARD_METRICS } from './afm-widths';
import type { EmbeddedFace } from './embedded-font';
import { encodeForShowEmbedded } from './embedded-font';
import type { FontRegistry, ResolvedFace } from './font-registry';
import { resolveFaceWithRegistry } from './font-registry';
import { encodeForShow } from './winansi';

export interface UnderlineMetrics {
  readonly offsetPt: number; // relative to the baseline; negative is below it
  readonly thicknessPt: number;
}

// Every measurement needed to lay out and paginate text, backed by a concrete font implementation. Kept as an interface (not a concrete class) so src/pdf/text-layout.ts's wrap-point logic can be tested against a fake, exactly-predictable measurer (e.g. a fixed-width "monospace" fake) instead of the real standard-14 metrics -- and so a future embedded-font measurer can be substituted without touching any layout code.
export interface TextMeasurer {
  widthOfTextAtSize(text: string, font: LayoutFont, sizePt: number): number;
  lineHeightAtSize(font: LayoutFont, sizePt: number): number;
  ascenderAtSize(font: LayoutFont, sizePt: number): number;
  descenderAtSize(font: LayoutFont, sizePt: number): number;
  underlineAtSize(font: LayoutFont, sizePt: number): UnderlineMetrics;
  // The PDF Tz (horizontal scaling) value, as a fraction (1.0 = no scaling), this font's actual glyphs must be drawn at so the *rendered* text lines up with what widthOfTextAtSize *measured*. This must come from the same measurer instance driving layout -- see the module doc below for why a mismatch here is worse than applying no correction at all.
  horizontalScaleFor(font: LayoutFont): number;
}

// PDF glyph space: the 1000-units-per-em space every EmbeddedFaceMetrics field and every encodeForShowEmbedded width is already expressed in (ISO 32000-1 9.8.1), regardless of the font's own design grid -- embedded-font.ts does that conversion once, at parse time, so nothing here needs the face's own unitsPerEm.
const GLYPH_SPACE_UNITS_PER_EM = 1000;

// Calibri and Aptos (Word's defaults since 2007 and 2024 respectively) run measurably narrower than Helvetica at the same point size; Cambria is narrower than Times-Roman; Verdana and Tahoma run wider. Keyed by the *requested* family name (normalized the same way src/pdf/fonts.ts does), not the resolved standard family, since two families mapped to the same standard face (e.g. both Calibri and Arial map to Helvetica) can have different real-world metrics.
//
// This table is a correction applied to a STANDARD-14 SUBSTITUTE's metrics, and it is meaningless -- actively harmful -- for a genuinely embedded face: an embedded Carlito already advances at Carlito's own real widths, so multiplying those by Calibri's 0.92 "Helvetica is too wide for this family" factor would make the measured line 8% narrower than the glyphs actually drawn, packing text past the column edge. See horizontalScaleFor below for how the code path enforces that.
const DEFAULT_WIDTH_CORRECTIONS: Readonly<Record<string, number>> = {
  calibri: 0.92,
  aptos: 0.93,
  aptosdisplay: 0.93,
  cambria: 0.96,
  verdana: 1.09,
  tahoma: 1.02,
};

function normalizeFamilyKey(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A real embedded face is drawn at its own true advance widths, so its Tz is exactly 100% -- never a width correction. Named rather than inlined so the one place it is returned reads as a deliberate decision rather than a stray literal.
const EMBEDDED_HORIZONTAL_SCALE = 1;

// Which of the three competing vertical-metric sets a font declares should drive line height, ascent, and descent for an EMBEDDED face. This is deliberately a named, caller-overridable policy rather than one hard-coded rule, because there is no authoritative specification section that settles it: an sfnt carries 'hhea's ascender/descender/lineGap, 'OS/2's sTypoAscender/sTypoDescender/sTypoLineGap, and 'OS/2's usWinAscent/usWinDescent, and real consumers genuinely disagree about which to use. The only ground truth is empirical convergence against real documents, so the choice is exposed rather than buried.
//
// 'hhea'    -- ascender + |descender| + lineGap from 'hhea'. The default here, for one concrete reason rather than a preference: afm-widths.ts's own STANDARD_METRICS.lineHeightEm is documented as derived exactly this way from the real TrueType faces the standard-14 stand in for, so an embedded face and a standard-14 substitute in the same document derive their line height from the same rule, and swapping a font from substituted to embedded does not silently change pagination for an unrelated reason. 'os2Typo' -- sTypoAscender + |sTypoDescender| + sTypoLineGap. What the OpenType specification designates for line spacing, and what a font with the 'OS/2' USE_TYPO_METRICS bit set asks consumers to use. 'os2Win'  -- usWinAscent + usWinDescent, with no line gap. The clipping box Windows GDI (and applications layered on it) derives a line height from; typically the loosest of the three.
//
// A face with no readable 'OS/2' table at all has no typo or win set to state, so both of those policies fall back to 'hhea' -- the only vertical metrics the font itself then declares. Documented rather than silent: this is a font that genuinely cannot answer the question the policy asks, not a policy being ignored.
export type VerticalMetricPolicy = 'hhea' | 'os2Typo' | 'os2Win';

export const DEFAULT_VERTICAL_METRIC_POLICY: VerticalMetricPolicy = 'hhea';

interface VerticalMetricSet {
  readonly ascentGlyphSpace: number;
  readonly descentGlyphSpace: number; // negative
  readonly lineGapGlyphSpace: number;
}

function verticalMetricsFor(face: EmbeddedFace, policy: VerticalMetricPolicy): VerticalMetricSet {
  const m = face.metrics;
  const hhea: VerticalMetricSet = { ascentGlyphSpace: m.ascentGlyphSpace, descentGlyphSpace: m.descentGlyphSpace, lineGapGlyphSpace: m.lineGapGlyphSpace };
  if (policy === 'os2Typo') {
    if (m.typoAscentGlyphSpace === undefined || m.typoDescentGlyphSpace === undefined || m.typoLineGapGlyphSpace === undefined) {
      return hhea;
    }
    return { ascentGlyphSpace: m.typoAscentGlyphSpace, descentGlyphSpace: m.typoDescentGlyphSpace, lineGapGlyphSpace: m.typoLineGapGlyphSpace };
  }
  if (policy === 'os2Win') {
    if (m.winAscentGlyphSpace === undefined || m.winDescentGlyphSpace === undefined) {
      return hhea;
    }
    // usWinAscent/usWinDescent are a bounding box, not a spacing model -- there is no win-flavoured line gap to add, and inventing one would be a guess rather than a metric the font states.
    return { ascentGlyphSpace: m.winAscentGlyphSpace, descentGlyphSpace: m.winDescentGlyphSpace, lineGapGlyphSpace: 0 };
  }
  return hhea;
}

export interface StandardFontMeasurerOptions {
  readonly widthCorrectionByFamily?: Readonly<Record<string, number>>;
}

export interface FontMeasurerOptions extends StandardFontMeasurerOptions {
  // Which vertical-metric set drives lineHeightAtSize/ascenderAtSize/descenderAtSize for an embedded face. Ignored entirely for a standard-14 resolution, which has only afm-widths.ts's own single metric set to read. Defaults to DEFAULT_VERTICAL_METRIC_POLICY.
  readonly verticalMetrics?: VerticalMetricPolicy;
}

// The measurer's per-family width-correction factor (Risk R1's mitigation) is not merely a measurement-time fudge: it must also scale how the writer actually draws that font's glyphs (via PDF's Tz horizontal-scaling operator, applied in src/pdf/content-write.ts using horizontalScaleFor), or the two disagree -- a "corrected" measurement that assumes Calibri is 8% narrower than Helvetica, while glyphs are drawn at literal Helvetica widths, would make wrapping *worse* than applying no correction at all: more (assumed-narrower) characters get packed onto a line than the actually-wider rendered glyphs can fit, and text overruns its column. Driving both from one measurer instance is what keeps them from drifting apart.
//
// `registry` is the same optional FontRegistry writePdf takes: with one, a LayoutFont may resolve to a real embedded face, and every measurement below comes from that face's own 'cmap'/'hmtx'/'hhea'/'OS/2'/'post' tables instead of a standard-14 AFM substitute plus a per-family fudge. With none, every resolution is standard-14 and this behaves identically to createStandardFontMeasurer -- which is exactly what that function now is.
export function createFontMeasurer(registry?: FontRegistry, options: FontMeasurerOptions = {}): TextMeasurer {
  const corrections: Readonly<Record<string, number>> = { ...DEFAULT_WIDTH_CORRECTIONS, ...options.widthCorrectionByFamily };
  const verticalPolicy = options.verticalMetrics ?? DEFAULT_VERTICAL_METRIC_POLICY;

  // Reachable ONLY from a 'standard' branch below. Every method here narrows on ResolvedFace.kind first and returns from the embedded branch before this is ever in scope, which is what structurally guarantees an embedded face never has both its own accurate advances AND the standard-14 width fudge applied to it (the failure mode would be silent: correctly-measured text drawn at 92% of the width it was measured at, overrunning its column with no error anywhere).
  function standardWidthCorrectionFor(family: string): number {
    return corrections[normalizeFamilyKey(family)] ?? 1;
  }

  function resolve(font: LayoutFont): ResolvedFace {
    return resolveFaceWithRegistry(registry, font);
  }

  return {
    widthOfTextAtSize(text, font, sizePt) {
      const face = resolve(font);
      if (face.kind === 'embedded') {
        // encodeForShowEmbedded is the single code path both this measurement and content-write.ts's own emission go through, so a character with no glyph in the face advances by the same .notdef width in both -- see its own comment for why measuring and encoding separately silently desyncs a wrap point from what is drawn.
        return (encodeForShowEmbedded(text, face.face).width1000 / GLYPH_SPACE_UNITS_PER_EM) * sizePt;
      }
      const { width1000 } = encodeForShow(text, face.standardName);
      return (width1000 / GLYPH_SPACE_UNITS_PER_EM) * sizePt * standardWidthCorrectionFor(font.family);
    },
    lineHeightAtSize(font, sizePt) {
      const face = resolve(font);
      if (face.kind === 'embedded') {
        const vertical = verticalMetricsFor(face.face, verticalPolicy);
        // descentGlyphSpace is negative, so subtracting it adds its magnitude -- the same (ascender + |descender| + lineGap) / unitsPerEm formula STANDARD_METRICS.lineHeightEm was itself derived from.
        return ((vertical.ascentGlyphSpace - vertical.descentGlyphSpace + vertical.lineGapGlyphSpace) / GLYPH_SPACE_UNITS_PER_EM) * sizePt;
      }
      return STANDARD_METRICS[face.standardName].lineHeightEm * sizePt;
    },
    ascenderAtSize(font, sizePt) {
      const face = resolve(font);
      if (face.kind === 'embedded') {
        return (verticalMetricsFor(face.face, verticalPolicy).ascentGlyphSpace / GLYPH_SPACE_UNITS_PER_EM) * sizePt;
      }
      return (STANDARD_METRICS[face.standardName].ascender / GLYPH_SPACE_UNITS_PER_EM) * sizePt;
    },
    descenderAtSize(font, sizePt) {
      const face = resolve(font);
      if (face.kind === 'embedded') {
        return (verticalMetricsFor(face.face, verticalPolicy).descentGlyphSpace / GLYPH_SPACE_UNITS_PER_EM) * sizePt;
      }
      return (STANDARD_METRICS[face.standardName].descender / GLYPH_SPACE_UNITS_PER_EM) * sizePt;
    },
    underlineAtSize(font, sizePt) {
      const face = resolve(font);
      if (face.kind === 'embedded') {
        // The font's own 'post' underlinePosition/underlineThickness, which is exactly what those fields mean -- not the AFM values of whichever standard-14 face this family would otherwise have substituted to.
        return {
          offsetPt: (face.face.metrics.underlinePositionGlyphSpace / GLYPH_SPACE_UNITS_PER_EM) * sizePt,
          thicknessPt: (face.face.metrics.underlineThicknessGlyphSpace / GLYPH_SPACE_UNITS_PER_EM) * sizePt,
        };
      }
      const metrics = STANDARD_METRICS[face.standardName];
      return {
        offsetPt: (metrics.underlinePosition / GLYPH_SPACE_UNITS_PER_EM) * sizePt,
        thicknessPt: (metrics.underlineThickness / GLYPH_SPACE_UNITS_PER_EM) * sizePt,
      };
    },
    horizontalScaleFor(font) {
      const face = resolve(font);
      // An embedded face is drawn at its own real advances, which widthOfTextAtSize measured directly -- there is nothing to correct, and DEFAULT_WIDTH_CORRECTIONS is not consulted at all on this path.
      return face.kind === 'embedded' ? EMBEDDED_HORIZONTAL_SCALE : standardWidthCorrectionFor(font.family);
    },
  };
}

// The standard-14-only measurer: createFontMeasurer with no registry, so every LayoutFont resolves through resolveStandardFont exactly as it always has. Retained as its own entry point because it is the one every existing caller (and this package's own public barrel) already names, and because "measure against the standard 14" is a genuine, complete configuration rather than a degenerate case worth spelling out at each call site.
export function createStandardFontMeasurer(options: StandardFontMeasurerOptions = {}): TextMeasurer {
  return createFontMeasurer(undefined, options);
}
