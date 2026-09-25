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

// The names in reading order — read back off the `readingOrder` ranks, since the array itself is
// deliberately returned in document order.
const order = (shapes: readonly ContentShape[]): (string | undefined)[] =>
  [...assignReadingOrder(shapes)]
    .sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0))
    .map((s) => s.name);

describe("assignReadingOrder", () => {
  it("reads a two-column slide column by column, keeping each heading with its own list", () => {
    // The layout that motivates cutting on an axis rather than always sorting top-to-bottom: sorting by y alone interleaves the columns and separates every heading from the bullets it introduces.
    const LEFT_COLUMN_X_PT = 40;
    const RIGHT_COLUMN_X_PT = 400;
    const HEADING_ROW_Y_PT = 60;
    const LIST_ROW_Y_PT = 120;
    const COLUMN_WIDTH_PT = 300;
    const HEADING_HEIGHT_PT = 40;
    const LIST_HEIGHT_PT = 200;
    const shapes = [
      shape(
        "right-list",
        RIGHT_COLUMN_X_PT,
        LIST_ROW_Y_PT,
        COLUMN_WIDTH_PT,
        LIST_HEIGHT_PT,
      ),
      shape(
        "left-heading",
        LEFT_COLUMN_X_PT,
        HEADING_ROW_Y_PT,
        COLUMN_WIDTH_PT,
        HEADING_HEIGHT_PT,
      ),
      shape(
        "right-heading",
        RIGHT_COLUMN_X_PT,
        HEADING_ROW_Y_PT,
        COLUMN_WIDTH_PT,
        HEADING_HEIGHT_PT,
      ),
      shape(
        "left-list",
        LEFT_COLUMN_X_PT,
        LIST_ROW_Y_PT,
        COLUMN_WIDTH_PT,
        LIST_HEIGHT_PT,
      ),
    ];

    expect(order(shapes)).toEqual([
      "left-heading",
      "left-list",
      "right-heading",
      "right-list",
    ]);
  });

  it("reads a title above a body top-to-bottom, not as columns", () => {
    const CONTENT_X_PT = 40;
    const CONTENT_WIDTH_PT = 660;
    const TITLE_Y_PT = 40;
    const TITLE_HEIGHT_PT = 60;
    const BODY_Y_PT = 140;
    const BODY_HEIGHT_PT = 300;
    const shapes = [
      shape("body", CONTENT_X_PT, BODY_Y_PT, CONTENT_WIDTH_PT, BODY_HEIGHT_PT),
      shape(
        "title",
        CONTENT_X_PT,
        TITLE_Y_PT,
        CONTENT_WIDTH_PT,
        TITLE_HEIGHT_PT,
      ),
    ];

    expect(order(shapes)).toEqual(["title", "body"]);
  });

  it("reads a four-box grid row by row, despite a 16:9 slide's horizontal gaps being larger", () => {
    // The case the relative-gap comparison exists for: on a 720x405pt slide the gap between columns is
    // physically wider than the gap between rows for the same visual separation, so an absolute
    // comparison cuts columns and reads down each one instead of across each row.
    const COLUMN1_X_PT = 40;
    const COLUMN2_X_PT = 380;
    const ROW1_Y_PT = 40;
    const ROW2_Y_PT = 220;
    const BOX_WIDTH_PT = 300;
    const BOX_HEIGHT_PT = 120;
    const shapes = [
      shape("r1c1", COLUMN1_X_PT, ROW1_Y_PT, BOX_WIDTH_PT, BOX_HEIGHT_PT),
      shape("r1c2", COLUMN2_X_PT, ROW1_Y_PT, BOX_WIDTH_PT, BOX_HEIGHT_PT),
      shape("r2c1", COLUMN1_X_PT, ROW2_Y_PT, BOX_WIDTH_PT, BOX_HEIGHT_PT),
      shape("r2c2", COLUMN2_X_PT, ROW2_Y_PT, BOX_WIDTH_PT, BOX_HEIGHT_PT),
    ];

    expect(order(shapes)).toEqual(["r1c1", "r1c2", "r2c1", "r2c2"]);
  });

  it("breaks an EXACT tie between the two axes' relative gaps in favour of rows", () => {
    // A symmetric grid (square boxes, an identical gap on both axes) makes the column ratio and row ratio come out exactly equal, not merely close — a >= comparison would wrongly treat this as "columns win" and read down each column first, producing r1c1, r2c1, r1c2, r2c2 instead. The grid step shared by both axes: a symmetric grid needs the column gap and row gap to be the same value, which is the whole point of this test.
    const GRID_STEP_PT = 150;
    const BOX_SIZE_PT = 100;
    const shapes = [
      shape("r1c1", 0, 0, BOX_SIZE_PT, BOX_SIZE_PT),
      shape("r1c2", GRID_STEP_PT, 0, BOX_SIZE_PT, BOX_SIZE_PT),
      shape("r2c1", 0, GRID_STEP_PT, BOX_SIZE_PT, BOX_SIZE_PT),
      shape("r2c2", GRID_STEP_PT, GRID_STEP_PT, BOX_SIZE_PT, BOX_SIZE_PT),
    ];

    expect(order(shapes)).toEqual(["r1c1", "r1c2", "r2c1", "r2c2"]);
  });

  it("recurses, so a column's own internal rows are ordered within that column", () => {
    const LEFT_COLUMN_X_PT = 40;
    const RIGHT_COLUMN_X_PT = 400;
    // The right shape's own top edge lines up with the left column's own top shape.
    const ROW_TOP_Y_PT = 40;
    const LEFT_BOTTOM_Y_PT = 300;
    const SHAPE_WIDTH_PT = 300;
    const LEFT_SHAPE_HEIGHT_PT = 80;
    const RIGHT_HEIGHT_PT = 340;
    const shapes = [
      shape(
        "left-bottom",
        LEFT_COLUMN_X_PT,
        LEFT_BOTTOM_Y_PT,
        SHAPE_WIDTH_PT,
        LEFT_SHAPE_HEIGHT_PT,
      ),
      shape(
        "right",
        RIGHT_COLUMN_X_PT,
        ROW_TOP_Y_PT,
        SHAPE_WIDTH_PT,
        RIGHT_HEIGHT_PT,
      ),
      shape(
        "left-top",
        LEFT_COLUMN_X_PT,
        ROW_TOP_Y_PT,
        SHAPE_WIDTH_PT,
        LEFT_SHAPE_HEIGHT_PT,
      ),
    ];

    expect(order(shapes)).toEqual(["left-top", "left-bottom", "right"]);
  });

  it("recurses into each row, so a row's own internal columns are ordered within that row", () => {
    // Each row's own two shapes overlap slightly in y (a right-hand shape a touch higher than its left-hand neighbour), so a flat sort of the whole set by y would read right-before-left within a row — only cutting each row out FIRST, then ordering left-to-right inside it, gets this right.
    const RIGHT_X_PT = 300;
    const ROW1_RIGHT_Y_PT = 40;
    const ROW1_LEFT_Y_PT = 50;
    const ROW2_LEFT_Y_PT = 400;
    const ROW2_RIGHT_Y_PT = 410;
    const SHAPE_SIZE_PT = 100;
    const shapes = [
      shape(
        "r1-right",
        RIGHT_X_PT,
        ROW1_RIGHT_Y_PT,
        SHAPE_SIZE_PT,
        SHAPE_SIZE_PT,
      ),
      shape("r1-left", 0, ROW1_LEFT_Y_PT, SHAPE_SIZE_PT, SHAPE_SIZE_PT),
      shape("r2-left", 0, ROW2_LEFT_Y_PT, SHAPE_SIZE_PT, SHAPE_SIZE_PT),
      shape(
        "r2-right",
        RIGHT_X_PT,
        ROW2_RIGHT_Y_PT,
        SHAPE_SIZE_PT,
        SHAPE_SIZE_PT,
      ),
    ];

    expect(order(shapes)).toEqual([
      "r1-left",
      "r1-right",
      "r2-left",
      "r2-right",
    ]);
  });

  it("computes an axis's extent as its true span, not the sum of its earliest start and latest end", () => {
    // x stays near zero (so a start+end sum barely differs from a real end-start span there), while y is pushed far from zero — large enough that summing y's own start and end, instead of subtracting, shrinks the vertical ratio to near nothing. The horizontal and vertical gaps are otherwise identical, so the correct (subtracting) computation ties them and breaks the tie in favour of rows; a summing bug would instead make the corrupted vertical ratio lose outright, flipping the result to columns.
    const COLUMN2_X_PT = 150;
    const ROW1_Y_PT = 100000;
    const ROW2_Y_PT = 100150;
    const BOX_SIZE_PT = 100;
    const shapes = [
      shape("r1c1", 0, ROW1_Y_PT, BOX_SIZE_PT, BOX_SIZE_PT),
      shape("r1c2", COLUMN2_X_PT, ROW1_Y_PT, BOX_SIZE_PT, BOX_SIZE_PT),
      shape("r2c1", 0, ROW2_Y_PT, BOX_SIZE_PT, BOX_SIZE_PT),
      shape("r2c2", COLUMN2_X_PT, ROW2_Y_PT, BOX_SIZE_PT, BOX_SIZE_PT),
    ];

    expect(order(shapes)).toEqual(["r1c1", "r1c2", "r2c1", "r2c2"]);
  });

  it("falls back to topmost-then-leftmost for shapes that overlap on both axes", () => {
    // Neither axis has a band of empty space crossing the whole set, so no cut is possible. A total order (y, then x) keeps the result deterministic rather than dependent on input order.
    const LOWER_X_PT = 100;
    const LOWER_Y_PT = 200;
    const UPPER_POSITION_PT = 60; // upper's own x and y happen to share this value.
    const SHAPE_WIDTH_PT = 400;
    const SHAPE_HEIGHT_PT = 300;
    const shapes = [
      shape("lower", LOWER_X_PT, LOWER_Y_PT, SHAPE_WIDTH_PT, SHAPE_HEIGHT_PT),
      shape(
        "upper",
        UPPER_POSITION_PT,
        UPPER_POSITION_PT,
        SHAPE_WIDTH_PT,
        SHAPE_HEIGHT_PT,
      ),
    ];

    expect(order(shapes)).toEqual(["upper", "lower"]);
    expect(order([...shapes].reverse())).toEqual(["upper", "lower"]);
  });

  it("sorts overlapping shapes by y even when doing so runs against their own x order", () => {
    // "topmost" is the primary key: this shape is higher up (smaller y) but sits further right (larger x) than the other, so a comparator that let the x term leak into a y-differing comparison would put them in the wrong order.
    const RIGHTMOST_X_PT = 200;
    const BOTTOMMOST_Y_PT = 100;
    const SHAPE_SIZE_PT = 300;
    const shapes = [
      shape(
        "topmost-but-rightmost",
        RIGHTMOST_X_PT,
        0,
        SHAPE_SIZE_PT,
        SHAPE_SIZE_PT,
      ),
      shape(
        "bottommost-but-leftmost",
        0,
        BOTTOMMOST_Y_PT,
        SHAPE_SIZE_PT,
        SHAPE_SIZE_PT,
      ),
    ];

    expect(order(shapes)).toEqual([
      "topmost-but-rightmost",
      "bottommost-but-leftmost",
    ]);
  });

  it("breaks a genuine y-tie by x, leftmost first", () => {
    const RIGHT_X_PT = 100;
    const SHAPE_SIZE_PT = 300;
    const shapes = [
      shape("right", RIGHT_X_PT, 0, SHAPE_SIZE_PT, SHAPE_SIZE_PT),
      shape("left", 0, 0, SHAPE_SIZE_PT, SHAPE_SIZE_PT),
    ];

    expect(order(shapes)).toEqual(["left", "right"]);
  });

  it("leaves a single shape, or none, alone", () => {
    // Its own position and size don't matter, only that a single shape survives ordering untouched.
    const ARBITRARY_POSITION_AND_SIZE_PT = 10;
    expect(order([])).toEqual([]);
    expect(
      order([
        shape(
          "only",
          ARBITRARY_POSITION_AND_SIZE_PT,
          ARBITRARY_POSITION_AND_SIZE_PT,
          ARBITRARY_POSITION_AND_SIZE_PT,
          ARBITRARY_POSITION_AND_SIZE_PT,
        ),
      ]),
    ).toEqual(["only"]);
  });

  it("does not treat two shapes touching exactly at a shared boundary as a gap", () => {
    // X and Y share a boundary on the vertical axis with zero space between them (X ends at y=100 exactly where Y starts) — a real gap requires a strictly positive distance, not merely non-overlap, or this touching pair would wrongly be split into two separate rows before Z's own genuine gap is even considered. Grouped correctly as one row, [X, Y] recurses and finds a genuine horizontal gap between them, reading Y (left) before X (right); split incorrectly into two rows, they would instead read in their row order, X then Y. X's own x-position, X's own box size (100x100), and Y's own y-position: X's right/bottom edge lands exactly on this coordinate, which is also where Y begins.
    const TOUCHING_BOUNDARY_PT = 100;
    const Y_BOX_SIZE_PT = 50;
    const Z_Y_PT = 300;
    const shapes = [
      shape(
        "x",
        TOUCHING_BOUNDARY_PT,
        0,
        TOUCHING_BOUNDARY_PT,
        TOUCHING_BOUNDARY_PT,
      ),
      shape("y", 0, TOUCHING_BOUNDARY_PT, Y_BOX_SIZE_PT, Y_BOX_SIZE_PT),
      shape("z", 0, Z_Y_PT, TOUCHING_BOUNDARY_PT, TOUCHING_BOUNDARY_PT),
    ];

    expect(order(shapes)).toEqual(["y", "x", "z"]);
  });

  it("measures a gap as the true distance between shapes, not their start plus the reach before them", () => {
    // Vertically, A sits a mere 10pt below a very tall preceding reach (1000pt), so summing start and reach instead of subtracting would inflate that gap into easily the largest ratio in the whole comparison — wrongly making rows the winning axis even though the real vertical gap is tiny next to the real horizontal one. A is placed above-right and B below-left so that choosing the wrong axis (rows, sorted top to bottom) reverses their order from the correct one (columns, sorted left to right).
    const A_Y_PT = 1010;
    const SHAPE_WIDTH_PT = 50;
    const A_HEIGHT_PT = 40;
    const B_X_PT = 80;
    const B_HEIGHT_PT = 1000;
    const shapes = [
      shape("a", 0, A_Y_PT, SHAPE_WIDTH_PT, A_HEIGHT_PT),
      shape("b", B_X_PT, 0, SHAPE_WIDTH_PT, B_HEIGHT_PT),
    ];

    expect(order(shapes)).toEqual(["a", "b"]);
  });

  it("measures an axis's extent from its true earliest start, not its latest one", () => {
    // extentAlong spans from the EARLIEST start to the latest end; substituting the latest start for the earliest one shrinks the denominator of whichever ratio it feeds. Here the two columns sit only 50pt apart — a modest gap next to the genuine 240pt-tall extent real code measures — so the real vertical ratio (from the tall lists) beats the real horizontal one and rows win, reading each heading immediately before its own list. Using the latest start instead collapses the vertical extent down to the last shape's own 150pt height, inflating that ratio past the horizontal one and flipping the cut to columns, which would instead read both headings before either list.
    const COLUMN2_X_PT = 150;
    const HEADING_HEIGHT_PT = 40;
    const LIST_Y_PT = 90;
    const LIST_HEIGHT_PT = 150;
    const COLUMN_WIDTH_PT = 100;
    const shapes = [
      shape("left-heading", 0, 0, COLUMN_WIDTH_PT, HEADING_HEIGHT_PT),
      shape(
        "right-heading",
        COLUMN2_X_PT,
        0,
        COLUMN_WIDTH_PT,
        HEADING_HEIGHT_PT,
      ),
      shape("left-list", 0, LIST_Y_PT, COLUMN_WIDTH_PT, LIST_HEIGHT_PT),
      shape(
        "right-list",
        COLUMN2_X_PT,
        LIST_Y_PT,
        COLUMN_WIDTH_PT,
        LIST_HEIGHT_PT,
      ),
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
    const RIGHT_X_PT = 400;
    const LEFT_X_PT = 40;
    const ROW_Y_PT = 60;
    const SHAPE_WIDTH_PT = 300;
    const SHAPE_HEIGHT_PT = 200;
    const shapes = [
      shape("right", RIGHT_X_PT, ROW_Y_PT, SHAPE_WIDTH_PT, SHAPE_HEIGHT_PT),
      shape("left", LEFT_X_PT, ROW_Y_PT, SHAPE_WIDTH_PT, SHAPE_HEIGHT_PT),
    ];

    const result = assignReadingOrder(shapes);

    expect(result.map((s) => s.name)).toEqual(["right", "left"]);
    expect(result.map((s) => s.readingOrder)).toEqual([1, 0]);
  });
});
