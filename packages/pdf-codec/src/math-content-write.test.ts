import type {
  MathBox,
  MathLayoutItem,
  PositionedFormula,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  collectUsedGlyphs,
  writeFormulaContentStream,
} from "./math-content-write";
import type { MathFont } from "./math-font";
import { loadMathFont } from "./math-font";

const BLACK = { r: 0, g: 0, b: 0 };
const RESOURCE = "MF";

function box(items: readonly MathLayoutItem[], heightPt: number): MathBox {
  return { widthPt: 10, heightPt, ascentPt: heightPt, descentPt: 0, items };
}

function positioned(boxValue: MathBox): PositionedFormula {
  return { pageIndex: 0, xPt: 100, yPt: 200, box: boxValue };
}

function write(formula: PositionedFormula): string {
  return new TextDecoder().decode(
    writeFormulaContentStream([formula], {
      font: loadMathFont().font,
      resourceName: RESOURCE,
    }),
  );
}

// Two arbitrary glyph IDs standing in for a real construction's own parts -- what this module does with a placement is independent of which glyph it names, and the real, font-derived IDs are asserted where they are actually produced (math-stretch.test.ts, and documents.js's own layout tests).
const LOWER_HOOK = 4862;
const UPPER_HOOK = 4860;

describe("writeFormulaContentStream, assembled stretchy glyphs", () => {
  it("shows each placement as its own glyph-ID CID at its own computed position", () => {
    const content = write(
      positioned(
        box(
          [
            {
              kind: "assembled-glyphs",
              text: "(",
              sizePt: 12,
              color: BLACK,
              placements: [
                { glyphId: LOWER_HOOK, xPt: 0, yPt: 40 },
                { glyphId: UPPER_HOOK, xPt: 0, yPt: 10 },
              ],
            },
          ],
          50,
        ),
      ),
    );

    // Box-local y-down against a 50pt-tall box placed with its bottom-left at (100, 200): a placement 40pt down from the box's own top sits 10pt up from its bottom, i.e. at PDF y = 210.
    expect(content).toContain(
      `1 0 0 1 100 210 Tm\n<${LOWER_HOOK.toString(16).padStart(4, "0")}> Tj`,
    );
    expect(content).toContain(
      `1 0 0 1 100 240 Tm\n<${UPPER_HOOK.toString(16).padStart(4, "0")}> Tj`,
    );
    // One text object per placement, each selecting the embedded math font at the item's own size.
    expect(content.match(/BT\n/g)).toHaveLength(2);
    expect(content.match(/\/MF 12 Tf\n/g)).toHaveLength(2);
  });

  it("wraps the whole construction in an /ActualText span naming the operator it stands for", () => {
    const content = write(
      positioned(
        box(
          [
            {
              kind: "assembled-glyphs",
              text: "(",
              sizePt: 12,
              color: BLACK,
              placements: [{ glyphId: LOWER_HOOK, xPt: 0, yPt: 0 }],
            },
          ],
          50,
        ),
      ),
    );
    // UTF-16BE with the byte-order mark that marks a PDF text string as Unicode: FEFF then U+0028.
    expect(content).toContain("/Span <</ActualText <feff0028> >> BDC\n");
    expect(content.endsWith("EMC\n")).toBe(true);
    expect(content).toContain("ET\n"); // a hard containment check first: indexOf("ET") is -1 (still "less than" any real EMC index) if this string were ever blanked out
    expect(content.indexOf("BDC")).toBeLessThan(content.indexOf("BT"));
    expect(content.indexOf("ET")).toBeLessThan(content.indexOf("EMC"));
  });

  it("encodes a two-character operator's /ActualText with each character's own low byte, not just its high byte", () => {
    // Two ordinary BMP characters, not a surrogate pair: proves utf16BeWithBom packs the SECOND code unit's own low byte at the right offset too, which a surrogate pair (whose low surrogate happens to end 0x00) can't distinguish from a dropped write.
    const content = write(
      positioned(
        box(
          [
            {
              kind: "assembled-glyphs",
              text: "AB",
              sizePt: 12,
              color: BLACK,
              placements: [{ glyphId: LOWER_HOOK, xPt: 0, yPt: 0 }],
            },
          ],
          50,
        ),
      ),
    );
    expect(content).toContain("/Span <</ActualText <feff00410042> >> BDC\n");
  });

  it("encodes a supplementary-plane operator in /ActualText as a real surrogate pair", () => {
    const content = write(
      positioned(
        box(
          [
            {
              kind: "assembled-glyphs",
              text: "\u{1D400}",
              sizePt: 12,
              color: BLACK,
              placements: [{ glyphId: LOWER_HOOK, xPt: 0, yPt: 0 }],
            },
          ],
          50,
        ),
      ),
    );
    expect(content).toContain("/Span <</ActualText <feffd835dc00> >> BDC\n");
  });

  it("emits nothing at all for a construction with no placements", () => {
    expect(
      write(
        positioned(
          box(
            [
              {
                kind: "assembled-glyphs",
                text: "(",
                sizePt: 12,
                color: BLACK,
                placements: [],
              },
            ],
            50,
          ),
        ),
      ),
    ).toBe("");
  });
});

describe("collectUsedGlyphs", () => {
  it("collects an assembled construction's own glyph IDs with no code point, since they have none", () => {
    const used = collectUsedGlyphs(
      [
        positioned(
          box(
            [
              {
                kind: "assembled-glyphs",
                text: "(",
                sizePt: 12,
                color: BLACK,
                placements: [
                  { glyphId: LOWER_HOOK, xPt: 0, yPt: 0 },
                  { glyphId: UPPER_HOOK, xPt: 0, yPt: 0 },
                ],
              },
            ],
            50,
          ),
        ),
      ],
      loadMathFont().font,
    );
    expect([...used.keys()].sort((a, b) => a - b)).toEqual(
      [UPPER_HOOK, LOWER_HOOK].sort((a, b) => a - b),
    );
    expect(used.get(LOWER_HOOK)).toBeUndefined();
    expect(used.has(LOWER_HOOK)).toBe(true);
  });

  it("still resolves an ordinary glyph run to its own code point, and merges both kinds into one map", () => {
    const font = loadMathFont().font;
    const used = collectUsedGlyphs(
      [
        positioned(
          box(
            [
              {
                kind: "glyphs",
                xPt: 0,
                yPt: 0,
                text: "x",
                sizePt: 12,
                color: BLACK,
              },
              {
                kind: "assembled-glyphs",
                text: "(",
                sizePt: 12,
                color: BLACK,
                placements: [{ glyphId: LOWER_HOOK, xPt: 0, yPt: 0 }],
              },
            ],
            50,
          ),
        ),
      ],
      font,
    );
    const latinX = font.glyphId(0x78);
    expect(latinX).toBeDefined();
    expect(used.get(latinX!)).toBe(0x78);
    expect(used.get(LOWER_HOOK)).toBeUndefined();
    expect(used.size).toBe(2);
  });

  it("gives a glyph its code point regardless of which kind of item is encountered first", () => {
    const font = loadMathFont().font;
    // The LEFT PARENTHESIS LOWER HOOK is one of the few assembly pieces that DOES have a code point of its own (U+239D, see math-stretch.test.ts), so a document can genuinely draw it both as an assembly piece and as ordinary text.
    const hook = font.glyphId(0x239d);
    expect(hook).toBeDefined();
    const assemblyFirst: MathLayoutItem[] = [
      {
        kind: "assembled-glyphs",
        text: "(",
        sizePt: 12,
        color: BLACK,
        placements: [{ glyphId: hook!, xPt: 0, yPt: 0 }],
      },
      { kind: "glyphs", xPt: 0, yPt: 0, text: "⎝", sizePt: 12, color: BLACK },
    ];
    expect(
      collectUsedGlyphs([positioned(box(assemblyFirst, 50))], font).get(hook!),
    ).toBe(0x239d);
    expect(
      collectUsedGlyphs(
        [positioned(box([...assemblyFirst].reverse(), 50))],
        font,
      ).get(hook!),
    ).toBe(0x239d);
  });

  it("keeps the first code point a glyph resolved to, never overwriting it with a later one", () => {
    // A synthetic font, not the real STIX Two Math one: the real font's cmap is injective (its own module comment states this explicitly, and it holds for every code point actually probed), so no pair of distinct real code points ever reaches this guard with an already-resolved glyph. A font is built here that deliberately violates that invariant, to prove the guard itself -- first write wins -- rather than relying on real font data that can never exercise it.
    const COLLIDING_GLYPH = 999;
    const realFont = loadMathFont().font; // for the members this test never exercises, so nothing here needs its own hand-stubbed values
    const collidingFont: MathFont = {
      ...realFont,
      glyphId: (codePoint: number) =>
        codePoint === 0x41 || codePoint === 0x42 ? COLLIDING_GLYPH : undefined,
    };
    const used = collectUsedGlyphs(
      [
        positioned(
          box(
            [
              {
                kind: "glyphs",
                xPt: 0,
                yPt: 0,
                text: "AB",
                sizePt: 12,
                color: BLACK,
              },
            ],
            50,
          ),
        ),
      ],
      collidingFont,
    );
    expect(used.size).toBe(1);
    expect(used.get(COLLIDING_GLYPH)).toBe(0x41); // 'A' was seen first; 'B' resolves to the same glyph but must not overwrite it
  });
});

const RED = { r: 0.25, g: 0.5, b: 0.75 };
// No cmap entry in STIX Two Math (a Supplementary Private Use Area-B code point, never assigned by any font's own cmap) -- standing in for "this character has no glyph", the branch encodeGlyphRunToCids skips over rather than crashing on.
const UNMAPPED_CODE_POINT = 0x10fffd;

describe("writeFormulaContentStream, an ordinary glyph run", () => {
  it("shows the run's own CIDs at its own computed size, color, and position", () => {
    const font = loadMathFont().font;
    const aId = font.glyphId(0x41)!;
    // The integral sign, not a second Latin letter: its glyph ID (0x6a2) has a non-zero HIGH byte, which a plain ASCII pair (every Latin glyph ID here sits under 256) would never exercise -- proving encodeGlyphRunToCids packs (gid >> 8) at the right byte offset for the second CID, not just the first.
    const bId = font.glyphId(0x222b)!;
    expect(aId).toBeDefined();
    expect(bId).toBeDefined();
    expect(bId).toBeGreaterThan(0xff);
    const content = write(
      positioned(
        box(
          [
            {
              kind: "glyphs",
              xPt: 5,
              yPt: 20,
              text: "A∫",
              sizePt: 16,
              color: RED,
            },
          ],
          50,
        ),
      ),
    );
    // Box-local (5, 20) against a 50pt box placed with its own bottom-left at page (100, 200): x is a plain offset (105); y is re-anchored from "20pt down from the box's own top" to "30pt up from its bottom", landing at page y = 230.
    expect(content).toBe(
      "BT\n" +
        `/${RESOURCE} 16 Tf\n` +
        "0.25 0.5 0.75 rg\n" +
        "1 0 0 1 105 230 Tm\n" +
        `<${aId.toString(16).padStart(4, "0")}${bId.toString(16).padStart(4, "0")}> Tj\n` +
        "ET\n",
    );
  });

  it("skips a character with no glyph in the font's cmap, rather than crashing or emitting a bogus CID", () => {
    const font = loadMathFont().font;
    expect(font.glyphId(UNMAPPED_CODE_POINT)).toBeUndefined();
    const aId = font.glyphId(0x41)!;
    const content = write(
      positioned(
        box(
          [
            {
              kind: "glyphs",
              xPt: 0,
              yPt: 0,
              text: `A${String.fromCodePoint(UNMAPPED_CODE_POINT)}A`,
              sizePt: 12,
              color: BLACK,
            },
          ],
          50,
        ),
      ),
    );
    // Two 'A's worth of CIDs, not three code points' worth: the unmapped middle character contributed nothing.
    const hex = `${aId.toString(16).padStart(4, "0")}${aId.toString(16).padStart(4, "0")}`;
    expect(content).toContain(`<${hex}> Tj`);
  });

  it("emits nothing at all when every character in the run is unmapped", () => {
    const content = write(
      positioned(
        box(
          [
            {
              kind: "glyphs",
              xPt: 0,
              yPt: 0,
              text: String.fromCodePoint(UNMAPPED_CODE_POINT),
              sizePt: 12,
              color: BLACK,
            },
          ],
          50,
        ),
      ),
    );
    expect(content).toBe("");
  });
});

describe("writeFormulaContentStream, a rule", () => {
  it("fills an axis-aligned rectangle from the rule's own top-left corner and size, re-anchored to page space", () => {
    const content = write(
      positioned(
        box(
          [
            {
              kind: "rule",
              xPt: 10,
              yPt: 5,
              widthPt: 30,
              heightPt: 2,
              color: RED,
            },
          ],
          50,
        ),
      ),
    );
    // xPt=10 -> page x 110. topY = box-local yPt=5 re-anchored to page y 245 (200 + 50 - 5); the filled rect's own y is its BOTTOM edge, topY - heightPt = 243.
    expect(content).toBe("0.25 0.5 0.75 rg\n" + "110 243 30 2 re\n" + "f\n");
  });
});

describe("writeFormulaContentStream, a stroke", () => {
  it("draws an open polyline through every point, moveto first then lineto the rest", () => {
    const content = write(
      positioned(
        box(
          [
            {
              kind: "stroke",
              points: [
                { xPt: 0, yPt: 0 },
                { xPt: 4, yPt: 10 },
                { xPt: 8, yPt: 0 },
              ],
              widthPt: 1.5,
              color: RED,
            },
          ],
          50,
        ),
      ),
    );
    expect(content).toBe(
      "0.25 0.5 0.75 RG\n" +
        "1.5 w\n" +
        "100 250 m\n" + // (0,0) box-local -> page (100, 250)
        "104 240 l\n" + // (4,10) -> page (104, 240)
        "108 250 l\n" + // (8,0) -> page (108, 250)
        "S\n",
    );
  });

  it("draws a stroke at exactly the two-point minimum, the boundary a fewer-than-two check must not also exclude", () => {
    const content = write(
      positioned(
        box(
          [
            {
              kind: "stroke",
              points: [
                { xPt: 0, yPt: 0 },
                { xPt: 6, yPt: 6 },
              ],
              widthPt: 1,
              color: RED,
            },
          ],
          50,
        ),
      ),
    );
    expect(content).toBe(
      "0.25 0.5 0.75 RG\n" + "1 w\n" + "100 250 m\n" + "106 244 l\n" + "S\n",
    );
  });

  it("draws nothing for a stroke with fewer than two points", () => {
    const content = write(
      positioned(
        box(
          [
            {
              kind: "stroke",
              points: [{ xPt: 0, yPt: 0 }],
              widthPt: 1,
              color: RED,
            },
          ],
          50,
        ),
      ),
    );
    expect(content).toBe("");
  });

  it("draws nothing for a stroke with no points at all", () => {
    const content = write(
      positioned(
        box([{ kind: "stroke", points: [], widthPt: 1, color: RED }], 50),
      ),
    );
    expect(content).toBe("");
  });
});
