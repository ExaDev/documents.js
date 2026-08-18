import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContentDocumentSchema, PAGE_SIZE_A4 } from 'document-schema.js';
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

  it('produces a ContentDocument envelope directly (kind, metadata, sheets) matching the live ContentDocumentSchema', () => {
    expect(document.kind).toBe('spreadsheet');
    expect(ContentDocumentSchema.safeParse(document).success).toBe(true);
    expect('formatVersion' in document).toBe(false); // retired in document-schema.js 4.0.0 -- versioning now lives only at the serialised-artefact boundary ($schema URI), never on the in-process codec-exchange envelope
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

    it('reads a plain numeric cell (t="n") whose format is General as kind "number"', () => {
      expect(cellAt(1).value).toEqual({ kind: 'number', value: 1234.56 }); // Amount, formatted through this fixture's own redefined numFmtId 164 ("General")
      expect(cellAt(1).displayText).toBe('1234.56');
    });

    // Cross-checked against an INDEPENDENT oracle, not just against this reader's own view of the format codes: the source these fixtures were exported from, odf.js's own src/typed/ods/fixtures/kitchen-sink.ods, declares these same four cells explicitly typed -- office:value-type="date" office:date-value="2026-07-31", office:value-type="time" office:time-value="PT14H30M00S", office:value-type="percentage" office:value="0.4256", and office:value-type="currency" office:currency="GBP" office:value="99.99". Every kind, value, and the ISO 4217 code recovered below matches what the author originally entered, recovered from nothing but a style index and a numFmt string.
    it('recovers the date/time/percentage/currency kinds xlsx itself has no cell type for, from the numFmt code each cell\'s own style points at', () => {
      // Due Date: numFmtId 166, "[$-809]yyyy\\-mm\\-dd" -- a locale-only bracket (NOT currency) plus real y/m/d codes; serial 46234 in this workbook's 1900 date system (workbookPr@date1904="false").
      expect(cellAt(3).value).toEqual({ kind: 'date', value: '2026-07-31' });
      // Due Time: numFmtId 167, "[$-809]hh:mm:ss" -- the 'mm' resolves to MINUTES here (nearest preceding code is 'hh'), unlike the identical 'mm' in the date format above, where it resolves to a month.
      expect(cellAt(4).value).toEqual({ kind: 'time', value: '14:30:00' });
      // Rate: numFmtId 168, "[$-809]0.00%" -- the value stays the raw stored fraction, not the 42.56 Excel displays.
      expect(cellAt(5).value).toEqual({ kind: 'percentage', value: 0.4256 });
      // Fee: numFmtId 169, "[$GBP-809]#,##0.00" -- an ISO 4217 code between the '$' and the '-', so `currency` is populated rather than left honestly absent.
      expect(cellAt(6).value).toEqual({ kind: 'currency', value: 99.99, currency: 'GBP' });
    });

    it('leaves displayText as the plain typed-value spelling -- this reader classifies a number format, it does not render through one', () => {
      expect(cellAt(3).displayText).toBe('2026-07-31');
      expect(cellAt(4).displayText).toBe('14:30:00');
      expect(cellAt(5).displayText).toBe('0.4256'); // not "42.56%"
      expect(cellAt(6).displayText).toBe('99.99'); // not "£99.99"
    });

    it('reads a boolean cell (t="b") and derives an Excel-style TRUE/FALSE displayText -- its own numFmtId 165 ("TRUE";"TRUE";"FALSE") style never gets a say, since only numeric cells are classified', () => {
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
      expect(data.printSettings.scalePercent).toBe(150);
      expect(data.printSettings.fitToPages).toBeUndefined();
    });

    it('reads a fit-to-N-pages scale from pageSetup@fitToWidth/@fitToHeight on the Summary sheet, whose sheetPr/pageSetUpPr@fitToPage is "true"', () => {
      expect(summary.printSettings.fitToPages).toEqual({ width: 1, height: 2 });
      expect(summary.printSettings.scalePercent).toBeUndefined();
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
    expect(sheet.printSettings.scalePercent).toBe(100);
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

  it('reads the rare t="d" ISO-8601 combined date-and-time cell type verbatim, unparsed, as ContentCellValue\'s own dateTime kind', () => {
    const worksheet = el('worksheet', {}, [el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1', t: 'd' }, [el('v', {}, [txt('2026-07-31T00:00:00Z')])])])])]);
    const { cells } = readFirstCell(worksheet);
    expect(cells[0]).toMatchObject({ value: { kind: 'dateTime', value: '2026-07-31T00:00:00Z' }, displayText: '2026-07-31T00:00:00Z' });
  });
});

// The number format governs only what a NUMERIC cell holds. These build a package carrying a real xl/styles.xml so a cell's own s attribute resolves to a genuine format code, exercising the boundaries the kitchen-sink fixture has no cell for.
function buildStyledPackage(formatCode: string, cell: ReturnType<typeof el>, date1904?: string): Package {
  const workbookChildren = [
    ...(date1904 === undefined ? [] : [el('workbookPr', { date1904 })]),
    el('sheets', {}, [el('sheet', { name: 'Sheet1', 'r:id': 'rId1' })]),
  ];
  return {
    parts: {
      'xl/workbook.xml': { kind: 'xml', nodes: [el('workbook', {}, workbookChildren)] },
      'xl/_rels/workbook.xml.rels': {
        kind: 'xml',
        nodes: [
          el('Relationships', {}, [
            el('Relationship', { Id: 'rId1', Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', Target: 'worksheets/sheet1.xml' }),
          ]),
        ],
      },
      'xl/styles.xml': {
        kind: 'xml',
        nodes: [
          el('styleSheet', {}, [
            el('numFmts', {}, [el('numFmt', { numFmtId: '164', formatCode })]),
            el('cellXfs', {}, [el('xf', { numFmtId: '0' }), el('xf', { numFmtId: '164' })]),
          ]),
        ],
      },
      'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [el('worksheet', {}, [el('sheetData', {}, [el('row', { r: '1' }, [cell])])])] },
    },
  };
}

function readStyledCell(formatCode: string, cell: ReturnType<typeof el>, date1904?: string) {
  const result = readXlsxContent(buildStyledPackage(formatCode, cell, date1904));
  if (result.kind !== 'spreadsheet') {
    throw new Error('expected a spreadsheet ContentDocument');
  }
  return result.sheets[0]?.cells[0];
}

// A styled numeric cell -- s="1" points at the numFmts-declared format; s="0" at General.
function numericCell(value: string): ReturnType<typeof el> {
  return el('c', { r: 'A1', s: '1' }, [el('v', {}, [txt(value)])]);
}

describe('readXlsxContent: the number format governs numeric cells only (synthetic packages)', () => {
  it('never reclassifies a cell that already carries its own type -- a currency-formatted string, boolean, or error stays what the file says it is', () => {
    expect(readStyledCell('[$GBP-809]#,##0.00', el('c', { r: 'A1', s: '1', t: 'str' }, [el('v', {}, [txt('99.99')])]))?.value).toEqual({ kind: 'string', value: '99.99' });
    expect(readStyledCell('[$-809]yyyy-mm-dd', el('c', { r: 'A1', s: '1', t: 'b' }, [el('v', {}, [txt('1')])]))?.value).toEqual({ kind: 'boolean', value: true });
    expect(readStyledCell('0.00%', el('c', { r: 'A1', s: '1', t: 'e' }, [el('v', {}, [txt('#N/A')])]))?.value).toEqual({ kind: 'error', value: '#N/A' });
  });

  it('reads a numeric cell with no s attribute at all through cell format 0 (CT_Cell/@s\'s own schema default)', () => {
    expect(readStyledCell('0.00%', el('c', { r: 'A1' }, [el('v', {}, [txt('0.5')])]))?.value).toEqual({ kind: 'number', value: 0.5 });
  });

  it('honours the workbook\'s own 1904 date system, shifting the same serial by 1462 days', () => {
    expect(readStyledCell('yyyy-mm-dd', numericCell('46234'), 'false')?.value).toEqual({ kind: 'date', value: '2026-07-31' });
    expect(readStyledCell('yyyy-mm-dd', numericCell('46234'), 'true')?.value).toEqual({ kind: 'date', value: '2030-08-01' });
  });

  it('degrades a date-formatted serial that names no real date to the plain number it literally is', () => {
    expect(readStyledCell('yyyy-mm-dd', numericCell('60'))?.value).toEqual({ kind: 'number', value: 60 });
    expect(readStyledCell('yyyy-mm-dd', numericCell('-5'))?.value).toEqual({ kind: 'number', value: -5 });
  });

  it('keeps an elapsed-time cell as a raw number -- ContentCellValue has no duration kind, and [h]:mm:ss may exceed 24 hours', () => {
    expect(readStyledCell('[h]:mm:ss', numericCell('2.5'))?.value).toEqual({ kind: 'number', value: 2.5 });
  });

  it('omits `currency` entirely when the format identifies money by symbol rather than by ISO code', () => {
    expect(readStyledCell('[$£-809]#,##0.00', numericCell('99.99'))?.value).toEqual({ kind: 'currency', value: 99.99 });
    expect(readStyledCell('[$USD-409]#,##0.00', numericCell('99.99'))?.value).toEqual({ kind: 'currency', value: 99.99, currency: 'USD' });
  });

  it('reads a combined date-and-time format as the dateTime kind, not as a date that silently drops its time', () => {
    expect(readStyledCell('yyyy-mm-dd hh:mm:ss', numericCell('46234.604166666666667'))?.value).toEqual({ kind: 'dateTime', value: '2026-07-31T14:30:00' });
  });
});

// Cell decoration (background/borders/alignment/verticalAlignment) resolves through the same cellXfs index the number format does. These build a package with a real xl/styles.xml carrying fills, borders, and inline <alignment> so a cell's own s attribute resolves to a genuinely decorated xf -- the boundaries the kitchen-sink fixture (all default styling) has no cell for.
function buildDecoratedPackage(styleSheet: ReturnType<typeof el>, cell: ReturnType<typeof el>): Package {
  return {
    parts: {
      'xl/workbook.xml': { kind: 'xml', nodes: [el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Sheet1', 'r:id': 'rId1' })])])] },
      'xl/_rels/workbook.xml.rels': {
        kind: 'xml',
        nodes: [
          el('Relationships', {}, [
            el('Relationship', { Id: 'rId1', Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', Target: 'worksheets/sheet1.xml' }),
          ]),
        ],
      },
      'xl/styles.xml': { kind: 'xml', nodes: [styleSheet] },
      'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [el('worksheet', {}, [el('sheetData', {}, [el('row', { r: '1' }, [cell])])])] },
    },
  };
}

function readDecoratedCell(styleSheet: ReturnType<typeof el>, cell: ReturnType<typeof el>) {
  const result = readXlsxContent(buildDecoratedPackage(styleSheet, cell));
  if (result.kind !== 'spreadsheet') {
    throw new Error('expected a spreadsheet ContentDocument');
  }
  return result.sheets[0]?.cells[0];
}

describe('readXlsxContent: cell decoration (background/borders/alignment/verticalAlignment)', () => {
  // A styleSheet whose cellXfs entry at index 1 carries a solid red fill (fgColor rgb), a thin solid left edge + a dashed blue right edge, a centred horizontal alignment, and a centred vertical alignment. Index 0 is the default General/no-decoration entry.
  const styledSheet = el('styleSheet', {}, [
    el('fills', {}, [
      el('fill', {}, [el('patternFill', { patternType: 'none' })]),
      el('fill', {}, [el('patternFill', { patternType: 'gray125' })]),
      el('fill', {}, [el('patternFill', { patternType: 'solid' }, [el('fgColor', { rgb: 'FFFF0000' }), el('bgColor', { indexed: '64' })])]),
    ]),
    el('borders', {}, [
      el('border', {}, [el('left'), el('right'), el('top'), el('bottom'), el('diagonal')]),
      el('border', {}, [
        el('left', { style: 'thin' }, [el('color', { rgb: 'FF000000' })]),
        el('right', { style: 'dashed' }, [el('color', { rgb: 'FF0000FF' })]),
        el('top'),
        el('bottom'),
        el('diagonal'),
      ]),
    ]),
    el('cellXfs', {}, [
      el('xf', { numFmtId: '0' }),
      el('xf', { numFmtId: '0', fillId: '2', borderId: '1', applyFill: '1', applyBorder: '1', applyAlignment: '1' }, [el('alignment', { horizontal: 'center', vertical: 'center' })]),
    ]),
  ]);

  it('reads a solid fill background from the solid pattern\'s fgColor rgb', () => {
    const cell = readDecoratedCell(styledSheet, el('c', { r: 'A1', s: '1' }, [el('v', {}, [txt('42')])]));
    expect(cell?.background).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('reads each present border edge with its derived widthPt and style, and omits absent edges', () => {
    const cell = readDecoratedCell(styledSheet, el('c', { r: 'A1', s: '1' }, [el('v', {}, [txt('42')])]));
    expect(cell?.borders).toEqual({
      left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 },
      right: { color: { r: 0, g: 0, b: 1 }, widthPt: 0.75, style: 'dashed' },
    });
  });

  it('reads horizontal and vertical alignment, mapping vertical "center" to the schema\'s "middle"', () => {
    const cell = readDecoratedCell(styledSheet, el('c', { r: 'A1', s: '1' }, [el('v', {}, [txt('42')])]));
    expect(cell?.alignment).toBe('center');
    expect(cell?.verticalAlignment).toBe('middle');
  });

  it('leaves all four decoration fields unset on a cell whose s index carries none of them', () => {
    const cell = readDecoratedCell(styledSheet, el('c', { r: 'A1', s: '0' }, [el('v', {}, [txt('42')])]));
    expect(cell?.background).toBeUndefined();
    expect(cell?.borders).toBeUndefined();
    expect(cell?.alignment).toBeUndefined();
    expect(cell?.verticalAlignment).toBeUndefined();
  });

  it('leaves horizontal="general" unread -- general means "use the value-kind default", the same semantics as an absent alignment', () => {
    const generalSheet = el('styleSheet', {}, [
      el('cellXfs', {}, [el('xf', { numFmtId: '0' }, [el('alignment', { horizontal: 'general', vertical: 'bottom' })])]),
    ]);
    const cell = readDecoratedCell(generalSheet, el('c', { r: 'A1' }, [el('v', {}, [txt('42')])]));
    expect(cell?.alignment).toBeUndefined();
    expect(cell?.verticalAlignment).toBeUndefined();
  });

  it('reads vertical="top" but leaves vertical="bottom" unread (the documented default)', () => {
    const topSheet = el('styleSheet', {}, [el('cellXfs', {}, [el('xf', { numFmtId: '0' }, [el('alignment', { vertical: 'top' })])])]);
    expect(readDecoratedCell(topSheet, el('c', { r: 'A1' }, [el('v', {}, [txt('1')])]))?.verticalAlignment).toBe('top');
  });

  it('leaves a theme/indexed-only fill colour unread rather than substituting a fixed colour', () => {
    const themeSheet = el('styleSheet', {}, [
      el('fills', {}, [
        el('fill', {}, [el('patternFill', { patternType: 'none' })]),
        el('fill', {}, [el('patternFill', { patternType: 'solid' }, [el('fgColor', { theme: '0' })])]),
      ]),
      el('cellXfs', {}, [el('xf', { numFmtId: '0' }), el('xf', { numFmtId: '0', fillId: '1' })]),
    ]);
    expect(readDecoratedCell(themeSheet, el('c', { r: 'A1', s: '1' }, [el('v', {}, [txt('1')])]))?.background).toBeUndefined();
  });
});
