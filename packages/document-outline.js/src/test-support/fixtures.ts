// Fixture builders for every ContentDocument kind, shaped against the real document-schema.js 3.3.0 field requirements -- every builder's output is asserted to pass ContentDocumentSchema.parse in the tests that use it, so a schema change in document-schema.js breaks these fixtures loudly instead of silently testing against a shape that no longer exists. Never imported by src/index.ts and never reaching dist/ -- test-only, mirroring the family's test-support convention.
import type {
  ContentBlock,
  ContentCellValue,
  ContentDocument,
  ContentDrawPage,
  ContentEmbeddedObject,
  ContentRun,
  ContentSection,
  ContentShape,
  ContentSheet,
  ContentSheetCell,
  ContentSheetImage,
  ContentSlide,
  ContentVector,
  LayoutFrame,
  LayoutMetadata,
  Margins,
  PageSize,
  SymbolTable,
} from 'document-schema.js';

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

// A rendered position for the fused-frames fixtures: a run or paragraph that has been through a layout pass carries wherever it landed, and the wrapped-run case (one node, more than one frame) is what the array-of-frames shape exists for.
export function layoutFrame(pageIndex: number, xPt: number, yPt: number, widthPt: number, heightPt: number): LayoutFrame {
  return { pageIndex, xPt, yPt, widthPt, heightPt };
}

// A paragraph whose single run carries more than one frame -- the wrapped-run case: the run's content renders in two places without the node being split or duplicated.
export function wrappedRunParagraph(text: string, frames: LayoutFrame[]): ContentBlock {
  return { kind: 'paragraph', runs: [{ text, frames }] };
}

const PAGE_SIZE_A4_SECTION = { widthPt: 595, heightPt: 842 };
const MARGINS_A4_SECTION = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

// Geometry defaults for the section builder: fixtures may override either half per section (the multi-section corpus entry uses two distinct geometries, because per-section geometry is exactly what section groups must carry for the flatten bijection to hold).
export interface SectionOptions {
  pageSize?: PageSize;
  margins?: Margins;
}

export function section(blocks: ContentBlock[], options: SectionOptions = {}): ContentSection {
  return {
    pageSize: options.pageSize ?? PAGE_SIZE_A4_SECTION,
    margins: options.margins ?? MARGINS_A4_SECTION,
    blocks,
  };
}

// Document-level options the envelope round-trip has to prove: non-empty metadata (title/author reach flatten only through DocumentEnvelope) and the document-level symbolTable (the optional third envelope field).
export interface DocumentOptions {
  metadata?: LayoutMetadata;
  symbolTable?: SymbolTable;
}

export function wordprocessingDoc(blocksPerSection: ContentBlock[][], options: DocumentOptions = {}): ContentDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: 3,
    metadata: options.metadata ?? {},
    ...(options.symbolTable !== undefined ? { symbolTable: options.symbolTable } : {}),
    sections: blocksPerSection.map((blocks) => section(blocks)),
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

export function slide(blocksPerShape: ContentBlock[][], options: { notes?: string } = {}): ContentSlide {
  return {
    size: { widthPt: 960, heightPt: 540 },
    shapes: blocksPerShape.map(shape),
    notes: options.notes ?? '',
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

// The recursive formula arm: an embedded whole formula document, anchored to a spreadsheet cell exactly as a sheet-held embedded object is (the four anchor fields are sheet-anchored-only, which is why they are set here and absent on embeddedObject above).
export function embeddedFormulaObject(): ContentEmbeddedObject {
  return {
    objectKind: 'formula',
    frame: { xPt: 2, yPt: 2, widthPt: 120, heightPt: 40 },
    document: formulaDoc('P = VI'),
    anchorRow: 0,
    anchorColumn: 2,
    offsetXPt: 2,
    offsetYPt: 2,
  };
}

// The block-level spelling of an embedded object inside a section's or shape's block flow (ContentEmbeddedObjectBlock adds the kind discriminator to ContentEmbeddedObject's own fields).
export function embeddedObjectBlock(): ContentBlock {
  return { ...embeddedObject(), kind: 'embeddedObject' };
}

// A populated sheet cell, for the corpus's grid-carrying sheet: cells ride ON the sheet descriptor in the tree, so a round-tripped cell proves the grid travelled with the container and not through the children.
export function sheetCell(row: number, column: number, value: ContentCellValue, displayText: string): ContentSheetCell {
  return { row, column, value, displayText };
}

export interface SheetOptions {
  name: string;
  cells?: ContentSheetCell[];
  images?: ContentSheetImage[];
  embeddedObjects?: ContentEmbeddedObject[];
}

export function sheet(options: SheetOptions): ContentSheet {
  return {
    name: options.name,
    cells: options.cells ?? [],
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

// A minimal, dimensionally correct symbol table (one curated symbol, the SI unit it prefers): enough to exercise the envelope's optional symbolTable field end to end without dragging in the wider math curation surface. Voltage is mass.length^2.time^-3.current^-1, and the coherent SI unit's factor to itself is 1/1.
export function minimalSymbolTable(): SymbolTable {
  return {
    symbols: [
      { glyph: 'U', scope: 'document', id: 'symbols:voltage', quantityKind: 'si:voltage', preferredUnit: 'si:volt' },
    ],
    units: [
      {
        id: 'si:volt',
        symbol: 'V',
        name: 'volt',
        dimension: { mass: 1, length: 2, time: -3, electricCurrent: -1 },
        factorToSi: { numerator: '1', denominator: '1' },
      },
    ],
  };
}
