import type { ContentDocument } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import type { Box } from '../../model/geometry';
import { PAGE_SIZE_A4 } from '../../model/geometry';
import type { EmbeddedFormula } from '../../model/formula';

const ZERO_MARGINS = { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 };

// A minimal but genuinely useful placeholder ContentDocument for a formula's own ContentEmbeddedObjectBlock.document field (see src/model/formula.ts's own comment on why the real MathML never goes there): a single paragraph showing the formula's own StarMath annotation as plain text, or the literal "[formula]" when the source formula carried no StarMath annotation at all. A consumer with no MathML rendering of its own -- reading the ContentDocument directly, or round-tripping it through a future writer -- still gets a readable stand-in rather than an empty box.
function placeholderFormulaDocument(formula: EmbeddedFormula): ContentDocument {
  const text = formula.starMath ?? '[formula]';
  return {
    kind: 'wordprocessing',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {},
    sections: [{ pageSize: PAGE_SIZE_A4, margins: ZERO_MARGINS, blocks: [{ kind: 'paragraph', runs: [{ text }] }] }],
  };
}

export interface FormulaPlaceholderBlock {
  readonly kind: 'embeddedObject';
  readonly objectKind: 'formula';
  readonly document: ContentDocument;
  readonly frame: Box;
  readonly sourcePath: string;
}

export function buildFormulaPlaceholderBlock(formula: EmbeddedFormula, frame: Box, sourcePath: string): FormulaPlaceholderBlock {
  return { kind: 'embeddedObject', objectKind: 'formula', document: placeholderFormulaDocument(formula), frame, sourcePath };
}
