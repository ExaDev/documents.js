import { describe, expect, it } from 'vitest';
import { DocumentPackageSchema, type DocumentPackage } from 'document-schema.js';
import { buildOutline } from './build';
import {
  drawPageGroup,
  drawingPackage,
  embeddedObject,
  formulaPackage,
  headingGroup,
  imageBlock,
  listGroup,
  pageBreak,
  paragraph,
  presentationPackage,
  sectionGroup,
  shapeGroup,
  sheetGroup,
  sheetImage,
  slideGroup,
  spreadsheetPackage,
  table,
  vectorLine,
  vectorRect,
  wordprocessingPackage,
} from '../test-support/fixtures';

// Every per-kind fixture is asserted valid against the canonical schema before its outline is checked, so these tests exercise the builder against real DocumentPackage shapes -- the actual field requirements of document-schema.js 4.0.0 -- not approximations that merely happen to type-check.
function expectSchemaValid(pkg: DocumentPackage): void {
  const result = DocumentPackageSchema.safeParse(pkg);
  expect(result.success ? 'valid' : `invalid: ${JSON.stringify(result.error.issues[0])}`).toBe('valid');
}

describe('wordprocessing outlines', () => {
  it('nests headings deeply with content at each level', () => {
    const lead = paragraph('lead');
    const chapterIntro = paragraph('chapter intro');
    const sectionBody = paragraph('section body');
    const subBody = paragraph('sub body');
    const pkg = wordprocessingPackage([
      sectionGroup([
        lead,
        headingGroup('Chapter', 1, [
          chapterIntro,
          headingGroup('Section', 2, [sectionBody, headingGroup('Subsection', 3, [subBody])]),
        ]),
      ]),
    ]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      lead,
      {
        text: 'Chapter',
        level: 1,
        children: [
          chapterIntro,
          {
            text: 'Section',
            level: 2,
            children: [
              sectionBody,
              { text: 'Subsection', level: 3, children: [subBody] },
            ],
          },
        ],
      },
    ]);
  });

  it('keeps the tree shape when an H4 sits under an H2 with no synthetic intermediates', () => {
    const body = paragraph('body');
    const pkg = wordprocessingPackage([
      sectionGroup([headingGroup('Section', 2, [headingGroup('Deep', 4, [body])])]),
    ]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      { text: 'Section', level: 2, children: [{ text: 'Deep', level: 4, children: [body] }] },
    ]);
  });

  it('pops exactly the deeper group when an H2 follows an H1 and an H3', () => {
    const body = paragraph('body');
    const pkg = wordprocessingPackage([
      sectionGroup([
        headingGroup('Chapter', 1, [headingGroup('Aside', 3, []), headingGroup('Section', 2, [body])]),
      ]),
    ]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      {
        text: 'Chapter',
        level: 1,
        children: [
          { text: 'Aside', level: 3, children: [] },
          { text: 'Section', level: 2, children: [body] },
        ],
      },
    ]);
  });

  it('nests a headingLevel 10 following an H2 as its direct child, level carried verbatim', () => {
    const body = paragraph('body');
    const pkg = wordprocessingPackage([
      sectionGroup([headingGroup('Section', 2, [headingGroup('Unusually deep', 10, [body])])]),
    ]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      { text: 'Section', level: 2, children: [{ text: 'Unusually deep', level: 10, children: [body] }] },
    ]);
  });

  it('pops an H1 after an H3 back to the root across sibling groups', () => {
    const firstBody = paragraph('first body');
    const nestedBody = paragraph('nested body');
    const secondBody = paragraph('second body');
    const pkg = wordprocessingPackage([
      sectionGroup([
        headingGroup('First', 1, [firstBody, headingGroup('Nested', 3, [nestedBody])]),
        headingGroup('Second', 1, [secondBody]),
      ]),
    ]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      {
        text: 'First',
        level: 1,
        children: [
          firstBody,
          { text: 'Nested', level: 3, children: [nestedBody] },
        ],
      },
      { text: 'Second', level: 1, children: [secondBody] },
    ]);
  });

  it('attaches content before any heading at the root', () => {
    const intro = paragraph('intro');
    const body = paragraph('body');
    const pkg = wordprocessingPackage([sectionGroup([intro, headingGroup('Chapter', 1, [body])])]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([intro, { text: 'Chapter', level: 1, children: [body] }]);
  });

  it('leaves a package with no headings flat at the root', () => {
    const body = paragraph('body');
    const cells = table([['a', 'b']]);
    const img = imageBlock('a picture');
    const breakBlock = pageBreak();
    const pkg = wordprocessingPackage([sectionGroup([body, cells, img, breakBlock])]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([body, cells, img, breakBlock]);
  });

  it('nests list levels inside a heading group, including stepping back to a shallower level', () => {
    const tail = paragraph('tail');
    const pkg = wordprocessingPackage([
      sectionGroup([
        headingGroup('Chapter', 1, [
          listGroup('A', 0, [listGroup('B', 1, [listGroup('C', 2, [])]), listGroup('D', 1, [])]),
          tail,
        ]),
      ]),
    ]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      {
        text: 'Chapter',
        level: 1,
        children: [
          {
            text: 'A',
            level: 0,
            children: [
              { text: 'B', level: 1, children: [{ text: 'C', level: 2, children: [] }] },
              { text: 'D', level: 1, children: [] },
            ],
          },
          tail,
        ],
      },
    ]);
  });

  it('nests a level jump directly under the nearest shallower item with no synthetic intermediates', () => {
    const pkg = wordprocessingPackage([sectionGroup([listGroup('A', 0, [listGroup('C', 2, [])])])]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      { text: 'A', level: 0, children: [{ text: 'C', level: 2, children: [] }] },
    ]);
  });

  it('does not group a Heading-styled paragraph that carries no headingLevel', () => {
    const styled = paragraph('styled as a heading', { styleId: 'Heading3' });
    const body = paragraph('body');
    const pkg = wordprocessingPackage([sectionGroup([styled, body])]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([styled, body]);
  });

  it('flows blocks from every section into one tree', () => {
    const firstSectionBody = paragraph('first section body');
    const secondSectionBody = paragraph('second section body');
    const pkg = wordprocessingPackage([
      sectionGroup([headingGroup('Chapter', 1, [firstSectionBody])]),
      sectionGroup([secondSectionBody]),
    ]);
    expectSchemaValid(pkg);
    // The heading stack persists across the section boundary -- the TOC projection's deliberate cross-container lossiness (and exactly why the lossless grouping lives in documents.js, not here).
    expect(buildOutline(pkg)).toEqual([
      {
        text: 'Chapter',
        level: 1,
        children: [firstSectionBody, secondSectionBody],
      },
    ]);
  });

  it('continues heading nesting opened in one section inside the next', () => {
    const pkg = wordprocessingPackage([
      sectionGroup([headingGroup('Chapter', 1, [headingGroup('Section', 2, [])])]),
      sectionGroup([headingGroup('Subsection', 3, [])]),
    ]);
    expectSchemaValid(pkg);
    // The deepest open group at the end of section one is the scope the next section's headings nest into -- stack semantics applied to anchors in pre-order, exactly as they were on flat content before the tree form existed.
    expect(buildOutline(pkg)).toEqual([
      {
        text: 'Chapter',
        level: 1,
        children: [{ text: 'Section', level: 2, children: [{ text: 'Subsection', level: 3, children: [] }] }],
      },
    ]);
  });
});

describe('presentation outlines', () => {
  it('nests mixed list levels under the slide group with non-paragraph blocks attached at the current depth', () => {
    const cells = table([['cell']]);
    const img = imageBlock('a picture');
    const pkg = presentationPackage([
      slideGroup([
        shapeGroup([
          listGroup('A', 0, [cells, listGroup('B', 1, [img])]),
          listGroup('C', 0, []),
        ]),
      ]),
    ]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      {
        text: 'Slide 1',
        level: 1,
        children: [
          {
            text: 'A',
            level: 0,
            children: [cells, { text: 'B', level: 1, children: [img] }],
          },
          { text: 'C', level: 0, children: [] },
        ],
      },
    ]);
  });

  it('keeps a slide with no list levels flat under its group and numbers slides across the document', () => {
    const first = paragraph('first');
    const second = paragraph('second');
    const pkg = presentationPackage([
      slideGroup([shapeGroup([first]), shapeGroup([second])]),
      slideGroup([]),
    ]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      { text: 'Slide 1', level: 1, children: [first, second] },
      { text: 'Slide 2', level: 1, children: [] },
    ]);
  });

  it('projects a heading-styled paragraph leaf flat: headingLevel is not a depth signal in a shape', () => {
    const titleStyled = paragraph('Title', { headingLevel: 1 });
    const pkg = presentationPackage([slideGroup([shapeGroup([titleStyled])])]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([{ text: 'Slide 1', level: 1, children: [titleStyled] }]);
  });
});

describe('spreadsheet outlines', () => {
  it('groups per sheet, with images then embedded objects as leaves and cells absent', () => {
    const chart = sheetImage('a chart');
    const embedded = embeddedObject();
    const pkg = spreadsheetPackage([
      sheetGroup({ name: 'Revenue', images: [chart], embeddedObjects: [embedded] }),
      sheetGroup({ name: 'Notes' }),
    ]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      { text: 'Revenue', level: 1, children: [chart, embedded] },
      { text: 'Notes', level: 1, children: [] },
    ]);
  });
});

describe('drawing outlines', () => {
  it('groups per page with shape contents then vectors as flat leaves', () => {
    const body = paragraph('text box');
    const line = vectorLine();
    const rect = vectorRect();
    const pkg = drawingPackage([
      drawPageGroup([shapeGroup([body]), line, rect]),
      drawPageGroup([]),
    ]);
    expectSchemaValid(pkg);
    expect(buildOutline(pkg)).toEqual([
      { text: 'Page 1', level: 1, children: [body, line, rect] },
      { text: 'Page 2', level: 1, children: [] },
    ]);
  });

  it('flattens list-group anchors inside a shape back to paragraph leaves, pre-order', () => {
    // A drawing outline is flat under its page: list structure inside a text box is not TOC hierarchy, so the anchor paragraphs re-emerge as plain leaves in document order.
    const pkg = drawingPackage([
      drawPageGroup([shapeGroup([listGroup('A', 0, [listGroup('B', 1, [])]), paragraph('tail')])]),
    ]);
    expectSchemaValid(pkg);
    const outline = buildOutline(pkg);
    expect(outline).toHaveLength(1);
    const page = outline[0];
    if (page === undefined || !('children' in page)) throw new Error('expected a group node');
    expect(page.text).toBe('Page 1');
    expect(page.level).toBe(1);
    expect(page.children).toEqual([
      expect.objectContaining({ kind: 'paragraph' }),
      expect.objectContaining({ kind: 'paragraph' }),
      expect.objectContaining({ kind: 'paragraph' }),
    ]);
  });
});

describe('formula outlines', () => {
  it('yields a single node whose leaf is the ContentFormula, labelled by its LaTeX', () => {
    const pkg = formulaPackage('x^2');
    expectSchemaValid(pkg);
    if (pkg.kind !== 'formula') throw new Error('unreachable');
    expect(buildOutline(pkg)).toEqual([{ text: 'x^2', level: 1, children: [pkg.children[0]] }]);
  });

  it('labels the single node with the empty string when no LaTeX is present', () => {
    const pkg = formulaPackage();
    expectSchemaValid(pkg);
    if (pkg.kind !== 'formula') throw new Error('unreachable');
    expect(buildOutline(pkg)).toEqual([{ text: '', level: 1, children: [pkg.children[0]] }]);
  });
});
