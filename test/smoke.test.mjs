// Smoke test: the built dist/ artifact loads and works under both ESM and CJS. Run only via `pnpm test:smoke` (tsdown, then vitest scoped to the "smoke" project) -- never part of the default `pnpm test` file set, since it requires a fresh build to mean anything.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { zipPackage, ODF_MEDIA_TYPES } from 'odf.js';
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
  'readOdtContent',
  'readOdpContent',
  'readOdsContent',
  'readPdf',
  'writePdf',
  'docxToPdf',
  'pdfToDocx',
  'pptxToPdf',
  'pdfToPptx',
  'odtToPdf',
  'odpToPdf',
  'odsToPdf',
  'openOdp',
  'createOdp',
  'pdfToOdp',
  'createLocalDocumentConverter',
];

// odt has no live-view editor in documents.js yet (see src/convert/convert.ts's own module doc), so unlike the docx bytes below -- built through cjs.createDocx() itself -- these minimal odt bytes are hand-built directly against odf.js (documents.js's own real, already-installed dependency), mirroring src/test-support/odt.ts's fixture exactly. This is deliberate duplication, not an oversight: it is the only way to prove odtToPdf's ENTIRE pipeline (odf.js's decodePackage, dist's own readOdtContent/convertWordprocessingToLayout/writePdf) actually works from the built dist/ artifact, rather than from source.
function minimalOdtBytes() {
  const mimetype = new TextEncoder().encode(ODF_MEDIA_TYPES.odt);
  const contentXml = new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Hello from the odt smoke test</text:p></office:text></office:body></office:document-content>',
  );
  return zipPackage([
    ['mimetype', { bytes: mimetype, stored: true }],
    ['content.xml', { bytes: contentXml }],
  ]);
}

// This mirrors minimalOdtBytes above exactly, just with office:presentation/draw:page/presentation:notes in place of office:text/text:p -- proving odpToPdf's entire pipeline (odf.js's decodePackage, dist's own readOdpContent/convertPresentationToLayout/writePdf, including the notes hidden-annotation mechanism) actually works from the built dist/ artifact via hand-built ODF XML, independent of this package's own createOdp/openOdp live-view editor (exercised separately below, via a fresh presentation built entirely through cjs.createOdp() itself).
function minimalOdpBytes() {
  const mimetype = new TextEncoder().encode(ODF_MEDIA_TYPES.odp);
  const contentXml = new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"><office:body><office:presentation><draw:page><draw:frame svg:x="20pt" svg:y="20pt" svg:width="300pt" svg:height="50pt"><draw:text-box><text:p>Hello from the odp smoke test</text:p></draw:text-box></draw:frame><presentation:notes><draw:frame svg:x="20pt" svg:y="300pt" svg:width="300pt" svg:height="50pt"><draw:text-box><text:p>Smoke test speaker notes</text:p></draw:text-box></draw:frame></presentation:notes></draw:page></office:presentation></office:body></office:document-content>',
  );
  return zipPackage([
    ['mimetype', { bytes: mimetype, stored: true }],
    ['content.xml', { bytes: contentXml }],
  ]);
}

// This mirrors minimalOdtBytes above exactly, just with office:spreadsheet/table:table/table:table-row/table:table-cell in place of office:text/text:p -- proving odsToPdf's entire pipeline (odf.js's decodePackage, dist's own readOdsContent/convertSpreadsheetToLayout/writePdf) actually works from the built dist/ artifact via hand-built ODF XML. There is no createOds/openOds live-view editor to exercise separately (odsToPdf is one-directional -- see src/convert/convert.ts's own module doc), unlike odp's pair of smoke tests below. The column carries an explicit wide style (mirroring odt.ts's own Col1/Col2 automatic-styles) so the cell's own real standard-14-font text genuinely fits without src/layout/sheets.ts's own string-overflow truncation kicking in -- a bare default-width column at real font metrics would truncate a sentence-length string, which is the correct algorithm behaviour, not a smoke-test bug, but would make this particular assertion the wrong one to write.
function minimalOdsBytes() {
  const mimetype = new TextEncoder().encode(ODF_MEDIA_TYPES.ods);
  const contentXml = new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><office:automatic-styles><style:style style:name="Wide" style:family="table-column"><style:table-column-properties style:column-width="10cm"/></style:style></office:automatic-styles><office:body><office:spreadsheet><table:table table:name="Sheet1"><table:table-column table:style-name="Wide"/><table:table-row><table:table-cell office:value-type="string"><text:p>Hello from the ods smoke test</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>',
  );
  return zipPackage([
    ['mimetype', { bytes: mimetype, stored: true }],
    ['content.xml', { bytes: contentXml }],
  ]);
}

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

describe('dist/ end-to-end: odtToPdf, from the CJS build', () => {
  it('produces a real PDF from a genuine ODF package, without throwing', () => {
    const pdfBytes = cjs.odtToPdf(minimalOdtBytes());
    expect(pdfBytes.length).toBeGreaterThan(0);
    expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

    const layout = cjs.readPdf(pdfBytes);
    const text = layout.pages[0]?.items
      .filter((item) => item.kind === 'text')
      .map((item) => item.text)
      .join(' ');
    expect(text).toContain('Hello from the odt smoke test');
  });
});

describe('dist/ end-to-end: odpToPdf, from the CJS build', () => {
  it('produces a real PDF from a genuine ODF package, with speaker notes carried through, without throwing', () => {
    const pdfBytes = cjs.odpToPdf(minimalOdpBytes());
    expect(pdfBytes.length).toBeGreaterThan(0);
    expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

    const layout = cjs.readPdf(pdfBytes);
    const text = layout.pages[0]?.items
      .filter((item) => item.kind === 'text')
      .map((item) => item.text)
      .join(' ');
    expect(text).toContain('Hello from the odp smoke test');
    expect(layout.pages[0]?.notes).toBe('Smoke test speaker notes');
  });
});

describe('dist/ end-to-end: odsToPdf, from the CJS build', () => {
  it('produces a real PDF from a genuine ODF spreadsheet package, without throwing', () => {
    const pdfBytes = cjs.odsToPdf(minimalOdsBytes());
    expect(pdfBytes.length).toBeGreaterThan(0);
    expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

    const layout = cjs.readPdf(pdfBytes);
    const text = layout.pages[0]?.items
      .filter((item) => item.kind === 'text')
      .map((item) => item.text)
      .join(' ');
    expect(text).toContain('Hello from the ods smoke test');
  });
});

describe('dist/ end-to-end: odpToPdf then pdfToOdp, from the CJS build', () => {
  it('builds a presentation via cjs.createOdp(), converts it to PDF and back, without throwing', () => {
    const editor = cjs.createOdp();
    const slide = editor.addSlide();
    slide.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 }, text: 'Hello from the odp editor smoke test' });
    const odpBytes = editor.toBytes();

    const pdfBytes = cjs.odpToPdf(odpBytes);
    expect(pdfBytes.length).toBeGreaterThan(0);
    expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

    const roundTrippedOdpBytes = cjs.pdfToOdp(pdfBytes);
    expect(roundTrippedOdpBytes.length).toBeGreaterThan(0);
    const roundTripped = cjs.openOdp(roundTrippedOdpBytes);
    const text = roundTripped
      .slides()
      .flatMap((s) => s.shapes())
      .map((s) => s.text)
      .join(' ');
    expect(text).toContain('Hello');
    expect(text).toContain('smoke');
  });
});
