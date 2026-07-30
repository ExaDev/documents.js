import { describe, expect, it } from 'vitest';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import type { FontMetricsPort, PdfObjectResolver } from './interpret';
import { interpretContentStream } from './interpret';
import type { PdfDict, PdfObject } from './objects';
import { asDict, pdfArray, pdfDict, pdfName, pdfNum, pdfRef, pdfStream } from './objects';

function collectDiagnostics(): { sink: PdfDiagnosticSink; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function fixedWidthFontMetrics(widthPer1000 = 500, byteLengthConsumed = 1): FontMetricsPort {
  return { glyphAdvance: () => ({ widthPer1000, byteLengthConsumed }) };
}

function unresolvableFontMetrics(): FontMetricsPort {
  return { glyphAdvance: () => undefined };
}

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined => (obj?.kind === 'ref' ? objects.get(obj.num) : obj);
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined => asDict(resolve(obj));
  return { resolve, resolveDict };
}

const EMPTY_RESOURCES = pdfDict({});

describe('interpretContentStream: text', () => {
  it('extracts a positioned text run with its font size and starting matrix', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(textBytes('BT /F1 12 Tf 10 50 Td (Hi) Tj ET'), EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(items).toHaveLength(1);
    const [item] = items;
    if (item?.kind !== 'text') {
      throw new Error('expected a text item');
    }
    expect(item.fontResourceName).toBe('F1');
    expect(item.sizePt).toBe(12);
    expect(item.startMatrix).toEqual([12, 0, 0, 12, 10, 50]);
    expect(Array.from(item.codes)).toEqual(Array.from(textBytes('Hi')));
  });

  it('uses the current fill colour (rg) for the text run', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(textBytes('1 0 0 rg BT /F1 12 Tf 0 0 Td (X) Tj ET'), EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    const [item] = items;
    if (item?.kind !== 'text') {
      throw new Error('expected a text item');
    }
    expect(item.color).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('advances the end matrix by the measured glyph widths, applying word spacing only to a single-byte space code', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(textBytes('BT /F1 10 Tf 0 0 Td 2 Tw (A B) Tj ET'), EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(500, 1),
      resolver: makeResolver(new Map()),
      sink,
    });
    const [item] = items;
    if (item?.kind !== 'text') {
      throw new Error('expected a text item');
    }
    // Three glyphs at width 5 each (500/1000 * 10) plus Tw=2 applied once, to the space alone: 5 + (5+2) + 5 = 17.
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 17, 0]);
  });

  it('does not apply word spacing to a byte value 0x20 inside a multi-byte code', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(textBytes('BT /F1 10 Tf 0 0 Td 2 Tw <004100200042> Tj ET'), EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(500, 2),
      resolver: makeResolver(new Map()),
      sink,
    });
    const [item] = items;
    if (item?.kind !== 'text') {
      throw new Error('expected a text item');
    }
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 15, 0]);
  });

  it('folds a TJ array\'s numeric kerning adjustments into one combined run', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(textBytes('BT /F1 10 Tf 0 0 Td [(A) -100 (V)] TJ ET'), EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(500, 1),
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(items).toHaveLength(1);
    const [item] = items;
    if (item?.kind !== 'text') {
      throw new Error('expected a single combined text item');
    }
    expect(Array.from(item.codes)).toEqual(Array.from(textBytes('AV')));
    // 'A' (5) + kerning adjustment (100/1000 * 10 = 1) + 'V' (5) = 11.
    expect(item.endMatrix).toEqual([10, 0, 0, 10, 11, 0]);
  });

  it('applies a rotated CTM to the text rendering matrix', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(textBytes('0 1 -1 0 0 0 cm BT /F1 10 Tf 0 0 Td (X) Tj ET'), EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    const [item] = items;
    if (item?.kind !== 'text') {
      throw new Error('expected a text item');
    }
    expect(item.startMatrix).toEqual([0, 10, -10, 0, 0, 0]);
  });

  it('reports a diagnostic and falls back to a default width when the font cannot be resolved', () => {
    const { sink, diagnostics } = collectDiagnostics();
    interpretContentStream(textBytes('BT /F1 10 Tf 0 0 Td (A) Tj ET'), EMPTY_RESOURCES, {
      fontMetrics: unresolvableFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(diagnostics.some((d) => d.code === 'pdf/font-not-resolved')).toBe(true);
  });
});

describe('interpretContentStream: axis-aligned rectangles', () => {
  it('recovers a rectangle painted under a non-rotated CTM', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(textBytes('1 0 0 rg 10 10 50 20 re f'), EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(items).toEqual([{ kind: 'rect', xPt: 10, yPt: 10, widthPt: 50, heightPt: 20, color: { r: 1, g: 0, b: 0 } }]);
  });

  it('does not recover a rectangle under a rotated CTM', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(textBytes('0 1 -1 0 0 0 cm 10 10 50 20 re f'), EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(items).toEqual([]);
  });

  it('discards a pending rect if any other path-construction operator intervenes', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(textBytes('10 10 50 20 re 0 0 m 1 1 l S f'), EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(items).toEqual([]);
  });
});

describe('interpretContentStream: save/restore', () => {
  it('restores fill colour after Q', () => {
    const { sink } = collectDiagnostics();
    const items = interpretContentStream(textBytes('1 0 0 rg q 0 1 0 rg 0 0 1 1 re f Q 0 0 5 5 re f'), EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ color: { r: 0, g: 1, b: 0 } });
    expect(items[1]).toMatchObject({ color: { r: 1, g: 0, b: 0 } });
  });
});

describe('interpretContentStream: XObjects', () => {
  it('extracts an image placement from Do', () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([[10, pdfStream(pdfDict({ Type: pdfName('XObject'), Subtype: pdfName('Image'), Width: pdfNum(2), Height: pdfNum(2) }), new Uint8Array([1, 2, 3]))]]);
    const resources = pdfDict({ XObject: pdfDict({ Im1: pdfRef(10, 0) }) });
    const items = interpretContentStream(textBytes('q 1 0 0 1 5 5 cm /Im1 Do Q'), resources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(objects),
      sink,
    });
    expect(items).toEqual([{ kind: 'image', resourceName: 'Im1', resources, matrix: [1, 0, 0, 1, 5, 5] }]);
  });

  it('recurses into a Form XObject, composing its own /Matrix into the CTM', () => {
    const { sink } = collectDiagnostics();
    const formDict = pdfDict({
      Type: pdfName('XObject'),
      Subtype: pdfName('Form'),
      Matrix: pdfArray([pdfNum(1), pdfNum(0), pdfNum(0), pdfNum(1), pdfNum(2), pdfNum(3)]),
    });
    const objects = new Map<number, PdfObject>([[20, pdfStream(formDict, textBytes('1 0 0 rg 0 0 10 10 re f'))]]);
    const resources = pdfDict({ XObject: pdfDict({ Fm1: pdfRef(20, 0) }) });
    const items = interpretContentStream(textBytes('/Fm1 Do'), resources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(objects),
      sink,
    });
    expect(items).toEqual([{ kind: 'rect', xPt: 2, yPt: 3, widthPt: 10, heightPt: 10, color: { r: 1, g: 0, b: 0 } }]);
  });

  it('stops a self-referential chain of forms at the recursion depth limit, with a diagnostic', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const selfResources = pdfDict({ XObject: pdfDict({ SelfRef: pdfRef(40, 0) }) });
    const formDict = pdfDict({ Type: pdfName('XObject'), Subtype: pdfName('Form'), Resources: selfResources });
    const objects = new Map<number, PdfObject>([[40, pdfStream(formDict, textBytes('/SelfRef Do'))]]);
    expect(() =>
      interpretContentStream(textBytes('/SelfRef Do'), selfResources, {
        fontMetrics: fixedWidthFontMetrics(),
        resolver: makeResolver(objects),
        sink,
      }),
    ).not.toThrow();
    expect(diagnostics.some((d) => d.code === 'pdf/form-recursion-limit')).toBe(true);
  });

  it('reports a diagnostic when an XObject resource does not resolve', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const resources = pdfDict({ XObject: pdfDict({}) });
    interpretContentStream(textBytes('/Missing Do'), resources, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(diagnostics.some((d) => d.code === 'pdf/xobject-not-resolved')).toBe(true);
  });
});

describe('interpretContentStream: inline images', () => {
  it('extracts an inline image with the current CTM', () => {
    const { sink } = collectDiagnostics();
    const pixelData = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
    const content = new Uint8Array([
      ...textBytes('q 1 0 0 1 5 5 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID '),
      ...pixelData,
      ...textBytes(' EI Q'),
    ]);
    const items = interpretContentStream(content, EMPTY_RESOURCES, {
      fontMetrics: fixedWidthFontMetrics(),
      resolver: makeResolver(new Map()),
      sink,
    });
    expect(items).toHaveLength(1);
    const [item] = items;
    if (item?.kind !== 'inlineImage') {
      throw new Error('expected an inline image item');
    }
    expect(item.matrix).toEqual([1, 0, 0, 1, 5, 5]);
    expect(Array.from(item.data)).toEqual(Array.from(pixelData));
  });
});
