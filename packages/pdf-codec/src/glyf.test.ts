import { describe, expect, it } from 'vitest';
import { buildCmapLookup } from './cmap-table';
import { parseHead, parseMaxp } from './font-tables';
import type { GlyfOptions, GlyfTable } from './glyf';
import { parseGlyf, parseLoca } from './glyf';
import type { SfntFont } from './sfnt';
import { parseSfnt } from './sfnt';
import { caladeaRegularBytes, carlitoRegularBytes } from './test-support/fonts';

// Every glyph ID, contour count, bounding box, and component list asserted below was read out of the real vendored .ttf files by a standalone Node script walking 'loca'/'glyf' with a bare DataView, independently of this package's own parsers.
interface LoadedFont {
  readonly sfnt: SfntFont;
  readonly options: GlyfOptions;
  readonly glyf: GlyfTable;
  readonly glyphIdFor: (codePoint: number) => number;
}

function load(bytes: Uint8Array<ArrayBuffer>): LoadedFont {
  const sfnt = parseSfnt(bytes);
  if (sfnt === undefined) {
    throw new Error('vendored font failed to parse as an sfnt container');
  }
  const head = parseHead(sfnt);
  const maxp = parseMaxp(sfnt);
  const cmap = buildCmapLookup(sfnt);
  if (head === undefined || maxp === undefined || cmap === undefined) {
    throw new Error('vendored font is missing head/maxp/cmap');
  }
  const options: GlyfOptions = { numGlyphs: maxp.numGlyphs, indexToLocFormat: head.indexToLocFormat };
  const glyf = parseGlyf(sfnt, options);
  if (glyf === undefined) {
    throw new Error('vendored font has no readable glyf/loca');
  }
  return {
    sfnt,
    options,
    glyf,
    glyphIdFor: (codePoint: number): number => {
      const glyphId = cmap(codePoint);
      if (glyphId === undefined) {
        throw new Error(`vendored font has no glyph for U+${codePoint.toString(16).toUpperCase()}`);
      }
      return glyphId;
    },
  };
}

describe('parseLoca', () => {
  it("reads Carlito Regular's long-format index: one offset per glyph plus a terminator", () => {
    const { sfnt, options } = load(carlitoRegularBytes());
    const loca = parseLoca(sfnt, options);
    expect(loca).toBeDefined();
    expect(options.indexToLocFormat).toBe(1);
    expect(loca!.length).toBe(2783 + 1);
    expect(loca![0]).toBe(0);
    // The terminating offset is the total length of the glyph data, i.e. the whole 'glyf' table.
    expect(loca![2783]).toBe(sfnt.tables.get('glyf')?.length);
    expect(loca![2783]).toBe(503548);
  });

  it("reads Caladea Regular's short-format index, doubling each stored offset", () => {
    const { sfnt, options } = load(caladeaRegularBytes());
    const loca = parseLoca(sfnt, options);
    expect(loca).toBeDefined();
    expect(options.indexToLocFormat).toBe(0);
    expect(loca!.length).toBe(464 + 1);
    expect(loca![464]).toBe(sfnt.tables.get('glyf')?.length);
    expect(loca![464]).toBe(52572);
    // A short 'loca' can only address an even byte, which is why glyph data is padded to an even length.
    for (const offset of loca!) {
      expect(offset % 2).toBe(0);
    }
  });

  it('rises monotonically, so every glyph occupies a non-negative byte range', () => {
    for (const bytes of [carlitoRegularBytes(), caladeaRegularBytes()]) {
      const { sfnt, options } = load(bytes);
      const loca = parseLoca(sfnt, options)!;
      for (let i = 1; i < loca.length; i++) {
        expect(loca[i]!).toBeGreaterThanOrEqual(loca[i - 1]!);
      }
    }
  });

  it('returns undefined when the declared glyph count outruns the table', () => {
    const { sfnt, options } = load(caladeaRegularBytes());
    expect(parseLoca(sfnt, { ...options, numGlyphs: options.numGlyphs * 2 })).toBeUndefined();
  });
});

describe('glyphHeader', () => {
  it("reads Carlito Regular's 'A' as a real two-contour simple glyph with its own bounding box", () => {
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    const capitalA = glyphIdFor(0x41);
    expect(capitalA).toBe(3);
    const header = glyf.glyphHeader(capitalA);
    expect(header).toEqual({ numberOfContours: 2, xMin: 8, yMin: 0, xMax: 1178, yMax: 1314 });
  });

  it("reads Caladea Regular's 'A' likewise, on its own 1000-unit grid", () => {
    const { glyf, glyphIdFor } = load(caladeaRegularBytes());
    const capitalA = glyphIdFor(0x41);
    expect(capitalA).toBe(5);
    expect(glyf.glyphHeader(capitalA)).toEqual({ numberOfContours: 2, xMin: 1, yMin: 0, xMax: 596, yMax: 667 });
  });

  it('reports a space as a glyph with no outline at all rather than as an unreadable one', () => {
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    const space = glyphIdFor(0x20);
    expect(glyf.glyphBytes(space)?.length).toBe(0);
    expect(glyf.glyphHeader(space)).toBeUndefined();
    expect(glyf.compositeComponents(space)).toBeUndefined();
  });

  it('returns undefined for a glyph ID outside the font', () => {
    const { glyf } = load(caladeaRegularBytes());
    expect(glyf.numGlyphs).toBe(464);
    expect(glyf.glyphBytes(464)).toBeUndefined();
    expect(glyf.glyphBytes(-1)).toBeUndefined();
    expect(glyf.glyphHeader(10_000)).toBeUndefined();
  });
});

describe('compositeComponents', () => {
  it("walks Carlito Regular's 'e-acute' into its real base letter and accent components", () => {
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    const eAcute = glyphIdFor(0xe9);
    const lowercaseE = glyphIdFor(0x65);
    expect(eAcute).toBe(2007);
    expect(lowercaseE).toBe(59);

    expect(glyf.glyphHeader(eAcute)?.numberOfContours).toBeLessThan(0);
    const components = glyf.compositeComponents(eAcute);
    expect(components).toBeDefined();
    expect(components!.map((component) => component.glyphIndex)).toEqual([2781, lowercaseE, 172]);

    // Every component places itself by x/y offset (not by matching point indices) and carries no transform of its own.
    for (const component of components!) {
      expect(component.argsAreXyValues).toBe(true);
      expect(component.transform).toBeUndefined();
    }
    // The base letter sits at the composite's own origin; the accent is shifted right to sit over it.
    const base = components!.find((component) => component.glyphIndex === lowercaseE);
    expect(base).toEqual({ flags: 0x0022, glyphIndex: 59, argument1: 0, argument2: 0, argsAreXyValues: true, transform: undefined });
    expect(components![2]).toEqual({ flags: 0x0103, glyphIndex: 172, argument1: 312, argument2: 0, argsAreXyValues: true, transform: undefined });

    // The base and the accent are both real, drawable simple glyphs -- exactly what a subset that dropped them would lose.
    expect(glyf.glyphHeader(lowercaseE)?.numberOfContours).toBe(2);
    expect(glyf.glyphHeader(172)?.numberOfContours).toBe(1);
  });

  it("walks Caladea Regular's 'e-acute' and finds its accent component is ITSELF composite", () => {
    const { glyf, glyphIdFor } = load(caladeaRegularBytes());
    const eAcute = glyphIdFor(0xe9);
    const lowercaseE = glyphIdFor(0x65);
    expect(eAcute).toBe(178);

    const components = glyf.compositeComponents(eAcute);
    expect(components).toBeDefined();
    expect(components!.map((component) => component.glyphIndex)).toEqual([lowercaseE, 289]);
    expect(components![0]).toEqual({ flags: 0x0022, glyphIndex: 35, argument1: 0, argument2: 0, argsAreXyValues: true, transform: undefined });
    expect(components![1]).toEqual({ flags: 0x0003, glyphIndex: 289, argument1: 324, argument2: 0, argsAreXyValues: true, transform: undefined });

    // This is the case one level of component walking is not enough for: glyph 289 (the acute accent) is a composite referring on to glyph 276, so a subset built from the first level alone would keep the accent's own entry and drop the outline it actually draws.
    expect(glyf.glyphHeader(289)?.numberOfContours).toBeLessThan(0);
    const nested = glyf.compositeComponents(289);
    expect(nested).toBeDefined();
    expect(nested!.map((component) => component.glyphIndex)).toEqual([276]);
    expect(glyf.glyphHeader(276)?.numberOfContours).toBeGreaterThan(0);
    expect(glyf.compositeComponents(276)).toBeUndefined(); // a simple glyph has no components to walk
  });

  it('walks every composite in both fonts without running off the end of a glyph', () => {
    for (const bytes of [carlitoRegularBytes(), caladeaRegularBytes()]) {
      const { glyf } = load(bytes);
      let composites = 0;
      for (let glyphId = 0; glyphId < glyf.numGlyphs; glyphId++) {
        const header = glyf.glyphHeader(glyphId);
        if (header === undefined || header.numberOfContours >= 0) {
          continue;
        }
        composites++;
        const components = glyf.compositeComponents(glyphId);
        expect(components).toBeDefined();
        expect(components!.length).toBeGreaterThan(0);
        for (const component of components!) {
          // Every referenced glyph must exist in the font, or the composite draws whatever happens to sit at that ID.
          expect(component.glyphIndex).toBeLessThan(glyf.numGlyphs);
          expect(glyf.glyphBytes(component.glyphIndex)).toBeDefined();
        }
      }
      expect(composites).toBeGreaterThan(0);
    }
  });

  it('counts the same composites the fonts really contain', () => {
    const countComposites = (bytes: Uint8Array<ArrayBuffer>): number => {
      const { glyf } = load(bytes);
      let composites = 0;
      for (let glyphId = 0; glyphId < glyf.numGlyphs; glyphId++) {
        if ((glyf.glyphHeader(glyphId)?.numberOfContours ?? 0) < 0) {
          composites++;
        }
      }
      return composites;
    };
    expect(countComposites(carlitoRegularBytes())).toBe(1387);
    expect(countComposites(caladeaRegularBytes())).toBe(189);
  });

  it('reports a truncated component list as unreadable rather than as a partial one', () => {
    const bytes = caladeaRegularBytes();
    const { sfnt, options, glyf, glyphIdFor } = load(bytes);
    const eAcute = glyphIdFor(0xe9);
    const loca = parseLoca(sfnt, options)!;
    const glyfTable = sfnt.tables.get('glyf');
    expect(glyfTable).toBeDefined();

    // Chop the composite's own entry short by moving its terminating 'loca' offset back over the second component record, leaving the first component's MORE_COMPONENTS bit pointing at bytes that are no longer there.
    expect(glyf.compositeComponents(eAcute)?.length).toBe(2);
    const truncated = new Uint8Array(bytes.length);
    truncated.set(bytes);
    const locaTable = sfnt.tables.get('loca');
    expect(locaTable).toBeDefined();
    const shortenedEnd = (loca[eAcute]! + 16) / 2; // the glyph header plus exactly the first component record, halved for the short loca format
    const view = new DataView(truncated.buffer);
    view.setUint16(locaTable!.offset + (eAcute + 1) * 2, shortenedEnd);

    const damaged = load(truncated);
    expect(damaged.glyf.compositeComponents(eAcute)).toBeUndefined();
  });
});
