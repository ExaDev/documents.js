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

  it("carries a fence's language word as the paragraph's codeLanguage", () => {
    const block = paragraph(blocks('```js\nfoo\n```')[0]);
    expect(block.styleId).toBe('CodeBlock');
    expect(block.codeLanguage).toBe('js');
    expect(block.source).toBeUndefined();
  });

  it('quarantines everything after the language word as markdown residue on the paragraph', () => {
    const block = paragraph(blocks('```js {.numberLines #demo}\nfoo\n```')[0]);
    expect(block.codeLanguage).toBe('js');
    expect(block.source).toEqual({ format: 'markdown', xml: '{.numberLines #demo}' });
  });

  it('treats an info string that opens with a pandoc attribute block as pure residue, no language word', () => {
    const block = paragraph(blocks('```{.haskell .numberLines}\nfoo\n```')[0]);
    expect(block.codeLanguage).toBeUndefined();
    expect(block.source).toEqual({ format: 'markdown', xml: '{.haskell .numberLines}' });
  });

  it('carries neither field for a bare fence or an indented code block, which have no info string at all', () => {
    const fenced = paragraph(blocks('```\nfoo\n```')[0]);
    expect(fenced.codeLanguage).toBeUndefined();
    expect(fenced.source).toBeUndefined();
    const indented = paragraph(blocks('    foo')[0]);
    expect(indented.codeLanguage).toBeUndefined();
    expect(indented.source).toBeUndefined();
  });
});

describe('math (ExaDev/markdown-codec#53)', () => {
  it('maps inline math to a run marked with the Cambria Math font, delimiters excluded from the run text', () => {
    expect(paragraph(blocks('\\(x^2\\)')[0]).runs).toEqual([{ text: 'x^2', fontFamily: 'Cambria Math' }]);
  });

  it('maps a $$ display math block to one embedded formula object carrying the LaTeX verbatim in presentation, with no MathML and no semantic layer', () => {
    const [block] = blocks('$$\nx^2\n$$');
    if (block?.kind !== 'embeddedObject') throw new Error(`expected an embeddedObject block, got ${block?.kind}`);
    expect(block.objectKind).toBe('formula');
    expect(block.frame).toEqual({ xPt: 0, yPt: 0, widthPt: 0, heightPt: 0 });
    expect(block.document.kind).toBe('formula');
    if (block.document.kind !== 'formula') throw new Error('unreachable');
    expect(block.document.formula.mathml).toEqual([]);
    expect(block.document.formula.presentation).toEqual({ latex: 'x^2' });
    expect(block.document.formula.content).toBeUndefined();
    expect(ContentDocumentSchema.safeParse(lowerMarkdown('$$\nx^2\n$$')).success).toBe(true);
  });

  it('carries an empty math block as a formula with an empty presentation LaTeX', () => {
    const [block] = blocks('$$\n$$');
    if (block?.kind !== 'embeddedObject') throw new Error(`expected an embeddedObject block, got ${block?.kind}`);
    if (block.document.kind !== 'formula') throw new Error('unreachable');
    expect(block.document.formula.presentation).toEqual({ latex: '' });
  });
});

describe('blockquotes', () => {
  it('maps a blockquote paragraph to styleId Quote plus indentLeftPt', () => {
    const block = paragraph(blocks('> foo')[1]);
    expect(block.styleId).toBe('Quote');
    expect(block.indentLeftPt).toBe(36);
  });

  it('wraps a blockquote\'s blocks in a division construct pair, keeping the indent and Quote styleId as the materialised formatting', () => {
    const [start, inner, end] = blocks('> foo');
    expect(start?.kind).toBe('constructStart');
    if (start?.kind !== 'constructStart') throw new Error('expected a constructStart');
    expect(start.descriptor).toEqual({ kind: 'division' });
    expect(inner?.kind).toBe('paragraph');
    expect(end?.kind).toBe('constructEnd');
  });

  it('wraps one quote containing several blocks in ONE pair -- the container boundary the indent alone never carried', () => {
    const kinds = blocks('> a\n>\n> b').map((block) => block.kind);
    expect(kinds).toEqual(['constructStart', 'paragraph', 'paragraph', 'constructEnd']);
  });

  it('nests one pair per nesting level for a quoted quote', () => {
    const kinds = blocks('> > deep').map((block) => block.kind);
    expect(kinds).toEqual(['constructStart', 'constructStart', 'paragraph', 'constructEnd', 'constructEnd']);
  });

  it('keeps a heading inside a quote styled as Heading{N}, not Quote, and skips the division pair for that quote -- a marker extent may not open a heading scope', () => {
    const collector = createDiagnosticCollector();
    const [block] = blocks('> # foo', { sink: collector.sink });
    expect(block?.kind).toBe('paragraph');
    expect(paragraph(block).styleId).toBe('Heading1');
    expect(paragraph(block).headingLevel).toBe(1);
    expect(paragraph(block).indentLeftPt).toBe(36);
    expect(collector.has(MarkdownDiagnosticCodes.BLOCKQUOTE_CONTAINER_SKIPPED)).toBe(true);
  });

  it('skips the pair for a quote containing a heading anywhere in its subtree, including inside a nested list', () => {
    const collector = createDiagnosticCollector();
    const kinds = blocks('> - item\n>\n>   # heading in item', { sink: collector.sink }).map((block) => block.kind);
    expect(kinds).not.toContain('constructStart');
    expect(collector.has(MarkdownDiagnosticCodes.BLOCKQUOTE_CONTAINER_SKIPPED)).toBe(true);
  });

  it('wraps a quote inside a list item, the pair sitting among the item\'s own membership-carrying blocks', () => {
    const result = blocks('- item\n\n  > quoted');
    expect(result.map((block) => block.kind)).toEqual(['paragraph', 'constructStart', 'paragraph', 'constructEnd']);
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
    expect(paragraph(nested).list).toMatchObject({ numId: paragraph(a).list?.numId, level: 1 });
  });

  it('mints a fresh numId for a second, independent top-level list', () => {
    const [a, b] = blocks('- a\n\n* b');
    expect(paragraph(a).list?.numId).not.toBe(paragraph(b).list?.numId);
  });

  it('carries a task item\'s checkbox state as membership.checked, with no glyph run prepended to the text', () => {
    const [checked, unchecked, plain] = blocks('- [x] done\n- [ ] todo\n- plain');
    expect(paragraph(checked).list?.checked).toBe(true);
    expect(paragraph(unchecked).list?.checked).toBe(false);
    expect(paragraph(plain).list?.checked).toBeUndefined();
    expect(paragraph(checked).runs[0]?.text).toBe('done');
    expect(paragraph(unchecked).runs[0]?.text).toBe('todo');
  });

  it('mints a distinct itemId per item, shared by every block of one multi-block item and separating it from a sibling with the same numId and level', () => {
    const [first, second, third] = blocks('- a\n\n  continuation of a\n- b');
    const firstId = paragraph(first).list?.itemId;
    const secondId = paragraph(second).list?.itemId;
    const thirdId = paragraph(third).list?.itemId;
    expect(firstId).toMatch(/^md-i\d+$/);
    expect(secondId).toBe(firstId);
    expect(thirdId).not.toBe(firstId);
    expect(paragraph(third).list?.numId).toBe(paragraph(first).list?.numId);
    expect(paragraph(third).list?.level).toBe(paragraph(first).list?.level);
  });

  it('carries itemId on the empty-item placeholder too, when the item\'s only content is a nested list', () => {
    const [placeholder] = blocks('-\n  - nested');
    const membership = paragraph(placeholder).list;
    expect(membership?.itemId).toMatch(/^md-i\d+$/);
    expect(paragraph(placeholder).runs).toEqual([]);
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

describe('link and image titles (the `link` construct annotation)', () => {
  it('carries an inline link title as a run-level link construct extent over the link\'s own runs, hyperlink untouched on the runs', () => {
    const block = paragraph(blocks('[text](http://example.com "the title")')[0]);
    expect(block.runs).toEqual([{ text: 'text', hyperlink: 'http://example.com' }]);
    expect(block.constructs).toEqual([
      { descriptor: { kind: 'link', target: { kind: 'external', uri: 'http://example.com' }, title: 'the title' }, startRun: 0, endRun: 1 },
    ]);
  });

  it('carries a reference link title from its definition once resolved, same shape as an inline title', () => {
    const block = paragraph(blocks('[text][label]\n\n[label]: /url "ref title"')[0]);
    expect(block.constructs).toEqual([
      { descriptor: { kind: 'link', target: { kind: 'external', uri: '/url' }, title: 'ref title' }, startRun: 0, endRun: 1 },
    ]);
  });

  it('scopes the extent to the link\'s own runs when the link sits inside emphasis, with surrounding runs outside it', () => {
    const block = paragraph(blocks('a **b [c](/u "t") d** e')[0]);
    expect(block.constructs).toEqual([
      { descriptor: { kind: 'link', target: { kind: 'external', uri: '/u' }, title: 't' }, startRun: 2, endRun: 3 },
    ]);
  });

  it('records one extent per titled link, ranges naming each link\'s own run span', () => {
    const block = paragraph(blocks('[one](/1 "a") middle [two](/2 "b")')[0]);
    expect(block.constructs).toEqual([
      { descriptor: { kind: 'link', target: { kind: 'external', uri: '/1' }, title: 'a' }, startRun: 0, endRun: 1 },
      { descriptor: { kind: 'link', target: { kind: 'external', uri: '/2' }, title: 'b' }, startRun: 2, endRun: 3 },
    ]);
  });

  it('leaves the constructs field absent for an untitled link', () => {
    const block = paragraph(blocks('[text](/u)')[0]);
    expect(block.constructs).toBeUndefined();
  });

  it('carries a titled link inside a heading and inside a table cell, both paragraph positions', () => {
    const heading = paragraph(blocks('# [t](/u "h")')[0]);
    expect(heading.constructs).toHaveLength(1);
    const table = blocks('| [t](/u "c") |\n| --- |\n| x |')[0];
    if (table?.kind !== 'table') throw new Error('expected a table block');
    const cell = table.rows[0]?.cells[0]?.blocks[0];
    if (cell?.kind !== 'paragraph') throw new Error('expected a cell paragraph');
    expect(cell.constructs).toHaveLength(1);
  });

  it('wraps a titled resolved image in a block-scoped link construct pair carrying the original destination and title', () => {
    const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const result = blocks(`![alt](${onePixelPng} "img title")`);
    expect(result.map((block) => block.kind)).toEqual(['constructStart', 'image', 'constructEnd']);
    const start = result[0];
    if (start?.kind !== 'constructStart') throw new Error('expected a constructStart');
    expect(start.descriptor).toEqual({ kind: 'link', target: { kind: 'external', uri: onePixelPng }, title: 'img title' });
  });

  it('still drops the title of a nested image (inside a link) and an unresolved top-level image, one LINK_TITLE_DROPPED each', () => {
    const collector = createDiagnosticCollector();
    const nested = paragraph(blocks('[![alt](/img.png "nested title")](/page)', { sink: collector.sink })[0]);
    expect(nested.constructs).toBeUndefined();
    const unresolved = blocks('![alt](/no.png "dropped title")\n\ntext', { sink: collector.sink, images: () => undefined })[0];
    if (unresolved?.kind !== 'paragraph') throw new Error('expected the degraded image run paragraph');
    expect(unresolved.constructs).toBeUndefined();
    expect(collector.codes().filter((code) => code === MarkdownDiagnosticCodes.LINK_TITLE_DROPPED)).toHaveLength(2);
  });
});

describe('raw HTML', () => {
  it('preserves block-level HTML as literal text by default, styled HTMLPreformatted, with the verbatim source quarantined as markdown residue on the paragraph', () => {
    const block = paragraph(blocks('<div>\nfoo\n</div>\n\nafter')[0]);
    expect(block.styleId).toBe('HTMLPreformatted');
    expect(block.runs[0]?.text).toContain('<div>');
    expect(block.source).toEqual({ format: 'markdown', xml: '<div>\nfoo\n</div>' });
  });

  it('quarantines inline raw HTML verbatim as markdown residue on each tag\'s own run -- the parser emits one rawHtml node per tag, so the residue is per tag', () => {
    const runs = paragraph(blocks('before <em>raw</em> after')[0]).runs;
    expect(runs[1]?.source).toEqual({ format: 'markdown', xml: '<em>' });
    expect(runs[3]?.source).toEqual({ format: 'markdown', xml: '</em>' });
    expect(runs[0]?.source).toBeUndefined();
  });

  it('carries no residue when rawHtml: "drop" discards the HTML entirely', () => {
    const block = paragraph(blocks('<div>\nfoo\n</div>\n\nafter', { rawHtml: 'drop' })[0]);
    expect(block.source).toBeUndefined();
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

  it('LINK_TITLE_DROPPED fires for the one titled shape left with nowhere to ride -- a nested image inside a link', () => {
    const collector = createDiagnosticCollector();
    blocks('[![alt](/img.png "t")](/page)', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LINK_TITLE_DROPPED)).toBe(true);
  });

  it('MATH_INLINE_PRESERVED_AS_TEXT fires for an inline \\( \\) math span', () => {
    const collector = createDiagnosticCollector();
    blocks('\\(x^2\\)', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.MATH_INLINE_PRESERVED_AS_TEXT)).toBe(true);
  });

  it('BLOCKQUOTE_NESTED_DEPTH is retired: nesting beyond level 1 is now exact through nested division pairs, firing nothing beyond the always-on page-geometry note', () => {
    const collector = createDiagnosticCollector();
    blocks('> > nested', { sink: collector.sink });
    expect(collector.codes().filter((code) => code !== MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY)).toEqual([]);
  });

  it('LIST_ITEM_BLOCK_UNLISTED fires for a table directly inside a list item', () => {
    const collector = createDiagnosticCollector();
    const result = blocks('- | a | b |\n  | - | - |\n  | 1 | 2 |', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED)).toBe(true);
    expect(result.some((block) => block.kind === 'table')).toBe(true);
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
