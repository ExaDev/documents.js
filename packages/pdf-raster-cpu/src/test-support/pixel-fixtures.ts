import { encodePng } from "byte-codec";
import type { RawImage } from "byte-codec";
import type { RasterPageGeometry } from "pdf-codec/raster";

// Shared between rasteriser.test.ts (rendered through renderPdfPage) and rasteriser-ops.test.ts (draw ops driven directly): both read pixels back from a decoded RawImage and both need a minimal RasterPageGeometry to hand CpuRasteriser.beginPage().

export function pixelAt(
  image: RawImage,
  x: number,
  y: number,
): readonly [number, number, number] {
  const index = (y * image.width + x) * 3;
  return [
    image.data[index] ?? 0,
    image.data[index + 1] ?? 0,
    image.data[index + 2] ?? 0,
  ];
}

export const WHITE: readonly [number, number, number] = [255, 255, 255];
export const BLACK: readonly [number, number, number] = [0, 0, 0];

export function pageGeometry(
  widthPx: number,
  heightPx: number,
): RasterPageGeometry {
  return { widthPx, heightPx, scale: 1, widthPt: widthPx, heightPt: heightPx };
}

export function pngBytes(image: RawImage): Uint8Array<ArrayBuffer> {
  return encodePng(image);
}
