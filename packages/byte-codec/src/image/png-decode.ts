import { crc32 } from "../bytes/crc32";
import { inflateTolerant } from "../bytes/flate";
import { concatBytes } from "../bytes/writer";
import { unfilterScanlines } from "./png-filter";

// Normalising every PNG colour type down to 8-bit gray-or-RGB plus a separate alpha plane is deliberate: it is exactly the shape a PDF Image XObject wants (/DeviceGray or /DeviceRGB, /BitsPerComponent 8, alpha as a separate /SMask /DeviceGray XObject), so the PDF writer does zero rearranging of whatever this decoder produces.
type RawImageChannels = 1 | 3;

export interface RawImage {
  readonly width: number;
  readonly height: number;
  readonly channels: RawImageChannels;
  readonly data: Uint8Array<ArrayBuffer>;
  readonly alpha?: Uint8Array<ArrayBuffer>;
}

export interface PngDecodeOptions {
  readonly onWarning?: (message: string) => void;
}

const PNG_SIG_HIGH_BIT_MARKER = 0x89;
const PNG_SIG_P = 0x50;
const PNG_SIG_N = 0x4e;
const PNG_SIG_G = 0x47;
const PNG_SIG_CR = 0x0d;
const PNG_SIG_LF = 0x0a;
const PNG_SIG_DOS_EOF = 0x1a;
const PNG_SIGNATURE: readonly number[] = [
  PNG_SIG_HIGH_BIT_MARKER,
  PNG_SIG_P,
  PNG_SIG_N,
  PNG_SIG_G,
  PNG_SIG_CR,
  PNG_SIG_LF,
  PNG_SIG_DOS_EOF,
  PNG_SIG_LF,
];
const CHUNK_LENGTH_FIELD_BYTES = 4;
const CHUNK_TYPE_FIELD_BYTES = 4;
const CHUNK_HEADER_BYTES = CHUNK_LENGTH_FIELD_BYTES + CHUNK_TYPE_FIELD_BYTES;
const CHUNK_CRC_FIELD_BYTES = 4;
const IHDR_HEIGHT_OFFSET = 4;
const RGB_CHANNELS = 3;
const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL_OFFSET = 3;
const BITS_PER_BYTE = 8;
const BYTE_SHIFT = 3; // bitOffset >> BYTE_SHIFT === bitOffset / BITS_PER_BYTE
const BYTE_BIT_MASK = 7; // bitOffset & BYTE_BIT_MASK === bitOffset % BITS_PER_BYTE
const MAX_SAMPLE_VALUE = 255;
const OPAQUE_ALPHA = 255;
const PNG_BIT_DEPTH_16 = 16;
const PNG_COLOR_TYPE_INDEXED = 3;
const PNG_COLOR_TYPE_GRAY_ALPHA = 4;
const PNG_COLOR_TYPE_RGBA = 6;

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array<ArrayBuffer>;
}

function requireDataView(bytes: Uint8Array<ArrayBuffer>): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readChunks(
  bytes: Uint8Array<ArrayBuffer>,
  onWarning: ((m: string) => void) | undefined,
): PngChunk[] {
  const chunks: PngChunk[] = [];
  const view = requireDataView(bytes);
  let offset = PNG_SIGNATURE.length;
  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    const length = view.getUint32(offset);
    const typeBytes = bytes.subarray(
      offset + CHUNK_LENGTH_FIELD_BYTES,
      offset + CHUNK_HEADER_BYTES,
    );
    const type = new TextDecoder("latin1").decode(typeBytes);
    const dataStart = offset + CHUNK_HEADER_BYTES;
    const dataEnd = dataStart + length;
    if (dataEnd + CHUNK_CRC_FIELD_BYTES > bytes.length) {
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
    offset = dataEnd + CHUNK_CRC_FIELD_BYTES;
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

function channelsForColorType(colorType: number): number {
  if (colorType === 0) {
    return 1; // grayscale
  }
  if (colorType === 2) {
    return RGB_CHANNELS; // truecolor
  }
  if (colorType === PNG_COLOR_TYPE_INDEXED) {
    return 1; // palette index
  }
  if (colorType === PNG_COLOR_TYPE_GRAY_ALPHA) {
    return 2; // grayscale + alpha
  }
  if (colorType === PNG_COLOR_TYPE_RGBA) {
    return RGBA_CHANNELS; // truecolor + alpha
  }
  throw new Error(`unsupported PNG colour type: ${colorType}`);
}

// PNG's own "bpp" for filtering purposes: bytes per complete pixel, rounded up, minimum 1.
function filterBpp(bitDepth: number, channels: number): number {
  return Math.max(1, Math.ceil((bitDepth * channels) / BITS_PER_BYTE));
}

// Unpacks one already-unfiltered scanline into `samples`, one entry per sample (raw, unscaled — 0..2^bitDepth-1 for bit depths under 16, or the 16-bit value's high byte for bitDepth 16, per this decoder's documented 16-bit handling: reduce every depth down to an 8-bit-equivalent raw sample here, and scale to a full 0..255 display range later only for grayscale, where sub-8-bit depths need it). `samples` is the caller's own reusable buffer, exactly width * channels long, so there is neither a loop bound to drift from the sample count nor a new array per row: every element index 0..length-1 is visited by the typed array's own forEach, never by a comparison that could run one iteration short or long.
function unpackRow(
  rowBytes: Uint8Array<ArrayBuffer>,
  samples: Uint8Array<ArrayBuffer>,
  bitDepth: number,
): void {
  if (bitDepth === PNG_BIT_DEPTH_16) {
    samples.forEach((_sample, i) => {
      samples[i] = rowBytes[i * 2]!; // high byte only
    });
    return;
  }
  // bitDepth 8 needs no dedicated fast path: with bitDepth === 8, the generic bit-packed formula below reduces exactly to mask = 255, byteIndex = i, shift = 0, i.e. `(rowBytes[i] >> 0) & 255`, which is just rowBytes[i].
  const mask = (1 << bitDepth) - 1;
  samples.forEach((_sample, i) => {
    const bitOffset = i * bitDepth;
    const byteIndex = bitOffset >> BYTE_SHIFT;
    const shift = BITS_PER_BYTE - bitDepth - (bitOffset & BYTE_BIT_MASK);
    samples[i] = (rowBytes[byteIndex]! >> shift) & mask;
  });
}

function readTrnsGrayValue(trns: Uint8Array<ArrayBuffer>): number {
  return requireDataView(trns).getUint16(0);
}

function readTrnsRgbKey(
  trns: Uint8Array<ArrayBuffer>,
): readonly [number, number, number] {
  const view = requireDataView(trns);
  return [
    view.getUint16(0),
    view.getUint16(2),
    view.getUint16(IHDR_HEIGHT_OFFSET),
  ];
}

function scaleToByte(sample: number, bitDepth: number): number {
  if (bitDepth === PNG_BIT_DEPTH_16) {
    return sample; // already the high byte, i.e. already 0..255
  }
  const maxSample = (1 << bitDepth) - 1;
  return Math.round((sample * MAX_SAMPLE_VALUE) / maxSample);
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

  // Looked up unconditionally rather than gated on colorType === 3: buildRawImage only ever reads `palette` inside its own colorType === 3 branch, so a PLTE chunk found for any other colour type is simply an unused value, never an observable difference.
  const palette = chunks.find((c) => c.type === "PLTE")?.data;
  if (ihdr.colorType === PNG_COLOR_TYPE_INDEXED && palette === undefined) {
    throw new Error("indexed-colour PNG has no PLTE chunk");
  }
  const trns = chunks.find((c) => c.type === "tRNS")?.data;

  return buildRawImage(ihdr, channels, bytesPerRow, unfiltered, palette, trns);
}

function buildRawImage(
  ihdr: Ihdr,
  channels: number,
  bytesPerRow: number,
  unfiltered: Uint8Array<ArrayBuffer>,
  palette: Uint8Array<ArrayBuffer> | undefined,
  trns: Uint8Array<ArrayBuffer> | undefined,
): RawImage {
  const { width, height, bitDepth, colorType } = ihdr;
  const outChannels: RawImageChannels =
    colorType === 0 || colorType === PNG_COLOR_TYPE_GRAY_ALPHA
      ? 1
      : RGB_CHANNELS;
  const data = new Uint8Array(width * height * outChannels);
  const hasAlpha =
    colorType === PNG_COLOR_TYPE_GRAY_ALPHA ||
    colorType === PNG_COLOR_TYPE_RGBA ||
    trns !== undefined;
  const alpha = hasAlpha
    ? new Uint8Array(width * height).fill(OPAQUE_ALPHA)
    : undefined;

  const trnsGray =
    colorType === 0 && trns !== undefined ? readTrnsGrayValue(trns) : undefined;
  const trnsRgb =
    colorType === 2 && trns !== undefined ? readTrnsRgbKey(trns) : undefined;

  // Rows and columns are visited through exact-length forEach walks rather than manually bounded for loops, for both indices: `data`/`alpha` are each allocated to exactly width*height*outChannels / width*height elements, so there is no separate loop-bound comparison whose own boundary could ever be observed through them. The column walk is over one Uint32Array reused for every row and the samples land in one buffer reused for every row, so decoding allocates nothing per row or per pixel.
  const samples = new Uint8Array(width * channels);
  const columns = new Uint32Array(width);
  Array.from({ length: height }).forEach((_row, y) => {
    const rowStart = y * bytesPerRow;
    const rowBytes = unfiltered.subarray(rowStart, rowStart + bytesPerRow);
    unpackRow(rowBytes, samples, bitDepth);
    columns.forEach((_column, x) => {
      const pixelBase = x * channels;
      const outBase = (y * width + x) * outChannels;
      const alphaIndex = y * width + x;

      if (colorType === 0) {
        const g = samples[pixelBase]!;
        data[outBase] = scaleToByte(g, bitDepth);
        // trnsGray is defined here whenever alpha is: both stem from the same `trns !== undefined` check for colorType 0 (see hasAlpha and trnsGray above), so checking trnsGray alone already guarantees alpha is defined too.
        if (trnsGray !== undefined) {
          alpha![alphaIndex] = g === trnsGray ? 0 : OPAQUE_ALPHA;
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
            r === kr && g === kg && b === kb ? 0 : OPAQUE_ALPHA;
        }
      } else if (colorType === PNG_COLOR_TYPE_INDEXED) {
        const index = samples[pixelBase]!;
        // decodePng's own colorType === 3 guard, thrown before buildRawImage is ever called, already guarantees palette is defined here — buildRawImage has no other caller.
        data[outBase] = palette![index * RGB_CHANNELS]!;
        data[outBase + 1] = palette![index * RGB_CHANNELS + 1]!;
        data[outBase + 2] = palette![index * RGB_CHANNELS + 2]!;
        if (alpha !== undefined && trns !== undefined) {
          alpha[alphaIndex] = index < trns.length ? trns[index]! : OPAQUE_ALPHA;
        }
      } else if (colorType === PNG_COLOR_TYPE_GRAY_ALPHA) {
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
          alpha[alphaIndex] = samples[pixelBase + ALPHA_CHANNEL_OFFSET]!;
        }
      }
    });
  });

  return alpha === undefined
    ? { width, height, channels: outChannels, data }
    : { width, height, channels: outChannels, data, alpha };
}
