import { ODF_MEDIA_TYPES, zipPackage } from "odf.js";
import { RtfBytesSchema } from "rtf-codec";
import { describe, expect, it } from "vitest";
import { writeDocContent } from "doc-codec";
import { writeXlsContent } from "xls-codec";
import { writePptContent } from "../ppt/write";
import {
  CsvBytesSchema,
  DocBytesSchema,
  DocxBytesSchema,
  MarkdownBytesSchema,
  OdgBytesSchema,
  OdpBytesSchema,
  OdsBytesSchema,
  OdtBytesSchema,
  PdfBytesSchema,
  PptBytesSchema,
  PptxBytesSchema,
  SvgBytesSchema,
  XlsBytesSchema,
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

// Real [MS-CFB] compound files, built through each legacy codec's own writer rather than hand-assembled -- the same fixture-independence convention src/convert/convert.test.ts already follows for doc/xls/ppt.
const docBytes = writeDocContent({
  kind: "wordprocessing",
  metadata: {},
  sections: [
    {
      pageSize: { widthPt: 612, heightPt: 792 },
      margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
      blocks: [{ kind: "paragraph", runs: [{ text: "Hello, world." }] }],
    },
  ],
});
const xlsBytes = writeXlsContent({
  kind: "spreadsheet",
  metadata: {},
  sheets: [
    {
      name: "Sheet1",
      cells: [
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "Hello, world." },
          displayText: "Hello, world.",
        },
      ],
      columns: [],
      rows: [],
      images: [],
      printSettings: {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
        gridlines: false,
        headers: false,
        pageOrder: "downThenOver",
      },
    },
  ],
});
const pptBytes = writePptContent({
  kind: "presentation",
  metadata: {},
  slides: [
    {
      size: { widthPt: 720, heightPt: 540 },
      notes: "",
      shapes: [
        {
          frame: { xPt: 72, yPt: 36, widthPt: 360, heightPt: 180 },
          insetLeftPt: 0,
          insetTopPt: 0,
          insetRightPt: 0,
          insetBottomPt: 0,
          blocks: [{ kind: "paragraph", runs: [{ text: "Hello, world." }] }],
        },
      ],
    },
  ],
});

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

  it("DocBytesSchema, XlsBytesSchema, and PptBytesSchema each accept their own real [MS-CFB] compound file", () => {
    expect(DocBytesSchema.parse(docBytes)).toBe(docBytes);
    expect(XlsBytesSchema.parse(xlsBytes)).toBe(xlsBytes);
    expect(PptBytesSchema.parse(pptBytes)).toBe(pptBytes);
  });

  it("DocBytesSchema, XlsBytesSchema, and PptBytesSchema reject non-compound-file bytes", () => {
    expect(DocBytesSchema.safeParse(garbage).success).toBe(false);
    expect(XlsBytesSchema.safeParse(garbage).success).toBe(false);
    expect(PptBytesSchema.safeParse(garbage).success).toBe(false);
    // Neither a ZIP-signed docx/pptx nor a %PDF- PDF is an [MS-CFB] compound file, so all three reject both too.
    expect(DocBytesSchema.safeParse(zipBytes).success).toBe(false);
    expect(XlsBytesSchema.safeParse(zipBytes).success).toBe(false);
    expect(PptBytesSchema.safeParse(zipBytes).success).toBe(false);
    expect(DocBytesSchema.safeParse(pdfBytes).success).toBe(false);
    expect(XlsBytesSchema.safeParse(pdfBytes).success).toBe(false);
    expect(PptBytesSchema.safeParse(pdfBytes).success).toBe(false);
  });

  it("DocBytesSchema, XlsBytesSchema, and PptBytesSchema each reject the other two's own compound file, since each checks for a different mandated stream", () => {
    expect(DocBytesSchema.safeParse(xlsBytes).success).toBe(false);
    expect(DocBytesSchema.safeParse(pptBytes).success).toBe(false);
    expect(XlsBytesSchema.safeParse(docBytes).success).toBe(false);
    expect(XlsBytesSchema.safeParse(pptBytes).success).toBe(false);
    expect(PptBytesSchema.safeParse(docBytes).success).toBe(false);
    expect(PptBytesSchema.safeParse(xlsBytes).success).toBe(false);
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

  // MarkdownBytesSchema is architecturally different from every schema above: it asserts nothing about format structure at all (no header, no magic bytes, no reserved byte sequence exists for markdown), only that the bytes are text in some character encoding.
  it("MarkdownBytesSchema accepts text, including bytes that would fail every OTHER schema above", () => {
    const markdownBytes = new TextEncoder().encode(
      "# Hello\n\nSome *markdown* text.",
    );
    expect(MarkdownBytesSchema.parse(markdownBytes)).toBe(markdownBytes);
    // Plain text is not a ZIP and has no %PDF- header, so every other schema in this file rejects it and MarkdownBytesSchema is the one exception.
    expect(DocxBytesSchema.safeParse(markdownBytes).success).toBe(false);
    expect(PdfBytesSchema.safeParse(markdownBytes).success).toBe(false);
  });

  it("MarkdownBytesSchema accepts a file saved in the Windows code page, which no longer has to be UTF-8", () => {
    const windows1252 = Uint8Array.of(0x23, 0x20, 0x43, 0x61, 0x66, 0xe9);
    expect(MarkdownBytesSchema.safeParse(windows1252).success).toBe(true);
  });

  it("MarkdownBytesSchema accepts UTF-16 behind a byte order mark", () => {
    const utf16 = Uint8Array.of(0xff, 0xfe, 0x23, 0x00, 0x20, 0x00, 0x41, 0x00);
    expect(MarkdownBytesSchema.safeParse(utf16).success).toBe(true);
  });

  it("MarkdownBytesSchema rejects real docx bytes, which are binary whatever encoding is tried", () => {
    // The judgement this schema can honestly make without a magic number is whether the bytes are text at all, and a ZIP is not: its local file header carries NUL bytes, which belong to no text document format. It passed while the check was UTF-8 well-formedness alone, which it happens to satisfy.
    expect(MarkdownBytesSchema.safeParse(zipBytes).success).toBe(false);
    // pdfBytes is deliberately NOT asserted here alongside it: that fixture is the UTF-8 encoding of a string spelling a PDF header, so it genuinely is text, and a schema with no format check of its own has nothing to say against it. A real PDF, whose object streams carry NULs, is refused (byte-codec's own decodeText tests cover that case with the stream bytes intact).
    expect(MarkdownBytesSchema.safeParse(pdfBytes).success).toBe(true);
  });

  it("MarkdownBytesSchema rejects bytes matching no supported encoding", () => {
    const undecodable = new Uint8Array([0x41, 0x81, 0x42]);
    expect(MarkdownBytesSchema.safeParse(undecodable).success).toBe(false);
  });

  // CsvBytesSchema shares MarkdownBytesSchema's architecture exactly: RFC 4180 defines no magic bytes either, so the schema checks only whether the bytes are text, stated here for the same reason.
  it("CsvBytesSchema accepts csv text, including bytes that would fail every structure-checking schema above", () => {
    const csvTextBytes = new TextEncoder().encode("Name,Amount\nWidget,42.5\n");
    expect(CsvBytesSchema.parse(csvTextBytes)).toBe(csvTextBytes);
    expect(DocxBytesSchema.safeParse(csvTextBytes).success).toBe(false);
    expect(PdfBytesSchema.safeParse(csvTextBytes).success).toBe(false);
  });

  it("CsvBytesSchema accepts an Excel-style windows-1252 export", () => {
    const excelExport = Uint8Array.of(
      0x4e,
      0x6f,
      0x6d,
      0x0a,
      0x43,
      0x61,
      0x66,
      0xe9,
      0x0a,
    );
    expect(CsvBytesSchema.safeParse(excelExport).success).toBe(true);
  });

  // Widening the two text schemas past UTF-8 could only change which codec reads a file if some code path chose a format by testing schemas in order and taking the first that accepted. None does: a format comes from a file extension (document-cli's and document-operations' inferFormatFromExtension, which returns undefined rather than inspecting bytes) or from an explicit format argument, and the registry and readers are records keyed by that format. These tests pin the property that makes that safe to rely on, from the other direction: no newly-accepted text input is accepted by any structural schema, so no input has gained a second plausible reader.
  describe("text acceptance does not overlap any structural schema", () => {
    const newlyAcceptedText: readonly (readonly [string, Uint8Array])[] = [
      ["windows-1252", Uint8Array.of(0x43, 0x61, 0x66, 0xe9, 0x0a)],
      [
        "UTF-16LE behind a mark",
        Uint8Array.of(0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00),
      ],
      [
        "UTF-16BE without a mark",
        Uint8Array.of(0x00, 0x61, 0x00, 0x2c, 0x00, 0x62),
      ],
    ];

    it.each(newlyAcceptedText)(
      "%s text is accepted as markdown and csv",
      (_name, bytes) => {
        expect(MarkdownBytesSchema.safeParse(bytes).success).toBe(true);
        expect(CsvBytesSchema.safeParse(bytes).success).toBe(true);
      },
    );

    it.each(newlyAcceptedText)(
      "%s text is refused by every schema that checks real format structure",
      (_name, bytes) => {
        for (const schema of [
          DocxBytesSchema,
          PptxBytesSchema,
          OdtBytesSchema,
          OdsBytesSchema,
          OdpBytesSchema,
          OdgBytesSchema,
          PdfBytesSchema,
          DocBytesSchema,
          XlsBytesSchema,
          PptBytesSchema,
          RtfBytesSchema,
        ]) {
          expect(schema.safeParse(bytes).success).toBe(false);
        }
      },
    );

    it("rtf is still read as rtf: its own schema accepts it, and the text schemas' opinion of it is what it always was", () => {
      // RTF is ASCII with a real magic header and no NUL bytes, so it satisfied the old well-formed-UTF-8 check and satisfies the new is-this-text check identically. Nothing chose between rtf and markdown by asking these schemas before, and nothing does now.
      const rtf = new TextEncoder().encode("{\\rtf1\\ansi\\deff0 Hello}");
      expect(RtfBytesSchema.safeParse(rtf).success).toBe(true);
      expect(MarkdownBytesSchema.safeParse(rtf).success).toBe(true);
      expect(CsvBytesSchema.safeParse(rtf).success).toBe(true);
    });

    it("a compound-file document is refused as text while its own schema still accepts it", () => {
      // doc/xls/ppt all begin with the [MS-CFB] signature, whose own bytes include NULs, so the tightened text check refuses them. Previously the text schemas' answer depended on whether a given file happened to be valid UTF-8.

      expect(DocBytesSchema.safeParse(docBytes).success).toBe(true);
      expect(MarkdownBytesSchema.safeParse(docBytes).success).toBe(false);
      expect(CsvBytesSchema.safeParse(docBytes).success).toBe(false);
    });
  });

  it("CsvBytesSchema rejects bytes that are not text", () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(CsvBytesSchema.safeParse(png).success).toBe(false);
  });

  // SvgBytesSchema calls decodeSvgText directly (src/svg/text.ts), so its own acceptance follows XML's encoding rules rather than the plain-text detection MarkdownBytesSchema/CsvBytesSchema use: a declared or byte-order-marked encoding is honoured, and UTF-8 is the strict default with no windows-1252 guess.
  it("SvgBytesSchema accepts a plain UTF-8 svg with no declaration", () => {
    const svgBytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
    );
    expect(SvgBytesSchema.parse(svgBytes)).toBe(svgBytes);
  });

  it("SvgBytesSchema accepts a non-UTF-8 encoding the XML prolog declares", () => {
    // "café" in ISO-8859-1: identical bytes to windows-1252 for this character, the encoding SvgBytesSchema's own decodeSvgText call maps the declaration onto.
    const svgBytes = Uint8Array.from(
      Array.from(
        '<?xml version="1.0" encoding="ISO-8859-1"?><svg xmlns="http://www.w3.org/2000/svg"><title>café</title></svg>',
        (character) => character.charCodeAt(0),
      ),
    );
    expect(SvgBytesSchema.safeParse(svgBytes).success).toBe(true);
  });

  it("SvgBytesSchema rejects an svg whose XML prolog declares an encoding decodeText's own bounded set doesn't support", () => {
    const svgBytes = Uint8Array.from(
      Array.from(
        '<?xml version="1.0" encoding="Shift_JIS"?><svg xmlns="http://www.w3.org/2000/svg"/>',
        (character) => character.charCodeAt(0),
      ),
    );
    expect(SvgBytesSchema.safeParse(svgBytes).success).toBe(false);
  });

  it("SvgBytesSchema rejects text with no <svg root element", () => {
    const notSvg = new TextEncoder().encode("<html><body/></html>");
    expect(SvgBytesSchema.safeParse(notSvg).success).toBe(false);
  });

  it("SvgBytesSchema rejects bytes that are not text", () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(SvgBytesSchema.safeParse(png).success).toBe(false);
  });
});
