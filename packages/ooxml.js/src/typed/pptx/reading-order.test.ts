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

  it("breaks an EXACT tie between the two axes' relative gaps in favour of rows", () => {
    // A symmetric grid (square boxes, an identical gap on both axes) makes the column ratio and row ratio come out exactly equal, not merely close -- a >= comparison would wrongly treat this as "columns win" and read down each column first, producing r1c1, r2c1, r1c2, r2c2 instead.
    const shapes = [
      shape("r1c1", 0, 0, 100, 100),
      shape("r1c2", 150, 0, 100, 100),
      shape("r2c1", 0, 150, 100, 100),
      shape("r2c2", 150, 150, 100, 100),
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

  it("recurses into each row, so a row's own internal columns are ordered within that row", () => {
    // Each row's own two shapes overlap slightly in y (a right-hand shape a touch higher than its left-hand neighbour), so a flat sort of the whole set by y would read right-before-left within a row -- only cutting each row out FIRST, then ordering left-to-right inside it, gets this right.
    const shapes = [
      shape("r1-right", 300, 40, 100, 100),
      shape("r1-left", 0, 50, 100, 100),
      shape("r2-left", 0, 400, 100, 100),
      shape("r2-right", 300, 410, 100, 100),
    ];

    expect(order(shapes)).toEqual([
      "r1-left",
      "r1-right",
      "r2-left",
      "r2-right",
    ]);
  });

  it("computes an axis's extent as its true span, not the sum of its earliest start and latest end", () => {
    // x stays near zero (so a start+end sum barely differs from a real end-start span there), while y is pushed far from zero -- large enough that summing y's own start and end, instead of subtracting, shrinks the vertical ratio to near nothing. The horizontal and vertical gaps are otherwise identical, so the correct (subtracting) computation ties them and breaks the tie in favour of rows; a summing bug would instead make the corrupted vertical ratio lose outright, flipping the result to columns.
    const shapes = [
      shape("r1c1", 0, 100000, 100, 100),
      shape("r1c2", 150, 100000, 100, 100),
      shape("r2c1", 0, 100150, 100, 100),
      shape("r2c2", 150, 100150, 100, 100),
    ];

    expect(order(shapes)).toEqual(["r1c1", "r1c2", "r2c1", "r2c2"]);
  });

  it("falls back to topmost-then-leftmost for shapes that overlap on both axes", () => {
    // Neither axis has a band of empty space crossing the whole set, so no cut is possible. A total order (y, then x) keeps the result deterministic rather than dependent on input order.
    const shapes = [
      shape("lower", 100, 200, 400, 300),
      shape("upper", 60, 60, 400, 300),
    ];

    expect(order(shapes)).toEqual(["upper", "lower"]);
    expect(order([...shapes].reverse())).toEqual(["upper", "lower"]);
  });

  it("sorts overlapping shapes by y even when doing so runs against their own x order", () => {
    // "topmost" is the primary key: this shape is higher up (smaller y) but sits further right (larger x) than the other, so a comparator that let the x term leak into a y-differing comparison would put them in the wrong order.
    const shapes = [
      shape("topmost-but-rightmost", 200, 0, 300, 300),
      shape("bottommost-but-leftmost", 0, 100, 300, 300),
    ];

    expect(order(shapes)).toEqual([
      "topmost-but-rightmost",
      "bottommost-but-leftmost",
    ]);
  });

  it("breaks a genuine y-tie by x, leftmost first", () => {
    const shapes = [
      shape("right", 100, 0, 300, 300),
      shape("left", 0, 0, 300, 300),
    ];

    expect(order(shapes)).toEqual(["left", "right"]);
  });

  it("leaves a single shape, or none, alone", () => {
    expect(order([])).toEqual([]);
    expect(order([shape("only", 10, 10, 10, 10)])).toEqual(["only"]);
  });

  it("does not treat two shapes touching exactly at a shared boundary as a gap", () => {
    // X and Y share a boundary on the vertical axis with zero space between them (X ends at y=100 exactly where Y starts) -- a real gap requires a strictly positive distance, not merely non-overlap, or this touching pair would wrongly be split into two separate rows before Z's own genuine gap is even considered. Grouped correctly as one row, [X, Y] recurses and finds a genuine horizontal gap between them, reading Y (left) before X (right); split incorrectly into two rows, they would instead read in their row order, X then Y.
    const shapes = [
      shape("x", 100, 0, 100, 100),
      shape("y", 0, 100, 50, 50),
      shape("z", 0, 300, 100, 100),
    ];

    expect(order(shapes)).toEqual(["y", "x", "z"]);
  });

  it("measures a gap as the true distance between shapes, not their start plus the reach before them", () => {
    // Vertically, A sits a mere 10pt below a very tall preceding reach (1000pt), so summing start and reach instead of subtracting would inflate that gap into easily the largest ratio in the whole comparison -- wrongly making rows the winning axis even though the real vertical gap is tiny next to the real horizontal one. A is placed above-right and B below-left so that choosing the wrong axis (rows, sorted top to bottom) reverses their order from the correct one (columns, sorted left to right).
    const shapes = [shape("a", 0, 1010, 50, 40), shape("b", 80, 0, 50, 1000)];

    expect(order(shapes)).toEqual(["a", "b"]);
  });

  it("measures an axis's extent from its true earliest start, not its latest one", () => {
    // extentAlong spans from the EARLIEST start to the latest end; substituting the latest start for the earliest one shrinks the denominator of whichever ratio it feeds. Here the two columns sit only 50pt apart -- a modest gap next to the genuine 240pt-tall extent real code measures -- so the real vertical ratio (from the tall lists) beats the real horizontal one and rows win, reading each heading immediately before its own list. Using the latest start instead collapses the vertical extent down to the last shape's own 150pt height, inflating that ratio past the horizontal one and flipping the cut to columns, which would instead read both headings before either list.
    const shapes = [
      shape("left-heading", 0, 0, 100, 40),
      shape("right-heading", 150, 0, 100, 40),
      shape("left-list", 0, 90, 100, 150),
      shape("right-list", 150, 90, 100, 150),
    ];

    expect(order(shapes)).toEqual([
      "left-heading",
      "right-heading",
      "left-list",
      "right-list",
    ]);
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
