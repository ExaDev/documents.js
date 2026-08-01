import type { LayoutFont } from 'document-schema.js';
import { STANDARD_METRICS } from './afm-widths';
import { resolveStandardFont } from './fonts';
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

// Calibri and Aptos (Word's defaults since 2007 and 2024 respectively) run measurably narrower than Helvetica at the same point size; Cambria is narrower than Times-Roman; Verdana and Tahoma run wider. Keyed by the *requested* family name (normalized the same way src/pdf/fonts.ts does), not the resolved standard family, since two families mapped to the same standard face (e.g. both Calibri and Arial map to Helvetica) can have different real-world metrics.
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

export interface StandardFontMeasurerOptions {
  readonly widthCorrectionByFamily?: Readonly<Record<string, number>>;
}

// The measurer's per-family width-correction factor (Risk R1's mitigation) is not merely a measurement-time fudge: it must also scale how the writer actually draws that font's glyphs (via PDF's Tz horizontal-scaling operator, applied in src/pdf/content-write.ts using horizontalScaleFor), or the two disagree -- a "corrected" measurement that assumes Calibri is 8% narrower than Helvetica, while glyphs are drawn at literal Helvetica widths, would make wrapping *worse* than applying no correction at all: more (assumed-narrower) characters get packed onto a line than the actually-wider rendered glyphs can fit, and text overruns its column. Driving both from one measurer instance is what keeps them from drifting apart.
export function createStandardFontMeasurer(options: StandardFontMeasurerOptions = {}): TextMeasurer {
  const corrections: Readonly<Record<string, number>> = { ...DEFAULT_WIDTH_CORRECTIONS, ...options.widthCorrectionByFamily };

  function correctionFor(family: string): number {
    return corrections[normalizeFamilyKey(family)] ?? 1;
  }

  function standardNameFor(font: LayoutFont): ReturnType<typeof resolveStandardFont>['standardName'] {
    return resolveStandardFont(font.family, font.weight === 'bold', font.style === 'italic').standardName;
  }

  return {
    widthOfTextAtSize(text, font, sizePt) {
      const { width1000 } = encodeForShow(text, standardNameFor(font));
      return (width1000 / 1000) * sizePt * correctionFor(font.family);
    },
    lineHeightAtSize(font, sizePt) {
      return STANDARD_METRICS[standardNameFor(font)].lineHeightEm * sizePt;
    },
    ascenderAtSize(font, sizePt) {
      return (STANDARD_METRICS[standardNameFor(font)].ascender / 1000) * sizePt;
    },
    descenderAtSize(font, sizePt) {
      return (STANDARD_METRICS[standardNameFor(font)].descender / 1000) * sizePt;
    },
    underlineAtSize(font, sizePt) {
      const metrics = STANDARD_METRICS[standardNameFor(font)];
      return {
        offsetPt: (metrics.underlinePosition / 1000) * sizePt,
        thicknessPt: (metrics.underlineThickness / 1000) * sizePt,
      };
    },
    horizontalScaleFor(font) {
      return correctionFor(font.family);
    },
  };
}
