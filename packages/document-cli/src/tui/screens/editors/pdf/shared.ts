import type { OpenDocument, PdfOpenDocument, XlsxOpenDocument } from '../../../state/types.js';

// Every screen in this directory is only ever reached from `pdfPageList`, the root screen `rootScreenForFormat` produces for either an open PDF document or an open xlsx workbook (opened read-only as a converted PDF preview -- see state/types.ts's own XlsxOpenDocument doc comment) -- so `state.openDocument` is always one of these two by the time any screen here renders. Both carry the identical `.layout: LayoutDocument` field this whole screen group reads from, and nothing else, which is exactly what lets one screen family serve both formats with no xlsx-specific branch anywhere in page-list.tsx/page-items.tsx/item-detail.tsx. This throws rather than falling back to an empty view because a mismatch would mean the app router itself is broken, not a recoverable, user-facing condition.
export function requirePdfDocument(openDocument: OpenDocument | undefined): PdfOpenDocument | XlsxOpenDocument {
  if (openDocument?.format !== 'pdf' && openDocument?.format !== 'xlsx') {
    throw new Error('A PDF inspection screen rendered without an open PDF or xlsx document; the app router only reaches this screen group from pdfPageList, which is only ever the root screen of one of those two formats.');
  }
  return openDocument;
}

// Shared between the page list (a page's own size) and the item detail dump (an image/rect/ellipse/link item's own size) -- both display a plain widthPt×heightPt pair with no further unit conversion.
export function formatSize(widthPt: number, heightPt: number): string {
  return `${widthPt.toFixed(0)}×${heightPt.toFixed(0)}pt`;
}
