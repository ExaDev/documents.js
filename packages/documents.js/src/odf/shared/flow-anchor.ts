import type { XmlElement } from "odf.js";
import { attrValue, parseOdfLength } from "odf.js";
import type { Box } from "document-schema.js";

// A frame anchored INTO the text flow (text:anchor-type="as-char" or "char" -- the shape LibreOffice writes for an object typed inline in a paragraph: a formula, or an inline image) carries svg:width/svg:height but no svg:x, because its horizontal position is decided by the surrounding text, not by the frame. odf.js's own readDrawFrame therefore resolves no geometry for one at all (resolveOdfShapeGeometry -> parseBox requires all four of svg:x/y/width/height), which is correct for its own purpose -- a shape with no position cannot be placed on a slide -- but wrong for a wordprocessing flow, where the layout engine derives x/y from the flow itself and reads only the frame's own declared size (see src/layout/engine.ts's own formulaSizePtFromFrame for the formula case, and readDrawImageBlock's own widthPt/heightPt-from-frameBox use for the image case). This recovers exactly that: the declared size, at a zero origin the flow will replace.
//
// Shared between src/odf/formula/detect.ts and src/odf/image/detect.ts, since both walk the identical deep draw:frame shapes (direct child, nested in a group, anchored inline in a paragraph run) and need the identical fallback once odf.js's own readDrawFrame resolves no geometry for a flow-anchored frame.
export function flowAnchoredFrameBox(frame: XmlElement): Box | undefined {
  const widthValue = attrValue(frame, "svg:width");
  const heightValue = attrValue(frame, "svg:height");
  if (widthValue === undefined || heightValue === undefined) {
    return undefined;
  }
  const widthPt = parseOdfLength(widthValue);
  const heightPt = parseOdfLength(heightValue);
  if (widthPt === undefined || heightPt === undefined) {
    return undefined;
  }
  return { xPt: 0, yPt: 0, widthPt, heightPt };
}
