// The embedded math font: STIX Two Math (OFL-1.1, vendored at assets/fonts/STIXTwoMath-Regular.otf -- see assets/fonts/NOTICE.md), embedded as a base64 string (src/mathml/assets/stix-two-math-font.ts) rather than read from disk at runtime -- see that file's own header comment for why.
//
// STIX Two Math is a CFF-flavoured OpenType font (an 'OTTO' sfnt wrapping a 'CFF ' table), not TrueType/glyf, confirmed by inspecting its own sfnt table directory while building this module -- the design plan this package was built against assumed glyf and asked to "confirm which and handle accordingly". CFF (Type 2 charstring) glyph-level subsetting -- re-encoding charstrings, rebuilding the CFF INDEX structures with a renumbered, minimal glyph set -- is a substantially larger undertaking than TrueType glyf/loca subsetting (which is closer to "slice out only the used glyf entries and rebuild loca"), and is out of scope for this pass. This module's own documented, honest simplification: the font's ENTIRE 'CFF ' table is embedded verbatim, unmodified, as a single /FontFile3 /Subtype /CIDFontType0C stream (see math-font-write.ts) -- a real, correct, working embedded font, just not glyph-subsetted. Everything else genuinely IS built from a real, targeted parse of only what's used: cmap resolves exactly the Unicode code points a document's formulas actually reference to glyph IDs, and the emitted /W widths array and ToUnicode CMap only ever cover those same glyph IDs, not the font's full ~5500-glyph repertoire.
//
// A CID-keyed PDF composite font built this way needs no /CIDToGIDMap at all (that key exists only for /CIDFontType2): per ISO 32000-1 9.7.4.2, a /CIDFontType0 whose /FontFile3 is a "bare" (non-CID-keyed) CFF program is read with CID treated as directly indexing the CFF's own CharStrings INDEX by glyph order -- i.e. CID == GID -- which is exactly the numbering this module's own cmap-derived glyph IDs already use, so Identity-H text-showing (2-byte CIDs, big-endian) needs no further remapping anywhere in the write path.
import { base64ToBytes } from './util/base64';
import type { MathFontMetrics, MathGlyphMetrics, MathStretchResult, MathStretchAxis } from 'document-schema.js';
import { STIX_TWO_MATH_FONT_BASE64 } from './assets/stix-two-math-font';
import type { CffGlyphBounds } from './cff-bounds';
import { parseCffGlyphBounds } from './cff-bounds';
import type { CmapLookup } from './cmap-table';
import { buildCmapLookup } from './cmap-table';
import type { GlyphInkBounds } from './glyph-bounds';
import type { HmtxTable } from './hmtx-table';
import { parseHmtx } from './hmtx-table';
import type { MathStretchConstruction, MathStretchPlacement } from './math-stretch';
import { assembleStretchyGlyph, scaleMathStretchConstruction } from './math-stretch';
import type { MathGlyphConstruction, MathTable } from './math-table';
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
  // This glyph's own tight ink bounding box in FONT DESIGN UNITS (y up, so a descender's yMin is negative), computed by interpreting its Type 2 charstring -- see cff-bounds.ts. `undefined` for a glyph outside the font, one that draws nothing (a space), or one whose charstring that module declines to walk. The size-relative form most callers want is MathGlyphMetrics.inkAscentPt/inkDescentPt, which metricsAt(sizePt) already converts to points.
  glyphInkBounds(glyphId: number): GlyphInkBounds | undefined;
  // The font's own MathVariants.minConnectorOverlap, in design units -- the floor on assembly part overlap assembleStretchyGlyph (math-stretch.ts) needs alongside a construction from `stretchyConstruction` below.
  readonly minConnectorOverlap: number;
  // Everything the font declares about stretching the glyph for `codePoint` along `axis`, in design units, or `undefined` when the font's MathVariants subtable does not cover that glyph on that axis at all (i.e. the character is not stretchy in this font, whatever an operator dictionary may say about it). See LoadedMathFont.stretchGlyph below for the points-in/points-out form most callers want.
  stretchyConstruction(codePoint: number, axis: MathStretchAxis): MathGlyphConstruction | undefined;
}

function toPt(designUnits: number, unitsPerEm: number, sizePt: number): number {
  return (designUnits / unitsPerEm) * sizePt;
}

// The whole construction's own real ink extent about its drawing origin, and its horizontal advance, both measured from the actual glyphs it is built from rather than assumed from the nominal advances the assembly model works in. Along the stretch axis each placement's own offset shifts its ink; across it every placement sits at the same position, so only the glyphs' own bounds matter. Returns undefined when NO placement's outline could be measured at all -- there is then nothing to position the construction by, and MathFontMetrics.stretch()'s own contract (document-schema.js's math layout port) says the caller falls back to the unstretched base glyph rather than being handed a guessed extent.
function measureConstruction(placements: readonly MathStretchPlacement[], axis: MathStretchAxis, inkBounds: CffGlyphBounds | undefined, hmtx: HmtxTable): { inkAscent: number; inkDescent: number; advanceWidth: number } | undefined {
  let inkAscent = Number.NEGATIVE_INFINITY;
  let inkDescent = Number.NEGATIVE_INFINITY;
  let advanceWidth = 0;
  for (const placement of placements) {
    advanceWidth = Math.max(advanceWidth, hmtx.advanceWidth(placement.glyphId));
    const ink = inkBounds?.bounds(placement.glyphId);
    if (ink === undefined) {
      continue;
    }
    const alongY = axis === 'vertical' ? placement.offset : 0;
    inkAscent = Math.max(inkAscent, alongY + ink.yMax);
    inkDescent = Math.max(inkDescent, -(alongY + ink.yMin));
  }
  return inkAscent === Number.NEGATIVE_INFINITY ? undefined : { inkAscent, inkDescent, advanceWidth };
}

// MathFontMetrics.stretch's own implementation: resolve the font's MathVariants construction for `codePoint` on `axis` (math-table.ts), pick or assemble the glyphs reaching `targetSizePt` (math-stretch.ts), then measure the result so a layout engine can place it. Kept alongside metricsAtSize rather than inside it because it needs the same closed-over parse state and the same design-units-to-points factor.
function stretchAtSize(cmap: CmapLookup, hmtx: HmtxTable, math: MathTable, inkBounds: CffGlyphBounds | undefined, unitsPerEm: number, codePoint: number, axis: MathStretchAxis, targetSizePt: number, sizePt: number): MathStretchResult | undefined {
  const glyphId = cmap(codePoint);
  if (glyphId === undefined) {
    return undefined;
  }
  const construction = (axis === 'vertical' ? math.variants.vertical : math.variants.horizontal).get(glyphId);
  if (construction === undefined) {
    return undefined;
  }
  const designUnitsPerPt = unitsPerEm / sizePt;
  const assembled = assembleStretchyGlyph(construction, { axis, targetSize: targetSizePt * designUnitsPerPt, minConnectorOverlap: math.variants.minConnectorOverlap });
  if (assembled === undefined) {
    return undefined;
  }
  const measured = measureConstruction(assembled.placements, axis, inkBounds, hmtx);
  if (measured === undefined) {
    return undefined;
  }
  const pt = (designUnits: number): number => toPt(designUnits, unitsPerEm, sizePt);
  return {
    kind: assembled.kind,
    sizePt: pt(assembled.size),
    advanceWidthPt: pt(measured.advanceWidth),
    inkAscentPt: pt(measured.inkAscent),
    inkDescentPt: pt(measured.inkDescent),
    placements: assembled.placements.map((placement) => ({ glyphId: placement.glyphId, offsetPt: pt(placement.offset) })),
  };
}

// MathFontMetrics's own *Pt fields are already "at the caller's requested size" by contract (see metrics.ts) -- a single, size-independent parsed font cannot supply that directly, so this is the per-size factory loadMathFont's own metricsAt(sizePt) calls.
function metricsAtSize(cmap: CmapLookup, hmtx: HmtxTable, math: MathTable, inkBounds: CffGlyphBounds | undefined, unitsPerEm: number, ascentDesignUnits: number, descentDesignUnits: number, sizePt: number): MathFontMetrics {
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
      // The glyph's own tight ink extent, from its actual outline rather than from the font-wide nominal ascent/descent every glyph in the face shares. Reported in the same direction convention as ascentPerEm/descentPerEm: ink above the baseline is a positive ascent, ink below it a positive descent -- which makes inkDescentPt NEGATIVE for a glyph drawing nothing below the baseline at all, since its lowest ink genuinely sits above it.
      const ink = inkBounds?.bounds(glyphId);
      return {
        advanceWidthPt,
        italicCorrectionPt: toPt(italicCorrectionDesignUnits, unitsPerEm, glyphSizePt),
        topAccentXPt: topAccentDesignUnits === undefined ? undefined : toPt(topAccentDesignUnits, unitsPerEm, glyphSizePt),
        inkAscentPt: ink === undefined ? undefined : toPt(ink.yMax, unitsPerEm, glyphSizePt),
        inkDescentPt: ink === undefined ? undefined : toPt(-ink.yMin, unitsPerEm, glyphSizePt),
      };
    },
    stretch(codePoint: number, axis: MathStretchAxis, targetSizePt: number, glyphSizePt: number): MathStretchResult | undefined {
      return stretchAtSize(cmap, hmtx, math, inkBounds, unitsPerEm, codePoint, axis, targetSizePt, glyphSizePt);
    },
  };
}

// The full parsed font state, size-independent -- glyphId/glyphSpaceWidth/cffBytes/descriptor never change per call; `metricsAt(sizePt)` is the size-dependent MathFontMetrics factory layout.ts's own LayoutFormulaOptions.metrics expects.
export interface LoadedMathFont {
  readonly font: MathFont;
  readonly metricsAt: (sizePt: number) => MathFontMetrics;
  // Stretches the glyph for `codePoint` to `targetSizePt` along `axis`, when the operator is being set at `sizePt` -- the points-in/points-out entry point for OpenType MATH stretchy glyphs (a tall parenthesis around a big fraction, a radical sign sized to its own radicand, an over-brace spanning its own content). Every length on the returned construction is in points at `sizePt`, matching MathFontMetrics's own convention. Returns `undefined` when this font declares no stretching for that glyph on that axis, in which case the caller draws the base glyph unstretched.
  readonly stretchGlyph: (codePoint: number, axis: MathStretchAxis, targetSizePt: number, sizePt: number) => MathStretchConstruction | undefined;
}

let cached: LoadedMathFont | undefined;

// Parses the vendored STIX Two Math font once per process and caches the result -- every call to odfToPdf (or any other formula-rendering entry point) within the same process reuses the same parse, matching how src/pdf/afm-widths.ts's own STANDARD_METRICS is a module-level constant rather than re-derived per call.
export function loadMathFont(): LoadedMathFont {
  if (cached !== undefined) {
    return cached;
  }

  const bytes = base64ToBytes(STIX_TWO_MATH_FONT_BASE64);
  // The embedded font is a vendored, checked-in asset, not untrusted input, so every "this font is unreadable" branch below is an invariant check on this package's own build output rather than a case a caller could hit with a bad document -- parseSfnt/buildCmapLookup return `undefined` for a malformed font because the same parsers also read fonts extracted from arbitrary source documents (see their own module comments).
  const sfnt: SfntFont | undefined = parseSfnt(bytes);
  if (sfnt === undefined) {
    throw new Error('embedded math font is not a readable sfnt container');
  }
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
  if (cmap === undefined) {
    throw new Error('embedded math font has no readable cmap subtable');
  }
  const hmtx = parseHmtx(sfnt);
  const math = parseMathTable(sfnt);
  // Per-glyph ink boxes come from walking each glyph's own charstring, since a CFF glyph -- unlike a TrueType one -- carries no bounding box of its own anywhere. Every glyph is walked at most once and memoised inside this object, which is itself built once per process alongside the rest of the parse.
  const inkBounds = parseCffGlyphBounds(cffBytes);

  const font: MathFont = {
    metrics: metricsAtSize(cmap, hmtx, math, inkBounds, unitsPerEm, ascentDesignUnits, descentDesignUnits, unitsPerEm), // a 1-unit-per-em-sized metrics object -- exists only to satisfy the MathFont.metrics field's own type; every real caller goes through metricsAt(sizePt) instead
    cffBytes,
    descriptor: { unitsPerEm, ascent: ascentDesignUnits, descent: descentDesignUnits, capHeight, bboxMin, bboxMax, italicAngle: 0 },
    glyphId: (codePoint: number) => cmap(codePoint),
    glyphSpaceWidth: (glyphId: number) => (hmtx.advanceWidth(glyphId) * 1000) / unitsPerEm,
    glyphInkBounds: (glyphId: number) => inkBounds?.bounds(glyphId),
    minConnectorOverlap: math.variants.minConnectorOverlap,
    stretchyConstruction: (codePoint: number, axis: MathStretchAxis) => {
      const glyphId = cmap(codePoint);
      if (glyphId === undefined) {
        return undefined;
      }
      return (axis === 'vertical' ? math.variants.vertical : math.variants.horizontal).get(glyphId);
    },
  };

  cached = {
    font,
    metricsAt: (sizePt: number) => metricsAtSize(cmap, hmtx, math, inkBounds, unitsPerEm, ascentDesignUnits, descentDesignUnits, sizePt),
    stretchGlyph: (codePoint: number, axis: MathStretchAxis, targetSizePt: number, sizePt: number) => {
      const construction = font.stretchyConstruction(codePoint, axis);
      if (construction === undefined) {
        return undefined;
      }
      const designUnitsPerPt = unitsPerEm / sizePt;
      const assembled = assembleStretchyGlyph(construction, { axis, targetSize: targetSizePt * designUnitsPerPt, minConnectorOverlap: math.variants.minConnectorOverlap });
      return assembled === undefined ? undefined : scaleMathStretchConstruction(assembled, 1 / designUnitsPerPt);
    },
  };
  return cached;
}
