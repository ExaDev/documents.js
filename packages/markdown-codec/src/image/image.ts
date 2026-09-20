// Image reference resolution: an inline `![alt](src "title")` or reference-style `![alt][ref]` image's dimensions, for a data: URI image whose bytes are already in memory -- the markdown-side counterpart to document-schema.js's ContentImageBlock.widthPt/heightPt, which src/lower/image.ts's own px-to-pt conversion populates from these.
//
// This module exports readImageDimensions (a hand-written PNG/JPEG header reader -- no dependency, no filesystem access, the bytes always come from an already-decoded data: URI or a caller-supplied MarkdownImageResolver, never a path this module reads itself), detectImageFormat (the same PNG/JPEG signature check readImageDimensions already does internally, exposed so src/lower/image.ts can pick ContentImageBlock's own `format` field without a second, divergent signature check), and an isomorphic base64 encode/decode pair (no Node Buffer -- this package is platform-neutral per tsdown.config.ts, matching pdf-codec's own src/util/base64.ts precedent) for a `data:image/png;base64,...`/`data:image/jpeg;base64,...` URI's own payload and for re-encoding resolved image bytes back into one on write.

export interface ImageDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}

export type ImageFormat = "png" | "jpeg";

// --- Isomorphic base64 (Uint8Array <-> string), no Node Buffer. ---

const BASE64_TABLE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Every byte value a character code can take, so the decode table covers the whole `charCodeAt` range a single-byte character can produce without a bounds check of its own.
const CHAR_CODE_VALUES = 256;
// The table entry for a character that is not in the alphabet at all. Any value above 63 would do, since a real six-bit value can never reach it.
const BASE64_INVALID = 0xff;

const BASE64_DECODE: Uint8Array = (() => {
  const map = new Uint8Array(CHAR_CODE_VALUES).fill(BASE64_INVALID);
  for (let index = 0; index < BASE64_TABLE.length; index += 1) {
    map[BASE64_TABLE.charCodeAt(index)] = index;
  }
  return map;
})();

const BASE64_PADDING = "=";
const BASE64_PADDING_CODE = BASE64_PADDING.charCodeAt(0);
// Base64's own quantum: three bytes carry twenty-four bits, spelled by four characters of six bits each.
const BASE64_GROUP_BYTES = 3;
const BASE64_GROUP_CHARS = 4;
const BASE64_CHAR_BITS = 6;
const BASE64_CHAR_MASK = 0x3f;
// A group of one data character carries six bits, which is not enough for even one byte, so such a group is malformed rather than merely short.
const BASE64_MIN_GROUP_CHARS = 2;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;

export function bytesToBase64(bytes: Uint8Array): string {
  const { length } = bytes;
  let out = "";
  for (let index = 0; index < length; index += BASE64_GROUP_BYTES) {
    const groupLength = Math.min(BASE64_GROUP_BYTES, length - index);
    // Only the bytes that actually exist are read, then left-aligned within the twenty-four bits a whole group occupies, so each character below reads a fixed six-bit slice whatever the group's length and no read ever runs past the end of the input.
    let group = 0;
    for (let offset = 0; offset < groupLength; offset += 1) {
      group = (group << BITS_PER_BYTE) | bytes[index + offset]!;
    }
    group <<= BITS_PER_BYTE * (BASE64_GROUP_BYTES - groupLength);
    // A group of n bytes spells n + 1 characters, since n bytes carry 8n bits and each character consumes six; padding fills the rest of the four-character quantum.
    for (let charIndex = 0; charIndex <= groupLength; charIndex += 1) {
      const shift = BASE64_CHAR_BITS * (BASE64_GROUP_CHARS - 1 - charIndex);
      out += BASE64_TABLE.charAt((group >> shift) & BASE64_CHAR_MASK);
    }
    out += BASE64_PADDING.repeat(BASE64_GROUP_BYTES - groupLength);
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  // Characters outside the alphabet are not data: the line breaks a wrapped data: URI payload carries, and any other stray whitespace, are dropped before anything is decoded.
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  // Padding carries no bits, so the data is whatever precedes the trailing run of it. `charCodeAt` before the start of a string returns NaN, which is not the padding code, so this stops at the start of the string without a bounds guard of its own.
  let dataLength = clean.length;
  while (clean.charCodeAt(dataLength - 1) === BASE64_PADDING_CODE) {
    dataLength -= 1;
  }
  // Four data characters carry three whole bytes, and each leftover character a further six bits, so this is the exact decoded length: the array allocated here is the array returned, with no trailing trim that could hide a wrong size.
  const out = new Uint8Array(
    Math.floor((dataLength * BASE64_GROUP_BYTES) / BASE64_GROUP_CHARS),
  );
  let position = 0;
  for (let index = 0; index < dataLength; index += BASE64_GROUP_CHARS) {
    const groupChars = Math.min(BASE64_GROUP_CHARS, dataLength - index);
    if (groupChars < BASE64_MIN_GROUP_CHARS) {
      throw new Error("invalid base64 input");
    }
    let group = 0;
    for (let offset = 0; offset < groupChars; offset += 1) {
      const code = BASE64_DECODE[clean.charCodeAt(index + offset)]!;
      // The only alphabet-surviving character that decodes to nothing is padding, so this rejects a '=' anywhere other than the trailing run already stripped above.
      if (code === BASE64_INVALID) {
        throw new Error("invalid base64 input");
      }
      group = (group << BASE64_CHAR_BITS) | code;
    }
    // n characters carry 6n bits, of which only whole bytes are kept: the leftover low bits belong to a byte this group does not finish.
    const groupBytes = Math.floor(
      (groupChars * BASE64_CHAR_BITS) / BITS_PER_BYTE,
    );
    group >>= groupChars * BASE64_CHAR_BITS - groupBytes * BITS_PER_BYTE;
    for (let byteIndex = groupBytes - 1; byteIndex >= 0; byteIndex -= 1) {
      out[position + byteIndex] = group & BYTE_MASK;
      group >>= BITS_PER_BYTE;
    }
    position += groupBytes;
  }
  return out;
}

// A big-endian 16-bit field. A byte the input does not reach reads as undefined at runtime, which both the shift and the or coerce to zero, so a field a truncated file cannot hold reads as zero rather than throwing, which is exactly what readJpegDimensions relies on for a segment's own length field.
function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) & 0xffff;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// signature(8) + IHDR chunk length(4) + 'IHDR'(4) + width(4) + height(4) -- the minimum a PNG needs before its own dimensions are readable.
const PNG_HEADER_BYTES = 24;

// A short input needs no length check of its own: a signature byte the input does not reach reads as undefined, which equals no byte value.
function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

// As in isPng, a byte the input does not reach reads as undefined and equals nothing, so the length needs no check of its own.
function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

// IHDR is always the very first chunk after the signature (PNG spec section 5.6, "IHDR must appear first") -- no chunk-walking is needed at all.
function readPngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < PNG_HEADER_BYTES) {
    return undefined;
  }
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    // not 'IHDR'
    return undefined;
  }
  return {
    widthPx: readUint32BE(bytes, 16),
    heightPx: readUint32BE(bytes, 20),
  };
}

// Start-Of-Frame markers (0xC0-0xCF), excluding 0xC4 (DHT, a Huffman table, not a frame header), 0xC8 (JPG, reserved), and 0xCC (DAC, an arithmetic-coding conditioning table) -- despite sitting in the same numeric run, none of these three carry width/height.
function isStartOfFrameMarker(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcf) {
    return false;
  }
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

// Markers with no following length field at all: SOI (0xD8), EOI (0xD9), the eight restart markers RST0-RST7 (0xD0-0xD7), and TEM (0x01).
function hasNoLengthField(marker: number): boolean {
  return (
    marker === 0xd8 ||
    marker === 0xd9 ||
    marker === 0x01 ||
    (marker >= 0xd0 && marker <= 0xd7)
  );
}

// Walks JPEG marker segments from the SOI (0xFFD8) until a Start-Of-Frame marker's own segment: length(2, BE) + precision(1) + height(2, BE) + width(2, BE) -- height before width, unlike PNG. Every other marker segment is skipped by its own declared length (which includes the 2 length bytes themselves).
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
    if (byte !== 0xff) {
      offset += 1;
      continue;
    }
    // A marker may be preceded by a run of extra 0xFF fill bytes -- the marker itself is the first non-0xFF byte after the initial 0xFF.
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === 0xff) {
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
      if (offset + 7 > bytes.length) {
        return undefined;
      }
      const heightPx = readUint16BE(bytes, offset + 3);
      const widthPx = readUint16BE(bytes, offset + 5);
      return { widthPx, heightPx };
    }
    if (marker === 0xda) {
      // Start Of Scan reached with no frame header found -- malformed, or a marker this reader doesn't recognise as a frame header.
      return undefined;
    }
    offset += length;
  }
}

// The same signature check readImageDimensions already makes internally to choose which reader to run, exposed so a caller (src/lower/image.ts) can pick ContentImageBlock's own `format` field from the identical bytes without a second, potentially-divergent sniff of its own. Returns undefined for anything that is neither a PNG nor a JPEG -- ContentImageBlockSchema's own `format` field has no third member to fall back to.
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
