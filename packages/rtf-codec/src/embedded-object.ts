// An RTF \object's \objdata is, per the specification's own words, "the structure produced by the OLESaveToStream function" -- and OLESaveToStream's own output is [MS-OLEDS] 2.2.5 EmbeddedObject: an ObjectHeader (2.2.4) followed by a NativeDataSize (4 bytes) and NativeData (the size that field names) -- NOT the raw native data alone. archive-codec ships the compound file the native data itself is (writeCompoundFile/readCompoundFile, [MS-CFB]) plus the OLE Package stream wrapper real Word/PowerPoint embeds use inside it (writeOlePackage/readOlePackage), so this module's own job is exactly the two things archive-codec cannot supply: the ObjectHeader/NativeDataSize envelope those bytes ride inside, and the JSON payload the Package stream wraps.
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

// Builds the real [MS-OLEDS] EmbeddedObject bytes an \object's \objdata hex-encodes: an ObjectHeader, then NativeDataSize and NativeData, where NativeData is this package's own JSON serialisation of `embedded`, wrapped in a Package stream, wrapped in a [MS-CFB] compound file -- archive-codec builds both container layers, this module supplies the ObjectHeader/NativeDataSize envelope and the payload between them.
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
  const out = new Uint8Array(headerBytes.length + 4 + nativeData.length);
  out.set(headerBytes, 0);
  const view = new DataView(out.buffer);
  view.setUint32(headerBytes.length, nativeData.length, true);
  out.set(nativeData, headerBytes.length + 4);
  return out;
}

// The mirror of writeEmbeddedObjectData: recovers a ContentEmbeddedObject from an \object's \objdata bytes when they are this package's own payload, or returns undefined for anything else -- a real OLE object's native data included -- rather than throwing, since one unreadable \object must not fail the whole document read. Every step below (ObjectHeader parse, compound-file parse, Package-stream unwrap, JSON parse, schema validation) can fail independently on a foreign object; the single catch treats all of them alike, matching xls-codec's own container.ts precedent ("archive-codec's own reader can surface a raw RangeError ... which is a corrupt file rather than a bug here").
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
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
