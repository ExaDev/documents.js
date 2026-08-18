// Construct-by-construct tests for the ContentDocument -> markdown emission stage (src/emit/emit.ts), the structural inverse of src/lower/lower.test.ts. Most tests here build a ContentDocument directly (bypassing src/lower entirely) so each construct -- including a cross-format shape src/lower itself never produces, like a paragraph with indentLeftPt but no quotable styleId -- can be exercised in isolation; a handful round-trip through src/lower/lower.ts first where that is the more natural way to obtain a real value (a code span run, a task-list item).

import type { ContentDocument, ContentImageBlock, ContentParagraph, ContentTable } from 'document-schema.js';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MARGINS } from '../defaults/defaults';
import { MarkdownDiagnosticCodes } from '../diagnostics/diagnostics';
import { lowerMarkdown } from '../lower/lower';
import { createDiagnosticCollector } from '../test-support/diagnostics';
import { emitMarkdown } from './emit';

function doc(blocks: readonly (ContentParagraph | ContentTable | ContentImageBlock)[]): ContentDocument {
  return {
    kind: 'wordprocessing',
    metadata: {},
    sections: [{ pageSize: PAGE_SIZE_A4, margins: DEFAULT_MARGINS, blocks: [...blocks] }],
  };
}

describe('headings', () => {
  it('emits a Heading{N} styleId as ATX by default', () => {
    expect(emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'foo' }], styleId: 'Heading3' }]))).toBe('### foo');
  });

  it('emits level 1/2 as setext when headingStyle: "setext" is requested, and falls back to ATX beyond level 2', () => {
    expect(emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'foo' }], styleId: 'Heading1' }]), { headingStyle: 'setext' })).toBe('foo\n===');
    expect(emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'foo' }], styleId: 'Heading3' }]), { headingStyle: 'setext' })).toBe('### foo');
  });
});

describe('code blocks, thematic breaks, preformatted HTML', () => {
  it('emits a CodeBlock paragraph as a fenced code block using the configured fence character', () => {
    expect(emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'foo\nbar' }], styleId: 'CodeBlock' }]), { codeFenceChar: '~' })).toBe('~~~\nfoo\nbar\n~~~');
  });

  it('emits a HorizontalRule paragraph as a thematic break using the configured character', () => {
    expect(emitMarkdown(doc([{ kind: 'paragraph', runs: [], styleId: 'HorizontalRule' }]), { thematicBreakChar: '*' })).toBe('***');
  });

  it('emits an HTMLPreformatted paragraph\'s runs verbatim, with no escaping at all', () => {
    expect(emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: '<div>*not emphasis*</div>' }], styleId: 'HTMLPreformatted' }]))).toBe('<div>*not emphasis*</div>');
  });
});

describe('math (ExaDev/markdown-codec#53)', () => {
  it('emits a MathBlock paragraph as a $$ display math block', () => {
    expect(emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'x^2' }], styleId: 'MathBlock' }]))).toBe('$$\nx^2\n$$');
  });

  it('emits a Cambria-Math-marked run with \\( \\) delimiters, unescaped', () => {
    expect(emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'f(x) = x^2', fontFamily: 'Cambria Math' }] }]))).toBe('\\(f(x) = x^2\\)');
  });
});

describe('blockquotes', () => {
  it('prefixes "> " once per recovered nesting level, on every line of the body', () => {
    const fenced = emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'a\nb' }], styleId: 'CodeBlock', indentLeftPt: 72 }]));
    expect(fenced).toBe('> > ```\n> > a\n> > b\n> > ```');
  });

  it('keeps a Heading{N} styleId while quoted, applying indent on top', () => {
    expect(emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'foo' }], styleId: 'Heading2', indentLeftPt: 36 }]))).toBe('> ## foo');
  });
});

describe('lists', () => {
  it('renders a bullet, an ordered (custom start), and a task list from their own numId encodings', () => {
    const bullet = emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'a' }], list: { numId: 'md1:bullet', level: 0 } }]));
    expect(bullet).toBe('- a');

    const ordered = emitMarkdown(
      doc([
        { kind: 'paragraph', runs: [{ text: 'a' }], list: { numId: 'md2:ordered@3', level: 0 } },
        { kind: 'paragraph', runs: [{ text: 'b' }], list: { numId: 'md2:ordered@3', level: 0 } },
      ]),
    );
    expect(ordered).toBe('3. a\n4. b');

    const task = emitMarkdown(
      doc([
        { kind: 'paragraph', runs: [{ text: '☒ ' }, { text: 'done' }], list: { numId: 'md3:bullet+task', level: 0 } },
        { kind: 'paragraph', runs: [{ text: '☐ ' }, { text: 'todo' }], list: { numId: 'md3:bullet+task', level: 0 } },
      ]),
    );
    expect(task).toBe('- [x] done\n- [ ] todo');
  });

  it('renders a nested list indented under its own parent item', () => {
    const markdown = emitMarkdown(
      doc([
        { kind: 'paragraph', runs: [{ text: 'a' }], list: { numId: 'md1:bullet', level: 0 } },
        { kind: 'paragraph', runs: [{ text: 'b' }], list: { numId: 'md1:bullet', level: 1 } },
      ]),
    );
    expect(markdown).toBe('- a\n  - b');
  });

  it('separates loose-list siblings with a blank line and tight-list siblings with none', () => {
    const tight = emitMarkdown(doc([
      { kind: 'paragraph', runs: [{ text: 'a' }], list: { numId: 'md1:bullet', level: 0 } },
      { kind: 'paragraph', runs: [{ text: 'b' }], list: { numId: 'md1:bullet', level: 0 } },
    ]));
    expect(tight).toBe('- a\n- b');

    const loose = emitMarkdown(doc([
      { kind: 'paragraph', runs: [{ text: 'a' }], list: { numId: 'md1:bullet+loose', level: 0 } },
      { kind: 'paragraph', runs: [{ text: 'b' }], list: { numId: 'md1:bullet+loose', level: 0 } },
    ]));
    expect(loose).toBe('- a\n\n- b');
  });
});

describe('tables', () => {
  it('emits alignment markers read from the header row\'s own cell alignment', () => {
    const table: ContentTable = {
      kind: 'table',
      columnWidthsPt: [100, 100],
      rows: [
        { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'a' }], alignment: 'left' }] }, { blocks: [{ kind: 'paragraph', runs: [{ text: 'b' }], alignment: 'right' }] }] },
        { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: '1' }] }] }, { blocks: [{ kind: 'paragraph', runs: [{ text: '2' }] }] }] },
      ],
    };
    expect(emitMarkdown(doc([table]))).toBe('| a | b |\n| :--- | ---: |\n| 1 | 2 |');
  });
});

describe('images', () => {
  it('embeds the image bytes as a data: URI by default, and omits them when images: false', () => {
    const image: ContentImageBlock = { kind: 'image', format: 'png', base64: 'AA==', widthPt: 1, heightPt: 1, altText: 'alt' };
    expect(emitMarkdown(doc([image]))).toBe('![alt](data:image/png;base64,AA==)');
    expect(emitMarkdown(doc([image]), { images: false })).toBe('![alt]()');
  });
});

describe('round trip through src/lower', () => {
  it('renders a code span run back as backticks and a plain autolink run back as <dest>', () => {
    const source = '`code` and <http://example.com>';
    const lowered = lowerMarkdown(source);
    expect(emitMarkdown(lowered)).toBe('`code` and <http://example.com>');
  });

  it('preserves inline raw HTML as literal HTML, not escaped text, across a full lower -> emit -> lower round trip', () => {
    const source = 'before <em>raw</em> after';
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    expect(markdown).toBe(source);
    const second = lowerMarkdown(markdown);
    expect(second).toEqual(first);
  });

  it('preserves inline math (\\( \\)), delimiters included, across a full lower -> emit -> lower round trip (ExaDev/markdown-codec#53)', () => {
    const source = 'before \\(E = mc^2\\) after';
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    expect(markdown).toBe(source);
    const second = lowerMarkdown(markdown);
    expect(second).toEqual(first);
  });

  it('preserves a $$ display math block across a full lower -> emit -> lower round trip', () => {
    const source = '$$\nx^2\n$$';
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    expect(markdown).toBe(source);
    const second = lowerMarkdown(markdown);
    expect(second).toEqual(first);
  });

  it('does not let ordinary parenthetical text collide with preserved math on a write-then-reread round trip', () => {
    const source = 'a link (not a link) trailing';
    const first = lowerMarkdown(source);
    const markdown = emitMarkdown(first);
    const second = lowerMarkdown(markdown);
    expect(second).toEqual(first);
    expect(markdown).not.toContain('\\(');
  });
});

describe('gaps (MarkdownDiagnosticCodes)', () => {
  it('HEADING_LEVEL_CLAMPED fires when a styleId exceeds Heading6', () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'x' }], styleId: 'Heading9' }]), { sink: collector.sink });
    expect(markdown).toBe('###### x');
    expect(collector.has(MarkdownDiagnosticCodes.HEADING_LEVEL_CLAMPED)).toBe(true);
  });

  it('ADJACENT_LINKS_MERGED fires when two consecutive runs share a hyperlink', () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(
      doc([{ kind: 'paragraph', runs: [{ text: 'a', hyperlink: 'http://x' }, { text: 'b', hyperlink: 'http://x' }] }]),
      { sink: collector.sink },
    );
    expect(markdown).toBe('[ab](http://x)');
    expect(collector.has(MarkdownDiagnosticCodes.ADJACENT_LINKS_MERGED)).toBe(true);
  });

  it('CODE_SPAN_AS_MONOSPACE_RUN fires for a Courier New run', () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'x', fontFamily: 'Courier New' }] }]), { sink: collector.sink });
    expect(markdown).toBe('`x`');
    expect(collector.has(MarkdownDiagnosticCodes.CODE_SPAN_AS_MONOSPACE_RUN)).toBe(true);
  });

  it('PARAGRAPH_INDENT_DROPPED fires for indentLeftPt with no quotable styleId, and the indent is dropped', () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'x' }], indentLeftPt: 20 }]), { sink: collector.sink });
    expect(markdown).toBe('x');
    expect(collector.has(MarkdownDiagnosticCodes.PARAGRAPH_INDENT_DROPPED)).toBe(true);
  });

  it('LIST_NUMID_FALLBACK fires for a numId this package never minted, falling back to a plain bullet', () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(doc([{ kind: 'paragraph', runs: [{ text: 'x' }], list: { numId: 'list1', level: 0 } }]), { sink: collector.sink });
    expect(markdown).toBe('- x');
    expect(collector.has(MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK)).toBe(true);
  });

  it('LIST_NUMID_FALLBACK fires once for depth-only memberships with no numId, falling back to one tight plain-bullet list', () => {
    const collector = createDiagnosticCollector();
    const markdown = emitMarkdown(doc([
      { kind: 'paragraph', runs: [{ text: 'x' }], list: { level: 0 } },
      { kind: 'paragraph', runs: [{ text: 'y' }], list: { level: 1 } },
    ]), { sink: collector.sink });
    expect(markdown).toBe('- x\n  - y');
    expect(collector.diagnostics.filter((diagnostic) => diagnostic.code === MarkdownDiagnosticCodes.LIST_NUMID_FALLBACK)).toHaveLength(1);
  });

  it('TABLE_CELL_FORMATTING_DROPPED fires for colSpan/rowSpan/background and for a non-paragraph cell block', () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: 'table',
      columnWidthsPt: [100],
      rows: [
        { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'h' }] }] }] },
        { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'x' }] }, { kind: 'pageBreak' }], colSpan: 2 }] },
      ],
    };
    emitMarkdown(doc([table]), { sink: collector.sink });
    expect(collector.codes().filter((code) => code === MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED).length).toBeGreaterThanOrEqual(2);
  });

  it('TABLE_CELL_MULTI_PARAGRAPH_JOINED fires for a cell with more than one paragraph, and the text space-joins', () => {
    const collector = createDiagnosticCollector();
    const table: ContentTable = {
      kind: 'table',
      columnWidthsPt: [100],
      rows: [
        { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'h' }] }] }] },
        { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'one' }] }, { kind: 'paragraph', runs: [{ text: 'two' }] }] }] },
      ],
    };
    const markdown = emitMarkdown(doc([table]), { sink: collector.sink });
    expect(markdown).toContain('one two');
    expect(collector.has(MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED)).toBe(true);
  });
});
