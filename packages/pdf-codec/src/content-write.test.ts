import { describe, expect, it } from 'vitest';
import type { TextMeasurer } from 'document-schema.js';
import type { LayoutEllipse, LayoutImage, LayoutLine, LayoutLink, LayoutRect, LayoutText } from './layout';
import type { ContentWriteContext } from './content-write';
import { writeContentStream } from './content-write';
import type { EmbeddedFace } from './embedded-font';
import { encodeForShowEmbedded, loadEmbeddedFace } from './embedded-font';
import { formatNumber } from './serialize';
import { parseSfnt } from './sfnt';
import { carlitoRegularBytes } from './test-support/fonts';

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
    resolveFont: () => ({ kind: 'standard', resourceName: 'F1', standardName: 'Helvetica' }),
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
    const context: ContentWriteContext = { ...fakeContext(), resolveFont: () => ({ kind: 'standard', resourceName: 'F7', standardName: 'Times-Roman' }) };
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

// The embedded-face branch of writeText. Every assertion here is against a fake measurer whose own answers are deliberately WRONG for this face (a 0.92 horizontal scale, a 0.1em underline offset) -- so a test passing proves the branch read the resolved face's own metrics rather than the measurer's, which is the whole point of resolving them off ResolvedFontResource instead.
describe('writeContentStream: text in an embedded face', () => {
  function embeddedFace(): EmbeddedFace {
    const sfnt = parseSfnt(carlitoRegularBytes());
    if (sfnt === undefined) {
      throw new Error('vendored Carlito Regular failed to parse as an sfnt container');
    }
    const face = loadEmbeddedFace(sfnt);
    if (face === undefined) {
      throw new Error('vendored Carlito Regular failed to load as an embeddable face');
    }
    return face;
  }

  function embeddedContext(face: EmbeddedFace, scale = 0.92): ContentWriteContext {
    return { ...fakeContext(scale), resolveFont: () => ({ kind: 'embedded', resourceName: 'E1', face }) };
  }

  it('emits BT/Tf/Tz/rg/Tm/Tj/ET with the embedded resource name and 2-byte Identity-H CIDs', () => {
    const face = embeddedFace();
    const item: LayoutText = { kind: 'text', text: 'Hi', xPt: 10, yPt: 20, font: HELVETICA, sizePt: 12, color: BLACK };
    const { bytes, substitutions, missingGlyphs } = writeContentStream([item], embeddedContext(face));
    const hex = [...encodeForShowEmbedded('Hi', face).codes].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(decode(bytes)).toBe(`BT\n/E1 12 Tf\n100 Tz\n0 0 0 rg\n1 0 0 1 10 20 Tm\n<${hex}> Tj\nET\n`);
    expect(hex).toHaveLength('Hi'.length * 4); // two bytes per character, unlike a WinAnsi string's one
    // Carlito kerns nothing between 'H' and 'i', so this stays one unsplit string shown with Tj -- byte for byte what this module emitted before pair kerning existed.
    expect(decode(bytes)).not.toContain('TJ');
    expect(substitutions).toHaveLength(0);
    expect(missingGlyphs).toHaveLength(0);
  });

  it('shows a kerned run as a real TJ array, splitting the CIDs at each of the face\'s own adjustments', () => {
    const item: LayoutText = { kind: 'text', text: 'AVATAR', xPt: 10, yPt: 20, font: HELVETICA, sizePt: 12, color: BLACK };
    const text = decode(writeContentStream([item], embeddedContext(embeddedFace())).bytes);
    // Carlito's own AV/VA/AT/TA adjustments, -89/-96/-160/-160 design units on its 2048-unit em, as PDF TJ numbers: NEGATED, because ISO 32000-1 9.4.3 defines a TJ number as being subtracted from the current horizontal coordinate, so tightening a pair is a positive number. The final pair (AR) is one the font covers and adjusts by nothing, so it splits nothing and the last two glyphs stay in one string.
    expect(text).toBe('BT\n/E1 12 Tf\n100 Tz\n0 0 0 rg\n1 0 0 1 10 20 Tm\n[<0003> 43.457 <0028> 46.875 <0003> 78.125 <0024> 78.125 <00030021>] TJ\nET\n');
    // Concatenating the array's own strings back together gives exactly the CIDs an unkerned Tj would have shown: the split repositions glyphs, it never changes which ones are drawn.
    const hex = [...encodeForShowEmbedded('AVATAR', embeddedFace()).codes].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('000300280003002400030021');
  });

  it('measures a kerned run\'s underline at the kerned width, not the bare advance sum', () => {
    const face = embeddedFace();
    const item: LayoutText = { kind: 'text', text: 'AVATAR', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 12, color: BLACK, underline: true };
    const text = decode(writeContentStream([item], embeddedContext(face)).bytes);
    // The same width1000 the TJ array above actually advances by (3086.9140625 at size 1000), not the 3333.49609375 its glyphs' bare advances sum to -- an underline drawn to the unkerned sum would overhang the text it underlines by nearly three points at this size.
    expect(text).toContain(` ${formatNumber((encodeForShowEmbedded('AVATAR', face).width1000 / 1000) * 12)} `);
    expect(text).toContain(` ${formatNumber((3086.9140625 / 1000) * 12)} `);
    expect(text).not.toContain(` ${formatNumber((3333.49609375 / 1000) * 12)} `);
  });

  it('always writes 100 Tz, never the measurer\'s standard-14 width correction', () => {
    const item: LayoutText = { kind: 'text', text: 'A', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK };
    const text = decode(writeContentStream([item], embeddedContext(embeddedFace(), 0.92)).bytes);
    expect(text).toContain('100 Tz\n');
    expect(text).not.toContain('92 Tz\n');
  });

  it('draws the underline from the face\'s own post metrics, not the measurer\'s', () => {
    // Carlito Regular's raw 'post': underlinePosition -103, underlineThickness 194 design units on a 2048-unit em -- so at size 10, -0.502929... and 0.947265... points.
    const item: LayoutText = { kind: 'text', text: 'A', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: RED, underline: true, widthPt: 5 };
    const text = decode(writeContentStream([item], embeddedContext(embeddedFace())).bytes);
    expect(text).toContain(`0 ${formatNumber((-103 * 10) / 2048)} 5 ${formatNumber((194 * 10) / 2048)} re\n`);
    // The fake measurer's own answers for size 10 are -1 and 0.5; neither may appear.
    expect(text).not.toContain('0 -1 5 0.5 re\n');
  });

  it('falls back to the face\'s own measured width for an underline with no widthPt, with no scale applied', () => {
    const face = embeddedFace();
    const item: LayoutText = { kind: 'text', text: 'Hi', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK, underline: true };
    const text = decode(writeContentStream([item], embeddedContext(face)).bytes);
    expect(text).toContain(` ${formatNumber((encodeForShowEmbedded('Hi', face).width1000 / 1000) * 10)} `);
  });

  it('reports a character the face has no glyph for as a missing glyph, not a WinAnsi substitution', () => {
    const item: LayoutText = { kind: 'text', text: 'a中b', xPt: 0, yPt: 0, font: HELVETICA, sizePt: 10, color: BLACK };
    const { substitutions, missingGlyphs } = writeContentStream([item], embeddedContext(embeddedFace()));
    expect(missingGlyphs).toEqual([{ from: '中' }]);
    expect(substitutions).toHaveLength(0);
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

// Every expectation below asserts the FULL emitted operator string, not a substring or a byte count: the whole point of the style field is the exact dash array, phase, and cap the graphics state ends up carrying, and a "contains [6 6]" assertion would pass just as happily on a stream that also left the pattern set for every later item on the page.
describe('writeContentStream: line -- stroke style', () => {
  // A 90pt horizontal rule at 2pt wide, so every derived length below is a clean multiple: dashes at 3x the stroke width are 6pt on, 6pt off; a dotted gap at 2x is 4pt.
  const rule: LayoutLine = { kind: 'line', x1Pt: 10, y1Pt: 10, x2Pt: 100, y2Pt: 10, color: BLACK, widthPt: 2 };

  it('emits nothing extra for an absent style', () => {
    const text = decode(writeContentStream([rule], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n2 w\n10 10 m 100 10 l\nS\n');
  });

  it("emits nothing extra for style: 'solid', which means exactly what an absent style means", () => {
    const text = decode(writeContentStream([{ ...rule, style: 'solid' }], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n2 w\n10 10 m 100 10 l\nS\n');
  });

  it("emits a [6 6] 0 d dash array (3x the 2pt stroke width, on and off) before the stroke and resets it to [] 0 d after", () => {
    const text = decode(writeContentStream([{ ...rule, style: 'dashed' }], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n2 w\n[6 6] 0 d\n10 10 m 100 10 l\nS\n[] 0 d\n');
  });

  // The zero on-length is what makes these dots rather than short dashes, and it only paints at all under the round cap: 1 J turns each zero-length segment into a single circle of diameter = the 2pt stroke width, while the default 0 J would paint literally nothing.
  it('emits a [0 4] 0 d dash array and a 1 J round cap for dotted, resetting both afterwards', () => {
    const text = decode(writeContentStream([{ ...rule, style: 'dotted' }], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n2 w\n[0 4] 0 d\n1 J\n10 10 m 100 10 l\nS\n[] 0 d\n0 J\n');
  });

  // 3pt splits into three 1pt bands -- ink, gap, ink -- so each rule is 1pt wide and sits 1pt either side of y=10, putting the pair's outer edges exactly where the single 3pt stroke's own edges would have been.
  it('draws double as two real 1pt strokes offset perpendicular by 1pt either side of a 3pt line', () => {
    const doubled: LayoutLine = { ...rule, widthPt: 3, style: 'double' };
    const text = decode(writeContentStream([doubled], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n1 w\n10 11 m 100 11 l\nS\n10 9 m 100 9 l\nS\n');
  });

  // A vertical line's perpendicular is horizontal: the offsets have to follow the line's own direction, not a fixed axis.
  it('offsets a vertical double line horizontally, not vertically', () => {
    const vertical: LayoutLine = { kind: 'line', x1Pt: 50, y1Pt: 0, x2Pt: 50, y2Pt: 30, color: BLACK, widthPt: 3, style: 'double' };
    const text = decode(writeContentStream([vertical], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n1 w\n49 0 m 49 30 l\nS\n51 0 m 51 30 l\nS\n');
  });

  // A degenerate line has no direction, so there is no perpendicular to offset along; drawing it once at its declared width is the only thing left that isn't an invented direction.
  it('falls back to a single stroke at the declared width for a zero-length double line', () => {
    const degenerate: LayoutLine = { kind: 'line', x1Pt: 7, y1Pt: 7, x2Pt: 7, y2Pt: 7, color: BLACK, widthPt: 3, style: 'double' };
    const text = decode(writeContentStream([degenerate], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n3 w\n7 7 m 7 7 l\nS\n');
  });

  // The regression this reset exists to prevent: the PDF graphics state persists for the whole content stream, so without the trailing [] 0 d the rect below would be stroked dashed too, on a page that never asked for it.
  it('leaves the dash pattern reset before a later, unrelated item in the same stream', () => {
    const rect: LayoutRect = { kind: 'rect', xPt: 0, yPt: 0, widthPt: 5, heightPt: 5, stroke: { color: RED, widthPt: 1 } };
    const text = decode(writeContentStream([{ ...rule, style: 'dashed' }, rect], fakeContext()).bytes);
    expect(text).toBe('0 0 0 RG\n2 w\n[6 6] 0 d\n10 10 m 100 10 l\nS\n[] 0 d\n1 0 0 RG\n1 w\n0 0 5 5 re\nS\n');
  });

  it('leaves both the dash pattern and the line cap reset before a later item after a dotted line', () => {
    const plain: LayoutLine = { kind: 'line', x1Pt: 0, y1Pt: 0, x2Pt: 10, y2Pt: 0, color: RED, widthPt: 1 };
    const text = decode(writeContentStream([{ ...rule, style: 'dotted' }, plain], fakeContext()).bytes);
    expect(text.endsWith('[] 0 d\n0 J\n1 0 0 RG\n1 w\n0 0 m 10 0 l\nS\n')).toBe(true);
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
