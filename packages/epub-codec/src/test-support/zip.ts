import { expect } from "vitest";

// Little-endian integer readers over raw zip bytes, shared by every test that walks a zip's physical local-file-header layout rather than trusting a round trip through unzipPackage's Record (which makes no ordering promise of its own to test against). Never imported by src/index.ts and never reaches dist/ — test-only, mirroring odf.js's and ooxml.js's own identical test-support convention.

// Narrows a byte the caller already knows is defined by construction (a lower Uint8Array index than one already checked against undefined — see readUint16LE/readUint32LE, the only two callers). A plain `as number` assertion would say the same thing to the type checker alone; this says it to a reader running the code too, and fails loudly instead of silently coercing to NaN in the impossible case where the premise is ever wrong.
export function definedByte(value: number | undefined): number {
  if (value === undefined) {
    throw new Error("unreachable: expected a byte already known to be defined");
  }
  return value;
}

const BITS_PER_BYTE = 8;
const TWO_BYTES_BITS = 16;
const THREE_BYTES_BITS = 24;
const FOURTH_BYTE_INDEX = 3;

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  const b1 = bytes[offset + 1];
  // No separate `bytes[offset] === undefined` check: a Uint8Array holds no gaps, so b1 (the higher index) reads as undefined whenever bytes[offset] would too, and never the other way around — checking b1 alone already covers every truncation a b0 check would.
  if (b1 === undefined) {
    throw new Error(
      `truncated zip bytes while reading a uint16 at offset ${offset}`,
    );
  }
  return definedByte(bytes[offset]) | (b1 << BITS_PER_BYTE);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  const b3 = bytes[offset + FOURTH_BYTE_INDEX];
  // No separate bytes[offset]/[offset+1]/[offset+2] check: a Uint8Array holds no gaps, so b3 (the highest index) reads as undefined whenever any earlier byte would too, and never the other way around — checking b3 alone already covers every truncation the other three checks would.
  if (b3 === undefined) {
    throw new Error(
      `truncated zip bytes while reading a uint32 at offset ${offset}`,
    );
  }
  return (
    (definedByte(bytes[offset]) |
      (definedByte(bytes[offset + 1]) << BITS_PER_BYTE) |
      (definedByte(bytes[offset + 2]) << TWO_BYTES_BITS) |
      (b3 << THREE_BYTES_BITS)) >>>
    0
  );
}

// PKWARE APPNOTE.TXT section 4.3.7 (local file header). Byte offsets within a single local file header's own fixed-size part; filename and extra-field bytes follow immediately after it.
export const ZIP_SIGNATURE_P = 0x50;
export const ZIP_SIGNATURE_K = 0x4b;
export const ZIP_SIGNATURE_LOCAL_FILE_MARKER = 0x03;
export const ZIP_SIGNATURE_LOCAL_FILE_HEADER = 0x04;
export const ZIP_LOCAL_FILE_HEADER_SIGNATURE =
  ZIP_SIGNATURE_P |
  (ZIP_SIGNATURE_K << BITS_PER_BYTE) |
  (ZIP_SIGNATURE_LOCAL_FILE_MARKER << TWO_BYTES_BITS) |
  (ZIP_SIGNATURE_LOCAL_FILE_HEADER << THREE_BYTES_BITS);
export const ZIP_COMPRESSION_METHOD_OFFSET = 8;
export const ZIP_COMPRESSION_METHOD_STORED = 0;
export const ZIP_COMPRESSED_SIZE_OFFSET = 18;
export const ZIP_FILENAME_LENGTH_OFFSET = 26;
export const ZIP_EXTRA_FIELD_LENGTH_OFFSET = 28;
export const ZIP_LOCAL_FILE_HEADER_SIZE = 30;
export const MIMETYPE_ENTRY_NAME = "mimetype";

// Walks local file headers from the start of a zip, in physical emission order, returning each entry's declared filename. This is the byte-level ordering guarantee zipPackage's ordered-entries contract exists to provide.
export function localFileHeaderNames(bytes: Uint8Array): string[] {
  const decoder = new TextDecoder();
  const names: string[] = [];
  let offset = 0;
  while (
    offset < bytes.length &&
    readUint32LE(bytes, offset) === ZIP_LOCAL_FILE_HEADER_SIGNATURE
  ) {
    const compressedSize = readUint32LE(
      bytes,
      offset + ZIP_COMPRESSED_SIZE_OFFSET,
    );
    const filenameLength = readUint16LE(
      bytes,
      offset + ZIP_FILENAME_LENGTH_OFFSET,
    );
    const extraLength = readUint16LE(
      bytes,
      offset + ZIP_EXTRA_FIELD_LENGTH_OFFSET,
    );
    const nameStart = offset + ZIP_LOCAL_FILE_HEADER_SIZE;
    names.push(
      decoder.decode(bytes.subarray(nameStart, nameStart + filenameLength)),
    );
    offset = nameStart + filenameLength + extraLength + compressedSize;
  }
  return names;
}

/**
 * Asserts the exact byte layout EPUB 3.3 section 6.3 pins for a package's first entry: a "mimetype" part, stored uncompressed with a zero-length extra field, containing exactly "application/epub+zip", so a reader can identify the container as an EPUB from fixed byte offsets alone, without parsing the zip central directory first.
 */
// No per-assertion description string is passed to any expect() call below: vitest's second `expect` argument only ever labels a failure message and is never itself part of the pass/fail decision, so a caller can observe no difference between any two description strings — the assertions' own values (the signature bytes, the stored-compression method, the zero extra length, "mimetype", mediaType) are what a malformed layout is actually caught by.
export function assertMimetypeEntryLayout(
  bytes: Uint8Array,
  mediaType: string,
): void {
  const decoder = new TextDecoder();
  const signatureLength = 4;
  expect(Array.from(bytes.subarray(0, signatureLength))).toEqual([
    ZIP_SIGNATURE_P,
    ZIP_SIGNATURE_K,
    ZIP_SIGNATURE_LOCAL_FILE_MARKER,
    ZIP_SIGNATURE_LOCAL_FILE_HEADER,
  ]);
  expect(readUint16LE(bytes, ZIP_COMPRESSION_METHOD_OFFSET)).toBe(
    ZIP_COMPRESSION_METHOD_STORED,
  );
  expect(readUint16LE(bytes, ZIP_FILENAME_LENGTH_OFFSET)).toBe(
    MIMETYPE_ENTRY_NAME.length,
  );
  expect(readUint16LE(bytes, ZIP_EXTRA_FIELD_LENGTH_OFFSET)).toBe(0);
  const nameEnd = ZIP_LOCAL_FILE_HEADER_SIZE + MIMETYPE_ENTRY_NAME.length;
  expect(
    decoder.decode(bytes.subarray(ZIP_LOCAL_FILE_HEADER_SIZE, nameEnd)),
  ).toBe(MIMETYPE_ENTRY_NAME);
  expect(
    decoder.decode(bytes.subarray(nameEnd, nameEnd + mediaType.length)),
  ).toBe(mediaType);
}
