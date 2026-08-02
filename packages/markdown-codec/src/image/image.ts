// Image reference resolution: an inline `![alt](src "title")` or reference-style `![alt][ref]` image's dimensions, for a data: URI image whose bytes are already in memory -- the markdown-side counterpart to document-schema.js's ContentImageBlock.widthPt/heightPt, which src/lower/image.ts's own px-to-pt conversion populates from these.
//
// This module exports readImageDimensions (a hand-written PNG/JPEG header reader -- no dependency, no filesystem access, the bytes always come from an already-decoded data: URI or a caller-supplied MarkdownImageResolver, never a path this module reads itself), detectImageFormat (the same PNG/JPEG signature check readImageDimensions already does internally, exposed so src/lower/image.ts can pick ContentImageBlock's own `format` field without a second, divergent signature check), and an isomorphic base64 encode/decode pair (no Node Buffer -- this package is platform-neutral per tsdown.config.ts, matching pdf-codec's own src/util/base64.ts precedent) for a `data:image/png;base64,...`/`data:image/jpeg;base64,...` URI's own payload and for re-encoding resolved image bytes back into one on write.

export interface ImageDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}

export type ImageFormat = 'png' | 'jpeg';

// --- Isomorphic base64 (Uint8Array <-> string), no Node Buffer. ---

const BASE64_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_DECODE: Uint8Array = (() => {
  const map = new Uint8Array(256).fill(255);
  for (let index = 0; index < BASE64_TABLE.length; index += 1) {
    map[BASE64_TABLE.charCodeAt(index)] = index;
  }
  return map;
})();

const BASE64_PADDING_CODE = 61; // '='

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const { length } = bytes;
  for (let index = 0; index < length; index += 3) {
    const b0 = bytes[index]!;
    const b1 = index + 1 < length ? bytes[index + 1]! : 0;
    const b2 = index + 2 < length ? bytes[index + 2]! : 0;
    out += BASE64_TABLE[b0 >> 2];
    out += BASE64_TABLE[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += index + 1 < length ? BASE64_TABLE[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += index + 2 < length ? BASE64_TABLE[b2 & 0x3f] : '=';
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const { length } = clean;
  const out = new Uint8Array(Math.floor((length * 3) / 4));
  let position = 0;
  for (let index = 0; index < length; index += 4) {
    const c0 = BASE64_DECODE[clean.charCodeAt(index)]!;
    const c1 = BASE64_DECODE[clean.charCodeAt(index + 1)]!;
    const code2 = clean.charCodeAt(index + 2);
    const code3 = clean.charCodeAt(index + 3);
    if (c0 === 255 || c1 === 255) {
      throw new Error('invalid base64 input');
    }
    out[position] = (c0 << 2) | (c1 >> 4);
    position += 1;
    if (code2 !== BASE64_PADDING_CODE) {
      const d2 = BASE64_DECODE[code2]!;
      out[position] = ((c1 & 0x0f) << 4) | (d2 >> 2);
      position += 1;
      if (code3 !== BASE64_PADDING_CODE) {
        const d3 = BASE64_DECODE[code3]!;
        out[position] = ((d2 & 0x03) << 6) | d3;
        position += 1;
      }
    }
  }
  return out.subarray(0, position);
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) & 0xffff;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// signature(8) + IHDR chunk length(4) + 'IHDR'(4) + width(4) + height(4) -- the minimum a PNG needs before its own dimensions are readable.
const PNG_HEADER_BYTES = 24;

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

// IHDR is always the very first chunk after the signature (PNG spec section 5.6, "IHDR must appear first") -- no chunk-walking is needed at all.
function readPngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < PNG_HEADER_BYTES) {
    return undefined;
  }
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    // not 'IHDR'
    return undefined;
  }
  return { widthPx: readUint32BE(bytes, 16), heightPx: readUint32BE(bytes, 20) };
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
  return marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

// Walks JPEG marker segments from the SOI (0xFFD8) until a Start-Of-Frame marker's own segment: length(2, BE) + precision(1) + height(2, BE) + width(2, BE) -- height before width, unlike PNG. Every other marker segment is skipped by its own declared length (which includes the 2 length bytes themselves).
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
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
    if (offset + 2 > bytes.length) {
      return undefined;
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
  return undefined;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

// The same signature check readImageDimensions already makes internally to choose which reader to run, exposed so a caller (src/lower/image.ts) can pick ContentImageBlock's own `format` field from the identical bytes without a second, potentially-divergent sniff of its own. Returns undefined for anything that is neither a PNG nor a JPEG -- ContentImageBlockSchema's own `format` field has no third member to fall back to.
export function detectImageFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (isPng(bytes)) {
    return 'png';
  }
  return isJpeg(bytes) ? 'jpeg' : undefined;
}

export function readImageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (isPng(bytes)) {
    return readPngDimensions(bytes);
  }
  return readJpegDimensions(bytes);
}
