import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import { buildCmapLookup } from "./cmap-table";
import type { PdfDiagnostic } from "./diagnostics";
import { PdfParseError } from "./diagnostics";
import { parseHead, parseMaxp } from "./font-tables";
import { parseGlyf } from "./glyf";
import { parseHmtx } from "./hmtx-table";
import type { GlyphContourPoint, GlyphOutline } from "./glyf-contours";
import type { Matrix } from "./matrix";
import { applyMatrix, BEZIER_KAPPA, IDENTITY_MATRIX } from "./matrix";
import {
  drawGlyphOutline,
  flattenCubic,
  glyphOutlineSubpaths,
  renderPdfPage,
} from "./raster";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterPageGeometry,
} from "./raster";
import { readPdf } from "./read";
import { parseSfnt } from "./sfnt";
import { ByteWriter } from "./bytes/writer";
import { STIX_TWO_MATH_FONT_BASE64 } from "./assets/stix-two-math-font";
import { base64ToBytes } from "byte-codec";
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

// Repoints a table record past the end of the file, the same technique embedded-font.test.ts's own dropTable uses -- parseSfnt drops that one table entirely, exactly as it would for a genuinely truncated font, while every other table (head/maxp/glyf included) stays intact and readable.
function dropSfntTable(bytes: Uint8Array<ArrayBuffer>, tag: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const recordOffset = 12 + i * 16;
    let found = "";
    for (let c = 0; c < 4; c++) {
      found += String.fromCharCode(view.getUint8(recordOffset + c));
    }
    if (found === tag) {
      view.setUint32(recordOffset + 8, bytes.length + 4);
      return;
    }
  }
  throw new Error(`the vendored font has no "${tag}" table to patch`);
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

  it("rejects a clipPt whose heightPt alone is zero, with a positive widthPt", () => {
    // A widthPt/heightPt boundary check written as two independent `> 0` guards has two ways to go wrong; the sibling case above already pins widthPt, so this pins heightPt on its own -- a positive widthPt must not mask a degenerate heightPt.
    expect(() =>
      drive(
        onePagePdf(content),
        0,
        { clipPt: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 0 } },
        new RecordingRasteriser(),
      ),
    ).toThrow(/positive widthPt and heightPt/);
  });

  it("rejects a clipPt that just touches the page's right edge with zero overlap width, a positive-widthPt clip the earlier guard cannot catch", () => {
    // clipLeft === clipRight exactly (200, the page's own right edge) -- a genuine intersection-width check at its own zero boundary, distinct from the requested-widthPt guard above (which never sees this clipPt at all, since its own widthPt is a positive 30).
    expect(() =>
      drive(
        onePagePdf(content),
        0,
        { clipPt: { xPt: 200, yPt: 20, widthPt: 30, heightPt: 40 } },
        new RecordingRasteriser(),
      ),
    ).toThrow(/does not intersect/);
  });

  it("rejects a clipPt that just touches the page's top edge with zero overlap height, the same boundary on the other axis", () => {
    // clipBottom === clipTop exactly (100, the page's own top edge).
    expect(() =>
      drive(
        onePagePdf(content),
        0,
        { clipPt: { xPt: 20, yPt: 100, widthPt: 30, heightPt: 40 } },
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
    try {
      drive(enc("not a pdf"), 0, {}, new RecordingRasteriser());
      throw new Error("expected renderPdfPage to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PdfParseError);
      expect((error as PdfParseError).code).toBe("pdf/no-header");
    }
    expect(() =>
      renderPdfPage(onePagePdf(content), 7, {}, new RecordingRasteriser()),
    ).toThrow(/page index 7/);
    try {
      drive(onePagePdf(content), 7, {}, new RecordingRasteriser());
      throw new Error("expected renderPdfPage to throw");
    } catch (error) {
      expect((error as PdfParseError).code).toBe("pdf/page-index-out-of-range");
    }
  });

  it("does not find a %PDF- header planted past the search window's own 1024-byte limit", () => {
    // hasPdfHeader searches only a bounded prefix (ISO 32000-1 7.5.2 allows junk before the header, not an unbounded scan) -- a header sitting well past that window is exactly as absent as no header at all.
    const junkPrefix = new Uint8Array(1030).fill(0x41); // 1030 > HEADER_SEARCH_WINDOW's own 1024
    const bytes = new Uint8Array([...junkPrefix, ...enc("%PDF-1.7\n")]);
    expect(() =>
      renderPdfPage(bytes, 0, {}, new RecordingRasteriser()),
    ).toThrow(/no "%PDF-" header/);
  });

  it("checks for an already-aborted signal before any parsing begins", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      renderPdfPage(
        onePagePdf(content),
        0,
        { signal: controller.signal },
        new RecordingRasteriser(),
      ),
    ).toThrow(/Aborted/);
  });

  it("checks an already-aborted signal at entry even for a page with no /Resources, whose walk never reaches the per-item abort check at all", () => {
    // twoPagesFirstWithoutResourcesPdf's first page returns before interpretContentStream ever runs, so this is the ONLY throwIfAborted call reachable for it -- unlike the top-of-module test above, whose fixture always has at least one item and so could throw from the per-item check even were the entry check removed entirely.
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      drive(
        twoPagesFirstWithoutResourcesPdf(),
        0,
        { signal: controller.signal },
        new RecordingRasteriser(),
      ),
    ).toThrow(/Aborted/);
  });

  it("checks the signal again on every item in the content-stream walk, not only once at entry", () => {
    // Two rects in one content stream: the signal is aborted from inside the rasteriser's own first draw() call, so a per-item abort check (not just the one at entry) is the only thing that can catch it before the second item paints.
    const controller = new AbortController();
    class AbortingRasteriser extends RecordingRasteriser {
      override draw(op: RasterDrawOp): void {
        super.draw(op);
        controller.abort();
      }
    }
    const twoRects = "1 0 0 rg 10 10 20 20 re f 0 1 0 rg 50 10 20 20 re f";
    expect(() =>
      drive(
        onePagePdf(twoRects),
        0,
        { signal: controller.signal },
        new AbortingRasteriser(),
      ),
    ).toThrow(/Aborted/);
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
        message:
          "page /CropBox is degenerate (zero width or height); falling back to the /MediaBox as the visible region",
      }),
    );
  });

  it("does not fall back for a CropBox whose corners have a negative-but-non-degenerate origin, where a mutated urx+llx (or ury+lly) sum would wrongly read as degenerate", () => {
    // llx = -20 and lly = -30 both make the sum urx+llx (or ury+lly) negative -- exactly the wrong-sign value a `+` in place of the real `-` would compute -- while the real width (30) and height (40) stay positive and non-degenerate.
    const diagnostics: PdfDiagnostic[] = [];
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf(content, { pageEntries: "/CropBox [-20 -30 10 10] " }),
      0,
      { sink: (d) => diagnostics.push(d) },
      rasteriser,
    );
    expect(diagnostics.some((d) => d.code === "pdf/invalid-crop-box")).toBe(
      false,
    );
    expect(rasteriser.geometry).toMatchObject({ widthPx: 30, heightPx: 40 });
  });

  it("translates by the visible region's own minY, not adds it, when the CropBox's own lower edge sits above the page's own origin", () => {
    // With no rotation the rotation matrix is the identity, so visibleRect is exactly the CropBox itself and visibleRect.minY = cropBox.lly = 30 directly -- a clean, direct pin on the translation's own sign.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("1 0 0 rg 10 40 30 10 re f", {
        pageEntries: "/CropBox [0 30 200 100] ",
      }),
      0,
      {},
      rasteriser,
    );
    // Crop-relative y = 40 - 30 = 10, height 10, crop height = 100 - 30 = 70: device y = 70 - (10 + 10) = 50. A `+30` translation would instead place this well outside (or entirely off) the cropped region.
    expect(rasteriser.ops.find(isFillRect)).toMatchObject({ xPx: 10, yPx: 50 });
  });

  it("falls back for a CropBox degenerate in height alone, its width perfectly healthy", () => {
    // llx=0/urx=30 keeps the width check (urx - llx = 30 > 0) from ever triggering on its own, so a genuine crop is only forced by the height term (ury - lly = 0) being evaluated independently rather than the whole OR condition being pinned by the sibling test's width-only degeneracy.
    const diagnostics: PdfDiagnostic[] = [];
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf(content, { pageEntries: "/CropBox [0 100 30 100] " }),
      0,
      { sink: (d) => diagnostics.push(d) },
      rasteriser,
    );
    expect(diagnostics.some((d) => d.code === "pdf/invalid-crop-box")).toBe(
      true,
    );
    expect(rasteriser.geometry).toMatchObject({ widthPx: 200, heightPx: 100 });
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

  it("reads a page whose /Contents is an array of streams, concatenated with a newline separator, not just a single stream", () => {
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents [5 0 R 6 0 R] >>",
    );
    b.object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    // Split mid-operator-list, not mid-token: the first chunk's own final token ("40") is a complete number on its own, so the separator the reader inserts between chunks only ever falls on whitespace a content stream already treats as insignificant.
    b.stream(5, "<< >>", enc("1 0 0 rg 10 20 30 40"));
    b.stream(6, "<< >>", enc("re f"));
    const bytes = b.classicXrefAndTrailer(6, "/Root 1 0 R");
    const rasteriser = new RecordingRasteriser();
    drive(bytes, 0, {}, rasteriser);
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

  it("keeps the array's own two keyword tokens apart across the chunk boundary, not merged into one unrecognised keyword", () => {
    // Unlike the sibling test above (whose split falls after a number, already a complete token on its own), this one splits directly between two bare keywords -- "re" ending one chunk, "f" starting the next. Without a separator the two concatenate into the single unrecognised keyword "ref", and the rect is never actually filled.
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents [5 0 R 6 0 R] >>",
    );
    b.object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    b.stream(5, "<< >>", enc("1 0 0 rg 10 20 30 40 re"));
    b.stream(6, "<< >>", enc("f"));
    const bytes = b.classicXrefAndTrailer(6, "/Root 1 0 R");
    const rasteriser = new RecordingRasteriser();
    drive(bytes, 0, {}, rasteriser);
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

  it("subdivides on the LARGER of the two control points' chord distances, not the smaller", () => {
    // c1 sits almost exactly on the chord (dist1 ~ 0.001, well under the flatness tolerance) while c2 sits far off it (dist2 = 5, far over) -- a curve constructed so the two distances disagree about whether this piece is flat enough to stop. Only checking the larger one is correct: a single wildly-off control point must still force a split even when its sibling is nearly collinear.
    const points = flattenCubic(
      { x: 0, y: 0 },
      { x: 5, y: 0.001 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    );
    expect(points.length).toBeGreaterThan(1);
  });

  it("treats the flatness check as <= at the tolerance boundary, not <", () => {
    // Both control points sit exactly 0.05 page-space units off the chord -- the module's own STROKE_FLATTEN_TOLERANCE_PX. At exactly the boundary the piece must already count as flat enough (<=) and stop without subdividing; a strict < would subdivide once more here, doubling the point count.
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
    // decodeGlyphOutline's own contract only guarantees a non-empty contours array, not that every contour individually clears the 3-point floor -- the same tooShort shape above, but driven through drawGlyphOutline's own draw-or-skip decision rather than glyphOutlineSubpaths directly.
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
    // On, off, on: the sole off-curve point never triggers the mid-pair emit (only one point in its run), so it folds into the following on-curve point's own quad -- exactly two segments (one line, one quad), the fewest a non-degenerate (length >= 3) contour can ever produce.
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
    // Stored order [A(off) B(on) C(off) D(off) E(on) F(off)]: firstOn = 1, so the walk starts at B, continues C, D, E, F, and wraps to A -- exercising the on-curve-with-pending quad (B->C->mid(C,D)), the consecutive-off-curve implied-midpoint quad (twice: C/D and F/A), and the final trailing quad closing a still-pending control point (A) back to the rotated start (B).
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
    // A pure translation confirms the matrix reaches the start point, the line endpoint, AND the quad's own control-derived points -- not only the segment's final on-curve xPx/yPx.
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
    // A single "m ... l S" open segment is exactly the shape detectLine reduces to an ExtractedLine (interpret.ts), so this actually drives drawLine's own dotted branch, not drawPath's -- drawPath's dotted branch needs a path detectLine won't collapse, which the two-segment test below covers. At scale 1, multiplying and dividing widthPt by pixelsPerPt are indistinguishable, so this pins it at scale 3.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 20 20 m 60 20 l S"),
      0,
      { scale: 3 },
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    // Device length 40pt x 3 = 120px, spacing = max(widthPx x 2, 1) = 12px: dots at 0, 12, ..., 120 -- 11 of them.
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
    // Two straight segments in one open subpath: detectLine only ever collapses a subpath of exactly one segment, so this one stays an ExtractedPath and genuinely drives drawPath's own "line" kind branch -- the sibling test above, despite drawing a straight line, never reaches this branch at all.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 20 20 m 60 20 l 60 60 l S"),
      0,
      {},
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    // Two 40pt segments, spacing = max(2 x 2, 1) = 4px: 11 dots each (0, 4, ..., 40), 22 total -- including the shared corner point drawn once by each segment's own end/start.
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
    // A cubic whose control points are collinear with its endpoints flattens to just its own endpoint (the same fact flattenCubic's own suite pins directly), so the resulting dot train is exactly as predictable as the line-segment case above -- this isolates drawPath's cubic branch from its line branch, which the line-only test above never touches.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 20 20 m 40 20 60 20 80 20 c S"),
      0,
      {},
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    // Device length 60pt, spacing = max(2 x 2, 1) = 4px: dots at 0, 4, ..., 60 -- 16 of them.
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
    // The segment's own length (180pt) is an exact multiple of the spacing (4pt), so a dot lands exactly on the final point too -- this pins that boundary (`distance <= length`) as an exact count, not just "more than a few": 180/4 + 1 = 46 dots, one at every multiple of 4 from 0 through 180 inclusive.
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
    // The sibling test above is purely horizontal (p1.y === p2.y throughout), which cannot distinguish `p1.y + (p2.y - p1.y) * t` from a sign-flipped or operand-swapped variant of the same expression -- every dot would land at the same y regardless. A diagonal segment where y genuinely varies with t is the only way to pin that arithmetic.
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("[0 4] 0 d 1 J 2 w 0 0 0 RG 10 10 m 50 50 l S"),
      0,
      {},
      rasteriser,
    );
    const squares = rasteriser.ops.filter(isFillRect);
    // length = hypot(40, 40), spacing = 4 -- not an exact multiple, so the dot count is governed by the loop's own `<=` boundary rather than pinned to a round number; what matters here is each dot's own position, not the count.
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

// A plain simple (non-Type0) /TrueType font resource: code -> Unicode through the PDF's own encoding (WinAnsi, since this face carries no Symbolic flag), then Unicode -> GID through the embedded program's own cmap -- the whole other half of buildTextOutlineFace's own branch, entirely separate from the Type0/CID path type0CarlitoPdf drives.
function trueTypeCarlitoPdf(
  text: string,
  overrides: {
    readonly fontDescriptorBody?: string;
    readonly fontBytes?: Uint8Array<ArrayBuffer>;
  } = {},
): Uint8Array<ArrayBuffer> {
  const fontBytes = overrides.fontBytes ?? carlitoRegularBytes();
  const b = new SmallFixture();
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  b.object(
    4,
    "<< /Type /Font /Subtype /TrueType /BaseFont /Carlito /FirstChar 0 /LastChar 255 /FontDescriptor 8 0 R >>",
  );
  b.object(
    8,
    overrides.fontDescriptorBody ??
      "<< /Type /FontDescriptor /FontName /Carlito /Flags 32 /FontFile2 9 0 R >>",
  );
  b.stream(9, `<< /Length1 ${fontBytes.length} >>`, fontBytes);
  b.stream(5, "<< >>", enc(`BT /F1 24 Tf 20 50 Td (${text}) Tj ET`));
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

  it("draws no path at all for a glyph with an empty outline (a space), while still advancing past it", () => {
    const bytes = type0CarlitoPdf("H H");
    const rasteriser = new RecordingRasteriser();
    drive(bytes, 0, {}, rasteriser);
    const glyphOps = rasteriser.ops.filter(isPath);
    // Two H's painted, the space between them painting nothing -- not three ops, and not two ops sitting on top of each other.
    expect(glyphOps.length).toBe(2);
    const sfnt = parseSfnt(carlitoRegularBytes())!;
    const cmap = buildCmapLookup(sfnt)!;
    const hmtx = parseHmtx(sfnt);
    const head = parseHead(sfnt)!;
    const spaceAdvancePt =
      (hmtx.advanceWidth(cmap(" ".codePointAt(0)!)!) / head.unitsPerEm) * 24;
    const hAdvancePt =
      (hmtx.advanceWidth(cmap("H".codePointAt(0)!)!) / head.unitsPerEm) * 24;
    const first = pathOpBounds(glyphOps[0]!);
    const second = pathOpBounds(glyphOps[1]!);
    expect(second.minX - first.minX).toBeCloseTo(
      hAdvancePt + spaceAdvancePt,
      2,
    );
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

  it("draws a simple TrueType font's own glyphs through WinAnsi code -> Unicode -> the program's own cmap", () => {
    const rasteriser = new RecordingRasteriser();
    drive(trueTypeCarlitoPdf("H"), 0, {}, rasteriser);
    const glyphOps = rasteriser.ops.filter(isPath);
    expect(glyphOps.length).toBe(1);
    const sfnt = parseSfnt(carlitoRegularBytes())!;
    const head = parseHead(sfnt)!;
    const cmap = buildCmapLookup(sfnt)!;
    const glyf = parseGlyf(sfnt, {
      numGlyphs: parseMaxp(sfnt)!.numGlyphs,
      indexToLocFormat: head.indexToLocFormat,
    })!;
    const ink = glyf.glyphInkBounds(cmap("H".codePointAt(0)!)!)!;
    const sizePt = 24;
    const bounds = pathOpBounds(glyphOps[0]!);
    expect(bounds.minX).toBeCloseTo(
      20 + (ink.xMin / head.unitsPerEm) * sizePt,
      1,
    );
    expect(bounds.minY).toBeCloseTo(
      100 - 50 - (ink.yMax / head.unitsPerEm) * sizePt,
      1,
    );
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

  it("resolves a font resource's outline face once per font dictionary, not once per run that references it", () => {
    // Two separate text runs through the same /F1 resource (a standard-14 face with no embedded program): resolveTextOutlineFace's own cache means buildTextOutlineFace, and the diagnostic it emits, runs exactly once -- not once per run naming the same already-diagnosed font all over again.
    const diagnostics: PdfDiagnostic[] = [];
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("BT /F1 24 Tf 20 60 Td (A) Tj 0 -20 Td (B) Tj ET"),
      0,
      { sink: (d) => diagnostics.push(d) },
      rasteriser,
    );
    expect(
      diagnostics.filter((d) => d.code === "raster/text-outlines-unavailable"),
    ).toHaveLength(1);
    expect(rasteriser.ops).toEqual([]);
  });

  // A bare Type0/CIDFontType2 skeleton around the real vendored Carlito face, with every dict entry a caller can override -- the same font bytes type0CarlitoPdf uses, but exposing the descendant/descriptor/encoding shape directly so each of buildTextOutlineFace's own branch conditions can be driven independently of the others.
  function type0Skeleton(overrides: {
    readonly encoding?: string;
    readonly descendantFontsEntry?: string;
    readonly descendantExtra?: string;
    readonly cidToGidMap?: string;
    readonly fontDescriptorBody?: string;
    readonly fontFileKey?: string;
    readonly fontFileBytes?: Uint8Array<ArrayBuffer>;
    readonly content?: string;
  }): Uint8Array<ArrayBuffer> {
    const fontBytes = overrides.fontFileBytes ?? carlitoRegularBytes();
    const fontFileKey = overrides.fontFileKey ?? "FontFile2";
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
        `<< /Type /FontDescriptor /FontName /Carlito /Flags 32 /${fontFileKey} 9 0 R >>`,
    );
    b.stream(9, `<< /Length1 ${fontBytes.length} >>`, fontBytes);
    b.stream(
      5,
      "<< >>",
      enc(overrides.content ?? "BT /F1 24 Tf 20 50 Td <0000> Tj ET"),
    );
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

  it("refuses a simple TrueType font with no readable embedded program", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      trueTypeCarlitoPdf("H", {
        fontDescriptorBody:
          "<< /Type /FontDescriptor /FontName /Carlito /Flags 32 >>",
      }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("no /FontDescriptor or no readable embedded program");
    expect(rasteriser.ops).toEqual([]);
  });

  it("refuses a Type0 font whose /Encoding is neither Identity CMap", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      type0Skeleton({ encoding: "/90ms-RKSJ-H" }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("neither Identity-H nor Identity-V");
    expect(rasteriser.ops).toEqual([]);
  });

  // The defect ExaDev/documents.js#1358 records: a vertically set run's glyphs were advanced along x like any other, so a whole column landed stacked on top of itself at one point. Each glyph's ink is reduced to the centre of its own path op's bounding box, which is enough to say which way the run ran without depending on the vendored face's own outlines.
  function glyphCentres(
    bytes: Uint8Array<ArrayBuffer>,
  ): { x: number; y: number }[] {
    const rasteriser = new RecordingRasteriser();
    drive(bytes, 0, { sink: () => undefined }, rasteriser);
    return rasteriser.ops.flatMap((op) => {
      if (op.kind !== "path") {
        return [];
      }
      const points = op.subpaths.flatMap((subpath) => [
        { x: subpath.startXPx, y: subpath.startYPx },
        ...subpath.segments.map((segment) => ({
          x: segment.xPx,
          y: segment.yPx,
        })),
      ]);
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return [
        {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
        },
      ];
    });
  }

  const TWO_GLYPH_CONTENT = "BT /F1 24 Tf 20 50 Td <00000000> Tj ET";

  it("draws a horizontal run's glyphs side by side", () => {
    const centres = glyphCentres(type0Skeleton({ content: TWO_GLYPH_CONTENT }));
    expect(centres).toHaveLength(2);
    expect(centres[1]?.x).not.toBeCloseTo(centres[0]?.x ?? 0, 3);
    expect(centres[1]?.y).toBeCloseTo(centres[0]?.y ?? 0, 6);
  });

  it("draws a vertical run's glyphs down the page rather than on top of each other", () => {
    const centres = glyphCentres(
      type0Skeleton({ encoding: "/Identity-V", content: TWO_GLYPH_CONTENT }),
    );
    expect(centres).toHaveLength(2);
    expect(centres[1]?.x).toBeCloseTo(centres[0]?.x ?? 0, 6);
    expect(centres[1]?.y).not.toBeCloseTo(centres[0]?.y ?? 0, 3);
  });

  it("centres each vertical glyph over the column by its own position vector", () => {
    // Widening one CID changes its default position vector, which is half its own width, and so moves that glyph sideways within the column. Comparing the same two glyphs rendered twice, once with equal widths and once with the second halved, isolates that shift from the glyphs' own differing outlines, which cancel exactly between the two renderings. Half of the 500/1000 em difference at 24pt is six points, and only the second glyph moves: the run's own matrices already carry the first glyph's vector.
    const twoCids = "BT /F1 24 Tf 20 50 Td <00000001> Tj ET";
    const equal = glyphCentres(
      type0Skeleton({
        encoding: "/Identity-V",
        descendantExtra: "/DW 1000",
        content: twoCids,
      }),
    );
    const halved = glyphCentres(
      type0Skeleton({
        encoding: "/Identity-V",
        descendantExtra: "/DW 1000 /W [1 [500]]",
        content: twoCids,
      }),
    );
    expect(equal).toHaveLength(2);
    expect(halved).toHaveLength(2);
    expect((halved[0]?.x ?? 0) - (equal[0]?.x ?? 0)).toBeCloseTo(0, 6);
    expect((halved[1]?.x ?? 0) - (equal[1]?.x ?? 0)).toBeCloseTo(6, 3);
  });

  it("raises a vertical glyph by its own position vector's y", () => {
    // The same comparison along the other axis, where only /W2 can vary the vector: the second CID's y drops from /DW2's 880/1000 em to 500/1000, so that glyph alone moves by 380/1000 em, which at 24pt is 9.12 points.
    const twoCids = "BT /F1 24 Tf 20 50 Td <00000001> Tj ET";
    const shared = glyphCentres(
      type0Skeleton({
        encoding: "/Identity-V",
        descendantExtra: "/DW 1000 /DW2 [880 -1000]",
        content: twoCids,
      }),
    );
    const lowered = glyphCentres(
      type0Skeleton({
        encoding: "/Identity-V",
        descendantExtra: "/DW 1000 /DW2 [880 -1000] /W2 [1 [-1000 500 500]]",
        content: twoCids,
      }),
    );
    expect((lowered[0]?.y ?? 0) - (shared[0]?.y ?? 0)).toBeCloseTo(0, 6);
    expect(Math.abs((lowered[1]?.y ?? 0) - (shared[1]?.y ?? 0))).toBeCloseTo(
      9.12,
      2,
    );
  });

  it("accepts Identity-V, whose CID mapping is the same identity one set vertically", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      type0Skeleton({ encoding: "/Identity-V" }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable"),
    ).toBe(undefined);
    expect(rasteriser.ops.length).toBeGreaterThan(0);
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

  it("names an unstated descendant subtype as (none), not a blank or undefined string", () => {
    const bytes = type0Skeleton({});
    const text = new TextDecoder("latin1").decode(bytes);
    const patched = new TextEncoder().encode(
      text.replace("/Subtype /CIDFontType2 ", ""),
    );
    const { diagnostics, rasteriser } = refusalDiagnostics(patched);
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("a descendant font of subtype (none)");
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

  it("reads an embedded program from /FontFile3 when /FontFile2 is absent, not only from /FontFile2", () => {
    // openEmbeddedProgram tries FontFile2 then FontFile3 in a loop -- a descriptor carrying only the latter is the only way to prove the loop actually reaches its second key rather than stopping after the first.
    const { rasteriser } = refusalDiagnostics(
      type0Skeleton({ fontFileKey: "FontFile3" }),
    );
    expect(rasteriser.ops.filter(isPath).length).toBeGreaterThan(0);
  });

  it("detects a bare CFF program in /FontFile3 by its exact 3-byte header, not a byte more or fewer", () => {
    const cffHeader = (): PdfDiagnostic[] =>
      refusalDiagnostics(
        type0Skeleton({
          fontFileKey: "FontFile3",
          fontFileBytes: new Uint8Array([0x01, 0x00, 0x04]),
        }),
      ).diagnostics;
    expect(
      cffHeader().find((d) => d.code === "raster/text-cff-outlines"),
    ).toBeDefined();
  });

  it("detects CFF outlines wrapped in an OTTO sfnt container by its 'CFF ' table, not only a bare CFF header", () => {
    // The real, vendored STIX Two Math font is a genuine OTTO container carrying a 'CFF ' table -- an /OpenType-wrapped CFF program is a legal /FontFile3 value per ISO 32000-1, distinct from the bare-CFF-header case above.
    const { diagnostics } = refusalDiagnostics(
      type0Skeleton({
        fontFileKey: "FontFile3",
        fontFileBytes: base64ToBytes(STIX_TWO_MATH_FONT_BASE64),
      }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-cff-outlines"),
    ).toBeDefined();
  });

  it("does not mistake a too-short FontFile3 stream, or one byte wrong in the header, for a CFF program", () => {
    const isCff = (bytes: Uint8Array<ArrayBuffer>): boolean =>
      refusalDiagnostics(
        type0Skeleton({ fontFileKey: "FontFile3", fontFileBytes: bytes }),
      ).diagnostics.some((d) => d.code === "raster/text-cff-outlines");
    // Exactly 2 bytes: the length >= 3 guard alone must refuse this before any byte is even read.
    expect(isCff(new Uint8Array([0x01, 0x00]))).toBe(false);
    // Each byte individually wrong, otherwise a valid-looking header.
    expect(isCff(new Uint8Array([0x02, 0x00, 0x04]))).toBe(false);
    expect(isCff(new Uint8Array([0x01, 0x01, 0x04]))).toBe(false);
    expect(isCff(new Uint8Array([0x01, 0x00, 0x05]))).toBe(false);
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

  it("ignores a trailing unpaired byte in a /CIDToGIDMap stream rather than reading it as a further entry", () => {
    // A 3-byte map declares exactly one 2-byte entry (CID 0 -> GID 15); the loop's own `i + 1 < length` bound must stop before the stray third byte, not read it paired with a phantom fourth. Were it read anyway, CID 1 would land on GID (0x00 << 8 | 0), i.e. GID 0 (.notdef) -- which Carlito's own .notdef genuinely draws (4 contours), so a wrongly-read entry paints a second, wrong path rather than silently doing nothing.
    const cidToGidMapBytes = new Uint8Array([0x00, 0x0f, 0x00]);
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
    // CID 0 (mapped, drawable) followed by CID 1 (past the map's one real entry).
    b.stream(5, "<< >>", enc("BT /F1 24 Tf 20 50 Td <00000001> Tj ET"));
    const mappedBytes = b.classicXrefAndTrailer(10, "/Root 1 0 R");

    const rasteriser = new RecordingRasteriser();
    drive(mappedBytes, 0, {}, rasteriser);
    expect(rasteriser.ops.filter(isPath)).toHaveLength(1);
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

  it("refuses an /MMType1 font the same way as a plain /Type1, not falling through to the unrecognised-subtype branch", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      onePagePdf("BT /F1 24 Tf 20 50 Td (H) Tj ET", {
        pageResources: "/Resources << /Font << /F1 4 0 R >> >>",
        extraObjects: [
          [
            4,
            "<< /Type /Font /Subtype /MMType1 /BaseFont /Custom /FirstChar 0 /LastChar 255 /FontDescriptor 6 0 R >>",
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

  it("routes a Type1 font's own genuinely embedded CFF program through the shared CFF refusal, rather than assuming Type1 always means no outlines at all", () => {
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    );
    b.object(
      4,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Custom /FirstChar 0 /LastChar 255 /FontDescriptor 6 0 R >>",
    );
    b.object(
      6,
      "<< /Type /FontDescriptor /FontName /Custom /Flags 4 /FontFile3 7 0 R >>",
    );
    b.stream(7, "<< >>", new Uint8Array([0x01, 0x00, 0x04]));
    b.stream(5, "<< >>", enc("BT /F1 24 Tf 20 50 Td (H) Tj ET"));
    const { diagnostics, rasteriser } = refusalDiagnostics(
      b.classicXrefAndTrailer(7, "/Root 1 0 R"),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-cff-outlines")?.message,
    ).toBe(
      "font resource /F1 (Custom) carries CFF outlines; this raster surface fills sfnt (TrueType/glyf) outlines only, so its text is not rendered rather than approximated",
    );
    expect(rasteriser.ops).toEqual([]);
  });

  it("names a diagnostic's face by /Subtype when a Type0 font has no /BaseFont, for the CFF-descendant refusal too", () => {
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    );
    b.object(
      4,
      "<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [6 0 R] >>",
    );
    b.object(
      6,
      "<< /Type /Font /Subtype /CIDFontType0 /FontDescriptor 7 0 R >>",
    );
    b.object(7, "<< /Type /FontDescriptor /Flags 4 >>");
    b.stream(5, "<< >>", enc("BT /F1 12 Tf 10 50 Td <0041> Tj ET"));
    const { diagnostics } = refusalDiagnostics(
      b.classicXrefAndTrailer(7, "/Root 1 0 R"),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-cff-outlines")?.message,
    ).toContain("(Type0)");
  });

  it("names a font dictionary with no /Subtype at all as (none), the same fallback the descendant-subtype refusal uses", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      onePagePdf("BT /F1 24 Tf 20 50 Td (H) Tj ET", {
        pageResources: "/Resources << /Font << /F1 4 0 R >> >>",
        extraObjects: [[4, "<< /Type /Font /BaseFont /Custom >>"]],
      }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("a font of subtype (none)");
    expect(rasteriser.ops).toEqual([]);
  });

  it("names a diagnostic's face by /Subtype when /BaseFont is absent, not the bare fallback", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      onePagePdf("BT /F1 24 Tf 20 50 Td (H) Tj ET", {
        pageResources: "/Resources << /Font << /F1 4 0 R >> >>",
        extraObjects: [
          [
            4,
            "<< /Type /Font /Subtype /Type1 /FirstChar 0 /LastChar 255 /FontDescriptor 6 0 R >>",
          ],
          [6, "<< /Type /FontDescriptor /Flags 4 >>"],
        ],
      }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("(Type1)");
    expect(rasteriser.ops).toEqual([]);
  });

  it("falls all the way back to the bare word (font) when neither /BaseFont nor /Subtype is stated", () => {
    const { diagnostics, rasteriser } = refusalDiagnostics(
      onePagePdf("BT /F1 24 Tf 20 50 Td (H) Tj ET", {
        pageResources: "/Resources << /Font << /F1 4 0 R >> >>",
        extraObjects: [[4, "<< /Type /Font >>"]],
      }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("(font)");
    expect(rasteriser.ops).toEqual([]);
  });

  it("refuses a simple TrueType font whose embedded program is CFF outlines, not sfnt glyf", () => {
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    );
    b.object(
      4,
      "<< /Type /Font /Subtype /TrueType /BaseFont /Custom /FirstChar 0 /LastChar 255 /FontDescriptor 6 0 R >>",
    );
    b.object(
      6,
      "<< /Type /FontDescriptor /FontName /Custom /Flags 32 /FontFile2 7 0 R >>",
    );
    b.stream(7, "<< >>", new Uint8Array([0x01, 0x00, 0x04]));
    b.stream(5, "<< >>", enc("BT /F1 24 Tf 20 50 Td (H) Tj ET"));
    const { diagnostics, rasteriser } = refusalDiagnostics(
      b.classicXrefAndTrailer(7, "/Root 1 0 R"),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-cff-outlines"),
    ).toBeDefined();
    expect(rasteriser.ops).toEqual([]);
  });

  it("refuses a simple TrueType font's embedded program when it carries no usable Unicode cmap subtable", () => {
    // dropTable repoints the 'cmap' table record past the end of the file -- parseSfnt drops it, exactly as it would for a genuinely truncated font -- while head/maxp/glyf stay intact, so openEmbeddedProgram still classifies this as a fillable "glyf" program; only buildCmapLookup finds nothing to resolve a code point through.
    const patched = new Uint8Array(carlitoRegularBytes());
    dropSfntTable(patched, "cmap");
    const { diagnostics, rasteriser } = refusalDiagnostics(
      trueTypeCarlitoPdf("H", { fontBytes: patched }),
    );
    expect(
      diagnostics.find((d) => d.code === "raster/text-outlines-unavailable")
        ?.message,
    ).toContain("no usable Unicode cmap subtable");
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
