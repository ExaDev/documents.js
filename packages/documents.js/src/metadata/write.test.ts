import { decodePackage as decodeOdfPackage } from 'odf.js';
import { readPdf } from 'pdf-codec';
import { describe, expect, it } from 'vitest';
import { docxToPdf } from '../convert/convert';
import { readOdpContent } from '../odf/odp/read';
import { minimalDocxBytes } from '../test-support/docx';
import { minimalOdpBytes } from '../test-support/odp';
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

describe('setDocumentMetadata: rejected formats', () => {
  it('rejects xlsx as a source or target, naming the ods-to-xlsx bridge as the workaround', () => {
    expect(() => setDocumentMetadata('xlsx', 'xlsx', new Uint8Array(), {})).toThrow(/not a supported setDocumentMetadata source or target/);
  });

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
