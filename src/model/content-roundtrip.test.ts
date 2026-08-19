import { describe, expect, it } from 'vitest';
import { base64ToBytes } from 'ooxml.js';
import type { ContentBlock, ContentImageBlock, ContentParagraph, ContentTable } from 'document-schema.js';
import { buildDocxPackage } from '../edit/docx/content';
import { createDocx } from '../edit/docx/editor';
import { buildPptxPackage } from '../edit/pptx/content';
import { createPptx } from '../edit/pptx/editor';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';

// src/convert/convert.test.ts's round-trip tests (docxToPdf -> pdfToDocx, pptxToPdf -> pdfToPptx) exercise the full docx/pptx -> ContentDocument -> LayoutDocument -> PDF -> LayoutDocument -> ContentDocument -> docx/pptx pipeline. A fidelity gap surfacing there could originate in readDocxContent/buildDocxPackage, in the layout engine (src/layout/engine.ts, src/layout/slides.ts, src/layout/reconstruct.ts), or in the PDF codec itself (src/pdf/*) -- three independent stages, any one of which could be the actual culprit.
//
// This file isolates just one of those stages: readDocxContent/buildDocxPackage and readPptxContent/buildPptxPackage, composed directly against each other with no LayoutDocument or PDF bytes anywhere in the loop (sample docx/pptx -> readXContent -> ContentDocument -> buildXPackage -> sample docx/pptx again -> readXContent -> ContentDocument). Comparing the two ContentDocument values this composition produces means a failure here points specifically at the read/write pair for that one format, never at the layout engine or the PDF codec.

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]); // real PNG magic bytes (ooxml.js's readPptxContent sniffs the format from these, not from a file extension) followed by a few arbitrary payload bytes -- the payload is never decoded as an actual image anywhere in this read/write pair, only carried through as an opaque blob

function isParagraph(block: ContentBlock): block is ContentParagraph {
  return block.kind === 'paragraph';
}

function isTable(block: ContentBlock): block is ContentTable {
  return block.kind === 'table';
}

function isImage(block: ContentBlock): block is ContentImageBlock {
  return block.kind === 'image';
}

describe('docx: readDocxContent/buildDocxPackage read -> build -> read stability', () => {
  it('agrees on paragraph text, a styled run, and table structure across the composition', () => {
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: 'Intro paragraph.' });

    const styledParagraph = editor.body.appendParagraph({ alignment: 'center' });
    const styledRun = styledParagraph.appendRun({ text: 'StyledRun' });
    styledRun.bold = true;
    styledRun.color = { r: 1, g: 0, b: 0 };
    styledRun.sizePt = 24;

    const table = editor.body.appendTable({ rows: 2, columns: 2, columnWidthsTwips: [2000, 2000] });
    table.cell(0, 0).paragraphs()[0]!.appendRun({ text: 'A1' });
    table.cell(0, 1).paragraphs()[0]!.appendRun({ text: 'B1' });
    table.cell(1, 0).paragraphs()[0]!.appendRun({ text: 'A2' });
    table.cell(1, 1).paragraphs()[0]!.appendRun({ text: 'B2' });

    // ooxml.js's flat docx reader (image reading since ooxml.js 2.6.1) now reads a real ContentImageBlock for an inline w:drawing -- readDocxContent (this package's own thin adapter over it) inherits that for free, with zero code change on this package's side. The upstream reader represents the image as TWO adjacent blocks sourced from the one physical <w:p>: a paragraph block carrying that paragraph's own (here all-empty) runs, immediately followed by the image block -- buildDocxPackage's appendBlocks (src/edit/docx/content.ts) recognises exactly that pattern and writes it back as the single physical paragraph it came from, which is what makes the full expect(roundTripped).toEqual(original) below hold byte-for-byte rather than accumulating a spurious empty paragraph before every image on every round trip.
    editor.body.appendParagraph().insertImageAfter({ format: 'png', bytes: PNG_BYTES, widthPt: 40, heightPt: 40 });

    editor.body.appendParagraph().appendRun({ text: 'Closing paragraph.' });

    const original = readDocxContent(editor.toPackage());
    if (original.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }

    const rebuiltPackage = buildDocxPackage(original);
    const roundTripped = readDocxContent(rebuiltPackage);
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }

    // The strongest available check: nothing survived that shouldn't have, and nothing that should have survived was dropped, reordered, or silently altered by the buildDocxPackage -> readDocxContent leg of the cycle.
    expect(roundTripped).toEqual(original);

    const originalParagraphs = original.sections.flatMap((s) => s.blocks).filter(isParagraph);
    const roundTrippedParagraphs = roundTripped.sections.flatMap((s) => s.blocks).filter(isParagraph);
    expect(roundTrippedParagraphs).toHaveLength(originalParagraphs.length);
    expect(roundTrippedParagraphs.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(originalParagraphs.map((p) => p.runs.map((r) => r.text).join('')));

    const roundTrippedStyledRun = roundTrippedParagraphs.flatMap((p) => p.runs).find((r) => r.text === 'StyledRun');
    expect(roundTrippedStyledRun).toMatchObject({ text: 'StyledRun', bold: true, sizePt: 24, color: { r: 1, g: 0, b: 0 } });

    const originalTable = original.sections.flatMap((s) => s.blocks).find(isTable);
    const roundTrippedTable = roundTripped.sections.flatMap((s) => s.blocks).find(isTable);
    expect(roundTrippedTable).toBeDefined();
    expect(roundTrippedTable).toEqual(originalTable);
    expect(roundTrippedTable?.rows).toHaveLength(2);
    expect(roundTrippedTable?.rows[0]?.cells.map((c) => (c.blocks[0]?.kind === 'paragraph' ? c.blocks[0].runs[0]?.text : undefined))).toEqual(['A1', 'B1']);
    expect(roundTrippedTable?.rows[1]?.cells.map((c) => (c.blocks[0]?.kind === 'paragraph' ? c.blocks[0].runs[0]?.text : undefined))).toEqual(['A2', 'B2']);

    // Confirms the top comment above: a real image block now survives in both reads, with its bytes/dimensions intact.
    const originalImage = original.sections.flatMap((s) => s.blocks).find(isImage);
    const roundTrippedImage = roundTripped.sections.flatMap((s) => s.blocks).find(isImage);
    expect(originalImage).toBeDefined();
    expect(originalImage?.format).toBe('png');
    expect(originalImage?.widthPt).toBe(40);
    expect(originalImage?.heightPt).toBe(40);
    expect(typeof originalImage?.base64).toBe('string');
    expect(roundTrippedImage).toEqual(originalImage);
  });
});

describe('pptx: readPptxContent/buildPptxPackage read -> build -> read stability', () => {
  it('agrees on slide count, a styled shape, an image, and speaker notes across the composition', () => {
    const editor = createPptx();

    const firstSlide = editor.addSlide();
    const titleShape = firstSlide.addTextBox({ frame: { xPt: 50, yPt: 30, widthPt: 400, heightPt: 60 }, text: '' });
    titleShape.setParagraphs([
      { alignment: 'center', runs: [{ text: 'Styled Title', bold: true, sizePt: 32, color: { r: 0, g: 0, b: 1 } }] },
      { runs: [{ text: 'Body text beneath the title' }] },
    ]);
    firstSlide.addImage({ frame: { xPt: 50, yPt: 120, widthPt: 80, heightPt: 60 }, format: 'png', bytes: PNG_BYTES });
    firstSlide.notes = 'Speaker notes for the first slide.';

    const secondSlide = editor.addSlide();
    secondSlide.addTextBox({ frame: { xPt: 50, yPt: 30, widthPt: 400, heightPt: 60 }, text: 'Second slide text' });

    const original = readPptxContent(editor.toPackage());
    if (original.kind !== 'presentation') {
      throw new Error('expected a presentation ContentDocument');
    }

    const rebuiltPackage = buildPptxPackage(original);
    const roundTripped = readPptxContent(rebuiltPackage);
    if (roundTripped.kind !== 'presentation') {
      throw new Error('expected a presentation ContentDocument');
    }

    expect(roundTripped.slides).toHaveLength(original.slides.length);
    expect(roundTripped.slides).toHaveLength(2);

    const originalShapeTexts = original.slides.map((slide) => slide.shapes.map((shape) => shape.blocks.filter(isParagraph).map((p) => p.runs.map((r) => r.text).join('')).join('')));
    const roundTrippedShapeTexts = roundTripped.slides.map((slide) => slide.shapes.map((shape) => shape.blocks.filter(isParagraph).map((p) => p.runs.map((r) => r.text).join('')).join('')));
    expect(roundTrippedShapeTexts).toEqual(originalShapeTexts);

    const originalStyledRun = original.slides[0]?.shapes.flatMap((s) => s.blocks).filter(isParagraph).flatMap((p) => p.runs).find((r) => r.text === 'Styled Title');
    const roundTrippedStyledRun = roundTripped.slides[0]?.shapes.flatMap((s) => s.blocks).filter(isParagraph).flatMap((p) => p.runs).find((r) => r.text === 'Styled Title');
    expect(roundTrippedStyledRun).toMatchObject({ text: 'Styled Title', bold: true, sizePt: 32, color: { r: 0, g: 0, b: 1 } });
    expect(roundTrippedStyledRun).toEqual(originalStyledRun);

    // Unlike docx, readPptxContent DOES read images back (ooxml.js's readPptx sniffs the picture's format from its own bytes and carries the base64 through) -- this is a real fidelity check, not the documented-gap workaround the docx test above needs.
    const originalImage = original.slides[0]?.shapes.flatMap((s) => s.blocks).find(isImage);
    const roundTrippedImage = roundTripped.slides[0]?.shapes.flatMap((s) => s.blocks).find(isImage);
    expect(originalImage).toBeDefined();
    expect(roundTrippedImage).toEqual(originalImage);
    expect(roundTrippedImage?.format).toBe('png');
    expect(roundTrippedImage !== undefined && base64ToBytes(roundTrippedImage.base64)).toEqual(PNG_BYTES);
    expect(roundTrippedImage).toMatchObject({ widthPt: 80, heightPt: 60 });

    expect(roundTripped.slides[0]?.notes).toBe('Speaker notes for the first slide.');
    expect(roundTripped.slides[0]?.notes).toBe(original.slides[0]?.notes);
    expect(roundTripped.slides[1]?.notes).toBe('');

    // The strongest available check for the whole slide deck at once.
    expect(roundTripped).toEqual(original);
  });
});
