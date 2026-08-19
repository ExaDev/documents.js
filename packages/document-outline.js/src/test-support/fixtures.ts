// Fixture builders for every tree-form DocumentPackage kind, shaped against the real document-schema.js 4.0.0 field requirements -- every builder's output is asserted to pass DocumentPackageSchema.parse in the tests that use it, so a schema change in document-schema.js breaks these fixtures loudly instead of silently testing against a shape that no longer exists. Two layers: the leaf builders (paragraphs, tables, images, vectors, ...) and the group/package builders (headingGroup/sectionGroup/wordprocessingPackage/...), mirroring the tree's own two vocabularies. Never imported by src/index.ts and never reaching dist/ -- test-only, mirroring the family's test-support convention.
import type {
  ContentCellValue,
  ContentEmbeddedObject,
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
  ContentPageBreak,
  ContentParagraph,
  ContentRun,
  ContentSheetCell,
  ContentSheetImage,
  ContentTable,
  ContentVector,
  DocumentPackage,
  DrawPageChild,
  DrawPageGroupNode,
  HeadingGroupNode,
  LayoutFrame,
  LayoutMetadata,
  ListChild,
  ListGroupNode,
  Margins,
  PageSize,
  SectionChild,
  SectionConstructGroupNode,
  SectionGroupNode,
  ShapeChild,
  ShapeConstructGroupNode,
  ShapeGroupNode,
  SheetChild,
  SheetGroupNode,
  SlideGroupNode,
  StylesTable,
  SymbolTable,
} from 'document-schema.js';

export function textRun(text: string, options: { bold?: boolean } = {}): ContentRun {
  return { text, ...(options.bold !== undefined ? { bold: options.bold } : {}) };
}

export interface ParagraphOptions {
  headingLevel?: number;
  listLevel?: number;
  styleId?: string;
  indentLeftPt?: number;
  bold?: boolean;
}

// A bare paragraph LEAF (ContentParagraph): no headingLevel, no list membership -- exactly the payload that sits at a leaf position in a tree. The heading/list anchors are separate builders below, because in the tree vocabulary an anchored paragraph lives on its group's node, never as a leaf.
export function paragraph(text: string, options: ParagraphOptions = {}): ContentParagraph {
  return {
    kind: 'paragraph',
    runs: [textRun(text, { bold: options.bold })],
    // headingLevel/listLevel here are for paragraphs that must carry the signal while sitting OUTSIDE a matching group (the heading-styled presentation leaf, the effective-resolution anchor variants), not for leaf-position grouping -- buildOutline reads signals only from group anchors.
    ...(options.headingLevel !== undefined ? { headingLevel: options.headingLevel } : {}),
    // numId omitted deliberately on list paragraphs: since schema 3.3.0 it is optional, and OOXML drawing paragraphs carry only a level -- exactly the slide-body shape the presentation outline nests by.
    ...(options.listLevel !== undefined ? { list: { level: options.listLevel } } : {}),
    ...(options.styleId !== undefined ? { styleId: options.styleId } : {}),
    ...(options.indentLeftPt !== undefined ? { indentLeftPt: options.indentLeftPt } : {}),
  };
}

export function table(rows: string[][]): ContentTable {
  return {
    kind: 'table',
    rows: rows.map((cells) => ({
      cells: cells.map((text) => ({ blocks: [paragraph(text)] })),
    })),
    columnWidthsPt: rows[0]?.map(() => 80) ?? [],
  };
}

export function imageBlock(altText?: string): ContentImageBlock {
  return {
    kind: 'image',
    format: 'png',
    base64: 'aW1hZ2U=',
    widthPt: 100,
    heightPt: 60,
    ...(altText !== undefined ? { altText } : {}),
  };
}

export function pageBreak(): ContentPageBreak {
  return { kind: 'pageBreak' };
}

// A rendered position for the fused-frames fixtures: a run or paragraph that has been through a layout pass carries wherever it landed, and the wrapped-run case (one node, more than one frame) is what the array-of-frames shape exists for.
export function layoutFrame(pageIndex: number, xPt: number, yPt: number, widthPt: number, heightPt: number): LayoutFrame {
  return { pageIndex, xPt, yPt, widthPt, heightPt };
}

// A paragraph whose single run carries more than one frame -- the wrapped-run case: the run's content renders in two places without the node being split or duplicated.
export function wrappedRunParagraph(text: string, frames: LayoutFrame[]): ContentParagraph {
  return { kind: 'paragraph', runs: [{ text, frames }] };
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

// An embedded whole wordprocessing document, block-flow-shaped via embeddedObjectBlock below or sheet-anchored as-is -- the recursive arm stays one intact leaf whichever container holds it. The payload is a flat ContentDocument, not a DocumentPackage: schema 4 promotes the TOP-LEVEL package to tree form, but an embedded document stays the flat codec-exchange shape it always was.
export function embeddedObject(): ContentEmbeddedObject {
  return {
    objectKind: 'wordprocessing',
    frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 200 },
    document: {
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks: [paragraph('embedded document body')] },
      ],
    },
  };
}

// The recursive formula arm: an embedded whole formula document, anchored to a spreadsheet cell exactly as a sheet-held embedded object is (the four anchor fields are sheet-anchored-only, which is why they are set here and absent on embeddedObject above). Same flat-shape rule as embeddedObject; mathml carries a real MathMlNode tree (an element with a text child), because the schema's guard rejects bare strings.
export function embeddedFormulaObject(): ContentEmbeddedObject {
  return {
    objectKind: 'formula',
    frame: { xPt: 2, yPt: 2, widthPt: 120, heightPt: 40 },
    document: {
      kind: 'formula',
      metadata: {},
      formula: {
        mathml: [{ type: 'element', tag: 'mi', attributes: [], children: [{ type: 'text', value: 'P' }] }],
        presentation: { latex: 'P = VI' },
      },
    },
    anchorRow: 0,
    anchorColumn: 2,
    offsetXPt: 2,
    offsetYPt: 2,
  };
}

// The block-level spelling of an embedded object inside a section's or shape's block flow (ContentEmbeddedObjectBlock adds the kind discriminator to ContentEmbeddedObject's own fields).
export function embeddedObjectBlock(): ContentEmbeddedObjectBlock {
  return { ...embeddedObject(), kind: 'embeddedObject' };
}

// A populated sheet cell, for grid-carrying sheets: cells ride ON the sheet descriptor, so a sheet group carries the grid and its children carry only the floating payload.
export function sheetCell(row: number, column: number, value: ContentCellValue, displayText: string): ContentSheetCell {
  return { row, column, value, displayText };
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

// A group's optional style ref into the package's styles table -- the field effectivePackage exists to consume. Plain {} at every call site keeps the anchor fixtures readable while the effective tests spell the ref out.
interface GroupOptions {
  style?: string;
}

// The anchor paragraphs are built literally rather than through paragraph(), whose return type is the loose ContentParagraph with the grouping signal optional -- a group anchor's signal is structurally required, and the literal spread keeps it required without a cast.
export function headingGroup(text: string, headingLevel: number, children: SectionChild[] = [], options: GroupOptions = {}): HeadingGroupNode {
  return {
    node: { ...paragraph(text), headingLevel },
    ...(options.style !== undefined ? { style: options.style } : {}),
    children,
  };
}

export function listGroup(text: string, level: number, children: ListChild[] = [], options: GroupOptions = {}): ListGroupNode {
  return {
    node: { ...paragraph(text), list: { level } },
    ...(options.style !== undefined ? { style: options.style } : {}),
    children,
  };
}

// A construct group's node is a ConstructDescriptor, never a paragraph -- richText is the simplest member of the discriminated union (kind + controlType only), which is all these fixtures need since the outline builder never reads a construct's descriptor fields, only its kind (to recognise the wrapper) and its children.
export function sectionConstructGroup(children: SectionChild[], options: GroupOptions = {}): SectionConstructGroupNode {
  return {
    node: { kind: 'contentControl', controlType: 'richText' },
    ...(options.style !== undefined ? { style: options.style } : {}),
    children,
  };
}

export function shapeConstructGroup(children: ShapeChild[], options: GroupOptions = {}): ShapeConstructGroupNode {
  return {
    node: { kind: 'contentControl', controlType: 'richText' },
    ...(options.style !== undefined ? { style: options.style } : {}),
    children,
  };
}

const PAGE_SIZE_A4_SECTION = { widthPt: 595, heightPt: 842 };
const MARGINS_A4_SECTION = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

export interface SectionGroupOptions extends GroupOptions {
  pageSize?: PageSize;
  margins?: Margins;
}

export function sectionGroup(children: SectionChild[], options: SectionGroupOptions = {}): SectionGroupNode {
  return {
    node: {
      pageSize: options.pageSize ?? PAGE_SIZE_A4_SECTION,
      margins: options.margins ?? MARGINS_A4_SECTION,
      kind: 'section',
    },
    ...(options.style !== undefined ? { style: options.style } : {}),
    children,
  };
}

export function shapeGroup(children: ShapeChild[], options: GroupOptions = {}): ShapeGroupNode {
  return {
    node: {
      frame: { xPt: 0, yPt: 0, widthPt: 600, heightPt: 400 },
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
    },
    ...(options.style !== undefined ? { style: options.style } : {}),
    children,
  };
}

export interface SlideGroupOptions extends GroupOptions {
  notes?: string;
}

export function slideGroup(shapes: ShapeGroupNode[], options: SlideGroupOptions = {}): SlideGroupNode {
  return {
    node: {
      size: { widthPt: 960, heightPt: 540 },
      notes: options.notes ?? '',
      kind: 'slide',
    },
    ...(options.style !== undefined ? { style: options.style } : {}),
    children: shapes,
  };
}

export interface SheetGroupOptions extends GroupOptions {
  name: string;
  cells?: ContentSheetCell[];
  images?: ContentSheetImage[];
  embeddedObjects?: ContentEmbeddedObject[];
}

export function sheetGroup(options: SheetGroupOptions): SheetGroupNode {
  const children: SheetChild[] = [...(options.images ?? []), ...(options.embeddedObjects ?? [])];
  return {
    node: {
      cells: options.cells ?? [],
      rows: [{ index: 0, heightPt: 20 }],
      name: options.name,
      columns: [{ index: 0, widthPt: 80 }],
      printSettings: {
        pageSize: { widthPt: 842, heightPt: 595 },
        margins: { topPt: 40, rightPt: 40, bottomPt: 40, leftPt: 40 },
        gridlines: false,
        headers: false,
        pageOrder: 'downThenOver',
      },
      kind: 'sheet',
    },
    ...(options.style !== undefined ? { style: options.style } : {}),
    children,
  };
}

export function drawPageGroup(children: DrawPageChild[], options: GroupOptions = {}): DrawPageGroupNode {
  return {
    node: { size: { widthPt: 960, heightPt: 540 }, kind: 'drawPage' },
    ...(options.style !== undefined ? { style: options.style } : {}),
    children,
  };
}

// The envelope options every package builder shares -- exactly the DocumentPackage fields outside `kind` and `children`, so a fixture can prove any envelope field survives alongside the tree without a second bespoke builder per kind.
export interface PackageOptions {
  metadata?: LayoutMetadata;
  symbolTable?: SymbolTable;
  pages?: NonNullable<DocumentPackage['pages']>;
  styles?: StylesTable;
}

export function wordprocessingPackage(children: SectionGroupNode[], options: PackageOptions = {}): DocumentPackage {
  return {
    kind: 'wordprocessing',
    metadata: options.metadata ?? {},
    ...(options.symbolTable !== undefined ? { symbolTable: options.symbolTable } : {}),
    ...(options.pages !== undefined ? { pages: options.pages } : {}),
    ...(options.styles !== undefined ? { styles: options.styles } : {}),
    children,
  };
}

export function presentationPackage(children: SlideGroupNode[], options: PackageOptions = {}): DocumentPackage {
  return {
    kind: 'presentation',
    metadata: options.metadata ?? {},
    ...(options.symbolTable !== undefined ? { symbolTable: options.symbolTable } : {}),
    ...(options.pages !== undefined ? { pages: options.pages } : {}),
    ...(options.styles !== undefined ? { styles: options.styles } : {}),
    children,
  };
}

export function spreadsheetPackage(children: SheetGroupNode[], options: PackageOptions = {}): DocumentPackage {
  return {
    kind: 'spreadsheet',
    metadata: options.metadata ?? {},
    ...(options.symbolTable !== undefined ? { symbolTable: options.symbolTable } : {}),
    ...(options.pages !== undefined ? { pages: options.pages } : {}),
    ...(options.styles !== undefined ? { styles: options.styles } : {}),
    children,
  };
}

export function drawingPackage(children: DrawPageGroupNode[], options: PackageOptions = {}): DocumentPackage {
  return {
    kind: 'drawing',
    metadata: options.metadata ?? {},
    ...(options.symbolTable !== undefined ? { symbolTable: options.symbolTable } : {}),
    ...(options.pages !== undefined ? { pages: options.pages } : {}),
    ...(options.styles !== undefined ? { styles: options.styles } : {}),
    children,
  };
}

export function formulaPackage(latex?: string): DocumentPackage {
  return {
    kind: 'formula',
    metadata: {},
    children: [
      {
        mathml: [{ type: 'element', tag: 'mi', attributes: [], children: [{ type: 'text', value: 'x' }] }],
        ...(latex !== undefined ? { presentation: { latex } } : {}),
      },
    ],
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
