import { describe, expect, it } from "vitest";
import type { PdfDiagnostic } from "./diagnostics";
import { PdfParseError } from "./diagnostics";
import { renderPdfPage } from "./raster";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterPageGeometry,
} from "./raster";
import { readPdf } from "./read";
import { ByteWriter } from "./bytes/writer";
import { twoPagesFirstWithoutResourcesPdf } from "./test-support/pdf";
import { cropBoxPdf, rotatedCropBoxPdf } from "./test-support/pdf-structures";

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
    // The rect at page point (10, 20) with extent 30x40 sits 40pt below the page's 100pt top edge, so its device top-left is (10, 100 - 60) = (10, 40) — the flip every consumer's OCR coordinate expectations ride on.
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
    expect(() => {
      void renderPdfPage(
        bytes,
        0,
        { scale: 1, dpi: 72 },
        new RecordingRasteriser(),
      );
    }).toThrow(/at most one of scale and dpi/);
    expect(() => {
      void renderPdfPage(bytes, 0, { scale: 0 }, new RecordingRasteriser());
    }).toThrow(/positive scale/);
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
    // A widthPt/heightPt boundary check written as two independent `> 0` guards has two ways to go wrong; the sibling case above already pins widthPt, so this pins heightPt on its own — a positive widthPt must not mask a degenerate heightPt.
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
    // clipLeft === clipRight exactly (200, the page's own right edge) — a genuine intersection-width check at its own zero boundary, distinct from the requested-widthPt guard above (which never sees this clipPt at all, since its own widthPt is a positive 30).
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
    expect(() => {
      void renderPdfPage(enc("not a pdf"), 0, {}, new RecordingRasteriser());
    }).toThrow(PdfParseError);
    expect(() => {
      void renderPdfPage(enc("not a pdf"), 0, {}, new RecordingRasteriser());
    }).toThrow(/no "%PDF-" header/);
    try {
      drive(enc("not a pdf"), 0, {}, new RecordingRasteriser());
      throw new Error("expected renderPdfPage to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PdfParseError);
      expect((error as PdfParseError).code).toBe("pdf/no-header");
    }
    expect(() => {
      void renderPdfPage(onePagePdf(content), 7, {}, new RecordingRasteriser());
    }).toThrow(/page index 7/);
    try {
      drive(onePagePdf(content), 7, {}, new RecordingRasteriser());
      throw new Error("expected renderPdfPage to throw");
    } catch (error) {
      expect((error as PdfParseError).code).toBe("pdf/page-index-out-of-range");
    }
  });

  it("does not find a %PDF- header planted past the search window's own 1024-byte limit", () => {
    // hasPdfHeader searches only a bounded prefix (ISO 32000-1 7.5.2 allows junk before the header, not an unbounded scan) — a header sitting well past that window is exactly as absent as no header at all.
    const junkPrefix = new Uint8Array(1030).fill(0x41); // 1030 > HEADER_SEARCH_WINDOW's own 1024
    const bytes = new Uint8Array([...junkPrefix, ...enc("%PDF-1.7\n")]);
    expect(() => {
      void renderPdfPage(bytes, 0, {}, new RecordingRasteriser());
    }).toThrow(/no "%PDF-" header/);
  });

  it("checks for an already-aborted signal before any parsing begins", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => {
      void renderPdfPage(
        onePagePdf(content),
        0,
        { signal: controller.signal },
        new RecordingRasteriser(),
      );
    }).toThrow(/Aborted/);
  });

  it("checks an already-aborted signal at entry even for a page with no /Resources, whose walk never reaches the per-item abort check at all", () => {
    // twoPagesFirstWithoutResourcesPdf's first page returns before interpretContentStream ever runs, so this is the ONLY throwIfAborted call reachable for it — unlike the top-of-module test above, whose fixture always has at least one item and so could throw from the per-item check even were the entry check removed entirely.
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
    expect(() => {
      void renderPdfPage(onePagePdf(content), 1, {}, new RecordingRasteriser());
    }).toThrow(
      /page index 1 is outside this document's page tree \(it declares 1 page\)$/,
    );
  });

  it("rejects a negative page index", () => {
    expect(() => {
      void renderPdfPage(
        onePagePdf(content),
        -1,
        {},
        new RecordingRasteriser(),
      );
    }).toThrow(/page index -1/);
  });

  it("names the page count plural for a multi-page document", () => {
    expect(() => {
      void renderPdfPage(
        twoPagesFirstWithoutResourcesPdf(),
        5,
        {},
        new RecordingRasteriser(),
      );
    }).toThrow(/it declares 2 pages\)$/);
  });

  it("falls back to /MediaBox and emits a diagnostic when /CropBox is degenerate", () => {
    const diagnostics: PdfDiagnostic[] = [];
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf(content, { pageEntries: "/CropBox [0 0 0 100] " }),
      0,
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
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
    // llx = -20 and lly = -30 both make the sum urx+llx (or ury+lly) negative — exactly the wrong-sign value a `+` in place of the real `-` would compute — while the real width (30) and height (40) stay positive and non-degenerate.
    const diagnostics: PdfDiagnostic[] = [];
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf(content, { pageEntries: "/CropBox [-20 -30 10 10] " }),
      0,
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
      rasteriser,
    );
    expect(diagnostics.some((d) => d.code === "pdf/invalid-crop-box")).toBe(
      false,
    );
    expect(rasteriser.geometry).toMatchObject({ widthPx: 30, heightPx: 40 });
  });

  it("translates by the visible region's own minY, not adds it, when the CropBox's own lower edge sits above the page's own origin", () => {
    // With no rotation the rotation matrix is the identity, so visibleRect is exactly the CropBox itself and visibleRect.minY = cropBox.lly = 30 directly — a clean, direct pin on the translation's own sign.
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
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
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
    // width = urx - llx = 200, height = ury - lly = 100 — urx + llx (300) or ury + lly (200) would both be wrong here precisely because the origin is non-zero.
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
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
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
    // Unlike the sibling test above (whose split falls after a number, already a complete token on its own), this one splits directly between two bare keywords — "re" ending one chunk, "f" starting the next. Without a separator the two concatenate into the single unrecognised keyword "ref", and the rect is never actually filled.
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
    drive(
      bytes,
      0,
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
      rasteriser,
    );
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
      // The region bounds document-outline.js's segmentPdfRegions would hand back for this figure: exactly PdfRegionBounds' shape, passed straight through as clipPt. This rect deliberately straddles the crop boundary, so the rendered region is the intersection with the visible page — the same clipping a viewer applies, not an error.
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

// flattenCubic exercised directly: every real caller reaches it only through curves recovered from actual PDF content streams, which are never carefully enough constructed to pin an exact subdivision count or force the recursion depth cap deterministically — both properties this suite verifies directly against hand-computed control points.
