import { crc32 } from '../bytes/crc32';
import { inflateTolerant } from '../bytes/flate';
import { concatBytes } from '../bytes/writer';
import { unfilterScanlines } from './png-filter';

// Normalising every PNG colour type down to 8-bit gray-or-RGB plus a separate alpha plane is deliberate: it is exactly the shape a PDF Image XObject wants (/DeviceGray or /DeviceRGB, /BitsPerComponent 8, alpha as a separate /SMask /DeviceGray XObject), so the PDF writer does zero rearranging of whatever this decoder produces.
export interface RawImage {
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 3;
  readonly data: Uint8Array<ArrayBuffer>;
  readonly alpha?: Uint8Array<ArrayBuffer>;
}

export interface PngDecodeOptions {
  readonly onWarning?: (message: string) => void;
}

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array<ArrayBuffer>;
}

function requireDataView(bytes: Uint8Array<ArrayBuffer>): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readChunks(bytes: Uint8Array<ArrayBuffer>, onWarning: ((m: string) => void) | undefined): PngChunk[] {
  const chunks: PngChunk[] = [];
  const view = requireDataView(bytes);
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = new TextDecoder('latin1').decode(typeBytes);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error(`PNG chunk '${type}' declares a length that runs past the end of the file`);
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
    offset = dataEnd + 4;
    if (type === 'IEND') {
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
    height: view.getUint32(4),
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
    return 3; // truecolor
  }
  if (colorType === 3) {
    return 1; // palette index
  }
  if (colorType === 4) {
    return 2; // grayscale + alpha
  }
  if (colorType === 6) {
    return 4; // truecolor + alpha
  }
  throw new Error(`unsupported PNG colour type: ${colorType}`);
}

// PNG's own "bpp" for filtering purposes: bytes per complete pixel, rounded up, minimum 1.
function filterBpp(bitDepth: number, channels: number): number {
  return Math.max(1, Math.ceil((bitDepth * channels) / 8));
}

// Unpacks one already-unfiltered scanline into one number per sample (raw, unscaled -- 0..2^bitDepth-1 for bit depths under 16, or the 16-bit value's high byte for bitDepth 16, per this decoder's documented 16-bit handling: reduce every depth down to an 8-bit-equivalent raw sample here, and scale to a full 0..255 display range later only for grayscale, where sub-8-bit depths need it).
function unpackRow(rowBytes: Uint8Array<ArrayBuffer>, width: number, channels: number, bitDepth: number): number[] {
  const sampleCount = width * channels;
  const samples: number[] = new Array<number>(sampleCount);
  if (bitDepth === 8) {
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = rowBytes[i]!;
    }
  } else if (bitDepth === 16) {
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = rowBytes[i * 2]!; // high byte only
    }
  } else {
    const mask = (1 << bitDepth) - 1;
    for (let i = 0; i < sampleCount; i++) {
      const bitOffset = i * bitDepth;
      const byteIndex = bitOffset >> 3;
      const shift = 8 - bitDepth - (bitOffset & 7);
      samples[i] = (rowBytes[byteIndex]! >> shift) & mask;
    }
  }
  return samples;
}

function readTrnsGrayValue(trns: Uint8Array<ArrayBuffer>): number {
  return requireDataView(trns).getUint16(0);
}

function readTrnsRgbKey(trns: Uint8Array<ArrayBuffer>): readonly [number, number, number] {
  const view = requireDataView(trns);
  return [view.getUint16(0), view.getUint16(2), view.getUint16(4)];
}

function scaleToByte(sample: number, bitDepth: number): number {
  if (bitDepth === 16) {
    return sample; // already the high byte, i.e. already 0..255
  }
  const maxSample = (1 << bitDepth) - 1;
  return Math.round((sample * 255) / maxSample);
}

// Decodes PNG file bytes into raw, normalised pixel data. Supports colour types 0/2/3/4/6 (gray, truecolor, indexed+PLTE, gray+alpha, truecolor+alpha) at bit depths 1/2/4/8/16 as applicable, plus tRNS transparency for all three non-alpha colour types. Adam7-interlaced sources are rejected explicitly (diagnostic-worthy but essentially never produced by Office/mainstream tooling) rather than silently decoded wrong.
export function decodePng(bytes: Uint8Array<ArrayBuffer>, options: PngDecodeOptions = {}): RawImage {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('not a valid PNG file: bad signature');
    }
  }

  const chunks = readChunks(bytes, options.onWarning);
  const ihdrChunk = chunks[0];
  if (ihdrChunk?.type !== 'IHDR') {
    throw new Error('PNG file does not begin with an IHDR chunk');
  }
  const ihdr = parseIhdr(ihdrChunk.data);
  if (ihdr.interlace !== 0) {
    throw new Error('Adam7-interlaced PNG images are not supported');
  }

  const channels = channelsForColorType(ihdr.colorType);
  const bpp = filterBpp(ihdr.bitDepth, channels);
  const bytesPerRow = Math.ceil((ihdr.width * channels * ihdr.bitDepth) / 8);

  const idatChunks = chunks.filter((c) => c.type === 'IDAT').map((c) => c.data);
  if (idatChunks.length === 0) {
    throw new Error('PNG file has no IDAT chunks');
  }
  // Every IDAT chunk must be concatenated before inflating -- multi-IDAT files are routine (Office emits them), and inflating only the first chunk is the single most common PNG-decoder bug.
  const compressed = concatBytes(idatChunks);
  const { bytes: inflated, recovered } = inflateTolerant(compressed);
  if (recovered && options.onWarning !== undefined) {
    options.onWarning('PNG IDAT stream required tolerant recovery (truncated or malformed)');
  }
  const unfiltered = unfilterScanlines(inflated, ihdr.height, bytesPerRow, bpp);

  const palette = ihdr.colorType === 3 ? chunks.find((c) => c.type === 'PLTE')?.data : undefined;
  if (ihdr.colorType === 3 && palette === undefined) {
    throw new Error('indexed-colour PNG has no PLTE chunk');
  }
  const trns = chunks.find((c) => c.type === 'tRNS')?.data;

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
  const outChannels: 1 | 3 = colorType === 0 || colorType === 4 ? 1 : 3;
  const data = new Uint8Array(width * height * outChannels);
  const hasAlpha = colorType === 4 || colorType === 6 || trns !== undefined;
  const alpha = hasAlpha ? new Uint8Array(width * height).fill(255) : undefined;

  const trnsGray = colorType === 0 && trns !== undefined ? readTrnsGrayValue(trns) : undefined;
  const trnsRgb = colorType === 2 && trns !== undefined ? readTrnsRgbKey(trns) : undefined;

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
          alpha[alphaIndex] = g === trnsGray ? 0 : 255;
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
          alpha[alphaIndex] = r === kr && g === kg && b === kb ? 0 : 255;
        }
      } else if (colorType === 3) {
        const index = samples[pixelBase]!;
        if (palette === undefined) {
          throw new Error('indexed-colour PNG has no PLTE chunk');
        }
        data[outBase] = palette[index * 3]!;
        data[outBase + 1] = palette[index * 3 + 1]!;
        data[outBase + 2] = palette[index * 3 + 2]!;
        if (alpha !== undefined && trns !== undefined) {
          alpha[alphaIndex] = index < trns.length ? trns[index]! : 255;
        }
      } else if (colorType === 4) {
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
          alpha[alphaIndex] = samples[pixelBase + 3]!;
        }
      }
    }
  }

  return alpha === undefined
    ? { width, height, channels: outChannels, data }
    : { width, height, channels: outChannels, data, alpha };
}
