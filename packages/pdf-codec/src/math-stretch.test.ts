import { describe, expect, it } from 'vitest';
import { assembleStretchyGlyph, scaleMathStretchConstruction } from './math-stretch';
import type { MathStretchConstruction } from './math-stretch';
import type { MathStretchAxis } from 'document-schema.js';
import { loadMathFont } from './math-font';
import type { MathGlyphConstruction, MathGlyphPart } from './math-table';

// Every expected value below was independently verified against the real vendored assets/fonts/STIXTwoMath-Regular.otf's own raw bytes (a standalone Node script walking the sfnt table directory and the MATH table's own MathVariants subtable directly, not this package's own parser) -- these are real, external cross-checks, not values derived from and re-asserted against this module's own output. The arithmetic in the "exact placement" cases below was likewise worked out by hand from those raw font values and the OpenType MATH spec's own assembly model, then asserted, rather than recorded from a run.

const PAREN = 0x28; // LEFT PARENTHESIS -- 13 vertical variants plus a bottom/extender/top assembly
const RADICAL = 0x221a; // SQUARE ROOT -- 4 vertical variants plus a bottom-hook/extender/top assembly
const OVER_BRACE = 0x23de; // TOP CURLY BRACKET -- 6 horizontal variants plus a five-part assembly with two extenders
const LATIN_X = 0x78; // not stretchy on either axis in this font

function partsByGlyphId(construction: MathGlyphConstruction): ReadonlyMap<number, MathGlyphPart> {
  const parts = new Map<number, MathGlyphPart>();
  for (const part of construction.assembly?.parts ?? []) {
    parts.set(part.glyphId, part);
  }
  return parts;
}

// Re-derives every seam of an assembled construction from the placements alone and checks it against the parts' own declared connector metadata: consecutive parts must genuinely overlap (never leave a gap), by no more than either side's own connector length, by no more than would swallow a part whole, and by at least the font's own minConnectorOverlap. Also checks that the reported total size is exactly what the placements span.
function expectSoundAssembly(result: MathStretchConstruction, construction: MathGlyphConstruction, minConnectorOverlap: number): void {
  const parts = partsByGlyphId(construction);
  expect(result.placements.length).toBeGreaterThan(0);

  const overlaps: number[] = [];
  for (let i = 0; i + 1 < result.placements.length; i++) {
    const before = result.placements[i]!;
    const after = result.placements[i + 1]!;
    const beforePart = parts.get(before.glyphId);
    const afterPart = parts.get(after.glyphId);
    expect(beforePart).toBeDefined();
    expect(afterPart).toBeDefined();

    const overlap = before.offset + before.advance - after.offset;
    expect(overlap).toBeGreaterThanOrEqual(minConnectorOverlap);
    expect(overlap).toBeLessThanOrEqual(beforePart!.endConnectorLength);
    expect(overlap).toBeLessThanOrEqual(afterPart!.startConnectorLength);
    // Each part must still contribute ink after both of its own seams are taken out of it.
    expect(after.advance).toBeGreaterThan(overlap);
    expect(before.advance).toBeGreaterThan(overlap);
    overlaps.push(overlap);
  }
  // The spec's own model overlaps every join by the same amount; an assembly whose seams varied would be this module's own bug, not a font trait.
  for (const overlap of overlaps) {
    expect(overlap).toBeCloseTo(overlaps[0]!, 9);
  }

  const last = result.placements[result.placements.length - 1]!;
  expect(result.size).toBeCloseTo(last.offset + last.advance, 9);
}

function verticalConstruction(codePoint: number): MathGlyphConstruction {
  const construction = loadMathFont().font.stretchyConstruction(codePoint, 'vertical');
  expect(construction).toBeDefined();
  return construction!;
}

function stretch(construction: MathGlyphConstruction, targetSize: number, axis: MathStretchAxis = 'vertical'): MathStretchConstruction {
  const result = assembleStretchyGlyph(construction, { axis, targetSize, minConnectorOverlap: loadMathFont().font.minConnectorOverlap });
  expect(result).toBeDefined();
  return result!;
}

describe('MathVariants parsing against the real STIX Two Math font', () => {
  it("reads the font's own minimum connector overlap", () => {
    expect(loadMathFont().font.minConnectorOverlap).toBe(100);
  });

  it('reads the left parenthesis\'s own vertical variant sequence, at strictly increasing sizes starting from the base glyph', () => {
    const construction = verticalConstruction(PAREN);
    expect(construction.variants).toHaveLength(13);
    expect(construction.variants[0]).toEqual({ glyphId: loadMathFont().font.glyphId(PAREN), advanceMeasurement: 933 });
    expect(construction.variants[1]).toEqual({ glyphId: 1301, advanceMeasurement: 1187 });
    expect(construction.variants[12]).toEqual({ glyphId: 1312, advanceMeasurement: 3821 });
    for (let i = 1; i < construction.variants.length; i++) {
      expect(construction.variants[i]!.advanceMeasurement).toBeGreaterThan(construction.variants[i - 1]!.advanceMeasurement);
    }
  });

  it("reads the left parenthesis's own three-part assembly, bottom to top, with exactly one extender", () => {
    const assembly = verticalConstruction(PAREN).assembly;
    expect(assembly).toBeDefined();
    expect(assembly!.italicsCorrection).toBe(0);
    expect(assembly!.parts).toEqual([
      { glyphId: 4862, startConnectorLength: 0, endConnectorLength: 250, fullAdvance: 1273, isExtender: false },
      { glyphId: 4861, startConnectorLength: 1000, endConnectorLength: 1000, fullAdvance: 1252, isExtender: true },
      { glyphId: 4860, startConnectorLength: 250, endConnectorLength: 0, fullAdvance: 1273, isExtender: false },
    ]);
    // The first part's own start connector and the last part's own end connector face nothing, which is what identifies them as the construction's two extremes.
    expect(assembly!.parts[0]!.startConnectorLength).toBe(0);
    expect(assembly!.parts[2]!.endConnectorLength).toBe(0);
  });

  it('lists vertical assembly parts bottom to top, corroborated by the Unicode names of the bracket pieces themselves', () => {
    // Unicode gives the bracket family's own assembly pieces dedicated code points (the U+239B..U+23AD block), and their names say which end of the construction each one belongs to -- an external, font-independent check on this module's reading of the spec's own part ordering, rather than a restatement of it.
    const font = loadMathFont().font;
    expect(verticalConstruction(PAREN).assembly!.parts.map((part) => part.glyphId)).toEqual([
      font.glyphId(0x239d), // LEFT PARENTHESIS LOWER HOOK -- first part, so the list starts at the BOTTOM
      font.glyphId(0x239c), // LEFT PARENTHESIS EXTENSION
      font.glyphId(0x239b), // LEFT PARENTHESIS UPPER HOOK -- last part, so the list ends at the TOP
    ]);
    expect(verticalConstruction(0x7b).assembly!.parts.map((part) => part.glyphId)).toEqual([
      font.glyphId(0x23a9), // LEFT CURLY BRACKET LOWER HOOK
      font.glyphId(0x23aa), // CURLY BRACKET EXTENSION
      font.glyphId(0x23a8), // LEFT CURLY BRACKET MIDDLE PIECE
      font.glyphId(0x23aa), // CURLY BRACKET EXTENSION, again
      font.glyphId(0x23a7), // LEFT CURLY BRACKET UPPER HOOK
    ]);
  });

  // Enumerating the whole 0x1FFFF codepoint range is cheap uninstrumented (well under 200ms), but `pnpm test:coverage`'s v8 coverage instrumentation adds per-call overhead to every one of the ~131,000 glyphId() calls below, which is enough to clear vitest's 5000ms default on a slower CI runner -- an explicit timeout, not a change to what this test checks.
  it('names glyphs that no Unicode code point reaches, which is why drawing a construction needs glyph IDs rather than text', () => {
    const font = loadMathFont();
    const encoded = new Set<number>();
    for (let codePoint = 0; codePoint <= 0x1_ffff; codePoint++) {
      const glyphId = font.font.glyphId(codePoint);
      if (glyphId !== undefined) {
        encoded.add(glyphId);
      }
    }
    // Every pre-built larger variant beyond the base glyph is an unencoded glyph, on both axes.
    for (const codePoint of [PAREN, RADICAL]) {
      for (const variant of font.font.stretchyConstruction(codePoint, 'vertical')!.variants.slice(1)) {
        expect(encoded.has(variant.glyphId)).toBe(false);
      }
    }
    for (const variant of font.font.stretchyConstruction(OVER_BRACE, 'horizontal')!.variants.slice(1)) {
      expect(encoded.has(variant.glyphId)).toBe(false);
    }
    // Assembly parts are a mixed case, not a uniform one: the bracket family's pieces DO have code points (the block checked above), while the radical's and the over-brace's pieces have none at all.
    for (const part of verticalConstruction(PAREN).assembly!.parts) {
      expect(encoded.has(part.glyphId)).toBe(true);
    }
    for (const part of verticalConstruction(RADICAL).assembly!.parts) {
      expect(encoded.has(part.glyphId)).toBe(false);
    }
    for (const part of font.font.stretchyConstruction(OVER_BRACE, 'horizontal')!.assembly!.parts) {
      expect(encoded.has(part.glyphId)).toBe(false);
    }
  }, 30_000);

  it("reads the radical sign's own vertical construction", () => {
    const construction = verticalConstruction(RADICAL);
    expect(construction.variants.map((variant) => variant.advanceMeasurement)).toEqual([1188, 1855, 2371, 2892]);
    expect(construction.assembly!.parts).toEqual([
      { glyphId: 1661, startConnectorLength: 200, endConnectorLength: 200, fullAdvance: 1905, isExtender: false },
      { glyphId: 1664, startConnectorLength: 650, endConnectorLength: 650, fullAdvance: 651, isExtender: true },
      { glyphId: 1662, startConnectorLength: 550, endConnectorLength: 0, fullAdvance: 642, isExtender: false },
    ]);
  });

  it("reads the over-brace's own HORIZONTAL construction, and finds nothing for it on the vertical axis", () => {
    const font = loadMathFont().font;
    expect(font.stretchyConstruction(OVER_BRACE, 'vertical')).toBeUndefined();
    const construction = font.stretchyConstruction(OVER_BRACE, 'horizontal');
    expect(construction).toBeDefined();
    expect(construction!.variants.map((variant) => variant.advanceMeasurement)).toEqual([631, 1001, 1501, 1771, 2181, 2601]);
    // Five parts, two of them the same repeated extender glyph on either side of a fixed middle -- the shape a brace needs and a parenthesis does not.
    expect(construction!.assembly!.parts.map((part) => part.glyphId)).toEqual([2106, 2073, 2107, 2073, 2108]);
    expect(construction!.assembly!.parts.map((part) => part.isExtender)).toEqual([false, true, false, true, false]);
  });

  it('reports no construction for a glyph the font does not stretch, on either axis', () => {
    const font = loadMathFont().font;
    expect(font.stretchyConstruction(LATIN_X, 'vertical')).toBeUndefined();
    expect(font.stretchyConstruction(LATIN_X, 'horizontal')).toBeUndefined();
  });
});

describe('assembleStretchyGlyph variant selection', () => {
  it('keeps the base glyph when it is already big enough', () => {
    const construction = verticalConstruction(PAREN);
    const result = stretch(construction, 800);
    expect(result.kind).toBe('base');
    expect(result.size).toBe(933);
    expect(result.placements).toEqual([{ glyphId: loadMathFont().font.glyphId(PAREN), offset: 0, advance: 933 }]);
  });

  it('picks the SMALLEST pre-built variant that reaches the target, not the largest', () => {
    const construction = verticalConstruction(PAREN);
    // 1500 sits between the 1427 and 1667 variants, so the 1667 one (glyph 1303) is the smallest that reaches it.
    const result = stretch(construction, 1500);
    expect(result.kind).toBe('variant');
    expect(result.size).toBe(1667);
    expect(result.placements).toEqual([{ glyphId: 1303, offset: 0, advance: 1667 }]);
  });

  it('takes a variant at its exact declared size when the target lands on one', () => {
    const result = stretch(verticalConstruction(PAREN), 1427);
    expect(result.size).toBe(1427);
    expect(result.placements).toHaveLength(1);
  });

  it('falls through to the part assembly only once every variant is too small', () => {
    const construction = verticalConstruction(PAREN);
    expect(stretch(construction, 3821).kind).toBe('variant'); // the largest variant, exactly
    expect(stretch(construction, 3822).kind).toBe('assembly'); // one design unit past it
  });
});

describe('assembleStretchyGlyph part assembly against the real font', () => {
  it('repeats the parenthesis extender to reach a target no variant covers, with sound seams', () => {
    const construction = verticalConstruction(PAREN);
    const result = stretch(construction, 6000);
    expect(result.kind).toBe('assembly');
    expect(result.axis).toBe('vertical');
    expectSoundAssembly(result, construction, loadMathFont().font.minConnectorOverlap);

    // Worked out by hand from the font's own part metrics: reaching 6000 needs the 1252-unit extender four times (bottom 1273 + 4x1252 + top 1273 = 7554 of raw advance across six parts), and the five seams between them are capped at 250 units by the bottom part's own end connector and the top part's own start connector -- so the construction lands at 7554 - 5x250 = 6304, the closest the font's own parts can get to 6000 from above.
    expect(result.placements.map((placement) => placement.glyphId)).toEqual([4862, 4861, 4861, 4861, 4861, 4860]);
    expect(result.placements.map((placement) => placement.offset)).toEqual([0, 1023, 2025, 3027, 4029, 5031]);
    expect(result.size).toBe(6304);
    expect(result.size).toBeGreaterThanOrEqual(6000);
  });

  it('lands exactly on a radical target the parts can hit, by widening the seams rather than overshooting', () => {
    const construction = verticalConstruction(RADICAL);
    const result = stretch(construction, 5000);
    expect(result.kind).toBe('assembly');
    expectSoundAssembly(result, construction, loadMathFont().font.minConnectorOverlap);

    // Five repetitions of the 651-unit extender between the 1905-unit hook and the 642-unit top (5802 raw across seven parts); the six seams are free to widen from the font's own 100-unit minimum up to 200, and (5802 - 5000) / 6 = 133.67 falls inside that range, so the construction hits 5000 exactly rather than overshooting it.
    expect(result.placements).toHaveLength(7);
    expect(result.placements.filter((placement) => placement.glyphId === 1664)).toHaveLength(5);
    expect(result.size).toBeCloseTo(5000, 9);
  });

  it('assembles a HORIZONTAL over-brace from its two extenders around a fixed middle', () => {
    const font = loadMathFont().font;
    const construction = font.stretchyConstruction(OVER_BRACE, 'horizontal')!;
    const result = stretch(construction, 5000, 'horizontal');
    expect(result.kind).toBe('assembly');
    expect(result.axis).toBe('horizontal');
    expectSoundAssembly(result, construction, font.minConnectorOverlap);

    // Both extenders repeat the same number of times, keeping the brace's own middle spur centred: two each, so the laid-down order is left / ext / ext / middle / ext / ext / right.
    expect(result.placements.map((placement) => placement.glyphId)).toEqual([2106, 2073, 2073, 2107, 2073, 2073, 2108]);
    expect(result.size).toBeCloseTo(5000, 9);
  });

  it('grows monotonically: a larger target never yields a smaller or equal construction', () => {
    const construction = verticalConstruction(PAREN);
    let previous = 0;
    for (const target of [1000, 2000, 4000, 6000, 10_000, 20_000, 50_000]) {
      const result = stretch(construction, target);
      expect(result.size).toBeGreaterThan(previous);
      expect(result.size).toBeGreaterThanOrEqual(target);
      if (result.kind === 'assembly') {
        expectSoundAssembly(result, construction, loadMathFont().font.minConnectorOverlap);
      }
      previous = result.size;
    }
  });
});

describe('point-scaled stretching through the loaded font', () => {
  it('stretches to a target expressed in points at a given font size', () => {
    const { font, stretchGlyph } = loadMathFont();
    const result = stretchGlyph(PAREN, 'vertical', 20, 12);
    expect(result).toBeDefined();
    // 20pt at 12pt-per-1000-design-units is 1666.67 design units, which the 1667-unit variant (glyph 1303) just covers.
    expect(result!.kind).toBe('variant');
    expect(result!.placements[0]!.glyphId).toBe(1303);
    expect(result!.size).toBeCloseTo((1667 / font.descriptor.unitsPerEm) * 12, 9);
    expect(result!.size).toBeGreaterThanOrEqual(20);
  });

  it('reports every assembly placement in points, spanning the reported size', () => {
    const result = loadMathFont().stretchGlyph(PAREN, 'vertical', 80, 12);
    expect(result).toBeDefined();
    expect(result!.kind).toBe('assembly');
    const last = result!.placements[result!.placements.length - 1]!;
    expect(last.offset + last.advance).toBeCloseTo(result!.size, 9);
    expect(result!.size).toBeGreaterThanOrEqual(80);
  });

  it('returns undefined for a glyph this font does not stretch', () => {
    expect(loadMathFont().stretchGlyph(LATIN_X, 'vertical', 40, 12)).toBeUndefined();
  });

  it('scales a design-unit construction into points identically to stretchGlyph', () => {
    const { font, stretchGlyph } = loadMathFont();
    const construction = verticalConstruction(PAREN);
    const inDesignUnits = stretch(construction, (80 * font.descriptor.unitsPerEm) / 12);
    expect(scaleMathStretchConstruction(inDesignUnits, 12 / font.descriptor.unitsPerEm)).toEqual(stretchGlyph(PAREN, 'vertical', 80, 12));
  });
});

describe('assembleStretchyGlyph on constructions the real font does not contain', () => {
  it('returns undefined when a construction offers neither variants nor parts', () => {
    expect(assembleStretchyGlyph({ variants: [] }, { axis: 'vertical', targetSize: 1000, minConnectorOverlap: 100 })).toBeUndefined();
  });

  it('falls back to the largest variant when the target is unreachable and there is no assembly', () => {
    const construction: MathGlyphConstruction = { variants: [{ glyphId: 1, advanceMeasurement: 500 }, { glyphId: 2, advanceMeasurement: 900 }] };
    const result = assembleStretchyGlyph(construction, { axis: 'vertical', targetSize: 5000, minConnectorOverlap: 100 });
    expect(result).toEqual({ kind: 'variant', axis: 'vertical', size: 900, italicsCorrection: 0, placements: [{ glyphId: 2, offset: 0, advance: 900 }] });
  });

  it('places an all-extender recipe at least once, since it has no fixed part to stand alone', () => {
    const construction: MathGlyphConstruction = {
      variants: [],
      assembly: { italicsCorrection: 0, parts: [{ glyphId: 7, startConnectorLength: 400, endConnectorLength: 400, fullAdvance: 1000, isExtender: true }] },
    };
    const result = assembleStretchyGlyph(construction, { axis: 'vertical', targetSize: 10, minConnectorOverlap: 100 });
    expect(result).toEqual({ kind: 'assembly', axis: 'vertical', size: 1000, italicsCorrection: 0, placements: [{ glyphId: 7, offset: 0, advance: 1000 }] });
  });

  it('stops at the minimum construction when repeating an extender cannot grow it', () => {
    // A degenerate recipe whose extender adds less advance than the minimum overlap consumes: every extra repetition would make the construction SHORTER, so no repeat count reaches the target and the smallest form is returned.
    const construction: MathGlyphConstruction = {
      variants: [],
      assembly: {
        italicsCorrection: 25,
        parts: [
          { glyphId: 1, startConnectorLength: 0, endConnectorLength: 300, fullAdvance: 800, isExtender: false },
          { glyphId: 2, startConnectorLength: 300, endConnectorLength: 300, fullAdvance: 90, isExtender: true },
          { glyphId: 3, startConnectorLength: 300, endConnectorLength: 0, fullAdvance: 800, isExtender: false },
        ],
      },
    };
    const result = assembleStretchyGlyph(construction, { axis: 'vertical', targetSize: 100_000, minConnectorOverlap: 100 });
    expect(result).toBeDefined();
    expect(result!.kind).toBe('assembly');
    expect(result!.italicsCorrection).toBe(25);
    // Zero extender repetitions: the two fixed parts alone, joined at the font's own 100-unit minimum overlap.
    expect(result!.placements).toEqual([
      { glyphId: 1, offset: 0, advance: 800 },
      { glyphId: 3, offset: 700, advance: 800 },
    ]);
    expect(result!.size).toBe(1500);
  });
});
