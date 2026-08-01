import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import type { Package } from '../../model/package';
import { el, txt } from '../../xml/fragment';
import { parsePackage } from '../../package-io/read';
import { columnWidthCharsToPt } from './units';
import { readXlsxContent } from './content';

// This suite reads real, unmodified LibreOffice-generated .xlsx fixtures (src/typed/xlsx/fixtures/*.xlsx). Both fixtures are genuine LibreOffice xlsx-exports (`soffice --headless --convert-to xlsx`) of odf.js's own src/typed/ods/fixtures/{kitchen-sink,minimal}.ods -- the same feature set that package's own readOds test suite already validates against ODF's equivalent mechanisms, run back through LibreOffice's real SpreadsheetML export filter so this suite exercises genuine, LibreOffice-authored xlsx markup (column-width character units, row heights, hidden rows/columns, every value-type LibreOffice's own xlsx exporter distinguishes, a real merged range, a real cross-sheet formula, and real print settings including Print_Area/Print_Titles defined names) rather than a hand-built approximation of what that markup might look like. A handful of narrow scope-boundary/error-path tests at the end use small, synthetic, hand-built packages instead (via el/txt), mirroring readOds's own established convention for the identical reason.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

describe('readXlsxContent: kitchen-sink.xlsx (real LibreOffice output)', () => {
  const document = readXlsxContent(loadFixture('kitchen-sink.xlsx'));
  if (document.kind !== 'spreadsheet') {
    throw new Error('expected a spreadsheet ContentDocument');
  }
  const { sheets } = document;
  const data = sheets.find((sheet) => sheet.name === 'Data');
  const summary = sheets.find((sheet) => sheet.name === 'Summary');
  if (data === undefined || summary === undefined) {
    throw new Error('expected both a Data and a Summary sheet');
  }

  it('reads both sheets in real workbook.xml <sheets> order, not filename order', () => {
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Data', 'Summary']);
  });

  it('produces a ContentDocument envelope directly (kind, formatVersion, metadata, sheets)', () => {
    expect(document.kind).toBe('spreadsheet');
    expect(document.formatVersion).toBe(1);
  });

  it('reads document metadata via docProps/core.xml -- this fixture never had a title set', () => {
    expect(document.metadata.title).toBeUndefined();
  });

  describe('column widths (real <col width> character units) and hidden columns', () => {
    it('converts the stored character-unit width to points via the documented MDW=7 pixel formula', () => {
      const widths = data.columns.map((column) => column.widthPt);
      expect(widths[0]).toBeCloseTo(columnWidthCharsToPt(15.32), 5);
      expect(widths[1]).toBeCloseTo(columnWidthCharsToPt(12.76), 5);
      expect(widths[2]).toBeCloseTo(columnWidthCharsToPt(10.21), 5);
    });

    it('marks column G (index 6, the Fee column) hidden via <col hidden="true">', () => {
      const hiddenColumn = data.columns.find((column) => column.index === 6);
      expect(hiddenColumn?.hidden).toBe(true);
      expect(data.columns.filter((column) => column.hidden === true)).toHaveLength(1);
    });

    it('does not mark visible columns hidden at all (omitted, not false)', () => {
      const visibleColumn = data.columns.find((column) => column.index === 0);
      expect(visibleColumn?.hidden).toBeUndefined();
    });

    it('reads one ContentSheetColumn per real <col> element (each min=max in this fixture)', () => {
      expect(data.columns).toHaveLength(9);
      expect(data.columns.map((column) => column.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });
  });

  describe('row heights (ht is already in points, no conversion) and hidden rows', () => {
    it('reads the header row and first data row\'s own explicit heights verbatim', () => {
      const headerRow = data.rows.find((row) => row.index === 0);
      const firstDataRow = data.rows.find((row) => row.index === 1);
      expect(headerRow?.heightPt).toBe(25.5);
      expect(firstDataRow?.heightPt).toBe(17);
    });

    it('marks row 10 (index 9, "Hidden Row Content") hidden via <row hidden="true">, while its own real content still reads', () => {
      const hiddenRow = data.rows.find((row) => row.index === 9);
      expect(hiddenRow?.hidden).toBe(true);
      const hiddenCell = data.cells.find((cell) => cell.row === 9 && cell.column === 0);
      expect(hiddenCell?.displayText).toBe('Hidden Row Content');
    });

    it('reads one ContentSheetRow per real <row> element -- no repeat-compression mechanism to guard against, unlike ODF', () => {
      expect(data.rows.map((row) => row.index)).toEqual([0, 1, 2, 5, 6, 9]);
    });
  });

  describe('every cell-type xlsx itself distinguishes, on row 2 (index 1)', () => {
    const cellAt = (column: number) => {
      const cell = data.cells.find((candidate) => candidate.row === 1 && candidate.column === column);
      if (cell === undefined) {
        throw new Error(`expected a cell at row 1, column ${column}`);
      }
      return cell;
    };

    it('reads a shared-string cell (t="s")', () => {
      expect(cellAt(0).value).toEqual({ kind: 'string', value: 'Acme Corp' });
      expect(cellAt(0).displayText).toBe('Acme Corp');
    });

    it('reads a plain numeric cell (t="n") -- including one carrying a date/time/percentage/currency NUMBER FORMAT STYLE, since xlsx has no distinct value-type for those (see this module\'s own scope note): all four still read as kind "number", not date/time/percentage/currency', () => {
      expect(cellAt(1).value).toEqual({ kind: 'number', value: 1234.56 }); // Amount
      expect(cellAt(3).value).toEqual({ kind: 'number', value: 46234 }); // Due Date, a date-formatted serial number
      expect(cellAt(4).value).toEqual({ kind: 'number', value: 0.604166666666667 }); // Due Time, a time-formatted fraction of a day
      expect(cellAt(5).value).toEqual({ kind: 'number', value: 0.4256 }); // Rate, a percentage-formatted fraction
      expect(cellAt(6).value).toEqual({ kind: 'number', value: 99.99 }); // Fee, a currency-formatted number
    });

    it('reads a boolean cell (t="b") and derives an Excel-style TRUE/FALSE displayText', () => {
      expect(cellAt(2).value).toEqual({ kind: 'boolean', value: true });
      expect(cellAt(2).displayText).toBe('TRUE');
    });

    it('carries a real formula string verbatim, alongside its own cached numeric result', () => {
      const formulaCell = cellAt(7);
      expect(formulaCell.formula).toBe('SUM(B2:B3)');
      expect(formulaCell.value).toEqual({ kind: 'number', value: 1276.56 });
    });

    it('reads a genuine formula-error cell (=1/0) as kind "error", carrying the real #DIV/0! text as both value and displayText', () => {
      const errorCell = cellAt(8);
      expect(errorCell.formula).toBe('1/0');
      expect(errorCell.value).toEqual({ kind: 'error', value: '#DIV/0!' });
      expect(errorCell.displayText).toBe('#DIV/0!');
    });
  });

  describe('merged range (<mergeCells><mergeCell ref="A6:B7"/></mergeCells>)', () => {
    it('reads the anchor cell with its own colSpan/rowSpan and text', () => {
      const anchor = data.cells.find((cell) => cell.row === 5 && cell.column === 0);
      expect(anchor).toMatchObject({ colSpan: 2, rowSpan: 2, displayText: 'Merged Cell' });
    });

    it('emits nothing at all for the covered positions (B6, A7, B7) -- xlsx writes a bare, valueless <c> for each, and readCell\'s own "no v/is/f -> skip" rule already drops them', () => {
      expect(data.cells.find((cell) => cell.row === 5 && cell.column === 1)).toBeUndefined();
      expect(data.cells.find((cell) => cell.row === 6 && cell.column === 0)).toBeUndefined();
      expect(data.cells.find((cell) => cell.row === 6 && cell.column === 1)).toBeUndefined();
    });
  });

  describe('cross-sheet formula', () => {
    it('carries a real cross-sheet formula reference verbatim and its own cached result', () => {
      const totalCell = summary.cells.find((cell) => cell.row === 1 && cell.column === 1);
      expect(totalCell?.formula).toBe('SUM(Data!B2:B3)');
      expect(totalCell?.value).toEqual({ kind: 'number', value: 1276.56 });
    });
  });

  describe('print settings (real <pageSetup>/<printOptions>/<pageMargins>, and sheet-scoped _xlnm.Print_Area/_xlnm.Print_Titles)', () => {
    it("resolves the Data sheet's own A4 page size (paperSize=\"9\") and inch-based margins converted to points", () => {
      expect(data.printSettings.pageSize).toEqual(PAGE_SIZE_A4);
      expect(data.printSettings.margins.leftPt).toBeCloseTo(0.590277777777778 * 72, 6);
      expect(data.printSettings.margins.topPt).toBeCloseTo(0.570833333333333 * 72, 6);
    });

    it('parses _xlnm.Print_Area ("Data!$A$1:$I$20") into 0-based row/column bounds', () => {
      expect(data.printSettings.printRange).toEqual({ startRow: 0, startColumn: 0, endRow: 19, endColumn: 8 });
    });

    it('reads a percentage scale from pageSetup@scale="150" when sheetPr/pageSetUpPr@fitToPage is "false"', () => {
      expect(data.printSettings.scale).toBe(150);
      expect(data.printSettings.fitToPages).toBeUndefined();
    });

    it('reads a fit-to-N-pages scale from pageSetup@fitToWidth/@fitToHeight on the Summary sheet, whose sheetPr/pageSetUpPr@fitToPage is "true"', () => {
      expect(summary.printSettings.fitToPages).toEqual({ width: 1, height: 2 });
      expect(summary.printSettings.scale).toBeUndefined();
    });

    it('parses _xlnm.Print_Titles ("Data!$A:$A,Data!$1:$1") into repeatColumns/repeatRows', () => {
      expect(data.printSettings.repeatRows).toEqual({ start: 0, end: 0 });
      expect(data.printSettings.repeatColumns).toEqual({ start: 0, end: 0 });
    });

    it('reads gridlines/headers from printOptions@gridLines/@headings', () => {
      expect(data.printSettings.gridlines).toBe(true);
      expect(data.printSettings.headers).toBe(true);
      expect(summary.printSettings.gridlines).toBe(false);
      expect(summary.printSettings.headers).toBe(false);
    });

    it('reads page order from pageSetup@pageOrder', () => {
      expect(data.printSettings.pageOrder).toBe('overThenDown');
      expect(summary.printSettings.pageOrder).toBe('downThenOver');
    });

    it('reads manual page breaks from rowBreaks/colBreaks <brk id="..."> at the break\'s own real 0-based index', () => {
      expect(data.printSettings.manualBreaks).toEqual({ rows: [15], columns: [3] });
      expect(summary.printSettings.manualBreaks).toBeUndefined();
    });

    it('the Summary sheet has no _xlnm.Print_Area/_xlnm.Print_Titles of its own', () => {
      expect(summary.printSettings.printRange).toBeUndefined();
      expect(summary.printSettings.repeatRows).toBeUndefined();
      expect(summary.printSettings.repeatColumns).toBeUndefined();
    });
  });
});

describe('readXlsxContent: minimal.xlsx (real LibreOffice output, default/unmodified sheet)', () => {
  const document = readXlsxContent(loadFixture('minimal.xlsx'));
  if (document.kind !== 'spreadsheet') {
    throw new Error('expected a spreadsheet ContentDocument');
  }
  const sheet = document.sheets[0];
  if (sheet === undefined) {
    throw new Error('expected at least one sheet');
  }

  it('reads the single default sheet', () => {
    expect(document.sheets).toHaveLength(1);
    expect(sheet.name).toBe('Sheet1');
  });

  it("emits nothing for the sheet's own single, genuinely empty cell -- and no <cols>/<row> elements at all", () => {
    expect(sheet.cells).toEqual([]);
    expect(sheet.columns).toEqual([]);
    expect(sheet.rows).toEqual([]);
  });

  it('reads real default print settings: A4, default margins, gridlines/headers off, down-then-over page order, an explicit (default-valued) scale', () => {
    expect(sheet.printSettings.pageSize).toEqual(PAGE_SIZE_A4);
    expect(sheet.printSettings.gridlines).toBe(false);
    expect(sheet.printSettings.headers).toBe(false);
    expect(sheet.printSettings.pageOrder).toBe('downThenOver');
    expect(sheet.printSettings.scale).toBe(100);
    expect(sheet.printSettings.fitToPages).toBeUndefined();
    expect(sheet.printSettings.printRange).toBeUndefined();
    expect(sheet.printSettings.repeatRows).toBeUndefined();
    expect(sheet.printSettings.repeatColumns).toBeUndefined();
    expect(sheet.printSettings.manualBreaks).toBeUndefined();
  });

  it('has no xl/sharedStrings.xml part at all (no string cells) -- readXlsxContent tolerates its absence', () => {
    const pkg = loadFixture('minimal.xlsx');
    expect(pkg.parts['xl/sharedStrings.xml']).toBeUndefined();
  });
});

// A minimal single-sheet package wrapping a hand-built <worksheet> element -- shared by every synthetic test below, since each one only cares about a single cell's own markup.
function buildMinimalPackage(worksheet: ReturnType<typeof el>): Package {
  return {
    parts: {
      'xl/workbook.xml': {
        kind: 'xml',
        nodes: [el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Sheet1', 'r:id': 'rId1' })])])],
      },
      'xl/_rels/workbook.xml.rels': {
        kind: 'xml',
        nodes: [
          el('Relationships', {}, [
            el('Relationship', { Id: 'rId1', Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', Target: 'worksheets/sheet1.xml' }),
          ]),
        ],
      },
      'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [worksheet] },
    },
  };
}

function readFirstCell(worksheet: ReturnType<typeof el>) {
  const result = readXlsxContent(buildMinimalPackage(worksheet));
  if (result.kind !== 'spreadsheet') {
    throw new Error('expected a spreadsheet ContentDocument');
  }
  return { cells: result.sheets[0]?.cells ?? [], result };
}

describe('readXlsxContent: scope boundaries and error/fallback paths (synthetic packages)', () => {
  it('reads an empty sheets array for a package with no xl/workbook.xml at all', () => {
    const result = readXlsxContent({ parts: {} });
    expect(result.kind).toBe('spreadsheet');
    if (result.kind === 'spreadsheet') {
      expect(result.sheets).toEqual([]);
    }
  });

  it('carries a formula cell that has an <f> but no cached <v> as kind "empty" with an empty displayText, rather than dropping it', () => {
    const worksheet = el('worksheet', {}, [el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1' }, [el('f', {}, [txt('1+1')])])])])]);
    const { cells } = readFirstCell(worksheet);
    expect(cells).toEqual([{ row: 0, column: 0, value: { kind: 'empty' }, formula: '1+1', displayText: '' }]);
  });

  it('reads an inline string cell (t="inlineStr") by concatenating its own <is> runs', () => {
    const worksheet = el('worksheet', {}, [
      el('sheetData', {}, [
        el('row', { r: '1' }, [
          el('c', { r: 'A1', t: 'inlineStr' }, [el('is', {}, [el('r', {}, [el('t', {}, [txt('Hello ')])]), el('r', {}, [el('t', {}, [txt('World')])])])]),
        ]),
      ]),
    ]);
    const { cells } = readFirstCell(worksheet);
    expect(cells[0]).toMatchObject({ value: { kind: 'string', value: 'Hello World' }, displayText: 'Hello World' });
  });

  it('reads a formula cell whose cached result is a string (t="str") as kind "string", literally, not shared-string-indexed', () => {
    const worksheet = el('worksheet', {}, [
      el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1', t: 'str' }, [el('f', {}, [txt('CONCATENATE("a","b")')]), el('v', {}, [txt('ab')])])])]),
    ]);
    const { cells } = readFirstCell(worksheet);
    expect(cells[0]).toMatchObject({ formula: 'CONCATENATE("a","b")', value: { kind: 'string', value: 'ab' }, displayText: 'ab' });
  });

  it('reads the rare t="d" ISO-8601 date cell type verbatim, unparsed', () => {
    const worksheet = el('worksheet', {}, [el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1', t: 'd' }, [el('v', {}, [txt('2026-07-31T00:00:00Z')])])])])]);
    const { cells } = readFirstCell(worksheet);
    expect(cells[0]).toMatchObject({ value: { kind: 'date', value: '2026-07-31T00:00:00Z' }, displayText: '2026-07-31T00:00:00Z' });
  });
});
