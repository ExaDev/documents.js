import { describe, expect, it } from 'vitest';
import { ContentDocumentSchema, DocumentPackageSchema, resolveStyleChain } from '../../src';

// Proves document-schema.js's Zod schemas and helpers parse inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. The package is pure Zod by design -- no node:fs, no Buffer, no process -- and zod is isomorphic, so if any schema (or its zod dependency) touched a Node-only API the workerd isolate would throw rather than these passing. This is the runtime complement to the static node test suite.
describe('document-schema.js under the Cloudflare Workers runtime', () => {
  it('ContentDocumentSchema parses a minimal wordprocessing document', () => {
    const document = {
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595.28, heightPt: 841.89 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [],
        },
      ],
    };
    const parsed = ContentDocumentSchema.parse(document);
    expect(parsed.kind).toBe('wordprocessing');
    expect(parsed.sections[0]?.blocks).toEqual([]);
  });

  it('ContentDocumentSchema rejects an unknown document kind', () => {
    expect(() =>
      ContentDocumentSchema.parse({
        kind: 'not-a-real-kind',
        metadata: {},
        sections: [],
      }),
    ).toThrow();
  });

  it('DocumentPackageSchema parses a tree-form package and its styles table, and resolveStyleChain resolves inside the isolate', () => {
    const parsed = DocumentPackageSchema.parse({
      kind: 'wordprocessing',
      metadata: {},
      styles: { s1: { paragraph: { alignment: 'justify' }, run: { sizePt: 11 } } },
      children: [
        {
          node: {
            kind: 'section',
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          },
          children: [
            {
              node: { kind: 'paragraph', headingLevel: 1, runs: [{ text: 'Hello, workerd.' }] },
              style: 's1',
              children: [],
            },
          ],
        },
      ],
    });
    expect(parsed.kind).toBe('wordprocessing');
    expect(parsed.pages).toBeUndefined();
    const resolved = resolveStyleChain(parsed.styles ?? {}, ['s1']);
    expect(resolved.paragraph).toEqual({ alignment: 'justify' });
  });

  it('DocumentPackageSchema parses a construct-bearing tree and the construct tables at the root', () => {
    const parsed = DocumentPackageSchema.parse({
      kind: 'wordprocessing',
      metadata: {},
      definitions: { n1: { kind: 'footnote', blocks: [] } },
      destinations: { ch1: { kind: 'destination', pageIndex: 0 } },
      children: [
        {
          node: {
            kind: 'section',
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          },
          children: [
            {
              node: { kind: 'division', name: 'Chapter1' },
              children: [
                { node: { kind: 'anchor', anchorType: 'footnote', name: '1', definition: 'n1' }, children: [] },
                {
                  node: { kind: 'link', target: { kind: 'internal', anchor: 'ch1' } },
                  children: [{ kind: 'paragraph', runs: [{ text: 'Jump to chapter 1.' }] }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.destinations?.ch1).toEqual({ kind: 'destination', pageIndex: 0 });
    expect(parsed.children[0]?.children).toHaveLength(1);
  });
});
