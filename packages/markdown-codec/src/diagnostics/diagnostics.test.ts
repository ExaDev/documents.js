// Coverage sweep: every entry in MarkdownDiagnosticCodes must be reachable from some real input to this package's own read/write surface (parseMarkdown, lowerMarkdown, emitMarkdown) -- a code that exists in the table but that nothing ever fires is dead documentation, worse than no documentation at all. Each case below is deliberately minimal and independent of src/block/block.test.ts, src/lower/lower.test.ts, and src/emit/emit.test.ts's own (more thoroughly asserted) per-gap tests -- this file only cares whether the code fires at all, not what else the surrounding output looks like. The final test asserts the codes proven reachable here cover the whole MarkdownDiagnosticCodes table, so the list can never grow a new, silently-unreachable entry.

import type { ContentBlock, ContentDocument, ContentTable } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION, PAGE_SIZE_A4 } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../block/block';
import { emitMarkdown } from '../emit/emit';
import { lowerMarkdown } from '../lower/lower';
import { createDiagnosticCollector } from '../test-support/diagnostics';
import { MarkdownDiagnosticCodes } from './diagnostics';

function minimalDocument(blocks: readonly ContentBlock[]): ContentDocument {
  return { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, sections: [{ pageSize: PAGE_SIZE_A4, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks: [...blocks] }] };
}

const reached = new Set<string>();

describe('every MarkdownDiagnosticCodes entry is reachable from real input', () => {
  it('UNCLOSED_FENCE: a fenced code block never closed before end-of-input', () => {
    const collector = createDiagnosticCollector();
    parseMarkdown('```\ncode', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.UNCLOSED_FENCE)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.UNCLOSED_FENCE);
  });

  it('UNTERMINATED_HTML_BLOCK: an HTML comment block never closed before end-of-input', () => {
    const collector = createDiagnosticCollector();
    parseMarkdown('<!-- comment\nmore', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.UNTERMINATED_HTML_BLOCK)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.UNTERMINATED_HTML_BLOCK);
  });

  it('TABLE_CELL_COUNT_MISMATCH: a body row with more cells than the header row', () => {
    const collector = createDiagnosticCollector();
    parseMarkdown('| a |\n| - |\n| 1 | 2 |', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.TABLE_CELL_COUNT_MISMATCH)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.TABLE_CELL_COUNT_MISMATCH);
  });

  it('DUPLICATE_LINK_REFERENCE: two definitions sharing one label', () => {
    const collector = createDiagnosticCollector();
    parseMarkdown('[a]: /1\n[a]: /2', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.DUPLICATE_LINK_REFERENCE)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.DUPLICATE_LINK_REFERENCE);
  });

  it('LIST_MARKER_TYPE_CONFLICT: a nested list disagreeing with its enclosing list\'s minted type', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('- top\n  1. nested\n- top2', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT);
  });

  it('INVENTED_PAGE_GEOMETRY: any lowered document', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('foo', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY);
  });

  it('NESTED_EMPHASIS_FLATTENED: emphasis nested inside emphasis', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('_a *b* c_', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED);
  });

  it('LINK_TITLE_DROPPED: a link carrying a title', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('[a](/b "t")', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LINK_TITLE_DROPPED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.LINK_TITLE_DROPPED);
  });

  it('CODE_BLOCK_INFO_STRING_DROPPED: a fence with a non-empty info string', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('```js\nx\n```', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.CODE_BLOCK_INFO_STRING_DROPPED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.CODE_BLOCK_INFO_STRING_DROPPED);
  });

  it('BLOCKQUOTE_NESTED_DEPTH: a blockquote nested inside a blockquote', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('> > x', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.BLOCKQUOTE_NESTED_DEPTH)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.BLOCKQUOTE_NESTED_DEPTH);
  });

  it('LIST_ITEM_BLOCK_UNLISTED: a table directly inside a list item', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('- | a |\n  | - |\n  | 1 |', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED);
  });

  it('LIST_ITEM_MULTI_BLOCK_FLATTENED: a list item directly containing two blocks', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('- one\n\n  two', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LIST_ITEM_MULTI_BLOCK_FLATTENED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.LIST_ITEM_MULTI_BLOCK_FLATTENED);
  });

  it('IMAGE_UNRESOLVED: an image with no resolver available', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('![a](http://example.com/x.png)', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.IMAGE_UNRESOLVED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.IMAGE_UNRESOLVED);
  });

  it('RAW_HTML_PRESERVED_AS_TEXT: raw HTML with the default rawHtml option', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('<div>\nx\n</div>', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT);
  });

  it('RAW_HTML_DROPPED: raw HTML with rawHtml: "drop"', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('<div>\nx\n</div>', { sink: collector.sink, rawHtml: 'drop' });
    expect(collector.has(MarkdownDiagnosticCodes.RAW_HTML_DROPPED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.RAW_HTML_DROPPED);
  });

  it('FRONT_MATTER_KEY_UNMAPPED: an unrecognised front matter key', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('---\nunknown: x\n---\n\nbody', { sink: collector.sink, frontMatter: true });
    expect(collector.has(MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED);
  });

  it('HEADING_LEVEL_CLAMPED: a Heading{N} styleId beyond 6', () => {
    const collector = createDiagnosticCollector();
    emitMarkdown(minimalDocument([{ kind: 'paragraph', runs: [{ text: 'x' }], styleId: 'Heading9' }]), { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED);
  });

  it('ADJACENT_LINKS_MERGED: two consecutive runs sharing one hyperlink', () => {
    const collector = createDiagnosticCollector();
    emitMarkdown(minimalDocument([{ kind: 'paragraph', runs: [{ text: 'a', hyperlink: 'http://x' }, { text: 'b', hyperlink: 'http://x' }] }]), { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED);
  });

  it('CODE_SPAN_AS_MONOSPACE_RUN: a run styled with the Courier New font family', () => {
    const collector = createDiagnosticCollector();
    emitMarkdown(minimalDocument([{ kind: 'paragraph', runs: [{ text: 'x', fontFamily: 'Courier New' }] }]), { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN);
  });

  it('PARAGRAPH_INDENT_DROPPED: indentLeftPt with no quotable styleId', () => {
    const collector = createDiagnosticCollector();
    emitMarkdown(minimalDocument([{ kind: 'paragraph', runs: [{ text: 'x' }], indentLeftPt: 10 }]), { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED);
  });

  it('LIST_NUMID_FALLBACK: a numId this package never minted', () => {
    const collector = createDiagnosticCollector();
    emitMarkdown(minimalDocument([{ kind: 'paragraph', runs: [{ text: 'x' }], list: { numId: 'list1', level: 0 } }]), { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK);
  });

  it('TABLE_CELL_FORMATTING_DROPPED: a cell with colSpan set', () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = { kind: 'table', columnWidthsPt: [100], rows: [{ cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'x' }] }], colSpan: 2 }] }] };
    emitMarkdown(minimalDocument([table]), { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED);
  });

  it('TABLE_CELL_MULTI_PARAGRAPH_JOINED: a cell with two blocks', () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: 'table',
      columnWidthsPt: [100],
      rows: [{ cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'a' }] }, { kind: 'paragraph', runs: [{ text: 'b' }] }] }] }],
    };
    emitMarkdown(minimalDocument([table]), { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED)).toBe(true);
    reached.add(MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED);
  });

  it('has no dead code: every value in MarkdownDiagnosticCodes was proven reachable above', () => {
    expect(reached).toEqual(new Set(Object.values(MarkdownDiagnosticCodes)));
  });
});
