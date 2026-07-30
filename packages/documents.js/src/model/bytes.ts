import { z } from 'zod';

// 'PK\x03\x04' -- the ZIP local-file-header signature (ISO/IEC 21320-1 / APPNOTE 4.3.7). Both docx and pptx are OPC packages, i.e. ZIP archives, so this is the fastest and most reliable way to reject a non-package input before any XML parsing is attempted.
const ZIP_LOCAL_FILE_HEADER = [0x50, 0x4b, 0x03, 0x04];

// '%PDF-' -- the PDF header (ISO 32000-1 section 7.5.2). Per the spec it may be preceded by arbitrary bytes (some producers prepend a comment or BOM), so this checks for the signature within the first kilobyte rather than requiring it at offset 0.
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PDF_HEADER_SEARCH_WINDOW = 1024;

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
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

function containsBytesWithin(bytes: Uint8Array, signature: readonly number[], window: number): boolean {
  const limit = Math.min(bytes.length - signature.length, window);
  for (let start = 0; start <= limit; start++) {
    let matched = true;
    for (let i = 0; i < signature.length; i++) {
      if (bytes[start + i] !== signature[i]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}

function zipBytesSchema(label: string) {
  return z.instanceof(Uint8Array).refine((bytes) => startsWithBytes(bytes, ZIP_LOCAL_FILE_HEADER), {
    message: `not a valid ${label} file: missing the ZIP local-file-header signature`,
  });
}

export const DocxBytesSchema = zipBytesSchema('docx');
export const PptxBytesSchema = zipBytesSchema('pptx');

export const PdfBytesSchema = z.instanceof(Uint8Array).refine(
  (bytes) => containsBytesWithin(bytes, PDF_HEADER, PDF_HEADER_SEARCH_WINDOW),
  { message: 'not a valid PDF file: missing the %PDF- header' },
);
