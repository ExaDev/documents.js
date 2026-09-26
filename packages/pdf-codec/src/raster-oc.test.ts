import { describe, expect, it } from "vitest";
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
const isFillRect = (
  op: RasterDrawOp,
): op is Extract<RasterDrawOp, { kind: "fillRect" }> => op.kind === "fillRect";
// --- The port's geometry contract. ---

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
    // Two named layers this time — L1 (OFF) and L2 (ON, not listed in /OFF at all) — so hiding every layer indiscriminately (rather than only the ones the default configuration actually turns off) would be indistinguishable from correct behaviour in the single-layer fixture above.
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
