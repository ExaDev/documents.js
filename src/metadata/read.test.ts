import { decodePackage as decodeOdfPackage } from 'odf.js';
import { decodePackage as decodeOoxmlPackage } from 'ooxml.js';
import { readPdf } from 'pdf-codec';
import { describe, expect, it, vi } from 'vitest';
import { docxToPdf, odsToXlsx, xlsxToPdf } from '../convert/convert';
import { readMarkdownContent } from '../markdown/read';
import { decodeMarkdownText, encodeMarkdownText } from '../markdown/text';
import { readOdfFormulaContent } from '../odf/formula/read';
import { readOdgContent } from '../odf/odg/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdsContent } from '../odf/ods/read';
import { readOdtContent } from '../odf/odt/read';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import { FRACTION_FORMULA, odfFormulaBytes } from '../test-support/odf';
import { minimalDocxBytes } from '../test-support/docx';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdsBytes } from '../test-support/ods';
import { minimalOdtBytes } from '../test-support/odt';
import { richMarkdownTextWithFrontMatter } from '../test-support/markdown';
import { minimalPptxBytes } from '../test-support/pptx';
import { readDocumentMetadata } from './read';

// Each case proves readDocumentMetadata(format, bytes) dispatches to exactly the same underlying reader every ergonomic conversion in this package already uses for that format, matching its own .metadata output exactly -- the underlying readers' own metadata extraction is already covered elsewhere (their own read.test.ts files), so this file's job is the dispatch table, not metadata resolution itself.

describe('readDocumentMetadata', () => {
  it('docx: matches readDocxContent(...).metadata', () => {
    const bytes = minimalDocxBytes();
    expect(readDocumentMetadata('docx', bytes)).toEqual(readDocxContent(decodeOoxmlPackage(bytes)).metadata);
  });

  it('pptx: matches readPptxContent(...).metadata', () => {
    const bytes = minimalPptxBytes();
    expect(readDocumentMetadata('pptx', bytes)).toEqual(readPptxContent(decodeOoxmlPackage(bytes)).metadata);
  });

  it('odt: matches readOdtContent(...).metadata', () => {
    const bytes = minimalOdtBytes();
    expect(readDocumentMetadata('odt', bytes)).toEqual(readOdtContent(decodeOdfPackage(bytes)).metadata);
  });

  it('odp: matches readOdpContent(...).metadata', () => {
    const bytes = minimalOdpBytes();
    expect(readDocumentMetadata('odp', bytes)).toEqual(readOdpContent(decodeOdfPackage(bytes)).metadata);
    expect(readDocumentMetadata('odp', bytes).title).toBe('My Presentation');
  });

  it('ods: matches readOdsContent(...).metadata', () => {
    const bytes = minimalOdsBytes();
    expect(readDocumentMetadata('ods', bytes)).toEqual(readOdsContent(decodeOdfPackage(bytes)).metadata);
  });

  it('odg: matches readOdgContent(...).metadata', () => {
    const bytes = minimalOdgBytes();
    expect(readDocumentMetadata('odg', bytes)).toEqual(readOdgContent(decodeOdfPackage(bytes)).metadata);
    expect(readDocumentMetadata('odg', bytes).title).toBe('My Drawing');
  });

  it('odf: matches readOdfFormulaContent(...).metadata', () => {
    const bytes = odfFormulaBytes(FRACTION_FORMULA);
    expect(readDocumentMetadata('odf', bytes)).toEqual(readOdfFormulaContent(decodeOdfPackage(bytes)).metadata);
  });

  it('markdown: matches readMarkdownContent(...).metadata, with front-matter now surfaced by default', () => {
    // readMarkdownContent now defaults frontMatter: true (src/markdown/read.ts), so a leading YAML front-matter block's title/author reach ContentDocument.metadata by default -- readDocumentMetadata dispatches through readMarkdownContent, so the title from the fixture's front matter is genuinely surfaced here, not dropped.
    const text = richMarkdownTextWithFrontMatter();
    const bytes = encodeMarkdownText(text);
    expect(readDocumentMetadata('markdown', bytes)).toEqual(readMarkdownContent(decodeMarkdownText(bytes)).metadata);
    expect(readDocumentMetadata('markdown', bytes).title).toBe('Sample Report');
  });

  it('pdf: matches readPdf(...).metadata', () => {
    const bytes = docxToPdf(minimalDocxBytes());
    expect(readDocumentMetadata('pdf', bytes)).toEqual(readPdf(bytes).metadata);
  });

  // xlsxToPdf accepts no clock option of its own, so resolveMetadataTimestamps falls back to the real system clock on every call -- readDocumentMetadata's own internal xlsxToPdf and this test's own direct one are two independent conversions, each free to land on either side of a real second boundary. Freezing time for the duration of this one test makes both see the identical "now", rather than asserting on two genuinely separate wall-clock reads.
  it('xlsx: matches the xlsxToPdf-then-readPdf preview path', () => {
    vi.useFakeTimers();
    try {
      const bytes = odsToXlsx(minimalOdsBytes());
      expect(readDocumentMetadata('xlsx', bytes)).toEqual(readPdf(xlsxToPdf(bytes)).metadata);
    } finally {
      vi.useRealTimers();
    }
  });
});
