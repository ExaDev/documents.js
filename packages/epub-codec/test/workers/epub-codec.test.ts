import { describe, expect, it } from 'vitest';
import {
  EpubBytesSchema,
  readEpubContent,
  writeEpubContent,
} from '../../src';
import type { ContentDocument } from 'document-schema.js';

// Proves epub-codec's surface executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. Every path here -- the OCF ZIP layer, XML parse/build (fast-xml-parser), XHTML read/write, OPF/nav read/write, and the base64/image-dimension codecs -- is deliberately Node-free; if any touched node:fs/Buffer/process/node:crypto the workerd isolate would throw rather than these passing. This is the runtime complement to the static no-restricted-imports guard eslint.config.ts enforces.
describe('epub-codec under the Cloudflare Workers runtime', () => {
  it('writes and reads back a real EPUB 3 zip end to end', () => {
    const document: ContentDocument = {
      kind: 'wordprocessing',
      metadata: { title: 'Workers Test' },
      sections: [
        {
          pageSize: { widthPt: 595.28, heightPt: 841.89 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            { kind: 'paragraph', headingLevel: 1, runs: [{ text: 'Title' }] },
            { kind: 'paragraph', runs: [{ text: 'Body text.', bold: true }] },
          ],
        },
      ],
    };

    const bytes = writeEpubContent(document);
    expect(EpubBytesSchema.safeParse(bytes).success).toBe(true);

    const result = readEpubContent(bytes);
    expect(result.kind).toBe('wordprocessing');
    if (result.kind === 'wordprocessing') {
      expect(result.metadata.title).toBe('Workers Test');
      expect(result.sections[0]?.blocks).toEqual(document.sections[0]?.blocks);
    }
  });

  it('mints crypto.randomUUID() identifiers without any node:crypto import', () => {
    const bytes = writeEpubContent({
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595.28, heightPt: 841.89 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: 'paragraph', runs: [{ text: 'Hello.' }] }],
        },
      ],
    });
    expect(bytes.length).toBeGreaterThan(0);
  });
});
