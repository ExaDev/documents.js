import { describe, expect, it } from 'vitest';
import { buildOutline, flattenOutline, isOutlineChild, leafContentHash, outlineLeafText } from '../../src';
import {
  drawPage,
  drawingDoc,
  formulaDoc,
  paragraph,
  presentationDoc,
  sheet,
  sheetImage,
  slide,
  spreadsheetDoc,
  vectorLine,
  wordprocessingDoc,
} from '../../src/test-support/fixtures';

// Proves document-outline.js's surface executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. Every path here -- per-kind outline building, flatten, leaf text, content hashing -- is deliberately Node-free (the SHA-256 is hand-rolled over Uint8Array precisely so no node:crypto is needed); if any touched code path in this module graph or its zod / document-schema dependencies reached for node:fs/Buffer/process, the workerd isolate would throw rather than these passing. This is the runtime complement to the static ESLint Worker-isomorphism guard.
describe('document-outline.js under the Cloudflare Workers runtime', () => {
  it('builds and validates outlines for all five document kinds inside the isolate', () => {
    const wordDoc = wordprocessingDoc([[paragraph('Chapter', { headingLevel: 1 }), paragraph('body')]]);
    const documents = [
      wordDoc,
      presentationDoc([slide([[paragraph('A', { listLevel: 0 }), paragraph('B', { listLevel: 1 })]])]),
      spreadsheetDoc([sheet({ name: 'Revenue', images: [sheetImage('a chart')] })]),
      drawingDoc([drawPage([[paragraph('text box')]], [vectorLine()])]),
      formulaDoc('x^2'),
    ];
    for (const doc of documents) {
      expect(buildOutline(doc).every(isOutlineChild)).toBe(true);
    }
    expect(buildOutline(wordDoc)).toEqual([
      { text: 'Chapter', level: 1, children: [paragraph('body')] },
    ]);
  });

  it('walks and hashes leaves inside the isolate', () => {
    const doc = wordprocessingDoc([
      [
        paragraph('before'),
        paragraph('Chapter', { headingLevel: 1 }),
        paragraph('A', { listLevel: 0 }),
        paragraph('B', { listLevel: 1 }),
      ],
    ]);
    const outline = buildOutline(doc);
    expect(outline.every(isOutlineChild)).toBe(true);
    expect(flattenOutline(outline)).toEqual([paragraph('before')]);
    expect(leafContentHash(paragraph('before'))).toBe(leafContentHash({ kind: 'paragraph', runs: [{ text: 'before' }] }));
    expect(outlineLeafText(paragraph('before'))).toBe('before');
  });
});
