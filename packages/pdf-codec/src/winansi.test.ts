import { describe, expect, it } from 'vitest';
import { encodeForShow, sanitizeToWinAnsi, winAnsiCodeToUnicode } from './winansi';

describe('sanitizeToWinAnsi', () => {
  it('passes plain ASCII through unchanged, byte for byte', () => {
    const result = sanitizeToWinAnsi('Hello, world!');
    expect(Array.from(result.codes)).toEqual(Array.from(new TextEncoder().encode('Hello, world!')));
    expect(result.substitutions).toHaveLength(0);
  });

  it('encodes common "smart" typography directly, since WinAnsi already represents it', () => {
    const result = sanitizeToWinAnsi('‘quoted’ — an em dash …');
    expect(result.substitutions).toHaveLength(0);
    expect(result.codes[0]).toBe(0x91); // left single quote
  });

  it('encodes Latin-1 accented characters directly', () => {
    const result = sanitizeToWinAnsi('café');
    expect(result.substitutions).toHaveLength(0);
    expect(result.codes[3]).toBe(0xe9); // eacute
  });

  it('substitutes "?" for a character outside WinAnsi and records the substitution', () => {
    const result = sanitizeToWinAnsi('caf中'); // a CJK character
    expect(result.substitutions).toEqual([{ from: '中', to: '?' }]);
    expect(result.codes[3]).toBe(0x3f);
  });

  it('handles an empty string', () => {
    const result = sanitizeToWinAnsi('');
    expect(result.codes).toHaveLength(0);
    expect(result.substitutions).toHaveLength(0);
  });
});

describe('encodeForShow', () => {
  it('measures width using the same sanitized codes it emits', () => {
    const result = encodeForShow('AA', 'Helvetica'); // 'A' = 667 units each
    expect(result.width1000).toBe(1334);
    expect(result.codes).toHaveLength(2);
  });

  it('substituted characters still contribute their fallback glyph width', () => {
    const withCjk = encodeForShow('中', 'Helvetica');
    const withQuestionMark = encodeForShow('?', 'Helvetica');
    expect(withCjk.width1000).toBe(withQuestionMark.width1000);
    expect(withCjk.substitutions).toHaveLength(1);
  });

  it('uses the fixed Courier width regardless of character', () => {
    expect(encodeForShow('i', 'Courier').width1000).toBe(600);
    expect(encodeForShow('W', 'Courier').width1000).toBe(600);
  });
});

describe('winAnsiCodeToUnicode', () => {
  it('is the exact inverse of sanitizeToWinAnsi for every representable character', () => {
    for (const ch of ['A', 'z', ' ', 'é', '€', '“', '”', '—']) {
      const { codes } = sanitizeToWinAnsi(ch);
      expect(codes).toHaveLength(1);
      const [code] = codes;
      if (code === undefined) {
        throw new Error('expected one code');
      }
      expect(winAnsiCodeToUnicode(code)).toBe(ch.codePointAt(0));
    }
  });

  it('returns undefined for a CP1252 byte position that is genuinely unassigned', () => {
    expect(winAnsiCodeToUnicode(0x81)).toBeUndefined();
    expect(winAnsiCodeToUnicode(0x8d)).toBeUndefined();
  });
});
