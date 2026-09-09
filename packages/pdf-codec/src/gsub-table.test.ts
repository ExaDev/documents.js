import { describe, expect, it } from "vitest";
import { buildCmapLookup } from "./cmap-table";
import { buildGsubShaper } from "./gsub-table";
import type { SfntFont } from "./sfnt";
import { parseSfnt } from "./sfnt";
import {
  caladeaRegularBytes,
  carlitoBoldBytes,
  carlitoRegularBytes,
} from "./test-support/fonts";

// Every glyph ID asserted below is the real ligature glyph the real vendored font declares, the same cross-checked-fixture discipline gpos-table.test.ts applies to its kerning values: the shaped results were confirmed against HarfBuzz's own `hb-shape` output for the same text in the same faces before being written down here.

function parse(bytes: Uint8Array<ArrayBuffer>): SfntFont {
  const font = parseSfnt(bytes);
  if (font === undefined) {
    throw new Error("font failed to parse as an sfnt container");
  }
  return font;
}

function shapedGlyphIds(
  bytes: Uint8Array<ArrayBuffer>,
  text: string,
): { readonly glyphIds: number[]; readonly spans: number[] } | undefined {
  const font = parse(bytes);
  const shaper = buildGsubShaper(font);
  const cmap = buildCmapLookup(font);
  if (cmap === undefined) {
    throw new Error("font failed to yield a cmap lookup");
  }
  const resolved = [...text].map(
    (character) => cmap(character.codePointAt(0)!) ?? 0,
  );
  if (shaper === undefined) {
    return undefined;
  }
  return shaper(resolved);
}

describe("buildGsubShaper: the vendored Carlito faces", () => {
  it("shapes the common Latin ligatures to their real ligature glyphs", () => {
    expect(shapedGlyphIds(carlitoRegularBytes(), "fi")).toEqual({
      glyphIds: [67],
      spans: [2],
    });
    expect(shapedGlyphIds(carlitoRegularBytes(), "ff")).toEqual({
      glyphIds: [64],
      spans: [2],
    });
    expect(shapedGlyphIds(carlitoRegularBytes(), "fl")).toEqual({
      glyphIds: [89],
      spans: [2],
    });
    // The three-component ligature consumes three input glyphs, which is what proves the span arithmetic beyond the pair case.
    expect(shapedGlyphIds(carlitoRegularBytes(), "ffi")).toEqual({
      glyphIds: [76],
      spans: [3],
    });
  });

  it("applies a ligature mid-word and leaves the surrounding glyphs untouched", () => {
    // 'office' resolves its inner 'ffi' to glyph 76 while the o, c, e pass through as their own glyphs (111, 49, 59): one ligature, four output glyphs, spans summing to the six input glyphs.
    expect(shapedGlyphIds(carlitoRegularBytes(), "office")).toEqual({
      glyphIds: [111, 76, 49, 59],
      spans: [1, 3, 1, 1],
    });
  });

  it("passes text with no ligature through unchanged, one glyph per span", () => {
    const bytes = carlitoRegularBytes();
    const font = parse(bytes);
    const cmap = buildCmapLookup(font);
    if (cmap === undefined) {
      throw new Error("Carlito Regular failed to yield a cmap lookup");
    }
    const raw = Array.from(
      "xaq",
      (character) => cmap(character.codePointAt(0)!) ?? 0,
    );
    expect(shapedGlyphIds(bytes, "xaq")).toEqual({
      glyphIds: raw,
      spans: [1, 1, 1],
    });
  });

  it("shapes the bold face identically for the shared Latin ligatures", () => {
    expect(shapedGlyphIds(carlitoBoldBytes(), "fi")).toEqual({
      glyphIds: [67],
      spans: [2],
    });
  });
});

describe("buildGsubShaper: faces with nothing to apply", () => {
  it("answers undefined for Caladea, whose GSUB declares no liga under the Latin default language system", () => {
    // Caladea's GSUB exists (small-caps and case features) but enables no 'liga'/'rlig' lookups its 'latn' default language system reaches, so there is nothing this package applies -- and `undefined` (not an identity shaper) is what lets embedded-font.ts skip the pass entirely.
    expect(buildGsubShaper(parse(caladeaRegularBytes()))).toBeUndefined();
  });
});
