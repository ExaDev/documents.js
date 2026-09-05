import { crc32 } from "../bytes/crc32";
import { deflate } from "../bytes/flate";
import { ByteWriter, concatBytes } from "../bytes/writer";
import type { RawImage } from "./png-decode";
import { filterScanlines } from "./png-filter";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// PNG colour type 3 (indexed/palette) cannot address more entries than this -- one palette index per byte, per the PNG spec's own 8-bit-depth ceiling for colour type 3.
const MAX_PALETTE_ENTRIES = 256;

export interface PngEncodeOptions {
  // 'adaptive' (the default) picks, per row, whichever of the five PNG filters minimises the sum of the filtered bytes' absolute values -- the PNG spec's own recommended heuristic. 'none' always emits filter type 0, useful for deterministic, human-auditable test output.
  readonly filter?: "none" | "adaptive";
}

function u32be(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function writeChunk(
  writer: ByteWriter,
  type: string,
  data: Uint8Array<ArrayBuffer>,
): void {
  const typeBytes = new TextEncoder().encode(type);
  writer.writeBytes(u32be(data.length));
  writer.writeBytes(typeBytes);
  writer.writeBytes(data);
  writer.writeBytes(u32be(crc32(concatBytes([typeBytes, data]))));
}

function writeIhdr(
  writer: ByteWriter,
  width: number,
  height: number,
  colorType: number,
): void {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth: always 8, since RawImage is always 8 bits per channel (including palette indices, which this encoder never packs below 8 bits)
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression method: always 0 (deflate)
  ihdr[11] = 0; // filter method: always 0 (the five-filter adaptive scheme)
  ihdr[12] = 0; // interlace method: 0 (no interlacing)
  writeChunk(writer, "IHDR", ihdr);
}

// IHDR colour type for the truecolour/greyscale path: 0 gray, 2 truecolor(RGB), 4 gray+alpha, 6 truecolor+alpha(RGBA). RawImage's channels/alpha combination maps onto these four. Colour type 3 (indexed/palette) is never chosen here -- it is only ever emitted by detectPalette below, and only for a channels === 3 image whose actual pixels reduce to a small enough palette.
function colorTypeFor(image: RawImage): number {
  if (image.channels === 1) {
    return image.alpha === undefined ? 0 : 4;
  }
  return image.alpha === undefined ? 2 : 6;
}

interface PaletteEncoding {
  readonly indices: Uint8Array<ArrayBuffer>;
  readonly palette: Uint8Array<ArrayBuffer>; // flattened R,G,B triples, one per palette entry
  readonly trns?: Uint8Array<ArrayBuffer>; // one alpha byte per palette entry, present only when image.alpha was defined
}

// Scans a truecolour RawImage's pixels for a lossless indexed-colour (PNG colour type 3) representation: every pixel's (r, g, b, a) reduces to one of at most 256 distinct colours, addressed by a one-byte-per-pixel index into a PLTE (+ tRNS) chunk pair. Returns undefined the instant a 257th distinct colour would be needed -- colour type 3 cannot hold more entries than that -- so the caller falls back to the truecolour path, which has no such limit. Only ever called for channels === 3: PNG's palette entries are always RGB triples, so a grayscale (channels === 1) RawImage indexed this way would come back from decodePng with channels === 3, silently changing its colour space -- exactly the round-trip break this feature must not introduce.
function detectPalette(image: RawImage): PaletteEncoding | undefined {
  const { width, height, data, alpha } = image;
  const pixelCount = width * height;
  const colorToIndex = new Map<number, number>();
  const indices = new Uint8Array(pixelCount);
  const paletteRgb: number[] = [];
  const paletteAlpha: number[] = [];

  for (let i = 0; i < pixelCount; i++) {
    const base = i * 3;
    const r = data[base]!;
    const g = data[base + 1]!;
    const b = data[base + 2]!;
    const a = alpha === undefined ? 255 : alpha[i]!;
    // A bijective encoding of the four 0..255 samples into one safe-integer key -- multiplication (not a `<<` shift) so the top channel never overflows into JS's 32-bit bitwise-operator truncation.
    const key = r + g * 256 + b * 65536 + a * 16777216;

    let index = colorToIndex.get(key);
    if (index === undefined) {
      if (colorToIndex.size >= MAX_PALETTE_ENTRIES) {
        return undefined;
      }
      index = colorToIndex.size;
      colorToIndex.set(key, index);
      paletteRgb.push(r, g, b);
      paletteAlpha.push(a);
    }
    indices[i] = index;
  }

  const palette = Uint8Array.from(paletteRgb);
  if (alpha === undefined) {
    return { indices, palette };
  }
  // A tRNS chunk is written whenever the source image carried an alpha plane at all, regardless of whether every value turns out opaque -- matching how colour types 4/6 always carry their alpha plane regardless of its actual values, so `image.alpha !== undefined` round-trips back to a defined (if all-255) alpha array rather than silently vanishing. Trailing fully-opaque entries are trimmed from the written chunk: decodePng already treats a palette index at or beyond the tRNS chunk's length as fully opaque, so this keeps the chunk minimal without losing information. The trim never goes below one entry -- a zero-length tRNS chunk is not a valid PNG chunk (strict decoders including libpng reject it outright), whereas a single-entry chunk validly states that one alpha value and lets every other palette entry default to 255, which is exactly what the fully-opaque case needs.
  let trnsLength = paletteAlpha.length;
  while (trnsLength > 1 && paletteAlpha[trnsLength - 1] === 255) {
    trnsLength--;
  }
  return {
    indices,
    palette,
    trns: Uint8Array.from(paletteAlpha.slice(0, trnsLength)),
  };
}

function writeIndexedPng(
  writer: ByteWriter,
  width: number,
  height: number,
  encoding: PaletteEncoding,
  options: PngEncodeOptions,
): void {
  writeIhdr(writer, width, height, 3);
  writeChunk(writer, "PLTE", encoding.palette);
  if (encoding.trns !== undefined) {
    writeChunk(writer, "tRNS", encoding.trns);
  }
  // one palette-index byte per pixel
  const filtered = filterScanlines(
    encoding.indices,
    height,
    width,
    1, // bpp: filterBpp(bitDepth=8, channels=1) for a single-sample-per-pixel index plane
    options.filter ?? "adaptive",
  );
  writeChunk(writer, "IDAT", deflate(filtered));
}

function writeTruecolorPng(
  writer: ByteWriter,
  image: RawImage,
  options: PngEncodeOptions,
): void {
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

  writeIhdr(writer, width, height, colorTypeFor(image));
  const filtered = filterScanlines(
    interleaved,
    height,
    bytesPerRow,
    outChannels,
    options.filter ?? "adaptive",
  );
  writeChunk(writer, "IDAT", deflate(filtered));
}

// Encodes normalised raw pixel data (8 bits per channel, optionally with a separate alpha plane) into PNG file bytes -- the exact inverse of decodePng's RawImage shape. A channels === 3 image is first checked for a lossless indexed-colour (colour type 3) representation, and encoded that way whenever its pixels reduce to 256 or fewer distinct colours -- indexed colour is substantially smaller than truecolour for the flat-colour images typical of diagrams and screenshots, and decodePng reconstructs the original RGB(A) data exactly via its own PLTE/tRNS lookup, so this never changes what decodePng(encodePng(image)) hands back. Every other image (grayscale, or a truecolour image with more than 256 distinct colours) falls back to the plain truecolour/greyscale path. Throws for a zero (or negative) width or height: the PNG spec (section 11.2.2, IHDR) states zero is an invalid value for either, so there is no valid PNG this function could produce for such an image.
export function encodePng(
  image: RawImage,
  options: PngEncodeOptions = {},
): Uint8Array<ArrayBuffer> {
  if (image.width <= 0 || image.height <= 0) {
    throw new Error(
      `cannot encode a zero-dimension PNG (width=${image.width}, height=${image.height}); the PNG spec's IHDR section states zero is an invalid value for either`,
    );
  }

  const paletteEncoding =
    image.channels === 3 ? detectPalette(image) : undefined;

  const writer = new ByteWriter();
  writer.writeBytes(PNG_SIGNATURE);
  if (paletteEncoding !== undefined) {
    writeIndexedPng(
      writer,
      image.width,
      image.height,
      paletteEncoding,
      options,
    );
  } else {
    writeTruecolorPng(writer, image, options);
  }
  writeChunk(writer, "IEND", new Uint8Array(0));
  return writer.toBytes();
}
