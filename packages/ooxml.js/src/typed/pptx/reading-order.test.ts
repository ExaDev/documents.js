import { describe, expect, it } from "vitest";
import type { ContentShape } from "document-schema.js";
import { assignReadingOrder } from "./reading-order";

// A shape carrying only what the ordering looks at: its frame, and a name to assert the order by.
function shape(
  name: string,
  xPt: number,
  yPt: number,
  widthPt: number,
  heightPt: number,
): ContentShape {
  return {
    name,
    frame: { xPt, yPt, widthPt, heightPt },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [],
  };
}

// The names in reading order -- read back off the `readingOrder` ranks, since the array itself is
// deliberately returned in document order.
const order = (shapes: ContentShape[]): (string | undefined)[] =>
  [...assignReadingOrder(shapes)]
    .sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0))
    .map((s) => s.name);

describe("assignReadingOrder", () => {
  it("reads a two-column slide column by column, keeping each heading with its own list", () => {
    // The layout that motivates cutting on an axis rather than always sorting top-to-bottom: sorting by
    // y alone interleaves the columns and separates every heading from the bullets it introduces.
    const shapes = [
      shape("right-list", 400, 120, 300, 200),
      shape("left-heading", 40, 60, 300, 40),
      shape("right-heading", 400, 60, 300, 40),
      shape("left-list", 40, 120, 300, 200),
    ];

    expect(order(shapes)).toEqual([
      "left-heading",
      "left-list",
      "right-heading",
      "right-list",
    ]);
  });

  it("reads a title above a body top-to-bottom, not as columns", () => {
    const shapes = [
      shape("body", 40, 140, 660, 300),
      shape("title", 40, 40, 660, 60),
    ];

    expect(order(shapes)).toEqual(["title", "body"]);
  });

  it("reads a four-box grid row by row, despite a 16:9 slide's horizontal gaps being larger", () => {
    // The case the relative-gap comparison exists for: on a 720x405pt slide the gap between columns is
    // physically wider than the gap between rows for the same visual separation, so an absolute
    // comparison cuts columns and reads down each one instead of across each row.
    const shapes = [
      shape("r1c1", 40, 40, 300, 120),
      shape("r1c2", 380, 40, 300, 120),
      shape("r2c1", 40, 220, 300, 120),
      shape("r2c2", 380, 220, 300, 120),
    ];

    expect(order(shapes)).toEqual(["r1c1", "r1c2", "r2c1", "r2c2"]);
  });

  it("recurses, so a column's own internal rows are ordered within that column", () => {
    const shapes = [
      shape("left-bottom", 40, 300, 300, 80),
      shape("right", 400, 40, 300, 340),
      shape("left-top", 40, 40, 300, 80),
    ];

    expect(order(shapes)).toEqual(["left-top", "left-bottom", "right"]);
  });

  it("falls back to topmost-then-leftmost for shapes that overlap on both axes", () => {
    // Neither axis has a band of empty space crossing the whole set, so no cut is possible. A total
    // order (y, then x) keeps the result deterministic rather than dependent on input order.
    const shapes = [
      shape("lower", 100, 200, 400, 300),
      shape("upper", 60, 60, 400, 300),
    ];

    expect(order(shapes)).toEqual(["upper", "lower"]);
    expect(order([...shapes].reverse())).toEqual(["upper", "lower"]);
  });

  it("leaves a single shape, or none, alone", () => {
    expect(order([])).toEqual([]);
    expect(order([shape("only", 10, 10, 10, 10)])).toEqual(["only"]);
  });

  it("returns the array in document order, ranking rather than reordering", () => {
    // The point of the whole design: sourcePath is assigned as slides[N].shapes[N], so the array must
    // keep naming the positions it names. Only the ranks describe the reading order.
    const shapes = [
      shape("right", 400, 60, 300, 200),
      shape("left", 40, 60, 300, 200),
    ];

    const result = assignReadingOrder(shapes);

    expect(result.map((s) => s.name)).toEqual(["right", "left"]);
    expect(result.map((s) => s.readingOrder)).toEqual([1, 0]);
  });
});
