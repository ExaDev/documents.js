import type { OpenDocument, PdfOpenDocument } from '../../../state/types.js';

// Every screen in this directory is only ever reached from `pdfPageList`, the root screen `rootScreenForFormat` produces exclusively for an open PDF document -- so `state.openDocument` is always a `PdfOpenDocument` by the time any screen here renders. This throws rather than falling back to an empty view because a mismatch would mean the app router itself is broken, not a recoverable, user-facing condition.
export function requirePdfDocument(openDocument: OpenDocument | undefined): PdfOpenDocument {
  if (openDocument?.format !== 'pdf') {
    throw new Error('A PDF inspection screen rendered without an open PDF document; the app router only reaches this screen group from pdfPageList, which is only ever the root screen of an open PDF document.');
  }
  return openDocument;
}

// Shared between the page list (a page's own size) and the item detail dump (an image/rect/ellipse/link item's own size) -- both display a plain widthPt×heightPt pair with no further unit conversion.
export function formatSize(widthPt: number, heightPt: number): string {
  return `${widthPt.toFixed(0)}×${heightPt.toFixed(0)}pt`;
}
