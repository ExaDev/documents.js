import { describe, expect, it } from "vitest";
import type { GlyphContourPoint, GlyphOutline } from "./glyf-contours";
import type { Matrix } from "./matrix";
import { IDENTITY_MATRIX } from "./matrix";
import { flattenCubic } from "./raster";
import { drawGlyphOutline, glyphOutlineSubpaths } from "./raster-text";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterPageGeometry,
} from "./raster";
import {} from "./test-support/pdf";

// renderPdfPage's tests drive it through a recording rasteriser (the port's cheapest consumer) so every assertion is on the op stream itself — the exact positioned geometry a real backend would receive — rather than on any one backend's pixels. The end-to-end pixel tests (renderPdfPage plus the pdf-raster-cpu reference backend) live in that backend package's own suite; here the port contract, the coordinate transforms, and the refusal diagnostics are what is pinned.
//
// The small fixtures below are built by local literal concatenation on the same independence principle src/test-support/pdf.ts states (a fixture built by this package's own writer would let a writer bug hide from the renderer test): the raster suite's fixtures differ from the reader suite's and are few enough to build inline.

// --- A recording rasteriser and a minimal fixture builder. ---

class RecordingRasteriser implements PageRasteriser {
  geometry: RasterPageGeometry | undefined;
  readonly ops: RasterDrawOp[] = [];
  private readonly sentinel = new Uint8Array([1, 2, 3]);

  beginPage(geometry: RasterPageGeometry): void {
    this.geometry = geometry;
  }

  draw(op: RasterDrawOp): void {
    this.ops.push(op);
  }

  finish(): Uint8Array<ArrayBuffer> {
    return this.sentinel;
  }
}

// renderPdfPage returns whatever the rasteriser's finish produces (a PNG's bytes, or a promise of them); every test here pairs it with the synchronous RecordingRasteriser, and this wrapper narrows that union for the assertions (and for no-floating-promises) while keeping the entry point's real signature exercised.

// Repoints a table record past the end of the file, the same technique embedded-font.test.ts's own dropTable uses — parseSfnt drops that one table entirely, exactly as it would for a genuinely truncated font, while every other table (head/maxp/glyf included) stays intact and readable.
// One page, 200 x 100 pt, with the caller's content stream and optional extra entries on the page dict and catalog. Objects 1 (catalog), 2 (pages), 3 (page), 5 (contents) are wired; object 4 is a standard Helvetica font resource so text fixtures have a /Font to select.
// --- The port's geometry contract. ---

describe("flattenCubic", () => {
  it("returns the endpoint alone for an already-flat (collinear) curve, with no subdivision", () => {
    const points = flattenCubic(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    );
    expect(points).toEqual([{ x: 3, y: 0 }]);
  });

  it("subdivides a curved arc into the exact de Casteljau midpoint sequence", () => {
    const points = flattenCubic(
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 10, y: 1 },
      { x: 10, y: 0 },
    );
    expect(points).toHaveLength(10);
    // The true, symmetric peak of this curve — wrong chord/dist arithmetic or a wrong midpoint divisor shifts every one of these values.
    expect(points[4]).toEqual({ x: 5, y: 0.75 });
    expect(points[points.length - 1]).toEqual({ x: 10, y: 0 });
  });

  it("stops at exactly the depth cap for a curve whose flatness never converges, terminating rather than recursing forever", () => {
    const points = flattenCubic(
      { x: 0, y: 0 },
      { x: 1e9, y: 1e9 },
      { x: -1e9, y: 1e9 },
      { x: 1e-12, y: 0 },
    );
    // Every leaf hits the depth cap, never the flatness check, so the tree is a perfectly balanced binary recursion of depth 16 — exactly 2**16 leaves. A boundary of >16, <16, or an unconditional true/false all produce a different power of two (or an infinite loop for false).
    expect(points).toHaveLength(65536);
  });

  it("falls back to a chord length of 1 rather than dividing by zero when the endpoints coincide", () => {
    const points = flattenCubic(
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
    );
    expect(points).toEqual([{ x: 5, y: 5 }]);
  });

  it("subdivides on the LARGER of the two control points' chord distances, not the smaller", () => {
    // c1 sits almost exactly on the chord (dist1 ~ 0.001, well under the flatness tolerance) while c2 sits far off it (dist2 = 5, far over) — a curve constructed so the two distances disagree about whether this piece is flat enough to stop. Only checking the larger one is correct: a single wildly-off control point must still force a split even when its sibling is nearly collinear.
    const points = flattenCubic(
      { x: 0, y: 0 },
      { x: 5, y: 0.001 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    );
    expect(points.length).toBeGreaterThan(1);
  });

  it("treats the flatness check as <= at the tolerance boundary, not <", () => {
    // Both control points sit exactly 0.05 page-space units off the chord — the module's own STROKE_FLATTEN_TOLERANCE_PX. At exactly the boundary the piece must already count as flat enough (<=) and stop without subdividing; a strict < would subdivide once more here, doubling the point count.
    const points = flattenCubic(
      { x: 0, y: 0 },
      { x: 3, y: 0.05 },
      { x: 7, y: 0.05 },
      { x: 10, y: 0 },
    );
    expect(points).toEqual([{ x: 10, y: 0 }]);
  });
});

// glyphOutlineSubpaths exercised directly, the same reasoning as flattenCubic above: no vendored face's own contours ever start off-curve, or carry a contour with no on-curve point at all (every glyph probed across Carlito's whole repertoire starts on-curve), so pinning the rotation and no-on-curve branches needs hand-built contours, not a real font's glyphs.
describe("glyphOutlineSubpaths", () => {
  const pt = (x: number, y: number, onCurve: boolean): GlyphContourPoint => ({
    x,
    y,
    onCurve,
  });
  const outlineOf = (contour: readonly GlyphContourPoint[]): GlyphOutline => ({
    contours: [contour],
  });

  it("drops a contour of fewer than 3 points but keeps one of exactly 3, the boundary a <= in place of < would erase", () => {
    const tooShort = outlineOf([pt(0, 0, true), pt(1, 0, true)]);
    expect(glyphOutlineSubpaths(tooShort, IDENTITY_MATRIX)).toEqual([]);

    const exactlyThree = outlineOf([
      pt(0, 0, true),
      pt(10, 0, true),
      pt(10, 10, true),
    ]);
    expect(glyphOutlineSubpaths(exactlyThree, IDENTITY_MATRIX)).toHaveLength(1);
  });

  it("draws nothing for a non-empty outline whose only contour is still too short to produce a subpath", () => {
    // decodeGlyphOutline's own contract only guarantees a non-empty contours array, not that every contour individually clears the 3-point floor — the same tooShort shape above, but driven through drawGlyphOutline's own draw-or-skip decision rather than glyphOutlineSubpaths directly.
    const tooShort = outlineOf([pt(0, 0, true), pt(1, 0, true)]);
    const rasteriser = new RecordingRasteriser();
    drawGlyphOutline(
      tooShort,
      IDENTITY_MATRIX,
      { r: 0, g: 0, b: 0 },
      rasteriser,
    );
    expect(rasteriser.ops).toEqual([]);
  });

  it("starts at the implied midpoint of the last and first points for a contour with no on-curve point at all, walking every consecutive off-curve pair through its own midpoint", () => {
    // Three off-curve points, none on-curve: start = midpoint(P2, P0), then each consecutive pair (P0,P1) and (P1,P2) implies its own on-curve midpoint, and the walk closes with a final quad from the last implied point back through P2 to start.
    const outline = outlineOf([
      pt(3, 9, false),
      pt(15, 3, false),
      pt(21, 15, false),
    ]);
    expect(glyphOutlineSubpaths(outline, IDENTITY_MATRIX)).toEqual([
      {
        startXPx: 12,
        startYPx: 12,
        closed: true,
        segments: [
          {
            kind: "cubic",
            c1xPx: 6,
            c1yPx: 10,
            c2xPx: 5,
            c2yPx: 8,
            xPx: 9,
            yPx: 6,
          },
          {
            kind: "cubic",
            c1xPx: 13,
            c1yPx: 4,
            c2xPx: 16,
            c2yPx: 5,
            xPx: 18,
            yPx: 9,
          },
          {
            kind: "cubic",
            c1xPx: 20,
            c1yPx: 13,
            c2xPx: 18,
            c2yPx: 14,
            xPx: 12,
            yPx: 12,
          },
        ],
      },
    ]);
  });

  it("needs no rotation when the contour already starts on-curve, and produces exactly two segments for a single on/off/on run", () => {
    // On, off, on: the sole off-curve point never triggers the mid-pair emit (only one point in its run), so it folds into the following on-curve point's own quad — exactly two segments (one line, one quad), the fewest a non-degenerate (length >= 3) contour can ever produce.
    const outline = outlineOf([
      pt(0, 0, true),
      pt(6, 9, false),
      pt(12, 0, true),
    ]);
    expect(glyphOutlineSubpaths(outline, IDENTITY_MATRIX)).toEqual([
      {
        startXPx: 0,
        startYPx: 0,
        closed: true,
        segments: [
          { kind: "line", xPx: 0, yPx: 0 },
          {
            kind: "cubic",
            c1xPx: 4,
            c1yPx: 6,
            c2xPx: 8,
            c2yPx: 6,
            xPx: 12,
            yPx: 0,
          },
        ],
      },
    ]);
  });

  it("rotates to start on the first on-curve point, walks a run of consecutive off-curve points through their implied midpoint, and closes a still-pending control point back to the start", () => {
    // Stored order [A(off) B(on) C(off) D(off) E(on) F(off)]: firstOn = 1, so the walk starts at B, continues C, D, E, F, and wraps to A — exercising the on-curve-with-pending quad (B->C->mid(C,D)), the consecutive-off-curve implied-midpoint quad (twice: C/D and F/A), and the final trailing quad closing a still-pending control point (A) back to the rotated start (B).
    const a = pt(27, 15, false);
    const b = pt(0, 0, true);
    const c = pt(3, 6, false);
    const d = pt(9, 12, false);
    const e = pt(15, 3, true);
    const f = pt(21, 9, false);
    const outline = outlineOf([a, b, c, d, e, f]);
    expect(glyphOutlineSubpaths(outline, IDENTITY_MATRIX)).toEqual([
      {
        startXPx: 0,
        startYPx: 0,
        closed: true,
        segments: [
          { kind: "line", xPx: 0, yPx: 0 },
          {
            kind: "cubic",
            c1xPx: 2,
            c1yPx: 4,
            c2xPx: 4,
            c2yPx: 7,
            xPx: 6,
            yPx: 9,
          },
          {
            kind: "cubic",
            c1xPx: 8,
            c1yPx: 11,
            c2xPx: 11,
            c2yPx: 9,
            xPx: 15,
            yPx: 3,
          },
          {
            kind: "cubic",
            c1xPx: 19,
            c1yPx: 7,
            c2xPx: 22,
            c2yPx: 10,
            xPx: 24,
            yPx: 12,
          },
          {
            kind: "cubic",
            c1xPx: 26,
            c1yPx: 14,
            c2xPx: 18,
            c2yPx: 10,
            xPx: 0,
            yPx: 0,
          },
        ],
      },
    ]);
  });

  it("applies the caller's own matrix to every emitted point, not just the on-curve endpoints", () => {
    // A pure translation confirms the matrix reaches the start point, the line endpoint, AND the quad's own control-derived points — not only the segment's final on-curve xPx/yPx.
    const outline = outlineOf([
      pt(0, 0, true),
      pt(6, 9, false),
      pt(12, 0, true),
    ]);
    const translated: Matrix = [1, 0, 0, 1, 100, 200];
    expect(glyphOutlineSubpaths(outline, translated)).toEqual([
      {
        startXPx: 100,
        startYPx: 200,
        closed: true,
        segments: [
          { kind: "line", xPx: 100, yPx: 200 },
          {
            kind: "cubic",
            c1xPx: 104,
            c1yPx: 206,
            c2xPx: 108,
            c2yPx: 206,
            xPx: 112,
            yPx: 200,
          },
        ],
      },
    ]);
  });
});
