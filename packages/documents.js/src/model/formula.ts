import type {
  Box,
  ContentBlock,
  ContentDocument,
  ContentEmbeddedObject,
  ContentEmbeddedObjectBlock,
  ContentFormula,
  LayoutMetadata,
  SymbolTable,
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

// One formula this walk found. `sourcePath` is the embedding block's own field for a NON-nested entry -- undefined for the standalone 'formula' document kind (no embedding block at all) and for a spreadsheet's cell-anchored embedded objects (ContentEmbeddedObject carries no sourcePath field; only the block-level ContentEmbeddedObjectBlock wrapper does). For a NESTED entry (one found inside a non-formula embedded object's own document -- see collectDocumentFormulas' formula-inside-a-drawing-inside-a-spreadsheet example), `sourcePath` is that inner block's own field, from a wholly different document's block-flow namespace than the embedding document's -- it can therefore collide with an unrelated block's sourcePath at the outer level, which is exactly why `locate` (below), not `sourcePath`, is the field a consumer keys distinctness on. `locate` is a different thing entirely: a structural path this walk itself derives from container/index position (e.g. "sections[0]/blocks[2]", "sheets[1].embeddedObjects[0]"), guaranteed unique per formula within one document regardless of whether the source format populated sourcePath at all -- a consumer needing to tell two formulas apart (a diagnostic locator, a lint detail string) should key on this, not on sourcePath, which several real producers leave undefined (markdown-codec's own $$ lowering, src/lower/lower.ts's lowerMathBlock, builds its embedded formula block with no sourcePath field at all) or stamp with an identical constant across sibling formulas once this package's own read path replaces that block (src/markdown/math.ts's lowerMarkdownMath stamps every display formula's sourcePath with the same literal "markdown:math-block", every inline formula's with the same literal "markdown:math-inline").
//
// `symbolTable` is the GOVERNING table this formula's own symbol and unit references resolve against -- document-schema.js's own content.ts is explicit that "the symbol and unit references inside resolve against the embedding document's own symbolTable field", and for a nested entry that embedding document is the nested ContentDocument the formula actually lives in, never the outermost document a caller started the walk from. That contract covers the case where the embedding document DOES declare a table (use it, unconditionally); it says nothing about what a consumer should do when the embedding document's own field is undefined -- document-schema.js takes no position on cross-nesting inheritance at all. The outward fallback below (a document with none of its own inherits whichever table was governing at the point it was embedded, all the way out to the outermost document if nothing along the chain ever redeclares one) is therefore THIS PACKAGE's own design choice, not a document-schema.js requirement: it treats symbolTable as lexically scoped, so a nested document that curates nothing of its own can still resolve plain SI units and symbols the outer document already registered, without needing to reimport them. Every consumer of this walk (documents.js's own coherence lint, document-mcp's compute_formula tool) resolves a formula's symbols/units against this field. undefined when neither the formula's own document nor any enclosing one ever declared a table -- in which case a formula referencing a symbol or unit id fails loudly via evaluate()'s own UnboundSymbolError/UnknownUnitError, never silently.
export interface DocumentFormulaEntry {
  readonly formula: ContentFormula;
  readonly sourcePath: string | undefined;
  readonly locate: string;
  readonly symbolTable: SymbolTable | undefined;
}

// Recurses into table cells -- a table cell's own blocks are block-flow content like any other, and a formula can sit inside one. `locate` is the structural path to this block list's own container (e.g. "sections[0]"); each block's position within it is appended via blocks.entries() rather than a plain for...of, so two formulas anywhere in the same document -- siblings, or nested inside different table cells -- always derive distinct locate strings. A table's own index is folded into the cell path passed to the recursive call (not just row/cell index) so two sibling tables in the same block list can never collide either. `symbolTable` is the table already resolved as governing for THIS block list's own document (see collectDocumentFormulas below) -- a table cell is still part of the same document, so it rides through unchanged; only a genuinely nested document (recursed into below) gets a freshly resolved table of its own.
function collectFormulasFromBlocks(
  blocks: readonly ContentBlock[],
  locate: string,
  symbolTable: SymbolTable | undefined,
  out: DocumentFormulaEntry[],
): void {
  for (const [index, block] of blocks.entries()) {
    if (block.kind === "table") {
      for (const [rowIndex, row] of block.rows.entries()) {
        for (const [cellIndex, cell] of row.cells.entries()) {
          collectFormulasFromBlocks(
            cell.blocks,
            `${locate}/blocks[${String(index)}].rows[${String(rowIndex)}].cells[${String(cellIndex)}]`,
            symbolTable,
            out,
          );
        }
      }
      continue;
    }
    if (block.kind === "embeddedObject") {
      const formula = formulaOfBlock(block);
      const blockLocate = `${locate}/blocks[${String(index)}]`;
      if (formula !== undefined) {
        // block.document IS the formula's own embedding ContentDocument (kind 'formula'), and it carries its own optional symbolTable field exactly like every other ContentDocument arm -- the same nested-first-with-outward-fallback resolution collectDocumentFormulas already applies when recursing into a NON-formula nested document (the else branch below) must apply here too, or a formula that redeclares its own symbol/unit meanings differently from the enclosing document would silently resolve against the wrong one. `symbolTable` here is the enclosing document's already-resolved table, consulted only when the formula's own document declares none.
        out.push({
          formula,
          sourcePath: block.sourcePath,
          locate: blockLocate,
          symbolTable: block.document.symbolTable ?? symbolTable,
        });
      } else {
        // Not a formula itself, but ContentEmbeddedObject.document is unconditionally a whole ContentDocument (document-schema.js's own content.ts documents the mutual recursion this closes -- a formula embedded inside a drawing embedded inside a spreadsheet, say), so a formula one level deeper is still reachable by recursing the identical walk into it. Each nested entry's own sourcePath rides through unchanged (it is that formula's own field, not this embedding block's); only locate grows, nesting the embedding position ahead of the nested walk's own path so two formulas at different nesting depths -- or two nested inside sibling embedded objects -- can never collide. The enclosing `symbolTable` passed to the recursive call is a FALLBACK, not the answer: collectDocumentFormulas resolves the nested document's own symbolTable field first and only reaches for this parameter when the nested document declares none of its own -- so a nested entry's own symbolTable field (read back off `nested`, never recomputed here) is already the correct, nested-first-resolved table by the time it reaches this loop.
        for (const nested of collectDocumentFormulas(
          block.document,
          symbolTable,
        )) {
          out.push({
            formula: nested.formula,
            sourcePath: nested.sourcePath,
            locate: `${blockLocate}/${nested.locate}`,
            symbolTable: nested.symbolTable,
          });
        }
      }
    }
  }
}

// Every place document-schema.js's own content model lets a ContentFormula travel: a wordprocessing section's block flow, a presentation slide's or drawing page's own shape's block flow (both structurally identical to a section's, per ContentShapeSchema/ContentEmbeddedObjectBlock's own comments), a spreadsheet's own cell-anchored embeddedObjects array (a bare ContentEmbeddedObject with no block flow and no sourcePath, not a gap in this walk), and the standalone 'formula' document kind, whose single child IS the formula rather than a block wrapping one -- plus, at any depth beneath any of those four arms, a non-formula embedded object's own nested document, recursed into by both collectFormulasFromBlocks and the spreadsheet arm below precisely because ContentEmbeddedObject is mutually recursive with ContentDocument (content.ts's own comment on that type: "a formula embedded inside a drawing embedded inside a spreadsheet" is the literal example given, not a hypothetical). The shared formula walk documents.js's own coherence lint (src/latex/lint.ts) and document-mcp's compute_formula tool both call, rather than each re-deriving the per-kind traversal -- document-compute.js's own harness/corpus.ts is a second, independent formula-reading walk elsewhere in the family, not a third caller of this one: its published src/ cannot take documents.js as a runtime dependency without inverting the family's own dependency order (document-compute.js sits below documents.js), though a devDependency-only pairing is fine and is exactly what its own corpus.test.ts uses, so it derives its own narrower wordprocessing-only traversal instead for its real, shipped src/. Every arm derives each entry's own `locate` from container/index position as it walks, so two formulas anywhere in one document -- even two sharing the same sourcePath, two nested at different depths, or a format that never populates sourcePath at all -- always come back with distinct locate strings.
//
// `enclosingSymbolTable` is the table that governed whatever embedded THIS document (undefined at the outermost call) -- used purely as a nested-first fallback, per DocumentFormulaEntry's own comment above: this document's own `symbolTable` field wins whenever it declares one, and `enclosingSymbolTable` is only consulted when it does not. A caller starting a fresh walk over a document it read directly (documents.js's own lint, document-mcp's compute_formula) always omits this parameter -- it exists solely for this function's own recursive calls into a nested embedded object's document, where the enclosing document's resolved table is threaded in as the fallback a nested document without its own table should inherit.
export function collectDocumentFormulas(
  document: ContentDocument,
  enclosingSymbolTable?: SymbolTable,
): DocumentFormulaEntry[] {
  const symbolTable = document.symbolTable ?? enclosingSymbolTable;
  const out: DocumentFormulaEntry[] = [];
  switch (document.kind) {
    case "wordprocessing":
      for (const [index, section] of document.sections.entries()) {
        collectFormulasFromBlocks(
          section.blocks,
          `sections[${String(index)}]`,
          symbolTable,
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
            symbolTable,
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
            symbolTable,
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
          const objectLocate = `sheets[${String(sheetIndex)}].embeddedObjects[${String(objectIndex)}]`;
          if (formula !== undefined) {
            // object.document IS the formula's own embedding ContentDocument (kind 'formula') -- same reasoning as the block arm's identical branch above: its own symbolTable field takes priority, falling back to this sheet's already-resolved table only when the formula's own document declares none.
            out.push({
              formula,
              sourcePath: undefined,
              locate: objectLocate,
              symbolTable: object.document.symbolTable ?? symbolTable,
            });
          } else {
            // Same recursion as the block arm above, for a spreadsheet's own cell-anchored embedded objects (a bare ContentEmbeddedObject, never wrapped in a block): a non-formula object's document is still a whole ContentDocument that can itself carry a formula nested further in (a formula embedded inside a chart-cached sub-sheet, or inside a drawing anchored to a cell). `symbolTable` (this sheet's own governing table) is threaded in as the nested document's fallback, exactly as the block arm above does.
            for (const nested of collectDocumentFormulas(
              object.document,
              symbolTable,
            )) {
              out.push({
                formula: nested.formula,
                sourcePath: nested.sourcePath,
                locate: `${objectLocate}/${nested.locate}`,
                symbolTable: nested.symbolTable,
              });
            }
          }
        }
      }
      break;
    case "formula":
      out.push({
        formula: document.formula,
        sourcePath: undefined,
        locate: "formula",
        symbolTable,
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
