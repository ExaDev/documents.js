import type { JpegInfo, RawImage } from "byte-codec";
import {
  encodePng,
  PNG_MAX_DIMENSION,
  PNG_MAX_PIXELS,
  readJpegInfo,
} from "byte-codec";
import type { Jpeg2000Image } from "./image/jpeg2000";
import { decodeJpeg2000 } from "./image/jpeg2000";
import type { PdfDiagnosticSink } from "./diagnostics";
import { decodeStream } from "./filters";
import type { PdfObjectResolver } from "./interpret-types";
import type { PdfDict, PdfObject } from "./objects";
import { asArray, asBool, asName, asNumber, dictGet } from "./objects";

// Turns an Image XObject (or an inline image's dict+data) into bytes ready to store as a LayoutImageAsset. A DCTDecode (JPEG) image passes through completely undecoded — its compressed bytes ARE the deliverable, exactly mirroring the write path's own lossless JPEG passthrough. Everything else is decoded to raw samples and re-encoded as PNG via byte-codec's own encodePng, since LayoutImageAsset only ever stores 'png' or 'jpeg' — byte-codec's encodePng is this package's only PNG encoder: a caller's own imageId is a crc32 of the PNG bytes it originally supplied (see documents.js's registerImageBytes), so this module's re-encode of the same raster data must run through the identical function a caller would have used, not a second, independently-maintained copy that could silently diverge from it.

export interface ExtractedPdfImage {
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly widthPx: number;
  readonly heightPx: number;
  // The source's own compressed stream for a filter this package has no encoder for (JBIG2, JPEG 2000), carried beside the decoded canonical so a same-format writer re-embeds it verbatim instead of re-encoding the pixels — the image-layer spelling of document-schema.js's ContentImageOriginal. globalsBytes is the decoded /JBIG2Globals segment stream a JBIG2 image declared (without it a symbol-dictionary stream cannot decode, so a verbatim re-embed must carry it). Never set for DCTDecode (the JPEG bytes ARE the deliverable) or Flate/CCITT (re-encoded losslessly).
  readonly original?: {
    readonly filter: "jbig2" | "jpeg2000";
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly globalsBytes?: Uint8Array<ArrayBuffer>;
  };
}

export type ResolvedColorSpace =
  | { readonly kind: "gray" }
  | { readonly kind: "rgb" }
  | { readonly kind: "cmyk" }
  | {
      readonly kind: "indexed";
      readonly base: ResolvedColorSpace;
      readonly lookup: Uint8Array<ArrayBuffer>;
    }
  | { readonly kind: "unsupported"; readonly name: string };

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

function resolveColorSpace(
  csObj: PdfObject | undefined,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): ResolvedColorSpace {
  const resolved = resolver.resolve(csObj);
  const directName = resolved?.kind === "name" ? resolved.name : undefined;
  if (directName !== undefined) {
    if (
      directName === "DeviceGray" ||
      directName === "CalGray" ||
      directName === "G"
    ) {
      return { kind: "gray" };
    }
    if (
      directName === "DeviceRGB" ||
      directName === "CalRGB" ||
      directName === "RGB"
    ) {
      return { kind: "rgb" };
    }
    if (directName === "DeviceCMYK" || directName === "CMYK") {
      return { kind: "cmyk" };
    }
    return { kind: "unsupported", name: directName };
  }
  const arr = resolved?.kind === "array" ? resolved.items : undefined;
  if (arr === undefined) {
    return { kind: "unsupported", name: "(missing or invalid /ColorSpace)" };
  }
  const family = asName(arr[0]);
  if (family === "ICCBased") {
    const streamObj = resolver.resolve(arr[1]);
    const n =
      streamObj?.kind === "stream"
        ? asNumber(dictGet(streamObj.dict, "N"))
        : undefined;
    if (n === 1) {
      return { kind: "gray" };
    }
    if (n === CMYK_COMPONENT_COUNT) {
      return { kind: "cmyk" };
    }
    return { kind: "rgb" }; // 3-component ICC (by far the common case) and any unlabelled profile both treated as RGB
  }
  if (family === "Indexed") {
    const base = resolveColorSpace(arr[1], resolver, sink);
    const lookupObj = resolver.resolve(arr[3]);
    let lookup: Uint8Array<ArrayBuffer>;
    if (lookupObj?.kind === "stream") {
      lookup = decodeStream(lookupObj.raw, lookupObj.dict, sink).bytes;
    } else if (lookupObj?.kind === "string") {
      lookup = lookupObj.bytes;
    } else {
      lookup = new Uint8Array(0);
    }
    return { kind: "indexed", base, lookup };
  }
  if (family === "CalGray") {
    return { kind: "gray" };
  }
  if (family === "CalRGB") {
    return { kind: "rgb" };
  }
  return {
    kind: "unsupported",
    name: family ?? "(unrecognised array colour space)",
  };
}

/**
 * Allocates the buffers one `decodeImageSamples` call needs and counts their bytes, so a test can bound the decode's memory in bytes rather than time.
 */
export class SampleDecodeWork {
  #bytesAllocated = 0;

  /** Bytes of every buffer the decode allocated: its raster, its one reusable row and its lookup table. Each lives until the decode returns, so this is also the decode's peak; a view onto the stream it was given costs nothing. */
  get bytesAllocated(): number {
    return this.#bytesAllocated;
  }

  /**
   * A zero-filled buffer of `length` bytes, counted.
   * @param length - Its length in bytes.
   * @returns The buffer.
   */
  allocate(length: number): Uint8Array<ArrayBuffer> {
    this.#bytesAllocated += length;
    return new Uint8Array(length);
  }
}

// Fills `target` (one row's worth of samples) with row `row`'s raw sample values. Each row starts on its own byte boundary (ISO 32000-1 8.9.3), the same row padding PNG's own IDAT payload uses, and a sub-byte sample (1, 2 or 4 bits) never straddles a byte, packing most significant bit first. A sample past the end of a short stream reads as 0.
function readSampleRow(
  data: Uint8Array<ArrayBuffer>,
  row: number,
  bitsPerComponent: number,
  target: Uint8Array<ArrayBuffer>,
): void {
  const samplesPerRow = target.length;
  if (bitsPerComponent === BITS_PER_BYTE) {
    const rowStart = row * samplesPerRow;
    for (let s = 0; s < samplesPerRow; s++) {
      target[s] = data[rowStart + s] ?? 0;
    }
    return;
  }
  const rowStart =
    row * Math.ceil((samplesPerRow * bitsPerComponent) / BITS_PER_BYTE);
  const sampleMask = (1 << bitsPerComponent) - 1;
  for (let s = 0; s < samplesPerRow; s++) {
    const bitPos = s * bitsPerComponent;
    const byte = data[rowStart + Math.floor(bitPos / BITS_PER_BYTE)] ?? 0;
    // The sample's own low bit sits this many places above the byte's low bit.
    const shift = BITS_PER_BYTE - bitsPerComponent - (bitPos % BITS_PER_BYTE);
    target[s] = (byte >> shift) & sampleMask;
  }
}

// Calls `visit` once per row with that row's raw samples and the flat (row-major) index of its first sample, in one row buffer reused for every row, so walking an image holds one row of samples at a time rather than all of them.
function forEachSampleRow(
  data: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  componentsPerPixel: number,
  bitsPerComponent: number,
  work: SampleDecodeWork,
  visit: (samples: Uint8Array<ArrayBuffer>, firstSample: number) => void,
): void {
  const samplesPerRow = width * componentsPerPixel;
  const rowSamples = work.allocate(samplesPerRow);
  for (let row = 0; row < height; row++) {
    readSampleRow(data, row, bitsPerComponent, rowSamples);
    visit(rowSamples, row * samplesPerRow);
  }
}

// How many of an image's samples carry a value into a gray, RGB or indexed raster. An 8-bit stream shorter than the image yields only the samples it holds, and the raster built from it is that much shorter (encodePng reads past its end as 0); a sub-byte stream's rows are always unpacked whole, a missing byte reading as 0.
function availableSampleCount(
  data: Uint8Array<ArrayBuffer>,
  sampleCount: number,
  bitsPerComponent: number,
): number {
  return bitsPerComponent === BITS_PER_BYTE
    ? Math.min(data.length, sampleCount)
    : sampleCount;
}

export function scaleToByte(
  value: number,
  maxValue: number,
  inverted: boolean,
): number {
  const v = inverted ? maxValue - value : value;
  return maxValue === MAX_BYTE_VALUE
    ? v
    : Math.round((v * MAX_BYTE_VALUE) / maxValue);
}

export function cmykToRgbByte(
  c: number,
  m: number,
  y: number,
  k: number,
): { r: number; g: number; b: number } {
  return {
    r: Math.round(MAX_BYTE_VALUE * (1 - c) * (1 - k)),
    g: Math.round(MAX_BYTE_VALUE * (1 - m) * (1 - k)),
    b: Math.round(MAX_BYTE_VALUE * (1 - y) * (1 - k)),
  };
}

export function sampleFromPalette(
  base: ResolvedColorSpace,
  lookup: Uint8Array<ArrayBuffer>,
  offset: number,
): { r: number; g: number; b: number } {
  if (base.kind === "gray") {
    const g = lookup[offset] ?? 0;
    return { r: g, g, b: g };
  }
  if (base.kind === "cmyk") {
    return cmykToRgbByte(
      (lookup[offset] ?? 0) / MAX_BYTE_VALUE,
      (lookup[offset + 1] ?? 0) / MAX_BYTE_VALUE,
      (lookup[offset + 2] ?? 0) / MAX_BYTE_VALUE,
      (lookup[offset + (CMYK_COMPONENT_COUNT - 1)] ?? 0) / MAX_BYTE_VALUE,
    );
  }
  return {
    r: lookup[offset] ?? 0,
    g: lookup[offset + 1] ?? 0,
    b: lookup[offset + 2] ?? 0,
  };
}

// scaleToByte for every value a sample of this depth can hold, so a decode looks each sample up rather than rescaling it.
function scaleTable(
  maxValue: number,
  inverted: boolean,
  work: SampleDecodeWork,
): Uint8Array<ArrayBuffer> {
  const table = work.allocate(maxValue + 1);
  for (let value = 0; value <= maxValue; value++) {
    table[value] = scaleToByte(value, maxValue, inverted);
  }
  return table;
}

/**
 * Decodes an image's samples into the 8-bit raster `encodePng` takes, holding at most the raster itself, one row of samples and a lookup table of at most 256 entries beside the stream; nothing is allocated per sample.
 * @param data - The image's decoded stream: rows of `width` pixels padded to a whole byte, sub-byte samples packed most significant bit first.
 * @param width - Pixels per row.
 * @param height - Rows.
 * @param bitsPerComponent - 1, 2, 4 or 8.
 * @param colorSpace - The resolved colour space; never `unsupported`.
 * @param inverted - Whether `/Decode` is `[1 0]`, which a gray, RGB or CMYK sample is inverted by and an indexed one ignores.
 * @param work - Counts the bytes allocated; see SampleDecodeWork.
 * @returns A gray or RGB raster. An 8-bit gray or RGB image with no `/Decode` inversion is already that raster, so its data is a view onto `data` and costs no allocation. An 8-bit stream shorter than the image yields a gray, RGB or indexed raster holding only the pixels the stream covers, and a CMYK one in which each missing sample reads as 0.
 */
export function decodeImageSamples(
  data: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  bitsPerComponent: number,
  colorSpace: Exclude<ResolvedColorSpace, { readonly kind: "unsupported" }>,
  inverted: boolean,
  work: SampleDecodeWork = new SampleDecodeWork(),
): RawImage {
  const maxValue = (1 << bitsPerComponent) - 1;
  const pixelCount = width * height;

  if (colorSpace.kind === "indexed") {
    const channels = colorSpace.base.kind === "gray" ? 1 : RGB_CHANNEL_COUNT;
    const baseComponents = componentsOf(colorSpace.base);
    // Every colour an index of this depth can name, already in the raster's channel layout.
    const palette = work.allocate((maxValue + 1) * channels);
    for (let index = 0; index <= maxValue; index++) {
      const rgb = sampleFromPalette(
        colorSpace.base,
        colorSpace.lookup,
        index * baseComponents,
      );
      palette[index * channels] = rgb.r;
      if (channels === RGB_CHANNEL_COUNT) {
        palette[index * channels + 1] = rgb.g;
        palette[index * channels + 2] = rgb.b;
      }
    }
    const out = work.allocate(pixelCount * channels);
    const indexed = availableSampleCount(data, pixelCount, bitsPerComponent);
    forEachSampleRow(
      data,
      width,
      height,
      1,
      bitsPerComponent,
      work,
      (indices, firstPixel) => {
        const count = Math.min(indices.length, indexed - firstPixel);
        for (let i = 0; i < count; i++) {
          const entry = indices[i]! * channels;
          const at = (firstPixel + i) * channels;
          for (let channel = 0; channel < channels; channel++) {
            out[at + channel] = palette[entry + channel]!;
          }
        }
      },
    );
    return { width, height, channels, data: out };
  }

  if (colorSpace.kind === "gray" || colorSpace.kind === "rgb") {
    const channels = colorSpace.kind === "gray" ? 1 : RGB_CHANNEL_COUNT;
    const available = availableSampleCount(
      data,
      pixelCount * channels,
      bitsPerComponent,
    );
    if (bitsPerComponent === BITS_PER_BYTE && !inverted) {
      return { width, height, channels, data: data.subarray(0, available) };
    }
    const scale = scaleTable(maxValue, inverted, work);
    const out = work.allocate(available);
    forEachSampleRow(
      data,
      width,
      height,
      channels,
      bitsPerComponent,
      work,
      (samples, firstSample) => {
        const count = Math.min(samples.length, available - firstSample);
        for (let i = 0; i < count; i++) {
          out[firstSample + i] = scale[samples[i]!]!;
        }
      },
    );
    return { width, height, channels, data: out };
  }

  // cmyk
  const scale = scaleTable(maxValue, inverted, work);
  const out = work.allocate(pixelCount * RGB_CHANNEL_COUNT);
  forEachSampleRow(
    data,
    width,
    height,
    CMYK_COMPONENT_COUNT,
    bitsPerComponent,
    work,
    (samples, firstSample) => {
      const firstPixel = firstSample / CMYK_COMPONENT_COUNT;
      for (let px = 0; px < width; px++) {
        const base = px * CMYK_COMPONENT_COUNT;
        const rgb = cmykToRgbByte(
          scale[samples[base]!]! / MAX_BYTE_VALUE,
          scale[samples[base + 1]!]! / MAX_BYTE_VALUE,
          scale[samples[base + 2]!]! / MAX_BYTE_VALUE,
          scale[samples[base + (CMYK_COMPONENT_COUNT - 1)]!]! / MAX_BYTE_VALUE,
        );
        const outBase = (firstPixel + px) * RGB_CHANNEL_COUNT;
        out[outBase] = rgb.r;
        out[outBase + 1] = rgb.g;
        out[outBase + 2] = rgb.b;
      }
    },
  );
  return { width, height, channels: RGB_CHANNEL_COUNT, data: out };
}

function readSoftMaskAlpha(
  dict: PdfDict,
  width: number,
  height: number,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): Uint8Array<ArrayBuffer> | undefined {
  const smaskObj = resolver.resolve(dictGet(dict, "SMask"));
  if (smaskObj?.kind !== "stream") {
    return undefined;
  }
  const decoded = decodeStream(smaskObj.raw, smaskObj.dict, sink);
  if (decoded.remainingFilter !== undefined) {
    return undefined; // an encoded (e.g. DCT) soft mask is out of scope — degrade to no alpha rather than guess
  }
  const smaskWidth = asNumber(dictGet(smaskObj.dict, "Width")) ?? width;
  const smaskHeight = asNumber(dictGet(smaskObj.dict, "Height")) ?? height;
  const smaskBpc =
    asNumber(dictGet(smaskObj.dict, "BitsPerComponent")) ?? BITS_PER_BYTE;
  if (
    smaskWidth !== width ||
    smaskHeight !== height ||
    smaskBpc !== BITS_PER_BYTE
  ) {
    return undefined; // a differently-sized or differently-depthed mask needs resampling this module doesn't do
  }
  return decoded.bytes.subarray(0, width * height);
}

// ISO 32000-1 7.4.9: for a JPXDecode image the codestream is authoritative about how many components there are and how deep their samples run, and /BitsPerComponent "shall not be present" at all. /ColorSpace is optional, and when it IS present it overrides whatever the JP2 boxes said — which is the only reason the dictionary is consulted here rather than the codestream alone.
function jpeg2000ChannelKind(
  image: Jpeg2000Image,
  dict: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): "gray" | "rgb" | "cmyk" {
  const declared = dictGet(dict, "ColorSpace") ?? dictGet(dict, "CS");
  if (declared !== undefined) {
    const resolved = resolveColorSpace(declared, resolver, sink);
    if (
      resolved.kind === "gray" ||
      resolved.kind === "rgb" ||
      resolved.kind === "cmyk"
    ) {
      return resolved.kind;
    }
  }
  if (image.colourSpace === "greyscale") {
    return "gray";
  }
  if (image.colourSpace === "cmyk") {
    return "cmyk";
  }
  if (
    image.colourSpace === "srgb" ||
    image.colourSpace === "sycc" ||
    image.colourSpace === "e-srgb" ||
    image.colourSpace === "rommrgb"
  ) {
    return "rgb";
  }
  // A bare codestream carries no colour specification of its own, so the component count is the only thing left to go on — the same fallback every JPEG 2000 reader makes.
  return image.components.length >= CMYK_COMPONENT_COUNT
    ? "cmyk"
    : image.components.length >= RGB_CHANNEL_COUNT
      ? "rgb"
      : "gray";
}

function readJpeg2000Image(
  dict: PdfDict,
  raw: Uint8Array<ArrayBuffer>,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): ExtractedPdfImage | undefined {
  let image: Jpeg2000Image;
  try {
    image = decodeJpeg2000(raw, {
      onWarning: (message) => {
        sink({ code: "image/jpx-degraded", severity: "warning", message });
      },
      // Mirrors readImageXObject's own /Width and /Height guard below (both the per-dimension PNG_MAX_DIMENSION ceiling and the PNG_MAX_PIXELS product ceiling): a JPXDecode codestream's SIZ marker is just as producer-controlled as a dictionary's /Width and /Height, and everything downstream — the per-pixel colour-conversion loops below and encodePng itself — is sized directly by image.width * image.height, so an oversized SIZ would otherwise reach encodePng's own throw uncaught, aborting the whole document parse instead of degrading to this function's usual "skip this image" diagnostic. Passed as decode options, rather than checked against decodeJpeg2000's return value, so an oversized canvas is rejected before decodeJpeg2000 allocates its own per-component sample planes for it, not after.
      maxWidth: PNG_MAX_DIMENSION,
      maxHeight: PNG_MAX_DIMENSION,
      maxPixels: PNG_MAX_PIXELS,
    });
  } catch (error) {
    sink({
      code: "image/jpx-undecodable",
      severity: "warning",
      message: `JPXDecode image could not be decoded (${error instanceof Error ? error.message : String(error)}); skipping this image`,
    });
    return undefined;
  }

  const kind = jpeg2000ChannelKind(image, dict, resolver, sink);
  const required =
    kind === "cmyk"
      ? CMYK_COMPONENT_COUNT
      : kind === "rgb"
        ? RGB_CHANNEL_COUNT
        : 1;
  if (image.components.length < required) {
    sink({
      code: "image/jpx-undecodable",
      severity: "warning",
      message: `JPXDecode image resolves to a ${kind} colour space but carries only ${String(image.components.length)} component(s); skipping this image`,
    });
    return undefined;
  }
  if (image.components.length > required) {
    // An extra channel is an opacity or auxiliary one (a JP2 cdef box says which). Compositing it would need /SMaskInData handling this codec does not implement, so it is dropped rather than mistaken for colour.
    sink({
      code: "image/jpx-extra-channels",
      severity: "info",
      message: `JPXDecode image carries ${String(image.components.length)} components where its colour space needs ${String(required)}; the extra channel(s) are ignored`,
    });
  }

  // The codestream's own sample depth is whatever it declares; a RawImage is always eight bits per channel, so anything else is scaled onto that range.
  const maximum = (1 << image.bitDepth) - 1;
  const scale = (value: number): number =>
    image.bitDepth === BITS_PER_BYTE
      ? value
      : Math.round((value * MAX_BYTE_VALUE) / maximum);
  const pixels = image.width * image.height;
  const channels = kind === "gray" ? 1 : RGB_CHANNEL_COUNT;
  const data = new Uint8Array(pixels * channels);
  if (kind === "cmyk") {
    for (let i = 0; i < pixels; i++) {
      const rgb = cmykToRgbByte(
        scale(image.components[0]?.[i] ?? 0) / MAX_BYTE_VALUE,
        scale(image.components[1]?.[i] ?? 0) / MAX_BYTE_VALUE,
        scale(image.components[2]?.[i] ?? 0) / MAX_BYTE_VALUE,
        scale(image.components[CMYK_COMPONENT_COUNT - 1]?.[i] ?? 0) /
          MAX_BYTE_VALUE,
      );
      data[i * RGB_CHANNEL_COUNT] = rgb.r;
      data[i * RGB_CHANNEL_COUNT + 1] = rgb.g;
      data[i * RGB_CHANNEL_COUNT + 2] = rgb.b;
    }
  } else {
    for (let channel = 0; channel < channels; channel++) {
      const plane = image.components[channel];
      for (let i = 0; i < pixels; i++) {
        data[i * channels + channel] = scale(plane?.[i] ?? 0);
      }
    }
  }

  const rawImage: RawImage = {
    width: image.width,
    height: image.height,
    channels,
    data,
  };
  const alpha = readSoftMaskAlpha(
    dict,
    image.width,
    image.height,
    resolver,
    sink,
  );
  const withAlpha: RawImage =
    alpha !== undefined ? { ...rawImage, alpha } : rawImage;
  return {
    format: "png",
    bytes: encodePng(withAlpha),
    widthPx: image.width,
    heightPx: image.height,
    original: { filter: "jpeg2000", bytes: raw },
  };
}

export function readImageXObject(
  dict: PdfDict,
  raw: Uint8Array<ArrayBuffer>,
  resolver: Readonly<PdfObjectResolver>,
  sink: PdfDiagnosticSink,
): ExtractedPdfImage | undefined {
  if (asBool(dictGet(dict, "ImageMask") ?? dictGet(dict, "IM")) === true) {
    sink({
      code: "image/mask-unsupported",
      severity: "info",
      message:
        "an /ImageMask stencil paints with the current fill colour rather than standing alone as an image; skipping",
    });
    return undefined;
  }

  // The resolver is threaded in here, and only here, because JBIG2Decode's own /JBIG2Globals DecodeParms entry is a stream that a producer essentially always writes as an indirect reference — no other filter this codec implements has a parameter that needs dereferencing.
  const decoded = decodeStream(raw, dict, sink, (obj) => resolver.resolve(obj));
  const jbig2Original: ExtractedPdfImage["original"] =
    decoded.jbig2 === undefined
      ? undefined
      : {
          filter: "jbig2",
          bytes: decoded.jbig2.encoded,
          ...(decoded.jbig2.globals !== undefined
            ? { globalsBytes: decoded.jbig2.globals }
            : {}),
        };
  if (decoded.remainingFilter === "DCTDecode") {
    let info: JpegInfo;
    try {
      info = readJpegInfo(decoded.bytes);
    } catch {
      sink({
        code: "image/undecodable",
        severity: "warning",
        message:
          "DCTDecode image bytes did not look like a valid JPEG (no SOF marker found); skipping this image",
      });
      return undefined;
    }
    return {
      format: "jpeg",
      bytes: decoded.bytes,
      widthPx: info.width,
      heightPx: info.height,
    };
  }
  if (decoded.remainingFilter === "JPXDecode") {
    return readJpeg2000Image(dict, decoded.bytes, resolver, sink);
  }
  if (decoded.remainingFilter !== undefined) {
    return undefined; // decodeStream already raised 'pdf/unsupported-filter'
  }

  const width = asNumber(dictGet(dict, "Width") ?? dictGet(dict, "W"));
  const height = asNumber(dictGet(dict, "Height") ?? dictGet(dict, "H"));
  // Mirrors encodePng's own dimension guard exactly (both the per-dimension PNG_MAX_DIMENSION ceiling and the PNG_MAX_PIXELS product ceiling), rather than only the lower bound — everything decoded past this point eventually reaches encodePng via decodeImageSamples' own width*height-sized raster below, so a dict this guard lets through must already be a dimension pair encodePng is guaranteed to accept, or a malformed producer's out-of-range /Width or /Height would abort this document's entire parse instead of degrading to the diagnostic below.
  if (
    width === undefined ||
    height === undefined ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > PNG_MAX_DIMENSION ||
    height > PNG_MAX_DIMENSION ||
    width * height > PNG_MAX_PIXELS
  ) {
    sink({
      code: "image/undecodable",
      severity: "warning",
      message:
        "image XObject has an invalid, out-of-range, or unusably large /Width or /Height; skipping",
    });
    return undefined;
  }

  const bitsPerComponent =
    asNumber(dictGet(dict, "BitsPerComponent") ?? dictGet(dict, "BPC")) ??
    BITS_PER_BYTE;
  // The third of PDF's four legal /BitsPerComponent depths (1, 2, 4, 8 — ISO 32000-1 Table 89, or Table 6 in later editions); 1 and 2 need no name of their own, exempt from this rule as structurally self-evident, and 8 reuses BITS_PER_BYTE.
  const FOUR_BIT_DEPTH = 4;
  if (
    bitsPerComponent !== 1 &&
    bitsPerComponent !== 2 &&
    bitsPerComponent !== FOUR_BIT_DEPTH &&
    bitsPerComponent !== BITS_PER_BYTE
  ) {
    sink({
      code: "image/unsupported-bit-depth",
      severity: "warning",
      message: `image has an unsupported /BitsPerComponent (${String(bitsPerComponent)}); skipping`,
    });
    return undefined;
  }

  const colorSpace = resolveColorSpace(
    dictGet(dict, "ColorSpace") ?? dictGet(dict, "CS"),
    resolver,
    sink,
  );
  if (colorSpace.kind === "unsupported") {
    sink({
      code: "image/unsupported-colorspace",
      severity: "warning",
      message: `image has an unsupported colour space (${colorSpace.name}); skipping`,
    });
    return undefined;
  }

  const decodeArr = asArray(dictGet(dict, "Decode"));
  const inverted =
    decodeArr !== undefined &&
    asNumber(decodeArr[0]) === 1 &&
    asNumber(decodeArr[1]) === 0;

  const rawImage = decodeImageSamples(
    decoded.bytes,
    width,
    height,
    bitsPerComponent,
    colorSpace,
    inverted,
  );
  const alpha = readSoftMaskAlpha(dict, width, height, resolver, sink);
  const withAlpha: RawImage =
    alpha !== undefined ? { ...rawImage, alpha } : rawImage;
  return {
    format: "png",
    bytes: encodePng(withAlpha),
    widthPx: width,
    heightPx: height,
    ...(jbig2Original !== undefined ? { original: jbig2Original } : {}),
  };
}
