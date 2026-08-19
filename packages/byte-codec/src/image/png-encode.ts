import { crc32 } from '../bytes/crc32';
import { deflate } from '../bytes/flate';
import { ByteWriter, concatBytes } from '../bytes/writer';
import type { RawImage } from './png-decode';
import { filterScanlines } from './png-filter';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngEncodeOptions {
  // 'adaptive' (the default) picks, per row, whichever of the five PNG filters minimises the sum of the filtered bytes' absolute values -- the PNG spec's own recommended heuristic. 'none' always emits filter type 0, useful for deterministic, human-auditable test output.
  readonly filter?: 'none' | 'adaptive';
}

function u32be(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function writeChunk(writer: ByteWriter, type: string, data: Uint8Array<ArrayBuffer>): void {
  const typeBytes = new TextEncoder().encode(type);
  writer.writeBytes(u32be(data.length));
  writer.writeBytes(typeBytes);
  writer.writeBytes(data);
  writer.writeBytes(u32be(crc32(concatBytes([typeBytes, data]))));
}

// IHDR colour type: 0 gray, 2 truecolor(RGB), 4 gray+alpha, 6 truecolor+alpha(RGBA). RawImage's channels/alpha combination maps onto these four (never 3, palette -- this encoder never emits an indexed-colour image, since RawImage carries no palette of its own).
function colorTypeFor(image: RawImage): number {
  if (image.channels === 1) {
    return image.alpha === undefined ? 0 : 4;
  }
  return image.alpha === undefined ? 2 : 6;
}

// Encodes normalised raw pixel data (8 bits per channel, optionally with a separate alpha plane) into PNG file bytes -- the exact inverse of decodePng's RawImage shape.
export function encodePng(image: RawImage, options: PngEncodeOptions = {}): Uint8Array<ArrayBuffer> {
  const { width, height, channels, data, alpha } = image;
  const outChannels = alpha === undefined ? channels : channels + 1;
  const bytesPerRow = width * outChannels;
  const pixelCount = width * height;

  const interleaved = new Uint8Array(pixelCount * outChannels);
  for (let i = 0; i < pixelCount; i++) {
    const srcBase = i * channels;
    const dstBase = i * outChannels;
    for (let c = 0; c < channels; c++) {
      interleaved[dstBase + c] = data[srcBase + c]!;
    }
    if (alpha !== undefined) {
      interleaved[dstBase + channels] = alpha[i]!;
    }
  }

  const filtered = filterScanlines(interleaved, height, bytesPerRow, outChannels, options.filter ?? 'adaptive');
  const compressed = deflate(filtered);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth: always 8, since RawImage is always 8 bits per channel
  ihdr[9] = colorTypeFor(image);
  ihdr[10] = 0; // compression method: always 0 (deflate)
  ihdr[11] = 0; // filter method: always 0 (the five-filter adaptive scheme)
  ihdr[12] = 0; // interlace method: 0 (no interlacing)

  const writer = new ByteWriter();
  writer.writeBytes(PNG_SIGNATURE);
  writeChunk(writer, 'IHDR', ihdr);
  writeChunk(writer, 'IDAT', compressed);
  writeChunk(writer, 'IEND', new Uint8Array(0));
  return writer.toBytes();
}
