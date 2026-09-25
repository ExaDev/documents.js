import {
  OfficeArtBStoreContainer,
  OfficeArtDggContainer,
  OfficeArtFBSE,
  OfficeArtFOPT,
  OfficeArtSpContainer,
  RT_DrawingGroup,
} from "../record/types";
import {
  concatBytes,
  u16le,
  u32le,
  u8,
  writeAtom as atom,
  writeContainer as container,
} from "../record/write";
import { PROPERTY_PIB, writeShapePropertyTable } from "../drawing/properties";
import { clientAnchor, fsp } from "./presentation-atoms";

// The document-wide picture plumbing syntheticPresentation composes: an OfficeArtBlip's own file bytes, the FBSE that embeds or delay-references one, the DrawingGroupContainer's own blip store, and the picture shape whose property table names it by pib.

// The RGB, one-UID recInstance each format's own OfficeArtBlip specification page enumerates, and each format's own MSOBLIPTYPE ([MS-ODRAW] 2.4.1).
const PNG_BLIP_REC_TYPE = 0xf01e;
const JPEG_BLIP_REC_TYPE = 0xf01d;
const PNG_BLIP_SINGLE_UID_INSTANCE = 0x6e0;
const JPEG_BLIP_SINGLE_UID_INSTANCE = 0x46a;
const PNG_BLIP_TYPE = 0x06;
const JPEG_BLIP_TYPE = 0x05;
// An MD4 digest ([RFC1320]) is 16 bytes, whether it is an OfficeArtBlip's own rgbUid or an FBSE's own rgbUid.
const MD4_DIGEST_BYTES = 16;
// The tag field's "external file" value, which every producer this package has been checked against writes.
const BLIP_TAG = 0xff;

// One OfficeArtBlip record wrapping an image's file bytes, in the single-uid spelling of each format (PNG 0x6E0, JPEG 0x46A).
export function blipRecord(options: {
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array<ArrayBuffer>;
}): Uint8Array<ArrayBuffer> {
  const recType =
    options.format === "png" ? PNG_BLIP_REC_TYPE : JPEG_BLIP_REC_TYPE;
  const recInstance =
    options.format === "png"
      ? PNG_BLIP_SINGLE_UID_INSTANCE
      : JPEG_BLIP_SINGLE_UID_INSTANCE;
  return atom(
    recType,
    concatBytes(new Uint8Array(MD4_DIGEST_BYTES), u8(BLIP_TAG), options.bytes),
    { recInstance },
  );
}

// One OfficeArtFBSE whose blip is embedded inline (foDelay 0, the payload after an empty name).
export function embeddedFbse(options: {
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array<ArrayBuffer>;
}): Uint8Array<ArrayBuffer> {
  const blipType = options.format === "png" ? PNG_BLIP_TYPE : JPEG_BLIP_TYPE;
  const embedded = blipRecord(options);
  return atom(
    OfficeArtFBSE,
    concatBytes(
      u8(blipType),
      u8(blipType),
      new Uint8Array(MD4_DIGEST_BYTES), // rgbUid — a zero digest; this fixture never verifies one
      u16le(BLIP_TAG), // tag
      u32le(embedded.length), // size
      u32le(1), // cRef
      u32le(0), // foDelay — embedded
      u8(0),
      u8(0), // cbName — no nameData
      u8(0),
      u8(0),
      embedded,
    ),
    { recVer: 0x2, recInstance: blipType },
  );
}

// One FBSE pointing at a Pictures stream offset instead of embedding (foDelay names the offset; cRef 1).
export function delayFbse(options: {
  readonly format: "png" | "jpeg";
  readonly foDelay: number;
}): Uint8Array<ArrayBuffer> {
  const blipType = options.format === "png" ? PNG_BLIP_TYPE : JPEG_BLIP_TYPE;
  return atom(
    OfficeArtFBSE,
    concatBytes(
      u8(blipType),
      u8(blipType),
      new Uint8Array(MD4_DIGEST_BYTES),
      u16le(BLIP_TAG),
      u32le(0), // size — unknown to this fixture, and unread on the delay path
      u32le(1),
      u32le(options.foDelay),
      u8(0),
      u8(0),
      u8(0),
      u8(0),
    ),
    { recVer: 0x2, recInstance: blipType },
  );
}

// OfficeArtFDGGBlock's own record type, and this fixture's own fixed spidMax/cspSaved counts: this function's only caller (below) never passes more than one FBSE, so the same two shape-id counts that are true for exactly one picture are stated directly rather than derived from fbseRecords.length.
const OFFICE_ART_FDGG_BLOCK_REC_TYPE = 0xf006;
const FDGG_SPID_MAX = 6;
const FDGG_CSP_SAVED = 5;

// The DocumentContainer's own DrawingGroupContainer: a real OfficeArtDggContainer whose mandatory OfficeArtFDGGBlock states document-wide counts, with the blip store after it.
export function drawingGroupContainer(
  fbseRecords: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
  const fdggBlock = atom(
    OFFICE_ART_FDGG_BLOCK_REC_TYPE,
    concatBytes(
      u32le(FDGG_SPID_MAX), // spidMax
      u32le(2), // cidcl
      u32le(FDGG_CSP_SAVED), // cspSaved
      u32le(2), // cdgSaved
      u32le(1), // one IDCL: dgid
      u32le(FDGG_SPID_MAX), // cspidCur
    ),
  );
  // This function's only caller (below) never passes an empty array — a picture is always exactly one FBSE — so an empty-store guard here would be dead code with no test that could ever reach its branch; a genuinely empty OfficeArtBStoreContainer (recInstance 0) is itself spec-conformant should a future caller ever pass one.
  return container(RT_DrawingGroup, [
    container(OfficeArtDggContainer, [
      fdggBlock,
      container(OfficeArtBStoreContainer, fbseRecords, {
        recInstance: fbseRecords.length,
      }),
    ]),
  ]);
}

// A picture shape: an ordinary OfficeArtSpContainer whose property table states pib, the one-based index into the document's blip store.
export function pictureShape(
  spid: number,
  pib: number,
  top: number,
  left: number,
  right: number,
  bottom: number,
): Uint8Array<ArrayBuffer> {
  return container(OfficeArtSpContainer, [
    fsp(spid, 0),
    writeShapePropertyTable(OfficeArtFOPT, [
      { opid: PROPERTY_PIB, op: pib, fBid: true },
    ]),
    clientAnchor(top, left, right, bottom),
  ]);
}
