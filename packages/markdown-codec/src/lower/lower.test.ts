// Construct-by-construct tests for the AST -> ContentDocument lowering stage (src/lower/lower.ts). Each `describe` below maps onto one row of that module's own top-of-file table; the "gaps" describe block gives every MarkdownDiagnosticCodes entry that module produces its own targeted, real-markdown-input test.

import { ContentDocumentSchema } from 'document-schema.js';
import type { ContentBlock, ContentParagraph } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { MarkdownDiagnosticCodes } from '../diagnostics/diagnostics';
import { createDiagnosticCollector } from '../test-support/diagnostics';
import { lowerMarkdown } from './lower';

function blocks(source: string, options: Parameters<typeof lowerMarkdown>[1] = {}): ContentBlock[] {
  const doc = lowerMarkdown(source, options);
  if (doc.kind !== 'wordprocessing') {
    throw new Error('expected a wordprocessing ContentDocument');
  }
  return doc.sections[0]?.blocks ?? [];
}

function paragraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== 'paragraph') {
    throw new Error(`expected a paragraph block, got ${block?.kind}`);
  }
  return block;
}

describe('document envelope', () => {
  it('produces a valid ContentDocument for a real markdown document across a range of constructs', () => {
    const source = `# Title\n\nSome **bold _nested italic_** text with [a link](http://example.com) and \`code\`.\n\n> quote\n> > nested\n\n- a\n  - nested\n- [x] done\n- [ ] todo\n\n1. one\n2. two\n\n\`\`\`js\nconsole.log(1);\n\`\`\`\n\n***\n\n| a | b |\n| - | :-: |\n| 1 | 2 |\n`;
    const doc = lowerMarkdown(source);
    expect(doc.kind).toBe('wordprocessing');
    expect(ContentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('uses A4 and 1in margins by default, and a caller-supplied page size/margins when given', () => {
    const defaultDoc = lowerMarkdown('foo');
    if (defaultDoc.kind !== 'wordprocessing') throw new Error('unreachable');
    expect(defaultDoc.sections[0]?.pageSize).toEqual({ widthPt: 595.28, heightPt: 841.89 });

    const customDoc = lowerMarkdown('foo', { pageSize: { widthPt: 100, heightPt: 200 }, margins: { topPt: 1, rightPt: 2, bottomPt: 3, leftPt: 4 } });
    if (customDoc.kind !== 'wordprocessing') throw new Error('unreachable');
    expect(customDoc.sections[0]?.pageSize).toEqual({ widthPt: 100, heightPt: 200 });
    expect(customDoc.sections[0]?.margins).toEqual({ topPt: 1, rightPt: 2, bottomPt: 3, leftPt: 4 });
  });
});

describe('headings', () => {
  it('maps an ATX heading level to a "Heading{N}" styleId plus the canonical headingLevel', () => {
    const heading = paragraph(blocks('### foo')[0]);
    expect(heading.styleId).toBe('Heading3');
    expect(heading.headingLevel).toBe(3);
  });

  it('maps a setext heading the same way', () => {
    const heading = paragraph(blocks('foo\n===')[0]);
    expect(heading.styleId).toBe('Heading1');
    expect(heading.headingLevel).toBe(1);
  });
});

describe('emphasis, strong, strikethrough', () => {
  it('maps emphasis/strong/strikethrough to italic/bold/strike ContentRun fields', () => {
    const runs = paragraph(blocks('*a* **b** ~~c~~')[0]).runs;
    expect(runs).toMatchObject([{ text: 'a', italic: true }, { text: ' ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', strike: true }]);
  });
});

describe('links, autolinks, breaks', () => {
  it('maps a link to ContentRun.hyperlink', () => {
    expect(paragraph(blocks('[text](http://example.com)')[0]).runs).toEqual([{ text: 'text', hyperlink: 'http://example.com' }]);
  });

  it('maps an autolink to a run where text === hyperlink', () => {
    expect(paragraph(blocks('<http://example.com>')[0]).runs).toEqual([{ text: 'http://example.com', hyperlink: 'http://example.com' }]);
  });

  it('maps a hard line break to a literal newline, as its own run', () => {
    expect(paragraph(blocks('a  \nb')[0]).runs).toEqual([{ text: 'a' }, { text: '\n' }, { text: 'b' }]);
  });

  it('maps a soft line break to a single space, as its own run', () => {
    expect(paragraph(blocks('a\nb')[0]).runs).toEqual([{ text: 'a' }, { text: ' ' }, { text: 'b' }]);
  });
});

describe('code spans and code blocks', () => {
  it('maps a code span to a Courier New run', () => {
    expect(paragraph(blocks('`x`')[0]).runs).toEqual([{ text: 'x', fontFamily: 'Courier New' }]);
  });

  it('maps a fenced code block to one CodeBlock paragraph with a monospace run', () => {
    const block = paragraph(blocks('```\nfoo\nbar\n```')[0]);
    expect(block.styleId).toBe('CodeBlock');
    expect(block.runs).toEqual([{ text: 'foo\nbar', fontFamily: 'Courier New' }]);
  });
});

describe('math (ExaDev/markdown-codec#53)', () => {
  it('maps inline math to a run marked with the Cambria Math font, delimiters excluded from the run text', () => {
    expect(paragraph(blocks('\\(x^2\\)')[0]).runs).toEqual([{ text: 'x^2', fontFamily: 'Cambria Math' }]);
  });

  it('maps a $$ display math block to one MathBlock paragraph', () => {
    const block = paragraph(blocks('$$\nx^2\n$$')[0]);
    expect(block.styleId).toBe('MathBlock');
    expect(block.runs).toEqual([{ text: 'x^2' }]);
  });

  it('produces an empty-runs paragraph for an empty math block', () => {
    const block = paragraph(blocks('$$\n$$')[0]);
    expect(block.styleId).toBe('MathBlock');
    expect(block.runs).toEqual([]);
  });
});

describe('blockquotes', () => {
  it('maps a blockquote paragraph to styleId Quote plus indentLeftPt', () => {
    const block = paragraph(blocks('> foo')[0]);
    expect(block.styleId).toBe('Quote');
    expect(block.indentLeftPt).toBe(36);
  });

  it('keeps a heading inside a quote styled as Heading{N}, not Quote', () => {
    const block = paragraph(blocks('> # foo')[0]);
    expect(block.styleId).toBe('Heading1');
    expect(block.headingLevel).toBe(1);
    expect(block.indentLeftPt).toBe(36);
  });
});

describe('thematic breaks', () => {
  it('maps a thematic break to an empty paragraph styled HorizontalRule, never a page break', () => {
    const block = paragraph(blocks('***')[0]);
    expect(block.styleId).toBe('HorizontalRule');
    expect(block.runs).toEqual([]);
  });
});

describe('lists', () => {
  it('mints one numId per top-level list and reuses it, level+1, for a nested list', () => {
    const [a, nested] = blocks('- a\n  - b');
    expect(paragraph(a).list?.level).toBe(0);
    expect(paragraph(nested).list).toEqual({ numId: paragraph(a).list?.numId, level: 1 });
  });

  it('mints a fresh numId for a second, independent top-level list', () => {
    const [a, b] = blocks('- a\n\n* b');
    expect(paragraph(a).list?.numId).not.toBe(paragraph(b).list?.numId);
  });

  it('applies a checkbox glyph to a task item\'s first run and none to an ordinary sibling item', () => {
    const [checked, unchecked, plain] = blocks('- [x] done\n- [ ] todo\n- plain');
    expect(paragraph(checked).runs[0]?.text).toBe('☒ ');
    expect(paragraph(unchecked).runs[0]?.text).toBe('☐ ');
    expect(paragraph(plain).runs[0]?.text).toBe('plain');
  });
});

describe('GFM tables', () => {
  it('distributes column widths evenly and reads alignment from the delimiter row, without forcing the header row bold', () => {
    const [table] = blocks('| a | bb |\n| :- | -: |\n| 1 | 2 |');
    if (table?.kind !== 'table') throw new Error('expected a table block');
    expect(table.columnWidthsPt[0]).toBeCloseTo(table.columnWidthsPt[1] ?? 0);
    expect(table.rows[0]?.cells[0]?.blocks[0]).toMatchObject({ runs: [{ text: 'a' }], alignment: 'left' });
    expect(table.rows[0]?.cells[1]?.blocks[0]).toMatchObject({ alignment: 'right' });
    expect(table.rows[1]?.cells[0]?.blocks[0]).toMatchObject({ runs: [{ text: '1' }] });
  });
});

describe('images', () => {
  const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('resolves a data: URI image natively, splitting the paragraph at that point', () => {
    const result = blocks(`before ![alt](${onePixelPng}) after`);
    expect(result.map((block) => block.kind)).toEqual(['paragraph', 'image', 'paragraph']);
    const image = result[1];
    if (image?.kind !== 'image') throw new Error('expected an image block');
    expect(image.format).toBe('png');
    expect(image.widthPt).toBeCloseTo(0.75);
  });
});

describe('raw HTML', () => {
  it('preserves block-level HTML as literal text by default, styled HTMLPreformatted', () => {
    const block = paragraph(blocks('<div>\nfoo\n</div>')[0]);
    expect(block.styleId).toBe('HTMLPreformatted');
    expect(block.runs[0]?.text).toContain('<div>');
  });

  it('drops block-level HTML entirely when rawHtml: "drop"', () => {
    expect(blocks('<div>\nfoo\n</div>\n\nafter', { rawHtml: 'drop' }).map((block) => block.kind)).toEqual(['paragraph']);
  });
});

describe('front matter', () => {
  it('maps a flat-scalar-only subset into LayoutMetadata when frontMatter: true', () => {
    const doc = lowerMarkdown('---\ntitle: Hello\nauthor: Jo\ndate: 2024-01-01\nkeywords: [a, b]\n---\n\nbody', { frontMatter: true });
    expect(doc.metadata).toEqual({ title: 'Hello', author: 'Jo', createdIso: '2024-01-01', keywords: ['a', 'b'] });
  });

  it('never sets producer, which has no front matter equivalent', () => {
    const doc = lowerMarkdown('---\ntitle: x\n---\n\nbody', { frontMatter: true });
    expect(doc.metadata.producer).toBeUndefined();
  });
});

describe('gaps (MarkdownDiagnosticCodes)', () => {
  it('INVENTED_PAGE_GEOMETRY always fires, once per lowered document', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('foo', { sink: collector.sink });
    expect(collector.codes().filter((code) => code === MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY)).toHaveLength(1);
  });

  it('NESTED_EMPHASIS_FLATTENED fires for emphasis nested inside emphasis (of either marker)', () => {
    const collector = createDiagnosticCollector();
    const runs = paragraph(blocks('_a *b* c_', { sink: collector.sink })[0]).runs;
    expect(collector.has(MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED)).toBe(true);
    expect(runs.find((run) => run.text === 'b')).toMatchObject({ italic: true });
  });

  it('LINK_TITLE_DROPPED fires for a link title', () => {
    const collector = createDiagnosticCollector();
    blocks('[text](http://example.com "a title")', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LINK_TITLE_DROPPED)).toBe(true);
  });

  it('CODE_BLOCK_INFO_STRING_DROPPED fires for a fence with a non-empty info string', () => {
    const collector = createDiagnosticCollector();
    blocks('```js\ncode\n```', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.CODE_BLOCK_INFO_STRING_DROPPED)).toBe(true);
  });

  it('MATH_BLOCK_PRESERVED_AS_TEXT fires for a $$ display math block', () => {
    const collector = createDiagnosticCollector();
    blocks('$$\nx^2\n$$', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.MATH_BLOCK_PRESERVED_AS_TEXT)).toBe(true);
  });

  it('MATH_INLINE_PRESERVED_AS_TEXT fires for an inline \\( \\) math span', () => {
    const collector = createDiagnosticCollector();
    blocks('\\(x^2\\)', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.MATH_INLINE_PRESERVED_AS_TEXT)).toBe(true);
  });

  it('BLOCKQUOTE_NESTED_DEPTH fires beyond level 1', () => {
    const collector = createDiagnosticCollector();
    blocks('> > nested', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.BLOCKQUOTE_NESTED_DEPTH)).toBe(true);
  });

  it('LIST_ITEM_BLOCK_UNLISTED fires for a table directly inside a list item', () => {
    const collector = createDiagnosticCollector();
    const result = blocks('- | a | b |\n  | - | - |\n  | 1 | 2 |', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED)).toBe(true);
    expect(result.some((block) => block.kind === 'table')).toBe(true);
  });

  it('LIST_ITEM_MULTI_BLOCK_FLATTENED fires for a list item directly containing more than one block', () => {
    const collector = createDiagnosticCollector();
    blocks('- one\n\n  two', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LIST_ITEM_MULTI_BLOCK_FLATTENED)).toBe(true);
  });

  it('LIST_MARKER_TYPE_CONFLICT fires when a nested list disagrees with its enclosing list\'s own minted type', () => {
    const collector = createDiagnosticCollector();
    blocks('- top\n  1. nested\n- top2', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT)).toBe(true);
  });

  it('IMAGE_UNRESOLVED fires for an image with no resolver and degrades to a text run of alt text + hyperlink', () => {
    const collector = createDiagnosticCollector();
    const result = blocks('![alt text](http://example.com/x.png)', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.IMAGE_UNRESOLVED)).toBe(true);
    expect(paragraph(result[0]).runs).toEqual([{ text: 'alt text', hyperlink: 'http://example.com/x.png' }]);
  });

  it('a resolver-supplied remote image resolves via the MarkdownImageResolver port', () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), (char) => char.codePointAt(0)!);
    const result = blocks('![alt](http://example.com/x.png)', { images: () => ({ bytes: png }) });
    expect(result.some((block) => block.kind === 'image')).toBe(true);
  });

  it('RAW_HTML_PRESERVED_AS_TEXT fires by default', () => {
    const collector = createDiagnosticCollector();
    blocks('<div>\nfoo\n</div>', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT)).toBe(true);
  });

  it('RAW_HTML_DROPPED fires with rawHtml: "drop"', () => {
    const collector = createDiagnosticCollector();
    blocks('<div>\nfoo\n</div>', { sink: collector.sink, rawHtml: 'drop' });
    expect(collector.has(MarkdownDiagnosticCodes.RAW_HTML_DROPPED)).toBe(true);
  });

  it('FRONT_MATTER_KEY_UNMAPPED fires for an unrecognised front matter key', () => {
    const collector = createDiagnosticCollector();
    lowerMarkdown('---\ndraft: true\n---\n\nbody', { frontMatter: true, sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED)).toBe(true);
  });
});
