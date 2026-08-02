import { describe, expect, it } from 'vitest';
import { decodePng } from './image/png-decode';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import { readImageXObject } from './images-read';
import type { PdfObjectResolver } from './interpret';
import type { PdfDict, PdfObject } from './objects';
import { asDict, pdfArray, pdfBool, pdfDict, pdfLiteralString, pdfName, pdfNum, pdfRef, pdfStream } from './objects';
import { CCITT_FAX_FIXTURES, ccittFixtureBitmap, ccittFixtureBytes } from './test-support/ccitt-fax';

function collectDiagnostics(): { sink: PdfDiagnosticSink; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined => (obj?.kind === 'ref' ? objects.get(obj.num) : obj);
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined => asDict(resolve(obj));
  return { resolve, resolveDict };
}

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function jpegMarker(code: number, payload: number[]): number[] {
  return [0xff, code, ...u16be(payload.length + 2), ...payload];
}

function buildMinimalJpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  const sofPayload = [8, ...u16be(height), ...u16be(width), 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, ...jpegMarker(0xc0, sofPayload), 0xff, 0xd9]);
}

const EMPTY_RESOLVER = makeResolver(new Map());

describe('readImageXObject: DeviceGray', () => {
  it('decodes an 8-bit gray image into a re-encoded PNG with matching pixels', () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({ Width: pdfNum(2), Height: pdfNum(2), BitsPerComponent: pdfNum(8), ColorSpace: pdfName('DeviceGray') });
    const raw = new Uint8Array([0, 85, 170, 255]);
    const result = readImageXObject(dict, raw, EMPTY_RESOLVER, sink);
    expect(result?.format).toBe('png');
    const decoded = decodePng(result!.bytes);
    expect(decoded).toMatchObject({ width: 2, height: 2, channels: 1 });
    expect(Array.from(decoded.data)).toEqual([0, 85, 170, 255]);
  });

  it('scales sub-byte depths up to 8 bits and honours an inverting /Decode array', () => {
    const { sink } = collectDiagnostics();
    // 1-bit, 2x2: bits packed MSB-first per row, one byte per row (2 bits used, padded).
    const dict = pdfDict({ Width: pdfNum(2), Height: pdfNum(2), BitsPerComponent: pdfNum(1), ColorSpace: pdfName('DeviceGray'), Decode: pdfArray([pdfNum(1), pdfNum(0)]) });
    const raw = new Uint8Array([0b10000000, 0b01000000]); // row0: [1,0], row1: [0,1] -- inverted by /Decode
    const result = readImageXObject(dict, raw, EMPTY_RESOLVER, sink);
    const decoded = decodePng(result!.bytes);
    // Un-inverted, bit 1 -> 255, bit 0 -> 0; /Decode [1 0] flips that.
    expect(Array.from(decoded.data)).toEqual([0, 255, 255, 0]);
  });
});

describe('readImageXObject: DeviceRGB and ICCBased', () => {
  it('decodes an 8-bit RGB image', () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({ Width: pdfNum(1), Height: pdfNum(1), BitsPerComponent: pdfNum(8), ColorSpace: pdfName('DeviceRGB') });
    const result = readImageXObject(dict, new Uint8Array([10, 20, 30]), EMPTY_RESOLVER, sink);
    const decoded = decodePng(result!.bytes);
    expect(Array.from(decoded.data)).toEqual([10, 20, 30]);
  });

  it('treats a 3-component ICCBased colour space as RGB', () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([[5, pdfStream(pdfDict({ N: pdfNum(3) }), new Uint8Array(0))]]);
    const dict = pdfDict({ Width: pdfNum(1), Height: pdfNum(1), BitsPerComponent: pdfNum(8), ColorSpace: pdfArray([pdfName('ICCBased'), pdfRef(5, 0)]) });
    const result = readImageXObject(dict, new Uint8Array([1, 2, 3]), makeResolver(objects), sink);
    expect(result?.format).toBe('png');
    const decoded = decodePng(result!.bytes);
    expect(decoded.channels).toBe(3);
  });
});

describe('readImageXObject: DeviceCMYK', () => {
  it('converts CMYK samples to RGB', () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({ Width: pdfNum(1), Height: pdfNum(1), BitsPerComponent: pdfNum(8), ColorSpace: pdfName('DeviceCMYK') });
    // Pure black via K=255, C=M=Y=0 -> RGB (0,0,0).
    const result = readImageXObject(dict, new Uint8Array([0, 0, 0, 255]), EMPTY_RESOLVER, sink);
    const decoded = decodePng(result!.bytes);
    expect(Array.from(decoded.data)).toEqual([0, 0, 0]);
  });
});

describe('readImageXObject: Indexed', () => {
  it('resolves palette indices against an RGB base colour space', () => {
    const { sink } = collectDiagnostics();
    const lookup = new Uint8Array([255, 0, 0, 0, 255, 0]); // index 0 = red, index 1 = green
    const dict = pdfDict({
      Width: pdfNum(2),
      Height: pdfNum(1),
      BitsPerComponent: pdfNum(8),
      ColorSpace: pdfArray([pdfName('Indexed'), pdfName('DeviceRGB'), pdfNum(1), pdfLiteralString(lookup)]),
    });
    const result = readImageXObject(dict, new Uint8Array([0, 1]), EMPTY_RESOLVER, sink);
    const decoded = decodePng(result!.bytes);
    expect(Array.from(decoded.data)).toEqual([255, 0, 0, 0, 255, 0]);
  });
});

describe('readImageXObject: DCTDecode passthrough', () => {
  it('returns the original JPEG bytes unchanged, with dimensions read from its SOF marker', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const jpeg = buildMinimalJpeg(64, 32);
    const dict = pdfDict({ Filter: pdfName('DCTDecode'), Width: pdfNum(64), Height: pdfNum(32) });
    const result = readImageXObject(dict, jpeg, EMPTY_RESOLVER, sink);
    expect(result).toEqual({ format: 'jpeg', bytes: jpeg, widthPx: 64, heightPx: 32 });
    expect(diagnostics).toEqual([]);
  });

  it('degrades with a diagnostic when the DCTDecode bytes are not a real JPEG', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({ Filter: pdfName('DCTDecode') });
    const result = readImageXObject(dict, new Uint8Array([1, 2, 3]), EMPTY_RESOLVER, sink);
    expect(result).toBeUndefined();
    expect(diagnostics.some((d) => d.code === 'image/undecodable')).toBe(true);
  });
});

describe('readImageXObject: degradation', () => {
  it('skips an unsupported colour space with a diagnostic', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({ Width: pdfNum(1), Height: pdfNum(1), ColorSpace: pdfName('Separation') });
    expect(readImageXObject(dict, new Uint8Array([1]), EMPTY_RESOLVER, sink)).toBeUndefined();
    expect(diagnostics.some((d) => d.code === 'image/unsupported-colorspace')).toBe(true);
  });

  it('skips an unsupported filter with a diagnostic (already raised by decodeStream)', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({ Filter: pdfName('JBIG2Decode'), Width: pdfNum(1), Height: pdfNum(1) });
    expect(readImageXObject(dict, new Uint8Array([1]), EMPTY_RESOLVER, sink)).toBeUndefined();
    expect(diagnostics.some((d) => d.code === 'pdf/unsupported-filter')).toBe(true);
  });

  it('skips an unsupported bit depth with a diagnostic', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({ Width: pdfNum(1), Height: pdfNum(1), BitsPerComponent: pdfNum(16), ColorSpace: pdfName('DeviceGray') });
    expect(readImageXObject(dict, new Uint8Array([0, 0]), EMPTY_RESOLVER, sink)).toBeUndefined();
    expect(diagnostics.some((d) => d.code === 'image/unsupported-bit-depth')).toBe(true);
  });

  it('skips an image with no valid /Width or /Height', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({ ColorSpace: pdfName('DeviceGray') });
    expect(readImageXObject(dict, new Uint8Array([0]), EMPTY_RESOLVER, sink)).toBeUndefined();
    expect(diagnostics.some((d) => d.code === 'image/undecodable')).toBe(true);
  });

  it('skips an /ImageMask stencil with an informational diagnostic', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({ Width: pdfNum(1), Height: pdfNum(1), ImageMask: pdfBool(true) });
    expect(readImageXObject(dict, new Uint8Array([0]), EMPTY_RESOLVER, sink)).toBeUndefined();
    expect(diagnostics.some((d) => d.code === 'image/mask-unsupported')).toBe(true);
  });
});

describe('readImageXObject: soft mask alpha', () => {
  it('attaches an /SMask as the alpha channel when dimensions and bit depth match', () => {
    const { sink } = collectDiagnostics();
    const smask = pdfStream(pdfDict({ Width: pdfNum(1), Height: pdfNum(1), BitsPerComponent: pdfNum(8), ColorSpace: pdfName('DeviceGray') }), new Uint8Array([128]));
    const objects = new Map<number, PdfObject>([[7, smask]]);
    const dict = pdfDict({ Width: pdfNum(1), Height: pdfNum(1), BitsPerComponent: pdfNum(8), ColorSpace: pdfName('DeviceRGB'), SMask: pdfRef(7, 0) });
    const result = readImageXObject(dict, new Uint8Array([10, 20, 30]), makeResolver(objects), sink);
    const decoded = decodePng(result!.bytes);
    expect(decoded.alpha).toBeDefined();
    expect(Array.from(decoded.alpha!)).toEqual([128]);
  });
});

describe('readImageXObject: CCITTFaxDecode', () => {
  const fixture = CCITT_FAX_FIXTURES.find((f) => f.name === 'diagonal')!;

  it('decodes a Group 4 fax image into a PNG with the original black and white pixels', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({
      Width: pdfNum(fixture.columns),
      Height: pdfNum(fixture.rows),
      BitsPerComponent: pdfNum(1),
      ColorSpace: pdfName('DeviceGray'),
      Filter: pdfName('CCITTFaxDecode'),
      DecodeParms: pdfDict({ K: pdfNum(-1), Columns: pdfNum(fixture.columns), Rows: pdfNum(fixture.rows) }),
    });
    const result = readImageXObject(dict, ccittFixtureBytes(fixture.encodings.group4), EMPTY_RESOLVER, sink);
    expect(diagnostics).toEqual([]);
    expect(result).toMatchObject({ format: 'png', widthPx: fixture.columns, heightPx: fixture.rows });
    const decoded = decodePng(result!.bytes);
    expect(decoded).toMatchObject({ width: fixture.columns, height: fixture.rows, channels: 1 });
    // /BlackIs1 defaulting to false puts black in the 0 bit, which a 1-bit /DeviceGray sample scales straight to 0.
    expect(Array.from(decoded.data)).toEqual(ccittFixtureBitmap(fixture).map((black) => (black ? 0 : 255)));
  });

  it('inverts with a /Decode array, the same as any other 1-bit gray image', () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({
      Width: pdfNum(fixture.columns),
      Height: pdfNum(fixture.rows),
      BitsPerComponent: pdfNum(1),
      ColorSpace: pdfName('DeviceGray'),
      Decode: pdfArray([pdfNum(1), pdfNum(0)]),
      Filter: pdfName('CCITTFaxDecode'),
      DecodeParms: pdfDict({ K: pdfNum(-1), Columns: pdfNum(fixture.columns), Rows: pdfNum(fixture.rows) }),
    });
    const result = readImageXObject(dict, ccittFixtureBytes(fixture.encodings.group4), EMPTY_RESOLVER, sink);
    expect(Array.from(decodePng(result!.bytes).data)).toEqual(ccittFixtureBitmap(fixture).map((black) => (black ? 255 : 0)));
  });
});
