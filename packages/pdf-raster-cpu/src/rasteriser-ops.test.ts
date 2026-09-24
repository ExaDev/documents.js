import { describe, expect, it } from "vitest";
import { decodePng } from "byte-codec";
import type { RawImage } from "byte-codec";
import type {
  RasterImageOp,
  RasterMatrix,
  RasterPathOp,
  RasterSubpath,
} from "pdf-codec/raster";
import {
  colourBytes,
  CpuRasteriser,
  invertMatrix,
  quadCorners,
  sampleBilinear,
} from "./rasteriser";
import type { RasterCpuDiagnostic } from "./rasteriser";
import {
  BLACK,
  pageGeometry,
  pixelAt,
  pngBytes,
} from "./test-support/pixel-fixtures";

// Split out of rasteriser.test.ts (ExaDev/documents.js#1275, max-lines): draw ops driven directly, bypassing PDF parsing entirely, plus the pure geometry/colour helper functions rasteriser.ts exports. The geometry each draw-ops test needs (a degenerate subpath alongside a real one, two overlapping draws on one page, two distinct cached images) is far more direct to hand-construct as RasterDrawOp values than to encode into a content stream — genuinely distinct testing style from rasteriser.test.ts's own renderPdfPage-driven pixel tests, which is why this is its own file rather than an arbitrary line-count split. pixelAt/BLACK/pageGeometry/pngBytes live in ./test-support/pixel-fixtures.ts, shared with rasteriser.test.ts.

describe("CpuRasteriser: draw ops driven directly", () => {
  it("names pathOp's own draw call when refusing a path before beginPage", () => {
    const rasteriser = new CpuRasteriser();
    const op: RasterPathOp = {
      kind: "path",
      subpaths: [],
      fill: { color: { r: 0, g: 0, b: 0 }, fillRule: "nonzero" },
    };
    expect(() => {
      rasteriser.draw(op);
    }).toThrow(/CpuRasteriser.draw\(\) was called before beginPage/);
  });

  it("names imageOp's own draw call when refusing an image before beginPage", () => {
    const rasteriser = new CpuRasteriser();
    const op: RasterImageOp = {
      kind: "image",
      format: "png",
      bytes: new Uint8Array(),
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [1, 0, 0, 1, 0, 0],
    };
    expect(() => {
      rasteriser.draw(op);
    }).toThrow(/CpuRasteriser.draw\(\) was called before beginPage/);
  });

  it("reports the JPEG refusal's own message text, not just its code", () => {
    const diagnostics: RasterCpuDiagnostic[] = [];
    const rasteriser = new CpuRasteriser({
      onDiagnostic: (d) => {
        diagnostics.push(d);
      },
    });
    rasteriser.beginPage(pageGeometry(4, 4));
    rasteriser.draw({
      kind: "image",
      format: "jpeg",
      bytes: new Uint8Array(),
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [1, 0, 0, 1, 0, 0],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/DCTDecode/);
    expect(diagnostics[0]?.message).toMatch(/byte-codec has no DCT decoder/);
  });

  it("blends the mask's own last marked pixel, not just every pixel before it", () => {
    // A triangle covering the whole 3x3 canvas: the mask's own markedRange().last is the bottom-right pixel's index (8), and blendMask must walk up to and including it — stopping one short would leave that one corner pixel white while every other pixel the shape covers turns black.
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(3, 3));
    rasteriser.draw({
      kind: "path",
      subpaths: [
        {
          startXPx: 0,
          startYPx: 0,
          segments: [
            { kind: "line", xPx: 3, yPx: 0 },
            { kind: "line", xPx: 3, yPx: 3 },
            { kind: "line", xPx: 0, yPx: 3 },
          ],
          closed: true,
        },
      ],
      fill: { color: { r: 0, g: 0, b: 0 }, fillRule: "nonzero" },
    });
    const image = decodePng(rasteriser.finish());
    expect(pixelAt(image, 2, 2)).toEqual(BLACK);
  });

  it("does not let two degenerate two-point subpaths perturb a real polygon's own fill", () => {
    // A real triangle alongside two unrelated two-point segments: CoverageMask's own bounding-box computation already excludes any subpath under three points from the SCAN RANGE regardless of what reaches it, so a single stray segment's forward/reverse crossings alone can land only on the identical x (the markSpan zero-width guard already absorbs that case) — it takes a SECOND, differently-placed degenerate segment for their respective stray crossings to pair up into a genuine, non-cancelling span. Pinning that pathOp's own `.filter(points => points.length >= 3)` keeps that pairing from ever reaching CoverageMask at all: pixel (1, 2) sits on the triangle's own interior and must stay solid black, not fade toward white.
    const triangle: RasterSubpath = {
      startXPx: 0,
      startYPx: 0,
      segments: [
        { kind: "line", xPx: 4.5, yPx: 4.5 },
        { kind: "line", xPx: 0, yPx: 4.5 },
      ],
      closed: true,
    };
    const degenerateA: RasterSubpath = {
      startXPx: 3,
      startYPx: 3.5,
      segments: [{ kind: "line", xPx: 4, yPx: 2.5 }],
      closed: false,
    };
    const degenerateB: RasterSubpath = {
      startXPx: 1,
      startYPx: 0.5,
      segments: [{ kind: "line", xPx: 2, yPx: 3.9 }],
      closed: false,
    };
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(5, 5));
    rasteriser.draw({
      kind: "path",
      subpaths: [triangle, degenerateA, degenerateB],
      fill: { color: { r: 0, g: 0, b: 0 }, fillRule: "nonzero" },
    });
    const image = decodePng(rasteriser.finish());
    expect(pixelAt(image, 1, 2)).toEqual(BLACK);
  });

  it("does not let a stroke's blend see a fill's own leftover mask coverage from an earlier draw", () => {
    // Two disjoint path draws on one page, in order: a full fill of the top-left region, then a stroke of the bottom-right region. If the stroke branch's own mask.reset() were skipped, blendMask — which paints every mask cell with a nonzero count, wherever it came from — would repaint the fill's already-covered pixels in the stroke's own colour, since CoverageMask carries state across draw calls on the same page.
    const fillRegion: RasterSubpath = {
      startXPx: 0,
      startYPx: 0,
      segments: [
        { kind: "line", xPx: 10, yPx: 0 },
        { kind: "line", xPx: 10, yPx: 10 },
        { kind: "line", xPx: 0, yPx: 10 },
      ],
      closed: true,
    };
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(20, 20));
    rasteriser.draw({
      kind: "path",
      subpaths: [fillRegion],
      fill: { color: { r: 0, g: 0, b: 0 }, fillRule: "nonzero" },
    });
    rasteriser.draw({
      kind: "path",
      subpaths: [
        {
          startXPx: 15,
          startYPx: 15,
          segments: [{ kind: "line", xPx: 19, yPx: 19 }],
          closed: false,
        },
      ],
      stroke: { color: { r: 0, g: 0, b: 1 }, widthPx: 2 },
    });
    const image = decodePng(rasteriser.finish());
    expect(pixelAt(image, 5, 5)).toEqual(BLACK);
  });

  it("does not let a fill's blend see a stroke's own leftover mask coverage from an earlier draw", () => {
    // The mirror image of the previous test: stroke first, then a disjoint fill — pinning the fill branch's own mask.reset(), not the stroke branch's.
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(20, 20));
    rasteriser.draw({
      kind: "path",
      subpaths: [
        {
          startXPx: 1,
          startYPx: 1,
          segments: [{ kind: "line", xPx: 5, yPx: 5 }],
          closed: false,
        },
      ],
      stroke: { color: { r: 0, g: 0, b: 1 }, widthPx: 2 },
    });
    const fillRegion: RasterSubpath = {
      startXPx: 10,
      startYPx: 10,
      segments: [
        { kind: "line", xPx: 20, yPx: 10 },
        { kind: "line", xPx: 20, yPx: 20 },
        { kind: "line", xPx: 10, yPx: 20 },
      ],
      closed: true,
    };
    rasteriser.draw({
      kind: "path",
      subpaths: [fillRegion],
      fill: { color: { r: 0, g: 0, b: 0 }, fillRule: "nonzero" },
    });
    const image = decodePng(rasteriser.finish());
    expect(pixelAt(image, 3, 3)).toEqual([0, 0, 255]);
  });

  it("does not let an image's blend see an earlier draw's own leftover mask coverage at the same location", () => {
    // imageOp reads only the mask cells inside its own quad's bounding box, so a leftover fill elsewhere on the page is never even looked at — what actually exercises this reset() is a fill and an image placement that OVERLAP: without the reset, the image's own fillPolygons call adds its quad's coverage on top of the fill's already-full 16, pushing the affected cells to 32 (an alpha of 2 instead of 1) and visibly overshooting the blend.
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(10, 10));
    rasteriser.draw({
      kind: "path",
      subpaths: [
        {
          startXPx: 0,
          startYPx: 0,
          segments: [
            { kind: "line", xPx: 10, yPx: 0 },
            { kind: "line", xPx: 10, yPx: 10 },
            { kind: "line", xPx: 0, yPx: 10 },
          ],
          closed: true,
        },
      ],
      fill: { color: { r: 0, g: 0, b: 0 }, fillRule: "nonzero" },
    });
    const image1x1: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array([0, 0, 255]),
    };
    rasteriser.draw({
      kind: "image",
      format: "png",
      bytes: pngBytes(image1x1),
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [4, 0, 0, 4, 2, 2],
    });
    const image = decodePng(rasteriser.finish());
    expect(pixelAt(image, 2, 2)).toEqual([0, 0, 255]);
  });

  it("decodes two distinct images placed on the same page by their own content, not a shared cache key", () => {
    // If decodeCached's own key collapsed to the same value for every image, the second placement's decode lookup would return the first image's already-cached RawImage instead of decoding its own bytes.
    const redImage: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array([255, 0, 0]),
    };
    const blueImage: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array([0, 0, 255]),
    };
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(10, 10));
    rasteriser.draw({
      kind: "image",
      format: "png",
      bytes: pngBytes(redImage),
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [4, 0, 0, 4, 0, 0],
    });
    rasteriser.draw({
      kind: "image",
      format: "png",
      bytes: pngBytes(blueImage),
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [4, 0, 0, 4, 5, 5],
    });
    const image = decodePng(rasteriser.finish());
    expect(pixelAt(image, 1, 1)).toEqual([255, 0, 0]);
    expect(pixelAt(image, 6, 6)).toEqual([0, 0, 255]);
  });

  it("caches a decoded image by content within a page, and forgets it once the next page begins", () => {
    // decodePng is pure, so no rendered pixel can ever tell a cache hit from a fresh decode — decodedImageForTesting inspects the cache directly instead, the same way stroke.test.ts/coverage.test.ts reach past this package's own narrow public surface for their own arithmetic.
    const solidGreen: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array([0, 255, 0]),
    };
    const bytes = pngBytes(solidGreen);
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(4, 4));
    expect(rasteriser.decodedImageForTesting(bytes)).toBeUndefined();
    const op: RasterImageOp = {
      kind: "image",
      format: "png",
      bytes,
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [1, 0, 0, 1, 0, 0],
    };
    rasteriser.draw(op);
    const decodedOnFirstDraw = rasteriser.decodedImageForTesting(bytes);
    expect(decodedOnFirstDraw).toBeDefined();
    // A second placement of the identical bytes reuses the cached entry, the exact same object, rather than replacing it with a fresh decode.
    rasteriser.draw(op);
    expect(rasteriser.decodedImageForTesting(bytes)).toBe(decodedOnFirstDraw);
    // The next page forgets it entirely.
    rasteriser.beginPage(pageGeometry(4, 4));
    expect(rasteriser.decodedImageForTesting(bytes)).toBeUndefined();
  });

  it("blends an image sample by its own coverage fraction times its own alpha, not divided by it", () => {
    // A fully-covered 1x1 destination pixel (samples === COVERAGE_DENOMINATOR) sampling a source texel whose own alpha is a genuine fraction (128 / 255): the correct blend factor is that fraction itself; dividing by it instead would push the factor well past 1 and paint a value far outside the two colours being blended between.
    const translucentBlack: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array([0, 0, 0]),
      alpha: new Uint8Array([128]),
    };
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(4, 4));
    rasteriser.draw({
      kind: "image",
      format: "png",
      bytes: pngBytes(translucentBlack),
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [1, 0, 0, 1, 1, 1],
    });
    const image = decodePng(rasteriser.finish());
    const [r, g, b] = pixelAt(image, 1, 1);
    // 255 + (0 - 255) * (128 / 255), rounded.
    expect(r).toBe(127);
    expect(g).toBe(127);
    expect(b).toBe(127);
  });
});

describe("colourBytes", () => {
  it("scales each unit-float channel up to its own byte, not down by the same factor", () => {
    // g: 0.2 rather than 0 — a zero channel can't distinguish multiplying by 255 from dividing by it (both give 0), so every channel here is a genuine, distinguishing fraction.
    expect(colourBytes({ r: 0.5, g: 0.2, b: 1 })).toEqual({
      r: 128,
      g: 51,
      b: 255,
    });
  });
});

describe("quadCorners", () => {
  it("maps the unit square's four corners through the placement matrix's own row-vector convention", () => {
    const matrix: RasterMatrix = [2, 0, 3, 1, 10, 20];
    expect(quadCorners(matrix)).toEqual([
      { x: 10, y: 20 },
      { x: 12, y: 20 },
      { x: 15, y: 21 },
      { x: 13, y: 21 },
    ]);
  });
});

describe("invertMatrix", () => {
  it("undoes quadCorners's own forward mapping for a fully generic (non-axis-aligned, non-orthogonal) matrix", () => {
    const matrix: RasterMatrix = [2, 0.5, 0.3, 1.5, 10, 20];
    const [a, b, c, d, e, f] = matrix;
    const forward = (u: number, v: number): [number, number] => [
      a * u + c * v + e,
      b * u + d * v + f,
    ];
    const inverse = invertMatrix(matrix);
    const [x, y] = forward(0.7, 0.4);
    const [u, v] = inverse(x, y);
    expect(u).toBeCloseTo(0.7, 9);
    expect(v).toBeCloseTo(0.4, 9);
  });
});

describe("sampleBilinear", () => {
  const rgbaSource: RawImage = {
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
    alpha: new Uint8Array([0, 64, 128, 255]),
  };

  it("blends colour and alpha across all four texels at the exact centre", () => {
    const [r, g, b, a] = sampleBilinear(rgbaSource, 0.5, 0.5);
    expect(r).toBeCloseTo(127.5, 9);
    expect(g).toBeCloseTo(127.5, 9);
    expect(b).toBeCloseTo(127.5, 9);
    expect(a).toBeCloseTo(0.43823529411764706, 9);
  });

  it("weights the sample toward whichever texel the point sits closer to", () => {
    const [r, g, b, a] = sampleBilinear(rgbaSource, 0.75, 0.75);
    expect(r).toBeCloseTo(255, 9);
    expect(g).toBeCloseTo(255, 9);
    expect(b).toBeCloseTo(255, 9);
    expect(a).toBeCloseTo(1, 9);
  });

  it("replicates a single-channel source's own grey value across r, g, and b", () => {
    const gray: RawImage = {
      width: 2,
      height: 1,
      channels: 1,
      data: new Uint8Array([0, 200]),
    };
    const [r, g, b, a] = sampleBilinear(gray, 0.5, 0.5);
    expect(r).toBeCloseTo(100, 9);
    expect(g).toBeCloseTo(100, 9);
    expect(b).toBeCloseTo(100, 9);
    expect(a).toBe(1);
  });

  it("interpolates between a texel and its own immediate neighbour, not one two columns and rows over", () => {
    // A 3x3 source sampled at a point whose x0/y0 land on 0, strictly short of the last valid index (2): x1/y1 must clamp to 1 (x0 + 1), not fall back to width - 1 (== 2, the last column) the way they would if x0's own clamp-to-edge logic were applied here by mistake — distinct from the two-texel rgbaSource above, where a boundary sample makes x0 and x1 (and therefore fx's own contribution) coincide and mask exactly this kind of bug.
    const distinctColours: RawImage = {
      width: 3,
      height: 3,
      channels: 3,
      data: new Uint8Array([
        255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255,
        128, 128, 128, 64, 64, 64, 200, 100, 50,
      ]),
      alpha: new Uint8Array([0, 64, 128, 32, 96, 160, 200, 220, 255]),
    };
    const [r, g, b, a] = sampleBilinear(distinctColours, 0.3, 0.3);
    expect(r).toBeCloseTo(193.8, 9);
    expect(g).toBeCloseTo(122.4, 9);
    expect(b).toBeCloseTo(40.8, 9);
    expect(a).toBeCloseTo(0.1505882352941176, 9);
  });

  it("weights by the fractional distance past x0/y0 themselves, not their sum", () => {
    // x0 and y0 are both 1 here (nonzero), so fx = sx - x0 and a wrong sx + x0 give genuinely different weights — the earlier interior-point test above has x0 == y0 == 0, where a sign error in that subtraction is invisible (sx - 0 and sx + 0 are identical). The alpha plane's own top-left corner of the interpolation, alphaAt(x0, y0) == 96, is likewise nonzero here, unlike that same earlier test's alphaAt(0, 0) == 0 — so this is also what actually distinguishes alphaTop's own + from a wrong -.
    const distinctColours: RawImage = {
      width: 3,
      height: 3,
      channels: 3,
      data: new Uint8Array([
        255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255,
        128, 128, 128, 64, 64, 64, 200, 100, 50,
      ]),
      alpha: new Uint8Array([0, 64, 128, 32, 96, 160, 200, 220, 255]),
    };
    const [r, g, b, a] = sampleBilinear(distinctColours, 0.6, 0.6);
    expect(r).toBeCloseTo(156.39, 9);
    expect(g).toBeCloseTo(75.99, 9);
    expect(b).toBeCloseTo(196.44, 9);
    expect(a).toBeCloseTo(0.5874117647058822, 9);
  });

  it("clamps a coordinate past the source's own edge to the nearest edge texel rather than extrapolating", () => {
    const [r, g, b, a] = sampleBilinear(rgbaSource, 1.5, 0.5);
    expect(r).toBeCloseTo(127.5, 9);
    expect(g).toBeCloseTo(255, 9);
    expect(b).toBeCloseTo(127.5, 9);
    expect(a).toBeCloseTo(0.6254901960784314, 9);
  });

  it("returns full opacity for a source with no alpha plane at all", () => {
    const opaque: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array([10, 20, 30]),
    };
    const [, , , a] = sampleBilinear(opaque, 0.5, 0.5);
    expect(a).toBe(1);
  });
});
