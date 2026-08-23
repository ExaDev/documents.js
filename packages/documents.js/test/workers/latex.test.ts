import { describe, expect, it } from 'vitest';
import { assembleTree } from 'document-schema.js';
import { buildMarkdownText, latexToFormula, lintMathCoherence, readMarkdownContent } from '../../src';

// Proves the whole LaTeX lowering path (the pinned temml parser through the lowering, the markdown read pass, the write reconstruction, and the coherence lint) executes inside a Cloudflare Workers isolate with no Node-only API usage -- temml is pure JavaScript whose DOM-touching entry points (render/renderMathInElement) are never called by this package, and whose parser/MathML-tree builder feature-detect `document` before using it (see src/latex/temml.ts's own top-of-file comment). If temml's parse path (or anything this feature pulls in) touched node:fs/Buffer/process at module top level or during a call, the workerd isolate would throw at import or fail these assertions rather than pass.
describe('the LaTeX lowering under the Cloudflare Workers runtime', () => {
  it('lowerLatex\'s pinned parser parses and lowers real math inside workerd', async () => {
    const { lowerLatex } = await import('../../src/latex/lower');
    const result = lowerLatex('\\sum_{i=1}^{n} \\frac{1}{i^2}');
    expect(result.expression).toEqual({
      kind: 'sum',
      binder: 'i',
      lower: { kind: 'num', numerator: '1', denominator: '1' },
      upper: { kind: 'sym', id: 'symbols:n' },
      body: { kind: 'app', operator: 'math:divide', args: [{ kind: 'num', numerator: '1', denominator: '1' }, { kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'i' }, { kind: 'num', numerator: '2', denominator: '1' }] }] },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('latexToFormula produces a presentation-MathML tree inside workerd', () => {
    const result = latexToFormula('\\frac{a}{b}');
    const root = result.formula.mathml[0];
    expect(root?.type).toBe('element');
    expect(root?.type === 'element' ? root.tag : undefined).toBe('math');
  });

  it('the markdown read pass lowers $$ display math into a two-layer formula block inside workerd', () => {
    const content = readMarkdownContent('Where R is the resistance.\n\n$$\nR^2\n$$\n');
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const formulaBlock = content.sections[0]?.blocks.find((block) => block.kind === 'embeddedObject');
    if (formulaBlock === undefined || formulaBlock.kind !== 'embeddedObject' || formulaBlock.document.kind !== 'formula') {
      throw new Error('expected an embedded formula block');
    }
    expect(formulaBlock.document.formula.presentation).toEqual({ latex: 'R^2' });
    expect(formulaBlock.document.formula.content).toEqual({ kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'symbols:R' }, { kind: 'num', numerator: '2', denominator: '1' }] });
    // The write side reconstructs the same markdown math from the presentation layer, all inside the isolate.
    expect(buildMarkdownText(content)).toContain('$$\nR^2\n$$');
  });

  it('the coherence lint runs over a package inside workerd', () => {
    const content = readMarkdownContent('$$\nx^2\n$$\n');
    expect(lintMathCoherence(assembleTree(content))).toEqual([]);
  });
});
