import { describe, expect, it } from 'vitest';
import type { LatexDiagnostic } from '../latex/diagnostics';
import { lintMathCoherence } from '../latex/lint';
import { buildMarkdownText } from './write';
import { lowerMarkdownMath } from './math';
import { readMarkdownContent } from './read';

// The markdown math-lowering pass end to end: markdown-codec's preserved raw LaTeX ($$ display blocks, \( \) inline spans) becomes the two-layer ContentFormula every format in this family shares, the document's own prose seeds the symbol table, and the write side reconstructs the same markdown math syntax from the presentation layer. These tests pin the whole pipeline the issue describes -- "parse at the format edge, lower at the model level, so every input format that can carry LaTeX benefits from one lowering implementation".

const MATH_MARKDOWN = [
  '# Math document',
  '',
  'Where R is the resistance per unit length.',
  '',
  '$$',
  '\\sum_{i=1}^{n} \\frac{1}{i^2}',
  '$$',
  '',
  'An inline span \\(x^2 + 1\\) mid-sentence.',
  '',
  '$$',
  '2x',
  '$$',
].join('\n');

describe('readMarkdownContent math lowering', () => {
  it('lowers a $$ display block into an embedded formula block carrying presentation, content, MathML, and provenance', () => {
    const content = readMarkdownContent(MATH_MARKDOWN);
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const formulaBlock = content.sections[0]?.blocks.find((block) => block.kind === 'embeddedObject');
    if (formulaBlock?.kind !== 'embeddedObject' || formulaBlock.document.kind !== 'formula') {
      throw new Error('expected an embedded formula block');
    }
    const formula = formulaBlock.document.formula;
    expect(formula.presentation).toEqual({ latex: '\\sum_{i=1}^{n} \\frac{1}{i^2}' });
    expect(formula.content).toEqual({
      kind: 'sum',
      binder: 'i',
      lower: { kind: 'num', numerator: '1', denominator: '1' },
      upper: { kind: 'sym', id: 'symbols:n' },
      body: { kind: 'app', operator: 'math:divide', args: [{ kind: 'num', numerator: '1', denominator: '1' }, { kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'i' }, { kind: 'num', numerator: '2', denominator: '1' }] }] },
    });
    expect(formula.provenance).toEqual({ source: 'markdown:math-block', editTrail: [] });
    const root = formula.mathml[0];
    expect(root?.type === 'element' ? root.tag : undefined).toBe('math');
  });

  it('seeds the document symbol table from prose, and a formula referencing the prose-defined glyph resolves to the curated entry', () => {
    const content = readMarkdownContent('Where R is the resistance per unit length.\n\n$$\nR^2\n$$\n');
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const table = content.symbolTable;
    expect(table?.units).toEqual([]);
    const curated = table?.symbols.find((entry) => entry.glyph === 'R');
    expect(curated).toEqual({ glyph: 'R', scope: 'document', id: 'symbols:R', definitionSource: 'Where R is the resistance per unit length.' });
    const formulaBlock = content.sections[0]?.blocks.find((block) => block.kind === 'embeddedObject');
    if (formulaBlock?.kind !== 'embeddedObject' || formulaBlock.document.kind !== 'formula') {
      throw new Error('expected an embedded formula block');
    }
    expect(formulaBlock.document.formula.content).toEqual({ kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'symbols:R' }, { kind: 'num', numerator: '2', denominator: '1' }] });
  });

  it('a document with no math and no prose definitions carries no symbol table at all', () => {
    const content = readMarkdownContent('# Plain\n\nJust prose, no symbols defined and no math.\n');
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    expect(content.symbolTable).toBeUndefined();
  });

  it('an inline \\( \\) span leaves its paragraph and follows it as a formula block', () => {
    const content = readMarkdownContent('An inline span \\(x^2 + 1\\) mid-sentence.\n');
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const blocks = content.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const paragraph = blocks[0];
    expect(paragraph?.kind).toBe('paragraph');
    expect(paragraph?.kind === 'paragraph' ? paragraph.runs.map((run) => run.text) : undefined).toEqual(['An inline span ', ' mid-sentence.']);
    const formulaBlock = blocks[1];
    if (formulaBlock?.kind !== 'embeddedObject' || formulaBlock.document.kind !== 'formula') {
      throw new Error('expected an embedded formula block after the paragraph');
    }
    expect(formulaBlock.document.formula.presentation).toEqual({ latex: 'x^2 + 1' });
    expect(formulaBlock.document.formula.provenance).toEqual({ source: 'markdown:math-inline', editTrail: [] });
  });

  it('a paragraph that is nothing but an inline span is consumed by its formula block', () => {
    const content = readMarkdownContent('\\(E\\)\n');
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const blocks = content.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('embeddedObject');
  });

  it('a context-starved construct degrades to unparsed inside the formula and surfaces its diagnostic through the sink', () => {
    const diagnostics: LatexDiagnostic[] = [];
    const content = readMarkdownContent('$$\n2x\n$$\n', undefined, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const formulaBlock = content.sections[0]?.blocks[0];
    if (formulaBlock?.kind !== 'embeddedObject' || formulaBlock.document.kind !== 'formula') {
      throw new Error('expected an embedded formula block');
    }
    expect(formulaBlock.document.formula.content).toEqual({ kind: 'unparsed', latex: '2x' });
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'latex/juxtaposition-unparsed')).toBe(true);
  });

  it('an unparseable $$ block still becomes a formula carrying the verbatim presentation and an unparsed root -- the text is never lost', () => {
    const content = readMarkdownContent('$$\n\\notacommand{x}\n$$\n');
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const formulaBlock = content.sections[0]?.blocks[0];
    if (formulaBlock?.kind !== 'embeddedObject' || formulaBlock.document.kind !== 'formula') {
      throw new Error('expected an embedded formula block');
    }
    expect(formulaBlock.document.formula.presentation).toEqual({ latex: '\\notacommand{x}' });
    expect(formulaBlock.document.formula.mathml).toEqual([]);
    expect(formulaBlock.document.formula.content).toEqual({ kind: 'unparsed', latex: '\\notacommand{x}' });
  });

  it('math inside a table cell is lowered too', () => {
    // Inline math, not a $$ block -- markdown-codec's block-math syntax needs its own delimiter lines, which cannot occur inside a single-line table cell, so the in-cell shape is the \\( \\) span.
    const content = readMarkdownContent('| head |\n| --- |\n| cell \\(a + b\\) text |\n');
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const table = content.sections[0]?.blocks.find((block) => block.kind === 'table');
    if (table?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    const cellBlocks = table.rows[1]?.cells[0]?.blocks ?? [];
    expect(cellBlocks[0]?.kind).toBe('paragraph');
    expect(cellBlocks[1]?.kind).toBe('embeddedObject');
  });
});

describe('buildMarkdownText math reconstruction', () => {
  it('round-trips display and inline math from the presentation layer, verbatim', () => {
    const content = readMarkdownContent(MATH_MARKDOWN);
    const text = buildMarkdownText(content);
    expect(text).toContain('$$\n\\sum_{i=1}^{n} \\frac{1}{i^2}\n$$');
    expect(text).toContain('\\(x^2 + 1\\)');
    expect(text).toContain('$$\n2x\n$$');
    // The re-read document lowers the identical presentation strings again -- the two-layer model round-trips through markdown without touching the semantic layer.
    const reread = readMarkdownContent(text);
    expect(lintMathCoherence({ formatVersion: 2, content: reread })).toEqual([]);
  });

  it('a formula with no presentation layer still flattens to its plain-text stand-in', () => {
    const content = lowerMarkdownMath(readMarkdownContent('no math here\n'));
    const text = buildMarkdownText(content);
    expect(text).toContain('no math here');
  });
});
