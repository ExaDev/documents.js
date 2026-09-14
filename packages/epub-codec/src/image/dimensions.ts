// Image format detection and pixel dimensions for a manifest image's raw bytes -- a hand-written PNG/JPEG header reader, mirroring markdown-codec's own src/image/image.ts exactly (the family's one other codec needing dimensions from arbitrary image bytes with no format-native explicit sizing metadata to read instead: docx/pptx/odt/odp/ods carry an explicit display size on their own image anchor, so ooxml.js and odf.js never need this at all). Deliberately NOT a byte-codec dependency: byte-codec's own image/jpeg-info.ts is exactly this (header-only, no sample decoding) and would be a clean reuse for the JPEG half, but its PNG half (image/png-decode.ts) is a FULL pixel decode -- normalising every PNG colour type to 8-bit gray/RGB planes for a PDF Image XObject's own needs, work this package has no use for and that pays real CPU per manifest image just to read four bytes of IHDR width/height, while also risking rejecting a real PNG variant this package's own IHDR-only read would tolerate. Depending on byte-codec for one half only (JPEG) and hand-writing the other (PNG) would gain nothing over hand-writing both, since JPEG marker scanning and PNG IHDR reading are each roughly the same amount of code -- so this module owns both directly, exactly as markdown-codec's does.

export interface ImageDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}

export type EpubImageFormat = "png" | "jpeg";

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)) & 0xffff;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// signature(8) + IHDR chunk length(4) + 'IHDR'(4) + width(4) + height(4) -- the minimum a PNG needs before its own dimensions are readable.
const PNG_HEADER_BYTES = 24;

// No separate `bytes.length < PNG_SIGNATURE.length` guard: an index past the end of `bytes` reads as `undefined`, which can never equal one of the signature's own real byte values, so `.every()` already returns false on its own the moment a short array runs out of bytes to compare.
function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
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
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // No separate `bytes.length < 4` clause: bytes[0]/bytes[1] already read as undefined past the end of a shorter array, which can never equal 0xff/0xd8, and every later read in this function is equally undefined-safe (via ?? 0 or its own explicit bounds check), so a short array is already rejected, or the loop below already terminates cleanly, without this clause's help.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }
  let offset = 2;
  // No `offset < bytes.length` loop bound: bytes[offset] reads as undefined once offset runs past the end, and that undefined-safe read is the loop's own real termination condition below, so a separate length comparison would only ever be a redundant restatement of it.
  for (;;) {
    const currentByte = bytes[offset];
    if (currentByte === undefined) {
      return undefined;
    }
    if (currentByte !== 0xff) {
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
    // No separate `offset + 2 > bytes.length` guard here: for a Start-Of-Frame marker, the deeper `offset + 7 > bytes.length` check just below already rejects every truncation this one would (7 is always the larger bound), and for any other marker, readUint16BE's own ?? 0 fallback yields a length that only ever advances `offset` further past `bytes.length`, which the loop's own undefined-read check above already terminates on next iteration.
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

// No separate `bytes.length >= 2` guard: bytes[0]/bytes[1] already read as undefined past the end of a shorter array, which can never equal 0xff/0xd8, so the equality checks alone already reject a too-short array.
function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

// Exposed so a caller can pick ContentImageBlock's own `format` field from the identical bytes without a second, potentially-divergent sniff of its own. Returns undefined for anything that is neither a PNG nor a JPEG -- ContentImageBlockSchema's own `format` field has no third member to fall back to (a GIF or SVG manifest image, both legal in EPUB, has no representation there at all -- see the README's own documented gap).
export function detectImageFormat(
  bytes: Uint8Array,
): EpubImageFormat | undefined {
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

// The CSS reference-pixel definition (1px = 1/96in), the same px<->pt conversion browsers themselves use to lay out an EPUB's own XHTML/CSS -- document-schema.js's ContentImageBlock is point-based throughout (matching the rest of this family's PDF/docx/ODF unit convention), matching markdown-codec's own identical constant and reasoning: a decoded PNG/JPEG header only ever reports pixel dimensions, and EPUB's own XHTML carries no reliable point-based sizing of its own (an `<img>` may declare width/height attributes in CSS pixels, or none at all, with actual display size left to the reading system's own CSS layout) -- so the image's own natural pixel size, converted through this one fixed ratio, is the one dimension every manifest image reliably has.
const CSS_PIXELS_PER_INCH = 96;
const POINTS_PER_INCH = 72;
export const POINTS_PER_PIXEL = POINTS_PER_INCH / CSS_PIXELS_PER_INCH;
