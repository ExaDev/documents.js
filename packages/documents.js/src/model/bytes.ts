import { z } from 'zod';
import { ODF_MEDIA_TYPES } from 'odf.js';

// 'PK\x03\x04' -- the ZIP local-file-header signature (ISO/IEC 21320-1 / APPNOTE 4.3.7). Both docx and pptx are OPC packages, i.e. ZIP archives, so this is the fastest and most reliable way to reject a non-package input before any XML parsing is attempted.
const ZIP_LOCAL_FILE_HEADER = [0x50, 0x4b, 0x03, 0x04];

// '%PDF-' -- the PDF header (ISO 32000-1 section 7.5.2). Per the spec it may be preceded by arbitrary bytes (some producers prepend a comment or BOM), so this checks for the signature within the first kilobyte rather than requiring it at offset 0.
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PDF_HEADER_SEARCH_WINDOW = 1024;

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

function containsBytesWithin(bytes: Uint8Array, signature: readonly number[], window: number): boolean {
  const limit = Math.min(bytes.length - signature.length, window);
  for (let start = 0; start <= limit; start++) {
    let matched = true;
    for (let i = 0; i < signature.length; i++) {
      if (bytes[start + i] !== signature[i]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}

function zipBytesSchema(label: string) {
  return z.instanceof(Uint8Array).refine((bytes) => startsWithBytes(bytes, ZIP_LOCAL_FILE_HEADER), {
    message: `not a valid ${label} file: missing the ZIP local-file-header signature`,
  });
}

export const DocxBytesSchema = zipBytesSchema('docx');
export const PptxBytesSchema = zipBytesSchema('pptx');
export const XlsxBytesSchema = zipBytesSchema('xlsx');

export const PdfBytesSchema = z.instanceof(Uint8Array).refine(
  (bytes) => containsBytesWithin(bytes, PDF_HEADER, PDF_HEADER_SEARCH_WINDOW),
  { message: 'not a valid PDF file: missing the %PDF- header' },
);

// ODF (OASIS Open Document Format Part 3, "Packages") mandates that a package's "mimetype" part be the very first zip entry, stored uncompressed with a zero-length extra field -- unlike DocxBytesSchema/PptxBytesSchema above, which can only check the generic ZIP local-file-header signature (OOXML has no discriminating byte earlier than that), this lets an ODF schema check the package's ACTUAL declared media type, not merely "this is some zip". That guarantee pins the media type string at a fixed byte offset: the 30-byte fixed local-file-header region, followed by the 8-byte "mimetype" filename, followed immediately by the media type itself as the entry's raw content -- proven and exercised against odf.js's own zip writer in its zip.test.ts (assertMimetypeEntryLayout). This is genuinely stronger validation than the OOXML schemas get: a docx/pptx file only proves "a ZIP", where an odt/ods/odp/odg file proves "a ZIP whose first entry declares itself, byte-for-byte, as this exact ODF media type".
const MIMETYPE_ENTRY_FILENAME = 'mimetype';
const MIMETYPE_FILENAME_OFFSET = 30; // fixed 30-byte local-file-header region (APPNOTE 4.3.7) precedes the filename field.
const MIMETYPE_CONTENT_OFFSET = MIMETYPE_FILENAME_OFFSET + MIMETYPE_ENTRY_FILENAME.length; // 38: the filename field is exactly "mimetype".length bytes, since ODF fixes both the name and its stored (uncompressed) encoding.
const COMPRESSION_METHOD_OFFSET = 8; // 2-byte LE field; 0 = stored (uncompressed), which ODF mandates for the mimetype entry specifically.
const COMPRESSED_SIZE_OFFSET = 18; // 4-byte LE field; for a stored entry this equals the entry's raw content length.

function readUint16LE(bytes: Uint8Array, offset: number): number | undefined {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  if (b0 === undefined || b1 === undefined) {
    return undefined;
  }
  return b0 | (b1 << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number | undefined {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    return undefined;
  }
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
}

function readAsciiSlice(bytes: Uint8Array, offset: number, length: number): string | undefined {
  if (bytes.length < offset + length) {
    return undefined;
  }
  return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}

// Reads the declared media type directly out of an ODF package's mimetype entry and checks it, byte for byte, against any of the accepted types -- no zip central-directory parse, and no decodePackage() through odf.js, both of which would be needlessly expensive for what is meant to be a cheap pre-flight validation check. Each accepted type is matched with its own exact length, so two types that share a byte-prefix (odt's '...opendocument.text' is a strict prefix of ott's '...opendocument.text-template') are still told apart correctly rather than one false-positive-matching the other.
function hasOdfMimetypeEntry(bytes: Uint8Array, mediaTypes: readonly string[]): boolean {
  if (!startsWithBytes(bytes, ZIP_LOCAL_FILE_HEADER)) {
    return false;
  }
  if (readUint16LE(bytes, COMPRESSION_METHOD_OFFSET) !== 0) {
    return false;
  }
  if (readAsciiSlice(bytes, MIMETYPE_FILENAME_OFFSET, MIMETYPE_ENTRY_FILENAME.length) !== MIMETYPE_ENTRY_FILENAME) {
    return false;
  }
  return mediaTypes.some((mediaType) => {
    // The entry's declared content length must equal the target media type's length exactly, not merely start with it.
    if (readUint32LE(bytes, COMPRESSED_SIZE_OFFSET) !== mediaType.length) {
      return false;
    }
    return readAsciiSlice(bytes, MIMETYPE_CONTENT_OFFSET, mediaType.length) === mediaType;
  });
}

function odfBytesSchema(label: string, mediaTypes: readonly string[]) {
  const accepted = mediaTypes.map((type) => `"${type}"`).join(' or ');
  return z.instanceof(Uint8Array).refine((bytes) => hasOdfMimetypeEntry(bytes, mediaTypes), {
    message: `not a valid ${label} file: the first zip entry is not a stored "mimetype" part declaring ${accepted}`,
  });
}

// Each schema accepts both the base media type and its -template sibling: an ODF template (.ott/.ots/.otp/.otg) is the same package as its non-template counterpart with only the mimetype's own "-template" suffix differing, so a .ott reads through the odt codec unchanged. The ergonomic conversions (odtToPdf etc.) never applied this schema and already accepted templates; this widens the schema-validated codec path and the exported pre-flight schemas to match.
export const OdtBytesSchema = odfBytesSchema('odt', [ODF_MEDIA_TYPES.odt, ODF_MEDIA_TYPES.ott]);
export const OdsBytesSchema = odfBytesSchema('ods', [ODF_MEDIA_TYPES.ods, ODF_MEDIA_TYPES.ots]);
export const OdpBytesSchema = odfBytesSchema('odp', [ODF_MEDIA_TYPES.odp, ODF_MEDIA_TYPES.otp]);
export const OdgBytesSchema = odfBytesSchema('odg', [ODF_MEDIA_TYPES.odg, ODF_MEDIA_TYPES.otg]);

// MarkdownBytesSchema is architecturally different from every schema above: it is the one schema in this file asserting nothing about FORMAT STRUCTURE at all. Docx/pptx/xlsx check the generic ZIP local-file-header signature; PDF checks its own %PDF- magic header; odt/ods/odp/odg check ODF's own declared mimetype entry, byte for byte. Markdown is plain text with no header, no magic bytes, and no reserved byte sequence of its own -- CommonMark's own grammar has no "this is not markdown" rejection path at all (a genuinely unparseable line just becomes an ordinary paragraph), so there is no format-level check to write here, ever. The one thing actually worth validating at the bytes boundary is well-formed UTF-8, matching markdown-codec's own MarkdownBytesSchema (that package's src/codec.ts) exactly, so a malformed byte sequence is caught here, at the schema, rather than surfacing later as silently-mangled U+FFFD replacement characters deep inside readMarkdownContent's own output.
function isWellFormedUtf8Text(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export const MarkdownBytesSchema = z.instanceof(Uint8Array).refine(isWellFormedUtf8Text, { message: 'not well-formed UTF-8 text' });

// CsvBytesSchema rests on the identical no-magic-bytes architecture as MarkdownBytesSchema above: csv shares markdown's plain-text nature (no header, no reserved byte sequence -- RFC 4180 text is just fields and delimiters), so well-formed UTF-8 is the one honest bytes-level check, and the same fatal-decode refinement covers both. The parse errors that ARE specific to csv (an unterminated quoted field) surface as CsvParseError from parseCsvRecords, which is where the text is actually understood.
export const CsvBytesSchema = z.instanceof(Uint8Array).refine(isWellFormedUtf8Text, { message: 'not well-formed UTF-8 text' });

// SvgBytesSchema shares the plain-text architecture above but can honestly check one step more structure: SVG, unlike csv/markdown, HAS a recognisable root -- an XML document whose outermost element is <svg>. The check is deliberately loose (a case-insensitive substring, not an XML parse, so a DOCTYPE, XML declaration, or comment ahead of the root still passes and trailing junk is left to the reader), because this schema's job is pre-flight rejection of obviously-wrong bytes, not validation. A fatal decode already proved well-formed UTF-8 by the time the substring is tested, so decoding it again here cannot mangle.
export const SvgBytesSchema = z.instanceof(Uint8Array).refine(
  (bytes) => {
    if (!isWellFormedUtf8Text(bytes)) {
      return false;
    }
    return new TextDecoder().decode(bytes).toLowerCase().includes('<svg');
  },
  { message: 'not a valid SVG file: not well-formed UTF-8 text containing an <svg root element' },
);

// TypeScript's default Uint8Array generic admits a SharedArrayBuffer-backed view, one step broader than this package's own Uint8Array<ArrayBuffer> convention that decodeDocumentPackage/readPdf/every public entry point in src/index.ts requires. A real, narrow runtime check (not an assertion) proves the narrowing at each byte boundary that needs it, rather than casting past it. Lives here, in the bytes-boundary module, because both directions reach for it: the read-side codec dispatch (src/codecs/read.ts) narrows before decodeDocumentPackage/readPdf, and the write-side callers (src/metadata/write.ts, src/convert/from-package.ts) narrow their builders' returned bytes the same way.
function isArrayBufferBacked(bytes: Uint8Array): bytes is Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer;
}

export function requireArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!isArrayBufferBacked(bytes)) {
    throw new TypeError('expected an ArrayBuffer-backed Uint8Array, received one backed by a SharedArrayBuffer');
  }
  return bytes;
}
