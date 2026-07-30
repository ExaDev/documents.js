// Smoke test: the built dist/ artifact loads and works under both ESM and CJS. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to the "smoke" project) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

// A representative slice of the public surface, not an exhaustive list: ooxml.js's re-exported lossless core, the read+write live-view editors, the hand-written PDF codec, and the ergonomic conversions -- enough to catch a genuinely broken dual build without duplicating src/index.ts's own export list here.
const FUNCTIONS = [
  'decodePackage',
  'encodePackage',
  'openDocx',
  'createDocx',
  'openPptx',
  'createPptx',
  'readDocxContent',
  'readPptxContent',
  'readPdf',
  'writePdf',
  'docxToPdf',
  'pdfToDocx',
  'pptxToPdf',
  'pdfToPptx',
  'createLocalDocumentConverter',
];

describe('dist/ exports are present in both builds', () => {
  for (const name of FUNCTIONS) {
    it(`${name} is a function`, () => {
      expect(typeof esm[name]).toBe('function');
      expect(typeof cjs[name]).toBe('function');
    });
  }
});

describe('dist/ end-to-end: docxToPdf then pdfToDocx, from the CJS build', () => {
  it('produces a real PDF, then real docx bytes, without throwing', () => {
    const pkg = cjs.createDocx();
    pkg.body.appendParagraph().appendRun({ text: 'Hello from the smoke test' });
    const docxBytes = pkg.toBytes();

    const pdfBytes = cjs.docxToPdf(docxBytes);
    expect(pdfBytes.length).toBeGreaterThan(0);
    expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

    const roundTrippedDocxBytes = cjs.pdfToDocx(pdfBytes);
    expect(roundTrippedDocxBytes.length).toBeGreaterThan(0);
    const roundTripped = cjs.openDocx(roundTrippedDocxBytes);
    const text = roundTripped
      .paragraphs()
      .map((p) => p.text)
      .join(' ');
    expect(text).toContain('Hello from the smoke test');
  });
});
