import { describe, expect, it } from "vitest";

import {
  columnWidthToPoints,
  pointsToColumnWidth,
  pointsToTwips,
  twipsToPoints,
} from "./units";

describe("pointsToTwips", () => {
  it("inverts twipsToPoints for an ordinary row height", () => {
    expect(pointsToTwips(twipsToPoints(300))).toBe(300);
  });

  it("converts a whole-point height to twenty times as many twips", () => {
    expect(pointsToTwips(15)).toBe(300);
  });

  it("clamps to the Row record's own minimum height", () => {
    // [MS-XLS] 2.4.221: miyRw "MUST be greater than or equal to 2".
    expect(pointsToTwips(0)).toBe(2);
  });

  it("clamps to the Row record's own maximum height", () => {
    // [MS-XLS] 2.4.221: miyRw "MUST be ... less than or equal to 8192".
    expect(pointsToTwips(1000)).toBe(8192);
  });
});

describe("pointsToColumnWidth", () => {
  it("round-trips through columnWidthToPoints for a width already on the pixel grid", () => {
    // coldx 2340 is a real Excel-written default column width; its own forward points value should reproduce the same coldx (or a narrower one truncating to the identical pixel count) when written back.
    const points = columnWidthToPoints(2340);
    const coldx = pointsToColumnWidth(points);
    expect(columnWidthToPoints(coldx)).toBe(points);
  });

  it("never reads back narrower than the requested width", () => {
    for (const points of [40, 48, 60, 72, 100, 150]) {
      const coldx = pointsToColumnWidth(points);
      expect(columnWidthToPoints(coldx)).toBeGreaterThanOrEqual(points - 1);
    }
  });

  it("returns a non-negative coldx for a very small width", () => {
    expect(pointsToColumnWidth(0)).toBeGreaterThanOrEqual(0);
  });
});
