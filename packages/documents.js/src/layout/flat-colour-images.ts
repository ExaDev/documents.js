/**
 * Removes the images of a PDF's layout that are a single flat colour, so they never reach the extracted text, the content tree or the search index as a run of image placeholders.
 *
 * A bitmap of one colour depicts nothing, whatever its size. PDFs written from Word draw some text and shapes as a flat-colour image under a soft mask (the mask carries the shape, and documents.js reads only the colour), so one page of such a document yields dozens of images that are each a 2 by 2 swatch, and the converted text becomes a run of `image-omitted` placeholders between the words. The words are in the text layer, which this does not touch.
 *
 * Only an image that is provably flat is removed: anything this cannot decode (an interlaced PNG, a format other than PNG, an asset that does not inflate) is kept. Works on the parsed layout, so every reader of it agrees on which images exist; `reconstructWordprocessing` applies it after `dropHiddenLineNumbers`, because an image is what shows a white number over it to be set on a coloured band.
 */
import { base64ToBytes, decodePng } from "byte-codec";
import type { LayoutDocument, LayoutItem } from "pdf-codec";

/** Whether every sample of `plane` equals the first, taken `stride` samples to a pixel: every pixel is the same value. An absent plane (an image with no alpha) is flat. */
function isUniform(plane: Uint8Array | undefined, stride: number): boolean {
  if (plane === undefined) {
    return true;
  }
  return plane.every((sample, index) => sample === plane[index % stride]);
}

/**
 * Whether `base64` is a PNG every pixel of which is the same value: its decoded colour channels, and its alpha channel where it has one, are constant. False for anything `decodePng` cannot read (an interlaced or malformed PNG), so such an image is kept rather than removed on a guess.
 */
export function isFlatColourPng(base64: string): boolean {
  let decoded: ReturnType<typeof decodePng>;
  try {
    decoded = decodePng(base64ToBytes(base64));
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
