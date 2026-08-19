import { describe, expect, it } from 'vitest';
import { ByteReader } from './bytes/reader';
import { nextToken } from './lexer';

function reader(text: string): ByteReader {
  return new ByteReader(new TextEncoder().encode(text));
}

// Byte-array token values (literalString/hexString) are converted to plain number[] for easy toEqual comparison; every other token kind passes through unchanged. Typed as a proper discriminated union up front so individual tests can narrow by `kind` instead of asserting.
type TestToken =
  | { readonly kind: 'literalString' | 'hexString'; readonly value: number[] }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'arrayStart' }
  | { readonly kind: 'arrayEnd' }
  | { readonly kind: 'dictStart' }
  | { readonly kind: 'dictEnd' }
  | { readonly kind: 'keyword'; readonly value: string };

function tokens(text: string): TestToken[] {
  const r = reader(text);
  const out: TestToken[] = [];
  for (;;) {
    const t = nextToken(r);
    if (t === undefined) {
      break;
    }
    out.push(t.kind === 'literalString' || t.kind === 'hexString' ? { kind: t.kind, value: Array.from(t.value) } : t);
  }
  return out;
}

function byteValue(token: TestToken | undefined): number[] {
  if (token?.kind !== 'literalString' && token?.kind !== 'hexString') {
    throw new Error('expected a byte-array token');
  }
  return token.value;
}

describe('nextToken: numbers', () => {
  it('reads plain integers, including negative and explicitly positive', () => {
    expect(tokens('123')).toEqual([{ kind: 'number', value: 123 }]);
    expect(tokens('-42')).toEqual([{ kind: 'number', value: -42 }]);
    expect(tokens('+7')).toEqual([{ kind: 'number', value: 7 }]);
  });

  it('reads real numbers, including forms with no leading or no trailing digit', () => {
    expect(tokens('3.14')).toEqual([{ kind: 'number', value: 3.14 }]);
    expect(tokens('.5')).toEqual([{ kind: 'number', value: 0.5 }]);
    expect(tokens('5.')).toEqual([{ kind: 'number', value: 5 }]);
    expect(tokens('-.5')).toEqual([{ kind: 'number', value: -0.5 }]);
  });
});

describe('nextToken: names', () => {
  it('reads a simple name without the leading slash', () => {
    expect(tokens('/Type')).toEqual([{ kind: 'name', value: 'Type' }]);
  });

  it('decodes #XX hex escapes', () => {
    expect(tokens('/A#42C')).toEqual([{ kind: 'name', value: 'ABC' }]);
  });

  it('reads an empty name', () => {
    const r = reader('/ ');
    expect(nextToken(r)).toEqual({ kind: 'name', value: '' });
  });

  it('stops a name at a delimiter without consuming it', () => {
    const r = reader('/Foo/Bar');
    expect(nextToken(r)).toEqual({ kind: 'name', value: 'Foo' });
    expect(nextToken(r)).toEqual({ kind: 'name', value: 'Bar' });
  });
});

describe('nextToken: literal strings', () => {
  it('reads a plain string', () => {
    expect(tokens('(Hello)')).toEqual([{ kind: 'literalString', value: Array.from(new TextEncoder().encode('Hello')) }]);
  });

  it('keeps balanced nested parentheses as literal content', () => {
    expect(tokens('(a(b)c)')).toEqual([{ kind: 'literalString', value: Array.from(new TextEncoder().encode('a(b)c')) }]);
  });

  it('decodes named escapes', () => {
    const [token] = tokens(String.raw`(\n\r\t\b\f\(\)\\)`);
    expect(byteValue(token)).toEqual([0x0a, 0x0d, 0x09, 0x08, 0x0c, 0x28, 0x29, 0x5c]);
  });

  it('decodes 1-3 digit octal escapes', () => {
    const [token] = tokens(String.raw`(\101\1\61)`); // 'A', 0x01, '1'
    expect(byteValue(token)).toEqual([0x41, 0x01, 0x31]);
  });

  it('treats a backslash-newline as a line-continuation escape producing no byte', () => {
    const [token] = tokens('(a\\\nb)');
    expect(byteValue(token)).toEqual(Array.from(new TextEncoder().encode('ab')));
  });

  it('normalises an unescaped CR or CRLF to a single LF', () => {
    const withCr = tokens('(a\rb)');
    const withCrLf = tokens('(a\r\nb)');
    expect(byteValue(withCr[0])).toEqual([0x61, 0x0a, 0x62]);
    expect(byteValue(withCrLf[0])).toEqual([0x61, 0x0a, 0x62]);
  });

  it('returns whatever was read so far for a truncated (unterminated) string, rather than throwing', () => {
    expect(() => tokens('(unterminated')).not.toThrow();
    const [token] = tokens('(unterminated');
    expect(byteValue(token)).toEqual(Array.from(new TextEncoder().encode('unterminated')));
  });
});

describe('nextToken: hex strings', () => {
  it('reads a hex string', () => {
    expect(tokens('<48656c6c6f>')).toEqual([{ kind: 'hexString', value: Array.from(new TextEncoder().encode('Hello')) }]);
  });

  it('ignores embedded whitespace', () => {
    expect(tokens('<48 65 6c 6c 6f>')).toEqual([{ kind: 'hexString', value: Array.from(new TextEncoder().encode('Hello')) }]);
  });

  it('zero-pads an odd trailing digit', () => {
    expect(tokens('<488>')).toEqual([{ kind: 'hexString', value: [0x48, 0x80] }]);
  });

  it('reads an empty hex string', () => {
    expect(tokens('<>')).toEqual([{ kind: 'hexString', value: [] }]);
  });
});

describe('nextToken: delimiters', () => {
  it('reads array and dictionary delimiters', () => {
    expect(tokens('[ ]')).toEqual([{ kind: 'arrayStart' }, { kind: 'arrayEnd' }]);
    expect(tokens('<< >>')).toEqual([{ kind: 'dictStart' }, { kind: 'dictEnd' }]);
  });

  it('distinguishes << (dict) from < (hex string) by lookahead', () => {
    expect(tokens('<<')).toEqual([{ kind: 'dictStart' }]);
    expect(tokens('<41>')).toEqual([{ kind: 'hexString', value: [0x41] }]);
  });

  it('skips a lone, lexically invalid ">" rather than treating it as fatal', () => {
    const r = reader('> 42');
    expect(nextToken(r)).toEqual({ kind: 'number', value: 42 });
  });

  it('skips PostScript calculator braces { } without producing a token for them', () => {
    expect(tokens('{ 1 2 add }')).toEqual([
      { kind: 'number', value: 1 },
      { kind: 'number', value: 2 },
      { kind: 'keyword', value: 'add' },
    ]);
  });
});

describe('nextToken: keywords', () => {
  it('reads structural keywords', () => {
    expect(tokens('obj endobj stream endstream xref trailer startxref true false null R')).toEqual(
      ['obj', 'endobj', 'stream', 'endstream', 'xref', 'trailer', 'startxref', 'true', 'false', 'null', 'R'].map((value) => ({ kind: 'keyword', value })),
    );
  });

  it('reads content-stream operators using the same keyword rule, no special-casing', () => {
    expect(tokens('BT Tf Tj re cm Do ET')).toEqual(['BT', 'Tf', 'Tj', 're', 'cm', 'Do', 'ET'].map((value) => ({ kind: 'keyword', value })));
  });
});

describe('nextToken: comments and whitespace', () => {
  it('skips a comment (% to end of line) between tokens', () => {
    expect(tokens('1 % a comment\n2')).toEqual([
      { kind: 'number', value: 1 },
      { kind: 'number', value: 2 },
    ]);
  });

  it('skips a comment at the very end of input without erroring', () => {
    expect(tokens('1 % trailing comment')).toEqual([{ kind: 'number', value: 1 }]);
  });
});

describe('nextToken: end of input', () => {
  it('returns undefined at end of input', () => {
    const r = reader('   ');
    expect(nextToken(r)).toBeUndefined();
  });
});

describe('nextToken: a realistic object-header sequence', () => {
  it('tokenizes "N G obj" and "N G R" as the same two-number-plus-keyword shape, leaving disambiguation to the caller', () => {
    expect(tokens('5 0 obj')).toEqual([{ kind: 'number', value: 5 }, { kind: 'number', value: 0 }, { kind: 'keyword', value: 'obj' }]);
    expect(tokens('5 0 R')).toEqual([{ kind: 'number', value: 5 }, { kind: 'number', value: 0 }, { kind: 'keyword', value: 'R' }]);
  });
});
