// AST-level tests for the block phase. The conformance suites (src/conformance.test.ts, src/gfm-conformance.test.ts) compare rendered HTML and are therefore blind to everything the AST records for the write side's benefit but HTML discards -- which bullet character a list was written with, which of `.`/`)` an ordered list used, whether a heading was written ATX or setext, whether a code block was fenced. Those are exactly what this file pins.
//
// It also covers the precedence decisions this phase had to make, where "the corpus passes" is not on its own evidence that the right rule produced the right answer.

import { describe, expect, it } from 'vitest';
import type { MarkdownBlockNode } from '../ast/ast';
import { MarkdownDiagnosticCodes } from '../diagnostics/diagnostics';
import { createDiagnosticCollector } from '../test-support/diagnostics';
import { parseMarkdown } from './block';

function parse(source: string): MarkdownBlockNode[] {
  return parseMarkdown(source).document.children;
}

describe('headings', () => {
  it('records an ATX heading\'s own style and level', () => {
    expect(parse('### foo')).toEqual([{ type: 'heading', level: 3, style: 'atx', children: [{ type: 'text', value: 'foo' }] }]);
  });

  it('records a setext heading separately from an ATX one of the same level', () => {
    expect(parse('foo\n===')).toEqual([{ type: 'heading', level: 1, style: 'setext', children: [{ type: 'text', value: 'foo' }] }]);
    expect(parse('foo\n---')).toEqual([{ type: 'heading', level: 2, style: 'setext', children: [{ type: 'text', value: 'foo' }] }]);
  });

  it('promotes only the paragraph it directly follows, never a lazily continued one', () => {
    // The `---` cannot reach the paragraph inside the block quote, so it is a thematic break in the document itself.
    expect(parse('> foo\n---')).toEqual([
      { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'foo' }] }] },
      { type: 'thematicBreak' },
    ]);
  });
});

describe('code blocks', () => {
  it('records a fenced block\'s own fence character and info string', () => {
    expect(parse('~~~ruby extra\nfoo\n~~~')).toEqual([{ type: 'codeBlock', fenced: true, fenceChar: '~', infoString: 'ruby extra', literal: 'foo\n' }]);
  });

  it('records an indented block as unfenced, with no fence character or info string', () => {
    expect(parse('    foo')).toEqual([{ type: 'codeBlock', fenced: false, literal: 'foo\n' }]);
  });
});

describe('lists', () => {
  it('records the bullet character a list was written with', () => {
    expect(parse('+ foo')).toEqual([
      { type: 'list', markerType: 'bullet', bulletMarker: '+', tight: true, children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'foo' }] }] }] },
    ]);
  });

  it('records an ordered list\'s own delimiter and start number', () => {
    const [list] = parse('3) foo');
    expect(list).toMatchObject({ type: 'list', markerType: 'ordered', orderedDelimiter: ')', start: 3 });
  });

  it('starts a new list when the marker type changes, with no blank line between', () => {
    const blocks = parse('- foo\n* bar');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'list', bulletMarker: '-' });
    expect(blocks[1]).toMatchObject({ type: 'list', bulletMarker: '*' });
  });

  it('marks a list loose when a blank line separates its items and tight when none does', () => {
    expect(parse('- a\n- b')[0]).toMatchObject({ tight: true });
    expect(parse('- a\n\n- b')[0]).toMatchObject({ tight: false });
  });

  it('marks a list loose when one item holds two blocks separated by a blank line', () => {
    expect(parse('- a\n\n  b\n- c')[0]).toMatchObject({ tight: false });
  });

  it('reads a marker followed by a blank line as an item whose content starts on a later line', () => {
    expect(parse('-\n  foo')).toEqual([
      { type: 'list', markerType: 'bullet', bulletMarker: '-', tight: true, children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'foo' }] }] }] },
    ]);
  });

  it('treats five or more spaces after the marker as indented code, not as the item\'s content indent', () => {
    expect(parse('-     foo')).toEqual([
      { type: 'list', markerType: 'bullet', bulletMarker: '-', tight: true, children: [{ type: 'listItem', children: [{ type: 'codeBlock', fenced: false, literal: 'foo\n' }] }] },
    ]);
  });

  it('takes the content indent from where the content actually starts, up to four spaces', () => {
    // Content at four columns, so a continuation line indented four columns belongs to the item rather than starting a code block.
    expect(parse('-   foo\n    bar')).toEqual([
      { type: 'list', markerType: 'bullet', bulletMarker: '-', tight: true, children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'foo' }, { type: 'softBreak' }, { type: 'text', value: 'bar' }] }] }] },
    ]);
  });

  it('reads three bullet markers with nothing after them as a thematic break, not as three empty items', () => {
    expect(parse('- - -')).toEqual([{ type: 'thematicBreak' }]);
    expect(parse('* * *')).toEqual([{ type: 'thematicBreak' }]);
  });
});

describe('containers and lazy continuation', () => {
  it('continues a paragraph inside a block quote across a line with no marker', () => {
    expect(parse('> foo\nbar')).toEqual([
      { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'foo' }, { type: 'softBreak' }, { type: 'text', value: 'bar' }] }] },
    ]);
  });

  it('closes the block quote when the unmarked line starts a block of its own', () => {
    expect(parse('> foo\n# bar')).toEqual([
      { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'foo' }] }] },
      { type: 'heading', level: 1, style: 'atx', children: [{ type: 'text', value: 'bar' }] },
    ]);
  });

  it('nests a list inside a block quote inside a list item', () => {
    expect(parse('- > - foo')).toMatchObject([
      { type: 'list', children: [{ type: 'listItem', children: [{ type: 'blockquote', children: [{ type: 'list', children: [{ type: 'listItem' }] }] }] }] },
    ]);
  });
});

describe('link reference definitions', () => {
  it('resolves a reference against a definition that appears later in the document', () => {
    const { document, references } = parseMarkdown('[foo]\n\n[foo]: /url "t"');
    expect(references.get('FOO')).toEqual({ destination: '/url', title: 't' });
    expect(document.children).toEqual([{ type: 'paragraph', children: [{ type: 'link', destination: '/url', title: 't', children: [{ type: 'text', value: 'foo' }] }] }]);
  });

  it('resolves a reference against a definition nested inside a block quote', () => {
    expect(parseMarkdown('[foo]\n\n> [foo]: /url').document.children[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'link', destination: '/url', children: [{ type: 'text', value: 'foo' }] }],
    });
  });

  it('keeps the first of two definitions sharing a label', () => {
    expect(parseMarkdown('[foo]: /first\n[foo]: /second').references.get('FOO')).toEqual({ destination: '/first' });
  });

  it('leaves no block behind for a paragraph that held nothing but definitions', () => {
    expect(parse('[foo]: /url')).toEqual([]);
  });
});

describe('HTML blocks', () => {
  it('ends a type-6 block at a blank line and keeps its literal source verbatim', () => {
    expect(parse('<div>\n*foo*\n\nbar')).toEqual([
      { type: 'htmlBlock', literal: '<div>\n*foo*' },
      { type: 'paragraph', children: [{ type: 'text', value: 'bar' }] },
    ]);
  });

  it('does not let a type-7 block interrupt a paragraph', () => {
    expect(parse('foo\n<a href="x">')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'foo' }, { type: 'softBreak' }, { type: 'rawHtml', literal: '<a href="x">' }] },
    ]);
  });
});

describe('GFM extension toggles', () => {
  it('reads a delimiter row as ordinary paragraph text when tables are disabled', () => {
    expect(parseMarkdown('| a |\n| - |', { gfmTables: false }).document.children).toMatchObject([{ type: 'paragraph' }]);
  });
});

describe('GFM task list items', () => {
  it('reads [ ] and [x] as an unchecked/checked task list item, stripping the marker from the item\'s own text', () => {
    expect(parse('- [ ] todo\n- [x] done')).toEqual([
      {
        type: 'list',
        markerType: 'bullet',
        bulletMarker: '-',
        tight: true,
        children: [
          { type: 'listItem', checked: false, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'todo' }] }] },
          { type: 'listItem', checked: true, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'done' }] }] },
        ],
      },
    ]);
  });

  it('leaves an ordinary item with no checked field at all, not false', () => {
    const [list] = parse('- foo');
    expect(list).toMatchObject({ children: [{ type: 'listItem' }] });
    if (list?.type !== 'list') throw new Error('expected a list node');
    expect(list.children[0]?.checked).toBeUndefined();
  });

  it('reads a leading [ ]/[x] as ordinary text when task lists are disabled', () => {
    const [list] = parseMarkdown('- [ ] foo', { gfmTaskLists: false }).document.children;
    expect(list).toMatchObject({ type: 'list', children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '[ ] foo' }] }] }] });
    if (list?.type !== 'list') throw new Error('expected a list node');
    expect(list.children[0]?.checked).toBeUndefined();
  });
});

describe('recover-tier diagnostics', () => {
  it('reports an unclosed fenced code block reaching end-of-input', () => {
    const collector = createDiagnosticCollector();
    parseMarkdown('```js\ncode', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.UNCLOSED_FENCE)).toBe(true);
  });

  it('reports an HTML comment block that never meets its own closing "-->" before end-of-input', () => {
    const collector = createDiagnosticCollector();
    parseMarkdown('<!-- comment\nmore text', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.UNTERMINATED_HTML_BLOCK)).toBe(true);
  });

  it('reports a table row whose cell count does not match the header row', () => {
    const collector = createDiagnosticCollector();
    parseMarkdown('| a | b |\n| - | - |\n| 1 | 2 | 3 |', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.TABLE_CELL_COUNT_MISMATCH)).toBe(true);
  });

  it('reports a second link reference definition sharing an already-defined label', () => {
    const collector = createDiagnosticCollector();
    parseMarkdown('[foo]: /first\n[foo]: /second', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.DUPLICATE_LINK_REFERENCE)).toBe(true);
  });
});
