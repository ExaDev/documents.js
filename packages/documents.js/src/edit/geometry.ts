import type { XmlElement } from "odf.js";
import { applyOdfTransform, formatOdfLength } from "odf.js";
import type { Box } from "document-schema.js";
import { removeAttr, setAttr } from "../xml/edit";

// The write side of ODF's own shape-geometry representation, shared by every editable element whose geometry odf.js resolves through the SAME resolveOdfShapeGeometry (typed/shared/transform.ts): a draw:frame (src/edit/odp/shape.ts's OdpShape, reused wholesale by odg), and the odg vector primitives draw:rect/draw:ellipse/draw:path (src/edit/odg/vector.ts). draw:line is the one exception and deliberately absent from this module's callers -- it carries two endpoints (svg:x1/y1/x2/y2) rather than a box, has no draw:transform handling in odf.js's own readDrawLineVector, and ContentVectorSchema's own 'line' variant has no rotationDeg field to write in the first place.
//
// Lives here, a peer of the per-format edit directories, rather than inside src/edit/odp/: the machinery is genuinely format-neutral (odp, odg, and any future ODF editor resolve geometry identically), and putting it in odp/ would make odg/vector.ts depend on the presentation editor for something that has nothing to do with presentations.

// The write-side inverse of odf.js's own resolveOdfShapeGeometry: given an element's own unrotated frame and a target clockwise-on-screen rotationDeg, produces a draw:transform="rotate(angleRad) translate(txPt typPt)" string that, fed back through resolveOdfShapeGeometry, reproduces exactly `frame` and `rotationDeg`. This reuses applyOdfTransform -- the SAME exported function resolveOdfShapeGeometry's own read side uses to fold rotate()/translate() together -- rather than re-deriving the rotation matrix and its sign convention by hand: angleRad is the exact algebraic inverse of transform.ts's own netRotationDeg ("(-totalRad * 180) / Math.PI" for a single rotate()), and the translate offset is computed by asking applyOdfTransform where a bare rotate(angleRad) would place the frame's own local centre, then translating by whatever remains to reach the frame's real centre. See transform.ts's own top-of-file note for how the rotate-then-translate composition order and the clockwise-positive sign convention were empirically verified against real LibreOffice-rendered output -- this function inherits that verification by construction rather than re-deriving it, which is the whole point of building it on applyOdfTransform instead of a hand-rolled rotation matrix.
export function buildTransformAttr(frame: Box, rotationDeg: number): string {
  const angleRad = (-rotationDeg * Math.PI) / 180;
  const localCenter = { xPt: frame.widthPt / 2, yPt: frame.heightPt / 2 };
  const rotatedCenter = applyOdfTransform(
    [{ kind: "rotate", angleRad }],
    localCenter,
  );
  const desiredCenter = {
    xPt: frame.xPt + frame.widthPt / 2,
    yPt: frame.yPt + frame.heightPt / 2,
  };
  const txPt = desiredCenter.xPt - rotatedCenter.xPt;
  const tyPt = desiredCenter.yPt - rotatedCenter.yPt;
  return `rotate(${angleRad}) translate(${formatOdfLength(txPt)} ${formatOdfLength(tyPt)})`;
}

// Rewrites an element's own position/size/rotation attributes together, since ODF ties all three into one representation: an unrotated element carries plain svg:x/svg:y/svg:width/svg:height, while a rotated one carries svg:width/svg:height plus draw:transform and NO svg:x/svg:y at all -- real ODF never mixes the two (confirmed against a real LibreOffice odp->odp round trip; see transform.ts's own resolveOdfShapeGeometry comment), so setting either frame or rotationDeg alone still needs to rebuild the other's own current value into this same combined representation.
export function applyOdfGeometry(
  node: XmlElement,
  frame: Box,
  rotationDeg: number | undefined,
): void {
  setAttr(node, "svg:width", formatOdfLength(frame.widthPt));
  setAttr(node, "svg:height", formatOdfLength(frame.heightPt));
  if (rotationDeg === undefined || rotationDeg === 0) {
    removeAttr(node, "draw:transform");
    setAttr(node, "svg:x", formatOdfLength(frame.xPt));
    setAttr(node, "svg:y", formatOdfLength(frame.yPt));
    return;
  }
  removeAttr(node, "svg:x");
  removeAttr(node, "svg:y");
  setAttr(node, "draw:transform", buildTransformAttr(frame, rotationDeg));
}
