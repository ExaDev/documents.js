import { describe, expect, it } from "vitest";
import { ByteWriter, decodePng, deflate } from "byte-codec";
import type { RawImage } from "byte-codec";
import { createFontRegistry, writePdf } from "pdf-codec";
import { renderPdfPage } from "pdf-codec/raster";
import type { RenderPdfPageOptions } from "pdf-codec/raster";
import { COVERAGE_DENOMINATOR } from "./coverage";
import { CpuRasteriser, createCpuRasteriser } from "./rasteriser";
import type { CpuRasteriserOptions, RasterCpuDiagnostic } from "./rasteriser";
import {
  BLACK,
  BLUE,
  GREEN,
  pageGeometry,
  pixelAt,
  RED,
  WHITE,
} from "./test-support/pixel-fixtures";

// The backend's own contract, pinned on pixels: every test here renders through renderPdfPage with createCpuRasteriser (the composition a real consumer uses) and asserts on the PNG's decoded pixels, which decodePng reconstructs exactly from either of encodePng's output representations — so the assertions are about raster output, never about one encoder spelling. pdf-codec's own raster suite already pins the op stream's geometry; what these tests add is that this backend turns those ops into the right pixels, deterministically, with the right refusals.
//
// The small fixtures are built by literal byte concatenation on the same independence principle pdf-codec's own suites state (a fixture built by the package under test would let a writer bug hide from the renderer test); the one deliberate exception is the embedded-font text fixture, which IS built by writePdf — there, the port's own geometry is already pinned by pdf-codec's suite against inline fixtures, and what needs proving here is that real embedded outlines reach real pixels, which the writer's mainstream-shaped output (Type0 + Identity-H + CIDFontType2 + FontFile2) exercises better than any hand-built equivalent.
//
// pixelAt/WHITE/BLACK/pageGeometry live in ./test-support/pixel-fixtures.ts, shared with rasteriser-ops.test.ts's draw-ops-driven-directly and pure-helper tests below the split this file and that one used to be one over-800-line file.

// --- Fixtures: the same minimal classic-xref shape pdf-codec's own raster suite builds, over byte-codec's ByteWriter. ---

//
// The small fixtures are built by literal byte concatenation on the same independence principle pdf-codec's own suites state (a fixture built by the package under test would let a writer bug hide from the renderer test); the one deliberate exception is the embedded-font text fixture, which IS built by writePdf — there, the port's own geometry is already pinned by pdf-codec's suite against inline fixtures, and what needs proving here is that real embedded outlines reach real pixels, which the writer's mainstream-shaped output (Type0 + Identity-H + CIDFontType2 + FontFile2) exercises better than any hand-built equivalent.

// --- Fixtures: the same minimal classic-xref shape pdf-codec's own raster suite builds, over byte-codec's ByteWriter. ---

// The classic xref table's own fixed 10-digit offset field width (ISO 32000-1 7.5.4).
const XREF_OFFSET_FIELD_WIDTH = 10;

class SmallFixture {
  private readonly writer = new ByteWriter();
  private readonly offsets = new Map<number, number>();

  constructor() {
    this.writer.writeAscii("%PDF-1.7\n");
  }

  object(num: number, body: string): this {
    this.offsets.set(num, this.writer.length);
    this.writer.writeAscii(`${num} 0 obj\n${body}\nendobj\n`);
    return this;
  }

  stream(
    num: number,
    dictWithoutLength: string,
    raw: Uint8Array<ArrayBuffer>,
  ): this {
    this.offsets.set(num, this.writer.length);
    const dict = dictWithoutLength.replace(
      />>\s*$/,
      ` /Length ${raw.length} >>`,
    );
    this.writer.writeAscii(`${num} 0 obj\n${dict}\nstream\n`);
    this.writer.writeBytes(raw);
    this.writer.writeAscii("\nendstream\nendobj\n");
    return this;
  }

  classicXrefAndTrailer(
    maxObjNum: number,
    trailerExtra: string,
  ): Uint8Array<ArrayBuffer> {
    const xrefOffset = this.writer.length;
    this.writer.writeAscii(`xref\n0 ${maxObjNum + 1}\n`);
    this.writer.writeAscii("0000000000 65535 f \n");
    for (let n = 1; n <= maxObjNum; n++) {
      const offset = this.offsets.get(n);
      this.writer.writeAscii(
        offset === undefined
          ? "0000000000 00000 f \n"
          : `${offset.toString().padStart(XREF_OFFSET_FIELD_WIDTH, "0")} 00000 n \n`,
      );
    }
    this.writer.writeAscii(
      `trailer\n<< /Size ${maxObjNum + 1} ${trailerExtra} >>\nstartxref\n${xrefOffset}\n%%EOF`,
    );
    return this.writer.toBytes();
  }
}

function enc(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

// One page, 200 x 100 pt, with the caller's content stream and optional extra resource entries.
function onePagePdf(
  content: string,
  options: { readonly pageResources?: string } = {},
): Uint8Array<ArrayBuffer> {
  const catalogObj = 1;
  const pagesObj = 2;
  const pageObj = 3;
  const fontObj = 4;
  const contentObj = 5;
  const b = new SmallFixture();
  b.object(catalogObj, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(pagesObj, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    pageObj,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] ${options.pageResources ?? "/Resources << /Font << /F1 4 0 R >> >>"} /Contents 5 0 R >>`,
  );
  b.object(fontObj, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  b.stream(contentObj, "<< >>", enc(content));
  return b.classicXrefAndTrailer(contentObj, "/Root 1 0 R");
}

// --- Helpers: render through the real composition and read pixels back. ---

function drive(
  bytes: Uint8Array<ArrayBuffer>,
  pageIndex: number,
  options: RenderPdfPageOptions,
  backendOptions?: CpuRasteriserOptions,
): Uint8Array<ArrayBuffer> {
  const result = renderPdfPage(
    bytes,
    pageIndex,
    options,
    createCpuRasteriser(backendOptions),
  );
  if (result instanceof Promise) {
    throw new Error("CpuRasteriser.finish never returns a promise");
  }
  return result;
}

function renderPixels(
  bytes: Uint8Array<ArrayBuffer>,
  options: RenderPdfPageOptions = {},
): RawImage {
  return decodePng(drive(bytes, 0, options));
}

function regionAll(
  image: RawImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): readonly [number, number, number][] {
  const pixels: [number, number, number][] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      pixels.push([...pixelAt(image, x, y)] as [number, number, number]);
    }
  }
  return pixels;
}

// The bounding box of every non-white pixel, for the ink-scaling assertions.
function inkBounds(image: RawImage): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // A pixel counts as "ink" once any channel dips noticeably below white; this is a loose antialiasing-tolerant threshold, not the exact channel value a real glyph edge lands on.
  const nearWhiteThreshold = 250;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b] = pixelAt(image, x, y);
      if (
        r < nearWhiteThreshold ||
        g < nearWhiteThreshold ||
        b < nearWhiteThreshold
      ) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (minX === Infinity) {
    throw new Error("fixture setup: no ink found to bound");
  }
  return { minX, minY, maxX, maxY };
}

// --- The rasteriser's own page-state contract, driven directly. ---

describe("CpuRasteriser page state", () => {
  it("refuses draw and finish before beginPage, naming the operation", () => {
    const rasteriser = new CpuRasteriser();
    expect(() => {
      rasteriser.draw({
        kind: "fillRect",
        xPx: 0,
        yPx: 0,
        widthPx: 1,
        heightPx: 1,
        color: { r: 0, g: 0, b: 0 },
      });
    }).toThrow(/CpuRasteriser.draw\(\) was called before beginPage/);
    expect(() => rasteriser.finish()).toThrow(
      /CpuRasteriser.finish\(\) was called before beginPage/,
    );
  });

  it("renders any number of pages sequentially on one instance", () => {
    const catalogObj = 1;
    const pagesObj = 2;
    const page1Obj = 3;
    const content1Obj = 4;
    const page2Obj = 6;
    const content2Obj = 7;
    const b = new SmallFixture();
    b.object(catalogObj, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(pagesObj, "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>");
    b.object(
      page1Obj,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << >> /Contents 4 0 R >>",
    );
    b.stream(content1Obj, "<< >>", enc("1 0 0 rg 5 5 10 10 re f"));
    b.object(
      page2Obj,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << >> /Contents 7 0 R >>",
    );
    b.stream(content2Obj, "<< >>", enc("0 0 1 rg 5 5 10 10 re f"));
    const bytes = b.classicXrefAndTrailer(content2Obj, "/Root 1 0 R");

    const rasteriser = createCpuRasteriser();
    const first = renderPdfPage(bytes, 0, {}, rasteriser);
    const second = renderPdfPage(bytes, 1, {}, rasteriser);
    if (first instanceof Promise || second instanceof Promise) {
      throw new Error("CpuRasteriser.finish never returns a promise");
    }
    expect(first).toBeInstanceOf(Uint8Array);
    const firstImage = decodePng(first);
    const secondImage = decodePng(second);
    const samplePoint = 10;
    expect(pixelAt(firstImage, samplePoint, samplePoint)).toEqual(RED);
    expect(pixelAt(secondImage, samplePoint, samplePoint)).toEqual(BLUE);
  });
});

// --- fillRect: analytic coverage. ---

describe("fillRect pixels", () => {
  it("paints the rect's interior exactly and leaves everything outside white", () => {
    const pageWidthPt = 200;
    const pageHeightPt = 100;
    const rgbChannelCount = 3;
    const image = renderPixels(onePagePdf("1 0 0 rg 10 20 30 40 re f"));
    expect(image.width).toBe(pageWidthPt);
    expect(image.height).toBe(pageHeightPt);
    expect(image.channels).toBe(rgbChannelCount);
    // Page y 20..60 maps to device y 40..80 (the y flip): interior pixel (25, 60) is red, corners outside are white.
    const interiorX = 25;
    const interiorY = 60;
    const nearCornerX = 39;
    const nearCornerY = 79;
    const outsideX = 5;
    const outsideY = 5;
    const rightOfRectX = 45;
    const belowRectY = 85;
    expect(pixelAt(image, interiorX, interiorY)).toEqual(RED);
    expect(pixelAt(image, nearCornerX, nearCornerY)).toEqual(RED);
    expect(pixelAt(image, outsideX, outsideY)).toEqual(WHITE);
    expect(pixelAt(image, rightOfRectX, interiorY)).toEqual(WHITE);
    expect(pixelAt(image, interiorX, belowRectY)).toEqual(WHITE);
  });

  it("blends a fractional edge at the exact analytic fraction", () => {
    // A rect starting at x 10.5: column 10 is covered from 10.5, an exact 0.5 overlap, so a 50%-grey red fill lands at exactly the half-blend of full-red over white. The far edge sits at 40.5, the same fractional shape one column further along; column 41, one past it, must stay pure white, not just the near-side column 9.
    // White/red averaged for the half-blend column, and further averaged with white again for the quarter-covered edge column.
    const halfBlend = 128;
    const quarterEdgeBlend = 192;
    const halfIntensityRed = [halfBlend, 0, 0] as const;
    const halfCoveredEdge = [quarterEdgeBlend, halfBlend, halfBlend] as const;
    const nearEdgeX = 10;
    const farEdgeX = 40;
    const rowY = 60;
    const interiorX = 25;
    const justBeforeNearEdgeX = 9;
    const justPastFarEdgeX = 41;
    const image = renderPixels(onePagePdf("0.5 0 0 rg 10.5 20 30 40 re f"));
    expect(pixelAt(image, nearEdgeX, rowY)).toEqual(halfCoveredEdge);
    expect(pixelAt(image, farEdgeX, rowY)).toEqual(halfCoveredEdge);
    expect(pixelAt(image, interiorX, rowY)).toEqual(halfIntensityRed);
    expect(pixelAt(image, justBeforeNearEdgeX, rowY)).toEqual(WHITE);
    expect(pixelAt(image, justPastFarEdgeX, rowY)).toEqual(WHITE);
  });

  it("blends a fractional top and bottom edge symmetrically, with nothing painted one row past either", () => {
    // Page y 20.5..50.5 (height 30) maps to device y 49.5..79.5 (the y flip): row 49 gets the far (bottom, in page terms) fractional 0.5 overlap, row 79 gets the near (top) fractional 0.5 overlap, and rows 48 and 80, one past each edge, must stay pure white.
    // White/green averaged for the half-blend row, and further averaged with white again for the quarter-covered edge row.
    const halfBlend = 128;
    const quarterEdgeBlend = 192;
    const halfIntensityGreen = [0, halfBlend, 0] as const;
    const halfCoveredEdge = [halfBlend, quarterEdgeBlend, halfBlend] as const;
    const columnX = 20;
    const nearEdgeY = 49;
    const farEdgeY = 79;
    const interiorY = 60;
    const justBeforeNearEdgeY = 48;
    const justPastFarEdgeY = 80;
    const image = renderPixels(onePagePdf("0 0.5 0 rg 10 20.5 30 30 re f"));
    expect(pixelAt(image, columnX, nearEdgeY)).toEqual(halfCoveredEdge);
    expect(pixelAt(image, columnX, farEdgeY)).toEqual(halfCoveredEdge);
    expect(pixelAt(image, columnX, interiorY)).toEqual(halfIntensityGreen);
    expect(pixelAt(image, columnX, justBeforeNearEdgeY)).toEqual(WHITE);
    expect(pixelAt(image, columnX, justPastFarEdgeY)).toEqual(WHITE);
  });

  it("paints nothing for a rect whose own width or height is negative", () => {
    // widthPx < 0 (or heightPx < 0) makes xPx + widthPx fall short of xPx itself; the clamp collapses this to an exact zero-width (or zero-height) interval rather than an inverted one, so the whole op paints nothing rather than something in the wrong place.
    const pageSize = 20;
    const rgbChannelCount = 3;
    const rasteriser = new CpuRasteriser();
    rasteriser.beginPage(pageGeometry(pageSize, pageSize));
    rasteriser.draw({
      kind: "fillRect",
      xPx: 15,
      yPx: 5,
      widthPx: -10,
      heightPx: 5,
      color: { r: 0, g: 0, b: 0 },
    });
    rasteriser.draw({
      kind: "fillRect",
      xPx: 5,
      yPx: 15,
      widthPx: 5,
      heightPx: -10,
      color: { r: 0, g: 0, b: 0 },
    });
    const image = decodePng(rasteriser.finish());
    expect(image.data).toEqual(
      new Uint8Array(pageSize * pageSize * rgbChannelCount).fill(WHITE[0]),
    );
  });

  it("clamps a rect straddling the page edge instead of painting outside the canvas", () => {
    // Page rect (-10, -10)-(20, 20) straddles the bottom-left corner: device y 80..110 clamps to 80..100, x -10..20 clamps to 0..20.
    const image = renderPixels(onePagePdf("0 0 0 rg -10 -10 30 30 re f"));
    const clampedLeft = 0;
    const clampedBottom = 80;
    const clampedRight = 19;
    const clampedTop = 99;
    expect(pixelAt(image, clampedLeft, clampedBottom)).toEqual(BLACK);
    expect(pixelAt(image, clampedRight, clampedTop)).toEqual(BLACK);
    expect(pixelAt(image, clampedLeft, clampedBottom - 1)).toEqual(WHITE);
    expect(pixelAt(image, clampedRight + 1, clampedBottom)).toEqual(WHITE);
  });

  it("renders an empty page as an exactly all-white canvas", () => {
    const rgbChannelCount = 3;
    const image = renderPixels(onePagePdf(""));
    expect(image.data).toEqual(
      new Uint8Array(image.width * image.height * rgbChannelCount).fill(
        WHITE[0],
      ),
    );
  });
});

// --- Determinism: the same draw ops produce byte-identical PNGs. ---

describe("deterministic output", () => {
  const content =
    "1 0 0 rg 10 20 30 40 re f 0 0 0 RG 2 w 10 10 m 90 10 l S 0 0 0 rg 100 10 m 130 10 l 115 40 l h f";
  const pageWidthPt = 200;
  const pageHeightPt = 100;

  it("produces byte-identical PNGs across renders", () => {
    const first = drive(onePagePdf(content), 0, {});
    const second = drive(onePagePdf(content), 0, {});
    expect([...second]).toEqual([...first]);
  });

  it("emits a real PNG file whose decoded dimensions are the page geometry", () => {
    // PNG's own file signature: a byte with the high bit set, then "PNG".
    const pngSignatureHighBitMarker = 0x89;
    const png = drive(onePagePdf(content), 0, {});
    expect(png[0]).toBe(pngSignatureHighBitMarker);
    expect(png[1]).toBe("P".charCodeAt(0));
    expect(png[2]).toBe("N".charCodeAt(0));
    expect(png[3]).toBe("G".charCodeAt(0));
    const image = decodePng(png);
    expect(image.width).toBe(pageWidthPt);
    expect(image.height).toBe(pageHeightPt);
  });

  it("scales the canvas by the requested factor", () => {
    const scaleFactor = 2;
    const scaled = renderPixels(onePagePdf(content), { scale: scaleFactor });
    expect(scaled.width).toBe(pageWidthPt * scaleFactor);
    expect(scaled.height).toBe(pageHeightPt * scaleFactor);
  });
});

// --- Path fills through the scanline coverage pass. ---

describe("path fill pixels", () => {
  it("keeps a same-wound inner ring filled under nonzero and holed under evenodd", () => {
    // Two concentric rects in one path, same winding direction: nonzero fills the inner ring too (winding 2 is still nonzero); evenodd (f*) cuts it out as a hole. Page y 10..70 -> device y 30..90, so the sampled interior points flip accordingly.
    const outerRingSampleX = 15;
    const outerRingSampleY = 85;
    const innerRingSampleX = 40;
    const innerRingSampleY = 60;
    const nonzero = renderPixels(
      onePagePdf("0 0 0 rg 10 10 60 60 re 20 20 40 40 re f"),
    );
    expect(pixelAt(nonzero, outerRingSampleX, outerRingSampleY)).toEqual(BLACK);
    expect(pixelAt(nonzero, innerRingSampleX, innerRingSampleY)).toEqual(BLACK);
    const evenodd = renderPixels(
      onePagePdf("0 0 0 rg 10 10 60 60 re 20 20 40 40 re f*"),
    );
    expect(pixelAt(evenodd, outerRingSampleX, outerRingSampleY)).toEqual(BLACK);
    expect(pixelAt(evenodd, innerRingSampleX, innerRingSampleY)).toEqual(WHITE);
    const nearOuterEdgeX = 21;
    const nearOuterEdgeY = 79;
    const farOuterEdgeX = 59;
    const farOuterEdgeY = 41;
    expect(pixelAt(evenodd, nearOuterEdgeX, nearOuterEdgeY)).toEqual(WHITE);
    expect(pixelAt(evenodd, farOuterEdgeX, farOuterEdgeY)).toEqual(WHITE);
  });

  it("fills an open subpath as implicitly closed", () => {
    // A triangle with no h before f: the port's fill semantics treat the open subpath as closed.
    const image = renderPixels(
      onePagePdf("0 0 0 rg 100 10 m 130 10 l 115 40 l f"),
    );
    // Device space: page y 10..40 -> device y 60..90; the triangle's interior centrecolumn is at device x ~115.
    const centreColumn = 115;
    const insideRowY = 75;
    const aboveTriangleY = 55;
    const leftOfTriangleX = 90;
    expect(pixelAt(image, centreColumn, insideRowY)).toEqual(BLACK);
    expect(pixelAt(image, centreColumn, aboveTriangleY)).toEqual(WHITE);
    expect(pixelAt(image, leftOfTriangleX, insideRowY)).toEqual(WHITE);
  });

  it("fills a four-cubic ellipse at its centre and not outside it", () => {
    const k = 0.5523;
    const cy = 40;
    const cx = 70;
    const rx = 30;
    const ry = 20;
    const content = [
      "0 0 0 rg",
      `${cx + rx} ${cy} m`,
      `${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry} c`,
      `${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy} c`,
      `${cx - rx * k} ${cy - ry} ${cx - rx} ${cy - ry * k} ${cx} ${cy - ry} c`,
      `${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy} c`,
      "h f",
    ].join("\n");
    const image = renderPixels(onePagePdf(content));
    // Centre page (cx, cy) -> device (cx, deviceCentreY); a point outside the ellipse's shorter radius (above its own top) stays white, as do points well outside either radius to the left and right.
    const deviceCentreY = 60;
    const aboveEllipseTop = 38;
    const leftOfEllipse = 38;
    const rightOfEllipse = 102;
    expect(pixelAt(image, cx, deviceCentreY)).toEqual(BLACK);
    expect(pixelAt(image, cx, aboveEllipseTop)).toEqual(WHITE);
    expect(pixelAt(image, leftOfEllipse, deviceCentreY)).toEqual(WHITE);
    expect(pixelAt(image, rightOfEllipse, deviceCentreY)).toEqual(WHITE);
  });

  it("antialiases a fill edge at the 1/16 coverage quantum", () => {
    // A triangle whose diagonal edge crosses pixel columns at a non-half fraction: coverage steps by 1/16 per subsample, so some boundary column holds a strictly intermediate blend. Pinning that an intermediate value exists (rather than one exact value) keeps this robust to flattening while still proving supersampling happened.
    const regionX0 = 10;
    const regionY0 = 20;
    const regionX1 = 90;
    const regionY1 = 85;
    const minIntermediateCount = 10;
    const whiteChannel = WHITE[0];
    const image = renderPixels(
      onePagePdf("0 0 0 rg 10 10 m 100 10 l 10 90 l h f"),
    );
    const intermediates = regionAll(
      image,
      regionX0,
      regionY0,
      regionX1,
      regionY1,
    ).filter(
      ([r, g, b]) => r !== 0 && r !== whiteChannel && g === r && b === r,
    );
    expect(intermediates.length).toBeGreaterThan(minIntermediateCount);
    // Every intermediate value must be a multiple of the coverage quantum over black-and-white: whiteChannel * k / COVERAGE_DENOMINATOR rounded.
    const roundingTolerance = 8;
    for (const [r] of intermediates) {
      const expected = Math.round(
        (whiteChannel * Math.round((r / whiteChannel) * COVERAGE_DENOMINATOR)) /
          COVERAGE_DENOMINATOR,
      );
      expect(Math.abs(r - expected)).toBeLessThanOrEqual(roundingTolerance);
    }
  });
});

// --- Strokes: quads, joins, dashes, and the zero-width clamp. ---

describe("stroke pixels", () => {
  const midLine = 50;
  const topRow = 89;
  const bottomRow = 90;

  it("paints a 2pt horizontal line as exactly its two centred device rows", () => {
    // Page y 10 -> device y 90; half-width 1 puts the band over device rows 89 and 90 exactly.
    const image = renderPixels(onePagePdf("0 0 0 RG 2 w 10 10 m 90 10 l S"));
    expect(pixelAt(image, midLine, topRow)).toEqual(BLACK);
    expect(pixelAt(image, midLine, bottomRow)).toEqual(BLACK);
    expect(pixelAt(image, midLine, topRow - 1)).toEqual(WHITE);
    expect(pixelAt(image, midLine, bottomRow + 1)).toEqual(WHITE);
    const justBeforeStart = 9;
    const justBeforeEnd = 89;
    const justPastEnd = 90;
    expect(pixelAt(image, justBeforeStart, topRow)).toEqual(WHITE); // butt cap: nothing before the start point
    expect(pixelAt(image, justBeforeEnd, topRow)).toEqual(BLACK); // ...and nothing past the end point
    expect(pixelAt(image, justPastEnd, topRow)).toEqual(WHITE);
  });

  it("miters an L-corner so the outer corner quadrant is fully covered", () => {
    // Vertical up then horizontal right, corner at page (10, 60) -> device (10, 40): the miter wedge must fill the outer quadrant device x [9,10) x y [39,40) completely, and the inner overlap quadrant [10,11) x [40,41) is covered by the quads themselves.
    const outerX = 9;
    const outerY = 39;
    const innerX = 10;
    const innerY = 40;
    const image = renderPixels(
      onePagePdf("0 0 0 RG 2 w 10 10 m 10 60 l 60 60 l S"),
    );
    expect(pixelAt(image, outerX, outerY)).toEqual(BLACK);
    expect(pixelAt(image, innerX, innerY)).toEqual(BLACK);
    expect(pixelAt(image, outerX, outerY - 1)).toEqual(WHITE);
    expect(pixelAt(image, outerX - 1, outerY)).toEqual(WHITE);
  });

  it("dashes with the pattern's on/off lengths", () => {
    const row = 20;
    const firstOnSample = 12;
    const firstOffSample = 19;
    const secondOnSample = 24;
    const image = renderPixels(
      onePagePdf("[6 6] 0 d 2 w 0 0 0 RG 10 80 m 190 80 l S"),
    );
    expect(pixelAt(image, firstOnSample, row)).toEqual(BLACK); // first on run: x 10..16
    expect(pixelAt(image, firstOffSample, row)).toEqual(WHITE); // first off run: x 16..22
    expect(pixelAt(image, secondOnSample, row)).toEqual(BLACK); // second on run: x 22..28
  });

  it("clamps a zero-width stroke to one device pixel", () => {
    // "the thinnest possible width" (ISO 32000-1 8.4.3.2): a 1px band centred on device row 89.5 covers rows 89 and 90 at half coverage each, 128 grey on both, white beyond.
    const halfBlend = 128;
    const halfCoverage = [halfBlend, halfBlend, halfBlend] as const;
    const image = renderPixels(onePagePdf("0 0 0 RG 0 w 10 10 m 90 10 l S"));
    expect(pixelAt(image, midLine, topRow)).toEqual(halfCoverage);
    expect(pixelAt(image, midLine, bottomRow)).toEqual(halfCoverage);
    expect(pixelAt(image, midLine, topRow - 1)).toEqual(WHITE);
    expect(pixelAt(image, midLine, bottomRow + 1)).toEqual(WHITE);
  });
});

// --- Images: bilinear sampling under the placement quad's coverage. ---

describe("image pixels", () => {
  function imageXobjectPdf(cm: string): Uint8Array<ArrayBuffer> {
    // A 2x2 FlateDecode RGB XObject: row 0 red/green, row 1 blue/white.
    const pixels = new Uint8Array([...RED, ...GREEN, ...BLUE, ...WHITE]);
    const catalogObj = 1;
    const pagesObj = 2;
    const pageObj = 3;
    const contentObj = 5;
    const imageObj = 6;
    const b = new SmallFixture();
    b.object(catalogObj, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(pagesObj, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      pageObj,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /XObject << /Im0 6 0 R >> >> /Contents 5 0 R >>",
    );
    b.stream(contentObj, "<< >>", enc(`q ${cm} /Im0 Do Q`));
    b.stream(
      imageObj,
      "<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>",
      deflate(pixels),
    );
    return b.classicXrefAndTrailer(imageObj, "/Root 1 0 R");
  }

  it("copies a 1:1 placement exactly: destination centres land on texel centres", () => {
    // 2x2 source placed at 2x2 device pixels, page rect (10, 60)-(12, 62) -> device (10, 38)-(12, 40): row 38 is the image's own top row.
    const left = 10;
    const right = 11;
    const topRow = 38;
    const bottomRow = 39;
    const image = renderPixels(imageXobjectPdf("2 0 0 2 10 60 cm"));
    expect(pixelAt(image, left, topRow)).toEqual(RED);
    expect(pixelAt(image, right, topRow)).toEqual(GREEN);
    expect(pixelAt(image, left, bottomRow)).toEqual(BLUE);
    expect(pixelAt(image, right, bottomRow)).toEqual(WHITE);
    expect(pixelAt(image, right + 1, topRow)).toEqual(WHITE);
    expect(pixelAt(image, left, bottomRow + 1)).toEqual(WHITE);
  });

  it("samples the edge texels exactly at a 40x20 placement's corners", () => {
    // Page rect (10, 60)-(50, 80) -> device (10, 20)-(50, 40): corner pixel centres clamp to the corner texels; the exact centre lands strictly between all four.
    const leftEdge = 10;
    const rightEdge = 49;
    const topRow = 20;
    const bottomRow = 39;
    const image = renderPixels(imageXobjectPdf("40 0 0 20 10 60 cm"));
    expect(pixelAt(image, leftEdge, topRow)).toEqual(RED);
    expect(pixelAt(image, rightEdge, topRow)).toEqual(GREEN);
    expect(pixelAt(image, leftEdge, bottomRow)).toEqual(BLUE);
    expect(pixelAt(image, rightEdge, bottomRow)).toEqual(WHITE);
    const centreX = 30;
    const centreY = 30;
    const centre = pixelAt(image, centreX, centreY);
    // The bilinear formula, spelled out: u/v are the centre's own fractional position across the 2x2 red/green/blue/white texels.
    const sampleU = 0.5125;
    const sampleV = 0.525;
    const texelCount = 2;
    const texelCentreOffset = 0.5;
    const fx = sampleU * texelCount - texelCentreOffset;
    const fy = sampleV * texelCount - texelCentreOffset;
    const lerp = (t0: number, t1: number, f: number): number =>
      t0 + (t1 - t0) * f;
    const corners: readonly (readonly [number, number, number])[] = [
      RED,
      GREEN,
      BLUE,
      WHITE,
    ];
    const channels = [0, 1, 2] as const;
    const expected = channels.map((channel) => {
      const [c0, c1, c2, c3] = corners;
      if (
        c0 === undefined ||
        c1 === undefined ||
        c2 === undefined ||
        c3 === undefined
      ) {
        throw new Error("fixture setup: corner list incomplete");
      }
      return Math.round(
        lerp(
          lerp(c0[channel], c1[channel], fx),
          lerp(c2[channel], c3[channel], fx),
          fy,
        ),
      );
    });
    expect([...centre]).toEqual(expected);
  });

  it("declines a JPEG image by name and still renders the rest of the page", () => {
    // SOI + SOF0 (1x1, 1 component, no sampling) + EOI: enough for the port's own JPEG recovery (a marker scan), and never decoded here.
    const markerPrefix = 0xff;
    const soiMarker = 0xd8;
    const eoiMarker = 0xd9;
    const sof0Marker = 0xc0;
    // Segment length (2, BE) + precision(1) + height(2, BE) + width(2, BE) + Nf(1) + one component descriptor(3): 11 bytes total, not counting the marker itself.
    const segmentLengthHigh = 0x00;
    const segmentLengthLow = 0x0b;
    const precision = 0x08;
    const heightHigh = 0x00;
    const heightLow = 0x01;
    const widthHigh = 0x00;
    const widthLow = 0x01;
    const componentCount = 0x01;
    // One component: id 1, sampling factors 0x11 (1h, 1v), quantisation table 0.
    const componentId = 0x01;
    const samplingFactors = 0x11;
    const quantTableId = 0x00;
    const jpeg = new Uint8Array([
      markerPrefix,
      soiMarker,
      markerPrefix,
      sof0Marker,
      segmentLengthHigh,
      segmentLengthLow,
      precision,
      heightHigh,
      heightLow,
      widthHigh,
      widthLow,
      componentCount,
      componentId,
      samplingFactors,
      quantTableId,
      markerPrefix,
      eoiMarker,
    ]);
    const catalogObj = 1;
    const pagesObj = 2;
    const pageObj = 3;
    const contentObj = 5;
    const imageObj = 6;
    const b = new SmallFixture();
    b.object(catalogObj, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(pagesObj, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      pageObj,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /XObject << /Im0 6 0 R >> >> /Contents 5 0 R >>",
    );
    b.stream(
      contentObj,
      "<< >>",
      enc("0 0 0 rg 10 10 30 10 re f q 20 0 0 20 100 40 cm /Im0 Do Q"),
    );
    b.stream(
      imageObj,
      "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>",
      jpeg,
    );
    const bytes = b.classicXrefAndTrailer(imageObj, "/Root 1 0 R");

    const diagnostics: RasterCpuDiagnostic[] = [];
    const image = decodePng(
      drive(
        bytes,
        0,
        {},
        {
          onDiagnostic: (d) => {
            diagnostics.push(d);
          },
        },
      ),
    );
    expect(diagnostics.map((d) => d.code)).toEqual([
      "raster-cpu/jpeg-image-undecoded",
    ]);
    // The rect on the same page still painted (page y 10..20 -> device rows 80..90); the image's placement area stayed white.
    const rectSampleX = 25;
    const rectSampleY = 85;
    const imagePlacementX = 110;
    const imagePlacementY = 40;
    expect(pixelAt(image, rectSampleX, rectSampleY)).toEqual(BLACK);
    expect(pixelAt(image, imagePlacementX, imagePlacementY)).toEqual(WHITE);
  });
});

// --- Text: real embedded sfnt outlines to real pixels, via the writer's own dominant font shape. ---

describe("text pixels through embedded outlines", () => {
  function calibriTextPdf(): Uint8Array<ArrayBuffer> {
    return writePdf(
      {
        formatVersion: 1,
        metadata: {},
        images: {},
        pages: [
          {
            widthPt: 200,
            heightPt: 100,
            items: [
              {
                kind: "text",
                text: "H",
                xPt: 20,
                yPt: 50,
                font: { family: "Calibri", weight: "normal", style: "normal" },
                sizePt: 24,
                color: { r: 0, g: 0, b: 0 },
              },
            ],
          },
        ],
      },
      { fonts: createFontRegistry() },
    );
  }

  it("renders glyph ink between baseline and cap height, and nothing elsewhere", () => {
    const pageWidthPt = 200;
    const pageHeightPt = 100;
    const halfIntensity = 128;
    const minInkCount = 20;
    const image = renderPixels(calibriTextPdf());
    // Baseline at page y 50 -> device row 50; cap height at 24pt is roughly 17pt, so ink lives in device rows ~33..50 and columns ~20..37.
    const inkRegion = { x0: 18, y0: 30, x1: 40, y1: 52 };
    const ink = regionAll(
      image,
      inkRegion.x0,
      inkRegion.y0,
      inkRegion.x1,
      inkRegion.y1,
    ).filter(([r]) => r < halfIntensity);
    expect(ink.length).toBeGreaterThan(minInkCount);
    // Above the cap, below the baseline, and either side of the glyph: white.
    const aboveCap = { x0: 0, y0: 0, x1: pageWidthPt, y1: 25 };
    const belowBaseline = { x0: 0, y0: 55, x1: pageWidthPt, y1: pageHeightPt };
    const leftOfGlyph = { x0: 0, y0: 25, x1: 15, y1: 55 };
    const rightOfGlyph = { x0: 45, y0: 25, x1: pageWidthPt, y1: 55 };
    const whiteRegion = (
      r: Readonly<{
        x0: number;
        y0: number;
        x1: number;
        y1: number;
      }>,
    ): readonly (readonly [number, number, number])[] =>
      Array<readonly [number, number, number]>(
        (r.x1 - r.x0) * (r.y1 - r.y0),
      ).fill(WHITE);
    expect(
      regionAll(image, aboveCap.x0, aboveCap.y0, aboveCap.x1, aboveCap.y1),
    ).toEqual(whiteRegion(aboveCap));
    expect(
      regionAll(
        image,
        belowBaseline.x0,
        belowBaseline.y0,
        belowBaseline.x1,
        belowBaseline.y1,
      ),
    ).toEqual(whiteRegion(belowBaseline));
    expect(
      regionAll(
        image,
        leftOfGlyph.x0,
        leftOfGlyph.y0,
        leftOfGlyph.x1,
        leftOfGlyph.y1,
      ),
    ).toEqual(whiteRegion(leftOfGlyph));
    expect(
      regionAll(
        image,
        rightOfGlyph.x0,
        rightOfGlyph.y0,
        rightOfGlyph.x1,
        rightOfGlyph.y1,
      ),
    ).toEqual(whiteRegion(rightOfGlyph));
  });

  it("doubles the ink bounding box at scale 2", () => {
    const scaleFactor = 2;
    const roundingTolerancePx = 1;
    const one = renderPixels(calibriTextPdf());
    const two = renderPixels(calibriTextPdf(), { scale: scaleFactor });
    expect(two.width).toBe(scaleFactor * one.width);
    expect(two.height).toBe(scaleFactor * one.height);
    const box1 = inkBounds(one);
    const box2 = inkBounds(two);
    expect(box2.minX).toBeGreaterThanOrEqual(
      scaleFactor * box1.minX - roundingTolerancePx,
    );
    expect(box2.minX).toBeLessThanOrEqual(
      scaleFactor * box1.minX + roundingTolerancePx,
    );
    expect(box2.maxX).toBeGreaterThanOrEqual(
      scaleFactor * box1.maxX - roundingTolerancePx,
    );
    expect(box2.maxX).toBeLessThanOrEqual(
      scaleFactor * box1.maxX + roundingTolerancePx,
    );
    expect(box2.minY).toBeGreaterThanOrEqual(
      scaleFactor * box1.minY - roundingTolerancePx,
    );
    expect(box2.minY).toBeLessThanOrEqual(
      scaleFactor * box1.minY + roundingTolerancePx,
    );
    expect(box2.maxY).toBeGreaterThanOrEqual(
      scaleFactor * box1.maxY - roundingTolerancePx,
    );
    expect(box2.maxY).toBeLessThanOrEqual(
      scaleFactor * box1.maxY + roundingTolerancePx,
    );
  });

  it("renders just the clip region, re-origined at its own top-left", () => {
    const clipWidthPt = 30;
    const clipHeightPt = 30;
    const halfIntensity = 128;
    const minInkCount = 10;
    const topBandHeight = 6;
    const image = renderPixels(calibriTextPdf(), {
      clipPt: {
        xPt: 15,
        yPt: 45,
        widthPt: clipWidthPt,
        heightPt: clipHeightPt,
      },
    });
    expect(image.width).toBe(clipWidthPt);
    expect(image.height).toBe(clipHeightPt);
    const ink = regionAll(image, 0, 0, clipWidthPt, clipHeightPt).filter(
      ([r]) => r < halfIntensity,
    );
    expect(ink.length).toBeGreaterThan(minInkCount);
    // The clip band sits between device rows 25..55 globally, so every ink pixel's own rows here come from that band, and the band's first rows (above cap height inside the clip) stay white.
    expect(regionAll(image, 0, 0, clipWidthPt, topBandHeight)).toEqual(
      Array(clipWidthPt * topBandHeight).fill(WHITE),
    );
  });
});
