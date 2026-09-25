import { crc32 } from "../bytes/crc32";
import { inflateTolerant } from "../bytes/flate";
import { concatBytes } from "../bytes/writer";
import { unfilterScanlines } from "./png-filter";

// Normalising every PNG colour type down to 8-bit gray-or-RGB plus a separate alpha plane is deliberate: it is exactly the shape a PDF Image XObject wants (/DeviceGray or /DeviceRGB, /BitsPerComponent 8, alpha as a separate /SMask /DeviceGray XObject), so the PDF writer does zero rearranging of whatever this decoder produces.
// A `type` alias (rather than the equivalent inline literal union) so `@typescript-eslint/no-magic-numbers`'s `ignoreNumericLiteralTypes` exemption applies: the same `1 | 3` written inline as a property or variable annotation is not exempt and is reported.
export type ImageChannels = 1 | 3;

export interface RawImage {
  readonly width: number;
  readonly height: number;
  readonly channels: ImageChannels;
  readonly data: Uint8Array<ArrayBuffer>;
  readonly alpha?: Uint8Array<ArrayBuffer>;
}

export interface PngDecodeOptions {
  readonly onWarning?: (message: string) => void;
}

// PNG spec 5.2 "PNG signature": eight fixed bytes, each chosen for a specific corruption it catches.
const PNG_SIGNATURE_HIGH_BIT_MARKER = 0x89; // outside the 7-bit ASCII range, catches transmission through a system that strips the high bit
const PNG_SIGNATURE_P = 0x50;
const PNG_SIGNATURE_N = 0x4e;
const PNG_SIGNATURE_G = 0x47;
const PNG_SIGNATURE_CR = 0x0d; // CRLF, catches transmission through a system that translates line endings
const PNG_SIGNATURE_LF = 0x0a;
const PNG_SIGNATURE_CTRL_Z = 0x1a; // stops file display under some old DOS utilities

const PNG_SIGNATURE: readonly number[] = [
  PNG_SIGNATURE_HIGH_BIT_MARKER,
  PNG_SIGNATURE_P,
  PNG_SIGNATURE_N,
  PNG_SIGNATURE_G,
  PNG_SIGNATURE_CR,
  PNG_SIGNATURE_LF,
  PNG_SIGNATURE_CTRL_Z,
  PNG_SIGNATURE_LF,
];

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array<ArrayBuffer>;
}

function requireDataView(bytes: Uint8Array<ArrayBuffer>): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// PNG spec 5.3 "Chunk layout": Length (4 bytes) + Type (4 bytes) + Data (variable) + CRC (4 bytes).
const PNG_CHUNK_LENGTH_SIZE = 4;
const PNG_CHUNK_TYPE_SIZE = 4;
const PNG_CHUNK_CRC_SIZE = 4;
const PNG_CHUNK_HEADER_SIZE = PNG_CHUNK_LENGTH_SIZE + PNG_CHUNK_TYPE_SIZE; // Length + Type, before the variable-length Data

function readChunks(
  bytes: Uint8Array<ArrayBuffer>,
  onWarning: ((m: string) => void) | undefined,
): PngChunk[] {
  const chunks: PngChunk[] = [];
  const view = requireDataView(bytes);
  let offset = PNG_SIGNATURE.length;
  while (offset + PNG_CHUNK_HEADER_SIZE <= bytes.length) {
    const length = view.getUint32(offset);
    const typeBytes = bytes.subarray(
      offset + PNG_CHUNK_LENGTH_SIZE,
      offset + PNG_CHUNK_HEADER_SIZE,
    );
    const type = new TextDecoder("latin1").decode(typeBytes);
    const dataStart = offset + PNG_CHUNK_HEADER_SIZE;
    const dataEnd = dataStart + length;
    if (dataEnd + PNG_CHUNK_CRC_SIZE > bytes.length) {
      throw new Error(
        `PNG chunk '${type}' declares a length that runs past the end of the file`,
      );
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (onWarning !== undefined) {
      const storedCrc = view.getUint32(dataEnd);
      const computedCrc = crc32(concatBytes([typeBytes, data]));
      if (storedCrc !== computedCrc) {
        onWarning(`PNG chunk '${type}' failed its CRC32 check`);
      }
    }
    chunks.push({ type, data });
    offset = dataEnd + PNG_CHUNK_CRC_SIZE;
    if (type === "IEND") {
      break;
    }
  }
  return chunks;
}

interface Ihdr {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlace: number;
}

const IHDR_HEIGHT_OFFSET = 4; // PNG spec 11.2.2: Height follows the 4-byte Width field

function parseIhdr(data: Uint8Array<ArrayBuffer>): Ihdr {
  const view = requireDataView(data);
  return {
    width: view.getUint32(0),
    height: view.getUint32(IHDR_HEIGHT_OFFSET),
    bitDepth: data[8]!,
    colorType: data[9]!,
    interlace: data[12]!,
  };
}

// PNG spec 11.2.2 Table 11.1: the five colour type values this decoder supports.
const PNG_COLOR_TYPE_GRAYSCALE = 0;
const PNG_COLOR_TYPE_TRUECOLOR = 2;
const PNG_COLOR_TYPE_INDEXED = 3;
const PNG_COLOR_TYPE_GRAYSCALE_ALPHA = 4;
const PNG_COLOR_TYPE_TRUECOLOR_ALPHA = 6;

const PNG_CHANNELS_TRUECOLOR = 3; // red, green, blue
const PNG_CHANNELS_TRUECOLOR_ALPHA = 4; // red, green, blue, alpha

function channelsForColorType(colorType: number): number {
  if (colorType === PNG_COLOR_TYPE_GRAYSCALE) {
    return 1; // grayscale
  }
  if (colorType === PNG_COLOR_TYPE_TRUECOLOR) {
    return PNG_CHANNELS_TRUECOLOR;
  }
  if (colorType === PNG_COLOR_TYPE_INDEXED) {
    return 1; // palette index
  }
  if (colorType === PNG_COLOR_TYPE_GRAYSCALE_ALPHA) {
    return 2; // grayscale + alpha
  }
  if (colorType === PNG_COLOR_TYPE_TRUECOLOR_ALPHA) {
    return PNG_CHANNELS_TRUECOLOR_ALPHA;
  }
  throw new Error(`unsupported PNG colour type: ${colorType}`);
}

const BITS_PER_BYTE = 8;

// PNG's own "bpp" for filtering purposes: bytes per complete pixel, rounded up, minimum 1.
function filterBpp(bitDepth: number, channels: number): number {
  return Math.max(1, Math.ceil((bitDepth * channels) / BITS_PER_BYTE));
}

const PNG_BIT_DEPTH_16 = 16;
const BYTE_INDEX_SHIFT = 3; // log2(BITS_PER_BYTE): converts a bit offset into the byte index it falls in

// Unpacks one already-unfiltered scanline into one number per sample (raw, unscaled — 0..2^bitDepth-1 for bit depths under 16, or the 16-bit value's high byte for bitDepth 16, per this decoder's documented 16-bit handling: reduce every depth down to an 8-bit-equivalent raw sample here, and scale to a full 0..255 display range later only for grayscale, where sub-8-bit depths need it).
function unpackRow(
  rowBytes: Uint8Array<ArrayBuffer>,
  width: number,
  channels: number,
  bitDepth: number,
): number[] {
  const sampleCount = width * channels;
  // Sized through Array.from's own length property rather than an Array constructor argument:
  // the constructor's argument is a mutable node whose removal changes nothing observable
  // (index assignment grows the array identically).
  const samples: number[] = Array.from({ length: sampleCount });
  // No 8-bit special case: at depth 8 the general bit-unpacking below is byte-aligned (shift 0, mask 255) and reads exactly the same value, so the branch would be a duplicate path.
  if (bitDepth === PNG_BIT_DEPTH_16) {
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = rowBytes[i * 2]!; // high byte only
    }
  } else {
    const mask = (1 << bitDepth) - 1;
    for (let i = 0; i < sampleCount; i++) {
      const bitOffset = i * bitDepth;
      const byteIndex = bitOffset >> BYTE_INDEX_SHIFT;
      const shift =
        BITS_PER_BYTE - bitDepth - (bitOffset & (BITS_PER_BYTE - 1));
      samples[i] = (rowBytes[byteIndex]! >> shift) & mask;
    }
  }
  return samples;
}

function readTrnsGrayValue(trns: Uint8Array<ArrayBuffer>): number {
  return requireDataView(trns).getUint16(0);
}

const TRNS_RGB_BLUE_OFFSET = 4; // PNG spec 11.3.2 tRNS (truecolor): three 2-byte samples, Red @0, Green @2, Blue @4

function readTrnsRgbKey(
  trns: Uint8Array<ArrayBuffer>,
): readonly [number, number, number] {
  const view = requireDataView(trns);
  return [
    view.getUint16(0),
    view.getUint16(2),
    view.getUint16(TRNS_RGB_BLUE_OFFSET),
  ];
}

const MAX_BYTE_VALUE = 255;

function scaleToByte(sample: number, bitDepth: number): number {
  if (bitDepth === PNG_BIT_DEPTH_16) {
    return sample; // already the high byte, i.e. already 0..255
  }
  const maxSample = (1 << bitDepth) - 1;
  return Math.round((sample * MAX_BYTE_VALUE) / maxSample);
}

// Decodes PNG file bytes into raw, normalised pixel data. Supports colour types 0/2/3/4/6 (gray, truecolor, indexed+PLTE, gray+alpha, truecolor+alpha) at bit depths 1/2/4/8/16 as applicable, plus tRNS transparency for all three non-alpha colour types. Adam7-interlaced sources are rejected explicitly (diagnostic-worthy but essentially never produced by Office/mainstream tooling) rather than silently decoded wrong.
export function decodePng(
  bytes: Uint8Array<ArrayBuffer>,
  options: PngDecodeOptions = {},
): RawImage {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error("not a valid PNG file: bad signature");
    }
  }

  const chunks = readChunks(bytes, options.onWarning);
  const ihdrChunk = chunks[0];
  if (ihdrChunk?.type !== "IHDR") {
    throw new Error("PNG file does not begin with an IHDR chunk");
  }
  const ihdr = parseIhdr(ihdrChunk.data);
  if (ihdr.interlace !== 0) {
    throw new Error("Adam7-interlaced PNG images are not supported");
  }

  const channels = channelsForColorType(ihdr.colorType);
  const bpp = filterBpp(ihdr.bitDepth, channels);
  const bytesPerRow = Math.ceil(
    (ihdr.width * channels * ihdr.bitDepth) / BITS_PER_BYTE,
  );

  const idatChunks = chunks.filter((c) => c.type === "IDAT").map((c) => c.data);
  if (idatChunks.length === 0) {
    throw new Error("PNG file has no IDAT chunks");
  }
  // Every IDAT chunk must be concatenated before inflating — multi-IDAT files are routine (Office emits them), and inflating only the first chunk is the single most common PNG-decoder bug.
  const compressed = concatBytes(idatChunks);
  const { bytes: inflated, recovered } = inflateTolerant(compressed);
  if (recovered && options.onWarning !== undefined) {
    options.onWarning(
      "PNG IDAT stream required tolerant recovery (truncated or malformed)",
    );
  }
  const unfiltered = unfilterScanlines(inflated, ihdr.height, bytesPerRow, bpp);

  const palette =
    ihdr.colorType === PNG_COLOR_TYPE_INDEXED
      ? chunks.find((c) => c.type === "PLTE")?.data
      : undefined;
  if (ihdr.colorType === PNG_COLOR_TYPE_INDEXED && palette === undefined) {
    throw new Error("indexed-colour PNG has no PLTE chunk");
  }
  const trns = chunks.find((c) => c.type === "tRNS")?.data;

  return buildRawImage(ihdr, channels, bytesPerRow, unfiltered, palette, trns);
}

const ALPHA_SAMPLE_INDEX_IN_RGBA = 3; // red, green and blue occupy sample offsets 0-2; the alpha sample immediately follows

function buildRawImage(
  ihdr: Ihdr,
  channels: number,
  bytesPerRow: number,
  unfiltered: Uint8Array<ArrayBuffer>,
  palette: Uint8Array<ArrayBuffer> | undefined,
  trns: Uint8Array<ArrayBuffer> | undefined,
): RawImage {
  const { width, height, bitDepth, colorType } = ihdr;
  const outChannels: ImageChannels =
    colorType === 0 || colorType === PNG_COLOR_TYPE_GRAYSCALE_ALPHA
      ? 1
      : PNG_CHANNELS_TRUECOLOR;
  const data = new Uint8Array(width * height * outChannels);
  const hasAlpha =
    colorType === PNG_COLOR_TYPE_GRAYSCALE_ALPHA ||
    colorType === PNG_COLOR_TYPE_TRUECOLOR_ALPHA ||
    trns !== undefined;
  const alpha = hasAlpha
    ? new Uint8Array(width * height).fill(MAX_BYTE_VALUE)
    : undefined;

  const trnsGray =
    colorType === 0 && trns !== undefined ? readTrnsGrayValue(trns) : undefined;
  const trnsRgb =
    colorType === 2 && trns !== undefined ? readTrnsRgbKey(trns) : undefined;

  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow;
    const rowBytes = unfiltered.subarray(rowStart, rowStart + bytesPerRow);
    const samples = unpackRow(rowBytes, width, channels, bitDepth);
    for (let x = 0; x < width; x++) {
      const pixelBase = x * channels;
      const outBase = (y * width + x) * outChannels;
      const alphaIndex = y * width + x;

      if (colorType === 0) {
        const g = samples[pixelBase]!;
        data[outBase] = scaleToByte(g, bitDepth);
        if (alpha !== undefined && trnsGray !== undefined) {
          alpha[alphaIndex] = g === trnsGray ? 0 : MAX_BYTE_VALUE;
        }
      } else if (colorType === 2) {
        const r = samples[pixelBase]!;
        const g = samples[pixelBase + 1]!;
        const b = samples[pixelBase + 2]!;
        data[outBase] = r;
        data[outBase + 1] = g;
        data[outBase + 2] = b;
        if (alpha !== undefined && trnsRgb !== undefined) {
          const [kr, kg, kb] = trnsRgb;
          alpha[alphaIndex] =
            r === kr && g === kg && b === kb ? 0 : MAX_BYTE_VALUE;
        }
      } else if (colorType === PNG_COLOR_TYPE_INDEXED) {
        const index = samples[pixelBase]!;
        // decodePng already refused an indexed image with no PLTE chunk before this function runs, so the non-null assertions are carried by that check.
        data[outBase] = palette![index * PNG_CHANNELS_TRUECOLOR]!;
        data[outBase + 1] = palette![index * PNG_CHANNELS_TRUECOLOR + 1]!;
        data[outBase + 2] = palette![index * PNG_CHANNELS_TRUECOLOR + 2]!;
        if (alpha !== undefined && trns !== undefined) {
          alpha[alphaIndex] =
            index < trns.length ? trns[index]! : MAX_BYTE_VALUE;
        }
      } else if (colorType === PNG_COLOR_TYPE_GRAYSCALE_ALPHA) {
        const g = samples[pixelBase]!;
        const a = samples[pixelBase + 1]!;
        data[outBase] = scaleToByte(g, bitDepth);
        if (alpha !== undefined) {
          alpha[alphaIndex] = scaleToByte(a, bitDepth);
        }
      } else {
        // colorType === 6: truecolor + alpha
        data[outBase] = samples[pixelBase]!;
        data[outBase + 1] = samples[pixelBase + 1]!;
        data[outBase + 2] = samples[pixelBase + 2]!;
        if (alpha !== undefined) {
          alpha[alphaIndex] = samples[pixelBase + ALPHA_SAMPLE_INDEX_IN_RGBA]!;
        }
      }
    }
  }

  return { width, height, channels: outChannels, data, alpha };
}
