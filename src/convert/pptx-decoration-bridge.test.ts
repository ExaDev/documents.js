import type { ContentDocument } from 'document-schema.js';

import { rootElement, type XmlElement } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { buildPptxPackage } from '../edit/pptx/content';
import { buildTextBoxShape, PptxShape } from '../edit/pptx/shape';
import { buildDrawingTable, PptxTableCell } from '../edit/pptx/table';

// Tests for the pptx (DrawingML) decoration setters added to src/edit/pptx/{shape,table,content}.ts: shape name/insets, paragraph spacing/indent, cell background/borders, and the threading of those fields through buildPptxPackage. Lives in src/convert/ alongside bridges.test.ts but is a separate file so the existing bridge suite stays untouched.

function firstParagraphElement(shapeElement: XmlElement): XmlElement {
  const txBody = shapeElement.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'p:txBody');
  if (txBody === undefined) {
    throw new Error('expected a p:txBody child');
  }
  const p = txBody.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'a:p');
  if (p === undefined) {
    throw new Error('expected an a:p child');
  }
  return p;
}

function bodyPrOf(shapeElement: XmlElement): XmlElement {
  const txBody = shapeElement.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'p:txBody');
  if (txBody === undefined) {
    throw new Error('expected a p:txBody child');
  }
  const bodyPr = txBody.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'a:bodyPr');
  if (bodyPr === undefined) {
    throw new Error('expected an a:bodyPr child');
  }
  return bodyPr;
}

function childElement(parent: XmlElement | undefined, tag: string): XmlElement | undefined {
  if (parent === undefined) {
    return undefined;
  }
  const found = parent.children.find((c): c is XmlElement => c.type === 'element' && c.tag === tag);
  return found;
}

describe('PptxShape name', () => {
  it('reads the name written by buildTextBoxShape from p:cNvPr@name', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    expect(shape.name).toBe('TextBox 2');
  });

  it('writes name to p:cNvPr@name and round-trips', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.name = 'Title 1';
    expect(shape.name).toBe('Title 1');
    const nvSpPr = shapeElement.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'p:nvSpPr');
    const cNvPr = childElement(nvSpPr, 'p:cNvPr');
    expect(cNvPr?.attributes).toContainEqual({ name: 'name', value: 'Title 1' });
  });
});

describe('PptxShape insets', () => {
  it('reads insets undefined when a:bodyPr carries no @lIns/@tIns/@rIns/@bIns', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    expect(shape.insetLeftPt).toBeUndefined();
    expect(shape.insetTopPt).toBeUndefined();
    expect(shape.insetRightPt).toBeUndefined();
    expect(shape.insetBottomPt).toBeUndefined();
  });

  it('writes insets to a:bodyPr in EMU and round-trips through points', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.insetLeftPt = 9;
    shape.insetTopPt = 4.5;
    shape.insetRightPt = 9;
    shape.insetBottomPt = 4.5;
    expect(shape.insetLeftPt).toBeCloseTo(9, 6);
    expect(shape.insetTopPt).toBeCloseTo(4.5, 6);
    expect(shape.insetRightPt).toBeCloseTo(9, 6);
    expect(shape.insetBottomPt).toBeCloseTo(4.5, 6);
    const bodyPr = bodyPrOf(shapeElement);
    // 9pt = 9 * 12700 = 114300 EMU; 4.5pt = 57150 EMU.
    expect(bodyPr.attributes).toContainEqual({ name: 'lIns', value: '114300' });
    expect(bodyPr.attributes).toContainEqual({ name: 'tIns', value: '57150' });
    expect(bodyPr.attributes).toContainEqual({ name: 'rIns', value: '114300' });
    expect(bodyPr.attributes).toContainEqual({ name: 'bIns', value: '57150' });
  });

  it('setting an inset to undefined removes the attribute', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.insetLeftPt = 9;
    shape.insetLeftPt = undefined;
    expect(shape.insetLeftPt).toBeUndefined();
    const bodyPr = bodyPrOf(shapeElement);
    expect(bodyPr.attributes.find((a) => a.name === 'lIns')).toBeUndefined();
  });
});

describe('buildDrawingParagraph spacing and indent', () => {
  it('emits a:spcBef/a:spcAft using a:spcPts in hundredths of a point', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.setParagraphs([{ runs: [{ text: 'Spaced' }], spacingBeforePt: 12, spacingAfterPt: 6 }]);
    const pPr = childElement(firstParagraphElement(shapeElement), 'a:pPr');
    const spcBef = childElement(pPr, 'a:spcBef');
    const spcPtsBef = childElement(spcBef, 'a:spcPts');
    expect(spcPtsBef?.attributes).toContainEqual({ name: 'val', value: '1200' });
    const spcAft = childElement(pPr, 'a:spcAft');
    const spcPtsAft = childElement(spcAft, 'a:spcPts');
    expect(spcPtsAft?.attributes).toContainEqual({ name: 'val', value: '600' });
  });

  it('emits a:lnSpc using a:spcPct in thousandths of a percent', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.setParagraphs([{ runs: [{ text: 'Lined' }], lineSpacing: 1.5 }]);
    const pPr = childElement(firstParagraphElement(shapeElement), 'a:pPr');
    const lnSpc = childElement(pPr, 'a:lnSpc');
    const spcPct = childElement(lnSpc, 'a:spcPct');
    expect(spcPct?.attributes).toContainEqual({ name: 'val', value: '150000' });
  });

  it('emits a:pPr@marL and @indent in EMU', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.setParagraphs([{ runs: [{ text: 'Indented' }], indentLeftPt: 36, indentFirstLinePt: -18 }]);
    const pPr = childElement(firstParagraphElement(shapeElement), 'a:pPr');
    // 36pt = 457200 EMU; -18pt = -228600 EMU.
    expect(pPr?.attributes).toContainEqual({ name: 'marL', value: '457200' });
    expect(pPr?.attributes).toContainEqual({ name: 'indent', value: '-228600' });
  });

  it('omits spacing and indent children when none are supplied', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.setParagraphs([{ runs: [{ text: 'Plain' }] }]);
    const pPr = childElement(firstParagraphElement(shapeElement), 'a:pPr');
    expect(pPr).toBeUndefined();
  });
});

describe('PptxTableCell background and borders', () => {
  function firstCellOf(tableElement: XmlElement): PptxTableCell {
    const tr = tableElement.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'a:tr');
    if (tr === undefined) {
      throw new Error('expected an a:tr child');
    }
    const tc = tr.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'a:tc');
    if (tc === undefined) {
      throw new Error('expected an a:tc child');
    }
    return new PptxTableCell(tc);
  }

  function tcPrOf(cell: PptxTableCell): XmlElement | undefined {
    const node = cell.element;
    return node.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'a:tcPr');
  }

  it('reads background as undefined when a:tcPr has no a:solidFill', () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const cell = firstCellOf(tableElement);
    expect(cell.background).toBeUndefined();
  });

  it('writes background to a:tcPr/a:solidFill/a:srgbClr and round-trips', () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const cell = firstCellOf(tableElement);
    cell.background = { r: 1, g: 0, b: 0 };
    expect(cell.background).toEqual({ r: 1, g: 0, b: 0 });
    const tcPr = tcPrOf(cell);
    const solidFill = childElement(tcPr, 'a:solidFill');
    const srgbClr = childElement(solidFill, 'a:srgbClr');
    expect(srgbClr?.attributes).toContainEqual({ name: 'val', value: 'FF0000' });
  });

  it('setting background to undefined removes the a:solidFill', () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const cell = firstCellOf(tableElement);
    cell.background = { r: 0, g: 1, b: 0 };
    cell.background = undefined;
    expect(cell.background).toBeUndefined();
    const tcPr = tcPrOf(cell);
    expect(childElement(tcPr, 'a:solidFill')).toBeUndefined();
  });

  it('writes all four borders as a:lnL/a:lnR/a:lnT/a:lnB children of a:tcPr', () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const cell = firstCellOf(tableElement);
    cell.borders = {
      left: { color: { r: 1, g: 0, b: 0 }, widthPt: 1 },
      right: { color: { r: 0, g: 1, b: 0 }, widthPt: 2 },
      top: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.5 },
      bottom: { color: { r: 0, g: 0, b: 0 }, widthPt: 1.5 },
    };
    const tcPr = tcPrOf(cell);
    const lnL = childElement(tcPr, 'a:lnL');
    const lnR = childElement(tcPr, 'a:lnR');
    const lnT = childElement(tcPr, 'a:lnT');
    const lnB = childElement(tcPr, 'a:lnB');
    // a:ln/@w is in EMU: 1pt = 12700, 2pt = 25400, 0.5pt = 6350, 1.5pt = 19050.
    expect(lnL?.attributes).toContainEqual({ name: 'w', value: '12700' });
    expect(lnR?.attributes).toContainEqual({ name: 'w', value: '25400' });
    expect(lnT?.attributes).toContainEqual({ name: 'w', value: '6350' });
    expect(lnB?.attributes).toContainEqual({ name: 'w', value: '19050' });
    const srgbL = childElement(childElement(lnL, 'a:solidFill'), 'a:srgbClr');
    expect(srgbL?.attributes).toContainEqual({ name: 'val', value: 'FF0000' });
  });

  it('reads borders as undefined when a:tcPr has no a:lnL/a:lnR/a:lnT/a:lnB', () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const cell = firstCellOf(tableElement);
    expect(cell.borders).toBeUndefined();
  });

  it('setting borders to undefined removes all four a:ln* children', () => {
    const tableElement = buildDrawingTable({ rows: 1, columns: 1 });
    const cell = firstCellOf(tableElement);
    cell.borders = {
      left: { color: { r: 1, g: 0, b: 0 }, widthPt: 1 },
      right: { color: { r: 1, g: 0, b: 0 }, widthPt: 1 },
      top: { color: { r: 1, g: 0, b: 0 }, widthPt: 1 },
      bottom: { color: { r: 1, g: 0, b: 0 }, widthPt: 1 },
    };
    cell.borders = undefined;
    expect(cell.borders).toBeUndefined();
    const tcPr = tcPrOf(cell);
    expect(childElement(tcPr, 'a:lnL')).toBeUndefined();
    expect(childElement(tcPr, 'a:lnR')).toBeUndefined();
    expect(childElement(tcPr, 'a:lnT')).toBeUndefined();
    expect(childElement(tcPr, 'a:lnB')).toBeUndefined();
  });
});

describe('buildPptxPackage threading', () => {
  function presentationOf(content: ContentDocument): XmlElement {
    const pkg = buildPptxPackage(content);
    const part = pkg.parts['ppt/slides/slide1.xml'];
    if (part === undefined) {
      throw new Error('expected slide1 part');
    }
    const root = rootElement(part);
    if (root === undefined) {
      throw new Error('expected root element');
    }
    return root;
  }

  function spTreeOf(slideRoot: XmlElement): XmlElement {
    const cSld = slideRoot.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'p:cSld');
    const spTree = childElement(cSld, 'p:spTree');
    if (spTree === undefined) {
      throw new Error('expected p:spTree');
    }
    return spTree;
  }

  it('threads shape name through to p:cNvPr@name', () => {
    const content: ContentDocument = {
      kind: 'presentation',
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          shapes: [
            {
              name: 'Title 1',
              frame: { xPt: 40, yPt: 30, widthPt: 600, heightPt: 80 },
              insetLeftPt: 9,
              insetTopPt: 4.5,
              insetRightPt: 9,
              insetBottomPt: 4.5,
              blocks: [{ kind: 'paragraph', runs: [{ text: 'Hi' }] }],
            },
          ],
          notes: '',
        },
      ],
    };
    const slideRoot = presentationOf(content);
    const spTree = spTreeOf(slideRoot);
    const sp = spTree.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'p:sp');
    const nvSpPr = childElement(sp, 'p:nvSpPr');
    const cNvPr = childElement(nvSpPr, 'p:cNvPr');
    expect(cNvPr?.attributes).toContainEqual({ name: 'name', value: 'Title 1' });
  });

  it('threads shape insets through to a:bodyPr in EMU', () => {
    const content: ContentDocument = {
      kind: 'presentation',
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          shapes: [
            {
              frame: { xPt: 40, yPt: 30, widthPt: 600, heightPt: 80 },
              insetLeftPt: 9,
              insetTopPt: 4.5,
              insetRightPt: 9,
              insetBottomPt: 4.5,
              blocks: [{ kind: 'paragraph', runs: [{ text: 'Hi' }] }],
            },
          ],
          notes: '',
        },
      ],
    };
    const slideRoot = presentationOf(content);
    const spTree = spTreeOf(slideRoot);
    const sp = spTree.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'p:sp');
    const txBody = childElement(sp, 'p:txBody');
    const bodyPr = childElement(txBody, 'a:bodyPr');
    expect(bodyPr?.attributes).toContainEqual({ name: 'lIns', value: '114300' });
    expect(bodyPr?.attributes).toContainEqual({ name: 'tIns', value: '57150' });
    expect(bodyPr?.attributes).toContainEqual({ name: 'rIns', value: '114300' });
    expect(bodyPr?.attributes).toContainEqual({ name: 'bIns', value: '57150' });
  });

  it('threads paragraph spacing/indent through to a:pPr', () => {
    const content: ContentDocument = {
      kind: 'presentation',
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          shapes: [
            {
              frame: { xPt: 40, yPt: 30, widthPt: 600, heightPt: 80 },
              insetLeftPt: 9,
              insetTopPt: 4.5,
              insetRightPt: 9,
              insetBottomPt: 4.5,
              blocks: [
                {
                  kind: 'paragraph',
                  runs: [{ text: 'Spaced' }],
                  spacingBeforePt: 12,
                  spacingAfterPt: 6,
                  lineSpacing: 1.5,
                  indentLeftPt: 36,
                  indentFirstLinePt: -18,
                },
              ],
            },
          ],
          notes: '',
        },
      ],
    };
    const slideRoot = presentationOf(content);
    const spTree = spTreeOf(slideRoot);
    const sp = spTree.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'p:sp');
    const txBody = childElement(sp, 'p:txBody');
    const p = txBody?.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'a:p');
    const pPr = childElement(p, 'a:pPr');
    const spcBef = childElement(pPr, 'a:spcBef');
    expect(childElement(spcBef, 'a:spcPts')?.attributes).toContainEqual({ name: 'val', value: '1200' });
    const spcAft = childElement(pPr, 'a:spcAft');
    expect(childElement(spcAft, 'a:spcPts')?.attributes).toContainEqual({ name: 'val', value: '600' });
    const lnSpc = childElement(pPr, 'a:lnSpc');
    expect(childElement(lnSpc, 'a:spcPct')?.attributes).toContainEqual({ name: 'val', value: '150000' });
    expect(pPr?.attributes).toContainEqual({ name: 'marL', value: '457200' });
    expect(pPr?.attributes).toContainEqual({ name: 'indent', value: '-228600' });
  });

  it('threads cell background and borders through to a:tcPr', () => {
    const content: ContentDocument = {
      kind: 'presentation',
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          shapes: [
            {
              frame: { xPt: 40, yPt: 30, widthPt: 600, heightPt: 80 },
              insetLeftPt: 9,
              insetTopPt: 4.5,
              insetRightPt: 9,
              insetBottomPt: 4.5,
              blocks: [
                {
                  kind: 'table',
                  columnWidthsPt: [100, 100],
                  rows: [
                    {
                      cells: [
                        {
                          background: { r: 1, g: 0, b: 0 },
                          borders: {
                            left: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
                            right: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
                            top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
                            bottom: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
                          },
                          blocks: [{ kind: 'paragraph', runs: [{ text: 'A' }] }],
                        },
                        { blocks: [{ kind: 'paragraph', runs: [{ text: 'B' }] }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          notes: '',
        },
      ],
    };
    const slideRoot = presentationOf(content);
    const spTree = spTreeOf(slideRoot);
    const graphicFrame = spTree.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'p:graphicFrame');
    const graphic = childElement(graphicFrame, 'a:graphic');
    const graphicData = childElement(graphic, 'a:graphicData');
    const tbl = childElement(graphicData, 'a:tbl');
    const tr = childElement(tbl, 'a:tr');
    const tc = tr?.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'a:tc');
    const tcPr = childElement(tc, 'a:tcPr');
    const solidFill = childElement(tcPr, 'a:solidFill');
    expect(childElement(solidFill, 'a:srgbClr')?.attributes).toContainEqual({ name: 'val', value: 'FF0000' });
    expect(childElement(tcPr, 'a:lnL')?.attributes).toContainEqual({ name: 'w', value: '12700' });
    expect(childElement(tcPr, 'a:lnR')?.attributes).toContainEqual({ name: 'w', value: '12700' });
    expect(childElement(tcPr, 'a:lnT')?.attributes).toContainEqual({ name: 'w', value: '12700' });
    expect(childElement(tcPr, 'a:lnB')?.attributes).toContainEqual({ name: 'w', value: '12700' });
  });
});
