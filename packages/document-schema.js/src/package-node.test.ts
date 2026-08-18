import { describe, expect, it } from 'vitest';
import type { ContentDocument, ContentEmbeddedObject, ContentFormula, ContentRun } from './content';
import {
  DrawPageGroupSchema,
  HeadingGroupSchema,
  isPackageGroup,
  isPackageLeaf,
  isPackageNode,
  ListGroupSchema,
  PackageGroupSchema,
  PackageLeafSchema,
  PackageNodeSchema,
  SectionGroupSchema,
  ShapeGroupSchema,
  SheetGroupSchema,
  SlideGroupSchema,
  type DrawPageGroupNode,
  type HeadingGroupNode,
  type ListGroupNode,
  type PackageNode,
  type SectionGroupNode,
  type ShapeGroupNode,
  type SheetGroupNode,
  type SlideGroupNode,
} from './package-node';

const PAGE = { widthPt: 612, heightPt: 792 };
const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

function run(text: string, extra: Partial<ContentRun> = {}): ContentRun {
  return { text, ...extra };
}

function formula(): ContentFormula {
  return { mathml: [{ type: 'element', tag: 'math', attributes: [], children: [] }] };
}

function embeddedFormulaDocument(): ContentDocument {
  return { kind: 'formula', metadata: {}, formula: formula() };
}

function embeddedObject(): ContentEmbeddedObject {
  return {
    objectKind: 'formula',
    document: embeddedFormulaDocument(),
    frame: { xPt: 100, yPt: 100, widthPt: 60, heightPt: 20 },
    anchorRow: 1,
    anchorColumn: 2,
    offsetXPt: 4,
    offsetYPt: 5,
  };
}

// A wordprocessing section group exercising every section-child position at once: a heading group with a nested deeper heading, a list group two levels deep, and bare block leaves (a paragraph, a table, an image, a page break) -- plus a style ref on the outer heading, the one place a ref may legally sit.
function sectionGroup(): SectionGroupNode {
  const heading: HeadingGroupNode = {
    node: { kind: 'paragraph', headingLevel: 1, runs: [run('Heading')] },
    children: [
      { kind: 'paragraph', runs: [run('Plain leaf')] },
      {
        kind: 'table',
        rows: [{ cells: [{ blocks: [{ kind: 'paragraph', runs: [run('Cell')] }] }] }],
        columnWidthsPt: [100],
      },
      { kind: 'image', format: 'png', base64: 'aGk=', widthPt: 50, heightPt: 50 },
      { kind: 'pageBreak' },
      {
        node: { kind: 'paragraph', headingLevel: 2, runs: [run('Nested heading')] },
        children: [],
      },
    ],
  };
  const list: ListGroupNode = {
    node: { kind: 'paragraph', list: { level: 0 }, runs: [run('Item')] },
    children: [
      {
        node: { kind: 'paragraph', list: { level: 1 }, runs: [run('Nested item')] },
        children: [],
      },
    ],
  };
  return {
    node: { kind: 'section', pageSize: PAGE, margins: MARGINS },
    children: [heading, list, { kind: 'paragraph', runs: [run('After the lists')] }],
  };
}

function slideGroup(): SlideGroupNode {
  const shape: ShapeGroupNode = {
    node: {
      frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
    },
    children: [
      {
        node: { kind: 'paragraph', list: { level: 0 }, runs: [run('Bullet')] },
        children: [],
      },
      { kind: 'paragraph', runs: [run('Shape body')] },
    ],
  };
  return {
    node: { kind: 'slide', size: { widthPt: 960, heightPt: 540 }, notes: '' },
    children: [shape],
  };
}

function sheetGroup(): SheetGroupNode {
  return {
    node: {
      kind: 'sheet',
      name: 'Sheet1',
      cells: [{ row: 0, column: 0, value: { kind: 'string', value: 'A1' }, displayText: 'A1' }],
      columns: [{ index: 0, widthPt: 64 }],
      rows: [],
      printSettings: {
        pageSize: PAGE,
        margins: MARGINS,
        gridlines: false,
        headers: false,
        pageOrder: 'downThenOver',
      },
    },
    children: [
      {
        kind: 'image',
        format: 'png',
        base64: 'aGk=',
        widthPt: 50,
        heightPt: 50,
        anchorRow: 0,
        anchorColumn: 0,
        offsetXPt: 0,
        offsetYPt: 0,
      },
      embeddedObject(),
    ],
  };
}

function drawPageGroup(): DrawPageGroupNode {
  const shape: ShapeGroupNode = {
    node: {
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
    },
    children: [],
  };
  return {
    node: { kind: 'drawPage', size: PAGE },
    children: [
      shape,
      {
        kind: 'line',
        from: { xPt: 0, yPt: 0 },
        to: { xPt: 10, yPt: 10 },
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
      },
    ],
  };
}

describe('the package tree accepts a real tree of every kind', () => {
  it('validates a wordprocessing section group with heading, list, and leaf children (SectionGroupSchema)', () => {
    expect(SectionGroupSchema.safeParse(sectionGroup()).success).toBe(true);
  });

  it('validates a presentation slide group of shape groups (SlideGroupSchema)', () => {
    expect(SlideGroupSchema.safeParse(slideGroup()).success).toBe(true);
  });

  it('validates a spreadsheet sheet group whose grid rides the node and whose children are images and embedded documents (SheetGroupSchema)', () => {
    expect(SheetGroupSchema.safeParse(sheetGroup()).success).toBe(true);
  });

  it('validates a drawing page group of shape groups and vector leaves (DrawPageGroupSchema)', () => {
    expect(DrawPageGroupSchema.safeParse(drawPageGroup()).success).toBe(true);
  });

  it('validates the individual group schemas against the same trees (HeadingGroup/ListGroup/ShapeGroup)', () => {
    const section = sectionGroup();
    const heading = section.children[0];
    if (!isPackageGroup(heading) || !('headingLevel' in heading.node)) throw new Error('fixture shape');
    expect(HeadingGroupSchema.safeParse(heading).success).toBe(true);
    const list = section.children[1];
    if (!isPackageGroup(list)) throw new Error('fixture shape');
    expect(ListGroupSchema.safeParse(list).success).toBe(true);
    const slide = slideGroup();
    expect(ShapeGroupSchema.safeParse(slide.children[0]).success).toBe(true);
  });

  it('accepts a style ref on every group wrapper position, and a present-but-empty table-free group', () => {
    const styled: SectionGroupNode = {
      node: { kind: 'section', pageSize: PAGE, margins: MARGINS },
      style: 's1',
      children: [
        { node: { kind: 'paragraph', headingLevel: 1, runs: [run('H')] }, style: 's2', children: [] },
      ],
    };
    expect(SectionGroupSchema.safeParse(styled).success).toBe(true);
  });

  it('keeps an embedded document intact as one leaf, recursively through its own ContentDocument', () => {
    expect(PackageLeafSchema.safeParse(embeddedObject()).success).toBe(true);
    expect(isPackageLeaf(embeddedObject())).toBe(true);
    expect(isPackageNode(embeddedObject())).toBe(true);
  });

  it('round-trips every kind of tree through JSON and revalidates identically', () => {
    for (const group of [sectionGroup(), slideGroup(), sheetGroup(), drawPageGroup()]) {
      const roundTripped: unknown = JSON.parse(JSON.stringify(group));
      expect(PackageGroupSchema.safeParse(roundTripped).success).toBe(true);
      expect(PackageNodeSchema.safeParse(roundTripped).success).toBe(true);
    }
  });
});

describe('the package tree rejects near-misses', () => {
  it('rejects a group wrapper with no children array', () => {
    const broken = { node: { kind: 'section', pageSize: PAGE, margins: MARGINS } };
    expect(SectionGroupSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a raw flat container posed as a descriptor -- a section node missing its kind tag', () => {
    const broken = { node: { pageSize: PAGE, margins: MARGINS }, children: [] };
    expect(SectionGroupSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a shape descriptor still carrying its blocks -- the omitted array is banned, not merely absent', () => {
    const broken = {
      node: {
        frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
        blocks: [],
      },
      children: [],
    };
    expect(ShapeGroupSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a slide group with a paragraph leaf child -- a slide holds shape groups only', () => {
    const slide = slideGroup();
    const broken = { ...slide, children: [...slide.children, { kind: 'paragraph', runs: [run('stray')] }] };
    expect(SlideGroupSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a sheet group with a block-flow child -- a sheet holds images and embedded documents only', () => {
    const sheet = sheetGroup();
    const broken = { ...sheet, children: [...sheet.children, { kind: 'paragraph', runs: [run('stray')] }] };
    expect(SheetGroupSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a heading group under a list group -- heading never appears below a list', () => {
    const broken = {
      node: { kind: 'paragraph', list: { level: 0 }, runs: [run('Item')] },
      children: [{ node: { kind: 'paragraph', headingLevel: 1, runs: [run('H')] }, children: [] }],
    };
    expect(ListGroupSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a heading group whose anchor carries no headingLevel, and a list group whose anchor carries no list', () => {
    const notHeading = { node: { kind: 'paragraph', runs: [run('plain')] }, children: [] };
    expect(HeadingGroupSchema.safeParse(notHeading).success).toBe(false);
    const notList = { node: { kind: 'paragraph', runs: [run('plain')] }, children: [] };
    expect(ListGroupSchema.safeParse(notList).success).toBe(false);
  });

  it('rejects a non-string style ref', () => {
    const broken = {
      node: { kind: 'section', pageSize: PAGE, margins: MARGINS },
      style: 7,
      children: [],
    };
    expect(SectionGroupSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a malformed leaf payload at a child position (an image whose width is not a number)', () => {
    const broken = {
      node: { kind: 'section', pageSize: PAGE, margins: MARGINS },
      children: [{ kind: 'image', format: 'png', base64: 'aGk=', widthPt: 'wide', heightPt: 50 }],
    };
    expect(SectionGroupSchema.safeParse(broken).success).toBe(false);
  });

  it('never confuses the two classes: a group does not validate as a leaf, a leaf does not validate as a group', () => {
    const section = sectionGroup();
    expect(isPackageLeaf(section)).toBe(false);
    const paragraph = { kind: 'paragraph', runs: [run('leaf')] } as const;
    expect(isPackageGroup(paragraph)).toBe(false);
    expect(isPackageLeaf(paragraph)).toBe(true);
  });

  it('a heading paragraph is also a legal bare leaf (a valid ContentBlock), while its group wrapper is not a leaf', () => {
    const headingParagraph = { kind: 'paragraph', headingLevel: 1, runs: [run('H')] } as const;
    expect(isPackageLeaf(headingParagraph)).toBe(true);
    const wrapper: PackageNode = { node: { kind: 'paragraph', headingLevel: 1, runs: [run('H')] }, children: [] };
    expect(isPackageGroup(wrapper)).toBe(true);
    expect(isPackageLeaf(wrapper)).toBe(false);
  });
});
