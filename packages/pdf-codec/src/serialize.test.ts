import { describe, expect, it } from 'vitest';
import { pdfArray, pdfBool, pdfDict, pdfHexString, pdfName, pdfNull, pdfNum, pdfRef, pdfStream } from './objects';
import { formatNumber, serializeObject } from './serialize';

function text(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder().decode(bytes);
}

describe('formatNumber', () => {
  it('formats whole and fractional numbers without exponential notation', () => {
    expect(formatNumber(612)).toBe('612');
    expect(formatNumber(0.5)).toBe('0.5');
    expect(formatNumber(1 / 3)).toBe('0.3333');
  });

  it('never produces exponential notation for a very small number', () => {
    expect(formatNumber(0.00000001)).toBe('0');
    expect(formatNumber(0.00000001)).not.toContain('e');
  });

  it('normalises -0 to 0', () => {
    expect(formatNumber(-0)).toBe('0');
  });

  it('strips trailing zeros and a bare trailing decimal point', () => {
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(1.0)).toBe('1');
  });
});

describe('writeObject / serializeObject', () => {
  it('serializes primitives', () => {
    expect(text(serializeObject(pdfNull()))).toBe('null');
    expect(text(serializeObject(pdfBool(true)))).toBe('true');
    expect(text(serializeObject(pdfBool(false)))).toBe('false');
    expect(text(serializeObject(pdfNum(12.5)))).toBe('12.5');
    expect(text(serializeObject(pdfName('Catalog')))).toBe('/Catalog');
    expect(text(serializeObject(pdfRef(3, 0)))).toBe('3 0 R');
  });

  it('always serializes strings as hex, regardless of the hex flag', () => {
    const bytes = new TextEncoder().encode('Hi');
    expect(text(serializeObject(pdfHexString(bytes)))).toBe('<4869>');
  });

  it('escapes a name containing a delimiter or non-printable character', () => {
    expect(text(serializeObject(pdfName('A B')))).toBe('/A#20B');
  });

  it('serializes an array of mixed types space-separated', () => {
    expect(text(serializeObject(pdfArray([pdfNum(1), pdfName('X'), pdfBool(true)])))).toBe('[1 /X true]');
  });

  it('serializes a dictionary', () => {
    const dict = pdfDict({ Type: pdfName('Catalog'), Count: pdfNum(3) });
    expect(text(serializeObject(dict))).toBe('<</Type /Catalog /Count 3 >>');
  });

  it('serializes a stream, deriving /Length from the actual byte count', () => {
    const raw = new TextEncoder().encode('BT /F1 12 Tf ET');
    const stream = pdfStream(pdfDict({ Length: pdfNum(999) }), raw);
    const out = text(serializeObject(stream));
    expect(out).toContain(`/Length ${raw.length}`);
    expect(out).not.toContain('999');
    expect(out).toContain('\nstream\nBT /F1 12 Tf ET\nendstream');
  });
});
