import { assembleTree, type ContentBlock, type DocumentTree } from 'document-schema.js';

import { describe, expect, it } from 'vitest';
import { latexToFormula } from './lower';
import { lintMathCoherence } from './lint';
import { buildFormulaBlock } from '../model/formula';

// The coherence lint's contract: re-parse, re-lower, compare -- and report divergence as a warning carrying the stored provenance, never as an automatic re-derivation (the schema's atomic pair-edit rule: the layers stay exactly as stored). These tests also pin that the lint WRITES nothing: every assertion re-reads the same package object after linting.

function packageOf(blocks: readonly ContentBlock[]): DocumentTree {
  return assembleTree({
    kind: 'wordprocessing',
    metadata: {},
    sections: [{ pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 }, blocks: [...blocks] }],
  });
}

function mathBlockOf(latex: string): ContentBlock {
  return buildFormulaBlock(latexToFormula(latex, { source: 'test:lint' }).formula, { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 }, 'test:lint');
}

describe('lintMathCoherence', () => {
  it('a package whose stored content is exactly the mechanical re-lowering of its presentation stays silent', () => {
    const pkg = packageOf([mathBlockOf('\\sum_{i=1}^{n} \\frac{1}{i^2}')]);
    expect(lintMathCoherence(pkg)).toEqual([]);
  });

  it('a deliberately edited content layer diverges: a warning carrying provenance, and the stored layers are untouched', () => {
    const block = mathBlockOf('E = mc^2');
    const pkg = packageOf([block]);
    // Someone resolved the mc^2 juxtaposition by hand into an explicit multiplication -- a better reading, stored deliberately next to the unchanged presentation.
    if (block.kind !== 'embeddedObject' || block.document.kind !== 'formula') {
      throw new Error('expected a formula block');
    }
    block.document.formula.content = {
      kind: 'app',
      operator: 'math:eq',
      args: [
        { kind: 'sym', id: 'symbols:E' },
        { kind: 'app', operator: 'math:multiply', args: [{ kind: 'sym', id: 'symbols:m' }, { kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'symbols:c' }, { kind: 'num', numerator: '2', denominator: '1' }] }] },
      ],
    };
    block.document.formula.provenance = { source: 'test:lint', editTrail: ['human edit: resolved the mc^2 juxtaposition into an explicit multiply'] };
    const warnings = lintMathCoherence(pkg);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('math/coherence-divergence');
    expect(warnings[0]?.severity).toBe('warning');
    expect(warnings[0]?.provenance).toBe('test:lint -> human edit: resolved the mc^2 juxtaposition into an explicit multiply');
    expect(warnings[0]?.detail).toContain('E = mc^2');
    // The lint re-derived nothing: the stored content is still the hand-edited tree, byte for byte.
    expect(block.document.formula.content).toEqual({
      kind: 'app',
      operator: 'math:eq',
      args: [
        { kind: 'sym', id: 'symbols:E' },
        { kind: 'app', operator: 'math:multiply', args: [{ kind: 'sym', id: 'symbols:m' }, { kind: 'app', operator: 'math:pow', args: [{ kind: 'sym', id: 'symbols:c' }, { kind: 'num', numerator: '2', denominator: '1' }] }] },
      ],
    });
  });

  it('a stored non-reduced rational still agrees with the reduced re-lowering -- value canonicalisation, not string equality', () => {
    // '\frac{0.5}{2}' re-lowers the decimal to the reduced 1/2; the stored content spells the same value as an unreduced 2/4. Same expression, different spelling -- the lint compares cross-reduced values and stays silent.
    const block = mathBlockOf('\\frac{0.5}{2}');
    if (block.kind !== 'embeddedObject' || block.document.kind !== 'formula') {
      throw new Error('expected a formula block');
    }
    block.document.formula.content = { kind: 'app', operator: 'math:divide', args: [{ kind: 'num', numerator: '2', denominator: '4' }, { kind: 'num', numerator: '2', denominator: '1' }] };
    expect(lintMathCoherence(packageOf([block]))).toEqual([]);
  });

  it('an unparseable stored presentation warns only when the stored content is a real lowering', () => {
    const degraded = mathBlockOf('\\notacommand');
    const pkgDegraded = packageOf([degraded]);
    // Stored content is itself an unparsed root (the lowering degraded too), so this stays silent.
    expect(lintMathCoherence(pkgDegraded)).toEqual([]);
    const edited = mathBlockOf('\\notacommand');
    if (edited.kind !== 'embeddedObject' || edited.document.kind !== 'formula') {
      throw new Error('expected a formula block');
    }
    edited.document.formula.content = { kind: 'sym', id: 'symbols:x' };
    const warnings = lintMathCoherence(packageOf([edited]));
    expect(warnings.map((warning) => warning.code)).toEqual(['math/coherence-unparseable-presentation']);
  });

  it('walks formula blocks inside table cells and skips formulas carrying only one layer', () => {
    const presentationOnly = buildFormulaBlock({ mathml: [], presentation: { latex: 'x^2' } }, { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 }, 'test');
    const pkg = packageOf([
      { kind: 'table', columnWidthsPt: [100], rows: [{ cells: [{ blocks: [mathBlockOf('a + b')] }] }] },
      presentationOnly,
    ]);
    expect(lintMathCoherence(pkg)).toEqual([]);
  });
});
