import { describe, expect, it } from 'vitest';
import { ByteReader } from './bytes/reader';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import type { PdfObject } from './objects';
import { asDict, dictGet } from './objects';
import { parseIndirectObject, parseValue } from './parse';

function reader(text: string): ByteReader {
  return new ByteReader(new TextEncoder().encode(text));
}

function collectDiagnostics(): { sink: PdfDiagnosticSink; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

function parseAllValues(text: string): { values: PdfObject[]; diagnostics: PdfDiagnostic[] } {
  const r = reader(text);
  const { sink, diagnostics } = collectDiagnostics();
  const values: PdfObject[] = [];
  for (;;) {
    const before = r.offset;
    const value = parseValue(r, sink);
    if (value === undefined) {
      break;
    }
    values.push(value);
    if (r.offset === before) {
      break;
    }
  }
  return { values, diagnostics };
}

function stringBytes(obj: PdfObject | undefined): number[] {
  if (obj?.kind !== 'string') {
    throw new Error('expected a string object');
  }
  return Array.from(obj.bytes);
}

describe('parseValue: scalars', () => {
  it('reads null, true, and false', () => {
    expect(parseAllValues('null true false').values).toEqual([{ kind: 'null' }, { kind: 'bool', value: true }, { kind: 'bool', value: false }]);
  });

  it('reads a plain integer or real number', () => {
    expect(parseAllValues('42').values).toEqual([{ kind: 'number', value: 42 }]);
    expect(parseAllValues('-3.14').values).toEqual([{ kind: 'number', value: -3.14 }]);
  });

  it('reads a name', () => {
    expect(parseAllValues('/Catalog').values).toEqual([{ kind: 'name', name: 'Catalog' }]);
  });

  it('reads a literal string and a hex string', () => {
    const { values } = parseAllValues('(Hello) <48656c6c6f>');
    expect(stringBytes(values[0])).toEqual(Array.from(new TextEncoder().encode('Hello')));
    expect(stringBytes(values[1])).toEqual(Array.from(new TextEncoder().encode('Hello')));
  });

  it('reports an unexpected keyword as null, with a diagnostic', () => {
    const { values, diagnostics } = parseAllValues('bogus');
    expect(values).toEqual([{ kind: 'null' }]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('pdf/unexpected-keyword');
    expect(diagnostics[0]?.severity).toBe('warning');
    expect(diagnostics[0]?.message).toContain('bogus');
  });

  it('reports a stray array/dict close delimiter as null, with a diagnostic', () => {
    const { values, diagnostics } = parseAllValues(']');
    expect(values).toEqual([{ kind: 'null' }]);
    expect(diagnostics[0]?.code).toBe('pdf/unexpected-delimiter');
  });
});

describe('parseValue: "N G R" reference disambiguation', () => {
  it('reads "5 0 R" as a reference, not three separate numbers', () => {
    expect(parseAllValues('5 0 R').values).toEqual([{ kind: 'ref', num: 5, gen: 0 }]);
  });

  it('does not misread "5 0 obj" as a reference -- backtracks so all three tokens parse independently', () => {
    expect(parseAllValues('5 0 obj').values).toEqual([
      { kind: 'number', value: 5 },
      { kind: 'number', value: 0 },
      { kind: 'null' }, // the bare "obj" keyword, reached via parseValue directly, is not a recognised value keyword
    ]);
  });

  it('never attempts the reference lookahead for a non-integer or negative number, even when a valid two-number-plus-R pattern would otherwise follow', () => {
    expect(parseAllValues('3.5 4 R').values).toEqual([{ kind: 'number', value: 3.5 }, { kind: 'number', value: 4 }, { kind: 'null' }]);
    expect(parseAllValues('-1 2 R').values).toEqual([{ kind: 'number', value: -1 }, { kind: 'number', value: 2 }, { kind: 'null' }]);
  });
});

describe('parseValue: arrays', () => {
  it('reads a flat array', () => {
    expect(parseAllValues('[1 2 3]').values).toEqual([
      { kind: 'array', items: [{ kind: 'number', value: 1 }, { kind: 'number', value: 2 }, { kind: 'number', value: 3 }] },
    ]);
  });

  it('reads a nested array containing a reference', () => {
    expect(parseAllValues('[1 [2 3] 4 0 R]').values).toEqual([
      {
        kind: 'array',
        items: [
          { kind: 'number', value: 1 },
          { kind: 'array', items: [{ kind: 'number', value: 2 }, { kind: 'number', value: 3 }] },
          { kind: 'ref', num: 4, gen: 0 },
        ],
      },
    ]);
  });

  it('recovers from a missing closing bracket with a diagnostic', () => {
    const { values, diagnostics } = parseAllValues('[1 2');
    expect(values).toEqual([{ kind: 'array', items: [{ kind: 'number', value: 1 }, { kind: 'number', value: 2 }] }]);
    expect(diagnostics.some((d) => d.code === 'pdf/unterminated-array')).toBe(true);
  });
});

describe('parseValue: dictionaries', () => {
  it('reads a dictionary with name, reference, and number values', () => {
    const [value] = parseAllValues('<< /Type /Catalog /Pages 2 0 R /Count 3 >>').values;
    const dict = asDict(value);
    expect(dict).toBeDefined();
    expect(dictGet(dict!, 'Type')).toEqual({ kind: 'name', name: 'Catalog' });
    expect(dictGet(dict!, 'Pages')).toEqual({ kind: 'ref', num: 2, gen: 0 });
    expect(dictGet(dict!, 'Count')).toEqual({ kind: 'number', value: 3 });
  });

  it('reads a nested dictionary', () => {
    const [value] = parseAllValues('<< /Outer << /Inner 1 >> >>').values;
    const outer = asDict(value)!;
    const inner = asDict(dictGet(outer, 'Outer'))!;
    expect(dictGet(inner, 'Inner')).toEqual({ kind: 'number', value: 1 });
  });

  it('recovers from a non-name key with a diagnostic and keeps parsing subsequent, well-formed key-value pairs', () => {
    const { values, diagnostics } = parseAllValues('<< 1 /Foo 2 /Bar 3 >>');
    const dict = asDict(values[0])!;
    expect(dictGet(dict, 'Foo')).toEqual({ kind: 'number', value: 2 });
    expect(dictGet(dict, 'Bar')).toEqual({ kind: 'number', value: 3 });
    expect(diagnostics.some((d) => d.code === 'pdf/dict-key-not-name')).toBe(true);
  });

  it('recovers from a missing closing ">>" with a diagnostic', () => {
    const { values, diagnostics } = parseAllValues('<< /Foo 1');
    const dict = asDict(values[0])!;
    expect(dictGet(dict, 'Foo')).toEqual({ kind: 'number', value: 1 });
    expect(diagnostics.some((d) => d.code === 'pdf/unterminated-dict')).toBe(true);
  });
});

describe('parseValue: streams', () => {
  it('reads a stream whose direct numeric /Length lands exactly on "endstream"', () => {
    const { values, diagnostics } = parseAllValues('<< /Length 5 >>\nstream\nHello\nendstream');
    const [value] = values;
    expect(value?.kind).toBe('stream');
    if (value?.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    expect(Array.from(value.raw)).toEqual(Array.from(new TextEncoder().encode('Hello')));
    expect(diagnostics).toEqual([]);
  });

  it('falls back to scanning for "endstream" when /Length is wrong', () => {
    const { values, diagnostics } = parseAllValues('<< /Length 3 >>\nstream\nHello\nendstream');
    const [value] = values;
    if (value?.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    expect(Array.from(value.raw)).toEqual(Array.from(new TextEncoder().encode('Hello')));
    expect(diagnostics.some((d) => d.code === 'pdf/stream-length-invalid')).toBe(true);
  });

  it('falls back to scanning, without a diagnostic, when /Length is simply absent', () => {
    const { values, diagnostics } = parseAllValues('<< /Filter /FlateDecode >>\nstream\nHello\nendstream');
    const [value] = values;
    if (value?.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    expect(Array.from(value.raw)).toEqual(Array.from(new TextEncoder().encode('Hello')));
    expect(diagnostics).toEqual([]);
  });

  it('falls back to scanning, with a diagnostic, when /Length is an indirect reference', () => {
    const { values, diagnostics } = parseAllValues('<< /Length 9 0 R >>\nstream\nHello\nendstream');
    const [value] = values;
    if (value?.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    expect(Array.from(value.raw)).toEqual(Array.from(new TextEncoder().encode('Hello')));
    expect(diagnostics.some((d) => d.code === 'pdf/stream-length-invalid')).toBe(true);
  });

  it('tolerates a bare CR after "stream" (diagnosed, but the data boundary is still correct)', () => {
    const { values, diagnostics } = parseAllValues('<< /Length 5 >>\nstream\rHello\rendstream');
    const [value] = values;
    if (value?.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    expect(Array.from(value.raw)).toEqual(Array.from(new TextEncoder().encode('Hello')));
    expect(diagnostics.some((d) => d.code === 'pdf/stream-bad-eol')).toBe(true);
  });

  it('trims a CRLF immediately before a scanned "endstream"', () => {
    const { values } = parseAllValues('<< /Filter /X >>\nstream\nHello\r\nendstream');
    const [value] = values;
    if (value?.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    expect(Array.from(value.raw)).toEqual(Array.from(new TextEncoder().encode('Hello')));
  });

  it('trims a bare LF immediately before a scanned "endstream"', () => {
    const { values } = parseAllValues('<< /Filter /X >>\nstream\nHello\nendstream');
    const [value] = values;
    if (value?.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    expect(Array.from(value.raw)).toEqual(Array.from(new TextEncoder().encode('Hello')));
  });

  it('trims nothing when a scanned "endstream" has no preceding EOL at all', () => {
    const { values } = parseAllValues('<< /Filter /X >>\nstream\nHelloendstream');
    const [value] = values;
    if (value?.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    expect(Array.from(value.raw)).toEqual(Array.from(new TextEncoder().encode('Hello')));
  });

  it('treats the rest of the input as stream data, with a diagnostic, when "endstream" is never found', () => {
    const { values, diagnostics } = parseAllValues('<< /Filter /X >>\nstream\nHello, unterminated');
    const [value] = values;
    if (value?.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    expect(Array.from(value.raw)).toEqual(Array.from(new TextEncoder().encode('Hello, unterminated')));
    expect(diagnostics.some((d) => d.code === 'pdf/stream-unterminated')).toBe(true);
  });
});

describe('parseIndirectObject', () => {
  it('reads "N G obj <value> endobj"', () => {
    const { sink } = collectDiagnostics();
    const r = reader('5 0 obj\n(Hello)\nendobj');
    const result = parseIndirectObject(r, sink);
    expect(result?.num).toBe(5);
    expect(result?.gen).toBe(0);
    expect(stringBytes(result?.value)).toEqual(Array.from(new TextEncoder().encode('Hello')));
  });

  it('reads an object whose value is a dict-introduced stream', () => {
    const { sink } = collectDiagnostics();
    const r = reader('4 0 obj\n<< /Length 5 >>\nstream\nHello\nendstream\nendobj');
    const result = parseIndirectObject(r, sink);
    expect(result?.num).toBe(4);
    expect(result?.value.kind).toBe('stream');
    if (result?.value.kind !== 'stream') {
      throw new Error('expected a stream');
    }
    expect(dictGet(result.value.dict, 'Length')).toEqual({ kind: 'number', value: 5 });
    expect(Array.from(result.value.raw)).toEqual(Array.from(new TextEncoder().encode('Hello')));
  });

  it('returns undefined, without moving the reader, when the input is not an object header', () => {
    const r = reader('hello world');
    const { sink } = collectDiagnostics();
    const before = r.offset;
    expect(parseIndirectObject(r, sink)).toBeUndefined();
    expect(r.offset).toBe(before);
  });

  it('recovers a missing "endobj" with a diagnostic, leaving the following token unconsumed', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const r = reader('5 0 obj (Hi) foo');
    const result = parseIndirectObject(r, sink);
    expect(stringBytes(result?.value)).toEqual(Array.from(new TextEncoder().encode('Hi')));
    expect(diagnostics.some((d) => d.code === 'pdf/missing-endobj')).toBe(true);
    const next = parseValue(r, sink);
    expect(next).toEqual({ kind: 'null' }); // the un-consumed "foo" keyword, read fresh as its own value
  });

  it('reports a missing value with a diagnostic when the object header is followed immediately by end of input', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const r = reader('5 0 obj');
    const result = parseIndirectObject(r, sink);
    expect(result).toEqual({ num: 5, gen: 0, value: { kind: 'null' } });
    expect(diagnostics.some((d) => d.code === 'pdf/object-missing-value')).toBe(true);
  });
});
