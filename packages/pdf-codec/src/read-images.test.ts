import { base64ToBytes } from "byte-codec";
import type * as Fflate from "fflate";
import { unzlibSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ImagesRead from "./images-read";
import type * as Interpret from "./interpret";
import { sha256 } from "./crypto/sha2";
import type { PdfDiagnostic } from "./diagnostics";
import { PdfImageLocatorError, PdfPageSelectionError } from "./diagnostics";
import type { PdfImageLocator } from "./image-locator";
import { PdfImageLocatorSchema } from "./image-locator";
import { readImageXObject } from "./images-read";
import { interpretContentStream } from "./interpret";
import type { LayoutDocument } from "./layout";
import { readPdf } from "./read";
import type { PdfImageEntry } from "./read-images";
import { decodePdfImage, listPdfImages, openPdfImages } from "./read-images";
import {
  imageEdgeCasesPdf,
  imageVarietyPdf,
  pictureDeckPdf,
} from "./test-support/image-heavy-pdf";
import {
  IMAGE_VARIETY_4_5_2,
  PICTURE_DECK_QUARTER_4_5_2,
} from "./test-support/image-heavy-pdf-golden";

// Observed, not stubbed: the real decoder still runs, so a test can count how many images a call decoded.
vi.mock("./images-read", async (importOriginal) => {
  const actual = await importOriginal<typeof ImagesRead>();
  return { ...actual, readImageXObject: vi.fn(actual.readImageXObject) };
});

// Observed the same way: how many pages a call interprets, and which buffers inflate was handed.
vi.mock("./interpret", async (importOriginal) => {
  const actual = await importOriginal<typeof Interpret>();
  return {
    ...actual,
    interpretContentStream: vi.fn(actual.interpretContentStream),
  };
});
vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof Fflate>();
  return { ...actual, unzlibSync: vi.fn(actual.unzlibSync) };
});

beforeEach(() => {
  vi.mocked(readImageXObject).mockClear();
  vi.mocked(interpretContentStream).mockClear();
  vi.mocked(unzlibSync).mockClear();
});

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function digest(bytes: Uint8Array<ArrayBuffer>): string {
  return hex(sha256(bytes));
}

function locatorKey(locator: PdfImageLocator): string {
  return locator.kind === "xobject"
    ? `${String(locator.objectNumber)} ${String(locator.generation)} R`
    : `inline ${String(locator.pageIndex)}#${String(locator.occurrence)}`;
}

// The imageIds readPdf's page items name: an image registered but drawn only where nothing is visible is in the registry and on no page.
function drawnImageIds(doc: LayoutDocument): Set<string> {
  return new Set(
    doc.pages.flatMap((page) =>
      page.items.flatMap((item) =>
        item.kind === "image" ? [item.imageId] : [],
      ),
    ),
  );
}

const variety = imageVarietyPdf();
const edgeCases = imageEdgeCasesPdf();
const pictureDeckQuarter = pictureDeckPdf({ scale: 0.25 });

describe("listPdfImages", () => {
  it("lists every visible image once, by reference, without decoding any of them", () => {
    const diagnostics: PdfDiagnostic[] = [];
    const listing = listPdfImages(variety, {
      sink: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(readImageXObject).not.toHaveBeenCalled();
    // The 16-bit image is listed, though decoding it would report image/unsupported-bit-depth: nothing was decoded, so nothing was reported.
    expect(diagnostics).toEqual([]);
    expect(listing.map((entry) => locatorKey(entry.locator))).toEqual([
      "3 0 R", // Flate RGB with a soft mask (its soft mask is object 4)
      "5 0 R", // inverted gray
      "6 0 R", // indexed
      "7 0 R", // 1-bit
      "8 0 R", // CMYK
      "9 0 R", // JPEG
      "10 0 R", // ICC RGB under a PNG predictor
      "13 0 R", // 16-bit, which no decoder reads
      "14 0 R", // drawn inside a form XObject
      "inline 1#0",
    ]);
    // Never listed: the /ImageMask stencil (object 11), which neither readPdf nor this reader reports as an image, and object 12, drawn only outside its page's crop box.
  });

  it("reports what each image's dictionary states", () => {
    const [softMasked, , , oneBit, , jpeg] = listPdfImages(variety);
    expect(softMasked).toMatchObject({
      widthPx: 64,
      heightPx: 48,
      filters: ["FlateDecode"],
      softMask: true,
    });
    expect(oneBit).toMatchObject({
      widthPx: 50,
      heightPx: 20,
      filters: [],
      softMask: false,
      encodedByteLength: 140,
    });
    expect(jpeg).toMatchObject({ filters: ["DCTDecode"], softMask: false });
  });

  it("places each image exactly where readPdf places its items, on every page that draws it", () => {
    const doc = readPdf(variety);
    const images = openPdfImages(variety);
    for (const entry of images.list()) {
      const decoded = images.decode(entry.locator);
      if (decoded === undefined) {
        continue;
      }
      const expected = doc.pages.flatMap((page, pageIndex) =>
        page.items.flatMap((item) =>
          item.kind === "image" && item.imageId === decoded.imageId
            ? [
                {
                  pageIndex,
                  xPt: item.xPt,
                  yPt: item.yPt,
                  widthPt: item.widthPt,
                  heightPt: item.heightPt,
                  ...(item.rotationDeg !== undefined
                    ? { rotationDeg: item.rotationDeg }
                    : {}),
                  ...(item.layer !== undefined ? { layer: item.layer } : {}),
                },
              ]
            : [],
        ),
      );
      expect(entry.placements, locatorKey(entry.locator)).toEqual(expected);
    }
  });

  it("collects every place one image XObject is drawn, across pages, including a rotated and cropped one", () => {
    const [softMasked] = listPdfImages(variety);
    expect(softMasked?.placements.map((p) => p.pageIndex)).toEqual([0, 0, 1]);
    // Page 1 is rotated a quarter turn, so the image drawn on it is too.
    expect(softMasked?.placements[2]?.rotationDeg).toBe(-90);
  });

  it("lists the selected pages only", () => {
    const lastPage = listPdfImages(variety, { pages: [-1] });
    expect(lastPage.map((entry) => locatorKey(entry.locator))).toEqual([
      "3 0 R",
      "inline 1#0",
    ]);
    expect(lastPage.flatMap((entry) => entry.placements)).toHaveLength(2);
    expect(listPdfImages(variety, { pages: [] })).toEqual([]);
    expect(() => listPdfImages(variety, { pages: [2] })).toThrow(
      PdfPageSelectionError,
    );
  });

  it("states the page count, and stops at an aborted signal", () => {
    expect(openPdfImages(variety).pageCount).toBe(2);
    const controller = new AbortController();
    controller.abort();
    let thrown: unknown;
    try {
      listPdfImages(variety, { signal: controller.signal });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DOMException);
    expect(thrown).toMatchObject({ name: "AbortError" });
  });

  it("lists an image named through a reference to its reference once, under the first reference drawn", () => {
    const [chained] = listPdfImages(edgeCases);
    expect(chained?.locator).toEqual({
      kind: "xobject",
      objectNumber: 3,
      generation: 0,
    });
    expect(chained?.placements.map((p) => p.xPt)).toEqual([0, 30]);
  });

  it("counts an inline stencil mask among its page's inline images, without listing it", () => {
    const inline = listPdfImages(edgeCases).filter(
      (entry) => entry.locator.kind === "inline",
    );
    expect(inline.map((entry) => entry.locator)).toEqual([
      { kind: "inline", pageIndex: 0, occurrence: 1 },
    ]);
    expect(decodePdfImage(edgeCases, inline[0]!.locator)).toMatchObject({
      format: "png",
      widthPx: 1,
      heightPx: 1,
    });
    // Occurrence 0 is the stencil, which readPdf leaves out of its registry too.
    expect(
      decodePdfImage(edgeCases, {
        kind: "inline",
        pageIndex: 0,
        occurrence: 0,
      }),
    ).toBeUndefined();
  });

  it("reports locators the schema accepts", () => {
    for (const entry of listPdfImages(variety)) {
      expect(PdfImageLocatorSchema.parse(entry.locator)).toEqual(entry.locator);
    }
    expect(
      PdfImageLocatorSchema.safeParse({
        kind: "inline",
        pageIndex: -1,
        occurrence: 0,
      }).success,
    ).toBe(false);
  });
});

describe("decodePdfImage", () => {
  it("decodes one image per call, without interpreting any page", () => {
    const images = openPdfImages(variety);
    const [, gray] = images.list();
    vi.mocked(interpretContentStream).mockClear();
    const decoded = images.decode(gray!.locator);
    expect(readImageXObject).toHaveBeenCalledTimes(1);
    expect(interpretContentStream).not.toHaveBeenCalled();
    expect(decoded).toMatchObject({ format: "png", widthPx: 40, heightPx: 30 });
  });

  it.each([
    ["the variety fixture", variety],
    ["the picture-deck fixture at quarter scale", pictureDeckQuarter],
  ] as const)(
    "decodes each image of %s to exactly the bytes, format, size and id readPdf registers for it",
    (_name, pdf) => {
      const doc = readPdf(pdf);
      const images = openPdfImages(pdf);
      const decodedIds = new Set<string>();
      for (const entry of images.list()) {
        const decoded = images.decode(entry.locator);
        if (decoded === undefined) {
          continue;
        }
        decodedIds.add(decoded.imageId);
        const asset = doc.images[decoded.imageId];
        expect(asset, locatorKey(entry.locator)).toBeDefined();
        expect(asset?.format).toBe(decoded.format);
        expect(asset?.widthPx).toBe(decoded.widthPx);
        expect(asset?.heightPx).toBe(decoded.heightPx);
        expect(hex(base64ToBytes(asset!.base64))).toBe(hex(decoded.bytes));
        // The standalone call opens the file afresh and still decodes the same bytes.
        expect(hex(decodePdfImage(pdf, entry.locator)!.bytes)).toBe(
          hex(decoded.bytes),
        );
      }
      expect(decodedIds).toEqual(drawnImageIds(doc));
    },
  );

  it("leaves out an image readPdf leaves out, with the same diagnostic", () => {
    const unsupported = listPdfImages(variety).find(
      (entry: PdfImageEntry) =>
        entry.locator.kind === "xobject" && entry.locator.objectNumber === 13,
    );
    const diagnostics: PdfDiagnostic[] = [];
    expect(
      decodePdfImage(variety, unsupported!.locator, {
        sink: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      }),
    ).toBeUndefined();
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "image/unsupported-bit-depth",
    ]);
  });

  it("returns a JPEG's bytes as an array of its own, not a view onto the file", () => {
    const jpeg = listPdfImages(variety).find(
      (entry) => entry.filters[0] === "DCTDecode",
    );
    const decoded = decodePdfImage(variety, jpeg!.locator);
    expect(decoded?.format).toBe("jpeg");
    expect(decoded?.bytes.buffer).not.toBe(variety.buffer);
    expect(decoded?.bytes.byteLength).toBe(decoded?.bytes.buffer.byteLength);
  });

  it("finds an image by its object number whatever generation the locator names", () => {
    const images = openPdfImages(variety);
    const named = images.decode({
      kind: "xobject",
      objectNumber: 5,
      generation: 0,
    });
    const otherGeneration = images.decode({
      kind: "xobject",
      objectNumber: 5,
      generation: 3,
    });
    expect(otherGeneration?.imageId).toBe(named?.imageId);
  });

  it("decodes an image without its soft mask when the mask is the wrong size, never inflating the mask", () => {
    const decoded = decodePdfImage(edgeCases, {
      kind: "xobject",
      objectNumber: 4,
      generation: 0,
    });
    expect(decoded).toMatchObject({ format: "png", widthPx: 2, heightPx: 1 });
    // The image's own stream, and not its 4000x4000 mask's.
    expect(unzlibSync).toHaveBeenCalledTimes(1);
  });

  it("never sizes an inflate buffer by a dictionary that declares an image too large to decode", () => {
    const diagnostics: PdfDiagnostic[] = [];
    expect(
      decodePdfImage(
        edgeCases,
        { kind: "xobject", objectNumber: 7, generation: 0 },
        {
          sink: (diagnostic) => {
            diagnostics.push(diagnostic);
          },
        },
      ),
    ).toBeUndefined();
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "image/undecodable",
    );
    expect(
      vi.mocked(unzlibSync).mock.calls.every((call) => call[1] === undefined),
    ).toBe(true);
  });

  it("refuses a locator that names no image of the document", () => {
    const images = openPdfImages(variety);
    // Object 1 is the catalog; object 99 does not exist; the form XObject is a stream, but not an image.
    for (const objectNumber of [1, 99, 16]) {
      expect(() =>
        images.decode({ kind: "xobject", objectNumber, generation: 0 }),
      ).toThrow(PdfImageLocatorError);
    }
    expect(() =>
      images.decode({ kind: "inline", pageIndex: 1, occurrence: 1 }),
    ).toThrow(PdfImageLocatorError);
    expect(() =>
      images.decode({ kind: "inline", pageIndex: 0, occurrence: 0 }),
    ).toThrow(PdfImageLocatorError);
    expect(() =>
      images.decode({ kind: "inline", pageIndex: 5, occurrence: 0 }),
    ).toThrow(PdfPageSelectionError);
    // A page index counted from the end is a page selection's, never a locator's.
    for (const locator of [
      { kind: "inline", pageIndex: -1, occurrence: 0 },
      { kind: "inline", pageIndex: 1, occurrence: -1 },
      { kind: "inline", pageIndex: 1, occurrence: 0.5 },
    ] as const) {
      expect(() => images.decode(locator)).toThrow(PdfImageLocatorError);
    }
  });
});

// The decoded bytes every image stored before pdf-codec 5 was produced from: per-image decoding must reproduce 4.5.2's output exactly, or every re-read image would mint a new blob.
describe("per-image decoding reproduces pdf-codec 4.5.2's decoded images byte for byte", () => {
  it.each([
    ["the variety fixture", variety, IMAGE_VARIETY_4_5_2],
    [
      "the picture-deck fixture at quarter scale",
      pictureDeckQuarter,
      PICTURE_DECK_QUARTER_4_5_2,
    ],
  ] as const)("%s", (_name, pdf, golden) => {
    const images = openPdfImages(pdf);
    const decoded = new Map<string, string>();
    for (const entry of images.list()) {
      const image = images.decode(entry.locator);
      if (image !== undefined) {
        decoded.set(image.imageId, digest(image.bytes));
      }
    }
    const drawn = drawnImageIds(readPdf(pdf));
    expect(Object.fromEntries(decoded)).toEqual(
      Object.fromEntries(
        Object.entries(golden).filter(([imageId]) => drawn.has(imageId)),
      ),
    );
  });

  it("and readPdf still registers exactly 4.5.2's images", () => {
    const doc = readPdf(variety);
    expect(
      Object.fromEntries(
        Object.entries(doc.images).map(([imageId, asset]) => [
          imageId,
          digest(base64ToBytes(asset.base64)),
        ]),
      ),
    ).toEqual(IMAGE_VARIETY_4_5_2);
  });
});

describe("the picture-deck fixture", () => {
  it("has the shape of the picture-heavy deck it stands in for", () => {
    const listing = listPdfImages(pictureDeckQuarter);
    expect(listing).toHaveLength(108);
    expect(
      listing.filter((entry) => entry.filters[0] === "DCTDecode"),
    ).toHaveLength(27);
    expect(listing.filter((entry) => entry.softMask).length).toBeGreaterThan(
      50,
    );
    expect(listing.some((entry) => entry.placements.length > 1)).toBe(true);
  });
});
