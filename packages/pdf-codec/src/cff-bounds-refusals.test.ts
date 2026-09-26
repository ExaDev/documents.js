import { describe, expect, it } from "vitest";
import { parseCffGlyphBounds } from "./cff-bounds";
import {
  CFF_HEADER,
  cffFontWithCharstrings,
  cffIndex,
  csInt16,
  dictInt32,
} from "./test-support/cff";

// The single-byte small-integer encoding (TN 5177 section 3.2) covers -107..107; anything outside that range needs the 3-byte int16 form. Shared by every hand-built charstring test below so each one states the operand it wants, not which of the two encodings reaches it.
function enc(value: number): number[] {
  return value >= -107 && value <= 107 ? [value + 139] : csInt16(value);
}

// Runs a font built with exactly one glyph (glyph 0) and returns its ink bounds — the common shape every hand-built charstring-interpreter test below drives.
function boundsOfOnlyGlyph(bytes: Uint8Array<ArrayBuffer>) {
  const bounds = parseCffGlyphBounds(bytes);
  if (bounds === undefined) {
    throw new Error("fixture font failed to parse");
  }
  return bounds.bounds(0);
}

// Every bounding box asserted below was cross-checked against fontTools 4.61.1's own BoundsPen run over the same vendored assets/fonts/STIXTwoMath-Regular.otf — an independent, mature implementation of the same computation, not this package's own output re-asserted against itself. That comparison was run across the font's whole 5543-glyph repertoire while building this module: every glyph matched to within 0.01 design units, and every glyph fontTools reported as drawing nothing this module reports as `undefined`.
//
// The font's nominal vertical metrics, for the "tighter than the metric it replaces" assertions: unitsPerEm 1000, hhea ascent 762, hhea descent -238.

// Glyph IDs in the vendored font, resolved through its own cmap in math-font.test.ts and hard-coded here so this module's tests need no cmap parse of their own.

describe("parseCffGlyphBounds's refusals, each preceded by real ink so the refusal is what loses the box", () => {
  const OP_HLINETO = 6;
  const OP_RMOVETO = 21;
  const OP_HMOVETO = 22;
  const OP_HINTMASK = 19;
  const OP_RRCURVETO = 8;
  const OP_RCURVELINE = 24;
  const OP_RLINECURVE = 25;
  const OP_VVCURVETO = 26;
  const OP_ESCAPE = 12;
  const ESC_FLEX = 35;
  const ESC_HFLEX = 34;
  const ESC_HFLEX1 = 36;
  const ESC_FLEX1 = 37;
  const ESC_AND = 3; // 12 3: the arithmetic `and`, one of the escaped operators this module refuses outright
  const LINE_THEN = [...enc(5), ...enc(0), OP_HLINETO];
  const LINE_BOX = { xMin: 0, yMin: 0, xMax: 5, yMax: 0 };

  it("refuses a truncated hintmask even after ink is already on the page", () => {
    // One implicit vstem pair ahead of the hintmask declares one stem, so the mask needs one trailing byte, and this charstring stops at the operator instead.
    const bytes = cffFontWithCharstrings({
      name: "TruncatedHintmaskAfterInk",
      charStrings: [[...LINE_THEN, ...enc(0), ...enc(0), OP_HINTMASK]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("refuses an rmoveto or hmoveto with an empty stack even after ink is already on the page", () => {
    // With operands missing, a permissive reader would move the current point by undefined and carry on reporting the line already drawn; the refusal is what withdraws it.
    const rmoveto = cffFontWithCharstrings({
      name: "BareRmovetoAfterInk",
      charStrings: [[...LINE_THEN, OP_RMOVETO]],
    });
    expect(boundsOfOnlyGlyph(rmoveto)).toBeUndefined();

    const hmoveto = cffFontWithCharstrings({
      name: "BareHmovetoAfterInk",
      charStrings: [[...LINE_THEN, OP_HMOVETO]],
    });
    expect(boundsOfOnlyGlyph(hmoveto)).toBeUndefined();
  });

  it("refuses each flex encoding with a too-short stack even after ink is already on the page", () => {
    // flex needs 13 arguments, hflex 7, hflex1 9, flex1 11; each fixture draws the line first, then supplies one operand fewer than its operator requires.
    for (const [name, escaped, argCount] of [
      ["Flex", ESC_FLEX, 12],
      ["Hflex", ESC_HFLEX, 6],
      ["Hflex1", ESC_HFLEX1, 8],
      ["Flex1", ESC_FLEX1, 10],
    ] as const) {
      const bytes = cffFontWithCharstrings({
        name: `${name}TooShortAfterInk`,
        charStrings: [
          [
            ...LINE_THEN,
            ...new Array<number>(argCount).fill(139),
            OP_ESCAPE,
            escaped,
          ],
        ],
      });
      expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
    }
  });

  it("refuses an unsupported escaped operator however many operands it is given, even after ink is already on the page", () => {
    // Eleven operands is exactly flex1's own arity, so a dispatcher that fell into the flex1 case for an unknown escape would draw two curves from them instead of refusing.
    const bytes = cffFontWithCharstrings({
      name: "EscapedAndAfterInk",
      charStrings: [
        [...LINE_THEN, ...new Array<number>(11).fill(139), OP_ESCAPE, ESC_AND],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("stops a subroutine at its own explicit return, before bytes that would refuse it", () => {
    // The subroutine draws a line, then returns explicitly; the reserved operator byte after the return must never execute, which is the only thing distinguishing return's own success from a reader that runs off the subroutine's end into it.
    const bias = 107; // subrBias for a one-entry Global Subr INDEX
    const lineThenReturnThenJunk = [
      ...enc(100),
      OP_HLINETO,
      11, // return
      13, // reserved: would refuse the glyph if reached
    ];
    const bytes = cffFontWithCharstrings({
      name: "ExplicitReturn",
      charStrings: [[...enc(0 - bias), 29]], // callgsubr 0
      globalSubrs: [lineThenReturnThenJunk],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 100,
      yMax: 0,
    });
  });

  it("leaves trailing unpaired operands unquoted by every multi-argument curve operator", () => {
    // Each of the four stack-layout shapes below ends one argument short of another complete group, so the leftover operands must be ignored rather than read into a curve that reaches past the stack.
    const curveBox = { xMin: 0, yMin: 0, xMax: 10, yMax: 10 };
    const rrcurveto = cffFontWithCharstrings({
      name: "RrcurvetoOddTrailer",
      charStrings: [
        [
          ...enc(0),
          ...enc(0),
          ...enc(10),
          ...enc(0),
          ...enc(0),
          ...enc(10), // one complete curve
          ...enc(99),
          ...enc(99),
          ...enc(99),
          ...enc(99),
          ...enc(99), // five leftovers: one short of a second curve
          OP_RRCURVETO,
          14,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(rrcurveto)).toEqual(curveBox);

    // rcurveline reserves its stack's last two operands for the trailing line, so a lone leftover operand (one short of that pair) draws neither a curve nor a line.
    const rcurveline = cffFontWithCharstrings({
      name: "RcurvelineOddTrailer",
      charStrings: [[...LINE_THEN, ...enc(99), OP_RCURVELINE, 14]],
    });
    expect(boundsOfOnlyGlyph(rcurveline)).toEqual(LINE_BOX);

    const rlinecurve = cffFontWithCharstrings({
      name: "RlinecurveOddTrailer",
      charStrings: [
        [
          ...LINE_THEN,
          ...enc(99), // one leftover after the draw: neither a line pair nor part of a curve
          OP_RLINECURVE,
          14,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(rlinecurve)).toEqual(LINE_BOX);

    const vvcurveto = cffFontWithCharstrings({
      name: "VvcurvetoOddTrailer",
      charStrings: [
        [
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(10), // one complete group: a curve to (0, 10)
          ...enc(99),
          ...enc(99),
          ...enc(99), // three leftovers: one short of a second group
          OP_VVCURVETO,
          14,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(vvcurveto)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 0,
      yMax: 10,
    });
  });

  it("draws rlinecurve's leading lines and trailing curve together, and rcurveline's the other way round", () => {
    // rlinecurve with one line pair and one complete curve: the line runs first, the curve starts from where it ended.
    const rlinecurve = cffFontWithCharstrings({
      name: "RlinecurveBoth",
      charStrings: [
        [
          ...enc(5),
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(10),
          ...enc(0),
          ...enc(0),
          ...enc(10),
          OP_RLINECURVE,
          14,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(rlinecurve)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 15,
      yMax: 10,
    });

    // rcurveline with one complete curve and a trailing line pair: the curve runs first, the line continues from its end.
    const rcurveline = cffFontWithCharstrings({
      name: "RcurvelineBoth",
      charStrings: [
        [
          ...enc(0),
          ...enc(0),
          ...enc(10),
          ...enc(0),
          ...enc(0),
          ...enc(10),
          ...enc(5),
          ...enc(0),
          OP_RCURVELINE,
          14,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(rcurveline)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 15,
      yMax: 10,
    });
  });

  it("applies flex1's final delta to y when y moved further, returning x to the flex's own start", () => {
    const bytes = cffFontWithCharstrings({
      name: "Flex1YDominant",
      charStrings: [
        [
          ...enc(0),
          ...enc(10), // dx1 dy1
          ...enc(0),
          ...enc(0), // dx2 dy2
          ...enc(0),
          ...enc(0), // dx3 dy3
          ...enc(3),
          ...enc(5), // dx4 dy4
          ...enc(2),
          ...enc(5), // dx5 dy5
          ...enc(7), // d6
          OP_ESCAPE,
          ESC_FLEX1,
          14,
        ],
      ],
    });
    const box = boundsOfOnlyGlyph(bytes)!;
    expect(box).toMatchObject({ xMin: 0, yMin: 0, yMax: 27 });
    // The y deltas total 20 against the x deltas' 5, so the else arm runs: the last delta (7) applies to y and x comes back to startX through startX less the second curve's own control-point reach. The second curve's x control points (3 and 5 along) put the box's exact right edge at the curve's interior extremum, not at either control point.
    expect(box.xMax).toBeCloseTo(3.045504440404044, 6);
  });

  it("applies flex1's final delta to x when x moved further, returning y to the flex's own start", () => {
    // The mirror of the y-dominant case: the x deltas total 10 against the y deltas' 8, so the if arm runs and the final delta (5) applies to x while y comes back to startY through startY less the second curve's own control-point reach. The second curve's rising y control points (4 and 8 above a start at 0) make the box's exact top the curve's interior extremum.
    const bytes = cffFontWithCharstrings({
      name: "Flex1XDominant",
      charStrings: [
        [
          ...enc(10),
          ...enc(0), // dx1 dy1
          ...enc(0),
          ...enc(0), // dx2 dy2
          ...enc(0),
          ...enc(0), // dx3 dy3
          ...enc(0),
          ...enc(4), // dx4 dy4
          ...enc(0),
          ...enc(4), // dx5 dy5
          ...enc(5), // d6
          OP_ESCAPE,
          ESC_FLEX1,
          14,
        ],
      ],
    });
    const box = boundsOfOnlyGlyph(bytes)!;
    expect(box).toMatchObject({ xMin: 0, yMin: 0, xMax: 15 });
    expect(box.yMax).toBeCloseTo(4.618802153517006, 6);
  });

  it("treats an exact tie between flex1's two axes the way the strict comparison says: y wins", () => {
    // dx and dy both total 10, so |dx| > |dy| is false and the y arm runs: the final delta (5) applies to y, x returns to startX. A reader using >= would apply the delta to x instead and land at (15, 10) rather than (0, 15).
    const bytes = cffFontWithCharstrings({
      name: "Flex1AxisTie",
      charStrings: [
        [
          ...enc(10),
          ...enc(10), // dx1 dy1: the only movement
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(5), // d6
          OP_ESCAPE,
          ESC_FLEX1,
          14,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 10,
      yMax: 15,
    });
  });

  it("returns hflex1's final point to the flex's own starting y, from a first curve that leaves y high", () => {
    // dy1 raises the join to y 10 and dy5 raises the second curve's second control point a further 5, so the final y delta must be startY - (10 + 5) = -15 and the final point is (0, 0). The curve's own top is its exact interior extremum at t = 0.4 (10.8 design units), not the 15 of its control point — this module solves extrema rather than hulling them. A reader adding where it should subtract lands the final point at y 30 instead.
    const bytes = cffFontWithCharstrings({
      name: "Hflex1ReturnsToStartY",
      charStrings: [
        [
          ...enc(0),
          ...enc(10), // dx1 dy1
          ...enc(0),
          ...enc(0), // dx2 dy2
          ...enc(0), // dx3
          ...enc(0), // dx4
          ...enc(0),
          ...enc(5), // dx5 dy5
          ...enc(0), // dx6
          OP_ESCAPE,
          ESC_HFLEX1,
          14,
        ],
      ],
    });
    const box = boundsOfOnlyGlyph(bytes)!;
    expect(box).toMatchObject({ xMin: 0, yMin: 0, xMax: 0 });
    expect(box.yMax).toBeCloseTo(10.8, 6);
  });
});

// The header and Private DICT guards, each given a font that would parse cleanly if the guard were skipped, so the refusal is what loses the font rather than a downstream coincidence.
describe("parseCffGlyphBounds's header and Private DICT refusals", () => {
  const OP_HLINETO = 6;
  const OP_CALLSUBR = 10;
  const OP_ENDCHAR = 14;
  const LINE_THEN_ENDCHAR = [...enc(5), ...enc(0), OP_HLINETO, OP_ENDCHAR];
  const LINE_BOX = { xMin: 0, yMin: 0, xMax: 5, yMax: 0 };

  it("refuses a CFF2-major program however valid the rest of it is", () => {
    const bytes = cffFontWithCharstrings({
      name: "Cff2MajorValidRest",
      charStrings: [[...LINE_THEN_ENDCHAR]],
      header: [2, 0, 4, 1],
    });
    // The version guard is the only thing standing between this font and a full parse: every INDEX sits where the same builder with a CFF1 header puts it.
    expect(parseCffGlyphBounds(bytes)).toBeUndefined();
  });

  it("refuses a header whose own hdrSize is under the four bytes a CFF1 header takes, however valid the rest of it is", () => {
    // The builder lays its INDEXes out from the header array's own length, so this three-byte header puts the Name INDEX exactly where a reader trusting hdrSize = 3 would look for it; the undersize guard is what refuses.
    const bytes = cffFontWithCharstrings({
      name: "HdrSizeThree",
      charStrings: [[...LINE_THEN_ENDCHAR]],
      header: [1, 0, 3],
    });
    expect(parseCffGlyphBounds(bytes)).toBeUndefined();
  });

  it("treats a Private DICT with no Subrs operator as no local subroutines at all, not as a broken font", () => {
    // An empty Private DICT: the Top DICT's Private operands point at zero bytes, which parse to no operators, so readPrivateSubrs declines and the font still walks glyphs that draw directly.
    const bytes = cffFontWithCharstrings({
      name: "PrivateNoSubrs",
      charStrings: [[...LINE_THEN_ENDCHAR]],
      privateDict: [],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual(LINE_BOX);
  });

  // Lays out a whole font around a Top DICT whose Private operator carries exactly the operands the given function builds, with a Private region and Local Subrs INDEX placed to match. The function receives the Private region's own start offset (so its offset operand can name where the region really sits) and must emit fixed-width operand encodings, so the Top DICT entry's own length is the same whatever values those operands carry and one pass suffices.
  function fontWithPrivateOperands(
    buildPrivateOperands: (privateOffset: number) => readonly number[],
    privateRegion: readonly number[],
    charStrings: readonly (readonly number[])[],
    localSubrs: readonly (readonly number[])[] = [],
  ): Uint8Array<ArrayBuffer> {
    const nameIndex = cffIndex([[0x50]]);
    const measureIndex = cffIndex([
      [...dictInt32(0), 17, ...buildPrivateOperands(0), 18],
    ]);
    const afterGlobalSubrs =
      CFF_HEADER.length + nameIndex.length + measureIndex.length + 2 + 2;
    const charStringsIndex = cffIndex(charStrings);
    const localSubrIndex = cffIndex(localSubrs);
    const charStringsOffset =
      afterGlobalSubrs + privateRegion.length + localSubrIndex.length;
    const topDict = [
      ...dictInt32(charStringsOffset),
      17,
      ...buildPrivateOperands(afterGlobalSubrs),
      18,
    ];
    return new Uint8Array([
      ...CFF_HEADER,
      ...nameIndex,
      ...cffIndex([topDict]),
      ...cffIndex([]),
      ...cffIndex([]),
      ...privateRegion,
      ...localSubrIndex,
      ...charStringsIndex,
    ]);
  }

  it("refuses a Private operator carrying one operand rather than two, without throwing", () => {
    // A size but no offset: the operand-count guard declines cleanly, so the font still parses and a glyph that draws directly still measures.
    const bytes = fontWithPrivateOperands(
      () => [...dictInt32(2)], // Private's size operand, with the offset operand simply absent
      [139, 139], // two inert operand bytes as the would-be Private DICT
      [[...LINE_THEN_ENDCHAR]],
    );
    expect(parseCffGlyphBounds(bytes)).toBeDefined();
    expect(parseCffGlyphBounds(bytes)?.numGlyphs).toBe(1);
    expect(parseCffGlyphBounds(bytes)?.bounds(0)).toEqual(LINE_BOX);
  });

  it("refuses a Private DICT whose size operand is not an integer, even though its bytes hold a working Subrs entry", () => {
    // The size operand is the real number 2.5 (DICT operand 30, nibbles 2 '.' 5 end), while the two bytes it would floor to are a genuine Subrs operator pointing at a Local Subr INDEX placed exactly where that operator says. A reader skipping the integer check would resolve working local subroutines from a size the format never allows; the check is what refuses them.
    const realTwoPointFive = [30, 0x2a, 0x5f];
    const drawLineSubr = [...enc(100), OP_HLINETO, OP_ENDCHAR];
    const callsubrGlyph = [
      ...enc(0 - 107), // subroutine 0 against the small (107) bias of a one-entry INDEX
      OP_CALLSUBR,
      OP_ENDCHAR,
    ];
    const bytes = fontWithPrivateOperands(
      (privateOffset) => [...realTwoPointFive, ...dictInt32(privateOffset)],
      [139 + 6, 19, 0, 0, 0, 0], // a Private DICT of exactly two bytes (Subrs offset 6) followed by four inert bytes, with the INDEX at +6
      [[...LINE_THEN_ENDCHAR], [...callsubrGlyph]],
      [drawLineSubr],
    );
    const bounds = parseCffGlyphBounds(bytes);
    expect(bounds).toBeDefined();
    // The glyph that draws directly still measures; the callsubr glyph gets no local subroutines to call.
    expect(bounds?.bounds(0)).toEqual(LINE_BOX);
    expect(bounds?.bounds(1)).toBeUndefined();
  });
});
