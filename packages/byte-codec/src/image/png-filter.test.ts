import { describe, expect, it } from "vitest";
import { filterScanlines, unfilterScanlines } from "./png-filter";

// Builds an unfiltered scanline stream (no filter-type bytes) for `height` rows of `bytesPerRow` bytes each, from a flat list of already-raw bytes.
function raw(bytesPerRow: number, rows: readonly (readonly number[])[]) {
  return { bytesPerRow, bytes: new Uint8Array(rows.flat()) };
}

// Prefixes each row in `rows` with its own filter-type byte, producing the shape unfilterScanlines expects as input (the inflated IDAT payload).
function filtered(rows: readonly (readonly [number, ...number[]])[]) {
  return new Uint8Array(rows.flatMap((row) => [...row]));
}

describe("unfilterScanlines: filter type 0 (None)", () => {
  it("passes bytes through unchanged", () => {
    const data = filtered([
      [0, 10, 20, 30],
      [0, 40, 50, 60],
    ]);
    const out = unfilterScanlines(data, 2, 3, 1);
    expect(Array.from(out)).toEqual([10, 20, 30, 40, 50, 60]);
  });
});

describe("unfilterScanlines: filter type 1 (Sub)", () => {
  it("adds the left neighbour within the same row, treating bpp bytes before the row start as 0", () => {
    // bpp=1: each byte is (raw + left) & 0xff. Left of the first byte is 0 (no real neighbour).
    const data = filtered([[1, 10, 5, 3]]);
    const out = unfilterScanlines(data, 1, 3, 1);
    expect(Array.from(out)).toEqual([10, 15, 18]);
  });

  it("wraps modulo 256 rather than overflowing", () => {
    const data = filtered([[1, 200, 100, 100]]);
    const out = unfilterScanlines(data, 1, 3, 1);
    // 200, (200+100)&0xff=44, (44+100)&0xff=144
    expect(Array.from(out)).toEqual([200, 44, 144]);
  });

  it("only reaches back bpp bytes, not one byte, for multi-byte-per-pixel data", () => {
    // bpp=3 (e.g. RGB): byte at x=3 (the next pixel's red channel) uses out[x-3], not out[x-1].
    const data = filtered([[1, 10, 20, 30, 5, 6, 7]]);
    const out = unfilterScanlines(data, 1, 6, 3);
    expect(Array.from(out)).toEqual([10, 20, 30, 15, 26, 37]);
  });
});

describe("unfilterScanlines: filter type 2 (Up)", () => {
  it("adds the byte directly above, treating the first row's 'above' as 0", () => {
    const data = filtered([
      [2, 10, 20, 30],
      [2, 1, 2, 3],
    ]);
    const out = unfilterScanlines(data, 2, 3, 1);
    expect(Array.from(out)).toEqual([10, 20, 30, 11, 22, 33]);
  });
});

describe("unfilterScanlines: filter type 3 (Average)", () => {
  it("adds floor((left + above) / 2), with both defaulting to 0 where absent", () => {
    const data = filtered([
      [3, 10, 20, 30], // first row: above=0, so raw + floor(left/2)
      [3, 1, 1, 1],
    ]);
    const out = unfilterScanlines(data, 2, 3, 1);
    // Row 0: x=0: 10+floor((0+0)/2)=10; x=1: 20+floor((10+0)/2)=25; x=2: 30+floor((25+0)/2)=42
    expect(Array.from(out.subarray(0, 3))).toEqual([10, 25, 42]);
    // Row 1: x=0: 1+floor((0+10)/2)=6; x=1: 1+floor((6+25)/2)=16; x=2: 1+floor((16+42)/2)=30
    expect(Array.from(out.subarray(3, 6))).toEqual([6, 16, 30]);
  });

  it("floors an odd left+above sum rather than rounding", () => {
    // Row1 x=0: left=0 (no left neighbour), above=row0[0]=1 -> avg=floor((0+1)/2)=floor(0.5)=0, not 1 -- Math.round(0.5) would give 1, so this distinguishes floor() from round().
    const avgData = filtered([
      [0, 1, 0],
      [3, 0, 5],
    ]);
    const out = unfilterScanlines(avgData, 2, 2, 1);
    // Row1 x=1: left=out[row1,0]=0, above=row0[1]=0 -> floor((0+0)/2)=0, raw 5 + 0 = 5.
    expect(Array.from(out.subarray(2, 4))).toEqual([0, 5]);
  });
});

describe("unfilterScanlines: filter type 4 (Paeth)", () => {
  it("predicts purely from 'above' when there is no left or above-left neighbour (first column, second row)", () => {
    const data = filtered([
      [0, 50, 60],
      [4, 1, 1],
    ]);
    const out = unfilterScanlines(data, 2, 2, 1);
    // Row 1, x=0: a=0,b=50,c=0 -> p=50, pa=50,pb=0,pc=50 -> pb<=pc -> predictor=b=50 -> 1+50=51
    expect(out[2]).toBe(51);
  });

  it("picks the left value 'a' when its Paeth distance is smallest", () => {
    // Construct a=10 (left), b=10 (above), c=10 (above-left): p = a+b-c = 10, distances all 0 -> ties resolve to 'a' per the pa<=pb && pa<=pc branch.
    const data = filtered([
      [0, 10, 10],
      [4, 0, 0],
    ]);
    const out = unfilterScanlines(data, 2, 2, 1);
    expect(Array.from(out.subarray(2, 4))).toEqual([10, 10]);
  });

  it("picks 'a' from a genuine, non-tied distance comparison, not merely a degenerate tie", () => {
    // a=200 (left), b=0 (above), c=0 (above-left, first row): p=a+b-c=200, pa=|200-200|=0,
    // pb=|200-0|=200, pc=|200-0|=200 -- pa is decisively smallest, and a (200) differs from
    // b and c (0), so picking the wrong candidate here is observable in the actual output byte, unlike an all-equal tie where every branch happens to return the same numeric value.
    const data = filtered([[4, 200, 0]]); // row0, Paeth: col0 raw=200 -> a=0,b=0,c=0 -> unfiltered=200
    const out = unfilterScanlines(data, 1, 2, 1);
    expect(out[0]).toBe(200); // col0: establishes the real left-neighbour value for col1
    expect(out[1]).toBe(200); // col1: a=200,b=0,c=0 -> Paeth must pick a=200, not b or c (0)
  });

  it("picks 'b' over 'c' when pb is strictly smaller than pa but ties or beats pc", () => {
    // a=0, b=10, c=0 (no above-left, so c defaults to 0): p = 0+10-0=10, pa=10, pb=0, pc=10. pa<=pb is false (10<=0 false), so falls to `pb <= pc` (0<=10 true) -> returns b=10.
    const rows = filtered([
      [0, 0, 10], // row0 (None): col0=0, col1=10
      [4, 0, 0], // row1 (Paeth), raw bytes 0,0
    ]);
    const out = unfilterScanlines(rows, 2, 2, 1);
    // Row1 x=0: a=0(no left), b=row0[0]=0, c=0 -> p=0, pa=0<=pb(0) && pa<=pc(0) -> a=0 -> 0+0=0
    // Row1 x=1: a=out[row1,0]=0, b=row0[1]=10, c=row0[0]=0 -> p=0+10-0=10, pa=|10-0|=10,
    //   pb=|10-10|=0, pc=|10-0|=10 -> pa<=pb false -> pb<=pc (0<=10 true) -> b=10 -> raw 0+10=10
    expect(Array.from(out.subarray(2, 4))).toEqual([0, 10]);
  });

  it("picks 'c' (above-left) only when it strictly beats both a and b", () => {
    // Choosing c as the exact midpoint of a and b forces p = a+b-c = c, so pc=0 while
    // pa=pb=|(b-a)/2| > 0 -- the one construction where c can strictly beat both. Concretely
    // a=2, b=4, c=3: p=3, pa=1, pb=1, pc=0 -> pa<=pb but not pa<=pc, and not pb<=pc -> c wins.
    const data = filtered([
      [0, 3, 4], // row0 (None): col0=3 (this pixel's c), col1=4 (this pixel's b)
      // row1 col0 (Paeth): a=0,b=row0[0]=3,c=0 -> p=3,pa=3,pb=0,pc=3 -> b wins -> raw+3. Raw 255 makes (255+3)&0xff = 2, giving col0's unfiltered value the target a=2.
      [4, 255, 0],
    ]);
    const out = unfilterScanlines(data, 2, 2, 1);
    expect(out[2]).toBe(2); // row1 col0, confirms a=2 for the pixel under test
    // Row1 col1: a=out[row1,col0]=2, b=row0[col1]=4, c=row0[col0]=3 -- exactly a=2,b=4,c=3. predictorValue returns c=3, so the unfiltered value is raw(0) + 3 = 3, not a(2) or b(4).
    expect(out[3]).toBe(3);
  });

  it("picks 'a' at an exact pa === pc tie, not merely when pa is strictly smaller", () => {
    // a=0, b=15, c=10: p=a+b-c=5, pa=|5-0|=5, pb=|5-15|=10, pc=|5-10|=5 -- pa and pc are tied
    // exactly, with pa<=pb holding too, so the first branch's outcome hinges purely on the pa<=pc boundary. a, b and c are all distinct, so picking the wrong candidate is observable.
    const data = filtered([
      [0, 10, 15], // row0 (None): col0=10 (this pixel's c), col1=15 (this pixel's b)
      // row1 col0 (Paeth): a=0,b=row0[0]=10,c=0 -> p=10,pa=10,pb=0,pc=10 -> b wins -> raw+10. Raw 246 makes (246+10)&0xff = 0, giving col0's unfiltered value the target a=0.
      [4, 246, 5],
    ]);
    const out = unfilterScanlines(data, 2, 2, 1);
    expect(out[2]).toBe(0); // row1 col0, confirms a=0 for the pixel under test
    // Row1 col1: a=0, b=15, c=10 -- the exact pa===pc tie. Correct code picks a=0, so the unfiltered value is raw(5) + 0 = 5, not c(10) (which would give 5 + 10 = 15).
    expect(out[3]).toBe(5);
  });

  it("picks 'b' at an exact pb === pc tie, not merely when pb is strictly smaller", () => {
    // a=0, b=30, c=10: p=a+b-c=20, pa=|20-0|=20, pb=|20-30|=10, pc=|20-10|=10 -- pa is largest
    // (first branch fails regardless), and pb/pc are tied exactly, with b and c distinct values.
    const data = filtered([
      [0, 10, 30], // row0 (None): col0=10 (this pixel's c), col1=30 (this pixel's b)
      // row1 col0 (Paeth): a=0,b=row0[0]=10,c=0 -> p=10,pa=10,pb=0,pc=10 -> b wins -> raw+10. Raw 246 makes (246+10)&0xff = 0, giving col0's unfiltered value the target a=0.
      [4, 246, 1],
    ]);
    const out = unfilterScanlines(data, 2, 2, 1);
    expect(out[2]).toBe(0); // row1 col0, confirms a=0 for the pixel under test
    // Row1 col1: a=0, b=30, c=10 -- the exact pb===pc tie (pa=20 is decisively largest, so the first branch fails either way). Correct code picks b=30, so the unfiltered value is raw(1) + 30 = 31, not c(10) (which would give 1 + 10 = 11).
    expect(out[3]).toBe(31);
  });
});

describe("unfilterScanlines: input validation", () => {
  it("throws when the input is shorter than height * (bytesPerRow + 1)", () => {
    const data = filtered([[0, 1, 2]]); // only 3 bytes, but 2 rows are requested
    expect(() => unfilterScanlines(data, 2, 2, 1)).toThrow(
      "PNG scanline data too short: expected at least 6 bytes, got 3",
    );
  });

  it("accepts input that is exactly the minimum required length", () => {
    const data = filtered([[0, 1, 2]]); // exactly height(1) * stride(3)
    expect(() => unfilterScanlines(data, 1, 2, 1)).not.toThrow();
  });

  it.each([5, 6, 7, 8, 255])(
    "throws for an unrecognised filter-type byte (%d)",
    (badFilterType) => {
      const data = new Uint8Array([badFilterType, 1, 2]);
      expect(() => unfilterScanlines(data, 1, 2, 1)).toThrow(
        `unknown PNG filter type: ${badFilterType}`,
      );
    },
  );
});

describe("filterScanlines: strategy 'none'", () => {
  it("always emits filter type 0 and leaves sample bytes unchanged", () => {
    const image = raw(3, [
      [10, 20, 30],
      [40, 50, 60],
    ]);
    const out = filterScanlines(image.bytes, 2, 3, 1, "none");
    expect(Array.from(out)).toEqual([0, 10, 20, 30, 0, 40, 50, 60]);
  });

  it("round-trips through unfilterScanlines", () => {
    const image = raw(4, [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ]);
    const filteredOut = filterScanlines(image.bytes, 3, 4, 2, "none");
    const back = unfilterScanlines(filteredOut, 3, 4, 2);
    expect(Array.from(back)).toEqual(Array.from(image.bytes));
  });
});

describe("filterScanlines: strategy 'adaptive'", () => {
  it("round-trips arbitrary data exactly regardless of which filter type it picks", () => {
    const width = 5;
    const height = 4;
    const bpp = 3;
    const bytesPerRow = width * bpp;
    const data = new Uint8Array(height * bytesPerRow);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 37 + 11) % 256;
    }
    const filteredOut = filterScanlines(
      data,
      height,
      bytesPerRow,
      bpp,
      "adaptive",
    );
    const back = unfilterScanlines(filteredOut, height, bytesPerRow, bpp);
    expect(Array.from(back)).toEqual(Array.from(data));
  });

  it("defaults to 'adaptive' when no strategy argument is given", () => {
    const data = new Uint8Array([5, 10, 15, 20, 25, 30]);
    const withDefault = filterScanlines(data, 2, 3, 1);
    const explicit = filterScanlines(data, 2, 3, 1, "adaptive");
    expect(Array.from(withDefault)).toEqual(Array.from(explicit));
  });

  it("chooses filter type 0 (None) for a uniformly zero row, since every candidate ties at zero and None is first", () => {
    const data = new Uint8Array([0, 0, 0, 0]);
    const out = filterScanlines(data, 1, 4, 1, "adaptive");
    expect(out[0]).toBe(0);
  });

  it("prefers a genuinely smaller-sum filter over None for a strongly left-correlated row", () => {
    // A steadily-incrementing row: the Sub filter (left-neighbour prediction) collapses it to a constant small delta, which must score lower than None's raw ascending values.
    const data = new Uint8Array([10, 12, 14, 16, 18, 20, 22, 24]);
    const out = filterScanlines(data, 1, 8, 1, "adaptive");
    expect(out[0]).toBe(1); // Sub
    // Every filtered delta should be the constant step size (2), confirming Sub was actually applied.
    for (let x = 1; x < 8; x++) {
      expect(out[x]).toBe(x === 1 ? 10 : 2);
    }
  });

  it("picks the lowest-scoring candidate using the true signed-magnitude interpretation, not a raw byte-value comparison", () => {
    // row1 is row0 shifted down by exactly 1 (mod 256): Paeth's "above" prediction is off by just 1 everywhere, giving residual bytes of 255 (i.e. -1) -- a tiny SIGNED magnitude (1) that a raw-byte-value comparison would instead see as a huge (255) score, wrongly favouring a candidate with genuinely larger errors but smaller *raw* byte values (Average, here).
    const row0 = [200, 200, 200, 200];
    const row1 = [199, 199, 199, 199];
    const data = new Uint8Array([...row0, ...row1]);
    const out = filterScanlines(data, 2, 4, 1, "adaptive");
    // row0 has nothing above it: None and Sub both score 56 (a tie broken in candidate-scan order, since Sub is tried before Paeth) -- this assertion only pins down the shared setup.
    expect(out[0]).toBe(1);
    expect(out[5]).toBe(4); // row1 must choose Paeth (type 4), the true lowest-signed-magnitude candidate
    const back = unfilterScanlines(out, 2, 4, 1);
    expect(Array.from(back)).toEqual([...row0, ...row1]);
  });

  it("reads the above-left reference sample from the correct column, not a neighbouring one, when picking Paeth", () => {
    // Column 2 (x === bpp + 1) is where a genuine above-left ('c') read at the wrong column would substitute a real but different value from elsewhere in the row above, silently corrupting Paeth's prediction there while leaving every other column unaffected.
    const row0 = [5, 0, 0, 99, 1];
    const row1 = [5, 200, 200, 50, 60];
    const data = new Uint8Array([...row0, ...row1]);
    const filteredOut = filterScanlines(data, 2, 5, 1, "adaptive");
    const back = unfilterScanlines(filteredOut, 2, 5, 1);
    expect(Array.from(back)).toEqual([...row0, ...row1]);
  });

  it("keeps the best candidate as height increases, still round-tripping exactly", () => {
    const width = 6;
    const height = 5;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        data[y * width + x] = (x * 3 + y * 17) % 256;
      }
    }
    const filteredOut = filterScanlines(data, height, width, 1, "adaptive");
    const back = unfilterScanlines(filteredOut, height, width, 1);
    expect(Array.from(back)).toEqual(Array.from(data));
  });
});
