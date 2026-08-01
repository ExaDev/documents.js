import { describe, expect, it } from 'vitest';
import { createDocx } from '../edit/docx/editor';
import { createPptx } from '../edit/pptx/editor';
import { brokenStartxrefPdf } from '../test-support/pdf';
import { FRACTION_FORMULA, odfFormulaBytes } from '../test-support/odf';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdsBytes } from '../test-support/ods';
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
    expect(converter.contractVersion).toBe(2);
    expect(converter.conversions).toEqual([
      { source: 'docx', target: 'pdf' },
      { source: 'pptx', target: 'pdf' },
      { source: 'odt', target: 'pdf' },
      { source: 'odp', target: 'pdf' },
      { source: 'ods', target: 'pdf' },
      { source: 'odg', target: 'pdf' },
      { source: 'odf', target: 'pdf' },
      { source: 'pdf', target: 'docx' },
      { source: 'pdf', target: 'pptx' },
      { source: 'pdf', target: 'odt' },
      { source: 'pdf', target: 'odp' },
      { source: 'pdf', target: 'ods' },
      { source: 'pdf', target: 'odg' },
      { source: 'odt', target: 'docx' },
      { source: 'docx', target: 'odt' },
      { source: 'odp', target: 'pptx' },
      { source: 'pptx', target: 'odp' },
      { source: 'ods', target: 'xlsx' },
      { source: 'xlsx', target: 'ods' },
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

  it('converts ods to pdf', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'ods', bytes: minimalOdsBytes() }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('pdf');
    expect(pdfHeader(result.document.bytes)).toBe('%PDF-');
  });

  it('converts odg to pdf', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'odg', bytes: minimalOdgBytes() }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('pdf');
    expect(pdfHeader(result.document.bytes)).toBe('%PDF-');
  });

  it('converts odf to pdf', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'odf', bytes: odfFormulaBytes(FRACTION_FORMULA) }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
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

  it('converts pdf to ods', async () => {
    const converter = createLocalDocumentConverter();
    const odsToPdfResult = await converter.convert({ source: { format: 'ods', bytes: minimalOdsBytes() }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    const result = await converter.convert({ source: odsToPdfResult.document, targetFormat: 'ods' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('ods');
    expect(result.document.bytes.length).toBeGreaterThan(0);
  });

  it('converts pdf to odg', async () => {
    const converter = createLocalDocumentConverter();
    const odgToPdfResult = await converter.convert({ source: { format: 'odg', bytes: minimalOdgBytes() }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    const result = await converter.convert({ source: odgToPdfResult.document, targetFormat: 'odg' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('odg');
    expect(result.document.bytes.length).toBeGreaterThan(0);
  });

  it('converts odt to docx directly, bypassing PDF', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'odt', bytes: minimalOdtBytes() }, targetFormat: 'docx' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('docx');
    expect(result.document.bytes.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  it('converts docx to odt directly, bypassing PDF', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'docx', bytes: buildSampleDocx('Hi') }, targetFormat: 'odt' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('odt');
    expect(result.document.bytes.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  it('converts odp to pptx directly, bypassing PDF', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'odp', bytes: minimalOdpBytes() }, targetFormat: 'pptx' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('pptx');
    expect(result.document.bytes.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  it('converts pptx to odp directly, bypassing PDF', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'pptx', bytes: buildSamplePptx('Hi') }, targetFormat: 'odp' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('odp');
    expect(result.document.bytes.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  it('converts ods to xlsx directly, bypassing PDF', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'ods', bytes: minimalOdsBytes() }, targetFormat: 'xlsx' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('xlsx');
    expect(result.document.bytes.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  it('converts xlsx to ods directly, bypassing PDF', async () => {
    const converter = createLocalDocumentConverter();
    const odsToXlsxResult = await converter.convert({ source: { format: 'ods', bytes: minimalOdsBytes() }, targetFormat: 'xlsx' }, { signal: new AbortController().signal });
    const result = await converter.convert({ source: odsToXlsxResult.document, targetFormat: 'ods' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('ods');
    expect(result.document.bytes.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
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

  it('returns a package with correlated content and layout for a PDF-pivot conversion (docx -> pdf)', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'docx', bytes: buildSampleDocx('Hi') }, targetFormat: 'pdf' }, { signal: new AbortController().signal });

    expect(result.package).toBeDefined();
    const pkg = result.package!;
    expect(pkg.content.kind).toBe('wordprocessing');
    expect(pkg.layout).toBeDefined();
    if (pkg.content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const paragraph = pkg.content.sections[0]?.blocks[0];
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected a paragraph block');
    }
    const run = paragraph.runs[0];
    expect(run?.sourcePath).toBeDefined();
    const layoutText = pkg.layout?.pages[0]?.items.find((item) => item.kind === 'text' && item.sourcePath === run?.sourcePath);
    expect(layoutText).toBeDefined();
  });

  it('returns a package with content only (layout undefined) for a PDF-bypassing bridge conversion (odt -> docx)', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'odt', bytes: minimalOdtBytes() }, targetFormat: 'docx' }, { signal: new AbortController().signal });

    expect(result.package).toBeDefined();
    const pkg = result.package!;
    expect(pkg.content.kind).toBe('wordprocessing');
    expect(pkg.layout).toBeUndefined();
  });
});
