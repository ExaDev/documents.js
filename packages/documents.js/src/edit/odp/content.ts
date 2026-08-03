import type { ContentDocument, ContentShape } from 'document-schema.js';
import type { Package } from 'odf.js';
import { base64ToBytes } from 'odf.js';
import { populateOdtTable, populateParagraph } from '../odt/content';
import { createOdp } from './editor';
import type { OdpSlide } from './slide';

// ContentDocument -> a fresh odp Package, built entirely through the same edit/odp/* live-view primitives a caller would use by hand -- the odp-side counterpart to src/edit/pptx/content.ts's buildPptxPackage, and the write-side counterpart to src/odf/odp/read.ts's readOdpContent. Used by the PDF -> odp conversion path (src/layout/reconstruct.ts's own reconstructPresentation never produces a table block for a shape) and by the odp<->pptx bridge, which does.
//
// A shape's rotationDeg IS written back here (unlike buildPptxPackage's own documented gap for pptx, which has no a:xfrm/@rot setter yet) -- OdpShape.rotationDeg exists specifically because this task called for genuine draw:transform support, reusing odf.js's own transform.ts machinery (see shape.ts's own buildTransformAttr).
export function buildOdpPackage(content: ContentDocument): Package {
  if (content.kind !== 'presentation') {
    throw new Error('buildOdpPackage requires a presentation ContentDocument');
  }
  const editor = createOdp();
  const firstSlide = content.slides[0];
  if (firstSlide !== undefined) {
    editor.slideSize = firstSlide.size;
  }
  for (const slide of content.slides) {
    const odpSlide = editor.addSlide();
    for (const shape of slide.shapes) {
      appendShape(odpSlide, shape);
    }
    if (slide.notes.length > 0) {
      odpSlide.notes = slide.notes;
    }
  }
  return editor.toPackage();
}

function appendShape(slide: OdpSlide, shape: ContentShape): void {
  const [onlyBlock] = shape.blocks;
  if (shape.blocks.length === 1 && onlyBlock?.kind === 'image') {
    const imageShape = slide.addImage({ frame: shape.frame, format: onlyBlock.format, bytes: base64ToBytes(onlyBlock.base64), altText: onlyBlock.altText });
    if (shape.rotationDeg !== undefined) {
      imageShape.rotationDeg = shape.rotationDeg;
    }
    return;
  }
  if (shape.blocks.length === 1 && onlyBlock?.kind === 'table') {
    const { shape: tableFrame, table } = slide.addTable({
      frame: shape.frame,
      table: { rows: onlyBlock.rows.length, columns: onlyBlock.columnWidthsPt.length, columnWidthsPt: onlyBlock.columnWidthsPt },
    });
    if (shape.rotationDeg !== undefined) {
      tableFrame.rotationDeg = shape.rotationDeg;
    }
    populateOdtTable(table, onlyBlock);
    return;
  }

  const textShape = slide.addTextBox({ frame: shape.frame, text: '' });
  if (shape.rotationDeg !== undefined) {
    textShape.rotationDeg = shape.rotationDeg;
  }
  // addTextBox's own placeholder empty paragraph is discarded in favour of the shape's real paragraph content -- mirrors buildPptxPackage's identical "addTextBox with a throwaway empty string, then overwrite" pattern (src/edit/pptx/content.ts).
  const placeholder = textShape.paragraphs()[0];
  placeholder?.remove();
  for (const block of shape.blocks) {
    if (block.kind !== 'paragraph') {
      continue; // a nested table or image mixed alongside other blocks inside a single text shape is out of scope -- neither PDF-reconstructed shapes nor a real odp/pptx slide shape mix kinds this way, mirroring buildPptxPackage's own identical comment.
    }
    populateParagraph(textShape.appendParagraph(), block);
  }
}
