import { describe, expect, it } from 'vitest';
import type { LayoutEllipse, LayoutImage, LayoutLine, LayoutLink, LayoutRect, LayoutText } from 'document-content-model';
import type { ContentWriteContext } from './content-write';
import { writeContentStream } from './content-write';
import type { TextMeasurer } from './measure';

const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };
const HELVETICA = { family: 'Helvetica', weight: 'normal', style: 'normal' } as const;

function fakeMeasurer(scale = 1): TextMeasurer {
  return {
    widthOfTextAtSize: () => 0,
    lineHeightAtSize: (_font, sizePt) => sizePt * 1.2,
    ascenderAtSize: (_font, sizePt) => sizePt * 0.8,
    descenderAtSize: (_font, sizePt) => -sizePt * 0.2,
    underlineAtSize: (_font, sizePt) => ({ offsetPt: -sizePt * 0.1, thicknessPt: sizePt * 0.05 }),
    horizontalScaleFor: () => scale,
  };
}

function fakeContext(scale = 1): ContentWriteContext {
  return {
    measurer: fakeMeasurer(scale),
    resolveFont: () => ({ resourceName: 'F1', standardName: 'Helvetica' }),
    resolveImage: () => ({ resourceName: 'Im1' }),
  };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('writeContentStream: text', () => {
  it('emits BT/Tf/Tz/rg/Tm/Tj/ET in order, with an absolute Tm and a hex-string operand', () => {
    const item: LayoutText = { kind: 'text', text: 'AA', xPt: 10, yPt: 20, font: HELVETICA, sizePt: 12, color: BLACK };
    const { bytes, substitutions } = writeContentStream([item], fakeContext());
    const text = decode(bytes);
    expect(text).toBe('BT\n/F1 12 Tf\n100 Tz\n0 0 0 rg\n1 0 0 1 10 20 Tm\n<4141> Tj\nET\n');
    expect(substitutions).toHaveLength(0);
  });

  it('always writes an explicit Tz even at 100%, so a prior item\'s correction can never leak in', () => {
    const item: LayoutText = { kind: 'text', text: 'A', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK };
    const text = decode(writeContentStream([item], fakeContext(1)).bytes);
    expect(text).toContain('100 Tz\n');
  });

  it('applies the measurer\'s width correction as a Tz percentage', () => {
    const item: LayoutText = { kind: 'text', text: 'A', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK };
    const text = decode(writeContentStream([item], fakeContext(0.92)).bytes);
    expect(text).toContain('92 Tz\n');
  });

  it('bakes rotation directly into Tm as [cos sin -sin cos xPt yPt]', () => {
    const item: LayoutText = { kind: 'text', text: 'A', xPt: 5, yPt: 5, font: HELVETICA, sizePt: 10, color: BLACK, rotationDeg: 90 };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toContain('0 1 -1 0 5 5 Tm\n');
  });

  it('resolves the font resource via the context and uses its name in Tf', () => {
    const item: LayoutText = { kind: 'text', text: 'A', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK };
    const context: ContentWriteContext = { ...fakeContext(), resolveFont: () => ({ resourceName: 'F7', standardName: 'Times-Roman' }) };
    const text = decode(writeContentStream([item], context).bytes);
    expect(text).toContain('/F7 10 Tf\n');
  });

  it('substitutes unencodable characters and reports the substitution', () => {
    const item: LayoutText = { kind: 'text', text: '中', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK };
    const { substitutions } = writeContentStream([item], fakeContext());
    expect(substitutions).toEqual([{ from: '中', to: '?' }]);
  });

  it('draws an underline rectangle after ET when requested, using the measurer\'s AFM-derived metrics', () => {
    const item: LayoutText = { kind: 'text', text: 'AA', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: RED, underline: true, widthPt: 13.34 };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toContain('ET\nq\n1 0 0 1 0 0 cm\n1 0 0 rg\n0 -1 13.34 0.5 re\nf\nQ\n');
  });

  it('does not draw an underline when underline is not set', () => {
    const item: LayoutText = { kind: 'text', text: 'A', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).not.toContain(' re\n');
  });

  it('falls back to the AFM-measured width for the underline when widthPt is not provided', () => {
    // 'AA' in Helvetica at size 1000 is 667 units each (spot-checked in measure.test.ts); at size 10, 2*667/1000*10 = 13.34.
    const item: LayoutText = { kind: 'text', text: 'AA', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK, underline: true };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toContain('0 -1 13.34 0.5 re\n');
  });
});

describe('writeContentStream: rect', () => {
  it('emits fill-only as re + f', () => {
    const item: LayoutRect = { kind: 'rect', xPt: 1, yPt: 2, widthPt: 3, heightPt: 4, fill: RED };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toBe('1 0 0 rg\n1 2 3 4 re\nf\n');
  });

  it('emits stroke-only as re + S, with a line-width w operator', () => {
    const item: LayoutRect = { kind: 'rect', xPt: 0, yPt: 0, widthPt: 5, heightPt: 5, stroke: { color: BLACK, widthPt: 2 } };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n2 w\n0 0 5 5 re\nS\n');
  });

  it('emits fill+stroke as re + B', () => {
    const item: LayoutRect = { kind: 'rect', xPt: 0, yPt: 0, widthPt: 5, heightPt: 5, fill: RED, stroke: { color: BLACK, widthPt: 1 } };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toBe('1 0 0 rg\n0 0 0 RG\n1 w\n0 0 5 5 re\nB\n');
  });

  it('skips a rect with neither fill nor stroke entirely, since it paints nothing', () => {
    const item: LayoutRect = { kind: 'rect', xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 };
    const bytes = writeContentStream([item], fakeContext()).bytes;
    expect(bytes).toHaveLength(0);
  });
});

describe('writeContentStream: line', () => {
  it('emits RG, w, m/l, S', () => {
    const item: LayoutLine = { kind: 'line', x1Pt: 0, y1Pt: 0, x2Pt: 10, y2Pt: 10, color: BLACK, widthPt: 1 };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n1 w\n0 0 m 10 10 l\nS\n');
  });
});

describe('writeContentStream: ellipse', () => {
  it('emits a starting point and four Bezier curve segments before the paint operator', () => {
    const item: LayoutEllipse = { kind: 'ellipse', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fill: RED };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    const curveCount = (text.match(/ c\n/g) ?? []).length;
    expect(curveCount).toBe(4);
    expect(text.startsWith('1 0 0 rg\n10 5 m\n')).toBe(true);
    expect(text.trim().endsWith('f')).toBe(true);
  });

  // The four arcs already return exactly to the starting point, so this `h` draws no additional ink -- but it does mark the subpath explicitly closed, which readPdf's own general path tracking (interpret.ts) needs to see in order to recover a filled ellipse as a closed (and therefore fillable, per real ODF/SVG consumers) subpath rather than an open one -- see this function's own top-of-file note.
  it('emits an explicit h (closepath) before the paint operator, even though the curves already return to their own start point', () => {
    const item: LayoutEllipse = { kind: 'ellipse', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fill: RED, stroke: { color: BLACK, widthPt: 1 } };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toContain('h\nB\n');
  });

  it('skips an ellipse with neither fill nor stroke', () => {
    const item: LayoutEllipse = { kind: 'ellipse', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 };
    const bytes = writeContentStream([item], fakeContext()).bytes;
    expect(bytes).toHaveLength(0);
  });
});

describe('writeContentStream: image', () => {
  it('wraps q/cm/Do/Q, with the CTM scaling to the placed size and translating to the anchor', () => {
    const item: LayoutImage = { kind: 'image', imageId: 'logo', xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    expect(text).toBe('q\n100 0 0 50 10 20 cm\n/Im1 Do\nQ\n');
  });

  it('composes rotation into the CTM ahead of translation', () => {
    const item: LayoutImage = { kind: 'image', imageId: 'logo', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, rotationDeg: 90 };
    const text = decode(writeContentStream([item], fakeContext()).bytes);
    // scale(10,10) composed with rotate(90) = [0,10,-10,0,0,0]; translated to (0,0) unchanged.
    expect(text).toContain('0 10 -10 0 0 0 cm\n');
  });

  it('resolves the image resource name via the context', () => {
    const item: LayoutImage = { kind: 'image', imageId: 'logo', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 };
    const context: ContentWriteContext = { ...fakeContext(), resolveImage: () => ({ resourceName: 'Im9' }) };
    const text = decode(writeContentStream([item], context).bytes);
    expect(text).toContain('/Im9 Do\n');
  });
});

describe('writeContentStream: link', () => {
  it('contributes no content-stream bytes -- link annotations belong in /Annots, built by write.ts', () => {
    const item: LayoutLink = { kind: 'link', uri: 'https://example.com', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 };
    const bytes = writeContentStream([item], fakeContext()).bytes;
    expect(bytes).toHaveLength(0);
  });
});

describe('writeContentStream: multiple items', () => {
  it('concatenates each item\'s operators in array order', () => {
    const items: LayoutRect[] = [
      { kind: 'rect', xPt: 0, yPt: 0, widthPt: 1, heightPt: 1, fill: RED },
      { kind: 'rect', xPt: 1, yPt: 1, widthPt: 2, heightPt: 2, fill: BLACK },
    ];
    const text = decode(writeContentStream(items, fakeContext()).bytes);
    expect(text).toBe('1 0 0 rg\n0 0 1 1 re\nf\n0 0 0 rg\n1 1 2 2 re\nf\n');
  });
});
