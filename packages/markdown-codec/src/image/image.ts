// Image reference resolution: an inline `![alt](src "title")` or reference-style `![alt][ref]` image's dimensions, for a data: URI image whose bytes are already in memory — the markdown-side counterpart to document-schema.js's ContentImageBlock.widthPt/heightPt, which src/lower/image.ts's own px-to-pt conversion populates from these.
//
// This module exports readImageDimensions (a hand-written PNG/JPEG header reader with no dependency and no filesystem access: the bytes always come from an already-decoded data: URI or a caller-supplied MarkdownImageResolver, never a path this module reads itself) and detectImageFormat (the same PNG/JPEG signature check readImageDimensions already does internally, exposed so src/lower/image.ts can pick ContentImageBlock's own `format` field without a second, divergent signature check). The base64 a `data:image/png;base64,...` URI's payload is decoded from, and re-encoded into on write, comes from byte-codec, which holds the family's one implementation.

export interface ImageDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}

export type ImageFormat = "png" | "jpeg";

const BITS_PER_BYTE = 8;
const TWO_BYTE_SHIFT = 16;
const THREE_BYTE_SHIFT = 24;
const UINT16_MASK = 0xffff;
// The 4th (least-significant) byte's own offset in a big-endian uint32 read.
const UINT32_LOW_BYTE_OFFSET = 3;

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << BITS_PER_BYTE) | bytes[offset + 1]!) & UINT16_MASK;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << THREE_BYTE_SHIFT) |
      (bytes[offset + 1]! << TWO_BYTE_SHIFT) |
      (bytes[offset + 2]! << BITS_PER_BYTE) |
      bytes[offset + UINT32_LOW_BYTE_OFFSET]!) >>>
    0
  );
}

// PNG's own 8-byte file signature: a byte with the high bit set (so a 7-bit text-mode transfer corrupts it detectably), then "PNG\r\n\x1a\n", a CRLF, a DOS EOF marker, and a final LF, each chosen to detect a different common file-transfer corruption.
const PNG_SIGNATURE_HIGH_BIT_MARKER = 0x89;
const PNG_SIGNATURE = [
  PNG_SIGNATURE_HIGH_BIT_MARKER,
  ...Array.from("PNG\r\n\x1a\n", (char) => char.charCodeAt(0)),
];
// signature(8) + IHDR chunk length(4) + 'IHDR'(4) + width(4) + height(4) — the minimum a PNG needs before its own dimensions are readable.
const PNG_HEADER_BYTES = 24;
const IHDR_CHUNK_TYPE_OFFSET = 12;
const IHDR_TYPE_BYTES = Array.from("IHDR", (char) => char.charCodeAt(0));
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;

// A short input needs no length check of its own: a signature byte the input does not reach reads as undefined, which equals no byte value.
function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

const JPEG_MARKER_PREFIX = 0xff;
const JPEG_SOI = 0xd8;
const JPEG_EOI = 0xd9;
const JPEG_TEM = 0x01;
const JPEG_RST_MIN = 0xd0;
const JPEG_RST_MAX = 0xd7;
const JPEG_SOS = 0xda;
const JPEG_SOF_MARKER_MIN = 0xc0;
const JPEG_SOF_MARKER_MAX = 0xcf;
const JPEG_DHT_MARKER = 0xc4; // Huffman table, not a frame header
const JPEG_JPG_RESERVED_MARKER = 0xc8; // reserved, not a frame header
const JPEG_DAC_MARKER = 0xcc; // arithmetic-coding conditioning table, not a frame header
// A Start-Of-Frame segment's own fixed fields after its 2-byte marker: length(2, BE) + precision(1) + height(2, BE) + width(2, BE).
const JPEG_SOF_SEGMENT_MIN_LENGTH = 7;
const JPEG_SOF_HEIGHT_OFFSET = 3; // past length(2) + precision(1)
const JPEG_SOF_WIDTH_OFFSET = 5; // past length(2) + precision(1) + height(2)

// As in isPng, a byte the input does not reach reads as undefined and equals nothing, so the length needs no check of its own.
function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === JPEG_MARKER_PREFIX && bytes[1] === JPEG_SOI;
}

// IHDR is always the very first chunk after the signature (PNG spec section 5.6, "IHDR must appear first") — no chunk-walking is needed at all.
function readPngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < PNG_HEADER_BYTES) {
    return undefined;
  }
  const isIhdr = IHDR_TYPE_BYTES.every(
    (byte, index) => bytes[IHDR_CHUNK_TYPE_OFFSET + index] === byte,
  );
  if (!isIhdr) {
    return undefined;
  }
  return {
    widthPx: readUint32BE(bytes, PNG_WIDTH_OFFSET),
    heightPx: readUint32BE(bytes, PNG_HEIGHT_OFFSET),
  };
}

// Start-Of-Frame markers (0xC0-0xCF), excluding 0xC4 (DHT, a Huffman table, not a frame header), 0xC8 (JPG, reserved), and 0xCC (DAC, an arithmetic-coding conditioning table) — despite sitting in the same numeric run, none of these three carry width/height.
function isStartOfFrameMarker(marker: number): boolean {
  if (marker < JPEG_SOF_MARKER_MIN || marker > JPEG_SOF_MARKER_MAX) {
    return false;
  }
  return (
    marker !== JPEG_DHT_MARKER &&
    marker !== JPEG_JPG_RESERVED_MARKER &&
    marker !== JPEG_DAC_MARKER
  );
}

// Markers with no following length field at all: SOI (0xD8), EOI (0xD9), the eight restart markers RST0-RST7 (0xD0-0xD7), and TEM (0x01).
function hasNoLengthField(marker: number): boolean {
  return (
    marker === JPEG_SOI ||
    marker === JPEG_EOI ||
    marker === JPEG_TEM ||
    (marker >= JPEG_RST_MIN && marker <= JPEG_RST_MAX)
  );
}

// Walks JPEG marker segments from the SOI (0xFFD8) until a Start-Of-Frame marker's own segment: length(2, BE) + precision(1) + height(2, BE) + width(2, BE) — height before width, unlike PNG. Every other marker segment is skipped by its own declared length (which includes the 2 length bytes themselves).
//
// A truncated file needs no length checks along the way, only the one end-of-input check the walk already makes each pass. A length field the input is too short to hold reads its missing bytes as zero (see readUint16BE). That either leaves the offset on the length field itself, whose own leading byte must then have been zero, so the next pass walks past it a byte at a time; or it pushes the offset straight past the end, which is also what a declared length that overshoots does. Either way the walk arrives at an offset the input does not reach, which is where a truncated segment is meant to end up.
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (!isJpeg(bytes)) {
    return undefined;
  }
  let offset = 2;
  for (;;) {
    const byte = bytes[offset];
    if (byte === undefined) {
      return undefined;
    }
    if (byte !== JPEG_MARKER_PREFIX) {
      offset += 1;
      continue;
    }
    // A marker may be preceded by a run of extra 0xFF fill bytes — the marker itself is the first non-0xFF byte after the initial 0xFF.
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === JPEG_MARKER_PREFIX) {
      markerOffset += 1;
    }
    const marker = bytes[markerOffset];
    if (marker === undefined) {
      return undefined;
    }
    offset = markerOffset + 1;
    if (hasNoLengthField(marker)) {
      continue;
    }
    const length = readUint16BE(bytes, offset);
    if (isStartOfFrameMarker(marker)) {
      if (offset + JPEG_SOF_SEGMENT_MIN_LENGTH > bytes.length) {
        return undefined;
      }
      const heightPx = readUint16BE(bytes, offset + JPEG_SOF_HEIGHT_OFFSET);
      const widthPx = readUint16BE(bytes, offset + JPEG_SOF_WIDTH_OFFSET);
      return { widthPx, heightPx };
    }
    if (marker === JPEG_SOS) {
      // Start Of Scan reached with no frame header found — malformed, or a marker this reader doesn't recognise as a frame header.
      return undefined;
    }
    offset += length;
  }
}

// The same signature check readImageDimensions already makes internally to choose which reader to run, exposed so a caller (src/lower/image.ts) can pick ContentImageBlock's own `format` field from the identical bytes without a second, potentially-divergent sniff of its own. Returns undefined for anything that is neither a PNG nor a JPEG — ContentImageBlockSchema's own `format` field has no third member to fall back to.
export function detectImageFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (isPng(bytes)) {
    return "png";
  }
  return isJpeg(bytes) ? "jpeg" : undefined;
}

export function readImageDimensions(
  bytes: Uint8Array,
): ImageDimensions | undefined {
  if (isPng(bytes)) {
    return readPngDimensions(bytes);
  }
  return readJpegDimensions(bytes);
}
