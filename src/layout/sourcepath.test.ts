import { bytesToBase64 } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import type { ContentDocument, ContentImageBlock, ContentParagraph, ContentRun, ContentSection, ContentShape, ContentSlide, ContentTable } from 'document-schema.js';

import { createDocx } from '../edit/docx/editor';
import { createPptx } from '../edit/pptx/editor';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import type { LayoutImage, LayoutItem, LayoutLink, LayoutRect, LayoutText, TextMeasurer } from 'pdf-codec';
import { encodePng } from 'byte-codec';
import { createStandardFontMeasurer, loadMathFont } from 'pdf-codec';
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);
import { convertWordprocessingToLayout } from './engine';
import { convertPresentationToLayout } from './slides';

// Propagation of ContentRun/ContentImageBlock/ContentShape's own sourcePath (assigned in document order by ooxml.js's readDocx/readPptx, see document-schema.js) onto the LayoutText/LayoutImage/LayoutRect/LayoutLink items engine.ts (docx) and slides.ts (pptx) emit from them -- the last leg of the traceability chain from a positioned PDF-side item back to the semantic content it came from. sourcePath is stable within a single read+layout pass only, not across edits -- see the README's note on this alongside the rest of this file's assertions.

function fakeMeasurer(): TextMeasurer {
  return {
    widthOfTextAtSize: (text, _font, sizePt) => Array.from(text).length * (sizePt / 10),
    lineHeightAtSize: (_font, sizePt) => sizePt * 1.2,
    ascenderAtSize: (_font, sizePt) => sizePt * 0.8,
    descenderAtSize: (_font, sizePt) => -sizePt * 0.2,
    underlineAtSize: (_font, sizePt) => ({ offsetPt: -sizePt * 0.1, thicknessPt: sizePt * 0.05 }),
    horizontalScaleFor: () => 1,
  };
}

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

function textItems(items: readonly LayoutItem[]): LayoutText[] {
  return items.filter((i): i is LayoutText => i.kind === 'text');
}

function linkItems(items: readonly LayoutItem[]): LayoutLink[] {
  return items.filter((i): i is LayoutLink => i.kind === 'link');
}

function imageItems(items: readonly LayoutItem[]): LayoutImage[] {
  return items.filter((i): i is LayoutImage => i.kind === 'image');
}

function rectItems(items: readonly LayoutItem[]): LayoutRect[] {
  return items.filter((i): i is LayoutRect => i.kind === 'rect');
}

function tinyPngBlock(overrides: Partial<ContentImageBlock> = {}): ContentImageBlock {
  const bytes = encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]) });
  return { kind: 'image', format: 'png', base64: bytesToBase64(bytes), widthPt: 20, heightPt: 20, ...overrides };
}

describe('sourcePath propagation: docx flow (engine.ts)', () => {
  it('copies a run\'s sourcePath onto the LayoutText it produces', () => {
    const { document: layout } = convertWordprocessingToLayout(
      wordprocessingDoc([section([paragraph([run('Hi', { sizePt: 10, sourcePath: 'sections[0].blocks[0].runs[0]' })])])]),
      { measurer: fakeMeasurer(), mathMetricsAt },
    );
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.sourcePath).toBe('sections[0].blocks[0].runs[0]');
  });

  it('leaves sourcePath undefined for a run with none, rather than fabricating one', () => {
    const { document: layout } = convertWordprocessingToLayout(wordprocessingDoc([section([paragraph([run('Hi', { sizePt: 10 })])])]), { measurer: fakeMeasurer(), mathMetricsAt });
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.sourcePath).toBeUndefined();
  });

  it('gives each fragment of a word split across a run boundary its own run\'s sourcePath', () => {
    // "Hel" (run 0) immediately followed by "lo" (run 1), no whitespace between -- atomizeRuns merges them into one word atom spanning both runs, but each StyledFragment inside it must keep its own originating run's sourcePath.
    const { document: layout } = convertWordprocessingToLayout(
      wordprocessingDoc([
        section([paragraph([run('Hel', { sizePt: 10, sourcePath: 'sections[0].blocks[0].runs[0]' }), run('lo', { sizePt: 10, sourcePath: 'sections[0].blocks[0].runs[1]' })])]),
      ]),
      { measurer: fakeMeasurer(), mathMetricsAt },
    );
    const texts = textItems(layout.pages[0]!.items);
    expect(texts.map((t) => t.text)).toEqual(['Hel', 'lo']);
    expect(texts.map((t) => t.sourcePath)).toEqual(['sections[0].blocks[0].runs[0]', 'sections[0].blocks[0].runs[1]']);
  });

  it('gives every fragment of one run emergency-split across multiple pages the SAME sourcePath, not a fabricated per-fragment one', () => {
    // A single, hugely oversized word from one run: text-layout.ts's emergency character split forces it across several pages (see engine.test.ts's identical "Huge" scenario) -- every resulting LayoutText fragment must still trace back to this one source run.
    const { document: layout } = convertWordprocessingToLayout(
      wordprocessingDoc([section([paragraph([run('Huge', { sizePt: 1000, sourcePath: 'sections[0].blocks[0].runs[0]' })])])]),
      { measurer: fakeMeasurer(), mathMetricsAt },
    );
    const texts = layout.pages.flatMap((p) => textItems(p.items));
    expect(texts.length).toBeGreaterThan(1); // confirms the word really was split across multiple fragments/pages
    expect(texts.map((t) => t.text).join('')).toBe('Huge');
    expect(new Set(texts.map((t) => t.sourcePath))).toEqual(new Set(['sections[0].blocks[0].runs[0]']));
  });

  it('copies a hyperlinked run\'s sourcePath onto its LayoutLink as well as its LayoutText', () => {
    const { document: layout } = convertWordprocessingToLayout(
      wordprocessingDoc([section([paragraph([run('link', { sizePt: 10, hyperlink: 'https://example.com', sourcePath: 'sections[0].blocks[0].runs[0]' })])])]),
      { measurer: fakeMeasurer(), mathMetricsAt },
    );
    const [link] = linkItems(layout.pages[0]!.items);
    expect(link?.sourcePath).toBe('sections[0].blocks[0].runs[0]');
  });

  it('copies an image block\'s sourcePath onto its LayoutImage', () => {
    const { document: layout } = convertWordprocessingToLayout(wordprocessingDoc([section([tinyPngBlock({ sourcePath: 'sections[0].blocks[0]' })])]), { measurer: fakeMeasurer(), mathMetricsAt });
    const [image] = imageItems(layout.pages[0]!.items);
    expect(image?.sourcePath).toBe('sections[0].blocks[0]');
  });

  it('attributes a table cell\'s background rect to the table\'s own sourcePath, since ContentTableCell has none of its own', () => {
    const table: ContentTable = {
      kind: 'table',
      columnWidthsPt: [100],
      sourcePath: 'sections[0].blocks[0]',
      rows: [{ heightPt: 20, cells: [{ blocks: [], background: { r: 1, g: 0, b: 0 } }] }],
    };
    const { document: layout } = convertWordprocessingToLayout(wordprocessingDoc([section([table])]), { measurer: fakeMeasurer(), mathMetricsAt });
    const [rect] = rectItems(layout.pages[0]!.items);
    expect(rect?.sourcePath).toBe('sections[0].blocks[0]');
  });

  it('gives a paragraph-in-cell run its own sourcePath, distinct from the table\'s', () => {
    const table: ContentTable = {
      kind: 'table',
      columnWidthsPt: [100],
      sourcePath: 'sections[0].blocks[0]',
      rows: [{ heightPt: 20, cells: [{ blocks: [paragraph([run('Cell', { sizePt: 10, sourcePath: 'sections[0].blocks[0].rows[0].cells[0].blocks[0].runs[0]' })])] }] }],
    };
    const { document: layout } = convertWordprocessingToLayout(wordprocessingDoc([section([table])]), { measurer: fakeMeasurer(), mathMetricsAt });
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.sourcePath).toBe('sections[0].blocks[0].rows[0].cells[0].blocks[0].runs[0]');
  });
});

describe('sourcePath propagation: pptx direct placement (slides.ts)', () => {
  it('copies a run\'s sourcePath onto the LayoutText it produces', () => {
    const s = shape({ blocks: [paragraph([run('Hi', { sizePt: 10, sourcePath: 'slides[0].shapes[0].blocks[0].runs[0]' })])] });
    const { document: layout } = convertPresentationToLayout(presentationDoc([slide([s])]), { measurer: fakeMeasurer(), mathMetricsAt });
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.sourcePath).toBe('slides[0].shapes[0].blocks[0].runs[0]');
  });

  it('copies an image block\'s sourcePath onto its LayoutImage', () => {
    const s = shape({ blocks: [tinyPngBlock({ sourcePath: 'slides[0].shapes[0].blocks[0]' })] });
    const { document: layout } = convertPresentationToLayout(presentationDoc([slide([s])]), { measurer: fakeMeasurer(), mathMetricsAt });
    const [image] = imageItems(layout.pages[0]!.items);
    expect(image?.sourcePath).toBe('slides[0].shapes[0].blocks[0]');
  });

  it('attributes a table cell\'s background rect to the table\'s own sourcePath, since ContentTableCell has none of its own', () => {
    const table: ContentTable = {
      kind: 'table',
      columnWidthsPt: [100],
      sourcePath: 'slides[0].shapes[0].blocks[0]',
      rows: [{ heightPt: 20, cells: [{ blocks: [], background: { r: 0, g: 1, b: 0 } }] }],
    };
    const s = shape({ blocks: [table] });
    const { document: layout } = convertPresentationToLayout(presentationDoc([slide([s])]), { measurer: fakeMeasurer(), mathMetricsAt });
    const [rect] = rectItems(layout.pages[0]!.items);
    expect(rect?.sourcePath).toBe('slides[0].shapes[0].blocks[0]');
  });
});

describe('sourcePath propagation: docx end-to-end (createDocx -> readDocxContent -> convertWordprocessingToLayout)', () => {
  it('carries ooxml.js-assigned sourcePath strings through the real read+layout pipeline', () => {
    const editor = createDocx();
    const firstParagraph = editor.body.appendParagraph();
    firstParagraph.appendRun({ text: 'Bold', bold: true });
    firstParagraph.appendRun({ text: 'Red', color: { r: 1, g: 0, b: 0 } });
    const secondParagraph = editor.body.appendParagraph();
    secondParagraph.appendRun({ text: 'Second' });

    const content = readDocxContent(editor.toPackage());
    if (content.kind !== 'wordprocessing') {
      throw new Error('readDocxContent returned a non-wordprocessing ContentDocument');
    }
    const { document: layout } = convertWordprocessingToLayout(content, { measurer: createStandardFontMeasurer(), mathMetricsAt });

    const texts = layout.pages.flatMap((p) => textItems(p.items));
    expect(texts.map((t) => t.text)).toEqual(['Bold', 'Red', 'Second']);
    expect(texts.map((t) => t.sourcePath)).toEqual(['sections[0].blocks[0].runs[0]', 'sections[0].blocks[0].runs[1]', 'sections[0].blocks[1].runs[0]']);
  });
});

describe('sourcePath propagation: pptx end-to-end (createPptx -> readPptxContent -> convertPresentationToLayout)', () => {
  it('carries ooxml.js-assigned sourcePath strings through the real read+layout pipeline', () => {
    const editor = createPptx();
    const firstSlide = editor.addSlide();
    const textBox = firstSlide.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 }, text: '' });
    textBox.setParagraphs([{ runs: [{ text: 'Bold', bold: true }, { text: 'Red', color: { r: 1, g: 0, b: 0 } }] }]);
    const secondSlide = editor.addSlide();
    const secondTextBox = secondSlide.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 }, text: '' });
    secondTextBox.setParagraphs([{ runs: [{ text: 'Second' }] }]);

    const content = readPptxContent(editor.toPackage());
    if (content.kind !== 'presentation') {
      throw new Error('readPptxContent returned a non-presentation ContentDocument');
    }
    const { document: layout } = convertPresentationToLayout(content, { measurer: createStandardFontMeasurer(), mathMetricsAt });

    const firstSlideTexts = textItems(layout.pages[0]!.items);
    const secondSlideTexts = textItems(layout.pages[1]!.items);
    expect(firstSlideTexts.map((t) => t.text)).toEqual(['Bold', 'Red']);
    expect(firstSlideTexts.map((t) => t.sourcePath)).toEqual(['slides[0].shapes[0].blocks[0].runs[0]', 'slides[0].shapes[0].blocks[0].runs[1]']);
    expect(secondSlideTexts.map((t) => t.text)).toEqual(['Second']);
    expect(secondSlideTexts.map((t) => t.sourcePath)).toEqual(['slides[1].shapes[0].blocks[0].runs[0]']);
  });
});
