import type { Box, ContentDocument, ContentEmbeddedObjectBlock, ContentFormula, LayoutMetadata } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';

// A formula's real content lives INSIDE the ContentDocument, not alongside it. document-schema.js 2.0.0 models a genuine fifth 'formula' ContentDocument variant (`formula: ContentFormulaSchema`, carrying `{ mathml: MathMlNode[]; starMath?: string }`) and a fully-specified MathMlNode union of its own -- so a formula embedded in an odt paragraph or an odp slide is an ordinary ContentEmbeddedObjectBlock whose `document` genuinely holds the MathML, and a standalone .odf formula document is a top-level ContentDocument of that same kind.
//
// This replaces the side-channel `formulas: ReadonlyMap<sourcePath, EmbeddedFormula>` this package used to thread alongside every ContentDocument, back when ContentEmbeddedObject.document had no formula-shaped variant to carry a raw MathML tree in. That split is gone entirely: readOdtContent/readOdpContent return a bare ContentDocument again (exactly like readDocxContent/readPptxContent), the layout engines read a block's own formula directly instead of looking its sourcePath up in a map, and a formula consequently survives anywhere a ContentDocument travels -- including odmToPdf's chapter concatenation, which previously had to discard every chapter's map, because re-keying each formula's sourcePath against the combined document's own renumbered block indices was intractable.
//
// formulaPlaceholderText below is what remains of the old mechanism, and it has a genuine, permanent job rather than being a leftover: a consumer that cannot render MathML at all still needs something readable to show, and every one of them writes it as ordinary text. Three real ones exist -- buildOdtPackage (writing an embedded ODF formula sub-object would mean writing a whole nested sub-package, not merely a different markup vocabulary), src/markdown/write.ts (CommonMark/GFM has no math construct, and markdown-codec's own writer emits nothing at all for an embedded-object block), and this package's own wordprocessing layout engine, for a block whose formula carries no MathML nodes to typeset. buildDocxPackage is NO LONGER one of them in the ordinary case: it writes real OOXML math (OMML) via src/omml/write.ts, and reaches for this stand-in only when a formula's own MathML produces no OMML content at all.

// The 'formula' ContentDocument envelope around one ContentFormula. `metadata` is meaningful only for a standalone .odf document (its own title/author belongs on the PDF that document produces); an embedded sub-object's own metadata is not meaningful at the embedding document's level and is left empty.
export function formulaDocument(formula: ContentFormula, metadata: LayoutMetadata = {}): ContentDocument {
  return { kind: 'formula', formatVersion: CONTENT_FORMAT_VERSION, metadata, formula };
}

// A formula embedded in a wordprocessing/presentation document, as the ordinary ContentEmbeddedObjectBlock it is. `frame` is the source draw:frame's own geometry (the layout engines pick a rendered size from its height); `sourcePath` traces the block back to its origin exactly as every other block's does.
export function buildFormulaBlock(formula: ContentFormula, frame: Box, sourcePath: string): ContentEmbeddedObjectBlock {
  return { kind: 'embeddedObject', objectKind: 'formula', document: formulaDocument(formula), frame, sourcePath };
}

// The ContentFormula an embedded-object block actually carries, or undefined when its own document is not a formula document (a block a caller constructed by hand, or one whose objectKind says formula while its document says otherwise). Narrowing lives here so both layout engines resolve a formula block identically rather than each repeating the discriminant check.
export function formulaOfBlock(block: ContentEmbeddedObjectBlock): ContentFormula | undefined {
  return block.document.kind === 'formula' ? block.document.formula : undefined;
}

// The plain-text stand-in for a formula a consumer cannot typeset: its own StarMath annotation when the source carried one, else the verbatim presentation LaTeX when the formula carries one (a LaTeX-authored formula's own source text is the most faithful thing to show -- and the only thing to show when the pinned parser could not read it, since such a formula's MathML array is empty and its rendering would otherwise collapse to a bare marker), else a literal marker. Never an empty string -- an empty stand-in is indistinguishable from the formula having been silently dropped.
export function formulaPlaceholderText(formula: ContentFormula): string {
  return formula.starMath ?? formula.presentation?.latex ?? '[formula]';
}

