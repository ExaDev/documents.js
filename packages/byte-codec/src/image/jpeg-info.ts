// A JPEG's compressed byte stream passes through this whole package unchanged in both directions (embedded via a PDF Image XObject's /DCTDecode filter on write; extracted as-is on read) — the single biggest scope reduction in the hand-written PDF codec, since no JPEG decoder or encoder is needed at all. The one piece of information still needed from a JPEG that isn't available without looking inside it is its pixel dimensions and component count, which the PDF Image XObject dictionary requires (/Width, /Height, /ColorSpace) — this module recovers exactly that, by scanning marker segments, without decoding a single sample.
export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  readonly components: number;
  readonly precision: number;
  readonly progressive: boolean;
  // The Adobe APP14 marker's transform byte, if present: 0 = unknown/CMYK-as-is, 1 = YCbCr, 2 = YCCK. A 4-component (CMYK) JPEG with transform 2, or an untagged 4-component JPEG, almost always needs colour inversion (/Decode [1 0 1 0 1 0 1 0]) to render correctly — a well-known, near-universal convention rather than something this scanner can verify from the bytes alone.
  readonly adobeTransform: number | undefined;
}

const SOI = 0xd8;
const EOI = 0xd9;
const APP14 = 0xee;
const SOF0 = 0xc0;
const SOF1 = 0xc1;
const SOF2 = 0xc2;
const SOF9 = 0xc9;
const SOF10 = 0xca;
// SOF0 (baseline), SOF1 (extended sequential Huffman), SOF2 (progressive Huffman), SOF9 (extended sequential arithmetic), SOF10 (progressive arithmetic) — the marker codes actually used to carry frame dimensions. SOF3/SOF5-7/SOF11/SOF13-15 (lossless / differential / hierarchical variants) are not handled, since they are not produced by mainstream PDF-embedding producers.
const SOF_MARKERS = new Set([SOF0, SOF1, SOF2, SOF9, SOF10]);
const PROGRESSIVE_SOF_MARKERS = new Set([SOF2, SOF10]);
const TEM = 0x01;
const RST0 = 0xd0;
const RST1 = 0xd1;
const RST2 = 0xd2;
const RST3 = 0xd3;
const RST4 = 0xd4;
const RST5 = 0xd5;
const RST6 = 0xd6;
const RST7 = 0xd7;
// Markers with no following length/payload: TEM, SOI, EOI, and the eight restart markers.
const NO_PAYLOAD_MARKERS = new Set([
  TEM,
  SOI,
  EOI,
  RST0,
  RST1,
  RST2,
  RST3,
  RST4,
  RST5,
  RST6,
  RST7,
]);
const BITS_PER_BYTE = 8;
// Every JPEG marker begins with this prefix byte.
const JPEG_MARKER_PREFIX = 0xff;
// The APP14 (Adobe) segment must be at least this many bytes to carry the transform byte, whose own offset within the segment (past the 2-byte length field) is 11.
const APP14_MIN_LENGTH_FOR_TRANSFORM = 14;
const APP14_TRANSFORM_OFFSET = 11;
// Byte offsets within an SOF segment, past its own 2-byte length field: precision (offset 0), height (offset 1, a 2-byte big-endian value), width (offset 3), component count (offset 5).
const SOF_WIDTH_OFFSET = 3;
const SOF_COMPONENTS_OFFSET = 5;

function requireByte(bytes: Uint8Array<ArrayBuffer>, index: number): number {
  const value = bytes[index];
  if (value === undefined) {
    throw new Error("unexpected end of JPEG data");
  }
  return value;
}

function readUint16BE(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return (
    (requireByte(bytes, offset) << BITS_PER_BYTE) |
    requireByte(bytes, offset + 1)
  );
}

// Scans a JPEG file's marker segments for its SOF (start-of-frame) segment, recovering dimensions, component count and progressive-ness without decoding any entropy-coded scan data. Throws if the bytes don't start with SOI or no SOF marker is found before EOI/truncation.
export function readJpegInfo(bytes: Uint8Array<ArrayBuffer>): JpegInfo {
  if (
    requireByte(bytes, 0) !== JPEG_MARKER_PREFIX ||
    requireByte(bytes, 1) !== SOI
  ) {
    throw new Error("not a valid JPEG file: missing SOI marker");
  }

  let offset = 2;
  let adobeTransform: number | undefined;

  // Bounded by the data itself rather than by a separately tracked length: Uint8Array indexing past the end always returns undefined, so the scan stops the moment offset runs off the buffer without needing its own length check.
  while (bytes[offset] !== undefined) {
    if (bytes[offset] !== JPEG_MARKER_PREFIX) {
      offset++;
      continue;
    }
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === JPEG_MARKER_PREFIX) {
      markerOffset++;
    }
    const marker = bytes[markerOffset];
    if (marker === undefined) {
      break;
    }
    offset = markerOffset + 1;

    if (marker === EOI) {
      break;
    }
    if (NO_PAYLOAD_MARKERS.has(marker)) {
      continue;
    }

    const segmentLength = readUint16BE(bytes, offset); // includes the 2 length bytes themselves

    if (marker === APP14 && segmentLength >= APP14_MIN_LENGTH_FOR_TRANSFORM) {
      adobeTransform = requireByte(bytes, offset + 2 + APP14_TRANSFORM_OFFSET);
    }

    if (SOF_MARKERS.has(marker)) {
      const p = offset + 2;
      const precision = requireByte(bytes, p);
      const height = readUint16BE(bytes, p + 1);
      const width = readUint16BE(bytes, p + SOF_WIDTH_OFFSET);
      const components = requireByte(bytes, p + SOF_COMPONENTS_OFFSET);
      return {
        width,
        height,
        components,
        precision,
        progressive: PROGRESSIVE_SOF_MARKERS.has(marker),
        adobeTransform,
      };
    }

    offset += segmentLength;
  }

  throw new Error("no SOF marker found in JPEG file");
}
