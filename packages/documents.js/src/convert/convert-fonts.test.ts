import { describe, expect, it } from 'vitest';
import type { FontSubstitution } from 'pdf-codec';
import { createStandardFontMeasurer, loadMathFont, writePdf } from 'pdf-codec';
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);
import { decodePackage as decodeOdfPackage } from 'odf.js';
import { encodePackage as encodeOoxmlPackage } from 'ooxml.js';
import { openDocx } from '../edit/docx/editor';
import { openPptx } from '../edit/pptx/editor';
import { convertDrawingToLayout } from '../layout/drawing';
import { convertWordprocessingToLayout } from '../layout/engine';
import { convertSpreadsheetToLayout } from '../layout/sheets';
import { convertPresentationToLayout } from '../layout/slides';
import { readOdgContent } from '../odf/odg/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdsContent } from '../odf/ods/read';
import { readOdtContent } from '../odf/odt/read';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import { minimalDocxBytes, standardFontDocxBytes } from '../test-support/docx';
import { caladeaRegularBytes, embeddedFontDocxPackage, fontRequestOdtBytes } from '../test-support/fonts';
import { minimalOdgBytes } from '../test-support/odg';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdsBytes } from '../test-support/ods';
import { minimalOdtBytes } from '../test-support/odt';
import { minimalPptxBytes } from '../test-support/pptx';
import { docxToPdf, odgToPdf, odpToPdf, odsToPdf, odtToPdf, pptxToPdf } from './convert';

// PDF object dictionaries are written as ordinary, uncompressed PDF objects (only content streams and image/font data are deflated), so a font resource is genuinely inspectable in the raw bytes -- which is the point of asserting on them here rather than on this package's own reader: a test that only asked readPdf what it recovered would be asking the writer's own sibling to confirm the writer's output, and could pass while the bytes carried no font program at all. 'latin1' rather than 'utf-8': PDF bytes are not valid UTF-8, and a replacement character mid-stream could otherwise swallow an ASCII marker we are searching for. Every byte above 0x7F decodes to some non-ASCII character under this label, so no spurious ASCII match can be manufactured by the decode.
function asLatin1(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder('latin1').decode(bytes);
}

// Every face pdf-codec embeds is a subsetted TrueType program behind a Type0/Identity-H composite font, so its /BaseFont carries the six-uppercase-letter subset tag ISO 32000-1 9.6.4 requires, followed by the face's own PostScript name. A standard-14 reference (/BaseFont /Helvetica) has no tag and no '+' at all, so this returns nothing for a document that embedded nothing.
const EMBEDDED_BASE_FONT_PATTERN = /\/BaseFont\s*\/[A-Z]{6}\+([A-Za-z0-9-]+)/g;

function embeddedFaceNames(pdf: Uint8Array<ArrayBuffer>): string[] {
  return [...new Set([...asLatin1(pdf).matchAll(EMBEDDED_BASE_FONT_PATTERN)].map((match) => match[1]))].filter((name) => name !== undefined);
}

// The three structural markers that together mean "a real font program travelled with this PDF": the composite font, its CIDFontType2 descendant, and the FontFile2 stream holding the actual sfnt bytes. Asserted as a set rather than one representative marker, because any one of them alone could be present while the font program itself was missing.
function expectEmbeddedTrueTypeFontResource(pdf: Uint8Array<ArrayBuffer>): void {
  const text = asLatin1(pdf);
  expect(text).toContain('/Subtype /Type0');
  expect(text).toContain('/Encoding /Identity-H');
  expect(text).toContain('/Subtype /CIDFontType2');
  expect(text).toContain('/FontFile2');
}

describe('X -> PDF: a family pdf-codec has a vendored metric-compatible substitute for', () => {
  // Calibri is not one of the standard 14 and never was renderable faithfully by them -- the old pipeline drew it as Helvetica with a width-correction factor. It now renders through the real, metric-compatible Carlito face, embedded in the output.
  it('docxToPdf embeds a real Carlito font program for a Calibri document rather than falling back to Helvetica', () => {
    const pdf = docxToPdf(minimalDocxBytes());
    expectEmbeddedTrueTypeFontResource(pdf);
    expect(embeddedFaceNames(pdf)).toEqual(['Carlito-Regular']);
    expect(asLatin1(pdf)).not.toContain('/BaseFont /Helvetica');
  });

  it('odtToPdf embeds a real Carlito font program for a Calibri document rather than falling back to Helvetica', () => {
    const pdf = odtToPdf(fontRequestOdtBytes('Calibri'));
    expectEmbeddedTrueTypeFontResource(pdf);
    expect(embeddedFaceNames(pdf)).toEqual(['Carlito-Regular']);
    expect(asLatin1(pdf)).not.toContain('/BaseFont /Helvetica');
  });
});

describe('X -> PDF: a family the source document embeds itself', () => {
  it('docxToPdf embeds the docx own deobfuscated Caladea face', () => {
    const pdf = docxToPdf(encodeOoxmlPackage(embeddedFontDocxPackage()));
    expectEmbeddedTrueTypeFontResource(pdf);
    expect(embeddedFaceNames(pdf)).toEqual(['Caladea-Regular']);
  });

  it('odtToPdf embeds the odt own Fonts/ face', () => {
    const pdf = odtToPdf(fontRequestOdtBytes('Caladea', true));
    expectEmbeddedTrueTypeFontResource(pdf);
    expect(embeddedFaceNames(pdf)).toEqual(['Caladea-Regular']);
  });

  // The control for the test above: the identical document, asking for the identical family, with the Fonts/ parts and their font-face declarations removed. Caladea has no vendored substitute of its own (only Calibri and Cambria do), so with nothing embedded there is nothing left but the standard 14 -- which is what proves the embedding above came from the source package rather than from anywhere else in the resolution chain.
  it('odtToPdf falls back to a standard font for the same document with its embedded faces removed', () => {
    const pdf = odtToPdf(fontRequestOdtBytes('Caladea'));
    expect(embeddedFaceNames(pdf)).toEqual([]);
    expect(asLatin1(pdf)).not.toContain('/FontFile2');
    expect(asLatin1(pdf)).toContain('/BaseFont /Helvetica');
  });
});

describe('X -> PDF: caller-supplied faces', () => {
  it('odtToPdf renders a family the document did not embed through a caller-supplied face', () => {
    const pdf = odtToPdf(fontRequestOdtBytes('Bookish'), { fonts: [{ family: 'Bookish', bold: false, italic: false, bytes: caladeaRegularBytes() }] });
    expectEmbeddedTrueTypeFontResource(pdf);
    expect(embeddedFaceNames(pdf)).toEqual(['Caladea-Regular']);
  });

  // Exactly one report for a document whose every run asks for the same family+weight+style, because the measurer and the writer share ONE registry (see docxToPdf) and pdf-codec caches a resolution per slot. Two registries would report this twice and, far worse, could measure against one face and draw with another.
  it('reports a vendored substitution once through onFontSubstitution', () => {
    const substitutions: FontSubstitution[] = [];
    docxToPdf(minimalDocxBytes(), { onFontSubstitution: (substitution) => substitutions.push(substitution) });
    expect(substitutions).toEqual([{ requestedFamily: 'Calibri', requestedBold: false, requestedItalic: false, reason: 'vendored-substitute', resolvedFamily: 'carlito' }]);
  });

  it('reports nothing for a document whose every family resolves without substitution', () => {
    const substitutions: FontSubstitution[] = [];
    docxToPdf(standardFontDocxBytes(), { onFontSubstitution: (substitution) => substitutions.push(substitution) });
    expect(substitutions).toEqual([]);
  });
});

// The backward-compatibility guarantee this phase had to keep: wiring a FontRegistry into all six conversions must not change a single byte of output for a document that embeds no fonts and asks for no family a vendored substitute claims. Each reference below reproduces the exact pre-registry pipeline -- createStandardFontMeasurer() into the format's own layout engine, then writePdf with no `fonts` option at all -- so this is a genuine before/after byte comparison rather than a self-consistency check of the new code against itself.
//
// Only the docx fixture needed a variant for it: the standard minimalDocxBytes asks for Calibri (as Word itself does), which is precisely a family that now resolves to an embedded Carlito face. The five ODF/pptx fixtures declare no family at all and so resolve through DEFAULT_LAYOUT_FONT's Helvetica, which the standard 14 covers directly.
function referenceDocxPdf(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const content = readDocxContent(openDocx(bytes).toPackage());
  if (content.kind !== 'wordprocessing') {
    throw new Error('readDocxContent returned a non-wordprocessing ContentDocument');
  }
  const { document: layout, formulas } = convertWordprocessingToLayout(content, { measurer: createStandardFontMeasurer(), mathMetricsAt });
  return writePdf(layout, { formulas });
}

function referencePptxPdf(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const content = readPptxContent(openPptx(bytes).toPackage());
  if (content.kind !== 'presentation') {
    throw new Error('readPptxContent returned a non-presentation ContentDocument');
  }
  const { document: layout, formulas } = convertPresentationToLayout(content, { measurer: createStandardFontMeasurer(), mathMetricsAt });
  return writePdf(layout, { formulas });
}

function referenceOdtPdf(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const content = readOdtContent(decodeOdfPackage(bytes));
  if (content.kind !== 'wordprocessing') {
    throw new Error('readOdtContent returned a non-wordprocessing ContentDocument');
  }
  const { document: layout, formulas } = convertWordprocessingToLayout(content, { measurer: createStandardFontMeasurer(), mathMetricsAt });
  return writePdf(layout, { formulas });
}

function referenceOdpPdf(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const content = readOdpContent(decodeOdfPackage(bytes));
  if (content.kind !== 'presentation') {
    throw new Error('readOdpContent returned a non-presentation ContentDocument');
  }
  const { document: layout, formulas } = convertPresentationToLayout(content, { measurer: createStandardFontMeasurer(), mathMetricsAt });
  return writePdf(layout, { formulas });
}

function referenceOdsPdf(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const content = readOdsContent(decodeOdfPackage(bytes));
  if (content.kind !== 'spreadsheet') {
    throw new Error('readOdsContent returned a non-spreadsheet ContentDocument');
  }
  const { document: layout, formulas } = convertSpreadsheetToLayout(content, { measurer: createStandardFontMeasurer(), mathMetricsAt });
  return writePdf(layout, { formulas });
}

function referenceOdgPdf(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const content = readOdgContent(decodeOdfPackage(bytes));
  if (content.kind !== 'drawing') {
    throw new Error('readOdgContent returned a non-drawing ContentDocument');
  }
  return writePdf(convertDrawingToLayout(content, { measurer: createStandardFontMeasurer() }).document);
}

const BYTE_IDENTITY_CASES: readonly { readonly name: string; readonly actual: () => Uint8Array<ArrayBuffer>; readonly reference: () => Uint8Array<ArrayBuffer> }[] = [
  { name: 'docxToPdf', actual: () => docxToPdf(standardFontDocxBytes()), reference: () => referenceDocxPdf(standardFontDocxBytes()) },
  { name: 'pptxToPdf', actual: () => pptxToPdf(minimalPptxBytes()), reference: () => referencePptxPdf(minimalPptxBytes()) },
  { name: 'odtToPdf', actual: () => odtToPdf(minimalOdtBytes()), reference: () => referenceOdtPdf(minimalOdtBytes()) },
  { name: 'odpToPdf', actual: () => odpToPdf(minimalOdpBytes()), reference: () => referenceOdpPdf(minimalOdpBytes()) },
  { name: 'odsToPdf', actual: () => odsToPdf(minimalOdsBytes()), reference: () => referenceOdsPdf(minimalOdsBytes()) },
  { name: 'odgToPdf', actual: () => odgToPdf(minimalOdgBytes()), reference: () => referenceOdgPdf(minimalOdgBytes()) },
];

describe('X -> PDF: backward compatibility', () => {
  it.each(BYTE_IDENTITY_CASES)('$name is byte-identical to the standard-font-only pipeline when nothing is embedded and no substitute applies', ({ actual, reference }) => {
    const withRegistry = actual();
    const withoutRegistry = reference();
    expect(asLatin1(withRegistry)).not.toContain('/FontFile2');
    expect(withRegistry.length).toBe(withoutRegistry.length);
    expect(withRegistry).toEqual(withoutRegistry);
  });

  // The proof that the comparison above can actually fail: the identical two pipelines, over the identical fixture except for the family its docDefaults ask for, genuinely diverge -- so byte identity for Arial is a real result about the registry, not a comparison that would pass however the wiring behaved.
  it('is deliberately NOT byte-identical for the same document asking for Calibri', () => {
    expect(docxToPdf(minimalDocxBytes())).not.toEqual(referenceDocxPdf(minimalDocxBytes()));
  });
});
