import { expect } from "vitest";

// Little-endian integer readers over raw zip bytes, shared by every test that walks a zip's physical local-file-header layout rather than trusting a round trip through unzipPackage's Record (which makes no ordering promise of its own to test against). Never imported by src/index.ts and never reaches dist/ -- test-only, mirroring odf.js's and ooxml.js's own identical test-support convention.

// Narrows a byte the caller already knows is defined by construction (a lower Uint8Array index than one already checked against undefined -- see readUint16LE/readUint32LE, the only two callers). A plain `as number` assertion would say the same thing to the type checker alone; this says it to a reader running the code too, and fails loudly instead of silently coercing to NaN in the impossible case where the premise is ever wrong.
export function definedByte(value: number | undefined): number {
  if (value === undefined) {
    throw new Error("unreachable: expected a byte already known to be defined");
  }
  return value;
}

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  const b1 = bytes[offset + 1];
  // No separate `bytes[offset] === undefined` check: a Uint8Array holds no gaps, so b1 (the higher index) reads as undefined whenever bytes[offset] would too, and never the other way around -- checking b1 alone already covers every truncation a b0 check would.
  if (b1 === undefined) {
    throw new Error(
      `truncated zip bytes while reading a uint16 at offset ${offset}`,
    );
  }
  return definedByte(bytes[offset]) | (b1 << 8);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  const b3 = bytes[offset + 3];
  // No separate bytes[offset]/[offset+1]/[offset+2] check: a Uint8Array holds no gaps, so b3 (the highest index) reads as undefined whenever any earlier byte would too, and never the other way around -- checking b3 alone already covers every truncation the other three checks would.
  if (b3 === undefined) {
    throw new Error(
      `truncated zip bytes while reading a uint32 at offset ${offset}`,
    );
  }
  return (
    (definedByte(bytes[offset]) |
      (definedByte(bytes[offset + 1]) << 8) |
      (definedByte(bytes[offset + 2]) << 16) |
      (b3 << 24)) >>>
    0
  );
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
// No per-assertion description string is passed to any expect() call below: vitest's second `expect` argument only ever labels a failure message and is never itself part of the pass/fail decision, so a caller can observe no difference between any two description strings -- the assertions' own values (the signature bytes, 8, 0, "mimetype", mediaType) are what a malformed layout is actually caught by.
export function assertMimetypeEntryLayout(
  bytes: Uint8Array,
  mediaType: string,
): void {
  const decoder = new TextDecoder();
  expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(readUint16LE(bytes, 8)).toBe(0);
  expect(readUint16LE(bytes, 26)).toBe(8);
  expect(readUint16LE(bytes, 28)).toBe(0);
  expect(decoder.decode(bytes.subarray(30, 38))).toBe("mimetype");
  expect(decoder.decode(bytes.subarray(38, 38 + mediaType.length))).toBe(
    mediaType,
  );
}
