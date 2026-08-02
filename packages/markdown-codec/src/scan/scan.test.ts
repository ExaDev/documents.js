import { describe, expect, it } from 'vitest';
import { MarkdownScanCursor } from './scan';

describe('MarkdownScanCursor', () => {
  it('advances one column per plain character and tracks line/column', () => {
    const cursor = new MarkdownScanCursor('ab');
    expect(cursor.position).toEqual({ offset: 0, line: 1, column: 0 });
    expect(cursor.next()).toBe('a');
    expect(cursor.position).toEqual({ offset: 1, line: 1, column: 1 });
    expect(cursor.next()).toBe('b');
    expect(cursor.position).toEqual({ offset: 2, line: 1, column: 2 });
    expect(cursor.atEnd()).toBe(true);
    expect(cursor.next()).toBeUndefined();
  });

  it('expands a tab at column 0 to the next 4-column tab stop, one column at a time', () => {
    const cursor = new MarkdownScanCursor('\tx');
    expect(cursor.next()).toBe(' ');
    expect(cursor.position).toEqual({ offset: 0, line: 1, column: 1 });
    expect(cursor.next()).toBe(' ');
    expect(cursor.next()).toBe(' ');
    expect(cursor.next()).toBe(' ');
    expect(cursor.position).toEqual({ offset: 1, line: 1, column: 4 });
    expect(cursor.next()).toBe('x');
    expect(cursor.position).toEqual({ offset: 2, line: 1, column: 5 });
  });

  it('expands a tab starting mid-tab-stop to only the remaining columns (spec example: two spaces then a tab)', () => {
    const cursor = new MarkdownScanCursor('  \tfoo');
    cursor.next();
    cursor.next();
    expect(cursor.position.column).toBe(2);
    expect(cursor.next()).toBe(' ');
    expect(cursor.position).toEqual({ offset: 2, line: 1, column: 3 });
    expect(cursor.next()).toBe(' ');
    expect(cursor.position).toEqual({ offset: 3, line: 1, column: 4 });
    expect(cursor.next()).toBe('f');
  });

  it('consumes a tab one column before a tab stop in a single step, with no pending partial state', () => {
    // Column 3 is one short of the next tab stop (4), so the tab there expands to exactly one column.
    const cursor = new MarkdownScanCursor('   \tx');
    for (let i = 0; i < 3; i++) cursor.next();
    expect(cursor.position.column).toBe(3);
    expect(cursor.next()).toBe(' ');
    expect(cursor.position).toEqual({ offset: 4, line: 1, column: 4 });
    expect(cursor.next()).toBe('x');
  });

  it('expands a tab already sitting on a tab stop to a full 4 columns', () => {
    const cursor = new MarkdownScanCursor('    \tx');
    for (let i = 0; i < 4; i++) cursor.next();
    expect(cursor.position.column).toBe(4);
    expect(cursor.next()).toBe(' ');
    expect(cursor.position).toEqual({ offset: 4, line: 1, column: 5 });
    expect(cursor.next()).toBe(' ');
    expect(cursor.next()).toBe(' ');
    expect(cursor.next()).toBe(' ');
    expect(cursor.position).toEqual({ offset: 5, line: 1, column: 8 });
    expect(cursor.next()).toBe('x');
  });

  it('peek() reflects mid-tab-expansion state without consuming', () => {
    const cursor = new MarkdownScanCursor('\tx');
    expect(cursor.peek()).toBe(' ');
    cursor.next();
    expect(cursor.peek()).toBe(' ');
    expect(cursor.position.column).toBe(1);
  });

  it('peekRaw() reads real source characters, ignoring pending tab-expansion state', () => {
    const cursor = new MarkdownScanCursor('\tfoo');
    cursor.next(); // consume the first of the tab's expanded columns; rawOffset stays at the tab itself
    expect(cursor.peekRaw(4)).toBe('\tfoo');
  });

  it('treats LF, CRLF, and lone CR as a single logical newline, resetting column and advancing line', () => {
    for (const [source, label] of [
      ['a\nb', 'LF'],
      ['a\r\nb', 'CRLF'],
      ['a\rb', 'CR'],
    ] as const) {
      const cursor = new MarkdownScanCursor(source);
      cursor.next(); // 'a'
      expect(cursor.next(), label).toBe('\n');
      expect(cursor.position.line, label).toBe(2);
      expect(cursor.position.column, label).toBe(0);
      expect(cursor.next(), label).toBe('b');
    }
  });

  it('mark()/reset() restores the cursor to an exact prior state, including mid-tab-expansion', () => {
    const cursor = new MarkdownScanCursor('\tfoo');
    cursor.next(); // one column into the tab's own 4-column expansion
    const mark = cursor.mark();
    expect(cursor.next()).toBe(' ');
    expect(cursor.next()).toBe(' ');
    expect(cursor.next()).toBe(' ');
    expect(cursor.next()).toBe('f');
    cursor.reset(mark);
    expect(cursor.position.column).toBe(1);
    expect(cursor.next()).toBe(' ');
    expect(cursor.next()).toBe(' ');
    expect(cursor.next()).toBe(' ');
    expect(cursor.next()).toBe('f');
  });

  it('atEnd() is false while a tab expansion is still pending, even past the raw source length', () => {
    const cursor = new MarkdownScanCursor('\t');
    // The lone tab at column 0 expands to 4 columns in total.
    cursor.next();
    expect(cursor.atEnd()).toBe(false);
    cursor.next();
    cursor.next();
    expect(cursor.atEnd()).toBe(false);
    cursor.next();
    expect(cursor.atEnd()).toBe(true);
  });
});
