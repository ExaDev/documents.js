import type { ContentImageBlock } from "document-schema.js";
import { bytesToBase64 } from "./base64";
import {
  readInt16LE,
  readUint16LE,
  readUint32LE,
  readUint8,
  slice,
} from "./bytes";

// Inline pictures, [MS-DOC] "Pictures": a picture character (U+0001, sprmCFSpec applied) names its own data through sprmCPicLocation, a signed 32-bit offset into the Data stream where a PICFAndOfficeArtData structure lives -- a PICF (68 bytes: type/size/border information) followed, for every producer this reader has seen, by a real OfficeArtInlineSpContainer ([MS-ODRAW] 2.2.15) regardless of PICF.mfpf.mm's own value, since [MS-DOC] states the `picture` field itself as that container's type. There is no simpler, non-OfficeArt path even for the plainest bitmap.
//
// This reads exactly as much of that container as the common case needs: OfficeArtInlineSpContainer.shape (an OfficeArtSpContainer, [MS-ODRAW] 2.2.14) is skipped whole by its own record header's recLen, and the first entry of `rgfb` immediately after it -- an OfficeArtBStoreContainerFileBlock, in practice a single OfficeArtBlip record for one inline picture with no separate blip-store indirection -- is read directly. Only the two raster formats document-schema.js's ContentImageBlock can hold losslessly (OfficeArtBlipJPEG 0xF01D, OfficeArtBlipPNG 0xF01E) are decoded; every other blip kind (WMF/EMF/PICT metafiles, a raw DIB with no format this schema names, TIFF) is a genuinely different structure -- a metafile blip carries a further OfficeArtMetafileHeader and, for WMF/EMF, DEFLATE-compressed payload bytes; a DIB has no ContentImageBlock format token to hold it under at all without re-encoding pixels this package has no image codec to perform -- so those return undefined here rather than being mis-decoded, the identical "genuinely unimplemented, not approximated" convention the rest of this package's own scope table already follows for floating drawn objects (PlcfSpa/OfficeArt shapes generally) and text boxes, which this module does not attempt at all.

const PICF_SIZE = 68;
const PICF_MM_OFFSET = 6;
const PICF_DXA_GOAL_OFFSET = 28;
const PICF_DYA_GOAL_OFFSET = 30;
const PICF_MX_OFFSET = 32;
const PICF_MY_OFFSET = 34;
/** MFPF.mm's MM_SHAPEFILE value, [MS-DOC] 2.9.181 -- the one case PICFAndOfficeArtData carries an extra cchPicName/stPicName pair (the picture's own source file name) before `picture` begins. */
const MM_SHAPEFILE = 0x0066;

const RECORD_HEADER_SIZE = 8;
/** OfficeArtBlipJPEG, [MS-ODRAW] 2.2.27. */
const BLIP_JPEG = 0xf01d;
/** OfficeArtBlipPNG, [MS-ODRAW] 2.2.28. */
const BLIP_PNG = 0xf01e;
/** rh.recInstance values naming a single rgbUid (16 bytes) rather than two (32 bytes) -- [MS-ODRAW] 2.2.27's own table for JPEG (RGB and CMYK) and 2.2.28's for PNG. */
const ONE_UID_INSTANCES = new Set([0x046a, 0x06e2, 0x06e0]);
const TWO_UID_INSTANCES = new Set([0x046b, 0x06e3, 0x06e1]);
/** The one byte following rgbUid(1|2) in every OfficeArtBlip variant this module reads, before the raw file bytes themselves. */
const BLIP_TAG_SIZE = 1;

const TWIPS_PER_POINT = 20;
/** mx/my, [MS-DOC] PICMID: "the ratio, measured in tenths of a percent, between the final display width/height and the initial picture width/height". */
const SCALE_DENOMINATOR = 1000;

interface RecordHeader {
  readonly recInstance: number;
  readonly recType: number;
  readonly recLen: number;
}

function readRecordHeader(data: Uint8Array, offset: number): RecordHeader {
  const versionAndInstance = readUint16LE(data, offset);
  return {
    recInstance: (versionAndInstance >> 4) & 0x0fff,
    recType: readUint16LE(data, offset + 2),
    recLen: readUint32LE(data, offset + 4),
  };
}

/** Resolves one inline picture character's own sprmCPicLocation offset into a ContentImageBlock, or undefined when the picture's own blip is a format this package does not decode (see this module's own top comment) -- never thrown, since an unsupported picture format is exactly the kind of absence the rest of this reader already treats as "read with fewer properties than it states" rather than a document-level failure. */
export function readInlinePicture(
  dataStream: Uint8Array,
  picLocation: number,
): ContentImageBlock | undefined {
  const picf = slice(
    dataStream,
    picLocation,
    PICF_SIZE,
    "PICF in the Data stream",
  );
  const mm = readUint16LE(picf, PICF_MM_OFFSET);
  const dxaGoal = readInt16LE(picf, PICF_DXA_GOAL_OFFSET);
  const dyaGoal = readInt16LE(picf, PICF_DYA_GOAL_OFFSET);
  const mx = readUint16LE(picf, PICF_MX_OFFSET);
  const my = readUint16LE(picf, PICF_MY_OFFSET);

  let cursor = picLocation + PICF_SIZE;
  if (mm === MM_SHAPEFILE) {
    const cchPicName = readUint8(dataStream, cursor);
    cursor += 1 + cchPicName;
  }

  // OfficeArtInlineSpContainer.shape: an OfficeArtSpContainer, skipped whole by its own record header's recLen -- this reader has no need to look inside it (the shape's own fill/line/position properties, not the picture's own bytes).
  const shapeHeader = readRecordHeader(dataStream, cursor);
  cursor += RECORD_HEADER_SIZE + shapeHeader.recLen;

  const blipHeader = readRecordHeader(dataStream, cursor);
  const format = blipFormat(blipHeader.recType);
  if (format === undefined) return undefined;

  const uidBytes = ONE_UID_INSTANCES.has(blipHeader.recInstance)
    ? 16
    : TWO_UID_INSTANCES.has(blipHeader.recInstance)
      ? 32
      : undefined;
  if (uidBytes === undefined) return undefined;

  const blipDataStart = cursor + RECORD_HEADER_SIZE + uidBytes + BLIP_TAG_SIZE;
  const blipDataLength = blipHeader.recLen - uidBytes - BLIP_TAG_SIZE;
  const blipBytes = slice(
    dataStream,
    blipDataStart,
    blipDataLength,
    "OfficeArtBlip file data in the Data stream",
  );

  return {
    kind: "image",
    format,
    base64: bytesToBase64(blipBytes),
    widthPt: (dxaGoal * mx) / SCALE_DENOMINATOR / TWIPS_PER_POINT,
    heightPt: (dyaGoal * my) / SCALE_DENOMINATOR / TWIPS_PER_POINT,
  };
}

function blipFormat(recType: number): "jpeg" | "png" | undefined {
  switch (recType) {
    case BLIP_JPEG:
      return "jpeg";
    case BLIP_PNG:
      return "png";
    default:
      return undefined;
  }
}
