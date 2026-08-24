export type ImageFormat = "png" | "jpeg";

const PNG_SIGNATURE: readonly number[] = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];
const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8, 0xff];

function startsWith(
  bytes: Uint8Array<ArrayBuffer>,
  signature: readonly number[],
): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

// Detects an image's container format from its magic bytes, never from a file extension or a caller-supplied label -- buildManifest (src/manifest.ts) needs to trust the bytes themselves when resolving an unknown binary part's media type. Ported verbatim from ooxml.js's src/image/sniff.ts (itself ported from documents.js's src/image/sniff.ts).
export function sniffImageFormat(
  bytes: Uint8Array<ArrayBuffer>,
): ImageFormat | undefined {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return "png";
  }
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    return "jpeg";
  }
  return undefined;
}
