import type {
  OdfTransformFunction,
  Package,
  XmlElement,
  XmlNode,
} from "odf.js";
import {
  attrValue,
  childrenWithTag,
  parseOdfTransform,
  readDrawFrame,
} from "odf.js";
import type { ContentFormula } from "document-schema.js";
import type { Box } from "document-schema.js";
import { flowAnchoredFrameBox } from "../shared/flow-anchor";
import { readOdfEmbeddedFormula } from "./read";

export interface DetectedFormulaFrame {
  readonly frameElement: XmlElement;
  readonly formula: ContentFormula;
  readonly frame: Box;
}

// The same DetectedFormulaFrame plus the index of the ContentShape odf.js's own readOdpContent produced for this exact frame -- see collectSlideFormulaFrames below for how that index is derived rather than guessed.
export interface DetectedSlideFormulaFrame extends DetectedFormulaFrame {
  readonly shapeIndex: number;
}

// A draw:object's own xlink:href, pointing at an embedded sub-object, is written by real ODF producers as a package-relative path into the SAME container -- either "./ObjectN" or, per the ODF 1.2 schema's own XLink profile for an internal same-document reference, "#./ObjectN" (a fragment-prefixed form). Both strip down to the same bare "ObjectN" directory name, which is exactly the prefix odf.js's own Package.parts keys embedded-object parts under (e.g. "Object 1/content.xml").
function subPackagePathFromHref(href: string): string {
  return href.replace(/^#?\.\//, "");
}

// The ContentFormula a draw:frame's own draw:object resolves to, or undefined when this frame carries no draw:object at all, or one referencing something that is not a formula (draw:object also embeds spreadsheets, charts, and other OLE-style objects this package makes no attempt to detect).
function formulaOfFrame(
  frame: XmlElement,
  pkg: Package,
): ContentFormula | undefined {
  const objectElement = childrenWithTag(frame, "draw:object")[0];
  if (objectElement === undefined) {
    return undefined;
  }
  const href = attrValue(objectElement, "xlink:href");
  if (href === undefined) {
    return undefined;
  }
  return readOdfEmbeddedFormula(pkg, subPackagePathFromHref(href));
}

// A group's own draw:transform, composed onto whatever transform its ancestors already contribute -- lifted verbatim from odf.js's own walkDrawShapes (typed/draw/shapes.ts), including the "an empty own-transform list reuses the parent's array rather than copying it" detail, so a frame nested inside a group resolves to the exact same geometry odf.js itself would resolve for it.
function nestedGroupFunctions(
  group: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
): readonly OdfTransformFunction[] {
  const value = attrValue(group, "draw:transform");
  const own = value === undefined ? [] : parseOdfTransform(value);
  return own.length === 0 ? groupFunctions : [...own, ...groupFunctions];
}

// One draw:frame -> a DetectedFormulaFrame, or undefined when it is not a formula frame (no draw:object, or one referencing a non-formula sub-object) or when neither geometry path resolves a box for it. Geometry is resolved through odf.js's own readDrawFrame first -- the identical function walkDrawShapes uses, so nothing here reimplements resolveOdfShapeGeometry/composeOdfGroupTransform -- falling back to the flow-anchored form above only when that returns nothing.
function readFormulaFrame(
  frame: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
  allowFlowAnchored: boolean,
): DetectedFormulaFrame | undefined {
  const formula = formulaOfFrame(frame, pkg);
  if (formula === undefined) {
    return undefined;
  }
  const box =
    readDrawFrame(frame, groupFunctions, pkg)?.frame ??
    (allowFlowAnchored ? flowAnchoredFrameBox(frame) : undefined);
  if (box === undefined) {
    return undefined;
  }
  return { frameElement: frame, formula, frame: box };
}

function walkForFormulaFrames(
  nodes: readonly XmlNode[],
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
  out: DetectedFormulaFrame[],
): void {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "draw:frame") {
      const detected = readFormulaFrame(node, groupFunctions, pkg, true);
      if (detected !== undefined) {
        // A formula frame's own children are the draw:object reference itself -- there is nothing further inside it to find.
        out.push(detected);
        continue;
      }
      // A frame that is NOT a formula can still contain one: a draw:text-box holds real text:p content, which may itself anchor an inline formula frame.
      walkForFormulaFrames(node.children, groupFunctions, pkg, out);
      continue;
    }
    if (node.tag === "draw:g") {
      walkForFormulaFrames(
        node.children,
        nestedGroupFunctions(node, groupFunctions),
        pkg,
        out,
      );
      continue;
    }
    walkForFormulaFrames(node.children, groupFunctions, pkg, out);
  }
}

// Every draw:frame resolving to an embedded formula found ANYWHERE beneath `nodes`, in document order: directly among them, nested inside a draw:g group (composing that group's own draw:transform), or anchored inline inside a paragraph's own run content. This is deliberately a deep walk rather than a direct-children scan -- a formula typed inline in a LibreOffice paragraph is a draw:frame child of text:p, and one dropped into a grouped diagram is a draw:frame child of draw:g; neither is a direct child of the container a caller starts from.
//
// Positioning the results back into a caller's own model is the caller's job, not this function's: an odt block index and an odp shape index are counted by two completely different upstream walks (odf.js's readBlocks vs its walkDrawShapes), so each caller mirrors its own.
export function collectFormulaFrames(
  nodes: readonly XmlNode[],
  pkg: Package,
): readonly DetectedFormulaFrame[] {
  const out: DetectedFormulaFrame[] = [];
  walkForFormulaFrames(nodes, [], pkg, out);
  return out;
}

// Every formula frame on one draw:page, each paired with the index of the ContentShape odf.js's own readOdpContent produced for it. That index is DERIVED, not guessed: the upstream reader's readSlide builds a slide's shapes array via walkDrawShapes(page.children, ...), which walks draw:frame and draw:g in document order, recurses into a group's own children, and pushes exactly one shape per draw:frame whose geometry readDrawFrame resolves (skipping any it cannot). This function performs the identical traversal with the identical skip condition, so the Nth shape it counts IS slide.shapes[N] -- including for a frame nested inside a group, which is why an odp slide containing a draw:g no longer has to be skipped wholesale.
//
// Geometry here is strictly readDrawFrame's, with no flow-anchored fallback: a frame walkDrawShapes could not resolve produced no shape at all, so there is nothing on the slide for a formula to attach to.
export function collectSlideFormulaFrames(
  pageChildren: readonly XmlNode[],
  pkg: Package,
): readonly DetectedSlideFormulaFrame[] {
  const out: DetectedSlideFormulaFrame[] = [];
  const state = { nextShapeIndex: 0 };

  const walk = (
    nodes: readonly XmlNode[],
    groupFunctions: readonly OdfTransformFunction[],
  ): void => {
    for (const node of nodes) {
      if (node.type !== "element") {
        continue;
      }
      if (node.tag === "draw:frame") {
        const shape = readDrawFrame(node, groupFunctions, pkg);
        if (shape === undefined) {
          continue;
        }
        const shapeIndex = state.nextShapeIndex;
        state.nextShapeIndex += 1;
        const formula = formulaOfFrame(node, pkg);
        if (formula !== undefined) {
          out.push({
            frameElement: node,
            formula,
            frame: shape.frame,
            shapeIndex,
          });
        }
        continue;
      }
      if (node.tag === "draw:g") {
        walk(node.children, nestedGroupFunctions(node, groupFunctions));
      }
    }
  };

  walk(pageChildren, []);
  return out;
}
