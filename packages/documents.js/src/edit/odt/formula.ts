import type { ContentFormula } from "document-schema.js";
import type { Package, XmlElement } from "odf.js";
import { formatOdfLength } from "odf.js";
import type { Box } from "document-schema.js";
import { addFormulaObject } from "../../odf-package/formula";
import { el } from "../../xml/fragment";

// The odt-side counterpart to src/edit/odp/image.ts's insertImageFrameMedia: add the sub-document part (and its manifest entry) through src/odf-package/, then return the draw:frame fragment referencing it, for the caller to place. What differs from the image case is the anchoring, not the mechanics.
//
// A formula frame is written text:anchor-type="as-char" with svg:width/svg:height and deliberately NO svg:x/svg:y -- the shape LibreOffice itself writes for a formula sitting in a document's text flow, where the frame's position comes from the surrounding text rather than from the frame. That is also exactly the shape src/odf/formula/detect.ts's own flowAnchoredFrameBox exists to resolve geometry for, since odf.js's readDrawFrame correctly resolves none for a frame with no position of its own. Writing an absolutely-positioned frame instead (svg:x/svg:y from the block's own recorded frame) would be wrong twice over: a formula recovered from a PDF or an OOXML equation has no meaningful absolute position to state (its recorded frame origin is 0,0), and a draw:frame is only unambiguously valid ODF as a child of a paragraph, not of office:text directly.
export function buildFormulaFrame(href: string, frame: Box): XmlElement {
  return el(
    "draw:frame",
    {
      "text:anchor-type": "as-char",
      "svg:width": formatOdfLength(frame.widthPt),
      "svg:height": formatOdfLength(frame.heightPt),
    },
    [el("draw:object", { "xlink:href": href })],
  );
}

export function insertFormulaFrameMedia(
  pkg: Package,
  frame: Box,
  formula: ContentFormula,
): XmlElement {
  const { href } = addFormulaObject(pkg, formula);
  return buildFormulaFrame(href, frame);
}
