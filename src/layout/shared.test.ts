import { bytesToBase64 } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import type { ContentRun, ContentTableRow, LayoutImageAsset } from 'document-content-model';
import { encodePng } from '../image/png-encode';
import type { TextMeasurer } from '../pdf/measure';
import { alignmentOffsetPt, effectiveStyledRuns, estimateRowHeightPt, lineNaturalHeightPt, NOMINAL_TEXT_SIZE_PT, registerImage, runFont, sumColumnWidthsPt, toStyledRuns } from './shared';

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

describe('runFont', () => {
  it('maps bold/italic to weight/style, defaulting to normal', () => {
    expect(runFont(run('x'))).toEqual({ family: 'Helvetica', weight: 'normal', style: 'normal' });
    expect(runFont(run('x', { bold: true, italic: true }))).toEqual({ family: 'Helvetica', weight: 'bold', style: 'italic' });
  });

  it('uses the run\'s own fontFamily when present', () => {
    expect(runFont(run('x', { fontFamily: 'Georgia' })).family).toBe('Georgia');
  });
});

describe('toStyledRuns', () => {
  it('scales size by fontScale and falls back to black for an unset colour', () => {
    const [styled] = toStyledRuns([run('x', { sizePt: 20 })], 0.5);
    expect(styled?.sizePt).toBe(10);
    expect(styled?.color).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('defaults fontScale to 1 when omitted', () => {
    const [styled] = toStyledRuns([run('x', { sizePt: 20 })]);
    expect(styled?.sizePt).toBe(20);
  });

  it('substitutes the nominal size for a run with no sizePt of its own', () => {
    const [styled] = toStyledRuns([run('x')]);
    expect(styled?.sizePt).toBe(NOMINAL_TEXT_SIZE_PT);
  });
});

describe('effectiveStyledRuns', () => {
  it('synthesises a single nominal-size run for an empty run list', () => {
    const runs = effectiveStyledRuns([]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.text).toBe('');
    expect(runs[0]?.sizePt).toBe(NOMINAL_TEXT_SIZE_PT);
  });

  it('applies fontScale to the synthesised fallback too', () => {
    const runs = effectiveStyledRuns([], 0.5);
    expect(runs[0]?.sizePt).toBe(NOMINAL_TEXT_SIZE_PT * 0.5);
  });

  it('passes non-empty runs through toStyledRuns unchanged in count', () => {
    expect(effectiveStyledRuns([run('a'), run('b')])).toHaveLength(2);
  });
});

describe('lineNaturalHeightPt', () => {
  it('takes the max lineHeightAtSize across a line\'s fragments', () => {
    const measurer = fakeMeasurer();
    const line = {
      fragments: [
        { text: 'a', font: { family: 'Helvetica', weight: 'normal', style: 'normal' } as const, sizePt: 10, color: { r: 0, g: 0, b: 0 }, xOffsetPt: 0 },
        { text: 'b', font: { family: 'Helvetica', weight: 'normal', style: 'normal' } as const, sizePt: 20, color: { r: 0, g: 0, b: 0 }, xOffsetPt: 1 },
      ],
      widthPt: 2,
      maxSizePt: 20,
      ascentPt: 16,
      descentPt: -4,
    };
    expect(lineNaturalHeightPt(line, measurer, { text: '', font: { family: 'Helvetica', weight: 'normal', style: 'normal' }, sizePt: 10, color: { r: 0, g: 0, b: 0 } })).toBe(24); // 20*1.2
  });

  it('falls back to the given fallback run\'s own height for a fragment-less (empty) line', () => {
    const measurer = fakeMeasurer();
    const emptyLine = { fragments: [], widthPt: 0, maxSizePt: 0, ascentPt: 0, descentPt: 0 };
    const fallback = { text: '', font: { family: 'Helvetica', weight: 'normal', style: 'normal' } as const, sizePt: 10, color: { r: 0, g: 0, b: 0 } };
    expect(lineNaturalHeightPt(emptyLine, measurer, fallback)).toBe(12); // 10*1.2
  });
});

describe('alignmentOffsetPt', () => {
  it('centers, right-aligns, and defaults to left (including justify, not yet implemented)', () => {
    expect(alignmentOffsetPt('center', 100, 20)).toBe(40);
    expect(alignmentOffsetPt('right', 100, 20)).toBe(80);
    expect(alignmentOffsetPt('left', 100, 20)).toBe(0);
    expect(alignmentOffsetPt('justify', 100, 20)).toBe(0);
    expect(alignmentOffsetPt(undefined, 100, 20)).toBe(0);
  });

  it('never returns a negative offset for a line wider than the content area', () => {
    expect(alignmentOffsetPt('center', 10, 20)).toBe(0);
    expect(alignmentOffsetPt('right', 10, 20)).toBe(0);
  });
});

describe('registerImage', () => {
  function tinyPngBlock() {
    const bytes = encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]) });
    return { kind: 'image' as const, format: 'png' as const, base64: bytesToBase64(bytes), widthPt: 10, heightPt: 10 };
  }

  it('registers a new image and returns a stable, deterministic id for identical content', () => {
    const images: Record<string, LayoutImageAsset> = {};
    const block = tinyPngBlock();
    const id1 = registerImage(block, images);
    const id2 = registerImage(block, images);
    expect(id1).toBe(id2);
    expect(Object.keys(images)).toHaveLength(1);
    expect(images[id1]?.widthPx).toBe(2);
    expect(images[id1]?.heightPx).toBe(2);
  });
});

describe('sumColumnWidthsPt', () => {
  it('sums a span of columns starting at an index', () => {
    expect(sumColumnWidthsPt([10, 20, 30, 40], 1, 2)).toBe(50);
  });

  it('clamps to the array bounds rather than reading past the end', () => {
    expect(sumColumnWidthsPt([10, 20], 1, 5)).toBe(20);
  });
});

describe('estimateRowHeightPt', () => {
  it('falls back to a nominal minimum for an empty row', () => {
    const measurer = fakeMeasurer();
    const row: ContentTableRow = { cells: [{ blocks: [] }] };
    expect(estimateRowHeightPt(row, measurer, [100], 1)).toBeGreaterThan(0);
  });

  it('grows to fit the tallest wrapped line across all cells', () => {
    const measurer = fakeMeasurer();
    const row: ContentTableRow = { cells: [{ blocks: [{ kind: 'paragraph', runs: [run('hi', { sizePt: 100 })] }] }] };
    const height = estimateRowHeightPt(row, measurer, [100], 1);
    expect(height).toBeCloseTo(100 * 1.2, 6); // lineHeightAtSize(100) via the fake measurer
  });
});
