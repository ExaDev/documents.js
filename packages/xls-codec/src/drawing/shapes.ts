import { BlockCursor } from "../biff/cursor";
import { BiffFormatError } from "../biff/records";
import {
  ESCHER_CLIENT_ANCHOR,
  ESCHER_DG_CONTAINER,
  ESCHER_OPT,
  ESCHER_SP,
  ESCHER_SP_CONTAINER,
  ESCHER_SPGR_CONTAINER,
  FOPT_FCOMPLEX_MASK,
  FOPT_OPID_PIB,
} from "./escher-constants";
import {
  childrenOfType,
  readEscherRecords,
  type EscherContainer,
} from "./escher";

// One worksheet's own drawing tree ([MS-XLS] 2.4.180's own MsoDrawing, whose data concatenates across records into one Escher stream per sheet -- see escher.ts's own top comment): every top-level shape the sheet's drawing layer places, in document order, cell-anchored ([MS-XLS] 2.5.163 OfficeArtClientAnchorSheet). The workbook's own root Escher group (the "patriarch" -- [MS-ODRAW] "fPatriarch": the invisible container every real shape sits inside) carries no anchor and no content of its own, and is not returned as a shape.

/** One drawing shape's own fixed geometry and identity -- what a Sp/Opt/ClientAnchor triple inside one SpContainer states. Nothing about what KIND of content the shape holds (a picture, a chart, an autoshape) lives here: that is the paired Obj record's own ftCmo.ot, resolved by workbook/drawing.ts once shapes and Obj records are matched up. */
export interface DrawingShape {
  readonly shapeType: number;
  readonly spid: number;
  /** 1-based index into the workbook's own Blip Store ([MS-ODRAW] "pib"), present only for a shape whose Opt property table actually states one -- a picture shape, in practice. */
  readonly blipIndex: number | undefined;
  readonly anchor: ShapeAnchor;
}

/** [MS-XLS] 2.5.163 OfficeArtClientAnchorSheet: a shape's placement as a top-left and bottom-right corner, each a cell plus a fractional offset within it -- dxL/dxR in 1/1024ths of that cell's own width, dyT/dyB in 1/256ths of that cell's own height (the two axes use different denominators; see this record's own field-by-field citation in escher-constants.ts). */
export interface ShapeAnchor {
  readonly colL: number;
  readonly dxL: number;
  readonly rwT: number;
  readonly dyT: number;
  readonly colR: number;
  readonly dxR: number;
  readonly rwB: number;
  readonly dyB: number;
}

const CLIENT_ANCHOR_SIZE = 18;

/** Reads one worksheet's own concatenated MsoDrawing bytes into an ordered list of its real (non-patriarch) top-level shapes. A stream this reader cannot make sense of at all (empty, or carrying no DgContainer) yields no shapes rather than throwing -- workbook/drawing.ts already treats "this sheet has a drawing" as optional. */
export function readSheetShapes(
  drawingBytes: Uint8Array<ArrayBuffer>,
): readonly DrawingShape[] {
  if (drawingBytes.length === 0) {
    return [];
  }
  const roots = readEscherRecords(drawingBytes);
  const dg = roots.find(
    (record): record is EscherContainer =>
      record.kind === "container" && record.recType === ESCHER_DG_CONTAINER,
  );
  if (dg === undefined) {
    return [];
  }
  const rootSpgr = childrenOfType(dg, ESCHER_SPGR_CONTAINER)[0];
  if (rootSpgr?.kind !== "container") {
    return [];
  }
  // The root group's own shape tree is read by the identical rule a nested group's is (readGroupShapes' own first-child-is-the-group's-own-shape-record skip) -- the root group's first child is the patriarch's own shape record ([MS-ODRAW] "fPatriarch"), which carries no cell anchor and is not a real placed shape, exactly as a nested group's own first child is that group's shape record rather than one of its children.
  return readGroupShapes(rootSpgr);
}

/** The root group's own direct children, in document order, restricted to the two kinds a shape tree ever nests: further shape groups and ordinary shape containers. Keeps document order across a mix of the two (a real drawing can place a group between two ordinary shapes) rather than processing every group before every plain shape. */
function interleaveGroupOrder(
  group: EscherContainer,
): readonly EscherContainer[] {
  return group.children.filter(
    (child): child is EscherContainer =>
      child.kind === "container" &&
      (child.recType === ESCHER_SP_CONTAINER ||
        child.recType === ESCHER_SPGR_CONTAINER),
  );
}

/** A nested shape group: its own first child SpContainer is the group's own shape record (no cell anchor, [MS-ODRAW] "fGroup"/"fChild"), and every shape after it -- ordinary or a further nested group -- is a real child shape, read the identical way. */
function readGroupShapes(group: EscherContainer): readonly DrawingShape[] {
  const [, ...rest] = interleaveGroupOrder(group);
  const shapes: DrawingShape[] = [];
  for (const child of rest) {
    if (child.recType === ESCHER_SPGR_CONTAINER) {
      shapes.push(...readGroupShapes(child));
    } else {
      const shape = readShapeContainer(child);
      if (shape !== undefined) {
        shapes.push(shape);
      }
    }
  }
  return shapes;
}

/** One SpContainer's own Sp/Opt/ClientAnchor children -- undefined when the shape carries no cell anchor at all (a malformed or unusually authored file; every real placed shape has one). */
function readShapeContainer(
  container: EscherContainer,
): DrawingShape | undefined {
  const sp = childrenOfType(container, ESCHER_SP)[0];
  if (sp?.kind !== "atom") {
    return undefined;
  }
  const spid = new BlockCursor([sp.data]).u32();
  const anchorRecord = childrenOfType(container, ESCHER_CLIENT_ANCHOR)[0];
  if (anchorRecord?.kind !== "atom") {
    return undefined;
  }
  const anchor = readClientAnchor(anchorRecord.data);
  if (anchor === undefined) {
    return undefined;
  }
  const opt = childrenOfType(container, ESCHER_OPT)[0];
  // A malformed Opt table (a FOPTE array whose own byte count is not a whole multiple of one entry's 6 bytes -- there is no length field of its own beyond the atom's recLen to cross-check against) degrades this ONE shape to carrying no pib, rather than aborting the whole sheet's shape read the way an uncaught BiffFormatError would; every other field this shape already resolved (its type, id, anchor) is still real and worth keeping.
  let blipIndex: number | undefined;
  if (opt?.kind === "atom") {
    try {
      blipIndex = readPibProperty(opt.data);
    } catch (error) {
      if (!(error instanceof BiffFormatError)) {
        throw error;
      }
    }
  }
  return { shapeType: sp.recInstance, spid, blipIndex, anchor };
}

function readClientAnchor(
  data: Uint8Array<ArrayBuffer>,
): ShapeAnchor | undefined {
  if (data.length < CLIENT_ANCHOR_SIZE) {
    return undefined;
  }
  const cursor = new BlockCursor([data]);
  cursor.skip(2); // flags: fMove/fSize, not read
  const colL = cursor.u16();
  const dxL = cursor.i16();
  const rwT = cursor.u16();
  const dyT = cursor.i16();
  const colR = cursor.u16();
  const dxR = cursor.i16();
  const rwB = cursor.u16();
  const dyB = cursor.i16();
  return { colL, dxL, rwT, dyT, colR, dxR, rwB, dyB };
}

/** Walks an Opt atom's own FOPTE array looking for the `pib` property ([MS-ODRAW] "pib": opid.opid MUST be 0x0104) -- undefined when the shape states no `pib` at all, or states one through the complex-data trailer form (fComplex set) this reader does not resolve, which is not the common inline-index shape a picture shape's own pib actually takes. */
function readPibProperty(data: Uint8Array<ArrayBuffer>): number | undefined {
  const cursor = new BlockCursor([data]);
  while (cursor.hasMore()) {
    const opid = cursor.u16();
    const op = cursor.u32();
    if (opid === FOPT_OPID_PIB && (opid & FOPT_FCOMPLEX_MASK) === 0) {
      return op;
    }
  }
  return undefined;
}
