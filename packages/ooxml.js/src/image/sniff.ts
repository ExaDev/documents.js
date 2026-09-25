export type ImageFormat = "png" | "jpeg" | "gif" | "svg";

// The PNG signature ([PNG] 12.12): a high-bit byte (catches transmission through a 7-bit-clean channel), the ASCII text "PNG", a CRLF pair (catches CR/LF translation), a DOS end-of-file marker (catches text-mode transfer that stops at Ctrl-Z), and a final LF (catches LF-to-CRLF translation) — each byte in the signature exists to catch one specific corruption a naive file transfer could introduce.
const PNG_SIGNATURE_HIGH_BIT_BYTE = 0x89;
const PNG_SIGNATURE_P = 0x50;
const PNG_SIGNATURE_N = 0x4e;
const PNG_SIGNATURE_G = 0x47;
const PNG_SIGNATURE_CR = 0x0d;
const PNG_SIGNATURE_LF = 0x0a;
const PNG_SIGNATURE_DOS_EOF = 0x1a;

// Exported so a fixture elsewhere in this package (round-trip.test.ts's own minimal PNG payload) can build a real PNG signature instead of re-deriving it, mirroring the same COMPOUND_FILE_MAGIC precedent archive-codec's own cfb/detect.ts exports.
export const PNG_SIGNATURE: readonly number[] = [
  PNG_SIGNATURE_HIGH_BIT_BYTE,
  PNG_SIGNATURE_P,
  PNG_SIGNATURE_N,
  PNG_SIGNATURE_G,
  PNG_SIGNATURE_CR,
  PNG_SIGNATURE_LF,
  PNG_SIGNATURE_DOS_EOF,
  PNG_SIGNATURE_LF,
];

// The JPEG/JFIF signature: every JPEG marker starts with an 0xFF prefix byte, and SOI (Start Of Image, 0xD8) is always the file's first marker.
const JPEG_MARKER_PREFIX = 0xff;
const JPEG_SOI_MARKER = 0xd8;
const JPEG_SIGNATURE: readonly number[] = [
  JPEG_MARKER_PREFIX,
  JPEG_SOI_MARKER,
  JPEG_MARKER_PREFIX,
];

// GIF87a and GIF89a are the only two header versions the format ever defined — both spell out "GIF8" followed by a two-ASCII-digit version and a trailing "a".
const GIF_SIGNATURE_G = 0x47;
const GIF_SIGNATURE_I = 0x49;
const GIF_SIGNATURE_F = 0x46;
const GIF_SIGNATURE_8 = 0x38;
const GIF_SIGNATURE_VERSION_87 = 0x37; // ASCII '7'.
const GIF_SIGNATURE_VERSION_89 = 0x39; // ASCII '9'.
const GIF_SIGNATURE_A = 0x61;
const GIF87A_SIGNATURE: readonly number[] = [
  GIF_SIGNATURE_G,
  GIF_SIGNATURE_I,
  GIF_SIGNATURE_F,
  GIF_SIGNATURE_8,
  GIF_SIGNATURE_VERSION_87,
  GIF_SIGNATURE_A,
];
const GIF89A_SIGNATURE: readonly number[] = [
  GIF_SIGNATURE_G,
  GIF_SIGNATURE_I,
  GIF_SIGNATURE_F,
  GIF_SIGNATURE_8,
  GIF_SIGNATURE_VERSION_89,
  GIF_SIGNATURE_A,
];

// No separate length guard needed: bytes[i] is `undefined` for any index at or past bytes.length (an out-of-range read never throws), and undefined can never equal a real signature byte value — so bytes shorter than the signature already fail this loop's own comparison at the first index past their own end.
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
  // No Math.min against bytes.length needed: subarray's own end argument is clamped to the array's length regardless of what is asked for, so requesting SVG_SNIFF_WINDOW bytes from a shorter buffer already yields only the bytes that exist.
  const window = bytes.subarray(0, SVG_SNIFF_WINDOW);
  let text = "";
  for (const byte of window) {
    text += String.fromCharCode(byte);
  }
  const trimmed = text.trimStart();
  return trimmed.startsWith("<?xml") || trimmed.startsWith("<svg");
}

// Detects an image's container format from its magic bytes, never from a file extension or a caller-supplied label — the pptx picture-shape reader (src/typed/pptx/read.ts) needs to trust the bytes themselves. Ported verbatim from documents.js's src/image/sniff.ts.
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
