import { uint16At, uint32At, byteAt, sliceAt } from "../bytes/view";
import {
  WpdEncryptedDocumentError,
  WpdNotAWordPerfectFileError,
  WpdUnsupportedVersionError,
} from "../errors";

// -- The WordPerfect file header, per WPFF Document Structure, "File Header Format" --
//
// The standard header is sixteen bytes and the extended header that follows it is 496, so the prefix's fixed part is 512 (0x200) bytes in total and the index area starts immediately after it. The SDK's own prose describes the whole 512 as "the file header" in one sentence and as "the 16-byte file header" in several others; the field table settles it, and the generic-header example proves it: its [pointer to index area] holds 0x0200, which is where a 16-byte header plus a 496-byte extended header ends.
//
// Only two fields of the extended header are documented -- a reserved long whose value is 5, and the {file size} long -- and the remaining 488 bytes are "Used by WordPerfect and is not documented", so this reader takes the file size and ignores the rest.

// -1,"WPC". "Always the first four bytes of a WP document file." Source: WPFF Document Structure, "File ID Field".
export const WPD_FILE_ID: readonly number[] = [0xff, 0x57, 0x50, 0x43];

// The fixed part of the prefix: the 16-byte standard header plus the 496-byte extended header.
export const WPD_PREFIX_HEADER_SIZE = 512;

// Product #1 is the WordPerfect program itself. Source: WPFF Document Structure, "Product Type Field".
const PRODUCT_TYPE_WORDPERFECT = 1;

// File type 10 (0x0A) is a WordPerfect document; 36 (0x24) is listed separately as ".WPD files". Both are documents this reader accepts; every other value in the SDK's table names something that is not a document at all (a printer resource file, a thesaurus, a graphic). Source: WPFF Document Structure, "Corel File Types".
const DOCUMENT_FILE_TYPES: readonly number[] = [0x0a, 0x24];

// "The major version number is the same for 6.x through X6 documents. For WP X6 documents the major version byte is 2." That one byte is the whole of this reader's version gate: it separates the single lineage Corel documents as "structured the same" from the earlier formats (WP 5.x and before) that share the file ID but not the structure. Source: WPFF Document Structure, "Major Version and Minor Version Fields".
const MAJOR_VERSION_WP6_THROUGH_X6 = 2;

export interface WpdFileHeader {
  // "Long pointer to document area (the absolute offset from the beginning of the file)."
  readonly documentAreaOffset: number;
  readonly productType: number;
  readonly fileType: number;
  readonly majorVersion: number;
  // 1 for a WP 6.x file and for a non-compound WP 8.0 file, 2 for a compound one. Carried because it is the coarsest generation signal the fixed header offers, not because this reader branches on it -- the SDK's own answer to telling WP8-through-X6 files apart is the Prefix Time Stamp packet, not this byte.
  readonly minorVersion: number;
  // "This is the offset from the beginning of the file to the index header."
  readonly indexAreaOffset: number;
  // "This 32-bit integer field contains the total length of the WordPerfect file." Not the buffer's length: a file inside an OLE compound wrapper, or one padded at EOF, legitimately differs, and the SDK warns that a third-party writer forgetting to update this field is a common real-world defect. This reader therefore records it and bounds nothing on it.
  readonly fileSize: number;
}

// True when the bytes open with the -1,"WPC" file ID. Cheap enough to run before any other work, and the discriminator the container layer uses to decide whether a buffer is a bare WordPerfect file or something (an OLE compound file) that may contain one.
export function hasWordPerfectFileId(bytes: Uint8Array): boolean {
  if (bytes.length < WPD_FILE_ID.length) {
    return false;
  }
  return WPD_FILE_ID.every((expected, index) => bytes[index] === expected);
}

export function readFileHeader(bytes: Uint8Array): WpdFileHeader {
  if (!hasWordPerfectFileId(bytes)) {
    const actual = Array.from(sliceAt(bytes, 0, Math.min(4, bytes.length)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
    throw new WpdNotAWordPerfectFileError(
      `Expected the WordPerfect file ID FF 57 50 43 (-1,"WPC") at offset 0, found ${actual}.`,
    );
  }

  const documentAreaOffset = uint32At(bytes, 4);
  const productType = byteAt(bytes, 8);
  const fileType = byteAt(bytes, 9);
  const majorVersion = byteAt(bytes, 10);
  const minorVersion = byteAt(bytes, 11);
  const encryption = uint16At(bytes, 12);
  const indexAreaOffset = uint16At(bytes, 14);

  // Checked before the version gate: an encrypted file's version bytes are inside the header and therefore still readable, but reporting "unsupported version" for a file that is merely encrypted would name the wrong problem.
  if (encryption !== 0) {
    throw new WpdEncryptedDocumentError(
      `This document is encrypted (encryption word ${encryption}); nothing beyond the file header is intelligible without the password, which this reader does not support.`,
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
  const fileSize = uint32At(bytes, 20);

  return {
    documentAreaOffset,
    productType,
    fileType,
    majorVersion,
    minorVersion,
    indexAreaOffset,
    fileSize,
  };
}
