import { describe, expect, it } from "vitest";
import { BEZIER_KAPPA } from "./matrix";
import { renderPdfPage } from "./raster";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterPageGeometry,
} from "./raster";
import { ByteWriter } from "./bytes/writer";
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
function drive(
  bytes: Uint8Array<ArrayBuffer>,
  pageIndex: number,
  options: Parameters<typeof renderPdfPage>[2],
  rasteriser: RecordingRasteriser,
): Uint8Array<ArrayBuffer> {
  const result = renderPdfPage(bytes, pageIndex, options, rasteriser);
  if (result instanceof Promise) {
    throw new Error("RecordingRasteriser.finish never returns a promise");
  }
  return result;
}

function enc(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

// The same minimal classic-xref shape src/test-support/pdf.ts's FixtureBuilder produces, locally: a header line, objects appended with offset tracking, one or more content streams, and a classic table in which an object number this fixture never wrote takes a free-list entry rather than being required to exist (several fixtures below deliberately leave gaps in the numbering for their font-descriptor chains).
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

  bytes(): Uint8Array<ArrayBuffer> {
    return this.writer.toBytes();
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
          ? "0000000000 00000 f \n" // an object number this fixture never wrote: a legal free entry, so a font chain can leave gaps in the numbering
          : `${offset.toString().padStart(10, "0")} 00000 n \n`,
      );
    }
    this.writer.writeAscii(
      `trailer\n<< /Size ${maxObjNum + 1} ${trailerExtra} >>\nstartxref\n${xrefOffset}\n%%EOF`,
    );
    return this.writer.toBytes();
  }
}

// Repoints a table record past the end of the file, the same technique embedded-font.test.ts's own dropTable uses — parseSfnt drops that one table entirely, exactly as it would for a genuinely truncated font, while every other table (head/maxp/glyf included) stays intact and readable.
// One page, 200 x 100 pt, with the caller's content stream and optional extra entries on the page dict and catalog. Objects 1 (catalog), 2 (pages), 3 (page), 5 (contents) are wired; object 4 is a standard Helvetica font resource so text fixtures have a /Font to select.
function onePagePdf(
  content: string | Uint8Array<ArrayBuffer>,
  options: {
    readonly pageEntries?: string;
    readonly pageResources?: string;
    readonly catalogEntries?: string;
    readonly extraObjects?: readonly (readonly [number, string])[];
  } = {},
): Uint8Array<ArrayBuffer> {
  const b = new SmallFixture();
  b.object(
    1,
    `<< /Type /Catalog /Pages 2 0 R ${options.catalogEntries ?? ""}>>`,
  );
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] ${options.pageResources ?? "/Resources << /Font << /F1 4 0 R >> >>"} /Contents 5 0 R ${options.pageEntries ?? ""}>>`,
  );
  b.object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const [num, body] of options.extraObjects ?? []) {
    b.object(num, body);
  }
  const contentBytes = typeof content === "string" ? enc(content) : content;
  b.stream(5, "<< >>", contentBytes);
  return b.classicXrefAndTrailer(5, "/Root 1 0 R");
}

const isFillRect = (
  op: RasterDrawOp,
): op is Extract<RasterDrawOp, { kind: "fillRect" }> => op.kind === "fillRect";
const isPath = (
  op: RasterDrawOp,
): op is Extract<RasterDrawOp, { kind: "path" }> => op.kind === "path";
// --- The port's geometry contract. ---

describe("renderPdfPage: vector draw ops", () => {
  it("strokes a recovered line with its colour and width", () => {
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("0.25 0.5 0.75 RG 2 w 10 10 m 90 10 l S"),
      0,
      {},
      rasteriser,
    );
    const stroke = rasteriser.ops.find(isPath);
    expect(stroke?.stroke).toEqual({
      color: { r: 0.25, g: 0.5, b: 0.75 },
      widthPx: 2,
    });
    expect(stroke?.subpaths).toEqual([
      {
        startXPx: 10,
        startYPx: 90,
        segments: [{ kind: "line", xPx: 90, yPx: 90 }],
        closed: false,
      },
    ]);
  });

  it("strokes a recovered rect as a closed four-line path, not only fills it", () => {
    // Every existing rect test only fills; drawRect's own stroke branch (a separate rasteriser.draw call building the same corners as a closed path) has no coverage at all otherwise.
    const rasteriser = new RecordingRasteriser();
    drive(onePagePdf("0.1 0.2 0.3 RG 2 w 10 20 30 40 re S"), 0, {}, rasteriser);
    const stroke = rasteriser.ops.find(isPath);
    expect(stroke?.fill).toBeUndefined();
    expect(stroke?.stroke).toEqual({
      color: { r: 0.1, g: 0.2, b: 0.3 },
      widthPx: 2,
    });
    // Rect at page (10,20)-(40,60) -> device top-left (10, 100-60)=(10,40), bottom-right (40, 100-20)=(40,80).
    expect(stroke?.subpaths).toEqual([
      {
        startXPx: 10,
        startYPx: 40,
        segments: [
          { kind: "line", xPx: 40, yPx: 40 },
          { kind: "line", xPx: 40, yPx: 80 },
          { kind: "line", xPx: 10, yPx: 80 },
        ],
        closed: true,
      },
    ]);
  });

  it("strokes a recovered ellipse's own cubic outline, not only fills it", () => {
    // drawEllipse's stroke spec is built via a spread on a SEPARATE code path from the fill spread above it; no existing ellipse test exercises it at all.
    const rasteriser = new RecordingRasteriser();
    const k = 0.5523;
    const cy = 40;
    const cx = 70;
    const rx = 30;
    const ry = 20;
    const content = [
      "0.4 0.5 0.6 RG 2 w",
      `${cx + rx} ${cy} m`,
      `${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry} c`,
      `${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy} c`,
      `${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry} c`,
      `${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy} c`,
      "h S",
    ].join("\n");
    drive(onePagePdf(content), 0, {}, rasteriser);
    const stroke = rasteriser.ops.find(isPath);
    expect(stroke?.fill).toBeUndefined();
    expect(stroke?.stroke).toEqual({
      color: { r: 0.4, g: 0.5, b: 0.6 },
      widthPx: 2,
    });
  });

  it("strokes a general (non-dotted, non-rect, non-line) path, not only fills it", () => {
    // drawPath's non-dotted stroke spread (the sibling of the fill spread the earlier test above pins) is otherwise never reached.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("0.7 0.8 0.9 RG 3 w 100 10 m 130 10 l 115 40 l h S"),
      0,
      {},
      rasteriser,
    );
    const stroke = rasteriser.ops.find(isPath);
    expect(stroke?.fill).toBeUndefined();
    expect(stroke?.stroke).toEqual({
      color: { r: 0.7, g: 0.8, b: 0.9 },
      widthPx: 3,
    });
  });

  it("draws a dotted two-point path as an exact dot train, scaling the dot size by widthPt x scale", () => {
    // A single "m ... l S" open segment is exactly the shape detectLine reduces to an ExtractedLine (interpret.ts), so this actually drives drawLine's own dotted branch, not drawPath's — drawPath's dotted branch needs a path detectLine won't collapse, which the two-segment test below covers. At scale 1, multiplying and dividing widthPt by pixelsPerPt are indistinguishable, so this pins it at scale 3.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 20 20 m 60 20 l S"),
      0,
      { scale: 3 },
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    // Device length 40pt x 3 = 120px, spacing = max(widthPx x 2, 1) = 12px: dots at 0, 12, ..., 120 — 11 of them.
    expect(squares).toHaveLength(11);
    expect(squares[0]).toEqual({
      kind: "fillRect",
      xPx: 57,
      yPx: 237,
      widthPx: 6,
      heightPx: 6,
      color: { r: 0, g: 0, b: 0 },
    });
    expect(squares[squares.length - 1]).toMatchObject({ xPx: 177, yPx: 237 });
  });

  it("draws a dotted general path's own line segment as a dot train, not only through drawLine's single-segment shape", () => {
    // Two straight segments in one open subpath: detectLine only ever collapses a subpath of exactly one segment, so this one stays an ExtractedPath and genuinely drives drawPath's own "line" kind branch — the sibling test above, despite drawing a straight line, never reaches this branch at all.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 20 20 m 60 20 l 60 60 l S"),
      0,
      {},
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    // Two 40pt segments, spacing = max(2 x 2, 1) = 4px: 11 dots each (0, 4, ..., 40), 22 total — including the shared corner point drawn once by each segment's own end/start.
    expect(squares).toHaveLength(22);
    expect(squares[0]).toMatchObject({ xPx: 19, yPx: 79 });
    expect(squares[10]).toMatchObject({ xPx: 59, yPx: 79 });
    expect(squares[11]).toMatchObject({ xPx: 59, yPx: 79 });
    expect(squares[squares.length - 1]).toMatchObject({ xPx: 59, yPx: 39 });
  });

  it("scales drawPath's own dotted dot size by the render scale, not divides by it", () => {
    // At scale 1 (every test above), multiplying and dividing widthPt by pixelsPerPt are indistinguishable; only a non-1 scale pins the operator drawPath's own dotted branch uses, as the sibling drawLine test above already does for its own branch.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 20 20 m 60 20 l 60 60 l S"),
      0,
      { scale: 3 },
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    expect(squares[0]).toMatchObject({ widthPx: 6, heightPx: 6 });
  });

  it("draws a dotted general path's own cubic segment as a dot train too, not only its line segments", () => {
    // A cubic whose control points are collinear with its endpoints flattens to just its own endpoint (the same fact flattenCubic's own suite pins directly), so the resulting dot train is exactly as predictable as the line-segment case above — this isolates drawPath's cubic branch from its line branch, which the line-only test above never touches.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 20 20 m 40 20 60 20 80 20 c S"),
      0,
      {},
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    // Device length 60pt, spacing = max(2 x 2, 1) = 4px: dots at 0, 4, ..., 60 — 16 of them.
    expect(squares).toHaveLength(16);
    expect(squares[0]).toMatchObject({ xPx: 19, yPx: 79 });
    expect(squares[squares.length - 1]).toMatchObject({ xPx: 79, yPx: 79 });
  });

  it("fills a general path with the paint operator's own fill rule and carries strokes on the same op", () => {
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("0 0 0 rg 100 10 m 130 10 l 115 40 l h f*"),
      0,
      {},
      rasteriser,
    );
    const fill = rasteriser.ops.find(isPath);
    expect(fill?.fill?.fillRule).toBe("evenodd");
    expect(fill?.subpaths[0]).toEqual({
      startXPx: 100,
      startYPx: 90,
      segments: [
        { kind: "line", xPx: 130, yPx: 90 },
        { kind: "line", xPx: 115, yPx: 60 },
      ],
      closed: true,
    });
  });

  it("recovers a dashed line as a stroke with a width-relative dash array", () => {
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[6 6] 0 d 2 w 0 0 0 RG 10 80 m 190 80 l S"),
      0,
      {},
      rasteriser,
    );
    const stroke = rasteriser.ops.find(isPath);
    expect(stroke?.stroke).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPx: 2,
      dashPx: [6, 6],
    });
  });

  it("scales a dashed stroke's own width by the render scale, not divides by it", () => {
    // At scale 1, multiplying and dividing by pixelsPerPt are indistinguishable (x*1 === x/1); only a non-1 scale actually pins the operator.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[6 6] 0 d 2 w 0 0 0 RG 10 80 m 190 80 l S"),
      0,
      { scale: 3 },
      rasteriser,
    );
    const stroke = rasteriser.ops.find(isPath);
    expect(stroke?.stroke).toMatchObject({ widthPx: 6 });
  });

  it("scales a dotted line's own dot size by the render scale, not divides by it", () => {
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 10 90 m 190 90 l S"),
      0,
      { scale: 3 },
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    expect(squares[0]).toMatchObject({ widthPx: 6, heightPx: 6 });
  });

  it("draws no dots at all for a dotted line whose two endpoints coincide", () => {
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 50 50 m 50 50 l S"),
      0,
      {},
      rasteriser,
    );
    expect(rasteriser.ops.filter(isFillRect)).toEqual([]);
  });

  it("draws a dotted line as filled squares rather than a zero-length dash array", () => {
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 10 90 m 190 90 l S"),
      0,
      {},
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    // The segment's own length (180pt) is an exact multiple of the spacing (4pt), so a dot lands exactly on the final point too — this pins that boundary (`distance <= length`) as an exact count, not just "more than a few": 180/4 + 1 = 46 dots, one at every multiple of 4 from 0 through 180 inclusive.
    expect(squares.length).toBe(46);
    // First dot at the segment's start: a 2x2 square centred on (10, 90) page points, i.e. device (10, 100 - 90) = (10, 10).
    expect(squares[0]).toEqual({
      kind: "fillRect",
      xPx: 9,
      yPx: 9,
      widthPx: 2,
      heightPx: 2,
      color: { r: 0, g: 0, b: 0 },
    });
    // The final dot sits exactly at the segment's own endpoint (190, 90) -> device (190, 10).
    expect(squares[45]).toEqual({
      kind: "fillRect",
      xPx: 189,
      yPx: 9,
      widthPx: 2,
      heightPx: 2,
      color: { r: 0, g: 0, b: 0 },
    });
    // Spacing is the writer's own dotted off-length: 2 x stroke width.
    expect(squares[1]!.xPx - squares[0]!.xPx).toBeCloseTo(4, 6);
  });

  it("draws a dotted diagonal line's dots along both axes, not just x", () => {
    // The sibling test above is purely horizontal (p1.y === p2.y throughout), which cannot distinguish `p1.y + (p2.y - p1.y) * t` from a sign-flipped or operand-swapped variant of the same expression — every dot would land at the same y regardless. A diagonal segment where y genuinely varies with t is the only way to pin that arithmetic.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 10 10 m 50 50 l S"),
      0,
      {},
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    // length = hypot(40, 40), spacing = 4 — not an exact multiple, so the dot count is governed by the loop's own `<=` boundary rather than pinned to a round number; what matters here is each dot's own position, not the count.
    expect(squares.length).toBeGreaterThan(3);
    // First dot at (10, 10) page -> device (10, 90).
    expect(squares[0]).toMatchObject({ xPx: 9, yPx: 89 });
    // Second dot has moved diagonally: both x AND y have advanced by the same page-space step (t moves equally along a 45-degree segment), and device y decreases as page y increases.
    const dx = squares[1]!.xPx - squares[0]!.xPx;
    const dy = squares[0]!.yPx - squares[1]!.yPx;
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeCloseTo(dx, 6);
  });

  it("rebuilds a recovered ellipse as four kappa cubics through the bounding box", () => {
    const rasteriser = new RecordingRasteriser();
    // The four-cubic kappa construction interpret.ts's own detector recognises, written out for the bounding box (40, 20)-(100, 60): start at the right cardinal point, one cubic per quarter. k = 0.5523 (4 dp is well inside the detector's tolerance).
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
      `${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry} c`,
      `${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy} c`,
      "h f",
    ].join("\n");
    drive(onePagePdf(content), 0, {}, rasteriser);
    const fill = rasteriser.ops.find(isPath);
    if (fill?.fill === undefined || fill.subpaths[0] === undefined) {
      throw new Error("no filled path op emitted for the ellipse");
    }
    expect(fill.fill.fillRule).toBe("nonzero");
    const subpath = fill.subpaths[0];
    expect(subpath.closed).toBe(true);
    expect(subpath.segments).toHaveLength(4);
    expect(subpath.segments.every((s) => s.kind === "cubic")).toBe(true);
    // Start at the right cardinal point: page (100, 40) -> device (100, 60).
    expect(subpath.startXPx).toBeCloseTo(100, 3);
    expect(subpath.startYPx).toBeCloseTo(60, 3);
    // The first cubic's first control point: page (100, 40 + 20k) -> device y 100 - 51.046.
    const first = subpath.segments[0]!;
    if (first.kind !== "cubic") {
      throw new Error("first ellipse segment is not a cubic");
    }
    expect(first.c1xPx).toBeCloseTo(100, 3);
    expect(first.c1yPx).toBeCloseTo(100 - (40 + 20 * k), 3);
    expect(first.xPx).toBeCloseTo(70, 3);
    expect(first.yPx).toBeCloseTo(40, 3);
  });

  it("places all four quarter cubics' own control points at the exact kappa-scaled offsets from every cardinal point, not just the first", () => {
    // The sibling test above only pins the first cubic; every one of drawEllipse's eight control points is its own independent cx/cy +/- rx/dx/ry/dy term, so a sign flip on any one of the other seven survives unless each is checked. rx != ry and cx != cy here specifically so a swapped or wrong-signed term cannot coincidentally match a right-signed one.
    const rasteriser = new RecordingRasteriser();
    const cx = 70;
    const cy = 35;
    const rx = 30;
    const ry = 15;
    const dx = rx * BEZIER_KAPPA;
    const dy = ry * BEZIER_KAPPA;
    const content = [
      "0 0 0 rg",
      `${cx + rx} ${cy} m`,
      `${cx + rx} ${cy + dy} ${cx + dx} ${cy + ry} ${cx} ${cy + ry} c`,
      `${cx - dx} ${cy + ry} ${cx - rx} ${cy + dy} ${cx - rx} ${cy} c`,
      `${cx - rx} ${cy - dy} ${cx - dx} ${cy - ry} ${cx} ${cy - ry} c`,
      `${cx + dx} ${cy - ry} ${cx + rx} ${cy - dy} ${cx + rx} ${cy} c`,
      "h f",
    ].join("\n");
    drive(onePagePdf(content), 0, {}, rasteriser);
    const fill = rasteriser.ops.find(isPath);
    if (fill?.fill === undefined || fill.subpaths[0] === undefined) {
      throw new Error("no filled path op emitted for the ellipse");
    }
    const toDeviceY = (pageY: number) => 100 - pageY;
    const segments = fill.subpaths[0].segments;
    expect(segments).toHaveLength(4);
    const expected = [
      {
        c1xPx: cx + rx,
        c1yPx: toDeviceY(cy + dy),
        c2xPx: cx + dx,
        c2yPx: toDeviceY(cy + ry),
        xPx: cx,
        yPx: toDeviceY(cy + ry),
      },
      {
        c1xPx: cx - dx,
        c1yPx: toDeviceY(cy + ry),
        c2xPx: cx - rx,
        c2yPx: toDeviceY(cy + dy),
        xPx: cx - rx,
        yPx: toDeviceY(cy),
      },
      {
        c1xPx: cx - rx,
        c1yPx: toDeviceY(cy - dy),
        c2xPx: cx - dx,
        c2yPx: toDeviceY(cy - ry),
        xPx: cx,
        yPx: toDeviceY(cy - ry),
      },
      {
        c1xPx: cx + dx,
        c1yPx: toDeviceY(cy - ry),
        c2xPx: cx + rx,
        c2yPx: toDeviceY(cy - dy),
        xPx: cx + rx,
        yPx: toDeviceY(cy),
      },
    ];
    for (const [i, segment] of segments.entries()) {
      if (segment.kind !== "cubic") {
        throw new Error(`ellipse segment ${i} is not a cubic`);
      }
      const want = expected[i]!;
      expect(segment.c1xPx).toBeCloseTo(want.c1xPx, 6);
      expect(segment.c1yPx).toBeCloseTo(want.c1yPx, 6);
      expect(segment.c2xPx).toBeCloseTo(want.c2xPx, 6);
      expect(segment.c2yPx).toBeCloseTo(want.c2yPx, 6);
      expect(segment.xPx).toBeCloseTo(want.xPx, 6);
      expect(segment.yPx).toBeCloseTo(want.yPx, 6);
    }
  });
});

// --- Images through the port. ---
