import { describe, expect, it } from 'vitest';
import { inverseDwt53Level, inverseDwt97Level, subbandBounds } from './jpeg2000-dwt';

// The whole-image fixtures in jpeg2000.test.ts already pin this transform against real encoder output at every size and origin the fixture set covers. What follows pins the pieces those cannot isolate: the exact integers the 5-3 lifting produces for a signal short enough to compute by hand from the specification's own equations, the DC gain that makes a flat image survive, and the coordinate split a caller has to size its subband buffers by.

// A resolution level one row high, so VER_SR reduces to the single-sample case and the row is a direct test of the one-dimensional 5-3 filter.
function synthesiseRow(ll: readonly number[], hl: readonly number[], u0: number, u1: number): number[] {
  const bounds = { u0, u1, v0: 0, v1: 1 };
  const result = inverseDwt53Level({ ll: Int32Array.from(ll), hl: Int32Array.from(hl), lh: new Int32Array(0), hh: new Int32Array(0) }, bounds);
  return Array.from(result);
}

describe('inverseDwt53Level', () => {
  it('reconstructs a constant signal from a constant low-pass band and a zero high-pass band', () => {
    // F.3.8.2's lifting has unit DC gain: with every high-pass coefficient zero, the even step subtracts floor(2/4) = 0 and the odd step interpolates the same value, so the whole signal comes back flat. A wrong rounding constant in either step breaks this immediately.
    expect(synthesiseRow([7, 7, 7], [0, 0, 0], 0, 6)).toEqual([7, 7, 7, 7, 7, 7]);
    expect(synthesiseRow([-3, -3], [0, 0], 0, 4)).toEqual([-3, -3, -3, -3]);
  });

  it('produces the integers ISO/IEC 15444-1 F-5 and F-6 define for a lone high-pass impulse', () => {
    // Interleaved: Y = [0, 4, 0, 0] over [0, 4). Symmetric extension gives Y(-1) = Y(1) = 4 and Y(3) = 0. Even step, X(2n) = Y(2n) - floor((Y(2n-1) + Y(2n+1) + 2) / 4): X(0) = 0 - floor((4 + 4 + 2) / 4) = -2,  X(2) = 0 - floor((4 + 0 + 2) / 4) = -1,  X(4) = 0 - floor((0 + 4 + 2) / 4) = -1 Odd step, X(2n+1) = Y(2n+1) + floor((X(2n) + X(2n+2)) / 2): X(1) = 4 + floor((-2 + -1) / 2) = 4 - 2 = 2,  X(3) = 0 + floor((-1 + -1) / 2) = -1
    expect(synthesiseRow([0, 0], [4, 0], 0, 4)).toEqual([-2, 2, -1, -1]);
  });

  it('handles a signal of odd length, where the low-pass band holds one more sample than the high-pass one', () => {
    // Over [0, 5) the low-pass band spans [0, 3) and the high-pass [0, 2), so the last sample is an even-indexed one with only a mirrored neighbour to its right.
    expect(synthesiseRow([5, 5, 5], [0, 0], 0, 5)).toEqual([5, 5, 5, 5, 5]);
  });

  it('handles a resolution level whose coordinates start at an odd position', () => {
    // Over [1, 5) the first sample is odd-indexed, so the low-pass band spans [1, 3) and the high-pass [0, 2) -- the case an image whose origin is not on the reference grid's own origin produces.
    const bounds = { u0: 1, u1: 5, v0: 0, v1: 1 };
    expect(subbandBounds(bounds)).toMatchObject({ llU0: 1, llU1: 3, hU0: 0, hU1: 2 });
    const result = inverseDwt53Level({ ll: Int32Array.from([9, 9]), hl: Int32Array.from([0, 0]), lh: new Int32Array(0), hh: new Int32Array(0) }, bounds);
    expect(Array.from(result)).toEqual([9, 9, 9, 9]);
  });

  it('halves a lone odd-indexed sample, the degenerate case of 1D_SR', () => {
    // A one-sample signal at an odd coordinate is a high-pass coefficient on its own, and F.3.7 undoes its synthesis gain of two rather than filtering it.
    const bounds = { u0: 1, u1: 2, v0: 0, v1: 1 };
    const result = inverseDwt53Level({ ll: new Int32Array(0), hl: Int32Array.from([10]), lh: new Int32Array(0), hh: new Int32Array(0) }, bounds);
    expect(Array.from(result)).toEqual([5]);
  });

  it('splits a two-dimensional level into the four coordinate ranges F.3.3 defines', () => {
    expect(subbandBounds({ u0: 0, u1: 7, v0: 3, v1: 10 })).toEqual({ llU0: 0, llU1: 4, llV0: 2, llV1: 5, hU0: 0, hU1: 3, hV0: 1, hV1: 5 });
  });
});

describe('inverseDwt97Level', () => {
  it('reconstructs a constant signal from a constant low-pass band and a zero high-pass band', () => {
    // The 9-7 analysis filter maps a constant signal onto a low-pass band of that same constant and an identically zero high-pass band (its four lifting steps and the K normalisation compose to unit DC gain), so the synthesis has to send it straight back. Any wrong lifting constant, wrong step order or wrong K placement shows up here as a value that is not the one that went in. Floating point makes it approximate rather than exact.
    const bounds = { u0: 0, u1: 8, v0: 0, v1: 1 };
    const result = inverseDwt97Level({ ll: Float32Array.from([100, 100, 100, 100]), hl: new Float32Array(4), lh: new Float32Array(0), hh: new Float32Array(0) }, bounds);
    for (const value of result) {
      expect(value).toBeCloseTo(100, 3);
    }
  });

  it('scales a lone odd-indexed sample by a half, matching what the reversible filter does in the same case', () => {
    const bounds = { u0: 1, u1: 2, v0: 0, v1: 1 };
    const result = inverseDwt97Level({ ll: new Float32Array(0), hl: Float32Array.from([11]), lh: new Float32Array(0), hh: new Float32Array(0) }, bounds);
    expect(Array.from(result)).toEqual([5.5]);
  });
});
