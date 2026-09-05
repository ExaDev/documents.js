import type { Package, XmlElement, XmlNode } from "odf.js";
import { formatOdfLength } from "odf.js";
import type { Box } from "document-schema.js";
import { addImageMedia } from "../../odf-package/media";
import { el } from "../../xml/fragment";
import { encodeOdfText } from "../../xml/odf-text";

export interface ImageInit {
  readonly format: "png" | "jpeg" | "svg" | "gif";
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly altText?: string;
}

// The odt-side counterpart to src/edit/odp/image.ts's insertImageFrameMedia and src/edit/odt/formula.ts's own insertFormulaFrameMedia: add the binary media part (and its manifest entry) through src/odf-package/, then return the draw:frame fragment referencing it, for the caller (OdtParagraph.insertImageAfter) to place.
//
// An image frame is written text:anchor-type="as-char" with svg:width/svg:height and deliberately NO svg:x/svg:y -- the exact shape buildFormulaFrame (src/edit/odt/formula.ts) already writes for a formula sitting in a document's text flow, where the frame's position comes from the surrounding text rather than from the frame. That is also exactly the shape src/odf/shared/flow-anchor.ts's own flowAnchoredFrameBox exists to resolve geometry for, since odf.js's readDrawFrame correctly resolves none for a frame with no position of its own. Writing an absolutely-positioned frame instead would be wrong for the same reason it would be for a formula: a draw:frame is only unambiguously valid ODF as a child of a paragraph (or as a direct sibling in office:text -- see src/odf/vector/detect.ts's own bare-vector fixture), not floating with no anchor at all, and an inline image genuinely has no meaningful absolute position to state.
//
// altText becomes a real svg:title CHILD ELEMENT (the OASIS ODF 1.2 schema's own content model for a draw:frame: an optional svg:title, then an optional svg:desc, then the frame's real content), written via encodeOdfText -- never a plain attribute, and never via a raw text node, for the identical reason every other ODF text getter/setter in this codebase must go through encodeOdfText/decodeOdfText (see src/xml/odf-text.ts's own top-of-file warning). odf.js's own readDrawImageBlock reads it straight back via readFrameAltText, which resolves svg:title (falling back to svg:desc) through its own decodeOdfText call.
export function buildImageFrame(
  href: string,
  frame: Box,
  altText?: string,
): XmlElement {
  const children: XmlNode[] = [];
  if (altText !== undefined) {
    children.push(el("svg:title", {}, encodeOdfText(altText)));
  }
  children.push(el("draw:image", { "xlink:href": href }));
  return el(
    "draw:frame",
    {
      "text:anchor-type": "as-char",
      "svg:width": formatOdfLength(frame.widthPt),
      "svg:height": formatOdfLength(frame.heightPt),
    },
    children,
  );
}

export function insertImageFrameMedia(
  pkg: Package,
  frame: Box,
  image: ImageInit,
): XmlElement {
  const { partPath } = addImageMedia(pkg, image.bytes, image.format);
  return buildImageFrame(partPath, frame, image.altText);
}
