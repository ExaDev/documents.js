import { describe, expect, it } from 'vitest';
import type { ContentDocument, ContentEmbeddedObject, ContentFormula, ContentRun } from './content';
import {
  DrawPageGroupSchema,
  HeadingGroupSchema,
  isTreeBlockLeaf,
  isTreeGroup,
  isTreeLeaf,
  isTreeNode,
  ListGroupSchema,
  TreeBlockLeafSchema,
  TreeGroupSchema,
  TreeLeafSchema,
  TreeNodeSchema,
  SectionConstructGroupSchema,
  SectionGroupSchema,
  ShapeConstructGroupSchema,
  ShapeGroupSchema,
  SheetGroupSchema,
  SlideGroupSchema,
  type DrawPageGroupNode,
  type HeadingGroupNode,
  type ListGroupNode,
  type TreeNode,
  type SectionConstructGroupNode,
  type SectionGroupNode,
  type ShapeConstructGroupNode,
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
    if (!isTreeGroup(heading) || !('headingLevel' in heading.node)) throw new Error('fixture shape');
    expect(HeadingGroupSchema.safeParse(heading).success).toBe(true);
    const list = section.children[1];
    if (!isTreeGroup(list)) throw new Error('fixture shape');
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
    expect(TreeLeafSchema.safeParse(embeddedObject()).success).toBe(true);
    expect(isTreeLeaf(embeddedObject())).toBe(true);
    expect(isTreeNode(embeddedObject())).toBe(true);
  });

  it('round-trips every kind of tree through JSON and revalidates identically', () => {
    for (const group of [sectionGroup(), slideGroup(), sheetGroup(), drawPageGroup()]) {
      const roundTripped: unknown = JSON.parse(JSON.stringify(group));
      expect(TreeGroupSchema.safeParse(roundTripped).success).toBe(true);
      expect(TreeNodeSchema.safeParse(roundTripped).success).toBe(true);
    }
  });
});

// The construct groups (ExaDev/document-schema.js#24) at every tree position they are legal in, and every position they are not. The 4.0.0 trees above stand unchanged beside these: the kinds are additive, so nothing that parsed before parses differently now.
describe('construct groups wrap block extents wherever block flow runs', () => {
  it('accepts a docx block SDT wrapping a heading group and its body, in a section flow', () => {
    const control: SectionConstructGroupNode = {
      node: { kind: 'contentControl', controlType: 'richText', tag: 'ClientBlock', lock: 'container' },
      children: [
        {
          node: { kind: 'paragraph', headingLevel: 2, runs: [run('Client')] },
          children: [{ kind: 'paragraph', runs: [run('Acme Ltd')] }],
        },
      ],
    };
    expect(SectionConstructGroupSchema.safeParse(control).success).toBe(true);
    const section: SectionGroupNode = {
      node: { kind: 'section', pageSize: PAGE, margins: MARGINS },
      children: [control],
    };
    expect(SectionGroupSchema.safeParse(section).success).toBe(true);
  });

  it("accepts a docx TOC field whose cached result is the extent it contains -- the kind's extent-as-containment shape", () => {
    const field: SectionConstructGroupNode = {
      node: { kind: 'field', instruction: 'TOC \\o "1-3" \\h' },
      children: [
        { kind: 'paragraph', runs: [run('1. Introduction\t3')] },
        { kind: 'paragraph', runs: [run('2. Method\t9')] },
      ],
    };
    expect(SectionConstructGroupSchema.safeParse(field).success).toBe(true);
  });

  it('accepts a point anchor (a footnote marker, no children) and a ranged anchor (a comment extent) side by side', () => {
    const section: SectionGroupNode = {
      node: { kind: 'section', pageSize: PAGE, margins: MARGINS },
      children: [
        { node: { kind: 'anchor', anchorType: 'footnote', name: '1', definition: 'n1' }, children: [] },
        {
          node: { kind: 'anchor', anchorType: 'comment', name: 'c1', definition: 'c1' },
          children: [{ kind: 'paragraph', runs: [run('The commented sentence.')] }],
        },
      ],
    };
    expect(SectionGroupSchema.safeParse(section).success).toBe(true);
  });

  it('accepts nested constructs -- a tracked deletion inside a content control inside a division', () => {
    const division: SectionConstructGroupNode = {
      node: { kind: 'division', name: 'Chapter1', columnCount: 2, protected: true },
      children: [
        {
          node: { kind: 'contentControl', controlType: 'richText', tag: 'Body' },
          children: [
            {
              node: { kind: 'provenance', change: 'deletion', author: 'A. Reviewer', dateIso: '2026-08-18T09:00:00Z' },
              children: [{ kind: 'paragraph', runs: [run('Struck sentence.')] }],
            },
          ],
        },
      ],
    };
    expect(SectionConstructGroupSchema.safeParse(division).success).toBe(true);
    expect(isTreeGroup(division)).toBe(true);
    expect(isTreeNode(division)).toBe(true);
  });

  it("accepts a pptx a:fld and an internal slide-jump link inside a shape's flow", () => {
    const shape: ShapeGroupNode = {
      node: {
        frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 100 },
        insetLeftPt: 0,
        insetTopPt: 0,
        insetRightPt: 0,
        insetBottomPt: 0,
      },
      children: [
        { node: { kind: 'field', instruction: 'slidenum', cachedResult: '7' }, children: [] },
        {
          node: { kind: 'link', target: { kind: 'internal', anchor: 'slide12' } },
          children: [{ kind: 'paragraph', runs: [run('Jump to the summary')] }],
        },
      ],
    };
    expect(ShapeGroupSchema.safeParse(shape).success).toBe(true);
    expect(SlideGroupSchema.safeParse({ node: { kind: 'slide', size: PAGE, notes: '' }, children: [shape] }).success).toBe(
      true,
    );
  });

  it("accepts a construct inside a list item's flow, which admits the shape-scoped variant", () => {
    const bookmark: ShapeConstructGroupNode = {
      node: { kind: 'anchor', anchorType: 'bookmark', name: 'item1' },
      children: [{ kind: 'paragraph', runs: [run('Item detail')] }],
    };
    const list: ListGroupNode = {
      node: { kind: 'paragraph', list: { level: 0 }, runs: [run('Item')] },
      children: [bookmark],
    };
    expect(ListGroupSchema.safeParse(list).success).toBe(true);
    expect(ShapeConstructGroupSchema.safeParse(bookmark).success).toBe(true);
  });

  it('carries a style ref on a construct group, exactly as on every other group wrapper', () => {
    const styled: SectionConstructGroupNode = {
      node: { kind: 'division', name: 'Chapter1' },
      style: 's1',
      children: [],
    };
    expect(SectionConstructGroupSchema.safeParse(styled).success).toBe(true);
  });

  it('round-trips a construct-bearing tree through JSON and revalidates identically', () => {
    const section: SectionGroupNode = {
      node: { kind: 'section', pageSize: PAGE, margins: MARGINS },
      children: [
        {
          node: { kind: 'link', target: { kind: 'external', uri: 'https://example.com' }, title: 'Example' },
          children: [{ kind: 'paragraph', runs: [run('Linked block')] }],
        },
      ],
    };
    const roundTripped: unknown = JSON.parse(JSON.stringify(section));
    expect(SectionGroupSchema.parse(roundTripped)).toEqual(section);
    expect(TreeGroupSchema.safeParse(roundTripped).success).toBe(true);
  });
});

// Pins the ordering invariant in package-node.ts's group guards: each tests its own node payload before walking its children, so at most one arm of a child predicate ever descends. Were a guard to walk first and reject on the node afterwards, every arm would pay for the whole subtree before failing and validating one tree would cost (arms per flow) to the power of its depth -- at the depth below, that is 3^30 predicate calls, so this test fails by timing out rather than by assertion if the order is ever reversed.
describe('validating a deeply nested tree stays linear in its size', () => {
  // Thirty construct groups deep, with the only thing that decides the verdict sitting at the very bottom -- the case that forces the whole subtree to be walked before any answer is possible.
  function nestConstructs(depth: number, innermostLeaf: unknown): unknown {
    let node: unknown = { node: { kind: 'division', name: 'innermost' }, children: [innermostLeaf] };
    for (let level = 0; level < depth; level += 1) {
      node = { node: { kind: 'contentControl', controlType: 'richText' }, children: [node] };
    }
    return node;
  }

  it('accepts a thirty-deep construct chain, and rejects the same chain with an illegal leaf at the bottom', () => {
    expect(SectionConstructGroupSchema.safeParse(nestConstructs(30, { kind: 'paragraph', runs: [run('Leaf')] })).success).toBe(
      true,
    );
    // A style ref on a bare leaf: legal on a group wrapper, never on a leaf, and only discoverable at the deepest level.
    expect(
      SectionConstructGroupSchema.safeParse(nestConstructs(30, { kind: 'paragraph', runs: [run('Leaf')], style: 's1' }))
        .success,
    ).toBe(false);
  });
});

describe('construct groups reject the positions and shapes they are not legal in', () => {
  it("rejects a heading group inside a shape-scoped construct -- a shape's flow carries no heading hierarchy", () => {
    const broken = {
      node: { kind: 'contentControl', controlType: 'richText' },
      children: [{ node: { kind: 'paragraph', headingLevel: 1, runs: [run('H')] }, children: [] }],
    };
    expect(ShapeConstructGroupSchema.safeParse(broken).success).toBe(false);
    expect(SectionConstructGroupSchema.safeParse(broken).success).toBe(true);
  });

  it('rejects a construct group as a direct child of a slide, a sheet, or a drawing page -- those hold containers and leaves, not block flow', () => {
    const construct = { node: { kind: 'anchor', anchorType: 'bookmark', name: 'b1' }, children: [] };
    expect(
      SlideGroupSchema.safeParse({ node: { kind: 'slide', size: PAGE, notes: '' }, children: [construct] }).success,
    ).toBe(false);
    expect(SheetGroupSchema.safeParse({ ...sheetGroup(), children: [construct] }).success).toBe(false);
    expect(DrawPageGroupSchema.safeParse({ node: { kind: 'drawPage', size: PAGE }, children: [construct] }).success).toBe(
      false,
    );
  });

  it('rejects a malformed descriptor at the node position -- an unknown control type does not become a bare wrapper', () => {
    const broken = { node: { kind: 'contentControl', controlType: 'w:sdt' }, children: [] };
    expect(SectionConstructGroupSchema.safeParse(broken).success).toBe(false);
    expect(isTreeGroup(broken)).toBe(false);
  });

  it('rejects a construct group carrying a key outside { node, style, children }', () => {
    const broken = {
      node: { kind: 'division', name: 'Chapter1' },
      residue: '<text:filter-name/>',
      children: [],
    };
    expect(SectionConstructGroupSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a construct descriptor posed as a bare leaf -- a descriptor is a node payload, never a block', () => {
    expect(isTreeLeaf({ kind: 'anchor', anchorType: 'bookmark', name: 'b1' })).toBe(false);
    const section = sectionGroup();
    const withDescriptorLeaf = {
      ...section,
      children: [...section.children, { kind: 'anchor', anchorType: 'bookmark', name: 'b1' }],
    };
    expect(SectionGroupSchema.safeParse(withDescriptorLeaf).success).toBe(false);
  });

  it('rejects a malformed leaf inside a construct extent, so a construct wrapper never launders bad content', () => {
    const broken: unknown = {
      node: { kind: 'provenance', change: 'insertion' },
      children: [{ kind: 'image', format: 'png', base64: 'aGk=', widthPt: 'wide', heightPt: 50 }],
    };
    expect(SectionConstructGroupSchema.safeParse(broken).success).toBe(false);
  });
});

// The flat form's construct boundary markers (src/content.ts) are legal ContentBlocks and illegal tree leaves: a construct is a group in this encoding, and one fact carried in both encodings inside one tree is what breaks decompose(flatten(x)) === x. These are the tests of that exclusion.
describe('construct boundary markers are not tree leaves', () => {
  const openMarker = { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'b1' } };
  const closeMarker = { kind: 'constructEnd' };

  it('rejects either marker at a block-leaf position, whichever flow it sits in', () => {
    for (const marker of [openMarker, closeMarker]) {
      expect(isTreeBlockLeaf(marker)).toBe(false);
      expect(TreeBlockLeafSchema.safeParse(marker).success).toBe(false);
      expect(isTreeLeaf(marker)).toBe(false);
      expect(isTreeNode(marker)).toBe(false);
      expect(
        SectionGroupSchema.safeParse({ node: { kind: 'section', pageSize: PAGE, margins: MARGINS }, children: [marker] })
          .success,
      ).toBe(false);
      expect(
        HeadingGroupSchema.safeParse({
          node: { kind: 'paragraph', headingLevel: 1, runs: [run('H')] },
          children: [marker],
        }).success,
      ).toBe(false);
      expect(
        ListGroupSchema.safeParse({
          node: { kind: 'paragraph', list: { level: 0 }, runs: [run('Item')] },
          children: [marker],
        }).success,
      ).toBe(false);
      expect(
        ShapeGroupSchema.safeParse({
          node: {
            frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
            insetLeftPt: 0,
            insetTopPt: 0,
            insetRightPt: 0,
            insetBottomPt: 0,
          },
          children: [marker],
        }).success,
      ).toBe(false);
    }
  });

  it('rejects a marker inside a construct extent too -- a construct group is where the pair would have been promoted to', () => {
    expect(
      SectionConstructGroupSchema.safeParse({
        node: { kind: 'division', name: 'Chapter1' },
        children: [openMarker, { kind: 'paragraph', runs: [run('Body')] }, closeMarker],
      }).success,
    ).toBe(false);
  });

  it('still accepts every other block kind as a leaf, so the exclusion is the two markers and nothing else', () => {
    for (const leaf of [
      { kind: 'paragraph', runs: [run('Body')] },
      { kind: 'pageBreak' },
      { kind: 'image', format: 'png', base64: 'aGk=', widthPt: 50, heightPt: 50 },
    ]) {
      expect(isTreeBlockLeaf(leaf)).toBe(true);
      expect(isTreeLeaf(leaf)).toBe(true);
    }
  });

  it('accepts a marker pair inside a table cell, the one place the flat encoding survives inside a tree', () => {
    const tableLeaf = {
      kind: 'table',
      rows: [
        {
          cells: [
            {
              blocks: [openMarker, { kind: 'paragraph', runs: [run('Bookmarked cell')] }, closeMarker],
            },
          ],
        },
      ],
      columnWidthsPt: [200],
    };
    expect(isTreeBlockLeaf(tableLeaf)).toBe(true);
    expect(
      SectionGroupSchema.safeParse({
        node: { kind: 'section', pageSize: PAGE, margins: MARGINS },
        children: [tableLeaf],
      }).success,
    ).toBe(true);
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

  it("rejects a group wrapper carrying a key outside { node, style, children }, exactly as the published fragments' additionalProperties: false does", () => {
    const broken = {
      node: { kind: 'section', pageSize: PAGE, margins: MARGINS },
      junkKey: 'x',
      children: [],
    };
    expect(SectionGroupSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a style ref on a bare leaf at a child position, in every leaf family -- refs sit on group wrappers only, so a leaf-position ref fails loudly instead of parsing inert', () => {
    const section = sectionGroup();
    const withLeafRef = {
      ...section,
      children: [...section.children, { kind: 'paragraph', runs: [run('leaf')], style: 's1' }],
    };
    expect(SectionGroupSchema.safeParse(withLeafRef).success).toBe(false);

    const sheet = sheetGroup();
    const sheetImage = sheet.children[0];
    if (sheetImage === undefined || !('format' in sheetImage)) throw new Error('fixture shape');
    const sheetWithLeafRef = { ...sheet, children: [{ ...sheetImage, style: 's1' }] };
    expect(SheetGroupSchema.safeParse(sheetWithLeafRef).success).toBe(false);

    const drawPage = drawPageGroup();
    const vectorWithRef = {
      kind: 'line',
      from: { xPt: 0, yPt: 0 },
      to: { xPt: 10, yPt: 10 },
      stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
      style: 's1',
    };
    expect(DrawPageGroupSchema.safeParse({ ...drawPage, children: [...drawPage.children, vectorWithRef] }).success).toBe(
      false,
    );
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
    expect(isTreeLeaf(section)).toBe(false);
    const paragraph = { kind: 'paragraph', runs: [run('leaf')] } as const;
    expect(isTreeGroup(paragraph)).toBe(false);
    expect(isTreeLeaf(paragraph)).toBe(true);
  });

  it('a heading paragraph is also a legal bare leaf (a valid ContentBlock), while its group wrapper is not a leaf', () => {
    const headingParagraph = { kind: 'paragraph', headingLevel: 1, runs: [run('H')] } as const;
    expect(isTreeLeaf(headingParagraph)).toBe(true);
    const wrapper: TreeNode = { node: { kind: 'paragraph', headingLevel: 1, runs: [run('H')] }, children: [] };
    expect(isTreeGroup(wrapper)).toBe(true);
    expect(isTreeLeaf(wrapper)).toBe(false);
  });
});
