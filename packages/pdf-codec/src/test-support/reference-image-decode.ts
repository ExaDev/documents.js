import type { RawImage } from "byte-codec";
import type { ResolvedColorSpace } from "../images-read";
import { cmykToRgbByte, sampleFromPalette, scaleToByte } from "../images-read";

// The sample decode images-read.ts used before it decoded into typed arrays (ExaDev/documents.js#1721), kept byte for byte (only buildRawImage renamed and exported) as the reference images-read-decode-differential.test.ts compares the current decode against: every sample unpacked into its own number array entry, then copied into the raster. Its helpers that the change left alone (scaleToByte, cmykToRgbByte, sampleFromPalette) are imported rather than copied, so a difference between the two can only come from the unpacking and the raster assembly.

// Component/channel counts this module converts between: PDF DeviceCMYK's own four components, and the three channels every raster this module ever outputs (RawImage is always RGB or gray, never CMYK).
const CMYK_COMPONENT_COUNT = 4;
const RGB_CHANNEL_COUNT = 3;
// One PDF sample byte's full range (ISO 32000-1 7.4.9's implicit 8-bit-per-sample assumption once BitsPerComponent is scaled up to it), and the width of one byte in bits.
const MAX_BYTE_VALUE = 255;
const BITS_PER_BYTE = 8;

function componentsOf(cs: ResolvedColorSpace): number {
  if (cs.kind === "gray") {
    return 1;
  }
  if (cs.kind === "cmyk") {
    return CMYK_COMPONENT_COUNT;
  }
  return RGB_CHANNEL_COUNT; // rgb, and indexed's own per-pixel sample count (handled separately — this is only used for a resolved *base* space)
}

// Unpacks sub-byte-depth samples (1/2/4-bit) into one array entry per sample, each row starting on its own byte boundary — the same row-padding convention PNG's own IDAT payload uses. The 8-bit case is a fast path: already byte-aligned, one sample per byte.
function unpackSamples(
  data: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  componentsPerPixel: number,
  bitsPerComponent: number,
): number[] {
  if (bitsPerComponent === BITS_PER_BYTE) {
    return Array.from(data.subarray(0, width * height * componentsPerPixel));
  }
  const samplesPerRow = width * componentsPerPixel;
  const bytesPerRow = Math.ceil(
    (samplesPerRow * bitsPerComponent) / BITS_PER_BYTE,
  );
  const out: number[] = [];
  for (let row = 0; row < height; row++) {
    const rowStart = row * bytesPerRow;
    let bitPos = 0;
    for (let s = 0; s < samplesPerRow; s++) {
      let value = 0;
      for (let b = 0; b < bitsPerComponent; b++) {
        const byteIndex = rowStart + Math.floor(bitPos / BITS_PER_BYTE);
        // Bits pack MSB-first within each byte, so the bit at position `bitPos` within the row sits this many places from that byte's own high bit.
        const bitIndex = BITS_PER_BYTE - 1 - (bitPos % BITS_PER_BYTE);
        const bit = ((data[byteIndex] ?? 0) >> bitIndex) & 1;
        value = (value << 1) | bit;
        bitPos++;
      }
      out.push(value);
    }
  }
  return out;
}

export function referenceDecodeImageSamples(
  data: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  bitsPerComponent: number,
  colorSpace: ResolvedColorSpace,
  inverted: boolean,
): RawImage {
  const maxValue = (1 << bitsPerComponent) - 1;

  if (colorSpace.kind === "indexed") {
    const indices = unpackSamples(data, width, height, 1, bitsPerComponent);
    const baseComponents = componentsOf(colorSpace.base);
    const out = new Uint8Array(
      width *
        height *
        (colorSpace.base.kind === "gray" ? 1 : RGB_CHANNEL_COUNT),
    );
    let outIdx = 0;
    for (const index of indices) {
      const rgb = sampleFromPalette(
        colorSpace.base,
        colorSpace.lookup,
        index * baseComponents,
      );
      if (colorSpace.base.kind === "gray") {
        out[outIdx++] = rgb.r;
      } else {
        out[outIdx++] = rgb.r;
        out[outIdx++] = rgb.g;
        out[outIdx++] = rgb.b;
      }
    }
    return {
      width,
      height,
      channels: colorSpace.base.kind === "gray" ? 1 : RGB_CHANNEL_COUNT,
      data: out,
    };
  }

  if (colorSpace.kind === "gray") {
    const samples = unpackSamples(data, width, height, 1, bitsPerComponent);
    const out = Uint8Array.from(samples, (v) =>
      scaleToByte(v, maxValue, inverted),
    );
    return { width, height, channels: 1, data: out };
  }

  if (colorSpace.kind === "rgb") {
    const samples = unpackSamples(
      data,
      width,
      height,
      RGB_CHANNEL_COUNT,
      bitsPerComponent,
    );
    const out = Uint8Array.from(samples, (v) =>
      scaleToByte(v, maxValue, inverted),
    );
    return { width, height, channels: RGB_CHANNEL_COUNT, data: out };
  }

  // cmyk
  const samples = unpackSamples(
    data,
    width,
    height,
    CMYK_COMPONENT_COUNT,
    bitsPerComponent,
  );
  const out = new Uint8Array(width * height * RGB_CHANNEL_COUNT);
  for (let px = 0; px < width * height; px++) {
    const c =
      scaleToByte(samples[px * CMYK_COMPONENT_COUNT] ?? 0, maxValue, inverted) /
      MAX_BYTE_VALUE;
    const m =
      scaleToByte(
        samples[px * CMYK_COMPONENT_COUNT + 1] ?? 0,
        maxValue,
        inverted,
      ) / MAX_BYTE_VALUE;
    const y =
      scaleToByte(
        samples[px * CMYK_COMPONENT_COUNT + 2] ?? 0,
        maxValue,
        inverted,
      ) / MAX_BYTE_VALUE;
    const k =
      scaleToByte(
        samples[px * CMYK_COMPONENT_COUNT + (CMYK_COMPONENT_COUNT - 1)] ?? 0,
        maxValue,
        inverted,
      ) / MAX_BYTE_VALUE;
    const rgb = cmykToRgbByte(c, m, y, k);
    out[px * RGB_CHANNEL_COUNT] = rgb.r;
    out[px * RGB_CHANNEL_COUNT + 1] = rgb.g;
    out[px * RGB_CHANNEL_COUNT + 2] = rgb.b;
  }
  return { width, height, channels: RGB_CHANNEL_COUNT, data: out };
}
