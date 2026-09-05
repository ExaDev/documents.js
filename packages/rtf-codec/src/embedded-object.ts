// An RTF \object's \objdata is, per the specification's own words, "the structure produced by the OLESaveToStream function" -- and OLESaveToStream's own output is [MS-OLEDS] 2.2.5 EmbeddedObject: a Header (an ObjectHeader, 2.2.4), NativeDataSize (4 bytes), NativeData (the size that field names), and a mandatory fourth field, Presentation -- "This MUST be a MetaFilePresentationObject, a BitmapPresentationObject, a DIBPresentationObject, a StandardClipboardFormatPresentationObject, or a RegisteredClipboardFormatPresentationObject." A reader that stops after NativeData is not decoding a real EmbeddedObject, only a truncated prefix of one: a genuine OLE1.0 consumer reading the whole structure keeps looking for Presentation once NativeData ends, and hits EOF instead. archive-codec ships the compound file the native data itself is (writeCompoundFile/readCompoundFile, [MS-CFB]) plus the OLE Package stream wrapper real Word/PowerPoint embeds use inside it (writeOlePackage/readOlePackage), so this module's own job is the three things archive-codec cannot supply: the ObjectHeader/NativeDataSize envelope NativeData rides inside, the JSON payload the Package stream wraps, and the Presentation field EmbeddedObject also requires -- written here as the smallest of the five legitimate shapes, a StandardClipboardFormatPresentationObject (2.2.3.2) wrapping a minimal CF_DIB image, since building any of the other four needs a full metafile/bitmap-record writer this module has no other use for.
//
// What goes INSIDE that container is the one thing this module still has to decide for itself. rtf-codec cannot depend on ooxml.js/odf.js -- format codecs are peers in this family, never one another's dependency (see the monorepo README's package-layering rule) -- so a 'wordprocessing'/'presentation'/'spreadsheet'/'drawing'/'formula' embedded object's own ContentDocument cannot be re-serialised into a real docx/pptx/xlsx/odf/MathML byte stream here the way a genuine OLE server would. What this codec CAN write and read back losslessly is its own ContentDocument (a plain, Zod-validated, JSON-serialisable value -- see document-schema.js's own JSON Schema generation), so that JSON is the "file" this module packages: it rides inside the Package stream exactly the way a real embed's actual file bytes do, that Package stream is the NativeData an EmbeddedObject structure carries, and readEmbeddedObjectData below reverses the identical path. A real Word-authored \object's OLESaveToStream data is a COM-specific structure with no JSON envelope inside its NativeData -- decoding that is out of scope, the same honest boundary a foreign/unsupported \pict format is dropped at, and readEmbeddedObjectData returns undefined for it rather than throwing.

import {
  readCompoundFile,
  readOlePackage,
  writeCompoundFile,
  writeOlePackage,
} from "archive-codec";
import {
  ContentEmbeddedObjectSchema,
  type ContentEmbeddedObject,
} from "document-schema.js";

// A fixed, ASCII-only label: archive-codec's writeOlePackage refuses a label/path outside ASCII (it carries no arbitrary-codepage encoder -- see its own doc comment), and nothing downstream branches on this string's content, so every \object this writer produces just names what it is.
const PACKAGE_LABEL = "rtf-codec-embedded-object.json";

// [MS-OLEDS] 2.2.4 ObjectHeader.FormatID: "This MUST be set to 0x00000001 or 0x00000002 ... If this field is set to 0x00000002, the ObjectHeader structure MUST be contained by an EmbeddedObject structure." This module only ever writes an EmbeddedObject (never a LinkedObject), so it only ever writes 0x00000002.
const OBJECT_HEADER_FORMAT_ID_EMBEDDED = 0x00000002;

// The LinkedObject counterpart (2.2.6) this module never writes -- but a real \object this reader encounters could carry it, and "validate FormatID is 0x00000001 or 0x00000002" (the spec's own ObjectHeader invariant) means a linked object's header must be recognised as structurally valid even though its NativeData is never this package's own JSON payload.
const OBJECT_HEADER_FORMAT_ID_LINKED = 0x00000001;

// [MS-OLEDS] 2.2.4 ObjectHeader.OLEVersion: "This can be set to any arbitrary value and MUST be ignored on receipt." 0x00000501 is the value real OLE-authored objects use; nothing downstream reads it back (readObjectHeader below discards it, matching the spec's own licence).
const OBJECT_HEADER_OLE_VERSION = 0x00000501;

// ObjectHeader.ClassName for this module's own EmbeddedObject: "Package" is the class name real Word/PowerPoint write for exactly this shape -- an OLE Package stream sitting inside the object's native data -- so a real OLE-aware consumer that cannot decode our own JSON payload still sees a recognisable, accurate class rather than an invented ProgID.
const OBJECT_HEADER_CLASS_NAME = "Package";

// The ANSI decoder for ObjectHeader's three LengthPrefixedAnsiString fields, matching archive-codec's own cfb/ole-package.ts convention for the identical kind of producer-locale ANSI string.
const ANSI_DECODER = new TextDecoder("windows-1252");

// [MS-OLEDS] 2.2.1 PresentationObjectHeader.FormatID: "This MUST be set to 0x00000000 or 0x00000005 ... 0x00000005 [means] The ClassName field is present." This module's own Presentation field always carries a ClassName (see PRESENTATION_CLASS_NAME below), so it only ever writes 0x00000005, and only ever accepts that value back -- a real presentation object with FormatID 0x00000000 exists in principle but is not a shape this module's own writer ever produces.
const PRESENTATION_OBJECT_HEADER_FORMAT_ID = 0x00000005;

// [MS-OLEDS] 2.2.3.1 ClipboardFormatHeader: "The FormatID field of the PresentationObjectHeader MUST NOT be set to 0x00000000 and the ClassName field of the Header MUST NOT be set to 'METAFILEPICT', 'DIB', or 'BITMAP'" -- those three reserved names route a presentation object through EmbeddedObject's own three type-specific structures (2.2.2.1-2.2.2.3) instead. An empty ClassName satisfies "MUST NOT be [one of those three]" trivially and needs no codepage table beyond ASCII, routing this module's own Presentation field through the generic ClipboardFormatHeader path (2.2.3) every time.
const PRESENTATION_CLASS_NAME = "";

// [MS-OLEDS] 2.1.1's own Standard Clipboard Formats table names exactly four values: CF_BITMAP (0x2), CF_METAFILEPICT (0x3), CF_DIB (0x8), CF_ENHMETAFILE (0xE) -- each naming a real image sub-structure ([MS-WMF]'s Bitmap16, a Windows metafile, a DeviceIndependentBitmap Object, or an enhanced metafile, respectively). CF_DIB's DeviceIndependentBitmap Object (2.2.2.9) is the only one of the four this module can build without a full metafile/enhanced-metafile record writer, so it is the one this module's own Presentation field always declares.
const CLIPBOARD_FORMAT_CF_DIB = 0x00000008;

// [MS-WMF] 2.2.2.3 BitmapInfoHeader's own fixed size -- the first field of the structure names it, so a reader can tell a BitmapInfoHeader (this size) from a BitmapCoreHeader (0x0000000C) without looking at anything else.
const DIB_HEADER_SIZE_BITMAPINFOHEADER = 40;

// [MS-WMF] 2.1.1.3 BitCount Enumeration's BI_BITCOUNT_1: "The image is specified with two colours... represented by a single bit." The smallest legal pixel depth a DeviceIndependentBitmap Object can declare, paired with a 2-entry RGBQuad colour table below.
const DIB_BIT_COUNT_MONOCHROME = 1;

// [MS-OLEDS] 2.1.4 LengthPrefixedAnsiString: "Length (4 bytes): This MUST be set to the number of ANSI characters in the String field, including the terminating null character. Length MUST be set to 0x00000000 to indicate an empty string." -- so an empty string is the 4-byte zero length alone, with no String field at all, not a length of 1 holding just a null byte.
function writeLengthPrefixedAnsiString(value: string): Uint8Array<ArrayBuffer> {
  if (value.length === 0) {
    return new Uint8Array(4); // already zero -- Length = 0x00000000
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code > 0x7f) {
      throw new Error(
        `ObjectHeader string contains a character (U+${code.toString(16).padStart(4, "0")}) outside ASCII; encoding it to an arbitrary windows-1252 byte would need a full codepage table this module does not carry`,
      );
    }
  }
  const length = value.length + 1; // + the terminating null character, per LengthPrefixedAnsiString's own field definition
  const out = new Uint8Array(4 + length);
  const view = new DataView(out.buffer);
  view.setUint32(0, length, true);
  for (let index = 0; index < value.length; index++) {
    out[4 + index] = value.charCodeAt(index);
  }
  // out[4 + value.length] is already zero -- the terminating null character.
  return out;
}

// The mirror of writeLengthPrefixedAnsiString. Throws on any structural shortfall (loud failure over a truncated string that looks complete), matching archive-codec's readZeroTerminated/readOlePackage precedent for the identical class of format.
function readLengthPrefixedAnsiString(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
  fieldName: string,
): { readonly value: string; readonly next: number } {
  if (offset + 4 > bytes.length) {
    throw new Error(`ObjectHeader ends before its ${fieldName} length field`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(offset, true);
  offset += 4;
  if (length === 0) {
    return { value: "", next: offset };
  }
  if (offset + length > bytes.length) {
    throw new Error(
      `ObjectHeader's ${fieldName} declares ${length} bytes but only ${bytes.length - offset} remain`,
    );
  }
  // length includes the terminating null character (LengthPrefixedAnsiString's own definition); drop it rather than decode it as a character.
  const value = ANSI_DECODER.decode(
    bytes.subarray(offset, offset + length - 1),
  );
  return { value, next: offset + length };
}

// Builds an [MS-OLEDS] 2.2.4 ObjectHeader for an EmbeddedObject: OLEVersion, FormatID (fixed at 0x00000002 -- this module never writes a LinkedObject), then ClassName/TopicName/ItemName as LengthPrefixedAnsiStrings. TopicName and ItemName are both empty: "If the ObjectHeader structure is contained by an EmbeddedObject structure ... the TopicName [ItemName] field SHOULD contain an empty string and MUST be ignored on processing" -- both are LinkedObject-only fields.
function writeObjectHeader(): Uint8Array<ArrayBuffer> {
  const classNameBytes = writeLengthPrefixedAnsiString(
    OBJECT_HEADER_CLASS_NAME,
  );
  const topicNameBytes = writeLengthPrefixedAnsiString("");
  const itemNameBytes = writeLengthPrefixedAnsiString("");
  const out = new Uint8Array(
    4 + // OLEVersion
      4 + // FormatID
      classNameBytes.length +
      topicNameBytes.length +
      itemNameBytes.length,
  );
  const view = new DataView(out.buffer);
  view.setUint32(0, OBJECT_HEADER_OLE_VERSION, true);
  view.setUint32(4, OBJECT_HEADER_FORMAT_ID_EMBEDDED, true);
  let offset = 8;
  out.set(classNameBytes, offset);
  offset += classNameBytes.length;
  out.set(topicNameBytes, offset);
  offset += topicNameBytes.length;
  out.set(itemNameBytes, offset);
  return out;
}

// The mirror of writeObjectHeader, generalised to accept either FormatID this reader may legitimately encounter (a real \object could carry a LinkedObject's header, even though this module's own writer never produces one). OLEVersion is read and discarded -- "MUST be ignored on receipt" is the spec's own instruction, not this module's choice.
function readObjectHeader(bytes: Uint8Array<ArrayBuffer>): {
  readonly formatId: number;
  readonly next: number;
} {
  if (bytes.length < 8) {
    throw new Error("ObjectHeader ends before its FormatID field");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formatId = view.getUint32(4, true);
  let offset = 8;
  const className = readLengthPrefixedAnsiString(bytes, offset, "ClassName");
  offset = className.next;
  const topicName = readLengthPrefixedAnsiString(bytes, offset, "TopicName");
  offset = topicName.next;
  const itemName = readLengthPrefixedAnsiString(bytes, offset, "ItemName");
  offset = itemName.next;
  return { formatId, next: offset };
}

// [MS-WMF] 2.2.2.3 BitmapInfoHeader (40 bytes, fixed) followed by [MS-WMF] 2.2.2.20's own 2-entry RGBQuad colour table and a packed 1-bit-per-pixel BitmapBuffer -- together the smallest legitimate [MS-WMF] DeviceIndependentBitmap Object (2.2.2.9) this module can build without a real rendering engine: a single 1x1 pixel, monochrome, uncompressed, indexing colour 0 (black) of a black/white palette. What the pixel actually shows is irrelevant -- nothing in this codec ever displays it, and a real OLE1.0 consumer that does is only using it as a placeholder preview until the object itself is activated.
function writeMinimalDib(): Uint8Array<ArrayBuffer> {
  const width = 1;
  const height = 1;
  const colorCount = 2; // BI_BITCOUNT_1's own two-colour table
  // The DIB Object's own aData size formula (MS-WMF 2.2.2.9): (((Width*Planes*BitCount+31)&~31)/8) * abs(Height).
  const rowBytes = ((width * 1 * DIB_BIT_COUNT_MONOCHROME + 31) & ~31) / 8;
  const out = new Uint8Array(
    DIB_HEADER_SIZE_BITMAPINFOHEADER +
      colorCount * 4 +
      rowBytes * Math.abs(height),
  );
  const view = new DataView(out.buffer);
  view.setUint32(0, DIB_HEADER_SIZE_BITMAPINFOHEADER, true); // HeaderSize
  view.setInt32(4, width, true); // Width
  view.setInt32(8, height, true); // Height -- positive: a bottom-up bitmap, MS-WMF's own default orientation
  view.setUint16(12, 1, true); // Planes -- "MUST be 0x0001"
  view.setUint16(14, DIB_BIT_COUNT_MONOCHROME, true); // BitCount
  view.setUint32(16, 0, true); // Compression -- BI_RGB
  view.setUint32(20, 0, true); // ImageSize -- "If the Compression value is BI_RGB, this value SHOULD be zero"
  view.setInt32(24, 0, true); // XPelsPerMeter
  view.setInt32(28, 0, true); // YPelsPerMeter
  view.setUint32(32, colorCount, true); // ColorUsed -- both entries of the 2-colour table, explicit rather than the 0x00000000-means-default spelling
  view.setUint32(36, 0, true); // ColorImportant -- "If this value is zero, all colour indexes are required"
  // Colors: two RGBQuad entries (Blue, Green, Red, Reserved -- MS-WMF 2.2.2.20), black then white. The BitmapBuffer that follows is already all-zero, so its one pixel indexes entry 0 (black).

  out.set([0x00, 0x00, 0x00, 0x00], DIB_HEADER_SIZE_BITMAPINFOHEADER); // index 0: black
  out.set([0xff, 0xff, 0xff, 0x00], DIB_HEADER_SIZE_BITMAPINFOHEADER + 4); // index 1: white
  return out;
}

// [MS-OLEDS] 2.2.1 PresentationObjectHeader: OLEVersion ("any arbitrary value ... MUST be ignored on processing" -- the same licence ObjectHeader's own OLEVersion carries, so this reuses OBJECT_HEADER_OLE_VERSION rather than inventing a second arbitrary constant), FormatID (fixed at 0x00000005, since a ClassName follows), then ClassName as a LengthPrefixedAnsiString.
function writePresentationObjectHeader(): Uint8Array<ArrayBuffer> {
  const classNameBytes = writeLengthPrefixedAnsiString(PRESENTATION_CLASS_NAME);
  const out = new Uint8Array(4 + 4 + classNameBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, OBJECT_HEADER_OLE_VERSION, true);
  view.setUint32(4, PRESENTATION_OBJECT_HEADER_FORMAT_ID, true);
  out.set(classNameBytes, 8);
  return out;
}

// [MS-OLEDS] 2.2.3.1 ClipboardFormatHeader: a PresentationObjectHeader, then the 4-byte ClipboardFormat field naming which standard clipboard format the PresentationData that follows (built by whichever caller wraps this) is encoded as.
function writeClipboardFormatHeader(): Uint8Array<ArrayBuffer> {
  const headerBytes = writePresentationObjectHeader();
  const out = new Uint8Array(headerBytes.length + 4);
  out.set(headerBytes, 0);
  new DataView(out.buffer).setUint32(
    headerBytes.length,
    CLIPBOARD_FORMAT_CF_DIB,
    true,
  );
  return out;
}

// [MS-OLEDS] 2.2.5 EmbeddedObject's own mandatory fourth field, Presentation: "This MUST be a MetaFilePresentationObject, a BitmapPresentationObject, a DIBPresentationObject, a StandardClipboardFormatPresentationObject, or a RegisteredClipboardFormatPresentationObject." A StandardClipboardFormatPresentationObject (2.2.3.2 -- a ClipboardFormatHeader, then PresentationDataSize and PresentationData) is the smallest of the five this module can build without a full metafile/bitmap-record writer of its own: its PresentationData is writeMinimalDib()'s own bytes, a legitimate (if trivial) CF_DIB image a real OLE1.0 consumer can genuinely decode and display as the object's placeholder preview -- not merely a size-matching filler.
function writePresentationObject(): Uint8Array<ArrayBuffer> {
  const headerBytes = writeClipboardFormatHeader();
  const dib = writeMinimalDib();
  const out = new Uint8Array(headerBytes.length + 4 + dib.length);
  out.set(headerBytes, 0);
  new DataView(out.buffer).setUint32(headerBytes.length, dib.length, true);
  out.set(dib, headerBytes.length + 4);
  return out;
}

// The mirror of writePresentationObjectHeader: validates and skips a PresentationObjectHeader, throwing when the bytes are not this module's own shape (a FormatID other than 0x00000005, or a truncated ClassName) -- readEmbeddedObjectData's shared catch treats that identically to every other reason a payload is not this package's own.
function skipPresentationObjectHeader(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
): number {
  if (offset + 8 > bytes.length) {
    throw new Error(
      "the Presentation field ends before its PresentationObjectHeader's FormatID",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formatId = view.getUint32(offset + 4, true);
  if (formatId !== PRESENTATION_OBJECT_HEADER_FORMAT_ID) {
    throw new Error(
      `PresentationObjectHeader.FormatID is 0x${formatId.toString(16).padStart(8, "0")}, not the 0x00000005 this module's own Presentation field always writes`,
    );
  }
  const className = readLengthPrefixedAnsiString(
    bytes,
    offset + 8,
    "PresentationObjectHeader.ClassName",
  );
  return className.next;
}

// The mirror of writeClipboardFormatHeader.
function skipClipboardFormatHeader(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
): number {
  const afterHeader = skipPresentationObjectHeader(bytes, offset);
  if (afterHeader + 4 > bytes.length) {
    throw new Error(
      "ClipboardFormatHeader ends before its ClipboardFormat field",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const clipboardFormat = view.getUint32(afterHeader, true);
  if (clipboardFormat !== CLIPBOARD_FORMAT_CF_DIB) {
    throw new Error(
      `ClipboardFormatHeader.ClipboardFormat is 0x${clipboardFormat.toString(16).padStart(8, "0")}, not the CF_DIB (0x00000008) this module's own Presentation field always writes`,
    );
  }
  return afterHeader + 4;
}

// The mirror of writePresentationObject: validates and skips the whole Presentation field, returning the offset immediately past it (the end of the EmbeddedObject structure itself). readEmbeddedObjectData calls this purely to confirm the field this package's own writer always appends is genuinely present and well-formed -- it never reads PresentationData back into anything, since nothing in ContentEmbeddedObject has a position for a placeholder preview image, and a payload missing this mandatory field is not this package's own regardless of whether NativeData alone happened to decode.
function skipPresentationObject(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
): number {
  const afterHeader = skipClipboardFormatHeader(bytes, offset);
  if (afterHeader + 4 > bytes.length) {
    throw new Error(
      "StandardClipboardFormatPresentationObject ends before its PresentationDataSize field",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const presentationDataSize = view.getUint32(afterHeader, true);
  const dataStart = afterHeader + 4;
  if (dataStart + presentationDataSize > bytes.length) {
    throw new Error(
      `StandardClipboardFormatPresentationObject's PresentationDataSize declares ${String(presentationDataSize)} bytes but only ${String(bytes.length - dataStart)} remain`,
    );
  }
  return dataStart + presentationDataSize;
}

// Builds the real [MS-OLEDS] EmbeddedObject bytes an \object's \objdata hex-encodes: an ObjectHeader, then NativeDataSize and NativeData (NativeData being this package's own JSON serialisation of `embedded`, wrapped in a Package stream, wrapped in a [MS-CFB] compound file), then the mandatory fourth field, Presentation -- archive-codec builds both container layers NativeData rides in, this module supplies the ObjectHeader/NativeDataSize envelope, the payload between them, and the Presentation field EmbeddedObject also requires.
export function writeEmbeddedObjectData(
  embedded: ContentEmbeddedObject,
): Uint8Array<ArrayBuffer> {
  // Only the content fields ride the envelope -- sourcePath/frames (ContentEmbeddedObjectBlock's own additions) are reader/layout-assigned metadata, never persisted input, exactly as a format reader mints its own sourcePath fresh on every read rather than expecting a writer to have carried one forward.
  const payload: ContentEmbeddedObject = {
    objectKind: embedded.objectKind,
    document: embedded.document,
    frame: embedded.frame,
    anchorRow: embedded.anchorRow,
    anchorColumn: embedded.anchorColumn,
    offsetXPt: embedded.offsetXPt,
    offsetYPt: embedded.offsetYPt,
    source: embedded.source,
  };
  const fileBytes = new TextEncoder().encode(JSON.stringify(payload));
  const packageBytes = writeOlePackage({
    label: PACKAGE_LABEL,
    sourcePath: "",
    tempPath: "",
    fileBytes,
  });
  const nativeData = writeCompoundFile([
    { path: "Package", bytes: packageBytes },
  ]);
  const headerBytes = writeObjectHeader();
  const presentationBytes = writePresentationObject();
  const out = new Uint8Array(
    headerBytes.length + 4 + nativeData.length + presentationBytes.length,
  );
  out.set(headerBytes, 0);
  const view = new DataView(out.buffer);
  view.setUint32(headerBytes.length, nativeData.length, true);
  out.set(nativeData, headerBytes.length + 4);
  out.set(presentationBytes, headerBytes.length + 4 + nativeData.length);
  return out;
}

// The mirror of writeEmbeddedObjectData: recovers a ContentEmbeddedObject from an \object's \objdata bytes when they are this package's own payload, or returns undefined for anything else -- a real OLE object's native data included -- rather than throwing, since one unreadable \object must not fail the whole document read. Every step below (ObjectHeader parse, compound-file parse, Package-stream unwrap, JSON parse, schema validation, Presentation-field parse) can fail independently on a foreign object; the single catch treats all of them alike, matching xls-codec's own container.ts precedent ("archive-codec's own reader can surface a raw RangeError ... which is a corrupt file rather than a bug here"). Presentation is validated last, after NativeData has already decoded successfully: a payload whose NativeData is genuinely this package's own JSON but whose mandatory fourth field is missing or malformed is not a shape this writer ever produced, so it is rejected here rather than accepted as a truncated match.
export function readEmbeddedObjectData(
  bytes: Uint8Array<ArrayBuffer>,
): ContentEmbeddedObject | undefined {
  try {
    const header = readObjectHeader(bytes);
    if (
      header.formatId !== OBJECT_HEADER_FORMAT_ID_EMBEDDED &&
      header.formatId !== OBJECT_HEADER_FORMAT_ID_LINKED
    ) {
      return undefined;
    }
    if (header.next + 4 > bytes.length) {
      return undefined;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const nativeDataSize = view.getUint32(header.next, true);
    const nativeDataStart = header.next + 4;
    if (nativeDataStart + nativeDataSize > bytes.length) {
      return undefined;
    }
    const nativeData = bytes.subarray(
      nativeDataStart,
      nativeDataStart + nativeDataSize,
    );
    const streams = readCompoundFile(nativeData);
    const packageStream = streams.find((stream) => stream.path === "Package");
    if (packageStream === undefined) {
      return undefined;
    }
    const olePackage = readOlePackage(packageStream.bytes);
    const text = new TextDecoder("utf-8").decode(olePackage.fileBytes);
    const parsed: unknown = JSON.parse(text);
    const result = ContentEmbeddedObjectSchema.safeParse(parsed);
    if (!result.success) {
      return undefined;
    }
    // The mandatory fourth field: confirmed present and well-formed, but never read back into anything -- nothing in ContentEmbeddedObject has a position for a placeholder preview image.
    skipPresentationObject(bytes, nativeDataStart + nativeDataSize);
    return result.data;
  } catch {
    return undefined;
  }
}
