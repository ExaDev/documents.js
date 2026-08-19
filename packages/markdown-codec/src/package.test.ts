// The tree-form half of the public surface: readMarkdown/writeMarkdown/markdownCodec over document-schema.js's DocumentPackage, and the three properties that make them trustworthy as the primary entry points.
//
// (i) They are exactly assemblePackage/flattenPackage composed onto the flat pair -- pinned by constructing the same value both ways, so a future edit that swapped assemblePackage for bare decompose (dropping the styles-minting pass) or forgot to flatten before emitting would fail here rather than silently changing what callers get. (ii) The transform is transparent to the markdown itself: the tree pair renders byte-identical text to the flat pair over real multi-construct content, which is what lets src/conformance.test.ts keep measuring the flat pair alone and still speak for both. (iii) Bytes survive a full round trip through the tree: decode -> encode -> decode reproduces the identical package, and the re-encoded bytes still carry the document's real content rather than an empty-but-valid shell.
//
// The blockquote fixture below is not decorative: two blockquote paragraphs share an indentLeftPt tuple, which is the one construct this package's lowering produces that assemblePackage's minting actually hoists onto a styles-table entry. It is the case where "assemblePackage" and "decompose plus an envelope" produce genuinely different values, so it is the case that proves which one readMarkdown calls.

import { assemblePackage, DocumentPackageSchema, flattenPackage, isPackageGroup, isSectionConstructGroupNode, type SectionConstructGroupNode } from 'document-schema.js';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { markdownCodec, markdownContentCodec } from './codec';
import { MarkdownDiagnosticCodes, MarkdownUnsupportedDocumentKindError } from './diagnostics/diagnostics';
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

// Construct groups sit wherever their marker pair sat in the block flow, which for a footnote definition following a heading is inside that heading's own group rather than at the section's top level -- so this walks the whole subtree rather than filtering one children array.
function collectConstructGroups(node: unknown): SectionConstructGroupNode[] {
  if (!isPackageGroup(node)) return [];
  const here = isSectionConstructGroupNode(node) ? [node] : [];
  return [...here, ...node.children.flatMap(collectConstructGroups)];
}

describe('readMarkdown: markdown text -> DocumentPackage', () => {
  it('produces a schema-valid wordprocessing package with one section group per lowered section', () => {
    const { documentPackage } = readMarkdown(SAMPLE);
    const { document } = readMarkdownContent(SAMPLE);
    if (document.kind !== 'wordprocessing') throw new Error('markdown lowers to wordprocessing content');

    expect(DocumentPackageSchema.safeParse(documentPackage).success).toBe(true);
    expect(documentPackage.kind).toBe('wordprocessing');
    expect(documentPackage.children).toHaveLength(document.sections.length);
  });

  it('promotes the footnote definition to a construct group carrying its own anchor descriptor', () => {
    const { documentPackage } = readMarkdown(SAMPLE);
    const constructGroups = documentPackage.children.flatMap(collectConstructGroups);

    expect(constructGroups).toHaveLength(1);
    expect(constructGroups[0]?.node).toMatchObject({ kind: 'anchor', anchorType: 'footnote', name: '1' });
  });

  it('is assemblePackage composed onto readMarkdownContent, minting included', () => {
    for (const source of [SAMPLE, BLOCKQUOTED]) {
      expect(readMarkdown(source).documentPackage).toEqual(assemblePackage(readMarkdownContent(source).document));
    }
  });

  it('mints a styles table for repeated paragraph properties rather than leaving the tree unfactored', () => {
    const { documentPackage } = readMarkdown(BLOCKQUOTED);

    expect(documentPackage.styles).toBeDefined();
    expect(Object.values(documentPackage.styles ?? {})).toContainEqual({ paragraph: { indentLeftPt: 36 } });
  });

  it('flattens back to exactly the document readMarkdownContent produces', () => {
    for (const source of [SAMPLE, BLOCKQUOTED]) {
      expect(flattenPackage(readMarkdown(source).documentPackage)).toEqual(readMarkdownContent(source).document);
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
});

describe('writeMarkdown: DocumentPackage -> markdown text', () => {
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
    const spreadsheet = assemblePackage({ kind: 'spreadsheet', metadata: {}, sheets: [] });

    expect(() => writeMarkdown(spreadsheet)).toThrow(MarkdownUnsupportedDocumentKindError);
  });

  it('throws an already-aborted signal before flattening', () => {
    const documentPackage = readMarkdown(SAMPLE).documentPackage;

    expect(() => writeMarkdown(documentPackage, { signal: AbortSignal.abort() })).toThrow();
  });
});

describe('markdownCodec: bytes <-> DocumentPackage', () => {
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

    expect(flattenPackage(documentPackage)).toEqual(document);
    expect(z.encode(markdownCodec, documentPackage)).toEqual(z.encode(markdownContentCodec, document));
  });
});
