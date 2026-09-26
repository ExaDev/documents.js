import { describe, expect, it } from "vitest";
import { buildGsubShaper } from "./gsub-table";
import type { GsubShaper } from "./gsub-table";
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
import {} from "./test-support/fonts";

// Every glyph ID asserted against the vendored faces below is the real shaped output the real font declares, the same cross-checked-fixture discipline gpos-table.test.ts applies to its kerning values: the ligature, calt, and dlig results were confirmed against HarfBuzz's own `hb-shape` output for the same text in the same faces before being written down here (calt checked with `-liga` so the two features' contributions stay separable, dlig with `-liga,+dlig`). The hand-built-table tests at the bottom cover the lookup formats the vendored fonts do not ship, through fixtures laid out byte by byte in test-support/sfnt.ts.

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

// Wraps one subtable as lookup 0 of a single-lookup, single-feature GSUB table — the shape every malformed-subtable test below needs, since a subtable that fails to parse leaves its lookup with zero subtables, and a GSUB whose only applied lookup has zero subtables yields no shaper at all.

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
