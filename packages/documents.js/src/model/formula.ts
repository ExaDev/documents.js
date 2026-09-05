import type {
  Box,
  ContentBlock,
  ContentDocument,
  ContentEmbeddedObject,
  ContentEmbeddedObjectBlock,
  ContentFormula,
  LayoutMetadata,
} from "document-schema.js";

// A formula's real content lives INSIDE the ContentDocument, not alongside it. document-schema.js 2.0.0 models a genuine fifth 'formula' ContentDocument variant (`formula: ContentFormulaSchema`, carrying `{ mathml: MathMlNode[]; starMath?: string }`) and a fully-specified MathMlNode union of its own -- so a formula embedded in an odt paragraph or an odp slide is an ordinary ContentEmbeddedObjectBlock whose `document` genuinely holds the MathML, and a standalone .odf formula document is a top-level ContentDocument of that same kind.
//
// This replaces the side-channel `formulas: ReadonlyMap<sourcePath, EmbeddedFormula>` this package used to thread alongside every ContentDocument, back when ContentEmbeddedObject.document had no formula-shaped variant to carry a raw MathML tree in. That split is gone entirely: readOdtContent/readOdpContent return a bare ContentDocument again (exactly like readDocxContent/readPptxContent), the layout engines read a block's own formula directly instead of looking its sourcePath up in a map, and a formula consequently survives anywhere a ContentDocument travels -- including odmToPdf's chapter concatenation, which previously had to discard every chapter's map, because re-keying each formula's sourcePath against the combined document's own renumbered block indices was intractable.
//
// formulaPlaceholderText below is what remains of the old mechanism, and it has a genuine, permanent job rather than being a leftover: a consumer that cannot render MathML at all still needs something readable to show, and every one of them writes it as ordinary text. Three real ones exist -- buildOdtPackage (writing an embedded ODF formula sub-object would mean writing a whole nested sub-package, not merely a different markup vocabulary), src/markdown/write.ts (CommonMark/GFM has no math construct, and markdown-codec's own writer emits nothing at all for an embedded-object block), and this package's own wordprocessing layout engine, for a block whose formula carries no MathML nodes to typeset. buildDocxPackage is NO LONGER one of them in the ordinary case: it writes real OOXML math (OMML) via src/omml/write.ts, and reaches for this stand-in only when a formula's own MathML produces no OMML content at all.

// The 'formula' ContentDocument envelope around one ContentFormula. `metadata` is meaningful only for a standalone .odf document (its own title/author belongs on the PDF that document produces); an embedded sub-object's own metadata is not meaningful at the embedding document's level and is left empty.
export function formulaDocument(
  formula: ContentFormula,
  metadata: LayoutMetadata = {},
): ContentDocument {
  return { kind: "formula", metadata, formula };
}

// A formula embedded in a wordprocessing/presentation document, as the ordinary ContentEmbeddedObjectBlock it is. `frame` is the source draw:frame's own geometry (the layout engines pick a rendered size from its height); `sourcePath` traces the block back to its origin exactly as every other block's does.
export function buildFormulaBlock(
  formula: ContentFormula,
  frame: Box,
  sourcePath: string,
): ContentEmbeddedObjectBlock {
  return {
    kind: "embeddedObject",
    objectKind: "formula",
    document: formulaDocument(formula),
    frame,
    sourcePath,
  };
}

// The ContentFormula an embedded object actually carries, or undefined when its own document is not a formula document (a block a caller constructed by hand, or one whose objectKind says formula while its document says otherwise). Narrowing lives here so both layout engines resolve a formula block identically rather than each repeating the discriminant check. Typed against the base ContentEmbeddedObject rather than the block-level ContentEmbeddedObjectBlock it was originally written for: `document` is a field ContentEmbeddedObjectBlock inherits unchanged from ContentEmbeddedObject (the block wrapper adds only `kind`/`sourcePath`/`frames`), so a spreadsheet's cell-anchored embedded objects -- which are bare ContentEmbeddedObject values, never wrapped in a block -- narrow through this exact same function rather than needing a second copy.
export function formulaOfBlock(
  object: ContentEmbeddedObject,
): ContentFormula | undefined {
  return object.document.kind === "formula"
    ? object.document.formula
    : undefined;
}

// One formula this walk found. `sourcePath` is the embedding block's own field -- undefined for the standalone 'formula' document kind (no embedding block at all) and for a spreadsheet's cell-anchored embedded objects (ContentEmbeddedObject carries no sourcePath field; only the block-level ContentEmbeddedObjectBlock wrapper does). `locate` is a different thing entirely: a structural path this walk itself derives from container/index position (e.g. "sections[0]/blocks[2]", "sheets[1].embeddedObjects[0]"), guaranteed unique per formula within one document regardless of whether the source format populated sourcePath at all -- a consumer needing to tell two formulas apart (a diagnostic locator, a lint detail string) should key on this, not on sourcePath, which several real producers leave undefined (markdown-codec's own $$ lowering, src/lower/lower.ts's lowerMathBlock, builds its embedded formula block with no sourcePath field at all) or stamp with an identical constant across sibling formulas once this package's own read path replaces that block (src/markdown/math.ts's lowerMarkdownMath stamps every display formula's sourcePath with the same literal "markdown:math-block", every inline formula's with the same literal "markdown:math-inline").
export interface DocumentFormulaEntry {
  readonly formula: ContentFormula;
  readonly sourcePath: string | undefined;
  readonly locate: string;
}

// Recurses into table cells -- a table cell's own blocks are block-flow content like any other, and a formula can sit inside one. `locate` is the structural path to this block list's own container (e.g. "sections[0]"); each block's position within it is appended via blocks.entries() rather than a plain for...of, so two formulas anywhere in the same document -- siblings, or nested inside different table cells -- always derive distinct locate strings. A table's own index is folded into the cell path passed to the recursive call (not just row/cell index) so two sibling tables in the same block list can never collide either.
function collectFormulasFromBlocks(
  blocks: readonly ContentBlock[],
  locate: string,
  out: DocumentFormulaEntry[],
): void {
  for (const [index, block] of blocks.entries()) {
    if (block.kind === "table") {
      for (const [rowIndex, row] of block.rows.entries()) {
        for (const [cellIndex, cell] of row.cells.entries()) {
          collectFormulasFromBlocks(
            cell.blocks,
            `${locate}/blocks[${String(index)}].rows[${String(rowIndex)}].cells[${String(cellIndex)}]`,
            out,
          );
        }
      }
      continue;
    }
    if (block.kind === "embeddedObject") {
      const formula = formulaOfBlock(block);
      if (formula !== undefined) {
        out.push({
          formula,
          sourcePath: block.sourcePath,
          locate: `${locate}/blocks[${String(index)}]`,
        });
      }
    }
  }
}

// Every place document-schema.js's own content model lets a ContentFormula travel: a wordprocessing section's block flow, a presentation slide's or drawing page's own shape's block flow (both structurally identical to a section's, per ContentShapeSchema/ContentEmbeddedObjectBlock's own comments), a spreadsheet's own cell-anchored embeddedObjects array (a bare ContentEmbeddedObject with no block flow and no sourcePath, not a gap in this walk), and the standalone 'formula' document kind, whose single child IS the formula rather than a block wrapping one. The one shared walk every formula-reading consumer in the family uses -- documents.js's own coherence lint (src/latex/lint.ts) and document-mcp's compute_formula tool both call this rather than each re-deriving the per-kind traversal. Every arm derives each entry's own `locate` from container/index position as it walks, so two formulas anywhere in one document -- even two sharing the same sourcePath, or a format that never populates sourcePath at all -- always come back with distinct locate strings.
export function collectDocumentFormulas(
  document: ContentDocument,
): DocumentFormulaEntry[] {
  const out: DocumentFormulaEntry[] = [];
  switch (document.kind) {
    case "wordprocessing":
      for (const [index, section] of document.sections.entries()) {
        collectFormulasFromBlocks(
          section.blocks,
          `sections[${String(index)}]`,
          out,
        );
      }
      break;
    case "presentation":
      for (const [slideIndex, slide] of document.slides.entries()) {
        for (const [shapeIndex, shape] of slide.shapes.entries()) {
          collectFormulasFromBlocks(
            shape.blocks,
            `slides[${String(slideIndex)}].shapes[${String(shapeIndex)}]`,
            out,
          );
        }
      }
      break;
    case "drawing":
      for (const [pageIndex, page] of document.pages.entries()) {
        for (const [shapeIndex, shape] of page.shapes.entries()) {
          collectFormulasFromBlocks(
            shape.blocks,
            `pages[${String(pageIndex)}].shapes[${String(shapeIndex)}]`,
            out,
          );
        }
      }
      break;
    case "spreadsheet":
      for (const [sheetIndex, sheet] of document.sheets.entries()) {
        for (const [objectIndex, object] of (
          sheet.embeddedObjects ?? []
        ).entries()) {
          const formula = formulaOfBlock(object);
          if (formula !== undefined) {
            out.push({
              formula,
              sourcePath: undefined,
              locate: `sheets[${String(sheetIndex)}].embeddedObjects[${String(objectIndex)}]`,
            });
          }
        }
      }
      break;
    case "formula":
      out.push({
        formula: document.formula,
        sourcePath: undefined,
        locate: "formula",
      });
      break;
    default: {
      // Leading underscore is deliberate, not a suppressed-unused-var workaround: this binding exists purely so its `never` annotation fails to compile the moment ContentDocument gains a kind this switch doesn't handle -- @exadev/eslint-config's no-pointless-reassignment rule exempts underscore-prefixed names precisely because such a binding's only job is the compile-time check, never its runtime value.
      const _exhaustive: never = document;
      throw new Error(
        `collectDocumentFormulas: unhandled ContentDocument kind ${JSON.stringify((_exhaustive as ContentDocument).kind)}`,
      );
    }
  }
  return out;
}

// The plain-text stand-in for a formula a consumer cannot typeset: its own StarMath annotation when the source carried one, else the verbatim presentation LaTeX when the formula carries one (a LaTeX-authored formula's own source text is the most faithful thing to show -- and the only thing to show when the pinned parser could not read it, since such a formula's MathML array is empty and its rendering would otherwise collapse to a bare marker), else a literal marker. Never an empty string -- an empty stand-in is indistinguishable from the formula having been silently dropped.
export function formulaPlaceholderText(formula: ContentFormula): string {
  return formula.starMath ?? formula.presentation?.latex ?? "[formula]";
}
