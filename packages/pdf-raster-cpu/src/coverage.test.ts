import { describe, expect, it } from "vitest";
import { CoverageMask } from "./coverage";

// Direct unit tests for the scanline coverage accumulator, distinct from rasteriser.test.ts's pixel-level PDF-driven assertions: these pin edge cases in the winding walk and its clamps that a real page's content streams rarely happen to construct -- an exactly scanline-aligned vertex, a degenerate sub-path mixed with real geometry, and a shape that overflows the canvas edge.

describe("CoverageMask", () => {
  it("clears every subsample count on reset", () => {
    const mask = new CoverageMask(2, 2);
    mask.fillPolygons(
      [
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
      ],
      "nonzero",
    );
    expect(mask.countAt(0)).toBeGreaterThan(0);
    mask.reset();
    expect(mask.countAt(0)).toBe(0);
    expect(mask.countAt(1)).toBe(0);
    expect(mask.countAt(2)).toBe(0);
    expect(mask.countAt(3)).toBe(0);
  });

  it("paints nothing when every polygon is degenerate (fewer than three points)", () => {
    // Neither of these "polygons" bounds any area, so filtering them out of the bounding-box computation leaves minY/maxY at their initial +/-Infinity, and the mask stays untouched -- without the filter, the degenerate points would set a real (if tiny) scan range, and the two-point segments' own forward and reverse traversals do not always cancel perfectly under floating point, leaving stray subsample marks.
    const mask = new CoverageMask(7, 6);
    mask.fillPolygons(
      [
        [
          { x: 0, y: 5.5 },
          { x: 5.5, y: 0 },
        ],
        [
          { x: 1, y: 4.5 },
          { x: 3, y: 0 },
        ],
      ],
      "nonzero",
    );
    for (let i = 0; i < 7 * 6; i++) {
      expect(mask.countAt(i)).toBe(0);
    }
  });

  it("does not paint a pixel a degenerate segment's own forward and reverse crossing coincide on exactly", () => {
    // The two-point segment (3, 3.5)-(4, 2.5), alongside a real triangle, crosses one particular scanline (row 10, y = 2.625) at the identical x in both traversal directions -- its own edge and that edge walked backwards. The resulting span-close call has an equal start and end, which must be treated as covering nothing: relaxing that guard degenerate-marks pixel (3, 2), index 13 in this 5-wide mask, with a stray sliver of coverage the real geometry does not produce.
    const mask = new CoverageMask(5, 5);
    mask.fillPolygons(
      [
        [
          { x: 0, y: 0 },
          { x: 4.5, y: 4.5 },
          { x: 0, y: 4.5 },
        ],
        [
          { x: 3, y: 3.5 },
          { x: 4, y: 2.5 },
        ],
      ],
      "nonzero",
    );
    expect(mask.countAt(13)).toBe(0);
  });

  it("fully covers a pixel whose polygon vertex sits exactly on a subsample scanline", () => {
    // The top edge runs from (0, 0.125) rather than (0, 0): 0.125 is exactly the first subsample row's own scanline y (row 0 samples at y = 0.125), so the half-open crossing test's two sides must each independently decide whether this vertex counts as on-or-above versus strictly-above the scanline. Loosening either side to a strict less-than drops four of the sixteen subsamples from the top-left pixel.
    const mask = new CoverageMask(4, 4);
    mask.fillPolygons(
      [
        [
          { x: 0, y: 0.125 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
        ],
      ],
      "nonzero",
    );
    expect(mask.countAt(0)).toBe(16);
  });

  it("does not bleed coverage into the next row down when a span overruns the canvas's right edge", () => {
    // The rectangle's right edge sits at device x 20, far past this 4-pixel-wide mask: the span-marking column clamp must stop at the mask's own last column rather than a column or two past it, because in the flat row-major counts array a column just past the last one on a non-final row is not out of bounds -- it is column 0 of the very next row. Widening that clamp leaks partial coverage into (0, 2) and (0, 3), directly below the rect's own rows 1-2.
    const mask = new CoverageMask(4, 4);
    mask.fillPolygons(
      [
        [
          { x: 1, y: 1 },
          { x: 20, y: 1 },
          { x: 20, y: 3 },
          { x: 1, y: 3 },
        ],
      ],
      "nonzero",
    );
    // Row 2 is one past the rect's own bottom row (page y 1..3 covers pixel rows 1-2); its first column must stay untouched by the rect's right-edge overrun.
    expect(mask.countAt(2 * 4 + 0)).toBe(0);
    expect(mask.countAt(3 * 4 + 0)).toBe(0);
  });

  it("cuts a hole under evenodd where nonzero keeps a same-wound overlap solid", () => {
    // Two identically-wound nested squares: nonzero sums the inner ring's winding to 2 (still nonzero, so the union stays solid); evenodd toggles on every crossing regardless of winding, so the same inner ring reads as a hole. This is the CoverageMask-level counterpart to rasteriser.test.ts's PDF-driven version of the same fixture.
    const outer = [
      { x: 1, y: 1 },
      { x: 6, y: 1 },
      { x: 6, y: 6 },
      { x: 1, y: 6 },
    ];
    const inner = [
      { x: 2, y: 2 },
      { x: 5, y: 2 },
      { x: 5, y: 5 },
      { x: 2, y: 5 },
    ];
    const centreIndex = 3 * 8 + 3;
    const nonzero = new CoverageMask(8, 8);
    nonzero.fillPolygons([outer, inner], "nonzero");
    expect(nonzero.countAt(centreIndex)).toBeGreaterThan(0);
    const evenodd = new CoverageMask(8, 8);
    evenodd.fillPolygons([outer, inner], "evenodd");
    expect(evenodd.countAt(centreIndex)).toBe(0);
  });

  it("cuts a hole under nonzero when the inner ring is wound the opposite way to the outer one", () => {
    // The outer square's own vertex order, reversed for the inner square: the two windings cancel back to exactly zero over the inner ring, reading as a hole under nonzero even though evenodd would already have cut the same hole for either winding.
    const outer = [
      { x: 1, y: 1 },
      { x: 6, y: 1 },
      { x: 6, y: 6 },
      { x: 1, y: 6 },
    ];
    const reversedInner = [
      { x: 2, y: 2 },
      { x: 2, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 2 },
    ];
    const centreIndex = 3 * 8 + 3;
    const mask = new CoverageMask(8, 8);
    mask.fillPolygons([outer, reversedInner], "nonzero");
    expect(mask.countAt(centreIndex)).toBe(0);
    // The outer ring itself, between the two squares, is still solid: only the inner square's own interior is cancelled out.
    expect(mask.countAt(1 * 8 + 3)).toBeGreaterThan(0);
  });
});
