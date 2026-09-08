import type { ContentImageBlock } from "document-schema.js";
import { base64ToBytes } from "./base64";
import { DocFormatError, DocUnsupportedError } from "./errors";

// The inverse of pictures.ts's readInlinePicture: a ContentImageBlock to the PICFAndOfficeArtData bytes a real MS-DOC producer places in the Data stream, plus the sprmCPicLocation grpprl a run's own Chpx states to point at them -- an empty OfficeArtSpContainer.shape (pictures.ts's own reader skips it whole by recLen and never looks inside it, so this writer states no shape properties of its own either) followed by a single-rgbUid OfficeArtBlip record wrapping the image's own raw file bytes verbatim. Only the two raster formats pictures.ts itself decodes from a real OfficeArtBlip -- PNG (OfficeArtBlipPNG, 0xF01E) and JPEG (OfficeArtBlipJPEG, 0xF01D) -- can be written this way; ContentImageBlock's own 'svg'/'gif' members have no OfficeArtBlip type this format defines at all, so writing one would mean fabricating a bitmap tag this reader could not itself decode back, the identical "genuinely unimplemented, not approximated" boundary pictures.ts's own top comment already draws for every blip kind beyond PNG/JPEG.

const PICF_SIZE = 68;
const PICF_MM_OFFSET = 6;
const PICF_DXA_GOAL_OFFSET = 28;
const PICF_DYA_GOAL_OFFSET = 30;
const PICF_MX_OFFSET = 32;
const PICF_MY_OFFSET = 34;
/** MFPF.mm's MM_SHAPE value, [MS-DOC] 2.9.181 -- the plain, no-source-filename form; this writer never emits MM_SHAPEFILE's own cchPicName/stPicName pair, matching what pictures.ts's own reader treats as the common case. */
const MM_SHAPE = 0x0064;

const RECORD_HEADER_SIZE = 8;
/** OfficeArtBlipJPEG / OfficeArtBlipPNG record types, [MS-ODRAW] 2.2.27/2.2.28. */
const BLIP_JPEG = 0xf01d;
const BLIP_PNG = 0xf01e;
/** rh.recInstance for the single-rgbUid (16-byte) form of each blip -- [MS-ODRAW] 2.2.27's own table for JPEG (RGB), 2.2.28's for PNG; the identical values pictures.ts's own ONE_UID_INSTANCES set already recognises on read. */
const BLIP_INSTANCE_JPEG = 0x046a;
const BLIP_INSTANCE_PNG = 0x06e0;
const BLIP_UID_SIZE = 16;
/** The one byte following rgbUid in every OfficeArtBlip variant pictures.ts reads -- [MS-ODRAW]'s own BLIPFileTag, 0xFF for a non-metafile blip (PNG/JPEG are never compressed the way a WMF/EMF metafile blip's own tag byte would state). */
const BLIP_FILE_TAG = 0xff;
const BLIP_TAG_SIZE = 1;

const TWIPS_PER_POINT = 20;
/** PICMID.mx/my, [MS-DOC]: "the ratio, measured in tenths of a percent, between the final display width/height and the initial picture width/height" -- this writer always states dxaGoal/dyaGoal as the image's own real size and mx/my as "no scaling" (1000, one thousand tenths-of-a-percent = 100%), matching pictures.ts's own read-side arithmetic (dxaGoal * mx / 1000) exactly at mx = 1000. */
const NO_SCALING = 1000;
/** PICMID.dxaGoal/dyaGoal are a signed 16-bit FieldFormatting value in twips -- [MS-DOC] states no narrower bound than that field width itself. */
const MAX_INT16 = 0x7fff;

function recordHeaderBytes(
  recType: number,
  recInstance: number,
  recLen: number,
): Uint8Array {
  const bytes = new Uint8Array(RECORD_HEADER_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, recInstance << 4, true); // recVer 0 (every OfficeArt record this writer emits is a non-container leaf).
  view.setUint16(2, recType, true);
  view.setUint32(4, recLen, true);
  return bytes;
}

function twipsFromPt(pt: number, field: string): number {
  const twips = Math.round(pt * TWIPS_PER_POINT);
  if (twips < 0 || twips > MAX_INT16) {
    throw new DocFormatError(
      `an image's ${field} of ${String(pt)}pt is ${String(twips)} twips, outside the 0..${String(MAX_INT16)} range PICMID.dxaGoal/dyaGoal (a signed 16-bit field) can hold`,
    );
  }
  return twips;
}

export interface WrittenInlinePicture {
  /** The whole PICFAndOfficeArtData byte blob to append to the Data stream at whatever offset it ends up placed. */
  readonly data: Uint8Array<ArrayBuffer>;
  /** sprmCPicLocation's own grpprl bytes, complete except for its 4-byte operand, which the caller fills in with wherever `data` was actually placed (buildPicLocationGrpprl below) -- the two are split because only the caller (write.ts's own Data-stream accumulator) knows that offset before `data` is placed. */
  readonly buildGrpprl: (dataStreamOffset: number) => number[];
}

/** Builds one inline picture's own PICFAndOfficeArtData bytes -- everything pictures.ts's readInlinePicture needs given the Data-stream offset it will end up placed at, which this function does not itself decide (see WrittenInlinePicture's own comment). */
export function buildInlinePicture(
  image: ContentImageBlock,
): WrittenInlinePicture {
  const recType =
    image.format === "png"
      ? BLIP_PNG
      : image.format === "jpeg"
        ? BLIP_JPEG
        : undefined;
  if (recType === undefined) {
    throw new DocUnsupportedError(
      `doc-codec's writer can only write a 'png' or 'jpeg' inline picture -- the two raster formats its own reader decodes from a real OfficeArtBlip; got '${image.format}'`,
    );
  }
  const recInstance =
    image.format === "png" ? BLIP_INSTANCE_PNG : BLIP_INSTANCE_JPEG;
  const payload = base64ToBytes(image.base64);

  const picf = new Uint8Array(PICF_SIZE);
  const picfView = new DataView(picf.buffer);
  picfView.setUint16(PICF_MM_OFFSET, MM_SHAPE, true);
  picfView.setInt16(
    PICF_DXA_GOAL_OFFSET,
    twipsFromPt(image.widthPt, "widthPt"),
    true,
  );
  picfView.setInt16(
    PICF_DYA_GOAL_OFFSET,
    twipsFromPt(image.heightPt, "heightPt"),
    true,
  );
  picfView.setUint16(PICF_MX_OFFSET, NO_SCALING, true);
  picfView.setUint16(PICF_MY_OFFSET, NO_SCALING, true);

  // OfficeArtInlineSpContainer.shape: an empty OfficeArtSpContainer -- pictures.ts's own reader skips it whole by this record header's own recLen and never looks inside it, so this writer states no shape properties of its own either.
  const shapeHeader = recordHeaderBytes(0xf004, 0, 0);
  const uid = new Uint8Array(BLIP_UID_SIZE);
  const blipHeader = recordHeaderBytes(
    recType,
    recInstance,
    uid.length + BLIP_TAG_SIZE + payload.length,
  );

  const data = new Uint8Array(
    picf.length +
      shapeHeader.length +
      blipHeader.length +
      uid.length +
      BLIP_TAG_SIZE +
      payload.length,
  );
  let cursor = 0;
  data.set(picf, cursor);
  cursor += picf.length;
  data.set(shapeHeader, cursor);
  cursor += shapeHeader.length;
  data.set(blipHeader, cursor);
  cursor += blipHeader.length;
  data.set(uid, cursor);
  cursor += uid.length;
  data[cursor] = BLIP_FILE_TAG;
  cursor += 1;
  data.set(payload, cursor);

  return { data, buildGrpprl: buildPicLocationGrpprl };
}

/** sprmCPicLocation, [MS-DOC] 2.6.1 -- a signed 32-bit offset into the Data stream, little-endian. */
function buildPicLocationGrpprl(dataStreamOffset: number): number[] {
  const grpprl: number[] = [0x03, 0x6a];
  const operand = new Uint8Array(4);
  new DataView(operand.buffer).setInt32(0, dataStreamOffset, true);
  grpprl.push(...operand);
  return grpprl;
}
