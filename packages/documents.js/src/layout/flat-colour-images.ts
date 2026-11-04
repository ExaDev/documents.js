/**
 * Removes the images of a PDF's layout that are a single flat colour, so they never reach the extracted text, the content tree or the search index as a run of image placeholders.
 *
 * A bitmap of one colour depicts nothing, whatever its size. PDFs written from Word draw some text and shapes as a flat-colour image under a soft mask (the mask carries the shape, and documents.js reads only the colour), so one page of such a document yields dozens of images that are each a 2 by 2 swatch, and the converted text becomes a run of `image-omitted` placeholders between the words. The words are in the text layer, which this does not touch.
 *
 * Only an image that is provably flat is removed: anything this cannot decode (an interlaced PNG, a format other than PNG, an asset that does not inflate) is kept. Works on the parsed layout, so every reader of it agrees on which images exist; `reconstructWordprocessing` applies it after `dropHiddenLineNumbers`, because an image is what shows a white number over it to be set on a coloured band.
 */
import { Unzlib } from "fflate";
import { base64ToBytes, decodePng, unfilterScanlines } from "byte-codec";
import type { LayoutDocument, LayoutItem } from "pdf-codec";

// The PNG signature, then each chunk as a four-byte length, a four-byte type, its data and a four-byte checksum (ISO/IEC 15948 section 5.2 and 5.3).
const SIGNATURE_BYTES = 8;
const INTEGER_BYTES = 4;

// Where the header chunk's data starts and what it holds (section 11.2.2): width and height as four-byte integers, then the bit depth, the colour type, the compression method, the filter method and the interlace method as one byte each.
const HEADER_DATA_OFFSET = SIGNATURE_BYTES + INTEGER_BYTES + INTEGER_BYTES;
const HEIGHT_OFFSET = HEADER_DATA_OFFSET + INTEGER_BYTES;
const BIT_DEPTH_OFFSET = HEIGHT_OFFSET + INTEGER_BYTES;
const COLOUR_TYPE_OFFSET = BIT_DEPTH_OFFSET + 1;
const COMPRESSION_AND_FILTER_METHOD_BYTES = 2;
const INTERLACE_OFFSET =
  COLOUR_TYPE_OFFSET + 1 + COMPRESSION_AND_FILTER_METHOD_BYTES;
const EIGHT_BITS_A_SAMPLE = 8;
const NOT_INTERLACED = 0;

/** The colour types whose samples are one byte each at eight bits and which carry no palette, with the samples to a pixel: greyscale, truecolour, greyscale with alpha and truecolour with alpha. */
const GREYSCALE = 0;
const TRUECOLOUR = 2;
const GREYSCALE_WITH_ALPHA = 4;
const TRUECOLOUR_WITH_ALPHA = 6;
const ONE_SAMPLE = 1;
const TWO_SAMPLES = 2;
const THREE_SAMPLES = 3;
const FOUR_SAMPLES = 4;
const SAMPLES_TO_A_PIXEL = new Map([
  [GREYSCALE, ONE_SAMPLE],
  [TRUECOLOUR, THREE_SAMPLES],
  [GREYSCALE_WITH_ALPHA, TWO_SAMPLES],
  [TRUECOLOUR_WITH_ALPHA, FOUR_SAMPLES],
]);

/** The ASCII of the image data chunk's type, `IDAT`. */
const IDAT = "IDAT";

/** Thrown from the inflater's callback to stop it once the first scanline is out, so the rest of the image is never inflated. */
class FirstScanlineReached extends Error {}

/** The data of every `IDAT` chunk of `png` joined in order, the zlib stream the image data is written as. Stops at the first chunk that runs past the end. */
function imageData(png: Uint8Array): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const decoder = new TextDecoder("latin1");
  const parts: Uint8Array[] = [];
  let offset = SIGNATURE_BYTES;
  while (offset + INTEGER_BYTES + INTEGER_BYTES <= png.length) {
    const length = view.getUint32(offset);
    const start = offset + INTEGER_BYTES + INTEGER_BYTES;
    if (start + length > png.length) {
      break;
    }
    const type = decoder.decode(png.subarray(offset + INTEGER_BYTES, start));
    if (type === IDAT) {
      parts.push(png.subarray(start, start + length));
    }
    offset = start + length + INTEGER_BYTES;
  }
  const joined = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  parts.reduce((at, part) => {
    joined.set(part, at);
    return at + part.length;
  }, 0);
  return joined;
}

/** Whether every sample of `plane` equals the first, taken `stride` samples to a pixel: every pixel is the same value. An absent plane (an image with no alpha) is flat. */
function isUniform(plane: Uint8Array | undefined, stride: number): boolean {
  if (plane === undefined) {
    return true;
  }
  return plane.every((sample, index) => sample === plane[index % stride]);
}

/**
 * Whether the first scanline of the eight-bit, non-interlaced, palette-free `png` already holds two different pixels, which proves the image is not flat without inflating the rest of it. False when the image is of another kind or its first line is uniform, so the caller decodes it whole.
 */
function firstScanlineVaries(png: Uint8Array): boolean {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const samples = SAMPLES_TO_A_PIXEL.get(png[COLOUR_TYPE_OFFSET] ?? -1);
  if (
    samples === undefined ||
    png.length <= INTERLACE_OFFSET ||
    png[BIT_DEPTH_OFFSET] !== EIGHT_BITS_A_SAMPLE ||
    png[INTERLACE_OFFSET] !== NOT_INTERLACED
  ) {
    return false;
  }
  const bytesInARow = view.getUint32(HEADER_DATA_OFFSET) * samples;
  const wanted = bytesInARow + 1;
  let inflated = new Uint8Array(0);
  try {
    const stream = new Unzlib((chunk) => {
      const grown = new Uint8Array(inflated.length + chunk.length);
      grown.set(inflated);
      grown.set(chunk, inflated.length);
      inflated = grown;
      if (inflated.length >= wanted) {
        throw new FirstScanlineReached();
      }
    });
    stream.push(imageData(png), true);
  } catch (error) {
    if (!(error instanceof FirstScanlineReached)) {
      return false;
    }
  }
  if (inflated.length < wanted) {
    return false;
  }
  const row = unfilterScanlines(
    new Uint8Array(inflated.subarray(0, wanted)),
    1,
    bytesInARow,
    samples,
  );
  return !isUniform(row, samples);
}

/**
 * Whether `base64` is a PNG every pixel of which is the same value: its decoded colour channels, and its alpha channel where it has one, are constant. False for anything `decodePng` cannot read (an interlaced or malformed PNG), so such an image is kept rather than removed on a guess.
 *
 * An image whose first scanline already varies is not flat, and is answered from that line alone: a page-sized picture or scan would otherwise be inflated and decoded whole to learn what its first row shows, once for every read of its page.
 */
export function isFlatColourPng(base64: string): boolean {
  const png = base64ToBytes(base64);
  if (firstScanlineVaries(png)) {
    return false;
  }
  let decoded: ReturnType<typeof decodePng>;
  try {
    decoded = decodePng(png);
  } catch {
    // An asset that does not decode is not provably flat, so it stays in the conversion.
    return false;
  }
  return (
    isUniform(decoded.data, decoded.channels) && isUniform(decoded.alpha, 1)
  );
}

function isImage(
  item: LayoutItem,
): item is Extract<LayoutItem, { kind: "image" }> {
  return item.kind === "image";
}

/**
 * `layoutDoc` without every image whose asset is a flat-colour PNG (`isFlatColourPng`), and without those assets. A document with no such image is returned as the same object.
 */
export function dropFlatColourImages(
  layoutDoc: LayoutDocument,
): LayoutDocument {
  const flat = new Set(
    Object.entries(layoutDoc.images)
      .filter(
        ([, asset]) => asset.format === "png" && isFlatColourPng(asset.base64),
      )
      .map(([imageId]) => imageId),
  );
  if (flat.size === 0) {
    return layoutDoc;
  }
  return {
    ...layoutDoc,
    images: Object.fromEntries(
      Object.entries(layoutDoc.images).filter(
        ([imageId]) => !flat.has(imageId),
      ),
    ),
    pages: layoutDoc.pages.map((page) => ({
      ...page,
      items: page.items.filter(
        (item) => !(isImage(item) && flat.has(item.imageId)),
      ),
    })),
  };
}
