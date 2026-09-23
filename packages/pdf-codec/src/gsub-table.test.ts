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
    // Caladea's GSUB exists (small-caps and case features) but enables no default-on feature its 'latn' default language system reaches, so there is nothing this package applies — and `undefined` (not an identity shaper) is what lets embedded-font.ts skip the pass entirely.
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

  it("withdraws a rule whose record's sequenceIndex names a position past the matched input", () => {
    // The rule matches only the entry glyph (one input position, index 0); a record aimed at sequenceIndex 1 names a position that was never matched.
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
                records: [{ sequenceIndex: 1, lookupIndex: 1 }],
              }),
            ],
          },
          {
            type: 1,
            subtables: [buildSingleSubstFormat2([[10, 15]])],
          },
        ],
      ),
    );
    expect(shaper([10])).toEqual({ glyphIds: [10], spans: [1] });
  });

  it("applies two SubstLookupRecords at two distinct matched positions in one rule", () => {
    // Proves the record-array walk and its per-record window re-targeting for more than one record: position 0 goes through lookup 1 (10->15), position 1 through lookup 2 (12->16).
    const shaper = shaperOf(
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
                      records: [
                        { sequenceIndex: 0, lookupIndex: 1 },
                        { sequenceIndex: 1, lookupIndex: 2 },
                      ],
                    },
                  ],
                ],
              ),
            ],
          },
          { type: 1, subtables: [buildSingleSubstFormat2([[10, 15]])] },
          { type: 1, subtables: [buildSingleSubstFormat2([[12, 16]])] },
        ],
      ),
    );
    expect(shaper([10, 12])).toEqual({ glyphIds: [15, 16], spans: [1, 1] });
  });
});

// A shaper built from a hand-assembled 'GSUB' table (+ optional GDEF), tolerating `undefined` — unlike shaperOf, which throws — because every test in this section is about a font degrading to "nothing to apply" rather than throwing.
function gsubOf(
  gsub: Uint8Array<ArrayBuffer>,
  gdef?: Uint8Array<ArrayBuffer>,
): GsubShaper | undefined {
  const tables = new Map<string, Uint8Array<ArrayBuffer>>([["GSUB", gsub]]);
  if (gdef !== undefined) {
    tables.set("GDEF", gdef);
  }
  const font = parseSfnt(buildSfnt(tables));
  if (font === undefined) {
    throw new Error("the hand-built font failed to parse as an sfnt container");
  }
  return buildGsubShaper(font);
}

// Wraps one subtable as lookup 0 of a single-lookup, single-feature GSUB table — the shape every malformed-subtable test below needs, since a subtable that fails to parse leaves its lookup with zero subtables, and a GSUB whose only applied lookup has zero subtables yields no shaper at all.
function gsubOfOneLookup(
  type: number,
  subtable: Uint8Array<ArrayBuffer>,
  flag?: number,
): Uint8Array<ArrayBuffer> {
  return buildGsubTable(
    [{ tag: "calt", lookupIndices: [0] }],
    [{ type, flag, subtables: [subtable] }],
  );
}

describe("buildGsubShaper: glyphSkipper ignores base and ligature glyph classes, not only marks", () => {
  it("steps an ignore-base-glyphs lookup over a base glyph between ligature components", () => {
    const gdef = buildGdefTable({
      glyphClassDef: buildClassDefFormat2([[11, 11, 1]]), // 11 is a base glyph
    });
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "liga", lookupIndices: [0] }],
        [
          {
            type: 4,
            flag: 0x0002, // ignoreBaseGlyphs
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
      gdef,
    );
    expect(shaper([10, 11, 12])).toEqual({
      glyphIds: [20, 11],
      spans: [3, 0],
    });
  });

  it("steps an ignore-ligatures lookup over a ligature-classed glyph between ligature components", () => {
    const gdef = buildGdefTable({
      glyphClassDef: buildClassDefFormat2([[11, 11, 2]]), // 11 is itself classed as a ligature glyph
    });
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "liga", lookupIndices: [0] }],
        [
          {
            type: 4,
            flag: 0x0004, // ignoreLigatures
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
      gdef,
    );
    expect(shaper([10, 11, 12])).toEqual({
      glyphIds: [20, 11],
      spans: [3, 0],
    });
  });

  it("does not step over a base glyph when only ignoreLigatures is set, since the two flags gate different classes", () => {
    const gdef = buildGdefTable({
      glyphClassDef: buildClassDefFormat2([[11, 11, 1]]), // 11 is a base glyph, not a ligature
    });
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "liga", lookupIndices: [0] }],
        [
          {
            type: 4,
            flag: 0x0004, // ignoreLigatures only
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
      gdef,
    );
    // 11 is visible to this lookup (it is a base glyph, not a ligature glyph), so it breaks the adjacency the ligature needs.
    expect(shaper([10, 11, 12])).toEqual({
      glyphIds: [10, 11, 12],
      spans: [1, 1, 1],
    });
  });
});

describe("buildGsubShaper: malformed Single Substitution subtables degrade to no shaper rather than throwing", () => {
  it("refuses a format 1 subtable truncated before its own fixed 6-byte header, without reading past its end", () => {
    // A 5-byte subtable: substFormat 1, and a coverageOffset of 0 — deliberately pointing back at the header's own first two bytes, which happen to double as a valid (empty) coverage table's own format/count fields. This makes the coverage read succeed on its own, so the ONLY thing that can still catch the truncation is the header's own upfront 6-byte bounds check: without it, the very next read (the 2-byte delta at offset 4) reaches past this 5-byte subtable's own end.
    const bytes = new Uint8Array(5);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1); // substFormat 1 (doubles as coverage format 1 when reread at offset 0)
    view.setUint16(2, 0); // coverageOffset 0 (doubles as coverage's own count = 0 when reread at offset 2)
    expect(() => gsubOf(gsubOfOneLookup(1, bytes))).not.toThrow();
    expect(gsubOf(gsubOfOneLookup(1, bytes))).toBeUndefined();
  });

  it("refuses a format 1 subtable whose coverage offset resolves to nothing readable", () => {
    const bytes = new Uint8Array(6);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1);
    view.setUint16(2, 6); // coverage offset points one byte past the subtable's own end
    view.setInt16(4, 5);
    expect(gsubOf(gsubOfOneLookup(1, bytes))).toBeUndefined();
  });

  it("skips a flagged format 1 lookup's own glyph rather than substituting it", () => {
    const gdef = buildGdefTable({
      glyphClassDef: buildClassDefFormat2([[10, 10, 1]]), // 10 is a base glyph
    });
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1);
    view.setUint16(2, 6); // coverage at byte 6
    view.setInt16(4, 5); // delta +5
    view.setUint16(6, 1); // coverage format 1
    // coverage glyph count and list omitted deliberately to keep the fixture minimal; parseCoverage needs its own bytes, so build via the real coverage builder instead:
    const coverage = buildCoverageFormat1([10]);
    const full = new Uint8Array(6 + coverage.length);
    full.set(bytes.subarray(0, 6), 0);
    full.set(coverage, 6);
    const shaper = shaperOf(gsubOfOneLookup(1, full, 0x0002), gdef);
    expect(shaper([10])).toEqual({ glyphIds: [10], spans: [1] });
  });

  it("refuses a format 2 subtable truncated before its own fixed 6-byte header", () => {
    const bytes = buildSingleSubstFormat2([[10, 15]]);
    expect(gsubOf(gsubOfOneLookup(1, bytes.slice(0, 5)))).toBeUndefined();
  });

  it("refuses a format 2 subtable whose substitutes array is truncated", () => {
    const bytes = buildSingleSubstFormat2([[10, 15]]);
    // The header (6 bytes) and glyphCount (1) both fit; only the 2-byte substitutes array is cut short.
    expect(gsubOf(gsubOfOneLookup(1, bytes.slice(0, 7)))).toBeUndefined();
  });

  it("skips a flagged format 2 lookup's own glyph rather than substituting it", () => {
    const gdef = buildGdefTable({
      glyphClassDef: buildClassDefFormat2([[10, 10, 1]]),
    });
    const shaper = shaperOf(
      gsubOfOneLookup(1, buildSingleSubstFormat2([[10, 15]]), 0x0002),
      gdef,
    );
    expect(shaper([10])).toEqual({ glyphIds: [10], spans: [1] });
  });

  it("declines a format 2 coverage index that reaches exactly as far as the substitutes array, one past its last valid entry", () => {
    // A deliberately mismatched, malformed table: coverage lists two glyphs but only one substitute is declared, so the second glyph's coverage index (1) equals glyphCount (1) exactly.
    const coverage = buildCoverageFormat1([10, 11]);
    const substitutesAt = 6 + 1 * 2;
    const bytes = new Uint8Array(substitutesAt + coverage.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 2);
    view.setUint16(2, substitutesAt);
    view.setUint16(4, 1); // glyphCount: only one substitute, though coverage lists two glyphs
    view.setUint16(6, 99); // the one substitute, for coverage index 0 (glyph 10)
    bytes.set(coverage, substitutesAt);
    const shaper = shaperOf(gsubOfOneLookup(1, bytes));
    expect(shaper([10])).toEqual({ glyphIds: [99], spans: [1] });
    // Glyph 11's coverage index is 1, equal to glyphCount (1): out of range, so it passes through rather than reading past the substitutes array.
    expect(shaper([11])).toEqual({ glyphIds: [11], spans: [1] });
  });
});

describe("buildGsubShaper: malformed Ligature Substitution subtables degrade to no shaper rather than throwing", () => {
  it("refuses a subtable truncated before its own fixed 6-byte header", () => {
    const bytes = buildLigatureSubstFormat1([
      { firstGlyph: 10, ligatures: [{ ligatureGlyph: 20, components: [12] }] },
    ]);
    expect(gsubOf(gsubOfOneLookup(4, bytes.slice(0, 5)))).toBeUndefined();
  });

  it("refuses a subtable whose ligature-set offset array is truncated", () => {
    const bytes = buildLigatureSubstFormat1([
      { firstGlyph: 10, ligatures: [{ ligatureGlyph: 20, components: [12] }] },
    ]);
    // The 6-byte header fits (ligSetCount 1); the one trailing offset word is cut short.
    expect(gsubOf(gsubOfOneLookup(4, bytes.slice(0, 7)))).toBeUndefined();
  });

  it("declines a ligature coverage index that reaches exactly as far as the ligSet array, one past its last valid entry", () => {
    // Coverage lists two first-glyphs but only one LigatureSet is declared, so the second glyph's coverage index (1) equals ligSetCount (1) exactly.
    const coverage = buildCoverageFormat1([10, 11]);
    const ligSet = (() => {
      const ligature = new Uint8Array(6); // ligatureGlyph 20, componentCount 2, one component (12)
      const view = new DataView(ligature.buffer);
      view.setUint16(0, 20);
      view.setUint16(2, 2);
      view.setUint16(4, 12);
      const set = new Uint8Array(4 + ligature.length); // ligatureCount 1, one offset, the record
      const setView = new DataView(set.buffer);
      setView.setUint16(0, 1);
      setView.setUint16(2, 4);
      set.set(ligature, 4);
      return set;
    })();
    const coverageAt = 6 + 1 * 2;
    const ligSetAt = coverageAt + coverage.length;
    const bytes = new Uint8Array(ligSetAt + ligSet.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1);
    view.setUint16(2, coverageAt);
    view.setUint16(4, 1); // ligSetCount: only one set, though coverage lists two glyphs
    view.setUint16(6, ligSetAt);
    bytes.set(coverage, coverageAt);
    bytes.set(ligSet, ligSetAt);
    const shaper = shaperOf(gsubOfOneLookup(4, bytes));
    expect(shaper([10, 12])).toEqual({ glyphIds: [20], spans: [2] });
    // Glyph 11's coverage index is 1, equal to ligSetCount (1): out of range, so it passes through untouched.
    expect(shaper([11, 12])).toEqual({ glyphIds: [11, 12], spans: [1, 1] });
  });

  it("finds no ligature when a LigatureSet's own 2-byte header is truncated, leaving the glyph unsubstituted", () => {
    // The LigatureSet's own bounds check runs per-glyph inside the returned matcher, not while the subtable is first parsed, so the subtable itself still parses (a shaper exists); only the actual match at this glyph comes back empty.
    const coverage = buildCoverageFormat1([10]);
    const coverageAt = 6 + 1 * 2;
    // The set offset points one byte past the subtable's own end, so the LigatureSet's own header cannot be read.
    const bytes = new Uint8Array(coverageAt + coverage.length + 1);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1);
    view.setUint16(2, coverageAt);
    view.setUint16(4, 1);
    view.setUint16(6, coverageAt + coverage.length);
    bytes.set(coverage, coverageAt);
    const shaper = shaperOf(gsubOfOneLookup(4, bytes));
    expect(shaper([10, 12])).toEqual({ glyphIds: [10, 12], spans: [1, 1] });
  });

  it("finds no ligature when the LigatureSet's own ligature-offset array is truncated, leaving the glyph unsubstituted", () => {
    const coverage = buildCoverageFormat1([10]);
    const coverageAt = 6 + 1 * 2;
    const ligSetAt = coverageAt + coverage.length;
    // ligatureCount 1, but the one trailing offset word is cut short.
    const bytes = new Uint8Array(ligSetAt + 3);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1);
    view.setUint16(2, coverageAt);
    view.setUint16(4, 1);
    view.setUint16(6, ligSetAt);
    bytes.set(coverage, coverageAt);
    view.setUint16(ligSetAt, 1);
    const shaper = shaperOf(gsubOfOneLookup(4, bytes));
    expect(shaper([10, 12])).toEqual({ glyphIds: [10, 12], spans: [1, 1] });
  });

  it("skips one unreadable Ligature record and still matches a good one that follows it in the same set", () => {
    const coverage = buildCoverageFormat1([10]);
    const goodLigature = (() => {
      const bytes = new Uint8Array(6);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, 20);
      view.setUint16(2, 2);
      view.setUint16(4, 12);
      return bytes;
    })();
    const badLigatureOffset = 4 + 2 * 2; // past the set's own end: unreadable
    const ligSet = new Uint8Array(4 + 2 * 2 + goodLigature.length);
    const ligSetView = new DataView(ligSet.buffer);
    ligSetView.setUint16(0, 2); // ligatureCount 2
    ligSetView.setUint16(2, badLigatureOffset); // first record: unreadable
    ligSetView.setUint16(4, 4 + 2 * 2); // second record: the good one
    ligSet.set(goodLigature, 4 + 2 * 2);
    const coverageAt = 6 + 1 * 2;
    const ligSetAt = coverageAt + coverage.length;
    const bytes = new Uint8Array(ligSetAt + ligSet.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1);
    view.setUint16(2, coverageAt);
    view.setUint16(4, 1);
    view.setUint16(6, ligSetAt);
    bytes.set(coverage, coverageAt);
    bytes.set(ligSet, ligSetAt);
    const shaper = shaperOf(gsubOfOneLookup(4, bytes));
    expect(shaper([10, 12])).toEqual({ glyphIds: [20], spans: [2] });
  });

  it("skips a Ligature record declaring zero components as describing no ligature at all", () => {
    const coverage = buildCoverageFormat1([10]);
    const zeroComponentLigature = new Uint8Array(4); // ligatureGlyph 20, componentCount 0
    new DataView(zeroComponentLigature.buffer).setUint16(0, 20);
    const ligSet = new Uint8Array(4 + zeroComponentLigature.length);
    const ligSetView = new DataView(ligSet.buffer);
    ligSetView.setUint16(0, 1);
    ligSetView.setUint16(2, 4);
    ligSet.set(zeroComponentLigature, 4);
    const coverageAt = 6 + 1 * 2;
    const ligSetAt = coverageAt + coverage.length;
    const bytes = new Uint8Array(ligSetAt + ligSet.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1);
    view.setUint16(2, coverageAt);
    view.setUint16(4, 1);
    view.setUint16(6, ligSetAt);
    bytes.set(coverage, coverageAt);
    bytes.set(ligSet, ligSetAt);
    const shaper = shaperOf(gsubOfOneLookup(4, bytes));
    expect(shaper([10])).toEqual({ glyphIds: [10], spans: [1] });
  });

  it("finds no ligature when a record's own component array is truncated, leaving the glyph unsubstituted", () => {
    const coverage = buildCoverageFormat1([10]);
    const truncatedLigature = new Uint8Array(5); // header (4) fits; the one component word is cut short by a byte
    new DataView(truncatedLigature.buffer).setUint16(0, 20);
    new DataView(truncatedLigature.buffer).setUint16(2, 2); // componentCount 2: one component word needed, only one byte given
    const ligSet = new Uint8Array(4 + truncatedLigature.length);
    const ligSetView = new DataView(ligSet.buffer);
    ligSetView.setUint16(0, 1);
    ligSetView.setUint16(2, 4);
    ligSet.set(truncatedLigature, 4);
    const coverageAt = 6 + 1 * 2;
    const ligSetAt = coverageAt + coverage.length;
    const bytes = new Uint8Array(ligSetAt + ligSet.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1);
    view.setUint16(2, coverageAt);
    view.setUint16(4, 1);
    view.setUint16(6, ligSetAt);
    bytes.set(coverage, coverageAt);
    bytes.set(ligSet, ligSetAt);
    const shaper = shaperOf(gsubOfOneLookup(4, bytes));
    expect(shaper([10, 12])).toEqual({ glyphIds: [10, 12], spans: [1, 1] });
  });
});

describe("buildGsubShaper: malformed Contextual/Chaining Contextual format 3 subtables", () => {
  it("declines a format 3 rule with zero input coverages, which matches nothing", () => {
    const bytes = buildFormat3Subtable(false, {
      backtrack: [],
      input: [],
      lookahead: [],
      records: [],
    });
    expect(gsubOf(gsubOfOneLookup(5, bytes))).toBeUndefined();
  });

  it("declines a chained format 3 rule whose lookahead coverage array is truncated", () => {
    const full = buildFormat3Subtable(true, {
      backtrack: [],
      input: [[10]],
      lookahead: [[13]],
      records: [{ sequenceIndex: 0, lookupIndex: 1 }],
    });
    // Cut the table short right where the lookahead offset array (one word) begins. backtrackCount(2) + inputCount(2) + inputOffset(2) + lookaheadCount(2) = 8 bytes past substFormat(2) = 10.
    expect(gsubOf(gsubOfOneLookup(6, full.slice(0, 10)))).toBeUndefined();
  });

  it("declines a chained format 3 rule whose backtrack coverage array is truncated", () => {
    const full = buildFormat3Subtable(true, {
      backtrack: [[11]],
      input: [[10]],
      lookahead: [],
      records: [{ sequenceIndex: 0, lookupIndex: 1 }],
    });
    // substFormat(2) + backtrackCount(2) = 4: cut right where the one backtrack offset word begins.
    expect(gsubOf(gsubOfOneLookup(6, full.slice(0, 4)))).toBeUndefined();
  });

  it("resolves an extension wrapper only when the wrapped lookup type is not itself an extension", () => {
    const rule = buildFormat3Subtable(true, {
      backtrack: [],
      input: [[10]],
      lookahead: [],
      records: [{ sequenceIndex: 0, lookupIndex: 1 }],
    });
    const nestedExtension = buildExtensionSubst(
      7,
      buildExtensionSubst(6, rule),
    );
    expect(gsubOf(gsubOfOneLookup(7, nestedExtension))).toBeUndefined();
  });

  it("refuses an extension subtable truncated before its own fixed 8-byte header", () => {
    const wrapped = buildFormat3Subtable(true, {
      backtrack: [],
      input: [[10]],
      lookahead: [],
      records: [{ sequenceIndex: 0, lookupIndex: 1 }],
    });
    const bytes = buildExtensionSubst(6, wrapped);
    expect(gsubOf(gsubOfOneLookup(7, bytes.slice(0, 7)))).toBeUndefined();
  });
});

describe("buildGsubShaper: dispatches on the correct lookup subtable format only", () => {
  it("refuses a Single Substitution subtable declaring a format other than 1 or 2", () => {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, 3);
    expect(gsubOf(gsubOfOneLookup(1, bytes))).toBeUndefined();
  });

  it("refuses a Ligature Substitution subtable declaring a format other than 1", () => {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, 2);
    expect(gsubOf(gsubOfOneLookup(4, bytes))).toBeUndefined();
  });

  it("refuses a Contextual/Chaining subtable declaring a format other than 1, 2 or 3", () => {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, 4);
    expect(gsubOf(gsubOfOneLookup(5, bytes))).toBeUndefined();
    expect(gsubOf(gsubOfOneLookup(6, bytes))).toBeUndefined();
  });

  it("skips a lookup type this module does not read (Alternate Substitution, type 3), leaving the feature with nothing to apply", () => {
    // Six arbitrary bytes: parseSubtable dispatches purely on lookupType, so this lookup type is refused before any byte of it is even inspected.
    const bytes = new Uint8Array(6);
    expect(gsubOf(gsubOfOneLookup(3, bytes))).toBeUndefined();
  });
});

describe("buildGsubShaper: feature-list and lookup-list bounds checking, and lookup index deduplication", () => {
  it("does not apply the same lookup twice when two applied features reference the identical lookup index", () => {
    // Both 'liga' and 'rlig' (both default-on) reference lookup 0, a single substitution chain 10->15->20. Applying it once maps 10 to 15; applying it twice (a broken dedup) would chase the chain on to 20.
    const shaper = shaperOf(
      buildGsubTable(
        [
          { tag: "liga", lookupIndices: [0] },
          { tag: "rlig", lookupIndices: [0] },
        ],
        [
          {
            type: 1,
            subtables: [
              buildSingleSubstFormat2([
                [10, 15],
                [15, 20],
              ]),
            ],
          },
        ],
      ),
    );
    expect(shaper([10])).toEqual({ glyphIds: [15], spans: [1] });
  });

  it("refuses a GSUB whose LookupList offset array is truncated", () => {
    const good = buildGsubTable(
      [{ tag: "calt", lookupIndices: [0] }],
      [{ type: 1, subtables: [buildSingleSubstFormat2([[10, 15]])] }],
    );
    // Cut the whole table short so the LookupList's own count-plus-one-offset array cannot be read in full.
    expect(gsubOf(good.slice(0, good.length - 1))).toBeUndefined();
  });

  it("leaves a malformed lookup's subtable unreadable (rather than throwing) while a sibling lookup still applies", () => {
    // Lookup 0's own subtable is truncated before its 6-byte format-2 header completes, so it parses to zero usable subtables; lookup 1 is untouched and still applies.
    const badSubtable = buildSingleSubstFormat2([[10, 15]]).slice(0, 5);
    const goodSubtable = buildSingleSubstFormat2([[12, 16]]);
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0, 1] }],
        [
          { type: 1, subtables: [badSubtable] },
          { type: 1, subtables: [goodSubtable] },
        ],
      ),
    );
    expect(shaper([10, 12])).toEqual({ glyphIds: [10, 16], spans: [1, 1] });
  });

  it("refuses a whole malformed lookup (its own subtable-offset array truncated) while a sibling lookup still applies", () => {
    // A hand-built LookupList where lookup 0's header claims one subtable but the table ends before that subtable's own offset word is written, forcing `lookups.push(undefined)`; lookup 1 (built normally) is unaffected.
    const goodSubtable = buildSingleSubstFormat2([[12, 16]]);
    const goodLookup = (() => {
      const bytes = new Uint8Array(8 + goodSubtable.length);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, 1); // lookupType: Single Substitution
      view.setUint16(4, 1); // subTableCount
      view.setUint16(6, 8); // subtable offset
      bytes.set(goodSubtable, 8);
      return bytes;
    })();
    const badLookup = new Uint8Array(6); // lookupType 1, flag 0, subTableCount 1, then nothing: the one offset word is missing entirely
    new DataView(badLookup.buffer).setUint16(0, 1);
    new DataView(badLookup.buffer).setUint16(4, 1);
    const lookupList = new Uint8Array(
      2 + 2 * 2 + badLookup.length + goodLookup.length,
    );
    const llView = new DataView(lookupList.buffer);
    llView.setUint16(0, 2); // lookupCount
    llView.setUint16(2, 6); // lookup 0 offset
    llView.setUint16(4, 6 + badLookup.length); // lookup 1 offset
    lookupList.set(badLookup, 6);
    lookupList.set(goodLookup, 6 + badLookup.length);

    const langSys = new Uint8Array(8); // requiredFeatureIndex=0xffff omitted (0 is fine here), featureIndexCount 1, index 0
    new DataView(langSys.buffer).setUint16(4, 1);
    const script = new Uint8Array(4 + langSys.length);
    new DataView(script.buffer).setUint16(0, 4); // defaultLangSysOffset
    script.set(langSys, 4);
    const scriptList = new Uint8Array(8 + script.length);
    const slView = new DataView(scriptList.buffer);
    slView.setUint16(0, 1);
    scriptList.set(new TextEncoder().encode("latn"), 2);
    slView.setUint16(6, 8);
    scriptList.set(script, 8);
    const featureTable = new Uint8Array(6); // featureParamsOffset 0, lookupIndexCount 1, lookup index 1 (the good lookup)
    new DataView(featureTable.buffer).setUint16(2, 1);
    new DataView(featureTable.buffer).setUint16(4, 1);
    const featureList = new Uint8Array(8 + featureTable.length);
    const flView = new DataView(featureList.buffer);
    flView.setUint16(0, 1);
    featureList.set(new TextEncoder().encode("calt"), 2);
    flView.setUint16(6, 8);
    featureList.set(featureTable, 8);

    const scriptListAt = 10;
    const featureListAt = scriptListAt + scriptList.length;
    const lookupListAt = featureListAt + featureList.length;
    const gsub = new Uint8Array(lookupListAt + lookupList.length);
    const gsubView = new DataView(gsub.buffer);
    gsubView.setUint16(0, 1);
    gsubView.setUint16(4, scriptListAt);
    gsubView.setUint16(6, featureListAt);
    gsubView.setUint16(8, lookupListAt);
    gsub.set(scriptList, scriptListAt);
    gsub.set(featureList, featureListAt);
    gsub.set(lookupList, lookupListAt);

    const shaper = gsubOf(gsub);
    if (shaper === undefined) {
      throw new Error(
        "expected a shaper from the still-readable second lookup",
      );
    }
    expect(shaper([12])).toEqual({ glyphIds: [16], spans: [1] });
  });
});

describe("buildGsubShaper: malformed format 1/2 rule-set subtables and their NULL/out-of-range set indices", () => {
  it("treats a NULL (zero) rule-set offset as no rules for that entry glyph", () => {
    // Two coverage entries (10, 12), but the SECOND rule-set's own offset word is patched to 0 (NULL) after a normal build — the spec's own "no contexts begin with this coverage index".
    const bytes = buildContextFormat1(
      [10, 12],
      [
        [{ input: [], records: [{ sequenceIndex: 0, lookupIndex: 1 }] }],
        [{ input: [], records: [{ sequenceIndex: 0, lookupIndex: 1 }] }],
      ],
    );
    new DataView(bytes.buffer).setUint16(6 + 1 * 2, 0); // rule-set offset array starts at byte 6 (prefixSize)
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          { type: 5, subtables: [bytes] },
          { type: 1, subtables: [buildSingleSubstFormat2([[10, 15]])] },
        ],
      ),
    );
    expect(shaper([10])).toEqual({ glyphIds: [15], spans: [1] });
    // Glyph 12's rule-set offset was zeroed: no rule fires, so it passes through untouched.
    expect(shaper([12])).toEqual({ glyphIds: [12], spans: [1] });
  });

  it("declines a coverage index that reaches exactly as far as the rule-set array, one past its last valid entry", () => {
    // A hand-built format 1 subtable: coverage lists two first-glyphs (10, 12) but only one rule-set is declared (setCount 1), so glyph 12's coverage index (1) equals setCount (1) exactly.
    const coverage = buildCoverageFormat1([10, 12]);
    const ruleSet = buildOffsetTableContainerForTest([
      (() => {
        // A SequenceRule with no further input glyphs (glyphCount 1, the implied entry glyph only) and one record.
        const rule = new Uint8Array(2 + 2 + 4);
        const view = new DataView(rule.buffer);
        view.setUint16(0, 1); // glyphCount (entry glyph only)
        view.setUint16(2, 1); // substCount
        view.setUint16(4, 0); // record.sequenceIndex
        view.setUint16(6, 1); // record.lookupIndex
        return rule;
      })(),
    ]);
    const coverageAt = 6 + 1 * 2;
    const ruleSetAt = coverageAt + coverage.length;
    const bytes = new Uint8Array(ruleSetAt + ruleSet.length);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1); // substFormat
    view.setUint16(2, coverageAt);
    view.setUint16(4, 1); // setCount: one rule-set, though coverage lists two glyphs
    view.setUint16(6, ruleSetAt);
    bytes.set(coverage, coverageAt);
    bytes.set(ruleSet, ruleSetAt);
    const shaper = shaperOf(
      buildGsubTable(
        [{ tag: "calt", lookupIndices: [0] }],
        [
          { type: 5, subtables: [bytes] },
          { type: 1, subtables: [buildSingleSubstFormat2([[10, 15]])] },
        ],
      ),
    );
    expect(shaper([10])).toEqual({ glyphIds: [15], spans: [1] });
    // Glyph 12's coverage index is 1, equal to setCount (1): out of range, so it passes through untouched.
    expect(shaper([12])).toEqual({ glyphIds: [12], spans: [1] });
  });
});

// [uint16 count][Offset16 per blob][blobs], offsets from the container's own start — the same layout buildLigatureSubstFormat1/assembleRuleSetSubtable use internally for a rule set, reimplemented here (rather than exported from test-support/sfnt.ts) since it is a one-off for the hand-built subtable above.
function buildOffsetTableContainerForTest(
  blobs: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const container = new Uint8Array(
    2 + blobs.length * 2 + blobs.reduce((n, blob) => n + blob.length, 0),
  );
  const view = new DataView(container.buffer);
  view.setUint16(0, blobs.length);
  let at = 2 + blobs.length * 2;
  blobs.forEach((blob, index) => {
    view.setUint16(2 + index * 2, at);
    container.set(blob, at);
    at += blob.length;
  });
  return container;
}

describe("buildGsubShaper: malformed ScriptList, LangSys and FeatureList tables", () => {
  it("answers undefined for a GSUB whose ScriptList is truncated before its own script-count header", () => {
    const good = buildGsubTable(
      [{ tag: "calt", lookupIndices: [0] }],
      [{ type: 1, subtables: [buildSingleSubstFormat2([[10, 15]])] }],
    );
    // The ScriptList sits at byte 10; cutting the whole table to 11 bytes leaves its own 2-byte scriptCount unreadable.
    expect(gsubOf(good.slice(0, 11))).toBeUndefined();
  });

  it("answers undefined for a GSUB whose ScriptList declares zero scripts", () => {
    const scriptList = new Uint8Array(2); // scriptCount 0
    const featureList = new Uint8Array(2); // featureCount 0
    const lookupList = new Uint8Array(2); // lookupCount 0
    const scriptListAt = 10;
    const featureListAt = scriptListAt + scriptList.length;
    const lookupListAt = featureListAt + featureList.length;
    const gsub = new Uint8Array(lookupListAt + lookupList.length);
    const view = new DataView(gsub.buffer);
    view.setUint16(0, 1);
    view.setUint16(4, scriptListAt);
    view.setUint16(6, featureListAt);
    view.setUint16(8, lookupListAt);
    gsub.set(scriptList, scriptListAt);
    gsub.set(featureList, featureListAt);
    gsub.set(lookupList, lookupListAt);
    expect(gsubOf(gsub)).toBeUndefined();
  });

  it("answers undefined for a script whose default LangSys offset is NULL (zero)", () => {
    // A real 'latn' Script table whose own defaultLangSysOffset field is explicitly 0: ISO 32000's own "no default language system" case.
    const script = new Uint8Array(4); // defaultLangSysOffset 0, langSysCount 0
    const scriptList = new Uint8Array(8 + script.length);
    const slView = new DataView(scriptList.buffer);
    slView.setUint16(0, 1);
    scriptList.set(new TextEncoder().encode("latn"), 2);
    slView.setUint16(6, 8);
    scriptList.set(script, 8);
    const featureList = new Uint8Array(2);
    const lookupList = new Uint8Array(2);
    const scriptListAt = 10;
    const featureListAt = scriptListAt + scriptList.length;
    const lookupListAt = featureListAt + featureList.length;
    const gsub = new Uint8Array(lookupListAt + lookupList.length);
    const view = new DataView(gsub.buffer);
    view.setUint16(0, 1);
    view.setUint16(4, scriptListAt);
    view.setUint16(6, featureListAt);
    view.setUint16(8, lookupListAt);
    gsub.set(scriptList, scriptListAt);
    gsub.set(featureList, featureListAt);
    gsub.set(lookupList, lookupListAt);
    expect(gsubOf(gsub)).toBeUndefined();
  });

  it("skips a feature index that names no readable feature record, rather than throwing", () => {
    // The default LangSys names feature index 5, but the FeatureList carries only one record (index 0): out of range, so nothing is applied and the shaper is undefined (nothing else enables a working lookup).
    const langSys = new Uint8Array(8);
    new DataView(langSys.buffer).setUint16(4, 1);
    new DataView(langSys.buffer).setUint16(6, 5); // feature index 5: out of range
    const script = new Uint8Array(4 + langSys.length);
    new DataView(script.buffer).setUint16(0, 4);
    script.set(langSys, 4);
    const scriptList = new Uint8Array(8 + script.length);
    const slView = new DataView(scriptList.buffer);
    slView.setUint16(0, 1);
    scriptList.set(new TextEncoder().encode("latn"), 2);
    slView.setUint16(6, 8);
    scriptList.set(script, 8);
    const featureTable = new Uint8Array(6);
    new DataView(featureTable.buffer).setUint16(4, 0);
    const featureList = new Uint8Array(8 + featureTable.length);
    const flView = new DataView(featureList.buffer);
    flView.setUint16(0, 1);
    featureList.set(new TextEncoder().encode("liga"), 2);
    flView.setUint16(6, 8);
    featureList.set(featureTable, 8);
    const lookupList = new Uint8Array(2);
    const scriptListAt = 10;
    const featureListAt = scriptListAt + scriptList.length;
    const lookupListAt = featureListAt + featureList.length;
    const gsub = new Uint8Array(lookupListAt + lookupList.length);
    const view = new DataView(gsub.buffer);
    view.setUint16(0, 1);
    view.setUint16(4, scriptListAt);
    view.setUint16(6, featureListAt);
    view.setUint16(8, lookupListAt);
    gsub.set(scriptList, scriptListAt);
    gsub.set(featureList, featureListAt);
    gsub.set(lookupList, lookupListAt);
    expect(gsubOf(gsub)).toBeUndefined();
  });
});
