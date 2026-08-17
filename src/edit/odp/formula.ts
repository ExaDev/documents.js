import type { ContentFormula } from 'document-schema.js';
import type { Package, XmlElement } from 'odf.js';
import { formatOdfLength } from 'odf.js';
import type { Box } from 'document-schema.js';
import { addFormulaObject } from '../../odf-package/formula';
import { el } from '../../xml/fragment';

// The odp-side counterpart to src/edit/odt/formula.ts's own buildFormulaFrame/insertFormulaFrameMedia -- same underlying mechanics (src/odf-package/formula.ts's addFormulaObject writes the real "Object N/content.xml" sub-document + manifest entry; only the referencing draw:frame differs), but positioned like every other odp shape rather than odt's text-flow anchoring: a slide has no surrounding text flow for a formula to sit "as-char" inside, so this frame carries real svg:x/svg:y/svg:width/svg:height instead, exactly mirroring src/edit/odp/image.ts's own buildImageFrame/insertImageFrameMedia pair (draw:object in place of draw:image).
export function buildFormulaFrame(href: string, frame: Box): XmlElement {
  return el(
    'draw:frame',
    {
      'svg:x': formatOdfLength(frame.xPt),
      'svg:y': formatOdfLength(frame.yPt),
      'svg:width': formatOdfLength(frame.widthPt),
      'svg:height': formatOdfLength(frame.heightPt),
    },
    [el('draw:object', { 'xlink:href': href })],
  );
}

export function insertFormulaFrameMedia(pkg: Package, frame: Box, formula: ContentFormula): XmlElement {
  const { href } = addFormulaObject(pkg, formula);
  return buildFormulaFrame(href, frame);
}
