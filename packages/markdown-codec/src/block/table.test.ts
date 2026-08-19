// Unit tests for the GFM table primitives, covering the cases the vendored spec's own eight table examples do not reach -- in particular the pipe requirement on a delimiter row, which is this package's own deliberate narrowing of the GFM prose rather than something the corpus pins (see src/block/table.ts's own top-of-file note).

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './block';
import { fitRowToColumns, parseTableDelimiterRow, splitTableRow } from './table';

describe('splitTableRow', () => {
  it('drops one optional leading and one optional trailing pipe and trims each cell', () => {
    expect(splitTableRow('| a | b |')).toEqual(['a', 'b']);
    expect(splitTableRow('a | b')).toEqual(['a', 'b']);
  });

  it('keeps an empty cell between two adjacent pipes', () => {
    expect(splitTableRow('| a || b |')).toEqual(['a', '', 'b']);
  });

  it('resolves an escaped pipe into a literal one rather than splitting on it', () => {
    expect(splitTableRow('| f\\|oo |')).toEqual(['f|oo']);
  });

  it('leaves every other escape for the inline phase to resolve', () => {
    expect(splitTableRow('| a\\*b |')).toEqual(['a\\*b']);
  });

  it('splits after a doubled backslash, which escapes itself rather than the pipe', () => {
    expect(splitTableRow('a\\\\|b')).toEqual(['a\\\\', 'b']);
  });
});

describe('parseTableDelimiterRow', () => {
  it('reads each cell\'s own alignment from its colons', () => {
    expect(parseTableDelimiterRow('| --- | :-- | --: | :-: |')).toEqual(['none', 'left', 'right', 'center']);
  });

  it('rejects a row with no pipe, which is what keeps a bare `---` a setext underline', () => {
    expect(parseTableDelimiterRow('---')).toBeUndefined();
    expect(parseTableDelimiterRow(':-:')).toBeUndefined();
  });

  it('rejects a row whose cells hold anything but hyphens and colons', () => {
    expect(parseTableDelimiterRow('| --- | x |')).toBeUndefined();
    expect(parseTableDelimiterRow('| -=- |')).toBeUndefined();
  });
});

describe('fitRowToColumns', () => {
  it('pads a short row with empty cells and truncates a long one', () => {
    expect(fitRowToColumns(['a'], 3)).toEqual(['a', '', '']);
    expect(fitRowToColumns(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });
});

describe('table promotion', () => {
  it('promotes only the paragraph\'s last line, leaving earlier lines as a paragraph', () => {
    expect(parseMarkdown('intro\na | b\n--- | ---').document.children).toMatchObject([
      { type: 'paragraph', children: [{ type: 'text', value: 'intro' }] },
      { type: 'table', alignments: ['none', 'none'], children: [{ type: 'tableRow', header: true }] },
    ]);
  });

  it('does not promote when the header and delimiter rows disagree on cell count', () => {
    expect(parseMarkdown('| a | b |\n| --- |').document.children).toMatchObject([{ type: 'paragraph' }]);
  });

  it('breaks the table at the first block-level structure that follows it', () => {
    expect(parseMarkdown('| a |\n| - |\n| b |\n> quoted').document.children).toMatchObject([
      { type: 'table', children: [{ header: true }, { header: false }] },
      { type: 'blockquote' },
    ]);
  });

  it('parses inline content inside a cell', () => {
    const [table] = parseMarkdown('| *a* |\n| --- |').document.children;
    expect(table).toMatchObject({
      type: 'table',
      children: [{ type: 'tableRow', header: true, children: [{ type: 'tableCell', children: [{ type: 'emphasis', marker: '*' }] }] }],
    });
  });
});
