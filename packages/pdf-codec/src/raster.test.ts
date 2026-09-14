import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import { buildCmapLookup } from "./cmap-table";
import type { PdfDiagnostic } from "./diagnostics";
import { PdfParseError } from "./diagnostics";
import { parseHead, parseMaxp } from "./font-tables";
import { parseGlyf } from "./glyf";
import { parseHmtx } from "./hmtx-table";
import { applyMatrix } from "./matrix";
import { flattenCubic, renderPdfPage } from "./raster";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterPageGeometry,
} from "./raster";
import { readPdf } from "./read";
import { parseSfnt } from "./sfnt";
import { ByteWriter } from "./bytes/writer";
import { carlitoRegularBytes } from "./test-support/fonts";
import {
  cropBoxPdf,
  inlineImagePdf,
  minimalClassicXrefPdf,
  rotatedCropBoxPdf,
  twoPagesFirstWithoutResourcesPdf,
} from "./test-support/pdf";

// renderPdfPage's tests drive it through a recording rasteriser (the port's cheapest consumer) so every assertion is on the op stream itself -- the exact positioned geometry a real backend would receive -- rather than on any one backend's pixels. The end-to-end pixel tests (renderPdfPage plus the pdf-raster-cpu reference backend) live in that backend package's own suite; here the port contract, the coordinate transforms, and the refusal diagnostics are what is pinned.
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
const isImage = (
  op: RasterDrawOp,
): op is Extract<RasterDrawOp, { kind: "image" }> => op.kind === "image";

function pathOpBounds(op: Extract<RasterDrawOp, { kind: "path" }>) {
  let minX = Infinity;
  let minY = Infinity;
  const visit = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  };
  for (const subpath of op.subpaths) {
    visit(subpath.startXPx, subpath.startYPx);
    for (const segment of subpath.segments) {
      visit(segment.xPx, segment.yPx);
    }
  }
  return { minX, minY };
}

// --- The port's geometry contract. ---

describe("renderPdfPage: geometry and clipPt", () => {
  const content =
    "1 0 0 rg 10 20 30 40 re f 0.5 0.5 0.5 RG 2 w 10 10 m 90 10 l S";

  it("reports the page's own extent at scale 1 and flips y into top-left device space", () => {
    const rasteriser = new RecordingRasteriser();
    drive(onePagePdf(content), 0, {}, rasteriser);
    expect(rasteriser.geometry).toEqual({
      widthPx: 200,
      heightPx: 100,
      scale: 1,
      widthPt: 200,
      heightPt: 100,
    });
    // The rect at page point (10, 20) with extent 30x40 sits 40pt below the page's 100pt top edge, so its device top-left is (10, 100 - 60) = (10, 40) -- the flip every consumer's OCR coordinate expectations ride on.
    expect(rasteriser.ops.filter(isFillRect)).toEqual([
      {
        kind: "fillRect",
        xPx: 10,
        yPx: 40,
        widthPx: 30,
        heightPx: 40,
        color: { r: 1, g: 0, b: 0 },
      },
    ]);
  });

  it("scales by the requested factor", () => {
    const rasteriser = new RecordingRasteriser();
    drive(onePagePdf(content), 0, { scale: 2 }, rasteriser);
    expect(rasteriser.geometry).toMatchObject({
      widthPx: 400,
      heightPx: 200,
      scale: 2,
    });
    expect(rasteriser.ops.find(isFillRect)).toMatchObject({
      xPx: 20,
      yPx: 80,
      widthPx: 60,
      heightPx: 80,
    });
  });

  it("treats dpi as 72 x scale", () => {
    const rasteriser = new RecordingRasteriser();
    drive(onePagePdf(content), 0, { dpi: 144 }, rasteriser);
    expect(rasteriser.geometry).toMatchObject({ widthPx: 400, heightPx: 200 });
  });

  it("renders just the requested region, re-origined at its own top-left", () => {
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf(content),
      0,
      { clipPt: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 } },
      rasteriser,
    );
    expect(rasteriser.geometry).toEqual({
      widthPx: 30,
      heightPx: 40,
      scale: 1,
      widthPt: 30,
      heightPt: 40,
    });
    // The rect exactly fills the region: its page point (10, 20) maps to device (0, 0).
    expect(rasteriser.ops.find(isFillRect)).toMatchObject({
      xPx: 0,
      yPx: 0,
      widthPx: 30,
      heightPx: 40,
    });
  });

  it("rejects scale and dpi together, non-positive scales, and zero-extent or non-intersecting clips", () => {
    const bytes = onePagePdf(content);
    expect(() =>
      renderPdfPage(bytes, 0, { scale: 1, dpi: 72 }, new RecordingRasteriser()),
    ).toThrow(/at most one of scale and dpi/);
    expect(() =>
      renderPdfPage(bytes, 0, { scale: 0 }, new RecordingRasteriser()),
    ).toThrow(/positive scale/);
    expect(() =>
      drive(
        bytes,
        0,
        { clipPt: { xPt: 10, yPt: 20, widthPt: 0, heightPt: 40 } },
        new RecordingRasteriser(),
      ),
    ).toThrow(/positive widthPt and heightPt/);
    expect(() =>
      drive(
        bytes,
        0,
        { clipPt: { xPt: 500, yPt: 20, widthPt: 30, heightPt: 40 } },
        new RecordingRasteriser(),
      ),
    ).toThrow(/does not intersect/);
  });

  it("throws the reader's own typed errors for a non-PDF input and an out-of-range page", () => {
    expect(() =>
      renderPdfPage(enc("not a pdf"), 0, {}, new RecordingRasteriser()),
    ).toThrow(PdfParseError);
    expect(() =>
      renderPdfPage(enc("not a pdf"), 0, {}, new RecordingRasteriser()),
    ).toThrow(/no "%PDF-" header/);
    expect(() =>
      renderPdfPage(onePagePdf(content), 7, {}, new RecordingRasteriser()),
    ).toThrow(/page index 7/);
  });

  it("rejects a page index at exactly the page count (the first invalid index, not just far out of range), naming the count singular for one page", () => {
    expect(() =>
      renderPdfPage(onePagePdf(content), 1, {}, new RecordingRasteriser()),
    ).toThrow(
      /page index 1 is outside this document's page tree \(it declares 1 page\)$/,
    );
  });

  it("rejects a negative page index", () => {
    expect(() =>
      renderPdfPage(onePagePdf(content), -1, {}, new RecordingRasteriser()),
    ).toThrow(/page index -1/);
  });

  it("names the page count plural for a multi-page document", () => {
    expect(() =>
      renderPdfPage(
        twoPagesFirstWithoutResourcesPdf(),
        5,
        {},
        new RecordingRasteriser(),
      ),
    ).toThrow(/it declares 2 pages\)$/);
  });

  it("falls back to /MediaBox and emits a diagnostic when /CropBox is degenerate", () => {
    const diagnostics: PdfDiagnostic[] = [];
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf(content, { pageEntries: "/CropBox [0 0 0 100] " }),
      0,
      { sink: (d) => diagnostics.push(d) },
      rasteriser,
    );
    expect(rasteriser.geometry).toMatchObject({ widthPx: 200, heightPx: 100 });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "pdf/invalid-crop-box",
        severity: "warning",
      }),
    );
  });

  it("computes page extent correctly for a MediaBox whose origin is not (0, 0)", () => {
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [50 50 250 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    );
    b.object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    b.stream(5, "<< >>", enc(content));
    const bytes = b.classicXrefAndTrailer(5, "/Root 1 0 R");
    const rasteriser = new RecordingRasteriser();
    drive(bytes, 0, {}, rasteriser);
    // width = urx - llx = 200, height = ury - lly = 100 -- urx + llx (300) or ury + lly (200) would both be wrong here precisely because the origin is non-zero.
    expect(rasteriser.geometry).toMatchObject({ widthPx: 200, heightPx: 100 });
  });

  it("reports a zero-height intersection distinctly from a zero-width one, with the exact requested and page ranges in the message", () => {
    const bytes = onePagePdf(content);
    expect(() =>
      drive(
        bytes,
        0,
        { clipPt: { xPt: 10, yPt: 200, widthPt: 30, heightPt: 40 } },
        new RecordingRasteriser(),
      ),
    ).toThrow(
      "renderPdfPage clipPt does not intersect the page's visible region (clip x 10..40, y 200..240; page 0..200 x 0..100)",
    );
  });

  it("intersects the requested clip with the page's own extent when the clip partially overhangs it, rather than rejecting it", () => {
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf(content),
      0,
      { clipPt: { xPt: 10, yPt: 20, widthPt: 300, heightPt: 40 }, scale: 2 },
      rasteriser,
    );
    // Requested width 300 clamped to the page's own 200pt right edge: a visible region of 190pt wide (200 - 10), at 2x scale.
    expect(rasteriser.geometry).toMatchObject({ widthPx: 380, heightPx: 80 });
    // The rect at page point (10, 20) sits at device x = (10 - clipLeft(10)) * 2 = 0.
    expect(rasteriser.ops.find(isFillRect)).toMatchObject({ xPx: 0 });
  });

  it("names its own diagnostic code for a missing /Resources dict, not just the message text", () => {
    const diagnostics: PdfDiagnostic[] = [];
    drive(
      twoPagesFirstWithoutResourcesPdf(),
      0,
      { sink: (d) => diagnostics.push(d) },
      new RecordingRasteriser(),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "pdf/object-missing-value" }),
    );
  });

  it("returns whatever the rasteriser's finish produces", () => {
    const rasteriser = new RecordingRasteriser();
    const result = renderPdfPage(onePagePdf(content), 0, {}, rasteriser);
    expect(result).toBe(rasteriser.finish());
  });

  it("renders an empty canvas and a diagnostic for a page with no /Resources", () => {
    const diagnostics: PdfDiagnostic[] = [];
    const rasteriser = new RecordingRasteriser();
    const bytes = twoPagesFirstWithoutResourcesPdf();
    drive(bytes, 0, { sink: (d) => diagnostics.push(d) }, rasteriser);
    expect(rasteriser.geometry).toEqual({
      widthPx: 200,
      heightPx: 100,
      scale: 1,
      widthPt: 200,
      heightPt: 100,
    });
    expect(rasteriser.ops).toEqual([]);
    expect(
      diagnostics.some((d) => d.message.includes("no /Resources dict")),
    ).toBe(true);
  });
});

// The pinning test for the module's one deliberately duplicated block: renderPdfPage's own crop/rotation geometry must agree with readPdf's reported item positions bit for bit, or the clipPt contract (the same point coordinates LayoutFrame uses) is fiction. Both fixtures carry a straddling rect and text inside and outside the crop, one unrotated and one under /Rotate 90.

describe("renderPdfPage: coordinate agreement with readPdf", () => {
  const cases: readonly {
    readonly name: string;
    readonly bytes: () => Uint8Array<ArrayBuffer>;
  }[] = [
    { name: "cropped page", bytes: cropBoxPdf },
    { name: "cropped and /Rotate 90 page", bytes: rotatedCropBoxPdf },
  ];

  for (const { name, bytes } of cases) {
    it(`places a straddling rect exactly where readPdf reports it (${name})`, () => {
      const doc = readPdf(bytes());
      const page = doc.pages[0]!;
      const rect = page.items.find((item) => item.kind === "rect");
      if (rect?.kind !== "rect") {
        throw new Error("fixture setup: no rect item recovered");
      }
      const rasteriser = new RecordingRasteriser();
      drive(bytes(), 0, {}, rasteriser);
      const fillRect = rasteriser.ops.find(isFillRect);
      if (fillRect === undefined) {
        throw new Error("no fillRect op emitted for the rect item");
      }
      expect(fillRect.xPx).toBeCloseTo(rect.xPt, 6);
      expect(fillRect.yPx).toBeCloseTo(
        page.heightPt - rect.yPt - rect.heightPt,
        6,
      );
      expect(fillRect.widthPx).toBeCloseTo(rect.widthPt, 6);
      expect(fillRect.heightPx).toBeCloseTo(rect.heightPt, 6);
    });

    it(`renders a LayoutFrame-shaped region exactly (segmentPdfRegions' bounds as clipPt, ${name})`, () => {
      const doc = readPdf(bytes());
      const page = doc.pages[0]!;
      const rect = page.items.find((item) => item.kind === "rect");
      if (rect?.kind !== "rect") {
        throw new Error("fixture setup: no rect item recovered");
      }
      // The region bounds document-outline.js's segmentPdfRegions would hand back for this figure: exactly PdfRegionBounds' shape, passed straight through as clipPt. This rect deliberately straddles the crop boundary, so the rendered region is the intersection with the visible page -- the same clipping a viewer applies, not an error.
      const clipPt = {
        xPt: rect.xPt,
        yPt: rect.yPt,
        widthPt: rect.widthPt,
        heightPt: rect.heightPt,
      };
      const rasteriser = new RecordingRasteriser();
      drive(bytes(), 0, { clipPt }, rasteriser);
      expect(rasteriser.geometry).toMatchObject({
        widthPt:
          Math.min(rect.xPt + rect.widthPt, page.widthPt) -
          Math.max(0, rect.xPt),
        heightPt:
          Math.min(rect.yPt + rect.heightPt, page.heightPt) -
          Math.max(0, rect.yPt),
      });
      const fillRect = rasteriser.ops.find(isFillRect);
      expect(fillRect).toMatchObject({ xPx: 0, yPx: 0 });
    });
  }
});

// --- Vector items through the port. ---

// flattenCubic exercised directly: every real caller reaches it only through curves recovered from actual PDF content streams, which are never carefully enough constructed to pin an exact subdivision count or force the recursion depth cap deterministically -- both properties this suite verifies directly against hand-computed control points.
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
    // The true, symmetric peak of this curve -- wrong chord/dist arithmetic or a wrong midpoint divisor shifts every one of these values.
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
    // Every leaf hits the depth cap, never the flatness check, so the tree is a perfectly balanced binary recursion of depth 16 -- exactly 2**16 leaves. A boundary of >16, <16, or an unconditional true/false all produce a different power of two (or an infinite loop for false).
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
});

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

  it("draws a dotted line as filled squares rather than a zero-length dash array", () => {
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 10 90 m 190 90 l S"),
      0,
      {},
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    expect(squares.length).toBeGreaterThan(10);
    // First dot at the segment's start: a 2x2 square centred on (10, 90) page points, i.e. device (10, 100 - 90) = (10, 10).
    expect(squares[0]).toEqual({
      kind: "fillRect",
      xPx: 9,
      yPx: 9,
      widthPx: 2,
      heightPx: 2,
      color: { r: 0, g: 0, b: 0 },
    });
    // Spacing is the writer's own dotted off-length: 2 x stroke width.
    expect(squares[1]!.xPx - squares[0]!.xPx).toBeCloseTo(4, 6);
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
});

// --- Images through the port. ---

describe("renderPdfPage: image ops", () => {
  function imageXObjectPdf(): Uint8Array<ArrayBuffer> {
    // A 2x2 FlateDecode RGB XObject drawn axis-aligned: unit CTM columns (40, 0) and rows (0, 20) at page point (10, 60), so the image occupies page rect (10, 60)-(50, 80).
    const pixels = new Uint8Array([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
    ]);
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /XObject << /Im0 6 0 R >> >> /Contents 5 0 R >>",
    );
    b.stream(5, "<< >>", enc("q 40 0 0 20 10 60 cm /Im0 Do Q"));
    b.stream(
      6,
      "<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>",
      zlibSync(pixels),
    );
    return b.classicXrefAndTrailer(6, "/Root 1 0 R");
  }

  it("emits one image op carrying images-read's recovered PNG and a placement that maps the unit square's corners onto the page rect", () => {
    const rasteriser = new RecordingRasteriser();
    drive(imageXObjectPdf(), 0, {}, rasteriser);
    const image = rasteriser.ops.find(isImage);
    if (image === undefined) {
      throw new Error("no image op emitted");
    }
    expect(image.format).toBe("png");
    expect(image.sourceWidthPx).toBe(2);
    expect(image.sourceHeightPx).toBe(2);
    // The port's top-left-origin unit square: (0,0) is the image's top-left, (1,1) its bottom-right. The image occupies page rect (10, 60)-(50, 80), i.e. device (10, 20)-(50, 40) after the y flip -- if the flip or the CTM order were wrong, these corners would transpose.
    const corner = (u: number, v: number) =>
      applyMatrix(image.matrix, { x: u, y: v });
    const topLeft = corner(0, 0);
    const bottomRight = corner(1, 1);
    const topRight = corner(1, 0);
    expect(topLeft.x).toBeCloseTo(10, 6);
    expect(topLeft.y).toBeCloseTo(20, 6);
    expect(bottomRight.x).toBeCloseTo(50, 6);
    expect(bottomRight.y).toBeCloseTo(40, 6);
    expect(topRight.x).toBeCloseTo(50, 6);
    expect(topRight.y).toBeCloseTo(20, 6);
  });

  it("emits an image op for the inline BI/ID/EI form too", () => {
    const rasteriser = new RecordingRasteriser();
    drive(inlineImagePdf(), 0, {}, rasteriser);
    const image = rasteriser.ops.find(isImage);
    expect(image?.sourceWidthPx).toBe(2);
    expect(image?.sourceHeightPx).toBe(2);
  });
});

// --- Text: outline resolution, per-glyph placement, and named refusals. ---

// A Type0/Identity-H/CIDFontType2 fixture around the real vendored Carlito face -- the exact dominant embedded-font shape mainstream producers emit and this package's own writer produces. The glyph IDs, advances, and units-per-em the fixture needs are read out of the same bytes with this package's own table parsers (legitimate here: the table parsers are independently tested against the real font files, and what is under test is the raster walk, not the fixture's arithmetic).
function type0CarlitoPdf(
  text: string,
  textState = "",
): Uint8Array<ArrayBuffer> {
  const bytes = carlitoRegularBytes();
  const sfnt = parseSfnt(bytes);
  const head = parseHead(sfnt!);
  const maxp = parseMaxp(sfnt!);
  const cmap = buildCmapLookup(sfnt!);
  const hmtx = parseHmtx(sfnt!);
  if (
    head === undefined ||
    maxp === undefined ||
    cmap === undefined ||
    sfnt === undefined
  ) {
    throw new Error("fixture setup: Carlito tables unreadable");
  }
  const glyphIds = [...text].map((ch) => cmap(ch.codePointAt(0)!));
  if (glyphIds.some((gid) => gid === undefined)) {
    throw new Error(`fixture setup: no glyph for "${text}"`);
  }
  const shown = glyphIds
    .map((gid) => (gid! + 0x10000).toString(16).slice(-4).toUpperCase())
    .join("");
  const widths = glyphIds
    .map(
      (gid) =>
        ` ${gid} [${(hmtx.advanceWidth(gid!) * (1000 / head.unitsPerEm)).toFixed(2)}]`,
    )
    .join("");
  const b = new SmallFixture();
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  b.object(
    4,
    `<< /Type /Font /Subtype /Type0 /BaseFont /Carlito /Encoding /Identity-H /DescendantFonts [7 0 R] >>`,
  );
  b.object(
    7,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Carlito /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /DW 1000 /W [${widths} ] /CIDToGIDMap /Identity >>`,
  );
  b.object(
    8,
    `<< /Type /FontDescriptor /FontName /Carlito /Flags 32 /FontBBox [${head.xMin} ${head.yMin} ${head.xMax} ${head.yMax}] /ItalicAngle 0 /Ascent ${head.yMax} /Descent ${head.yMin} /CapHeight ${head.yMax} /StemV 80 /FontFile2 9 0 R >>`,
  );
  b.stream(9, `<< /Length1 ${bytes.length} >>`, bytes);
  b.stream(
    5,
    "<< >>",
    enc(`BT /F1 24 Tf ${textState} 20 50 Td <${shown}> Tj ET`),
  );
  return b.classicXrefAndTrailer(9, "/Root 1 0 R");
}

describe("renderPdfPage: text through embedded sfnt outlines", () => {
  it("draws each shown glyph as a filled closed path placed at the run's own matrices", () => {
    const bytes = type0CarlitoPdf("HH");
    // Sanity: the reader still extracts the text (the fixture's font dictionaries are valid), and reports the run's page-space anchor.
    const doc = readPdf(bytes);
    const textItem = doc.pages[0]!.items.find((item) => item.kind === "text");
    if (textItem?.kind !== "text") {
      throw new Error("fixture setup: readPdf extracted no text item");
    }
    expect(textItem.text).toBe("HH");

    const sfnt = parseSfnt(carlitoRegularBytes())!;
    const head = parseHead(sfnt)!;
    const maxp = parseMaxp(sfnt)!;
    const cmap = buildCmapLookup(sfnt)!;
    const hmtx = parseHmtx(sfnt);
    const glyf = parseGlyf(sfnt, {
      numGlyphs: maxp.numGlyphs,
      indexToLocFormat: head.indexToLocFormat,
    })!;
    const gid = cmap("H".codePointAt(0)!)!;
    const ink = glyf.glyphInkBounds(gid)!;
    const sizePt = 24;
    const advancePt = (hmtx.advanceWidth(gid) / head.unitsPerEm) * sizePt;

    const rasteriser = new RecordingRasteriser();
    drive(bytes, 0, {}, rasteriser);
    const glyphOps = rasteriser.ops.filter(isPath);
    expect(glyphOps.length).toBe(2);
    for (const op of glyphOps) {
      expect(op.fill?.fillRule).toBe("nonzero");
      expect(op.subpaths.length).toBeGreaterThanOrEqual(1);
      expect(op.subpaths.every((subpath) => subpath.closed)).toBe(true);
    }
    // First glyph's ink window, straight from Carlito's own declared box: page x [20 + xMin/em*24, 20 + xMax/em*24], y from the baseline at 50 up by yMax/em*24 -- flipped into device space. This is the placement assertion: wrong matrix order, missing unitsPerEm division, or a lost y flip all move it.
    const first = pathOpBounds(glyphOps[0]!);
    expect(first.minX).toBeCloseTo(
      20 + (ink.xMin / head.unitsPerEm) * sizePt,
      1,
    );
    expect(first.minY).toBeCloseTo(
      100 - 50 - (ink.yMax / head.unitsPerEm) * sizePt,
      1,
    );
    // The second glyph sits exactly one /W advance further right (no Tc/Tw/Tz in the fixture, so the end-matrix correction factor is exactly 1).
    const second = pathOpBounds(glyphOps[1]!);
    expect(second.minX - first.minX).toBeCloseTo(advancePt, 2);
  });

  it("absorbs interpreter-only spacing state through the end-matrix correction", () => {
    // The same two-glyph run under 150% horizontal scaling (Tz): the interpreter's end matrix reflects the scaling, and the correction must widen the per-glyph advances to match rather than leaving the second glyph short of where the page placed it.
    const bytes = type0CarlitoPdf("HH", "150 Tz");
    const rasteriser = new RecordingRasteriser();
    drive(bytes, 0, {}, rasteriser);
    const glyphOps = rasteriser.ops.filter(isPath);
    expect(glyphOps.length).toBe(2);
    const sfnt = parseSfnt(carlitoRegularBytes())!;
    const head = parseHead(sfnt)!;
    const hmtx = parseHmtx(sfnt);
    const cmap = buildCmapLookup(sfnt)!;
    const scaledAdvancePt =
      (hmtx.advanceWidth(cmap("H".codePointAt(0)!)!) / head.unitsPerEm) *
      24 *
      1.5;
    expect(
      pathOpBounds(glyphOps[1]!).minX - pathOpBounds(glyphOps[0]!).minX,
    ).toBeCloseTo(scaledAdvancePt, 1);
  });
});

describe("renderPdfPage: text refusals are named, never approximated", () => {
  it("refuses a CFF-flavoured face (a CIDFontType0 descendant) through raster/text-cff-outlines", () => {
    const diagnostics: PdfDiagnostic[] = [];
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    );
    b.object(
      4,
      "<< /Type /Font /Subtype /Type0 /BaseFont /STIXTwoMath /Encoding /Identity-H /DescendantFonts [6 0 R] >>",
    );
    b.object(
      6,
      "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STIXTwoMath /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R >>",
    );
    b.object(7, "<< /Type /FontDescriptor /FontName /STIXTwoMath /Flags 4 >>");
    b.stream(5, "<< >>", enc("BT /F1 12 Tf 10 50 Td <0041> Tj ET"));
    const bytes = b.classicXrefAndTrailer(7, "/Root 1 0 R");
    const rasteriser = new RecordingRasteriser();
    drive(bytes, 0, { sink: (d) => diagnostics.push(d) }, rasteriser);
    expect(diagnostics.map((d) => d.code)).toContain(
      "raster/text-cff-outlines",
    );
    expect(rasteriser.ops).toEqual([]);
  });

  it("refuses a standard-14 face with nothing embedded through raster/text-outlines-unavailable", () => {
    const diagnostics: PdfDiagnostic[] = [];
    const rasteriser = new RecordingRasteriser();
    drive(
      minimalClassicXrefPdf(),
      0,
      { sink: (d) => diagnostics.push(d) },
      rasteriser,
    );
    expect(diagnostics.map((d) => d.code)).toContain(
      "raster/text-outlines-unavailable",
    );
    expect(
      diagnostics
        .find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message.includes("Helvetica"),
    ).toBe(true);
    // The page carries text only, so nothing else paints.
    expect(rasteriser.ops).toEqual([]);
  });

  // A bare Type0/CIDFontType2 skeleton around the real vendored Carlito face, with every dict entry a caller can override -- the same font bytes type0CarlitoPdf uses, but exposing the descendant/descriptor/encoding shape directly so each of buildTextOutlineFace's own branch conditions can be driven independently of the others.
  function type0Skeleton(overrides: {
    readonly encoding?: string;
    readonly descendantFontsEntry?: string;
    readonly descendantExtra?: string;
    readonly cidToGidMap?: string;
    readonly fontDescriptorBody?: string;
  }): Uint8Array<ArrayBuffer> {
    const fontBytes = carlitoRegularBytes();
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    );
    b.object(
      4,
      `<< /Type /Font /Subtype /Type0 /BaseFont /Carlito /Encoding ${overrides.encoding ?? "/Identity-H"} ${overrides.descendantFontsEntry ?? "/DescendantFonts [7 0 R]"} >>`,
    );
    b.object(
      7,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Carlito /FontDescriptor 8 0 R ${overrides.cidToGidMap ?? ""} ${overrides.descendantExtra ?? ""} >>`,
    );
    b.object(
      8,
      overrides.fontDescriptorBody ??
        "<< /Type /FontDescriptor /FontName /Carlito /Flags 32 /FontFile2 9 0 R >>",
    );
    b.stream(9, `<< /Length1 ${fontBytes.length} >>`, fontBytes);
    b.stream(5, "<< >>", enc("BT /F1 24 Tf 20 50 Td <0000> Tj ET"));
    return b.classicXrefAndTrailer(9, "/Root 1 0 R");
  }

  function refusalDiagnostics(bytes: Uint8Array<ArrayBuffer>): {
    readonly diagnostics: PdfDiagnostic[];
    readonly rasteriser: RecordingRasteriser;
  } {
    const diagnostics: PdfDiagnostic[] = [];
    const rasteriser = new RecordingRasteriser();
    drive(bytes, 0, { sink: (d) => diagnostics.push(d) }, rasteriser);
    return { diagnostics, rasteriser };
  }

  it("refuses a Type0 font whose /Encoding is not Identity-H", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      type0Skeleton({ encoding: "/90ms-RKSJ-H" }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("not Identity-H");
    expect(rasteriser.ops).toEqual([]);
  });

  it("refuses a Type0 font with no readable /DescendantFonts entry", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      type0Skeleton({ descendantFontsEntry: "" }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("no readable /DescendantFonts entry");
    expect(rasteriser.ops).toEqual([]);
  });

  it("refuses a descendant font of a subtype that is neither CIDFontType0 nor CIDFontType2, naming the real subtype", () => {
    const bytes = type0Skeleton({});
    // Overwrite object 7's own Subtype in place -- simplest way to force an unsupported descendant subtype without duplicating the whole skeleton.
    const text = new TextDecoder("latin1").decode(bytes);
    const patched = new TextEncoder().encode(
      text.replace("/Subtype /CIDFontType2", "/Subtype /CIDFontType9"),
    );
    const { diagnostics, rasteriser } = refusalDiagnostics(patched);
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("a descendant font of subtype CIDFontType9");
    expect(rasteriser.ops).toEqual([]);
  });

  it("refuses a CIDFontType2 descendant with no readable embedded program", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      type0Skeleton({
        fontDescriptorBody:
          "<< /Type /FontDescriptor /FontName /Carlito /Flags 32 >>",
      }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("no readable /FontFile2");
    expect(rasteriser.ops).toEqual([]);
  });

  it("refuses a CIDFontType2 descendant whose /CIDToGIDMap is neither /Identity nor a readable stream", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      type0Skeleton({ cidToGidMap: "/CIDToGIDMap 7" }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("neither /Identity nor a readable stream");
    expect(rasteriser.ops).toEqual([]);
  });

  it("maps CIDs through an explicit /CIDToGIDMap stream rather than treating CID as GID directly", () => {
    // CID 0 (the shown code) maps to GID 15 ('H') via the stream -- Identity would instead look up GID 0 (.notdef), a completely different, much smaller shape. type0Skeleton has no stream-object escape hatch for the map itself, so this one is built directly rather than bending the helper further.
    const cidToGidMapBytes = new Uint8Array([0x00, 0x0f]); // one entry: CID 0 -> GID 15
    const b = new SmallFixture();
    const fontBytes = carlitoRegularBytes();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    );
    b.object(
      4,
      "<< /Type /Font /Subtype /Type0 /BaseFont /Carlito /Encoding /Identity-H /DescendantFonts [7 0 R] >>",
    );
    b.object(
      7,
      "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Carlito /FontDescriptor 8 0 R /CIDToGIDMap 10 0 R >>",
    );
    b.object(
      8,
      "<< /Type /FontDescriptor /FontName /Carlito /Flags 32 /FontFile2 9 0 R >>",
    );
    b.stream(9, `<< /Length1 ${fontBytes.length} >>`, fontBytes);
    b.stream(10, "<< >>", cidToGidMapBytes);
    b.stream(5, "<< >>", enc("BT /F1 24 Tf 20 50 Td <0000> Tj ET"));
    const mappedBytes = b.classicXrefAndTrailer(10, "/Root 1 0 R");

    const sfnt = parseSfnt(fontBytes)!;
    const head = parseHead(sfnt)!;
    const maxp = parseMaxp(sfnt)!;
    const glyf = parseGlyf(sfnt, {
      numGlyphs: maxp.numGlyphs,
      indexToLocFormat: head.indexToLocFormat,
    })!;
    const expectedInk = glyf.glyphInkBounds(15)!; // 'H'

    const rasteriser = new RecordingRasteriser();
    drive(mappedBytes, 0, {}, rasteriser);
    const paths = rasteriser.ops.filter(isPath);
    expect(paths).toHaveLength(1);
    const { minX, minY } = pathOpBounds(paths[0]!);
    const sizePt = 24;
    const scale = sizePt / head.unitsPerEm;
    expect(minX).toBeCloseTo(20 + expectedInk.xMin * scale, 1);
    expect(minY).toBeCloseTo(100 - 50 - expectedInk.yMax * scale, 1);
  });

  it("refuses a Type1 font whose embedded program is not CFF outlines", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      onePagePdf("BT /F1 24 Tf 20 50 Td (H) Tj ET", {
        pageResources: "/Resources << /Font << /F1 4 0 R >> >>",
        extraObjects: [
          [
            4,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Custom /FirstChar 0 /LastChar 255 /FontDescriptor 6 0 R >>",
          ],
          [6, "<< /Type /FontDescriptor /FontName /Custom /Flags 4 >>"],
        ],
      }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("PostScript program");
    expect(rasteriser.ops).toEqual([]);
  });

  it("refuses an unrecognised font subtype, naming it in the diagnostic", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      onePagePdf("BT /F1 24 Tf 20 50 Td (H) Tj ET", {
        pageResources: "/Resources << /Font << /F1 4 0 R >> >>",
        extraObjects: [[4, "<< /Type /Font /Subtype /Type3 >>"]],
      }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("a font of subtype Type3");
    expect(rasteriser.ops).toEqual([]);
  });
});

// --- Optional content: a rendering must take the viewer's side. ---

describe("renderPdfPage: optional-content visibility", () => {
  function ocRectPdf(): Uint8Array<ArrayBuffer> {
    const b = new SmallFixture();
    b.object(
      1,
      "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << /BaseState /ON /OFF [6 0 R] >> >> >>",
    );
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Properties << /L1 << /OC 6 0 R >> >> >> /Contents 5 0 R >>",
    );
    b.object(6, "<< /Type /OCG /Name (Watermark) >>");
    b.stream(
      5,
      "<< >>",
      enc("/OC /L1 BDC 10 10 30 20 re f EMC 60 10 30 20 re f"),
    );
    return b.classicXrefAndTrailer(6, "/Root 1 0 R");
  }

  it("does not draw content in a layer the default configuration leaves OFF", () => {
    const rasteriser = new RecordingRasteriser();
    drive(ocRectPdf(), 0, {}, rasteriser);
    const fills = rasteriser.ops.filter(isFillRect);
    expect(fills).toEqual([
      {
        kind: "fillRect",
        xPx: 60,
        yPx: 70,
        widthPx: 30,
        heightPx: 20,
        color: { r: 0, g: 0, b: 0 },
      },
    ]);
  });

  it("still draws content in a NAMED layer the default configuration leaves ON, alongside one it leaves OFF", () => {
    // Two named layers this time -- L1 (OFF) and L2 (ON, not listed in /OFF at all) -- so hiding every layer indiscriminately (rather than only the ones the default configuration actually turns off) would be indistinguishable from correct behaviour in the single-layer fixture above.
    const b = new SmallFixture();
    b.object(
      1,
      "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R 7 0 R] /D << /BaseState /ON /OFF [6 0 R] >> >> >>",
    );
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Properties << /L1 << /OC 6 0 R >> /L2 << /OC 7 0 R >> >> >> /Contents 5 0 R >>",
    );
    b.object(6, "<< /Type /OCG /Name (Watermark) >>");
    b.object(7, "<< /Type /OCG /Name (Body) >>");
    b.stream(
      5,
      "<< >>",
      enc("/OC /L1 BDC 10 10 30 20 re f EMC /OC /L2 BDC 60 10 30 20 re f EMC"),
    );
    const bytes = b.classicXrefAndTrailer(7, "/Root 1 0 R");
    const rasteriser = new RecordingRasteriser();
    drive(bytes, 0, {}, rasteriser);
    const fills = rasteriser.ops.filter(isFillRect);
    expect(fills).toEqual([
      {
        kind: "fillRect",
        xPx: 60,
        yPx: 70,
        widthPx: 30,
        heightPx: 20,
        color: { r: 0, g: 0, b: 0 },
      },
    ]);
  });
});
