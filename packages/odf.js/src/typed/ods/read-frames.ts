// The anchored-drawing walk for a sheet read, split from read.ts: collecting a table:table's cell-anchored draw:frames into the image and embedded-object arrays a ContentSheet carries. read.ts keeps the table walk itself and imports these back (safe in ESM: every cross-binding use sits inside a hoisted function declaration).
//
import type {
  ContentEmbeddedObject,
  ContentSheetImage,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import type { Package } from "../../model/package";
import { attrValue } from "../../xml/query";
import {
  parseOdfTransform,
  type OdfTransformFunction,
} from "../shared/transform";
import { readDrawFrame } from "../draw/shapes";
import {
  readDrawObjectReference,
  readEmbeddedObjectDocument,
} from "../draw/embedded";

// The two anchored-drawing accumulators a sheet's frame walk fills, always threaded together: a draw:frame resolves to either a ContentSheetImage or a ContentEmbeddedObject, so a walk that could produce either needs both. Wrapped rather than passed as bare arrays so the parameters stay out of prefer-readonly-array-param's scope while the arrays they hold stay genuinely mutable.
interface AnchoredDrawingSink {
  readonly images: ContentSheetImage[];
  readonly embeddedObjects: ContentEmbeddedObject[];
}

export function collectAnchoredFrame(
  frameElement: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
  anchorRow: number,
  anchorColumn: number,
  sink: AnchoredDrawingSink,
): void {
  const { images, embeddedObjects } = sink;
  const shape = readDrawFrame(frameElement, groupFunctions, pkg);
  if (shape === undefined) {
    return;
  }

  const reference = readDrawObjectReference(frameElement, pkg);
  if (reference !== undefined) {
    // Anchor fields are set exactly as they are for an anchored image just below — document-schema.js 2.2.0 gave ContentEmbeddedObject the same anchorRow/anchorColumn/offsetXPt/offsetYPt quartet ContentSheetImage already carried, so an embedded object's own anchor cell is now genuinely representable rather than lost. `frame` keeps the coordinates the format itself stated (cell-relative for a cell-anchored object, sheet-absolute for a page-anchored one) and the offsets restate that frame's own origin against the named anchor cell, mirroring ContentSheetImage's own convention rather than inventing a second one. A chart's residue (its whole chart:chart element, quarantined for a same-format restorer) rides the same return the document does.
    const { document, residue } = readEmbeddedObjectDocument(
      reference,
      shape.frame,
      "ods",
    );
    const object: ContentEmbeddedObject = {
      objectKind: reference.objectKind,
      document,
      frame: shape.frame,
      anchorRow,
      anchorColumn,
      offsetXPt: shape.frame.xPt,
      offsetYPt: shape.frame.yPt,
    };
    if (residue !== undefined) {
      object.source = residue;
    }
    embeddedObjects.push(object);
    return;
  }

  for (const block of shape.blocks) {
    if (block.kind === "image") {
      images.push({
        ...block,
        anchorRow,
        anchorColumn,
        offsetXPt: shape.frame.xPt,
        offsetYPt: shape.frame.yPt,
      });
    }
  }
}

// Walks a shape container's own children (a table:table-cell's, a table:shapes', or a nested draw:g's), flattening draw:g groups exactly as walkDrawShapes does for a slide — an enclosing group's own draw:transform is accumulated INNERMOST FIRST so composeOdfGroupTransform applies the list in the right order at the leaf. Every other element kind (a bare draw:rect/draw:custom-shape vector primitive, a draw:control, the cell's own text:p content) is skipped: see this module's own top-of-file note on what a ContentSheet has nowhere to carry.
export function collectAnchoredFrames(
  children: readonly XmlNode[],
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
  anchorRow: number,
  anchorColumn: number,
  sink: AnchoredDrawingSink,
): void {
  for (const child of children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "draw:frame") {
      collectAnchoredFrame(
        child,
        groupFunctions,
        pkg,
        anchorRow,
        anchorColumn,
        sink,
      );
    } else if (child.tag === "draw:g") {
      const ownValue = attrValue(child, "draw:transform");
      const ownFunctions =
        ownValue === undefined ? [] : parseOdfTransform(ownValue);
      const nested =
        ownFunctions.length === 0
          ? groupFunctions
          : [...ownFunctions, ...groupFunctions];
      collectAnchoredFrames(
        child.children,
        nested,
        pkg,
        anchorRow,
        anchorColumn,
        sink,
      );
    }
  }
}
