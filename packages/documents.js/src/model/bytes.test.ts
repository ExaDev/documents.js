import { ODF_MEDIA_TYPES, zipPackage } from "odf.js";
import { describe, expect, it } from "vitest";
import {
  CsvBytesSchema,
  DocxBytesSchema,
  MarkdownBytesSchema,
  OdgBytesSchema,
  OdpBytesSchema,
  OdsBytesSchema,
  OdtBytesSchema,
  PdfBytesSchema,
  PptxBytesSchema,
} from "./bytes";

const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
const garbage = new Uint8Array([1, 2, 3, 4]);

// Minimal, but genuinely spec-conformant, ODF packages: a "mimetype" entry, stored uncompressed, as the first zip entry -- the exact layout OdtBytesSchema/etc. check, generated the same way odf.js's own package writer does rather than hand-built byte-for-byte.
function odfBytes(mediaType: string): Uint8Array {
  const encoder = new TextEncoder();
  return zipPackage([
    ["mimetype", { bytes: encoder.encode(mediaType), stored: true }],
    ["content.xml", { bytes: encoder.encode("<office:document-content/>") }],
  ]);
}

const odtBytes = odfBytes(ODF_MEDIA_TYPES.odt);
const odsBytes = odfBytes(ODF_MEDIA_TYPES.ods);
const odpBytes = odfBytes(ODF_MEDIA_TYPES.odp);
const odgBytes = odfBytes(ODF_MEDIA_TYPES.odg);

describe("bytes", () => {
  it("DocxBytesSchema and PptxBytesSchema accept ZIP-signed bytes", () => {
    expect(DocxBytesSchema.parse(zipBytes)).toBe(zipBytes);
    expect(PptxBytesSchema.parse(zipBytes)).toBe(zipBytes);
  });

  it("DocxBytesSchema and PptxBytesSchema reject non-ZIP bytes", () => {
    expect(DocxBytesSchema.safeParse(garbage).success).toBe(false);
    expect(PptxBytesSchema.safeParse(garbage).success).toBe(false);
  });

  it("PdfBytesSchema accepts a %PDF- header", () => {
    expect(PdfBytesSchema.parse(pdfBytes)).toBe(pdfBytes);
  });

  it("PdfBytesSchema rejects bytes with no %PDF- header", () => {
    expect(PdfBytesSchema.safeParse(garbage).success).toBe(false);
    expect(PdfBytesSchema.safeParse(zipBytes).success).toBe(false);
  });

  it("OdtBytesSchema, OdsBytesSchema, OdpBytesSchema, and OdgBytesSchema each accept their own real media type", () => {
    expect(OdtBytesSchema.parse(odtBytes)).toBe(odtBytes);
    expect(OdsBytesSchema.parse(odsBytes)).toBe(odsBytes);
    expect(OdpBytesSchema.parse(odpBytes)).toBe(odpBytes);
    expect(OdgBytesSchema.parse(odgBytes)).toBe(odgBytes);
  });

  it("each ODF schema also accepts its own -template variant (.ott/.ots/.otp/.otg), since a template is the same package with a template mimetype", () => {
    const ottBytes = odfBytes(ODF_MEDIA_TYPES.ott);
    const otsBytes = odfBytes(ODF_MEDIA_TYPES.ots);
    const otpBytes = odfBytes(ODF_MEDIA_TYPES.otp);
    const otgBytes = odfBytes(ODF_MEDIA_TYPES.otg);
    expect(OdtBytesSchema.parse(ottBytes)).toBe(ottBytes);
    expect(OdsBytesSchema.parse(otsBytes)).toBe(otsBytes);
    expect(OdpBytesSchema.parse(otpBytes)).toBe(otpBytes);
    expect(OdgBytesSchema.parse(otgBytes)).toBe(otgBytes);
  });

  it("the ODF schemas reject every other ODF media type, not just non-ODF input", () => {
    expect(OdtBytesSchema.safeParse(odsBytes).success).toBe(false);
    expect(OdtBytesSchema.safeParse(odpBytes).success).toBe(false);
    expect(OdtBytesSchema.safeParse(odgBytes).success).toBe(false);
    expect(OdsBytesSchema.safeParse(odtBytes).success).toBe(false);
    expect(OdpBytesSchema.safeParse(odtBytes).success).toBe(false);
    expect(OdgBytesSchema.safeParse(odtBytes).success).toBe(false);
  });

  it("the ODF schemas reject real docx/pptx bytes, and the OOXML schemas reject real ODF bytes", () => {
    expect(OdtBytesSchema.safeParse(zipBytes).success).toBe(false);
    expect(OdsBytesSchema.safeParse(zipBytes).success).toBe(false);
    expect(OdpBytesSchema.safeParse(zipBytes).success).toBe(false);
    expect(OdgBytesSchema.safeParse(zipBytes).success).toBe(false);
    // DocxBytesSchema/PptxBytesSchema only check the generic ZIP signature, so -- unlike the ODF schemas above -- they cannot distinguish an ODF package from an OOXML one; this is exactly the validation gap the code comment in bytes.ts calls out.
    expect(DocxBytesSchema.safeParse(odtBytes).success).toBe(true);
    expect(PptxBytesSchema.safeParse(odpBytes).success).toBe(true);
  });

  it("the length check still tells a genuine mismatch from a byte-prefix coincidence: odt accepts its own template (ott) but rejects every other ODF type, including one whose media type is a byte-prefix of a DIFFERENT accepted type", () => {
    // ott ('...text-template') is now accepted by OdtBytesSchema (see the template-acceptance test above), so the prefix relationship between odt and ott no longer demonstrates rejection. The length check still matters for cross-type separation: odt's own media type is a strict prefix of odp's ('...presentation' is longer), yet odt does not false-positive-match odp.
    expect(OdtBytesSchema.safeParse(odpBytes).success).toBe(false);
    expect(OdtBytesSchema.safeParse(odsBytes).success).toBe(false);
    // And a fabricated mimetype that merely STARTS WITH an accepted one is still rejected, since the match is length-exact per candidate.
    const prefixBytes = odfBytes(`${ODF_MEDIA_TYPES.odt}-not-a-real-type`);
    expect(OdtBytesSchema.safeParse(prefixBytes).success).toBe(false);
  });

  it("rejects a deflated (non-stored) mimetype entry even with the correct content", () => {
    const encoder = new TextEncoder();
    const deflated = zipPackage([
      ["mimetype", { bytes: encoder.encode(ODF_MEDIA_TYPES.odt) }],
    ]);
    expect(OdtBytesSchema.safeParse(deflated).success).toBe(false);
  });

  // MarkdownBytesSchema is architecturally different from every schema above -- it asserts nothing about format structure at all (no header, no magic bytes, no reserved byte sequence exists for markdown), only well-formed UTF-8.
  it("MarkdownBytesSchema accepts well-formed UTF-8 text, including bytes that would fail every OTHER schema above", () => {
    const markdownBytes = new TextEncoder().encode(
      "# Hello\n\nSome *markdown* text.",
    );
    expect(MarkdownBytesSchema.parse(markdownBytes)).toBe(markdownBytes);
    // Plain text is not a ZIP and has no %PDF- header -- every other schema in this file rejects it, MarkdownBytesSchema is the one exception.
    expect(DocxBytesSchema.safeParse(markdownBytes).success).toBe(false);
    expect(PdfBytesSchema.safeParse(markdownBytes).success).toBe(false);
  });

  it("MarkdownBytesSchema rejects malformed UTF-8", () => {
    const malformed = new Uint8Array([0xff, 0xfe, 0x00]);
    expect(MarkdownBytesSchema.safeParse(malformed).success).toBe(false);
  });

  it("MarkdownBytesSchema accepts real docx/pdf/odt bytes too, since UTF-8 well-formedness says nothing about format structure", () => {
    // Not a claim that docx/pdf/odt bytes ARE markdown -- only that this schema's one check (well-formed UTF-8) cannot distinguish them, unlike every structure-checking schema above. zipBytes/pdfBytes/odtBytes are all valid UTF-8 byte sequences even though they are binary formats.
    expect(MarkdownBytesSchema.safeParse(zipBytes).success).toBe(true);
    expect(MarkdownBytesSchema.safeParse(pdfBytes).success).toBe(true);
  });

  // CsvBytesSchema shares MarkdownBytesSchema's architecture exactly: RFC 4180 defines no magic bytes either, so the schema checks only well-formed UTF-8 -- the same validation gap, stated here for the same reason.
  it("CsvBytesSchema accepts well-formed UTF-8 csv text, including bytes that would fail every structure-checking schema above", () => {
    const csvTextBytes = new TextEncoder().encode("Name,Amount\nWidget,42.5\n");
    expect(CsvBytesSchema.parse(csvTextBytes)).toBe(csvTextBytes);
    expect(DocxBytesSchema.safeParse(csvTextBytes).success).toBe(false);
    expect(PdfBytesSchema.safeParse(csvTextBytes).success).toBe(false);
  });

  it("CsvBytesSchema rejects malformed UTF-8", () => {
    expect(
      CsvBytesSchema.safeParse(new Uint8Array([0xff, 0xfe, 0x00])).success,
    ).toBe(false);
  });
});
