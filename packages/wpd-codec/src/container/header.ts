import { uint16At, uint32At, byteAt, sliceAt } from "../bytes/view";
import {
  WpdEncryptedDocumentError,
  WpdNotAWordPerfectFileError,
  WpdUnsupportedVersionError,
} from "../errors";

// — The WordPerfect file header, per WPFF Document Structure, "File Header Format" --
//
// The standard header is sixteen bytes and the extended header that follows it is 496, so the prefix's fixed part is 512 (0x200) bytes in total and the index area starts immediately after it. The SDK's own prose describes the whole 512 as "the file header" in one sentence and as "the 16-byte file header" in several others; the field table settles it, and the generic-header example proves it: its [pointer to index area] holds 0x0200, which is where a 16-byte header plus a 496-byte extended header ends.
//
// Only two fields of the extended header are documented — a reserved long whose value is 5, and the {file size} long — and the remaining 488 bytes are "Used by WordPerfect and is not documented", so this reader takes the file size and ignores the rest.

// -1,"WPC". "Always the first four bytes of a WP document file." Source: WPFF Document Structure, "File ID Field". The leading byte is the literal value -1 (0xFF) rather than an ASCII character, so only "WPC" itself is derived from its own text.
const FILE_ID_NEGATIVE_ONE_BYTE = 0xff;
export const WPD_FILE_ID: readonly number[] = [
  FILE_ID_NEGATIVE_ONE_BYTE,
  ...Array.from("WPC", (c) => c.charCodeAt(0)),
];

// The fixed part of the prefix: the 16-byte standard header plus the 496-byte extended header.
export const WPD_PREFIX_HEADER_SIZE = 512;

// Product #1 is the WordPerfect program itself. Source: WPFF Document Structure, "Product Type Field".
const PRODUCT_TYPE_WORDPERFECT = 1;

// File type 10 (0x0A) is a WordPerfect document; 36 (0x24) is listed separately as ".WPD files". Both are documents this reader accepts; every other value in the SDK's table names something that is not a document at all (a printer resource file, a thesaurus, a graphic). Source: WPFF Document Structure, "Corel File Types".
const FILE_TYPE_WORDPERFECT_DOCUMENT = 0x0a;
const FILE_TYPE_WPD = 0x24;
const DOCUMENT_FILE_TYPES: readonly number[] = [
  FILE_TYPE_WORDPERFECT_DOCUMENT,
  FILE_TYPE_WPD,
];

// "The major version number is the same for 6.x through X6 documents. For WP X6 documents the major version byte is 2." That one byte is the whole of this reader's version gate: it separates the single lineage Corel documents as "structured the same" from the earlier formats (WP 5.x and before) that share the file ID but not the structure. Source: WPFF Document Structure, "Major Version and Minor Version Fields".
const MAJOR_VERSION_WP6_THROUGH_X6 = 2;

export interface ReadWpdHeaderOptions {
  readonly password?: string;
}

export interface WpdFileHeader {
  // "Long pointer to document area (the absolute offset from the beginning of the file)."
  readonly documentAreaOffset: number;
  readonly productType: number;
  readonly fileType: number;
  readonly majorVersion: number;
  // 1 for a WP 6.x file and for a non-compound WP 8.0 file, 2 for a compound one. Carried because it is the coarsest generation signal the fixed header offers, not because this reader branches on it — the SDK's own answer to telling WP8-through-X6 files apart is the Prefix Time Stamp packet, not this byte.
  readonly minorVersion: number;
  // "This is the offset from the beginning of the file to the index header."
  readonly indexAreaOffset: number;
  // "This 32-bit integer field contains the total length of the WordPerfect file." Not the buffer's length: a file inside an OLE compound wrapper, or one padded at EOF, legitimately differs, and the SDK warns that a third-party writer forgetting to update this field is a common real-world defect. This reader therefore records it and bounds nothing on it.
  readonly fileSize: number;
  // The header's encryption word verbatim: 0 for an unencrypted document, and for an encrypted one the 16-bit checksum of the standard mode's password (see src/container/encryption.ts for the cipher and the word's two readings — standard password checksum, or a value an enhanced-mode file carries instead).
  readonly encryption: number;
}

// True when the bytes open with the -1,"WPC" file ID. Cheap enough to run before any other work, and the discriminator the container layer uses to decide whether a buffer is a bare WordPerfect file or something (an OLE compound file) that may contain one.
export function hasWordPerfectFileId(bytes: Uint8Array): boolean {
  // No separate length guard is needed: indexing a Uint8Array past its own end always answers undefined rather than throwing, and undefined never equals one of WPD_FILE_ID's own byte values, so a buffer shorter than the file ID already fails the every() below on its own.
  return WPD_FILE_ID.every((expected, index) => bytes[index] === expected);
}

// The 16-byte standard header's own field offsets (WPFF Document Structure, "File Header Format"): file ID (0), document area pointer (4, a long), product type (8), file type (9), major version (10), minor version (11), encryption word (12), index area pointer (14).
const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;
const DOCUMENT_AREA_OFFSET_FIELD = 4;
const PRODUCT_TYPE_FIELD = 8;
const FILE_TYPE_FIELD = 9;
const MAJOR_VERSION_FIELD = 10;
const MINOR_VERSION_FIELD = 11;
const ENCRYPTION_FIELD = 12;
const INDEX_AREA_OFFSET_FIELD = 14;
// The extended header's own documented fields sit at offset 16 (a reserved long whose value is 5) and offset 20 (the file size), both relative to the extended header's own start immediately after the 16-byte standard header.
const EXTENDED_HEADER_FILE_SIZE_FIELD = 20;

export function readFileHeader(
  bytes: Uint8Array,
  options: ReadWpdHeaderOptions = {},
): WpdFileHeader {
  if (!hasWordPerfectFileId(bytes)) {
    const actual = Array.from(
      sliceAt(bytes, 0, Math.min(WPD_FILE_ID.length, bytes.length)),
    )
      .map((byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0"))
      .join(" ");
    throw new WpdNotAWordPerfectFileError(
      `Expected the WordPerfect file ID FF 57 50 43 (-1,"WPC") at offset 0, found ${actual}.`,
    );
  }

  const documentAreaOffset = uint32At(bytes, DOCUMENT_AREA_OFFSET_FIELD);
  const productType = byteAt(bytes, PRODUCT_TYPE_FIELD);
  const fileType = byteAt(bytes, FILE_TYPE_FIELD);
  const majorVersion = byteAt(bytes, MAJOR_VERSION_FIELD);
  const minorVersion = byteAt(bytes, MINOR_VERSION_FIELD);
  const encryption = uint16At(bytes, ENCRYPTION_FIELD);
  const indexAreaOffset = uint16At(bytes, INDEX_AREA_OFFSET_FIELD);

  // Checked before the version gate: an encrypted file's version bytes are inside the header and therefore still readable, but reporting "unsupported version" for a file that is merely encrypted would name the wrong problem. With a password supplied, the encrypted file stays readable — the password's verification and the decryption itself happen in the container layer (openWpdDocument), which owns the byte buffer — so this throws only when there is no password to try. An empty-string password is no password, exactly as every other codec here treats one.
  const suppliedPassword =
    options.password === "" ? undefined : options.password;
  if (encryption !== 0 && suppliedPassword === undefined) {
    throw new WpdEncryptedDocumentError(
      `This document is encrypted (encryption word ${encryption}); nothing beyond the file header is intelligible without the password. Pass { password } to read it — the standard ("original") encryption mode is supported, and a non-matching password throws WpdWrongPasswordError.`,
    );
  }

  if (productType !== PRODUCT_TYPE_WORDPERFECT) {
    throw new WpdUnsupportedVersionError(
      `Product type ${productType} is not WordPerfect (${PRODUCT_TYPE_WORDPERFECT}); this file was produced by a different Corel product.`,
    );
  }

  if (!DOCUMENT_FILE_TYPES.includes(fileType)) {
    throw new WpdUnsupportedVersionError(
      `File type ${fileType} is not a WordPerfect document (expected ${DOCUMENT_FILE_TYPES.join(" or ")}).`,
    );
  }

  if (majorVersion !== MAJOR_VERSION_WP6_THROUGH_X6) {
    throw new WpdUnsupportedVersionError(
      `Major version ${majorVersion} is outside the WordPerfect 6.x-X6 lineage (major version ${MAJOR_VERSION_WP6_THROUGH_X6}), the one generation this reader covers.`,
    );
  }

  // The extended header's own documented fields sit at 16 (a reserved long whose value is 5) and 20 (the file size).
  const fileSize = uint32At(bytes, EXTENDED_HEADER_FILE_SIZE_FIELD);

  return {
    documentAreaOffset,
    productType,
    fileType,
    majorVersion,
    minorVersion,
    indexAreaOffset,
    fileSize,
    encryption,
  };
}
