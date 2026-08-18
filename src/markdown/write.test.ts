import type { ContentDocument } from 'document-schema.js';

import { MarkdownUnsupportedDocumentKindError } from 'markdown-codec';
import { describe, expect, it } from 'vitest';
import { richMarkdownText } from '../test-support/markdown';
import { readMarkdownContent } from './read';
import { buildMarkdownText } from './write';

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
});
