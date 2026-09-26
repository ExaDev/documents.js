import { describe, expect, it } from "vitest";
import {
  SmallFixture,
  trueTypeCarlitoPdf,
} from "./test-support/raster-carlito";
import type { PdfDiagnostic } from "./diagnostics";
import { parseHead, parseMaxp } from "./font-tables";
import { parseGlyf } from "./glyf";
import { renderPdfPage } from "./raster";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterPageGeometry,
} from "./raster";
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

function enc(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

// The same minimal classic-xref shape src/test-support/pdf.ts's FixtureBuilder produces, locally: a header line, objects appended with offset tracking, one or more content streams, and a classic table in which an object number this fixture never wrote takes a free-list entry rather than being required to exist (several fixtures below deliberately leave gaps in the numbering for their font-descriptor chains).

// Repoints a table record past the end of the file, the same technique embedded-font.test.ts's own dropTable uses — parseSfnt drops that one table entirely, exactly as it would for a genuinely truncated font, while every other table (head/maxp/glyf included) stays intact and readable.
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

describe("renderPdfPage: text refusals are named, never approximated (continued)", () => {
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
    return { diagnostics, rasteriser };
  }
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
    // CID 0 (the shown code) maps to GID 15 ('H') via the stream — Identity would instead look up GID 0 (.notdef), a completely different, much smaller shape. type0Skeleton has no stream-object escape hatch for the map itself, so this one is built directly rather than bending the helper further.
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
    // A 3-byte map declares exactly one 2-byte entry (CID 0 -> GID 15); the loop's own `i + 1 < length` bound must stop before the stray third byte, not read it paired with a phantom fourth. Were it read anyway, CID 1 would land on GID (0x00 << 8 | 0), i.e. GID 0 (.notdef) — which Carlito's own .notdef genuinely draws (4 contours), so a wrongly-read entry paints a second, wrong path rather than silently doing nothing.
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
    // dropTable repoints the 'cmap' table record past the end of the file — parseSfnt drops it, exactly as it would for a genuinely truncated font — while head/maxp/glyf stay intact, so openEmbeddedProgram still classifies this as a fillable "glyf" program; only buildCmapLookup finds nothing to resolve a code point through.
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
