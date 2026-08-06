import { describe, expect, it } from 'vitest';
import { readMarkdown, writeMarkdown } from '../../src';

// Proves markdown-codec's readMarkdown/writeMarkdown execute inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. The codec is isomorphic by design -- CommonMark+GFM scan/parse/lower/emit hand-written with only zod as a runtime sibling, no node:fs/Buffer/path anywhere -- so if either direction touched a Node-only API the workerd isolate would throw instead of these passing. This is the runtime complement to the existing node `vitest run --project unit` suite, not a replacement for it.
describe('markdown-codec under the Cloudflare Workers runtime', () => {
  const source = '# Heading text\n\nA paragraph with **bold** and `code`.\n';

  it('readMarkdown lowers a heading + paragraph to a wordprocessing ContentDocument', () => {
    const { document } = readMarkdown(source);
    expect(document.kind).toBe('wordprocessing');
  });

  it('writeMarkdown round-trips that content back to a string containing the heading text', () => {
    const { document } = readMarkdown(source);
    const roundTripped = writeMarkdown(document);
    expect(roundTripped).toContain('Heading text');
  });
});
