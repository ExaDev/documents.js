import { describe, expect, it } from "vitest";
import { buildSfnt } from "./test-support/sfnt";
import { buildCmapLookup } from "./cmap-table";
import { parseHead, parseMaxp } from "./font-tables";
import type { GlyfOptions, GlyfTable } from "./glyf";
import { parseGlyf, parseLoca } from "./glyf";
import type { SfntFont } from "./sfnt";
import { parseSfnt } from "./sfnt";
import { caladeaRegularBytes, carlitoRegularBytes } from "./test-support/fonts";

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
    throw new Error("vendored font failed to parse as an sfnt container");
  }
  const head = parseHead(sfnt);
  const maxp = parseMaxp(sfnt);
  const cmap = buildCmapLookup(sfnt);
  if (head === undefined || maxp === undefined || cmap === undefined) {
    throw new Error("vendored font is missing head/maxp/cmap");
  }
  const options: GlyfOptions = {
    numGlyphs: maxp.numGlyphs,
    indexToLocFormat: head.indexToLocFormat,
  };
  const glyf = parseGlyf(sfnt, options);
  if (glyf === undefined) {
    throw new Error("vendored font has no readable glyf/loca");
  }
  return {
    sfnt,
    options,
    glyf,
    glyphIdFor: (codePoint: number): number => {
      const glyphId = cmap(codePoint);
      if (glyphId === undefined) {
        throw new Error(
          `vendored font has no glyph for U+${codePoint.toString(16).toUpperCase()}`,
        );
      }
      return glyphId;
    },
  };
}

describe("parseLoca", () => {
  it("reads Carlito Regular's long-format index: one offset per glyph plus a terminator", () => {
    const { sfnt, options } = load(carlitoRegularBytes());
    const loca = parseLoca(sfnt, options);
    expect(loca).toBeDefined();
    expect(options.indexToLocFormat).toBe(1);
    expect(loca!.length).toBe(2783 + 1);
    expect(loca![0]).toBe(0);
    // The terminating offset is the total length of the glyph data, i.e. the whole 'glyf' table.
    expect(loca![2783]).toBe(sfnt.tables.get("glyf")?.length);
    expect(loca![2783]).toBe(503548);
  });

  it("reads Caladea Regular's short-format index, doubling each stored offset", () => {
    const { sfnt, options } = load(caladeaRegularBytes());
    const loca = parseLoca(sfnt, options);
    expect(loca).toBeDefined();
    expect(options.indexToLocFormat).toBe(0);
    expect(loca!.length).toBe(464 + 1);
    expect(loca![464]).toBe(sfnt.tables.get("glyf")?.length);
    expect(loca![464]).toBe(52572);
    // A short 'loca' can only address an even byte, which is why glyph data is padded to an even length.
    for (const offset of loca!) {
      expect(offset % 2).toBe(0);
    }
  });

  it("rises monotonically, so every glyph occupies a non-negative byte range", () => {
    for (const bytes of [carlitoRegularBytes(), caladeaRegularBytes()]) {
      const { sfnt, options } = load(bytes);
      const loca = parseLoca(sfnt, options)!;
      for (let i = 1; i < loca.length; i++) {
        expect(loca[i]!).toBeGreaterThanOrEqual(loca[i - 1]!);
      }
    }
  });

  it("returns undefined when the declared glyph count outruns the table", () => {
    const { sfnt, options } = load(caladeaRegularBytes());
    expect(
      parseLoca(sfnt, { ...options, numGlyphs: options.numGlyphs * 2 }),
    ).toBeUndefined();
  });
});

describe("glyphHeader", () => {
  it("reads Carlito Regular's 'A' as a real two-contour simple glyph with its own bounding box", () => {
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    const capitalA = glyphIdFor(0x41);
    expect(capitalA).toBe(3);
    const header = glyf.glyphHeader(capitalA);
    expect(header).toEqual({
      numberOfContours: 2,
      xMin: 8,
      yMin: 0,
      xMax: 1178,
      yMax: 1314,
    });
  });

  it("reads Caladea Regular's 'A' likewise, on its own 1000-unit grid", () => {
    const { glyf, glyphIdFor } = load(caladeaRegularBytes());
    const capitalA = glyphIdFor(0x41);
    expect(capitalA).toBe(5);
    expect(glyf.glyphHeader(capitalA)).toEqual({
      numberOfContours: 2,
      xMin: 1,
      yMin: 0,
      xMax: 596,
      yMax: 667,
    });
  });

  it("reports a space as a glyph with no outline at all rather than as an unreadable one", () => {
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    const space = glyphIdFor(0x20);
    expect(glyf.glyphBytes(space)?.length).toBe(0);
    expect(glyf.glyphHeader(space)).toBeUndefined();
    expect(glyf.compositeComponents(space)).toBeUndefined();
  });

  it("returns undefined for a glyph ID outside the font", () => {
    const { glyf } = load(caladeaRegularBytes());
    expect(glyf.numGlyphs).toBe(464);
    expect(glyf.glyphBytes(464)).toBeUndefined();
    expect(glyf.glyphBytes(-1)).toBeUndefined();
    expect(glyf.glyphHeader(10_000)).toBeUndefined();
  });
});

describe("compositeComponents", () => {
  it("walks Carlito Regular's 'e-acute' into its real base letter and accent components", () => {
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    const eAcute = glyphIdFor(0xe9);
    const lowercaseE = glyphIdFor(0x65);
    expect(eAcute).toBe(2007);
    expect(lowercaseE).toBe(59);

    expect(glyf.glyphHeader(eAcute)?.numberOfContours).toBeLessThan(0);
    const components = glyf.compositeComponents(eAcute);
    expect(components).toBeDefined();
    expect(components!.map((component) => component.glyphIndex)).toEqual([
      2781,
      lowercaseE,
      172,
    ]);

    // Every component places itself by x/y offset (not by matching point indices) and carries no transform of its own.
    for (const component of components!) {
      expect(component.argsAreXyValues).toBe(true);
      expect(component.transform).toBeUndefined();
    }
    // The base letter sits at the composite's own origin; the accent is shifted right to sit over it.
    const base = components!.find(
      (component) => component.glyphIndex === lowercaseE,
    );
    expect(base).toEqual({
      flags: 0x0022,
      glyphIndex: 59,
      argument1: 0,
      argument2: 0,
      argsAreXyValues: true,
      transform: undefined,
    });
    expect(components![2]).toEqual({
      flags: 0x0103,
      glyphIndex: 172,
      argument1: 312,
      argument2: 0,
      argsAreXyValues: true,
      transform: undefined,
    });

    // The base and the accent are both real, drawable simple glyphs — exactly what a subset that dropped them would lose.
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
    expect(components!.map((component) => component.glyphIndex)).toEqual([
      lowercaseE,
      289,
    ]);
    expect(components![0]).toEqual({
      flags: 0x0022,
      glyphIndex: 35,
      argument1: 0,
      argument2: 0,
      argsAreXyValues: true,
      transform: undefined,
    });
    expect(components![1]).toEqual({
      flags: 0x0003,
      glyphIndex: 289,
      argument1: 324,
      argument2: 0,
      argsAreXyValues: true,
      transform: undefined,
    });

    // This is the case one level of component walking is not enough for: glyph 289 (the acute accent) is a composite referring on to glyph 276, so a subset built from the first level alone would keep the accent's own entry and drop the outline it actually draws.
    expect(glyf.glyphHeader(289)?.numberOfContours).toBeLessThan(0);
    const nested = glyf.compositeComponents(289);
    expect(nested).toBeDefined();
    expect(nested!.map((component) => component.glyphIndex)).toEqual([276]);
    expect(glyf.glyphHeader(276)?.numberOfContours).toBeGreaterThan(0);
    expect(glyf.compositeComponents(276)).toBeUndefined(); // a simple glyph has no components to walk
  });

  it("walks every composite in both fonts without running off the end of a glyph", () => {
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

  it("counts the same composites the fonts really contain", () => {
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

  it("reports a truncated component list as unreadable rather than as a partial one", () => {
    const bytes = caladeaRegularBytes();
    const { sfnt, options, glyf, glyphIdFor } = load(bytes);
    const eAcute = glyphIdFor(0xe9);
    const loca = parseLoca(sfnt, options)!;
    const glyfTable = sfnt.tables.get("glyf");
    expect(glyfTable).toBeDefined();

    // Chop the composite's own entry short by moving its terminating 'loca' offset back over the second component record, leaving the first component's MORE_COMPONENTS bit pointing at bytes that are no longer there.
    expect(glyf.compositeComponents(eAcute)?.length).toBe(2);
    const truncated = new Uint8Array(bytes.length);
    truncated.set(bytes);
    const locaTable = sfnt.tables.get("loca");
    expect(locaTable).toBeDefined();
    const shortenedEnd = (loca[eAcute]! + 16) / 2; // the glyph header plus exactly the first component record, halved for the short loca format
    const view = new DataView(truncated.buffer);
    view.setUint16(locaTable!.offset + (eAcute + 1) * 2, shortenedEnd);

    const damaged = load(truncated);
    expect(damaged.glyf.compositeComponents(eAcute)).toBeUndefined();
  });
});

// Carlito Regular's own nominal vertical metrics ('hhea' ascent/descent at unitsPerEm 2048), read from the vendored file directly — the font-wide extent every glyph in the face shares, and the value per-glyph ink bounds exist to replace where a caller is sizing a box around particular characters.
const CARLITO_UNITS_PER_EM = 2048;
const CARLITO_NOMINAL_ASCENT = 1950;
const CARLITO_NOMINAL_DESCENT = -550;

describe("GlyfTable.glyphInkBounds", () => {
  it("reads a simple glyph's box straight out of its own header, where the format already states it", () => {
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    const x = glyphIdFor(0x78);
    expect(glyf.glyphHeader(x)?.numberOfContours).toBeGreaterThan(0);
    expect(glyf.glyphInkBounds(x)).toEqual({
      xMin: 23,
      yMin: 0,
      xMax: 864,
      yMax: 978,
    });
  });

  it("unions a composite's components under their own placement offsets", () => {
    // 'é' is three components: a zero-sized anchor point at (75, 0), 'e' unshifted, and the acute accent shifted 312 units right. Each component's own box and offset was read out of the vendored .ttf by a standalone script, and the union below also matches fontTools' own outline bounds for the assembled glyph.
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    const eAcute = glyphIdFor(0xe9);
    const components = glyf.compositeComponents(eAcute);
    expect(
      components?.map((component) => [
        component.glyphIndex,
        component.argument1,
        component.argument2,
      ]),
    ).toEqual([
      [2781, 75, 0],
      [59, 0, 0],
      [172, 312, 0],
    ]);
    expect(glyf.glyphInkBounds(59)).toEqual({
      xMin: 75,
      yMin: -14,
      xMax: 945,
      yMax: 993,
    }); // 'e' alone
    expect(glyf.glyphInkBounds(172)).toEqual({
      xMin: 81,
      yMin: 1123,
      xMax: 473,
      yMax: 1399,
    }); // the acute accent alone, before its 312-unit shift
    expect(glyf.glyphInkBounds(eAcute)).toEqual({
      xMin: 75,
      yMin: -14,
      xMax: 945,
      yMax: 1399,
    });
  });

  it("places a component whose own offset moves it below the baseline", () => {
    // Carlito builds its full stop as the dot accent shifted 1184 units DOWN, so the union has to apply the offset rather than trusting either the component's own box or the composite's declared one: the accent alone sits at y 1168..1416, and the full stop it becomes at -16..232.
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    expect(glyf.glyphInkBounds(193)).toEqual({
      xMin: 108,
      yMin: 1168,
      xMax: 355,
      yMax: 1416,
    }); // the dot accent alone
    expect(glyf.glyphInkBounds(glyphIdFor(0x2e))).toEqual({
      xMin: 134,
      yMin: -16,
      xMax: 381,
      yMax: 232,
    });
  });

  it("distinguishes a short glyph from a tall one, which the nominal metrics cannot", () => {
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    const period = glyf.glyphInkBounds(glyphIdFor(0x2e))!;
    const parenleft = glyf.glyphInkBounds(glyphIdFor(0x28))!;
    expect(period.yMax - period.yMin).toBe(248);
    expect(parenleft.yMax - parenleft.yMin).toBe(1781);
    expect(
      (parenleft.yMax - parenleft.yMin) / (period.yMax - period.yMin),
    ).toBeGreaterThan(7);
  });

  it("reports ink no taller or deeper than the nominal metrics for ordinary text glyphs", () => {
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    for (const codePoint of [0x2e, 0x28, 0x78, 0x41, 0x79, 0xe9]) {
      const box = glyf.glyphInkBounds(glyphIdFor(codePoint))!;
      expect(box.yMax).toBeLessThanOrEqual(CARLITO_NOMINAL_ASCENT);
      expect(box.yMin).toBeGreaterThanOrEqual(CARLITO_NOMINAL_DESCENT);
      expect(box.yMax - box.yMin).toBeLessThanOrEqual(
        CARLITO_NOMINAL_ASCENT - CARLITO_NOMINAL_DESCENT,
      );
    }
    // ... and by a wide margin for the shallowest of them: a full stop draws roughly an eighth of the vertical extent the face's own nominal metrics claim for every glyph alike.
    const period = glyf.glyphInkBounds(glyphIdFor(0x2e))!;
    expect(
      (period.yMax - period.yMin) /
        (CARLITO_NOMINAL_ASCENT - CARLITO_NOMINAL_DESCENT),
    ).toBeLessThan(0.11);
    expect(CARLITO_UNITS_PER_EM).toBe(2048); // the em the values above are stated in, asserted so a different vendored face swapped in here fails loudly rather than silently rescaling every number
  });

  it("reports undefined for a glyph that draws nothing and for one outside the font", () => {
    const { glyf, glyphIdFor } = load(carlitoRegularBytes());
    expect(glyf.glyphBytes(glyphIdFor(0x20))?.length).toBe(0); // a space: a legitimately zero-length 'loca' entry
    expect(glyf.glyphInkBounds(glyphIdFor(0x20))).toBeUndefined();
    expect(glyf.glyphInkBounds(glyf.numGlyphs)).toBeUndefined();
  });

  it("agrees with Caladea too, a second real face with its own composite conventions", () => {
    const { glyf, glyphIdFor } = load(caladeaRegularBytes());
    const period = glyf.glyphInkBounds(glyphIdFor(0x2e))!;
    const parenleft = glyf.glyphInkBounds(glyphIdFor(0x28))!;
    expect(period.yMax - period.yMin).toBeLessThan(
      parenleft.yMax - parenleft.yMin,
    );
    expect(glyf.glyphInkBounds(glyphIdFor(0xe9))!.yMax).toBeGreaterThan(
      glyf.glyphInkBounds(glyphIdFor(0x65))!.yMax,
    ); // an accented 'e' reaches higher than a bare one
  });
});

// Hand-built 'glyf'/'loca' fixtures, for the composite shapes the vendored fonts happen not to
// contain: every argument width, every transform flag, both offset-offset flags, the point-
// matching and depth refusals, and the malformed loca entries.
describe("parseGlyf over hand-built tables", () => {
  function u16be(n: number): number[] {
    return [(n >> 8) & 0xff, n & 0xff];
  }
  function i16be(n: number): number[] {
    return u16be(n < 0 ? n + 0x10000 : n);
  }
  function f2dot14Bytes(value: number): number[] {
    return i16be(Math.round(value * 0x4000));
  }

  function simpleGlyph(
    box: [number, number, number, number],
    contours = 1,
  ): number[] {
    return [
      ...i16be(contours),
      ...i16be(box[0]),
      ...i16be(box[1]),
      ...i16be(box[2]),
      ...i16be(box[3]),
    ];
  }

  function compositeGlyph(
    records: readonly {
      readonly flags: number;
      readonly glyphIndex: number;
      readonly args: readonly number[];
      readonly transform?: readonly number[];
    }[],
  ): number[] {
    const bytes: number[] = [
      ...i16be(-1),
      ...i16be(0),
      ...i16be(0),
      ...i16be(0),
      ...i16be(0),
    ];
    for (const [index, record] of records.entries()) {
      const more = index < records.length - 1 ? 0x0020 : 0;
      bytes.push(...u16be(record.flags | more), ...u16be(record.glyphIndex));
      bytes.push(...record.args, ...(record.transform ?? []));
    }
    return bytes;
  }

  function fontWithGlyphs(
    glyphs: readonly number[][],
    indexToLocFormat: 0 | 1 = 1,
  ): GlyfTable {
    const glyf: number[] = [];
    const loca: number[] = [];
    for (const glyph of glyphs) {
      if (glyf.length % 2 === 1) {
        glyf.push(0); // glyph data is padded to an even length (clause 5.3.2)
      }
      loca.push(glyf.length);
      glyf.push(...glyph);
    }
    loca.push(glyf.length);
    const locaBytes = new Uint8Array(
      loca.flatMap((offset) =>
        indexToLocFormat === 1
          ? [
              (offset >>> 24) & 0xff,
              (offset >>> 16) & 0xff,
              (offset >>> 8) & 0xff,
              offset & 0xff,
            ]
          : u16be(offset / 2),
      ),
    );
    const sfnt = parseSfnt(
      buildSfnt(
        new Map<string, Uint8Array<ArrayBuffer>>([
          ["glyf", new Uint8Array(glyf)],
          ["loca", locaBytes],
        ]),
      ),
    );
    if (sfnt === undefined) {
      throw new Error("hand-built font failed to parse as an sfnt container");
    }
    const table = parseGlyf(sfnt, {
      numGlyphs: glyphs.length,
      indexToLocFormat,
    });
    if (table === undefined) {
      throw new Error("hand-built font has no readable glyf/loca");
    }
    return table;
  }

  const XY_BYTE_FLAGS = 0x0002;
  const XY_WORD_FLAGS = 0x0001 | 0x0002;
  const MATCH_BYTE_FLAGS = 0;
  const MATCH_WORD_FLAGS = 0x0001;

  it("reads byte-sized signed x/y placement arguments at both sign edges", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([
        { flags: XY_BYTE_FLAGS, glyphIndex: 0, args: [0x80, 0x7f] }, // -128, 127
      ]),
    ]);
    const component = glyf.compositeComponents(1)?.[0];
    expect(component?.argsAreXyValues).toBe(true);
    expect(component?.argument1).toBe(-128);
    expect(component?.argument2).toBe(127);
  });

  it("reads word-sized signed x/y placement arguments", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([
        {
          flags: XY_WORD_FLAGS,
          glyphIndex: 0,
          args: [...i16be(-3000), ...i16be(3000)],
        },
      ]),
    ]);
    const component = glyf.compositeComponents(1)?.[0];
    expect(component?.argument1).toBe(-3000);
    expect(component?.argument2).toBe(3000);
  });

  it("reads byte-sized unsigned point-matching arguments, uninterpreted as coordinates", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([
        { flags: MATCH_BYTE_FLAGS, glyphIndex: 0, args: [0xc0, 0x03] },
      ]),
    ]);
    const component = glyf.compositeComponents(1)?.[0];
    expect(component?.argsAreXyValues).toBe(false);
    expect(component?.argument1).toBe(0xc0); // 192, a point index, not -64
    expect(component?.argument2).toBe(3);
  });

  it("reads word-sized unsigned point-matching arguments", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([
        {
          flags: MATCH_WORD_FLAGS,
          glyphIndex: 0,
          args: [...u16be(400), ...u16be(900)],
        },
      ]),
    ]);
    const component = glyf.compositeComponents(1)?.[0];
    expect(component?.argsAreXyValues).toBe(false);
    expect(component?.argument1).toBe(400);
    expect(component?.argument2).toBe(900);
  });

  it("reads a component with a single shared scale", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 20]),
      compositeGlyph([
        {
          flags: XY_BYTE_FLAGS | 0x0008,
          glyphIndex: 0,
          args: [0, 0],
          transform: f2dot14Bytes(1.5),
        },
      ]),
    ]);
    const component = glyf.compositeComponents(1)?.[0];
    expect(component?.transform).toEqual([1.5, 0, 0, 1.5]);
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 15,
      yMax: 30,
    });
  });

  it("reads a component with separate x and y scales", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 20]),
      compositeGlyph([
        {
          flags: XY_BYTE_FLAGS | 0x0040,
          glyphIndex: 0,
          args: [0, 0],
          transform: [...f2dot14Bytes(1.5), ...f2dot14Bytes(0.5)],
        },
      ]),
    ]);
    const component = glyf.compositeComponents(1)?.[0];
    expect(component?.transform).toEqual([1.5, 0, 0, 0.5]);
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 15,
      yMax: 10,
    });
  });

  it("reads a component with a full 2x2 transform, skewing the box's corners", () => {
    // [a b c d] = [1, 0.5, 0, 1]: corner (10, 0) maps to (10, 5), so the union is not the
    // transform of the min/max pair alone.
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([
        {
          flags: XY_BYTE_FLAGS | 0x0080,
          glyphIndex: 0,
          args: [0, 0],
          transform: [
            ...f2dot14Bytes(1),
            ...f2dot14Bytes(0.5),
            ...f2dot14Bytes(0),
            ...f2dot14Bytes(1),
          ],
        },
      ]),
    ]);
    expect(glyf.compositeComponents(1)?.[0]?.transform).toEqual([1, 0.5, 0, 1]);
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 10,
      yMax: 15,
    });
  });

  it("reads a component whose 2x2 transform mixes both cross terms", () => {
    // [a b c d] = [1, 0, 0.5, 1]: corner (0, 10) maps to (5, 10), which an a*x - c*y reading
    // of the x axis would move the wrong way.
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([
        {
          flags: XY_BYTE_FLAGS | 0x0080,
          glyphIndex: 0,
          args: [0, 0],
          transform: [
            ...f2dot14Bytes(1),
            ...f2dot14Bytes(0),
            ...f2dot14Bytes(0.5),
            ...f2dot14Bytes(1),
          ],
        },
      ]),
    ]);
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 15,
      yMax: 10,
    });
  });

  it("treats a component with no transform flags as the identity", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([{ flags: XY_BYTE_FLAGS, glyphIndex: 0, args: [5, 7] }]),
    ]);
    expect(glyf.compositeComponents(1)?.[0]?.transform).toBeUndefined();
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 5,
      yMin: 7,
      xMax: 15,
      yMax: 17,
    });
  });

  it("puts a SCALED_COMPONENT_OFFSET component's offset through the transform", () => {
    // Offset (10, 10) under [1.5, 0, 0, 1.5] lands at (15, 15), not (10, 10).
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([
        {
          flags: XY_BYTE_FLAGS | 0x0008 | 0x0800,
          glyphIndex: 0,
          args: [10, 10],
          transform: f2dot14Bytes(1.5),
        },
      ]),
    ]);
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 15,
      yMin: 15,
      xMax: 30,
      yMax: 30,
    });
  });

  it("keeps an offset unscaled when both offset flags are set, UNSCALED winning", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([
        {
          flags: XY_BYTE_FLAGS | 0x0008 | 0x0800 | 0x1000,
          glyphIndex: 0,
          args: [10, 10],
          transform: f2dot14Bytes(1.5),
        },
      ]),
    ]);
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 10,
      yMin: 10,
      xMax: 25,
      yMax: 25,
    });
  });

  it("reads several components under MORE_COMPONENTS, each with its own shape", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([
        { flags: XY_BYTE_FLAGS, glyphIndex: 0, args: [0, 0] },
        {
          flags: XY_BYTE_FLAGS | 0x0008,
          glyphIndex: 0,
          args: [20, 0],
          transform: f2dot14Bytes(1),
        },
      ]),
    ]);
    expect(glyf.compositeComponents(1)).toHaveLength(2);
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 30,
      yMax: 10,
    });
  });

  it("reports a composite unreadable when its declared transform is truncated", () => {
    for (const [label, flag, transformBytes] of [
      ["a shared scale", 0x0008, f2dot14Bytes(1.5), 2],
      [
        "separate x and y scales",
        0x0040,
        [...f2dot14Bytes(1.5), ...f2dot14Bytes(0.5)],
        4,
      ],
      [
        "a 2x2 transform",
        0x0080,
        [
          ...f2dot14Bytes(1),
          ...f2dot14Bytes(0),
          ...f2dot14Bytes(0.5),
          ...f2dot14Bytes(1),
        ],
        8,
      ],
    ] as const) {
      const glyph = compositeGlyph([
        {
          flags: XY_BYTE_FLAGS | flag,
          glyphIndex: 0,
          args: [0, 0],
          transform: [...transformBytes],
        },
      ]);
      glyph.length = glyph.length - 1; // cut into the transform, leaving the record header intact
      const glyf = fontWithGlyphs([simpleGlyph([0, 0, 10, 10]), glyph]);
      expect(glyf.compositeComponents(1), label).toBeUndefined();
    }
  });

  it("reports a composite unreadable when its arguments are truncated", () => {
    const glyph = compositeGlyph([
      { flags: XY_WORD_FLAGS, glyphIndex: 0, args: [...i16be(5), ...i16be(5)] },
    ]);
    glyph.length = glyph.length - 3; // into the second word argument
    const glyf = fontWithGlyphs([simpleGlyph([0, 0, 10, 10]), glyph]);
    expect(glyf.compositeComponents(1)).toBeUndefined();
  });

  it("reads a simple glyph whose contour count is zero, box and all", () => {
    const glyf = fontWithGlyphs([simpleGlyph([-20, -30, 40, 50], 0)]);
    expect(glyf.compositeComponents(0)).toBeUndefined();
    expect(glyf.glyphInkBounds(0)).toEqual({
      xMin: -20,
      yMin: -30,
      xMax: 40,
      yMax: 50,
    });
  });

  it("returns no bytes for a glyph whose loca entry runs backwards", () => {
    // A loca whose second offset precedes its first is malformed, and the byte view reports
    // undefined rather than an empty or inverted slice.
    const glyfGlyphs: number[][] = [simpleGlyph([0, 0, 10, 10])];
    const glyf: number[] = [];
    const loca: number[] = [];
    for (const glyph of glyfGlyphs) {
      loca.push(glyf.length);
      glyf.push(...glyph);
    }
    loca.push(glyf.length);
    // Glyph 0's own extent now runs backwards: [8, 10) becomes [8, 10) with start moved past end.
    loca[0] = loca[1]! + 2;
    const locaBytes = new Uint8Array(
      loca.flatMap((offset) => [
        (offset >>> 24) & 0xff,
        (offset >>> 16) & 0xff,
        (offset >>> 8) & 0xff,
        offset & 0xff,
      ]),
    );
    const sfnt = parseSfnt(
      buildSfnt(
        new Map<string, Uint8Array<ArrayBuffer>>([
          ["glyf", new Uint8Array(glyf)],
          ["loca", locaBytes],
        ]),
      ),
    );
    const table = parseGlyf(sfnt!, {
      numGlyphs: 1,
      indexToLocFormat: 1,
    });
    expect(table?.glyphBytes(0)).toBeUndefined();
  });

  it("refuses an ink box for a composite placed by point matching, rather than guessing", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([
        { flags: MATCH_BYTE_FLAGS, glyphIndex: 0, args: [1, 2] },
      ]),
    ]);
    expect(glyf.glyphInkBounds(1)).toBeUndefined();
  });

  it("unions around a component that draws nothing at all", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      [], // an empty glyph: loca entry of zero length
      compositeGlyph([
        { flags: XY_BYTE_FLAGS, glyphIndex: 1, args: [0, 0] },
        { flags: XY_BYTE_FLAGS, glyphIndex: 0, args: [100, 0] },
      ]),
    ]);
    expect(glyf.glyphInkBounds(2)).toEqual({
      xMin: 100,
      yMin: 0,
      xMax: 110,
      yMax: 10,
    });
  });

  it("refuses an ink box for a composite nested past the depth bound, at exactly the boundary", () => {
    // A chain of six composites: the deepest sits at depth 5, one past the bound, so the whole
    // chain reports undefined rather than a box missing its deepest piece.
    const glyphs: number[][] = [simpleGlyph([0, 0, 10, 10])];
    for (let level = 0; level < 6; level++) {
      glyphs.push(
        compositeGlyph([
          { flags: XY_BYTE_FLAGS, glyphIndex: level, args: [0, 0] },
        ]),
      );
    }
    const glyf = fontWithGlyphs(glyphs);
    expect(glyf.glyphInkBounds(6)).toBeUndefined();
    // Five levels of nesting resolve: the chain of five reports the base glyph's box.
    expect(glyf.glyphInkBounds(5)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 10,
      yMax: 10,
    });
  });

  it("refuses an ink box for a composite whose component glyph ID is outside the font", () => {
    const glyf = fontWithGlyphs([
      simpleGlyph([0, 0, 10, 10]),
      compositeGlyph([{ flags: XY_BYTE_FLAGS, glyphIndex: 9, args: [0, 0] }]),
    ]);
    expect(glyf.glyphInkBounds(1)).toBeUndefined();
  });

  it("reads the short loca format, doubling every stored offset", () => {
    const glyf = fontWithGlyphs(
      [simpleGlyph([0, 0, 10, 10]), simpleGlyph([0, 0, 4, 4])],
      0,
    );
    // Both glyphs occupy non-zero even offsets, so the halved storage is exercised.
    expect(glyf.glyphBytes(1)?.length).toBe(10);
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 4,
      yMax: 4,
    });
  });
});

describe("parseLoca over hand-built tables", () => {
  function locaFont(
    locaOffsets: readonly number[],
    indexToLocFormat: 0 | 1,
    numGlyphs: number,
  ) {
    const locaBytes = new Uint8Array(
      locaOffsets.flatMap((offset) =>
        indexToLocFormat === 1
          ? [
              (offset >>> 24) & 0xff,
              (offset >>> 16) & 0xff,
              (offset >>> 8) & 0xff,
              offset & 0xff,
            ]
          : [((offset / 2) >> 8) & 0xff, (offset / 2) & 0xff],
      ),
    );
    const sfnt = parseSfnt(
      buildSfnt(
        new Map<string, Uint8Array<ArrayBuffer>>([
          ["glyf", new Uint8Array(32)],
          ["loca", locaBytes],
        ]),
      ),
    );
    return parseLoca(sfnt!, { numGlyphs, indexToLocFormat });
  }

  it("reads a long-format index whose offsets need all four bytes", () => {
    const offsets = locaFont([0, 0x10203, 0x10203], 1, 2);
    expect(offsets).toEqual([0, 0x10203, 0x10203]);
  });

  it("returns undefined for a long-format index truncated past its own entry size", () => {
    // Three long entries need 12 bytes; 8 are present, enough for a short-format check to pass
    // but not for the reads the format requires.
    const offsets = locaFont([0, 16], 1, 2);
    expect(offsets).toBeUndefined();
  });

  it("reads a short-format index with offsets that need the doubling", () => {
    // The builder halves each offset on the way in, so the decoder's doubling returns it.
    const offsets = locaFont([0, 6, 10], 0, 2);
    expect(offsets).toEqual([0, 6, 10]);
  });
});

describe("parseGlyf: composite record offsets", () => {
  const u16be = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
  const i16be = (n: number): number[] => u16be(n < 0 ? n + 0x10000 : n);

  function rawFont(glyphs: readonly number[][]): GlyfTable {
    const glyf: number[] = [];
    const loca: number[] = [];
    for (const glyph of glyphs) {
      if (glyf.length % 2 === 1) {
        glyf.push(0);
      }
      loca.push(glyf.length);
      glyf.push(...glyph);
    }
    loca.push(glyf.length);
    const locaBytes = new Uint8Array(
      loca.flatMap((offset) => [
        (offset >>> 24) & 0xff,
        (offset >>> 16) & 0xff,
        (offset >>> 8) & 0xff,
        offset & 0xff,
      ]),
    );
    const sfnt = parseSfnt(
      buildSfnt(
        new Map<string, Uint8Array<ArrayBuffer>>([
          ["glyf", new Uint8Array(glyf)],
          ["loca", locaBytes],
        ]),
      ),
    );
    const table = parseGlyf(sfnt!, {
      numGlyphs: glyphs.length,
      indexToLocFormat: 1,
    });
    if (table === undefined) {
      throw new Error("fixture failed to parse");
    }
    return table;
  }

  it("advances past a first component's transform to read the second component", () => {
    const composite = [
      ...i16be(-1),
      ...i16be(0),
      ...i16be(0),
      ...i16be(0),
      ...i16be(0),
      // First component: byte x/y args and a shared scale.
      ...u16be(0x0002 | 0x0008 | 0x0020),
      ...u16be(0),
      3,
      4,
      0x60,
      0x00,
      // Second component: byte x/y args, no transform, last record.
      ...u16be(0x0002),
      ...u16be(0),
      40,
      50,
    ];
    const glyf = rawFont([
      [...i16be(1), ...i16be(0), ...i16be(0), ...i16be(10), ...i16be(10)],
      composite,
    ]);
    const components = glyf.compositeComponents(1);
    expect(components).toHaveLength(2);
    expect(components?.[1]?.argument1).toBe(40);
    expect(components?.[1]?.argument2).toBe(50);
    // The union covers both placements: [3,4] for the first and [40,50] for the second.
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 3,
      yMin: 4,
      xMax: 50,
      yMax: 60,
    });
  });

  it("advances past the wider transforms too, reading the component that follows", () => {
    for (const [label, flag, transform] of [
      ["separate x and y scales", 0x0040, [...u16be(0x6000), ...u16be(0x2000)]],
      [
        "a 2x2 transform",
        0x0080,
        [...u16be(0x4000), ...u16be(0), ...u16be(0x2000), ...u16be(0x4000)],
      ],
    ] as const) {
      const composite = [
        ...i16be(-1),
        ...i16be(0),
        ...i16be(0),
        ...i16be(0),
        ...i16be(0),
        ...u16be(0x0002 | flag | 0x0020),
        ...u16be(0),
        3,
        4,
        ...transform,
        ...u16be(0x0002),
        ...u16be(0),
        40,
        50,
      ];
      const glyf = rawFont([
        [...i16be(1), ...i16be(0), ...i16be(0), ...i16be(10), ...i16be(10)],
        composite,
      ]);
      const components = glyf.compositeComponents(1);
      expect(components?.[1]?.argument1, label).toBe(40);
      expect(components?.[1]?.argument2, label).toBe(50);
    }
  });

  it("puts a scaled offset through a 2x2 transform's cross terms", () => {
    // [a b c d] = [1, 0, 0.5, 1] with offset (10, 10): dx = 1*10 + 0.5*10 = 15,
    // dy = 0*10 + 1*10 = 10 — both cross terms decide the placement.
    const composite = [
      ...i16be(-1),
      ...i16be(0),
      ...i16be(0),
      ...i16be(0),
      ...i16be(0),
      ...u16be(0x0002 | 0x0080 | 0x0800),
      ...u16be(0),
      10,
      10,
      ...u16be(0x4000),
      ...u16be(0),
      ...u16be(0x2000),
      ...u16be(0x4000),
    ];
    const glyf = rawFont([
      [...i16be(1), ...i16be(0), ...i16be(0), ...i16be(10), ...i16be(10)],
      composite,
    ]);
    expect(glyf.glyphInkBounds(1)).toEqual({
      xMin: 15,
      yMin: 10,
      xMax: 30,
      yMax: 20,
    });

    // The same transform family with BOTH cross terms non-zero: [1, 0.5, 0.5, 1] and offset
    // (10, 10) give dx = 15 and dy = 15, so every term of both formulas decides the placement.
    const skewed = [
      ...i16be(-1),
      ...i16be(0),
      ...i16be(0),
      ...i16be(0),
      ...i16be(0),
      ...u16be(0x0002 | 0x0080 | 0x0800),
      ...u16be(0),
      10,
      10,
      ...u16be(0x4000),
      ...u16be(0x2000),
      ...u16be(0x2000),
      ...u16be(0x4000),
    ];
    const skewedFont = rawFont([
      [...i16be(1), ...i16be(0), ...i16be(0), ...i16be(10), ...i16be(10)],
      skewed,
    ]);
    expect(skewedFont.glyphInkBounds(1)).toEqual({
      xMin: 15,
      yMin: 15,
      xMax: 30,
      yMax: 30,
    });
  });

  it("treats a zero-contour glyph with trailing bytes as simple, not as a composite", () => {
    // numberOfContours 0 with bytes after the header that would parse as a component record:
    // a zero-contour glyph is a simple glyph with no outline, whatever follows.
    const glyph = [
      ...i16be(0),
      ...i16be(-5),
      ...i16be(-6),
      ...i16be(7),
      ...i16be(8),
      ...u16be(0x0002),
      ...u16be(0),
      1,
      2,
    ];
    const glyf = rawFont([glyph]);
    expect(glyf.compositeComponents(0)).toBeUndefined();
    expect(glyf.glyphInkBounds(0)).toEqual({
      xMin: -5,
      yMin: -6,
      xMax: 7,
      yMax: 8,
    });
  });
});
