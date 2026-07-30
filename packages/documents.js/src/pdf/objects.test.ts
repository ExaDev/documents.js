import { describe, expect, it } from 'vitest';
import {
  asArray,
  asDict,
  asName,
  asNumber,
  dictGet,
  isName,
  pdfArray,
  pdfBool,
  pdfDict,
  pdfHexString,
  pdfLiteralString,
  pdfName,
  pdfNull,
  pdfNum,
  pdfRef,
  pdfStream,
} from './objects';

describe('constructors', () => {
  it('build the expected tagged shapes', () => {
    expect(pdfNull()).toEqual({ kind: 'null' });
    expect(pdfBool(true)).toEqual({ kind: 'bool', value: true });
    expect(pdfNum(3.14)).toEqual({ kind: 'number', value: 3.14 });
    expect(pdfName('Foo')).toEqual({ kind: 'name', name: 'Foo' });
    expect(pdfRef(5, 0)).toEqual({ kind: 'ref', num: 5, gen: 0 });
  });

  it('pdfHexString/pdfLiteralString carry raw bytes, never a decoded string', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(pdfHexString(bytes)).toEqual({ kind: 'string', bytes, hex: true });
    expect(pdfLiteralString(bytes)).toEqual({ kind: 'string', bytes, hex: false });
  });

  it('pdfDict accepts either a Record or a Map and normalises to a Map', () => {
    const fromRecord = pdfDict({ Type: pdfName('Catalog') });
    const fromMap = pdfDict(new Map([['Type', pdfName('Catalog')]]));
    expect(fromRecord.entries).toBeInstanceOf(Map);
    expect(fromRecord).toEqual(fromMap);
  });

  it('pdfArray and pdfStream wrap their contents directly', () => {
    const items = [pdfNum(1), pdfNum(2)];
    expect(pdfArray(items)).toEqual({ kind: 'array', items });
    const dict = pdfDict({ Length: pdfNum(0) });
    const raw = new Uint8Array([1, 2, 3]);
    expect(pdfStream(dict, raw)).toEqual({ kind: 'stream', dict, raw });
  });
});

describe('resolution-free accessors', () => {
  it('isName matches only a name object with the given name', () => {
    expect(isName(pdfName('Catalog'), 'Catalog')).toBe(true);
    expect(isName(pdfName('Page'), 'Catalog')).toBe(false);
    expect(isName(pdfNum(1), 'Catalog')).toBe(false);
    expect(isName(undefined, 'Catalog')).toBe(false);
  });

  it('asNumber/asName/asArray narrow or return undefined for the wrong kind', () => {
    expect(asNumber(pdfNum(42))).toBe(42);
    expect(asNumber(pdfName('x'))).toBeUndefined();
    expect(asName(pdfName('Catalog'))).toBe('Catalog');
    expect(asName(pdfNum(1))).toBeUndefined();
    expect(asArray(pdfArray([pdfNum(1)]))).toEqual([pdfNum(1)]);
    expect(asArray(pdfNum(1))).toBeUndefined();
  });

  it('asDict resolves both a dict and a stream to its dictionary entries', () => {
    const dict = pdfDict({ Type: pdfName('Page') });
    expect(asDict(dict)).toBe(dict);
    const stream = pdfStream(dict, new Uint8Array());
    expect(asDict(stream)).toBe(dict);
    expect(asDict(pdfNum(1))).toBeUndefined();
    expect(asDict(undefined)).toBeUndefined();
  });

  it('dictGet reads an entry by key', () => {
    const dict = pdfDict({ Type: pdfName('Page') });
    expect(dictGet(dict, 'Type')).toEqual(pdfName('Page'));
    expect(dictGet(dict, 'Missing')).toBeUndefined();
  });
});
