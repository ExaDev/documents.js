import { expect } from "vitest";

// Little-endian integer readers over raw zip bytes, shared by every test that walks a zip's physical local-file-header layout rather than trusting a round trip through unzipPackage's Record (which makes no ordering promise of its own to test against). Never imported by src/index.ts and never reaches dist/ — test-only, mirroring the same test-only, never-exported convention as this package's other test-support helpers.

const UINT16_BYTES = 2;
const UINT32_BYTES = 4;
const BYTE_1_SHIFT = 8;
const BYTE_2_SHIFT = 16;
const BYTE_3_SHIFT = 24;

// A single out-of-range check on the whole [offset, offset + byteCount) span, rather than one `bytes[i] === undefined` comparison per byte — the per-byte form used to leave middle bytes (b1 of 4, say) impossible to isolate as the sole missing one, since a real Uint8Array's undefined region is always a contiguous prefix (negative indices) or suffix (indices past the end), never a single interior gap: no test input could ever tell "byte 1 alone is missing" apart from "the guard doesn't check byte 1 at all", so that mutation was unkillable by construction. A span check has no such interior case to isolate.
function requireBytesInRange(
  bytes: Uint8Array,
  offset: number,
  byteCount: number,
  typeLabel: string,
): void {
  if (offset < 0 || offset + byteCount > bytes.length) {
    throw new Error(
      `truncated zip bytes while reading a ${typeLabel} at offset ${offset}`,
    );
  }
}

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  requireBytesInRange(bytes, offset, UINT16_BYTES, "uint16");
  // Bounds already verified above, so both indices are in range — this is the standard escape hatch for a typed-array read TypeScript otherwise types as `number | undefined` under noUncheckedIndexedAccess with no way to narrow it from a separately-expressed arithmetic guard.
  const b0 = bytes[offset]!;
  const b1 = bytes[offset + 1]!;
  return b0 | (b1 << BYTE_1_SHIFT);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  requireBytesInRange(bytes, offset, UINT32_BYTES, "uint32");
  // Bounds already verified above, so all four indices are in range — see readUint16LE's identical comment.
  const fourthByteIndex = 3;
  const b0 = bytes[offset]!;
  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;
  const b3 = bytes[offset + fourthByteIndex]!;
  return (
    (b0 |
      (b1 << BYTE_1_SHIFT) |
      (b2 << BYTE_2_SHIFT) |
      (b3 << BYTE_3_SHIFT)) >>>
    0
  );
}

// A zip local file header's own fixed field layout (PKWARE APPNOTE.TXT section 4.3.7), the part of it this module actually reads.
const LFH_SIGNATURE = 0x04034b50;
const LFH_COMPRESSION_METHOD_OFFSET = 8;
const LFH_COMPRESSED_SIZE_OFFSET = 18;
const LFH_FILENAME_LENGTH_OFFSET = 26;
const LFH_EXTRA_LENGTH_OFFSET = 28;
const LFH_FIXED_SIZE = 30;

// Walks local file headers from the start of a zip, in physical emission order, returning each entry's declared filename. This is the byte-level ordering guarantee zipPackage's ordered-entries contract exists to provide.
export function localFileHeaderNames(bytes: Uint8Array): string[] {
  const decoder = new TextDecoder();
  const names: string[] = [];
  let offset = 0;
  while (
    offset < bytes.length &&
    readUint32LE(bytes, offset) === LFH_SIGNATURE
  ) {
    const compressedSize = readUint32LE(
      bytes,
      offset + LFH_COMPRESSED_SIZE_OFFSET,
    );
    const filenameLength = readUint16LE(
      bytes,
      offset + LFH_FILENAME_LENGTH_OFFSET,
    );
    const extraLength = readUint16LE(bytes, offset + LFH_EXTRA_LENGTH_OFFSET);
    const nameStart = offset + LFH_FIXED_SIZE;
    names.push(
      decoder.decode(bytes.subarray(nameStart, nameStart + filenameLength)),
    );
    offset = nameStart + filenameLength + extraLength + compressedSize;
  }
  return names;
}

const STORED_COMPRESSION_METHOD = 0;
const NO_EXTRA_FIELD_LENGTH = 0;
const MIMETYPE_NAME = "mimetype";
const MIMETYPE_NAME_LENGTH = MIMETYPE_NAME.length;
const MIMETYPE_CONTENT_OFFSET = LFH_FIXED_SIZE + MIMETYPE_NAME_LENGTH;

/**
 * Asserts the exact byte layout ODF (OASIS Open Document Format Part 3, "Packages") pins for a package's first entry: a "mimetype" part, stored uncompressed with a zero-length extra field, so a reader can identify the container's media type from fixed byte offsets alone, without parsing the zip central directory first.
 */
export function assertMimetypeEntryLayout(
  bytes: Uint8Array,
  mediaType: string,
): void {
  const decoder = new TextDecoder();
  const lfhSignatureBytes = Array.from("PK\x03\x04", (char) =>
    char.charCodeAt(0),
  );
  expect(
    Array.from(bytes.subarray(0, lfhSignatureBytes.length)),
    'local file header signature "PK\\x03\\x04"',
  ).toEqual(lfhSignatureBytes);
  expect(
    readUint16LE(bytes, LFH_COMPRESSION_METHOD_OFFSET),
    "compression method (0 = stored)",
  ).toBe(STORED_COMPRESSION_METHOD);
  expect(
    readUint16LE(bytes, LFH_FILENAME_LENGTH_OFFSET),
    'filename length ("mimetype".length)',
  ).toBe(MIMETYPE_NAME_LENGTH);
  expect(
    readUint16LE(bytes, LFH_EXTRA_LENGTH_OFFSET),
    "extra field length",
  ).toBe(NO_EXTRA_FIELD_LENGTH);
  expect(
    decoder.decode(bytes.subarray(LFH_FIXED_SIZE, MIMETYPE_CONTENT_OFFSET)),
    "filename bytes",
  ).toBe(MIMETYPE_NAME);
  expect(
    decoder.decode(
      bytes.subarray(
        MIMETYPE_CONTENT_OFFSET,
        MIMETYPE_CONTENT_OFFSET + mediaType.length,
      ),
    ),
    "mimetype content bytes",
  ).toBe(mediaType);
}
