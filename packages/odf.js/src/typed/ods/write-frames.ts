import type {
  ContentEmbeddedObject,
  ContentSheetImage,
} from "document-schema.js";
import type { OdsWriteState } from "./write-validations";
import { imageExtension } from "../../typed/shared/image";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { formatOdfLength } from "../shared/units";
import { writeEmbeddedObject } from "../draw/embedded-write";
import { coverageKey, PICTURES_DIRECTORY } from "./write";

// The image and embedded-object frame writers split from write.ts: the position grouping and draw:frame emission for everything a sheet anchors in a cell.

export function groupImagesByPosition(
  images: readonly ContentSheetImage[],
): ReadonlyMap<string, ContentSheetImage[]> {
  const byPosition = new Map<string, ContentSheetImage[]>();
  for (const image of images) {
    const key = coverageKey(image.anchorRow, image.anchorColumn);
    const existing = byPosition.get(key);
    if (existing === undefined) {
      byPosition.set(key, [image]);
    } else {
      existing.push(image);
    }
  }
  return byPosition;
}

// --- images: ContentSheetImage -> a draw:frame anchored directly inside its own table:table-cell ----------------------
//
// Every image this writer places is written cell-anchored (a direct child of the table:table-cell at anchorRow/anchorColumn, with svg:x/svg:y as the offsets readDrawFrame parses directly), never as a table:shapes page-anchored entry — and that is a genuine, not merely convenient, choice: readOdsContent's own two anchoring conventions are numerically INDISTINGUISHABLE at row 0/column 0 (cell (0,0)'s own top-left IS the sheet origin, per that module's own top-of-file note), so a page-anchored image reads back with exactly the same anchorRow/anchorColumn/offsetXPt/offsetYPt a cell-anchored one at (0,0) would. Writing every image cell-anchored is therefore not a narrowing of what this writer can express — it is the one representation that already covers both source conventions losslessly.
export function writeSheetImageFrame(
  image: ContentSheetImage,
  state: OdsWriteState,
): XmlElement {
  const extension = imageExtension(image.format);
  const path = `${PICTURES_DIRECTORY}/image${state.nextImage}.${extension}`;
  state.nextImage += 1;
  state.pkg.parts[path] = { kind: "binary", base64: image.base64 };
  const children: XmlNode[] = [
    el("draw:image", {
      "xlink:href": encodeXmlText(path),
      "xlink:type": "simple",
      "xlink:show": "embed",
      "xlink:actuate": "onLoad",
    }),
  ];
  if (image.altText !== undefined) {
    children.push(el("svg:title", {}, [txt(encodeXmlText(image.altText))]));
  }
  return el(
    "draw:frame",
    {
      "draw:z-index": String(state.nextZIndex++),
      "svg:x": formatOdfLength(image.offsetXPt),
      "svg:y": formatOdfLength(image.offsetYPt),
      "svg:width": formatOdfLength(image.widthPt),
      "svg:height": formatOdfLength(image.heightPt),
    },
    children,
  );
}

// The identical position grouping images use, for the sheet's own embedded objects: one list per anchor cell, in document order.
export function groupEmbeddedObjectsByPosition(
  objects: readonly ContentEmbeddedObject[],
): ReadonlyMap<string, ContentEmbeddedObject[]> {
  const byPosition = new Map<string, ContentEmbeddedObject[]>();
  for (const object of objects) {
    const key = coverageKey(object.anchorRow ?? 0, object.anchorColumn ?? 0);
    const existing = byPosition.get(key);
    if (existing === undefined) {
      byPosition.set(key, [object]);
    } else {
      existing.push(object);
    }
  }
  return byPosition;
}

// An embedded object's own sub-package plus the page-anchored draw:frame that references it: the frame mirrors writeSheetImageFrame's own z-indexed/svg:x/y/width/height shape (the cell-anchored spelling — anchorRow/anchorColumn with cell-relative offsets, which is what the reader's cell-anchored walk resolves back), and the draw:object child replaces the draw:image. The sub-package serialises through the shared writeEmbeddedObject (#972's machinery, typed/draw/embedded-write.ts) under its own "Object N/" directory.
export function writeSheetEmbeddedObjectFrame(
  object: ContentEmbeddedObject,
  state: OdsWriteState,
): XmlElement {
  const directory = `Object ${state.nextObject}`;
  state.nextObject += 1;
  const drawObject = writeEmbeddedObject(object, directory, state.pkg);
  return el(
    "draw:frame",
    {
      "draw:z-index": String(state.nextZIndex++),
      "svg:x": formatOdfLength(object.offsetXPt ?? object.frame.xPt),
      "svg:y": formatOdfLength(object.offsetYPt ?? object.frame.yPt),
      "svg:width": formatOdfLength(object.frame.widthPt),
      "svg:height": formatOdfLength(object.frame.heightPt),
    },
    [drawObject],
  );
}

// --- print settings: ContentSheetPrintSettings -> a master page + page style names ------
