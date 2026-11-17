import { PdfPageSelectionError } from "./diagnostics";

// What every whole-document reader (readPdf, and read-images.ts's image listing) checks before it reads a page, split from read.ts so both check it the same way.

// Resolves a page selection against the page tree's length: negative indices counted from the end, duplicates collapsed, and the result as a set, since a reader walks the tree in document order and asks it per page. Throws on the first entry that names no page, before any page is read.
export function resolvePageSelection(
  selection: readonly number[],
  pageCount: number,
): ReadonlySet<number> {
  const resolved = new Set<number>();
  for (const requested of selection) {
    const index = requested < 0 ? pageCount + requested : requested;
    if (!Number.isInteger(requested) || index < 0 || index >= pageCount) {
      throw new PdfPageSelectionError(requested, pageCount);
    }
    resolved.add(index);
  }
  return resolved;
}

const PDF_HEADER_BYTES = new TextEncoder().encode("%PDF-");
// Real producers occasionally prepend a small amount of junk (a UTF-8 BOM, blank lines) before the header — ISO 32000-1 7.5.2 itself permits leading bytes before "%PDF-", so this scans a window rather than requiring it at offset 0.
const HEADER_SEARCH_WINDOW = 1024;

export function hasPdfHeader(bytes: Uint8Array<ArrayBuffer>): boolean {
  const window = bytes.subarray(
    0,
    Math.min(HEADER_SEARCH_WINDOW, bytes.length),
  );
  outer: for (let i = 0; i <= window.length - PDF_HEADER_BYTES.length; i++) {
    for (let j = 0; j < PDF_HEADER_BYTES.length; j++) {
      if (window[i + j] !== PDF_HEADER_BYTES[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}
