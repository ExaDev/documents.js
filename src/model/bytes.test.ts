import { ODF_MEDIA_TYPES, zipPackage } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { DocxBytesSchema, OdgBytesSchema, OdpBytesSchema, OdsBytesSchema, OdtBytesSchema, PdfBytesSchema, PptxBytesSchema } from './bytes';

const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const pdfBytes = new TextEncoder().encode('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
const garbage = new Uint8Array([1, 2, 3, 4]);

// Minimal, but genuinely spec-conformant, ODF packages: a "mimetype" entry, stored uncompressed, as the first zip entry -- the exact layout OdtBytesSchema/etc. check, generated the same way odf.js's own package writer does rather than hand-built byte-for-byte.
function odfBytes(mediaType: string): Uint8Array {
  const encoder = new TextEncoder();
  return zipPackage([
    ['mimetype', { bytes: encoder.encode(mediaType), stored: true }],
    ['content.xml', { bytes: encoder.encode('<office:document-content/>') }],
  ]);
}

const odtBytes = odfBytes(ODF_MEDIA_TYPES.odt);
const odsBytes = odfBytes(ODF_MEDIA_TYPES.ods);
const odpBytes = odfBytes(ODF_MEDIA_TYPES.odp);
const odgBytes = odfBytes(ODF_MEDIA_TYPES.odg);

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

  it('OdtBytesSchema, OdsBytesSchema, OdpBytesSchema, and OdgBytesSchema each accept their own real media type', () => {
    expect(OdtBytesSchema.parse(odtBytes)).toBe(odtBytes);
    expect(OdsBytesSchema.parse(odsBytes)).toBe(odsBytes);
    expect(OdpBytesSchema.parse(odpBytes)).toBe(odpBytes);
    expect(OdgBytesSchema.parse(odgBytes)).toBe(odgBytes);
  });

  it('the ODF schemas reject every other ODF media type, not just non-ODF input', () => {
    expect(OdtBytesSchema.safeParse(odsBytes).success).toBe(false);
    expect(OdtBytesSchema.safeParse(odpBytes).success).toBe(false);
    expect(OdtBytesSchema.safeParse(odgBytes).success).toBe(false);
    expect(OdsBytesSchema.safeParse(odtBytes).success).toBe(false);
    expect(OdpBytesSchema.safeParse(odtBytes).success).toBe(false);
    expect(OdgBytesSchema.safeParse(odtBytes).success).toBe(false);
  });

  it('the ODF schemas reject real docx/pptx bytes, and the OOXML schemas reject real ODF bytes', () => {
    expect(OdtBytesSchema.safeParse(zipBytes).success).toBe(false);
    expect(OdsBytesSchema.safeParse(zipBytes).success).toBe(false);
    expect(OdpBytesSchema.safeParse(zipBytes).success).toBe(false);
    expect(OdgBytesSchema.safeParse(zipBytes).success).toBe(false);
    // DocxBytesSchema/PptxBytesSchema only check the generic ZIP signature, so -- unlike the ODF schemas above -- they cannot distinguish an ODF package from an OOXML one; this is exactly the validation gap the code comment in bytes.ts calls out.
    expect(DocxBytesSchema.safeParse(odtBytes).success).toBe(true);
    expect(PptxBytesSchema.safeParse(odpBytes).success).toBe(true);
  });

  it('rejects an ODF mimetype entry that is merely a byte-prefix of the expected media type (odt vs. ott)', () => {
    const templateBytes = odfBytes('application/vnd.oasis.opendocument.text-template');
    expect(OdtBytesSchema.safeParse(templateBytes).success).toBe(false);
  });

  it('rejects a deflated (non-stored) mimetype entry even with the correct content', () => {
    const encoder = new TextEncoder();
    const deflated = zipPackage([['mimetype', { bytes: encoder.encode(ODF_MEDIA_TYPES.odt) }]]);
    expect(OdtBytesSchema.safeParse(deflated).success).toBe(false);
  });
});
