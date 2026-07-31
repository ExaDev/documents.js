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

// Reads the declared media type directly out of an ODF package's mimetype entry and compares it, byte for byte, against the expected type -- no zip central-directory parse, and no decodePackage() through odf.js, both of which would be needlessly expensive for what is meant to be a cheap pre-flight validation check.
function hasOdfMimetypeEntry(bytes: Uint8Array, mediaType: string): boolean {
  if (!startsWithBytes(bytes, ZIP_LOCAL_FILE_HEADER)) {
    return false;
  }
  if (readUint16LE(bytes, COMPRESSION_METHOD_OFFSET) !== 0) {
    return false;
  }
  if (readAsciiSlice(bytes, MIMETYPE_FILENAME_OFFSET, MIMETYPE_ENTRY_FILENAME.length) !== MIMETYPE_ENTRY_FILENAME) {
    return false;
  }
  // The entry's declared content length must equal the target media type's length exactly, not merely start with it -- e.g. odt's media type ('...opendocument.text') is a strict byte-prefix of ott's ('...opendocument.text-template'), so a length check is what tells the two apart rather than a false-positive prefix match.
  if (readUint32LE(bytes, COMPRESSED_SIZE_OFFSET) !== mediaType.length) {
    return false;
  }
  return readAsciiSlice(bytes, MIMETYPE_CONTENT_OFFSET, mediaType.length) === mediaType;
}

function odfBytesSchema(label: string, mediaType: string) {
  return z.instanceof(Uint8Array).refine((bytes) => hasOdfMimetypeEntry(bytes, mediaType), {
    message: `not a valid ${label} file: the first zip entry is not a stored "mimetype" part declaring "${mediaType}"`,
  });
}

export const OdtBytesSchema = odfBytesSchema('odt', ODF_MEDIA_TYPES.odt);
export const OdsBytesSchema = odfBytesSchema('ods', ODF_MEDIA_TYPES.ods);
export const OdpBytesSchema = odfBytesSchema('odp', ODF_MEDIA_TYPES.odp);
export const OdgBytesSchema = odfBytesSchema('odg', ODF_MEDIA_TYPES.odg);
