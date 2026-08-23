import { describe, expect, it } from 'vitest';
import { assembleTree, ContentDocumentSchema, decompose, DocumentTreeSchema, factorStyles, findConstructMarkerImbalance, flattenTree, resolveStyleChain } from '../../src';

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

  it('DocumentTreeSchema parses a tree-form package and its styles table, and resolveStyleChain resolves inside the isolate', () => {
    const parsed = DocumentTreeSchema.parse({
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

  it('DocumentTreeSchema parses a construct-bearing tree and the construct tables at the root', () => {
    const parsed = DocumentTreeSchema.parse({
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

  it('ContentDocumentSchema parses the flat form of the same construct, and findConstructMarkerImbalance runs inside the isolate', () => {
    const blocks = [
      { kind: 'constructStart', descriptor: { kind: 'division', name: 'Chapter1' } },
      { kind: 'paragraph', runs: [{ text: 'Chapter body.' }] },
      { kind: 'constructEnd' },
    ];
    const parsed = ContentDocumentSchema.parse({
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks,
        },
      ],
    });
    const parsedBlocks = parsed.kind === 'wordprocessing' ? (parsed.sections[0]?.blocks ?? []) : [];
    expect(parsedBlocks).toHaveLength(3);
    expect(findConstructMarkerImbalance(parsedBlocks)).toBeUndefined();
    expect(findConstructMarkerImbalance(parsedBlocks.slice(1))).toStrictEqual({ kind: 'unmatchedEnd', index: 1 });
  });

  // The package boundary is the one part of the published surface that is behaviour rather than schema, so it needs the same runtime proof: it walks and rebuilds plain objects with no platform API at all, and running the whole assemble/mint/flatten round trip here turns that from a design claim into a workerd-executed fact.
  it('runs the flat/tree transform end to end -- decompose, mint, and flatten back -- inside the isolate', () => {
    const content = {
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [
            { kind: 'paragraph', headingLevel: 1, runs: [{ text: 'Chapter' }], indentLeftPt: 20 },
            { kind: 'paragraph', runs: [{ text: 'first' }], indentLeftPt: 20 },
            { kind: 'paragraph', runs: [{ text: 'second' }], indentLeftPt: 20 },
          ],
        },
      ],
    } as const;
    const parsed = ContentDocumentSchema.parse(content);
    expect(decompose(parsed)).toHaveLength(1);
    const tree = assembleTree(parsed);
    expect(DocumentTreeSchema.safeParse(tree).success).toBe(true);
    // Repeated indentLeftPt across the section's whole extent, so minting genuinely runs rather than short-circuiting on a styles-free tree.
    expect(tree.styles).toEqual({ s1: { paragraph: { indentLeftPt: 20 } } });
    expect(factorStyles(tree).styles).toEqual(tree.styles);
    expect(flattenTree(tree)).toStrictEqual(parsed);
  });
});
