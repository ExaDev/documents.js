// The MathML layout shapes documents.js owns itself (the layout RESULT and its diagnostics) -- the box/item shapes and the font-metrics port now live in document-schema.js (src/math-layout.ts), so this file imports MathBox from there and adds only what is genuinely documents.js-local on top of it.
import type { MathBox } from "document-schema.js";

// Mirrors this package's existing three-tier PDF-read diagnostic policy (see README's own "Conventions" section) at formula-layout granularity: 'unsupported-element' for a MathML construct this engine doesn't implement (rendered as its own plain-text content instead, so the formula still lays out rather than vanishing); 'missing-glyph' for a code point the embedded math font has no glyph for at all (rendered as nothing -- an empty run -- rather than crashing layout, in the same spirit as encodeForShow's own WinAnsi substitution reporting for the standard-14 text path).
export type MathDiagnosticKind = "unsupported-element" | "missing-glyph";

export interface MathDiagnostic {
  readonly kind: MathDiagnosticKind;
  readonly detail: string; // the element's own local tag name, or the missing code point formatted as "U+XXXX"
}

export interface MathLayoutResult {
  readonly box: MathBox;
  readonly diagnostics: readonly MathDiagnostic[];
}
