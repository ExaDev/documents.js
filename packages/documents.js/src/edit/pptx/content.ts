import type { ContentDocument, ContentShape } from 'document-schema.js';
import type { Package } from 'ooxml.js';
import { base64ToBytes } from 'ooxml.js';
import type { DrawingParagraphInit } from './shape';
import { createPptx } from './editor';
import type { PptxSlide } from './slide';

// ContentDocument -> a fresh pptx Package, the write-side counterpart to src/ooxml/pptx/read.ts's readPptxContent. Used by the PDF->pptx conversion path.
//
// One remaining gap, bounded and tracked rather than silent: every slide shares one deck-wide size (p:sldSz is presentation-level, not per-slide) -- taken from the first slide, since PDF-reconstructed pages that come from a single source document invariably share one page size in practice.
export function buildPptxPackage(content: ContentDocument): Package {
  if (content.kind !== 'presentation') {
    throw new Error('buildPptxPackage requires a presentation ContentDocument');
  }
  const editor = createPptx();
  const firstSlide = content.slides[0];
  if (firstSlide !== undefined) {
    editor.slideSize = firstSlide.size;
  }
  for (const slide of content.slides) {
    const pptxSlide = editor.addSlide();
    for (const shape of slide.shapes) {
      appendShape(pptxSlide, shape);
    }
    if (slide.notes.length > 0) {
      pptxSlide.notes = slide.notes;
    }
  }
  return editor.toPackage();
}

function appendShape(slide: PptxSlide, shape: ContentShape): void {
  const [onlyBlock] = shape.blocks;
  if (shape.blocks.length === 1 && onlyBlock?.kind === 'image') {
    const imageShape = slide.addImage({ frame: shape.frame, format: onlyBlock.format, bytes: base64ToBytes(onlyBlock.base64), altText: onlyBlock.altText });
    if (shape.rotationDeg !== undefined) {
      imageShape.rotationDeg = shape.rotationDeg;
    }
    return;
  }
  const paragraphs: DrawingParagraphInit[] = [];
  for (const block of shape.blocks) {
    if (block.kind !== 'paragraph') {
      continue; // a table or nested image inside a text shape is out of scope for this bridge -- PDF-reconstructed shapes never mix kinds (see reconstruct.ts)
    }
    paragraphs.push({
      alignment: block.alignment,
      runs: block.runs.map((run) => ({ text: run.text, bold: run.bold, italic: run.italic, fontFamily: run.fontFamily, sizePt: run.sizePt, color: run.color })),
    });
  }
  const textBox = slide.addTextBox({ frame: shape.frame, text: '' });
  if (shape.rotationDeg !== undefined) {
    textBox.rotationDeg = shape.rotationDeg;
  }
  textBox.setParagraphs(paragraphs);
}
