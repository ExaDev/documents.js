// The tree-form half of the public surface: readMarkdown/writeMarkdown/markdownCodec over document-schema.js's DocumentTree, and the three properties that make them trustworthy as the primary entry points.
//
// (i) They are exactly assembleTree/flattenTree composed onto the flat pair -- pinned by constructing the same value both ways, so a future edit that swapped assembleTree for bare decompose (dropping the styles-minting pass) or forgot to flatten before emitting would fail here rather than silently changing what callers get. (ii) The transform is transparent to the markdown itself: the tree pair renders byte-identical text to the flat pair over real multi-construct content, which is what lets src/conformance.test.ts keep measuring the flat pair alone and still speak for both. (iii) Bytes survive a full round trip through the tree: decode -> encode -> decode reproduces the identical package, and the re-encoded bytes still carry the document's real content rather than an empty-but-valid shell.
//
// The blockquote fixture below is not decorative: two blockquote paragraphs share an indentLeftPt tuple, which is the one construct this package's lowering produces that assembleTree's minting actually hoists onto a styles-table entry. It is the case where "assembleTree" and "decompose plus an envelope" produce genuinely different values, so it is the case that proves which one readMarkdown calls.

import { assembleTree, DocumentTreeSchema, flattenTree, isTreeGroup, isSectionConstructGroupNode, type DocumentTree, type SectionConstructGroupNode } from 'document-schema.js';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { markdownCodec, markdownContentCodec } from './codec';
import { createDiagnosticCollector } from './test-support/diagnostics';
import { MarkdownDiagnosticCodes, MarkdownPackageFlattenError, MarkdownUnsupportedDocumentKindError } from './diagnostics/diagnostics';
import { readMarkdown, readMarkdownContent } from './read';
import { writeMarkdown, writeMarkdownContent } from './write';

// Every construct the lower/emit pair maps differently -- headings, a nested-paragraph blockquote, both list kinds, a GFM table, inline emphasis and a link, and a footnote whose definition rides a constructStart/constructEnd pair (the one block shape decompose promotes to a group of its own).
const SAMPLE = [
  '# Title',
  '',
  'Some **bold** and *italic* text with [a link](https://example.com) and `code`.',
  '',
  '## Section two',
  '',
  '- alpha',
  '- beta',
  '',
  '1. one',
  '2. two',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  'Body with a footnote[^1].',
  '',
  '[^1]: The note body.',
  '',
].join('\n');

// Two blockquote paragraphs sharing one indentLeftPt tuple -- the minting case, see this file's own top-of-file note.
const BLOCKQUOTED = '> Quoted one.\n>\n> Quoted two.\n\n> Quoted three.\n>\n> Quoted four.\n';

const SAMPLE_BYTES = new TextEncoder().encode(SAMPLE);

// SAMPLE above carries exactly one footnote, in the simplest possible shape (a single-paragraph body straight after the reference). The construct-group path is the one genuinely new structural shape decompose promotes over a bare {metadata, sections} envelope, so it gets its own fixture set here, one shape per case that the parser and lowerer treat differently (src/footnote.test.ts pins each at the flat ContentDocument level; these same shapes are exercised here at the tree level instead).
const FOOTNOTE_SHAPES = {
  bodyless: 'Body[^1].\n\n[^1]:\n',
  duplicateLabel: 'Body[^1] and[^1] again.\n\n[^1]: first\n\n[^1]: second\n',
  multiParagraphBody: 'Body[^1].\n\n[^1]: One.\n\n    Two.\n\n    Three.\n',
  afterList: 'Body[^1].\n\n- a\n- b\n\n[^1]: note\n',
  afterBlockquote: 'Body[^1].\n\n> quoted\n\n[^1]: note\n',
  afterHeading: '# Heading\n\nBody[^1].\n\n[^1]: note\n',
} as const;

// Construct groups sit wherever their marker pair sat in the block flow, which for a footnote definition following a heading is inside that heading's own group rather than at the section's top level -- so this walks the whole subtree rather than filtering one children array. Filtered to ANCHOR groups where the tests count footnote definitions specifically: since blockquotes became divisions, a fixture's quotes promote construct groups of their own beside the anchors.
function collectConstructGroups(node: unknown): SectionConstructGroupNode[] {
  if (!isTreeGroup(node)) return [];
  const here = isSectionConstructGroupNode(node) ? [node] : [];
  return [...here, ...node.children.flatMap(collectConstructGroups)];
}

function collectFootnoteGroups(node: unknown): SectionConstructGroupNode[] {
  return collectConstructGroups(node).filter((group) => group.node.kind === 'anchor' && group.node.anchorType === 'footnote');
}

describe('readMarkdown: markdown text -> DocumentTree', () => {
  it('produces a schema-valid wordprocessing package with one section group per lowered section', () => {
    const { documentPackage } = readMarkdown(SAMPLE);
    const { document } = readMarkdownContent(SAMPLE);
    if (document.kind !== 'wordprocessing') throw new Error('markdown lowers to wordprocessing content');

    expect(DocumentTreeSchema.safeParse(documentPackage).success).toBe(true);
    expect(documentPackage.kind).toBe('wordprocessing');
    expect(documentPackage.children).toHaveLength(document.sections.length);
  });

  it('promotes the footnote definition to a construct group carrying its own anchor descriptor', () => {
    const { documentPackage } = readMarkdown(SAMPLE);
    const constructGroups = documentPackage.children.flatMap(collectFootnoteGroups);

    expect(constructGroups).toHaveLength(1);
    expect(constructGroups[0]?.node).toMatchObject({ kind: 'anchor', anchorType: 'footnote', name: '1' });
  });

  it('is assembleTree composed onto readMarkdownContent, minting included', () => {
    for (const source of [SAMPLE, BLOCKQUOTED]) {
      expect(readMarkdown(source).documentPackage).toEqual(assembleTree(readMarkdownContent(source).document));
    }
  });

  it('mints a styles table for repeated paragraph properties rather than leaving the tree unfactored', () => {
    const { documentPackage } = readMarkdown(BLOCKQUOTED);

    expect(documentPackage.styles).toBeDefined();
    expect(Object.values(documentPackage.styles ?? {})).toContainEqual({ paragraph: { indentLeftPt: 36 } });
  });

  it('flattens back to exactly the document readMarkdownContent produces', () => {
    for (const source of [SAMPLE, BLOCKQUOTED]) {
      expect(flattenTree(readMarkdown(source).documentPackage)).toEqual(readMarkdownContent(source).document);
    }
  });

  it('reports the same diagnostics as readMarkdownContent, through the return value and the caller sink alike', () => {
    const seen: string[] = [];
    const { diagnostics } = readMarkdown(SAMPLE, { sink: (diagnostic) => seen.push(diagnostic.code) });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(readMarkdownContent(SAMPLE).diagnostics.map((diagnostic) => diagnostic.code));
    expect(seen).toEqual(diagnostics.map((diagnostic) => diagnostic.code));
    expect(seen).toContain(MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY);
  });

  it('throws an already-aborted signal before parsing', () => {
    expect(() => readMarkdown(SAMPLE, { signal: AbortSignal.abort() })).toThrow();
  });

  it('flattens back to exactly the flat document over every construct spelling this package now mints -- run-level title extents, the division pair, the embedded formula, codeLanguage, task and item-identity memberships, and HTML residue', () => {
    const source = [
      '# Heading with [a titled link](/u "the title")',
      '',
      '> quoted one',
      '>',
      '> quoted two with [another](/2 "t")',
      '',
      '- [x] done task',
      '- a multi-block item',
      '',
      '  whose second paragraph survives',
      '',
      '``` js {.numberLines}',
      'console.log(1);',
      '```',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      '<div>block html</div>',
      '',
      'inline <em>html</em> text',
      '',
    ].join('\n');
    const { documentPackage } = readMarkdown(source);
    const { document } = readMarkdownContent(source);
    expect(DocumentTreeSchema.safeParse(documentPackage).success).toBe(true);
    expect(flattenTree(documentPackage)).toEqual(document);
  });
});

describe('writeMarkdown: DocumentTree -> markdown text', () => {
  it('renders byte-identical text to writeMarkdownContent over the flat document', () => {
    for (const source of [SAMPLE, BLOCKQUOTED]) {
      expect(writeMarkdown(readMarkdown(source).documentPackage)).toBe(writeMarkdownContent(readMarkdownContent(source).document));
    }
  });

  it('round-trips text -> package -> text -> package to the identical package and text', () => {
    const first = readMarkdown(SAMPLE).documentPackage;
    const written = writeMarkdown(first);
    const second = readMarkdown(written).documentPackage;

    expect(second).toEqual(first);
    expect(writeMarkdown(second)).toBe(written);
  });

  it('carries every source construct through the round trip rather than emitting a valid-but-empty document', () => {
    const written = writeMarkdown(readMarkdown(SAMPLE).documentPackage);

    expect(written).toContain('# Title');
    expect(written).toContain('## Section two');
    expect(written).toContain('[a link](https://example.com)');
    expect(written).toContain('| a | b |');
    // The trailing full stop comes back escaped (`body\.`) -- this package escapes ASCII punctuation on emit -- so the assertion stops at the last unescaped character rather than pinning an escape this test has no opinion about.
    expect(written).toContain('[^1]: The note body');
  });

  it('honours the same write-side style options the flat writer takes', () => {
    const written = writeMarkdown(readMarkdown('- alpha\n- beta\n').documentPackage, { bulletListMarker: '*' });

    expect(written).toContain('* alpha');
  });

  it('throws MarkdownUnsupportedDocumentKindError for a package whose kind markdown cannot represent', () => {
    const spreadsheet = assembleTree({ kind: 'spreadsheet', metadata: {}, sheets: [] });

    expect(() => writeMarkdown(spreadsheet)).toThrow(MarkdownUnsupportedDocumentKindError);
  });

  it('throws MarkdownUnsupportedDocumentKindError, not a bare Error, for a formula package with no formula node -- flattenTree has its own single-ContentFormula-node constraint for this kind that this check pre-empts entirely', () => {
    // Hand-built rather than routed through assembleTree: assembleTree(ContentDocument) always produces exactly one formula node for a 'formula' document, so this empty-children shape (the one flattenTree itself rejects) can only arise from a caller constructing a DocumentTree directly.
    const formula: DocumentTree = { kind: 'formula', metadata: {}, children: [] };

    expect(() => writeMarkdown(formula)).toThrow(MarkdownUnsupportedDocumentKindError);
  });

  it('throws an already-aborted signal before flattening', () => {
    const documentPackage = readMarkdown(SAMPLE).documentPackage;

    expect(() => writeMarkdown(documentPackage, { signal: AbortSignal.abort() })).toThrow();
  });

  it('wraps flattenTree\'s own bare Error as MarkdownPackageFlattenError when a group carries a style ref the package has no styles table to resolve', () => {
    // A minimal, hand-built reproduction of the one flattenTree failure reachable for a 'wordprocessing' package: the section group below still references its minted style, but the package's own top-level styles table has been stripped out from under it.
    const { styles, ...packageWithoutStyles } = readMarkdown(BLOCKQUOTED).documentPackage;
    expect(styles).toBeDefined();

    expect(() => writeMarkdown(packageWithoutStyles)).toThrow(MarkdownPackageFlattenError);
    expect(() => writeMarkdown(packageWithoutStyles)).toThrow(/style ref/);
  });

  it('reports a PACKAGE_TABLE_DROPPED diagnostic per non-empty package-level table flattenTree cannot carry into markdown', () => {
    const base = readMarkdown(SAMPLE).documentPackage;
    const withExtraTables = {
      ...base,
      definitions: { d1: { kind: 'bookmark' } },
      layers: { l1: { kind: 'layer' } },
      attachments: { a1: { kind: 'file' } },
      destinations: { dest1: { kind: 'anchor' } },
      pages: [{ widthPt: 100, heightPt: 100 }],
    };

    const seen: string[] = [];
    writeMarkdown(withExtraTables, { sink: (diagnostic) => seen.push(diagnostic.code) });

    expect(seen.filter((code) => code === MarkdownDiagnosticCodes.PACKAGE_TABLE_DROPPED)).toHaveLength(5);
  });

  it('reports nothing extra, and renders identically, for a package that carries none of those tables', () => {
    const base = readMarkdown(SAMPLE).documentPackage;
    const seen: string[] = [];

    const written = writeMarkdown(base, { sink: (diagnostic) => seen.push(diagnostic.code) });

    expect(seen.filter((code) => code === MarkdownDiagnosticCodes.PACKAGE_TABLE_DROPPED)).toHaveLength(0);
    expect(written).toBe(writeMarkdown(base));
  });
});

describe('the construct-group path over footnote shapes beyond SAMPLE\'s single case', () => {
  for (const [name, source] of Object.entries(FOOTNOTE_SHAPES)) {
    it(`${name}: readMarkdown is assembleTree(readMarkdownContent(...).document), and flattens back to it exactly`, () => {
      const { documentPackage } = readMarkdown(source);
      const { document } = readMarkdownContent(source);

      expect(documentPackage).toEqual(assembleTree(document));
      expect(flattenTree(documentPackage)).toEqual(document);
    });

    it(`${name}: writeMarkdown renders byte-identical text to writeMarkdownContent`, () => {
      const { documentPackage } = readMarkdown(source);
      const { document } = readMarkdownContent(source);

      expect(writeMarkdown(documentPackage)).toBe(writeMarkdownContent(document));
    });
  }

  it('promotes exactly one construct group per definition, including both definitions sharing a duplicated label', () => {
    expect(readMarkdown(FOOTNOTE_SHAPES.bodyless).documentPackage.children.flatMap(collectFootnoteGroups)).toHaveLength(1);
    expect(readMarkdown(FOOTNOTE_SHAPES.multiParagraphBody).documentPackage.children.flatMap(collectFootnoteGroups)).toHaveLength(1);
    expect(readMarkdown(FOOTNOTE_SHAPES.afterList).documentPackage.children.flatMap(collectFootnoteGroups)).toHaveLength(1);
    expect(readMarkdown(FOOTNOTE_SHAPES.afterBlockquote).documentPackage.children.flatMap(collectFootnoteGroups)).toHaveLength(1);
    expect(readMarkdown(FOOTNOTE_SHAPES.afterHeading).documentPackage.children.flatMap(collectFootnoteGroups)).toHaveLength(1);
    expect(readMarkdown(FOOTNOTE_SHAPES.duplicateLabel).documentPackage.children.flatMap(collectFootnoteGroups)).toHaveLength(2);
  });

  it('lowers a bodyless definition to a construct group with no body blocks between its start and end', () => {
    const [group] = readMarkdown(FOOTNOTE_SHAPES.bodyless).documentPackage.children.flatMap(collectFootnoteGroups);

    expect(group?.children).toEqual([]);
  });
});

describe('tree-only carries: reference definitions and front-matter residue', () => {
  it('splices the reference definition table into the package\'s definitions root, keyed by the definition\'s own normalised label (this parser folds to upper case), link tenant', () => {
    const { documentPackage } = readMarkdown('[foo]: /url "the title"\n\n[foo]');
    expect(documentPackage.definitions).toEqual({ FOO: { kind: 'link', destination: '/url', title: 'the title' } });
  });

  it('leaves definitions and the package source table absent for a document with neither, so the package is exactly assembleTree of the flat document', () => {
    const { documentPackage } = readMarkdown('plain body');
    expect(documentPackage.definitions).toBeUndefined();
    expect(documentPackage.source).toBeUndefined();
    expect(documentPackage).toEqual(assembleTree(readMarkdownContent('plain body').document));
  });

  it('renders this package\'s own link definitions back out after the body, and reports no PACKAGE_TABLE_DROPPED for them', () => {
    const collector = createDiagnosticCollector();
    const written = writeMarkdown(readMarkdown('[foo]: /url "the title"\n\n[foo]').documentPackage, { sink: collector.sink });
    expect(written).toBe('[foo](/url "the title")\n\n[FOO]: /url "the title"');
    expect(collector.codes()).not.toContain(MarkdownDiagnosticCodes.PACKAGE_TABLE_DROPPED);
  });

  it('round-trips text -> package -> text -> package to the identical package and text, definitions included', () => {
    const source = '[foo]: /url "the title"\n\nuse [foo] here.';
    const first = readMarkdown(source).documentPackage;
    const written = writeMarkdown(first);
    expect(readMarkdown(written).documentPackage).toEqual(first);
    expect(writeMarkdown(readMarkdown(written).documentPackage)).toBe(written);
  });

  it('still reports PACKAGE_TABLE_DROPPED for a definitions table holding only foreign-tenant entries, and renders nothing for them', () => {
    const collector = createDiagnosticCollector();
    const base = readMarkdown('body').documentPackage;
    const written = writeMarkdown({ ...base, definitions: { n1: { kind: 'bookmark' } } }, { sink: collector.sink });
    expect(written).toBe('body');
    expect(collector.codes()).toContain(MarkdownDiagnosticCodes.PACKAGE_TABLE_DROPPED);
  });

  it('splices the verbatim front-matter block into the package-level source residue table under the frontmatter key', () => {
    const { documentPackage } = readMarkdown('---\ntitle: Hello\nunknown: value\n---\n\nbody', { frontMatter: true });
    expect(documentPackage.source).toEqual({ frontmatter: { format: 'markdown', xml: '---\ntitle: Hello\nunknown: value\n---' } });
    expect(documentPackage.metadata.title).toBe('Hello');
  });

  it('re-emits the front-matter residue verbatim in place of the regenerated block when frontMatter: true, so unmapped keys and original spellings survive', () => {
    const source = '---\ntitle: "Quoted Spelling"\nrating: 5\n---\n\nbody';
    const { documentPackage } = readMarkdown(source, { frontMatter: true });
    expect(writeMarkdown(documentPackage, { frontMatter: true })).toBe(source);
  });

  it('regenerates front matter from metadata for a package carrying no residue, exactly as before', () => {
    const base = readMarkdown('body').documentPackage;
    expect(writeMarkdown({ ...base, metadata: { ...base.metadata, title: 'Generated' } }, { frontMatter: true })).toBe('---\ntitle: Generated\n---\n\nbody');
  });

  it('emits no front matter at all without the option, residue or not', () => {
    const { documentPackage } = readMarkdown('---\ntitle: x\n---\n\nbody', { frontMatter: true });
    expect(writeMarkdown(documentPackage)).toBe('body');
  });

  it('keeps the flat pair free of both carries: readMarkdownContent\'s document differs from the tree only through the transform, and writeMarkdownContent renders neither definitions nor residue front matter', () => {
    const source = '[foo]: /url "t"\n\n[foo]';
    const flat = readMarkdownContent(source).document;
    expect(flat.kind).toBe('wordprocessing');
    expect(writeMarkdownContent(flat)).toBe('[foo](/url "t")');
  });
});

describe('markdownCodec: bytes <-> DocumentTree', () => {
  it('decodes real bytes to a package and encodes it back to bytes carrying the same content', () => {
    const documentPackage = z.decode(markdownCodec, SAMPLE_BYTES);
    expect(documentPackage.kind).toBe('wordprocessing');

    const encoded = z.encode(markdownCodec, documentPackage);
    expect(encoded).toBeInstanceOf(Uint8Array);

    const text = new TextDecoder().decode(encoded);
    expect(text).toContain('# Title');
    expect(text).toContain('| a | b |');
  });

  it('round-trips bytes -> package -> bytes -> package to the identical package and bytes', () => {
    const first = z.decode(markdownCodec, SAMPLE_BYTES);
    const encoded = z.encode(markdownCodec, first);
    const second = z.decode(markdownCodec, encoded);

    expect(second).toEqual(first);
    expect(z.encode(markdownCodec, second)).toEqual(encoded);
  });

  it('rejects bytes that are not well-formed UTF-8', () => {
    expect(() => z.decode(markdownCodec, new Uint8Array([0xff, 0xfe, 0xfd]))).toThrow();
  });

  it('decodes to the tree form where markdownContentCodec decodes to the flat form, over the same bytes', () => {
    const documentPackage = z.decode(markdownCodec, SAMPLE_BYTES);
    const document = z.decode(markdownContentCodec, SAMPLE_BYTES);

    expect(flattenTree(documentPackage)).toEqual(document);
    expect(z.encode(markdownCodec, documentPackage)).toEqual(z.encode(markdownContentCodec, document));
  });
});
