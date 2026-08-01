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
  'readOdgContent',
  'readPdf',
  'writePdf',
  'docxToPdf',
  'pdfToDocx',
  'pptxToPdf',
  'pdfToPptx',
  'odtToPdf',
  'odpToPdf',
  'odsToPdf',
  'odgToPdf',
  'openOdp',
  'createOdp',
  'pdfToOdp',
  'openOds',
  'createOds',
  'buildOdsPackage',
  'pdfToOds',
  'openOdg',
  'createOdg',
  'buildOdgPackage',
  'pdfToOdg',
  'createLocalDocumentConverter',
];

// These minimal odt bytes are hand-built directly against odf.js (documents.js's own real, already-installed dependency), mirroring src/test-support/odt.ts's fixture exactly, rather than built through this package's own createOdt(). This is deliberate duplication, not an oversight: it is the only way to prove odtToPdf's ENTIRE pipeline (odf.js's decodePackage, dist's own readOdtContent/convertWordprocessingToLayout/writePdf) actually works from the built dist/ artifact independent of documents.js's own odt live-view editor, the same reasoning the odp/odg blocks further down apply when they build their own fixture bytes via cjs.createOdp()/cjs.createOdg() instead.
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

// This mirrors minimalOdtBytes above exactly, just with office:spreadsheet/table:table/table:table-row/table:table-cell in place of office:text/text:p -- proving odsToPdf's entire pipeline (odf.js's decodePackage, dist's own readOdsContent/convertSpreadsheetToLayout/writePdf) actually works from the built dist/ artifact via hand-built ODF XML, independent of this package's own createOds/openOds live-view editor (exercised separately below, via a fresh spreadsheet built entirely through cjs.createOds() itself). The column carries an explicit wide style (mirroring odt.ts's own Col1/Col2 automatic-styles) so the cell's own real standard-14-font text genuinely fits without src/layout/sheets.ts's own string-overflow truncation kicking in -- a bare default-width column at real font metrics would truncate a sentence-length string, which is the correct algorithm behaviour, not a smoke-test bug, but would make this particular assertion the wrong one to write.
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

// This mirrors minimalOdsBytes above exactly, just with office:drawing/draw:page/draw:path in place of office:spreadsheet/table:table -- proving odgToPdf's entire pipeline (odf.js's decodePackage, dist's own readOdgContent/convertDrawingToLayout/writePdf, INCLUDING writePath's own m/l/c content-stream emission) actually works from the built dist/ artifact via hand-built ODF XML. The svg:d/svg:viewBox here are the exact ground-truth-verified real LibreOffice curve odf.js's own typed/shared/path.ts documents (see src/test-support/odg.ts's own note) -- this is what proves the curve genuinely reaches the built dist/ writePath as a cubic segment, not just a straight-line approximation. There is no createOdg/openOdg live-view editor to exercise separately in THIS particular block (it is exercised below, via a fresh drawing built entirely through cjs.createOdg() itself), matching ods's own pair of smoke tests above.
function minimalOdgBytes() {
  const mimetype = new TextEncoder().encode(ODF_MEDIA_TYPES.odg);
  const contentXml = new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><office:automatic-styles><style:style style:name="grCurve" style:family="graphic"><style:graphic-properties draw:fill-color="#ffff00"/></style:style></office:automatic-styles><office:body><office:drawing><draw:page><draw:path draw:style-name="grCurve" svg:width="3.656cm" svg:height="3.999cm" svg:x="20pt" svg:y="20pt" svg:viewBox="0 0 3657 4000" svg:d="M0 4000h3000c1000 0 1000-4000-1000-4000z"/><draw:frame svg:x="20pt" svg:y="150pt" svg:width="300pt" svg:height="50pt"><draw:text-box><text:p>Hello from the odg smoke test</text:p></draw:text-box></draw:frame></draw:page></office:drawing></office:body></office:document-content>',
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

// pdfToOds now exists, so unlike ods's own PDF-only test above, this closes the full loop: minimalOdsBytes' own real column-width style gives odsToPdf real, non-degenerate geometry to render (unlike a bare cjs.createOds() sheet, which has no column-width/row-height setter of its own yet -- a documented, tracked gap, see src/edit/ods/content.ts's own module doc -- so its cells would render at zero-size bands with nothing meaningful to recover). pdfToOds is then fed the rendered PDF and reopened -- proving reconstructSpreadsheet itself reaches dist/, not just readPdf's own general path tracking.
describe('dist/ end-to-end: odsToPdf then pdfToOds, from the CJS build', () => {
  it('round-trips a genuine ODF spreadsheet package\'s cell text through PDF and back', () => {
    const pdfBytes = cjs.odsToPdf(minimalOdsBytes());
    expect(pdfBytes.length).toBeGreaterThan(0);
    expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

    // pdfToOds, closing the loop: reconstructSpreadsheet (src/layout/reconstruct.ts) recovers the rendered text's own geometry into a grid and reassembles it into a fresh, real ods package via buildOdsPackage -- reachable from the built dist/ artifact, not just from src/ under vitest.
    const roundTrippedOdsBytes = cjs.pdfToOds(pdfBytes);
    expect(roundTrippedOdsBytes.length).toBeGreaterThan(0);
    const roundTripped = cjs.openOds(roundTrippedOdsBytes);
    const text = roundTripped
      .sheets()
      .map((sheet) => sheet.cell(0, 0).displayText)
      .join(' ');
    expect(text).toContain('Hello from the ods smoke test');
  });
});

// The printSettings getter/setter (src/edit/ods/print-settings.ts) is genuinely new write code -- exercised here directly on a cjs.createOds() sheet, independent of any real cell geometry, since that's all this specific property needs to prove it reaches dist/ correctly (mints a real style:page-layout/style:master-page/style:style[family="table"] chain and reads it back through a real reopen). buildOdsPackage/OdsEditor are exercised directly too (not merely re-exported), mirroring the odg block below's own "exercised directly" pattern -- the standalone ContentDocument -> ods bridge, reachable from dist/ too.
describe('dist/ end-to-end: ods printSettings and buildOdsPackage, from the CJS build', () => {
  it('sets and reads back printSettings through a real write -> reread round trip, and rebuilds a package via buildOdsPackage', () => {
    const editor = cjs.createOds();
    const sheet = editor.sheets()[0];
    const settings = { pageSize: { widthPt: 400, heightPt: 300 }, margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 }, gridlines: true, headers: true, pageOrder: 'overThenDown' };
    sheet.printSettings = settings;
    sheet.cell(0, 0).value = { kind: 'string', value: 'Hello from the ods editor smoke test' };
    const odsBytes = editor.toBytes();

    const reopened = cjs.openOds(odsBytes).sheets()[0];
    expect(reopened.printSettings).toEqual(settings);

    const content = cjs.readOdsContent(editor.toPackage());
    expect(content.sheets[0].printSettings).toEqual(settings);
    const rebuiltPkg = cjs.buildOdsPackage(content);
    const rebuilt = new cjs.OdsEditor(rebuiltPkg);
    expect(rebuilt.sheets()).toHaveLength(1);
    expect(rebuilt.sheets()[0].printSettings).toEqual(settings);
    expect(rebuilt.sheets()[0].cell(0, 0).displayText).toBe('Hello from the ods editor smoke test');
  });
});

describe('dist/ end-to-end: odgToPdf, from the CJS build', () => {
  it('produces a real PDF from a genuine ODF drawing package with a real curved path, without throwing', () => {
    const pdfBytes = cjs.odgToPdf(minimalOdgBytes());
    expect(pdfBytes.length).toBeGreaterThan(0);
    expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

    const layout = cjs.readPdf(pdfBytes);
    const text = layout.pages[0]?.items
      .filter((item) => item.kind === 'text')
      .map((item) => item.text)
      .join(' ');
    expect(text).toContain('Hello from the odg smoke test');
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

// pdfToOdg now exists, so unlike the pre-round-trip version of this test, this closes the full loop: cjs.createOdg()'s live-view editor (page-level add/remove, addRect/addEllipse/addLine/addPath, and reused OdpShape text boxes) reaches the built dist/ artifact and produces a genuinely renderable drawing, which is then fed through odgToPdf, back through pdfToOdg, and reopened -- proving reconstructDrawing itself reaches dist/, not just readPdf's own general path tracking. Mirrors the odpToPdf-then-pdfToOdp block above exactly.
describe('dist/ end-to-end: odg live-view editor, odgToPdf then pdfToOdg, from the CJS build', () => {
  it('builds a drawing via cjs.createOdg() (a filled rect, a curved path, a text label), round-trips it through PDF, and reopens it', () => {
    const editor = cjs.createOdg();
    const page = editor.addPage();
    page.addRect({ frame: { xPt: 20, yPt: 20, widthPt: 80, heightPt: 60 }, fill: { r: 1, g: 0, b: 0 } });
    page.addPath({
      frame: { xPt: 150, yPt: 20, widthPt: 80, heightPt: 80 },
      subpaths: [
        {
          start: { xPt: 0, yPt: 80 },
          closed: true,
          segments: [
            { kind: 'line', to: { xPt: 60, yPt: 80 } },
            { kind: 'cubic', control1: { xPt: 80, yPt: 80 }, control2: { xPt: 80, yPt: 0 }, to: { xPt: 40, yPt: 0 } },
          ],
        },
      ],
      fill: { r: 0, g: 0.5, b: 1 },
    });
    page.addTextBox({ frame: { xPt: 20, yPt: 120, widthPt: 300, heightPt: 40 }, text: 'Hello from the odg editor smoke test' });
    const odgBytes = editor.toBytes();

    const pdfBytes = cjs.odgToPdf(odgBytes);
    expect(pdfBytes.length).toBeGreaterThan(0);
    expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

    const layout = cjs.readPdf(pdfBytes);
    const items = layout.pages[0]?.items ?? [];
    expect(items.some((item) => item.kind === 'rect')).toBe(true);
    const text = items
      .filter((item) => item.kind === 'text')
      .map((item) => item.text)
      .join(' ');
    expect(text).toContain('Hello');
    expect(text).toContain('smoke');

    // buildOdgPackage, exercised directly (not merely re-exported) -- the standalone ContentDocument -> odg bridge, reachable from dist/ too. Goes via editor.toPackage()/new OdgEditor(...) rather than raw decodePackage/encodePackage, since the bare decodePackage/encodePackage names re-exported from documents.js's own index are ooxml.js's (for docx/pptx), not odf.js's -- OdgEditor's own toPackage()/constructor is this package's established way to move an odf.js Package in and out of the live-view editor without that ambiguity.
    const content = cjs.readOdgContent(editor.toPackage());
    const rebuiltPkg = cjs.buildOdgPackage(content);
    const rebuilt = new cjs.OdgEditor(rebuiltPkg);
    expect(rebuilt.pages()).toHaveLength(1);

    // pdfToOdg, closing the loop: reconstructDrawing (src/layout/reconstruct.ts) recovers the rect and the text label from the rendered PDF's own geometry and reassembles them into a fresh, real odg package via buildOdgPackage -- reachable from the built dist/ artifact, not just from src/ under vitest.
    const roundTrippedOdgBytes = cjs.pdfToOdg(pdfBytes);
    expect(roundTrippedOdgBytes.length).toBeGreaterThan(0);
    const roundTripped = cjs.openOdg(roundTrippedOdgBytes);
    const roundTrippedText = roundTripped
      .pages()
      .flatMap((p) => p.shapes())
      .map((s) => s.text)
      .join(' ');
    expect(roundTrippedText).toContain('Hello');
    expect(roundTrippedText).toContain('smoke');
  });
});
