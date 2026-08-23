import { describe, expect, it } from 'vitest';
import { DocumentTreeSchema, type DocumentTree, type StylesTable } from 'document-schema.js';
import { effectivePackage } from './effective';
import {
  drawPageGroup,
  drawingPackage,
  formulaPackage,
  headingGroup,
  listGroup,
  paragraph,
  presentationPackage,
  sectionConstructGroup,
  sectionGroup,
  shapeConstructGroup,
  shapeGroup,
  sheetGroup,
  sheetImage,
  slideGroup,
  spreadsheetPackage,
  table,
  vectorLine,
  wordprocessingPackage,
} from '../test-support/fixtures';

// 'outer' carries both halves (paragraph geometry + run weight); 'inner' carries a paragraph half that conflicts with outer's on indentLeftPt -- enough surface to prove gap-filling, own-property precedence, nearest-wins overlay, and the run half with one table.
const styles: StylesTable = {
  outer: { paragraph: { indentLeftPt: 24 }, run: { bold: true } },
  inner: { paragraph: { indentLeftPt: 48 } },
};

function expectSchemaValid(pkg: DocumentTree, label: string): void {
  const result = DocumentTreeSchema.safeParse(pkg);
  expect(result.success ? 'valid' : `invalid (${label}): ${JSON.stringify(result.error.issues[0])}`).toBe('valid');
}

// Narrows a children element to a group (the walk never returns a leaf at a group position, but the array element type is the whole child union).
function asGroup(child: unknown): asserts child is { node: unknown; children: unknown[] } {
  if (typeof child !== 'object' || child === null || !('node' in child) || !('children' in child)) throw new Error('expected a group node');
}

describe('effectivePackage', () => {
  it('returns a styles-free package as the same object', () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph('body')])]);
    expect(effectivePackage(pkg)).toBe(pkg);
  });

  it('drops an unreferenced styles table without touching the tree', () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph('body')])], { styles });
    const resolved = effectivePackage(pkg);
    expect(resolved.styles).toBeUndefined();
    // No group referenced the table, so every child object is shared, not rebuilt.
    expect(resolved.children[0]).toBe(pkg.children[0]);
  });

  it('fills property gaps on a heading anchor and its subtree, own properties winning', () => {
    const factored = wordprocessingPackage(
      [sectionGroup([headingGroup('Chapter', 1, [paragraph('plain'), paragraph('own', { indentLeftPt: 12 })], { style: 'outer' })])],
      { styles },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, 'resolved');
    // The styles table is consumed along with every ref, and both halves of the entry landed: paragraph gaps filled (indentLeftPt), run gaps filled (bold), own direct values preserved (the 12).
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: { kind: 'paragraph', runs: [{ text: 'Chapter', bold: true }], headingLevel: 1, indentLeftPt: 24 },
            children: [
              { kind: 'paragraph', runs: [{ text: 'plain', bold: true }], indentLeftPt: 24 },
              { kind: 'paragraph', runs: [{ text: 'own', bold: true }], indentLeftPt: 12 },
            ],
          },
        ]),
      ]),
    );
  });

  it('overlays nested refs nearest-wins while merging non-conflicting properties', () => {
    const factored = wordprocessingPackage(
      [sectionGroup([listGroup('A', 0, [paragraph('body')], { style: 'inner' })], { style: 'outer' })],
      { styles },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, 'resolved');
    // The chain is [outer, inner]: inner (nearest) wins the indent conflict at 48; outer still contributes what inner does not name (the run half). Both the list anchor and its subtree paragraph resolve against the same chain.
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: { kind: 'paragraph', runs: [{ text: 'A', bold: true }], list: { level: 0 }, indentLeftPt: 48 },
            children: [{ kind: 'paragraph', runs: [{ text: 'body', bold: true }], indentLeftPt: 48 }],
          },
        ]),
      ]),
    );
  });

  it('applies the run half alone when the entry names no paragraph properties', () => {
    const runOnly: StylesTable = { title: { run: { fontFamily: 'Test Serif' } } };
    const factored = wordprocessingPackage([sectionGroup([headingGroup('Chapter', 1, [], { style: 'title' })])], {
      styles: runOnly,
    });
    expect(effectivePackage(factored)).toEqual(
      wordprocessingPackage([
        sectionGroup([
          {
            node: { kind: 'paragraph', runs: [{ text: 'Chapter', fontFamily: 'Test Serif' }], headingLevel: 1 },
            children: [],
          },
        ]),
      ]),
    );
  });

  it('threads a section construct group\'s own ref down to its subtree, same as a heading group\'s', () => {
    const factored = wordprocessingPackage(
      [sectionGroup([sectionConstructGroup([paragraph('inside')], { style: 'outer' })])],
      { styles },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, 'resolved');
    expect(resolved).toEqual(
      wordprocessingPackage([
        sectionGroup([{ node: { kind: 'contentControl', controlType: 'richText' }, children: [{ kind: 'paragraph', runs: [{ text: 'inside', bold: true }], indentLeftPt: 24 }] }]),
      ]),
    );
  });

  it('threads a shape construct group\'s own ref down to its subtree, same as a shape group\'s', () => {
    const factored = presentationPackage(
      [slideGroup([shapeGroup([shapeConstructGroup([paragraph('inside')], { style: 'outer' })])])],
      { styles },
    );
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, 'presentation resolved');
    asGroup(resolved.children[0]!);
    asGroup(resolved.children[0].children[0]!);
    expect(resolved.children[0].children[0].children[0]).toEqual({
      node: { kind: 'contentControl', controlType: 'richText' },
      children: [{ kind: 'paragraph', runs: [{ text: 'inside', bold: true }], indentLeftPt: 24 }],
    });
  });

  it('does not rewrite leaf-local payload: table cell paragraphs pass through untouched', () => {
    const cells = table([['cell']]);
    const pkg = wordprocessingPackage([sectionGroup([cells], { style: 'outer' })], { styles });
    const resolved = effectivePackage(pkg);
    expectSchemaValid(resolved, 'resolved');
    asGroup(resolved.children[0]!);
    // The table is the very same object: a table's cell paragraphs are the table's own payload, and style entries carry block-flow properties only.
    expect(resolved.children[0].children[0]).toBe(cells);
  });

  it('resolves through the presentation shape chain', () => {
    const factored = presentationPackage([slideGroup([shapeGroup([paragraph('body')], { style: 'outer' })])], { styles });
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, 'presentation resolved');
    asGroup(resolved.children[0]!);
    asGroup(resolved.children[0].children[0]!);
    expect(resolved.children[0].children[0].children[0]).toEqual({
      kind: 'paragraph',
      runs: [{ text: 'body', bold: true }],
      indentLeftPt: 24,
    });
  });

  it('resolves through the drawing shape chain and leaves vector leaves untouched', () => {
    const line = vectorLine();
    const factored = drawingPackage([drawPageGroup([shapeGroup([paragraph('body')], { style: 'outer' }), line])], {
      styles,
    });
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, 'drawing resolved');
    asGroup(resolved.children[0]!);
    asGroup(resolved.children[0].children[0]!);
    expect(resolved.children[0].children[0].children[0]).toEqual({
      kind: 'paragraph',
      runs: [{ text: 'body', bold: true }],
      indentLeftPt: 24,
    });
    expect(resolved.children[0].children[1]).toBe(line);
  });

  it('consumes a spreadsheet sheet group ref, its image children passing through as the same objects', () => {
    const chart = sheetImage('a chart');
    const factored = spreadsheetPackage([sheetGroup({ name: 'Revenue', images: [chart], style: 'outer' })], { styles });
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, 'spreadsheet resolved');
    asGroup(resolved.children[0]!);
    expect(resolved.children[0].children[0]).toBe(chart);
  });

  it('drops a formula package styles table, the ContentFormula child untouched', () => {
    const bare = formulaPackage('x^2');
    const pkg: DocumentTree = { ...bare, styles: {} };
    expect(effectivePackage(pkg)).toEqual(bare);
  });

  it('throws loudly on a ref the styles table does not carry', () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph('body')], { style: 'missing' })], { styles });
    expect(() => effectivePackage(pkg)).toThrowError(/missing/);
  });

  it('law ii: the resolved factored tree deep-equals its unfactored twin', () => {
    const factored = wordprocessingPackage(
      [sectionGroup([headingGroup('Chapter', 1, [paragraph('body')], { style: 'outer' })])],
      { styles },
    );
    const twin = wordprocessingPackage([
      sectionGroup([
        {
          node: { kind: 'paragraph', runs: [{ text: 'Chapter', bold: true }], headingLevel: 1, indentLeftPt: 24 },
          children: [{ kind: 'paragraph', runs: [{ text: 'body', bold: true }], indentLeftPt: 24 }],
        },
      ]),
    ]);
    const resolved = effectivePackage(factored);
    expectSchemaValid(resolved, 'resolved');
    expect(resolved).toEqual(twin);
  });
});
