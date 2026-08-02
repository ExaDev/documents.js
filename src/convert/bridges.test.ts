import type { DocumentPackage } from 'document-schema.js';
import { DOCUMENT_PACKAGE_FORMAT_VERSION } from 'document-schema.js';
import { decodePackage as decodeOdfPackage } from 'odf.js';
import { buildXlsxPackage, decodePackage as decodeOoxmlPackage, encodePackage as encodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import type { ContentDocument } from '../model/content';
import { CONTENT_FORMAT_VERSION } from '../model/content';
import { createDocx } from '../edit/docx/editor';
import { createOdp } from '../edit/odp/editor';
import { createOdt } from '../edit/odt/editor';
import { createPptx } from '../edit/pptx/editor';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdsContent } from '../odf/ods/read';
import { readOdtContent } from '../odf/odt/read';
import { minimalOdpBytes } from '../test-support/odp';
import { richOdsBytes } from '../test-support/ods';
import { minimalOdtBytes } from '../test-support/odt';
import { docxToOdt, odpToPptx, odsToXlsx, odtToDocx, pptxToOdp, xlsxToOds } from './convert';

// The dedicated round-trip suite for the six PDF-bypassing cross-format bridges (convert.ts's own "Six cross-format bridges" section) -- exercised via both directions and both starting points for each of the three pairs (odt<->docx, odp<->pptx, ods<->xlsx), per the project's own explicit "we should also have .odt <-> .docx roundtrip tests and similar for the other types" requirement. Real-file, real-LibreOffice verification (independently-produced odt/odp/ods opened through the bridge and back into LibreOffice) is a separate, manual, non-CI-gated step -- see this repo's own README Fidelity section and test:corpus precedent for why that class of check deliberately never runs inside `pnpm test`.

function docxContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readDocxContent(decodeOoxmlPackage(bytes));
  if (content.kind !== 'wordprocessing') {
    throw new Error('expected a wordprocessing ContentDocument');
  }
  return content;
}

function odtContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readOdtContent(decodeOdfPackage(bytes)).document;
  if (content.kind !== 'wordprocessing') {
    throw new Error('expected a wordprocessing ContentDocument');
  }
  return content;
}

function pptxContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readPptxContent(decodeOoxmlPackage(bytes));
  if (content.kind !== 'presentation') {
    throw new Error('expected a presentation ContentDocument');
  }
  return content;
}

function odpContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readOdpContent(decodeOdfPackage(bytes)).document;
  if (content.kind !== 'presentation') {
    throw new Error('expected a presentation ContentDocument');
  }
  return content;
}

function odsContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readOdsContent(decodeOdfPackage(bytes));
  if (content.kind !== 'spreadsheet') {
    throw new Error('expected a spreadsheet ContentDocument');
  }
  return content;
}

function xlsxContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readXlsxContent(decodeOoxmlPackage(bytes));
  if (content.kind !== 'spreadsheet') {
    throw new Error('expected a spreadsheet ContentDocument');
  }
  return content;
}

// --- odt <-> docx ----------------------------------------------------------------------------------------------

// Multiple paragraphs, a styleId string (Heading1), a bold+italic+coloured run, a two-level list, and a 2x2 table -- the content shapes the task explicitly names.
function buildRichDocx(): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph({ styleId: 'Heading1' }).appendRun({ text: 'Report Title' });

  const styled = editor.body.appendParagraph();
  const styledRun = styled.appendRun({ text: 'Bold italic coloured text' });
  styledRun.bold = true;
  styledRun.italic = true;
  styledRun.color = { r: 0.8, g: 0, b: 0 };

  editor.body.appendParagraph().appendRun({ text: 'A second, plain paragraph.' });

  const item1 = editor.body.appendParagraph();
  item1.list = { numId: '1', level: 0 };
  item1.appendRun({ text: 'First item' });
  const item2 = editor.body.appendParagraph();
  item2.list = { numId: '1', level: 0 };
  item2.appendRun({ text: 'Second item' });
  const item3 = editor.body.appendParagraph();
  item3.list = { numId: '1', level: 1 };
  item3.appendRun({ text: 'Nested item' });
  const item4 = editor.body.appendParagraph();
  item4.list = { numId: '1', level: 0 };
  item4.appendRun({ text: 'Third top-level item' });

  const table = editor.body.appendTable({ rows: 2, columns: 2, columnWidthsTwips: [3000, 3000] });
  const rows = table.rows();
  rows[0]!.cells()[0]!.paragraphs()[0]!.appendRun({ text: 'A1' });
  rows[0]!.cells()[1]!.paragraphs()[0]!.appendRun({ text: 'B1' });
  rows[1]!.cells()[0]!.paragraphs()[0]!.appendRun({ text: 'A2' });
  rows[1]!.cells()[1]!.paragraphs()[0]!.appendRun({ text: 'B2' });

  return editor.toBytes();
}

// The odt-editor-built mirror of buildRichDocx above: same content shapes (paragraphs, a styleId, a bold+italic+coloured run, a two-level list, a 2x2 table), built through the odt live-view editor instead.
function buildRichOdt(): Uint8Array<ArrayBuffer> {
  const editor = createOdt();
  editor.body.appendParagraph({ styleId: 'Heading1' }).appendRun({ text: 'Report Title' });

  const styled = editor.body.appendParagraph();
  const styledRun = styled.appendRun({ text: 'Bold italic coloured text' });
  styledRun.bold = true;
  styledRun.italic = true;
  styledRun.color = { r: 0.8, g: 0, b: 0 };

  editor.body.appendParagraph().appendRun({ text: 'A second, plain paragraph.' });

  const list = editor.body.appendList();
  const listItem1 = list.addItem();
  listItem1.appendParagraph().appendRun({ text: 'First item' });
  const listItem2 = list.addItem();
  listItem2.appendParagraph().appendRun({ text: 'Second item' });
  const nestedList = listItem2.addNestedList();
  nestedList.addItem().appendParagraph().appendRun({ text: 'Nested item' });
  const listItem3 = list.addItem();
  listItem3.appendParagraph().appendRun({ text: 'Third top-level item' });

  const table = editor.body.appendTable({ rows: 2, columns: 2, columnWidthsPt: [150, 150] });
  const rows = table.rows();
  rows[0]!.cells()[0]!.paragraphs()[0]!.appendRun({ text: 'A1' });
  rows[0]!.cells()[1]!.paragraphs()[0]!.appendRun({ text: 'B1' });
  rows[1]!.cells()[0]!.paragraphs()[0]!.appendRun({ text: 'A2' });
  rows[1]!.cells()[1]!.paragraphs()[0]!.appendRun({ text: 'B2' });

  return editor.toBytes();
}

function paragraphTexts(content: ReturnType<typeof docxContentOf>): string[] {
  return content.sections[0]!.blocks.filter((b) => b.kind === 'paragraph').map((b) => b.runs.map((r) => r.text).join(''));
}

describe('onDocument (DocumentPackage side channel)', () => {
  // A bridge never runs a layout engine (see convert.ts's own DocumentBridgeOptions comment), so its DocumentPackage always carries content with layout left undefined -- unlike the PDF-pivot conversions, which populate both (see convert.test.ts's own docxToPdf onDocument test).
  it('calls onDocument with content populated and layout left undefined', () => {
    let captured: DocumentPackage | undefined;
    const docxBytes = odtToDocx(minimalOdtBytes(), { onDocument: (pkg) => { captured = pkg; } });
    expect(docxBytes.length).toBeGreaterThan(0);

    expect(captured).toBeDefined();
    const pkg = captured!;
    expect(pkg.formatVersion).toBe(DOCUMENT_PACKAGE_FORMAT_VERSION);
    expect(pkg.content.kind).toBe('wordprocessing');
    expect(pkg.layout).toBeUndefined();
  });
});

describe('odt <-> docx: docx -> odt -> docx', () => {
  it('carries text, styleId, run styling, list membership, and table structure through both hops', () => {
    const originalBytes = buildRichDocx();
    const original = docxContentOf(originalBytes);

    const odtBytes = docxToOdt(originalBytes);
    const roundTrippedBytes = odtToDocx(odtBytes);
    const roundTripped = docxContentOf(roundTrippedBytes);

    expect(paragraphTexts(roundTripped)).toEqual(paragraphTexts(original));

    const heading = roundTripped.sections[0]!.blocks[0];
    expect(heading?.kind).toBe('paragraph');
    expect(heading?.kind === 'paragraph' ? heading.styleId : undefined).toBe('Heading1');

    const styledBlock = roundTripped.sections[0]!.blocks[1];
    expect(styledBlock?.kind).toBe('paragraph');
    const styledRun = styledBlock?.kind === 'paragraph' ? styledBlock.runs[0] : undefined;
    expect(styledRun?.bold).toBe(true);
    expect(styledRun?.italic).toBe(true);
    expect(styledRun?.color?.r).toBeCloseTo(0.8, 5);
    expect(styledRun?.color?.g).toBeCloseTo(0, 5);
    expect(styledRun?.color?.b).toBeCloseTo(0, 5);

    // List membership: four consecutive list paragraphs at blocks[3..6], levels 0,0,1,0 -- the exact shape appendListRun (src/edit/odt/content.ts) is built to reconstruct from odt's structural text:list/text:list-item tree.
    const listBlocks = roundTripped.sections[0]!.blocks.slice(3, 7);
    const listLevels = listBlocks.map((b) => (b.kind === 'paragraph' ? b.list?.level : undefined));
    expect(listLevels).toEqual([0, 0, 1, 0]);
    // Every list paragraph shares the same numId once round-tripped through one odt text:list (a single top-level list, never split into several).
    const numIds = new Set(listBlocks.map((b) => (b.kind === 'paragraph' ? b.list?.numId : undefined)));
    expect(numIds.size).toBe(1);
    expect(numIds.has(undefined)).toBe(false);

    const tableBlock = roundTripped.sections[0]!.blocks[7];
    expect(tableBlock?.kind).toBe('table');
    if (tableBlock?.kind === 'table') {
      expect(tableBlock.rows).toHaveLength(2);
      expect(tableBlock.rows[0]?.cells).toHaveLength(2);
      const cellText = (row: number, col: number) => {
        const cell = tableBlock.rows[row]?.cells[col];
        const firstBlock = cell?.blocks[0];
        return firstBlock?.kind === 'paragraph' ? firstBlock.runs.map((r) => r.text).join('') : undefined;
      };
      expect(cellText(0, 0)).toBe('A1');
      expect(cellText(0, 1)).toBe('B1');
      expect(cellText(1, 0)).toBe('A2');
      expect(cellText(1, 1)).toBe('B2');
    }
  });

  it('throws when the signal is already aborted, on both hops', () => {
    const controller = new AbortController();
    controller.abort();
    const docxBytes = buildRichDocx();
    expect(() => docxToOdt(docxBytes, { signal: controller.signal })).toThrow();
    const odtBytes = docxToOdt(docxBytes);
    expect(() => odtToDocx(odtBytes, { signal: controller.signal })).toThrow();
  });
});

describe('odt <-> docx: odt -> docx -> odt', () => {
  it('carries text, styleId, run styling, list membership, and table structure through both hops', () => {
    const originalBytes = buildRichOdt();
    const original = odtContentOf(originalBytes);

    const docxBytes = odtToDocx(originalBytes);
    const roundTrippedBytes = docxToOdt(docxBytes);
    const roundTripped = odtContentOf(roundTrippedBytes);

    expect(paragraphTexts(roundTripped)).toEqual(paragraphTexts(original));

    const heading = roundTripped.sections[0]!.blocks[0];
    expect(heading?.kind === 'paragraph' ? heading.styleId : undefined).toBe('Heading1');

    const styledBlock = roundTripped.sections[0]!.blocks[1];
    const styledRun = styledBlock?.kind === 'paragraph' ? styledBlock.runs[0] : undefined;
    expect(styledRun?.bold).toBe(true);
    expect(styledRun?.italic).toBe(true);
    expect(styledRun?.color?.r).toBeCloseTo(0.8, 5);

    const listBlocks = roundTripped.sections[0]!.blocks.slice(3, 7);
    const listLevels = listBlocks.map((b) => (b.kind === 'paragraph' ? b.list?.level : undefined));
    expect(listLevels).toEqual([0, 0, 1, 0]);

    const tableBlock = roundTripped.sections[0]!.blocks[7];
    expect(tableBlock?.kind).toBe('table');
    if (tableBlock?.kind === 'table') {
      expect(tableBlock.rows).toHaveLength(2);
      const cellText = (row: number, col: number) => {
        const cell = tableBlock.rows[row]?.cells[col];
        const firstBlock = cell?.blocks[0];
        return firstBlock?.kind === 'paragraph' ? firstBlock.runs.map((r) => r.text).join('') : undefined;
      };
      expect(cellText(0, 0)).toBe('A1');
      expect(cellText(1, 1)).toBe('B2');
    }
  });

  it('throws when the signal is already aborted, on both hops', () => {
    const controller = new AbortController();
    controller.abort();
    const odtBytes = buildRichOdt();
    expect(() => odtToDocx(odtBytes, { signal: controller.signal })).toThrow();
    const docxBytes = odtToDocx(odtBytes);
    expect(() => docxToOdt(docxBytes, { signal: controller.signal })).toThrow();
  });
});

// --- odp <-> pptx ------------------------------------------------------------------------------------------------

// Two slides, a styled run, and speaker notes on slide 1 only -- the content shapes the task explicitly names, including notes.
function buildRichPptx(): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  const slide1 = editor.addSlide();
  const titleShape = slide1.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 80 }, text: 'Slide One Title' });
  titleShape.setParagraphs([{ runs: [{ text: 'Slide One Title', bold: true, color: { r: 0, g: 0, b: 0.8 } }] }]);
  slide1.notes = 'Speaker notes for slide one.';

  const slide2 = editor.addSlide();
  slide2.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 80 }, text: 'Slide Two Body' });

  return editor.toBytes();
}

function buildRichOdp(): Uint8Array<ArrayBuffer> {
  const editor = createOdp();
  const slide1 = editor.addSlide();
  const titleShape = slide1.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 80 }, text: 'placeholder' });
  const placeholder = titleShape.paragraphs()[0];
  placeholder?.remove();
  const titleRun = titleShape.appendParagraph().appendRun({ text: 'Slide One Title' });
  titleRun.bold = true;
  titleRun.color = { r: 0, g: 0, b: 0.8 };
  slide1.notes = 'Speaker notes for slide one.';

  const slide2 = editor.addSlide();
  slide2.addTextBox({ frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 80 }, text: 'Slide Two Body' });

  return editor.toBytes();
}

function slideText(slide: ReturnType<typeof pptxContentOf>['slides'][number], shapeIndex: number): string {
  const block = slide.shapes[shapeIndex]?.blocks[0];
  return block?.kind === 'paragraph' ? block.runs.map((r) => r.text).join('') : '';
}

describe('odp <-> pptx: pptx -> odp -> pptx', () => {
  it('carries slide text, run styling, and speaker notes through both hops', () => {
    const originalBytes = buildRichPptx();
    const odpBytes = pptxToOdp(originalBytes);
    const roundTrippedBytes = odpToPptx(odpBytes);
    const roundTripped = pptxContentOf(roundTrippedBytes);

    expect(roundTripped.slides).toHaveLength(2);
    expect(slideText(roundTripped.slides[0]!, 0)).toBe('Slide One Title');
    expect(slideText(roundTripped.slides[1]!, 0)).toBe('Slide Two Body');

    const titleRun = roundTripped.slides[0]!.shapes[0]?.blocks[0];
    expect(titleRun?.kind).toBe('paragraph');
    if (titleRun?.kind === 'paragraph') {
      expect(titleRun.runs[0]?.bold).toBe(true);
      expect(titleRun.runs[0]?.color?.b).toBeCloseTo(0.8, 5);
    }

    expect(roundTripped.slides[0]!.notes).toBe('Speaker notes for slide one.');
    expect(roundTripped.slides[1]!.notes).toBe('');
  });

  it('throws when the signal is already aborted, on both hops', () => {
    const controller = new AbortController();
    controller.abort();
    const pptxBytes = buildRichPptx();
    expect(() => pptxToOdp(pptxBytes, { signal: controller.signal })).toThrow();
    const odpBytes = pptxToOdp(pptxBytes);
    expect(() => odpToPptx(odpBytes, { signal: controller.signal })).toThrow();
  });
});

describe('odp <-> pptx: odp -> pptx -> odp', () => {
  it('carries slide text, run styling, and speaker notes through both hops', () => {
    const originalBytes = buildRichOdp();
    const pptxBytes = odpToPptx(originalBytes);
    const roundTrippedBytes = pptxToOdp(pptxBytes);
    const roundTripped = odpContentOf(roundTrippedBytes);

    expect(roundTripped.slides).toHaveLength(2);
    expect(slideText(roundTripped.slides[0]!, 0)).toBe('Slide One Title');
    expect(slideText(roundTripped.slides[1]!, 0)).toBe('Slide Two Body');

    const titleRun = roundTripped.slides[0]!.shapes[0]?.blocks[0];
    expect(titleRun?.kind).toBe('paragraph');
    if (titleRun?.kind === 'paragraph') {
      expect(titleRun.runs[0]?.bold).toBe(true);
      expect(titleRun.runs[0]?.color?.b).toBeCloseTo(0.8, 5);
    }

    expect(roundTripped.slides[0]!.notes).toBe('Speaker notes for slide one.');
    expect(roundTripped.slides[1]!.notes).toBe('');
  });

  it('throws when the signal is already aborted, on both hops', () => {
    const controller = new AbortController();
    controller.abort();
    const odpBytes = buildRichOdp();
    expect(() => odpToPptx(odpBytes, { signal: controller.signal })).toThrow();
    const pptxBytes = odpToPptx(odpBytes);
    expect(() => pptxToOdp(pptxBytes, { signal: controller.signal })).toThrow();
  });
});

// minimalOdpBytes() (test-support/odp.ts) carries content buildOdpPackage/buildPptxPackage do NOT fully round-trip -- a rotated frame, a grouped pair of shapes, an image, and a TABLE SHAPE (a draw:frame whose content is a table:table directly, not inside a text box). This is a genuine, real fidelity finding for THIS bridge specifically, distinct from the PDF-pivot conversions' own already-documented table-in-shape gap: buildPptxPackage's own appendShape (src/edit/pptx/content.ts) silently drops any non-paragraph block inside a shape's own text-box loop, a scope narrowing whose own comment ("PDF-reconstructed shapes never mix kinds") assumed its only caller was the PDF-reconstruction path -- odpToPptx is a second, non-PDF-reconstructed caller for which that assumption no longer holds, and a real odp table shape silently becomes an EMPTY pptx text box rather than a table. Documented here, in the README's own Gotchas, and left as a bounded, tracked gap rather than fixed in this change -- closing it properly means teaching buildPptxPackage/buildOdpPackage to write real tables into a slide shape at all, a materially larger feature than this task's own explicit scope.
describe('odp <-> pptx: real fidelity gap -- a table shape does not survive odpToPptx', () => {
  it('carries the rotated title, the grouped shapes, the image, and the notes through odpToPptx, but silently drops the table shape\'s own content', () => {
    const pptxBytes = odpToPptx(minimalOdpBytes());
    const content = pptxContentOf(pptxBytes);
    expect(content.slides).toHaveLength(2);

    // Slide 1: rotated title + two grouped shapes + notes all survive -- none of these are the table-in-shape case.
    const slide1Texts = content.slides[0]!.shapes.map((_, index) => slideText(content.slides[0]!, index));
    expect(slide1Texts.some((t) => t.includes('Hello'))).toBe(true);
    expect(slide1Texts).toContain('Grouped A');
    expect(slide1Texts).toContain('Grouped B');
    expect(content.slides[0]!.notes).toBe('Speaker notes for slide one.');

    // Slide 2: the image shape survives (buildPptxPackage's appendShape has a dedicated image branch)...
    const slide2 = content.slides[1]!;
    expect(slide2.shapes.some((shape) => shape.blocks.length === 1 && shape.blocks[0]?.kind === 'image')).toBe(true);
    // ...but the table shape's own content is gone: every remaining shape is either the image or an empty text box, never a 'table' block.
    expect(slide2.shapes.every((shape) => shape.blocks.every((block) => block.kind !== 'table'))).toBe(true);
  });
});

// --- ods <-> xlsx ------------------------------------------------------------------------------------------------
//
// The least mature of the three bridges -- ooxml.js's buildXlsxPackage is a brand-new xlsx writer -- so this section is deliberately the most scrutinised: every ContentCellValue kind ODS can actually produce, a merged range, a formula carried verbatim, and column widths checked against a stated numeric tolerance rather than exact equality.
//
// COLUMN WIDTH TOLERANCE: 1pt. ptToColumnWidthChars (ooxml.js's src/typed/xlsx/units.ts) is a best-effort ALGEBRAIC inverse of columnWidthCharsToPt's own two Math.trunc() pixel-grid roundings -- that module's own doc comment says as much: "not guaranteed exact for every x". The underlying grid is 96 pixels/inch, so one truncated pixel is 1/96in = 0.75pt; empirically walking columnWidthCharsToPt(ptToColumnWidthChars(x).toFixed(2)) across a wide range of realistic column widths (1..400pt, quarter-point steps) never exceeds 0.75pt of drift. 1pt is used as the assertion tolerance -- comfortably above the observed 0.75pt maximum (so the test isn't flaky against a legitimate off-by-one-pixel rounding), while still tight enough to catch a genuine regression (a wrong unit, a dropped conversion, a swapped axis would all produce errors far larger than 1pt).
const COLUMN_WIDTH_TOLERANCE_PT = 1;

function cellAt(sheet: ReturnType<typeof odsContentOf>['sheets'][number], row: number, column: number) {
  return sheet.cells.find((c) => c.row === row && c.column === column);
}

describe('ods <-> xlsx: ods -> xlsx (one hop, the character-width-unit conversion under scrutiny)', () => {
  it('carries every ODS cell-value kind, the merge, the verbatim formula, and column widths within tolerance', () => {
    const original = odsContentOf(richOdsBytes());
    const originalSheet = original.sheets[0]!;

    const xlsxBytes = odsToXlsx(richOdsBytes());
    const xlsx = xlsxContentOf(xlsxBytes);
    const sheet = xlsx.sheets[0]!;

    expect(cellAt(sheet, 0, 0)?.value).toEqual({ kind: 'string', value: 'Name' });
    expect(cellAt(sheet, 1, 0)?.value).toEqual({ kind: 'string', value: 'Widget' });
    expect(cellAt(sheet, 1, 1)?.value).toEqual({ kind: 'number', value: 42.5 });
    expect(cellAt(sheet, 1, 2)?.value).toEqual({ kind: 'boolean', value: true });

    // xlsx has no percentage/currency cell type (ooxml.js's own build.ts: "both write as a plain numeric cell") -- the kind downgrades to 'number', but the underlying numeric VALUE survives exactly.
    expect(cellAt(sheet, 2, 0)?.value).toEqual({ kind: 'number', value: 0.15 });
    expect(cellAt(sheet, 2, 1)?.value).toEqual({ kind: 'number', value: 9.99 });
    // date DOES survive as a distinct kind (xlsx's own rare t="d" cell type) -- unlike percentage/currency/time.
    expect(cellAt(sheet, 2, 2)?.value).toEqual({ kind: 'date', value: '2026-01-15' });

    // xlsx's t="d" cell type has no separate date/time distinction the way ODS's own office:value-type="time" does -- a time cell also downgrades to kind 'date', carrying its original ISO-8601-duration VALUE STRING verbatim but now under the wrong kind label.
    expect(cellAt(sheet, 3, 0)?.value).toEqual({ kind: 'date', value: 'PT14H30M00S' });

    // Formula: written verbatim into <f>, never parsed, translated, or evaluated -- the exact OpenFormula-syntax string ODS carried survives byte-for-byte, even though it is not valid Excel A1 syntax (a real Excel opening this file would show a formula error; this bridge makes no claim about cross-application formula semantics, only about byte preservation).
    const formulaCell = cellAt(sheet, 3, 1);
    expect(formulaCell?.formula).toBe('of:=[.B2]*2');
    expect(formulaCell?.value).toEqual({ kind: 'number', value: 85 });

    // Merge: colSpan survives on the anchor cell.
    const mergedCell = cellAt(sheet, 4, 0);
    expect(mergedCell?.colSpan).toBe(2);
    expect(mergedCell?.value).toEqual({ kind: 'string', value: 'Merged Cell' });

    // Column widths: within COLUMN_WIDTH_TOLERANCE_PT of the source ODS's own widths (3cm/4cm/2cm), not exact equality -- see this describe block's own top comment for why.
    expect(sheet.columns).toHaveLength(3);
    originalSheet.columns.forEach((originalColumn, index) => {
      const xlsxColumn = sheet.columns.find((c) => c.index === index);
      expect(xlsxColumn).toBeDefined();
      expect(Math.abs((xlsxColumn?.widthPt ?? 0) - originalColumn.widthPt)).toBeLessThanOrEqual(COLUMN_WIDTH_TOLERANCE_PT);
    });
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => odsToXlsx(richOdsBytes(), { signal: controller.signal })).toThrow();
  });
});

describe('ods <-> xlsx: ods -> xlsx -> ods (double hop, starting from ods)', () => {
  it('carries string/number/boolean values, the verbatim formula, and the merge through both hops', () => {
    const xlsxBytes = odsToXlsx(richOdsBytes());
    const roundTrippedBytes = xlsxToOds(xlsxBytes);
    const sheet = odsContentOf(roundTrippedBytes).sheets[0]!;

    expect(cellAt(sheet, 0, 0)?.value).toEqual({ kind: 'string', value: 'Name' });
    expect(cellAt(sheet, 1, 1)?.value).toEqual({ kind: 'number', value: 42.5 });
    expect(cellAt(sheet, 1, 2)?.value).toEqual({ kind: 'boolean', value: true });
    expect(cellAt(sheet, 3, 1)?.formula).toBe('of:=[.B2]*2');
    expect(cellAt(sheet, 3, 1)?.value).toEqual({ kind: 'number', value: 85 });
    expect(cellAt(sheet, 4, 0)?.colSpan).toBe(2);
    expect(cellAt(sheet, 4, 0)?.value).toEqual({ kind: 'string', value: 'Merged Cell' });
  });

  it('documents the real, known losses of a full double-hop cycle: percentage/currency downgrade to a plain number and time collapses into date, but column widths now survive within tolerance', () => {
    const original = odsContentOf(richOdsBytes());
    const originalSheet = original.sheets[0]!;

    const xlsxBytes = odsToXlsx(richOdsBytes());
    const roundTrippedBytes = xlsxToOds(xlsxBytes);
    const sheet = odsContentOf(roundTrippedBytes).sheets[0]!;

    // Percentage/currency: the VALUE survives, the semantic kind does not (already lost on the first hop, see the one-hop describe block above).
    expect(cellAt(sheet, 2, 0)?.value).toEqual({ kind: 'number', value: 0.15 });
    expect(cellAt(sheet, 2, 1)?.value).toEqual({ kind: 'number', value: 9.99 });

    // Time: collapses into 'date' on the first hop (xlsx has one combined t="d" type) and STAYS 'date' on the second, since buildOdsPackage's own OdsCell.value setter writes whatever kind it is given -- there is no way back to 'time' once the first hop has already thrown that distinction away.
    expect(cellAt(sheet, 3, 0)?.value).toEqual({ kind: 'date', value: 'PT14H30M00S' });

    // Column widths: buildOdsPackage (src/edit/ods/content.ts) now writes ContentSheetColumn.widthPt for real via OdsSheet.setColumnWidth (src/edit/ods/column-row.ts) -- a fix made while composing xlsxToPdf, since an unstyled column previously read back at widthPt 0 there too, and src/layout/sheets.ts's own resolveAxis treats that explicit zero as authoritative rather than falling back to a default (see column-row.ts's own top-of-file note). The tolerance here is COLUMN_WIDTH_TOLERANCE_PT stacked twice, not once -- this is a genuine double hop through the SAME lossy xlsx character-width-unit conversion the one-hop test above already documents (ods pt -> xlsx character-width units on the first hop, xlsx character-width units -> ods pt again on the second), so the accumulated drift can be up to twice the one-hop test's own single-hop bound.
    expect(sheet.columns).toHaveLength(3);
    originalSheet.columns.forEach((originalColumn, index) => {
      const roundTrippedColumn = sheet.columns.find((c) => c.index === index);
      expect(roundTrippedColumn).toBeDefined();
      expect(Math.abs((roundTrippedColumn?.widthPt ?? 0) - originalColumn.widthPt)).toBeLessThanOrEqual(COLUMN_WIDTH_TOLERANCE_PT * 2);
    });
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    const xlsxBytes = odsToXlsx(richOdsBytes());
    expect(() => xlsxToOds(xlsxBytes, { signal: controller.signal })).toThrow();
  });
});

// A genuinely independent xlsx starting point -- built directly via ooxml.js's own buildXlsxPackage + encodePackage, NOT via odsToXlsx -- so this describe block's own round trip doesn't merely re-exercise odsToXlsx's own output. Includes an 'error' cell, the one ContentCellValue kind ODS structurally cannot ever produce on read (OdsCell.value's own getter, src/edit/ods/cell.ts: "Reading it back can never reproduce kind:'error' -- no writer ... can put that value-type on the wire -- and that is a property of the format, not a gap in this editor"), since xlsx's own t="e" cell type is a genuine ECMA-376 wire format ODS has no equivalent for.
function buildXlsxNativeContentDocument(): ContentDocument {
  return {
    kind: 'spreadsheet',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {},
    sheets: [
      {
        name: 'Sheet1',
        images: [],
        columns: [],
        rows: [],
        printSettings: { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, gridlines: false, headers: false, pageOrder: 'downThenOver' },
        cells: [
          { row: 0, column: 0, value: { kind: 'error', value: '#DIV/0!' }, displayText: '#DIV/0!' },
          { row: 0, column: 1, value: { kind: 'number', value: 10 }, formula: 'A1*2', displayText: '10' },
          { row: 1, column: 0, value: { kind: 'string', value: 'plain text' }, displayText: 'plain text' },
        ],
      },
    ],
  };
}

describe('ods <-> xlsx: xlsx -> ods -> xlsx (double hop, starting from a genuine xlsx source)', () => {
  it('carries the formula and plain-text cell verbatim, and documents the error-kind -> string-kind loss unique to routing through ods', () => {
    const originalXlsxBytes = encodeOoxmlPackage(buildXlsxPackage(buildXlsxNativeContentDocument()));

    const odsBytes = xlsxToOds(originalXlsxBytes);
    const roundTrippedBytes = odsToXlsx(odsBytes);
    const sheet = xlsxContentOf(roundTrippedBytes).sheets[0]!;

    // Formula and plain string cells survive completely.
    expect(cellAt(sheet, 0, 1)?.formula).toBe('A1*2');
    expect(cellAt(sheet, 0, 1)?.value).toEqual({ kind: 'number', value: 10 });
    expect(cellAt(sheet, 1, 0)?.value).toEqual({ kind: 'string', value: 'plain text' });

    // ODS has no 'error' value-type on the wire at all (see this describe block's own top comment) -- OdsCell.value's own write-side choice for 'error' is to write it as a genuine, non-empty office:string-value carrying the error's own text, so the round trip through ods turns the ORIGINAL xlsx error cell into a plain string cell carrying the identical text. The message survives; the 'error' semantic does not.
    expect(cellAt(sheet, 0, 0)?.value).toEqual({ kind: 'string', value: '#DIV/0!' });
  });

  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    const xlsxBytes = encodeOoxmlPackage(buildXlsxPackage(buildXlsxNativeContentDocument()));
    expect(() => xlsxToOds(xlsxBytes, { signal: controller.signal })).toThrow();
  });
});
