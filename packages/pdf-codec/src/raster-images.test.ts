import { describe, expect, it } from "vitest";
import { SmallFixture } from "./test-support/raster-carlito";
import { zlibSync } from "fflate";
import { applyMatrix } from "./matrix";
import { renderPdfPage } from "./raster";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterPageGeometry,
} from "./raster";
import { inlineImagePdf } from "./test-support/pdf";

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

// Repoints a table record past the end of the file, the same technique embedded-font.test.ts's own dropTable uses — parseSfnt drops that one table entirely, exactly as it would for a genuinely truncated font, while every other table (head/maxp/glyf included) stays intact and readable.
// One page, 200 x 100 pt, with the caller's content stream and optional extra entries on the page dict and catalog. Objects 1 (catalog), 2 (pages), 3 (page), 5 (contents) are wired; object 4 is a standard Helvetica font resource so text fixtures have a /Font to select.
const isImage = (
  op: RasterDrawOp,
): op is Extract<RasterDrawOp, { kind: "image" }> => op.kind === "image";

// --- The port's geometry contract. ---

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
    // The port's top-left-origin unit square: (0,0) is the image's top-left, (1,1) its bottom-right. The image occupies page rect (10, 60)-(50, 80), i.e. device (10, 20)-(50, 40) after the y flip — if the flip or the CTM order were wrong, these corners would transpose.
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

// A Type0/Identity-H/CIDFontType2 fixture around the real vendored Carlito face — the exact dominant embedded-font shape mainstream producers emit and this package's own writer produces. The glyph IDs, advances, and units-per-em the fixture needs are read out of the same bytes with this package's own table parsers (legitimate here: the table parsers are independently tested against the real font files, and what is under test is the raster walk, not the fixture's arithmetic).
// A plain simple (non-Type0) /TrueType font resource: code -> Unicode through the PDF's own encoding (WinAnsi, since this face carries no Symbolic flag), then Unicode -> GID through the embedded program's own cmap — the whole other half of buildTextOutlineFace's own branch, entirely separate from the Type0/CID path type0CarlitoPdf drives.
