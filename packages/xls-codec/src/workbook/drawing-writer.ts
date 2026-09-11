import type {
  ContentEmbeddedObject,
  ContentSheet,
  ContentSheetImage,
} from "document-schema.js";

import { RecordBuilder } from "../biff/builder";
import { writeRecord, writeRecordChain } from "../biff/record-writer";
import { RECORD_MSODRAWING, RECORD_OBJ } from "../biff/record-types";
import { writeXLUnicodeStringNoCch } from "../biff/string-writer";
import { BiffWriteError } from "../biff/write-errors";
import {
  columnWidthToPoints,
  DEFAULT_COLUMN_WIDTH_CHARS,
  DEFAULT_ROW_HEIGHT_PT,
} from "../units";
import {
  writeDrawingGroupBytes,
  writeSheetDrawingBytes,
  type DrawingIdBlock,
  type SheetShapeEntry,
  type StoredBlip,
} from "../drawing/escher-writer";
import type { ShapeAnchor } from "../drawing/shapes";
import { writeEmbeddedObjectPackage } from "./embedded-object";

// The write side of workbook/drawing.ts: one MS-ODRAW container per sheet carrying shapes (the MsoDrawing record pair), the workbook-wide drawing group (the MsoDrawingGroup stream workbook/globals-writer.ts emits ahead of the SST), and the Obj records pairing each Escher shape with what it holds -- a picture resolving into the workbook's Blip Store, or an embedded OLE object whose bytes live in an MBD Embedding Storage ([MS-XLS] 2.1.7, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/b406ade0-fb1c-4512-bff2-b576fdfff545) as a Package stream wrapping this package's own JSON payload (workbook/embedded-object.ts).
//
// A 'chart' embedded object is refused by name rather than approximated: writing one means embedding a genuine BIFF8 chart substream -- the whole [MS-XLS] chart grammar a flattened series/category table would have to drive, with series data links resolving back to real cells -- which is a chart engine of its own, not a container to place a table in. The other five objectKinds all embed through the one OLE mechanism.

/** The sheet-grid geometry an anchor resolves against and inverts into, the write-side mirror of workbook/drawing.ts's own SheetGridGeometry: declared column widths/row heights with the same Excel "Normal" defaults beneath, so a shape written from a given placement reads back at the identical placement. Derived from the same constants (units.ts) the reader's own geometry uses, so the two cannot disagree about what an undeclared cell sizes. */
class WriterGridGeometry {
  private readonly columnWidths = new Map<number, number>();
  private readonly rowHeights = new Map<number, number>();
  private readonly defaultColumnWidthPt = columnWidthToPoints(
    DEFAULT_COLUMN_WIDTH_CHARS * 256,
  );

  constructor(sheet: ContentSheet) {
    for (const column of sheet.columns) {
      if (column.widthPt !== undefined) {
        this.columnWidths.set(column.index, column.widthPt);
      }
    }
    for (const row of sheet.rows) {
      if (row.heightPt !== undefined) {
        this.rowHeights.set(row.index, row.heightPt);
      }
    }
  }

  columnWidthPt(index: number): number {
    return this.columnWidths.get(index) ?? this.defaultColumnWidthPt;
  }

  rowHeightPt(index: number): number {
    return this.rowHeights.get(index) ?? DEFAULT_ROW_HEIGHT_PT;
  }

  /** The absolute x of a column's own left edge -- the cumulative width of every column before it, the identical accumulation the reader's own geometry walks back down. */
  xPt(column: number): number {
    let x = 0;
    for (let index = 0; index < column; index += 1) {
      x += this.columnWidthPt(index);
    }
    return x;
  }

  yPt(row: number): number {
    let y = 0;
    for (let index = 0; index < row; index += 1) {
      y += this.rowHeightPt(index);
    }
    return y;
  }

  /** Locates an absolute x as a column plus a 1/1024ths-of-that-column fraction, the pair OfficeArtClientAnchorSheet's own left/right corners state. A point beyond the grid's own last column clamps to that column's far edge: the grid has no column 256 to name, and a shape whose extent runs that far past the grid loses only the overflow, where refusing the workbook would lose the cells too -- the same trade a print range past the grid already draws (print-names.ts's clampToGrid). */
  locateX(x: number): { readonly column: number; readonly fraction: number } {
    let left = 0;
    for (let column = 0; column < 0xff; column += 1) {
      const width = this.columnWidthPt(column);
      if (x < left + width) {
        return {
          column,
          fraction: Math.min(1023, Math.round(((x - left) / width) * 1024)),
        };
      }
      left += width;
    }
    return { column: 0xff, fraction: 1023 };
  }

  /** The row-axis counterpart: a row plus a 1/256ths-of-that-row fraction, clamped to the grid's own last row. */
  locateY(y: number): { readonly row: number; readonly fraction: number } {
    let top = 0;
    for (let row = 0; row < 0xffff; row += 1) {
      const height = this.rowHeightPt(row);
      if (y < top + height) {
        return {
          row,
          fraction: Math.min(255, Math.round(((y - top) / height) * 256)),
        };
      }
      top += height;
    }
    return { row: 0xffff, fraction: 255 };
  }
}

/** One anchored object's absolute placement: the page-space corner its top-left edge sits at, and its extent. Both ContentSheetImage and ContentEmbeddedObject name this corner cell-relatively (anchor cell + offsets); an embedded object carrying no anchor fields names it only through its own absolute frame, which is the one position it does state. */
interface Placement {
  readonly startXPt: number;
  readonly startYPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

function placementOfImage(
  image: ContentSheetImage,
  geometry: WriterGridGeometry,
): Placement {
  if (image.anchorRow > 0xffff || image.anchorColumn > 0xff) {
    throw new BiffWriteError(
      `a sheet image anchored at row ${image.anchorRow}, column ${image.anchorColumn} is outside BIFF8's own grid (rows 0-65535, columns 0-255); a .xls workbook cannot address the cell it names`,
    );
  }
  return {
    startXPt: geometry.xPt(image.anchorColumn) + image.offsetXPt,
    startYPt: geometry.yPt(image.anchorRow) + image.offsetYPt,
    widthPt: image.widthPt,
    heightPt: image.heightPt,
  };
}

function placementOfEmbedded(
  embedded: ContentEmbeddedObject,
  geometry: WriterGridGeometry,
): Placement {
  // The anchor quartet is optional on ContentEmbeddedObject; when present it names the corner the way an image does (the anchor cell's own origin plus the offset, the identical arithmetic the reader's resolveAnchorPlacement walks back), and when absent the frame's own absolute corner is the one position the object states.
  const startXPt =
    embedded.anchorColumn !== undefined && embedded.offsetXPt !== undefined
      ? geometry.xPt(embedded.anchorColumn) + embedded.offsetXPt
      : embedded.frame.xPt;
  const startYPt =
    embedded.anchorRow !== undefined && embedded.offsetYPt !== undefined
      ? geometry.yPt(embedded.anchorRow) + embedded.offsetYPt
      : embedded.frame.yPt;
  return {
    startXPt,
    startYPt,
    widthPt: embedded.frame.widthPt,
    heightPt: embedded.frame.heightPt,
  };
}

/** Inverts a placement into the OfficeArtClientAnchorSheet corner pair the reader's own resolveAnchorPlacement turns back into that placement: each corner resolved to its containing cell and a 1/1024ths (columns) or 1/256ths (rows) fraction within it. */
function anchorOf(
  placement: Placement,
  geometry: WriterGridGeometry,
): ShapeAnchor {
  const start = geometry.locateX(placement.startXPt);
  const end = geometry.locateX(placement.startXPt + placement.widthPt);
  const top = geometry.locateY(placement.startYPt);
  const bottom = geometry.locateY(placement.startYPt + placement.heightPt);
  return {
    colL: start.column,
    dxL: start.fraction,
    rwT: top.row,
    dyT: top.fraction,
    colR: end.column,
    dxR: end.fraction,
    rwB: bottom.row,
    dyB: bottom.fraction,
  };
}

// --- The Obj records ([MS-XLS] 2.4.181, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/dd34df60-8250-40a9-83a3-911476a31ea7) ---

/** [MS-XLS] 2.5.213's own ot table: the Picture type both a plain image and an embedded OLE object carry -- an OLE object IS hosted through the picture machinery (its FtPictFmla naming the Embedding Storage its data lives in), which is exactly how the Embedding Storage page itself states the pairing ("cmo.ot equal to 8, pictFlags.fPrstm equal to 0, and pictFlags.fDde equal to 0"). */
const OBJECT_TYPE_PICTURE = 0x0008;

/** FtCmo ([MS-XLS] 2.5.92, 22 bytes): ft 0x15, cb 0x12, the object type and id, then grbit and three unused dwords all written zero -- the identical shape comment-writer.ts writes for a Note, restated here with the object type as a parameter rather than shared across the two direction modules. */
function writeFtCmo(ot: number, id: number): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u16(0x0015)
    .u16(0x0012)
    .u16(ot)
    .u16(id)
    .u16(0) // grbit: fLocked/fDefaultSize/fPublished/fPrint and reserved bits, none of which this writer has data for
    .u32(0) // unused8
    .u32(0) // unused9
    .u32(0) // unused10
    .build();
}

/** FtCf ([MS-XLS] 2.5.142, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/fc5bb3ce-8e35-4393-b22f-9cf54062a3a4): the clipboard format of the picture this object shows. 0xFFFF names "an unspecified format that is neither an enhanced metafile nor a bitmap" -- honest for a shape whose visible rendering is the blip the Escher layer itself carries and for an OLE object this writer has no preview metafile for. */
function writeFtCf(): Uint8Array<ArrayBuffer> {
  return new RecordBuilder().u16(0x0007).u16(0x0002).u16(0xffff).build();
}

/** FtPioGrbit ([MS-XLS] 2.5.151, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/8eee0b3d-9d27-4294-85fc-a66ae8a361c9): a plain picture states fAutoPict (aspect preserved across views); an OLE embedding states no bits at all -- fPrstm and fDde stay clear, the pair the Embedding Storage page requires for storage-based object data. */
function writeFtPioGrbit(autoPict: boolean): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u16(0x0008)
    .u16(0x0002)
    .u16(autoPict ? 0x0001 : 0x0000)
    .build();
}

/** The PtgTbl token byte an embedded object's ObjectParsedFormula carries ([MS-XLS] 2.5.198.92: ptg 0x02, class none) -- the spelling that tells a reader this picture's data lives in an Embedding Storage rather than a linked range. */
const PTG_TBL = 0x02;

/** The class name stated in an embedding's PictFmlaEmbedInfo: "Package" is what a genuine OLE Package embed carries, so a real OLE-aware consumer that cannot decode this package's own JSON payload still sees a recognisable, accurate class rather than an invented one -- the identical choice rtf-codec's own ObjectHeader makes for the same payload shape. */
const EMBED_CLASS_NAME = "Package";

/** FtPictFmla ([MS-XLS] 2.5.150, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/00f89d32-67b0-408e-9eaf-f4fecbddb089) for an embedded OLE object: the ObjFmla (cbFmla counting the ObjectParsedFormula, the PictFmlaEmbedInfo, and the padding -- even, per [MS-XLS] 2.5.187's own cbFmla rule), then lPosInCtlStm, the storage id the Embedding Storage's own MBD name is the eight-hex-digit spelling of. The ObjectParsedFormula is the one shape [MS-XLS] pins for an embedding: cce 5, rgce one PtgTbl followed by four undefined bytes. */
function writeFtPictFmla(storageId: number): Uint8Array<ArrayBuffer> {
  const formula = new RecordBuilder()
    .u16(5) // ObjectParsedFormula.cce
    .u32(0) // ObjectParsedFormula.unused
    .u8(PTG_TBL)
    .bytes(new Uint8Array(4)) // PtgTbl's own four undefined bytes
    .build();
  const className = writeXLUnicodeStringNoCch(EMBED_CLASS_NAME);
  const embedInfo = new RecordBuilder()
    .u8(0x03) // ttb: reserved, MUST be 0x03
    .u8(className.length - 1) // cbClass: the class name's own character count, one byte per character in the compressed spelling
    .u8(0) // reserved
    .bytes(className)
    .build();
  const fmlaBytes = new RecordBuilder().bytes(formula).bytes(embedInfo).build();
  const data = new RecordBuilder()
    .u16(fmlaBytes.length) // cbFmla -- even, as [MS-XLS] requires
    .bytes(fmlaBytes)
    .u32(storageId) // lPosInCtlStm
    .build();
  return new RecordBuilder().u16(0x0009).u16(data.length).bytes(data).build();
}

/** The trailing four reserved bytes every Obj not naming a list-box/dropdown object carries ([MS-XLS] 2.4.181's own reserved field: MUST be 0) -- the ftEnd marker a real sub-record walk terminates on. */
const OBJ_RESERVED_END = new Uint8Array(4);

/** One picture shape's Obj record: FtCmo (ot Picture), FtCf, FtPioGrbit, and the trailing reserved field. No FtPictFmla -- the image's bytes live in the workbook's Blip Store, which the shape's own pib property names, leaving the Obj record itself nothing to locate. */
function writePictureObjRecord(objectId: number): Uint8Array<ArrayBuffer> {
  return writeRecord(
    RECORD_OBJ,
    new RecordBuilder()
      .bytes(writeFtCmo(OBJECT_TYPE_PICTURE, objectId))
      .bytes(writeFtCf())
      .bytes(writeFtPioGrbit(true))
      .bytes(OBJ_RESERVED_END)
      .build(),
  );
}

/** One embedded OLE object's Obj record: FtCmo (ot Picture), FtCf, FtPioGrbit (no bits -- storage-based, per the Embedding Storage page's own fPrstm/fDde requirement), the FtPictFmla naming the storage, and the trailing reserved field. */
function writeEmbeddedObjRecord(
  objectId: number,
  storageId: number,
): Uint8Array<ArrayBuffer> {
  return writeRecord(
    RECORD_OBJ,
    new RecordBuilder()
      .bytes(writeFtCmo(OBJECT_TYPE_PICTURE, objectId))
      .bytes(writeFtCf())
      .bytes(writeFtPioGrbit(false))
      .bytes(writeFtPictFmla(storageId))
      .bytes(OBJ_RESERVED_END)
      .build(),
  );
}

// --- The workbook-wide plan ---

/** Base64's own character set, decoded by hand rather than through atob's DOM-string round trip -- mirroring drawing/blips.ts's own hand-written encoder, which exists for the identical reason: byte-exact, allocation-predictable, and identical in Node and a Workers isolate. */
function bytesFromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const values = new Int8Array(256).fill(-1);
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    .split("")
    .forEach((char, index) => {
      values[char.charCodeAt(0)] = index;
    });
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((base64.length / 4) * 3 - padding);
  let buffer = 0;
  let bits = 0;
  let outIndex = 0;
  for (const char of base64) {
    const value = values[char.charCodeAt(0)];
    if (value === undefined || value < 0) {
      continue; // the padding characters
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex] = (buffer >> bits) & 0xff;
      outIndex += 1;
    }
  }
  return out;
}

/** One sheet's own drawing records, positioned into the worksheet substream's OBJECTS section by sheet-writer.ts. Empty arrays when the sheet carries no shapes at all -- a sheet with nothing to draw writes no MsoDrawing and no Obj, staying as minimal as it always was. */
export interface SheetDrawingWrite {
  readonly msoDrawingRecords: readonly Uint8Array<ArrayBuffer>[];
  readonly objRecords: readonly Uint8Array<ArrayBuffer>[];
}

/** The workbook-wide drawing plan: the drawing-group Escher bytes the globals substream's MsoDrawingGroup record carries (undefined when no sheet carries shapes, in which case no such record is written at all), one drawing write per sheet, and the Embedding Storage streams the outer compound file carries beside the Workbook stream. */
export interface DrawingWritePlan {
  readonly drawingGroupBytes: Uint8Array<ArrayBuffer> | undefined;
  readonly sheetDrawings: readonly SheetDrawingWrite[];
  readonly embeddingStreams: readonly {
    readonly path: string;
    readonly bytes: Uint8Array<ArrayBuffer>;
  }[];
}

/**
 * Builds every sheet's drawing and the workbook-wide state around it, in one pass over the document before any record is written -- the same workbook-wide-passes shape write.ts's own format, colour, font, and string tables take.
 *
 * Images dedupe through the Blip Store: two placements of the same bytes share one BSE, whose cRef counts the references. Embedded objects (every objectKind but 'chart', which is refused by name) each get their own MBD Embedding Storage named by a storage id this plan assigns sequentially from 1, its FtPictFmla carrying the id and the outer compound file carrying the storage. Shape ids allocate from 1024 across the whole workbook -- Excel's own convention for the first drawing group -- patriarch first, then each sheet's real shapes in document order, so the Escher stream's shape order and the Obj records' order pair 1:1 the way the reader's own positional correlation expects.
 */
/** A StoredBlip whose own referenceCount this plan is still free to increment -- StoredBlip's own field is readonly for escher-writer.ts's callers, since nothing downstream of writeDrawingGroupBytes should mutate a finished plan, but this function is what counts the references in the first place. */
type MutableStoredBlip = { -readonly [K in keyof StoredBlip]: StoredBlip[K] };

export function buildDrawingWritePlan(
  sheets: readonly ContentSheet[],
): DrawingWritePlan {
  const blips: MutableStoredBlip[] = [];
  const blipIndexByBase64 = new Map<string, number>();

  const resolveBlip = (image: ContentSheetImage): number => {
    if (image.format !== "png" && image.format !== "jpeg") {
      throw new BiffWriteError(
        `xls-codec cannot write a sheet image of format "${image.format}": [MS-ODRAW]'s own MSOBLIPTYPE enumeration has no member for it, so no Blip Store entry can carry it`,
      );
    }
    const existing = blipIndexByBase64.get(image.base64);
    if (existing !== undefined) {
      // A deduplicated reference: the BSE's own cRef counts references to the BLIP, so the count grows rather than a second entry being minted.
      const blip = blips[existing - 1];
      if (blip === undefined) {
        throw new BiffWriteError(
          "internal error: a blip index resolved that the workbook-wide image scan never assigned",
        );
      }
      blip.referenceCount += 1;
      return existing;
    }
    const index = blips.length + 1;
    blipIndexByBase64.set(image.base64, index);
    blips.push({
      format: image.format,
      fileBytes: bytesFromBase64(image.base64),
      referenceCount: 1,
    });
    return index;
  };

  // Storage ids are assigned workbook-wide from 1, and the MBD storage name is the id's own eight-uppercase-hex-digit spelling -- the format the Embedding Storage page states and every real producer (and this package's own reader) spells it back as.
  let nextStorageId = 1;
  const storageIdOf = (): number => {
    const id = nextStorageId;
    nextStorageId += 1;
    return id;
  };

  let nextSpid = 1024;
  let nextDrawingId = 1;
  const drawingBlocks: DrawingIdBlock[] = [];
  const sheetDrawings: SheetDrawingWrite[] = [];
  const embeddingStreams: { path: string; bytes: Uint8Array<ArrayBuffer> }[] =
    [];

  for (const sheet of sheets) {
    const geometry = new WriterGridGeometry(sheet);
    const entries: SheetShapeEntry[] = [];
    const objRecords: Uint8Array<ArrayBuffer>[] = [];
    // Object ids continue past the comment records the same substream carries ([MS-XLS] 2.5.92: an id MUST be unique among all Obj records of the substream), so the drawing's ids start one past the commented-cell count.
    let nextObjectId =
      sheet.cells.filter((cell) => cell.comment !== undefined).length + 1;

    for (const image of sheet.images) {
      entries.push({
        anchor: anchorOf(placementOfImage(image, geometry), geometry),
        blipIndex: resolveBlip(image),
        oleShape: false,
      });
      objRecords.push(writePictureObjRecord(nextObjectId));
      nextObjectId += 1;
    }
    for (const embedded of sheet.embeddedObjects ?? []) {
      if (embedded.objectKind === "chart") {
        throw new BiffWriteError(
          "xls-codec cannot write a 'chart' embedded object: embedding one means writing a genuine BIFF8 chart substream -- the whole [MS-XLS] chart grammar its series data links drive -- which is a chart engine of its own rather than a container for the flattened series table the schema carries",
        );
      }
      const storageId = storageIdOf();
      entries.push({
        anchor: anchorOf(placementOfEmbedded(embedded, geometry), geometry),
        blipIndex: undefined,
        oleShape: true,
      });
      objRecords.push(writeEmbeddedObjRecord(nextObjectId, storageId));
      nextObjectId += 1;
      embeddingStreams.push({
        path: `MBD${storageId.toString(16).toUpperCase().padStart(8, "0")}/Package`,
        bytes: writeEmbeddedObjectPackage(embedded),
      });
    }

    if (entries.length === 0) {
      sheetDrawings.push({ msoDrawingRecords: [], objRecords: [] });
      continue;
    }
    const escherBytes = writeSheetDrawingBytes(
      nextDrawingId,
      nextSpid,
      entries,
    );
    drawingBlocks.push({
      drawingId: nextDrawingId,
      lastSpid: nextSpid + entries.length,
      shapeCount: entries.length + 1, // the patriarch alongside the real shapes
    });
    nextDrawingId += 1;
    nextSpid += entries.length + 1; // this sheet's patriarch took one id too
    sheetDrawings.push({
      // MsoDrawing's own data concatenates across its Continue chain ([MS-XLS] 2.4.180 and the MSODRAWING production), so a drawing larger than one record's 8224-byte ceiling is chained rather than refused -- the one record family whose size real image bytes make routinely exceed the ceiling.
      msoDrawingRecords: writeRecordChain(RECORD_MSODRAWING, escherBytes),
      objRecords,
    });
  }

  return {
    drawingGroupBytes:
      drawingBlocks.length > 0
        ? writeDrawingGroupBytes(blips, drawingBlocks)
        : undefined,
    sheetDrawings,
    embeddingStreams,
  };
}
