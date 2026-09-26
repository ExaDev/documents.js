import { describe, expect, it } from "vitest";
import {
  SmallFixture,
  trueTypeCarlitoPdf,
} from "./test-support/raster-carlito";
import type { PdfDiagnostic } from "./diagnostics";
import { renderPdfPage } from "./raster";
import type {
  PageRasteriser,
  RasterDrawOp,
  RasterPageGeometry,
} from "./raster";
import { STIX_TWO_MATH_FONT_BASE64 } from "./assets/stix-two-math-font";
import { base64ToBytes } from "byte-codec";
import { carlitoRegularBytes } from "./test-support/fonts";
import { minimalClassicXrefPdf } from "./test-support/pdf";

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
// --- The port's geometry contract. ---

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
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
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
    // Two separate text runs through the same /F1 resource (a standard-14 face with no embedded program): resolveTextOutlineFace's own cache means buildTextOutlineFace, and the diagnostic it emits, runs exactly once — not once per run naming the same already-diagnosed font all over again.
    const diagnostics: PdfDiagnostic[] = [];
    const rasteriser = new RecordingRasteriser();
    drive(
      onePagePdf("BT /F1 24 Tf 20 60 Td (A) Tj 0 -20 Td (B) Tj ET"),
      0,
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
      rasteriser,
    );
    expect(
      diagnostics.filter((d) => d.code === "raster/text-outlines-unavailable"),
    ).toHaveLength(1);
    expect(rasteriser.ops).toEqual([]);
  });

  // A bare Type0/CIDFontType2 skeleton around the real vendored Carlito face, with every dict entry a caller can override — the same font bytes type0CarlitoPdf uses, but exposing the descendant/descriptor/encoding shape directly so each of buildTextOutlineFace's own branch conditions can be driven independently of the others.
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
    // Exactly one em apart, not merely apart: the same two glyphs drawn horizontally are the same distance along the other axis, so any mis-scaling of the accumulated advance shows up as a different figure rather than as the glyphs merely still being separate.
    const horizontal = glyphCentres(
      type0Skeleton({ content: TWO_GLYPH_CONTENT }),
    );
    expect(Math.abs((centres[1]?.y ?? 0) - (centres[0]?.y ?? 0))).toBeCloseTo(
      Math.abs((horizontal[1]?.x ?? 0) - (horizontal[0]?.x ?? 0)),
      3,
    );
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

    // Lowering the FIRST glyph's vector instead moves the whole run, since the run's own matrices already carry that one, so the first glyph must move by exactly that 380/1000 em and no further. A walk that added each glyph's vector to the first's rather than subtracting it would move this glyph by its own vector twice over on top of that.
    const firstLowered = glyphCentres(
      type0Skeleton({
        encoding: "/Identity-V",
        descendantExtra: "/DW 1000 /DW2 [880 -1000] /W2 [0 [-1000 500 500]]",
        content: twoCids,
      }),
    );
    expect(
      Math.abs((firstLowered[0]?.y ?? 0) - (shared[0]?.y ?? 0)),
    ).toBeCloseTo(9.12, 2);
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
    // Overwrite object 7's own Subtype in place — simplest way to force an unsupported descendant subtype without duplicating the whole skeleton.
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
    // openEmbeddedProgram tries FontFile2 then FontFile3 in a loop — a descriptor carrying only the latter is the only way to prove the loop actually reaches its second key rather than stopping after the first.
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
    // The real, vendored STIX Two Math font is a genuine OTTO container carrying a 'CFF ' table — an /OpenType-wrapped CFF program is a legal /FontFile3 value per ISO 32000-1, distinct from the bare-CFF-header case above.
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
});
