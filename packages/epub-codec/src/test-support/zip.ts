import { expect } from "vitest";

// Little-endian integer readers over raw zip bytes, shared by every test that walks a zip's physical local-file-header layout rather than trusting a round trip through unzipPackage's Record (which makes no ordering promise of its own to test against). Never imported by src/index.ts and never reaches dist/ -- test-only, mirroring odf.js's and ooxml.js's own identical test-support convention.

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  if (b0 === undefined || b1 === undefined) {
    throw new Error(
      `truncated zip bytes while reading a uint16 at offset ${offset}`,
    );
  }
  return b0 | (b1 << 8);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (
    b0 === undefined ||
    b1 === undefined ||
    b2 === undefined ||
    b3 === undefined
  ) {
    throw new Error(
      `truncated zip bytes while reading a uint32 at offset ${offset}`,
    );
  }
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
}

// Walks local file headers (signature 0x04034b50) from the start of a zip, in physical emission order, returning each entry's declared filename. This is the byte-level ordering guarantee zipPackage's ordered-entries contract exists to provide.
export function localFileHeaderNames(bytes: Uint8Array): string[] {
  const decoder = new TextDecoder();
  const names: string[] = [];
  let offset = 0;
  while (offset < bytes.length && readUint32LE(bytes, offset) === 0x04034b50) {
    const compressedSize = readUint32LE(bytes, offset + 18);
    const filenameLength = readUint16LE(bytes, offset + 26);
    const extraLength = readUint16LE(bytes, offset + 28);
    const nameStart = offset + 30;
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
export function assertMimetypeEntryLayout(
  bytes: Uint8Array,
  mediaType: string,
): void {
  const decoder = new TextDecoder();
  expect(
    Array.from(bytes.subarray(0, 4)),
    'local file header signature "PK\\x03\\x04"',
  ).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(readUint16LE(bytes, 8), "compression method (0 = stored)").toBe(0);
  expect(readUint16LE(bytes, 26), 'filename length ("mimetype".length)').toBe(
    8,
  );
  expect(readUint16LE(bytes, 28), "extra field length").toBe(0);
  expect(decoder.decode(bytes.subarray(30, 38)), "filename bytes").toBe(
    "mimetype",
  );
  expect(
    decoder.decode(bytes.subarray(38, 38 + mediaType.length)),
    "mimetype content bytes",
  ).toBe(mediaType);
}
