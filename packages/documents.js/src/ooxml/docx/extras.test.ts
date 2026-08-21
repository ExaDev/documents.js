import { describe, expect, it } from 'vitest';
import { docxWithExtrasPackage, minimalDocxPackage } from '../../test-support/docx';
import { readDocxExtras } from './extras';

// readDocxExtras is a thin re-projection of ooxml.js's own readDocx, exposing exactly the fields readDocxContent (./read.ts) cannot carry through ContentDocument: comments, footnotes, headers/footers, and numbering definitions. These tests confirm real content in each of those parts survives the round trip, and that a package with none of them reports empty collections rather than throwing.

describe('readDocxExtras', () => {
  it('reads a comment, its author, and its text from word/comments.xml', () => {
    const extras = readDocxExtras(docxWithExtrasPackage());
    expect(extras.comments).toHaveLength(1);
    // The id is the key a comment extent's anchor name joins this body back through.
    expect(extras.comments[0]).toEqual({ id: '0', author: 'Jane Doe', text: 'This needs a citation.' });
  });

  it('reads a real footnote from word/footnotes.xml, excluding the separator/continuationSeparator pair', () => {
    const extras = readDocxExtras(docxWithExtrasPackage());
    expect(extras.footnotes).toHaveLength(1);
    expect(extras.footnotes[0]).toEqual({ id: '1', text: 'See appendix A for details.' });
  });

  it('reads header and footer text', () => {
    const extras = readDocxExtras(docxWithExtrasPackage());
    expect(extras.headers).toEqual(['Header text']);
    expect(extras.footers).toEqual(['Footer text']);
  });

  it('exposes the structural header/footer model: each referenced part as block flow in package-key order, plus the section-slot references naming them', () => {
    const extras = readDocxExtras(docxWithExtrasPackage());
    expect(extras.sectionHeaderFooters).toEqual([{ header: { default: 'word/header1.xml' }, footer: { default: 'word/footer1.xml' } }]);
    expect(extras.headerFooterParts.map((part) => [part.path, part.kind])).toEqual([
      ['word/footer1.xml', 'footer'],
      ['word/header1.xml', 'header'],
    ]);
    // A referenced part's content is walked as real block flow, not concatenated text: the header's one paragraph comes through as a paragraph block with its run, resolved through the document's own style cascade (docDefaults Calibri 11pt) exactly as a body paragraph would be.
    const headerBlocks = extras.headerFooterParts[1]?.blocks ?? [];
    expect(headerBlocks).toHaveLength(1);
    const headerParagraph = headerBlocks[0]?.kind === 'paragraph' ? headerBlocks[0] : undefined;
    expect(headerParagraph?.runs.map((run) => run.text)).toEqual(['Header text']);
    expect(headerParagraph?.runs[0]?.fontFamily).toBe('Calibri');
    expect(headerParagraph?.runs[0]?.sizePt).toBe(11);
  });

  it('reads a numbering definition, keyed by numId, with its abstractNum-derived level resolved', () => {
    const extras = readDocxExtras(docxWithExtrasPackage());
    expect(extras.numbering).toEqual({
      '1': {
        levels: {
          '0': { format: 'decimal', text: '%1.', startAt: 1 },
        },
      },
    });
  });

  it('reports empty comments/footnotes/headers/footers/numbering for a package with none of those parts', () => {
    const extras = readDocxExtras(minimalDocxPackage());
    expect(extras.comments).toEqual([]);
    expect(extras.footnotes).toEqual([]);
    expect(extras.headers).toEqual([]);
    expect(extras.footers).toEqual([]);
    expect(extras.headerFooterParts).toEqual([]);
    expect(extras.sectionHeaderFooters).toEqual([{}]);
    expect(extras.numbering).toEqual({});
  });

  it('propagates the upstream reader\'s own error for a package with no word/document.xml', () => {
    expect(() => readDocxExtras({ parts: {} })).toThrow(/word\/document\.xml/);
  });
});
