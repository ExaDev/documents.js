import type { PdfDiagnosticSink } from "./diagnostics";
import { NOOP_DIAGNOSTIC_SINK, PdfImageLocatorError } from "./diagnostics";
import { openPdfDocument } from "./document";
import type { PdfDocument } from "./document";
import { filterNames } from "./filters";
import type { ExtractedPdfImage } from "./images-read";
import { readImageXObject } from "./images-read";
import { interpretContentStream } from "./interpret";
import type {
  ExtractedItem,
  FontMetricsPort,
  InterpretContext,
} from "./interpret-types";
import { multiplyMatrices } from "./matrix";
import type { Matrix } from "./matrix";
import type { PdfDict, PdfObject } from "./objects";
import { asBool, asName, asNumber, dictGet } from "./objects";
import { readOptionalContent } from "./optional-content";
import {
  itemIntersectsVisibleRegion,
  readPageContentBytes,
  readPageFrame,
} from "./page-frame";
import { imageIdOf, imagePlacementFrom } from "./read-convert";
import { hasPdfHeader, resolvePageSelection } from "./read-open";
import { PdfParseError } from "./diagnostics";
import { throwIfAborted } from "./util/abort";

// The image registry readPdf builds, taken apart into its two halves so a memory-capped caller (a Worker isolate shelving a picture-heavy PDF) can pay for one image at a time: listing finds every image a page draws, where it draws it, and the reference that names it, without decoding any image stream; decoding turns one image, named by that reference, into exactly the bytes readPdf's registry holds for it (the same readImageXObject call on the same stream), without interpreting any page again. readPdf decodes every image during its one pass and keeps each as a base64 string, so its memory grows with the number of images; here nothing outlives the call that decoded it.

/**
 * Names one image of a PDF, as `listPdfImages` reports it and `decodePdfImage` takes it back. Plain data, so a caller can store it and decode the image in a later call (or a later process) against the same file bytes.
 *
 * - `xobject`: an image XObject, by its indirect object reference. One entry covers every place the document draws it.
 * - `inline`: an inline image (`BI` ... `ID` ... `EI`), which has no object of its own, by its page and its position among that page's inline images in content-stream order (counted from 0, every inline image counted, including ones the listing leaves out). Decoding one interprets that page's content again to find it; inline images are small by design (ISO 32000-1 8.9.7 recommends at most 4 KB), and producers rarely write them.
 */
export type PdfImageLocator =
  | {
      readonly kind: "xobject";
      readonly objectNumber: number;
      readonly generation: number;
    }
  | {
      readonly kind: "inline";
      readonly pageIndex: number;
      readonly occurrence: number;
    };

/** One place a page draws an image: the same placement fields a `readPdf` image item carries, in the same page coordinates. */
export interface PdfImagePlacement {
  /** The page's zero-based source index. */
  readonly pageIndex: number;
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly rotationDeg?: number;
  /** The optional-content layer the image is drawn in, as `readPdf` names it. */
  readonly layer?: string;
}

/** One image a PDF draws, read from its dictionary alone: nothing here required decoding the image's stream. */
export interface PdfImageEntry {
  readonly locator: PdfImageLocator;
  /** `/Width` and `/Height` as the dictionary declares them; absent when it declares none (a JPEG 2000 image's codestream states its own). */
  readonly widthPx?: number;
  readonly heightPx?: number;
  /** The stream's `/Filter` names in the order they apply, as written (an inline image may use the abbreviated names). */
  readonly filters: readonly string[];
  /** Whether the image names a soft mask (`/SMask`), which decoding composites in as an alpha channel. */
  readonly softMask: boolean;
  /** The length of the image's stream as stored in the file, before any filter is undone. */
  readonly encodedByteLength: number;
  /** Every visible place the listed pages draw it, in page order and then content-stream order. */
  readonly placements: readonly PdfImagePlacement[];
}

/** One image decoded: exactly the bytes, format and size `readPdf`'s registry holds for it, and the id `readPdf` names it by. */
export interface DecodedPdfImage extends ExtractedPdfImage {
  /** `img` and the CRC-32 of `bytes`, the key `readPdf` registers the image under in `LayoutDocument.images`. */
  readonly imageId: string;
}

export interface PdfImageReadOptions {
  /** Receives every recoverable diagnostic, as `readPdf`'s sink does. */
  readonly sink?: PdfDiagnosticSink;
  /** Checked before the document is opened, before each listed page, and before each decode. */
  readonly signal?: AbortSignal;
}

export interface ListPdfImagesOptions {
  /** The pages to list images from, exactly as `ReadPdfOptions.pages` takes them (negative indices from the end; an entry naming no page throws `PdfPageSelectionError`). Omitted, every page is listed. */
  readonly pages?: readonly number[];
}

/** One opened PDF's images. Listing and decoding share the opened document, so its cross-reference table and object streams are parsed once however many images are decoded. */
export interface PdfImages {
  /** The number of pages in the document's page tree. */
  readonly pageCount: number;
  /**
   * Lists the images the selected pages draw, without decoding any of them.
   * @param options - Which pages to list.
   * @returns One entry per image XObject drawn (in the order first drawn), and one per inline image, each with every visible placement.
   */
  list: (options?: ListPdfImagesOptions) => PdfImageEntry[];
  /**
   * Decodes one image.
   * @param locator - The image, as a listing of this same file named it.
   * @returns The image, or undefined for one `readPdf` would leave out of its registry too (an `/ImageMask` stencil, an unsupported filter, colour space or bit depth, an invalid size, or an undecodable stream), with the same diagnostic `readPdf` reports for it.
   * @throws PdfImageLocatorError if the locator names no image of this document.
   */
  decode: (locator: PdfImageLocator) => DecodedPdfImage | undefined;
}

// Listing places images and never shows text, so the interpreter's text advances only have to keep it moving: an image's placement is the CTM at its Do, which no text operator changes. Answering every glyph with a zero advance spares resolving, and parsing the program of, every font a page uses.
const PLACEMENT_ONLY_FONT_METRICS: FontMetricsPort = {
  glyphAdvance: () => ({ widthPer1000: 0, byteLengthConsumed: 1 }),
  isVertical: () => false,
};

function isImageMask(dict: PdfDict): boolean {
  return asBool(dictGet(dict, "ImageMask") ?? dictGet(dict, "IM")) === true;
}

// A page's content as the interpreter extracts it, with the matrix that places it on the page and the page's visible size. Undefined for a page with no /Resources, which readPdf interprets no content for either.
function interpretPage(
  doc: PdfDocument,
  pageIndex: number,
  page: PdfDict,
  layerNameOf: InterpretContext["layerNameOf"],
  sink: PdfDiagnosticSink,
):
  | {
      readonly items: ExtractedItem[];
      readonly pageMatrix: Matrix;
      readonly widthPt: number;
      readonly heightPt: number;
    }
  | undefined {
  const resources = doc.resolveDict(dictGet(page, "Resources"));
  if (resources === undefined) {
    return undefined;
  }
  const frame = readPageFrame(pageIndex, page, sink);
  const items = interpretContentStream(
    readPageContentBytes(page, doc, sink),
    resources,
    {
      fontMetrics: PLACEMENT_ONLY_FONT_METRICS,
      resolver: doc,
      sink,
      ...(layerNameOf !== undefined ? { layerNameOf } : {}),
    },
  );
  return { items, ...frame };
}

// Where an image item lands, or undefined when it lies wholly outside the visible region, which readPdf drops too.
function visiblePlacement(
  pageIndex: number,
  matrix: Matrix,
  layerName: string | undefined,
  page: {
    readonly pageMatrix: Matrix;
    readonly widthPt: number;
    readonly heightPt: number;
  },
): PdfImagePlacement | undefined {
  const { rotationDeg, ...frame } = imagePlacementFrom(
    multiplyMatrices(matrix, page.pageMatrix),
  );
  const visible = itemIntersectsVisibleRegion(
    { kind: "image", imageId: "", ...frame },
    page.widthPt,
    page.heightPt,
  );
  if (!visible) {
    return undefined;
  }
  return {
    pageIndex,
    ...frame,
    ...(rotationDeg !== undefined ? { rotationDeg } : {}),
    ...(layerName !== undefined ? { layer: layerName } : {}),
  };
}

function entryFacts(
  dict: PdfDict,
  encodedByteLength: number,
): Omit<PdfImageEntry, "locator" | "placements"> {
  const widthPx = asNumber(dictGet(dict, "Width") ?? dictGet(dict, "W"));
  const heightPx = asNumber(dictGet(dict, "Height") ?? dictGet(dict, "H"));
  return {
    ...(widthPx !== undefined ? { widthPx } : {}),
    ...(heightPx !== undefined ? { heightPx } : {}),
    filters: filterNames(dict),
    softMask: dictGet(dict, "SMask") !== undefined,
    encodedByteLength,
  };
}

// The reference a page's /XObject resource names an image by. Undefined for a direct (unreferenced) entry, which ISO 32000-1 7.3.8.1 rules out for a stream.
function xobjectReference(
  doc: PdfDocument,
  resources: PdfDict,
  resourceName: string,
): Extract<PdfObject, { kind: "ref" }> | undefined {
  const xobjects = doc.resolveDict(dictGet(resources, "XObject"));
  const entry =
    xobjects === undefined ? undefined : dictGet(xobjects, resourceName);
  return entry?.kind === "ref" ? entry : undefined;
}

function listImages(
  doc: PdfDocument,
  pageDicts: readonly PdfDict[],
  options: ListPdfImagesOptions | undefined,
  signal: AbortSignal | undefined,
  sink: PdfDiagnosticSink,
): PdfImageEntry[] {
  const selection =
    options?.pages === undefined
      ? undefined
      : resolvePageSelection(options.pages, pageDicts.length);
  const { layerNameOf } = readOptionalContent(doc.catalog, doc, sink);
  const entries: PdfImageEntry[] = [];
  // Each image XObject's entry, by object number, with the placements still being collected into it.
  const xobjects = new Map<number, PdfImagePlacement[]>();
  pageDicts.forEach((page, pageIndex) => {
    if (selection !== undefined && !selection.has(pageIndex)) {
      return;
    }
    throwIfAborted(signal);
    const interpreted = interpretPage(doc, pageIndex, page, layerNameOf, sink);
    if (interpreted === undefined) {
      return;
    }
    let occurrence = 0;
    for (const item of interpreted.items) {
      if (item.kind === "inlineImage") {
        const locator: PdfImageLocator = {
          kind: "inline",
          pageIndex,
          occurrence: occurrence++,
        };
        const placement = visiblePlacement(
          pageIndex,
          item.matrix,
          item.layerName,
          interpreted,
        );
        if (placement !== undefined && !isImageMask(item.dict)) {
          entries.push({
            locator,
            ...entryFacts(item.dict, item.data.length),
            placements: [placement],
          });
        }
        continue;
      }
      if (item.kind !== "image") {
        continue;
      }
      const ref = xobjectReference(doc, item.resources, item.resourceName);
      const stream = ref === undefined ? undefined : doc.resolve(ref);
      if (
        ref === undefined ||
        stream?.kind !== "stream" ||
        isImageMask(stream.dict)
      ) {
        continue;
      }
      const placement = visiblePlacement(
        pageIndex,
        item.matrix,
        item.layerName,
        interpreted,
      );
      if (placement === undefined) {
        continue;
      }
      const placements = xobjects.get(ref.num);
      if (placements !== undefined) {
        placements.push(placement);
        continue;
      }
      const collected = [placement];
      xobjects.set(ref.num, collected);
      entries.push({
        locator: {
          kind: "xobject",
          objectNumber: ref.num,
          generation: ref.gen,
        },
        ...entryFacts(stream.dict, stream.raw.length),
        placements: collected,
      });
    }
  });
  return entries;
}

function decodeImage(
  doc: PdfDocument,
  pageDicts: readonly PdfDict[],
  locator: PdfImageLocator,
  sink: PdfDiagnosticSink,
): DecodedPdfImage | undefined {
  let extracted: ExtractedPdfImage | undefined;
  if (locator.kind === "xobject") {
    const stream = doc.resolve({
      kind: "ref",
      num: locator.objectNumber,
      gen: locator.generation,
    });
    // The interpreter draws an XObject as an image exactly when its /Subtype says so, so that is what a locator must name.
    if (
      stream?.kind !== "stream" ||
      asName(dictGet(stream.dict, "Subtype")) !== "Image"
    ) {
      throw new PdfImageLocatorError(
        locator,
        `object ${String(locator.objectNumber)} ${String(locator.generation)} R is not an image XObject stream of this document`,
      );
    }
    extracted = readImageXObject(stream.dict, stream.raw, doc, sink);
  } else {
    // The page index is resolved like a one-page selection, so a locator naming no page throws PdfPageSelectionError as a selection would.
    const [pageIndex = 0] = resolvePageSelection(
      [locator.pageIndex],
      pageDicts.length,
    );
    const page = pageDicts[pageIndex];
    const inline =
      page === undefined
        ? undefined
        : interpretPage(doc, pageIndex, page, undefined, sink)?.items.filter(
            (item) => item.kind === "inlineImage",
          )[locator.occurrence];
    if (inline === undefined) {
      throw new PdfImageLocatorError(
        locator,
        `page ${String(locator.pageIndex)} holds no inline image at occurrence ${String(locator.occurrence)}`,
      );
    }
    extracted = readImageXObject(inline.dict, inline.data, doc, sink);
  }
  return extracted === undefined
    ? undefined
    : { ...extracted, imageId: imageIdOf(extracted.bytes) };
}

/**
 * Opens a PDF for reading its images one at a time.
 * @param bytes - The PDF file.
 * @param options - A diagnostic sink and an abort signal.
 * @returns The document's images, listed and decoded on request.
 * @throws PdfParseError (or a subclass) for a file that cannot be opened at all, as `readPdf` does.
 */
export function openPdfImages(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfImageReadOptions,
): PdfImages {
  const sink = options?.sink ?? NOOP_DIAGNOSTIC_SINK;
  const signal = options?.signal;
  if (!hasPdfHeader(bytes)) {
    throw new PdfParseError(
      "pdf/no-header",
      'no "%PDF-" header found within the first bytes of the file; this does not look like a PDF at all',
    );
  }
  throwIfAborted(signal);
  const doc = openPdfDocument(bytes, sink);
  const pageDicts = doc.pages();
  return {
    pageCount: pageDicts.length,
    list: (listOptions) =>
      listImages(doc, pageDicts, listOptions, signal, sink),
    decode: (locator) => {
      throwIfAborted(signal);
      return decodeImage(doc, pageDicts, locator, sink);
    },
  };
}

/**
 * Lists the images a PDF's pages draw, by reference and with their placements, without decoding any image stream or keeping any image's bytes.
 * @param bytes - The PDF file.
 * @param options - Which pages to list, a diagnostic sink and an abort signal.
 * @returns One entry per image (see `PdfImages.list`).
 */
export function listPdfImages(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfImageReadOptions & ListPdfImagesOptions,
): PdfImageEntry[] {
  return openPdfImages(bytes, options).list(options);
}

/**
 * Decodes one image of a PDF, named by a locator a listing of the same file returned, without interpreting any page (except an inline image's own page).
 * @param bytes - The PDF file.
 * @param locator - The image.
 * @param options - A diagnostic sink and an abort signal.
 * @returns The image, byte-identical to `readPdf`'s registry entry for it, or undefined for one `readPdf` would leave out (see `PdfImages.decode`).
 */
export function decodePdfImage(
  bytes: Uint8Array<ArrayBuffer>,
  locator: PdfImageLocator,
  options?: PdfImageReadOptions,
): DecodedPdfImage | undefined {
  return openPdfImages(bytes, options).decode(locator);
}
