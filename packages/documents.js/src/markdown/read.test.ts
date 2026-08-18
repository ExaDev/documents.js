
import { describe, expect, it } from 'vitest';
import { richMarkdownText, richMarkdownTextWithFrontMatter } from '../test-support/markdown';
import { readMarkdownContent } from './read';

describe('readMarkdownContent', () => {
  it('produces a wordprocessing ContentDocument at the current CONTENT_FORMAT_VERSION', () => {
    const content = readMarkdownContent(richMarkdownText());
    expect(content.kind).toBe('wordprocessing');
  });

  it('lowers a heading to a Heading1-styled paragraph, matching odf.js/ooxml.js\'s own convention', () => {
    const content = readMarkdownContent(richMarkdownText());
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const heading = content.sections[0]?.blocks[0];
    expect(heading?.kind).toBe('paragraph');
    expect(heading?.kind === 'paragraph' ? heading.styleId : undefined).toBe('Heading1');
    expect(heading?.kind === 'paragraph' ? heading.runs.map((r) => r.text).join('') : undefined).toBe('Report Title');
  });

  it('lowers a bold+italic run', () => {
    const content = readMarkdownContent(richMarkdownText());
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const paragraph = content.sections[0]?.blocks[1];
    expect(paragraph?.kind).toBe('paragraph');
    const runs = paragraph?.kind === 'paragraph' ? paragraph.runs : [];
    expect(runs.some((r) => r.bold === true)).toBe(true);
    expect(runs.some((r) => r.italic === true)).toBe(true);
  });

  it('lowers a two-level bullet list into ContentListMembership numId/level', () => {
    const content = readMarkdownContent(richMarkdownText());
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const listBlocks = content.sections[0]!.blocks.filter((b) => b.kind === 'paragraph' && b.list !== undefined);
    const levels = listBlocks.map((b) => (b.kind === 'paragraph' ? b.list?.level : undefined));
    expect(levels).toEqual([0, 0, 1, 0]);
    const numIds = new Set(listBlocks.map((b) => (b.kind === 'paragraph' ? b.list?.numId : undefined)));
    expect(numIds.size).toBe(1);
  });

  it('lowers a GFM table into a ContentTable block', () => {
    const content = readMarkdownContent(richMarkdownText());
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const table = content.sections[0]!.blocks.find((b) => b.kind === 'table');
    expect(table?.kind).toBe('table');
    if (table?.kind === 'table') {
      expect(table.rows).toHaveLength(3);
      const cellText = (row: number, column: number) => {
        const block = table.rows[row]?.cells[column]?.blocks[0];
        return block?.kind === 'paragraph' ? block.runs.map((r) => r.text).join('') : undefined;
      };
      expect(cellText(1, 0)).toBe('A1');
      expect(cellText(2, 1)).toBe('B2');
    }
  });

  it('parses front matter into LayoutMetadata when frontMatter: true is passed', () => {
    const content = readMarkdownContent(richMarkdownTextWithFrontMatter(), { frontMatter: true });
    expect(content.metadata.title).toBe('Sample Report');
    expect(content.metadata.author).toBe('Ada Lovelace');
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => readMarkdownContent(richMarkdownText(), { signal: controller.signal })).toThrow();
  });
});
