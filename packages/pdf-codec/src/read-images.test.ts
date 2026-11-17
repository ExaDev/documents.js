import { base64ToBytes } from "byte-codec";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ImagesRead from "./images-read";
import { sha256 } from "./crypto/sha2";
import type { PdfDiagnostic } from "./diagnostics";
import { PdfImageLocatorError, PdfPageSelectionError } from "./diagnostics";
import { readImageXObject } from "./images-read";
import type { LayoutDocument } from "./layout";
import { readPdf } from "./read";
import type { PdfImageEntry, PdfImageLocator } from "./read-images";
import { decodePdfImage, listPdfImages, openPdfImages } from "./read-images";
import {
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

beforeEach(() => {
  vi.mocked(readImageXObject).mockClear();
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
    expect(() =>
      listPdfImages(variety, { signal: controller.signal }),
    ).toThrow();
  });
});

describe("decodePdfImage", () => {
  it("decodes one image per call", () => {
    const [, gray] = listPdfImages(variety);
    const decoded = decodePdfImage(variety, gray!.locator);
    expect(readImageXObject).toHaveBeenCalledTimes(1);
    expect(decoded).toMatchObject({ format: "png", widthPx: 40, heightPx: 30 });
  });

  it("decodes each image to exactly the bytes, format, size and id readPdf registers for it", () => {
    const doc = readPdf(variety);
    const images = openPdfImages(variety);
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
      expect(hex(decodePdfImage(variety, entry.locator)!.bytes)).toBe(
        hex(decoded.bytes),
      );
    }
    expect(decodedIds).toEqual(drawnImageIds(doc));
  });

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
  });
});

// The decoded bytes every image stored before pdf-codec 5 was produced from: per-image decoding must reproduce 4.5.2's output exactly, or every re-read image would mint a new blob.
describe("per-image decoding reproduces pdf-codec 4.5.2's decoded images byte for byte", () => {
  it.each([
    ["the variety fixture", variety, IMAGE_VARIETY_4_5_2],
    [
      "the picture-deck fixture at quarter scale",
      pictureDeckPdf({ scale: 0.25 }),
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
    const listing = listPdfImages(pictureDeckPdf({ scale: 0.25 }));
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
