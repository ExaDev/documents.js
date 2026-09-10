import { describe, expect, it } from "vitest";
import { buildCmapLookup } from "./cmap-table";
import { buildGsubShaper } from "./gsub-table";
import type { GsubShaper } from "./gsub-table";
import type { SfntFont } from "./sfnt";
import { parseSfnt } from "./sfnt";
import {
  buildChainContextFormat1,
  buildChainContextFormat2,
  buildClassDefFormat1,
  buildClassDefFormat2,
  buildContextFormat1,
  buildContextFormat2,
  buildCoverageFormat1,
  buildExtensionSubst,
  buildFormat3Subtable,
  buildGdefTable,
  buildGsubTable,
  buildLigatureSubstFormat1,
  buildSingleSubstFormat2,
  buildSfnt,
} from "./test-support/sfnt";
import {
  caladeaItalicBytes,
  caladeaRegularBytes,
  carlitoBoldBytes,
  carlitoRegularBytes,
} from "./test-support/fonts";

// Every glyph ID asserted against the vendored faces below is the real shaped output the real font declares, the same cross-checked-fixture discipline gpos-table.test.ts applies to its kerning values: the ligature, calt, and dlig results were confirmed against HarfBuzz's own `hb-shape` output for the same text in the same faces before being written down here (calt checked with `-liga` so the two features' contributions stay separable, dlig with `-liga,+dlig`). The hand-built-table tests at the bottom cover the lookup formats the vendored fonts do not ship, through fixtures laid out byte by byte in test-support/sfnt.ts.

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

describe("buildGsubShaper: contextual alternates (calt) in the vendored Carlito faces", () => {
  // Carlito's 'calt' is the Greek uppercase accent discipline, carried by two Chaining Contextual format 3 lookups whose nested Single Substitutions hb-shape applies the same way: an accented vowel before another vowel drops its accent (Ά→Α), and an iota or upsilon after an accented vowel takes a dialytika (Ι→Ϊ). The order the two lookups apply in is observable and pinned here: the dialytika lookup runs FIRST, matching its backtrack against the still-accented vowel, and only then does the accent-dropping lookup run with the dialytika glyph in its lookahead — the per-lookup-pass model the shaper states.
  it("shapes accented-vowel-plus-iota exactly as HarfBuzz shapes it", () => {
    // 'ΆΙ' (Alphatonos, Iota): hb-shape gives [1598 1754] — Alpha and Iotadieresis.
    expect(shapedGlyphIds(carlitoRegularBytes(), "ΆΙ")).toEqual({
      glyphIds: [1598, 1754],
      spans: [1, 1],
    });
    // 'ΎΙ' (Upsilontonos, Iota): hb-shape gives [1929 1754] — Upsilon and Iotadieresis.
    expect(shapedGlyphIds(carlitoRegularBytes(), "ΎΙ")).toEqual({
      glyphIds: [1929, 1754],
      spans: [1, 1],
    });
  });

  it("drops a vowel's accent before another vowel, including the plain two-vowel case", () => {
    // 'ΆΑ' (Alphatonos, Alpha): hb-shape gives [1598 1598] — the tonos is gone from the first glyph.
    expect(shapedGlyphIds(carlitoRegularBytes(), "ΆΑ")).toEqual({
      glyphIds: [1598, 1598],
      spans: [1, 1],
    });
  });

  it("leaves unaccented Greek exactly as the cmap resolved it", () => {
    // 'ΑΙ' (Alpha, Iota) matches no contextual rule — nothing is accented — so both glyphs pass through untouched.
    expect(shapedGlyphIds(carlitoRegularBytes(), "ΑΙ")).toEqual({
      glyphIds: [1598, 1752],
      spans: [1, 1],
    });
  });
});

describe("buildGsubShaper: lookupFlag skipping over GDEF glyph classes (Caladea Italic)", () => {
  // Caladea Italic's one 'liga' lookup carries the ignore-marks flag (0x0008): its fi/fl ligatures apply with combining marks stepped over, which is why the face gained real ligature shaping only once GDEF was read. hb-shape confirms every value below.
  it("shapes the fi and fl ligatures of the face whose liga lookup is flagged ignore-marks", () => {
    expect(shapedGlyphIds(caladeaItalicBytes(), "fi")).toEqual({
      glyphIds: [259],
      spans: [2],
    });
    expect(shapedGlyphIds(caladeaItalicBytes(), "fl")).toEqual({
      glyphIds: [260],
      spans: [2],
    });
    // No ffi ligature exists in this face: the second f passes through and the following pair still ligates.
    expect(shapedGlyphIds(caladeaItalicBytes(), "ffi")).toEqual({
      glyphIds: [36, 259],
      spans: [1, 2],
    });
  });

  it("forms a ligature ACROSS a combining mark, drawing the mark after it with the ligature absorbing its text", () => {
    // 'f', U+0308 combining diaeresis, 'i' — hb-shape gives [259 289]: the ligature forms across the mark (gid 289, GDEF class mark), and the mark is drawn after the ligature glyph. The spans state the cluster merge: the ligature glyph claims all three input glyphs' text (so its ToUnicode destination is the whole 'f◌̈i' run) and the mark carries a span of 0 — drawn, subsetted, and mapped to no text of its own.
    expect(shapedGlyphIds(caladeaItalicBytes(), "f̈i")).toEqual({
      glyphIds: [259, 289],
      spans: [3, 0],
    });
  });
});

describe("buildGsubShaper: faces with nothing to apply", () => {
  it("answers undefined for Caladea, whose GSUB declares no applied feature under the Latin default language system", () => {
    // Caladea's GSUB exists (small-caps and case features) but enables no default-on feature its 'latn' default language system reaches, so there is nothing this package applies -- and `undefined` (not an identity shaper) is what lets embedded-font.ts skip the pass entirely.
    expect(buildGsubShaper(parse(caladeaRegularBytes()))).toBeUndefined();
  });
});

describe("buildGsubShaper: opt-in features", () => {
  it("applies Carlito's discretionary ligatures only when asked for by name", () => {
    // Carlito's 'dlig' carries the st/ct/ch ligatures. With the defaults, 'staff' resolves only its 'ff' through liga (hb-shape's own default-feature output: [118 124 45 64]); with dlig opted in, the st ligature forms first — 'dlig' precedes 'liga' in the font's own feature order — giving hb-shape's +dlig output [120 45 64] with both ligature spans.
    expect(shapedGlyphIds(carlitoRegularBytes(), "staff")).toEqual({
      glyphIds: [118, 124, 45, 64],
      spans: [1, 1, 1, 2],
    });
    const font = parse(carlitoRegularBytes());
    const shaper = buildGsubShaper(font, { optInFeatures: ["dlig"] });
    const cmap = buildCmapLookup(font);
    if (shaper === undefined || cmap === undefined) {
      throw new Error("Carlito Regular failed to yield a dlig shaper and cmap");
    }
    expect(
      shaper(Array.from("staff", (c) => cmap(c.codePointAt(0)!) ?? 0)),
    ).toEqual({
      glyphIds: [120, 45, 64],
      spans: [2, 1, 2],
    });
  });
});

// A shaper over a hand-built GSUB (+ optional GDEF), shaping raw glyph ids — the fixture-built font carries no cmap, and the formats under test describe glyphs, not characters.
function shaperOf(
  gsub: Uint8Array<ArrayBuffer>,
  gdef?: Uint8Array<ArrayBuffer>,
): GsubShaper {
  const tables = new Map<string, Uint8Array<ArrayBuffer>>([["GSUB", gsub]]);
  if (gdef !== undefined) {
    tables.set("GDEF", gdef);
  }
  const font = parseSfnt(buildSfnt(tables));
  if (font === undefined) {
    throw new Error("the hand-built font failed to parse as an sfnt container");
  }
  const shaper = buildGsubShaper(font);
  if (shaper === undefined) {
    throw new Error("the hand-built font yielded no shaper");
  }
  return shaper;
}

// The glyph ids the hand-built tables below describe: 10 and 12 are ligature components/bases, 11 a backtrack glyph, 13 a lookahead glyph, 15 and 16 substitute glyphs, 20 a ligature glyph, and 14 and 17 marks.
describe("buildGsubShaper: hand-built contextual subtables", () => {
  it("applies Chaining Contextual format 1 (glyph rules): backtrack, input, lookahead, nested single substitution", () => {
    // Lookup 0 (calt): after 11, the pair 10 12 with 13 following substitutes 12→15 through nested lookup 1.
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          {
            type: 6,
            subtables: [
              buildChainContextFormat1(
                [10],
                [
                  [
                    {
                      backtrack: [11],
                      input: [12],
                      lookahead: [13],
                      records: [{ sequenceIndex: 1, lookupIndex: 1 }],
                    },
                  ],
                ],
              ),
            ],
          },
          {
            type: 1,
            subtables: [buildSingleSubstFormat2([[12, 15]])],
          },
        ],
      ),
    );
    expect(shaper([11, 10, 12, 13])).toEqual({
      glyphIds: [11, 10, 15, 13],
      spans: [1, 1, 1, 1],
    });
    // The wrong lookahead glyph, or the wrong backtrack glyph, leaves the whole run untouched: a contextual rule is one match, not a per-glyph filter.
    expect(shaper([11, 10, 12, 14])).toEqual({
      glyphIds: [11, 10, 12, 14],
      spans: [1, 1, 1, 1],
    });
    expect(shaper([13, 10, 12, 13])).toEqual({
      glyphIds: [13, 10, 12, 13],
      spans: [1, 1, 1, 1],
    });
  });

  it("applies Chaining Contextual format 2 (class rules) to whichever glyphs carry the rule's classes", () => {
    // Backtrack class 1 = {11}; input class 1 = {10, 17}, class 2 = {12}; lookahead class 1 = {13}. The rule set indexed by input class 1 matches any of its glyphs followed by a class-2 glyph, so both 10 and 17 start the same rule.
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          {
            type: 6,
            subtables: [
              buildChainContextFormat2(
                [10, 17],
                {
                  backtrack: buildClassDefFormat2([[11, 11, 1]]),
                  input: buildClassDefFormat2([
                    [10, 10, 1],
                    [12, 12, 2],
                    [17, 17, 1],
                  ]),
                  lookahead: buildClassDefFormat2([[13, 13, 1]]),
                },
                [
                  [],
                  [
                    {
                      backtrack: [1],
                      input: [2],
                      lookahead: [1],
                      records: [{ sequenceIndex: 1, lookupIndex: 1 }],
                    },
                  ],
                ],
              ),
            ],
          },
          {
            type: 1,
            subtables: [buildSingleSubstFormat2([[12, 15]])],
          },
        ],
      ),
    );
    expect(shaper([11, 10, 12, 13])).toEqual({
      glyphIds: [11, 10, 15, 13],
      spans: [1, 1, 1, 1],
    });
    expect(shaper([11, 17, 12, 13])).toEqual({
      glyphIds: [11, 17, 15, 13],
      spans: [1, 1, 1, 1],
    });
  });

  it("applies a nested ligature substitution inside Chaining Contextual format 3, merging the matched window", () => {
    // Lookup 0 (calt): coverage-matched backtrack {11}, input {10}{12}, lookahead {13}, whose record ligates 10+12→20 through nested lookup 1 — the length-changing nested case, proving the match window is replaced as one unit and later positions stay aimed correctly.
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          {
            type: 6,
            subtables: [
              buildFormat3Subtable(true, {
                backtrack: [[11]],
                input: [[10], [12]],
                lookahead: [[13]],
                records: [{ sequenceIndex: 0, lookupIndex: 1 }],
              }),
            ],
          },
          {
            type: 4,
            subtables: [
              buildLigatureSubstFormat1([
                {
                  firstGlyph: 10,
                  ligatures: [{ ligatureGlyph: 20, components: [12] }],
                },
              ]),
            ],
          },
        ],
      ),
    );
    expect(shaper([11, 10, 12, 13])).toEqual({
      glyphIds: [11, 20, 13],
      spans: [1, 2, 1],
    });
  });

  it("applies the plain Contextual (type 5) formats: glyph rules, class rules, and coverage arrays", () => {
    const glyphRuleShaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          {
            type: 5,
            subtables: [
              buildContextFormat1(
                [10],
                [
                  [
                    {
                      input: [12],
                      records: [{ sequenceIndex: 1, lookupIndex: 1 }],
                    },
                  ],
                ],
              ),
            ],
          },
          {
            type: 1,
            subtables: [buildSingleSubstFormat2([[12, 15]])],
          },
        ],
      ),
    );
    expect(glyphRuleShaper([10, 12])).toEqual({
      glyphIds: [10, 15],
      spans: [1, 1],
    });
    const classRuleShaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          {
            type: 5,
            subtables: [
              buildContextFormat2(
                [10],
                buildClassDefFormat2([
                  [10, 10, 1],
                  [12, 12, 2],
                ]),
                [
                  [],
                  [
                    {
                      input: [2],
                      records: [{ sequenceIndex: 1, lookupIndex: 1 }],
                    },
                  ],
                ],
              ),
            ],
          },
          {
            type: 1,
            subtables: [buildSingleSubstFormat2([[12, 15]])],
          },
        ],
      ),
    );
    expect(classRuleShaper([10, 12])).toEqual({
      glyphIds: [10, 15],
      spans: [1, 1],
    });
    const coverageShaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          {
            type: 5,
            subtables: [
              buildFormat3Subtable(false, {
                backtrack: [],
                input: [[10], [12]],
                lookahead: [],
                records: [{ sequenceIndex: 0, lookupIndex: 1 }],
              }),
            ],
          },
          {
            type: 1,
            subtables: [buildSingleSubstFormat2([[10, 16]])],
          },
        ],
      ),
    );
    expect(coverageShaper([10, 12])).toEqual({
      glyphIds: [16, 12],
      spans: [1, 1],
    });
  });

  it("resolves an Extension wrapper around a Chaining Contextual subtable", () => {
    // The same format 3 rule as the ligature test, wrapped in LookupType 7 — the spelling a font whose contextual table outgrew an Offset16's reach carries.
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          {
            type: 7,
            subtables: [
              buildExtensionSubst(
                6,
                buildFormat3Subtable(true, {
                  backtrack: [],
                  input: [[10], [12]],
                  lookahead: [[13]],
                  records: [{ sequenceIndex: 1, lookupIndex: 1 }],
                }),
              ),
            ],
          },
          {
            type: 1,
            subtables: [buildSingleSubstFormat2([[12, 15]])],
          },
        ],
      ),
    );
    expect(shaper([10, 12, 13])).toEqual({
      glyphIds: [10, 15, 13],
      spans: [1, 1, 1],
    });
    // The rule's lookahead is part of the match: without 13 following, nothing applies.
    expect(shaper([10, 12])).toEqual({
      glyphIds: [10, 12],
      spans: [1, 1],
    });
  });
});

describe("buildGsubShaper: lookupFlag class skipping over hand-built GDEF tables", () => {
  const ligatureTable = (flag: number, markFilteringSet?: number) =>
    buildGsubTable(
      [{ tag: "liga", lookupIndices: [0] }],
      [
        {
          type: 4,
          flag,
          ...(markFilteringSet === undefined ? {} : { markFilteringSet }),
          subtables: [
            buildLigatureSubstFormat1([
              {
                firstGlyph: 10,
                ligatures: [{ ligatureGlyph: 20, components: [12] }],
              },
            ]),
          ],
        },
      ],
    );

  it("steps an ignore-marks lookup over a mark between ligature components", () => {
    const gdef = buildGdefTable({
      glyphClassDef: buildClassDefFormat2([
        [10, 12, 1],
        [14, 14, 3],
      ]),
    });
    expect(shaperOf(ligatureTable(0x0008), gdef)([10, 14, 12])).toEqual({
      glyphIds: [20, 14],
      spans: [3, 0],
    });
    expect(shaperOf(ligatureTable(0x0008), gdef)([10, 12])).toEqual({
      glyphIds: [20],
      spans: [2],
    });
  });

  it("leaves the same flagged lookup inert in a font with no GDEF: unclassified glyphs are nothing to skip", () => {
    // The flag's sentence quantifies over glyph classes; with no GDEF every glyph is unclassified, so the components must still be adjacent — and 14 between them breaks the match.
    expect(shaperOf(ligatureTable(0x0008))([10, 14, 12])).toEqual({
      glyphIds: [10, 14, 12],
      spans: [1, 1, 1],
    });
  });

  it("honours the mark-attachment class in the flag's high byte: only that class's marks stay visible", () => {
    // Glyph 14 is a mark in attachment class 2. A lookup selecting class 1 (flag 0x0100) skips it; a lookup selecting class 2 (flag 0x0200) keeps it visible, and a visible glyph between components breaks the ligature.
    const gdef = buildGdefTable({
      glyphClassDef: buildClassDefFormat2([[14, 14, 3]]),
      markAttachClassDef: buildClassDefFormat1(14, [2]),
    });
    expect(shaperOf(ligatureTable(0x0100), gdef)([10, 14, 12])).toEqual({
      glyphIds: [20, 14],
      spans: [3, 0],
    });
    expect(shaperOf(ligatureTable(0x0200), gdef)([10, 14, 12])).toEqual({
      glyphIds: [10, 14, 12],
      spans: [1, 1, 1],
    });
  });

  it("honours a mark filtering set: only the selected set's marks stay visible", () => {
    // GDEF 1.2 with two sets: set 0 covers mark 15, set 1 covers mark 14. A lookup filtering on set 0 steps over 14 (not in the set) but is blocked by 15 (in the set, hence visible between components).
    const gdef = buildGdefTable({
      glyphClassDef: buildClassDefFormat2([[14, 15, 3]]),
      markGlyphSets: [buildCoverageFormat1([15]), buildCoverageFormat1([14])],
    });
    const filtering = shaperOf(ligatureTable(0x0010, 0), gdef);
    expect(filtering([10, 14, 12])).toEqual({
      glyphIds: [20, 14],
      spans: [3, 0],
    });
    expect(filtering([10, 15, 12])).toEqual({
      glyphIds: [10, 15, 12],
      spans: [1, 1, 1],
    });
  });
});

describe("buildGsubShaper: bounded and refused nested machinery", () => {
  it("terminates on a contextual lookup that references itself, leaving the glyphs unchanged", () => {
    // Lookup 0's one record points back at lookup 0. Without a depth bound this would recurse forever; with it, the deepest application withdraws and each level's rule completes with nothing substituted.
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          {
            type: 6,
            subtables: [
              buildFormat3Subtable(true, {
                backtrack: [],
                input: [[10]],
                lookahead: [],
                records: [{ sequenceIndex: 0, lookupIndex: 0 }],
              }),
            ],
          },
        ],
      ),
    );
    expect(shaper([10])).toEqual({ glyphIds: [10], spans: [1] });
  });

  it("withdraws a rule whose record names a lookup index the font does not carry", () => {
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          {
            type: 6,
            subtables: [
              buildFormat3Subtable(true, {
                backtrack: [],
                input: [[10]],
                lookahead: [],
                records: [{ sequenceIndex: 0, lookupIndex: 9 }],
              }),
            ],
          },
        ],
      ),
    );
    // The match is withdrawn whole rather than applied without its substitution, so the glyph passes through.
    expect(shaper([10])).toEqual({ glyphIds: [10], spans: [1] });
  });
});
