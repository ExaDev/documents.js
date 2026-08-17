import { describe, expect, it } from 'vitest';
import { ContentDocumentSchema, type ContentDocument } from 'document-schema.js';
import { buildOutline } from './build';
import {
  drawPage,
  drawingDoc,
  embeddedObject,
  formulaDoc,
  imageBlock,
  pageBreak,
  paragraph,
  presentationDoc,
  sheet,
  sheetImage,
  slide,
  spreadsheetDoc,
  table,
  vectorLine,
  vectorRect,
  wordprocessingDoc,
} from '../test-support/fixtures';

// Every per-kind fixture is asserted valid against the canonical schema before its outline is checked, so these tests exercise the builder against real ContentDocument shapes -- the actual field requirements of document-schema.js 3.3.0 -- not approximations that merely happen to type-check.
function expectSchemaValid(doc: ContentDocument): void {
  const result = ContentDocumentSchema.safeParse(doc);
  expect(result.success ? 'valid' : `invalid: ${JSON.stringify(result.error.issues[0])}`).toBe('valid');
}

describe('wordprocessing outlines', () => {
  it('nests headings deeply with content at each level', () => {
    const lead = paragraph('lead');
    const h1 = paragraph('Chapter', { headingLevel: 1 });
    const chapterIntro = paragraph('chapter intro');
    const h2 = paragraph('Section', { headingLevel: 2 });
    const sectionBody = paragraph('section body');
    const h3 = paragraph('Subsection', { headingLevel: 3 });
    const subBody = paragraph('sub body');
    const doc = wordprocessingDoc([[lead, h1, chapterIntro, h2, sectionBody, h3, subBody]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
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

  it('makes an H4 following an H2 its direct child with no synthetic intermediates', () => {
    const h2 = paragraph('Section', { headingLevel: 2 });
    const h4 = paragraph('Deep', { headingLevel: 4 });
    const body = paragraph('body');
    const doc = wordprocessingDoc([[h2, h4, body]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
      { text: 'Section', level: 2, children: [{ text: 'Deep', level: 4, children: [body] }] },
    ]);
  });

  it('pops exactly the deeper group when an H2 follows an H1 and an H3', () => {
    const h1 = paragraph('Chapter', { headingLevel: 1 });
    const h3 = paragraph('Aside', { headingLevel: 3 });
    const h2 = paragraph('Section', { headingLevel: 2 });
    const body = paragraph('body');
    const doc = wordprocessingDoc([[h1, h3, h2, body]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
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
    const h2 = paragraph('Section', { headingLevel: 2 });
    const h10 = paragraph('Unusually deep', { headingLevel: 10 });
    const body = paragraph('body');
    const doc = wordprocessingDoc([[h2, h10, body]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
      { text: 'Section', level: 2, children: [{ text: 'Unusually deep', level: 10, children: [body] }] },
    ]);
  });

  it('pops an H1 after an H3 back to the root', () => {
    const first = paragraph('First', { headingLevel: 1 });
    const firstBody = paragraph('first body');
    const h3 = paragraph('Nested', { headingLevel: 3 });
    const nestedBody = paragraph('nested body');
    const second = paragraph('Second', { headingLevel: 1 });
    const secondBody = paragraph('second body');
    const doc = wordprocessingDoc([[first, firstBody, h3, nestedBody, second, secondBody]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
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
    const h1 = paragraph('Chapter', { headingLevel: 1 });
    const body = paragraph('body');
    const doc = wordprocessingDoc([[intro, h1, body]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([intro, { text: 'Chapter', level: 1, children: [body] }]);
  });

  it('leaves a document with no headings flat at the root', () => {
    const body = paragraph('body');
    const cells = table([['a', 'b']]);
    const img = imageBlock('a picture');
    const breakBlock = pageBreak();
    const doc = wordprocessingDoc([[body, cells, img, breakBlock]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([body, cells, img, breakBlock]);
  });

  it('nests list levels inside a heading group, including stepping back to a shallower level', () => {
    const h1 = paragraph('Chapter', { headingLevel: 1 });
    const a = paragraph('A', { listLevel: 0 });
    const b = paragraph('B', { listLevel: 1 });
    const c = paragraph('C', { listLevel: 2 });
    const d = paragraph('D', { listLevel: 1 });
    const tail = paragraph('tail');
    const doc = wordprocessingDoc([[h1, a, b, c, d, tail]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
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
    const a = paragraph('A', { listLevel: 0 });
    const c = paragraph('C', { listLevel: 2 });
    const doc = wordprocessingDoc([[a, c]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
      { text: 'A', level: 0, children: [{ text: 'C', level: 2, children: [] }] },
    ]);
  });

  it('does not group a Heading-styled paragraph that carries no headingLevel', () => {
    const styled = paragraph('styled as a heading', { styleId: 'Heading3' });
    const body = paragraph('body');
    const doc = wordprocessingDoc([[styled, body]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([styled, body]);
  });

  it('flows blocks from every section into one tree', () => {
    const h1 = paragraph('Chapter', { headingLevel: 1 });
    const firstSectionBody = paragraph('first section body');
    const secondSectionBody = paragraph('second section body');
    const doc = wordprocessingDoc([[h1, firstSectionBody], [secondSectionBody]]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
      {
        text: 'Chapter',
        level: 1,
        children: [firstSectionBody, secondSectionBody],
      },
    ]);
  });
});

describe('presentation outlines', () => {
  it('nests mixed list levels under the slide group with non-paragraph blocks attached at the current depth', () => {
    const a = paragraph('A', { listLevel: 0 });
    const cells = table([['cell']]);
    const b = paragraph('B', { listLevel: 1 });
    const img = imageBlock('a picture');
    const c = paragraph('C', { listLevel: 0 });
    const doc = presentationDoc([slide([[a, cells, b, img, c]])]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
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
    const doc = presentationDoc([slide([[first], [second]]), slide([[]])]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
      { text: 'Slide 1', level: 1, children: [first, second] },
      { text: 'Slide 2', level: 1, children: [] },
    ]);
  });
});

describe('spreadsheet outlines', () => {
  it('groups per sheet, with images then embedded objects as leaves and cells absent', () => {
    const chart = sheetImage('a chart');
    const embedded = embeddedObject();
    const doc = spreadsheetDoc([
      sheet({ name: 'Revenue', images: [chart], embeddedObjects: [embedded] }),
      sheet({ name: 'Notes' }),
    ]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
      { text: 'Revenue', level: 1, children: [chart, embedded] },
      { text: 'Notes', level: 1, children: [] },
    ]);
  });
});

describe('drawing outlines', () => {
  it('groups per page with shape blocks then vectors as leaves', () => {
    const body = paragraph('text box');
    const line = vectorLine();
    const rect = vectorRect();
    const doc = drawingDoc([drawPage([[body]], [line, rect]), drawPage([], [])]);
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([
      { text: 'Page 1', level: 1, children: [body, line, rect] },
      { text: 'Page 2', level: 1, children: [] },
    ]);
  });
});

describe('formula outlines', () => {
  it('yields a single node whose leaf is the ContentFormula, labelled by its LaTeX', () => {
    const doc = formulaDoc('x^2');
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([{ text: 'x^2', level: 1, children: [doc.formula] }]);
  });

  it('labels the single node with the empty string when no LaTeX is present', () => {
    const doc = formulaDoc();
    expectSchemaValid(doc);
    expect(buildOutline(doc)).toEqual([{ text: '', level: 1, children: [doc.formula] }]);
  });
});
