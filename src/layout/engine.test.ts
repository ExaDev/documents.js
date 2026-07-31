import { bytesToBase64 } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import type { ContentBlock, ContentImageBlock, ContentParagraph, ContentRun, ContentSection, ContentTable, LayoutImage, LayoutItem, LayoutLink, LayoutRect, LayoutText } from 'document-content-model';
import { encodePng } from '../image/png-encode';
import { CONTENT_FORMAT_VERSION } from '../model/content';
import type { ContentDocument } from '../model/content';
import type { TextMeasurer } from '../pdf/measure';
import { convertWordprocessingToLayout } from './engine';

// Every character is sizePt/10 pt wide; lineHeightAtSize is 1.2x, ascender 0.8x, descender -0.2x -- the same fake-measurer convention already used across src/pdf/text-layout.test.ts, src/layout/slides.test.ts, and src/layout/shared.test.ts.
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

function section(blocks: ContentBlock[], overrides: Partial<ContentSection> = {}): ContentSection {
  return { pageSize: { widthPt: 100, heightPt: 50 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, blocks, ...overrides };
}

function doc(sections: ContentSection[]): Extract<ContentDocument, { kind: 'wordprocessing' }> {
  return { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, sections };
}

function convert(sections: ContentSection[]) {
  return convertWordprocessingToLayout(doc(sections), { measurer: fakeMeasurer() });
}

function textItems(items: readonly LayoutItem[]): LayoutText[] {
  return items.filter((i): i is LayoutText => i.kind === 'text');
}

function tinyPngBlock(): ContentImageBlock {
  const bytes = encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]) });
  return { kind: 'image', format: 'png', base64: bytesToBase64(bytes), widthPt: 20, heightPt: 20 };
}

describe('convertWordprocessingToLayout: basic flow', () => {
  it('positions a single line, flipping Y from OOXML top-left/y-down into PDF bottom-left/y-up', () => {
    const layout = convert([section([paragraph([run('Hi', { sizePt: 10 })])])]);
    expect(layout.pages).toHaveLength(1);
    const [text] = textItems(layout.pages[0]!.items);
    // baselineYDown = 0(top margin) + ascent(8) = 8 -> y = 50 - 8 = 42.
    expect(text?.text).toBe('Hi');
    expect(text?.yPt).toBe(42);
  });

  it('stacks consecutive paragraphs by line height', () => {
    const layout = convert([section([paragraph([run('One', { sizePt: 10 })]), paragraph([run('Two', { sizePt: 10 })])])]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(['One', 'Two']);
    // line height = 12; para1 baseline=8->y=42; para2 baseline=12+8=20->y=30.
    expect(items[0]?.yPt).toBe(42);
    expect(items[1]?.yPt).toBe(30);
  });

  it('produces one page per section, using that section\'s own page size', () => {
    const layout = convert([
      section([paragraph([run('A', { sizePt: 10 })])], { pageSize: { widthPt: 100, heightPt: 50 } }),
      section([paragraph([run('B', { sizePt: 10 })])], { pageSize: { widthPt: 200, heightPt: 300 } }),
    ]);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]).toMatchObject({ widthPt: 100, heightPt: 50 });
    expect(layout.pages[1]).toMatchObject({ widthPt: 200, heightPt: 300 });
  });

  it('produces exactly one (empty) page for a section with no blocks', () => {
    const layout = convert([section([])]);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]?.items).toHaveLength(0);
  });
});

describe('convertWordprocessingToLayout: pagination overflow', () => {
  it('starts a new page when the next line would overflow the content area', () => {
    // Page height 50, each line 12pt: four lines exactly fill (48pt used), a fifth overflows (60 > 50) and moves to a new page.
    const paragraphs = ['One', 'Two', 'Three', 'Four', 'Five'].map((word) => paragraph([run(word, { sizePt: 10 })]));
    const layout = convert([section(paragraphs)]);
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((i) => i.text)).toEqual(['One', 'Two', 'Three', 'Four']);
    expect(textItems(layout.pages[1]!.items).map((i) => i.text)).toEqual(['Five']);
  });

  it('never drops content, even a word so oversized each of its emergency-split characters is individually too tall for a page', () => {
    const layout = convert([section([paragraph([run('Huge', { sizePt: 1000 })])])]);
    const allText = layout.pages.flatMap((p) => textItems(p.items)).map((i) => i.text).join('');
    expect(allText).toBe('Huge'); // every character survives, however many pages it took to place them
  });
});

describe('convertWordprocessingToLayout: explicit page breaks', () => {
  it('starts a new page at a pageBreak block, even when the current page has room left', () => {
    const layout = convert([section([paragraph([run('Before', { sizePt: 10 })]), { kind: 'pageBreak' }, paragraph([run('After', { sizePt: 10 })])])]);
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((i) => i.text)).toEqual(['Before']);
    expect(textItems(layout.pages[1]!.items).map((i) => i.text)).toEqual(['After']);
  });

  it('does not emit a blank leading page for a pageBreak with nothing before it', () => {
    const layout = convert([section([{ kind: 'pageBreak' }, paragraph([run('After', { sizePt: 10 })])])]);
    expect(layout.pages).toHaveLength(1);
  });

  it('skips spacingBeforePt for a paragraph that starts a fresh page, avoiding stacked whitespace at the top', () => {
    const layout = convert([
      section([paragraph([run('Before', { sizePt: 10 })]), { kind: 'pageBreak' }, paragraph([run('After', { sizePt: 10 })], { spacingBeforePt: 1000 })]),
    ]);
    const [afterText] = textItems(layout.pages[1]!.items);
    // If spacingBeforePt had been applied, the baseline would be far off the page (1000+8 down from the top); instead it should sit at the same position an ordinary first line on a fresh page would.
    expect(afterText?.yPt).toBe(42);
  });
});

describe('convertWordprocessingToLayout: hyperlinks', () => {
  it('emits a LayoutLink alongside the text for a hyperlinked run', () => {
    const layout = convert([section([paragraph([run('link', { sizePt: 10, hyperlink: 'https://example.com' })])])]);
    const links = layout.pages[0]!.items.filter((i): i is LayoutLink => i.kind === 'link');
    expect(links).toHaveLength(1);
    expect(links[0]?.uri).toBe('https://example.com');
  });
});

describe('convertWordprocessingToLayout: images', () => {
  it('places an image at the content cursor, flipped, and registers it in the image registry', () => {
    const layout = convert([section([tinyPngBlock()])]);
    const [image] = layout.pages[0]!.items.filter((i): i is LayoutImage => i.kind === 'image');
    expect(image).toBeDefined();
    // flipY at cursor 0 on a 50pt-tall page with a 20pt image: yPt = 50 - 0 - 20 = 30.
    expect(image?.yPt).toBe(30);
    expect(layout.images[image!.imageId]?.format).toBe('png');
  });

  it('advances the cursor past a placed image for subsequent content', () => {
    const layout = convert([section([tinyPngBlock(), paragraph([run('After image', { sizePt: 10 })])])]);
    const [text] = textItems(layout.pages[0]!.items);
    // cursor after a 20pt image = 20; baseline = 20+8=28 -> y = 50-28 = 22.
    expect(text?.yPt).toBe(22);
  });
});

describe('convertWordprocessingToLayout: tables', () => {
  function tableWithRowHeights(...heights: number[]): ContentTable {
    return {
      kind: 'table',
      columnWidthsPt: [100],
      rows: heights.map((h, i) => ({ heightPt: h, cells: [{ blocks: [paragraph([run(`Row${i}`, { sizePt: 10 })])] }] })),
    };
  }

  it('positions each row\'s text stacked by row height', () => {
    const layout = convert([section([tableWithRowHeights(10, 10)])]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(['Row0', 'Row1']);
  });

  it('splits a table row-atomically: a row that doesn\'t fit moves entirely to a new page rather than splitting', () => {
    const layout = convert([section([tableWithRowHeights(30, 30)])]); // page height 50: row0 fits (0-30), row1 (30+30=60) doesn't
    expect(layout.pages).toHaveLength(2);
    expect(textItems(layout.pages[0]!.items).map((i) => i.text)).toEqual(['Row0']);
    expect(textItems(layout.pages[1]!.items).map((i) => i.text)).toEqual(['Row1']);
  });

  it('emits a background rect for a cell with a fill colour', () => {
    const table: ContentTable = { kind: 'table', columnWidthsPt: [100], rows: [{ heightPt: 20, cells: [{ blocks: [], background: { r: 1, g: 0, b: 0 } }] }] };
    const layout = convert([section([table])]);
    const rects = layout.pages[0]!.items.filter((i): i is LayoutRect => i.kind === 'rect');
    expect(rects).toHaveLength(1);
    expect(rects[0]?.fill).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('scales column widths proportionally to fit the content width', () => {
    const table: ContentTable = { kind: 'table', columnWidthsPt: [50, 50], rows: [{ heightPt: 10, cells: [{ blocks: [] }, { blocks: [paragraph([run('B', { sizePt: 10 })])] }] }] };
    const layout = convert([section([table], { pageSize: { widthPt: 200, heightPt: 50 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 } })]);
    // grid width 100 scaled to content width 200 -> scale 2; second column starts at 50*2=100.
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.xPt).toBe(100);
  });
});

describe('convertWordprocessingToLayout: indentation and alignment', () => {
  it('offsets a paragraph by its own indentLeftPt', () => {
    const layout = convert([section([paragraph([run('Hi', { sizePt: 10 })], { indentLeftPt: 20 })])]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.xPt).toBe(20);
  });

  it('centers a line within the content width', () => {
    const layout = convert([section([paragraph([run('hi', { sizePt: 10 })], { alignment: 'center' })])]);
    const [text] = textItems(layout.pages[0]!.items);
    // width('hi')=2; content width 100; offset=(100-2)/2=49.
    expect(text?.xPt).toBe(49);
  });
});
