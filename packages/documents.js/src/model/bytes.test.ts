import { describe, expect, it } from 'vitest';
import { DocxBytesSchema, PdfBytesSchema, PptxBytesSchema } from './bytes';

const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const pdfBytes = new TextEncoder().encode('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
const garbage = new Uint8Array([1, 2, 3, 4]);

describe('bytes', () => {
  it('DocxBytesSchema and PptxBytesSchema accept ZIP-signed bytes', () => {
    expect(DocxBytesSchema.parse(zipBytes)).toBe(zipBytes);
    expect(PptxBytesSchema.parse(zipBytes)).toBe(zipBytes);
  });

  it('DocxBytesSchema and PptxBytesSchema reject non-ZIP bytes', () => {
    expect(DocxBytesSchema.safeParse(garbage).success).toBe(false);
    expect(PptxBytesSchema.safeParse(garbage).success).toBe(false);
  });

  it('PdfBytesSchema accepts a %PDF- header', () => {
    expect(PdfBytesSchema.parse(pdfBytes)).toBe(pdfBytes);
  });

  it('PdfBytesSchema rejects bytes with no %PDF- header', () => {
    expect(PdfBytesSchema.safeParse(garbage).success).toBe(false);
    expect(PdfBytesSchema.safeParse(zipBytes).success).toBe(false);
  });
});
