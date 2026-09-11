import { PptFormatError } from "../errors";
import { type PptRecord, childRecords, findChild } from "../record/tree";
import {
  OfficeArtChildAnchor,
  OfficeArtClientAnchor,
  OfficeArtClientData,
  OfficeArtClientTextbox,
  OfficeArtDgContainer,
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_Drawing,
} from "../record/types";
import {
  PROPERTY_ROTATION,
  PROPERTY_TABLE_PROPERTIES,
  TABLE_FLAG_IS_TABLE,
  type ShapeProperty,
  fixedPointToDegrees,
  readShapeProperties,
} from "./properties";

// The drawing walk: a slide's DrawingContainer holds an [MS-ODRAW] OfficeArtDgContainer, and beneath it a tree of group and shape containers. This module flattens that tree into the shapes a reader actually cares about, resolving each one's rectangle into the slide's own coordinate system on the way down -- a grouped shape's anchor is stated in its group's private coordinate system, so the rectangle is only meaningful once every enclosing group's transform has been applied to it. [MS-PPT] 2.5.13 DrawingContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/0595b49f-da96-4402-b353-1f766e9d548f [MS-ODRAW] 2.2.13 OfficeArtDgContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/68976475-fcfd-4483-8fc4-75adc635130d [MS-ODRAW] 2.2.14 OfficeArtSpContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/16194cb9-b4b0-476c-9678-a6ac1f06b034 [MS-ODRAW] 2.2.16 OfficeArtSpgrContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/e42f26e5-c0eb-4d10-a708-eef5958af44d

// [MS-ODRAW] 2.2.40 OfficeArtFSP's flags word, in the spec's own A-to-L order. Only the bits the walk acts on are named.
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
  // The shape's rotation in degrees clockwise, from its property table's rotation property -- undefined when the shape states none ([MS-ODRAW] 2.3.18.5).
  readonly rotationDeg: number | undefined;
  // The OfficeArtClientTextbox holding this shape's text records, when it has one.
  readonly clientTextbox: PptRecord | undefined;
  // The OfficeArtClientData record holding this shape's host-defined data -- for an OLE shape, the ExObjRefAtom naming its object.
  readonly clientData: PptRecord | undefined;
  // The shape's property tables, merged -- the source of its rotation and, for a picture, its blip-store reference.
  readonly properties: ReadonlyMap<number, ShapeProperty>;
}

// A table, which the format spells as a group whose own shape's property table states tableProperties with fIsTable set ([MS-ODRAW] 2.3.4.36): the group's own anchor places the table on the slide, and each cell is an ordinary OfficeArtSpContainer among the group's children, carrying its own anchor and its own text. A cell is not distinguished from any other shape by any flag -- the grid is genuinely derived from the cells' own rectangles, which is how every reader of this spelling recovers it.
export interface PptTable {
  // The table's own rectangle in slide coordinates, from the group shape's anchor.
  readonly anchor: ShapeRect;
  // The group's own rotation in degrees clockwise -- the whole table rotates as one shape.
  readonly rotationDeg: number | undefined;
  // The cell shapes in document order, each with its own rectangle in slide coordinates (a client anchor is absolute; a child anchor is mapped through the group's coordinate system like any grouped shape's).
  readonly cells: readonly PptShape[];
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

interface ShapeIdentity {
  readonly spid: number;
  readonly flags: number;
}

// [MS-ODRAW] 2.2.14 makes shapeProp a required field of every OfficeArtSpContainer, so a container without a readable one is malformed rather than a shape with unknown identity -- read as one pair so neither half can be answered while the other fails.
function readShapeIdentity(shape: PptRecord): ShapeIdentity {
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

function rotationDegOf(
  properties: ReadonlyMap<number, ShapeProperty>,
): number | undefined {
  const rotation = properties.get(PROPERTY_ROTATION);
  if (rotation === undefined) {
    return undefined;
  }
  const degrees = fixedPointToDegrees(rotation.value);
  // The shared schema's own convention: an unrotated shape is undefined rather than a stored zero, so a zero rotation reads as no statement at all.
  return degrees === 0 ? undefined : degrees;
}

// Whether a group shape's property table states tableProperties with fIsTable set -- the one mark that separates a table from an ordinary grouping ([MS-ODRAW] 2.3.4.36: "flags for a group that represents a table"). A group stating no tableProperties at all is an ordinary group, the property's own documented default of 0x00000000.
function isTableGroup(properties: ReadonlyMap<number, ShapeProperty>): boolean {
  const tableProperties = properties.get(PROPERTY_TABLE_PROPERTIES);
  return (
    tableProperties !== undefined &&
    (tableProperties.value & TABLE_FLAG_IS_TABLE) !== 0
  );
}

// Composes the transform a group's children are read through: their coordinates run in the space the group's OfficeArtFSPGR declares, and the group's own anchor says where that space lands in the parent's. The patriarch -- every drawing's outermost group -- is the exception the spec's structure creates rather than an assumption: it declares a degenerate coordinate system and no anchor, because its children are already in slide coordinates.
function groupTransform(groupShape: PptRecord, parent: Transform): Transform {
  const { spid, flags } = readShapeIdentity(groupShape);
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
  into: (PptShape | PptTable)[],
): void {
  const { spid, flags } = readShapeIdentity(shape);
  // A deleted shape's content is retained in the file but is not part of the drawing; a group's own placeholder shape carries the group's geometry rather than content, and is consumed by groupTransform instead.
  if ((flags & FSP_DELETED) !== 0 || (flags & FSP_GROUP) !== 0) {
    return;
  }
  const children = childRecords(shape);
  const properties = readShapeProperties(shape);
  into.push({
    spid,
    anchor: resolveAnchor(shape, transform),
    rotationDeg: rotationDegOf(properties),
    clientTextbox: findChild(children, OfficeArtClientTextbox),
    clientData: findChild(children, OfficeArtClientData),
    properties,
  });
}

function collectGroup(
  group: PptRecord,
  parent: Transform,
  into: (PptShape | PptTable)[],
): void {
  const children = childRecords(group);
  const [groupShape, ...rest] = children;
  if (groupShape === undefined) {
    return;
  }
  // [MS-ODRAW] 2.2.16: the first child of a group container is always the OfficeArtSpContainer holding that group's own shape information.
  const groupProperties = readShapeProperties(groupShape);
  if (isTableGroup(groupProperties)) {
    // A table group's children are its cells, not shapes to flatten into the slide -- the grid is the content here, and a nested group inside a table is not a shape the format defines, so only OfficeArtSpContainer children are collected.
    const anchor = resolveAnchor(groupShape, parent);
    if (anchor === undefined) {
      throw new PptFormatError(
        `table group shape ${readShapeIdentity(groupShape).spid} carries no anchor, so the table cannot be placed on the slide`,
      );
    }
    const tableTransform = groupTransform(groupShape, parent);
    const cells: PptShape[] = [];
    for (const child of rest) {
      if (child.header.recType === OfficeArtSpContainer) {
        collectShape(child, tableTransform, cells);
      }
    }
    into.push({
      anchor,
      rotationDeg: rotationDegOf(groupProperties),
      cells,
    });
    return;
  }
  const transform = groupTransform(groupShape, parent);
  for (const child of rest) {
    if (child.header.recType === OfficeArtSpgrContainer) {
      collectGroup(child, transform, into);
    } else if (child.header.recType === OfficeArtSpContainer) {
      collectShape(child, transform, into);
    }
  }
}

// Every content shape in a slide's drawing, in document order, each shape's rectangle resolved into slide coordinates. A table group arrives as one PptTable entry rather than as its cells, so a caller walking the result sees one table where the file spells one.
export function readDrawingShapes(
  drawing: PptRecord,
): readonly (PptShape | PptTable)[] {
  if (drawing.header.recType !== RT_Drawing) {
    throw new PptFormatError(
      `expected RT_Drawing (0x${RT_Drawing.toString(16)}), found record type 0x${drawing.header.recType.toString(16)}`,
    );
  }
  const dg = findChild(childRecords(drawing), OfficeArtDgContainer);
  if (dg === undefined) {
    return [];
  }
  const shapes: (PptShape | PptTable)[] = [];
  for (const child of childRecords(dg)) {
    if (child.header.recType === OfficeArtSpgrContainer) {
      collectGroup(child, IDENTITY, shapes);
    } else if (child.header.recType === OfficeArtSpContainer) {
      collectShape(child, IDENTITY, shapes);
    }
  }
  return shapes;
}
