import { describe, expect, it } from 'vitest';
import { flattenTree } from 'document-schema.js';
import type { FontSubstitution } from 'pdf-codec';
import { createDocx } from '../edit/docx/editor';
import { createPptx } from '../edit/pptx/editor';
import { minimalDocxBytes } from '../test-support/docx';
import { caladeaRegularBytes } from '../test-support/fonts';
import { brokenStartxrefPdf } from '../test-support/pdf';
import { FRACTION_FORMULA, odfFormulaBytes } from '../test-support/odf';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdsBytes } from '../test-support/ods';
import { minimalOdtBytes } from '../test-support/odt';
import { odsToXlsx } from './convert';
import { createLocalDocumentConverter } from './local';
import { UnsupportedConversionError } from './capability';

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
    // 7, not 6: ConversionResult.package changed TYPE to the tree-form DocumentTree of document-schema.js 4.0.0 (children carry the decomposed group tree plus the minted styles table, where it previously carried the flat { content, pages } envelope) -- see port.ts's own contractVersion comment on what does and does not warrant a bump.
    expect(converter.contractVersion).toBe(7);
    // SUPPORTED_CONVERSIONS is now derived from the composition pathfinder (resolveCompositionPlan) rather than a hand-maintained DIRECT_EDGES list. The pathfinder routes every pair of non-odf formats (each reaches all 10 others within the 3-hop cap), plus the special-case odf -> pdf pair -- 111 pairs total, sorted by source then target for determinism. csv joins as a full spreadsheet-variant member: same-variant bridges to ods/xlsx directly, everything else composed through the identical ods pivot xlsx uses. svg joins as the drawing family's plain-text member the same way: a same-variant bridge to odg directly plus its own pdf layout pair, everything else composed through those two edges.
    expect(converter.conversions).toEqual([
      { source: 'csv', target: 'docx' },
      { source: 'csv', target: 'markdown' },
      { source: 'csv', target: 'odg' },
      { source: 'csv', target: 'odp' },
      { source: 'csv', target: 'ods' },
      { source: 'csv', target: 'odt' },
      { source: 'csv', target: 'pdf' },
      { source: 'csv', target: 'pptx' },
      { source: 'csv', target: 'svg' },
      { source: 'csv', target: 'xlsx' },
      { source: 'docx', target: 'csv' },
      { source: 'docx', target: 'markdown' },
      { source: 'docx', target: 'odg' },
      { source: 'docx', target: 'odp' },
      { source: 'docx', target: 'ods' },
      { source: 'docx', target: 'odt' },
      { source: 'docx', target: 'pdf' },
      { source: 'docx', target: 'pptx' },
      { source: 'docx', target: 'svg' },
      { source: 'docx', target: 'xlsx' },
      { source: 'markdown', target: 'csv' },
      { source: 'markdown', target: 'docx' },
      { source: 'markdown', target: 'odg' },
      { source: 'markdown', target: 'odp' },
      { source: 'markdown', target: 'ods' },
      { source: 'markdown', target: 'odt' },
      { source: 'markdown', target: 'pdf' },
      { source: 'markdown', target: 'pptx' },
      { source: 'markdown', target: 'svg' },
      { source: 'markdown', target: 'xlsx' },
      { source: 'odf', target: 'pdf' },
      { source: 'odg', target: 'csv' },
      { source: 'odg', target: 'docx' },
      { source: 'odg', target: 'markdown' },
      { source: 'odg', target: 'odp' },
      { source: 'odg', target: 'ods' },
      { source: 'odg', target: 'odt' },
      { source: 'odg', target: 'pdf' },
      { source: 'odg', target: 'pptx' },
      { source: 'odg', target: 'svg' },
      { source: 'odg', target: 'xlsx' },
      { source: 'odp', target: 'csv' },
      { source: 'odp', target: 'docx' },
      { source: 'odp', target: 'markdown' },
      { source: 'odp', target: 'odg' },
      { source: 'odp', target: 'ods' },
      { source: 'odp', target: 'odt' },
      { source: 'odp', target: 'pdf' },
      { source: 'odp', target: 'pptx' },
      { source: 'odp', target: 'svg' },
      { source: 'odp', target: 'xlsx' },
      { source: 'ods', target: 'csv' },
      { source: 'ods', target: 'docx' },
      { source: 'ods', target: 'markdown' },
      { source: 'ods', target: 'odg' },
      { source: 'ods', target: 'odp' },
      { source: 'ods', target: 'odt' },
      { source: 'ods', target: 'pdf' },
      { source: 'ods', target: 'pptx' },
      { source: 'ods', target: 'svg' },
      { source: 'ods', target: 'xlsx' },
      { source: 'odt', target: 'csv' },
      { source: 'odt', target: 'docx' },
      { source: 'odt', target: 'markdown' },
      { source: 'odt', target: 'odg' },
      { source: 'odt', target: 'odp' },
      { source: 'odt', target: 'ods' },
      { source: 'odt', target: 'pdf' },
      { source: 'odt', target: 'pptx' },
      { source: 'odt', target: 'svg' },
      { source: 'odt', target: 'xlsx' },
      { source: 'pdf', target: 'csv' },
      { source: 'pdf', target: 'docx' },
      { source: 'pdf', target: 'markdown' },
      { source: 'pdf', target: 'odg' },
      { source: 'pdf', target: 'odp' },
      { source: 'pdf', target: 'ods' },
      { source: 'pdf', target: 'odt' },
      { source: 'pdf', target: 'pptx' },
      { source: 'pdf', target: 'svg' },
      { source: 'pdf', target: 'xlsx' },
      { source: 'pptx', target: 'csv' },
      { source: 'pptx', target: 'docx' },
      { source: 'pptx', target: 'markdown' },
      { source: 'pptx', target: 'odg' },
      { source: 'pptx', target: 'odp' },
      { source: 'pptx', target: 'ods' },
      { source: 'pptx', target: 'odt' },
      { source: 'pptx', target: 'pdf' },
      { source: 'pptx', target: 'svg' },
      { source: 'pptx', target: 'xlsx' },
      { source: 'svg', target: 'csv' },
      { source: 'svg', target: 'docx' },
      { source: 'svg', target: 'markdown' },
      { source: 'svg', target: 'odg' },
      { source: 'svg', target: 'odp' },
      { source: 'svg', target: 'ods' },
      { source: 'svg', target: 'odt' },
      { source: 'svg', target: 'pdf' },
      { source: 'svg', target: 'pptx' },
      { source: 'svg', target: 'xlsx' },
      { source: 'xlsx', target: 'csv' },
      { source: 'xlsx', target: 'docx' },
      { source: 'xlsx', target: 'markdown' },
      { source: 'xlsx', target: 'odg' },
      { source: 'xlsx', target: 'odp' },
      { source: 'xlsx', target: 'ods' },
      { source: 'xlsx', target: 'odt' },
      { source: 'xlsx', target: 'pdf' },
      { source: 'xlsx', target: 'pptx' },
      { source: 'xlsx', target: 'svg' },
    ]);
  });

  // A dedicated, order-independent assertion for the special-case odf -> pdf pair and the composed csv/xlsx <-> pdf pairs, on top of the exact-array assertion above -- these keep working even if SUPPORTED_CONVERSIONS' own order ever changes.
  it('includes the special-case odf->pdf and composed csv/xlsx<->pdf pairs', () => {
    const converter = createLocalDocumentConverter();
    expect(converter.conversions).toContainEqual({ source: 'odf', target: 'pdf' });
    expect(converter.conversions).toContainEqual({ source: 'csv', target: 'pdf' });
    expect(converter.conversions).toContainEqual({ source: 'pdf', target: 'csv' });
    expect(converter.conversions).toContainEqual({ source: 'xlsx', target: 'pdf' });
    expect(converter.conversions).toContainEqual({ source: 'pdf', target: 'xlsx' });
    // svg <-> pdf is a DIRECT layout pair, not a composed one (svg rides the drawing layout engine the way odg does), pinned here alongside the composed pairs so the distinction survives any future reordering.
    expect(converter.conversions).toContainEqual({ source: 'svg', target: 'pdf' });
    expect(converter.conversions).toContainEqual({ source: 'pdf', target: 'svg' });
    expect(converter.conversions).toContainEqual({ source: 'pdf', target: 'xlsx' });
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

  it('converts xlsx to pdf', async () => {
    const converter = createLocalDocumentConverter();
    const xlsxBytes = odsToXlsx(minimalOdsBytes());
    const result = await converter.convert({ source: { format: 'xlsx', bytes: xlsxBytes }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
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

  it('converts pdf to xlsx', async () => {
    const converter = createLocalDocumentConverter();
    const xlsxBytes = odsToXlsx(minimalOdsBytes());
    const xlsxToPdfResult = await converter.convert({ source: { format: 'xlsx', bytes: xlsxBytes }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    const result = await converter.convert({ source: xlsxToPdfResult.document, targetFormat: 'xlsx' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('xlsx');
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

  it('rejects an unsupported conversion pair with a named UnsupportedConversionError', async () => {
    const converter = createLocalDocumentConverter();
    const promise = converter.convert({ source: { format: 'docx', bytes: buildSampleDocx('Hi') }, targetFormat: 'docx' }, { signal: new AbortController().signal });
    await expect(promise).rejects.toBeInstanceOf(UnsupportedConversionError);
    await expect(promise).rejects.toThrow(/unsupported conversion/);
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

  it('returns a package with frame-stamped content and pages for a PDF-pivot conversion (docx -> pdf)', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'docx', bytes: buildSampleDocx('Hi') }, targetFormat: 'pdf' }, { signal: new AbortController().signal });

    expect(result.package).toBeDefined();
    const pkg = result.package!;
    expect(pkg.kind).toBe('wordprocessing');
    expect(pkg.pages).toBeDefined();
    const content = flattenTree(pkg);
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const paragraph = content.sections[0]?.blocks[0];
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected a paragraph block');
    }
    const run = paragraph.runs[0];
    expect(run?.sourcePath).toBeDefined();
    // The layout pass fused the run's rendered position onto the run node itself, on a page the package's own pages array describes.
    expect(run?.frames?.length).toBeGreaterThan(0);
    expect(run?.frames?.[0]?.pageIndex).toBe(0);
  });

  it('returns a package with content only (pages undefined) for a PDF-bypassing bridge conversion (odt -> docx)', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'odt', bytes: minimalOdtBytes() }, targetFormat: 'docx' }, { signal: new AbortController().signal });

    expect(result.package).toBeDefined();
    const pkg = result.package!;
    expect(pkg.kind).toBe('wordprocessing');
    expect(pkg.pages).toBeUndefined();
  });
});

describe('createLocalDocumentConverter: fonts', () => {
  it('reports a vendored font substitution as a diagnostic even with no callback supplied', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'docx', bytes: minimalDocxBytes() }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    expect(result.diagnostics).toContainEqual({ severity: 'info', code: 'font/substituted', message: '"Calibri" is not available; substituted the metric-compatible "carlito"' });
  });

  it('forwards the structured substitution to the caller own callback as well', async () => {
    const converter = createLocalDocumentConverter();
    const substitutions: FontSubstitution[] = [];
    await converter.convert(
      { source: { format: 'docx', bytes: minimalDocxBytes() }, targetFormat: 'pdf' },
      { signal: new AbortController().signal, onFontSubstitution: (substitution) => substitutions.push(substitution) },
    );
    expect(substitutions).toEqual([{ requestedFamily: 'Calibri', requestedBold: false, requestedItalic: false, reason: 'vendored-substitute', resolvedFamily: 'carlito' }]);
  });

  // Threading proof rather than a font-resolution proof (src/convert/convert-fonts.test.ts asserts on the real PDF font resource): a caller-supplied face for the requested family means nothing falls back, so the substitution diagnostic that would otherwise be reported is absent.
  it('threads caller-supplied faces into the conversion that lays text out', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      { source: { format: 'docx', bytes: minimalDocxBytes() }, targetFormat: 'pdf' },
      { signal: new AbortController().signal, fonts: [{ family: 'Calibri', bold: false, italic: false, bytes: caladeaRegularBytes() }] },
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'font/substituted')).toBe(false);
  });

  // A bridge runs no layout engine and resolves no face, so supplying fonts to one is accepted and reports nothing rather than silently changing its output.
  it('reports no font diagnostics for a PDF-bypassing bridge conversion', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      { source: { format: 'odt', bytes: minimalOdtBytes() }, targetFormat: 'docx' },
      { signal: new AbortController().signal, fonts: [{ family: 'Calibri', bold: false, italic: false, bytes: caladeaRegularBytes() }] },
    );
    expect(result.diagnostics).toEqual([]);
  });
});

describe('createLocalDocumentConverter: markdown image resolution', () => {
  // The port threads options.images through to markdown-codec's MarkdownImageResolver port for the markdown-sourced conversions -- the port-level counterpart to src/convert/markdown-image.test.ts's own ergonomic-function assertions. A relative-path image that a resolver turns into real PNG bytes reaches the converted document's own ContentDocument as a genuine ContentImageBlock rather than the alt-text degradation it becomes with no resolver.
  it('threads options.images through a markdown -> pdf conversion', async () => {
    const onePixelPng = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), (char) => char.codePointAt(0)!);
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      { source: { format: 'markdown', bytes: new TextEncoder().encode('![a local image](./local.png)') }, targetFormat: 'pdf' },
      { signal: new AbortController().signal, images: (destination) => (destination === './local.png' ? { bytes: onePixelPng } : undefined) },
    );
    const content = result.package === undefined ? undefined : flattenTree(result.package);
    expect(content?.kind).toBe('wordprocessing');
    if (content?.kind === 'wordprocessing') {
      const hasImage = content.sections.some((section) => section.blocks.some((block) => block.kind === 'image'));
      expect(hasImage).toBe(true);
    }
  });
});
