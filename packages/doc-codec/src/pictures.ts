import type { ContentImageBlock } from "document-schema.js";
import { bytesToBase64 } from "./base64";
import {
  readInt16LE,
  readUint16LE,
  readUint32LE,
  readUint8,
  slice,
} from "./bytes";

// Inline pictures, [MS-DOC] "Pictures": a picture character (U+0001, sprmCFSpec applied) names its own data through sprmCPicLocation, a signed 32-bit offset into the Data stream where a PICFAndOfficeArtData structure lives -- a PICF (68 bytes: type/size/border information) followed by the picture's OfficeArt container chain. Word wraps the blip in an OfficeArtInlineSpContainer ([MS-ODRAW] 2.2.15); LibreOffice (verified against a real LibreOffice-produced corpus file) wraps it in a SpgrContainer with a property table and no InlineSp wrapper at all -- so the reader walks container headers forward from PICF's end until the blip's own record type appears, tolerating either producer's wrapper shape without looking inside any of them. There is no simpler, non-OfficeArt path even for the plainest bitmap.
//
// This reads exactly as much of that chain as the common case needs: the validated blip record the locator lands on is read directly -- in practice a single OfficeArtBlip record for one inline picture with no separate blip-store indirection -- and every wrapper container before it is skipped without being parsed at all. Only the two raster formats document-schema.js's ContentImageBlock can hold losslessly (OfficeArtBlipJPEG 0xF01D, OfficeArtBlipPNG 0xF01E) are decoded; every other blip kind (WMF/EMF/PICT metafiles, a raw DIB with no format this schema names, TIFF) is a genuinely different structure -- a metafile blip carries a further OfficeArtMetafileHeader and, for WMF/EMF, DEFLATE-compressed payload bytes; a DIB has no ContentImageBlock format token to hold it under at all without re-encoding pixels this package has no image codec to perform -- so those return undefined here rather than being mis-decoded, the identical "genuinely unimplemented, not approximated" convention the rest of this package's own scope table already follows for floating drawn objects (PlcfSpa/OfficeArt shapes generally) and text boxes, which this module does not attempt at all.

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
/** rh.recInstance values naming a single rgbUid rather than two -- [MS-ODRAW] 2.2.27's own table for JPEG (RGB and CMYK) and 2.2.28's for PNG. */
const ONE_UID_INSTANCES = new Set([0x046a, 0x06e2, 0x06e0]);
const TWO_UID_INSTANCES = new Set([0x046b, 0x06e3, 0x06e1]);
const ONE_UID_BYTES = 16;
const TWO_UID_BYTES = 32;
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

/** The one byte past PICF's own fixed 68 bytes, skipping past MFPF.mm's MM_SHAPEFILE-only cchPicName/stPicName pair (the source file's own name, [MS-DOC] 2.9.181) when present. Exported so its own contract -- how far past PICF the OfficeArt container chain actually begins -- is directly testable: findBlipRecord's own forward scan for a validated blip is robust enough to find the real blip even starting from the wrong offset (scanning straight through a skipped filename's bytes finds nothing signature-shaped there and simply continues), which means asserting only on readInlinePicture's own final result can never tell a correct skip from a wrong one apart. */
export function skipPicName(
  dataStream: Uint8Array,
  mm: number,
  afterPicf: number,
): number {
  if (mm !== MM_SHAPEFILE) return afterPicf;
  const cchPicName = readUint8(dataStream, afterPicf);
  return afterPicf + 1 + cchPicName;
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

  const cursor = skipPicName(dataStream, mm, picLocation + PICF_SIZE);

  // Locating the blip: the containers between PICF and the blip are wrapper shapes this reader has no need to look inside, and producers disagree on the nesting -- Word writes InlineSpContainer > SpContainer > blip, while LibreOffice (confirmed against a real LibreOffice-produced .doc corpus file, 2026-09-10) emits a chain whose container lengths do not walk to the blip (its property-table record's recLen spans past the blip entirely), so header-walking mis-parses it. The robust spelling-independent locator: scan forward from PICF's end for a record header whose type is a known blip, whose instance names a known rgbUid count, whose length stays inside the Data stream, and whose payload actually begins with that format's own file signature -- a validated blip, not merely a well-formed header. The signature check is what makes a false positive on wrapper bytes effectively impossible: no container prefix preceding a real blip starts with a PNG or JPEG signature at exactly the uid-and-tag-derived offset.
  const found = findBlipRecord(dataStream, cursor);
  if (found === undefined) {
    return undefined;
  }
  const { header: blipHeader, offset: blipOffset } = found;
  const format = blipFormat(blipHeader.recType);
  if (format === undefined) return undefined;

  const uidBytes = ONE_UID_INSTANCES.has(blipHeader.recInstance)
    ? ONE_UID_BYTES
    : TWO_UID_INSTANCES.has(blipHeader.recInstance)
      ? TWO_UID_BYTES
      : undefined;
  if (uidBytes === undefined) return undefined;

  const blipDataStart =
    blipOffset + RECORD_HEADER_SIZE + uidBytes + BLIP_TAG_SIZE;
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

// The PNG and JPEG file signatures, the one-byte-prefix form OfficeArtBlip carries them under (rgbUid, then the one-byte tag, then raw file bytes).
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8];

function payloadHasSignature(
  data: Uint8Array,
  start: number,
  signature: readonly number[],
): boolean {
  for (const [i, byte] of signature.entries()) {
    if (data[start + i] !== byte) {
      return false;
    }
  }
  return true;
}

/** A record header at a known offset, the validated-blip scan's answer. */
interface FoundBlip {
  readonly header: RecordHeader;
  readonly offset: number;
}

/** The least a real find can ever need past a record header: the smaller rgbUid (ONE_UID_BYTES) + the tag byte + the shorter of the two file signatures this reader validates (JPEG's, 2 bytes). A candidate header that does not even leave this much room behind it can never validate, so the scan below never bothers reading one. */
const MIN_BLIP_TAIL_BYTES =
  ONE_UID_BYTES +
  BLIP_TAG_SIZE +
  Math.min(PNG_SIGNATURE.length, JPEG_SIGNATURE.length);

/** Scans forward from `from` for a validated blip record (see readInlinePicture's own locating note) -- every candidate header of a blip type must also carry a known rgbUid instance count, a length inside the stream, and payload bytes starting with its format's own file signature. */
function findBlipRecord(data: Uint8Array, from: number): FoundBlip | undefined {
  for (
    let at = from;
    at + RECORD_HEADER_SIZE + MIN_BLIP_TAIL_BYTES <= data.length;
    at++
  ) {
    const header = readRecordHeader(data, at);
    const format = blipFormat(header.recType);
    if (format === undefined) {
      continue;
    }
    const uidBytes = ONE_UID_INSTANCES.has(header.recInstance)
      ? ONE_UID_BYTES
      : TWO_UID_INSTANCES.has(header.recInstance)
        ? TWO_UID_BYTES
        : undefined;
    if (uidBytes === undefined) {
      continue;
    }
    const payloadStart = at + RECORD_HEADER_SIZE + uidBytes + BLIP_TAG_SIZE;
    const signature = format === "png" ? PNG_SIGNATURE : JPEG_SIGNATURE;
    // No separate payloadStart + signature.length <= data.length bounds check is needed: payloadHasSignature indexes past data's own end via a plain data[start + i] read, which is undefined for any out-of-range i, and undefined !== a real signature byte is already false -- so a signature that runs off the end of data is already rejected by payloadHasSignature itself, on its own.
    if (
      header.recLen > uidBytes + BLIP_TAG_SIZE &&
      payloadHasSignature(data, payloadStart, signature)
    ) {
      return { header, offset: at };
    }
  }
  return undefined;
}
