// A JPEG's compressed byte stream passes through this whole package unchanged in both directions (embedded via a PDF Image XObject's /DCTDecode filter on write; extracted as-is on read) -- the single biggest scope reduction in the hand-written PDF codec, since no JPEG decoder or encoder is needed at all. The one piece of information still needed from a JPEG that isn't available without looking inside it is its pixel dimensions and component count, which the PDF Image XObject dictionary requires (/Width, /Height, /ColorSpace) -- this module recovers exactly that, by scanning marker segments, without decoding a single sample.
export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  readonly components: number;
  readonly precision: number;
  readonly progressive: boolean;
  // The Adobe APP14 marker's transform byte, if present: 0 = unknown/CMYK-as-is, 1 = YCbCr, 2 = YCCK. A 4-component (CMYK) JPEG with transform 2, or an untagged 4-component JPEG, almost always needs colour inversion (/Decode [1 0 1 0 1 0 1 0]) to render correctly -- a well-known, near-universal convention rather than something this scanner can verify from the bytes alone.
  readonly adobeTransform: number | undefined;
}

const SOI = 0xd8;
const EOI = 0xd9;
const APP14 = 0xee;
// SOF0 (baseline), SOF1 (extended sequential Huffman), SOF2 (progressive Huffman), SOF9 (extended sequential arithmetic), SOF10 (progressive arithmetic) -- the marker codes actually used to carry frame dimensions. SOF3/SOF5-7/SOF11/SOF13-15 (lossless / differential / hierarchical variants) are not handled, since they are not produced by mainstream PDF-embedding producers.
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc9, 0xca]);
const PROGRESSIVE_SOF_MARKERS = new Set([0xc2, 0xca]);
// Markers with no following length/payload: TEM, SOI, EOI, and the eight restart markers.
const NO_PAYLOAD_MARKERS = new Set([0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

function requireByte(bytes: Uint8Array<ArrayBuffer>, index: number): number {
  const value = bytes[index];
  if (value === undefined) {
    throw new Error('unexpected end of JPEG data');
  }
  return value;
}

function readUint16BE(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return (requireByte(bytes, offset) << 8) | requireByte(bytes, offset + 1);
}

// Scans a JPEG file's marker segments for its SOF (start-of-frame) segment, recovering dimensions, component count and progressive-ness without decoding any entropy-coded scan data. Throws if the bytes don't start with SOI or no SOF marker is found before EOI/truncation.
export function readJpegInfo(bytes: Uint8Array<ArrayBuffer>): JpegInfo {
  if (requireByte(bytes, 0) !== 0xff || requireByte(bytes, 1) !== SOI) {
    throw new Error('not a valid JPEG file: missing SOI marker');
  }

  let offset = 2;
  let adobeTransform: number | undefined;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === 0xff) {
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

    if (marker === APP14 && segmentLength >= 14) {
      adobeTransform = requireByte(bytes, offset + 2 + 11);
    }

    if (SOF_MARKERS.has(marker)) {
      const p = offset + 2;
      const precision = requireByte(bytes, p);
      const height = readUint16BE(bytes, p + 1);
      const width = readUint16BE(bytes, p + 3);
      const components = requireByte(bytes, p + 5);
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

  throw new Error('no SOF marker found in JPEG file');
}
