import { BlockCursor } from "../biff/cursor";
import {
  ESCHER_BLIP_JPEG_A,
  ESCHER_BLIP_JPEG_B,
  ESCHER_BLIP_PNG,
  ESCHER_BSE,
  ESCHER_BSTORE_CONTAINER,
  ESCHER_DGG_CONTAINER,
} from "./escher-constants";
import { childrenOfType, readEscherRecords, type EscherRecord } from "./escher";

// The Blip Store ([MS-ODRAW] OfficeArtBstoreContainer -- see escher-constants.ts for citations): the workbook-wide table of embedded images every worksheet's picture shapes reference by a 1-based index (their own Opt property table's `pib` value), read once from the workbook globals substream's own MsoDrawingGroup stream and shared across every sheet, exactly as [MS-ODRAW] documents the Blip Store as a property of the drawing DOCUMENT rather than of any one sheet's drawing.

/** One resolved image: the bytes document-schema.js's ContentImageBlockSchema can actually carry (png/jpeg only -- see readBlipImage below), base64-encoded. */
export interface BlipImage {
  readonly format: "png" | "jpeg";
  readonly base64: string;
}

const RGB_UID_SIZE = 16;
const BLIP_TAG_SIZE = 1;

/** [MS-ODRAW] OfficeArtFBSE's own fixed fields up to and including unused3, before the optional nameData and the nested embedded blip -- btWin32(1) + btMacOS(1) + rgbUid(16) + tag(2) + size(4) + cRef(4) + foDelay(4) + unused1(1) + cbName(1) + unused2(1) + unused3(1). */
const BSE_FIXED_SIZE = 1 + 1 + RGB_UID_SIZE + 2 + 4 + 4 + 4 + 1 + 1 + 1 + 1;

/** A Blip record's own recInstance, mapped to how many 16-byte rgbUid fields precede its `tag` byte and the raw file bytes -- one UID for a blip embedded once, two when [MS-ODRAW] also records a second, "printer" representation's own hash. Only PNG/JPEG instances are named: every other blip type resolves to no image at all (see readBlipImage), so its own UID count is never needed. */
const BLIP_UID_COUNTS: ReadonlyMap<number, number> = new Map([
  [0x6e0, 1], // PNG, 1 UID
  [0x6e1, 2], // PNG, 2 UIDs
  [0x46a, 1], // JPEG (RGB), 1 UID
  [0x46b, 2], // JPEG (RGB), 2 UIDs
  [0x6e2, 1], // JPEG (CMYK), 1 UID
  [0x6e3, 2], // JPEG (CMYK), 2 UIDs
]);

/** Reads every BSE entry the workbook's own drawing-group Escher stream declares, keyed by its 1-based position in the Blip Store array -- the same index a picture shape's `pib` property names. A BSE this reader cannot turn into a real image (no embedded blip, or a blip type document-schema.js's ContentImageBlockSchema has no lossless slot for -- DIB, EMF, WMF, PICT, TIFF) is simply absent from the map, exactly like any other unsupported construct elsewhere in this package: a picture shape whose `pib` resolves to one of these is recognised as a picture but produces no ContentSheetImage, rather than a fabricated or mistranscoded one. */
export function readBlipStore(
  drawingGroupBytes: Uint8Array<ArrayBuffer>,
): ReadonlyMap<number, BlipImage> {
  const store = new Map<number, BlipImage>();
  if (drawingGroupBytes.length === 0) {
    return store;
  }
  const roots = readEscherRecords(drawingGroupBytes);
  const dgg = roots.find(
    (record): record is Extract<EscherRecord, { kind: "container" }> =>
      record.kind === "container" && record.recType === ESCHER_DGG_CONTAINER,
  );
  if (dgg === undefined) {
    return store;
  }
  const bstore = childrenOfType(dgg, ESCHER_BSTORE_CONTAINER)[0];
  if (bstore?.kind !== "container") {
    return store;
  }
  const bseRecords = childrenOfType(bstore, ESCHER_BSE);
  bseRecords.forEach((bse, index) => {
    if (bse.kind !== "atom") {
      return;
    }
    const image = readBseImage(bse.data);
    if (image !== undefined) {
      store.set(index + 1, image);
    }
  });
  return store;
}

/** One BSE atom's own body ([MS-ODRAW] OfficeArtFBSE): the fixed fields, an optional nameData string, then the nested embedded blip record -- present whenever the image is stored inline rather than only linked externally (foDelay !== 0xFFFFFFFF), which is the only case this reader can recover bytes for at all. */
function readBseImage(data: Uint8Array<ArrayBuffer>): BlipImage | undefined {
  if (data.length < BSE_FIXED_SIZE) {
    return undefined;
  }
  const cursor = new BlockCursor([data]);
  cursor.skip(1); // btWin32
  cursor.skip(1); // btMacOS
  cursor.skip(RGB_UID_SIZE); // rgbUid
  cursor.skip(2); // tag
  cursor.skip(4); // size
  cursor.skip(4); // cRef
  cursor.skip(4); // foDelay
  cursor.skip(1); // unused1
  const cbName = cursor.u8();
  cursor.skip(1); // unused2
  cursor.skip(1); // unused3
  const nameBytes = cbName > 0 ? cbName : 0;
  const embeddedStart = BSE_FIXED_SIZE + nameBytes;
  if (embeddedStart >= data.length) {
    // No embedded blip at all -- an externally-linked reference (foDelay carries a delay-stream offset instead), which this reader has no delay stream to resolve against.
    return undefined;
  }
  const embeddedBytes = data.subarray(embeddedStart);
  const blipRecords = readEscherRecords(embeddedBytes);
  const blip = blipRecords[0];
  if (blip?.kind !== "atom") {
    return undefined;
  }
  return readBlipImage(blip.recType, blip.recInstance, blip.data);
}

/** One embedded OfficeArtBlip record's own body -- one or two 16-byte rgbUid fields, a one-byte tag, then the literal image file bytes to the end of the record. PNG and JPEG blips carry their literal file bytes verbatim ([MS-ODRAW] OfficeArtBlipPNG/OfficeArtBlipJPEG); every other recognised blip type (DIB -- an in-memory Windows DIB, not a standalone .bmp file, and carrying no BITMAPFILEHEADER of its own to become one) has no lossless target in document-schema.js's ContentImageBlockSchema (png/jpeg/svg/gif only) and resolves to undefined rather than a mistranscoded image. */
function readBlipImage(
  recType: number,
  recInstance: number,
  data: Uint8Array<ArrayBuffer>,
): BlipImage | undefined {
  const format = blipFormatOf(recType);
  if (format === undefined) {
    return undefined;
  }
  const uidCount = BLIP_UID_COUNTS.get(recInstance);
  if (uidCount === undefined) {
    return undefined;
  }
  const headerSize = uidCount * RGB_UID_SIZE + BLIP_TAG_SIZE;
  if (data.length < headerSize) {
    return undefined;
  }
  const fileBytes = data.subarray(headerSize);
  return { format, base64: bytesToBase64(fileBytes) };
}

function blipFormatOf(recType: number): "png" | "jpeg" | undefined {
  if (recType === ESCHER_BLIP_PNG) {
    return "png";
  }
  if (recType === ESCHER_BLIP_JPEG_A || recType === ESCHER_BLIP_JPEG_B) {
    return "jpeg";
  }
  return undefined;
}

function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
