import type { Box } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { attrValue } from "../../xml/query";
import { parseOdfLength } from "./units";
import { parseBox } from "./geometry";

// ODF's draw:transform: a shape's rotation and position collapsed into a single attribute, e.g. draw:transform="rotate(0.5235987755982988) translate(3.528cm 3.528cm)" -- a space-separated list of transform functions, applied in DOCUMENT order (left to right) directly to the shape's own local geometry, one function at a time. Only rotate(<angle-in-radians>) and translate(<length> [<length>]) are modelled here (scale/skewX/skewY/matrix are valid per the OASIS grammar but not produced by any real presentation-shape rotation this package has verified against, and are silently skipped -- a documented, narrow scope boundary, not a silent one).
//
// The exact composition rule below (left-to-right application, each rotate() pivoting about whatever point the pipeline has reached so far, rotate(angle) rotating CLOCKWISE on screen for positive angle once translate is folded in) was reverse-engineered empirically, not assumed from SVG's own transform-list convention (which composes the OPPOSITE way -- rightmost function applied first): a shape was rotated by a known angle in a real LibreOffice-round-tripped .odp (rotate(pi/2) then rotate(pi/6), each combined with a known translate), rendered to PDF via `soffice --headless --convert-to pdf`, and its rendered pixel bounding box was measured and compared against every plausible composition-order/sign hypothesis. Only "apply functions left to right, rotate(theta) mapping a current point (x,y) to (x*cos(theta) + y*sin(theta), y*cos(theta) - x*sin(theta))" reproduced the measured geometry, for both test angles. See this package's own repository history (the commit introducing this file) for the verification method; re-deriving this from the OASIS spec text alone reliably gets the sign/order wrong, since the naive "rightmost-applied-first" SVG reading does not match what real ODF producers/consumers actually do.

export type OdfTransformFunction =
  | { readonly kind: "rotate"; readonly angleRad: number }
  | { readonly kind: "translate"; readonly xPt: number; readonly yPt: number };

export interface OdfPoint {
  readonly xPt: number;
  readonly yPt: number;
}

const FUNCTION_PATTERN = /([a-zA-Z]+)\s*\(\s*([^)]*?)\s*\)/g;

// Parses a draw:transform attribute value into its function list, in document order. A function this module doesn't model (scale/skewX/skewY/matrix), or one whose arguments don't parse (a malformed angle, a translate length outside the ODF `length` grammar), is skipped rather than aborting the whole parse -- the remaining, well-formed functions still contribute, matching this package's general "degrade a single unsupported feature, don't fail the whole read" policy.
export function parseOdfTransform(value: string): OdfTransformFunction[] {
  const functions: OdfTransformFunction[] = [];
  for (const match of value.matchAll(FUNCTION_PATTERN)) {
    const name = match[1];
    const argsRaw = match[2];
    if (name === undefined || argsRaw === undefined) {
      continue;
    }
    const args = argsRaw.split(/\s+/).filter((arg) => arg.length > 0);
    if (name === "rotate") {
      const angleArg = args[0];
      if (angleArg === undefined) {
        continue;
      }
      const angleRad = Number(angleArg);
      if (!Number.isFinite(angleRad)) {
        continue;
      }
      functions.push({ kind: "rotate", angleRad });
    } else if (name === "translate") {
      const xArg = args[0];
      if (xArg === undefined) {
        continue;
      }
      const yArg = args[1];
      const xPt = parseOdfLength(xArg);
      const yPt = yArg === undefined ? 0 : parseOdfLength(yArg);
      if (xPt === undefined || yPt === undefined) {
        continue;
      }
      functions.push({ kind: "translate", xPt, yPt });
    }
  }
  return functions;
}

// Applies a transform-function list to a point, left to right (see this module's own top-of-file note on why this order, and not SVG's own rightmost-first convention). rotate(theta) rotates the CURRENT point -- wherever the pipeline has already moved it to by any preceding function -- about the origin (0,0) of that current coordinate value; translate(tx,ty) is a plain offset. Composed this way, a shape's own rotate()-then-translate() pivots about its own local top-left corner (the origin its untransformed svg:width/svg:height box is defined against) and lands wherever translate() then places that pivot -- see resolveOdfShapeGeometry below for how this gets turned into a center-pivoting frame+rotationDeg instead.
export function applyOdfTransform(
  functions: readonly OdfTransformFunction[],
  point: OdfPoint,
): OdfPoint {
  let current = point;
  for (const fn of functions) {
    if (fn.kind === "rotate") {
      const cos = Math.cos(fn.angleRad);
      const sin = Math.sin(fn.angleRad);
      current = {
        xPt: current.xPt * cos + current.yPt * sin,
        yPt: current.yPt * cos - current.xPt * sin,
      };
    } else {
      current = { xPt: current.xPt + fn.xPt, yPt: current.yPt + fn.yPt };
    }
  }
  return current;
}

// The net clockwise-on-screen rotation (in degrees, matching document-schema.js's ContentShape.rotationDeg convention -- see ooxml.js's own DrawingXfrm.rotationDeg: "Clockwise, per ECMA-376's own a:xfrm/@rot convention", which this package's ContentShape shares) contributed by every rotate() function in the list, summed. Translation contributes no rotation; summing (rather than composing rotation matrices) is exact here because every function this module models is a pure rotation or a pure translation, never a scale/skew that would make the two non-commutative for this purpose.
export function netRotationDeg(
  functions: readonly OdfTransformFunction[],
): number {
  let totalRad = 0;
  for (const fn of functions) {
    if (fn.kind === "rotate") {
      totalRad += fn.angleRad;
    }
  }
  return (-totalRad * 180) / Math.PI;
}

export interface OdfShapeGeometry {
  readonly frame: Box;
  readonly rotationDeg: number | undefined;
}

// Resolves a positioned drawing element's geometry: either the plain, unrotated svg:x/svg:y/svg:width/svg:height case (delegated to geometry.ts's own parseBox), or -- when draw:transform is present -- svg:width/svg:height for size plus the transform's own rotate()/translate() functions for position and rotation. In the transform case, real ODF carries NO svg:x/svg:y at all (confirmed: draw:transform's translate() component replaces them entirely, verified against a real LibreOffice odp->odp round trip) -- svg:width/svg:height alone are still required, since a shape's SIZE is never itself part of draw:transform.
//
// The returned frame is always the shape's own UNROTATED box (top-left + size), centered under the transform's own rotation pivot, with rotationDeg the clockwise-on-screen degrees a renderer should apply ABOUT THE BOX'S OWN CENTER to reproduce the real geometry -- matching how ContentShape.rotationDeg is already used elsewhere in this package family (see ooxml.js's own pptx reader), even though ODF's own draw:transform pivots about the box's local top-left, not its center: the center point is computed by applying the SAME transform pipeline to the box's own local center (widthPt/2, heightPt/2) rather than its local origin, which is provably equivalent to a center-pivoting rotation for a rigid (rotation + translation only, no scale/skew) transform -- see this module's own commit history for the derivation.
//
// Returns undefined when the element carries no resolvable geometry at all (missing svg:width/svg:height, or a transform/box that doesn't parse) -- out of scope, deliberately: a frame that relies on master-page/layout-level positioning inheritance rather than carrying its own explicit geometry is not resolved here, and reads with no box at all rather than a fabricated zero-size or origin one.
export function resolveOdfShapeGeometry(
  element: XmlElement,
): OdfShapeGeometry | undefined {
  const transformValue = attrValue(element, "draw:transform");
  if (transformValue === undefined) {
    const box = parseBox(element);
    return box === undefined
      ? undefined
      : { frame: box, rotationDeg: undefined };
  }

  const widthValue = attrValue(element, "svg:width");
  const heightValue = attrValue(element, "svg:height");
  if (widthValue === undefined || heightValue === undefined) {
    return undefined;
  }
  const widthPt = parseOdfLength(widthValue);
  const heightPt = parseOdfLength(heightValue);
  if (widthPt === undefined || heightPt === undefined) {
    return undefined;
  }

  const functions = parseOdfTransform(transformValue);
  const center = applyOdfTransform(functions, {
    xPt: widthPt / 2,
    yPt: heightPt / 2,
  });
  const rotationDeg = netRotationDeg(functions);
  return {
    frame: {
      xPt: center.xPt - widthPt / 2,
      yPt: center.yPt - heightPt / 2,
      widthPt,
      heightPt,
    },
    rotationDeg: rotationDeg === 0 ? undefined : rotationDeg,
  };
}

// Composes an enclosing draw:g's own transform-function list onto an already-resolved child shape's geometry -- the group-flattening counterpart to resolveOdfShapeGeometry above, mirroring how OOXML's p:grpSp group-flattening composes a parent group's off/ext/chOff/chExt onto each child (see ooxml.js's src/typed/pptx/read.ts applyGroupTransform/composeGroupTransform), adapted to ODF's own model: unlike OOXML, a real ODF draw:g carries no chOff/chExt child-coordinate remapping at all (confirmed: a real LibreOffice-generated group's children carry their own literal, already-page-space svg:x/svg:y -- grouping is a purely logical/selection construct with no coordinate-space effect in practice), and a draw:g's own draw:transform is likewise not something LibreOffice's own Impress import currently honours on render (confirmed via a controlled round-trip render test: a hand-added draw:g/@draw:transform survives re-import/re-export as inert, unrendered XML). This function still implements composition for a group-level draw:transform when present -- it is valid per the OASIS schema, mirrors the OOXML sibling reader's own group-composition contract exactly as this package's own architecture requires, and protects against any OTHER real-world ODF producer that DOES emit or honour one; it is simply, per the evidence above, dead weight for LibreOffice's own output specifically.
//
// A pure rotation+translation group transform applied to a rigid (already rotationDeg-summarized) child box produces another rigid box: the child's own center maps through the SAME function-list pipeline resolveOdfShapeGeometry itself uses, and the added rotation is this function-list's own netRotationDeg, summed onto the child's existing rotationDeg -- width/height are unchanged, since neither this module nor ODF's own group model (per the above) supports scaling a group's children.
export function composeOdfGroupTransform(
  groupFunctions: readonly OdfTransformFunction[],
  child: OdfShapeGeometry,
): OdfShapeGeometry {
  if (groupFunctions.length === 0) {
    return child;
  }
  const childCenter: OdfPoint = {
    xPt: child.frame.xPt + child.frame.widthPt / 2,
    yPt: child.frame.yPt + child.frame.heightPt / 2,
  };
  const newCenter = applyOdfTransform(groupFunctions, childCenter);
  const newRotationDeg =
    (child.rotationDeg ?? 0) + netRotationDeg(groupFunctions);
  return {
    frame: {
      xPt: newCenter.xPt - child.frame.widthPt / 2,
      yPt: newCenter.yPt - child.frame.heightPt / 2,
      widthPt: child.frame.widthPt,
      heightPt: child.frame.heightPt,
    },
    rotationDeg: newRotationDeg === 0 ? undefined : newRotationDeg,
  };
}
