import { decodePackage as decodeOdfPackage } from 'odf.js';
import { decodePackage as decodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { readPdf } from 'pdf-codec';
import { describe, expect, it } from 'vitest';
import { docxToPdf, odsToXlsx } from '../convert/convert';
import { readOdpContent } from '../odf/odp/read';
import { minimalDocxBytes } from '../test-support/docx';
import { minimalOdpBytes } from '../test-support/odp';
import { richOdsBytes } from '../test-support/ods';
import { setDocumentMetadata } from './write';

describe('setDocumentMetadata: rebuild path (docx/pptx/odt/odp/ods/odg/markdown)', () => {
  it('patches only the overridden field, leaving the source document own existing title untouched', () => {
    const bytes = setDocumentMetadata('odp', 'odp', minimalOdpBytes(), { author: 'New Author' });
    const metadata = readOdpContent(decodeOdfPackage(bytes)).metadata;
    expect(metadata.title).toBe('My Presentation'); // minimalOdpBytes's own real dc:title, never touched.
    expect(metadata.author).toBe('New Author');
  });

  it('overrides the title when asked to', () => {
    const bytes = setDocumentMetadata('odp', 'odp', minimalOdpBytes(), { title: 'Renamed Deck' });
    expect(readOdpContent(decodeOdfPackage(bytes)).metadata.title).toBe('Renamed Deck');
  });

  it('sets keywords as a real string array', () => {
    const bytes = setDocumentMetadata('odp', 'odp', minimalOdpBytes(), { keywords: ['quarterly', 'sales'] });
    expect(readOdpContent(decodeOdfPackage(bytes)).metadata.keywords).toEqual(['quarterly', 'sales']);
  });
});

describe('setDocumentMetadata: pdf direct-patch path', () => {
  it('patches metadata on the parsed PDF directly, leaving the page content untouched', () => {
    const pdfBytes = docxToPdf(minimalDocxBytes());
    const before = readPdf(pdfBytes);

    const patched = setDocumentMetadata('pdf', 'pdf', pdfBytes, { title: 'A Patched PDF', subject: 'metadata test' });
    const after = readPdf(patched);

    expect(after.metadata.title).toBe('A Patched PDF');
    expect(after.metadata.subject).toBe('metadata test');
    expect(after.pages.length).toBe(before.pages.length);
  });
});

// xlsx rebuilds through DOCUMENT_FORMAT_CODECS.xlsx.content (ooxml.js's readXlsxContent/buildXlsxPackage, src/codecs/registry.ts) exactly like every other rebuild format above -- real xlsx bytes (via the odsToXlsx bridge over richOdsBytes, the same real-fixture pattern src/convert/bridges.test.ts already uses) prove the round trip genuinely works, not merely that the type system accepts 'xlsx' as a RebuildFormat.
describe('setDocumentMetadata: rebuild path (xlsx)', () => {
  it('patches only the overridden field, leaving the source spreadsheet content untouched', () => {
    const xlsxBytes = odsToXlsx(richOdsBytes());
    const before = readXlsxContent(decodeOoxmlPackage(xlsxBytes));
    expect(before.metadata.title).toBe('Rich Spreadsheet'); // richOdsBytes's own real dc:title, carried through odsToXlsx.

    const patched = setDocumentMetadata('xlsx', 'xlsx', xlsxBytes, { author: 'New Author' });
    const after = readXlsxContent(decodeOoxmlPackage(patched));
    expect(after.metadata.title).toBe('Rich Spreadsheet');
    expect(after.metadata.author).toBe('New Author');
    if (after.kind !== 'spreadsheet' || before.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(after.sheets[0]?.cells.length).toBe(before.sheets[0]?.cells.length);
  });

  it('overrides the title when asked to', () => {
    const xlsxBytes = odsToXlsx(richOdsBytes());
    const patched = setDocumentMetadata('xlsx', 'xlsx', xlsxBytes, { title: 'Renamed Workbook' });
    expect(readXlsxContent(decodeOoxmlPackage(patched)).metadata.title).toBe('Renamed Workbook');
  });
});

describe('setDocumentMetadata: rejected formats', () => {
  it('rejects odf as a source or target, naming that it has no write path back out', () => {
    expect(() => setDocumentMetadata('odf', 'odf', new Uint8Array(), {})).toThrow(/no write path back out/);
  });

  it('rejects a source that is neither pdf nor a rebuild format, even when target is a rebuild format', () => {
    expect(() => setDocumentMetadata('pdf', 'docx', new Uint8Array(), {})).toThrow(/must be the same format \(or both 'pdf'\)/);
  });

  it('rejects two different rebuild formats -- setDocumentMetadata does not convert format', () => {
    expect(() => setDocumentMetadata('docx', 'pptx', minimalDocxBytes(), {})).toThrow(/must be the same format\./);
  });
});
