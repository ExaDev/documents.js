// Direct tests for the link-syntax primitives the inline phase and the (future) block phase must agree on exactly. Label normalisation especially: a definition written by one and a reference read by the other must normalise to the identical key, and a mismatch there fails silently as an unresolved reference rather than as an error.

import { describe, expect, it } from 'vitest';
import { matchLinkLabel, normalizeLinkLabel, parseLinkDestination, parseLinkTitle, skipInlineWhitespace } from './link';

describe('normalizeLinkLabel', () => {
  it('strips the brackets, trims, collapses internal whitespace, and case-folds', () => {
    expect(normalizeLinkLabel('[  Foo\n\tBar  ]')).toBe('FOO BAR');
  });

  it('folds case pairs a single toLowerCase would leave distinct', () => {
    expect(normalizeLinkLabel('[ẞ]')).toBe(normalizeLinkLabel('[ß]'));
  });
});

describe('matchLinkLabel', () => {
  it('returns the length including both brackets', () => {
    expect(matchLinkLabel('[foo]', 0)).toBe(5);
  });

  it('matches an empty label, which the caller reads as the collapsed form', () => {
    expect(matchLinkLabel('[]', 0)).toBe(2);
  });

  it('allows an escaped bracket but rejects an unescaped one', () => {
    expect(matchLinkLabel('[a\\]b]', 0)).toBe(6);
    expect(matchLinkLabel('[a[b]', 0)).toBe(0);
  });

  it('rejects a label longer than the 999-character maximum', () => {
    expect(matchLinkLabel(`[${'a'.repeat(999)}]`, 0)).toBe(1001);
    expect(matchLinkLabel(`[${'a'.repeat(1000)}]`, 0)).toBe(0);
  });
});

describe('parseLinkDestination', () => {
  it('reads an angle-bracketed destination and unescapes it', () => {
    expect(parseLinkDestination('<a\\>b>', 0)).toEqual({ value: 'a>b', end: 6 });
  });

  it('reads an empty angle-bracketed destination', () => {
    expect(parseLinkDestination('<>', 0)).toEqual({ value: '', end: 2 });
  });

  it('rejects an angle-bracketed destination containing a line ending', () => {
    expect(parseLinkDestination('<a\nb>', 0)).toBeUndefined();
  });

  it('reads a bare destination with balanced parentheses', () => {
    expect(parseLinkDestination('/a(b)c)', 0)).toEqual({ value: '/a(b)c', end: 6 });
  });

  it('rejects a bare destination with unbalanced parentheses', () => {
    expect(parseLinkDestination('/a(b', 0)).toBeUndefined();
  });

  it('stops at a space and resolves a character reference', () => {
    expect(parseLinkDestination('/f&ouml;o rest', 0)).toEqual({ value: '/föo', end: 9 });
  });
});

describe('parseLinkTitle', () => {
  it.each(['"t"', "'t'", '(t)'])('reads the %s form', (source) => {
    expect(parseLinkTitle(source, 0)).toEqual({ value: 't', end: 3 });
  });

  it('allows the delimiter inside only when escaped', () => {
    expect(parseLinkTitle('"a\\"b"', 0)).toEqual({ value: 'a"b', end: 6 });
  });

  it('rejects an unescaped opening parenthesis inside the parenthesised form', () => {
    expect(parseLinkTitle('(a(b)', 0)).toBeUndefined();
  });

  it('rejects an unterminated title', () => {
    expect(parseLinkTitle('"abc', 0)).toBeUndefined();
  });
});

describe('skipInlineWhitespace', () => {
  it('skips spaces and tabs and at most one line ending', () => {
    expect(skipInlineWhitespace('  \t \n  x', 0)).toBe(7);
  });

  it('stops at a blank line, which can never appear inside one inline construct', () => {
    expect(skipInlineWhitespace(' \n \n x', 0)).toBe(3);
  });
});
