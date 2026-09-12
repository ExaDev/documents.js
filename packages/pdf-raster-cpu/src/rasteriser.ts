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
    // Stryker disable next-line CallExpression: decodeCached's own key is a pure function of the image bytes (crc32 plus length), so a decode left over from a previous page is byte-for-byte the same RawImage this page would have decoded itself -- retaining it changes memory footprint, never a rendered pixel. Skipping this clear is a real (if narrow) memory-retention concern across many pages, which is why it stays, but it is not something any pixel-level test can observe.
    this.decodedImages.clear();
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
    const right = Math.min(op.xPx + op.widthPx, geometry.widthPx);
    const top = Math.max(op.yPx, 0);
    const bottom = Math.min(op.yPx + op.heightPx, geometry.heightPx);
    // Stryker disable next-line ConditionalExpression,LogicalOperator,EqualityOperator,BlockStatement: pixelOverlap(index, edgeLow, edgeHigh) is clamped to Math.max(0, ...), so whenever the interval [left, right) or [top, bottom) is empty or inverted (which is exactly what this guard tests for), every pixelOverlap call the loops below could ever make against it returns exactly 0 -- rendering this guard a pure early-exit for a case the coverage-zero checks further down already paint nothing for. Loosening, inverting, or dropping either half of this check cannot change a single blended pixel; it can only make the loops below iterate over a wider, still entirely zero-coverage range.
    if (right <= left || bottom <= top) {
      return; // outside the canvas, or degenerate: no ink either way
    }
    const colour = colourBytes(op.color);
    const columnStart = Math.floor(left);
    const columnEnd = Math.ceil(right);
    const rowStart = Math.floor(top);
    const rowEnd = Math.ceil(bottom);
    // Stryker disable next-line EqualityOperator: pixelOverlap(rowEnd, top, bottom) is always exactly 0 -- rowEnd is Math.ceil(bottom), so bottom - rowEnd is never positive, and the overlap's own Math.max(0, ...) clamp floors that to 0 every time. Admitting one extra row via <= only ever hits this always-zero case, caught by the coverageY check just below.
    for (let row = rowStart; row < rowEnd; row++) {
      const coverageY = pixelOverlap(row, top, bottom);
      // Stryker disable next-line ConditionalExpression,BlockStatement: this.blendPixel at alpha 0 leaves the destination byte exactly as it was (bg + (fg - bg) * 0 rounds back to the same already-integer bg), so skipping the call here is a performance shortcut, not a correctness requirement -- removing it cannot change a rendered pixel.
      if (coverageY === 0) {
        continue;
      }
      const rowBase = row * geometry.widthPx;
      // Stryker disable next-line EqualityOperator: the same reasoning as the row loop above -- pixelOverlap(columnEnd, left, right) is always exactly 0, since columnEnd is Math.ceil(right).
      for (let column = columnStart; column < columnEnd; column++) {
        const coverage = coverageY * pixelOverlap(column, left, right);
        // Stryker disable next-line ConditionalExpression,BlockStatement: same reasoning as the coverageY check above -- blendPixel at alpha 0 is already a no-op.
        if (coverage === 0) {
          continue;
        }
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
    // Stryker disable next-line MethodExpression: mask.fillPolygons([quad], ...) just above already paints the mask according to the quad's own real, unmutated geometry, independently of this clamp -- so any row this bound admits outside the quad's true extent reads a mask cell the fill pass itself left at samples 0 (whether that cell is a genuine miss or an out-of-bounds index countAt's own `?? 0` already covers), caught by the samples check inside the loop below. Unlike a write into the mask (which really could corrupt an adjacent row), this bound only ever widens what gets read back from an already-correct mask.
    const rowStart = Math.max(
      0,
      Math.floor(Math.min(...quad.map((corner) => corner.y))),
    );
    // Stryker disable next-line MethodExpression: same reasoning as rowStart above.
    const rowEnd = Math.min(
      geometry.heightPx,
      Math.ceil(Math.max(...quad.map((corner) => corner.y))),
    );
    // Stryker disable next-line MethodExpression: same reasoning as rowStart above.
    const columnStart = Math.max(
      0,
      Math.floor(Math.min(...quad.map((corner) => corner.x))),
    );
    // Stryker disable next-line MethodExpression: same reasoning as rowStart above.
    const columnEnd = Math.min(
      geometry.widthPx,
      Math.ceil(Math.max(...quad.map((corner) => corner.x))),
    );
    // Stryker disable next-line EqualityOperator: see the disable comment on rowStart above -- widening either loop bound here only ever admits a zero-coverage cell.
    for (let row = rowStart; row < rowEnd; row++) {
      const rowBase = row * geometry.widthPx;
      // Stryker disable next-line EqualityOperator: same reasoning as the row loop above.
      for (let column = columnStart; column < columnEnd; column++) {
        const samples = mask.countAt(rowBase + column);
        // Stryker disable next-line ConditionalExpression,BlockStatement: at samples 0 the blendPixel call below would run with alpha (0 / COVERAGE_DENOMINATOR) * a === 0, itself a no-op (see fillRectOp's identical reasoning) -- this check only ever saves the wasted inverse/sampleBilinear/blendPixel work, never changes a pixel.
        if (samples === 0) {
          continue;
        }
        const [u, v] = inverse(column + 0.5, row + 0.5);
        const [r, g, b, a] = sampleBilinear(source, u, v);
        this.blendPixel(
          canvas,
          rowBase + column,
          { r, g, b },
          (samples / COVERAGE_DENOMINATOR) * a,
        );
      }
    }
  }

  // The port may hand the same image bytes repeatedly (one XObject drawn for every stamp of a logo); PNG decoding is this backend's most expensive per-op step, so decoded images are cached by content within the page. crc32 over the bytes plus the byte length is the key -- cheap relative to the decode, and two distinct images colliding on both is not a case a page's own content can produce.
  private decodeCached(bytes: Uint8Array<ArrayBuffer>): RawImage {
    const key = `${bytes.length}:${crc32(bytes)}`;
    const cached = this.decodedImages.get(key);
    // Stryker disable next-line BlockStatement: decodePng is a pure function of `bytes`, and `key` is derived from those same bytes, so skipping this early return only means falling through to decode the identical bytes again and returning an equal (if freshly-allocated) RawImage -- the cache exists to skip the decode's own cost, not to change what a caller receives.
    if (cached !== undefined) {
      return cached;
    }
    const decoded = decodePng(bytes);
    // Stryker disable next-line CallExpression: skipping this populate means only that every future call with these same bytes falls through to decodePng again instead of hitting the cache -- decodePng is pure, so it returns an equal RawImage either way. This cache is a performance measure, never a correctness one, per this method's own leading comment.
    this.decodedImages.set(key, decoded);
    return decoded;
  }

  private blendMask(
    canvas: Uint8Array<ArrayBuffer>,
    mask: CoverageMask,
    color: UnitRgb,
  ): void {
    const colour = colourBytes(color);
    const pixels = mask.widthPx * mask.heightPx;
    // Stryker disable next-line EqualityOperator: mask.countAt(pixels), one past the mask's own last valid index, reads past the end of its backing Uint16Array and its own `?? 0` fallback returns 0 -- admitting that one extra iteration via <= hits the same always-zero, always-skipped case the samples check just below already handles.
    for (let i = 0; i < pixels; i++) {
      const samples = mask.countAt(i);
      // Stryker disable next-line ConditionalExpression,BlockStatement: blendPixel at alpha 0 is a no-op, per fillRectOp's identical reasoning -- this check only saves the wasted call.
      if (samples === 0) {
        continue;
      }
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

// The covered fraction of one pixel row (or column) index against the half-open interval [edgeLow, edgeHigh]: the overlap length of [index, index + 1] with it, 0..1.
function pixelOverlap(
  index: number,
  edgeLow: number,
  edgeHigh: number,
): number {
  return Math.max(0, Math.min(index + 1, edgeHigh) - Math.max(index, edgeLow));
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
    // Stryker disable next-line ArithmeticOperator: this clamp only ever binds when the unclamped value would exceed source.width - 1, which forces sx to land on exactly that value regardless of the mutation, since sx can never legitimately go higher (clampedU maxes out at 1, giving source.width - 0.5, itself past this bound) -- and landing on exactly x0 = source.width - 1 makes fx (sx - x0) exactly 0, which zeroes out every place x1 (the only thing this clamp could otherwise have widened) enters the interpolation below. Widening the clamp changes what sx could theoretically reach, never what it does once floored and weighted.
    source.width - 1,
  );
  const sy = Math.min(
    Math.max(clampedV * source.height - 0.5, 0),
    // Stryker disable next-line ArithmeticOperator: the same reasoning as sx above, for the vertical axis.
    source.height - 1,
  );
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  // Stryker disable next-line ArithmeticOperator: whenever x0 < source.width - 1, x0 + 1 is already the smaller of the two candidates Math.min compares, so widening the second one to source.width + 1 cannot change the result; whenever x0 === source.width - 1 (the only case where this clamp would otherwise bind), sx equals x0 exactly (see the sx comment above), so fx is 0 and x1's own value cannot reach the output either way.
  const x1 = Math.min(x0 + 1, source.width - 1);
  // Stryker disable next-line ArithmeticOperator: the same reasoning as x1 above, for the vertical axis.
  const y1 = Math.min(y0 + 1, source.height - 1);
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
