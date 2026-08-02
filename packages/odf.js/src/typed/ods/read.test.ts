import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { parsePackage } from '../../package-io/read';
import { parseOdfLength } from '../shared/units';
import { readOds } from './read';

// This suite reads real, unmodified LibreOffice 26.2-generated .ods fixtures (src/typed/ods/fixtures/*.ods, built via a headless UNO Basic macro driving the SAME UNO calls the Calc UI itself uses -- Format > Columns > Width, Format > Rows > Height, Format > Print Areas, Format > Page Style's Sheet tab -- never hand-edited afterwards) rather than programmatically reconstructing the expected XML shapes, mirroring readOdt's own established convention: this reader's own design brief is explicit that print-settings attribute names and the repeat-row/repeat-column mechanism must each be proven against genuine producer output, not just this package's own idea of what that output looks like. A handful of narrow scope-boundary/hazard-proof tests at the end use small, synthetic, hand-built packages instead (via el/txt), since a genuinely million-row repeat isn't something worth shipping as a binary fixture when the exact real repeat count is already established (typed/shared/a1.test.ts, citing a real LibreOffice-shipped .ots template).

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

describe('readOds: kitchen-sink.ods (real LibreOffice output)', () => {
  const { metadata, sheets } = readOds(loadFixture('kitchen-sink.ods'));
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

describe('readOds: minimal.ods (real LibreOffice output, default/unmodified sheet)', () => {
  const { sheets } = readOds(loadFixture('minimal.ods'));
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

describe('readOds: repeat-count hazards (synthetic packages -- proving this reader never materializes a huge repeated run, real confirmed counts from typed/shared/a1.test.ts)', () => {
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
    const { sheets } = readOds(buildHugeRepeatPackage());
    expect(sheets[0]?.cells).toHaveLength(1);
    expect(sheets[0]?.cells[0]).toMatchObject({ row: 0, column: 0, value: { kind: 'string', value: 'Header' }, displayText: 'Header' });
  });

  it('does not allocate one ContentSheetRow per repeated row: only the two real table:table-row XML elements are represented', () => {
    const { sheets } = readOds(buildHugeRepeatPackage());
    expect(sheets[0]?.rows).toHaveLength(2);
    expect(sheets[0]?.rows[1]?.index).toBe(1); // the huge repeat block's own STARTING row index, not a materialized count.
  });

  it('does not allocate one ContentSheetColumn per repeated column: a 1024-column repeat block yields exactly one column entry', () => {
    const { sheets } = readOds(buildHugeRepeatPackage());
    expect(sheets[0]?.columns).toHaveLength(1);
    expect(sheets[0]?.columns[0]?.index).toBe(0);
  });

  it('completes in well under a second, confirming no O(repeatCount) work happened at all', () => {
    const start = performance.now();
    readOds(buildHugeRepeatPackage());
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('readOds: error and fallback paths (synthetic packages -- not something real LibreOffice output can exercise)', () => {
  it('reads an empty sheets array for a package with no content.xml at all', () => {
    const result = readOds({ parts: {} });
    expect(result.sheets).toEqual([]);
    expect(result.metadata).toEqual({});
  });

  it('reads an empty sheets array for a package with no office:spreadsheet at all', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body')])] } } };
    expect(readOds(pkg).sheets).toEqual([]);
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
    expect(readOds(pkg).sheets).toEqual([]);
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
    const { sheets } = readOds(pkg);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ name: 'Empty', cells: [], columns: [], rows: [] });
  });
});

describe('readOds: cell background/borders/alignment/verticalAlignment (synthetic packages -- the real cascade, including a genuine style:parent-style-name chain matching kitchen-sink.ods\'s own real ce1..ce5 -> "Default" -> table-cell family default-style shape)', () => {
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

  it('resolves fo:background-color from the cell\'s own table:style-name -> table-cell family style', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'fo:background-color': '#ff0000' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('red', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOds(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.background).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('expands the fo:border shorthand onto all four edges', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'fo:border': '0.5pt solid #0000ff' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('bordered', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOds(sheetPackage([ce1], table));
    const expectedEdge = { color: { r: 0, g: 0, b: 1 }, widthPt: 0.5, style: 'solid' };
    expect(sheets[0]?.cells[0]?.borders).toEqual({ left: expectedEdge, right: expectedEdge, top: expectedEdge, bottom: expectedEdge });
  });

  it('lets a per-edge fo:border-top override just that one edge', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'fo:border': '1pt solid #000000', 'fo:border-top': '2pt dotted #ffff00' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('bordered', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOds(sheetPackage([ce1], table));
    const borders = sheets[0]?.cells[0]?.borders;
    expect(borders?.top).toEqual({ color: { r: 1, g: 1, b: 0 }, widthPt: 2, style: 'dotted' });
    expect(borders?.bottom).toEqual({ color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'solid' });
  });

  it('treats an explicit "none" border-style override as genuinely clearing an inherited edge, not merely leaving it unmentioned', () => {
    const parent = tableCellStyle('Parent', { cellProperties: { 'fo:border': '1pt solid #000000' } });
    const child = tableCellStyle('ce1', { cellProperties: { 'fo:border-bottom': '1pt none #000000' }, parentStyleName: 'Parent' });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('partial', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOds(sheetPackage([parent, child], table));
    const borders = sheets[0]?.cells[0]?.borders;
    expect(borders?.bottom).toBeUndefined();
    expect(borders?.top).toEqual({ color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'solid' });
  });

  it('reads style:vertical-align from the cell\'s own table-cell-properties', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'style:vertical-align': 'middle' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('centred', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOds(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.verticalAlignment).toBe('middle');
  });

  it('leaves verticalAlignment undefined for style:vertical-align="automatic" (no matching enum member), rather than guessing', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'style:vertical-align': 'automatic' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('auto', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOds(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.verticalAlignment).toBeUndefined();
  });

  it('reads fo:text-align from the cell style\'s own style:paragraph-properties as an alignment override', () => {
    const ce1 = tableCellStyle('ce1', { paragraphProperties: { 'fo:text-align': 'center' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('centred', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOds(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.alignment).toBe('center');
  });

  it('leaves alignment undefined for a cell whose style sets no fo:text-align at all -- the value-kind default stays in effect elsewhere, this reader never fabricates one', () => {
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'fo:background-color': '#ff0000' } });
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('red', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOds(sheetPackage([ce1], table));
    expect(sheets[0]?.cells[0]?.alignment).toBeUndefined();
  });

  it('resolves background through the FULL resolveStyleElementChain cascade -- a family default-style contributes a background the cell\'s own specific style never overrides', () => {
    const defaultStyle = tableCellDefaultStyle({ cellProperties: { 'fo:background-color': '#00ff00' } });
    const ce1 = tableCellStyle('ce1', { cellProperties: { 'style:vertical-align': 'top' } }); // no background of its own
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('inherited', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOds(sheetPackage([defaultStyle, ce1], table));
    expect(sheets[0]?.cells[0]?.background).toEqual({ r: 0, g: 1, b: 0 });
    expect(sheets[0]?.cells[0]?.verticalAlignment).toBe('top');
  });

  it('lets a style:parent-style-name chain contribute a background that the cell\'s own specific style then overrides -- later (more specific) always wins, matching kitchen-sink.ods\'s own real ce1..ce5 -> "Default" chain shape', () => {
    const parent = tableCellStyle('Parent', { cellProperties: { 'fo:background-color': '#ff0000' } });
    const ce1 = el('style:style', { 'style:name': 'ce1', 'style:family': 'table-cell', 'style:parent-style-name': 'Parent' }, [
      el('style:table-cell-properties', { 'fo:background-color': '#0000ff' }),
    ]);
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('overridden', { 'table:style-name': 'ce1' })])]);
    const { sheets } = readOds(sheetPackage([parent, ce1], table));
    expect(sheets[0]?.cells[0]?.background).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('leaves background/borders/alignment/verticalAlignment all undefined for a cell with no table:style-name at all', () => {
    const table = el('table:table', { 'table:name': 'Sheet1' }, [el('table:table-row', {}, [stringCell('plain')])]);
    const { sheets } = readOds(sheetPackage([], table));
    const cell = sheets[0]?.cells[0];
    expect(cell?.background).toBeUndefined();
    expect(cell?.borders).toBeUndefined();
    expect(cell?.alignment).toBeUndefined();
    expect(cell?.verticalAlignment).toBeUndefined();
  });
});
