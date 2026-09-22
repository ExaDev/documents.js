export type ImageFormat = "png" | "jpeg" | "gif" | "svg";

const PNG_SIGNATURE: readonly number[] = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];
const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8, 0xff];
// GIF87a and GIF89a are the only two header versions the format ever defined.
const GIF87A_SIGNATURE: readonly number[] = [
  0x47, 0x49, 0x46, 0x38, 0x37, 0x61,
];
const GIF89A_SIGNATURE: readonly number[] = [
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
];

// No separate "bytes too short" guard: when bytes.length < signature.length, some index i in the loop below reads past the end of bytes, and an out-of-bounds array read is `undefined` in JS — which is never strictly equal to signature[i] (always a real 0-255 byte value), so the loop's own mismatch check already returns false for every too-short input. A dedicated length guard would only ever produce a result the loop already produces on its own.
function startsWith(
  bytes: Uint8Array<ArrayBuffer>,
  signature: readonly number[],
): boolean {
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

// SVG has no magic-number signature at all — it is XML text, so detection here is textual rather than a fixed byte match. Decodes only the leading window (SVG's own root element always appears well within the first kilobyte of a real file) as Latin-1 rather than UTF-8: Latin-1 never throws on arbitrary bytes, and every byte this check actually compares against (ASCII '<', 's', 'v', 'g', ...) is identical in both encodings, so a non-UTF-8-safe decode here costs nothing while staying safe against a binary format that happens to start with something ASCII-adjacent. An XML prolog (`<?xml ... ?>`) may precede the root element, so this looks for either the prolog or the `<svg` root tag itself, not only the very first bytes.
const SVG_SNIFF_WINDOW = 1024;

function looksLikeSvg(bytes: Uint8Array<ArrayBuffer>): boolean {
  const window = bytes.subarray(0, Math.min(bytes.length, SVG_SNIFF_WINDOW));
  let text = "";
  for (const byte of window) {
    text += String.fromCharCode(byte);
  }
  const trimmed = text.trimStart();
  return trimmed.startsWith("<?xml") || trimmed.startsWith("<svg");
}

// Detects an image's container format from its magic bytes, never from a file extension or a caller-supplied label — buildManifest (src/manifest.ts) needs to trust the bytes themselves when resolving an unknown binary part's media type. Ported verbatim from ooxml.js's src/image/sniff.ts (itself ported from documents.js's src/image/sniff.ts).
export function sniffImageFormat(
  bytes: Uint8Array<ArrayBuffer>,
): ImageFormat | undefined {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return "png";
  }
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    return "jpeg";
  }
  if (
    startsWith(bytes, GIF87A_SIGNATURE) ||
    startsWith(bytes, GIF89A_SIGNATURE)
  ) {
    return "gif";
  }
  if (looksLikeSvg(bytes)) {
    return "svg";
  }
  return undefined;
}
