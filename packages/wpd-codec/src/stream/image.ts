// -- Embedded image payloads inside a box's content prefix packet --
//
// A box whose function-level override names IMAGE content (stream/box.ts's type 3) points at a prefix packet whose layout this reader has no specification for -- WordPerfect carried several image container spellings across its versions (raw WPG2 bitmaps, "Image: WP" packets, later straight PNG/JPEG embeds). Rather than guess at any container header, this module scans the packet's raw bytes for a whole, well-formed PNG or JPEG payload by signature and structure -- the same magic-driven discipline pdf-codec's byte schemas apply -- and lifts exactly the byte span the structure itself delimits. A packet carrying no such payload is honestly reported as unresolved by the caller rather than approximated.

import { byteAt, sliceAt } from "../bytes/view";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SOI = [0xff, 0xd8] as const;

export interface WpdImagePayload {
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array;
}

// Whether `signature` occurs at exactly `index`. Safe for an index near the buffer's own end with no separate "does it fit" pre-check of its own: an out-of-range position reads back `undefined` from the plain index, which never equals one of a signature's own concrete byte values.
function bytesMatchAt(
  bytes: Uint8Array,
  index: number,
  signature: readonly number[],
): boolean {
  return signature.every((byte, offset) => bytes[index + offset] === byte);
}

// The first byte offset at which `needle` occurs in `bytes` at or after `from`, or undefined. A plain scan: packet payloads are small (an embedded figure), and no container this module knows of would justify a fancier search.
function indexOf(
  bytes: Uint8Array,
  needle: readonly number[],
  from: number,
): number | undefined {
  for (let index = from; index < bytes.length; index += 1) {
    if (bytesMatchAt(bytes, index, needle)) {
      return index;
    }
  }
  return undefined;
}

// Big-endian (network byte order) reads: both PNG chunk lengths and JPEG segment lengths use this convention, the opposite of the little-endian convention every read in this package's own bytes/view.ts assumes for WordPerfect's own fields -- so these live here, not there. Built on byteAt, whose own bounds check throws rather than returning undefined, so a truncated read anywhere in either scan below surfaces as one caught exception instead of a separate manual length comparison at every call site.
function bigEndianUint32At(bytes: Uint8Array, offset: number): number {
  return (
    byteAt(bytes, offset) * 0x1000000 +
    byteAt(bytes, offset + 1) * 0x10000 +
    byteAt(bytes, offset + 2) * 0x100 +
    byteAt(bytes, offset + 3)
  );
}

function bigEndianUint16At(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) * 0x100 + byteAt(bytes, offset + 1);
}

function scanPng(
  bytes: Uint8Array,
  signatureAt: number,
): WpdImagePayload | undefined {
  // Walk the chunk chain from the signature: each chunk is [length (big-endian u32)][type][data][crc], and the image ends after IEND's own crc. Every read below is bounds-checked by byteAt or sliceAt themselves, whose own throw -- caught once, below -- stands in for a truncated or malformed embed rather than a best-effort span.
  let cursor = signatureAt + PNG_SIGNATURE.length;
  try {
    for (;;) {
      const length = bigEndianUint32At(bytes, cursor);
      const type = String.fromCharCode(
        byteAt(bytes, cursor + 4),
        byteAt(bytes, cursor + 5),
        byteAt(bytes, cursor + 6),
        byteAt(bytes, cursor + 7),
      );
      cursor += 8 + length + 4;
      if (type === "IEND") {
        return {
          format: "png",
          bytes: sliceAt(bytes, signatureAt, cursor - signatureAt),
        };
      }
    }
  } catch {
    return undefined;
  }
}

function scanJpeg(
  bytes: Uint8Array,
  soiAt: number,
): WpdImagePayload | undefined {
  // Walk the marker segments from SOI: each non-standalone marker carries its own big-endian length; SOS opens entropy-coded data that only ends at EOI (FF D9). RSTn and TEM are standalone; a fill FF before a marker is legal and skipped. Every positional read below is bounds-checked by byteAt or sliceAt themselves, whose own throw -- caught once, below -- stands in for a stream that runs out anywhere in this walk.
  let cursor = soiAt + JPEG_SOI.length;
  try {
    for (;;) {
      if (byteAt(bytes, cursor) !== 0xff) {
        return undefined;
      }
      while (byteAt(bytes, cursor) === 0xff) {
        cursor += 1;
      }
      const marker = byteAt(bytes, cursor);
      cursor += 1;
      const standalone =
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7);
      if (standalone) {
        continue;
      }
      if (marker === 0xd9) {
        return { format: "jpeg", bytes: bytes.subarray(soiAt, cursor) };
      }
      const length = bigEndianUint16At(bytes, cursor);
      if (length < 2) {
        return undefined;
      }
      // The segment's own declared extent, bounds-checked by sliceAt itself; its length (equal to `length` when it does not throw) is what actually advances the cursor, rather than a separately-mutable "cursor + length > bytes.length" comparison of its own.
      cursor += sliceAt(bytes, cursor, length).length;
      if (marker === 0xda) {
        // Entropy-coded data: scan byte-wise for the EOI marker (a preceding 0xff run is the marker prefix). A stuffed FF inside the entropy stream is always followed by a non-zero byte, so FF D9 can only be EOI.
        const eoi = indexOf(bytes, [0xff, 0xd9], cursor);
        if (eoi === undefined) {
          return undefined;
        }
        return { format: "jpeg", bytes: bytes.subarray(soiAt, eoi + 2) };
      }
    }
  } catch {
    return undefined;
  }
}

// Scans a packet's bytes for the first whole PNG or JPEG payload. A single left-to-right walk checks both signatures at every position, so whichever this reaches first genuinely is first -- there is no need to locate both signatures independently and then compare their positions. Both absent is the common case (a WPG or OLE payload) and answers undefined.
export function scanImagePayload(
  bytes: Uint8Array,
): WpdImagePayload | undefined {
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytesMatchAt(bytes, index, PNG_SIGNATURE)) {
      return scanPng(bytes, index);
    }
    if (bytesMatchAt(bytes, index, JPEG_SOI)) {
      return scanJpeg(bytes, index);
    }
  }
  return undefined;
}
