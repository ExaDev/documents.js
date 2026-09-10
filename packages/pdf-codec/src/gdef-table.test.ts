import { describe, expect, it } from "vitest";
import { buildCmapLookup } from "./cmap-table";
import {
  GLYPH_CLASS_BASE,
  GLYPH_CLASS_LIGATURE,
  GLYPH_CLASS_MARK,
  GLYPH_CLASS_UNCLASSIFIED,
  parseGdefTable,
} from "./gdef-table";
import { parseSfnt } from "./sfnt";
import type { SfntFont } from "./sfnt";
import {
  buildClassDefFormat1,
  buildClassDefFormat2,
  buildCoverageFormat1,
  buildGdefTable,
  buildSfnt,
} from "./test-support/sfnt";
import { caladeaItalicBytes, carlitoRegularBytes } from "./test-support/fonts";

// The real-font assertions below state glyph classes read out of the vendored .ttf files, cross-checked against a standalone fontTools dump of the same tables made while these tests were written (the discipline test-support/fonts.ts states for its metric values): Carlito classifies its ligature glyphs as class 2 and its combining marks as class 3, Caladea Italic classifies fi (gid 259) and uni0308 (gid 289) the same way, and neither face declares a MarkAttachClassDef at all — the high byte of a lookupFlag could only ever resolve to class 0 against these fonts.

function parse(bytes: Uint8Array<ArrayBuffer>): SfntFont {
  const font = parseSfnt(bytes);
  if (font === undefined) {
    throw new Error("font failed to parse as an sfnt container");
  }
  return font;
}

describe("parseGdefTable: the vendored faces", () => {
  it("classifies ligature glyphs, bases, and combining marks in Carlito Regular", () => {
    const font = parse(carlitoRegularBytes());
    const gdef = parseGdefTable(font);
    if (gdef === undefined) {
      throw new Error("Carlito Regular carries a GDEF the reader refused");
    }
    // Glyph 67 is Carlito's 'fi' ligature (the glyph gsub-table.test.ts shapes 'fi' into); glyph 61 is plain 'f'.
    expect(gdef.glyphClass(67)).toBe(GLYPH_CLASS_LIGATURE);
    expect(gdef.glyphClass(61)).toBe(GLYPH_CLASS_BASE);
    const cmap = buildCmapLookup(font);
    // U+02DE (modifier letter rhotic hook) is the first mark Carlito's cmap reaches; Carlito maps none of the U+0300 combining block.
    const rhoticHook = cmap?.(0x02de);
    if (rhoticHook === undefined) {
      throw new Error("Carlito Regular has no glyph for U+02DE");
    }
    expect(gdef.glyphClass(rhoticHook)).toBe(GLYPH_CLASS_MARK);
  });

  it("classifies Caladea Italic's fi ligature and combining diaeresis, and leaves plain 'f' unclassified", () => {
    const gdef = parseGdefTable(parse(caladeaItalicBytes()));
    if (gdef === undefined) {
      throw new Error("Caladea Italic carries a GDEF the reader refused");
    }
    // Glyph 259 is the fi ligature hb-shape produces for Caladea Italic 'fi'; glyph 289 is uni0308, the mark the ignore-marks ligature test skips over. Caladea's GDEF classifies marks and ligatures but not every base — plain 'f' (36) is genuinely unclassified, which is why the class-0 catch-all is a real answer rather than an error.
    expect(gdef.glyphClass(259)).toBe(GLYPH_CLASS_LIGATURE);
    expect(gdef.glyphClass(36)).toBe(GLYPH_CLASS_UNCLASSIFIED);
    expect(gdef.glyphClass(289)).toBe(GLYPH_CLASS_MARK);
  });

  it("answers mark-attachment class 0 for every glyph of faces that declare no MarkAttachClassDef", () => {
    // Both vendored families ship GDEF 1.0 with only a GlyphClassDef — the probe above confirms offsets 0 — so class 0 is not a fallback here but the fonts' own statement that every mark belongs to no attachment class.
    const gdef = parseGdefTable(parse(carlitoRegularBytes()));
    expect(gdef?.markAttachClass(0)).toBe(0);
    expect(gdef?.markAttachClass(289)).toBe(0);
    expect(gdef?.markFilteringSetCovers(0, 289)).toBe(false);
  });

  it("answers undefined for a font with no GDEF at all", () => {
    // The filler table is a 'cmap'-tagged Coverage blob: the test needs any sfnt that carries no GDEF, and the tag's meaning is irrelevant to a reader that must not find one.
    expect(
      parseGdefTable(
        parse(buildSfnt(new Map([["cmap", buildCoverageFormat1([0])]]))),
      ),
    ).toBeUndefined();
  });
});

describe("parseGdefTable: hand-built tables", () => {
  it("reads a version 1.0 table's glyph classes and mark attachment classes", () => {
    // Glyphs 2 and 3 are bases, 4 a ligature, 5 and 6 marks; the MarkAttachClassDef splits the marks into attachment classes: 5 in class 1, 6 in class 2.
    const font = parse(
      buildSfnt(
        new Map([
          [
            "GDEF",
            buildGdefTable({
              glyphClassDef: buildClassDefFormat1(2, [
                GLYPH_CLASS_BASE,
                GLYPH_CLASS_BASE,
                GLYPH_CLASS_LIGATURE,
                GLYPH_CLASS_MARK,
                GLYPH_CLASS_MARK,
              ]),
              markAttachClassDef: buildClassDefFormat2([
                [5, 5, 1],
                [6, 6, 2],
              ]),
            }),
          ],
        ]),
      ),
    );
    const gdef = parseGdefTable(font);
    if (gdef === undefined) {
      throw new Error("the hand-built GDEF failed to parse");
    }
    expect(gdef.glyphClass(2)).toBe(GLYPH_CLASS_BASE);
    expect(gdef.glyphClass(4)).toBe(GLYPH_CLASS_LIGATURE);
    expect(gdef.glyphClass(5)).toBe(GLYPH_CLASS_MARK);
    expect(gdef.glyphClass(7)).toBe(GLYPH_CLASS_UNCLASSIFIED);
    expect(gdef.markAttachClass(5)).toBe(1);
    expect(gdef.markAttachClass(6)).toBe(2);
    expect(gdef.markAttachClass(7)).toBe(0);
    // No MarkGlyphSets in a 1.0 table: every filtering-set query answers false.
    expect(gdef.markFilteringSetCovers(0, 5)).toBe(false);
  });

  it("reads a version 1.2 table's mark glyph sets, and answers false for an undeclared set index", () => {
    const font = parse(
      buildSfnt(
        new Map([
          [
            "GDEF",
            buildGdefTable({
              glyphClassDef: buildClassDefFormat1(2, [GLYPH_CLASS_MARK]),
              markGlyphSets: [
                buildCoverageFormat1([5]),
                buildCoverageFormat1([6, 7]),
              ],
            }),
          ],
        ]),
      ),
    );
    const gdef = parseGdefTable(font);
    if (gdef === undefined) {
      throw new Error("the hand-built GDEF 1.2 failed to parse");
    }
    expect(gdef.markFilteringSetCovers(0, 5)).toBe(true);
    expect(gdef.markFilteringSetCovers(0, 6)).toBe(false);
    expect(gdef.markFilteringSetCovers(1, 6)).toBe(true);
    expect(gdef.markFilteringSetCovers(1, 7)).toBe(true);
    // A set index beyond the declared sets is "no such set", not an alias of another set.
    expect(gdef.markFilteringSetCovers(2, 5)).toBe(false);
  });
});
