import { describe, expect, it } from 'vitest';
import { ByteReader, isAsciiWhitespace } from './reader';

function reader(text: string): ByteReader {
  return new ByteReader(new TextEncoder().encode(text));
}

describe('isAsciiWhitespace', () => {
  it('recognises the PDF/ASCII whitespace set', () => {
    for (const byte of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) {
      expect(isAsciiWhitespace(byte)).toBe(true);
    }
  });

  it('rejects non-whitespace and undefined', () => {
    expect(isAsciiWhitespace(0x41)).toBe(false);
    expect(isAsciiWhitespace(undefined)).toBe(false);
  });
});

describe('ByteReader', () => {
  it('peek does not advance; next does', () => {
    const r = reader('AB');
    expect(r.peek()).toBe(0x41);
    expect(r.offset).toBe(0);
    expect(r.next()).toBe(0x41);
    expect(r.offset).toBe(1);
    expect(r.next()).toBe(0x42);
    expect(r.atEnd()).toBe(true);
    expect(r.next()).toBeUndefined();
  });

  it('peek with a lookahead offset does not move the cursor', () => {
    const r = reader('ABC');
    expect(r.peek(2)).toBe(0x43);
    expect(r.offset).toBe(0);
  });

  it('mark/reset rewinds to a saved position, enabling backtracking', () => {
    const r = reader('12 R');
    const mark = r.mark();
    r.next();
    r.next();
    expect(r.offset).toBe(2);
    r.reset(mark);
    expect(r.offset).toBe(0);
    expect(r.peek()).toBe(0x31);
  });

  it('skipWhitespace advances past a run of whitespace and stops at the first non-whitespace byte', () => {
    const r = reader('   \t\nx');
    r.skipWhitespace();
    expect(r.peek()).toBe(0x78); // 'x'
  });

  it('matchKeyword consumes the keyword and advances on a match', () => {
    const r = reader('endobj rest');
    expect(r.matchKeyword('endobj')).toBe(true);
    expect(r.offset).toBe(6);
  });

  it('matchKeyword leaves the position unchanged on a mismatch', () => {
    const r = reader('endstream');
    expect(r.matchKeyword('endobj')).toBe(false);
    expect(r.offset).toBe(0);
  });

  it('slice returns the requested byte range without copying beyond it', () => {
    const r = reader('hello world');
    expect(new TextDecoder().decode(r.slice(6, 11))).toBe('world');
  });
});
