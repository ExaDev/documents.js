import { crc32, decodePng, encodePng } from "byte-codec";
import type { RawImage } from "byte-codec";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterFillRectOp,
  RasterImageOp,
  RasterMatrix,
  RasterPageGeometry,
  RasterPathOp,
} from "pdf-codec/raster";
import { COVERAGE_DENOMINATOR, CoverageMask } from "./coverage";
import type { Pt } from "./geometry";
import { flattenSubpath, strokeOutlinePolygons } from "./stroke";

// The pure-software reference backend for pdf-codec's PageRasteriser port: a colour canvas (three opaque bytes per pixel) painted by scanline coverage with 4x4 supersampling and encoded to PNG by byte-codec at finish. No canvas API, no DOM, no node:* builtins, no network, and nothing beyond arithmetic on the draw ops themselves -- so it runs identically under Node, a browser Worker, and workerd, which the workerd suite pins. It is the port's reference consumer: correct and deterministic first, fast second (a page of text at 300 dpi is seconds, not milliseconds; a runtime with a real canvas supplies its own backend through the same port).

// The one capability boundary this backend states up front: JPEG image ops are declined by name rather than drawn. byte-codec, this package's only image decoder, decodes PNG and reads JPEG metadata but carries no DCT decoder, and re-encoding or approximating a JPEG's pixels would be a silent misrender -- so the placement is skipped, the diagnostic says why, and a consumer that wants the scan's own pixels still has them through the port's op (or readPdf's image recovery). A canvas-owning backend draws these natively instead.
export interface RasterCpuDiagnostic {
  readonly code: "raster-cpu/jpeg-image-undecoded";
  readonly message: string;
}

export interface CpuRasteriserOptions {
  // Receives this backend's own capability refusals (a JPEG image op). Absent means the refusal is silent -- the page still renders around the skipped placement either way; the callback is for consumers that surface such gaps alongside pdf-codec's own sink diagnostics.
  readonly onDiagnostic?: (diagnostic: RasterCpuDiagnostic) => void;
}

export function createCpuRasteriser(
  options: CpuRasteriserOptions = {},
): PageRasteriser {
  return new CpuRasteriser(options);
}

// An sRGB colour in the 0..1 floats every draw op carries (document-schema.js's Color); named structurally so this package adds no dependency on the schema package for one lerp's sake.
export interface UnitRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface PageBuffers {
  readonly geometry: RasterPageGeometry;
  readonly canvas: Uint8Array<ArrayBuffer>;
  readonly mask: CoverageMask;
}

export class CpuRasteriser implements PageRasteriser {
  private readonly onDiagnostic:
    ((diagnostic: RasterCpuDiagnostic) => void) | undefined;
  private buffers: PageBuffers | undefined;
  private readonly decodedImages = new Map<string, RawImage>();

  constructor(options: CpuRasteriserOptions = {}) {
    this.onDiagnostic = options.onDiagnostic;
  }

  // One instance renders any number of pages sequentially: each beginPage re-clears the canvas to opaque white (what a viewer shows behind a page; the port deliberately specifies no background, leaving it to the backend) and forgets the previous page's image-decode cache.
  beginPage(geometry: RasterPageGeometry): void {
    this.buffers = {
      geometry,
      canvas: new Uint8Array(geometry.widthPx * geometry.heightPx * 3).fill(
        255,
      ),
      mask: new CoverageMask(geometry.widthPx, geometry.heightPx),
    };
    this.decodedImages.clear();
  }

  // Exposed purely so rasteriser.test.ts can pin the image-decode cache's own behaviour directly (populated on first decode, reused on a repeat, forgotten between pages) -- the same pattern colourBytes/quadCorners/invertMatrix/sampleBilinear below already use for their own arithmetic, needed here because decodePng's own purity means no rendered pixel can ever distinguish a cache hit, a fresh re-decode, or a retained-past-its-page entry from one another.
  decodedImageForTesting(bytes: Uint8Array<ArrayBuffer>): RawImage | undefined {
    return this.decodedImages.get(decodeCacheKey(bytes));
  }

  draw(op: RasterDrawOp): void {
    if (op.kind === "fillRect") {
      this.fillRectOp(op);
      return;
    }
    if (op.kind === "path") {
      this.pathOp(op);
      return;
    }
    this.imageOp(op);
  }

  finish(): Uint8Array<ArrayBuffer> {
    const { geometry, canvas } = this.requirePage("finish");
    // The alpha channel needs no encoding pass: the canvas starts opaque white and every composite is source-over onto an opaque base, so alpha is identically 1 and the PNG carries colour alone.
    const png = encodePng({
      width: geometry.widthPx,
      height: geometry.heightPx,
      channels: 3,
      data: canvas,
    });
    this.buffers = undefined;
    return png;
  }

  private requirePage(operation: string): PageBuffers {
    if (this.buffers === undefined) {
      throw new Error(
        `CpuRasteriser.${operation}() was called before beginPage(); renderPdfPage (or the caller) drives one page at a time through beginPage, draw..., finish`,
      );
    }
    return this.buffers;
  }

  // --- fillRect: analytic coverage. The port's most common op gets the exact treatment rather than the sampled one: for an axis-aligned rectangle, each pixel's covered fraction is the product of its x and y edge overlaps, computable in closed form. Crisp table rules fall on integer boundaries and paint whole pixels; fractional edges get exact fractional blends -- slightly more accurate than a supersample could state, and never less.
  private fillRectOp(op: RasterFillRectOp): void {
    const { geometry, canvas } = this.requirePage("draw");
    const left = Math.max(op.xPx, 0);
    const top = Math.max(op.yPx, 0);
    // Clamped up to left/top, not merely down to the canvas's own far edge, so right >= left and bottom >= top always hold -- a rect that starts past the canvas, or one whose own width/height is zero or negative, collapses to an exact zero-width or zero-height interval here rather than an inverted one, with no separate degenerate-input guard needed below.
    const right = Math.max(
      Math.min(op.xPx + op.widthPx, geometry.widthPx),
      left,
    );
    const bottom = Math.max(
      Math.min(op.yPx + op.heightPx, geometry.heightPx),
      top,
    );
    const colour = colourBytes(op.color);
    const columnStart = Math.floor(left);
    const columnEnd = Math.ceil(right);
    const rowStart = Math.floor(top);
    const rowEnd = Math.ceil(bottom);
    for (let row = rowStart; row < rowEnd; row++) {
      const coverageY = pixelOverlap(row, top, bottom);
      const rowBase = row * geometry.widthPx;
      for (let column = columnStart; column < columnEnd; column++) {
        const coverage = coverageY * pixelOverlap(column, left, right);
        this.blendPixel(canvas, rowBase + column, colour, coverage);
      }
    }
  }

  // --- path: fill and/or stroke, one coverage pass each, painted fill-then-stroke (PDF's own paint order for a combined fill-and-stroke operator).
  private pathOp(op: RasterPathOp): void {
    const { canvas, mask } = this.requirePage("draw");
    const flattened = op.subpaths.map(flattenSubpath);
    if (op.fill !== undefined) {
      // Every subpath is a polygon, open ones implicitly closed by the scanline walk itself.
      const polygons = flattened
        .map((subpath) => subpath.points)
        .filter((points) => points.length >= 3);
      mask.reset();
      mask.fillPolygons(polygons, op.fill.fillRule);
      this.blendMask(canvas, mask, op.fill.color);
    }
    if (op.stroke !== undefined) {
      const polygons = strokeOutlinePolygons(
        flattened,
        op.stroke.widthPx,
        op.stroke.dashPx,
      );
      mask.reset();
      mask.fillPolygons(polygons, "nonzero");
      this.blendMask(canvas, mask, op.stroke.color);
    }
  }

  // --- image: bilinear sampling under the placement quad's own coverage, so a rotated placement antialiases exactly like every other edge this backend paints. The pixel walk is bounded by the quad's bounding box -- the coverage mask is empty everywhere outside it.
  private imageOp(op: RasterImageOp): void {
    const { geometry, canvas, mask } = this.requirePage("draw");
    if (op.format === "jpeg") {
      this.onDiagnostic?.({
        code: "raster-cpu/jpeg-image-undecoded",
        message:
          "a JPEG (DCTDecode) image placement was not drawn: this backend decodes PNG images only (byte-codec has no DCT decoder), and approximating the scan's pixels would misrender it; the op's bytes remain available to the caller through the port",
      });
      return;
    }
    const source = this.decodeCached(op.bytes);
    const quad = quadCorners(op.matrix);
    mask.reset();
    mask.fillPolygons([quad], "nonzero");
    const inverse = invertMatrix(op.matrix);
    // The linear pixel-index range this one fillPolygons call actually marked, rather than a hand-computed bounding box over the quad's own corners: markedRange() reflects the fill pass's real output, so there is no separately-derived bound that could disagree with it, and the loop below is the same range-walk blendMask uses for a fill or stroke's own mask. No samples-zero skip inside the range: this.blendPixel at alpha 0 leaves the destination byte exactly as it was (bg + (fg - bg) * 0 rounds back to the same already-integer bg), so a gap pixel between two marked spans costs a wasted call, never a wrong one.
    const { first, last } = mask.markedRange();
    for (let i = first; i <= last; i++) {
      const samples = mask.countAt(i);
      const row = Math.floor(i / geometry.widthPx);
      const column = i % geometry.widthPx;
      const [u, v] = inverse(column + 0.5, row + 0.5);
      const [r, g, b, a] = sampleBilinear(source, u, v);
      this.blendPixel(
        canvas,
        i,
        { r, g, b },
        (samples / COVERAGE_DENOMINATOR) * a,
      );
    }
  }

  // The port may hand the same image bytes repeatedly (one XObject drawn for every stamp of a logo); PNG decoding is this backend's most expensive per-op step, so decoded images are cached by content within the page. crc32 over the bytes plus the byte length is the key -- cheap relative to the decode, and two distinct images colliding on both is not a case a page's own content can produce.
  private decodeCached(bytes: Uint8Array<ArrayBuffer>): RawImage {
    const key = decodeCacheKey(bytes);
    const cached = this.decodedImages.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const decoded = decodePng(bytes);
    this.decodedImages.set(key, decoded);
    return decoded;
  }

  private blendMask(
    canvas: Uint8Array<ArrayBuffer>,
    mask: CoverageMask,
    color: UnitRgb,
  ): void {
    const colour = colourBytes(color);
    const { first, last } = mask.markedRange();
    // No samples-zero skip: this.blendPixel at alpha 0 is a no-op (per fillRectOp's identical reasoning), so a gap pixel between two marked spans costs a wasted call, never a wrong one.
    for (let i = first; i <= last; i++) {
      const samples = mask.countAt(i);
      this.blendPixel(canvas, i, colour, samples / COVERAGE_DENOMINATOR);
    }
  }

  // Source-over of an opaque colour at fractional coverage: out = bg + (fg - bg) * alpha, rounded once per channel. Coverage arrives from the mask (already 0..1) or the analytic rect overlap; colour components arrive as bytes for vector paints and as 0..255 floats for image samples, rounded here identically. The background reads fall back to 0 only on an index the caller's own walk has already bounded -- the same provably-in-bounds arithmetic archive-codec's sector assembly uses.
  private blendPixel(
    canvas: Uint8Array<ArrayBuffer>,
    pixelIndex: number,
    colour: { readonly r: number; readonly g: number; readonly b: number },
    alpha: number,
  ): void {
    const base = pixelIndex * 3;
    canvas[base] = Math.round(
      (canvas[base] ?? 0) + (colour.r - (canvas[base] ?? 0)) * alpha,
    );
    canvas[base + 1] = Math.round(
      (canvas[base + 1] ?? 0) + (colour.g - (canvas[base + 1] ?? 0)) * alpha,
    );
    canvas[base + 2] = Math.round(
      (canvas[base + 2] ?? 0) + (colour.b - (canvas[base + 2] ?? 0)) * alpha,
    );
  }
}

// Exported (from this module only, not from the package's own index) purely so rasteriser.test.ts can pin its arithmetic directly, the same way stroke.test.ts reaches past this package's narrow public surface into dashPolyline.
export function colourBytes(color: UnitRgb): {
  readonly r: number;
  readonly g: number;
  readonly b: number;
} {
  return {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
  };
}

// The image-decode cache key, shared between decodeCached's own lookup/populate and decodedImageForTesting's read-only inspection so the two can never disagree about which entry a given set of bytes maps to.
function decodeCacheKey(bytes: Uint8Array<ArrayBuffer>): string {
  return `${bytes.length}:${crc32(bytes)}`;
}

// The covered fraction of one pixel row (or column) index against the half-open interval [edgeLow, edgeHigh]: the overlap length of [index, index + 1] with it, 0..1. No defensive clamp to a minimum of 0: fillRectOp's own rowStart/rowEnd and columnStart/columnEnd already bound index to the exact range where this difference is non-negative (edgeHigh >= edgeLow is an invariant fillRectOp establishes before computing them), so a clamp here would only ever mask a genuinely wrong caller-side range rather than serve a real input.
function pixelOverlap(
  index: number,
  edgeLow: number,
  edgeHigh: number,
): number {
  return Math.min(index + 1, edgeHigh) - Math.max(index, edgeLow);
}

// The placement quad in device pixels: the port's matrix maps the unit image square (top-left origin, x right, y down) through PDF's [a b c d e f] row-vector convention, so the corners are the images of (0,0), (1,0), (1,1), (0,1) in order -- a quad whatever rotation the placement carries.
export function quadCorners(matrix: RasterMatrix): readonly Pt[] {
  const [a, b, c, d, e, f] = matrix;
  const at = (u: number, v: number): Pt => ({
    x: a * u + c * v + e,
    y: b * u + d * v + f,
  });
  return [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
}

// The placement matrix's inverse as a function from device pixels back to the unit image square. A singular matrix never reaches this arithmetic: it maps the unit square to a zero-area quad, the quad covers no subsamples, and the sampler never runs -- the geometry is the guard, so there is no branch for it here.
export function invertMatrix(
  matrix: RasterMatrix,
): (xPx: number, yPx: number) => readonly [number, number] {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  return (xPx, yPx) => {
    const dx = xPx - e;
    const dy = yPx - f;
    return [(d * dx - c * dy) / determinant, (-b * dx + a * dy) / determinant];
  };
}

// Bilinear sample of the decoded source at unit-square coordinates (u, v), edges clamped: a destination pixel whose centre maps just outside the quad's float fuzz samples the nearest edge texel rather than nothing. The clamp lands on the texel-space coordinate itself (not on the floor of it) so the fractional weights stay within [0, 1) -- clamping only the floor would leave a negative fraction extrapolating past the edge texel instead of pinning to it. Returns 0..255 colour floats and a 0..1 alpha (always 1 for a source with no alpha plane -- the shape PNGs this family's own writers emit).
export function sampleBilinear(
  source: RawImage,
  u: number,
  v: number,
): readonly [number, number, number, number] {
  const clampedU = Math.min(Math.max(u, 0), 1);
  const clampedV = Math.min(Math.max(v, 0), 1);
  const sx = Math.min(
    Math.max(clampedU * source.width - 0.5, 0),
    source.width - 1,
  );
  const sy = Math.min(
    Math.max(clampedV * source.height - 0.5, 0),
    source.height - 1,
  );
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  // No clamp against source.width/height - 1 here: sx is already clamped there, so x0 can never exceed it, and x1 = x0 + 1 only ever reaches an actual out-of-texture column when x0 is exactly that last column -- the one case where fx (sx - x0) is exactly 0, zeroing out whatever sample(x1, ...) reads (a real value in an adjacent row, or the 0 fallback past the array's own end) before it can enter the interpolation below.
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = sx - x0;
  const fy = sy - y0;
  const channelCount = source.channels === 1 ? 1 : 3;
  const sample = (x: number, y: number, channel: number): number => {
    const index = (y * source.width + x) * channelCount + channel;
    return source.data[index] ?? 0;
  };
  const lerpChannel = (channel: number): number => {
    const top0 = sample(x0, y0, channel);
    const top1 = sample(x1, y0, channel);
    const bottom0 = sample(x0, y1, channel);
    const bottom1 = sample(x1, y1, channel);
    const top = top0 + (top1 - top0) * fx;
    const bottom = bottom0 + (bottom1 - bottom0) * fx;
    return top + (bottom - top) * fy;
  };
  let r: number;
  let g: number;
  let b: number;
  if (channelCount === 1) {
    r = lerpChannel(0);
    g = r;
    b = r;
  } else {
    r = lerpChannel(0);
    g = lerpChannel(1);
    b = lerpChannel(2);
  }
  const alpha = source.alpha;
  if (alpha === undefined) {
    return [r, g, b, 1];
  }
  const alphaAt = (x: number, y: number): number =>
    alpha[y * source.width + x] ?? 0;
  const alphaTop = alphaAt(x0, y0) + (alphaAt(x1, y0) - alphaAt(x0, y0)) * fx;
  const alphaBottom =
    alphaAt(x0, y1) + (alphaAt(x1, y1) - alphaAt(x0, y1)) * fx;
  return [r, g, b, (alphaTop + (alphaBottom - alphaTop) * fy) / 255];
}
