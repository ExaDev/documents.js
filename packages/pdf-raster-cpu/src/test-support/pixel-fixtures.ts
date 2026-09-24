import { encodePng } from "byte-codec";
import type { RawImage } from "byte-codec";
import type { RasterPageGeometry } from "pdf-codec/raster";

// Shared between rasteriser.test.ts (rendered through renderPdfPage) and rasteriser-ops.test.ts (draw ops driven directly): both read pixels back from a decoded RawImage and both need a minimal RasterPageGeometry to hand CpuRasteriser.beginPage().

// Three bytes per pixel (r, g, b), matching rasteriser.ts's own fixed canvas layout.
const RGB_CHANNELS = 3;
export const RGB_CHANNEL_MAX = 255;

export function pixelAt(
  image: RawImage,
  x: number,
  y: number,
): readonly [number, number, number] {
  const index = (y * image.width + x) * RGB_CHANNELS;
  return [
    image.data[index] ?? 0,
    image.data[index + 1] ?? 0,
    image.data[index + 2] ?? 0,
  ];
}

export const WHITE: readonly [number, number, number] = [
  RGB_CHANNEL_MAX,
  RGB_CHANNEL_MAX,
  RGB_CHANNEL_MAX,
];
export const BLACK: readonly [number, number, number] = [0, 0, 0];
export const RED: readonly [number, number, number] = [RGB_CHANNEL_MAX, 0, 0];
export const GREEN: readonly [number, number, number] = [0, RGB_CHANNEL_MAX, 0];
export const BLUE: readonly [number, number, number] = [0, 0, RGB_CHANNEL_MAX];

export function pageGeometry(
  widthPx: number,
  heightPx: number,
): RasterPageGeometry {
  return { widthPx, heightPx, scale: 1, widthPt: widthPx, heightPt: heightPx };
}

export function pngBytes(image: RawImage): Uint8Array<ArrayBuffer> {
  return encodePng(image);
}
