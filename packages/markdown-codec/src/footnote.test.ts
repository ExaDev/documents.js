// GitHub footnotes end to end (ExaDev/markdown-codec#66): the block/inline phases that recognise `[^label]` and `[^label]: body`, the lowering that turns a definition into an `anchor` construct's boundary-marker pair (document-schema.js 4.2.0) and a reference into a marked run, and the writer that renders both back. Deliberately one file across all four stages rather than four scattered additions: the whole point of the feature is that the two halves of a footnote are carried by two DIFFERENT mechanisms and still have to reproduce each other, which no single-stage test can show.
//
// The round-trip assertion below is "read -> write -> read -> write reproduces the same text", not "write reproduces the source byte for byte". That is not a weaker bar chosen for convenience: this package normalises freely on the way out (it escapes ASCII punctuation, regenerates code fences, and picks its own bullet glyph), so byte equality with arbitrary source text is not a property `writeMarkdown` has for ANY construct. What must hold, and what is asserted, is that nothing about a footnote is lost on the way through -- the second pass produces the identical document and the identical text.

import type { ContentBlock, ContentDocument } from 'document-schema.js';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './block/block';
import { MarkdownDiagnosticCodes, MarkdownUnbalancedConstructMarkersError } from './diagnostics/diagnostics';
import { emitMarkdown } from './emit/emit';
import { readMarkdown } from './read';
import { FOOTNOTE_REFERENCE_FONT_MARKER } from './shared/style-constants';
import { createDiagnosticCollector } from './test-support/diagnostics';
import { writeMarkdown } from './write';

function blocksOf(document: ContentDocument): ContentBlock[] {
  if (document.kind !== 'wordprocessing') {
    throw new Error(`expected a wordprocessing document, got '${document.kind}'`);
  }
  return document.sections.flatMap((section) => section.blocks);
}

function lowered(source: string): ContentBlock[] {
  return blocksOf(readMarkdown(source).document);
}

function minimalDocument(blocks: readonly ContentBlock[]): ContentDocument {
  return { kind: 'wordprocessing', metadata: {}, sections: [{ pageSize: PAGE_SIZE_A4, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks: [...blocks] }] };
}

// One full pass through the public surface and back, twice -- see this file's own top-of-file note on why the fixed point, rather than the source text, is what a round trip is measured against here.
function roundTrip(source: string): { readonly written: string; readonly rewritten: string; readonly document: ContentDocument; readonly reread: ContentDocument } {
  const document = readMarkdown(source).document;
  const written = writeMarkdown(document);
  const reread = readMarkdown(written).document;
  return { written, rewritten: writeMarkdown(reread), document, reread };
}

describe('reading footnote definitions', () => {
  it('parses a definition as its own block node carrying its label and its body', () => {
    expect(parseMarkdown('[^1]: The note.').document.children).toEqual([
      { type: 'footnoteDefinition', label: '1', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'The note.' }] }] },
    ]);
  });

  it('collects every definition label into the document-global set, before any inline is parsed', () => {
    expect([...parseMarkdown('[^a]: one\n\n[^b]: two').footnotes]).toEqual(['a', 'b']);
  });

  it('continues a definition body across further indented blocks', () => {
    const [definition] = parseMarkdown('[^1]: First.\n\n    Second.\n\n    - item').document.children;
    expect(definition).toEqual({
      type: 'footnoteDefinition',
      label: '1',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'First.' }] },
        { type: 'paragraph', children: [{ type: 'text', value: 'Second.' }] },
        { type: 'list', markerType: 'bullet', bulletMarker: '-', tight: true, children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'item' }] }] }] },
      ],
    });
  });

  it('ends a definition at a blank line followed by unindented content', () => {
    expect(parseMarkdown('[^1]: note\n\nafter').document.children).toEqual([
      { type: 'footnoteDefinition', label: '1', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'note' }] }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'after' }] },
    ]);
  });

  it('continues a definition\'s own paragraph lazily, exactly as a list item does', () => {
    expect(parseMarkdown('[^1]: note\nsame paragraph').document.children).toEqual([
      {
        type: 'footnoteDefinition',
        label: '1',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'note' }, { type: 'softBreak' }, { type: 'text', value: 'same paragraph' }] }],
      },
    ]);
  });

  it('accepts a definition with no body at all', () => {
    expect(parseMarkdown('[^1]:').document.children).toEqual([{ type: 'footnoteDefinition', label: '1', children: [] }]);
  });

  it('does not let a definition interrupt a paragraph', () => {
    expect(parseMarkdown('prose\n[^1]: not a definition').document.children).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'prose' }, { type: 'softBreak' }, { type: 'text', value: '[^1]: not a definition' }] },
    ]);
  });

  it('does not recognise a definition inside a block quote or a list item', () => {
    // Both would put the construct pair's own extent inside a scope the enclosing container opened -- see src/block/block.ts's tryFootnoteDefinitionStart for why that is the one thing the marker contract forbids a producer from emitting. The text stays an ordinary paragraph there, exactly as it did before footnotes were recognised anywhere.
    expect(parseMarkdown('> [^1]: quoted note text').document.children).toEqual([
      { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: '[^1]: quoted note text' }] }] },
    ]);
    expect(parseMarkdown('- [^1]: listed note text').document.children).toEqual([
      { type: 'list', markerType: 'bullet', bulletMarker: '-', tight: true, children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '[^1]: listed note text' }] }] }] },
    ]);
  });

  it('reports a duplicate label and keeps both definitions as written', () => {
    const collector = createDiagnosticCollector();
    const parsed = parseMarkdown('[^1]: first\n\n[^1]: second', { sink: collector.sink });
    expect(collector.has(MarkdownDiagnosticCodes.DUPLICATE_FOOTNOTE_DEFINITION)).toBe(true);
    expect(parsed.document.children).toHaveLength(2);
  });

  it('leaves both spellings as ordinary text when footnotes are switched off', () => {
    // A multi-word body deliberately, so the line cannot be read as a LINK reference definition either (`[^1]: note` alone is `[^1]` -> `note`, which is what this package did with the whole shape before footnotes existed).
    expect(parseMarkdown('a[^1]\n\n[^1]: note text', { footnotes: false }).document.children).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'a[^1]' }] },
      { type: 'paragraph', children: [{ type: 'text', value: '[^1]: note text' }] },
    ]);
  });
});

describe('reading footnote references', () => {
  it('parses a reference whose label has a definition somewhere in the document', () => {
    const [paragraph] = parseMarkdown('see[^1] here\n\n[^1]: note').document.children;
    expect(paragraph).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', value: 'see' }, { type: 'footnoteReference', label: '1' }, { type: 'text', value: ' here' }],
    });
  });

  it('resolves a reference against a definition that appears later in the document', () => {
    const [paragraph] = parseMarkdown('forward[^late]\n\n[^late]: defined afterwards').document.children;
    expect(paragraph).toEqual({ type: 'paragraph', children: [{ type: 'text', value: 'forward' }, { type: 'footnoteReference', label: 'late' }] });
  });

  it('leaves a label with no definition as ordinary text', () => {
    expect(parseMarkdown('see[^missing] here').document.children).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'see[^missing] here' }] }]);
  });

  it('matches labels exactly, without case folding', () => {
    const [paragraph] = parseMarkdown('a[^Note] b[^note]\n\n[^note]: only the lower-case one is defined').document.children;
    expect(paragraph).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', value: 'a[^Note] b' }, { type: 'footnoteReference', label: 'note' }],
    });
  });

  it('reads `![^1]` as an exclamation mark followed by a reference, never an image', () => {
    const [paragraph] = parseMarkdown('![^1]\n\n[^1]: note').document.children;
    expect(paragraph).toEqual({ type: 'paragraph', children: [{ type: 'text', value: '!' }, { type: 'footnoteReference', label: '1' }] });
  });
});

describe('lowering a footnote onto the schema', () => {
  it('lowers a definition to an anchor construct bracketing its own body blocks', () => {
    expect(lowered('[^1]: The note.')).toEqual([
      { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'footnote', name: '1' } },
      { kind: 'paragraph', runs: [{ text: 'The note.' }] },
      { kind: 'constructEnd' },
    ]);
  });

  it('carries a multi-block body inside the construct extent', () => {
    expect(lowered('[^1]: One.\n\n    Two.')).toEqual([
      { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'footnote', name: '1' } },
      { kind: 'paragraph', runs: [{ text: 'One.' }] },
      { kind: 'paragraph', runs: [{ text: 'Two.' }] },
      { kind: 'constructEnd' },
    ]);
  });

  it('lowers a bodyless definition to a point anchor -- a pair with nothing between it', () => {
    expect(lowered('[^1]:')).toEqual([
      { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'footnote', name: '1' } },
      { kind: 'constructEnd' },
    ]);
  });

  it('lowers a reference to a marked run keeping its own source spelling', () => {
    const collector = createDiagnosticCollector();
    const document = readMarkdown('see[^1]\n\n[^1]: note', { sink: collector.sink }).document;
    expect(blocksOf(document)[0]).toEqual({
      kind: 'paragraph',
      runs: [{ text: 'see' }, { text: '[^1]', fontFamily: FOOTNOTE_REFERENCE_FONT_MARKER }],
    });
    expect(collector.has(MarkdownDiagnosticCodes.FOOTNOTE_REFERENCE_PRESERVED_AS_TEXT)).toBe(true);
  });

  it('carries a reference inside a link as one run of that link', () => {
    expect(blocksOf(readMarkdown('[text[^1]](/u)\n\n[^1]: note').document)[0]).toEqual({
      kind: 'paragraph',
      runs: [{ text: 'text', hyperlink: '/u' }, { text: '[^1]', hyperlink: '/u', fontFamily: FOOTNOTE_REFERENCE_FONT_MARKER }],
    });
  });

  it('flattens a heading inside a definition body to literal ATX text, and says so', () => {
    const collector = createDiagnosticCollector();
    const document = readMarkdown('[^1]: intro\n\n    ## inner', { sink: collector.sink }).document;
    expect(blocksOf(document)).toEqual([
      { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'footnote', name: '1' } },
      { kind: 'paragraph', runs: [{ text: 'intro' }] },
      { kind: 'paragraph', runs: [{ text: '## ' }, { text: 'inner' }] },
      { kind: 'constructEnd' },
    ]);
    expect(collector.has(MarkdownDiagnosticCodes.FOOTNOTE_BODY_HEADING_FLATTENED)).toBe(true);
  });

  it('leaves every construct marker pair balanced, which is what the schema requires of a producer', () => {
    const blocks = lowered('a[^x]\n\n[^x]: one\n\n    two\n\n[^y]: another');
    const opens = blocks.filter((block) => block.kind === 'constructStart').length;
    const closes = blocks.filter((block) => block.kind === 'constructEnd').length;
    expect(opens).toBe(closes);
  });
});

describe('writing footnotes back out', () => {
  it('renders an anchor construct as a definition, and its marked run as a reference', () => {
    expect(emitMarkdown(minimalDocument([
      { kind: 'paragraph', runs: [{ text: 'see' }, { text: '[^1]', fontFamily: FOOTNOTE_REFERENCE_FONT_MARKER }] },
      { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'footnote', name: '1' } },
      { kind: 'paragraph', runs: [{ text: 'note' }] },
      { kind: 'constructEnd' },
    ]))).toBe('see[^1]\n\n[^1]: note');
  });

  it('indents a multi-block body to the continuation column a reader measures against', () => {
    expect(emitMarkdown(minimalDocument([
      { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'footnote', name: 'long' } },
      { kind: 'paragraph', runs: [{ text: 'one' }] },
      { kind: 'paragraph', runs: [{ text: 'two' }] },
      { kind: 'constructEnd' },
    ]))).toBe('[^long]: one\n\n    two');
  });

  it('renders an empty extent as the bare marker, with no trailing space', () => {
    expect(emitMarkdown(minimalDocument([
      { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'footnote', name: '1' } },
      { kind: 'constructEnd' },
    ]))).toBe('[^1]:');
  });

  it('escapes an ordinary run that merely looks like a reference, so it reparses as text', () => {
    const written = emitMarkdown(minimalDocument([{ kind: 'paragraph', runs: [{ text: 'literal [^1] here' }] }]));
    expect(written).toBe('literal \\[\\^1\\] here');
    expect(parseMarkdown(`${written}\n\n[^1]: real`).document.children[0]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: 'literal [^1] here' }] });
  });

  it('renders a construct markdown has no syntax for transparently, keeping its extent', () => {
    const collector = createDiagnosticCollector();
    const written = emitMarkdown(minimalDocument([
      { kind: 'constructStart', descriptor: { kind: 'division', name: 'chapter-one' } },
      { kind: 'paragraph', runs: [{ text: 'content inside a division' }] },
      { kind: 'constructEnd' },
    ]), { sink: collector.sink });
    expect(written).toBe('content inside a division');
    expect(collector.has(MarkdownDiagnosticCodes.CONSTRUCT_UNREPRESENTED)).toBe(true);
  });

  it('renders a nested construct inside a footnote body', () => {
    expect(emitMarkdown(minimalDocument([
      { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'footnote', name: '1' } },
      { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'mark' } },
      { kind: 'paragraph', runs: [{ text: 'bookmarked note' }] },
      { kind: 'constructEnd' },
      { kind: 'constructEnd' },
    ]))).toBe('[^1]: bookmarked note');
  });

  it('throws rather than guessing when the markers do not pair up', () => {
    expect(() => emitMarkdown(minimalDocument([{ kind: 'constructEnd' }]))).toThrow(MarkdownUnbalancedConstructMarkersError);
    expect(() => emitMarkdown(minimalDocument([{ kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'footnote', name: '1' } }]))).toThrow(MarkdownUnbalancedConstructMarkersError);
  });
});

describe('round trip', () => {
  const sources = [
    'Text with a note[^1] here.\n\n[^1]: The note body.',
    'A[^a] and B[^b].\n\n[^a]: First.\n\n[^b]: Second.',
    'See[^long].\n\n[^long]: First paragraph.\n\n    Second paragraph.\n\n    ```\n    code\n    ```',
    '[^1]:',
    '# Heading\n\nBody[^n].\n\n[^n]: note with *emphasis*, `code`, and a [link](/u).',
    '[^1]: body\n\n    - a\n    - b',
    'Escaped \\[^1\\] stays literal.\n\n[^1]: while this one is real.',
    'Unmatched [^nope] stays literal text.',
  ];

  it.each(sources)('reaches a fixed point for %j', (source) => {
    const { written, rewritten, document, reread } = roundTrip(source);
    expect(rewritten).toBe(written);
    expect(reread).toEqual(document);
  });

  it('keeps a definition body that a plain reparse would otherwise flatten into the surrounding flow', () => {
    const { written } = roundTrip('intro[^1]\n\n[^1]: first\n\n    second\n\nafter the note');
    expect(written).toBe('intro[^1]\n\n[^1]: first\n\n    second\n\nafter the note');
    expect(blocksOf(readMarkdown(written).document).map((block) => block.kind)).toEqual(['paragraph', 'constructStart', 'paragraph', 'paragraph', 'constructEnd', 'paragraph']);
  });
});
