import { describe, expect, it } from "vitest";
import {
  trueTypeCarlitoPdf,
  type0CarlitoPdf,
} from "./test-support/raster-carlito";
import { buildCmapLookup } from "./cmap-table";
import { parseHead, parseMaxp } from "./font-tables";
import { parseGlyf } from "./glyf";
import { parseHmtx } from "./hmtx-table";
import { renderPdfPage } from "./raster";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterPageGeometry,
} from "./raster";
import { readPdf } from "./read";
import { parseSfnt } from "./sfnt";
import { carlitoRegularBytes } from "./test-support/fonts";
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

// The same minimal classic-xref shape src/test-support/pdf.ts's FixtureBuilder produces, locally: a header line, objects appended with offset tracking, one or more content streams, and a classic table in which an object number this fixture never wrote takes a free-list entry rather than being required to exist (several fixtures below deliberately leave gaps in the numbering for their font-descriptor chains).

// Repoints a table record past the end of the file, the same technique embedded-font.test.ts's own dropTable uses — parseSfnt drops that one table entirely, exactly as it would for a genuinely truncated font, while every other table (head/maxp/glyf included) stays intact and readable.
// One page, 200 x 100 pt, with the caller's content stream and optional extra entries on the page dict and catalog. Objects 1 (catalog), 2 (pages), 3 (page), 5 (contents) are wired; object 4 is a standard Helvetica font resource so text fixtures have a /Font to select.
const isPath = (
  op: RasterDrawOp,
): op is Extract<RasterDrawOp, { kind: "path" }> => op.kind === "path";
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
    // First glyph's ink window, straight from Carlito's own declared box: page x [20 + xMin/em*24, 20 + xMax/em*24], y from the baseline at 50 up by yMax/em*24 — flipped into device space. This is the placement assertion: wrong matrix order, missing unitsPerEm division, or a lost y flip all move it.
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
    // Two H's painted, the space between them painting nothing — not three ops, and not two ops sitting on top of each other.
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
