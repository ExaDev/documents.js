import { describe, expect, it } from "vitest";

import { boundingBoxOf, relativeCellRef } from "./conditional-format-write";

describe("relativeCellRef", () => {
  it("names a single-letter column for indices 0-25", () => {
    expect(relativeCellRef(0, 0)).toBe("A1");
    expect(relativeCellRef(0, 25)).toBe("Z1");
  });

  it("names a two-letter column once the index runs past Z, exercising the loop more than once", () => {
    expect(relativeCellRef(0, 26)).toBe("AA1");
    expect(relativeCellRef(0, 27)).toBe("AB1");
    expect(relativeCellRef(0, 51)).toBe("AZ1");
  });

  it("names a three-letter column, the loop running a third time", () => {
    expect(relativeCellRef(0, 702)).toBe("AAA1");
  });

  it("states the row as one-based", () => {
    expect(relativeCellRef(9, 0)).toBe("A10");
  });
});

describe("boundingBoxOf", () => {
  it("takes the tightest rectangle across several ranges, not just the first or the union of extremes each range states independently", () => {
    const box = boundingBoxOf({
      type: "aboveAverage",
      ranges: [
        { startRow: 5, endRow: 10, startColumn: 3, endColumn: 3 },
        { startRow: 0, endRow: 2, startColumn: 8, endColumn: 20 },
        { startRow: 7, endRow: 7, startColumn: 1, endColumn: 1 },
      ],
    });
    expect(box).toStrictEqual({
      startRow: 0,
      endRow: 10,
      startColumn: 1,
      endColumn: 20,
    });
  });
});
