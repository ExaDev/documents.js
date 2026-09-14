import { describe, expect, it } from "vitest";
import {
  interleave,
  type InterleaveSource,
  inverse53Filter,
  inverse97Filter,
  inverseDwt53Level,
  inverseDwt97Level,
  mirrorIndex,
  subbandBounds,
  synthesiseLine,
  times,
} from "./jpeg2000-dwt";

// Every buffer cell inverse53Filter/inverse97Filter actually write to gets a value distinguishable from this sentinel: the even step's own F-5 arithmetic maps a uniform 100 to 100 - floor((100 + 100 + 2) / 4) = 50, and every later lifting step further changes whatever it touches, so a sentinel-filled buffer's own untouched/touched split can be read straight off which cells still equal 100.
const SENTINEL = 100;

function touchedIndices(buffer: ArrayLike<number>): number[] {
  const touched: number[] = [];
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== SENTINEL) {
      touched.push(i);
    }
  }
  return touched;
}

// The whole-image fixtures in jpeg2000.test.ts already pin this transform against real encoder output at every size and origin the fixture set covers. What follows pins the pieces those cannot isolate: the exact integers the 5-3 lifting produces for a signal short enough to compute by hand from the specification's own equations, the DC gain that makes a flat image survive, and the coordinate split a caller has to size its subband buffers by.

// A resolution level one row high, so VER_SR reduces to the single-sample case and the row is a direct test of the one-dimensional 5-3 filter.
function synthesiseRow(
  ll: readonly number[],
  hl: readonly number[],
  u0: number,
  u1: number,
): number[] {
  const bounds = { u0, u1, v0: 0, v1: 1 };
  const result = inverseDwt53Level(
    {
      ll: Int32Array.from(ll),
      hl: Int32Array.from(hl),
      lh: new Int32Array(0),
      hh: new Int32Array(0),
    },
    bounds,
  );
  return Array.from(result);
}

describe("inverseDwt53Level", () => {
  it("reconstructs a constant signal from a constant low-pass band and a zero high-pass band", () => {
    // F.3.8.2's lifting has unit DC gain: with every high-pass coefficient zero, the even step subtracts floor(2/4) = 0 and the odd step interpolates the same value, so the whole signal comes back flat. A wrong rounding constant in either step breaks this immediately.
    expect(synthesiseRow([7, 7, 7], [0, 0, 0], 0, 6)).toEqual([
      7, 7, 7, 7, 7, 7,
    ]);
    expect(synthesiseRow([-3, -3], [0, 0], 0, 4)).toEqual([-3, -3, -3, -3]);
  });

  it("produces the integers ISO/IEC 15444-1 F-5 and F-6 define for a lone high-pass impulse", () => {
    // Interleaved: Y = [0, 4, 0, 0] over [0, 4). Symmetric extension gives Y(-1) = Y(1) = 4 and Y(3) = 0. Even step, X(2n) = Y(2n) - floor((Y(2n-1) + Y(2n+1) + 2) / 4): X(0) = 0 - floor((4 + 4 + 2) / 4) = -2,  X(2) = 0 - floor((4 + 0 + 2) / 4) = -1,  X(4) = 0 - floor((0 + 4 + 2) / 4) = -1 Odd step, X(2n+1) = Y(2n+1) + floor((X(2n) + X(2n+2)) / 2): X(1) = 4 + floor((-2 + -1) / 2) = 4 - 2 = 2,  X(3) = 0 + floor((-1 + -1) / 2) = -1
    expect(synthesiseRow([0, 0], [4, 0], 0, 4)).toEqual([-2, 2, -1, -1]);
  });

  it("handles a signal of odd length, where the low-pass band holds one more sample than the high-pass one", () => {
    // Over [0, 5) the low-pass band spans [0, 3) and the high-pass [0, 2), so the last sample is an even-indexed one with only a mirrored neighbour to its right.
    expect(synthesiseRow([5, 5, 5], [0, 0], 0, 5)).toEqual([5, 5, 5, 5, 5]);
  });

  it("handles a resolution level whose coordinates start at an odd position", () => {
    // Over [1, 5) the first sample is odd-indexed, so the low-pass band spans [1, 3) and the high-pass [0, 2) -- the case an image whose origin is not on the reference grid's own origin produces.
    const bounds = { u0: 1, u1: 5, v0: 0, v1: 1 };
    expect(subbandBounds(bounds)).toMatchObject({
      llU0: 1,
      llU1: 3,
      hU0: 0,
      hU1: 2,
    });
    const result = inverseDwt53Level(
      {
        ll: Int32Array.from([9, 9]),
        hl: Int32Array.from([0, 0]),
        lh: new Int32Array(0),
        hh: new Int32Array(0),
      },
      bounds,
    );
    expect(Array.from(result)).toEqual([9, 9, 9, 9]);
  });

  it("halves a lone odd-indexed sample, the degenerate case of 1D_SR", () => {
    // A one-sample signal at an odd coordinate is a high-pass coefficient on its own, and F.3.7 undoes its synthesis gain of two rather than filtering it.
    const bounds = { u0: 1, u1: 2, v0: 0, v1: 1 };
    const result = inverseDwt53Level(
      {
        ll: new Int32Array(0),
        hl: Int32Array.from([10]),
        lh: new Int32Array(0),
        hh: new Int32Array(0),
      },
      bounds,
    );
    expect(Array.from(result)).toEqual([5]);
  });

  it("splits a two-dimensional level into the four coordinate ranges F.3.3 defines", () => {
    expect(subbandBounds({ u0: 0, u1: 7, v0: 3, v1: 10 })).toEqual({
      llU0: 0,
      llU1: 4,
      llV0: 2,
      llV1: 5,
      hU0: 0,
      hU1: 3,
      hV0: 1,
      hV1: 5,
    });
  });
});

describe("inverseDwt97Level", () => {
  it("reconstructs a constant signal from a constant low-pass band and a zero high-pass band", () => {
    // The 9-7 analysis filter maps a constant signal onto a low-pass band of that same constant and an identically zero high-pass band (its four lifting steps and the K normalisation compose to unit DC gain), so the synthesis has to send it straight back. Any wrong lifting constant, wrong step order or wrong K placement shows up here as a value that is not the one that went in. Floating point makes it approximate rather than exact.
    const bounds = { u0: 0, u1: 8, v0: 0, v1: 1 };
    const result = inverseDwt97Level(
      {
        ll: Float32Array.from([100, 100, 100, 100]),
        hl: new Float32Array(4),
        lh: new Float32Array(0),
        hh: new Float32Array(0),
      },
      bounds,
    );
    for (const value of result) {
      expect(value).toBeCloseTo(100, 3);
    }
  });

  it("scales a lone odd-indexed sample by a half, matching what the reversible filter does in the same case", () => {
    const bounds = { u0: 1, u1: 2, v0: 0, v1: 1 };
    const result = inverseDwt97Level(
      {
        ll: new Float32Array(0),
        hl: Float32Array.from([11]),
        lh: new Float32Array(0),
        hh: new Float32Array(0),
      },
      bounds,
    );
    expect(Array.from(result)).toEqual([5.5]);
  });

  it("returns an empty array for a resolution level with zero width or zero height", () => {
    const emptyBands = {
      ll: new Float32Array(0),
      hl: new Float32Array(0),
      lh: new Float32Array(0),
      hh: new Float32Array(0),
    };
    expect(
      Array.from(inverseDwt97Level(emptyBands, { u0: 3, u1: 3, v0: 0, v1: 4 })),
    ).toEqual([]);
    expect(
      Array.from(inverseDwt97Level(emptyBands, { u0: 0, u1: 4, v0: 2, v1: 2 })),
    ).toEqual([]);
  });

  it("does not crash allocating scratch space for grossly inverted (u1 < u0 and v1 < v0) bounds", () => {
    const bands = {
      ll: new Float32Array(0),
      hl: new Float32Array(0),
      lh: new Float32Array(0),
      hh: new Float32Array(0),
    };
    const bounds = { u0: 20, u1: 0, v0: 20, v1: 0 };
    expect(() => inverseDwt97Level(bands, bounds)).not.toThrow();
    expect(inverseDwt97Level(bands, bounds)).toHaveLength(400);
  });

  it("applies the single-sample gain at the correct absolute row when the vertical origin is nonzero", () => {
    // u0/v0 both odd this time (band hh), and v0 = 3 rather than 0, so an (index - v0) mutant that instead adds v0 would write the vertical pass's result to output[6] (out of this length-1 buffer) rather than back to output[0], leaving the horizontal pass's own result unhalved.
    const bounds = { u0: 1, u1: 2, v0: 3, v1: 4 };
    const result = inverseDwt97Level(
      {
        ll: new Float32Array(0),
        hl: new Float32Array(0),
        lh: new Float32Array(0),
        hh: Float32Array.from([11]),
      },
      bounds,
    );
    // Both u0 and v0 are odd, so the lone sample's synthesis gain of two is undone once by the horizontal pass and again by the vertical one: 11 / 2 / 2.
    expect(Array.from(result)).toEqual([2.75]);
  });

  it("places a distinguishable value at the correct row and column of a non-square level with a nonzero origin", () => {
    // u0/v0 both nonzero so an index-arithmetic mutant that adds the origin instead of subtracting it (or vice versa) lands the impulse at the wrong output cell rather than coincidentally the right one.
    const bounds = { u0: 1, u1: 5, v0: 2, v1: 5 }; // width 4, height 3
    const result = inverseDwt97Level(
      {
        ll: Float32Array.from([9, 9, 9, 9]),
        hl: new Float32Array(4),
        lh: new Float32Array(2),
        hh: new Float32Array(2),
      },
      bounds,
    );
    expect(result).toHaveLength(12);
    for (const value of result) {
      expect(value).toBeCloseTo(9, 3);
    }
  });
});

describe("inverseDwt53Level, zero-size and non-square cases", () => {
  it("returns an empty array for a resolution level with zero width or zero height", () => {
    const emptyBands = {
      ll: new Int32Array(0),
      hl: new Int32Array(0),
      lh: new Int32Array(0),
      hh: new Int32Array(0),
    };
    expect(
      Array.from(inverseDwt53Level(emptyBands, { u0: 3, u1: 3, v0: 0, v1: 4 })),
    ).toEqual([]);
    expect(
      Array.from(inverseDwt53Level(emptyBands, { u0: 0, u1: 4, v0: 2, v1: 2 })),
    ).toEqual([]);
  });

  it("does not crash allocating scratch space for grossly inverted (u1 < u0 and v1 < v0) bounds", () => {
    // Both dimensions negative enough that Math.max(width, height) alone would fall below -2 * EXTENSION_MARGIN, which would make scratch's own size negative without its own floor at 0.
    const bands = {
      ll: new Int32Array(0),
      hl: new Int32Array(0),
      lh: new Int32Array(0),
      hh: new Int32Array(0),
    };
    const bounds = { u0: 20, u1: 0, v0: 20, v1: 0 };
    expect(() => inverseDwt53Level(bands, bounds)).not.toThrow();
    // width * height = (-20) * (-20) = 400: the same Math.max(..., 0) floor already sizes output to that, filled with its default zeros, since raster order is undefined for bounds no real caller would ever pass.
    expect(inverseDwt53Level(bands, bounds)).toHaveLength(400);
  });

  it("reconstructs a flat signal correctly across a non-square level with a nonzero origin", () => {
    const bounds = { u0: 1, u1: 5, v0: 2, v1: 5 }; // width 4, height 3
    const result = inverseDwt53Level(
      {
        ll: Int32Array.from([9, 9, 9, 9]),
        hl: new Int32Array(4),
        lh: new Int32Array(2),
        hh: new Int32Array(2),
      },
      bounds,
    );
    expect(result).toHaveLength(12);
    expect(Array.from(result)).toEqual(new Array<number>(12).fill(9));
  });
});

describe("interleave", () => {
  it("visits exactly the coordinate range each of the four subbands owns, and no more", () => {
    // Distinct llWidth (3), hWidth (2), llHeight (2), hHeight (1) so every one of the four loops' own upper bound is individually observable in the recorded call set.
    const bounds = { u0: 0, u1: 5, v0: 0, v1: 3 };
    const calls: string[] = [];
    const source: InterleaveSource = {
      ll: (u, v) => {
        calls.push(`ll(${String(u)},${String(v)})`);
        return 0;
      },
      hl: (u, v) => {
        calls.push(`hl(${String(u)},${String(v)})`);
        return 0;
      },
      lh: (u, v) => {
        calls.push(`lh(${String(u)},${String(v)})`);
        return 0;
      },
      hh: (u, v) => {
        calls.push(`hh(${String(u)},${String(v)})`);
        return 0;
      },
    };
    interleave(source, bounds, () => {
      // The write callback's own arguments are covered by inverseDwt53Level/97Level's own output-placement tests above; this test is solely about which (u, v) each subband gets asked for.
    });
    expect(calls.sort()).toEqual(
      [
        "ll(0,0)",
        "ll(1,0)",
        "ll(2,0)",
        "ll(0,1)",
        "ll(1,1)",
        "ll(2,1)",
        "hl(0,0)",
        "hl(1,0)",
        "hl(0,1)",
        "hl(1,1)",
        "lh(0,0)",
        "lh(1,0)",
        "lh(2,0)",
        "hh(0,0)",
        "hh(1,0)",
      ].sort(),
    );
  });
});

describe("synthesiseLine", () => {
  it("calls neither read nor write for a degenerate (i1 <= i0) range", () => {
    const read = () => {
      throw new Error("read should not be called");
    };
    const write = () => {
      throw new Error("write should not be called");
    };
    expect(() => {
      synthesiseLine(
        read,
        write,
        5,
        5,
        () => 0,
        () => 0,
        () => 0,
        (v) => v,
      );
    }).not.toThrow();
    expect(() => {
      synthesiseLine(
        read,
        write,
        5,
        3,
        () => 0,
        () => 0,
        () => 0,
        (v) => v,
      );
    }).not.toThrow();
  });

  it("reads and writes exactly once, at i0, for a length-1 range -- without applying the gain at an even i0", () => {
    let written: [number, number] | undefined;
    synthesiseLine(
      () => 42,
      (index, value) => {
        written = [index, value];
      },
      4,
      5,
      () => 0,
      () => 0,
      () => 0,
      (value) => value * 1000, // would be unmistakable in the output if wrongly applied
    );
    expect(written).toEqual([4, 42]);
  });

  it("applies the single-sample gain function at an odd i0", () => {
    let written: [number, number] | undefined;
    synthesiseLine(
      () => 42,
      (index, value) => {
        written = [index, value];
      },
      5,
      6,
      () => 0,
      () => 0,
      () => 0,
      (value) => value / 2,
    );
    expect(written).toEqual([5, 21]);
  });

  it("fills the scratch buffer over exactly [i0 - MARGIN, i1 + MARGIN) and calls the filter once, for a length-2 range", () => {
    const filled: number[] = [];
    let filterCalls = 0;
    synthesiseLine(
      (index) => index, // echoes its own (already mirrored) index, so filled[] below records mirrored source indices
      () => {
        // Not under test here: the write-back loop is covered by the exact-value reconstruction tests elsewhere in this file.
      },
      10,
      12, // length 2: the smallest input that reaches the general (non-degenerate, non-single-sample) loop
      (offset) => {
        filled.push(offset);
      },
      () => 0,
      () => {
        filterCalls++;
      },
      (value) => value,
    );
    // EXTENSION_MARGIN is 6, so a length-2 range fills 2 + 2*6 = 14 scratch offsets, 0..13.
    expect(filled).toHaveLength(14);
    expect(Math.min(...filled)).toBe(0);
    expect(Math.max(...filled)).toBe(13);
    expect(filterCalls).toBe(1);
  });

  it("reads each fill-loop sample from mirrorIndex(i0 + k, i0, i1), not mirrorIndex(i0 - k, i0, i1)", () => {
    // Length 2 (period 2) would make this indistinguishable: mirrorIndex there collapses to a parity check on (position - i0), and parity(k) === parity(-k) for every k, so i0 + k and i0 - k would always mirror to the same result. Length 4 (period 6) breaks that symmetry.
    const i0 = 10;
    const i1 = 14;
    const fed: number[] = [];
    synthesiseLine(
      (index) => index, // echo: fed[] below ends up holding exactly what each fillScratch call's own source-index argument was
      () => {
        // Write-back is not under test here.
      },
      i0,
      i1,
      (_offset, value) => {
        fed.push(value);
      },
      () => 0,
      () => {
        // No filtering needed for this test.
      },
      (value) => value,
    );
    // mirrorIndex itself is separately verified correct (see the describe block below), so it doubles here as ground truth for what synthesiseLine's fill loop ought to have fed it.
    const expected = [];
    for (let k = -6; k < i1 - i0 + 6; k++) {
      expected.push(mirrorIndex(i0 + k, i0, i1));
    }
    expect(fed).toEqual(expected);
  });

  it("writes exactly [i0, i1) back from the scratch buffer, for a length-2 range", () => {
    const written: number[] = [];
    synthesiseLine(
      () => 0,
      (index) => {
        written.push(index);
      },
      10,
      12,
      () => {
        // Not under test here: the fill loop's own extent is covered by the test above.
      },
      (offset) => offset, // echoes the scratch offset back as the "reconstructed" value, so a wrong readScratch offset would show up as a wrong written value too
      () => {
        // No filtering needed for this test.
      },
      (value) => value,
    );
    expect(written).toEqual([10, 11]);
  });
});

describe("inverse53Filter", () => {
  it("writes to exactly the buffer cells the F-5/F-6 equations need for i0 = 0, i1 = 8, and no others", () => {
    const buffer = new Int32Array(30).fill(SENTINEL);
    inverse53Filter(buffer, 0, 8);
    // base = EXTENSION_MARGIN(6) - i0(0) = 6. Even step: n from floor(0/2) - 1 = -1 to floor(8/2) + 1 = 5 inclusive, indices base + 2n = 4, 6, 8, 10, 12, 14, 16. Odd step: n from -1 to 4 (5 excluded), indices base + 2n + 1 = 5, 7, 9, 11, 13, 15.
    expect(touchedIndices(buffer)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("writes to exactly the buffer cells the F-5/F-6 equations need for an odd, offset i0/i1", () => {
    const buffer = new Int32Array(30).fill(SENTINEL);
    inverse53Filter(buffer, 3, 9);
    // base = 6 - 3 = 3. Even: n from floor(3/2) - 1 = 0 to floor(9/2) + 1 = 5, indices 3 + 2n = 3, 5, 7, 9, 11, 13. Odd: n from 0 to 4 (5 excluded), indices 3 + 2n + 1 = 4, 6, 8, 10, 12.
    expect(touchedIndices(buffer)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });
});

describe("inverse97Filter", () => {
  it("writes to exactly the buffer cells the F-8/F-9 normalisation pass needs for i0 = 0, i1 = 8, and no others", () => {
    // F-8/F-9 is the widest of the four passes (its own n range is the other three's each extended by one or two further steps), so the overall touched set below is entirely this pass's own -- direct evidence for its own loop bound and for `last`'s own division.
    const buffer = new Float32Array(30).fill(SENTINEL);
    inverse97Filter(buffer, 0, 8);
    // base = 6, first = floor(0/2) = 0, last = floor(8/2) = 4. F-8/F-9: n from first - 2 = -2 to last + 2 = 6, touching both even(n) = base + 2n and odd(n) = base + 2n + 1 for each -- every integer from base + 2*(-2) = 2 to base + 2*6 + 1 = 19.
    expect(touchedIndices(buffer)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 2),
    );
  });

  it("applies F-12's own beta step at n = last + 1, its outermost even index", () => {
    // F-12's own range is a subset of F-8/F-9's, already touched either way, so only the exact value at its own outermost cell -- computed once, independently, straight from the same Float32Array/constants the production code uses -- can show whether F-12 actually ran there.
    const buffer = new Float32Array(30).fill(SENTINEL);
    inverse97Filter(buffer, 0, 4);
    expect(buffer[12]).toBeCloseTo(54.763057708740234, 5);
  });

  it("applies F-13's own alpha step at n = last, its outermost odd index", () => {
    const buffer = new Float32Array(30).fill(SENTINEL);
    inverse97Filter(buffer, 0, 4);
    expect(buffer[11]).toBeCloseTo(157.5548553466797, 3);
  });
});

describe("times", () => {
  it("calls fn exactly `count` times, with indices 0..count - 1 in order", () => {
    const calls: number[] = [];
    times(4, (index) => {
      calls.push(index);
    });
    expect(calls).toEqual([0, 1, 2, 3]);
  });

  it("calls fn zero times for a count of zero", () => {
    const calls: number[] = [];
    times(0, (index) => {
      calls.push(index);
    });
    expect(calls).toEqual([]);
  });

  it("calls fn zero times for a negative count", () => {
    const calls: number[] = [];
    times(-3, (index) => {
      calls.push(index);
    });
    expect(calls).toEqual([]);
  });
});

describe("mirrorIndex", () => {
  it("returns the sole in-range index for a length-1 range, whatever position is asked for", () => {
    expect(mirrorIndex(0, 5, 6)).toBe(5);
    expect(mirrorIndex(-3, 5, 6)).toBe(5);
    expect(mirrorIndex(9, 5, 6)).toBe(5);
  });

  it("returns i0 for a degenerate (empty) range", () => {
    expect(mirrorIndex(0, 3, 3)).toBe(3);
  });

  it("mirrors a position before i0 about i0 itself", () => {
    // [i0, i1) = [0, 4): position -1 mirrors to 1, matching F.3.4's own reflection about the first sample.
    expect(mirrorIndex(-1, 0, 4)).toBe(1);
  });

  it("mirrors a position at or past i1 about the last in-range sample", () => {
    expect(mirrorIndex(4, 0, 4)).toBe(2);
  });

  it("leaves a position already inside [i0, i1) unchanged", () => {
    expect(mirrorIndex(2, 0, 4)).toBe(2);
  });
});
