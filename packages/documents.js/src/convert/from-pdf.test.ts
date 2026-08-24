import { decodePackage as decodeOdfPackage } from "odf.js";
import {
  buildXlsxPackageFromContent,
  decodePackage as decodeOoxmlPackage,
  encodePackage as encodeOoxmlPackage,
  readXlsxContent,
} from "ooxml.js";
import { readPdf } from "pdf-codec";
import { describe, expect, it } from "vitest";
import { docxToPdf, odsToXlsx } from "./convert";
import { readMarkdownContent } from "../markdown/read";
import { decodeMarkdownText, encodeMarkdownText } from "../markdown/text";
import { readOdfFormulaContent } from "../odf/formula/read";
import { readOdgContent } from "../odf/odg/read";
import { readOdpContent } from "../odf/odp/read";
import { readOdsContent } from "../odf/ods/read";
import { readOdtContent } from "../odf/odt/read";
import { readDocxContent } from "../ooxml/docx/read";
import { readPptxContent } from "../ooxml/pptx/read";
import { FRACTION_FORMULA, odfFormulaBytes } from "../test-support/odf";
import { minimalDocxBytes } from "../test-support/docx";
import { minimalOdgBytes } from "../test-support/odg";
import { minimalOdpBytes } from "../test-support/odp";
import { minimalOdsBytes } from "../test-support/ods";
import { minimalOdtBytes } from "../test-support/odt";
import { richMarkdownTextWithFrontMatter } from "../test-support/markdown";
import { minimalPptxBytes } from "../test-support/pptx";
import { readDocumentMetadata } from "./from-pdf";

// Each case proves readDocumentMetadata(format, bytes) dispatches to exactly the same underlying reader every ergonomic conversion in this package already uses for that format, matching its own .metadata output exactly -- the underlying readers' own metadata extraction is already covered elsewhere (their own read.test.ts files), so this file's job is the dispatch table, not metadata resolution itself.

describe("readDocumentMetadata", () => {
  it("docx: matches readDocxContent(...).metadata", () => {
    const bytes = minimalDocxBytes();
    expect(readDocumentMetadata("docx", bytes)).toEqual(
      readDocxContent(decodeOoxmlPackage(bytes)).metadata,
    );
  });

  it("pptx: matches readPptxContent(...).metadata", () => {
    const bytes = minimalPptxBytes();
    expect(readDocumentMetadata("pptx", bytes)).toEqual(
      readPptxContent(decodeOoxmlPackage(bytes)).metadata,
    );
  });

  it("odt: matches readOdtContent(...).metadata", () => {
    const bytes = minimalOdtBytes();
    expect(readDocumentMetadata("odt", bytes)).toEqual(
      readOdtContent(decodeOdfPackage(bytes)).metadata,
    );
  });

  it("odp: matches readOdpContent(...).metadata", () => {
    const bytes = minimalOdpBytes();
    expect(readDocumentMetadata("odp", bytes)).toEqual(
      readOdpContent(decodeOdfPackage(bytes)).metadata,
    );
    expect(readDocumentMetadata("odp", bytes).title).toBe("My Presentation");
  });

  it("ods: matches readOdsContent(...).metadata", () => {
    const bytes = minimalOdsBytes();
    expect(readDocumentMetadata("ods", bytes)).toEqual(
      readOdsContent(decodeOdfPackage(bytes)).metadata,
    );
  });

  it("odg: matches readOdgContent(...).metadata", () => {
    const bytes = minimalOdgBytes();
    expect(readDocumentMetadata("odg", bytes)).toEqual(
      readOdgContent(decodeOdfPackage(bytes)).metadata,
    );
    expect(readDocumentMetadata("odg", bytes).title).toBe("My Drawing");
  });

  it("odf: matches readOdfFormulaContent(...).metadata", () => {
    const bytes = odfFormulaBytes(FRACTION_FORMULA);
    expect(readDocumentMetadata("odf", bytes)).toEqual(
      readOdfFormulaContent(decodeOdfPackage(bytes)).metadata,
    );
  });

  it("markdown: matches readMarkdownContent(...).metadata, with front-matter now surfaced by default", () => {
    // readMarkdownContent now defaults frontMatter: true (src/markdown/read.ts), so a leading YAML front-matter block's title/author reach ContentDocument.metadata by default -- readDocumentMetadata dispatches through readMarkdownContent, so the title from the fixture's front matter is genuinely surfaced here, not dropped.
    const text = richMarkdownTextWithFrontMatter();
    const bytes = encodeMarkdownText(text);
    expect(readDocumentMetadata("markdown", bytes)).toEqual(
      readMarkdownContent(decodeMarkdownText(bytes)).metadata,
    );
    expect(readDocumentMetadata("markdown", bytes).title).toBe("Sample Report");
  });

  it("pdf: matches readPdf(...).metadata", () => {
    const bytes = docxToPdf(minimalDocxBytes());
    expect(readDocumentMetadata("pdf", bytes)).toEqual(readPdf(bytes).metadata);
  });

  // xlsx now reads its own docProps the way every other content format does (#744) -- the PDF-preview exception is gone. The preview never reported workbook facts at all: for a file carrying no timestamps of its own it stamped createdIso/modifiedIso at the render moment and a producer naming the preview PDF's writer, which is why this case's predecessor needed fake timers to pass -- a metadata read whose answer changes with wall-clock is reporting its own execution, not the document. What a workbook genuinely declares still arrives: ooxml.js maps docProps/core.xml's dcterms:created/dcterms:modified straight through and app.xml's Application onto creator, while producer stays unset (the schema's own rule: a PDF-only concept no semantic reader ever sets).
  it("xlsx: matches readXlsxContent(...).metadata", () => {
    const bytes = odsToXlsx(minimalOdsBytes());
    expect(readDocumentMetadata("xlsx", bytes)).toEqual(
      readXlsxContent(decodeOoxmlPackage(bytes)).metadata,
    );
  });

  it("xlsx: reports the workbook's own core.xml timestamps, and no producer", () => {
    const base = odsToXlsx(minimalOdsBytes());
    const content = readXlsxContent(decodeOoxmlPackage(base));
    const stamped = encodeOoxmlPackage(
      buildXlsxPackageFromContent({
        ...content,
        metadata: {
          ...content.metadata,
          title: "Stamped workbook",
          createdIso: "2024-01-02T03:04:05Z",
          modifiedIso: "2024-02-03T04:05:06Z",
        },
      }),
    );
    const metadata = readDocumentMetadata("xlsx", stamped);
    expect(metadata.title).toBe("Stamped workbook");
    expect(metadata.createdIso).toBe("2024-01-02T03:04:05Z");
    expect(metadata.modifiedIso).toBe("2024-02-03T04:05:06Z");
    expect(metadata.producer).toBeUndefined();
  });
});
