import { describe, expect, it } from 'vitest';
import { flattenPackage } from 'document-schema.js';
import { readMarkdown, readMarkdownContent, writeMarkdown, writeMarkdownContent } from '../../src';

// Proves markdown-codec's public read/write surface executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs -- both encodings: the tree-form readMarkdown/writeMarkdown pair over document-schema.js's DocumentPackage, and the flat readMarkdownContent/writeMarkdownContent pair over its ContentDocument. The codec is isomorphic by design -- CommonMark+GFM scan/parse/lower/emit hand-written with only zod as a runtime sibling, no node:fs/Buffer/path anywhere -- so if either direction touched a Node-only API the workerd isolate would throw instead of these passing. The tree pair matters here in its own right rather than being covered by the flat one: it runs document-schema.js's own decompose/factorStyles/flattenPackage inside the isolate too, so this is equally a check that the schema package's package-boundary transform is Worker-isomorphic on the path this package puts it on. This is the runtime complement to the existing node `vitest run --project unit` suite, not a replacement for it.
describe('markdown-codec under the Cloudflare Workers runtime', () => {
  const source = '# Heading text\n\nA paragraph with **bold** and `code`.\n';

  it('readMarkdown lowers a heading + paragraph to a wordprocessing DocumentPackage', () => {
    const { documentPackage } = readMarkdown(source);
    expect(documentPackage.kind).toBe('wordprocessing');
    expect(documentPackage.children.length).toBeGreaterThan(0);
  });

  it('writeMarkdown round-trips that package back to a string containing the heading text', () => {
    const { documentPackage } = readMarkdown(source);
    expect(writeMarkdown(documentPackage)).toContain('Heading text');
  });

  it('flattens a package to exactly the document readMarkdownContent produces', () => {
    expect(flattenPackage(readMarkdown(source).documentPackage)).toEqual(readMarkdownContent(source).document);
  });

  it('readMarkdownContent lowers a heading + paragraph to a wordprocessing ContentDocument', () => {
    const { document } = readMarkdownContent(source);
    expect(document.kind).toBe('wordprocessing');
  });

  it('writeMarkdownContent round-trips that content back to a string containing the heading text', () => {
    const { document } = readMarkdownContent(source);
    expect(writeMarkdownContent(document)).toContain('Heading text');
  });

  it('round-trips a footnote through the package form, whose definition rides a construct boundary-marker pair', () => {
    const { documentPackage } = readMarkdown('Body[^1].\n\n[^1]: The note.');
    expect(writeMarkdown(documentPackage)).toContain('[^1]: The note');
  });
});
