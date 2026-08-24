import type { Package, XmlElement } from "odf.js";
import type { Box } from "document-schema.js";
import { addImageMedia } from "../../odf-package/media";
import { buildImageFrame } from "./shape";

export interface ImageInit {
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array<ArrayBuffer>;
  // Mirrors pptx/image.ts's own ImageInit.altText for API-shape parity across the two sibling editors -- not yet wired into any XML attribute, matching that sibling's own identical, pre-existing scope (pptx/image.ts's insertPictureShapeMedia never passes altText into buildPictureShape either). odf.js's own readDrawImageBlock (typed/draw/shapes.ts) does not read image alt text back into ContentImageBlock, so there is nothing downstream in this package to round-trip a written value against yet.
  readonly altText?: string;
}

export interface MediaContext {
  readonly pkg: Package;
}

// Adds the binary media part + manifest entry, then returns the draw:frame fragment referencing it, positioned at `frame`. The caller (OdpSlide) inserts the returned element into the slide's own draw:page children. Unlike pptx/image.ts's own insertPictureShapeMedia, there is no per-shape numeric id to allocate (ODF's draw:frame carries no OOXML-style p:cNvPr/@id requirement) and no relationship id either (see shape.ts's own buildImageFrame comment).
export function insertImageFrameMedia(
  context: MediaContext,
  frame: Box,
  image: ImageInit,
): XmlElement {
  const { partPath } = addImageMedia(context.pkg, image.bytes, image.format);
  return buildImageFrame(partPath, frame);
}
