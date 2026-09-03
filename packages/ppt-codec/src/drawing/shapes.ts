import { PptFormatError } from "../errors";
import { type PptRecord, childRecords, findChild } from "../record/tree";
import {
  OfficeArtChildAnchor,
  OfficeArtClientAnchor,
  OfficeArtClientTextbox,
  OfficeArtDgContainer,
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_Drawing,
} from "../record/types";

// The drawing walk: a slide's DrawingContainer holds an [MS-ODRAW] OfficeArtDgContainer, and beneath it a tree of group and shape containers. This module flattens that tree into the shapes a reader actually cares about, resolving each one's rectangle into the slide's own coordinate system on the way down -- a grouped shape's anchor is stated in its group's private coordinate system, so the rectangle is only meaningful once every enclosing group's transform has been applied to it. [MS-PPT] 2.5.13 DrawingContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/0595b49f-da96-4402-b353-1f766e9d548f [MS-ODRAW] 2.2.13 OfficeArtDgContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/68976475-fcfd-4483-8fc4-75adc635130d [MS-ODRAW] 2.2.14 OfficeArtSpContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/16194cb9-b4b0-476c-9678-a6ac1f06b034 [MS-ODRAW] 2.2.16 OfficeArtSpgrContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/e42f26e5-c0eb-4d10-a708-eef5958af44d

// [MS-ODRAW] 2.2.40 OfficeArtFSP's flags word, in the spec's own A-to-L order. Only the three the walk acts on are named.
const FSP_GROUP = 1 << 0;
const FSP_PATRIARCH = 1 << 2;
const FSP_DELETED = 1 << 3;

// A rectangle in master units. Kept in the format's own coordinate system rather than converted to points here, so the geometry and the unit conversion stay separately testable.
export interface ShapeRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PptShape {
  readonly spid: number;
  // The shape's rectangle in slide coordinates, or undefined for a shape carrying no anchor at all.
  readonly anchor: ShapeRect | undefined;
  // The OfficeArtClientTextbox holding this shape's text records, when it has one.
  readonly clientTextbox: PptRecord | undefined;
}

interface Transform {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

const IDENTITY: Transform = {
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
};

function applyTransform(transform: Transform, rect: ShapeRect): ShapeRect {
  return {
    left: transform.offsetX + rect.left * transform.scaleX,
    top: transform.offsetY + rect.top * transform.scaleY,
    right: transform.offsetX + rect.right * transform.scaleX,
    bottom: transform.offsetY + rect.bottom * transform.scaleY,
  };
}

function readRectFields(
  record: PptRecord,
  size: 2 | 4,
  order: "top-left" | "left-top",
): ShapeRect {
  const { data } = record;
  const needed = size * 4;
  if (data.length < needed) {
    throw new PptFormatError(
      `anchor record 0x${record.header.recType.toString(16)} carries ${data.length} bytes, fewer than the ${needed} its four ${size}-byte coordinates need`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const at = (index: number): number =>
    size === 2
      ? view.getInt16(index * 2, true)
      : view.getInt32(index * 4, true);
  // SmallRectStruct and RectStruct both order their fields top, left, right, bottom -- not the left-first order the names suggest -- while OfficeArtChildAnchor and OfficeArtFSPGR order theirs xLeft, yTop, xRight, yBottom. Reading either with the other's order silently transposes the rectangle.
  return order === "top-left"
    ? { top: at(0), left: at(1), right: at(2), bottom: at(3) }
    : { left: at(0), top: at(1), right: at(2), bottom: at(3) };
}

// [MS-PPT] 2.7.1: the client anchor's own recLen picks its payload -- 0x8 is a SmallRectStruct of 16-bit coordinates, 0x10 a RectStruct of 32-bit ones. Both are already in slide coordinates, which is why a grouped shape carrying one needs no group transform applied.
function readClientAnchor(record: PptRecord): ShapeRect {
  const { recLen } = record.header;
  if (recLen === 0x00000008) {
    return readRectFields(record, 2, "top-left");
  }
  if (recLen === 0x00000010) {
    return readRectFields(record, 4, "top-left");
  }
  throw new PptFormatError(
    `OfficeArtClientAnchor declares recLen 0x${recLen.toString(16)}, neither the 0x8 of a SmallRectStruct nor the 0x10 of a RectStruct`,
  );
}

interface ShapeProperties {
  readonly spid: number;
  readonly flags: number;
}

// [MS-ODRAW] 2.2.14 makes shapeProp a required field of every OfficeArtSpContainer, so a container without a readable one is malformed rather than a shape with unknown identity -- read as one pair so neither half can be answered while the other fails.
function readShapeProperties(shape: PptRecord): ShapeProperties {
  const fsp = findChild(childRecords(shape), OfficeArtFSP);
  if (fsp === undefined || fsp.data.length < 8) {
    throw new PptFormatError(
      `OfficeArtSpContainer at offset ${shape.offset} has no readable OfficeArtFSP, so the shape has neither an identity nor its flags`,
    );
  }
  const view = new DataView(fsp.data.buffer, fsp.data.byteOffset, 8);
  return { spid: view.getUint32(0, true), flags: view.getUint32(4, true) };
}

// A shape's rectangle in slide coordinates. A client anchor is absolute and needs no transform; a child anchor is stated in the enclosing group's coordinate system and is mapped through it.
function resolveAnchor(
  shape: PptRecord,
  transform: Transform,
): ShapeRect | undefined {
  const children = childRecords(shape);
  const clientAnchor = findChild(children, OfficeArtClientAnchor);
  if (clientAnchor !== undefined) {
    return readClientAnchor(clientAnchor);
  }
  const child = findChild(children, OfficeArtChildAnchor);
  if (child !== undefined) {
    return applyTransform(transform, readRectFields(child, 4, "left-top"));
  }
  return undefined;
}

// Composes the transform a group's children are read through: their coordinates run in the space the group's OfficeArtFSPGR declares, and the group's own anchor says where that space lands in the parent's. The patriarch -- every drawing's outermost group -- is the exception the spec's structure creates rather than an assumption: it declares a degenerate coordinate system and no anchor, because its children are already in slide coordinates.
function groupTransform(groupShape: PptRecord, parent: Transform): Transform {
  const { spid, flags } = readShapeProperties(groupShape);
  if ((flags & FSP_PATRIARCH) !== 0) {
    return parent;
  }
  const children = childRecords(groupShape);
  const fspgr = findChild(children, OfficeArtFSPGR);
  const anchor = resolveAnchor(groupShape, parent);
  if (fspgr === undefined || anchor === undefined) {
    throw new PptFormatError(
      `group shape ${spid} lacks ${fspgr === undefined ? "an OfficeArtFSPGR coordinate system" : "an anchor"}, so its children's coordinates cannot be placed on the slide`,
    );
  }
  const space = readRectFields(fspgr, 4, "left-top");
  const spaceWidth = space.right - space.left;
  const spaceHeight = space.bottom - space.top;
  if (spaceWidth === 0 || spaceHeight === 0) {
    throw new PptFormatError(
      `group shape ${spid} declares a coordinate system of zero ${spaceWidth === 0 ? "width" : "height"}, which no child coordinate can be scaled through`,
    );
  }
  const scaleX = (anchor.right - anchor.left) / spaceWidth;
  const scaleY = (anchor.bottom - anchor.top) / spaceHeight;
  return {
    scaleX,
    scaleY,
    offsetX: anchor.left - space.left * scaleX,
    offsetY: anchor.top - space.top * scaleY,
  };
}

function collectShape(
  shape: PptRecord,
  transform: Transform,
  into: PptShape[],
): void {
  const { spid, flags } = readShapeProperties(shape);
  // A deleted shape's content is retained in the file but is not part of the drawing; a group's own placeholder shape carries the group's geometry rather than content, and is consumed by groupTransform instead.
  if ((flags & FSP_DELETED) !== 0 || (flags & FSP_GROUP) !== 0) {
    return;
  }
  into.push({
    spid,
    anchor: resolveAnchor(shape, transform),
    clientTextbox: findChild(childRecords(shape), OfficeArtClientTextbox),
  });
}

function collectGroup(
  group: PptRecord,
  parent: Transform,
  into: PptShape[],
): void {
  const children = childRecords(group);
  const [groupShape, ...rest] = children;
  if (groupShape === undefined) {
    return;
  }
  // [MS-ODRAW] 2.2.16: the first child of a group container is always the OfficeArtSpContainer holding that group's own shape information.
  const transform = groupTransform(groupShape, parent);
  for (const child of rest) {
    if (child.header.recType === OfficeArtSpgrContainer) {
      collectGroup(child, transform, into);
    } else if (child.header.recType === OfficeArtSpContainer) {
      collectShape(child, transform, into);
    }
  }
}

// Every content shape in a slide's drawing, in document order, each with its rectangle resolved into slide coordinates.
export function readDrawingShapes(drawing: PptRecord): PptShape[] {
  if (drawing.header.recType !== RT_Drawing) {
    throw new PptFormatError(
      `expected RT_Drawing (0x${RT_Drawing.toString(16)}), found record type 0x${drawing.header.recType.toString(16)}`,
    );
  }
  const dg = findChild(childRecords(drawing), OfficeArtDgContainer);
  if (dg === undefined) {
    return [];
  }
  const shapes: PptShape[] = [];
  for (const child of childRecords(dg)) {
    if (child.header.recType === OfficeArtSpgrContainer) {
      collectGroup(child, IDENTITY, shapes);
    } else if (child.header.recType === OfficeArtSpContainer) {
      collectShape(child, IDENTITY, shapes);
    }
  }
  return shapes;
}
