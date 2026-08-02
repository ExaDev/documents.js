// Direct tests for delimiter-run flanking classification. The conformance suite exercises this through whole documents, which is the right end-to-end check but a poor diagnostic: a flanking bug there surfaces as a wrong emphasis nesting several steps downstream. These pin the classification itself, using the exact runs the spec's own "Here are some examples of delimiter runs" list gives.

import { describe, expect, it } from 'vitest';
import { scanDelimiterRun } from './delimiter';

function classify(text: string, start: number, char: '*' | '_' | '~'): string {
  const run = scanDelimiterRun(text, start, char);
  if (run === undefined) {
    return 'none';
  }
  if (run.canOpen && run.canClose) {
    return 'both';
  }
  if (run.canOpen) {
    return 'open';
  }
  return run.canClose ? 'close' : 'neither';
}

describe('scanDelimiterRun', () => {
  it('measures the run length', () => {
    expect(scanDelimiterRun('***abc', 0, '*')?.count).toBe(3);
  });

  // spec 0.31.2's own "left-flanking but not right-flanking" examples.
  it.each([
    ['***abc', 0, '*'],
    ['  _abc', 2, '_'],
    ['**"abc"', 0, '*'],
    [' _"abc"', 1, '_'],
  ] as const)('classifies %s at %i as an opener only', (text, start, char) => {
    expect(classify(text, start, char)).toBe('open');
  });

  // spec 0.31.2's own "right-flanking but not left-flanking" examples.
  it.each([
    [' abc***', 4, '*'],
    [' abc_', 4, '_'],
    ['"abc"**', 5, '*'],
    ['"abc"_', 5, '_'],
  ] as const)('classifies %s at %i as a closer only', (text, start, char) => {
    expect(classify(text, start, char)).toBe('close');
  });

  // spec 0.31.2's own "both left and right-flanking" examples -- note `_` is deliberately NOT both here: an underscore run between two word characters can neither open nor close, which is the whole intraword-emphasis restriction.
  it('classifies an asterisk run between two word characters as both an opener and a closer', () => {
    expect(classify(' abc***def', 4, '*')).toBe('both');
  });

  it('classifies an underscore run between two word characters as neither', () => {
    expect(classify('abc_def', 3, '_')).toBe('neither');
  });

  it('classifies an underscore run between two punctuation characters as both', () => {
    expect(classify('"abc"_"def"', 5, '_')).toBe('both');
  });

  // spec 0.31.2's own "neither left nor right-flanking" examples.
  it.each([
    ['abc *** def', 4, '*'],
    ['a _ b', 2, '_'],
  ] as const)('classifies %s at %i as neither', (text, start, char) => {
    expect(classify(text, start, char)).toBe('neither');
  });

  it('treats the start and end of the block as whitespace', () => {
    expect(classify('*abc', 0, '*')).toBe('open');
    expect(classify('abc*', 3, '*')).toBe('close');
  });

  it('classifies an astral symbol adjacent to a run as punctuation, not as a lone surrogate', () => {
    // U+1F600 is in the Unicode `So` category, which spec 0.31.2 counts as a punctuation character for flanking purposes -- so this run is followed by punctuation and preceded by whitespace, making it an opener.
    expect(classify(' *\u{1F600}', 1, '*')).toBe('open');
  });

  it('rejects a tilde run longer than the two-tilde maximum GFM allows', () => {
    expect(classify('~~~a', 0, '~')).toBe('none');
    expect(classify('~~a', 0, '~')).toBe('open');
  });
});
