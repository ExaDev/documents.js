import type { ContentBlock, ContentDocument } from 'document-schema.js';

import { MarkdownUnsupportedDocumentKindError } from 'markdown-codec';
import { describe, expect, it } from 'vitest';
import { richMarkdownText } from '../test-support/markdown';
import { readMarkdownContent } from './read';
import { buildMarkdownText, MarkdownConstructUnsupportedError } from './write';

const CONSTRUCT_START: ContentBlock = { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'b1' } };
const CONSTRUCT_END: ContentBlock = { kind: 'constructEnd' };

function markerDocument(blocks: ContentBlock[]): ContentDocument {
  return {
    kind: 'wordprocessing',
    metadata: {},
    sections: [{ pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks }],
  };
}

describe('buildMarkdownText', () => {
  it('round-trips a wordprocessing ContentDocument back to markdown text carrying its heading, bold/italic run, list, and table', () => {
    const content = readMarkdownContent(richMarkdownText());
    const text = buildMarkdownText(content);
    expect(text).toContain('Report Title');
    expect(text).toContain('First item');
    expect(text).toContain('A1');
  });

  it('throws MarkdownUnsupportedDocumentKindError for a non-wordprocessing ContentDocument', () => {
    const presentation: ContentDocument = { kind: 'presentation', metadata: {}, slides: [] };
    expect(() => buildMarkdownText(presentation)).toThrow(MarkdownUnsupportedDocumentKindError);
  });

  it('throws when the signal is already aborted', () => {
    const content = readMarkdownContent(richMarkdownText());
    const controller = new AbortController();
    controller.abort();
    expect(() => buildMarkdownText(content, { signal: controller.signal })).toThrow();
  });

  // Both marker kinds must refuse by name -- before this fix, either one crashed inside markdown-codec's own emit path with an undebuggable `TypeError: Cannot read properties of undefined (reading 'length')` (renderTopLevelBlock has no arm for either kind, so its caller dereferences the resulting `undefined`).
  it('throws MarkdownConstructUnsupportedError for a constructStart marker, naming its descriptor kind', () => {
    const document = markerDocument([CONSTRUCT_START, { kind: 'paragraph', runs: [{ text: 'inside' }] }, CONSTRUCT_END]);
    expect(() => buildMarkdownText(document)).toThrow(MarkdownConstructUnsupportedError);
    try {
      buildMarkdownText(document);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MarkdownConstructUnsupportedError);
      expect((error as MarkdownConstructUnsupportedError).descriptorKind).toBe('anchor');
    }
  });

  it('throws MarkdownConstructUnsupportedError for a constructEnd marker', () => {
    const document = markerDocument([{ kind: 'paragraph', runs: [{ text: 'before' }] }, CONSTRUCT_END]);
    expect(() => buildMarkdownText(document)).toThrow(MarkdownConstructUnsupportedError);
  });

  it('throws MarkdownConstructUnsupportedError for a construct marker nested inside a table cell', () => {
    const document = markerDocument([{ kind: 'table', rows: [{ cells: [{ blocks: [CONSTRUCT_START, { kind: 'paragraph', runs: [{ text: 'cell' }] }, CONSTRUCT_END] }] }], columnWidthsPt: [80] }]);
    expect(() => buildMarkdownText(document)).toThrow(MarkdownConstructUnsupportedError);
  });
});
