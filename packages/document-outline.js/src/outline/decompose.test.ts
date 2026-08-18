import { describe, expect, it } from 'vitest';
import { DOCUMENT_PACKAGE_FORMAT_VERSION, type ContentDocument, type DocumentPackage } from 'document-schema.js';
import { decompose } from './decompose';
import { flatten } from './flatten';
import { isSlideGroup } from './package-node';
import {
  drawPage,
  drawingDoc,
  embeddedFormulaObject,
  embeddedObjectBlock,
  formulaDoc,
  imageBlock,
  paragraph,
  presentationDoc,
  sheet,
  sheetCell,
  sheetImage,
  slide,
  spreadsheetDoc,
  table,
  vectorLine,
  vectorRect,
  wordprocessingDoc,
} from '../test-support/fixtures';

// The bijection laws pin round-trip fidelity, not grouping semantics -- a degenerate decompose whose section groups carried flat, ungrouped children would satisfy all three laws just as well. These tests pin the TREE SHAPE itself: mandatory section groups, per-container stacks, the never-cross-a-shape-boundary rule, and flatten's fail-loud envelope matching.
function wrap(content: ContentDocument): DocumentPackage {
  return { formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content };
}

describe('wordprocessing decomposition', () => {
  it('makes one section group per section, carrying the section geometry on the descriptor', () => {
    const doc = wordprocessingDoc([[paragraph('first')], [paragraph('second')]]);
    expect(decompose(wrap(doc))).toEqual([
      {
        node: { kind: 'section', pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } },
        children: [paragraph('first')],
      },
      {
        node: { kind: 'section', pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } },
        children: [paragraph('second')],
      },
    ]);
  });

  it('resets the heading stack at each section boundary instead of flowing sections into one tree', () => {
    const doc = wordprocessingDoc([
      [paragraph('Chapter', { headingLevel: 1 }), paragraph('section one body')],
      [paragraph('Method', { headingLevel: 2 }), paragraph('section two body')],
    ]);
    const [first, second] = decompose(wrap(doc));
    // An H2 directly at a section root is the observable difference from buildOutline's cross-section TOC tree, where the same H2 would nest under the still-open H1 of the previous section: decompose groups per container, so each section starts with an empty stack.
    expect(second).toEqual({
      node: { kind: 'section', pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } },
      children: [{ node: paragraph('Method', { headingLevel: 2 }), children: [paragraph('section two body')] }],
    });
    expect(first).toEqual({
      node: { kind: 'section', pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } },
      children: [{ node: paragraph('Chapter', { headingLevel: 1 }), children: [paragraph('section one body')] }],
    });
  });

  it('nests headings, lists, and leaves with the same stack semantics as the outline builder', () => {
    const h1 = paragraph('Chapter', { headingLevel: 1 });
    const a = paragraph('A', { listLevel: 0 });
    const b = paragraph('B', { listLevel: 1 });
    const plain = paragraph('plain closes the list');
    const cells = table([['x']]);
    const img = imageBlock('captioned');
    const h4 = paragraph('Deep', { headingLevel: 4 });
    const doc = wordprocessingDoc([[h1, a, b, cells, plain, img, h4]]);
    expect(decompose(wrap(doc))).toEqual([
      {
        node: { kind: 'section', pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } },
        children: [
          {
            node: h1,
            children: [
              { node: a, children: [{ node: b, children: [cells] }] },
              plain,
              img,
              // An H4 with no open heading shallower than 4 attaches flat under the heading scope (its own group with the H1 still open above it), the builder's pop rule verbatim.
              { node: h4, children: [] },
            ],
          },
        ],
      },
    ]);
  });

  it('keeps embedded-object blocks intact as leaves of the block flow', () => {
    const embedded = embeddedObjectBlock();
    const doc = wordprocessingDoc([[embedded]]);
    expect(decompose(wrap(doc))).toEqual([
      {
        node: { kind: 'section', pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } },
        children: [embedded],
      },
    ]);
  });
});

describe('presentation decomposition', () => {
  it('groups per slide, then per shape, with list nesting inside each shape and no crossing between shapes', () => {
    const aTop = paragraph('A top', { listLevel: 0 });
    const aNested = paragraph('A nested', { listLevel: 1 });
    const bPlain = paragraph('B plain');
    const bTop = paragraph('B top', { listLevel: 0 });
    const headingStyled = paragraph('B heading-styled', { headingLevel: 2 });
    const doc = presentationDoc([slide([[aTop, aNested], [bPlain, headingStyled, bTop]], { notes: 'notes' })]);
    const [slideGroup] = decompose(wrap(doc));
    if (slideGroup === undefined || !isSlideGroup(slideGroup)) throw new Error('expected a slide group');
    expect(slideGroup.node).toEqual({ kind: 'slide', size: { widthPt: 960, heightPt: 540 }, notes: 'notes' });
    expect(slideGroup.children).toEqual([
      {
        node: { frame: { xPt: 0, yPt: 0, widthPt: 600, heightPt: 400 }, insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 },
        children: [{ node: aTop, children: [{ node: aNested, children: [] }] }],
      },
      {
        node: { frame: { xPt: 0, yPt: 0, widthPt: 600, heightPt: 400 }, insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 },
        // headingLevel is not a depth signal in a shape: the heading-styled paragraph is a plain leaf, and B's list opens fresh at the shape root rather than nesting under shape A's last item.
        children: [bPlain, headingStyled, { node: bTop, children: [] }],
      },
    ]);
  });
});

describe('spreadsheet decomposition', () => {
  it('rides the grid on the sheet descriptor and lists images then embedded objects as children', () => {
    const chart = sheetImage('a chart');
    const formula = embeddedFormulaObject();
    const cells = [sheetCell(0, 0, { kind: 'number', value: 1 }, '1')];
    const doc = spreadsheetDoc([sheet({ name: 'Data', cells, images: [chart] }), sheet({ name: 'Model', embeddedObjects: [formula] })]);
    expect(decompose(wrap(doc))).toEqual([
      {
        node: { kind: 'sheet', name: 'Data', cells, columns: [{ index: 0, widthPt: 80 }], rows: [{ index: 0, heightPt: 20 }], printSettings: { pageSize: { widthPt: 842, heightPt: 595 }, margins: { topPt: 40, rightPt: 40, bottomPt: 40, leftPt: 40 }, gridlines: false, headers: false, pageOrder: 'downThenOver' } },
        children: [chart],
      },
      {
        node: { kind: 'sheet', name: 'Model', cells: [], columns: [{ index: 0, widthPt: 80 }], rows: [{ index: 0, heightPt: 20 }], printSettings: { pageSize: { widthPt: 842, heightPt: 595 }, margins: { topPt: 40, rightPt: 40, bottomPt: 40, leftPt: 40 }, gridlines: false, headers: false, pageOrder: 'downThenOver' } },
        children: [formula],
      },
    ]);
  });
});

describe('drawing decomposition', () => {
  it('groups per page with shape groups then vector leaves', () => {
    const item = paragraph('caption', { listLevel: 0 });
    const line = vectorLine();
    const rect = vectorRect();
    const doc = drawingDoc([drawPage([[item]], [line, rect])]);
    expect(decompose(wrap(doc))).toEqual([
      {
        node: { kind: 'drawPage', size: { widthPt: 960, heightPt: 540 } },
        children: [
          {
            node: { frame: { xPt: 0, yPt: 0, widthPt: 600, heightPt: 400 }, insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 },
            children: [{ node: item, children: [] }],
          },
          line,
          rect,
        ],
      },
    ]);
  });
});

describe('formula decomposition', () => {
  it('is the single ContentFormula node, with no container group around it', () => {
    const doc = formulaDoc('x^2');
    expect(decompose(wrap(doc))).toEqual([doc.formula]);
  });
});

describe('flatten envelope matching', () => {
  it('throws when the roots do not match the envelope kind', () => {
    const presentation = presentationDoc([slide([[paragraph('A', { listLevel: 0 })]])]);
    const tree = decompose(wrap(presentation));
    expect(() => flatten(tree, { kind: 'wordprocessing', metadata: {} })).toThrow('section groups only');
    const formulaTree = decompose(wrap(formulaDoc('x')));
    expect(() => flatten(formulaTree, { kind: 'wordprocessing', metadata: {} })).toThrow('section groups only');
    expect(() => flatten([], { kind: 'formula', metadata: {} })).toThrow('exactly one ContentFormula');
  });

  it('rebuilds an absent embeddedObjects field as absent, not as an empty array', () => {
    const doc = spreadsheetDoc([sheet({ name: 'Bare' })]);
    const flat = flatten(decompose(wrap(doc)), { kind: 'spreadsheet', metadata: {} });
    if (flat.kind !== 'spreadsheet') throw new Error('expected a spreadsheet back');
    const [bare] = flat.sheets;
    if (bare === undefined) throw new Error('expected one sheet back');
    expect('embeddedObjects' in bare).toBe(false);
  });
});
