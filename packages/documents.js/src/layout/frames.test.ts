import { bytesToBase64 } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import type { ContentDocument, ContentDrawPage, ContentImageBlock, ContentParagraph, ContentRun, ContentSection, ContentSheet, ContentSheetCell, ContentSheetPrintSettings, ContentShape, ContentSlide, ContentTable, ContentVector } from 'document-schema.js';
import { assembleTree, type DocumentTree } from 'document-schema.js';
import { encodePng } from 'byte-codec';
import { createStandardFontMeasurer, loadMathFont } from 'pdf-codec';
import { convertWordprocessingToLayout } from './engine';
import { convertDrawingToLayout } from './drawing';
import { reconstructWordprocessing } from './reconstruct';
import { convertSpreadsheetToLayout } from './sheets';
import { convertPresentationToLayout } from './slides';
import { layoutDocumentFromPackage } from '../convert/from-package';
import type { LayoutItem } from 'pdf-codec';
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);

// The frames half of the unified DocumentTree (ExaDev/documents.js#569): every layout engine stamps each placement it computes onto the corresponding content node's own frames array (PDF user-space, pageIndex into the package's own pages), every reconstructor attaches frames from the exact items each reconstructed node was clustered from, and from-package's inverse rebuilds a LayoutDocument from those frames alone. These tests pin that stamping at each layer; sourcepath.test.ts pins the older sourcePath traceability that survives alongside it.

function run(text: string, overrides: Partial<ContentRun> = {}): ContentRun {
  return { text, ...overrides };
}

function paragraph(runs: ContentRun[], overrides: Partial<ContentParagraph> = {}): ContentParagraph {
  return { kind: 'paragraph', runs, ...overrides };
}

function section(blocks: ContentSection['blocks'], overrides: Partial<ContentSection> = {}): ContentSection {
  return { pageSize: { widthPt: 100, heightPt: 50 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, blocks, ...overrides };
}

function wordprocessingDoc(sections: ContentSection[]): Extract<ContentDocument, { kind: 'wordprocessing' }> {
  return { kind: 'wordprocessing', metadata: {}, sections };
}

function shape(overrides: Partial<ContentShape> = {}): ContentShape {
  return { frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 }, insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0, blocks: [], ...overrides };
}

function slide(shapes: ContentShape[], size = { widthPt: 960, heightPt: 540 }): ContentSlide {
  return { size, shapes, notes: '' };
}

function presentationDoc(slides: ContentSlide[]): Extract<ContentDocument, { kind: 'presentation' }> {
  return { kind: 'presentation', metadata: {}, slides };
}

function drawPage(overrides: Partial<ContentDrawPage> = {}): ContentDrawPage {
  return { size: { widthPt: 400, heightPt: 300 }, shapes: [], vectors: [], ...overrides };
}

function drawingDoc(pages: ContentDrawPage[]): Extract<ContentDocument, { kind: 'drawing' }> {
  return { kind: 'drawing', metadata: {}, pages };
}

function tinyPngBlock(overrides: Partial<ContentImageBlock> = {}): ContentImageBlock {
  const bytes = encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]) });
  return { kind: 'image', format: 'png', base64: bytesToBase64(bytes), widthPt: 20, heightPt: 20, ...overrides };
}

function sheet(cells: ContentSheetCell[]): ContentSheet {
  const printSettings: ContentSheetPrintSettings = { pageSize: { widthPt: 400, heightPt: 300 }, margins: { topPt: 10, rightPt: 10, bottomPt: 10, leftPt: 10 }, gridlines: false, headers: false, pageOrder: 'downThenOver' };
  return { name: 'Sheet1', cells, columns: [{ index: 0, widthPt: 60 }, { index: 1, widthPt: 60 }], rows: [{ index: 0, heightPt: 20 }], images: [], printSettings };
}

describe('engine frames: wordprocessing (engine.ts)', () => {
  it('stamps one frame per wrapped fragment onto the originating run, in place on the caller\'s own content', () => {
    // "Hello from docx" wraps to three words -> three fragments -> three frames on the ONE run they all came from, in reading order.
    const doc = wordprocessingDoc([section([paragraph([run('Hello from docx', { sizePt: 10 })])], { pageSize: { widthPt: 50, heightPt: 50 } })]);
    const theRun = doc.sections[0]!.blocks[0]!;
    const { pages } = convertWordprocessingToLayout(doc, { measurer: createStandardFontMeasurer(), mathMetricsAt });
    expect(theRun.kind).toBe('paragraph');
    if (theRun.kind !== 'paragraph') throw new Error('unreachable');
    expect(theRun.runs[0]!.frames).toHaveLength(3);
    expect(pages).toEqual([{ widthPt: 50, heightPt: 50 }]);
    for (const frame of theRun.runs[0]!.frames ?? []) {
      expect(frame.pageIndex).toBe(0);
      expect(frame.heightPt).toBeGreaterThan(0);
      expect(frame.widthPt).toBeGreaterThan(0);
    }
    // Reading order: each successive frame starts to the right of the previous one's end on its own line (here all three share one line, so x is strictly increasing).
    const frames = theRun.runs[0]!.frames!;
    expect(frames[1]!.xPt).toBeGreaterThanOrEqual(frames[0]!.xPt + frames[0]!.widthPt - 0.01);
  });

  it('stamps distinct frames per fragment even when a run splits across a page boundary', () => {
    // One hugely oversized word from one run: the emergency character split forces it across several pages, and every fragment's frame names the page it actually landed on.
    const doc = wordprocessingDoc([section([paragraph([run('Huge', { sizePt: 1000 })])])]);
    convertWordprocessingToLayout(doc, { measurer: createStandardFontMeasurer(), mathMetricsAt });
    const block = doc.sections[0]!.blocks[0]!;
    if (block.kind !== 'paragraph') throw new Error('expected a paragraph');
    const frames = block.runs[0]!.frames!;
    expect(frames.length).toBeGreaterThan(1);
    expect(new Set(frames.map((frame) => frame.pageIndex)).size).toBeGreaterThan(1);
  });

  it('leaves frames undefined for an empty paragraph\'s synthesised fallback run', () => {
    const doc = wordprocessingDoc([section([paragraph([])])]);
    const { pages } = convertWordprocessingToLayout(doc, { measurer: createStandardFontMeasurer(), mathMetricsAt });
    expect(pages).toEqual([{ widthPt: 100, heightPt: 50 }]);
    expect(doc.sections[0]!.blocks[0]!.kind).toBe('paragraph');
  });

  it('stamps the cell node\'s frame and each in-cell run\'s own frames for a table', () => {
    const table: ContentTable = {
      kind: 'table',
      columnWidthsPt: [100],
      rows: [{ heightPt: 20, cells: [{ blocks: [paragraph([run('Cell', { sizePt: 10 })])], background: { r: 1, g: 0, b: 0 } }] }],
    };
    const doc = wordprocessingDoc([section([table])]);
    convertWordprocessingToLayout(doc, { measurer: createStandardFontMeasurer(), mathMetricsAt });
    const cell = table.rows[0]!.cells[0]!;
    expect(cell.frames).toEqual([{ pageIndex: 0, xPt: 0, yPt: 50 - 20, widthPt: 100, heightPt: 20 }]); // PDF space: y flipped about the 50pt page
    expect(cell.blocks[0]).toMatchObject({ kind: 'paragraph' });
    const cellParagraph = cell.blocks[0];
    if (cellParagraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(cellParagraph.runs[0]!.frames?.[0]?.pageIndex).toBe(0);
  });

  it('stamps a list marker\'s frame onto the paragraph node itself', () => {
    const doc = wordprocessingDoc([section([paragraph([run('item', { sizePt: 10 })], { list: { numId: 'md1:bullet', level: 0 } })])]);
    const theParagraph = doc.sections[0]!.blocks[0]!;
    convertWordprocessingToLayout(doc, { measurer: createStandardFontMeasurer(), mathMetricsAt });
    if (theParagraph.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(theParagraph.frames).toHaveLength(1); // the marker -- the one item derived from the paragraph itself rather than from any run
    expect(theParagraph.frames?.[0]?.pageIndex).toBe(0);
  });

  it('stamps an image block\'s frame at its placed position', () => {
    const block = tinyPngBlock();
    const doc = wordprocessingDoc([section([block])]);
    convertWordprocessingToLayout(doc, { measurer: createStandardFontMeasurer(), mathMetricsAt });
    expect(block.frames).toEqual([{ pageIndex: 0, xPt: 0, yPt: 50 - 20, widthPt: 20, heightPt: 20 }]);
  });
});

describe('engine frames: presentation (slides.ts)', () => {
  it('stamps the shape\'s own placement and each run\'s fragment frames', () => {
    const s = shape({ frame: { xPt: 50, yPt: 40, widthPt: 300, heightPt: 100 }, blocks: [paragraph([run('Hi', { sizePt: 10 })])] });
    const doc = presentationDoc([slide([s])]);
    const { pages } = convertPresentationToLayout(doc, { measurer: createStandardFontMeasurer(), mathMetricsAt });
    expect(s.frames).toEqual([{ pageIndex: 0, xPt: 50, yPt: 540 - 40 - 100, widthPt: 300, heightPt: 100 }]);
    const p = s.blocks[0];
    if (p?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(p.runs[0]!.frames?.[0]?.pageIndex).toBe(0);
    expect(pages).toEqual([{ widthPt: 960, heightPt: 540 }]);
  });
});

describe('engine frames: spreadsheet (sheets.ts)', () => {
  it('stamps each populated cell\'s frame at its grid position', () => {
    const doc: Extract<ContentDocument, { kind: 'spreadsheet' }> = { kind: 'spreadsheet', metadata: {}, sheets: [sheet([{ row: 0, column: 0, value: { kind: 'string', value: 'A' }, displayText: 'A' }])] };
    convertSpreadsheetToLayout(doc, { measurer: createStandardFontMeasurer(), mathMetricsAt });
    const cell = doc.sheets[0]!.cells[0]!;
    expect(cell.frames).toEqual([{ pageIndex: 0, xPt: 10, yPt: 300 - 10 - 20, widthPt: 60, heightPt: 20 }]);
  });
});

describe('engine frames: drawing (drawing.ts)', () => {
  it('stamps each vector\'s frame from its emitted item, flipped into PDF space', () => {
    const vector: ContentVector = { kind: 'rect', frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 }, fill: { r: 1, g: 0, b: 0 } };
    const doc = drawingDoc([drawPage({ vectors: [vector] })]);
    const { pages } = convertDrawingToLayout(doc, { measurer: createStandardFontMeasurer() });
    expect(vector.frames).toEqual([{ pageIndex: 0, xPt: 10, yPt: 300 - 20 - 40, widthPt: 30, heightPt: 40 }]);
    expect(pages).toEqual([{ widthPt: 400, heightPt: 300 }]);
  });
});

describe('reconstruct frames: wordprocessing (reconstruct.ts)', () => {
  it('attaches each reconstructed paragraph and run frames from the exact items they were clustered from', () => {
    const items: LayoutItem[] = [
      { kind: 'text', text: 'Hello', xPt: 72, yPt: 700, font: { family: 'Helvetica', weight: 'normal', style: 'normal' }, sizePt: 12, color: { r: 0, g: 0, b: 0 }, widthPt: 27 },
      { kind: 'text', text: 'world', xPt: 72.5 + 27, yPt: 700, font: { family: 'Helvetica', weight: 'normal', style: 'normal' }, sizePt: 12, color: { r: 0, g: 0, b: 0 }, widthPt: 28 },
    ];
    const content = reconstructWordprocessing({ formatVersion: 1, metadata: {}, pages: [{ widthPt: 612, heightPt: 792, items }], images: {} });
    if (content.kind !== 'wordprocessing') throw new Error('expected wordprocessing');
    const block = content.sections[0]!.blocks[0];
    if (block?.kind !== 'paragraph') throw new Error('expected a paragraph');
    // One line clustered -> one paragraph frame (the line's bounding box); two runs -> each carries its own item's box, both naming page 0.
    expect(block.frames).toHaveLength(1);
    expect(block.frames?.[0]?.pageIndex).toBe(0);
    expect(block.runs).toHaveLength(2);
    expect(block.runs[0]!.frames?.[0]?.xPt).toBe(72);
    expect(block.runs[1]!.frames?.[0]?.xPt).toBe(72.5 + 27);
    for (const run of block.runs) {
      expect(run.frames?.[0]?.pageIndex).toBe(0);
    }
  });
});

describe('from-package inverse (from-package.ts)', () => {
  it('rebuilds a LayoutDocument whose pages match the package\'s own and whose text comes from the runs\' frames', () => {
    const doc = wordprocessingDoc([section([paragraph([run('Hi', { sizePt: 10 })])])]);
    const { pages } = convertWordprocessingToLayout(doc, { measurer: createStandardFontMeasurer(), mathMetricsAt });
    const pkg: DocumentTree = assembleTree(doc, pages);
    const layout = layoutDocumentFromPackage(pkg);
    expect(layout.pages.map(({ widthPt, heightPt }) => ({ widthPt, heightPt }))).toEqual(pages);
    const texts = layout.pages.flatMap((page) => page.items.filter((item): item is Extract<LayoutItem, { kind: 'text' }> => item.kind === 'text'));
    expect(texts.map((item) => item.text)).toEqual(['Hi']);
    // The rebuilt item sits at the run's own recorded frame.
    const block = doc.sections[0]!.blocks[0];
    if (block?.kind !== 'paragraph') throw new Error('expected a paragraph');
    const frame = block.runs[0]!.frames![0]!;
    expect(texts[0]!.xPt).toBe(frame.xPt);
    expect(texts[0]!.yPt).toBe(frame.yPt);
  });

  it('renders one frame per image placement and rebuilds vectors exactly through the drawing engine\'s own conversion', () => {
    const vector: ContentVector = { kind: 'rect', frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 }, fill: { r: 1, g: 0, b: 0 } };
    const image = tinyPngBlock();
    const doc = drawingDoc([drawPage({ vectors: [vector], shapes: [shape({ blocks: [image], frame: { xPt: 100, yPt: 100, widthPt: 20, heightPt: 20 } })] })]);
    const { pages } = convertDrawingToLayout(doc, { measurer: createStandardFontMeasurer() });
    const layout = layoutDocumentFromPackage(assembleTree(doc, pages));
    const rebuiltItems = layout.pages[0]!.items;
    expect(rebuiltItems.map((item) => item.kind)).toEqual(['rect', 'image']);
    const rebuiltRect = rebuiltItems.find((item): item is Extract<LayoutItem, { kind: 'rect' }> => item.kind === 'rect');
    expect(rebuiltRect).toMatchObject({ xPt: 10, yPt: 300 - 20 - 40, widthPt: 30, heightPt: 40, fill: { r: 1, g: 0, b: 0 } });
    const rebuiltImage = rebuiltItems.find((item): item is Extract<LayoutItem, { kind: 'image' }> => item.kind === 'image');
    expect(rebuiltImage).toMatchObject({ xPt: 100, yPt: 300 - 100 - 20, widthPt: 20, heightPt: 20 });
  });

  it('renders a spreadsheet cell\'s displayText at its own frame (single-line by construction)', () => {
    const doc: Extract<ContentDocument, { kind: 'spreadsheet' }> = { kind: 'spreadsheet', metadata: {}, sheets: [sheet([{ row: 0, column: 0, value: { kind: 'string', value: 'A' }, displayText: 'A' }])] };
    const { pages } = convertSpreadsheetToLayout(doc, { measurer: createStandardFontMeasurer(), mathMetricsAt });
    const layout = layoutDocumentFromPackage(assembleTree(doc, pages));
    const texts = layout.pages[0]!.items.filter((item): item is Extract<LayoutItem, { kind: 'text' }> => item.kind === 'text');
    expect(texts.map((item) => item.text)).toEqual(['A']);
  });
});
