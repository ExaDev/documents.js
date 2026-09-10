// -- Embedded image payloads inside a box's content prefix packet --
//
// A box whose function-level override names IMAGE content (stream/box.ts's type 3) points at a prefix packet whose layout this reader has no specification for -- WordPerfect carried several image container spellings across its versions (raw WPG2 bitmaps, "Image: WP" packets, later straight PNG/JPEG embeds). Rather than guess at any container header, this module scans the packet's raw bytes for a whole, well-formed PNG or JPEG payload by signature and structure -- the same magic-driven discipline pdf-codec's byte schemas apply -- and lifts exactly the byte span the structure itself delimits. A packet carrying no such payload is honestly reported as unresolved by the caller rather than approximated.

import { byteAt } from "../bytes/view";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SOI = [0xff, 0xd8] as const;

export interface WpdImagePayload {
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array;
}

// The first byte offset at which `needle` occurs in `bytes` at or after `from`, or undefined. A plain scan: packet payloads are small (an embedded figure), and no container this module knows of would justify a fancier search.
function indexOf(
  bytes: Uint8Array,
  needle: readonly number[],
  from: number,
): number | undefined {
  outer: for (let i = from; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return undefined;
}

function scanPng(
  bytes: Uint8Array,
  signatureAt: number,
): WpdImagePayload | undefined {
  // Walk the chunk chain from the signature: each chunk is [length (big-endian u32)][type][data][crc], and the image ends after IEND's own crc. A length that runs past the buffer is a truncated or malformed embed -- undefined, not a best-effort span.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = signatureAt + PNG_SIGNATURE.length;
  for (;;) {
    if (cursor + 8 > bytes.length) {
      return undefined;
    }
    const length = view.getUint32(cursor);
    const type = String.fromCharCode(
      byteAt(bytes, cursor + 4),
      byteAt(bytes, cursor + 5),
      byteAt(bytes, cursor + 6),
      byteAt(bytes, cursor + 7),
    );
    cursor += 8 + length + 4;
    if (cursor > bytes.length) {
      return undefined;
    }
    if (type === "IEND") {
      return { format: "png", bytes: bytes.subarray(signatureAt, cursor) };
    }
  }
}

function scanJpeg(
  bytes: Uint8Array,
  soiAt: number,
): WpdImagePayload | undefined {
  // Walk the marker segments from SOI: each non-standalone marker carries its own big-endian length; SOS opens entropy-coded data that only ends at EOI (FF D9). RSTn and TEM are standalone; a fill FF before a marker is legal and skipped.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = soiAt + JPEG_SOI.length;
  for (;;) {
    if (cursor >= bytes.length) {
      return undefined;
    }
    if (byteAt(bytes, cursor) !== 0xff) {
      return undefined;
    }
    while (cursor < bytes.length && byteAt(bytes, cursor) === 0xff) {
      cursor += 1;
    }
    if (cursor >= bytes.length) {
      return undefined;
    }
    const marker = byteAt(bytes, cursor);
    cursor += 1;
    const standalone =
      marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
    if (standalone) {
      continue;
    }
    if (marker === 0xd9) {
      return { format: "jpeg", bytes: bytes.subarray(soiAt, cursor) };
    }
    if (cursor + 2 > bytes.length) {
      return undefined;
    }
    const length = view.getUint16(cursor);
    if (length < 2 || cursor + length > bytes.length) {
      return undefined;
    }
    cursor += length;
    if (marker === 0xda) {
      // Entropy-coded data: scan byte-wise for the EOI marker (a preceding 0xff run is the marker prefix). A stuffed FF inside the entropy stream is always followed by a non-zero byte, so FF D9 can only be EOI.
      const eoi = indexOf(bytes, [0xff, 0xd9], cursor);
      if (eoi === undefined) {
        return undefined;
      }
      return { format: "jpeg", bytes: bytes.subarray(soiAt, eoi + 2) };
    }
  }
}

// Scans a packet's bytes for the first whole PNG or JPEG payload. The two signatures cannot be confused (PNG's opens 0x89..., JPEG's 0xFF D8), and the structural walk -- not the signature alone -- decides where the payload ends, so trailing container bytes after the image never leak into the lift.
export function scanImagePayload(
  bytes: Uint8Array,
): WpdImagePayload | undefined {
  const pngAt = indexOf(bytes, PNG_SIGNATURE, 0);
  const jpegAt = indexOf(bytes, JPEG_SOI, 0);
  // Whichever signature appears first wins; if only one exists, that one. Both absent is the common case (a WPG or OLE payload) and answers undefined.
  if (pngAt !== undefined && (jpegAt === undefined || pngAt < jpegAt)) {
    return scanPng(bytes, pngAt);
  }
  if (jpegAt !== undefined) {
    return scanJpeg(bytes, jpegAt);
  }
  return undefined;
}
