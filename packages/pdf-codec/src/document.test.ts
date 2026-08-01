import { describe, expect, it } from 'vitest';
import {
  encryptedPdf,
  incrementalUpdatePdf,
  inheritedPageAttributesPdf,
  minimalClassicXrefPdf,
  xrefStreamWithObjectStreamPdf,
} from './test-support/pdf';
import { openPdfDocument } from './document';
import { PdfEncryptedError, PdfParseError } from './diagnostics';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import { dictGet } from './objects';

function collectDiagnostics(): { sink: PdfDiagnosticSink; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

describe('openPdfDocument: basic structure', () => {
  it('resolves the root catalog and walks a single page', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const doc = openPdfDocument(minimalClassicXrefPdf(), sink);
    const pages = doc.pages();
    expect(pages).toHaveLength(1);
    expect(dictGet(pages[0]!, 'MediaBox')).toEqual({ kind: 'array', items: [{ kind: 'number', value: 0 }, { kind: 'number', value: 0 }, { kind: 'number', value: 200 }, { kind: 'number', value: 100 }] });
    expect(diagnostics).toEqual([]);
  });

  it('resolves a chain of indirect references through .resolve()', () => {
    const { sink } = collectDiagnostics();
    const doc = openPdfDocument(minimalClassicXrefPdf(), sink);
    const page = doc.pages()[0]!;
    const resources = doc.resolveDict(dictGet(page, 'Resources'));
    expect(resources).toBeDefined();
    const fontDict = doc.resolveDict(dictGet(resources!, 'Font'));
    const f1 = doc.resolveDict(dictGet(fontDict!, 'F1'));
    expect(dictGet(f1!, 'BaseFont')).toEqual({ kind: 'name', name: 'Helvetica' });
  });
});

describe('openPdfDocument: object streams', () => {
  it('reads pages whose Catalog/Pages/Page are packed inside an ObjStm', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const doc = openPdfDocument(xrefStreamWithObjectStreamPdf(), sink);
    const pages = doc.pages();
    expect(pages).toHaveLength(1);
    expect(dictGet(pages[0]!, 'MediaBox')).toBeDefined();
    expect(diagnostics).toEqual([]);
  });
});

describe('openPdfDocument: incremental updates', () => {
  it('reflects the newest revision of an overridden page', () => {
    const { sink } = collectDiagnostics();
    const doc = openPdfDocument(incrementalUpdatePdf(), sink);
    const pages = doc.pages();
    expect(pages).toHaveLength(1);
    expect(dictGet(pages[0]!, 'MediaBox')).toEqual({ kind: 'array', items: [{ kind: 'number', value: 0 }, { kind: 'number', value: 0 }, { kind: 'number', value: 400 }, { kind: 'number', value: 300 }] });
  });
});

describe('openPdfDocument: page-tree attribute inheritance', () => {
  it('inherits /MediaBox and /Resources from the Pages node onto both pages', () => {
    const { sink } = collectDiagnostics();
    const doc = openPdfDocument(inheritedPageAttributesPdf(), sink);
    const pages = doc.pages();
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(dictGet(page, 'MediaBox')).toEqual({ kind: 'array', items: [{ kind: 'number', value: 0 }, { kind: 'number', value: 0 }, { kind: 'number', value: 300 }, { kind: 'number', value: 200 }] });
      expect(dictGet(page, 'Resources')).toBeDefined();
    }
  });

  it('does not let inheritance overwrite a page\'s own attribute', () => {
    const { sink } = collectDiagnostics();
    const doc = openPdfDocument(inheritedPageAttributesPdf(), sink);
    const pages = doc.pages();
    expect(dictGet(pages[0]!, 'Rotate')).toBeUndefined();
    expect(dictGet(pages[1]!, 'Rotate')).toEqual({ kind: 'number', value: 90 });
  });
});

describe('openPdfDocument: encryption', () => {
  it('throws PdfEncryptedError rather than attempting to parse further', () => {
    const { sink } = collectDiagnostics();
    expect(() => openPdfDocument(encryptedPdf(), sink)).toThrow(PdfEncryptedError);
  });
});

describe('openPdfDocument: unresolvable root', () => {
  it('throws a PdfParseError when no /Root catalog can be found at all', () => {
    const { sink } = collectDiagnostics();
    const garbage = new TextEncoder().encode('%PDF-1.4\nnot a real PDF at all\n%%EOF');
    expect(() => openPdfDocument(garbage, sink)).toThrow(PdfParseError);
  });
});
