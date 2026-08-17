import type { ContentDocument, ContentShape } from 'document-schema.js';
import type { Package } from 'odf.js';
import { base64ToBytes } from 'odf.js';
import { drawingOfBlock, embeddedDrawingVectors } from '../../model/embedded-drawing';
import { formulaOfBlock, formulaPlaceholderText } from '../../model/formula';
import { resolveMetadataTimestamps } from '../../model/metadata';
import type { ClockPort } from '../../ports/clock';
import { systemClock } from '../../ports/clock';
import { populateOdtTable, populateParagraph } from '../odt/content';
import { OdpEditor } from './editor';
import { createEmptyOdpPackage } from './scaffold';
import type { OdpSlide } from './slide';

// clock resolves content.metadata's own createdIso/modifiedIso the same way createOdp does (src/model/metadata.ts's resolveMetadataTimestamps) -- systemClock by default, never overwriting a createdIso/modifiedIso the source content already carried.
export interface BuildOdpPackageOptions {
  readonly clock?: ClockPort;
}

// ContentDocument -> a fresh odp Package, built entirely through the same edit/odp/* live-view primitives a caller would use by hand -- the odp-side counterpart to src/edit/pptx/content.ts's buildPptxPackage, and the write-side counterpart to src/odf/odp/read.ts's readOdpContent. Used by the PDF -> odp conversion path and by the odp<->pptx bridge. Both now genuinely produce table blocks: reconstructPresentation synthesizes one whenever it detects a real drawn gridline lattice on a page (src/layout/reconstruct.ts's own gate), so the table branch below is reachable from either caller, not only the bridge. Constructs its own package directly (createEmptyOdpPackage + OdpEditor) rather than calling createOdp(), mirroring buildDocxPackage's own identical reasoning: createOdp() always starts metadata from {}, but this function needs the SOURCE content's own metadata to reach resolveMetadataTimestamps.
//
// A shape's rotationDeg IS written back here (unlike buildPptxPackage's own documented gap for pptx, which has no a:xfrm/@rot setter yet) -- OdpShape.rotationDeg exists specifically because this task called for genuine draw:transform support, reusing odf.js's own transform.ts machinery (see shape.ts's own buildTransformAttr).
export function buildOdpPackage(content: ContentDocument, options?: BuildOdpPackageOptions): Package {
  if (content.kind !== 'presentation') {
    throw new Error('buildOdpPackage requires a presentation ContentDocument');
  }
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps(content.metadata, clock);
  const editor = new OdpEditor(createEmptyOdpPackage({ metadata }));
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
  // A shape carrying nothing but a recovered DRAWING (src/layout/reconstruct.ts's own vector recovery wraps one in a shape, since a slide has no other container for a block) becomes real draw:rect/draw:ellipse/draw:line/draw:path elements on the slide's own draw:page -- NOT a shape at all, since ODF positions a vector primitive directly against the page rather than nesting it in a frame. The vectors are translated by the wrapping shape's own frame origin, since that frame is where the embedded drawing sits on the slide. Built through src/edit/odg/vector.ts's writer, imported and reused wholesale (see OdpSlide.addVector's own note on why a presentation's draw:page needs no odp-specific variant of it).
  if (shape.blocks.length === 1 && onlyBlock?.kind === 'embeddedObject' && drawingOfBlock(onlyBlock) !== undefined) {
    for (const vector of embeddedDrawingVectors(onlyBlock, shape.frame)) {
      slide.addVector(vector);
    }
    return;
  }
  if (shape.blocks.length === 1 && onlyBlock?.kind === 'embeddedObject') {
    const formula = formulaOfBlock(onlyBlock);
    if (formula !== undefined) {
      // A formula carrying no MathML nodes at all degrades to its own plain-text stand-in, mirroring OdtBody's own appendEmbeddedObject narrowing (src/edit/odt/content.ts) -- writing an empty formula sub-document would render as an empty box, and writing nothing would drop the shape without trace.
      if (formula.mathml.length === 0) {
        slide.addTextBox({ frame: shape.frame, text: formulaPlaceholderText(formula) });
      } else {
        slide.addFormula(shape.frame, formula);
      }
      return;
    }
  }
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
