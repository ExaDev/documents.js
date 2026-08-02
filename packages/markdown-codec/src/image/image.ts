// Image reference resolution: an inline `![alt](src "title")` or reference-style `![alt][ref]` image's dimensions, for a data: URI image whose bytes are already in memory -- the markdown-side counterpart to document-schema.js's ContentImageBlock.widthPt/heightPt, which src/lower's own px-to-pt conversion will populate from these once that stage exists.
//
// This module currently exports only readImageDimensions, a hand-written PNG/JPEG header reader (no dependency, no filesystem access -- the bytes always come from an already-decoded data: URI, never a path). Resolving a reference-style image's target against the document's own link-reference-definition table, and remote (http/https/relative-path) image handling, are not implemented yet -- both belong to src/block/src/inline once those stages parse image syntax at all.

export interface ImageDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
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

export function readImageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (isPng(bytes)) {
    return readPngDimensions(bytes);
  }
  return readJpegDimensions(bytes);
}
