import { describe, expect, it } from 'vitest';
import {
  incrementalUpdatePdf,
  inheritedPageAttributesPdf,
  minimalClassicXrefPdf,
  unsupportedSecurityHandlerPdf,
  xrefStreamWithObjectStreamPdf,
} from './test-support/pdf';
import { ENCRYPTED_FIXTURE_TITLE, aes256EmptyUserPasswordPdf, aes256RealUserPasswordPdf } from './test-support/encrypted-pdfs';
import { openPdfDocument } from './document';
import { PdfEncryptedError, PdfParseError, PdfPasswordRequiredError } from './diagnostics';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import { asName, asNumber, dictGet } from './objects';

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
  it('throws PdfEncryptedError rather than attempting to parse further, for a handler no password could open', () => {
    const { sink } = collectDiagnostics();
    expect(() => openPdfDocument(unsupportedSecurityHandlerPdf(), sink)).toThrow(PdfEncryptedError);
  });

  it('throws PdfPasswordRequiredError for a file that genuinely needs a user password', () => {
    const { sink } = collectDiagnostics();
    expect(() => openPdfDocument(aes256RealUserPasswordPdf(), sink)).toThrow(PdfPasswordRequiredError);
  });

  // Decryption is transparent below this layer: an object fetched from an encrypted document comes back in the clear, strings included, so nothing downstream of the object store needs to know the file was encrypted at all.
  it('resolves objects from an encrypted document with their strings already decrypted', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const doc = openPdfDocument(aes256EmptyUserPasswordPdf(), sink);
    const info = doc.resolveDict(dictGet(doc.trailer, 'Info'));
    const title = dictGet(info!, 'Title');
    expect(title?.kind).toBe('string');
    expect(title?.kind === 'string' ? new TextDecoder('latin1').decode(title.bytes) : undefined).toBe(ENCRYPTED_FIXTURE_TITLE);
    expect(diagnostics).toEqual([]);
  });

  // A file's own /Encrypt dictionary is stored unencrypted (ISO 32000-1 7.6.1), so it must be fetched with decryption still off -- a bug here would corrupt /O and /U and make every supported file look password-protected.
  it('reads the /Encrypt dictionary itself without trying to decrypt it', () => {
    const { sink } = collectDiagnostics();
    const doc = openPdfDocument(aes256EmptyUserPasswordPdf(), sink);
    const encryptDict = doc.resolveDict(dictGet(doc.trailer, 'Encrypt'));
    expect(asName(dictGet(encryptDict!, 'Filter'))).toBe('Standard');
    expect(asNumber(dictGet(encryptDict!, 'V'))).toBe(5);
  });
});

describe('openPdfDocument: unresolvable root', () => {
  it('throws a PdfParseError when no /Root catalog can be found at all', () => {
    const { sink } = collectDiagnostics();
    const garbage = new TextEncoder().encode('%PDF-1.4\nnot a real PDF at all\n%%EOF');
    expect(() => openPdfDocument(garbage, sink)).toThrow(PdfParseError);
  });
});
