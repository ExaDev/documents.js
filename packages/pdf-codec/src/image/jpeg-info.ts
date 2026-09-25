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

const TEM = 0x01;
const SOI = 0xd8;
const EOI = 0xd9;
const APP14 = 0xee;
// SOF0 (baseline), SOF1 (extended sequential Huffman), SOF2 (progressive Huffman), SOF9 (extended sequential arithmetic), SOF10 (progressive arithmetic) — the marker codes actually used to carry frame dimensions. SOF3/SOF5-7/SOF11/SOF13-15 (lossless / differential / hierarchical variants) are not handled, since they are not produced by mainstream PDF-embedding producers.
const SOF0 = 0xc0;
const SOF1 = 0xc1;
const SOF2 = 0xc2;
const SOF9 = 0xc9;
const SOF10 = 0xca;
const SOF_MARKERS = new Set([SOF0, SOF1, SOF2, SOF9, SOF10]);
const PROGRESSIVE_SOF_MARKERS = new Set([SOF2, SOF10]);
// The eight restart markers RST0..RST7 are contiguous marker codes starting at 0xd0, one per MCU interval boundary (0-7, cycling); generating them from RST0 rather than naming all eight keeps that contiguity visible instead of restating it eight times.
const RST0 = 0xd0;
const RESTART_MARKER_COUNT = 8;
// Markers with no following length/payload: TEM, SOI, EOI, and the eight restart markers.
const NO_PAYLOAD_MARKERS = new Set([
  TEM,
  SOI,
  EOI,
  ...Array.from({ length: RESTART_MARKER_COUNT }, (_, i) => RST0 + i),
]);

function requireByte(bytes: Uint8Array<ArrayBuffer>, index: number): number {
  const value = bytes[index];
  if (value === undefined) {
    throw new Error("unexpected end of JPEG data");
  }
  return value;
}

const BITS_PER_BYTE = 8;
const MARKER_PREFIX = 0xff; // every JPEG marker is a 0xff byte followed by a non-zero, non-0xff marker code (fill bytes are 0xff and are skipped over below)

function readUint16BE(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return (
    (requireByte(bytes, offset) << BITS_PER_BYTE) |
    requireByte(bytes, offset + 1)
  );
}

// Scans a JPEG file's marker segments for its SOF (start-of-frame) segment, recovering dimensions, component count and progressive-ness without decoding any entropy-coded scan data. Throws if the bytes don't start with SOI or no SOF marker is found before EOI/truncation.
export function readJpegInfo(bytes: Uint8Array<ArrayBuffer>): JpegInfo {
  if (
    requireByte(bytes, 0) !== MARKER_PREFIX ||
    requireByte(bytes, 1) !== SOI
  ) {
    throw new Error("not a valid JPEG file: missing SOI marker");
  }

  let offset = 2;
  let adobeTransform: number | undefined;

  while (offset < bytes.length) {
    if (bytes[offset] !== MARKER_PREFIX) {
      offset++;
      continue;
    }
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === MARKER_PREFIX) {
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

    // Adobe APP14 payload layout: "Adobe" (5 bytes) + version (uint16) + flags0 (uint16) + flags1 (uint16) + transform (1 byte), so the transform byte sits at payload offset 11 and the segment must declare at least 12 payload bytes plus its own 2 length bytes to contain it.
    const APP14_TRANSFORM_OFFSET = 11;
    const APP14_TRANSFORM_MIN_SEGMENT_LENGTH = 14;
    if (
      marker === APP14 &&
      segmentLength >= APP14_TRANSFORM_MIN_SEGMENT_LENGTH
    ) {
      adobeTransform = requireByte(bytes, offset + 2 + APP14_TRANSFORM_OFFSET);
    }

    if (SOF_MARKERS.has(marker)) {
      // SOF payload layout: precision (1 byte, offset 0) + height (uint16, offset 1) + width (uint16, offset 3) + component count (1 byte, offset 5).
      const SOF_WIDTH_OFFSET = 3;
      const SOF_COMPONENTS_OFFSET = 5;
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
