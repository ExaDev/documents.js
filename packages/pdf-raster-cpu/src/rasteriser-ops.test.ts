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
  BLUE,
  GREEN,
  pageGeometry,
  pixelAt,
  pngBytes,
  RED,
  RGB_CHANNEL_MAX,
  WHITE,
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
    const pageSize = 4;
    const diagnostics: RasterCpuDiagnostic[] = [];
    const rasteriser = new CpuRasteriser({
      onDiagnostic: (d) => {
        diagnostics.push(d);
      },
    });
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
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
    // A triangle covering the whole canvas: the mask's own markedRange().last is the bottom-right pixel's index, and blendMask must walk up to and including it — stopping one short would leave that one corner pixel white while every other pixel the shape covers turns black.
    const pageSize = 3;
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
    rasteriser.draw({
      kind: "path",
      subpaths: [
        {
          startXPx: 0,
          startYPx: 0,
          segments: [
            { kind: "line", xPx: pageSize, yPx: 0 },
            { kind: "line", xPx: pageSize, yPx: pageSize },
            { kind: "line", xPx: 0, yPx: pageSize },
          ],
          closed: true,
        },
      ],
      fill: { color: { r: 0, g: 0, b: 0 }, fillRule: "nonzero" },
    });
    const image = decodePng(rasteriser.finish());
    const cornerPixel = pageSize - 1;
    expect(pixelAt(image, cornerPixel, cornerPixel)).toEqual(BLACK);
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
    const pageSize = 5;
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
    rasteriser.draw({
      kind: "path",
      subpaths: [triangle, degenerateA, degenerateB],
      fill: { color: { r: 0, g: 0, b: 0 }, fillRule: "nonzero" },
    });
    const image = decodePng(rasteriser.finish());
    const interiorX = 1;
    const interiorY = 2;
    expect(pixelAt(image, interiorX, interiorY)).toEqual(BLACK);
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
    const pageSize = 20;
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
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
    const fillRegionSampleX = 5;
    const fillRegionSampleY = 5;
    expect(pixelAt(image, fillRegionSampleX, fillRegionSampleY)).toEqual(BLACK);
  });

  it("does not let a fill's blend see a stroke's own leftover mask coverage from an earlier draw", () => {
    // The mirror image of the previous test: stroke first, then a disjoint fill — pinning the fill branch's own mask.reset(), not the stroke branch's.
    const pageSize = 20;
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
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
    const strokeRegionSampleX = 3;
    const strokeRegionSampleY = 3;
    expect(pixelAt(image, strokeRegionSampleX, strokeRegionSampleY)).toEqual(
      BLUE,
    );
  });

  it("does not let an image's blend see an earlier draw's own leftover mask coverage at the same location", () => {
    // imageOp reads only the mask cells inside its own quad's bounding box, so a leftover fill elsewhere on the page is never even looked at — what actually exercises this reset() is a fill and an image placement that OVERLAP: without the reset, the image's own fillPolygons call adds its quad's coverage on top of the fill's already-full coverage denominator, pushing the affected cells to double (an alpha of 2 instead of 1) and visibly overshooting the blend.
    const pageSize = 10;
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
    rasteriser.draw({
      kind: "path",
      subpaths: [
        {
          startXPx: 0,
          startYPx: 0,
          segments: [
            { kind: "line", xPx: pageSize, yPx: 0 },
            { kind: "line", xPx: pageSize, yPx: pageSize },
            { kind: "line", xPx: 0, yPx: pageSize },
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
      data: new Uint8Array(BLUE),
    };
    const imageScale = 4;
    const imagePlacement = 2;
    rasteriser.draw({
      kind: "image",
      format: "png",
      bytes: pngBytes(image1x1),
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [imageScale, 0, 0, imageScale, imagePlacement, imagePlacement],
    });
    const image = decodePng(rasteriser.finish());
    expect(pixelAt(image, imagePlacement, imagePlacement)).toEqual(BLUE);
  });

  it("decodes two distinct images placed on the same page by their own content, not a shared cache key", () => {
    // If decodeCached's own key collapsed to the same value for every image, the second placement's decode lookup would return the first image's already-cached RawImage instead of decoding its own bytes.
    const redImage: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array(RED),
    };
    const blueImage: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array(BLUE),
    };
    const pageSize = 10;
    const imageScale = 4;
    const secondPlacement = 5;
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
    rasteriser.draw({
      kind: "image",
      format: "png",
      bytes: pngBytes(redImage),
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [imageScale, 0, 0, imageScale, 0, 0],
    });
    rasteriser.draw({
      kind: "image",
      format: "png",
      bytes: pngBytes(blueImage),
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [imageScale, 0, 0, imageScale, secondPlacement, secondPlacement],
    });
    const image = decodePng(rasteriser.finish());
    const firstImageSample = 1;
    const secondImageSample = secondPlacement + 1;
    expect(pixelAt(image, firstImageSample, firstImageSample)).toEqual(RED);
    expect(pixelAt(image, secondImageSample, secondImageSample)).toEqual(BLUE);
  });

  it("caches a decoded image by content within a page, and forgets it once the next page begins", () => {
    // decodePng is pure, so no rendered pixel can ever tell a cache hit from a fresh decode — decodedImageForTesting inspects the cache directly instead, the same way stroke.test.ts/coverage.test.ts reach past this package's own narrow public surface for their own arithmetic.
    const pageSize = 4;
    const solidGreen: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array(GREEN),
    };
    const bytes = pngBytes(solidGreen);
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
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
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
    expect(rasteriser.decodedImageForTesting(bytes)).toBeUndefined();
  });

  it("blends an image sample by its own coverage fraction times its own alpha, not divided by it", () => {
    const pageSize = 4;
    const texelAlpha = 128;
    const alphaMax = 255;
    // A fully-covered 1x1 destination pixel (samples === COVERAGE_DENOMINATOR) sampling a source texel whose own alpha is a genuine fraction: the correct blend factor is that fraction itself; dividing by it instead would push the factor well past 1 and paint a value far outside the two colours being blended between.
    const translucentBlack: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array(BLACK),
      alpha: new Uint8Array([texelAlpha]),
    };
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
    const samplePoint = 1;
    rasteriser.draw({
      kind: "image",
      format: "png",
      bytes: pngBytes(translucentBlack),
      sourceWidthPx: 1,
      sourceHeightPx: 1,
      matrix: [1, 0, 0, 1, samplePoint, samplePoint],
    });
    const image = decodePng(rasteriser.finish());
    const [r, g, b] = pixelAt(image, samplePoint, samplePoint);
    // WHITE's own channel value + (BLACK's own channel value - WHITE's own channel value) * (texelAlpha / alphaMax), rounded.
    const expectedBlend = Math.round(
      WHITE[0] + (BLACK[0] - WHITE[0]) * (texelAlpha / alphaMax),
    );
    expect(r).toBe(expectedBlend);
    expect(g).toBe(expectedBlend);
    expect(b).toBe(expectedBlend);
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
    const skewX = 3;
    const translateX = 10;
    const translateY = 20;
    const matrix: RasterMatrix = [2, 0, skewX, 1, translateX, translateY];
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
    const skewY = 0.5;
    const skewX = 0.3;
    const scaleY = 1.5;
    const translateX = 10;
    const translateY = 20;
    const matrix: RasterMatrix = [
      2,
      skewY,
      skewX,
      scaleY,
      translateX,
      translateY,
    ];
    const [a, b, c, d, e, f] = matrix;
    const forward = (u: number, v: number): [number, number] => [
      a * u + c * v + e,
      b * u + d * v + f,
    ];
    const inverse = invertMatrix(matrix);
    const sampleU = 0.7;
    const sampleV = 0.4;
    const precisionDigits = 9;
    const [x, y] = forward(sampleU, sampleV);
    const [u, v] = inverse(x, y);
    expect(u).toBeCloseTo(sampleU, precisionDigits);
    expect(v).toBeCloseTo(sampleV, precisionDigits);
  });
});

describe("sampleBilinear", () => {
  const precisionDigits = 9;
  const centreSample = 0.5;
  // Four texels, row-major 2x2: top-left red, top-right green, bottom-left blue, bottom-right white.
  const alphaTopLeft = 0;
  const alphaTopRight = 64;
  const alphaBottomLeft = 128;
  const alphaBottomRight = 255;
  const rgbaSource: RawImage = {
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array([...RED, ...GREEN, ...BLUE, ...WHITE]),
    alpha: new Uint8Array([
      alphaTopLeft,
      alphaTopRight,
      alphaBottomLeft,
      alphaBottomRight,
    ]),
  };

  it("blends colour and alpha across all four texels at the exact centre", () => {
    const [r, g, b, a] = sampleBilinear(rgbaSource, centreSample, centreSample);
    const expectedRgb = 127.5;
    const expectedAlpha = 0.43823529411764706;
    expect(r).toBeCloseTo(expectedRgb, precisionDigits);
    expect(g).toBeCloseTo(expectedRgb, precisionDigits);
    expect(b).toBeCloseTo(expectedRgb, precisionDigits);
    expect(a).toBeCloseTo(expectedAlpha, precisionDigits);
  });

  it("weights the sample toward whichever texel the point sits closer to", () => {
    const nearCorner = 0.75;
    const [r, g, b, a] = sampleBilinear(rgbaSource, nearCorner, nearCorner);
    const fullOpacity = 1;
    expect(r).toBeCloseTo(WHITE[0], precisionDigits);
    expect(g).toBeCloseTo(WHITE[0], precisionDigits);
    expect(b).toBeCloseTo(WHITE[0], precisionDigits);
    expect(a).toBeCloseTo(fullOpacity, precisionDigits);
  });

  it("replicates a single-channel source's own grey value across r, g, and b", () => {
    const blackTexel = 0;
    const lightTexel = 200;
    const gray: RawImage = {
      width: 2,
      height: 1,
      channels: 1,
      data: new Uint8Array([blackTexel, lightTexel]),
    };
    const [r, g, b, a] = sampleBilinear(gray, centreSample, centreSample);
    const expectedGray = (blackTexel + lightTexel) / 2;
    expect(r).toBeCloseTo(expectedGray, precisionDigits);
    expect(g).toBeCloseTo(expectedGray, precisionDigits);
    expect(b).toBeCloseTo(expectedGray, precisionDigits);
    expect(a).toBe(1);
  });

  it("interpolates between a texel and its own immediate neighbour, not one two columns and rows over", () => {
    // A 3x3 source sampled at a point whose x0/y0 land on 0, strictly short of the last valid index (2): x1/y1 must clamp to 1 (x0 + 1), not fall back to width - 1 (== 2, the last column) the way they would if x0's own clamp-to-edge logic were applied here by mistake — distinct from the two-texel rgbaSource above, where a boundary sample makes x0 and x1 (and therefore fx's own contribution) coincide and mask exactly this kind of bug.
    // A 3x3 grid, row-major: red, green, blue, yellow, magenta, cyan, mid-grey, dark-grey, and one arbitrary colour, each with its own distinct alpha.

    const midGreyLevel = 128;
    const darkGreyLevel = 64;
    const yellow: readonly [number, number, number] = [
      RGB_CHANNEL_MAX,
      RGB_CHANNEL_MAX,
      0,
    ];
    const magenta: readonly [number, number, number] = [
      RGB_CHANNEL_MAX,
      0,
      RGB_CHANNEL_MAX,
    ];
    const cyan: readonly [number, number, number] = [
      0,
      RGB_CHANNEL_MAX,
      RGB_CHANNEL_MAX,
    ];
    const midGrey: readonly [number, number, number] = [
      midGreyLevel,
      midGreyLevel,
      midGreyLevel,
    ];
    const darkGrey: readonly [number, number, number] = [
      darkGreyLevel,
      darkGreyLevel,
      darkGreyLevel,
    ];
    const arbitraryColourR = 200;
    const arbitraryColourG = 100;
    const arbitraryColourB = 50;
    const arbitraryColour: readonly [number, number, number] = [
      arbitraryColourR,
      arbitraryColourG,
      arbitraryColourB,
    ];
    const alphaRed = 0;

    const alphaYellow = 32;
    const alphaMagenta = 96;
    const alphaCyan = 160;
    const alphaMidGrey = 200;
    const alphaDarkGrey = 220;

    const texelAlphas = [
      alphaRed,
      darkGreyLevel,
      midGreyLevel,
      alphaYellow,
      alphaMagenta,
      alphaCyan,
      alphaMidGrey,
      alphaDarkGrey,
      RGB_CHANNEL_MAX,
    ];
    const distinctColours: RawImage = {
      width: 3,
      height: 3,
      channels: 3,
      data: new Uint8Array([
        ...RED,
        ...GREEN,
        ...BLUE,
        ...yellow,
        ...magenta,
        ...cyan,
        ...midGrey,
        ...darkGrey,
        ...arbitraryColour,
      ]),
      alpha: new Uint8Array(texelAlphas),
    };
    const sampleUv = 0.3;
    const [r, g, b, a] = sampleBilinear(distinctColours, sampleUv, sampleUv);
    const expectedR = 193.8;
    const expectedG = 122.4;
    const expectedB = 40.8;
    const expectedA = 0.1505882352941176;
    expect(r).toBeCloseTo(expectedR, precisionDigits);
    expect(g).toBeCloseTo(expectedG, precisionDigits);
    expect(b).toBeCloseTo(expectedB, precisionDigits);
    expect(a).toBeCloseTo(expectedA, precisionDigits);
  });

  it("weights by the fractional distance past x0/y0 themselves, not their sum", () => {
    // x0 and y0 are both 1 here (nonzero), so fx = sx - x0 and a wrong sx + x0 give genuinely different weights — the earlier interior-point test above has x0 == y0 == 0, where a sign error in that subtraction is invisible (sx - 0 and sx + 0 are identical). The alpha plane's own top-left corner of the interpolation, alphaAt(x0, y0) == 96, is likewise nonzero here, unlike that same earlier test's alphaAt(0, 0) == 0 — so this is also what actually distinguishes alphaTop's own + from a wrong -.
    // A 3x3 grid, row-major: red, green, blue, yellow, magenta, cyan, mid-grey, dark-grey, and one arbitrary colour, each with its own distinct alpha.

    const midGreyLevel = 128;
    const darkGreyLevel = 64;
    const yellow: readonly [number, number, number] = [
      RGB_CHANNEL_MAX,
      RGB_CHANNEL_MAX,
      0,
    ];
    const magenta: readonly [number, number, number] = [
      RGB_CHANNEL_MAX,
      0,
      RGB_CHANNEL_MAX,
    ];
    const cyan: readonly [number, number, number] = [
      0,
      RGB_CHANNEL_MAX,
      RGB_CHANNEL_MAX,
    ];
    const midGrey: readonly [number, number, number] = [
      midGreyLevel,
      midGreyLevel,
      midGreyLevel,
    ];
    const darkGrey: readonly [number, number, number] = [
      darkGreyLevel,
      darkGreyLevel,
      darkGreyLevel,
    ];
    const arbitraryColourR = 200;
    const arbitraryColourG = 100;
    const arbitraryColourB = 50;
    const arbitraryColour: readonly [number, number, number] = [
      arbitraryColourR,
      arbitraryColourG,
      arbitraryColourB,
    ];
    const alphaRed = 0;

    const alphaYellow = 32;
    const alphaMagenta = 96;
    const alphaCyan = 160;
    const alphaMidGrey = 200;
    const alphaDarkGrey = 220;

    const texelAlphas = [
      alphaRed,
      darkGreyLevel,
      midGreyLevel,
      alphaYellow,
      alphaMagenta,
      alphaCyan,
      alphaMidGrey,
      alphaDarkGrey,
      RGB_CHANNEL_MAX,
    ];
    const distinctColours: RawImage = {
      width: 3,
      height: 3,
      channels: 3,
      data: new Uint8Array([
        ...RED,
        ...GREEN,
        ...BLUE,
        ...yellow,
        ...magenta,
        ...cyan,
        ...midGrey,
        ...darkGrey,
        ...arbitraryColour,
      ]),
      alpha: new Uint8Array(texelAlphas),
    };
    const sampleUv = 0.6;
    const [r, g, b, a] = sampleBilinear(distinctColours, sampleUv, sampleUv);
    const expectedR = 156.39;
    const expectedG = 75.99;
    const expectedB = 196.44;
    const expectedA = 0.5874117647058822;
    expect(r).toBeCloseTo(expectedR, precisionDigits);
    expect(g).toBeCloseTo(expectedG, precisionDigits);
    expect(b).toBeCloseTo(expectedB, precisionDigits);
    expect(a).toBeCloseTo(expectedA, precisionDigits);
  });

  it("clamps a coordinate past the source's own edge to the nearest edge texel rather than extrapolating", () => {
    const pastRightEdge = 1.5;
    const [r, g, b, a] = sampleBilinear(
      rgbaSource,
      pastRightEdge,
      centreSample,
    );
    const expectedRb = 127.5;
    const expectedA = 0.6254901960784314;
    expect(r).toBeCloseTo(expectedRb, precisionDigits);
    expect(g).toBeCloseTo(GREEN[1], precisionDigits);
    expect(b).toBeCloseTo(expectedRb, precisionDigits);
    expect(a).toBeCloseTo(expectedA, precisionDigits);
  });

  it("returns full opacity for a source with no alpha plane at all", () => {
    // An arbitrary, distinguishable colour: its exact value carries no meaning beyond not coinciding with black, white, or a primary.
    const opaqueR = 10;
    const opaqueG = 20;
    const opaqueB = 30;
    const opaque: RawImage = {
      width: 1,
      height: 1,
      channels: 3,
      data: new Uint8Array([opaqueR, opaqueG, opaqueB]),
    };
    const [, , , a] = sampleBilinear(opaque, centreSample, centreSample);
    expect(a).toBe(1);
  });
});
