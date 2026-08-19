import type { OdfTransformFunction, Package, XmlElement, XmlNode } from 'odf.js';
import { attrValue, childrenWithTag, parseOdfTransform, readDrawFrame, readDrawImageBlock } from 'odf.js';
import type { ContentImageBlock } from 'document-schema.js';
import { flowAnchoredFrameBox } from '../shared/flow-anchor';

// Image detection for odt -- the ODF-side counterpart to ooxml.js's own readDocxContent image support (see the README's own docx-image-round-trip gotcha), needed because odf.js's own readOdtContent explicitly does not read draw:frame/draw:image back into a ContentParagraph or any ContentBlock at all (that reader's own scope note treats an inline frame as odp/odg's job, not odt's). Structurally this mirrors src/odf/formula/detect.ts's own deep walk almost exactly -- a draw:frame can sit anywhere at all (nested in a group, anchored inline in a run), so this runs its own bespoke deep walk rather than delegating to odf.js's own readDrawPageContent the way src/odf/vector/detect.ts does.

export interface DetectedImageFrame {
  readonly frameElement: XmlElement;
  readonly image: ContentImageBlock;
}

// A group's own draw:transform, composed onto whatever transform its ancestors already contribute -- the identical helper src/odf/formula/detect.ts keeps as its own private copy, duplicated here rather than shared: the two modules already diverge in what they detect from a frame, and a shared traversal utility would have to parameterise over that anyway, so a second small copy is the more honest abstraction of what each module already does independently.
function nestedGroupFunctions(group: XmlElement, groupFunctions: readonly OdfTransformFunction[]): readonly OdfTransformFunction[] {
  const value = attrValue(group, 'draw:transform');
  const own = value === undefined ? [] : parseOdfTransform(value);
  return own.length === 0 ? groupFunctions : [...own, ...groupFunctions];
}

// One draw:frame -> a DetectedImageFrame, or undefined when it is not an image frame at all, or when neither geometry path resolves a box for it. CRITICAL: a frame carrying its own draw:object is a formula/embedded-object frame that src/odf/formula/detect.ts already owns -- its own sibling draw:image, when present, is a GDI-metafile preview bitmap (odf.js's own typed/draw/embedded.ts treats it identically: never real content), so this checks for and rejects a draw:object-bearing frame FIRST, before ever looking for a draw:image child, guaranteeing a formula frame's preview bitmap is never double-claimed as a real image.
//
// Geometry is resolved through odf.js's own readDrawFrame first -- the identical function walkDrawShapes uses, so nothing here reimplements resolveOdfShapeGeometry/composeOdfGroupTransform -- falling back to the flow-anchored form only when that returns nothing. readDrawImageBlock (odf.js's own image-block reader) then resolves the actual media part, sniffs its format, and returns undefined for a reference odf.js cannot read as a real image (a missing part, an unrecognised format) -- that undefined propagates out of this function too, rather than being papered over.
function readImageFrame(frame: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package, allowFlowAnchored: boolean): DetectedImageFrame | undefined {
  if (childrenWithTag(frame, 'draw:object')[0] !== undefined) {
    return undefined;
  }
  const imageElement = childrenWithTag(frame, 'draw:image')[0];
  if (imageElement === undefined) {
    return undefined;
  }
  const box = readDrawFrame(frame, groupFunctions, pkg)?.frame ?? (allowFlowAnchored ? flowAnchoredFrameBox(frame) : undefined);
  if (box === undefined) {
    return undefined;
  }
  const image = readDrawImageBlock(imageElement, frame, box, pkg);
  if (image === undefined) {
    return undefined;
  }
  return { frameElement: frame, image };
}

function walkForImageFrames(nodes: readonly XmlNode[], groupFunctions: readonly OdfTransformFunction[], pkg: Package, out: DetectedImageFrame[]): void {
  for (const node of nodes) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'draw:frame') {
      const detected = readImageFrame(node, groupFunctions, pkg, true);
      if (detected !== undefined) {
        // An image frame's own children are the draw:image reference itself -- there is nothing further inside it to find.
        out.push(detected);
        continue;
      }
      // Not an image frame itself (no draw:image at all, or a formula frame's own draw:object) -- a draw:text-box holds real text:p content, which may itself anchor a further inline image frame. A formula frame's own children (the draw:object reference, and optionally its preview bitmap) contain no further draw:frame/draw:g to find, so recursing into them is a no-op, not a risk of double-claiming the preview bitmap -- readImageFrame is only ever invoked for a node tagged draw:frame, and the preview bitmap sits as a bare draw:image, never wrapped in one of its own.
      walkForImageFrames(node.children, groupFunctions, pkg, out);
      continue;
    }
    if (node.tag === 'draw:g') {
      walkForImageFrames(node.children, nestedGroupFunctions(node, groupFunctions), pkg, out);
      continue;
    }
    walkForImageFrames(node.children, groupFunctions, pkg, out);
  }
}

// Every draw:frame resolving to a real embedded image found ANYWHERE beneath `nodes`, in document order: directly among them, nested inside a draw:g group (composing that group's own draw:transform), or anchored inline inside a paragraph's own run content. This is deliberately a deep walk rather than a direct-children scan -- an image inserted inline in a LibreOffice paragraph is a draw:frame child of text:p, and one dropped into a grouped diagram is a draw:frame child of draw:g; neither is a direct child of the container a caller starts from.
//
// Positioning the results back into a caller's own model is the caller's job, not this function's -- see src/odf/odt/read.ts's own collectImagePlacements, which (unlike its formula/vector counterparts) never consumes the paragraph an image is found in: ContentImageBlock has nowhere to record inline membership, so an image always arrives as its own adjacent block, mirroring ooxml.js's own readDocxContent convention for a docx inline image exactly.
export function collectImageFrames(nodes: readonly XmlNode[], pkg: Package): readonly DetectedImageFrame[] {
  const out: DetectedImageFrame[] = [];
  walkForImageFrames(nodes, [], pkg, out);
  return out;
}
