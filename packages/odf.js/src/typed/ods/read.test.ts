import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { bytesToBase64 } from '../../util/base64';
import { parsePackage } from '../../package-io/read';
import { parseOdfLength } from '../shared/units';
import { assertPackageRoundTrip, spreadsheetPackage } from '../../test-support/document-package';
import { readOds, readOdsContent } from './read';

// This suite reads real, unmodified LibreOffice 26.2-generated .ods fixtures (src/typed/ods/fixtures/*.ods, built via a headless UNO Basic macro driving the SAME UNO calls the Calc UI itself uses -- Format > Columns > Width, Format > Rows > Height, Format > Print Areas, Format > Page Style's Sheet tab -- never hand-edited afterwards) rather than programmatically reconstructing the expected XML shapes, mirroring readOdtContent's own established convention: this reader's own design brief is explicit that print-settings attribute names and the repeat-row/repeat-column mechanism must each be proven against genuine producer output, not just this package's own idea of what that output looks like. A handful of narrow scope-boundary/hazard-proof tests at the end use small, synthetic, hand-built packages instead (via el/txt), since a genuinely million-row repeat isn't something worth shipping as a binary fixture when the exact real repeat count is already established (typed/shared/a1.test.ts, citing a real LibreOffice-shipped .ots template).

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

function knownLength(value: string): number {
  const parsed = parseOdfLength(value);
  if (parsed === undefined) {
    throw new Error(`test fixture error: "${value}" is not a valid ODF length literal`);
  }
  return parsed;
}

describe('readOdsContent: kitchen-sink.ods (real LibreOffice output)', () => {
  const { metadata, sheets } = readOdsContent(loadFixture('kitchen-sink.ods'));
  const data = sheets.find((sheet) => sheet.name === 'Data');
  const summary = sheets.find((sheet) => sheet.name === 'Summary');
  if (data === undefined || summary === undefined) {
    throw new Error('expected both a Data and a Summary sheet');
  }

  it('reads both sheets in native document order, no sldIdLst-style indirection to resolve', () => {
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Data', 'Summary']);
  });

  it('reads document metadata via meta.xml', () => {
    expect(metadata.title).toBeUndefined(); // this fixture's own meta.xml was never touched by the build macro -- no title was ever set.
  });

  describe('column widths and hidden columns (real style:table-column-properties, real table:visibility)', () => {
    it('reads real column widths in the exact units LibreOffice itself rounded them to', () => {
      const widths = data.columns.map((column) => column.widthPt);
      expect(widths[0]).toBeCloseTo(knownLength('3cm'), 3);
      expect(widths[1]).toBeCloseTo(knownLength('2.499cm'), 3);
      expect(widths[2]).toBeCloseTo(knownLength('2cm'), 3);
      expect(widths[3]).toBeCloseTo(knownLength('2.6cm'), 3);
    });

    it('marks column G (index 6, the Fee column) hidden via table:visibility="collapse"', () => {
      const hiddenColumn = data.columns.find((column) => column.index === 6);
      expect(hiddenColumn?.hidden).toBe(true);
      expect(data.columns.filter((column) => column.hidden === true)).toHaveLength(1);
    });

    it('does not mark visible columns hidden at all (omitted, not false)', () => {
      const visibleColumn = data.columns.find((column) => column.index === 0);
      expect(visibleColumn?.hidden).toBeUndefined();
    });

    it('compresses two identically-styled columns into ONE ContentSheetColumn entry on the Summary sheet (real table:number-columns-repeated="2"), not two', () => {
      expect(summary.columns).toHaveLength(1);
      expect(summary.columns[0]).toMatchObject({ index: 0 });
    });
  });

  describe('row heights and hidden rows (real style:table-row-properties, real table:visibility)', () => {
    it('reads the header row and first data row\'s own explicit heights', () => {
      const headerRow = data.rows.find((row) => row.index === 0);
      const firstDataRow = data.rows.find((row) => row.index === 1);
      expect(headerRow?.heightPt).toBeCloseTo(knownLength('0.9cm'), 3);
      expect(firstDataRow?.heightPt).toBeCloseTo(knownLength('0.6cm'), 3);
    });

    it('marks row 10 (index 9, "Hidden Row Content") hidden via table:visibility="collapse", while its own real content still reads', () => {
      const hiddenRow = data.rows.find((row) => row.index === 9);
      expect(hiddenRow?.hidden).toBe(true);
      const hiddenCell = data.cells.find((cell) => cell.row === 9 && cell.column === 0);
      expect(hiddenCell?.displayText).toBe('Hidden Row Content');
    });
  });

  describe('every office:value-type variant on row 2 (index 1)', () => {
    const cellAt = (column: number) => {
      const cell = data.cells.find((candidate) => candidate.row === 1 && candidate.column === column);
      if (cell === undefined) {
        throw new Error(`expected a cell at row 1, column ${column}`);
      }
      return cell;
    };

    it('reads a plain string cell (office:value-type="string", no office:string-value -- the cell\'s own text:p content is the value)', () => {
      expect(cellAt(0).value).toEqual({ kind: 'string', value: 'Acme Corp' });
    });

    it('translates office:value-type="float" to kind "number" (NOT "float" -- ContentCellValueSchema has no "float" member)', () => {
      expect(cellAt(1).value).toEqual({ kind: 'number', value: 1234.56 });
    });

    it('reads a boolean cell from office:boolean-value', () => {
      expect(cellAt(2).value).toEqual({ kind: 'boolean', value: true });
    });

    it('reads a date cell\'s bare office:date-value string, unparsed', () => {
      expect(cellAt(3).value).toEqual({ kind: 'date', value: '2026-07-31' });
    });

    it('reads a time cell\'s bare office:time-value ISO-8601-duration string, unparsed', () => {
      expect(cellAt(4).value).toEqual({ kind: 'time', value: 'PT14H30M00S' });
    });

    it('reads a percentage cell as its own fraction, not multiplied by 100', () => {
      expect(cellAt(5).value).toEqual({ kind: 'percentage', value: 0.4256 });
    });

    it('reads a currency cell with its real ISO currency code from office:currency', () => {
      expect(cellAt(6).value).toEqual({ kind: 'currency', value: 99.99, currency: 'GBP' });
    });

    it('carries a real OpenFormula table:formula string verbatim, alongside its own cached numeric result', () => {
      const formulaCell = cellAt(7);
      expect(formulaCell.formula).toBe('of:=SUM([.B2:.B3])');
      expect(formulaCell.value).toEqual({ kind: 'number', value: 1276.56 });
    });

    it('reads a genuine formula-error cell (=1/0) as kind "string" with an empty office:string-value -- ODF itself has no "error" value-type -- while still carrying the real #DIV/0! text as displayText', () => {
      const errorCell = cellAt(8);
      expect(errorCell.formula).toBe('of:=1/0');
      expect(errorCell.value).toEqual({ kind: 'string', value: '' });
      expect(errorCell.displayText).toBe('#DIV/0!');
    });
  });

  describe('merged range (table:number-columns-spanned/table:number-rows-spanned, table:covered-table-cell)', () => {
    it('reads the anchor cell with its own colSpan/rowSpan and text', () => {
      const anchor = data.cells.find((cell) => cell.row === 5 && cell.column === 0);
      expect(anchor).toMatchObject({ colSpan: 2, rowSpan: 2, displayText: 'Merged Cell' });
    });

    it('emits nothing at all for the covered positions (B6, A7, B7) -- no placeholder cell object, matching the repeat-hazard\'s "skip empty" rule', () => {
      expect(data.cells.find((cell) => cell.row === 5 && cell.column === 1)).toBeUndefined();
      expect(data.cells.find((cell) => cell.row === 6 && cell.column === 0)).toBeUndefined();
      expect(data.cells.find((cell) => cell.row === 6 && cell.column === 1)).toBeUndefined();
    });
  });

  describe('cross-sheet formula', () => {
    it('carries a real cross-sheet OpenFormula reference verbatim and its own cached result', () => {
      const totalCell = summary.cells.find((cell) => cell.row === 1 && cell.column === 1);
      expect(totalCell?.formula).toBe('of:=SUM([Data.B2:.B3])');
      expect(totalCell?.value).toEqual({ kind: 'number', value: 1276.56 });
    });
  });

  describe('print settings (real style:page-layout-properties, resolved through table:table -> style:style[family="table"] -> style:master-page-name)', () => {
    it('resolves the Data sheet\'s own explicit page size and margins', () => {
      expect(data.printSettings.pageSize.widthPt).toBeCloseTo(knownLength('21.001cm'), 3);
      expect(data.printSettings.pageSize.heightPt).toBeCloseTo(knownLength('29.7cm'), 3);
      expect(data.printSettings.margins.topPt).toBeCloseTo(knownLength('1.199cm'), 3);
      expect(data.printSettings.margins.leftPt).toBeCloseTo(knownLength('1.499cm'), 3);
    });

    it('parses table:print-ranges ("Data.A1:Data.I20") into 0-based row/column bounds', () => {
      expect(data.printSettings.printRange).toEqual({ startRow: 0, startColumn: 0, endRow: 19, endColumn: 8 });
    });

    it('reads a percentage scale from style:scale-to="150%"', () => {
      expect(data.printSettings.scalePercent).toBe(150);
      expect(data.printSettings.fitToPages).toBeUndefined();
    });

    it('reads a fit-to-N-pages scale from style:scale-to-X/style:scale-to-Y on the Summary sheet', () => {
      expect(summary.printSettings.fitToPages).toEqual({ width: 1, height: 2 });
      expect(summary.printSettings.scalePercent).toBeUndefined();
    });

    it('reads repeat rows/columns from the REAL table:table-header-rows/table:table-header-columns wrapper elements -- not a named range', () => {
      expect(data.printSettings.repeatRows).toEqual({ start: 0, end: 0 });
      expect(data.printSettings.repeatColumns).toEqual({ start: 0, end: 0 });
    });

    it('reads gridlines/headers from the style:print token list\'s "grid"/"headers" membership', () => {
      expect(data.printSettings.gridlines).toBe(true);
      expect(data.printSettings.headers).toBe(true);
      expect(summary.printSettings.gridlines).toBe(false);
      expect(summary.printSettings.headers).toBe(false);
    });

    it('reads page order: style:print-page-order="ltr" -> overThenDown (Data), "ttb" -> downThenOver (Summary)', () => {
      expect(data.printSettings.pageOrder).toBe('overThenDown');
      expect(summary.printSettings.pageOrder).toBe('downThenOver');
    });

    it('reads manual page breaks from fo:break-before="page" on the row/column\'s own style, at the row/column\'s real index', () => {
      expect(data.printSettings.manualBreaks).toEqual({ rows: [15], columns: [3] });
      expect(summary.printSettings.manualBreaks).toBeUndefined();
    });

    it('falls back to the default A4/2cm page geometry on the Summary sheet, whose own page style never had an explicit size set', () => {
      expect(summary.printSettings.pageSize.widthPt).toBeCloseTo(knownLength('21.001cm'), 1);
      expect(summary.printSettings.margins.topPt).toBeCloseTo(knownLength('2cm'), 1);
    });
  });
});

describe('readOdsContent: minimal.ods (real LibreOffice output, default/unmodified sheet)', () => {
  const { sheets } = readOdsContent(loadFixture('minimal.ods'));
  const sheet = sheets[0];
  if (sheet === undefined) {
    throw new Error('expected at least one sheet');
  }

  it('reads the single default sheet', () => {
    expect(sheets).toHaveLength(1);
    expect(sheet.name).toBe('Sheet1');
  });

  it('emits nothing for the sheet\'s own single, genuinely empty cell', () => {
    expect(sheet.cells).toEqual([]);
  });

  it('still reads one column/row entry each, from the real (untouched) default column/row style', () => {
    expect(sheet.columns).toHaveLength(1);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.columns[0]?.hidden).toBeUndefined();
    expect(sheet.rows[0]?.hidden).toBeUndefined();
  });

  it('reads LibreOffice\'s own real default print settings: no explicit page size/margins written at all, gridlines/headers off, down-then-over page order', () => {
    expect(sheet.printSettings.pageSize).toEqual(PAGE_SIZE_A4);
    expect(sheet.printSettings.margins.topPt).toBeCloseTo(knownLength('2cm'), 3);
    expect(sheet.printSettings.gridlines).toBe(false);
    expect(sheet.printSettings.headers).toBe(false);
    expect(sheet.printSettings.pageOrder).toBe('downThenOver');
    expect(sheet.printSettings.printRange).toBeUndefined();
    expect(sheet.printSettings.scalePercent).toBeUndefined();
    expect(sheet.printSettings.fitToPages).toBeUndefined();
    expect(sheet.printSettings.repeatRows).toBeUndefined();
    expect(sheet.printSettings.repeatColumns).toBeUndefined();
    expect(sheet.printSettings.manualBreaks).toBeUndefined();
  });
});

// sheet-anchors.ods was built via a Java UNO client against a headless LibreOffice 26.2 (the same "drive the calls the UI itself makes" technique the other fixtures use -- LibreOffice's own bundled Python cannot be launched directly on macOS 26, which kills it with a code-signing Launch Constraint Violation, and command-line `macro:///` dispatch never fired at all in this sandbox, so the Java UNO bridge shipped in LibreOffice's own Resources/java was used instead). Three real anchored drawings, saved with the calc8 filter and never hand-edited afterwards:
//   - an 8x8 PNG anchored TO CELL C5 (column index 2, row index 4), sized 3cm x 2cm, positioned 0.5cm/0.3cm past its anchor cell's own top-left, with a real UNO Title and Description set (svg:title/svg:desc);
//   - a LibreOffice Draw document embedded as an OLE object anchored TO CELL B8 (column index 1, row index 7), sized 4cm x 3cm, offset 0.2cm/0.1cm, containing one real orange rectangle;
//   - the same PNG anchored TO PAGE at an absolute 7cm/0.9cm, sized 1.5cm x 1cm.
describe('readOdsContent: sheet-anchors.ods (real LibreOffice output -- anchored images and an embedded object)', () => {
  const { sheets } = readOdsContent(loadFixture('sheet-anchors.ods'));
  const sheet = sheets[0];
  if (sheet === undefined) {
    throw new Error('expected at least one sheet');
  }

  it('reads both anchored images -- the page-anchored one (table:shapes, first in document order) then the cell-anchored one', () => {
    expect(sheet.images).toHaveLength(2);
    expect(sheet.images.map((image) => image.format)).toEqual(['png', 'png']);
  });

  it('resolves the cell-anchored image to its real anchor cell (C5) with its own cell-relative offsets, never a fabricated address attribute', () => {
    const anchored = sheet.images[1];
    expect(anchored?.anchorColumn).toBe(2);
    expect(anchored?.anchorRow).toBe(4);
    expect(anchored?.offsetXPt).toBeCloseTo(knownLength('0.5cm'), 6);
    expect(anchored?.offsetYPt).toBeCloseTo(knownLength('0.3cm'), 6);
  });

  it('sizes the cell-anchored image to its own frame, not to the source PNG\'s 8x8 native pixels', () => {
    expect(sheet.images[1]?.widthPt).toBeCloseTo(knownLength('3cm'), 6);
    expect(sheet.images[1]?.heightPt).toBeCloseTo(knownLength('2cm'), 6);
  });

  it('carries the image\'s real bytes through as base64, sniffed to png from its own magic bytes', () => {
    expect(sheet.images[1]?.base64.startsWith('iVBORw0KGgo')).toBe(true);
  });

  it('reads the frame\'s own svg:title as altText', () => {
    expect(sheet.images[1]?.altText).toBe('Chequered swatch');
  });

  it('reports the page-anchored image (a real table:shapes child) against cell (0, 0) with its absolute sheet coordinates carried through unchanged', () => {
    const pageAnchored = sheet.images[0];
    expect(pageAnchored?.anchorRow).toBe(0);
    expect(pageAnchored?.anchorColumn).toBe(0);
    expect(pageAnchored?.offsetXPt).toBeCloseTo(knownLength('7cm'), 6);
    expect(pageAnchored?.offsetYPt).toBeCloseTo(knownLength('0.9cm'), 6);
    expect(pageAnchored?.altText).toBeUndefined();
  });

  it('reads the embedded OLE object as a real, fully-read drawing ContentDocument -- not a placeholder, and not its ObjectReplacements preview image', () => {
    expect(sheet.embeddedObjects).toHaveLength(1);
    const embedded = sheet.embeddedObjects?.[0];
    expect(embedded?.objectKind).toBe('drawing');
    expect(embedded?.document.kind).toBe('drawing');
    if (embedded?.document.kind !== 'drawing') {
      throw new Error('expected a drawing ContentDocument');
    }
    const vectors = embedded.document.pages[0]?.vectors;
    expect(vectors).toHaveLength(1);
    const vector = vectors?.[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected the embedded drawing\'s own rectangle');
    }
    expect(vector.fill).toEqual({ r: 1, g: 0x88 / 255, b: 0 });
  });

  it('reads the embedded object\'s own frame from the draw:frame, keeping the cell-relative coordinates the format itself states', () => {
    const frame = sheet.embeddedObjects?.[0]?.frame;
    expect(frame?.xPt).toBeCloseTo(knownLength('0.2cm'), 6);
    expect(frame?.yPt).toBeCloseTo(knownLength('0.1cm'), 6);
    expect(frame?.widthPt).toBeCloseTo(knownLength('4cm'), 6);
    expect(frame?.heightPt).toBeCloseTo(knownLength('3cm'), 6);
  });

  it('resolves the embedded object to its real anchor cell (B8) with the same cell-relative offsets an anchored image gets', () => {
    const embedded = sheet.embeddedObjects?.[0];
    expect(embedded?.anchorColumn).toBe(1);
    expect(embedded?.anchorRow).toBe(7);
    expect(embedded?.offsetXPt).toBeCloseTo(knownLength('0.2cm'), 6);
    expect(embedded?.offsetYPt).toBeCloseTo(knownLength('0.1cm'), 6);
  });

  it('never mistakes the embedded object\'s own ObjectReplacements preview for anchored picture content', () => {
    expect(sheet.images.some((image) => image.widthPt > knownLength('3.5cm'))).toBe(false);
  });

  it('still reads the sheet\'s ordinary cell content alongside its drawings, and never materializes the drawing-only anchor cells as cells of their own', () => {
    expect(sheet.cells.map((cell) => cell.displayText)).toEqual(['Label', 'Value', 'Alpha', '42']);
  });

  it('leaves embeddedObjects undefined on a sheet that has none, rather than writing an empty array', () => {
    expect(readOdsContent(loadFixture('kitchen-sink.ods')).sheets[0]?.embeddedObjects).toBeUndefined();
    expect(readOdsContent(loadFixture('kitchen-sink.ods')).sheets[0]?.images).toEqual([]);
  });
});

// sheet-formula.ods was built the same way as sheet-anchors.ods above (a Java UNO client against a headless LibreOffice 26.2, saved with the calc8 filter, never hand-edited afterwards): a one-sheet Calc document named "Formulas" carrying two ordinary cells and ONE real LibreOffice Math object -- a com.sun.star.drawing.OLE2Shape with Math's own CLSID 078B7ABA-54FC-457F-8551-6147E776A997, its Formula property set to the StarMath expression "f(x) = {x^2} over {2} + sqrt {x}", anchored TO CELL C4 (column index 2, row index 3) at a 0.4cm/0.2cm cell-relative offset. Its saved shape confirms, on a genuinely produced file, everything typed/draw/embedded.ts's formula path is built on: the frame is an ordinary draw:frame with a draw:object href of "./Object 1" plus the usual ObjectReplacements preview sibling, the outer manifest declares "Object 1/" as application/vnd.oasis.opendocument.formula, and that sub-document's own content.xml is a BARE <math> root with no office:body (and, notably, no meta.xml part of its own at all).
describe('readOdsContent: sheet-formula.ods (real LibreOffice output -- a Math object anchored to a cell)', () => {
  const { sheets } = readOdsContent(loadFixture('sheet-formula.ods'));
  const sheet = sheets[0];
  if (sheet === undefined) {
    throw new Error('expected at least one sheet');
  }

  it('reads the embedded Math object as a real formula ContentDocument, not as its ObjectReplacements preview image', () => {
    expect(sheet.images).toEqual([]);
    expect(sheet.embeddedObjects).toHaveLength(1);
    expect(sheet.embeddedObjects?.[0]?.objectKind).toBe('formula');
    expect(sheet.embeddedObjects?.[0]?.document.kind).toBe('formula');
  });

  it('carries the formula\'s real MathML through, with its own StarMath annotation -- the same payload readOdfFormulaContent produces for a standalone .odf', () => {
    const document = sheet.embeddedObjects?.[0]?.document;
    if (document?.kind !== 'formula') {
      throw new Error('expected a formula ContentDocument');
    }
    expect(document.formula.starMath).toBe('f(x) = {x^2} over {2} + sqrt {x}');
    // The MathML root's own children, exactly as read: one <semantics> wrapping the presentation MathML plus the annotation.
    const [semantics] = document.formula.mathml;
    if (semantics?.type !== 'element') {
      throw new Error('expected a <semantics> element');
    }
    expect(semantics.tag).toBe('semantics');
    expect(semantics.children.filter((child) => child.type === 'element').map((child) => child.tag)).toEqual(['mrow', 'annotation']);
  });

  it('resolves the formula object to its real anchor cell (C4) with its own cell-relative offsets', () => {
    const embedded = sheet.embeddedObjects?.[0];
    expect(embedded?.anchorColumn).toBe(2);
    expect(embedded?.anchorRow).toBe(3);
    expect(embedded?.offsetXPt).toBeCloseTo(knownLength('0.4cm'), 6);
    expect(embedded?.offsetYPt).toBeCloseTo(knownLength('0.2cm'), 6);
    expect(embedded?.frame.xPt).toBeCloseTo(knownLength('0.4cm'), 6);
    expect(embedded?.frame.yPt).toBeCloseTo(knownLength('0.2cm'), 6);
  });

  it('reads the frame at the size LibreOffice itself sized the rendered formula to, not at the size the OLE shape was created with', () => {
    // LibreOffice resizes a Math OLE object's own frame to its rendered formula: the shape was created 4cm x 2cm and saved as 2.701cm x 4.515cm.
    expect(sheet.embeddedObjects?.[0]?.frame.widthPt).toBeCloseTo(knownLength('2.701cm'), 6);
    expect(sheet.embeddedObjects?.[0]?.frame.heightPt).toBeCloseTo(knownLength('4.515cm'), 6);
  });

  it('reports empty metadata for a sub-document that ships no meta.xml of its own, rather than throwing', () => {
    expect(sheet.embeddedObjects?.[0]?.document.metadata).toEqual({});
  });

  it('still reads the sheet\'s ordinary cells alongside the formula, and never materializes the formula\'s own anchor cell as a cell of its own', () => {
    expect(sheet.name).toBe('Formulas');
    expect(sheet.cells.map((cell) => cell.displayText)).toEqual(['Quantity', '7']);
  });
});

describe('readOdsContent: anchored drawings (synthetic packages -- the scope boundaries and group flattening real LibreOffice output does not exercise)', () => {
  // Only the PNG magic-byte signature matters to sniffImageFormat -- the rest is arbitrary filler, matching typed/draw/shapes.test.ts's own convention.
  const pngBase64 = bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));

  function imageFrame(attrs: Record<string, string>): XmlElement {
    return el('draw:frame', attrs, [el('draw:image', { 'xlink:href': 'Pictures/img.png' })]);
  }

  function drawingPackage(table: XmlElement): Package {
    return {
      parts: {
        'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:spreadsheet', {}, [table])])])] },
        'Pictures/img.png': { kind: 'binary', base64: pngBase64 },
      },
    };
  }

  const frameBox = { 'svg:x': '10pt', 'svg:y': '20pt', 'svg:width': '100pt', 'svg:height': '50pt' };

  it('resolves the anchor cell from the running cursor, so a frame in a cell after a repeated run still reports its real column index', () => {
    const row = el('table:table-row', {}, [
      el('table:table-cell', { 'table:number-columns-repeated': '5' }),
      el('table:table-cell', {}, [imageFrame(frameBox)]),
    ]);
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', { 'table:number-rows-repeated': '3' }, []), row]);
    const { sheets } = readOdsContent(drawingPackage(table));
    expect(sheets[0]?.images[0]).toMatchObject({ anchorRow: 3, anchorColumn: 5, offsetXPt: 10, offsetYPt: 20 });
  });

  it('walks through a draw:g group, composing the group\'s own draw:transform onto the frame exactly as walkDrawShapes does for a slide', () => {
    const group = el('draw:g', { 'draw:transform': 'translate(5pt 7pt)' }, [imageFrame(frameBox)]);
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [el('table:table-cell', {}, [group])])]);
    const { sheets } = readOdsContent(drawingPackage(table));
    expect(sheets[0]?.images[0]).toMatchObject({ anchorRow: 0, anchorColumn: 0, offsetXPt: 15, offsetYPt: 27 });
  });

  it('skips a frame ContentSheet has nowhere to carry -- a floating text box (no `shapes` array) and a bare vector primitive (no `vectors` array)', () => {
    const textBox = el('draw:frame', frameBox, [el('draw:text-box', {}, [el('text:p', {}, [txt('floating')])])]);
    const rect = el('draw:rect', frameBox);
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [el('table:table-cell', {}, [textBox, rect])])]);
    const { sheets } = readOdsContent(drawingPackage(table));
    expect(sheets[0]?.images).toEqual([]);
    expect(sheets[0]?.embeddedObjects).toBeUndefined();
  });

  it('skips a frame with no resolvable geometry at all, matching readDrawFrame\'s own documented inherited-positioning boundary', () => {
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [el('table:table-cell', {}, [imageFrame({})])])]);
    expect(readOdsContent(drawingPackage(table)).sheets[0]?.images).toEqual([]);
  });

  it('reads an anchored image from a cell that also has real content, without disturbing that cell\'s own value', () => {
    const cell = el('table:table-cell', { 'office:value-type': 'string' }, [el('text:p', {}, [txt('has a picture')]), imageFrame(frameBox)]);
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [cell])]);
    const { sheets } = readOdsContent(drawingPackage(table));
    expect(sheets[0]?.cells[0]?.displayText).toBe('has a picture');
    expect(sheets[0]?.images[0]).toMatchObject({ anchorRow: 0, anchorColumn: 0 });
  });
});

describe('readOdsContent: repeat-count hazards (synthetic packages -- proving this reader never materializes a huge repeated run, real confirmed counts from typed/shared/a1.test.ts)', () => {
  // A real LibreOffice-shipped .ots template's own trailing empty rows carry table:number-rows-repeated="1016575" (confirmed in typed/shared/a1.test.ts, from /Applications/LibreOffice.app/Contents/Resources/template/common/wizard/styles/*.ots) -- reused here verbatim rather than re-deriving a fresh huge fixture, since the real count is already established ground truth.
  const HUGE_ROW_REPEAT = 1016575;
  const HUGE_COLUMN_REPEAT = 1024; // a1.test.ts's own "real trailing-repeated-cell block" example.

  function buildHugeRepeatPackage(): Package {
    const headerRow = el('table:table-row', {}, [el('table:table-cell', { 'office:value-type': 'string' }, [el('text:p', {}, [txt('Header')])])]);
    const hugeEmptyRow = el('table:table-row', { 'table:number-rows-repeated': String(HUGE_ROW_REPEAT) }, [
      el('table:table-cell', { 'table:number-columns-repeated': String(HUGE_COLUMN_REPEAT) }),
    ]);
    const table = el('table:table', { 'table:name': 'Big' }, [
      el('table:table-column', { 'table:number-columns-repeated': String(HUGE_COLUMN_REPEAT) }),
      headerRow,
      hugeEmptyRow,
    ]);
    return {
      parts: {
        'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:spreadsheet', {}, [table])])])] },
      },
    };
  }

  it('does not allocate one ContentSheetCell per repeated empty position: a >1,000,000-row repeat block yields exactly one real cell', () => {
    const { sheets } = readOdsContent(buildHugeRepeatPackage());
    expect(sheets[0]?.cells).toHaveLength(1);
    expect(sheets[0]?.cells[0]).toMatchObject({ row: 0, column: 0, value: { kind: 'string', value: 'Header' }, displayText: 'Header' });
  });

  it('does not allocate one ContentSheetRow per repeated row: only the two real table:table-row XML elements are represented', () => {
    const { sheets } = readOdsContent(buildHugeRepeatPackage());
    expect(sheets[0]?.rows).toHaveLength(2);
    expect(sheets[0]?.rows[1]?.index).toBe(1); // the huge repeat block's own STARTING row index, not a materialized count.
  });

  it('does not allocate one ContentSheetColumn per repeated column: a 1024-column repeat block yields exactly one column entry', () => {
    const { sheets } = readOdsContent(buildHugeRepeatPackage());
    expect(sheets[0]?.columns).toHaveLength(1);
    expect(sheets[0]?.columns[0]?.index).toBe(0);
  });

  it('completes in well under a second, confirming no O(repeatCount) work happened at all', () => {
    const start = performance.now();
    readOdsContent(buildHugeRepeatPackage());
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('readOdsContent: error and fallback paths (synthetic packages -- not something real LibreOffice output can exercise)', () => {
  it('reads an empty sheets array for a package with no content.xml at all', () => {
    const result = readOdsContent({ parts: {} });
    expect(result.sheets).toEqual([]);
    expect(result.metadata).toEqual({});
  });

  it('reads an empty sheets array for a package with no office:spreadsheet at all', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body')])] } } };
    expect(readOdsContent(pkg).sheets).toEqual([]);
  });

  it('skips a table:table with no table:name at all, rather than fabricating one', () => {
    const pkg: Package = {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:spreadsheet', {}, [el('table:table', {}, [el('table:table-row')])])])])],
        },
      },
    };
    expect(readOdsContent(pkg).sheets).toEqual([]);
  });

  it('reads a table:table with no rows/columns at all as a sheet with empty arrays, not a throw', () => {
    const pkg: Package = {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:spreadsheet', {}, [el('table:table', { 'table:name': 'Empty' })])])])],
        },
      },
    };
    const { sheets } = readOdsContent(pkg);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ name: 'Empty', cells: [], columns: [], rows: [] });
  });
});

describe('readOdsContent: named expressions (synthetic packages -- the declarations real fixture output leaves empty)', () => {
  function namedExpressionsPackage(named: XmlElement): Package {
    return {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:spreadsheet', {}, [el('table:named-expressions', {}, [named])])])])],
        },
      },
    };
  }

  it('reads a table:named-range into a definitions entry keyed by its name, carrying its range and base cell verbatim', () => {
    const pkg = namedExpressionsPackage(el('table:named-range', { 'table:name': 'TotalSales', 'table:base-cell-address': "$'Q1 Sheet'.$A$1", 'table:cell-range-address': "$'Q1 Sheet'.$B$2:.$D$6" }));
    const document = readOdsContent(pkg);
    expect(document.definitions).toEqual({
      'named-range:TotalSales': { kind: 'namedRange', name: 'TotalSales', cellRangeAddress: "$'Q1 Sheet'.$B$2:.$D$6", baseCellAddress: "$'Q1 Sheet'.$A$1" },
    });
  });

  it('reads a table:named-expression into its own entry kind, carrying the expression verbatim', () => {
    const pkg = namedExpressionsPackage(el('table:named-expression', { 'table:name': 'Growth', 'table:base-cell-address': '$Sheet2.$A$1', 'table:expression': 'of:=[.B2]/[.B1]' }));
    const document = readOdsContent(pkg);
    expect(document.definitions).toEqual({
      'named-expression:Growth': { kind: 'namedExpression', name: 'Growth', expression: 'of:=[.B2]/[.B1]', baseCellAddress: '$Sheet2.$A$1' },
    });
  });

  it('leaves definitions absent for the empty table:named-expressions element every real fixture carries', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:spreadsheet', {}, [el('table:named-expressions')])])])] } } };
    expect(readOdsContent(pkg).definitions).toBeUndefined();
  });

  it('carries the definitions table onto the assembled package root', () => {
    const pkg = namedExpressionsPackage(el('table:named-range', { 'table:name': 'R', 'table:cell-range-address': '.A1' }));
    expect(readOds(pkg).definitions).toEqual(readOdsContent(pkg).definitions);
  });
});

describe('readOdsContent: cell background/borders/alignment/verticalAlignment (synthetic packages -- the real cascade, including a genuine style:parent-style-name chain matching kitchen-sink.ods\'s own real ce1..ce5 -> "Default" -> table-cell family default-style shape)', () => {
  interface TableCellStyleOptions {
    cellProperties?: Record<string, string>;
    paragraphProperties?: Record<string, string>;
    parentStyleName?: string;
  }

  function tableCellStyle(name: string, options: TableCellStyleOptions = {}): XmlElement {
    const children: XmlElement[] = [];
    if (options.cellProperties !== undefined) {
      children.push(el('style:table-cell-properties', options.cellProperties));
    }
    if (options.paragraphProperties !== undefined) {
      children.push(el('style:paragraph-properties', options.paragraphProperties));
    }
    const attrs: Record<string, string> = { 'style:name': name, 'style:family': 'table-cell' };
    if (options.parentStyleName !== undefined) {
      attrs['style:parent-style-name'] = options.parentStyleName;
    }
    return el('style:style', attrs, children);
  }

  function tableCellDefaultStyle(options: TableCellStyleOptions = {}): XmlElement {
    const children: XmlElement[] = [];
    if (options.cellProperties !== undefined) {
      children.push(el('style:table-cell-properties', options.cellProperties));
    }
    if (options.paragraphProperties !== undefined) {
      children.push(el('style:paragraph-properties', options.paragraphProperties));
    }
    return el('style:default-style', { 'style:family': 'table-cell' }, children);
  }

  function stringCell(text: string, extraAttrs: Record<string, string> = {}): XmlElement {
    return el('table:table-cell', { 'office:value-type': 'string', ...extraAttrs }, [el('text:p', {}, [txt(text)])]);
  }

  function sheetPackage(automaticStyleChildren: XmlElement[], table: XmlElement): Package {
    return {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [
            el('office:document-content', {}, [
              el('office:automatic-styles', {}, automaticStyleChildren),
              el('office:body', {}, [el('office:spreadsheet', {}, [table])]),
            ]),
          ],
        },
      },
    };
  }

  it('defaults an unstyled column/row to a positive width/height (not 0, which would violate ContentSheet{Column,Row}Schema\'s .positive() constraint)', () => {
    const table = el('table:table', { 'table:name': 'Sheet1' }, [
      el('table:table-column', {}, []),
      el('table:table-row', {}, [stringCell('a')]),
    ]);
    const { sheets } = readOdsContent(sheetPackage([], table));
    expect(sheets[0]?.columns[0]?.widthPt).toBe(64);
    expect(sheets[0]?.rows[0]?.heightPt).toBe(15);
  });

  it('resolves fo:background-color from the cell\'s own table:style-name -> table-cell family style', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'fo:background-color': '#ff0000' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('red', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.background).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('expands the fo:border shorthand onto all four edges', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'fo:border': '0.5pt solid #0000ff' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('bordered', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    const expectedEdge = { color: { r: 0, g: 0, b: 1 }, widthPt: 0.5, style: 'solid' };
    expect(sheets[0]?.cells[0]?.borders).toEqual({ left: expectedEdge, right: expectedEdge, top: expectedEdge, bottom: expectedEdge });
  });

  it('lets a per-edge fo:border-top override just that one edge', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'fo:border': '1pt solid #000000', 'fo:border-top': '2pt dotted #ffff00' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('bordered', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    const borders = sheets[0]?.cells[0]?.borders;
    expect(borders?.top).toEqual({ color: { r: 1, g: 1, b: 0 }, widthPt: 2, style: 'dotted' });
    expect(borders?.bottom).toEqual({ color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'solid' });
  });

  it('treats an explicit "none" border-style override as genuinely clearing an inherited edge, not merely leaving it unmentioned', () => {
    const parent = tableCellStyle('Parent', { cellProperties: { 'fo:border': '1pt solid #000000' } });
    const child = tableCellStyle('ce1', { cellProperties: { 'fo:border-bottom': '1pt none #000000' }, parentStyleName: 'Parent' });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('partial', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOdsContent(sheetPackage([parent, child], table));
    const borders = sheets[0]?.cells[0]?.borders;
    expect(borders?.bottom).toBeUndefined();
    expect(borders?.top).toEqual({ color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'solid' });
  });

  it('reads style:vertical-align from the cell\'s own table-cell-properties', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'style:vertical-align': 'middle' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('centred', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.verticalAlignment).toBe('middle');
  });

  it('leaves verticalAlignment undefined for style:vertical-align="automatic" (no matching enum member), rather than guessing', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'style:vertical-align': 'automatic' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('auto', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.verticalAlignment).toBeUndefined();
  });

  it('reads fo:text-align from the cell style\'s own style:paragraph-properties as an alignment override', () => {
    const ce1 = tableCellStyle('ce1', { paragraphProperties: { 'fo:text-align': 'center' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('centred', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.alignment).toBe('center');
  });

  it('leaves alignment undefined for a cell whose style sets no fo:text-align at all -- the value-kind default stays in effect elsewhere, this reader never fabricates one', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'fo:background-color': '#ff0000' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('red', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOdsContent(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.alignment).toBeUndefined();
  });

  it('resolves background through the FULL resolveStyleElementChain cascade -- a family default-style contributes a background the cell\'s own specific style never overrides', () => {
    const defaultStyle = tableCellDefaultStyle({ cellProperties: { 'fo:background-color': '#00ff00' } });
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'style:vertical-align': 'top' } }); // no background of its own
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('inherited', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOdsContent(sheetPackage([defaultStyle, ce1], table));
    expect(sheets[0]?.cells[0]?.background).toEqual({ r: 0, g: 1, b: 0 });
    expect(sheets[0]?.cells[0]?.verticalAlignment).toBe('top');
  });

  it('lets a style:parent-style-name chain contribute a background that the cell\'s own specific style then overrides -- later (more specific) always wins, matching kitchen-sink.ods\'s own real ce1..ce5 -> "Default" chain shape', () => {
    const parent = tableCellStyle('Parent', { cellProperties: { 'fo:background-color': '#ff0000' } });
    const ce1 = el('style:style', { 'style:name': 'ce1', 'style:family': 'table-cell', 'style:parent-style-name': 'Parent' }, [
      el('style:table-cell-properties', { 'fo:background-color': '#0000ff' }),
    ]);
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('overridden', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOdsContent(sheetPackage([parent, ce1], table));
    expect(sheets[0]?.cells[0]?.background).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('leaves background/borders/alignment/verticalAlignment all undefined for a cell with no table:style-name at all', () => {
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('plain')])]);
    const { sheets } = readOdsContent(sheetPackage([], table));
    const cell = sheets[0]?.cells[0];
    expect(cell?.background).toBeUndefined();
    expect(cell?.borders).toBeUndefined();
    expect(cell?.alignment).toBeUndefined();
    expect(cell?.verticalAlignment).toBeUndefined();
  });
});

describe('readOds: the package-native reader over the same real fixtures', () => {
  it('assembles kitchen-sink.ods into a spreadsheet package whose tree flattens back to readOdsContent output exactly', () => {
    const pkg = loadFixture('kitchen-sink.ods');
    const content = readOdsContent(pkg);
    const documentPackage = readOds(pkg);

    expect(documentPackage.kind).toBe('spreadsheet');
    expect(documentPackage.metadata).toEqual(content.metadata);
    expect(documentPackage.children).toHaveLength(content.sheets.length);
    assertPackageRoundTrip(documentPackage, { kind: 'spreadsheet', ...content });
  });

  it('keeps a sheet\'s grid and print settings on its group node, since a sheet holds addressable data rather than block flow', () => {
    const pkg = loadFixture('kitchen-sink.ods');
    const content = readOdsContent(pkg);
    const documentPackage = spreadsheetPackage(readOds(pkg));
    const firstSheet = documentPackage.children[0];
    const firstContentSheet = content.sheets[0];
    if (firstSheet === undefined || firstContentSheet === undefined) {
      throw new Error('expected at least one sheet');
    }
    expect(firstSheet.node.kind).toBe('sheet');
    expect(firstSheet.node.name).toBe(firstContentSheet.name);
    expect(firstSheet.node.cells).toEqual(firstContentSheet.cells);
    expect(firstSheet.node.printSettings).toEqual(firstContentSheet.printSettings);
    // A sheet group's extent holds no paragraphs at all, so the minting pass has nothing to factor and never stamps a ref on one.
    expect(firstSheet.style).toBeUndefined();
  });

  it('carries a sheet\'s anchored images and embedded sub-documents as its group\'s children', () => {
    const pkg = loadFixture('sheet-anchors.ods');
    const content = readOdsContent(pkg);
    const documentPackage = spreadsheetPackage(readOds(pkg));
    const sheet = documentPackage.children[0];
    const contentSheet = content.sheets[0];
    if (sheet === undefined || contentSheet === undefined) {
      throw new Error('expected at least one sheet');
    }
    const images = contentSheet.images ?? [];
    const embedded = contentSheet.embeddedObjects ?? [];
    expect(images.length + embedded.length).toBeGreaterThan(0);
    // Images first, then embedded objects -- the fixed order flatten's own partition reverses.
    expect(sheet.children).toEqual([...images, ...embedded]);
    assertPackageRoundTrip(documentPackage, { kind: 'spreadsheet', ...content });
  });

  it('round-trips sheet-formula.ods, whose embedded Math object stays one intact leaf carrying its own formula document', () => {
    const pkg = loadFixture('sheet-formula.ods');
    const content = readOdsContent(pkg);
    assertPackageRoundTrip(readOds(pkg), { kind: 'spreadsheet', ...content });
  });

  it('assembles minimal.ods into a package that round-trips identically', () => {
    const pkg = loadFixture('minimal.ods');
    const content = readOdsContent(pkg);
    assertPackageRoundTrip(readOds(pkg), { kind: 'spreadsheet', ...content });
  });
});
