import type { RawImage } from './image/png-decode';
import { encodePng } from './image/png-encode';
import type { JpegInfo } from './image/jpeg-info';
import { readJpegInfo } from './image/jpeg-info';
import type { PdfDiagnosticSink } from './diagnostics';
import { decodeStream } from './filters';
import type { PdfObjectResolver } from './interpret';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asName, asNumber, dictGet } from './objects';

// Turns an Image XObject (or an inline image's dict+data) into bytes ready to store as a LayoutImageAsset. A DCTDecode (JPEG) image passes through completely undecoded -- its compressed bytes ARE the deliverable, exactly mirroring the write path's own lossless JPEG passthrough. Everything else is decoded to raw samples and re-encoded as PNG via image/png-encode.ts, since LayoutImageAsset only ever stores 'png' or 'jpeg'.

export interface ExtractedPdfImage {
  readonly format: 'png' | 'jpeg';
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly widthPx: number;
  readonly heightPx: number;
}

type ResolvedColorSpace =
  | { readonly kind: 'gray' }
  | { readonly kind: 'rgb' }
  | { readonly kind: 'cmyk' }
  | { readonly kind: 'indexed'; readonly base: ResolvedColorSpace; readonly lookup: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'unsupported'; readonly name: string };

function componentsOf(cs: ResolvedColorSpace): number {
  if (cs.kind === 'gray') {
    return 1;
  }
  if (cs.kind === 'cmyk') {
    return 4;
  }
  return 3; // rgb, and indexed's own per-pixel sample count (handled separately -- this is only used for a resolved *base* space)
}

function resolveColorSpace(csObj: PdfObject | undefined, resolver: PdfObjectResolver, sink: PdfDiagnosticSink): ResolvedColorSpace {
  const resolved = resolver.resolve(csObj);
  const directName = resolved?.kind === 'name' ? resolved.name : undefined;
  if (directName !== undefined) {
    if (directName === 'DeviceGray' || directName === 'CalGray' || directName === 'G') {
      return { kind: 'gray' };
    }
    if (directName === 'DeviceRGB' || directName === 'CalRGB' || directName === 'RGB') {
      return { kind: 'rgb' };
    }
    if (directName === 'DeviceCMYK' || directName === 'CMYK') {
      return { kind: 'cmyk' };
    }
    return { kind: 'unsupported', name: directName };
  }
  const arr = resolved?.kind === 'array' ? resolved.items : undefined;
  if (arr === undefined) {
    return { kind: 'unsupported', name: '(missing or invalid /ColorSpace)' };
  }
  const family = asName(arr[0]);
  if (family === 'ICCBased') {
    const streamObj = resolver.resolve(arr[1]);
    const n = streamObj?.kind === 'stream' ? asNumber(dictGet(streamObj.dict, 'N')) : undefined;
    if (n === 1) {
      return { kind: 'gray' };
    }
    if (n === 4) {
      return { kind: 'cmyk' };
    }
    return { kind: 'rgb' }; // 3-component ICC (by far the common case) and any unlabelled profile both treated as RGB
  }
  if (family === 'Indexed') {
    const base = resolveColorSpace(arr[1], resolver, sink);
    const lookupObj = resolver.resolve(arr[3]);
    let lookup: Uint8Array<ArrayBuffer>;
    if (lookupObj?.kind === 'stream') {
      lookup = decodeStream(lookupObj.raw, lookupObj.dict, sink).bytes;
    } else if (lookupObj?.kind === 'string') {
      lookup = lookupObj.bytes;
    } else {
      lookup = new Uint8Array(0);
    }
    return { kind: 'indexed', base, lookup };
  }
  if (family === 'CalGray') {
    return { kind: 'gray' };
  }
  if (family === 'CalRGB') {
    return { kind: 'rgb' };
  }
  return { kind: 'unsupported', name: family ?? '(unrecognised array colour space)' };
}

// Unpacks sub-byte-depth samples (1/2/4-bit) into one array entry per sample, each row starting on its own byte boundary -- the same row-padding convention PNG's own IDAT payload uses. The 8-bit case is a fast path: already byte-aligned, one sample per byte.
function unpackSamples(data: Uint8Array<ArrayBuffer>, width: number, height: number, componentsPerPixel: number, bitsPerComponent: number): number[] {
  if (bitsPerComponent === 8) {
    return Array.from(data.subarray(0, width * height * componentsPerPixel));
  }
  const samplesPerRow = width * componentsPerPixel;
  const bytesPerRow = Math.ceil((samplesPerRow * bitsPerComponent) / 8);
  const out: number[] = [];
  for (let row = 0; row < height; row++) {
    const rowStart = row * bytesPerRow;
    let bitPos = 0;
    for (let s = 0; s < samplesPerRow; s++) {
      let value = 0;
      for (let b = 0; b < bitsPerComponent; b++) {
        const byteIndex = rowStart + Math.floor(bitPos / 8);
        const bitIndex = 7 - (bitPos % 8);
        const bit = ((data[byteIndex] ?? 0) >> bitIndex) & 1;
        value = (value << 1) | bit;
        bitPos++;
      }
      out.push(value);
    }
  }
  return out;
}

function scaleToByte(value: number, maxValue: number, inverted: boolean): number {
  const v = inverted ? maxValue - value : value;
  return maxValue === 255 ? v : Math.round((v * 255) / maxValue);
}

function cmykToRgbByte(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  return { r: Math.round(255 * (1 - c) * (1 - k)), g: Math.round(255 * (1 - m) * (1 - k)), b: Math.round(255 * (1 - y) * (1 - k)) };
}

function sampleFromPalette(base: ResolvedColorSpace, lookup: Uint8Array<ArrayBuffer>, offset: number): { r: number; g: number; b: number } {
  if (base.kind === 'gray') {
    const g = lookup[offset] ?? 0;
    return { r: g, g, b: g };
  }
  if (base.kind === 'cmyk') {
    return cmykToRgbByte((lookup[offset] ?? 0) / 255, (lookup[offset + 1] ?? 0) / 255, (lookup[offset + 2] ?? 0) / 255, (lookup[offset + 3] ?? 0) / 255);
  }
  return { r: lookup[offset] ?? 0, g: lookup[offset + 1] ?? 0, b: lookup[offset + 2] ?? 0 };
}

function buildRawImage(data: Uint8Array<ArrayBuffer>, width: number, height: number, bitsPerComponent: number, colorSpace: ResolvedColorSpace, inverted: boolean): RawImage {
  const maxValue = (1 << bitsPerComponent) - 1;

  if (colorSpace.kind === 'indexed') {
    const indices = unpackSamples(data, width, height, 1, bitsPerComponent);
    const baseComponents = componentsOf(colorSpace.base);
    const out = new Uint8Array(width * height * (colorSpace.base.kind === 'gray' ? 1 : 3));
    let outIdx = 0;
    for (const index of indices) {
      const rgb = sampleFromPalette(colorSpace.base, colorSpace.lookup, index * baseComponents);
      if (colorSpace.base.kind === 'gray') {
        out[outIdx++] = rgb.r;
      } else {
        out[outIdx++] = rgb.r;
        out[outIdx++] = rgb.g;
        out[outIdx++] = rgb.b;
      }
    }
    return { width, height, channels: colorSpace.base.kind === 'gray' ? 1 : 3, data: out };
  }

  if (colorSpace.kind === 'gray') {
    const samples = unpackSamples(data, width, height, 1, bitsPerComponent);
    const out = Uint8Array.from(samples, (v) => scaleToByte(v, maxValue, inverted));
    return { width, height, channels: 1, data: out };
  }

  if (colorSpace.kind === 'rgb') {
    const samples = unpackSamples(data, width, height, 3, bitsPerComponent);
    const out = Uint8Array.from(samples, (v) => scaleToByte(v, maxValue, inverted));
    return { width, height, channels: 3, data: out };
  }

  // cmyk
  const samples = unpackSamples(data, width, height, 4, bitsPerComponent);
  const out = new Uint8Array(width * height * 3);
  for (let px = 0; px < width * height; px++) {
    const c = scaleToByte(samples[px * 4] ?? 0, maxValue, inverted) / 255;
    const m = scaleToByte(samples[px * 4 + 1] ?? 0, maxValue, inverted) / 255;
    const y = scaleToByte(samples[px * 4 + 2] ?? 0, maxValue, inverted) / 255;
    const k = scaleToByte(samples[px * 4 + 3] ?? 0, maxValue, inverted) / 255;
    const rgb = cmykToRgbByte(c, m, y, k);
    out[px * 3] = rgb.r;
    out[px * 3 + 1] = rgb.g;
    out[px * 3 + 2] = rgb.b;
  }
  return { width, height, channels: 3, data: out };
}

function readSoftMaskAlpha(dict: PdfDict, width: number, height: number, resolver: PdfObjectResolver, sink: PdfDiagnosticSink): Uint8Array<ArrayBuffer> | undefined {
  const smaskObj = resolver.resolve(dictGet(dict, 'SMask'));
  if (smaskObj?.kind !== 'stream') {
    return undefined;
  }
  const decoded = decodeStream(smaskObj.raw, smaskObj.dict, sink);
  if (decoded.remainingFilter !== undefined) {
    return undefined; // an encoded (e.g. DCT) soft mask is out of scope -- degrade to no alpha rather than guess
  }
  const smaskWidth = asNumber(dictGet(smaskObj.dict, 'Width')) ?? width;
  const smaskHeight = asNumber(dictGet(smaskObj.dict, 'Height')) ?? height;
  const smaskBpc = asNumber(dictGet(smaskObj.dict, 'BitsPerComponent')) ?? 8;
  if (smaskWidth !== width || smaskHeight !== height || smaskBpc !== 8) {
    return undefined; // a differently-sized or differently-depthed mask needs resampling this module doesn't do
  }
  return decoded.bytes.subarray(0, width * height);
}

function isTrue(obj: PdfObject | undefined): boolean {
  return obj?.kind === 'bool' && obj.value;
}

export function readImageXObject(dict: PdfDict, raw: Uint8Array<ArrayBuffer>, resolver: PdfObjectResolver, sink: PdfDiagnosticSink): ExtractedPdfImage | undefined {
  if (isTrue(dictGet(dict, 'ImageMask') ?? dictGet(dict, 'IM'))) {
    sink({ code: 'image/mask-unsupported', severity: 'info', message: 'an /ImageMask stencil paints with the current fill colour rather than standing alone as an image; skipping' });
    return undefined;
  }

  const decoded = decodeStream(raw, dict, sink);
  if (decoded.remainingFilter === 'DCTDecode') {
    let info: JpegInfo;
    try {
      info = readJpegInfo(decoded.bytes);
    } catch {
      sink({ code: 'image/undecodable', severity: 'warning', message: 'DCTDecode image bytes did not look like a valid JPEG (no SOF marker found); skipping this image' });
      return undefined;
    }
    return { format: 'jpeg', bytes: decoded.bytes, widthPx: info.width, heightPx: info.height };
  }
  if (decoded.remainingFilter !== undefined) {
    return undefined; // decodeStream already raised 'pdf/unsupported-filter'
  }

  const width = asNumber(dictGet(dict, 'Width') ?? dictGet(dict, 'W'));
  const height = asNumber(dictGet(dict, 'Height') ?? dictGet(dict, 'H'));
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    sink({ code: 'image/undecodable', severity: 'warning', message: 'image XObject is missing a valid /Width or /Height; skipping' });
    return undefined;
  }

  const bitsPerComponent = asNumber(dictGet(dict, 'BitsPerComponent') ?? dictGet(dict, 'BPC')) ?? 8;
  if (bitsPerComponent !== 1 && bitsPerComponent !== 2 && bitsPerComponent !== 4 && bitsPerComponent !== 8) {
    sink({ code: 'image/unsupported-bit-depth', severity: 'warning', message: `image has an unsupported /BitsPerComponent (${String(bitsPerComponent)}); skipping` });
    return undefined;
  }

  const colorSpace = resolveColorSpace(dictGet(dict, 'ColorSpace') ?? dictGet(dict, 'CS'), resolver, sink);
  if (colorSpace.kind === 'unsupported') {
    sink({ code: 'image/unsupported-colorspace', severity: 'warning', message: `image has an unsupported colour space (${colorSpace.name}); skipping` });
    return undefined;
  }

  const decodeArr = asArray(dictGet(dict, 'Decode'));
  const inverted = decodeArr !== undefined && asNumber(decodeArr[0]) === 1 && asNumber(decodeArr[1]) === 0;

  const rawImage = buildRawImage(decoded.bytes, width, height, bitsPerComponent, colorSpace, inverted);
  const alpha = readSoftMaskAlpha(dict, width, height, resolver, sink);
  const withAlpha: RawImage = alpha !== undefined ? { ...rawImage, alpha } : rawImage;
  return { format: 'png', bytes: encodePng(withAlpha), widthPx: width, heightPx: height };
}
