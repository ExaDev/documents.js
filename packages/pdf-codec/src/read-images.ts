import type { PdfDiagnosticSink } from "./diagnostics";
import {
  NOOP_DIAGNOSTIC_SINK,
  PdfImageLocatorError,
  PdfParseError,
} from "./diagnostics";
import { openPdfDocument } from "./document";
import type { PdfDocument } from "./document";
import { filterNames } from "./filters";
import type { PdfImageLocator } from "./image-locator";
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
import { throwIfAborted } from "./util/abort";

// The image registry readPdf builds, taken apart into its two halves so a memory-capped caller (a Worker isolate shelving a picture-heavy PDF) can pay for one image at a time: listing finds every image a page draws, where it draws it, and the reference that names it (image-locator.ts), without decoding any image stream; decoding turns one image, named by that reference, into exactly the bytes readPdf's registry holds for it (the same readImageXObject call on the same stream), without interpreting any page again. readPdf decodes every image during its one pass and keeps each as a base64 string, so its memory grows with the number of images; here nothing outlives the call that decoded it.

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

/** One image decoded: exactly the bytes, format and size `readPdf`'s registry holds for it, and the id `readPdf` names it by. Its byte arrays are its own, never views onto the PDF file's bytes, so keeping one does not keep the file alive. */
export interface DecodedPdfImage extends ExtractedPdfImage {
  /** `img` and the CRC-32 of `bytes`, the key `readPdf` registers the image under in `LayoutDocument.images`. */
  readonly imageId: string;
}

export interface PdfImageReadOptions {
  /** Receives every recoverable diagnostic, as `readPdf`'s sink does. */
  readonly sink?: PdfDiagnosticSink;
  /** Checked before the document is opened, before each listed page, and before each decode. The signal given when the document is opened is the one every later `list` and `decode` of it checks. */
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
   *
   * The listing follows the images `readPdf`'s pages draw, not its registry: two entries whose streams decode to the same bytes (the same picture stored twice) both appear here, and decode to the same `imageId`, where the registry holds the picture once. A caller storing decoded images by `imageId` stores it once too.
   * @param options - Which pages to list.
   * @returns One entry per image XObject drawn (in the order first drawn), and one per inline image, each with every visible placement.
   * @throws PdfPageSelectionError if `pages` names a page the document does not have.
   */
  list: (options?: ListPdfImagesOptions) => PdfImageEntry[];
  /**
   * Decodes one image.
   *
   * An `xobject` locator is not checked against a listing: it names any image XObject stream in the file by its object number, so one naming a stream no page draws (another image's `/SMask`, or a page's `/Thumb` thumbnail) decodes that stream as an image, as `readPdf` would decode it had a page drawn it. The handle keeps the inline images of the last page it found an inline image on, so decoding a page's inline images one after another interprets that page once.
   * @param locator - The image, as a listing of this same file named it.
   * @returns The image, or undefined for one `readPdf` would leave out of its registry too (an `/ImageMask` stencil, an unsupported filter, colour space or bit depth, an invalid size, or an undecodable stream), with the same diagnostic `readPdf` reports for it.
   * @throws PdfImageLocatorError if the locator names nothing that can be decoded as an image: an object that is not a stream whose `/Subtype` is `/Image`, or a page index or occurrence that is negative, not an integer, or past the page's inline images.
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
  // Each image XObject's placements, still being collected, by its stream: two references that resolve to one stream (a reference to a reference) name one image, listed under the first reference seen.
  const xobjects = new Map<PdfObject, PdfImagePlacement[]>();
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
      const placements = xobjects.get(stream);
      if (placements !== undefined) {
        placements.push(placement);
        continue;
      }
      const collected = [placement];
      xobjects.set(stream, collected);
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

// The bytes a decode returns as an array of their own: an image whose stream needs no decoding (a JPEG's, or a JPEG 2000 or JBIG2 original) is otherwise a view onto the file, and would keep the whole file alive for as long as the caller keeps the image.
function detachedFrom(
  file: ArrayBufferLike,
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return bytes.buffer === file ? bytes.slice() : bytes;
}

function detachedImage(
  file: ArrayBufferLike,
  image: ExtractedPdfImage,
): ExtractedPdfImage {
  const { original } = image;
  return {
    ...image,
    bytes: detachedFrom(file, image.bytes),
    ...(original !== undefined
      ? {
          original: {
            ...original,
            bytes: detachedFrom(file, original.bytes),
            ...(original.globalsBytes !== undefined
              ? { globalsBytes: detachedFrom(file, original.globalsBytes) }
              : {}),
          },
        }
      : {}),
  };
}

function isLocatorIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

// One page's inline images, in content-stream order.
interface PageInlineImages {
  readonly pageIndex: number;
  readonly images: readonly Extract<ExtractedItem, { kind: "inlineImage" }>[];
}

// The inline images a page draws, found by interpreting its content again. The page's own diagnostics were reported when it was listed, so finding them again reports nothing new.
function inlineImagesOf(
  doc: PdfDocument,
  pageIndex: number,
  page: PdfDict | undefined,
): PageInlineImages {
  const items =
    page === undefined
      ? []
      : (interpretPage(doc, pageIndex, page, undefined, NOOP_DIAGNOSTIC_SINK)
          ?.items ?? []);
  return {
    pageIndex,
    images: items.filter((item) => item.kind === "inlineImage"),
  };
}

function decodeImage(
  doc: PdfDocument,
  pageDicts: readonly PdfDict[],
  locator: PdfImageLocator,
  sink: PdfDiagnosticSink,
  inlineImagesOn: (
    pageIndex: number,
    page: PdfDict | undefined,
  ) => PageInlineImages,
): ExtractedPdfImage | undefined {
  if (locator.kind === "xobject") {
    const stream = doc.resolve({
      kind: "ref",
      num: locator.objectNumber,
      gen: locator.generation,
    });
    // The interpreter draws an XObject as an image exactly when its /Subtype says so, so that is what a locator must name. Whether a page draws it is not checked, since that would mean interpreting every page.
    if (
      stream?.kind !== "stream" ||
      asName(dictGet(stream.dict, "Subtype")) !== "Image"
    ) {
      throw new PdfImageLocatorError(
        locator,
        `object ${String(locator.objectNumber)} ${String(locator.generation)} R is not an image XObject stream of this document`,
      );
    }
    return readImageXObject(stream.dict, stream.raw, doc, sink);
  }
  // A locator's page index is the page's own source index, as a listing reports it, never one counted from the end as a page selection's may be.
  if (
    !isLocatorIndex(locator.pageIndex) ||
    !isLocatorIndex(locator.occurrence)
  ) {
    throw new PdfImageLocatorError(
      locator,
      `an inline image locator's pageIndex and occurrence are non-negative integers (got ${String(locator.pageIndex)} and ${String(locator.occurrence)})`,
    );
  }
  // Resolved like a one-page selection, so a locator naming no page throws PdfPageSelectionError as a selection would.
  const [pageIndex = 0] = resolvePageSelection(
    [locator.pageIndex],
    pageDicts.length,
  );
  // Only the image's decode below reports to the caller.
  const inline = inlineImagesOn(pageIndex, pageDicts[pageIndex]).images[
    locator.occurrence
  ];
  if (inline === undefined) {
    throw new PdfImageLocatorError(
      locator,
      `page ${String(locator.pageIndex)} holds no inline image at occurrence ${String(locator.occurrence)}`,
    );
  }
  return readImageXObject(inline.dict, inline.data, doc, sink);
}

/**
 * Opens a PDF for reading its images one at a time.
 * @param bytes - The PDF file.
 * @param options - A diagnostic sink and an abort signal.
 * @returns The document's images, listed and decoded on request.
 * @throws PdfParseError (or a subclass) for a file that cannot be opened at all, as `readPdf` does; a DOMException named AbortError if the signal is already aborted.
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
  // The last page whose inline images were looked for, kept so decoding a page's inline images one by one interprets it once rather than once per image. One page at most: its inline images are views onto its decoded content, which this keeps alive until another page's are looked for.
  let lastInlinePage: PageInlineImages | undefined;
  const inlineImagesOn = (
    pageIndex: number,
    page: PdfDict | undefined,
  ): PageInlineImages => {
    if (lastInlinePage?.pageIndex !== pageIndex) {
      lastInlinePage = inlineImagesOf(doc, pageIndex, page);
    }
    return lastInlinePage;
  };
  return {
    pageCount: pageDicts.length,
    list: (listOptions) =>
      listImages(doc, pageDicts, listOptions, signal, sink),
    decode: (locator) => {
      throwIfAborted(signal);
      const extracted = decodeImage(
        doc,
        pageDicts,
        locator,
        sink,
        inlineImagesOn,
      );
      if (extracted === undefined) {
        return undefined;
      }
      // The id is the CRC-32 of the same bytes either way: detaching copies them, never changes them.
      const image = detachedImage(bytes.buffer, extracted);
      return { ...image, imageId: imageIdOf(image.bytes) };
    },
  };
}

/**
 * Lists the images a PDF's pages draw, by reference and with their placements, without decoding any image stream or keeping any image's bytes.
 * @param bytes - The PDF file.
 * @param options - Which pages to list, a diagnostic sink and an abort signal.
 * @returns One entry per image (see `PdfImages.list`).
 * @throws PdfParseError (or a subclass) for a file that cannot be opened; PdfPageSelectionError for a page the document does not have; a DOMException named AbortError once the signal is aborted.
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
 * @throws PdfParseError (or a subclass) for a file that cannot be opened; PdfImageLocatorError for a locator naming no image of it; PdfPageSelectionError for an inline locator's page the document does not have; a DOMException named AbortError if the signal is already aborted.
 */
export function decodePdfImage(
  bytes: Uint8Array<ArrayBuffer>,
  locator: PdfImageLocator,
  options?: PdfImageReadOptions,
): DecodedPdfImage | undefined {
  return openPdfImages(bytes, options).decode(locator);
}
