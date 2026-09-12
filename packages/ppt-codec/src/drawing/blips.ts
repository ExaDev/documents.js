import { PptFormatError } from "../errors";
import {
  type PptRecord,
  childRecords,
  findChild,
  readRecordAt,
} from "../record/tree";
import {
  OfficeArtBStoreContainer,
  OfficeArtBlipJPEG,
  OfficeArtBlipPNG,
  OfficeArtDggContainer,
  OfficeArtFBSE,
  OfficeArtFDGGBlock,
  RT_DrawingGroup,
} from "../record/types";
import {
  concatBytes,
  u16le,
  u32le,
  u8,
  writeAtom,
  writeContainer,
} from "../record/write";

// The blip store: where a .ppt keeps the images its slides display. Pictures do not live on the slide at all -- a picture shape's pib property names a one-based index into the document-wide OfficeArtBStoreContainer the DocumentContainer's own DrawingGroupContainer carries, and each entry there (an OfficeArtFBSE) either embeds the blip record inline or points into a separate "Pictures" stream by byte offset. Reading a picture therefore needs this store walked before any slide is. [MS-PPT] 2.4.3 DrawingGroupContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/1daf91b1-3531-4e55-ba6a-2e271de975c0 [MS-PPT] 2.1.3 Pictures Stream: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/150a72bc-487f-467e-994e-01270dfaf9bf OfficeArtDggContainer 2.2.12: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/dd7133b6-ed10-4bcb-be29-67b0544f884f OfficeArtBStoreContainer 2.2.20: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/561cb6d4-d38b-4666-b2b4-10abc1dce44c OfficeArtFBSE 2.2.32: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/2f2d7f5e-d5c4-4cb7-b230-59b3fe8f10d6 OfficeArtBlip 2.2.23: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/c67b883b-8136-4e91-a1a3-2981d16e934f

// MSOBLIPTYPE (2.4.1), the enumeration an FBSE's recInstance and btWin32/btMacOS fields all speak. Only the two raster formats document-schema.js's ContentImageBlock can hold losslessly are named -- every other kind an FBSE may carry (a WMF/EMF/PICT metafile, a raw DIB, a TIFF) has no ContentImageBlock format token at all, and reads as no blip rather than as a mis-decoded payload. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/84e15233-f5a0-4c9f-bb31-b31bf8795e15
const MSOBLIP_JPEG = 0x05;
const MSOBLIP_PNG = 0x06;

// The OfficeArtBlip record types for the two formats this package decodes, each mapped to the ContentImageBlock format token the bytes genuinely are. OfficeArtBlipJPEG 2.2.27: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/704b3ec5-3e3f-425f-b2f7-a090cc68e624 OfficeArtBlipPNG 2.2.28: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/7af7d17e-6ae1-4c43-a3d6-691e6b3b4a45
export interface PptBlip {
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array<ArrayBuffer>;
}

// The ContentImageBlock formats that have both an MSOBLIPTYPE token and a blip record this package reads and writes -- PNG (0x06) and JPEG (0x05), the two document-schema.js holds losslessly. Stated once here, where the MSOBLIPTYPE vocabulary lives, so the writer's blip-store collector and its per-shape block planner agree by construction rather than by two hand-kept copies of the same list. A type guard rather than a plain boolean so a caller holding the schema's wider image-format union narrows to exactly the two a PptBlip can carry.
export function isBlipFormat(format: string): format is "png" | "jpeg" {
  return format === "png" || format === "jpeg";
}

// An OfficeArtBlip record's payload: rgbUid1, optionally rgbUid2, a one-byte tag, then the file's own bytes. How many 16-byte MD4 digests precede the tag is stated by the record header's own recInstance -- one for PNG's 0x6E0 and JPEG's 0x46A/0x6E2 spellings, two for the odd-numbered siblings (0x6E1, 0x46B, 0x6E3) -- and the parity of the instance value is exactly that distinction in every case the specifications enumerate, so the count is derived from it rather than restated per format. The digests themselves are de-duplication keys this reader never verifies.
function blipPayload(record: PptRecord): PptBlip | undefined {
  const format =
    record.header.recType === OfficeArtBlipPNG
      ? "png"
      : record.header.recType === OfficeArtBlipJPEG
        ? "jpeg"
        : undefined;
  if (format === undefined) {
    return undefined;
  }
  const uidCount = (record.header.recInstance & 1) + 1;
  const dataStart = uidCount * 16 + 1;
  if (record.data.length < dataStart) {
    throw new PptFormatError(
      `a blip record of type 0x${record.header.recType.toString(16)} declares ${record.header.recInstance.toString(16)} as its instance (so ${uidCount} digest(s)) but carries only ${record.data.length} bytes`,
    );
  }
  return { format, bytes: record.data.subarray(dataStart) };
}

// The fixed head an FBSE carries ahead of its optional name and embedded blip: btWin32, btMacOS, rgbUid (16), tag (2), size (4), cRef (4), foDelay (4), then three unused bytes and cbName -- 36 bytes in total, every one of them positioned by adding the specification's own declared sizes.
const FBSE_FIXED_SIZE = 1 + 1 + 16 + 2 + 4 + 4 + 4 + 1 + 1 + 1 + 1;
// foDelay's "the file is not in the delay stream" sentinel.
const FO_DELAY_NONE = 0xffffffff;

// One OfficeArtBStoreContainerFileBlock: an FBSE atom whose data ends in the blip it embeds, an FBSE pointing at the Pictures stream, or (a spelling no producer this package has been checked against uses, but the container permits) a bare blip record. cRef 0 marks an empty slot in the store -- a deleted picture's reusable position -- and contributes no blip to the index sequence, since pib references are positional over rgfb as a whole.
function readStoreEntry(
  entry: PptRecord,
  picturesStream: Uint8Array<ArrayBuffer> | undefined,
): PptBlip | undefined {
  if (entry.header.recType !== OfficeArtFBSE) {
    return blipPayload(entry);
  }
  const view = new DataView(
    entry.data.buffer,
    entry.data.byteOffset,
    entry.data.byteLength,
  );
  const cRef = view.getUint32(24, true);
  const foDelay = view.getUint32(28, true);
  const cbName = view.getUint8(35);
  const embeddedAt = entry.dataOffset + FBSE_FIXED_SIZE + cbName;
  // An FBSE whose data runs past its name carries the blip record inline; the spec's own recLen rule ("the size of nameData plus size plus 36 if the BLIP is embedded in this record") makes the embedded blip run exactly to the end of the atom.
  const hasEmbedded = embeddedAt < entry.dataOffset + entry.header.recLen;
  if (hasEmbedded) {
    return blipPayload(readRecordAt(entry.stream, embeddedAt));
  }
  if (cRef === 0 || foDelay === FO_DELAY_NONE) {
    return undefined;
  }
  if (picturesStream === undefined) {
    // A delay-stream blip with no Pictures stream supplied: genuinely undecodable here, not malformed -- the caller (readPptContent) supplies the stream only when the compound file carries one.
    return undefined;
  }
  return blipPayload(readRecordAt(picturesStream, foDelay));
}

// The whole document's blip store, indexed the way pib references it: element 0 of the result is store entry 1. Only drawing-group children are walked -- a blip store nowhere else in the format exists, and an absent DrawingGroupContainer or BStoreContainer (a picture-free deck) reads as an empty store rather than an error.
export function readBlipStore(
  documentContainer: PptRecord,
  picturesStream: Uint8Array<ArrayBuffer> | undefined,
): readonly PptBlip[] {
  const drawingGroup = findChild(
    childRecords(documentContainer),
    RT_DrawingGroup,
  );
  if (drawingGroup === undefined) {
    return [];
  }
  const dgg = findChild(childRecords(drawingGroup), OfficeArtDggContainer);
  if (dgg === undefined) {
    return [];
  }
  const bStore = findChild(childRecords(dgg), OfficeArtBStoreContainer);
  if (bStore === undefined) {
    return [];
  }
  const blips: PptBlip[] = [];
  for (const entry of childRecords(bStore)) {
    const blip = readStoreEntry(entry, picturesStream);
    if (blip !== undefined) {
      blips.push(blip);
    }
  }
  return blips;
}

// The one blip a pib reference resolves to, or undefined when it names no decodable entry -- the same "unresolvable picture keeps the shape with empty content" convention ooxml.js's pptx reader applies to a missing relationship. A pib of 0 is the format's own "ignored" value.
export function blipForPib(
  blips: readonly PptBlip[],
  pib: number,
): PptBlip | undefined {
  // A pib of 0 -- the format's own "ignored" value -- and any other non-positive pib both resolve to undefined without a separate guard: a negative array index is not a thing JavaScript indexing supports, so blips[pib - 1] already reads as undefined for pib <= 0 exactly as it would for a genuinely out-of-range positive one.
  return blips[pib - 1];
}

// The rgbUid digests are MD4 ([RFC1320]) of the pixel data -- de-duplication keys a producer matches on. This package has no MD4 implementation and no consumer of its output needs one (this reader never verifies a digest), so the FBSEs and blips this writer emits carry zero digests: a well-formed value by shape, an honest non-computation by content.
const ZERO_DIGEST = new Uint8Array(16);

// The tag field's "external file" value, which every producer this package has been checked against writes.
const TAG_EXTERNAL = 0xff;

// One OfficeArtBlip record wrapping a picture's own file bytes verbatim, in the single-digest spelling of each format (PNG 0x6E0, JPEG 0x46A -- the RGB, one-UID instances each format's own specification page enumerates).
function writeBlipRecord(blip: PptBlip): Uint8Array<ArrayBuffer> {
  const recType = blip.format === "png" ? OfficeArtBlipPNG : OfficeArtBlipJPEG;
  const recInstance = blip.format === "png" ? 0x6e0 : 0x46a;
  return writeAtom(
    recType,
    concatBytes(ZERO_DIGEST, u8(TAG_EXTERNAL), blip.bytes),
    { recInstance },
  );
}

// One FBSE atom: the 36-byte head with the blip embedded inline after an empty name. cRef is written as 1 (this store's entries are each referenced by exactly the picture this writer emitted them for), foDelay as 0 -- meaningless for an embedded blip, whose presence is itself the disambiguator, but 0 rather than the 0xFFFFFFFF sentinel because the spec ties that value to "not in the delay stream AND cRef 0", an empty slot's signature rather than an embedded one's.
function writeFbse(blip: PptBlip): Uint8Array<ArrayBuffer> {
  const embedded = writeBlipRecord(blip);
  const blipType = blip.format === "png" ? MSOBLIP_PNG : MSOBLIP_JPEG;
  return writeAtom(
    OfficeArtFBSE,
    concatBytes(
      u8(blipType), // btWin32
      u8(blipType), // btMacOS
      ZERO_DIGEST, // rgbUid
      u16le(TAG_EXTERNAL), // tag
      u32le(embedded.length), // size
      u32le(1), // cRef
      u32le(0), // foDelay -- embedded blip, no delay-stream offset
      u8(0), // unused1
      u8(0), // cbName -- no nameData
      u8(0), // unused2
      u8(0), // unused3
      embedded,
    ),
    { recVer: 0x2, recInstance: blipType },
  );
}

// The OfficeArtFDGGBlock an OfficeArtDggContainer must open with: document-wide shape counts, then one identifier cluster. The counts are derived from what this writer actually emitted rather than stated as constants -- spidMax and cspSaved from the shapes themselves, cdgSaved from the number of DrawingContainers written (one master, one per slide, one per notes slide), and a single cluster (cidcl 2's own arithmetic: one fewer rgidcl entry than cidcl says) owning every shape id this writer minted, which is legal because they all belong to the one drawing identifier this cluster declares. OfficeArtFDGG 2.2.47: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/ed508e0c-9ab1-4539-8c3c-3086d62f7a62 OfficeArtIDCL 2.2.46: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/2335d2f8-109b-4cd6-ac8d-40b1237283f3
export function writeDrawingGroupContainer(
  blips: readonly PptBlip[],
  counts: {
    readonly spidMax: number;
    readonly shapeCount: number;
    readonly drawingCount: number;
  },
): Uint8Array<ArrayBuffer> {
  const fdgg = concatBytes(
    u32le(counts.spidMax),
    u32le(2), // cidcl -- the one rgidcl entry below plus the array's own off-by-one
    u32le(counts.shapeCount),
    u32le(counts.drawingCount),
  );
  const idcl = concatBytes(u32le(1), u32le(counts.spidMax));
  const dggChildren = [writeAtom(OfficeArtFDGGBlock, concatBytes(fdgg, idcl))];
  if (blips.length > 0) {
    dggChildren.push(
      writeContainer(OfficeArtBStoreContainer, blips.map(writeFbse), {
        recInstance: blips.length,
      }),
    );
  }
  return writeContainer(RT_DrawingGroup, [
    writeContainer(OfficeArtDggContainer, dggChildren),
  ]);
}
