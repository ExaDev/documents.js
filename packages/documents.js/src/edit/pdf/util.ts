import { bytesToBase64 } from 'ooxml.js';
import type { LayoutImageAsset } from 'pdf-codec';
import { crc32, decodePng, readJpegInfo } from 'byte-codec';

// Generic splice-by-reference removal for a plain (non-XmlNode) array -- the LayoutPage[]/LayoutItem[] counterpart to src/xml/edit.ts's own removeChild, which is typed specifically for XmlNode and can't be reused here: PdfEditor/PdfPage/PdfItem hold live references directly into plain, Zod-inferred LayoutDocument objects (readPdf's/createPdf's own return value), never an XmlElement tree.
export function spliceOut<T>(container: T[], node: T): void {
  const index = container.indexOf(node);
  if (index !== -1) {
    container.splice(index, 1);
  }
}

function decodeImageDimensions(format: 'png' | 'jpeg', bytes: Uint8Array<ArrayBuffer>): { widthPx: number; heightPx: number } {
  if (format === 'jpeg') {
    const info = readJpegInfo(bytes);
    return { widthPx: info.width, heightPx: info.height };
  }
  const raw = decodePng(bytes);
  return { widthPx: raw.width, heightPx: raw.height };
}

// Registers `bytes` in the shared, LayoutDocument-wide image registry, deduplicating by content -- the exact same crc32-derived key scheme pdf-codec's own read.ts (registerExtractedImage) and this package's own src/layout/shared.ts (registerImage) already use, reimplemented here against raw bytes+format rather than a ContentImageBlock, since a PdfImageItem/PdfPage has no ContentImageBlock to hand it. An identical image (by content, not by call site) reuses the same imageId; an already-registered id is never overwritten, so two items that both register the same bytes end up sharing one images[] entry.
export function registerImageBytes(bytes: Uint8Array<ArrayBuffer>, format: 'png' | 'jpeg', images: Record<string, LayoutImageAsset>): string {
  const imageId = `img${crc32(bytes).toString(16)}`;
  if (!(imageId in images)) {
    const { widthPx, heightPx } = decodeImageDimensions(format, bytes);
    images[imageId] = { format, base64: bytesToBase64(bytes), widthPx, heightPx };
  }
  return imageId;
}
