// The embedded math font: STIX Two Math (OFL-1.1, vendored at assets/fonts/STIXTwoMath-Regular.otf -- see assets/fonts/NOTICE.md), embedded as a base64 string (src/mathml/assets/stix-two-math-font.ts) rather than read from disk at runtime -- see that file's own header comment for why.
//
// STIX Two Math is a CFF-flavoured OpenType font (an 'OTTO' sfnt wrapping a 'CFF ' table), not TrueType/glyf, confirmed by inspecting its own sfnt table directory while building this module -- the design plan this package was built against assumed glyf and asked to "confirm which and handle accordingly". CFF (Type 2 charstring) glyph-level subsetting -- re-encoding charstrings, rebuilding the CFF INDEX structures with a renumbered, minimal glyph set -- is a substantially larger undertaking than TrueType glyf/loca subsetting (which is closer to "slice out only the used glyf entries and rebuild loca"), and is out of scope for this pass. This module's own documented, honest simplification: the font's ENTIRE 'CFF ' table is embedded verbatim, unmodified, as a single /FontFile3 /Subtype /CIDFontType0C stream (see math-font-write.ts) -- a real, correct, working embedded font, just not glyph-subsetted. Everything else genuinely IS built from a real, targeted parse of only what's used: cmap resolves exactly the Unicode code points a document's formulas actually reference to glyph IDs, and the emitted /W widths array and ToUnicode CMap only ever cover those same glyph IDs, not the font's full ~5500-glyph repertoire.
//
// A CID-keyed PDF composite font built this way needs no /CIDToGIDMap at all (that key exists only for /CIDFontType2): per ISO 32000-1 9.7.4.2, a /CIDFontType0 whose /FontFile3 is a "bare" (non-CID-keyed) CFF program is read with CID treated as directly indexing the CFF's own CharStrings INDEX by glyph order -- i.e. CID == GID -- which is exactly the numbering this module's own cmap-derived glyph IDs already use, so Identity-H text-showing (2-byte CIDs, big-endian) needs no further remapping anywhere in the write path.
import { base64ToBytes } from './util/base64';
import type { MathFontMetrics, MathGlyphMetrics } from './math-types';
import { STIX_TWO_MATH_FONT_BASE64 } from './assets/stix-two-math-font';
import type { CmapLookup } from './math-cmap';
import { buildCmapLookup } from './math-cmap';
import type { HmtxTable } from './math-hmtx';
import { parseHmtx } from './math-hmtx';
import type { MathTable } from './math-table';
import { parseMathTable } from './math-table';
import type { SfntFont } from './sfnt';
import { i16, parseSfnt, sfntTableBytes, u16 } from './sfnt';

export interface MathFontDescriptorMetrics {
  readonly unitsPerEm: number;
  readonly ascent: number; // design units
  readonly descent: number; // design units (negative, per sfnt hhea convention)
  readonly capHeight: number; // design units
  readonly bboxMin: readonly [number, number];
  readonly bboxMax: readonly [number, number];
  readonly italicAngle: number;
}

export interface MathFont {
  readonly metrics: MathFontMetrics;
  readonly cffBytes: Uint8Array<ArrayBuffer>;
  readonly descriptor: MathFontDescriptorMetrics;
  glyphId(codePoint: number): number | undefined;
  // The glyph-space (1000-units-per-em, PDF's own /W convention regardless of the font's own unitsPerEm) advance width for `glyphId` -- the value math-font-write.ts writes into /W, and the same conversion factor content stream widths implicitly rely on.
  glyphSpaceWidth(glyphId: number): number;
}

function toPt(designUnits: number, unitsPerEm: number, sizePt: number): number {
  return (designUnits / unitsPerEm) * sizePt;
}

// MathFontMetrics's own *Pt fields are already "at the caller's requested size" by contract (see metrics.ts) -- a single, size-independent parsed font cannot supply that directly, so this is the per-size factory loadMathFont's own metricsAt(sizePt) calls.
function metricsAtSize(cmap: CmapLookup, hmtx: HmtxTable, math: MathTable, unitsPerEm: number, ascentDesignUnits: number, descentDesignUnits: number, sizePt: number): MathFontMetrics {
  const c = math.constants;
  const pt = (designUnits: number): number => toPt(designUnits, unitsPerEm, sizePt);
  return {
    ascentPerEm: ascentDesignUnits / unitsPerEm,
    descentPerEm: -descentDesignUnits / unitsPerEm,
    axisHeightPt: pt(c.axisHeight),
    fractionRuleThicknessPt: pt(c.fractionRuleThickness),
    fractionNumeratorShiftUpPt: pt(c.fractionNumeratorShiftUp),
    fractionNumeratorDisplayShiftUpPt: pt(c.fractionNumeratorDisplayStyleShiftUp),
    fractionDenominatorShiftDownPt: pt(c.fractionDenominatorShiftDown),
    fractionDenominatorDisplayShiftDownPt: pt(c.fractionDenominatorDisplayStyleShiftDown),
    fractionNumeratorGapMinPt: pt(c.fractionNumeratorGapMin),
    fractionDenominatorGapMinPt: pt(c.fractionDenominatorGapMin),
    radicalRuleThicknessPt: pt(c.radicalRuleThickness),
    radicalExtraAscenderPt: pt(c.radicalExtraAscender),
    radicalVerticalGapPt: pt(c.radicalVerticalGap),
    radicalKernBeforeDegreePt: pt(c.radicalKernBeforeDegree),
    radicalKernAfterDegreePt: pt(c.radicalKernAfterDegree),
    radicalDegreeBottomRaisePercent: c.radicalDegreeBottomRaisePercent,
    subscriptShiftDownPt: pt(c.subscriptShiftDown),
    superscriptShiftUpPt: pt(c.superscriptShiftUp),
    superscriptShiftUpCrampedPt: pt(c.superscriptShiftUpCramped),
    subSuperscriptGapMinPt: pt(c.subSuperscriptGapMin),
    superscriptBaselineDropMaxPt: pt(c.superscriptBaselineDropMax),
    subscriptBaselineDropMinPt: pt(c.subscriptBaselineDropMin),
    spaceAfterScriptPt: pt(c.spaceAfterScript),
    upperLimitGapMinPt: pt(c.upperLimitGapMin),
    upperLimitBaselineRiseMinPt: pt(c.upperLimitBaselineRiseMin),
    lowerLimitGapMinPt: pt(c.lowerLimitGapMin),
    lowerLimitBaselineDropMinPt: pt(c.lowerLimitBaselineDropMin),
    stackTopShiftUpPt: pt(c.stackTopShiftUp),
    stackBottomShiftDownPt: pt(c.stackBottomShiftDown),
    stackGapMinPt: pt(c.stackGapMin),
    scriptPercentScaleDown: c.scriptPercentScaleDown,
    scriptScriptPercentScaleDown: c.scriptScriptPercentScaleDown,
    defaultRuleThicknessPt: pt(c.fractionRuleThickness),
    glyph(codePoint: number, glyphSizePt: number): MathGlyphMetrics | undefined {
      const glyphId = cmap(codePoint);
      if (glyphId === undefined) {
        return undefined;
      }
      const advanceWidthPt = toPt(hmtx.advanceWidth(glyphId), unitsPerEm, glyphSizePt);
      const italicCorrectionDesignUnits = math.glyphInfo.italicsCorrection.get(glyphId) ?? 0;
      const topAccentDesignUnits = math.glyphInfo.topAccentAttachment.get(glyphId);
      return {
        advanceWidthPt,
        italicCorrectionPt: toPt(italicCorrectionDesignUnits, unitsPerEm, glyphSizePt),
        topAccentXPt: topAccentDesignUnits === undefined ? undefined : toPt(topAccentDesignUnits, unitsPerEm, glyphSizePt),
      };
    },
  };
}

// The full parsed font state, size-independent -- glyphId/glyphSpaceWidth/cffBytes/descriptor never change per call; `metricsAt(sizePt)` is the size-dependent MathFontMetrics factory layout.ts's own LayoutFormulaOptions.metrics expects.
export interface LoadedMathFont {
  readonly font: MathFont;
  readonly metricsAt: (sizePt: number) => MathFontMetrics;
}

let cached: LoadedMathFont | undefined;

// Parses the vendored STIX Two Math font once per process and caches the result -- every call to odfToPdf (or any other formula-rendering entry point) within the same process reuses the same parse, matching how src/pdf/afm-widths.ts's own STANDARD_METRICS is a module-level constant rather than re-derived per call.
export function loadMathFont(): LoadedMathFont {
  if (cached !== undefined) {
    return cached;
  }

  const bytes = base64ToBytes(STIX_TWO_MATH_FONT_BASE64);
  const sfnt: SfntFont = parseSfnt(bytes);
  const headBytes = sfntTableBytes(sfnt, 'head');
  const hheaBytes = sfntTableBytes(sfnt, 'hhea');
  const os2Bytes = sfntTableBytes(sfnt, 'OS/2');
  const cffBytes = sfntTableBytes(sfnt, 'CFF ');
  if (headBytes === undefined || hheaBytes === undefined || cffBytes === undefined) {
    throw new Error('embedded math font is missing a required sfnt table (head/hhea/CFF )');
  }

  const unitsPerEm = u16(headBytes, 18);
  const ascentDesignUnits = i16(hheaBytes, 4);
  const descentDesignUnits = i16(hheaBytes, 6);
  const bboxMin: readonly [number, number] = [i16(headBytes, 36), i16(headBytes, 38)];
  const bboxMax: readonly [number, number] = [i16(headBytes, 40), i16(headBytes, 42)];
  const capHeight = os2Bytes === undefined ? ascentDesignUnits : i16(os2Bytes, 88);
  // STIX Two Math is an upright design (mathvariant='italic' selects a real, distinct, upright-drawn ITALIC GLYPH rather than an algorithmically slanted one -- see variant.ts), so its FontDescriptor's own /ItalicAngle is always 0 -- this module doesn't parse 'post's own Fixed-format italicAngle field at all, since nothing this package ever draws through this font needs a non-zero value.

  const cmap = buildCmapLookup(sfnt);
  const hmtx = parseHmtx(sfnt);
  const math = parseMathTable(sfnt);

  const font: MathFont = {
    metrics: metricsAtSize(cmap, hmtx, math, unitsPerEm, ascentDesignUnits, descentDesignUnits, unitsPerEm), // a 1-unit-per-em-sized metrics object -- exists only to satisfy the MathFont.metrics field's own type; every real caller goes through metricsAt(sizePt) instead
    cffBytes,
    descriptor: { unitsPerEm, ascent: ascentDesignUnits, descent: descentDesignUnits, capHeight, bboxMin, bboxMax, italicAngle: 0 },
    glyphId: (codePoint: number) => cmap(codePoint),
    glyphSpaceWidth: (glyphId: number) => (hmtx.advanceWidth(glyphId) * 1000) / unitsPerEm,
  };

  cached = {
    font,
    metricsAt: (sizePt: number) => metricsAtSize(cmap, hmtx, math, unitsPerEm, ascentDesignUnits, descentDesignUnits, sizePt),
  };
  return cached;
}
