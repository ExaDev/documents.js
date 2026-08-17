// Fixture builders for every ContentDocument kind, shaped against the real document-schema 3.3.0 field requirements -- every builder's output is asserted to pass ContentDocumentSchema.parse in the tests that use it, so a schema change in document-schema breaks these fixtures loudly instead of silently testing against a shape that no longer exists. Never imported by src/index.ts and never reaching dist/ -- test-only, mirroring the family's test-support convention.
import type {
  ContentBlock,
  ContentDocument,
  ContentDrawPage,
  ContentEmbeddedObject,
  ContentRun,
  ContentSection,
  ContentShape,
  ContentSheet,
  ContentSheetImage,
  ContentSlide,
  ContentVector,
} from 'document-schema';

export function textRun(text: string): ContentRun {
  return { text };
}

interface ParagraphOptions {
  headingLevel?: number;
  listLevel?: number;
  styleId?: string;
}

export function paragraph(text: string, options: ParagraphOptions = {}): ContentBlock {
  return {
    kind: 'paragraph',
    runs: [textRun(text)],
    ...(options.headingLevel !== undefined ? { headingLevel: options.headingLevel } : {}),
    // numId omitted deliberately on list paragraphs: since schema 3.3.0 it is optional, and OOXML drawing paragraphs carry only a level -- exactly the slide-body shape the presentation outline nests by.
    ...(options.listLevel !== undefined ? { list: { level: options.listLevel } } : {}),
    ...(options.styleId !== undefined ? { styleId: options.styleId } : {}),
  };
}

export function table(rows: string[][]): ContentBlock {
  return {
    kind: 'table',
    rows: rows.map((cells) => ({
      cells: cells.map((text) => ({ blocks: [paragraph(text)] })),
    })),
    columnWidthsPt: rows[0]?.map(() => 80) ?? [],
  };
}

export function imageBlock(altText?: string): ContentBlock {
  return {
    kind: 'image',
    format: 'png',
    base64: 'aW1hZ2U=',
    widthPt: 100,
    heightPt: 60,
    ...(altText !== undefined ? { altText } : {}),
  };
}

export function pageBreak(): ContentBlock {
  return { kind: 'pageBreak' };
}

const PAGE_SIZE_A4_SECTION = { widthPt: 595, heightPt: 842 };
const MARGINS_A4_SECTION = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

export function section(blocks: ContentBlock[]): ContentSection {
  return {
    pageSize: PAGE_SIZE_A4_SECTION,
    margins: MARGINS_A4_SECTION,
    blocks,
  };
}

export function wordprocessingDoc(blocksPerSection: ContentBlock[][]): ContentDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: 3,
    metadata: {},
    sections: blocksPerSection.map(section),
  };
}

export function shape(blocks: ContentBlock[]): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 600, heightPt: 400 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks,
  };
}

export function slide(blocksPerShape: ContentBlock[][]): ContentSlide {
  return {
    size: { widthPt: 960, heightPt: 540 },
    shapes: blocksPerShape.map(shape),
    notes: '',
  };
}

export function presentationDoc(slides: ContentSlide[]): ContentDocument {
  return {
    kind: 'presentation',
    formatVersion: 3,
    metadata: {},
    slides,
  };
}

export function sheetImage(altText?: string): ContentSheetImage {
  return {
    kind: 'image',
    format: 'jpeg',
    base64: 'c2hlZXQtaW1hZ2U=',
    widthPt: 200,
    heightPt: 120,
    ...(altText !== undefined ? { altText } : {}),
    anchorRow: 0,
    anchorColumn: 1,
    offsetXPt: 4,
    offsetYPt: 4,
  };
}

export function embeddedObject(): ContentEmbeddedObject {
  return {
    objectKind: 'wordprocessing',
    frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 200 },
    document: wordprocessingDoc([[paragraph('embedded document body')]]),
  };
}

export interface SheetOptions {
  name: string;
  images?: ContentSheetImage[];
  embeddedObjects?: ContentEmbeddedObject[];
}

export function sheet(options: SheetOptions): ContentSheet {
  return {
    name: options.name,
    cells: [],
    columns: [{ index: 0, widthPt: 80 }],
    rows: [{ index: 0, heightPt: 20 }],
    images: options.images ?? [],
    printSettings: {
      pageSize: { widthPt: 842, heightPt: 595 },
      margins: { topPt: 40, rightPt: 40, bottomPt: 40, leftPt: 40 },
      gridlines: false,
      headers: false,
      pageOrder: 'downThenOver',
    },
    ...(options.embeddedObjects !== undefined ? { embeddedObjects: options.embeddedObjects } : {}),
  };
}

export function spreadsheetDoc(sheets: ContentSheet[]): ContentDocument {
  return {
    kind: 'spreadsheet',
    formatVersion: 3,
    metadata: {},
    sheets,
  };
}

export function vectorLine(): ContentVector {
  return {
    kind: 'line',
    from: { xPt: 0, yPt: 0 },
    to: { xPt: 100, yPt: 50 },
    stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
  };
}

export function vectorRect(): ContentVector {
  return {
    kind: 'rect',
    frame: { xPt: 10, yPt: 10, widthPt: 80, heightPt: 40 },
    fill: { r: 1, g: 1, b: 1 },
  };
}

export function drawPage(blocksPerShape: ContentBlock[][], vectors: ContentVector[]): ContentDrawPage {
  return {
    size: { widthPt: 960, heightPt: 540 },
    shapes: blocksPerShape.map(shape),
    vectors,
  };
}

export function drawingDoc(pages: ContentDrawPage[]): ContentDocument {
  return {
    kind: 'drawing',
    formatVersion: 3,
    metadata: {},
    pages,
  };
}

type FormulaDocument = Extract<ContentDocument, { kind: 'formula' }>;

// Narrowed to the formula variant so tests can reach doc.formula without re-narrowing by hand.
export function formulaDoc(latex?: string): FormulaDocument {
  return {
    kind: 'formula',
    formatVersion: 3,
    metadata: {},
    formula: {
      mathml: [{ type: 'element', tag: 'mi', attributes: [], children: [{ type: 'text', value: 'x' }] }],
      ...(latex !== undefined ? { presentation: { latex } } : {}),
    },
  };
}
