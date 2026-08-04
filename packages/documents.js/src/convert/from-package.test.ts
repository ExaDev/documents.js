import type { DocumentPackage } from 'document-schema.js';
import { DOCUMENT_PACKAGE_FORMAT_VERSION } from 'document-schema.js';
import { decodePackage as decodeOdfPackage } from 'odf.js';
import { decodePackage as decodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { readPdf } from 'pdf-codec';
import { describe, expect, it } from 'vitest';
import { openDocx } from '../edit/docx/editor';
import { openOdg } from '../edit/odg/editor';
import { openOdp } from '../edit/odp/editor';
import { openOds } from '../edit/ods/editor';
import { openOdt } from '../edit/odt/editor';
import { openPptx } from '../edit/pptx/editor';
import { decodeMarkdownText } from '../markdown/text';
import { readOdgContent } from '../odf/odg/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdsContent } from '../odf/ods/read';
import { readOdtContent } from '../odf/odt/read';
import { minimalDocxBytes } from '../test-support/docx';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdsBytes } from '../test-support/ods';
import { minimalOdtBytes } from '../test-support/odt';
import { docxToPdf, odtToDocx } from './convert';
import { buildDocumentBytes } from './from-package';

function wordprocessingPackage(): DocumentPackage {
  return { formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content: readOdtContent(decodeOdfPackage(minimalOdtBytes())) };
}

function presentationPackage(): DocumentPackage {
  return { formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content: readOdpContent(decodeOdfPackage(minimalOdpBytes())) };
}

function spreadsheetPackage(): DocumentPackage {
  return { formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content: readOdsContent(decodeOdfPackage(minimalOdsBytes())) };
}

function drawingPackage(): DocumentPackage {
  return { formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content: readOdgContent(decodeOdfPackage(minimalOdgBytes())) };
}

describe('buildDocumentBytes', () => {
  it('builds real docx bytes from a wordprocessing package', () => {
    const bytes = buildDocumentBytes(wordprocessingPackage(), 'docx');
    const text = openDocx(bytes).paragraphs().map((p) => p.text).join(' ');
    expect(text).toContain('Hello from odt');
  });

  it('builds real odt bytes from a wordprocessing package', () => {
    const bytes = buildDocumentBytes(wordprocessingPackage(), 'odt');
    const text = openOdt(bytes).paragraphs().map((p) => p.text).join(' ');
    expect(text).toContain('Hello from odt');
  });

  it('builds real markdown bytes from a wordprocessing package', () => {
    const bytes = buildDocumentBytes(wordprocessingPackage(), 'markdown');
    expect(decodeMarkdownText(bytes)).toContain('Hello from odt');
  });

  it('builds real pptx bytes from a presentation package', () => {
    const bytes = buildDocumentBytes(presentationPackage(), 'pptx');
    const text = openPptx(bytes).slides().flatMap((s) => s.shapes()).map((s) => s.text).join(' ');
    expect(text.length).toBeGreaterThan(0);
  });

  it('builds real odp bytes from a presentation package', () => {
    const bytes = buildDocumentBytes(presentationPackage(), 'odp');
    const text = openOdp(bytes).slides().flatMap((s) => s.shapes()).map((s) => s.text).join(' ');
    expect(text.length).toBeGreaterThan(0);
  });

  it('builds real ods bytes from a spreadsheet package', () => {
    const bytes = buildDocumentBytes(spreadsheetPackage(), 'ods');
    const sheet = openOds(bytes).sheets()[0];
    expect(sheet).toBeDefined();
  });

  it('builds real odg bytes from a drawing package', () => {
    const bytes = buildDocumentBytes(drawingPackage(), 'odg');
    const page = openOdg(bytes).pages()[0];
    expect(page).toBeDefined();
  });

  it('writes PDF bytes directly from a package that carries a real layout', () => {
    let captured: DocumentPackage | undefined;
    docxToPdf(minimalDocxBytes(), { onDocument: (pkg) => { captured = pkg; } });
    if (captured === undefined) {
      throw new Error('expected docxToPdf to report a package via onDocument');
    }
    const bytes = buildDocumentBytes(captured, 'pdf');
    const layout = readPdf(bytes);
    expect(layout.pages.length).toBeGreaterThan(0);
  });

  it('throws when asked for pdf from a package with no layout (a bridge conversion dump)', () => {
    let captured: DocumentPackage | undefined;
    odtToDocx(minimalOdtBytes(), { onDocument: (pkg) => { captured = pkg; } });
    if (captured === undefined) {
      throw new Error('expected odtToDocx to report a package via onDocument');
    }
    expect(captured.layout).toBeUndefined();
    expect(() => buildDocumentBytes(captured!, 'pdf')).toThrow(/has no layout/);
  });

  it('builds real xlsx bytes from a spreadsheet package', () => {
    const bytes = buildDocumentBytes(spreadsheetPackage(), 'xlsx');
    const content = readXlsxContent(decodeOoxmlPackage(bytes));
    expect(content.kind).toBe('spreadsheet');
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(content.sheets.length).toBeGreaterThan(0);
    expect(content.sheets[0]?.cells.length).toBeGreaterThan(0);
  });

  it('throws for the unsupported odf target', () => {
    expect(() => buildDocumentBytes(wordprocessingPackage(), 'odf')).toThrow(/no ContentDocument-to-odf builder/);
  });
});
