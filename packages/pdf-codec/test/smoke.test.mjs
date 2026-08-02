// Smoke test: the built dist/ artifact loads and works under both ESM and CJS. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to this file by vitest.config.ts's "smoke" project) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

// A representative slice of the public surface, not an exhaustive list -- enough to catch a genuinely broken dual build without duplicating src/index.ts's own export list here. Classes (ByteReader, ByteWriter, PdfParseError, PdfEncryptedError) are real invocable functions at runtime (typeof === 'function'), so they're checked here alongside ordinary functions rather than in OBJECTS below.
const FUNCTIONS = [
  'readPdf',
  'writePdf',
  'loadMathFont',
  'createStandardFontMeasurer',
  'wrapRunsToWidth',
  'rotatePointAboutCenter',
  'resolveStandardFont',
  'crc32',
  'deflate',
  'inflate',
  'inflateTolerant',
  'isAsciiWhitespace',
  'concatBytes',
  'readJpegInfo',
  'decodePng',
  'encodePng',
  'unfilterScanlines',
  'filterScanlines',
  'NOOP_DIAGNOSTIC_SINK',
  'ByteReader',
  'ByteWriter',
  'PdfParseError',
  'PdfEncryptedError',
  'PdfPasswordRequiredError',
];
const OBJECTS = ['pdfCodec', 'PdfBytesSchema', 'STANDARD_METRICS', 'MAX_INFLATE_OUTPUT_BYTES'];

describe('dist/ exports are present in both builds', () => {
  for (const name of FUNCTIONS) {
    it(`${name} is a function`, () => {
      expect(typeof esm[name]).toBe('function');
      expect(typeof cjs[name]).toBe('function');
    });
  }

  for (const name of OBJECTS) {
    it(`${name} is exported`, () => {
      expect(esm[name]).toBeDefined();
      expect(cjs[name]).toBeDefined();
    });
  }
});

const HELVETICA = { family: 'Helvetica', weight: 'normal', style: 'normal' };
const BLACK = { r: 0, g: 0, b: 0 };

describe.each([
  ['ESM', esm],
  ['CJS', cjs],
])('%s artifact behaviour', (_label, api) => {
  describe('writePdf then readPdf', () => {
    it('produces a real PDF and reads its own text content back', () => {
      const doc = {
        formatVersion: 1,
        metadata: { title: 'Smoke test document' },
        pages: [
          {
            widthPt: 200,
            heightPt: 100,
            items: [{ kind: 'text', text: 'Hello from the pdf-codec smoke test', xPt: 10, yPt: 50, font: HELVETICA, sizePt: 12, color: BLACK }],
          },
        ],
        images: {},
      };

      const pdfBytes = api.writePdf(doc);
      expect(pdfBytes.length).toBeGreaterThan(0);
      expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

      const layout = api.readPdf(pdfBytes);
      expect(layout.pages).toHaveLength(1);
      const text = layout.pages[0].items
        .filter((item) => item.kind === 'text')
        .map((item) => item.text)
        .join(' ');
      expect(text).toContain('Hello from the pdf-codec smoke test');
    });
  });

  // A hand-built MathBox (a single glyph run, no MathML layout engine involved -- that engine stays in documents.js, see this package's own README) exercised through writePdf's own formulas side channel, proving the embedded STIX Two Math font asset survived the tsdown build unmangled and the CID composite font machinery (math-font.ts, math-font-write.ts, math-content-write.ts) reaches the built dist/ artifact. Mirrors documents.js's own odfToPdf smoke test assertion: the fraction/glyph run itself never becomes an ordinary LayoutItem (see write.ts's own module comment), so this checks the PDF actually contains a real embedded Type0/CIDFontType0C font resource rather than trying to recover the glyph text via readPdf.
  describe('formula embedding via writePdf({ formulas })', () => {
    it('embeds a real glyph run through the STIX Two Math font, producing a well-formed single-page PDF', () => {
      const box = {
        widthPt: 20,
        heightPt: 12,
        ascentPt: 10,
        descentPt: 2,
        items: [{ kind: 'glyphs', xPt: 0, yPt: 10, text: 'x', sizePt: 12, color: BLACK }],
      };
      const formula = { pageIndex: 0, xPt: 50, yPt: 50, box };
      const doc = { formatVersion: 1, metadata: {}, pages: [{ widthPt: 200, heightPt: 100, items: [] }], images: {} };

      const pdfBytes = api.writePdf(doc, { formulas: [formula] });
      expect(pdfBytes.length).toBeGreaterThan(0);
      expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

      const raw = new TextDecoder('latin1').decode(pdfBytes);
      expect(raw).toContain('/Subtype /Type0');
      expect(raw).toContain('/Encoding /Identity-H');
      expect(raw).toContain('/Subtype /CIDFontType0C');

      const layout = api.readPdf(pdfBytes);
      expect(layout.pages).toHaveLength(1);
    });
  });
});
