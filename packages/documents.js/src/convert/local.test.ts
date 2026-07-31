import { describe, expect, it } from 'vitest';
import { createDocx } from '../edit/docx/editor';
import { createPptx } from '../edit/pptx/editor';
import { brokenStartxrefPdf } from '../test-support/pdf';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdtBytes } from '../test-support/odt';
import { createLocalDocumentConverter } from './local';

function pdfHeader(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 5));
}

function buildSampleDocx(text: string): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text });
  return editor.toBytes();
}

function buildSamplePptx(text: string): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  editor.addSlide().addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 }, text });
  return editor.toBytes();
}

describe('createLocalDocumentConverter: shape', () => {
  it('reports contractVersion and the supported conversion pairs', () => {
    const converter = createLocalDocumentConverter();
    expect(converter.contractVersion).toBe(1);
    expect(converter.conversions).toEqual([
      { source: 'docx', target: 'pdf' },
      { source: 'pptx', target: 'pdf' },
      { source: 'odt', target: 'pdf' },
      { source: 'odp', target: 'pdf' },
      { source: 'pdf', target: 'docx' },
      { source: 'pdf', target: 'pptx' },
      { source: 'pdf', target: 'odt' },
      { source: 'pdf', target: 'odp' },
    ]);
  });
});

describe('createLocalDocumentConverter: convert', () => {
  it('converts docx to pdf', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'docx', bytes: buildSampleDocx('Hi') }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('pdf');
    expect(pdfHeader(result.document.bytes)).toBe('%PDF-');
  });

  it('converts pptx to pdf', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'pptx', bytes: buildSamplePptx('Hi') }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('pdf');
    expect(pdfHeader(result.document.bytes)).toBe('%PDF-');
  });

  it('converts odt to pdf', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'odt', bytes: minimalOdtBytes() }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('pdf');
    expect(pdfHeader(result.document.bytes)).toBe('%PDF-');
  });

  it('converts odp to pdf', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'odp', bytes: minimalOdpBytes() }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('pdf');
    expect(pdfHeader(result.document.bytes)).toBe('%PDF-');
  });

  it('converts pdf to docx', async () => {
    const converter = createLocalDocumentConverter();
    const docxToPdfResult = await converter.convert({ source: { format: 'docx', bytes: buildSampleDocx('Hi') }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    const result = await converter.convert({ source: docxToPdfResult.document, targetFormat: 'docx' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('docx');
    expect(result.document.bytes.length).toBeGreaterThan(0);
  });

  it('converts pdf to pptx', async () => {
    const converter = createLocalDocumentConverter();
    const pptxToPdfResult = await converter.convert({ source: { format: 'pptx', bytes: buildSamplePptx('Hi') }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    const result = await converter.convert({ source: pptxToPdfResult.document, targetFormat: 'pptx' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('pptx');
    expect(result.document.bytes.length).toBeGreaterThan(0);
  });

  it('converts pdf to odt', async () => {
    const converter = createLocalDocumentConverter();
    const odtToPdfResult = await converter.convert({ source: { format: 'odt', bytes: minimalOdtBytes() }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    const result = await converter.convert({ source: odtToPdfResult.document, targetFormat: 'odt' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('odt');
    expect(result.document.bytes.length).toBeGreaterThan(0);
  });

  it('converts pdf to odp', async () => {
    const converter = createLocalDocumentConverter();
    const odpToPdfResult = await converter.convert({ source: { format: 'odp', bytes: minimalOdpBytes() }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    const result = await converter.convert({ source: odpToPdfResult.document, targetFormat: 'odp' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('odp');
    expect(result.document.bytes.length).toBeGreaterThan(0);
  });

  it('rejects an unsupported conversion pair', async () => {
    const converter = createLocalDocumentConverter();
    await expect(converter.convert({ source: { format: 'docx', bytes: buildSampleDocx('Hi') }, targetFormat: 'docx' }, { signal: new AbortController().signal })).rejects.toThrow(/unsupported conversion/);
  });

  it('collects a char/substituted diagnostic for a character outside WinAnsi', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'docx', bytes: buildSampleDocx('中文') }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    expect(result.diagnostics.some((d) => d.code === 'char/substituted')).toBe(true);
  });

  it('collects PDF read diagnostics on the pdf->docx path', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'pdf', bytes: brokenStartxrefPdf() }, targetFormat: 'docx' }, { signal: new AbortController().signal });
    expect(result.diagnostics.some((d) => d.code === 'pdf/xref-recovered')).toBe(true);
  });
});
