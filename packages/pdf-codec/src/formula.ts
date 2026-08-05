// MathBox + PositionedFormula are now owned by document-schema.js (the neutral shared-schema package); re-exported here so this package's barrel and internal callers (math-content-write.ts, write.ts) keep importing them from './formula'. Only the PDF-coordinate-space convention comment below stays relevant here.
import type { MathBox, PositionedFormula } from 'document-schema.js';
export type { PositionedFormula };
export type { MathBox };

