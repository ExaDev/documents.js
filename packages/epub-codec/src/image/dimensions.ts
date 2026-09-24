// Image format detection and pixel dimensions for a manifest image's raw bytes — a hand-written PNG/JPEG header reader, mirroring markdown-codec's own src/image/image.ts exactly (the family's one other codec needing dimensions from arbitrary image bytes with no format-native explicit sizing metadata to read instead: docx/pptx/odt/odp/ods carry an explicit display size on their own image anchor, so ooxml.js and odf.js never need this at all). Deliberately NOT a byte-codec dependency: byte-codec's own image/jpeg-info.ts is exactly this (header-only, no sample decoding) and would be a clean reuse for the JPEG half, but its PNG half (image/png-decode.ts) is a FULL pixel decode — normalising every PNG colour type to 8-bit gray/RGB planes for a PDF Image XObject's own needs, work this package has no use for and that pays real CPU per manifest image just to read four bytes of IHDR width/height, while also risking rejecting a real PNG variant this package's own IHDR-only read would tolerate. Depending on byte-codec for one half only (JPEG) and hand-writing the other (PNG) would gain nothing over hand-writing both, since JPEG marker scanning and PNG IHDR reading are each roughly the same amount of code — so this module owns both directly, exactly as markdown-codec's does.

export interface ImageDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}

export type EpubImageFormat = "png" | "jpeg";

const BITS_PER_BYTE = 8;
const TWO_BYTES_BITS = 16;
const THREE_BYTES_BITS = 24;
const UINT16_MASK = 0xffff;
const FOURTH_BYTE_INDEX = 3;

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << BITS_PER_BYTE) | (bytes[offset + 1] ?? 0)) &
    UINT16_MASK
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << THREE_BYTES_BITS) |
      ((bytes[offset + 1] ?? 0) << TWO_BYTES_BITS) |
      ((bytes[offset + 2] ?? 0) << BITS_PER_BYTE) |
      (bytes[offset + FOURTH_BYTE_INDEX] ?? 0)) >>>
    0
  );
}

// PNG spec section 5.2: a high-bit marker byte chosen to reduce the chance of mistaking a text file for a PNG, then "PNG" in ASCII, then a CR, an LF, a byte that trips a naive Unix/DOS line-ending conversion, and a second LF.
const PNG_SIGNATURE_HIGH_BIT_MARKER = 0x89;
const PNG_SIGNATURE_P = 0x50;
const PNG_SIGNATURE_N = 0x4e;
const PNG_SIGNATURE_G = 0x47;
const PNG_SIGNATURE_CR = 0x0d;
const PNG_SIGNATURE_LF = 0x0a;
const PNG_SIGNATURE_LINE_ENDING_DETECTOR = 0x1a;
const PNG_SIGNATURE = [
  PNG_SIGNATURE_HIGH_BIT_MARKER,
  PNG_SIGNATURE_P,
  PNG_SIGNATURE_N,
  PNG_SIGNATURE_G,
  PNG_SIGNATURE_CR,
  PNG_SIGNATURE_LF,
  PNG_SIGNATURE_LINE_ENDING_DETECTOR,
  PNG_SIGNATURE_LF,
];

const PNG_CHUNK_LENGTH_FIELD_BYTES = 4;
const PNG_CHUNK_TYPE_FIELD_BYTES = 4;
const UINT32_BYTES = 4;
// Where the IHDR chunk's own 4-byte type tag starts: right after the 8-byte signature and the chunk's own 4-byte length field.
const PNG_CHUNK_TYPE_OFFSET =
  PNG_SIGNATURE.length + PNG_CHUNK_LENGTH_FIELD_BYTES;
const PNG_IHDR_WIDTH_OFFSET =
  PNG_CHUNK_TYPE_OFFSET + PNG_CHUNK_TYPE_FIELD_BYTES;
const PNG_IHDR_HEIGHT_OFFSET = PNG_IHDR_WIDTH_OFFSET + UINT32_BYTES;
// signature + chunk length + chunk type + width + height — the minimum a PNG needs before its own dimensions are readable.
const PNG_HEADER_BYTES = PNG_IHDR_HEIGHT_OFFSET + UINT32_BYTES;

// No separate `bytes.length < PNG_SIGNATURE.length` guard: an index past the end of `bytes` reads as `undefined`, which can never equal one of the signature's own real byte values, so `.every()` already returns false on its own the moment a short array runs out of bytes to compare.
function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

const IHDR_TAG = "IHDR";

// Avoids spreading or splitting IHDR_TAG (both mishandle non-ASCII input in general, even though this literal is pure ASCII) by walking its own charCodeAt values by numeric index instead.
function matchesIhdrTag(bytes: Uint8Array, offset: number): boolean {
  for (let index = 0; index < IHDR_TAG.length; index += 1) {
    if (bytes[offset + index] !== IHDR_TAG.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

// IHDR is always the very first chunk after the signature (PNG spec section 5.6, "IHDR must appear first") — no chunk-walking is needed at all.
function readPngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < PNG_HEADER_BYTES) {
    return undefined;
  }
  if (!matchesIhdrTag(bytes, PNG_CHUNK_TYPE_OFFSET)) {
    return undefined;
  }
  return {
    widthPx: readUint32BE(bytes, PNG_IHDR_WIDTH_OFFSET),
    heightPx: readUint32BE(bytes, PNG_IHDR_HEIGHT_OFFSET),
  };
}

const JPEG_MARKER_PREFIX = 0xff;
const JPEG_MARKER_SOI = 0xd8; // Start Of Image.
const JPEG_MARKER_EOI = 0xd9; // End Of Image.
const JPEG_MARKER_TEM = 0x01; // Temporary marker, reserved.
const JPEG_MARKER_RST_MIN = 0xd0; // RST0.
const JPEG_MARKER_RST_MAX = 0xd7; // RST7.
const JPEG_MARKER_SOS = 0xda; // Start Of Scan.
const JPEG_SOF_MARKER_MIN = 0xc0;
const JPEG_SOF_MARKER_MAX = 0xcf;
const JPEG_MARKER_DHT = 0xc4; // Define Huffman Table, a Huffman table, not a frame header.
const JPEG_MARKER_JPG_RESERVED = 0xc8; // JPG, reserved.
const JPEG_MARKER_DAC = 0xcc; // Define Arithmetic Coding conditioning, not a frame header.

// SOI (2 bytes: the 0xFF prefix plus the marker byte itself).
const JPEG_SOI_LENGTH_BYTES = 2;
const JPEG_SOF_LENGTH_FIELD_BYTES = 2;
const JPEG_SOF_PRECISION_FIELD_BYTES = 1;
// Offsets within a Start-Of-Frame segment, counted from right after its own marker byte: length(2, BE) + precision(1) + height(2, BE) + width(2, BE) — height before width, unlike PNG.
const JPEG_SOF_HEIGHT_OFFSET =
  JPEG_SOF_LENGTH_FIELD_BYTES + JPEG_SOF_PRECISION_FIELD_BYTES;
const JPEG_SOF_WIDTH_OFFSET = JPEG_SOF_HEIGHT_OFFSET + 2;
const JPEG_SOF_SEGMENT_MIN_BYTES = JPEG_SOF_WIDTH_OFFSET + 2;

// Start-Of-Frame markers, excluding DHT, JPG-reserved, and DAC — despite sitting in the same numeric run, none of these three carry width/height.
function isStartOfFrameMarker(marker: number): boolean {
  if (marker < JPEG_SOF_MARKER_MIN || marker > JPEG_SOF_MARKER_MAX) {
    return false;
  }
  return (
    marker !== JPEG_MARKER_DHT &&
    marker !== JPEG_MARKER_JPG_RESERVED &&
    marker !== JPEG_MARKER_DAC
  );
}

// Markers with no following length field at all: SOI, EOI, the eight restart markers RST0-RST7, and TEM.
function hasNoLengthField(marker: number): boolean {
  return (
    marker === JPEG_MARKER_SOI ||
    marker === JPEG_MARKER_EOI ||
    marker === JPEG_MARKER_TEM ||
    (marker >= JPEG_MARKER_RST_MIN && marker <= JPEG_MARKER_RST_MAX)
  );
}

// Walks JPEG marker segments from the SOI until a Start-Of-Frame marker's own segment. Every other marker segment is skipped by its own declared length (which includes the 2 length bytes themselves).
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // No separate `bytes.length < 4` clause: bytes[0]/bytes[1] already read as undefined past the end of a shorter array, which can never equal the JPEG prefix/SOI pair, and every later read in this function is equally undefined-safe (via ?? 0 or its own explicit bounds check), so a short array is already rejected, or the loop below already terminates cleanly, without this clause's help.
  if (bytes[0] !== JPEG_MARKER_PREFIX || bytes[1] !== JPEG_MARKER_SOI) {
    return undefined;
  }
  let offset = JPEG_SOI_LENGTH_BYTES;
  // No `offset < bytes.length` loop bound: bytes[offset] reads as undefined once offset runs past the end, and that undefined-safe read is the loop's own real termination condition below, so a separate length comparison would only ever be a redundant restatement of it.
  for (;;) {
    const currentByte = bytes[offset];
    if (currentByte === undefined) {
      return undefined;
    }
    if (currentByte !== JPEG_MARKER_PREFIX) {
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
    // No separate `offset + 2 > bytes.length` guard here: for a Start-Of-Frame marker, the deeper `offset + JPEG_SOF_SEGMENT_MIN_BYTES > bytes.length` check just below already rejects every truncation this one would (that bound is always the larger one), and for any other marker, readUint16BE's own ?? 0 fallback yields a length that only ever advances `offset` further past `bytes.length`, which the loop's own undefined-read check above already terminates on next iteration.
    const length = readUint16BE(bytes, offset);
    if (isStartOfFrameMarker(marker)) {
      if (offset + JPEG_SOF_SEGMENT_MIN_BYTES > bytes.length) {
        return undefined;
      }
      const heightPx = readUint16BE(bytes, offset + JPEG_SOF_HEIGHT_OFFSET);
      const widthPx = readUint16BE(bytes, offset + JPEG_SOF_WIDTH_OFFSET);
      return { widthPx, heightPx };
    }
    if (marker === JPEG_MARKER_SOS) {
      // Start Of Scan reached with no frame header found — malformed, or a marker this reader doesn't recognise as a frame header.
      return undefined;
    }
    offset += length;
  }
}

// No separate `bytes.length >= 2` guard: bytes[0]/bytes[1] already read as undefined past the end of a shorter array, which can never equal the JPEG prefix/SOI pair, so the equality checks alone already reject a too-short array.
function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === JPEG_MARKER_PREFIX && bytes[1] === JPEG_MARKER_SOI;
}

// Exposed so a caller can pick ContentImageBlock's own `format` field from the identical bytes without a second, potentially-divergent sniff of its own. Returns undefined for anything that is neither a PNG nor a JPEG — ContentImageBlockSchema's own `format` field has no third member to fall back to (a GIF or SVG manifest image, both legal in EPUB, has no representation there at all — see the README's own documented gap).
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

// The CSS reference-pixel definition (1px = 1/96in), the same px<->pt conversion browsers themselves use to lay out an EPUB's own XHTML/CSS — document-schema.js's ContentImageBlock is point-based throughout (matching the rest of this family's PDF/docx/ODF unit convention), matching markdown-codec's own identical constant and reasoning: a decoded PNG/JPEG header only ever reports pixel dimensions, and EPUB's own XHTML carries no reliable point-based sizing of its own (an `<img>` may declare width/height attributes in CSS pixels, or none at all, with actual display size left to the reading system's own CSS layout) — so the image's own natural pixel size, converted through this one fixed ratio, is the one dimension every manifest image reliably has.
const CSS_PIXELS_PER_INCH = 96;
const POINTS_PER_INCH = 72;
export const POINTS_PER_PIXEL = POINTS_PER_INCH / CSS_PIXELS_PER_INCH;
