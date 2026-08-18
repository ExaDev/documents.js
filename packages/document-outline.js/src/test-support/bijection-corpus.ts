// The outline-local bijection corpus (document-outline.js cannot import documents.js, so the laws run over fixtures built directly against document-schema.js's own types; documents.js later re-runs the same assertions over its real corpus at the phase-3 promotion gate). Every entry's content is asserted valid against ContentDocumentSchema before its laws run, so a schema change breaks the corpus loudly. Built to cover, at minimum: the recursive embedded-formula arm, multi-section wordprocessing with per-section geometry, a run carrying multiple frames, a slide whose two shapes each carry list-nested paragraphs, a drawing page mixing shapes and vectors, and the empty-document edge where the envelope's kind is the only kind carrier left.
import { DOCUMENT_PACKAGE_FORMAT_VERSION, type ContentDocument, type DocumentPackage, type PageSize } from 'document-schema.js';
import {
  drawPage,
  drawingDoc,
  embeddedFormulaObject,
  embeddedObjectBlock,
  formulaDoc,
  imageBlock,
  layoutFrame,
  minimalSymbolTable,
  pageBreak,
  paragraph,
  presentationDoc,
  section,
  sheet,
  sheetCell,
  sheetImage,
  slide,
  spreadsheetDoc,
  table,
  vectorLine,
  vectorRect,
  wordprocessingDoc,
  wrappedRunParagraph,
} from './fixtures';

export interface CorpusEntry {
  readonly name: string;
  readonly pkg: DocumentPackage;
}

function packageOf(content: ContentDocument, pages?: PageSize[]): DocumentPackage {
  return { formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION, content, ...(pages !== undefined ? { pages } : {}) };
}

const LETTER_SECTION = { widthPt: 612, heightPt: 792 };
const NARROW_MARGINS = { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 };

const multiSectionWordprocessing: ContentDocument = {
  kind: 'wordprocessing',
  formatVersion: 3,
  metadata: { title: 'Bakery notes', author: 'Joseph Mearman', keywords: ['bread', 'sourdough'] },
  symbolTable: minimalSymbolTable(),
  sections: [
    section(
      [
        paragraph('before any heading'),
        paragraph('Ingredients', { headingLevel: 1 }),
        paragraph('flour', { listLevel: 0 }),
        paragraph('water', { listLevel: 1 }),
        paragraph('salt', { listLevel: 2 }),
        paragraph('starter', { listLevel: 1 }),
        paragraph('a plain paragraph closes the list nesting'),
        table([['hydrate', '80%'], ['salt', '2%']]),
      ],
      { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 } },
    ),
    section(
      [
        paragraph('Method', { headingLevel: 2 }),
        paragraph('bulk fermentation', { listLevel: 0 }),
        paragraph('shape', { listLevel: 0 }),
        wrappedRunParagraph('a run whose content wraps across a page boundary', [layoutFrame(0, 72, 90, 450, 12), layoutFrame(1, 72, 60, 450, 8)]),
        imageBlock('the shaped loaf'),
        pageBreak(),
        embeddedObjectBlock(),
      ],
      { pageSize: LETTER_SECTION, margins: NARROW_MARGINS },
    ),
  ],
};

export const corpus: readonly CorpusEntry[] = [
  {
    name: 'multi-section wordprocessing: lists, table, wrapped run, embedded object, symbolTable',
    // pages is populated on this one entry only, to pin that decompose reads a full DocumentPackage (layout geometry present) and never depends on its absence either.
    pkg: packageOf(multiSectionWordprocessing, [{ widthPt: 595, heightPt: 842 }, { widthPt: 612, heightPt: 792 }]),
  },
  {
    name: 'presentation: two shapes per slide with list nesting, notes, and an empty shape',
    pkg: packageOf(
      presentationDoc([
        slide(
          [
            [
              paragraph('shape A top item', { listLevel: 0 }),
              paragraph('shape A nested', { listLevel: 1 }),
              table([['cell']]),
              paragraph('shape A deeper', { listLevel: 2 }),
            ],
            [
              paragraph('shape B plain paragraph'),
              // headingLevel inside a shape is deliberately present and deliberately not a grouping signal: shapes carry list nesting only, and this paragraph must round-trip as a plain leaf carrying the field.
              paragraph('shape B heading-styled', { headingLevel: 2 }),
              paragraph('shape B own list', { listLevel: 0 }),
            ],
          ],
          { notes: 'speaker notes ride the slide descriptor' },
        ),
        slide([[]], { notes: '' }),
      ]),
    ),
  },
  {
    name: 'spreadsheet: cells and image on one sheet, embedded formula and wordprocessing objects on another, a bare third',
    pkg: packageOf(
      spreadsheetDoc([
        sheet({
          name: 'Data',
          cells: [
            sheetCell(0, 0, { kind: 'number', value: 42 }, '42'),
            sheetCell(1, 1, { kind: 'string', value: 'total' }, 'total'),
            sheetCell(2, 0, { kind: 'date', value: '2026-08-17' }, '2026-08-17'),
          ],
          images: [sheetImage('revenue chart')],
        }),
        sheet({ name: 'Model', embeddedObjects: [embeddedFormulaObject()] }),
        sheet({ name: 'Bare' }),
      ]),
    ),
  },
  {
    name: 'drawing: a page with two shapes plus vectors, and a vectors-only page',
    pkg: packageOf(
      drawingDoc([
        drawPage(
          [
            [paragraph('caption item', { listLevel: 0 }), paragraph('caption subitem', { listLevel: 1 })],
            [paragraph('a plain text box')],
          ],
          [vectorLine(), vectorRect()],
        ),
        drawPage([], [vectorLine()]),
      ]),
    ),
  },
  {
    name: 'formula document',
    pkg: packageOf(formulaDoc('E = mc^2')),
  },
  {
    name: 'empty wordprocessing document',
    pkg: packageOf(wordprocessingDoc([])),
  },
  {
    name: 'empty presentation document',
    pkg: packageOf(presentationDoc([])),
  },
];
