import { MarkdownUnsupportedDocumentKindError } from 'markdown-codec';
import { describe, expect, it } from 'vitest';
import type { ContentDocument } from '../model/content';
import { CONTENT_FORMAT_VERSION } from '../model/content';
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
    const presentation: ContentDocument = { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, slides: [] };
    expect(() => buildMarkdownText(presentation)).toThrow(MarkdownUnsupportedDocumentKindError);
  });

  it('throws when the signal is already aborted', () => {
    const content = readMarkdownContent(richMarkdownText());
    const controller = new AbortController();
    controller.abort();
    expect(() => buildMarkdownText(content, { signal: controller.signal })).toThrow();
  });
});
