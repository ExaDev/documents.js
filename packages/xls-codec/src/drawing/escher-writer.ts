import { RecordBuilder } from "../biff/builder";
import { BiffWriteError } from "../biff/write-errors";
import { md4 } from "./md4";
import {
  ESCHER_BSE,
  ESCHER_BSTORE_CONTAINER,
  ESCHER_CLIENT_ANCHOR,
  ESCHER_CLIENT_DATA,
  ESCHER_DG_CONTAINER,
  ESCHER_DGG_CONTAINER,
  ESCHER_FSPGR,
  ESCHER_OPT,
  ESCHER_SP,
  ESCHER_SPGR_CONTAINER,
  ESCHER_SP_CONTAINER,
  FOPT_OPID_PIB,
} from "./escher-constants";
import type { ShapeAnchor } from "./shapes";

// The write side of drawing/escher.ts: [MS-ODRAW]'s own OfficeArtRecordHeader/container framing in reverse, plus the two container trees this writer actually builds -- the workbook-wide DggContainer (its FDGGBlock and its Blip Store) and one per-sheet DgContainer (its FDG and shape tree). Every structural claim cites the [MS-ODRAW] page it comes from, mirroring the reader's own convention.
//
// [MS-ODRAW] 2.2.1 OfficeArtRecordHeader (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/5dc1b9ed-818c-436f-8a4f-905a7ebb1ba9): a little-endian WORD whose low nibble is recVer and whose remaining 12 bits are recInstance, then a little-endian recType WORD, then a little-endian recLen DWORD counting the bytes that follow the header -- for a container, the total size of every nested record INCLUDING their own headers, which is what assembling a container from its children's own finished bytes gives for free.

/** One Escher atom's own bytes: header plus `data` verbatim. */
function escherAtom(
  recVer: number,
  recInstance: number,
  recType: number,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u16((recVer & 0xf) | ((recInstance & 0xfff) << 4))
    .u16(recType)
    .u32(data.length)
    .bytes(data)
    .build();
}

/** One Escher container's own bytes: header (recVer 0xF, [MS-ODRAW] 2.2.1's container marker, in the verInstance word's low nibble) plus its children concatenated -- recLen is then the children's total size with their own headers included, exactly what the format defines. `recInstance` is the verInstance word's upper 12 bits, which every container this writer states pins to 0x000 except the Blip Store, whose own page requires the count of BSE children. */
function escherContainer(
  recType: number,
  recInstance: number,
  children: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
  const body = children.reduce<number>((sum, child) => sum + child.length, 0);
  const builder = new RecordBuilder()
    .u16(0x000f | ((recInstance & 0xfff) << 4))
    .u16(recType)
    .u32(body);
  for (const child of children) {
    builder.bytes(child);
  }
  return builder.build();
}

// MSOBLIPTYPE ([MS-ODRAW] 2.4.1, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/84e15233-f5a0-4c9f-bb31-b31bf8795e15), the two members this writer states: the FBSE's own btWin32/btMacOS pair and the BSE header's recInstance both name the blip's persistence format through it.
const MSOBLIP_JPEG = 0x05;
const MSOBLIP_PNG = 0x06;

// OfficeArtBlip record headers ([MS-ODRAW] 2.2.23's own table): the recType each format carries, and the one-UID recInstance values -- 0x6E0 for PNG, 0x46A for JPEG (RGB). A one-UID blip is all this writer needs: rgbUid2 exists to hold a second, printer-representation digest that a file with only one rendering of the image has no reason to state.
const BLIP_PNG_RECTYPE = 0xf01e;
const BLIP_JPEG_RECTYPE = 0xf01d;
const BLIP_PNG_INSTANCE_ONE_UID = 0x6e0;
const BLIP_JPEG_INSTANCE_ONE_UID = 0x46a;

/** rgbUid's own fixed size: [MS-ODRAW]'s FBSE and Blip records each open with one 16-byte MD4 digest of the image data. */
const UID_SIZE = 16;

function blipFormatFields(format: "png" | "jpeg"): {
  readonly msoBlip: number;
  readonly recType: number;
  readonly recInstance: number;
} {
  if (format === "png") {
    return {
      msoBlip: MSOBLIP_PNG,
      recType: BLIP_PNG_RECTYPE,
      recInstance: BLIP_PNG_INSTANCE_ONE_UID,
    };
  }
  return {
    msoBlip: MSOBLIP_JPEG,
    recType: BLIP_JPEG_RECTYPE,
    recInstance: BLIP_JPEG_INSTANCE_ONE_UID,
  };
}

/** One OfficeArtBlipPNG/JPEG record ([MS-ODRAW] 2.2.28/2.2.27): one rgbUid (the MD4 of the file bytes -- a digest of the UNCOMPRESSED blip data per 2.2.28's own field text, which for PNG and JPEG is the file bytes themselves), the tag byte, then the literal file bytes. The tag byte is 0xFF, "internal resource tag" -- the value real producers write for data embedded in the record. */
function writeBlipRecord(
  format: "png" | "jpeg",
  uidBytes: Uint8Array<ArrayBuffer>,
  fileBytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const fields = blipFormatFields(format);
  return escherAtom(
    0x0,
    fields.recInstance,
    fields.recType,
    new RecordBuilder().bytes(uidBytes).u8(0xff).bytes(fileBytes).build(),
  );
}

/** One distinct image the workbook's sheets share: its decoded bytes, and how many picture shapes reference it (the FBSE's own cRef, which [MS-ODRAW] defines as the number of references to the BLIP). */
export interface StoredBlip {
  readonly format: "png" | "jpeg";
  readonly fileBytes: Uint8Array<ArrayBuffer>;
  readonly referenceCount: number;
}

/** One OfficeArtFBSE ([MS-ODRAW] 2.2.24.1, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/2f2d7f5e-d5c4-4cb7-b230-59b3fe8f10d6): the blip's type pair, its rgbUid, a tag, the embedded blip record's own total size, the reference count, a foDelay this writer always states as "not in a delay stream" alongside an inline embeddedBlip (which [MS-ODRAW] says makes foDelay ignored), the name-length byte (0 -- no name), and the embedded blip record itself. recLen's own rule -- "the size of nameData plus size plus 36" for an embedded blip -- falls out of the fixed fields plus the blip record's length. */
function writeBseRecord(blip: StoredBlip): Uint8Array<ArrayBuffer> {
  const fields = blipFormatFields(blip.format);
  const uidBytes = hexToBytes(md4(blip.fileBytes));
  if (uidBytes.length !== UID_SIZE) {
    throw new BiffWriteError(
      `internal error: md4 produced a ${uidBytes.length}-byte digest, not the ${UID_SIZE} bytes rgbUid ([MS-ODRAW]'s own FBSE/Blip field) requires`,
    );
  }
  const embedded = writeBlipRecord(blip.format, uidBytes, blip.fileBytes);
  const fixed = new RecordBuilder()
    .u8(fields.msoBlip) // btWin32
    .u8(fields.msoBlip) // btMacOS -- both platforms name the same format, the one case [MS-ODRAW]'s own MUST-match rules describe
    .bytes(uidBytes)
    .u16(0x00ff) // tag -- "MUST be 0xFF for external files", the value real producers write for an embedded blip too
    .u32(embedded.length) // size: the BLIP's own size in the stream
    .u32(blip.referenceCount) // cRef
    .u32(0) // foDelay: no delay stream; the embeddedBlip below makes this ignored
    .u8(0) // unused1
    .u8(0) // cbName: no nameData
    .u8(0) // unused2
    .u8(0); // unused3
  return escherAtom(
    0x2,
    fields.msoBlip,
    ESCHER_BSE,
    new RecordBuilder().bytes(fixed.build()).bytes(embedded).build(),
  );
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/** One drawing's own contribution to the drawing group's shape-id state: the drawing identifier its FDG and IDCL both name, and the last shape identifier it allocated. */
export interface DrawingIdBlock {
  readonly drawingId: number;
  readonly lastSpid: number;
  readonly shapeCount: number;
}

/**
 * The workbook-wide OfficeArtDggContainer ([MS-ODRAW] 2.2.12, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/dd7133b6-ed10-4bcb-be29-67b0544f884f): a FDGGBlock (the FDGG atom plus one OfficeArtIDCL per drawing, cidcl = drawing count + 1 per 2.2.14's own field definition) followed by the Blip Store when the workbook carries any image. The DggContainer's own optional children this writer has no data for -- drawingPrimaryOptions, colorMRU, splitColors -- are omitted, which the container's own production permits.
 */
export function writeDrawingGroupBytes(
  blips: readonly StoredBlip[],
  drawings: readonly DrawingIdBlock[],
): Uint8Array<ArrayBuffer> {
  // OfficeArtFDGG ([MS-ODRAW] 2.2.14): spidMax (the largest shape id any drawing allocated), cidcl (IDCL count + 1), cspSaved (total shapes saved), cdgSaved (drawings saved).
  const spidMax = drawings.reduce(
    (max, drawing) => Math.max(max, drawing.lastSpid),
    0,
  );
  const cspSaved = drawings.reduce(
    (sum, drawing) => sum + drawing.shapeCount,
    0,
  );
  const fdgg = new RecordBuilder()
    .u32(spidMax)
    .u32(drawings.length + 1) // cidcl
    .u32(cspSaved)
    .u32(drawings.length); // cdgSaved
  // One OfficeArtIDCL ([MS-ODRAW] 2.2.13) per drawing: dgid naming that drawing, cspidCur the largest shape id assigned in it.
  for (const drawing of drawings) {
    fdgg.u32(drawing.drawingId).u32(drawing.lastSpid);
  }
  const fdggBlock = escherAtom(0x0, 0x0000, 0xf006, fdgg.build());

  const children: Uint8Array<ArrayBuffer>[] = [fdggBlock];
  if (blips.length > 0) {
    children.push(
      escherContainer(
        ESCHER_BSTORE_CONTAINER,
        blips.length, // the Blip Store's own recInstance states its BSE count ([MS-ODRAW] 2.2.20)
        blips.map((blip) => writeBseRecord(blip)),
      ),
    );
  }
  return escherContainer(ESCHER_DGG_CONTAINER, 0x0000, children);
}

// --- One worksheet's own drawing ([MS-ODRAW] OfficeArtDgContainer, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/68976475-fcfd-4483-8fc4-75adc635130d) ---

// OfficeArtFSP's own flag bits ([MS-ODRAW] 2.2.40's A-L table, LSB first): only the four a shape this writer states ever sets.
const FSP_FLAG_GROUP = 0x1 << 0;
const FSP_FLAG_PATRIARCH = 0x1 << 2;
const FSP_FLAG_OLE_SHAPE = 0x1 << 4;
const FSP_FLAG_HAVE_ANCHOR = 0x1 << 9;
const FSP_FLAG_HAVE_SPT = 0x1 << 11;

/** One real (non-patriarch) shape this writer places on a sheet: its anchor, its 1-based Blip Store reference when it is a picture, and whether it hosts an embedded OLE object (which sets FSP's own fOleShape and takes no pib). */
export interface SheetShapeEntry {
  readonly anchor: ShapeAnchor;
  readonly blipIndex: number | undefined;
  readonly oleShape: boolean;
}

/** OfficeArtFSP ([MS-ODRAW] 2.2.40, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/8a7e7be3-0582-4461-9400-29d7eda8497d): recVer 0x2, recInstance carrying the shape's own MSOSPT type, then spid and the flags word. Every shape this writer states is a picture frame (MSOSPT 0x4B) -- a picture because it holds an image, an OLE object because [MS-ODRAW]'s own model hosts one through the picture machinery with fOleShape set. */
function writeFspRecord(
  spid: number,
  flags: number,
  shapeType: number,
): Uint8Array<ArrayBuffer> {
  return escherAtom(
    0x2,
    shapeType,
    ESCHER_SP,
    new RecordBuilder()
      .u32(spid)
      .u32(flags >>> 0)
      .build(),
  );
}

/** OfficeArtFOPT ([MS-ODRAW] 2.2.9): recVer 0x3, recInstance carrying the property count, then that many 6-byte FOPTE entries (opid, op). The one property this writer states is `pib` -- the picture's own 1-based Blip Store index, opid 0x0104 with fComplex clear. */
function writePibOptRecord(blipIndex: number): Uint8Array<ArrayBuffer> {
  return escherAtom(
    0x3,
    0x0001, // one property
    ESCHER_OPT,
    new RecordBuilder().u16(FOPT_OPID_PIB).u32(blipIndex).build(),
  );
}

/** OfficeArtClientAnchorSheet ([MS-XLS] 2.5.193): recVer 0, recLen 18, a flags word (fMove and fSize both set -- the shape moves and sizes with its cells, the behaviour an image anchored to cells means), then the corner-cell-plus-fractional-offset pair -- eight u16 fields, 18 bytes total (2 for flags + 8*2), matching the record's own declared recLen and drawing/shapes.ts's own readClientAnchor, which reads each of dxL/dyT/dxR/dyB as a 2-byte i16, not a 4-byte i32. dxL/dxR are 1/1024ths of their column's own width, dyT/dyB 1/256ths of their row's own height, both always non-negative in this writer's own range (0-1023, 0-255), so the identical bit pattern u16 writes here is what i16 reads back unchanged. */
function writeClientAnchorRecord(anchor: ShapeAnchor): Uint8Array<ArrayBuffer> {
  return escherAtom(
    0x0,
    0x0000,
    ESCHER_CLIENT_ANCHOR,
    new RecordBuilder()
      .u16(0x0003) // fMove | fSize
      .u16(anchor.colL)
      .u16(anchor.dxL)
      .u16(anchor.rwT)
      .u16(anchor.dyT)
      .u16(anchor.colR)
      .u16(anchor.dxR)
      .u16(anchor.rwB)
      .u16(anchor.dyB)
      .build(),
  );
}

/** OfficeArtClientData: an empty atom (recLen 0) whose presence is what tells a reader that the next BIFF record after the MsoDrawing is this shape's own Obj record -- see [MS-XLS] MsoDrawing's own prose, cited on ESCHER_CLIENT_DATA above. */
function writeClientDataRecord(): Uint8Array<ArrayBuffer> {
  return escherAtom(0x0, 0x0000, ESCHER_CLIENT_DATA, new Uint8Array(0));
}

/** One shape's own SpContainer ([MS-ODRAW] 2.2.14, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/16194cb9-b4b0-476c-9678-a6ac1f06b034): shapeProp (the FSP), then shapePrimaryOptions only for a picture (the pib property table), then the clientAnchor and the clientData -- the reader's own SpContainer walk reads exactly these atoms and no others. */
function writeShapeContainer(
  spid: number,
  entry: SheetShapeEntry,
): Uint8Array<ArrayBuffer> {
  const flags =
    (entry.oleShape ? FSP_FLAG_OLE_SHAPE : 0) |
    FSP_FLAG_HAVE_ANCHOR |
    FSP_FLAG_HAVE_SPT;
  const children: Uint8Array<ArrayBuffer>[] = [
    writeFspRecord(spid, flags, 0x004b), // MSOSPT PictureFrame
  ];
  if (entry.blipIndex !== undefined) {
    children.push(writePibOptRecord(entry.blipIndex));
  }
  children.push(writeClientAnchorRecord(entry.anchor), writeClientDataRecord());
  return escherContainer(ESCHER_SP_CONTAINER, 0x0000, children);
}

/**
 * One worksheet's own OfficeArtDgContainer: the FDG atom (recInstance carrying the drawing identifier, csp counting the patriarch alongside every real shape, spidCur the last shape id this drawing allocated), then the one SpgrContainer holding the patriarch -- an SpContainer whose FSPGR states the all-zero coordinate rectangle and whose FSP carries fGroup|fPatriarch -- followed by one SpContainer per real shape in document order, the order the sheet's Obj records then pair with 1:1. `spidBase` is the first unallocated shape id of the whole drawing group (1024 for the first sheet carrying shapes, Excel's own convention): the patriarch takes it, the real shapes take the following ids, and the caller continues allocating from the returned drawing's own lastSpid.
 *
 * The DgContainer's own further optional children (a SolverContainer, deleted shapes) are omitted: this writer states no solver rules and no deleted shapes, which the container's own production permits.
 */
export function writeSheetDrawingBytes(
  drawingId: number,
  spidBase: number,
  entries: readonly SheetShapeEntry[],
): Uint8Array<ArrayBuffer> {
  const lastSpid = spidBase + entries.length;
  const fdg = escherAtom(
    0x0,
    drawingId,
    0xf008, // OfficeArtFDG ([MS-ODRAW] 2.2.17): recInstance = the drawing identifier
    new RecordBuilder()
      .u32(entries.length + 1)
      .u32(lastSpid)
      .build(), // csp counts the patriarch; spidCur
  );
  const patriarch = escherContainer(ESCHER_SP_CONTAINER, 0x0000, [
    escherAtom(
      0x0,
      0x0000,
      ESCHER_FSPGR,
      new Uint8Array(16), // all-zero rectangle
    ),
    writeFspRecord(
      spidBase,
      (FSP_FLAG_GROUP | FSP_FLAG_PATRIARCH) >>> 0,
      0x0000, // MSOSPT NotPrimitive -- the patriarch is a container, not a drawn shape
    ),
  ]);
  const spgr = escherContainer(ESCHER_SPGR_CONTAINER, 0x0000, [
    patriarch,
    ...entries.map((entry, index) =>
      writeShapeContainer(spidBase + index + 1, entry),
    ),
  ]);
  return escherContainer(ESCHER_DG_CONTAINER, 0x0000, [fdg, spgr]);
}
