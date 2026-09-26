import { describe, expect, it } from "vitest";
import { parseCffGlyphBounds } from "./cff-bounds";
import { cffFontWithCharstrings, csInt16 } from "./test-support/cff";

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

describe("parseCffGlyphBounds's charstring interpreter: hmoveto/vmoveto, escaped operators, and the remaining interpreter boundaries", () => {
  const OP_HSTEM = 1;
  const OP_VMOVETO = 4;
  const OP_RLINETO = 5;
  const OP_HLINETO = 6;
  const OP_VLINETO = 7;
  const OP_ESCAPE = 12;
  const OP_ENDCHAR = 14;
  const OP_HSTEMHM = 18;
  const OP_HINTMASK = 19;
  const OP_HMOVETO = 22;
  const OP_RCURVELINE = 24;
  const OP_RLINECURVE = 25;
  const OP_VVCURVETO = 26;
  const OP_CALLGSUBR = 29;
  const ESC_HFLEX = 34;
  const ESC_FLEX = 35;
  const ESC_HFLEX1 = 36;
  const ESC_FLEX1 = 37;
  const RESERVED_OPERATOR = 13;
  const MAX_SUBR_DEPTH = 10;
  const MAX_OPERAND_STACK = 48;
  const MAX_OPERATIONS_PER_GLYPH = 100_000;

  // A chain of `depth` distinct global subroutines, each calling the next, the last one drawing a single horizontal line — lets a test reach an EXACT nesting depth (rather than only "eventually recurses past the limit", which the self-calling DeepRecursion fixture above already covers) to pin the interpreter's own off-by-one boundary.
  function callChainOfDepth(depth: number): {
    charStrings: number[][];
    globalSubrs: number[][];
  } {
    const bias = 107; // subrBias for a chain this short (count < 1240)
    const globalSubrs: number[][] = [];
    for (let i = 0; i < depth; i++) {
      globalSubrs.push(
        i === depth - 1
          ? [enc(100)[0]!, OP_HLINETO]
          : [...enc(i + 1 - bias), OP_CALLGSUBR],
      );
    }
    return { charStrings: [[...enc(0 - bias), OP_CALLGSUBR]], globalSubrs };
  }

  it("draws through a subroutine chain nested exactly to the spec's own depth limit", () => {
    const { charStrings, globalSubrs } = callChainOfDepth(MAX_SUBR_DEPTH);
    const bytes = cffFontWithCharstrings({
      name: "ExactSubrDepth",
      charStrings,
      globalSubrs,
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 100,
      yMax: 0,
    });
  });

  it("draws through exactly MAX_OPERAND_STACK operands cleared by one operator, one short of the overrun this module already refuses", () => {
    // MAX_OPERAND_STACK single-byte zero operands, THEN a stack-clearing hstem: the stack never exceeds the limit because hstem clears it before another operand is pushed, unlike the StackOverflow fixture above, which never clears the stack at all. A trailing draw after the hstem makes the "succeeds" claim observable — a glyph that draws nothing reports undefined regardless of whether it was rejected for overflowing or genuinely walked to completion, so only a real box proves the walk actually continued.
    const zeros = new Array<number>(MAX_OPERAND_STACK).fill(139);
    const bytes = cffFontWithCharstrings({
      name: "ExactOperandStack",
      charStrings: [
        [...zeros, OP_HSTEM, ...enc(5), ...enc(0), OP_HLINETO, OP_ENDCHAR],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 5,
      yMax: 0,
    });
  });

  it("draws through exactly MAX_OPERATIONS_PER_GLYPH operators, one short of the ceiling this module already refuses", () => {
    // The ceiling counts every operand push and every operator dispatch as one operation each (execute's own per-iteration counter): MAX filler hstems, plus the trailing draw's own 2 operand pushes and 2 operators (hlineto, endchar), totals exactly MAX_OPERATIONS_PER_GLYPH.
    const exact = new Array<number>(MAX_OPERATIONS_PER_GLYPH - 4).fill(
      OP_HSTEM,
    );
    const bytes = cffFontWithCharstrings({
      name: "ExactOperationCeiling",
      charStrings: [[...exact, ...enc(5), ...enc(0), OP_HLINETO, OP_ENDCHAR]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 5,
      yMax: 0,
    });
  });

  it("decodes the 16.16 fixed-point operand form (TN 5177 section 3.2, operand 255)", () => {
    // 0x0002_8000 is 2.5 in 16.16 fixed point (0x0002_0000 = 2, + 0x8000 = 0.5).
    const FIXED_2_5 = [255, 0x00, 0x02, 0x80, 0x00];
    const bytes = cffFontWithCharstrings({
      name: "FixedOperand",
      charStrings: [[...FIXED_2_5, OP_HMOVETO, ...FIXED_2_5, OP_VLINETO]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 2.5, // hmoveto's own destination is never added to the box; only the line drawn afterward is
      yMin: 0,
      xMax: 2.5,
      yMax: 2.5,
    });
  });

  it("returns undefined for a truncated 16.16 fixed-point operand", () => {
    const bytes = cffFontWithCharstrings({
      name: "TruncatedFixed",
      charStrings: [[255, 0x00, 0x02, 0x80]], // needs 4 bytes after 255; only 3 supplied
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("decodes a positive 16-bit integer operand (TN 5177 section 3.2, operand 28)", () => {
    // Every existing int16 fixture uses a NEGATIVE value (the medium-bias subroutine index); this is the positive half of the same 3-byte form.
    const bytes = cffFontWithCharstrings({
      name: "PositiveInt16Operand",
      charStrings: [[...csInt16(300), OP_HMOVETO, OP_ENDCHAR]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined(); // hmoveto alone draws nothing; this is purely a decode smoke test
  });

  it("returns undefined for a truncated 16-bit integer operand", () => {
    const bytes = cffFontWithCharstrings({
      name: "TruncatedInt16",
      charStrings: [[28, 0x01]], // needs 2 bytes after 28; only 1 supplied
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("returns undefined for a truncated medium-range single-byte-extra operand", () => {
    const bytes = cffFontWithCharstrings({
      name: "TruncatedMedium",
      charStrings: [[247]], // 247 (medium-positive) needs one more byte
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("returns undefined for a truncated negative-medium-range single-byte-extra operand", () => {
    const bytes = cffFontWithCharstrings({
      name: "TruncatedNegativeMedium",
      charStrings: [[251]], // 251 (medium-negative) needs one more byte
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("moves the current point horizontally with a bare hmoveto, the minimal one-operand case", () => {
    const bytes = cffFontWithCharstrings({
      name: "BareHmoveto",
      charStrings: [[...enc(5), OP_HMOVETO, ...enc(3), OP_HLINETO, OP_ENDCHAR]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 5,
      yMin: 0,
      xMax: 8,
      yMax: 0,
    });
  });

  it("moves the current point vertically with a bare vmoveto, applying the delta to y rather than x", () => {
    const bytes = cffFontWithCharstrings({
      name: "BareVmoveto",
      charStrings: [[...enc(4), OP_VMOVETO, ...enc(2), OP_VLINETO, OP_ENDCHAR]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 4,
      xMax: 0,
      yMax: 6,
    });
  });

  it("moves the current point diagonally with a bare rmoveto, the minimal two-operand case", () => {
    const OP_RMOVETO = 21;
    const bytes = cffFontWithCharstrings({
      name: "BareRmoveto",
      charStrings: [
        [...enc(5), ...enc(4), OP_RMOVETO, ...enc(1), ...enc(1), OP_RLINETO],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 5,
      yMin: 4,
      xMax: 6,
      yMax: 5,
    });
  });

  it("discards rmoveto's own leading width operand, using only the last two operands as dx/dy", () => {
    // 3 operands: a leading width the interpreter must shift off, then dx=5, dy=4. Using the wrong two (say, the first two, treating the width as dx) would move to a completely different point.
    const OP_RMOVETO = 21;
    const bytes = cffFontWithCharstrings({
      name: "RmovetoWithWidth",
      charStrings: [
        [
          ...enc(999),
          ...enc(5),
          ...enc(4),
          OP_RMOVETO,
          ...enc(1),
          ...enc(1),
          OP_RLINETO,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 5,
      yMin: 4,
      xMax: 6,
      yMax: 5,
    });
  });

  it("discards hmoveto's own leading width operand, using only the last operand as dx", () => {
    const bytes = cffFontWithCharstrings({
      name: "HmovetoWithWidth",
      charStrings: [
        [...enc(999), ...enc(5), OP_HMOVETO, ...enc(3), OP_HLINETO, OP_ENDCHAR],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 5,
      yMin: 0,
      xMax: 8,
      yMax: 0,
    });
  });

  it("discards vmoveto's own leading width operand, using only the last operand as dy", () => {
    const bytes = cffFontWithCharstrings({
      name: "VmovetoWithWidth",
      charStrings: [
        [...enc(999), ...enc(4), OP_VMOVETO, ...enc(2), OP_VLINETO, OP_ENDCHAR],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 4,
      xMax: 0,
      yMax: 6,
    });
  });

  it("finds both of a cubic curve's own interior extrema when the derivative's quadratic has two distinct real roots", () => {
    // Both axes share control points 0, 30, -30, 0 (an S-shaped overshoot: the curve swings past its own two endpoints in both directions before returning to 0). The derivative's quadratic (a=180, b=-180, c=30) has two real, distinct roots strictly inside (0,1) — t=0.2113 and t=0.7887 — giving an exact extremum of +-5*sqrt(3) on each axis, verified independently by dense sampling.
    const OP_RRCURVETO = 8;
    const bytes = cffFontWithCharstrings({
      name: "CurveTwoRealRoots",
      charStrings: [
        [
          ...enc(30),
          ...enc(30),
          ...enc(-60),
          ...enc(-60),
          ...enc(30),
          ...enc(30),
          OP_RRCURVETO,
          OP_ENDCHAR,
        ],
      ],
    });
    const bounds = boundsOfOnlyGlyph(bytes);
    if (bounds === undefined) {
      throw new Error("fixture glyph unexpectedly drew nothing");
    }
    const extremum = 5 * Math.sqrt(3);
    expect(bounds.xMin).toBeCloseTo(-extremum, 9);
    expect(bounds.xMax).toBeCloseTo(extremum, 9);
    expect(bounds.yMin).toBeCloseTo(-extremum, 9);
    expect(bounds.yMax).toBeCloseTo(extremum, 9);
  });

  it("finds a cubic axis's own extremum through the degenerate (a === 0) linear derivative case, not just the quadratic formula", () => {
    // x control points 0, 10, 5, -15: a = -0+30-15-15 = 0 exactly (the derivative's own leading term vanishes), so this axis's extremum can only come from includeCubicAxis's linear (b !== 0) fallback, never the quadratic formula the test above exercises. The true extremum (verified by dense sampling) is xMax=5 at t=1/3, past both endpoints 0 and -15; y stays flat at 0 throughout, so this isolates the x-axis's own degenerate branch from the y-axis's ordinary one.
    const OP_RRCURVETO = 8;
    const bytes = cffFontWithCharstrings({
      name: "CurveDegenerateAxis",
      charStrings: [
        [
          ...enc(10),
          ...enc(0),
          ...enc(-5),
          ...enc(0),
          ...enc(-20),
          ...enc(0),
          OP_RRCURVETO,
          OP_ENDCHAR,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: -15,
      yMin: 0,
      xMax: 5,
      yMax: 0,
    });
  });

  it("returns undefined for an rmoveto with fewer than 2 operands on the stack", () => {
    const OP_RMOVETO = 21;
    const bytes = cffFontWithCharstrings({
      name: "RmovetoTooFewArgs",
      charStrings: [[...enc(5), OP_RMOVETO]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("uses parity (evenArgs), not a fixed expected count, to detect a stack-clearing hint operator's own leading width", () => {
    // 9 zero-width stem pairs (18 operands, even — no width to shift) registered via hstemhm, followed by a bare hintmask that must consume exactly ceil(9/8)=2 mask bytes. If the width-detection wrongly used "stack.length > 0" instead of parity, it would shift one operand off, leaving 17 (8 stems, ceil(8/8)=1 mask byte) — desyncing the byte stream, so the hlineto that follows would be misread and the draw would fail instead of producing this exact box.
    const pairs18 = new Array<number>(18).fill(139); // 9 zero-width stem pairs
    const bytes = cffFontWithCharstrings({
      name: "HstemWidthParity",
      charStrings: [
        [
          ...pairs18,
          OP_HSTEMHM,
          OP_HINTMASK,
          0xff,
          0xff, // 2 mask bytes, matching the 9 real stems
          ...enc(5),
          ...enc(0),
          OP_HLINETO,
          OP_ENDCHAR,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 5,
      yMax: 0,
    });
  });

  it("applies vvcurveto's own leading cross-axis delta only to the first curve of a multi-curve call, not every curve", () => {
    // Two curve groups plus a leading cross value (9 operands: 1 + 4 + 4). The cross moves the FIRST curve's own first control point off-axis; the second curve gets no cross at all, so x never moves past the first curve's own contribution.
    const bytes = cffFontWithCharstrings({
      name: "VvcurvetoCrossOnce",
      charStrings: [
        [
          ...enc(5), // leading cross
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(10), // group 1: dy1=0,dx2=0,dy2=0,dy3=10
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(10), // group 2: dy1=0,dx2=0,dy2=0,dy3=10, no cross
          OP_VVCURVETO,
          OP_ENDCHAR,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 5,
      yMax: 20,
    });
  });

  it("stops an rlineto after the last complete coordinate pair, ignoring a trailing unpaired operand", () => {
    const bytes = cffFontWithCharstrings({
      name: "RlinetoOddTrailer",
      charStrings: [[...enc(5), ...enc(0), ...enc(3), OP_RLINETO, OP_ENDCHAR]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 5,
      yMax: 0,
    });
  });

  it("treats an rcurveline stack too short to reserve its own trailing line pair as a bare line, not a curve", () => {
    // 7 operands: not enough to fit a 6-argument curve AND still reserve 2 for the mandatory trailing line, so the whole stack is read as just the trailing line — the first two operands only, the other five ignored.
    const bytes = cffFontWithCharstrings({
      name: "RcurvelineShortStack",
      charStrings: [
        [
          ...enc(10),
          ...enc(0),
          ...enc(1),
          ...enc(1),
          ...enc(1),
          ...enc(1),
          ...enc(1),
          OP_RCURVELINE,
          OP_ENDCHAR,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 10,
      yMax: 0,
    });
  });

  it("treats an rlinecurve stack too short to reserve any leading line pair as a bare curve, not a line", () => {
    // 7 operands: below the threshold that would let the loop treat any of them as a leading line, so all read as the mandatory trailing 6-argument curve, with the 7th ignored.
    const bytes = cffFontWithCharstrings({
      name: "RlinecurveShortStack",
      charStrings: [
        [
          ...enc(4),
          ...enc(0),
          ...enc(4),
          ...enc(0),
          ...enc(4),
          ...enc(0),
          ...enc(999),
          OP_RLINECURVE,
          OP_ENDCHAR,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 12,
      yMax: 0,
    });
  });

  it("draws through a real Global Subrs INDEX reached via callgsubr, the mirror of the existing local-subr success case", () => {
    // Proves callgsubr's OWN branch (context.globalSubrs/globalBias), not local's: no Private DICT/Local Subrs exist at all here, so a wrong branch (using the undefined local subrs, or the wrong bias) fails to resolve any subroutine.
    const bias = 107; // subrBias for a one-entry Global Subrs INDEX (count < 1240)
    const bytes = cffFontWithCharstrings({
      name: "DrawViaGlobalSubr",
      charStrings: [[...enc(0 - bias), OP_CALLGSUBR]],
      globalSubrs: [[...enc(100), OP_HLINETO]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 100,
      yMax: 0,
    });
  });

  it("propagates a failure from deeper in the charstring even after this glyph has already drawn something", () => {
    // Each of these draws a line first (box.drawn becomes true), then hits a failure that must still make the WHOLE glyph undefined — proving the failure genuinely propagates rather than being masked by the box already having content, which is exactly the difference a `return true` in place of the interpreter's own `return false` would hide.
    const drawFirst = [...enc(5), ...enc(0), OP_HLINETO];

    const emptyCallsubrStack = cffFontWithCharstrings({
      name: "DrawnThenEmptyCallsubr",
      charStrings: [[...drawFirst, OP_CALLGSUBR]],
    });
    expect(boundsOfOnlyGlyph(emptyCallsubrStack)).toBeUndefined();

    const unresolvedSubr = cffFontWithCharstrings({
      name: "DrawnThenUnresolvedSubr",
      charStrings: [[...drawFirst, ...enc(0), OP_CALLGSUBR]],
      globalSubrs: [], // count 0: any index resolves to nothing
    });
    expect(boundsOfOnlyGlyph(unresolvedSubr)).toBeUndefined();

    const bias = 107;
    const nestedFailure = cffFontWithCharstrings({
      name: "DrawnThenNestedFailure",
      charStrings: [[...drawFirst, ...enc(0 - bias), OP_CALLGSUBR]],
      globalSubrs: [[RESERVED_OPERATOR]], // fails immediately once entered
    });
    expect(boundsOfOnlyGlyph(nestedFailure)).toBeUndefined();

    const reservedAfterDrawing = cffFontWithCharstrings({
      name: "DrawnThenReserved",
      charStrings: [[...drawFirst, RESERVED_OPERATOR]],
    });
    expect(boundsOfOnlyGlyph(reservedAfterDrawing)).toBeUndefined();

    // The three interpreter ceilings, and the truncated-operand decode failure: each is itself only reachable/observable this way, since a charstring that fails before drawing anything is indistinguishable from one that "succeeds" while drawing nothing (both report undefined regardless of which is correct).
    const operationCeilingAfterDrawing = cffFontWithCharstrings({
      name: "DrawnThenOperationCeiling",
      charStrings: [
        [
          ...drawFirst,
          ...new Array<number>(MAX_OPERATIONS_PER_GLYPH).fill(OP_HSTEM),
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(operationCeilingAfterDrawing)).toBeUndefined();

    const operandStackOverflowAfterDrawing = cffFontWithCharstrings({
      name: "DrawnThenOperandStackOverflow",
      charStrings: [
        [...drawFirst, ...new Array<number>(MAX_OPERAND_STACK + 1).fill(139)],
      ],
    });
    expect(boundsOfOnlyGlyph(operandStackOverflowAfterDrawing)).toBeUndefined();

    const subrDepthOverflowAfterDrawing = (() => {
      const selfCall = [32, OP_CALLGSUBR]; // -107, this INDEX's own subroutine, recursing forever
      return cffFontWithCharstrings({
        name: "DrawnThenSubrDepthOverflow",
        charStrings: [[...drawFirst, ...selfCall]],
        globalSubrs: [selfCall],
      });
    })();
    expect(boundsOfOnlyGlyph(subrDepthOverflowAfterDrawing)).toBeUndefined();

    const truncatedOperandAfterDrawing = cffFontWithCharstrings({
      name: "DrawnThenTruncatedOperand",
      charStrings: [[...drawFirst, 247]], // medium-positive needs one more byte
    });
    expect(boundsOfOnlyGlyph(truncatedOperandAfterDrawing)).toBeUndefined();
  });

  it("refuses an escape operator with no following byte", () => {
    const bytes = cffFontWithCharstrings({
      name: "TruncatedEscape",
      charStrings: [[OP_ESCAPE]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("refuses an escaped operator this module does not interpret (the arithmetic/storage/conditional set)", () => {
    const ESC_AND = 3;
    const bytes = cffFontWithCharstrings({
      name: "UnsupportedEscape",
      charStrings: [[OP_ESCAPE, ESC_AND]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("draws the flex operator's own two-curve construction (escape 12 35), whose 13th argument (fd) has no effect on the curve", () => {
    const bytes = cffFontWithCharstrings({
      name: "Flex",
      charStrings: [
        [
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(10), // curve 1: straight up by 10
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(0),
          ...enc(10), // curve 2: straight up by another 10
          ...enc(50), // fd: a rasterisation hint, ignored
          OP_ESCAPE,
          ESC_FLEX,
          OP_ENDCHAR,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 0,
      yMax: 20,
    });
  });

  it("refuses a flex operator whose stack is too short for its own 13 arguments", () => {
    const bytes = cffFontWithCharstrings({
      name: "FlexTooShort",
      charStrings: [[...new Array<number>(12).fill(139), OP_ESCAPE, ESC_FLEX]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("draws the hflex operator (escape 12 34), whose second curve negates the first's own dy2 to return to the start y", () => {
    // dx1 dx2 dy2 dx3 dx4 dx5 dx6, all positive: x accumulates monotonically to their sum (60); y rises to dy2=20 by the end of the first curve, then the second curve's own -dy2 must bring it back down to exactly 0. A sign error on that negation (turning -stack[2] into +stack[2]) would send y on to 40 instead of back to 0, which the exact yMax assertion below catches, distinct from the trivial yMin=0 every curveTo already includes via its own start point.
    const bytes = cffFontWithCharstrings({
      name: "Hflex",
      charStrings: [
        [
          ...enc(10), // dx1
          ...enc(10), // dx2
          ...enc(20), // dy2
          ...enc(10), // dx3
          ...enc(10), // dx4
          ...enc(10), // dx5
          ...enc(10), // dx6
          OP_ESCAPE,
          ESC_HFLEX,
          OP_ENDCHAR,
        ],
      ],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 60,
      yMax: 20,
    });
  });

  it("refuses an hflex operator whose stack is too short for its own 7 arguments", () => {
    const bytes = cffFontWithCharstrings({
      name: "HflexTooShort",
      charStrings: [[...new Array<number>(6).fill(139), OP_ESCAPE, ESC_HFLEX]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("draws the hflex1 operator (escape 12 36), whose final point returns to the flex's own starting y", () => {
    const bytes = cffFontWithCharstrings({
      name: "Hflex1",
      charStrings: [
        [
          ...enc(0),
          ...enc(10), // dx1, dy1
          ...enc(10),
          ...enc(10), // dx2, dy2
          ...enc(10), // dx3
          ...enc(10), // dx4
          ...enc(0),
          ...enc(-20), // dx5, dy5
          ...enc(0), // dx6
          OP_ESCAPE,
          ESC_HFLEX1,
          OP_ENDCHAR,
        ],
      ],
    });
    const box = boundsOfOnlyGlyph(bytes)!;
    expect(box.yMin).toBe(0);
    expect(box.yMax).toBe(20); // rises by dy1+dy2=20, then the final curve's own computed dy returns exactly to 0
  });

  it("refuses an hflex1 operator whose stack is too short for its own 9 arguments", () => {
    const bytes = cffFontWithCharstrings({
      name: "Hflex1TooShort",
      charStrings: [[...new Array<number>(8).fill(139), OP_ESCAPE, ESC_HFLEX1]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("draws the flex1 operator (escape 12 37), whose own final delta applies to whichever axis moved further", () => {
    // The five leading deltas move further in x (30 total) than in y (4 total), so the last delta (d6) applies to x and y returns exactly to its own start — the branch a wrong Math.abs comparison would swap for its opposite.
    const bytes = cffFontWithCharstrings({
      name: "Flex1",
      charStrings: [
        [
          ...enc(10),
          ...enc(1), // dx1,dy1
          ...enc(10),
          ...enc(1), // dx2,dy2
          ...enc(10),
          ...enc(1), // dx3,dy3
          ...enc(10),
          ...enc(1), // dx4,dy4
          ...enc(10),
          ...enc(0), // dx5,dy5
          ...enc(5), // d6
          OP_ESCAPE,
          ESC_FLEX1,
          OP_ENDCHAR,
        ],
      ],
    });
    const box = boundsOfOnlyGlyph(bytes)!;
    expect(box.yMin).toBe(0);
    expect(box.xMax).toBe(55); // 10+10+10+10+10+5
  });

  it("refuses a flex1 operator whose stack is too short for its own 11 arguments", () => {
    const bytes = cffFontWithCharstrings({
      name: "Flex1TooShort",
      charStrings: [[...new Array<number>(10).fill(139), OP_ESCAPE, ESC_FLEX1]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });
});

// Every refusal in this block draws real ink first, then hits the failure: a glyph that draws nothing reports `undefined` from a successful walk and a refused one alike, so a refusal test that never draws cannot tell its own outcome apart from the mutant that skips the refusal. This is the trap the issue's own recurring-shapes section describes, and it is why so many of this module's `return false` guards survived the suite above.
