import type { ContentDocument, ContentShape } from 'document-schema.js';
import type { Package } from 'odf.js';
import { base64ToBytes } from 'odf.js';
import { mergeByPaintOrder } from '../../model/paint-order';
import { populateParagraph } from '../odt/content';
import { createOdg } from './editor';
import type { OdgPage } from './page';

// ContentDocument -> a fresh odg Package, built entirely through the same edit/odg/* live-view primitives a caller would use by hand -- the odg-side counterpart to src/edit/odp/content.ts's buildOdpPackage, and pdfToOdg's own package-building half (src/convert/convert.ts), fed by reconstructDrawing. Equally usable standalone by any caller holding a drawing ContentDocument from elsewhere -- most naturally one that came from readOdgContent itself, or the nested drawing document a recovered ContentEmbeddedObjectBlock carries (src/model/embedded-drawing.ts).
export function buildOdgPackage(content: ContentDocument): Package {
  if (content.kind !== 'drawing') {
    throw new Error('buildOdgPackage requires a drawing ContentDocument');
  }
  const editor = createOdg();
  const firstPage = content.pages[0];
  if (firstPage !== undefined) {
    editor.pageSize = firstPage.size;
  }
  for (const page of content.pages) {
    const odgPage = editor.addPage();
    // Appended in true paint order, merged across the page's two arrays through the shared paintOrder field (src/model/paint-order.ts) -- the identical merge src/layout/drawing.ts's own convertDrawingToLayout applies when laying the SAME content out, so a rebuilt-from-Content odg page paints exactly as its layout would. Document order IS paint order in a written .odg (no draw:z-index is ever emitted -- see OdgPage's own note), so appending in merged order is the whole of what is needed here.
    for (const entry of mergeByPaintOrder(page.vectors, page.shapes)) {
      if (entry.kind === 'vector') {
        odgPage.addVector(entry.value);
      } else {
        appendShape(odgPage, entry.value);
      }
    }
  }
  return editor.toPackage();
}

// Mirrors buildOdpPackage's own appendShape (src/edit/odp/content.ts) exactly: an image-only shape becomes a picture frame, everything else becomes a text box populated with its real paragraph content, and rotation carries through either branch -- odg's draw:frame geometry resolution is the SAME resolveOdfShapeGeometry/applyOdfTransform machinery odp uses (see page.ts's own top-of-file note on reusing OdpShape wholesale), so there is no odg-specific variant of this logic to write.
function appendShape(page: OdgPage, shape: ContentShape): void {
  const [onlyBlock] = shape.blocks;
  if (shape.blocks.length === 1 && onlyBlock?.kind === 'image') {
    const imageShape = page.addImage({ frame: shape.frame, format: onlyBlock.format, bytes: base64ToBytes(onlyBlock.base64), altText: onlyBlock.altText });
    if (shape.rotationDeg !== undefined) {
      imageShape.rotationDeg = shape.rotationDeg;
    }
    return;
  }

  const textShape = page.addTextBox({ frame: shape.frame, text: '' });
  if (shape.rotationDeg !== undefined) {
    textShape.rotationDeg = shape.rotationDeg;
  }
  // addTextBox's own placeholder empty paragraph is discarded in favour of the shape's real paragraph content -- mirrors buildOdpPackage's identical "addTextBox with a throwaway empty string, then overwrite" pattern.
  const placeholder = textShape.paragraphs()[0];
  placeholder?.remove();
  for (const block of shape.blocks) {
    if (block.kind !== 'paragraph') {
      continue; // a table or nested image inside a text shape is out of scope for this bridge, mirroring buildOdpPackage's own identical comment.
    }
    populateParagraph(textShape.appendParagraph(), block);
  }
}
