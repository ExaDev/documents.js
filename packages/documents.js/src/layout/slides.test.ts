import { bytesToBase64 } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import type { ContentImageBlock, ContentParagraph, ContentRun, ContentShape, ContentSlide, ContentTable, LayoutImage, LayoutItem, LayoutLink, LayoutRect, LayoutText } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from '../model/content';
import type { ContentDocument } from '../model/content';
import type { TextMeasurer } from 'pdf-codec';
import { encodePng } from 'pdf-codec';
import { convertPresentationToLayout } from './slides';

const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };

// Every character is exactly sizePt/10 pt wide -- the same fake measurer convention already used in pdf-codec's own text-layout.test.ts and content-write.test.ts, so wrap-point and position assertions can be exact.
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

function shape(overrides: Partial<ContentShape> = {}): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks: [],
    ...overrides,
  };
}

function slide(shapes: ContentShape[], size = { widthPt: 960, heightPt: 540 }): ContentSlide {
  return { size, shapes, notes: '' };
}

function presentationDoc(slides: ContentSlide[]): Extract<ContentDocument, { kind: 'presentation' }> {
  return { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, slides };
}

function convert(slides: ContentSlide[]) {
  return convertPresentationToLayout(presentationDoc(slides), { measurer: fakeMeasurer() }).document;
}

function textItems(items: readonly LayoutItem[]): LayoutText[] {
  return items.filter((i): i is LayoutText => i.kind === 'text');
}

function imageItems(items: readonly LayoutItem[]): LayoutImage[] {
  return items.filter((i): i is LayoutImage => i.kind === 'image');
}

function tinyPngBlock(): ContentImageBlock {
  const bytes = encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]) });
  return { kind: 'image', format: 'png', base64: bytesToBase64(bytes), widthPt: 50, heightPt: 30 };
}

describe('convertPresentationToLayout: page size', () => {
  it('maps each slide\'s size directly to its page', () => {
    const layout = convert([slide([], { widthPt: 960, heightPt: 540 })]);
    expect(layout.pages[0]).toMatchObject({ widthPt: 960, heightPt: 540 });
  });

  it('produces one page per slide, in slide order', () => {
    const layout = convert([slide([], { widthPt: 100, heightPt: 100 }), slide([], { widthPt: 200, heightPt: 200 })]);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]?.widthPt).toBe(100);
    expect(layout.pages[1]?.widthPt).toBe(200);
  });
});

describe('convertPresentationToLayout: text position and the Y-flip', () => {
  it('flips a single line of text from OOXML top-left/y-down into PDF bottom-left/y-up', () => {
    const s = shape({ frame: { xPt: 10, yPt: 20, widthPt: 200, heightPt: 50 }, blocks: [paragraph([run('Hi', { sizePt: 10, color: BLACK })])] });
    const layout = convert([slide([s], { widthPt: 960, heightPt: 540 })]);
    const [text] = textItems(layout.pages[0]!.items);
    // contentTopYDown = 20; ascent = 10*0.8 = 8; baselineYDown = 28; baselineYUp = 540 - 28 = 512.
    expect(text?.text).toBe('Hi');
    expect(text?.xPt).toBe(10);
    expect(text?.yPt).toBe(512);
    expect(text?.sizePt).toBe(10);
    expect(text?.color).toEqual(BLACK);
  });

  it('wraps a paragraph across multiple lines within the shape\'s content width, stacking them by line height', () => {
    const s = shape({ frame: { xPt: 0, yPt: 0, widthPt: 8, heightPt: 50 }, blocks: [paragraph([run('hello world', { sizePt: 10 })])] });
    const layout = convert([slide([s], { widthPt: 960, heightPt: 100 })]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(['hello', 'world']);
    // line height = 10*1.2 = 12; line0 baseline = 0+8=8 -> y=100-8=92; line1 baseline=12+8=20 -> y=100-20=80.
    expect(items[0]?.yPt).toBe(92);
    expect(items[1]?.yPt).toBe(80);
  });

  it('offsets the content area by the shape\'s own insets', () => {
    const s = shape({ frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 }, insetLeftPt: 5, insetTopPt: 3, blocks: [paragraph([run('Hi', { sizePt: 10 })])] });
    const layout = convert([slide([s], { widthPt: 960, heightPt: 100 })]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.xPt).toBe(5);
    // baselineYDown = insetTopPt(3) + ascent(8) = 11 -> y = 100-11=89.
    expect(text?.yPt).toBe(89);
  });
});

describe('convertPresentationToLayout: alignment', () => {
  it('centers a line within the content width', () => {
    const s = shape({ frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 }, blocks: [paragraph([run('hi', { sizePt: 10 })], { alignment: 'center' })] });
    const layout = convert([slide([s])]);
    const [text] = textItems(layout.pages[0]!.items);
    // width('hi')=2; offset = (100-2)/2 = 49.
    expect(text?.xPt).toBe(49);
  });

  it('right-aligns a line within the content width', () => {
    const s = shape({ frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 }, blocks: [paragraph([run('hi', { sizePt: 10 })], { alignment: 'right' })] });
    const layout = convert([slide([s])]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.xPt).toBe(98);
  });
});

describe('convertPresentationToLayout: fontScale and lineSpacingReduction', () => {
  it('scales every run\'s size by the shape\'s fontScale', () => {
    const s = shape({ fontScale: 0.5, blocks: [paragraph([run('Hi', { sizePt: 20 })])] });
    const layout = convert([slide([s])]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.sizePt).toBe(10);
  });

  it('reduces line-to-line spacing by lineSpacingReduction', () => {
    const withoutReduction = shape({ frame: { xPt: 0, yPt: 0, widthPt: 8, heightPt: 50 }, blocks: [paragraph([run('hello world', { sizePt: 10 })])] });
    const withReduction = shape({ frame: { xPt: 0, yPt: 0, widthPt: 8, heightPt: 50 }, lineSpacingReduction: 0.5, blocks: [paragraph([run('hello world', { sizePt: 10 })])] });
    const plain = textItems(convert([slide([withoutReduction], { widthPt: 960, heightPt: 100 })]).pages[0]!.items);
    const reduced = textItems(convert([slide([withReduction], { widthPt: 960, heightPt: 100 })]).pages[0]!.items);
    const plainGap = plain[0]!.yPt - plain[1]!.yPt;
    const reducedGap = reduced[0]!.yPt - reduced[1]!.yPt;
    expect(reducedGap).toBeCloseTo(plainGap * 0.5, 10);
  });
});

describe('convertPresentationToLayout: empty paragraphs', () => {
  it('advances the cursor for a run-less paragraph without emitting a text item for it', () => {
    const s = shape({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
      blocks: [paragraph([run('First', { sizePt: 10 })]), paragraph([]), paragraph([run('Third', { sizePt: 10 })])],
    });
    const layout = convert([slide([s], { widthPt: 960, heightPt: 200 })]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(['First', 'Third']);
    const gapFirstToThird = items[0]!.yPt - items[1]!.yPt;
    const singleLineHeight = 10 * 1.2; // the fake measurer's own lineHeightAtSize
    expect(gapFirstToThird).toBeGreaterThan(singleLineHeight);
  });
});

describe('convertPresentationToLayout: images', () => {
  it('flips an image\'s frame the same way as text, with no rotation for an unrotated shape', () => {
    const s = shape({ frame: { xPt: 10, yPt: 20, widthPt: 50, heightPt: 30 }, blocks: [tinyPngBlock()] });
    const layout = convert([slide([s], { widthPt: 960, heightPt: 100 })]);
    const [image] = imageItems(layout.pages[0]!.items);
    expect(image?.kind).toBe('image');
    // flipY: yPt = 100 - 20 - 30 = 50.
    expect(image?.xPt).toBe(10);
    expect(image?.yPt).toBe(50);
    expect(image?.widthPt).toBe(50);
    expect(image?.heightPt).toBe(30);
    expect(image?.rotationDeg).toBeUndefined();
  });

  it('registers a decoded image in the document\'s image registry, with real pixel dimensions', () => {
    const s = shape({ blocks: [tinyPngBlock()] });
    const layout = convert([slide([s])]);
    const [image] = imageItems(layout.pages[0]!.items);
    const asset = image === undefined ? undefined : layout.images[image.imageId];
    expect(asset?.format).toBe('png');
    expect(asset?.widthPx).toBe(2);
    expect(asset?.heightPx).toBe(2);
  });

  it('deduplicates an identical image referenced from two different shapes', () => {
    const block = tinyPngBlock();
    const s1 = shape({ frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 30 }, blocks: [block] });
    const s2 = shape({ frame: { xPt: 60, yPt: 0, widthPt: 50, heightPt: 30 }, blocks: [block] });
    const layout = convert([slide([s1, s2])]);
    const images = layout.pages[0]!.items.filter((i): i is LayoutImage => i.kind === 'image');
    expect(images).toHaveLength(2);
    expect(images[0]?.imageId).toBe(images[1]?.imageId);
    expect(Object.keys(layout.images)).toHaveLength(1);
  });
});

describe('convertPresentationToLayout: tables', () => {
  function tableShape(): ContentShape {
    const table: ContentTable = {
      kind: 'table',
      columnWidthsPt: [50, 50],
      rows: [
        {
          heightPt: 20,
          cells: [
            { blocks: [paragraph([run('A', { sizePt: 10 })])], background: RED },
            { blocks: [paragraph([run('B', { sizePt: 10 })])] },
          ],
        },
      ],
    };
    return shape({ frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 }, blocks: [table] });
  }

  it('positions each cell\'s text at its own column offset', () => {
    const layout = convert([slide([tableShape()], { widthPt: 960, heightPt: 100 })]);
    const items = textItems(layout.pages[0]!.items);
    expect(items.map((i) => i.text)).toEqual(['A', 'B']);
    expect(items[0]?.xPt).toBe(0);
    expect(items[1]?.xPt).toBe(50);
  });

  it('emits a background rect for a cell with a fill colour, sized to the cell', () => {
    const layout = convert([slide([tableShape()], { widthPt: 960, heightPt: 100 })]);
    const rects = layout.pages[0]!.items.filter((i): i is LayoutRect => i.kind === 'rect');
    expect(rects).toHaveLength(1);
    expect(rects[0]?.fill).toEqual(RED);
    expect(rects[0]?.widthPt).toBe(50);
    expect(rects[0]?.heightPt).toBe(20);
  });
});

describe('convertPresentationToLayout: hyperlinks', () => {
  it('emits a LayoutLink alongside the text for a hyperlinked run', () => {
    const s = shape({ frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 }, blocks: [paragraph([run('link', { sizePt: 10, hyperlink: 'https://example.com' })])] });
    const layout = convert([slide([s], { widthPt: 960, heightPt: 100 })]);
    const links = layout.pages[0]!.items.filter((i): i is LayoutLink => i.kind === 'link');
    expect(links).toHaveLength(1);
    expect(links[0]?.uri).toBe('https://example.com');
    expect(links[0]?.widthPt).toBe(4); // 'link' = 4 chars * (10/10)
  });

  it('emits no link for a run with no hyperlink', () => {
    const s = shape({ blocks: [paragraph([run('plain', { sizePt: 10 })])] });
    const layout = convert([slide([s])]);
    const links = layout.pages[0]!.items.filter((i) => i.kind === 'link');
    expect(links).toHaveLength(0);
  });
});

describe('convertPresentationToLayout: rotation', () => {
  it('rotates a shape\'s text about the shape\'s own centre, matching rotatePointAboutCenter', () => {
    const s = shape({ frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 }, rotationDeg: 180, blocks: [paragraph([run('R', { sizePt: 10 })])] });
    const layout = convert([slide([s], { widthPt: 960, heightPt: 100 })]);
    const [text] = textItems(layout.pages[0]!.items);
    // Unrotated anchor: x=0, baselineYDown=8 -> y=100-8=92. Centre=(50,50). 180-degree rotation about (50,50): (0,92) -> (100,8).
    expect(text?.xPt).toBeCloseTo(100, 6);
    expect(text?.yPt).toBeCloseTo(8, 6);
    expect(text?.rotationDeg).toBeCloseTo(-180, 6); // DrawingML clockwise -> PDF counter-clockwise
  });

  it('leaves rotationDeg undefined for an unrotated shape', () => {
    const s = shape({ blocks: [paragraph([run('x', { sizePt: 10 })])] });
    const layout = convert([slide([s])]);
    const [text] = textItems(layout.pages[0]!.items);
    expect(text?.rotationDeg).toBeUndefined();
  });

  it('skips table cell background rects for a rotated shape rather than positioning them unrotated', () => {
    const table: ContentTable = { kind: 'table', columnWidthsPt: [50], rows: [{ cells: [{ blocks: [], background: RED }] }] };
    const s = shape({ frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 }, rotationDeg: 45, blocks: [table] });
    const layout = convert([slide([s])]);
    const rects = layout.pages[0]!.items.filter((i) => i.kind === 'rect');
    expect(rects).toHaveLength(0);
  });
});
