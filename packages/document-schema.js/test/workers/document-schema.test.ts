import { describe, expect, it } from 'vitest';
import {
  CONTENT_FORMAT_VERSION,
  ContentDocumentSchema,
  DOCUMENT_PACKAGE_FORMAT_VERSION,
  DocumentPackageSchema,
} from '../../src';

// Proves document-schema.js's Zod schemas parse inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. The package is pure Zod by design -- no node:fs, no Buffer, no process -- and zod is isomorphic, so if any schema (or its zod dependency) touched a Node-only API the workerd isolate would throw rather than these passing. This is the runtime complement to the static node test suite.
describe('document-schema.js under the Cloudflare Workers runtime', () => {
  it('ContentDocumentSchema parses a minimal wordprocessing document', () => {
    const document = {
      kind: 'wordprocessing',
      formatVersion: CONTENT_FORMAT_VERSION,
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
    expect(parsed.formatVersion).toBe(CONTENT_FORMAT_VERSION);
    expect(parsed.sections[0]?.blocks).toEqual([]);
  });

  it('ContentDocumentSchema rejects an unknown document kind', () => {
    expect(() =>
      ContentDocumentSchema.parse({
        kind: 'not-a-real-kind',
        formatVersion: CONTENT_FORMAT_VERSION,
        metadata: {},
        sections: [],
      }),
    ).toThrow();
  });

  it('DocumentPackageSchema parses a content-only package wrapping that document', () => {
    const document = {
      kind: 'wordprocessing',
      formatVersion: CONTENT_FORMAT_VERSION,
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [],
        },
      ],
    };
    const parsed = DocumentPackageSchema.parse({
      formatVersion: DOCUMENT_PACKAGE_FORMAT_VERSION,
      content: document,
    });
    expect(parsed.content.kind).toBe('wordprocessing');
    expect(parsed.pages).toBeUndefined();
  });
});
