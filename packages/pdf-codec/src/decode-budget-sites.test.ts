import { describe, expect, it } from "vitest";
import { PdfDecodeBudget } from "./decode-budget";
import { NOOP_DIAGNOSTIC_SINK } from "./diagnostics";
import { readImageXObject } from "./images-read";
import type { PdfObject } from "./objects";
import { pdfDict, pdfName, pdfStream } from "./objects";
import type { PageRasteriser } from "./raster";
import { renderPdfPage } from "./raster";
import { readPdf } from "./read";
import {
  BIG,
  BIG_OBJ,
  bigStream,
  BUDGET,
  budgetedResolver,
  contentSitePdf,
  expectBudgetError,
  fillUnused,
  FLATE_ZEROS,
  flateZeros,
  jpegHeader,
  LARGE,
  OBJECT_STREAM_OBJ,
  objectStreamPdf,
  runLengthZeros,
  SHOW_TEXT,
  sitePdf,
  TO_UNICODE_PRIVATE_USE,
  XREF_STREAM_OBJ,
} from "./test-support/decode-budget";
import * as encryptedFixtures from "./test-support/encrypted-pdfs";
import { carlitoRegularBytes } from "./test-support/fonts";
import {
  JPEG2000_FIXTURES,
  jpeg2000FixtureBytes,
} from "./test-support/jpeg2000";
import { enc, FixtureBuilder } from "./test-support/pdf";

// Every site a document decodes a stream at, each reached by a document whose only large stream sits there: reverting a site's charge lets its read decode to the end, so its test fails.

// Each site, the document that reaches it, and the stream its budget error names.
const SITES: readonly {
  readonly site: string;
  readonly pdf: () => Uint8Array<ArrayBuffer>;
  readonly objectNumber: number | undefined;
}[] = [
  {
    site: "a page content stream, as an element of a /Contents array",
    pdf: () => contentSitePdf(),
    objectNumber: 6,
  },
  {
    site: "a form XObject",
    pdf: () =>
      sitePdf({
        pageResources: "/XObject << /Fm1 9 0 R >>",
        content: "/Fm1 Do",
        objects: (b) => {
          b.stream(
            BIG_OBJ,
            "<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Filter /FlateDecode >>",
            FLATE_ZEROS,
          );
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "an image XObject",
    pdf: () =>
      sitePdf({
        pageResources: "/XObject << /Im1 9 0 R >>",
        content: "q 10 0 0 10 0 0 cm /Im1 Do Q",
        objects: (b) => {
          b.stream(
            BIG_OBJ,
            "<< /Type /XObject /Subtype /Image /Width 1024 /Height 1024 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode >>",
            FLATE_ZEROS,
          );
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "an inline image",
    pdf: () => {
      const data = runLengthZeros(LARGE);
      const b = new FixtureBuilder().header("1.7");
      b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
      b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
      b.object(
        3,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 5 0 R >>",
      );
      const content = new Uint8Array([
        ...enc(
          "q 10 0 0 10 0 0 cm BI /W 1024 /H 1024 /BPC 8 /CS /G /F /RL ID ",
        ),
        ...data,
        ...enc(" EI Q"),
      ]);
      b.stream(5, "<< >>", content);
      fillUnused(b, 5);
      b.classicXrefAndTrailer(5, "/Root 1 0 R");
      return b.bytes();
    },
    objectNumber: undefined,
  },
  {
    site: "an image's /SMask",
    pdf: () =>
      sitePdf({
        pageResources: "/XObject << /Im1 6 0 R >>",
        content: "q 10 0 0 10 0 0 cm /Im1 Do Q",
        objects: (b) => {
          b.stream(
            6,
            "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /SMask 9 0 R >>",
            new Uint8Array([0x80]),
          );
          b.object(7, "null");
          b.object(8, "null");
          b.stream(
            BIG_OBJ,
            "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode >>",
            FLATE_ZEROS,
          );
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "an /Indexed colour space's lookup stream",
    pdf: () =>
      sitePdf({
        pageResources: "/XObject << /Im1 6 0 R >>",
        content: "q 10 0 0 10 0 0 cm /Im1 Do Q",
        objects: (b) => {
          b.stream(
            6,
            "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace [/Indexed /DeviceRGB 255 9 0 R] >>",
            new Uint8Array([0]),
          );
          b.object(7, "null");
          b.object(8, "null");
          bigStream(b);
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "the catalog's /Metadata",
    pdf: () =>
      sitePdf({
        catalogExtra: "/Metadata 9 0 R",
        objects: (b) => {
          for (let n = 6; n < BIG_OBJ; n++) b.object(n, "null");
          b.stream(
            BIG_OBJ,
            "<< /Type /Metadata /Subtype /XML /Filter /FlateDecode >>",
            FLATE_ZEROS,
          );
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "an embedded file",
    pdf: () =>
      sitePdf({
        catalogExtra:
          "/Names << /EmbeddedFiles << /Names [(a.bin) 6 0 R] >> >>",
        objects: (b) => {
          b.object(6, "<< /Type /Filespec /F (a.bin) /EF << /F 9 0 R >> >>");
          b.object(7, "null");
          b.object(8, "null");
          b.stream(
            BIG_OBJ,
            "<< /Type /EmbeddedFile /Filter /FlateDecode >>",
            FLATE_ZEROS,
          );
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "a font's /ToUnicode CMap",
    pdf: () =>
      sitePdf({
        pageResources: "/Font << /F1 6 0 R >>",
        content: SHOW_TEXT,
        objects: (b) => {
          b.object(
            6,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 9 0 R >>",
          );
          b.object(7, "null");
          b.object(8, "null");
          bigStream(b);
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "a symbolic font's embedded program, read for its encoding",
    pdf: () =>
      sitePdf({
        pageResources: "/Font << /F1 6 0 R >>",
        content: SHOW_TEXT,
        objects: (b) => {
          b.object(
            6,
            "<< /Type /Font /Subtype /TrueType /BaseFont /Glyphs /FirstChar 65 /LastChar 65 /Widths [500] /FontDescriptor 7 0 R >>",
          );
          b.object(
            7,
            "<< /Type /FontDescriptor /FontName /Glyphs /Flags 4 /FontFile2 9 0 R >>",
          );
          b.object(8, "null");
          bigStream(b);
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "a font's embedded program, read for its PostScript name",
    pdf: () =>
      sitePdf({
        pageResources: "/Font << /F1 6 0 R >>",
        content: SHOW_TEXT,
        objects: (b) => {
          b.object(
            6,
            "<< /Type /Font /Subtype /TrueType /BaseFont /Glyphs /FirstChar 65 /LastChar 65 /Widths [500] /FontDescriptor 7 0 R /ToUnicode 8 0 R >>",
          );
          b.object(
            7,
            "<< /Type /FontDescriptor /FontName /Glyphs /Flags 32 /FontFile2 9 0 R >>",
          );
          b.stream(8, "<< >>", TO_UNICODE_PRIVATE_USE);
          bigStream(b);
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "a font's embedded program, read for its digest",
    pdf: () =>
      sitePdf({
        pageResources: "/Font << /F1 6 0 R >>",
        content: SHOW_TEXT,
        objects: (b) => {
          b.object(
            6,
            "<< /Type /Font /Subtype /Type1 /BaseFont /AdvP4C4E74 /FirstChar 65 /LastChar 65 /Widths [500] /FontDescriptor 7 0 R >>",
          );
          b.object(
            7,
            "<< /Type /FontDescriptor /FontName /AdvP4C4E74 /Flags 32 /FontFile3 9 0 R >>",
          );
          b.object(8, "null");
          bigStream(b);
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "a composite font's /CIDToGIDMap",
    pdf: () =>
      sitePdf({
        pageResources: "/Font << /F1 6 0 R >>",
        content: "BT /F1 12 Tf 10 50 Td <0041> Tj ET",
        objects: (b) => {
          b.object(
            6,
            "<< /Type /Font /Subtype /Type0 /BaseFont /Glyphs /Encoding /Identity-H /DescendantFonts [7 0 R] >>",
          );
          b.object(
            7,
            "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Glyphs /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /CIDToGIDMap 9 0 R >>",
          );
          b.object(8, "null");
          bigStream(b);
        },
        maxObj: BIG_OBJ,
      }),
    objectNumber: BIG_OBJ,
  },
  {
    site: "a cross-reference stream",
    pdf: () => objectStreamPdf(0, LARGE),
    objectNumber: XREF_STREAM_OBJ,
  },
  {
    site: "an object stream",
    pdf: () => objectStreamPdf(LARGE, 0),
    objectNumber: OBJECT_STREAM_OBJ,
  },
  {
    site: "an object stream found by cross-reference recovery",
    pdf: () => objectStreamPdf(LARGE, 0, true),
    objectNumber: OBJECT_STREAM_OBJ,
  },
];

describe("readPdf with maxDecodedBytes", () => {
  for (const { site, pdf, objectNumber } of SITES) {
    it(`charges ${site}`, () => {
      const document = pdf();
      // The same document reads without a budget, so the refusal below is the budget's and not a malformed file's.
      expect(() => readPdf(document)).not.toThrow();
      expectBudgetError(
        () => readPdf(document, { maxDecodedBytes: BUDGET }),
        objectNumber,
      );
      expect(() =>
        readPdf(document, { maxDecodedBytes: 4 * LARGE }),
      ).not.toThrow();
    });
  }

  it("charges a font program two font dictionaries share once for each", () => {
    const document = sitePdf({
      pageResources: "/Font << /F1 6 0 R /F2 8 0 R >>",
      content: `${SHOW_TEXT} BT /F2 12 Tf 10 30 Td (A) Tj ET`,
      objects: (b) => {
        const font = (name: string): string =>
          `<< /Type /Font /Subtype /TrueType /BaseFont /${name} /FirstChar 65 /LastChar 65 /Widths [500] /FontDescriptor 7 0 R >>`;
        b.object(6, font("GlyphsA"));
        b.object(
          7,
          "<< /Type /FontDescriptor /FontName /Glyphs /Flags 4 /FontFile2 9 0 R >>",
        );
        b.object(8, font("GlyphsB"));
        bigStream(b);
      },
      maxObj: BIG_OBJ,
    });
    expect(() =>
      readPdf(document, { maxDecodedBytes: 2 * LARGE }),
    ).not.toThrow();
    expectBudgetError(
      () => readPdf(document, { maxDecodedBytes: 2 * LARGE - 1 }),
      BIG_OBJ,
    );
  });

  it("charges a JPEG 2000 image's samples before decoding them, and stops the read rather than skipping the image", () => {
    const fixture = JPEG2000_FIXTURES.find((f) => !f.undecodable);
    if (fixture === undefined) {
      throw new Error("no decodable JPEG 2000 fixture");
    }
    const samples = fixture.width * fixture.height * fixture.componentCount * 4;
    const dict = pdfDict({
      Subtype: pdfName("Image"),
      Filter: pdfName("JPXDecode"),
    });
    const raw = jpeg2000FixtureBytes(fixture.codestream);
    const objects = new Map<number, PdfObject>([
      [BIG_OBJ, pdfStream(dict, raw)],
    ]);
    const fits = new PdfDecodeBudget(samples);
    expect(
      readImageXObject(
        dict,
        raw,
        budgetedResolver(objects, fits),
        NOOP_DIAGNOSTIC_SINK,
      ),
    ).toBeDefined();
    expect(fits.decodedBytes).toBe(samples);
    expectBudgetError(
      () =>
        readImageXObject(
          dict,
          raw,
          budgetedResolver(objects, new PdfDecodeBudget(samples - 1)),
          NOOP_DIAGNOSTIC_SINK,
        ),
      BIG_OBJ,
    );
  });

  it("reads an encrypted document with object streams under a budget exactly as without one", () => {
    const document = encryptedFixtures.aes256ObjectStreamsPdf();
    expect(readPdf(document, { maxDecodedBytes: LARGE })).toEqual(
      readPdf(document),
    );
  });
});

// A rasteriser that records nothing: the decode budget is what these tests watch.
const SILENT_RASTERISER: PageRasteriser = {
  beginPage: () => undefined,
  draw: () => undefined,
  finish: () => new Uint8Array(0),
};

function render(
  document: Uint8Array<ArrayBuffer>,
  maxDecodedBytes?: number,
): unknown {
  return renderPdfPage(
    document,
    0,
    maxDecodedBytes === undefined ? {} : { maxDecodedBytes },
    SILENT_RASTERISER,
  );
}

function carlitoType0Pdf(
  cidToGidMap: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return sitePdf({
    pageResources: "/Font << /F1 6 0 R >>",
    content: "BT /F1 12 Tf 10 50 Td <0041> Tj ET",
    objects: (b) => {
      b.object(
        6,
        "<< /Type /Font /Subtype /Type0 /BaseFont /Carlito /Encoding /Identity-H /DescendantFonts [7 0 R] >>",
      );
      b.object(
        7,
        "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Carlito /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /CIDToGIDMap 9 0 R >>",
      );
      b.stream(
        8,
        "<< /Type /FontDescriptor /FontName /Carlito /Flags 32 /FontFile2 10 0 R >>",
        new Uint8Array(0),
      );
      b.stream(BIG_OBJ, BIG, cidToGidMap);
      b.stream(10, "<< >>", carlitoRegularBytes());
    },
    maxObj: 10,
  });
}

describe("renderPdfPage with maxDecodedBytes", () => {
  it("charges a page content stream", () => {
    const document = contentSitePdf();
    expect(() => render(document)).not.toThrow();
    expectBudgetError(() => render(document, BUDGET), 6);
  });

  it("charges a TrueType program the text walk decodes for its outlines", () => {
    const document = sitePdf({
      pageResources: "/Font << /F1 6 0 R >>",
      content: SHOW_TEXT,
      objects: (b) => {
        b.object(
          6,
          "<< /Type /Font /Subtype /TrueType /BaseFont /Glyphs /FirstChar 65 /LastChar 65 /Widths [500] /FontDescriptor 7 0 R >>",
        );
        b.object(
          7,
          "<< /Type /FontDescriptor /FontName /Glyphs /Flags 32 /FontFile2 9 0 R >>",
        );
        b.object(8, "null");
        bigStream(b);
      },
      maxObj: BIG_OBJ,
    });
    expect(() => render(document)).not.toThrow();
    expectBudgetError(() => render(document, BUDGET), BIG_OBJ);
  });

  it("charges the /CIDToGIDMap the text walk decodes, beside the one the font read decodes", () => {
    const map = flateZeros(1000);
    const document = carlitoType0Pdf(map);
    expect(() => render(document)).not.toThrow();
    // Read once by the font reader and once by the text walk: one charge fits, the second does not.
    expectBudgetError(() => render(document, 1500), BIG_OBJ);
    expect(() => render(document, 2000)).not.toThrow();
  });

  it("charges a JPEG its decoded samples before handing it to the rasteriser", () => {
    const width = 1024;
    const height = 1024;
    const document = sitePdf({
      pageResources: "/XObject << /Im1 9 0 R >>",
      content: "q 10 0 0 10 0 0 cm /Im1 Do Q",
      objects: (b) => {
        for (let n = 6; n < BIG_OBJ; n++) b.object(n, "null");
        b.stream(
          BIG_OBJ,
          `<< /Type /XObject /Subtype /Image /Width ${String(width)} /Height ${String(height)} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode >>`,
          jpegHeader(width, height, 3),
        );
      },
      maxObj: BIG_OBJ,
    });
    expect(() => render(document)).not.toThrow();
    expectBudgetError(() => render(document, width * height * 3 - 1), BIG_OBJ);
    expect(() => render(document, width * height * 3)).not.toThrow();
    // readPdf passes the JPEG through undecoded, so it costs nothing there.
    expect(() => readPdf(document, { maxDecodedBytes: 0 })).not.toThrow();
  });
});
