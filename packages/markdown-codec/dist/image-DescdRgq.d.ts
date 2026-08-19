//#region src/image/image.d.ts
interface ImageDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}
type ImageFormat = 'png' | 'jpeg';
declare function bytesToBase64(bytes: Uint8Array): string;
declare function base64ToBytes(base64: string): Uint8Array;
declare function detectImageFormat(bytes: Uint8Array): ImageFormat | undefined;
declare function readImageDimensions(bytes: Uint8Array): ImageDimensions | undefined;
//#endregion
export { detectImageFormat as a, bytesToBase64 as i, ImageFormat as n, readImageDimensions as o, base64ToBytes as r, ImageDimensions as t };