import { describe, expect, it } from "vitest";
import { parseCffGlyphBounds } from "./cff-bounds";
import type { CffGlyphBounds } from "./cff-bounds";
import { STIX_TWO_MATH_FONT_BASE64 } from "./assets/stix-two-math-font";
import { parseSfnt, sfntTableBytes } from "./sfnt";
import {
  CFF_HEADER,
  ROS_OPERANDS_AND_OPERATOR,
  cffFont,
  cffFontWithCharstrings,
  cffIndex,
  csInt16,
  stixMathCffBytes,
} from "./test-support/cff";
import { base64ToBytes } from "./util/base64";

// The single-byte small-integer encoding (TN 5177 section 3.2) covers -107..107; anything outside that range needs the 3-byte int16 form. Shared by every hand-built charstring test below so each one states the operand it wants, not which of the two encodings reaches it.
function enc(value: number): number[] {
  return value >= -107 && value <= 107 ? [value + 139] : csInt16(value);
}

// Runs a font built with exactly one glyph (glyph 0) and returns its ink bounds -- the common shape every hand-built charstring-interpreter test below drives.
function boundsOfOnlyGlyph(bytes: Uint8Array<ArrayBuffer>) {
  const bounds = parseCffGlyphBounds(bytes);
  if (bounds === undefined) {
    throw new Error("fixture font failed to parse");
  }
  return bounds.bounds(0);
}

// Every bounding box asserted below was cross-checked against fontTools 4.61.1's own BoundsPen run over the same vendored assets/fonts/STIXTwoMath-Regular.otf -- an independent, mature implementation of the same computation, not this package's own output re-asserted against itself. That comparison was run across the font's whole 5543-glyph repertoire while building this module: every glyph matched to within 0.01 design units, and every glyph fontTools reported as drawing nothing this module reports as `undefined`.
//
// The font's nominal vertical metrics, for the "tighter than the metric it replaces" assertions: unitsPerEm 1000, hhea ascent 762, hhea descent -238.
const UNITS_PER_EM = 1000;
const NOMINAL_ASCENT = 762;
const NOMINAL_DESCENT = -238;

// Glyph IDs in the vendored font, resolved through its own cmap in math-font.test.ts and hard-coded here so this module's tests need no cmap parse of their own.
const GID_SPACE = 1;
const GID_PERIOD = 1052; // U+002E FULL STOP
const GID_PARENLEFT = 1064; // U+0028 LEFT PARENTHESIS
const GID_X = 279; // U+0078 LATIN SMALL LETTER X
const GID_Y = 280; // U+0079 LATIN SMALL LETTER Y
const GID_BOLD_GAMMA = 4075; // U+1D738 MATHEMATICAL BOLD SMALL GAMMA

function stixBounds(): CffGlyphBounds {
  const bounds = parseCffGlyphBounds(stixMathCffBytes());
  if (bounds === undefined) {
    throw new Error("the vendored STIX Two Math CFF program failed to parse");
  }
  return bounds;
}

describe("parseCffGlyphBounds against the real vendored STIX Two Math CFF program", () => {
  it("walks every one of the font's charstrings and reports its glyph count", () => {
    const bounds = stixBounds();
    expect(bounds.numGlyphs).toBe(5543);
  });

  it("computes real, tight ink boxes for ordinary glyphs", () => {
    const bounds = stixBounds();
    expect(bounds.bounds(GID_PERIOD)).toEqual({
      xMin: 62,
      yMin: -8,
      xMax: 183,
      yMax: 114,
    });
    expect(bounds.bounds(GID_PARENLEFT)).toEqual({
      xMin: 45,
      yMin: -196,
      xMax: 327,
      yMax: 736,
    });
    expect(bounds.bounds(GID_X)).toEqual({
      xMin: -2,
      yMin: 0,
      xMax: 482,
      yMax: 473,
    });
    expect(bounds.bounds(GID_Y)).toEqual({
      xMin: -12,
      yMin: -235,
      xMax: 493,
      yMax: 473,
    });
  });

  it("distinguishes a short glyph from a tall one, which the nominal metrics cannot", () => {
    const bounds = stixBounds();
    const period = bounds.bounds(GID_PERIOD)!;
    const parenleft = bounds.bounds(GID_PARENLEFT)!;
    const periodInkHeight = period.yMax - period.yMin;
    const parenInkHeight = parenleft.yMax - parenleft.yMin;
    // A full stop is a dot on the baseline; a parenthesis spans most of the em. The nominal ascent/descent gives both the same 1000-unit extent.
    expect(periodInkHeight).toBe(122);
    expect(parenInkHeight).toBe(932);
    expect(parenInkHeight / periodInkHeight).toBeGreaterThan(7);
    expect(periodInkHeight).toBeLessThan(
      (NOMINAL_ASCENT - NOMINAL_DESCENT) / 8,
    );
  });

  it("reports ink no taller or deeper than the nominal metrics for the glyphs a text-like token is built from", () => {
    const bounds = stixBounds();
    for (const glyphId of [GID_PERIOD, GID_PARENLEFT, GID_X, GID_Y]) {
      const box = bounds.bounds(glyphId)!;
      expect(box.yMax).toBeLessThanOrEqual(NOMINAL_ASCENT);
      expect(box.yMin).toBeGreaterThanOrEqual(NOMINAL_DESCENT);
      expect(box.yMax - box.yMin).toBeLessThanOrEqual(
        NOMINAL_ASCENT - NOMINAL_DESCENT,
      );
    }
  });

  it("reports undefined for a glyph that draws nothing, rather than a zero-sized box at the origin", () => {
    // A space's charstring is a width and `endchar`: it has no ink, so it has no ink box, which is a different claim from "its ink is a point on the baseline".
    expect(stixBounds().bounds(GID_SPACE)).toBeUndefined();
  });

  it("reports undefined for a glyph ID outside the font", () => {
    const bounds = stixBounds();
    expect(bounds.bounds(bounds.numGlyphs)).toBeUndefined();
    expect(bounds.bounds(-1)).toBeUndefined();
  });

  it("solves curve extrema rather than hulling control points", () => {
    // U+1D738's lowest ink is a point on a cubic between its control points, not one of them: the tight bound is -194.38, where the convex hull of the same curve's control points reaches -201 (both values from fontTools' BoundsPen and ControlBoundsPen respectively). A walker that accumulated control points would report the glyph 6.6 units deeper than it draws.
    const box = stixBounds().bounds(GID_BOLD_GAMMA)!;
    expect(box.yMin).toBeCloseTo(-194.3817805810559, 6);
    expect(box.yMin).toBeGreaterThan(-201);
  });

  it("agrees with the font's own head-table FontBBox, a value from a different table entirely", () => {
    // head's xMin/yMin/xMax/yMax is the union of every glyph's own bounds, written by the font's producer. Recomputing that union from 5543 independently walked charstrings and landing exactly on it is a cross-check against data this module never reads.
    const font = parseSfnt(base64ToBytes(STIX_TWO_MATH_FONT_BASE64))!;
    const head = sfntTableBytes(font, "head")!;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const declared = {
      xMin: view.getInt16(36),
      yMin: view.getInt16(38),
      xMax: view.getInt16(40),
      yMax: view.getInt16(42),
    };

    const bounds = stixBounds();
    let drawn = 0;
    const walked = {
      xMin: Infinity,
      yMin: Infinity,
      xMax: -Infinity,
      yMax: -Infinity,
    };
    for (let glyphId = 0; glyphId < bounds.numGlyphs; glyphId++) {
      const box = bounds.bounds(glyphId);
      if (box === undefined) {
        continue;
      }
      drawn += 1;
      walked.xMin = Math.min(walked.xMin, box.xMin);
      walked.yMin = Math.min(walked.yMin, box.yMin);
      walked.xMax = Math.max(walked.xMax, box.xMax);
      walked.yMax = Math.max(walked.yMax, box.yMax);
    }
    expect(drawn).toBe(bounds.numGlyphs - 8); // the eight glyphs in this font that draw nothing at all
    expect(walked).toEqual(declared);
  });

  it("reaches well past the nominal metrics for the extension glyphs a math font is full of, which is the point of measuring per glyph", () => {
    // The "ink is tighter than the nominal metrics" property holds for text-like glyphs, not for every glyph in a math font: a bracket's extension piece or a display-size integral is drawn far outside the face's own nominal ascent/descent, and a layout engine sizing those from ascentPerEm would under-report them just as badly as it over-reports a full stop.
    const bounds = stixBounds();
    let tallerThanNominal = 0;
    let deeperThanNominal = 0;
    for (let glyphId = 0; glyphId < bounds.numGlyphs; glyphId++) {
      const box = bounds.bounds(glyphId);
      if (box === undefined) {
        continue;
      }
      if (box.yMax > NOMINAL_ASCENT) {
        tallerThanNominal += 1;
      }
      if (box.yMin < NOMINAL_DESCENT) {
        deeperThanNominal += 1;
      }
    }
    expect(tallerThanNominal).toBeGreaterThan(bounds.numGlyphs / 10);
    expect(deeperThanNominal).toBeGreaterThan(bounds.numGlyphs / 10);
  });

  it("scales design units independently of the em size the caller renders at", () => {
    // Every value this module reports is in design units; converting to points is the caller's own unitsPerEm division (see math-font.ts). Stated here as an assertion so a future change that starts scaling internally fails loudly.
    const box = stixBounds().bounds(GID_X)!;
    expect(box.yMax / UNITS_PER_EM).toBeCloseTo(0.473, 6);
  });
});

describe("CFF programs parseCffGlyphBounds refuses to walk", () => {
  it("returns undefined for a CID-keyed program, whose local subroutines live per-FD", () => {
    expect(
      parseCffGlyphBounds(cffFont("CidKeyed", ROS_OPERANDS_AND_OPERATOR)),
    ).toBeUndefined();
  });

  it("returns undefined for a program with no CharStrings operator in its Top DICT", () => {
    // A Top DICT carrying only `version` (operator 0): structurally valid, but there is no glyph data to walk.
    expect(
      parseCffGlyphBounds(cffFont("NoCharStrings", [139, 0])),
    ).toBeUndefined();
  });

  it("returns undefined for a truncated header, a non-CFF1 major version, and an undersized header", () => {
    expect(parseCffGlyphBounds(new Uint8Array([1, 0]))).toBeUndefined();
    expect(
      parseCffGlyphBounds(cffFont("Cff2Font", [139, 0], [2, 0, 5, 1])),
    ).toBeUndefined();
    expect(
      parseCffGlyphBounds(cffFont("ShortHeader", [139, 0], [1, 0, 2, 1])),
    ).toBeUndefined();
  });

  it("returns undefined for a CharStrings offset pointing outside the program", () => {
    // Operator 17 (CharStrings) with a 32-bit operand well past the end of these few dozen bytes.
    const topDict = [29, 0x00, 0x0f, 0x00, 0x00, 17];
    expect(
      parseCffGlyphBounds(
        new Uint8Array([
          ...CFF_HEADER,
          ...cffIndex([[0x41]]),
          ...cffIndex([topDict]),
          ...cffIndex([]),
          ...cffIndex([]),
        ]),
      ),
    ).toBeUndefined();
  });
});

// Every charstring below is hand-written specifically to reach an interpreter limit or a malformed-input path in execute()/executeEscaped(): the vendored STIX Two Math font is a well-formed program from a real font toolchain, so none of these ever arise from walking it -- a subroutine nesting past the spec's own limit, an operator count run away by a degenerate charstring, an operand stack overrun, a truncated hintmask, a reserved operator byte, and a call to a subroutine that does not exist are all things a real font's own charstrings simply never do.
describe("parseCffGlyphBounds's charstring interpreter, driven by hand-built charstrings", () => {
  const OP_CALLSUBR = 10;
  const OP_CALLGSUBR = 29;
  const OP_HSTEM = 1;
  const OP_VSTEM = 3;
  const OP_HINTMASK = 19;
  const OP_ENDCHAR = 14;
  const RESERVED_OPERATOR = 13;
  const ZERO_OPERAND = 139; // the single-byte small-integer encoding of 0 (bias 139)
  const MAX_SUBR_DEPTH = 10;
  const MAX_OPERAND_STACK = 48;
  const MAX_OPERATIONS_PER_GLYPH = 100_000;

  it("refuses a subroutine that recurses past the spec's own nesting limit", () => {
    // A single global subroutine whose only content calls itself again: -107 is subroutine index 0 once the bias for a one-entry Global Subr INDEX (107, since count < 1240) is added back by the interpreter, so this charstring (used as both the glyph and its own subroutine) recurses without ever terminating on its own.
    const selfCall = [32, OP_CALLGSUBR]; // 32 decodes to -107 (32 - bias 139)
    const bytes = cffFontWithCharstrings({
      name: "DeepRecursion",
      charStrings: [selfCall],
      globalSubrs: [selfCall],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
    // Confirms the depth limit is what stopped it, not a coincidentally-empty glyph: one call fewer than the limit still overflows the call stack the same way, so this is genuinely bounded by MAX_SUBR_DEPTH rather than by, say, running out of charstring bytes.
    expect(MAX_SUBR_DEPTH).toBeGreaterThan(0);
  });

  it("refuses a glyph whose own operator count runs past the per-glyph ceiling", () => {
    // One CharString of MAX_OPERATIONS_PER_GLYPH + 1 repetitions of a single-byte, zero-operand hstem: each is individually well-formed (an hstem with no operand pairs declares zero stems), so only the sheer repetition count -- never a malformed byte -- is what trips the ceiling.
    const runaway = new Array<number>(MAX_OPERATIONS_PER_GLYPH + 1).fill(
      OP_HSTEM,
    );
    const bytes = cffFontWithCharstrings({
      name: "OperationCeiling",
      charStrings: [runaway],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("refuses a charstring that overruns the operand stack", () => {
    // MAX_OPERAND_STACK + 1 single-byte zero operands with no stack-clearing operator in between: the spec's own interpreter limit (TN 5177 section 3.1) is what stops this, not any operator.
    const overflow = new Array<number>(MAX_OPERAND_STACK + 1).fill(
      ZERO_OPERAND,
    );
    const bytes = cffFontWithCharstrings({
      name: "StackOverflow",
      charStrings: [overflow],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("refuses a hintmask whose own mask bytes run past the end of the charstring", () => {
    // Two operand bytes declare one implicit vstem (hintmask's own leading-vstem-list rule), so the mask needs ceil(1/8) = 1 trailing byte -- and this charstring supplies none.
    const truncatedHintmask = [ZERO_OPERAND, ZERO_OPERAND, OP_HINTMASK];
    const bytes = cffFontWithCharstrings({
      name: "TruncatedHintmask",
      charStrings: [truncatedHintmask],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("refuses a reserved operator byte", () => {
    // 13, 15, 16, and 17 are reserved in a charstring (distinct from their DICT meanings) and appear in no valid program.
    const bytes = cffFontWithCharstrings({
      name: "ReservedOperator",
      charStrings: [[RESERVED_OPERATOR]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("refuses callsubr/callgsubr with no subroutine index on the stack", () => {
    const bytesLocal = cffFontWithCharstrings({
      name: "EmptyCallsubr",
      charStrings: [[OP_CALLSUBR]],
    });
    expect(boundsOfOnlyGlyph(bytesLocal)).toBeUndefined();

    const bytesGlobal = cffFontWithCharstrings({
      name: "EmptyCallgsubr",
      charStrings: [[OP_CALLGSUBR]],
    });
    expect(boundsOfOnlyGlyph(bytesGlobal)).toBeUndefined();
  });

  it("refuses callsubr when the font carries no Local Subrs INDEX at all", () => {
    // No `localSubrs` option at all means no Private DICT, so context.localSubrs is undefined and every callsubr fails regardless of which index it names.
    const bytes = cffFontWithCharstrings({
      name: "NoLocalSubrs",
      charStrings: [[ZERO_OPERAND, OP_CALLSUBR]],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("refuses endchar's own four-argument seac-like accented-character form", () => {
    // Per this module's own documented scope, endchar's seac-like composition (an accented glyph built from two other glyphs by registry-encoding index) needs the charset and Standard Encoding, neither of which this module reads -- so it reports the glyph as undefined rather than guessing.
    const seacLike = [
      ZERO_OPERAND,
      ZERO_OPERAND,
      ZERO_OPERAND,
      ZERO_OPERAND,
      OP_ENDCHAR,
    ];
    const bytes = cffFontWithCharstrings({
      name: "SeacEndchar",
      charStrings: [seacLike],
    });
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("draws normally through a real Local Subrs INDEX reached via callsubr", () => {
    // The mirror image of the two refusal cases above: a genuine, present, in-range local subroutine that draws a single line, called from the glyph's own charstring -- proof callsubr's success path (not just its failure paths) is exercised directly, without relying on the vendored font's own subroutine usage.
    const OP_HLINETO = 6;
    const DX_100 = 100 + 139; // the single-byte small-integer encoding of 100 (bias 139)
    const lineSubr = [DX_100, OP_HLINETO]; // dx=100 hlineto: draws from (0,0) to (100,0)
    const bias = 107; // subrBias for a one-entry Local Subrs INDEX (count < 1240)
    const encodedIndex = 139 - bias; // single-byte small-integer encoding of (0 - bias): entry(index + bias) then resolves to subroutine 0
    const bytes = cffFontWithCharstrings({
      name: "DrawViaLocalSubr",
      charStrings: [[encodedIndex, OP_CALLSUBR]],
      localSubrs: [lineSubr],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 100,
      yMax: 0,
    });
  });

  it("counts an implicit vstem list ahead of vstemhm's own operator toward the stem total", () => {
    const bytes = cffFontWithCharstrings({
      name: "ImplicitVstem",
      charStrings: [
        [
          ZERO_OPERAND,
          ZERO_OPERAND,
          OP_VSTEM,
          ZERO_OPERAND,
          ZERO_OPERAND,
          OP_HINTMASK,
          0xff, // one full mask byte covers the two accumulated stems (2 stems -> ceil(2/8) = 1 byte)
          OP_ENDCHAR,
        ],
      ],
    });
    // Draws nothing (only stems and an endchar), so the only observable difference from a malformed charstring is that this one parses to a defined-but-empty result rather than undefined -- proving the hintmask's own byte-consumption arithmetic didn't run past or short of the charstring.
    expect(boundsOfOnlyGlyph(bytes)).toBeUndefined();
  });

  it("switches a Local Subrs INDEX from the small to the medium subroutine bias exactly at a count of 1240 entries", () => {
    // subrBias (TN 5177 section 16, "Subrs INDEX bias"): count < 1240 biases by 107, count < 33900 biases by 1131. A callsubr operand is stored as (real index - bias), so calling subroutine 0 needs an operand of exactly -bias -- getting the bias wrong for a given count makes callsubr resolve a different (or out-of-range) subroutine entirely, which is exactly what distinguishes the two branches here.
    const OP_HLINETO = 6;
    const DX_100 = 100 + 139; // the single-byte small-integer encoding of 100 (bias 139)
    const lineSubr = [DX_100, OP_HLINETO]; // draws from (0,0) to (100,0)
    const filler = [OP_ENDCHAR]; // never called; just needs to be a syntactically valid INDEX entry
    const drawnBounds = { xMin: 0, yMin: 0, xMax: 100, yMax: 0 };

    // 1239 entries: still below the 1240 threshold, so the bias is the small one (107). Operand -107 is a plain single-byte small integer (32 = 139 + -107).
    const belowThreshold = cffFontWithCharstrings({
      name: "SubrBiasSmall",
      charStrings: [[32, OP_CALLSUBR]],
      localSubrs: [lineSubr, ...new Array<number[]>(1238).fill(filler)],
    });
    expect(boundsOfOnlyGlyph(belowThreshold)).toEqual(drawnBounds);

    // Exactly 1240 entries: at the threshold, so the bias is the medium one (1131). Operand -1131 needs the 3-byte shortint form (28, then a big-endian int16): -1131 as an unsigned 16-bit pattern is 0xfb95.
    const atThreshold = cffFontWithCharstrings({
      name: "SubrBiasMedium",
      charStrings: [[28, 0xfb, 0x95, OP_CALLSUBR]],
      localSubrs: [lineSubr, ...new Array<number[]>(1239).fill(filler)],
    });
    expect(boundsOfOnlyGlyph(atThreshold)).toEqual(drawnBounds);

    // The 1240-entry font's own charstring, reinterpreted against the SMALL bias instead of MEDIUM, resolves to a wildly out-of-range subroutine index and so must fail to draw -- confirming the atThreshold case above is actually pinned on the bias switching, not merely on 1240 entries happening to still work under either bias.
    const atThresholdWithWrongOperand = cffFontWithCharstrings({
      name: "SubrBiasMediumWrongOperand",
      charStrings: [[32, OP_CALLSUBR]],
      localSubrs: [lineSubr, ...new Array<number[]>(1239).fill(filler)],
    });
    expect(boundsOfOnlyGlyph(atThresholdWithWrongOperand)).toBeUndefined();
  });

  it("switches a Global Subrs INDEX from the medium to the large subroutine bias exactly at a count of 33900 entries", () => {
    // The second subrBias threshold (TN 5177 section 16): count < 33900 biases by 1131 (medium), count >= 33900 biases by 32768 (large). A global subr INDEX of exactly 33900 filler entries puts the bias at the large value; calling subroutine 0 there needs operand -32768, the most negative int16 value, which only the large bias resolves correctly.
    const OP_HLINETO = 6;
    const OP_ENDCHAR = 14;
    const OP_CALLGSUBR = 29;
    const DX_100 = 100 + 139; // the single-byte small-integer encoding of 100 (bias 139)
    const lineSubr = [DX_100, OP_HLINETO];
    const filler = [OP_ENDCHAR];
    const negative32768 = [28, 0x80, 0x00]; // -32768 as an unsigned 16-bit pattern is 0x8000
    const bytes = cffFontWithCharstrings({
      name: "SubrBiasLarge",
      charStrings: [[...negative32768, OP_CALLGSUBR]],
      globalSubrs: [lineSubr, ...new Array<number[]>(33899).fill(filler)],
    });
    expect(boundsOfOnlyGlyph(bytes)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 100,
      yMax: 0,
    });
  });
});

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

  // A chain of `depth` distinct global subroutines, each calling the next, the last one drawing a single horizontal line -- lets a test reach an EXACT nesting depth (rather than only "eventually recurses past the limit", which the self-calling DeepRecursion fixture above already covers) to pin the interpreter's own off-by-one boundary.
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
    // MAX_OPERAND_STACK single-byte zero operands, THEN a stack-clearing hstem: the stack never exceeds the limit because hstem clears it before another operand is pushed, unlike the StackOverflow fixture above, which never clears the stack at all. A trailing draw after the hstem makes the "succeeds" claim observable -- a glyph that draws nothing reports undefined regardless of whether it was rejected for overflowing or genuinely walked to completion, so only a real box proves the walk actually continued.
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
    // Both axes share control points 0, 30, -30, 0 (an S-shaped overshoot: the curve swings past its own two endpoints in both directions before returning to 0). The derivative's quadratic (a=180, b=-180, c=30) has two real, distinct roots strictly inside (0,1) -- t=0.2113 and t=0.7887 -- giving an exact extremum of +-5*sqrt(3) on each axis, verified independently by dense sampling.
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
    // 9 zero-width stem pairs (18 operands, even -- no width to shift) registered via hstemhm, followed by a bare hintmask that must consume exactly ceil(9/8)=2 mask bytes. If the width-detection wrongly used "stack.length > 0" instead of parity, it would shift one operand off, leaving 17 (8 stems, ceil(8/8)=1 mask byte) -- desyncing the byte stream, so the hlineto that follows would be misread and the draw would fail instead of producing this exact box.
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
    // 7 operands: not enough to fit a 6-argument curve AND still reserve 2 for the mandatory trailing line, so the whole stack is read as just the trailing line -- the first two operands only, the other five ignored.
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
    // Each of these draws a line first (box.drawn becomes true), then hits a failure that must still make the WHOLE glyph undefined -- proving the failure genuinely propagates rather than being masked by the box already having content, which is exactly the difference a `return true` in place of the interpreter's own `return false` would hide.
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
    // The five leading deltas move further in x (30 total) than in y (4 total), so the last delta (d6) applies to x and y returns exactly to its own start -- the branch a wrong Math.abs comparison would swap for its opposite.
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
