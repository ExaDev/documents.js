import { decodePng, encodePng } from "byte-codec";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterImageOp,
  RasterPageGeometry,
  RasterPathOp,
} from "pdf-codec/raster";
import { COVERAGE_DENOMINATOR, CoverageMask } from "../coverage";
import type { FillRule } from "../coverage";
import type { Pt } from "../geometry";
import {
  blendPixel,
  colourBytes,
  invertMatrix,
  quadCorners,
  sampleBilinear,
} from "../rasteriser";
import type { UnitRgb } from "../rasteriser";
import { flattenSubpath, strokeOutlinePolygons } from "../stroke";

// CpuRasteriser's path and image passes as they were before the coverage mask recorded the pixels it marks (ExaDev/documents.js#1720), kept as the reference the differential tests compare CpuRasteriser against. Every coverage pass starts from a mask cleared across the whole canvas, and its blend walks every pixel in the linear index range from the first marked pixel to the last, zero-count pixels included. It shares everything that change left alone (the scanline fill, flattening and stroke outlining, blendPixel and the image sampler), so a difference between the two renders can only come from the clear or the walk.

// fillRect is not part of the comparison: it paints analytically, never through the coverage mask, so it has no clear or walk to differ in.

const RGB_CHANNELS = 3;
const RGB_CHANNEL_MAX = 255;
const MIN_POLYGON_VERTICES = 3;
const PIXEL_CENTER_OFFSET = 0.5;

interface ReferencePage {
  readonly geometry: RasterPageGeometry;
  readonly canvas: Uint8Array<ArrayBuffer>;
}

export class ReferenceRasteriser implements PageRasteriser {
  // The cells the old algorithm clears and walks, counted the way CoverageMask.cellsVisited counts the new one's: a whole canvas per clear, and the full linear range per walk.
  cellsVisited = 0;
  // The pixels each coverage pass actually covered (a nonzero subsample count), summed over the page: the least work any readback of those pixels can do, and exactly what the new algorithm's drain should cost.
  coveredCells = 0;
  private page: ReferencePage | undefined;

  beginPage(geometry: RasterPageGeometry): void {
    this.page = {
      geometry,
      canvas: new Uint8Array(
        geometry.widthPx * geometry.heightPx * RGB_CHANNELS,
      ).fill(RGB_CHANNEL_MAX),
    };
    this.cellsVisited = 0;
    this.coveredCells = 0;
  }

  draw(op: RasterDrawOp): void {
    if (op.kind === "fillRect") {
      throw new Error(
        "ReferenceRasteriser does not paint fillRect: it never touches the coverage mask, so there is nothing to compare",
      );
    }
    if (op.kind === "path") {
      this.pathOp(op);
      return;
    }
    this.imageOp(op);
  }

  finish(): Uint8Array<ArrayBuffer> {
    const { geometry, canvas } = this.requirePage();
    return encodePng({
      width: geometry.widthPx,
      height: geometry.heightPx,
      channels: 3,
      data: canvas,
    });
  }

  private requirePage(): ReferencePage {
    if (this.page === undefined) {
      throw new Error("ReferenceRasteriser drew before beginPage()");
    }
    return this.page;
  }

  private pathOp(op: RasterPathOp): void {
    const flattened = op.subpaths.map(flattenSubpath);
    if (op.fill !== undefined) {
      const polygons = flattened
        .map((subpath) => subpath.points)
        .filter((points) => points.length >= MIN_POLYGON_VERTICES);
      this.blendMask(this.coverage(polygons, op.fill.fillRule), op.fill.color);
    }
    if (op.stroke !== undefined) {
      const polygons = strokeOutlinePolygons(
        flattened,
        op.stroke.widthPx,
        op.stroke.dashPx,
      );
      this.blendMask(this.coverage(polygons, "nonzero"), op.stroke.color);
    }
  }

  private imageOp(op: RasterImageOp): void {
    const { geometry, canvas } = this.requirePage();
    if (op.format === "jpeg") {
      return;
    }
    const source = decodePng(op.bytes);
    const mask = this.coverage([quadCorners(op.matrix)], "nonzero");
    const inverse = invertMatrix(op.matrix);
    const { first, last } = markedRange(mask);
    for (let i = first; i <= last; i++) {
      const row = Math.floor(i / geometry.widthPx);
      const column = i % geometry.widthPx;
      const [u, v] = inverse(
        column + PIXEL_CENTER_OFFSET,
        row + PIXEL_CENTER_OFFSET,
      );
      const [r, g, b, a] = sampleBilinear(source, u, v);
      blendPixel(
        canvas,
        i,
        { r, g, b },
        (mask.countAt(i) / COVERAGE_DENOMINATOR) * a,
      );
    }
    this.cellsVisited += Math.max(last - first + 1, 0);
  }

  private blendMask(mask: CoverageMask, color: UnitRgb): void {
    const { canvas } = this.requirePage();
    const colour = colourBytes(color);
    const { first, last } = markedRange(mask);
    for (let i = first; i <= last; i++) {
      blendPixel(canvas, i, colour, mask.countAt(i) / COVERAGE_DENOMINATOR);
    }
    this.cellsVisited += Math.max(last - first + 1, 0);
  }

  // A mask holding one coverage pass, cleared across the whole canvas first: a freshly allocated mask is exactly the old full clear's result, and counts as that clear's work.
  private coverage(
    polygons: readonly (readonly Pt[])[],
    fillRule: FillRule,
  ): CoverageMask {
    const { geometry } = this.requirePage();
    const mask = new CoverageMask(geometry.widthPx, geometry.heightPx);
    this.cellsVisited += geometry.widthPx * geometry.heightPx;
    mask.fillPolygons(polygons, fillRule);
    const { first, last } = markedRange(mask);
    for (let i = first; i <= last; i++) {
      if (mask.countAt(i) > 0) {
        this.coveredCells++;
      }
    }
    return mask;
  }
}

// The old mask's markedRange(): the inclusive pixel-index range from the first pixel any mark landed in to the last, read here by scanning every count, so it depends on nothing the new mask records about its own marks. Empty (last below first) when nothing was marked.
function markedRange(mask: CoverageMask): {
  readonly first: number;
  readonly last: number;
} {
  const cells = mask.widthPx * mask.heightPx;
  let first = cells;
  let last = -1;
  for (let i = 0; i < cells; i++) {
    if (mask.countAt(i) > 0) {
      first = Math.min(first, i);
      last = i;
    }
  }
  return { first, last };
}
