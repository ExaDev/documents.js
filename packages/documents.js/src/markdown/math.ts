import type { ContentBlock, ContentDocument, ContentRun, MathSymbolEntry } from 'document-schema.js';
import type { LatexDiagnosticSink } from '../latex/diagnostics';
import { latexToFormula } from '../latex/lower';
import { extractSymbolDefinitionsFromProse } from '../latex/symbols';
import { buildFormulaBlock } from '../model/formula';

// The markdown read path's math-lowering pass: markdown-codec recognises math syntax ($$ display blocks and \( \) inline spans, its issue #53) but deliberately stops short of lowering the LaTeX -- a $$ block becomes an embedded formula object carrying the verbatim presentation layer and nothing else, an inline span a Cambria-Math-marked run, with markdown-codec's own diagnostics saying "it is not parsed as LaTeX or converted to MathML by this package". This pass is that lowering, living here rather than inside markdown-codec because it is a documents.js question (the issue trail is explicit: markdown-codec#53 deferred to documents.js#563, which settled on model-level lowering in #572): every formula shape is lowered once into the two-layer ContentFormula every format in this family shares, so markdown math becomes typesettable (MathML), editable (OMML via the docx writer), and computable (the MathExpression content layer) without markdown-codec knowing any of that exists.
//
// The inline marker string markdown-codec's lowered runs carry is mirrored here as a literal: markdown-codec re-exports its style-constant vocabulary for exactly this sibling-package use, but MATH_INLINE_FONT_MARKER ('Cambria Math') is not among the re-exported names. It is a stable, documented convention of markdown-codec's own lower/emit pair (the same "standard, not invented" naming its Courier New code-span marker plays), and this package's read pass (recognition) and write pass (src/markdown/write.ts's reconstruction) agree on it exactly as markdown-codec's own two halves do. Display math needs no marker: since markdown-codec's fidelity-constructs row landed, a $$ block arrives as the embedded formula object itself (presentation LaTeX, no content layer), and this pass recognises that block shape directly.

const MATH_INLINE_FONT_MARKER = 'Cambria Math';

// The stand-in frame for a formula markdown never gave geometry: markdown records no page geometry at all (src/markdown/read.ts's own pageSize note), so there is no source box to carry. Mirrors the docx OMML recovery's own convention (src/ooxml/docx/formula.ts): width 0 tells the layout fit (formulaSizePtForFrame) that height alone drives the rendered size, and the height is twice the size a body-text formula renders at -- Word's own 11pt body default, since markdown states no size either.
const STAND_IN_FRAME = { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 };

// Provenance sources the pass stamps, distinguishing the two markdown math shapes so the write path (src/markdown/write.ts) can reconstruct the same shape back out: display blocks re-emit as $$ blocks, inline spans as marker runs.
const MATH_BLOCK_SOURCE = 'markdown:math-block';
const MATH_INLINE_SOURCE = 'markdown:math-inline';

export interface MarkdownMathLoweringOptions {
  // Receives every diagnostic the pass emits -- prose definitions seeded, per-formula degradations -- as they happen.
  readonly onDiagnostic?: LatexDiagnosticSink;
}

// One paragraph's inline math extraction: the LaTeX of each Cambria-Math-marked run, in order, paired with the paragraph as it stands minus those runs. An all-math paragraph (nothing but math runs) is consumed entirely -- the same "a paragraph carrying nothing but its equation IS the equation" rule the docx and odf recoveries play -- so the formula blocks replace it in place rather than leaving an empty paragraph behind.
interface InlineMathExtraction {
  readonly latexRuns: readonly string[];
  readonly remainingRuns: readonly ContentRun[];
  readonly consumed: boolean;
}

function extractInlineMath(runs: readonly ContentRun[]): InlineMathExtraction {
  const latexRuns: string[] = [];
  const remainingRuns: ContentRun[] = [];
  for (const run of runs) {
    if (run.fontFamily === MATH_INLINE_FONT_MARKER && run.text.trim() !== '') {
      latexRuns.push(run.text);
      continue;
    }
    remainingRuns.push(run);
  }
  const consumed = latexRuns.length > 0 && remainingRuns.every((run) => run.text === '');
  return { latexRuns, remainingRuns: consumed ? [] : remainingRuns, consumed };
}

// Lower a wordprocessing ContentDocument's markdown-carried math in place-free fashion: returns a NEW document (nothing of the input is mutated -- this is a read adapter's projection, not a layout pass stamping frames). Display-math paragraphs become embedded formula blocks carrying presentation+content+MathML+provenance; inline math runs leave their paragraph and follow it as formula blocks, the position convention the odf/docx recoveries already established for inline equations. The document's symbol table is seeded from its own prose definitions first, so a formula referencing a prose-defined glyph resolves to the curated entry; glyphs nobody defined are minted into the table so every reference resolves.
export function lowerMarkdownMath(document: ContentDocument, options?: MarkdownMathLoweringOptions): ContentDocument {
  if (document.kind !== 'wordprocessing') {
    return document;
  }
  const sink = options?.onDiagnostic;
  const proseEntries = extractSymbolDefinitionsFromProse(document, sink);
  const known = new Map<string, MathSymbolEntry>(proseEntries.map((entry) => [entry.glyph, entry]));
  const minted = new Map<string, MathSymbolEntry>();
  const lowerOne = (latex: string, source: string): ContentBlock | undefined => {
    if (latex.trim() === '') {
      return undefined;
    }
    const result = latexToFormula(latex, { symbolEntries: [...known.values()], source });
    for (const diagnostic of result.diagnostics) {
      sink?.(diagnostic);
    }
    for (const entry of result.mintedSymbols) {
      if (!known.has(entry.glyph) && !minted.has(entry.glyph)) {
        minted.set(entry.glyph, entry);
      }
    }
    return buildFormulaBlock(result.formula, STAND_IN_FRAME, source);
  };
  const lowerBlocks = (blocks: readonly ContentBlock[]): ContentBlock[] => {
    const out: ContentBlock[] = [];
    for (const block of blocks) {
      if (block.kind === 'table') {
        out.push({ ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, blocks: lowerBlocks(cell.blocks) })) })) });
        continue;
      }
      if (block.kind === 'embeddedObject' && block.objectKind === 'formula' && block.document.kind === 'formula' && block.document.formula.presentation !== undefined) {
        // markdown-codec's own $$ carry (its fidelity-constructs row): an embedded formula block holding the verbatim presentation LaTeX and no content layer. This pass replaces it in place with the fully lowered formula -- same block kind, same position in the flow, now carrying content, MathML, and provenance -- so every format this package builds from markdown sees the same two-layer formula any other format's math arrives as. A blank presentation (an empty $$ block) lowers to nothing and keeps markdown-codec's own block, the empty formula it spelled.
        const formulaBlock = lowerOne(block.document.formula.presentation.latex, MATH_BLOCK_SOURCE);
        out.push(formulaBlock ?? block);
        continue;
      }
      if (block.kind !== 'paragraph') {
        out.push(block);
        continue;
      }
      const extraction = extractInlineMath(block.runs);
      if (extraction.latexRuns.length === 0) {
        out.push(block);
        continue;
      }
      if (!extraction.consumed) {
        out.push({ ...block, runs: [...extraction.remainingRuns] });
      }
      for (const latex of extraction.latexRuns) {
        const formulaBlock = lowerOne(latex, MATH_INLINE_SOURCE);
        if (formulaBlock !== undefined) {
          out.push(formulaBlock);
        }
      }
    }
    return out;
  };
  const sections = document.sections.map((section) => ({ ...section, blocks: lowerBlocks(section.blocks) }));
  const symbols = [...known.values(), ...minted.values()];
  if (symbols.length === 0) {
    // No prose definitions and no minted glyphs (a formula of pure numbers mints nothing): the table stays unset rather than carried empty -- the schema's own "a document with no lowered math content simply omits it".
    return { ...document, sections };
  }
  return { ...document, sections, symbolTable: { symbols, units: [] } };
}
