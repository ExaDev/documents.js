import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContentDocumentSchema, PAGE_SIZE_A4 } from 'document-schema.js';
import type { Package } from '../../model/package';
import { el, txt } from '../../xml/fragment';
import { decodePackage, encodePackage } from '../../codec';
import { parsePackage } from '../../package-io/read';
import { buildXlsxPackageFromContent } from './build';
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

// A chart graphic frame reached the way a real workbook reaches one: the worksheet's own <drawing r:id> names a drawing part through the worksheet's relationships, the drawing's xdr:twoCellAnchor carries an xdr:graphicFrame whose a:graphicData names the chart part through the DRAWING's relationships. The anchor geometry resolves through the sheet's own declared column widths and row heights, exactly as a spreadsheet renderer would place it.
function chartDrawingPackage(): Package {
  const revenue = el('c:ser', {}, [
    el('c:tx', {}, [el('c:strRef', {}, [el('c:f', {}, [txt('Sheet1!$B$1')]), el('c:strCache', {}, [el('c:ptCount', { val: '1' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('Revenue')])])])])]),
    el('c:cat', {}, [el('c:strRef', {}, [el('c:strCache', {}, [el('c:ptCount', { val: '2' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('Q1')])]), el('c:pt', { idx: '1' }, [el('c:v', {}, [txt('Q2')])])])])]),
    el('c:val', {}, [el('c:numRef', {}, [el('c:numCache', {}, [el('c:ptCount', { val: '2' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('8.5')])]), el('c:pt', { idx: '1' }, [el('c:v', {}, [txt('12')])])])])]),
  ]);
  const chartSpace = el('c:chartSpace', {}, [el('c:chart', {}, [el('c:plotArea', {}, [el('c:barChart', {}, [revenue])])])]);
  // CT_TwoCellAnchor's own shape: the from/to markers are the ANCHOR's children, with the anchored object (the graphic frame) between them and xdr:clientData last.
  const graphicFrame = el('xdr:graphicFrame', {}, [
    el('xdr:nvGraphicFramePr', {}, [el('xdr:cNvPr', { id: '2', name: 'Chart 1' })]),
    el('a:graphic', {}, [el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/chart' }, [el('c:chart', { 'r:id': 'rIdChart' })])]),
  ]);
  const drawing = el('xdr:wsDr', {}, [
    el('xdr:twoCellAnchor', {}, [
      el('xdr:from', {}, [el('xdr:col', {}, [txt('0')]), el('xdr:colOff', {}, [txt('19050')]), el('xdr:row', {}, [txt('1')]), el('xdr:rowOff', {}, [txt('0')])]),
      el('xdr:to', {}, [el('xdr:col', {}, [txt('2')]), el('xdr:colOff', {}, [txt('0')]), el('xdr:row', {}, [txt('4')]), el('xdr:rowOff', {}, [txt('0')])]),
      graphicFrame,
      el('xdr:clientData'),
    ]),
  ]);
  const worksheet = el('worksheet', {}, [
    el('cols', {}, [el('col', { min: '1', max: '1', width: '10' }), el('col', { min: '2', max: '2', width: '20' })]),
    el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1' }, [el('v', {}, [txt('1')])])])]),
    el('drawing', { 'r:id': 'rIdDrawing' }),
  ]);
  const relationship = (id: string, type: string, target: string) => el('Relationship', { Id: id, Type: type, Target: target });
  return {
    parts: {
      'xl/workbook.xml': { kind: 'xml', nodes: [el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Data', sheetId: '1', 'r:id': 'rIdSheet' })])])] },
      'xl/_rels/workbook.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdSheet', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml')])] },
      'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [worksheet] },
      'xl/worksheets/_rels/sheet1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdDrawing', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', '../drawings/drawing1.xml')])] },
      'xl/drawings/drawing1.xml': { kind: 'xml', nodes: [drawing] },
      'xl/drawings/_rels/drawing1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdChart', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart', '../charts/chart1.xml')])] },
      'xl/charts/chart1.xml': { kind: 'xml', nodes: [chartSpace] },
    },
  };
}

describe('readXlsxContent: chart graphic frames', () => {
  it('reads a chart graphic frame as an embedded chart object carrying the chart part\'s cached series/category model as a one-sheet spreadsheet document', () => {
    const document = readXlsxContent(chartDrawingPackage());
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets[0]?.embeddedObjects).toHaveLength(1);
    const chart = document.sheets[0]?.embeddedObjects?.[0];
    expect(chart?.objectKind).toBe('chart');
    expect(chart?.anchorColumn).toBe(0);
    expect(chart?.anchorRow).toBe(1);
    // The frame: anchored at column 0 offset 19050 EMU, row 1, spanning to the start of column 2 and row 4 -- absolute position from the sheet's left edge through the declared column widths and default row height, size the difference of the two anchors.
    const col0 = columnWidthCharsToPt(10);
    const col1 = columnWidthCharsToPt(20);
    const offsetX = (19050 / 914400) * 72;
    expect(chart?.offsetXPt).toBeCloseTo(offsetX, 5);
    expect(chart?.frame.xPt).toBeCloseTo(offsetX, 5);
    expect(chart?.frame.yPt).toBeCloseTo(15, 5);
    expect(chart?.frame.widthPt).toBeCloseTo(col0 + col1 - offsetX, 5);
    expect(chart?.frame.heightPt).toBeCloseTo(45, 5);
    // The payload is the cached model, verbatim c:v text, laid out the way the pptx chart reader spells its table: a header row of series names over a category column, one row per category.
    expect(chart?.document.kind).toBe('spreadsheet');
    const sheet = chart?.document.kind === 'spreadsheet' ? chart.document.sheets[0] : undefined;
    expect(sheet?.cells).toEqual([
      { row: 0, column: 1, value: { kind: 'string', value: 'Revenue' }, displayText: 'Revenue' },
      { row: 1, column: 0, value: { kind: 'string', value: 'Q1' }, displayText: 'Q1' },
      { row: 1, column: 1, value: { kind: 'string', value: '8.5' }, displayText: '8.5' },
      { row: 2, column: 0, value: { kind: 'string', value: 'Q2' }, displayText: 'Q2' },
      { row: 2, column: 1, value: { kind: 'string', value: '12' }, displayText: '12' },
    ]);
  });

  it('round-trips the whole document through ContentDocumentSchema, so the embedded chart object is schema-valid as read', () => {
    expect(ContentDocumentSchema.safeParse(readXlsxContent(chartDrawingPackage())).success).toBe(true);
  });

  it('does not survive the write pair: buildXlsxPackageFromContent emits no drawing part, so the read row is one-way (the established cell-comment asymmetry)', () => {
    const rewritten = readXlsxContent(decodePackage(encodePackage(buildXlsxPackageFromContent(readXlsxContent(chartDrawingPackage())))));
    if (rewritten.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(rewritten.sheets[0]?.embeddedObjects).toBeUndefined();
  });
});

// The same chart graphic frame as chartDrawingPackage carries, under a oneCellAnchor instead: both rows share the drawing walk, so the one-cell spelling extends charts exactly as it extends pictures (#776's own "both rows" note). Position from the from-marker, size from the anchor's own xdr:ext.
function oneCellChartPackage(): Package {
  const revenue = el('c:ser', {}, [
    el('c:tx', {}, [el('c:strRef', {}, [el('c:f', {}, [txt('Sheet1!$B$1')]), el('c:strCache', {}, [el('c:ptCount', { val: '1' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('Revenue')])])])])]),
    el('c:cat', {}, [el('c:strRef', {}, [el('c:strCache', {}, [el('c:ptCount', { val: '2' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('Q1')])]), el('c:pt', { idx: '1' }, [el('c:v', {}, [txt('Q2')])])])])]),
    el('c:val', {}, [el('c:numRef', {}, [el('c:numCache', {}, [el('c:ptCount', { val: '2' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('8.5')])]), el('c:pt', { idx: '1' }, [el('c:v', {}, [txt('12')])])])])]),
  ]);
  const chartSpace = el('c:chartSpace', {}, [el('c:chart', {}, [el('c:plotArea', {}, [el('c:barChart', {}, [revenue])])])]);
  const graphicFrame = el('xdr:graphicFrame', {}, [
    el('xdr:nvGraphicFramePr', {}, [el('xdr:cNvPr', { id: '2', name: 'Chart 1' })]),
    el('a:graphic', {}, [el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/chart' }, [el('c:chart', { 'r:id': 'rIdChart' })])]),
  ]);
  const drawing = el('xdr:wsDr', {}, [
    el('xdr:oneCellAnchor', {}, [
      el('xdr:from', {}, [el('xdr:col', {}, [txt('0')]), el('xdr:colOff', {}, [txt('19050')]), el('xdr:row', {}, [txt('1')]), el('xdr:rowOff', {}, [txt('0')])]),
      el('xdr:ext', { cx: '1828800', cy: '914400' }),
      graphicFrame,
      el('xdr:clientData'),
    ]),
  ]);
  const worksheet = el('worksheet', {}, [
    el('cols', {}, [el('col', { min: '1', max: '1', width: '10' }), el('col', { min: '2', max: '2', width: '20' })]),
    el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1' }, [el('v', {}, [txt('1')])])])]),
    el('drawing', { 'r:id': 'rIdDrawing' }),
  ]);
  const relationship = (id: string, type: string, target: string) => el('Relationship', { Id: id, Type: type, Target: target });
  return {
    parts: {
      'xl/workbook.xml': { kind: 'xml', nodes: [el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Data', sheetId: '1', 'r:id': 'rIdSheet' })])])] },
      'xl/_rels/workbook.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdSheet', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml')])] },
      'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [worksheet] },
      'xl/worksheets/_rels/sheet1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdDrawing', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', '../drawings/drawing1.xml')])] },
      'xl/drawings/drawing1.xml': { kind: 'xml', nodes: [drawing] },
      'xl/drawings/_rels/drawing1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdChart', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart', '../charts/chart1.xml')])] },
      'xl/charts/chart1.xml': { kind: 'xml', nodes: [chartSpace] },
    },
  };
}

describe('readXlsxContent: chart graphic frames (oneCellAnchor)', () => {
  it("reads an xdr:oneCellAnchor graphic frame with its frame sized from the anchor's own xdr:ext and its cached model intact", () => {
    const document = readXlsxContent(oneCellChartPackage());
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets[0]?.embeddedObjects).toHaveLength(1);
    const chart = document.sheets[0]?.embeddedObjects?.[0];
    expect(chart?.objectKind).toBe('chart');
    expect(chart?.anchorColumn).toBe(0);
    expect(chart?.anchorRow).toBe(1);
    // Position from the from-marker through the same grid geometry the two-cell spelling uses; size verbatim from xdr:ext (1828800 x 914400 EMU = 144 x 72 pt).
    const offsetX = (19050 / 914400) * 72;
    expect(chart?.offsetXPt).toBeCloseTo(offsetX, 5);
    expect(chart?.offsetYPt).toBe(0);
    expect(chart?.frame.xPt).toBeCloseTo(offsetX, 5);
    expect(chart?.frame.yPt).toBeCloseTo(15, 5);
    expect(chart?.frame.widthPt).toBeCloseTo(144, 5);
    expect(chart?.frame.heightPt).toBeCloseTo(72, 5);
    expect(chart?.document.kind).toBe('spreadsheet');
    const sheet = chart?.document.kind === 'spreadsheet' ? chart.document.sheets[0] : undefined;
    expect(sheet?.cells).toEqual([
      { row: 0, column: 1, value: { kind: 'string', value: 'Revenue' }, displayText: 'Revenue' },
      { row: 1, column: 0, value: { kind: 'string', value: 'Q1' }, displayText: 'Q1' },
      { row: 1, column: 1, value: { kind: 'string', value: '8.5' }, displayText: '8.5' },
      { row: 2, column: 0, value: { kind: 'string', value: 'Q2' }, displayText: 'Q2' },
      { row: 2, column: 1, value: { kind: 'string', value: '12' }, displayText: '12' },
    ]);
  });

  it('round-trips the whole document through ContentDocumentSchema, so the one-cell-anchored chart object is schema-valid as read', () => {
    expect(ContentDocumentSchema.safeParse(readXlsxContent(oneCellChartPackage())).success).toBe(true);
  });
});

// A drawing picture reached through the same cascade as the chart fixture above: the worksheet's <drawing r:id> names a drawing part, whose xdr:twoCellAnchor this time carries an xdr:pic whose a:blip names a media part through the DRAWING's relationships. Anchor fields and frame come from the from/to markers through the same grid geometry the chart row resolves against.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function pictureDrawingPackage(mediaBase64: string = TINY_PNG_BASE64): Package {
  const picture = el('xdr:pic', {}, [
    el('xdr:nvPicPr', {}, [el('xdr:cNvPr', { id: '2', name: 'Picture 1' })]),
    el('xdr:blipFill', {}, [el('a:blip', { 'r:embed': 'rIdImage' })]),
    el('xdr:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '0', y: '0' }), el('a:ext', { cx: '4781525', cy: '2765425' })]), el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')])]),
  ]);
  const drawing = el('xdr:wsDr', {}, [
    el('xdr:twoCellAnchor', {}, [
      el('xdr:from', {}, [el('xdr:col', {}, [txt('0')]), el('xdr:colOff', {}, [txt('19050')]), el('xdr:row', {}, [txt('1')]), el('xdr:rowOff', {}, [txt('0')])]),
      el('xdr:to', {}, [el('xdr:col', {}, [txt('2')]), el('xdr:colOff', {}, [txt('0')]), el('xdr:row', {}, [txt('4')]), el('xdr:rowOff', {}, [txt('0')])]),
      picture,
      el('xdr:clientData'),
    ]),
  ]);
  const worksheet = el('worksheet', {}, [
    el('cols', {}, [el('col', { min: '1', max: '1', width: '10' }), el('col', { min: '2', max: '2', width: '20' })]),
    el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1' }, [el('v', {}, [txt('1')])])])]),
    el('drawing', { 'r:id': 'rIdDrawing' }),
  ]);
  const relationship = (id: string, type: string, target: string) => el('Relationship', { Id: id, Type: type, Target: target });
  return {
    parts: {
      'xl/workbook.xml': { kind: 'xml', nodes: [el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Data', sheetId: '1', 'r:id': 'rIdSheet' })])])] },
      'xl/_rels/workbook.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdSheet', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml')])] },
      'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [worksheet] },
      'xl/worksheets/_rels/sheet1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdDrawing', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', '../drawings/drawing1.xml')])] },
      'xl/drawings/drawing1.xml': { kind: 'xml', nodes: [drawing] },
      'xl/drawings/_rels/drawing1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdImage', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', '../media/image1.png')])] },
      'xl/media/image1.png': { kind: 'binary', base64: mediaBase64 },
    },
  };
}

describe('readXlsxContent: drawing pictures', () => {
  it('reads an xdr:pic into ContentSheet.images, media bytes sniffed and anchor fields plus frame resolved from the from/to markers', () => {
    const document = readXlsxContent(pictureDrawingPackage());
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets[0]?.images).toHaveLength(1);
    const image = document.sheets[0]?.images[0];
    expect(image?.kind).toBe('image');
    // The media part's own bytes decide the format, never the part's .png name -- the same contract as the pptx picture reader.
    expect(image?.format).toBe('png');
    expect(image?.base64).toBe(TINY_PNG_BASE64);
    expect(image?.anchorColumn).toBe(0);
    expect(image?.anchorRow).toBe(1);
    // Same anchor geometry as the chart row: anchored at column 0 offset 19050 EMU, row 1, spanning to the start of column 2 and row 4, size the difference of the two anchors.
    const col0 = columnWidthCharsToPt(10);
    const col1 = columnWidthCharsToPt(20);
    const offsetX = (19050 / 914400) * 72;
    expect(image?.offsetXPt).toBeCloseTo(offsetX, 5);
    expect(image?.offsetYPt).toBe(0);
    expect(image?.widthPt).toBeCloseTo(col0 + col1 - offsetX, 5);
    expect(image?.heightPt).toBeCloseTo(45, 5);
  });

  it('leaves a picture whose media bytes do not sniff as PNG/JPEG unread rather than emitting an unsniffable image', () => {
    const document = readXlsxContent(pictureDrawingPackage('aGVsbG8gd29ybGQ='));
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets[0]?.images).toEqual([]);
  });

  it('round-trips the whole document through ContentDocumentSchema, so the sheet image is schema-valid as read', () => {
    expect(ContentDocumentSchema.safeParse(readXlsxContent(pictureDrawingPackage())).success).toBe(true);
  });

  it('does not survive the write pair: buildXlsxPackageFromContent emits no drawing part, so the read row is one-way (the established cell-comment asymmetry)', () => {
    const rewritten = readXlsxContent(decodePackage(encodePackage(buildXlsxPackageFromContent(readXlsxContent(pictureDrawingPackage())))));
    if (rewritten.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(rewritten.sheets[0]?.images).toEqual([]);
  });
});

// The oneCellAnchor spelling -- Excel's own "Move, but don't size with cells" anchoring for an inserted picture (the common real-producer spelling, per #776): a from-marker positions the frame through the grid geometry exactly as a two-cell anchor's from-marker does, and the anchor's own xdr:ext sizes it, which is the to-marker's job in the two-cell spelling.
function oneCellPicturePackage(extCx = '1828800', extCy = '914400'): Package {
  const picture = el('xdr:pic', {}, [
    el('xdr:nvPicPr', {}, [el('xdr:cNvPr', { id: '2', name: 'Picture 1' })]),
    el('xdr:blipFill', {}, [el('a:blip', { 'r:embed': 'rIdImage' })]),
    el('xdr:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '0', y: '0' }), el('a:ext', { cx: '0', cy: '0' })]), el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')])]),
  ]);
  const drawing = el('xdr:wsDr', {}, [
    el('xdr:oneCellAnchor', {}, [
      el('xdr:from', {}, [el('xdr:col', {}, [txt('0')]), el('xdr:colOff', {}, [txt('19050')]), el('xdr:row', {}, [txt('1')]), el('xdr:rowOff', {}, [txt('0')])]),
      el('xdr:ext', { cx: extCx, cy: extCy }),
      picture,
      el('xdr:clientData'),
    ]),
  ]);
  const worksheet = el('worksheet', {}, [
    el('cols', {}, [el('col', { min: '1', max: '1', width: '10' }), el('col', { min: '2', max: '2', width: '20' })]),
    el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1' }, [el('v', {}, [txt('1')])])])]),
    el('drawing', { 'r:id': 'rIdDrawing' }),
  ]);
  const relationship = (id: string, type: string, target: string) => el('Relationship', { Id: id, Type: type, Target: target });
  return {
    parts: {
      'xl/workbook.xml': { kind: 'xml', nodes: [el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Data', sheetId: '1', 'r:id': 'rIdSheet' })])])] },
      'xl/_rels/workbook.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdSheet', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml')])] },
      'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [worksheet] },
      'xl/worksheets/_rels/sheet1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdDrawing', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', '../drawings/drawing1.xml')])] },
      'xl/drawings/drawing1.xml': { kind: 'xml', nodes: [drawing] },
      'xl/drawings/_rels/drawing1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdImage', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', '../media/image1.png')])] },
      'xl/media/image1.png': { kind: 'binary', base64: TINY_PNG_BASE64 },
    },
  };
}

describe('readXlsxContent: drawing pictures (oneCellAnchor)', () => {
  it("reads an xdr:oneCellAnchor xdr:pic with its size from the anchor's own xdr:ext rather than a to-marker difference", () => {
    const document = readXlsxContent(oneCellPicturePackage());
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets[0]?.images).toHaveLength(1);
    const image = document.sheets[0]?.images[0];
    expect(image?.kind).toBe('image');
    expect(image?.format).toBe('png');
    expect(image?.base64).toBe(TINY_PNG_BASE64);
    // Position and anchor fields come from the from-marker exactly as in the two-cell spelling: column 0 offset 19050 EMU, row 1, no offset.
    expect(image?.anchorColumn).toBe(0);
    expect(image?.anchorRow).toBe(1);
    const offsetX = (19050 / 914400) * 72;
    expect(image?.offsetXPt).toBeCloseTo(offsetX, 5);
    expect(image?.offsetYPt).toBe(0);
    // The size is the anchor's own xdr:ext verbatim: 1828800 x 914400 EMU is 2 x 1 inches, 144 x 72 pt.
    expect(image?.widthPt).toBeCloseTo(144, 5);
    expect(image?.heightPt).toBeCloseTo(72, 5);
  });

  it('skips a one-cell picture whose ext size is not positive, the same degenerate-anchor guard the two-cell spelling has', () => {
    const document = readXlsxContent(oneCellPicturePackage('0', '914400'));
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets[0]?.images).toEqual([]);
  });

  it('round-trips the whole document through ContentDocumentSchema, so the one-cell-anchored sheet image is schema-valid as read', () => {
    expect(ContentDocumentSchema.safeParse(readXlsxContent(oneCellPicturePackage())).success).toBe(true);
  });

  it('does not survive the write pair: buildXlsxPackageFromContent emits no drawing part, so the read row is one-way (the established cell-comment asymmetry)', () => {
    const rewritten = readXlsxContent(decodePackage(encodePackage(buildXlsxPackageFromContent(readXlsxContent(oneCellPicturePackage())))));
    if (rewritten.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(rewritten.sheets[0]?.images).toEqual([]);
  });
});

// The absoluteAnchor spelling: xdr:pos (x/y EMU, page-absolute) plus xdr:ext sizing, no markers at all. ContentSheetImage's anchor vocabulary is cell-relative, so the landing #776 decides on is the nearest-cell re-basing -- the grid geometry's own inverse maps the absolute position onto a containing column/row plus the offset within it, exactly the fields a from-marker spells directly. The fixture grid: column 0 is 10 chars (52.5 pt), column 1 is 20 chars (105 pt), rows default 15 pt; pos 762000 x 190500 EMU is 60 x 15 pt, so column 1 offset 7.5 pt (52.5 + 7.5 = 60) and row 1 offset 0 (15 sits exactly on the row-1 boundary).
function absolutePicturePackage(extCx = '1828800', extCy = '914400'): Package {
  const picture = el('xdr:pic', {}, [
    el('xdr:nvPicPr', {}, [el('xdr:cNvPr', { id: '2', name: 'Picture 1' })]),
    el('xdr:blipFill', {}, [el('a:blip', { 'r:embed': 'rIdImage' })]),
    el('xdr:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '0', y: '0' }), el('a:ext', { cx: '0', cy: '0' })]), el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')])]),
  ]);
  const drawing = el('xdr:wsDr', {}, [
    el('xdr:absoluteAnchor', {}, [
      el('xdr:pos', { x: '762000', y: '190500' }),
      el('xdr:ext', { cx: extCx, cy: extCy }),
      picture,
      el('xdr:clientData'),
    ]),
  ]);
  const worksheet = el('worksheet', {}, [
    el('cols', {}, [el('col', { min: '1', max: '1', width: '10' }), el('col', { min: '2', max: '2', width: '20' })]),
    el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1' }, [el('v', {}, [txt('1')])])])]),
    el('drawing', { 'r:id': 'rIdDrawing' }),
  ]);
  const relationship = (id: string, type: string, target: string) => el('Relationship', { Id: id, Type: type, Target: target });
  return {
    parts: {
      'xl/workbook.xml': { kind: 'xml', nodes: [el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Data', sheetId: '1', 'r:id': 'rIdSheet' })])])] },
      'xl/_rels/workbook.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdSheet', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml')])] },
      'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [worksheet] },
      'xl/worksheets/_rels/sheet1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdDrawing', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', '../drawings/drawing1.xml')])] },
      'xl/drawings/drawing1.xml': { kind: 'xml', nodes: [drawing] },
      'xl/drawings/_rels/drawing1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdImage', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', '../media/image1.png')])] },
      'xl/media/image1.png': { kind: 'binary', base64: TINY_PNG_BASE64 },
    },
  };
}

describe('readXlsxContent: drawing pictures (absoluteAnchor)', () => {
  it("reads an xdr:absoluteAnchor xdr:pic, its page-absolute position re-based into the cell anchor vocabulary through the grid geometry's own inverse", () => {
    const document = readXlsxContent(absolutePicturePackage());
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets[0]?.images).toHaveLength(1);
    const image = document.sheets[0]?.images[0];
    expect(image?.kind).toBe('image');
    expect(image?.format).toBe('png');
    // pos 60 pt sits 7.5 pt into column 1 (52.5 pt wide column 0 first); pos 15 pt sits exactly on the row-1 boundary, the same cell a from-marker row=1 rowOff=0 names.
    expect(image?.anchorColumn).toBe(1);
    expect(image?.anchorRow).toBe(1);
    expect(image?.offsetXPt).toBeCloseTo(7.5, 5);
    expect(image?.offsetYPt).toBe(0);
    // Size verbatim from xdr:ext: 1828800 x 914400 EMU is 144 x 72 pt.
    expect(image?.widthPt).toBeCloseTo(144, 5);
    expect(image?.heightPt).toBeCloseTo(72, 5);
  });

  it('skips an absolute picture whose ext size is not positive, the same degenerate-anchor guard the marker spellings have', () => {
    const document = readXlsxContent(absolutePicturePackage('1828800', '0'));
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets[0]?.images).toEqual([]);
  });

  it('round-trips the whole document through ContentDocumentSchema, so the absolute-anchored sheet image is schema-valid as read', () => {
    expect(ContentDocumentSchema.safeParse(readXlsxContent(absolutePicturePackage())).success).toBe(true);
  });

  it('does not survive the write pair: buildXlsxPackageFromContent emits no drawing part, so the read row is one-way (the established cell-comment asymmetry)', () => {
    const rewritten = readXlsxContent(decodePackage(encodePackage(buildXlsxPackageFromContent(readXlsxContent(absolutePicturePackage())))));
    if (rewritten.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(rewritten.sheets[0]?.images).toEqual([]);
  });
});

// The same absoluteAnchor carrying a chart graphic frame: the embedded object's frame keeps the page-absolute position verbatim (60 x 15 pt) while its anchor fields carry the same re-based cell the picture row lands on.
function absoluteChartPackage(): Package {
  const revenue = el('c:ser', {}, [
    el('c:tx', {}, [el('c:strRef', {}, [el('c:f', {}, [txt('Sheet1!$B$1')]), el('c:strCache', {}, [el('c:ptCount', { val: '1' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('Revenue')])])])])]),
    el('c:cat', {}, [el('c:strRef', {}, [el('c:strCache', {}, [el('c:ptCount', { val: '2' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('Q1')])]), el('c:pt', { idx: '1' }, [el('c:v', {}, [txt('Q2')])])])])]),
    el('c:val', {}, [el('c:numRef', {}, [el('c:numCache', {}, [el('c:ptCount', { val: '2' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('8.5')])]), el('c:pt', { idx: '1' }, [el('c:v', {}, [txt('12')])])])])]),
  ]);
  const chartSpace = el('c:chartSpace', {}, [el('c:chart', {}, [el('c:plotArea', {}, [el('c:barChart', {}, [revenue])])])]);
  const graphicFrame = el('xdr:graphicFrame', {}, [
    el('xdr:nvGraphicFramePr', {}, [el('xdr:cNvPr', { id: '2', name: 'Chart 1' })]),
    el('a:graphic', {}, [el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/chart' }, [el('c:chart', { 'r:id': 'rIdChart' })])]),
  ]);
  const drawing = el('xdr:wsDr', {}, [
    el('xdr:absoluteAnchor', {}, [
      el('xdr:pos', { x: '762000', y: '190500' }),
      el('xdr:ext', { cx: '1828800', cy: '914400' }),
      graphicFrame,
      el('xdr:clientData'),
    ]),
  ]);
  const worksheet = el('worksheet', {}, [
    el('cols', {}, [el('col', { min: '1', max: '1', width: '10' }), el('col', { min: '2', max: '2', width: '20' })]),
    el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1' }, [el('v', {}, [txt('1')])])])]),
    el('drawing', { 'r:id': 'rIdDrawing' }),
  ]);
  const relationship = (id: string, type: string, target: string) => el('Relationship', { Id: id, Type: type, Target: target });
  return {
    parts: {
      'xl/workbook.xml': { kind: 'xml', nodes: [el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Data', sheetId: '1', 'r:id': 'rIdSheet' })])])] },
      'xl/_rels/workbook.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdSheet', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml')])] },
      'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [worksheet] },
      'xl/worksheets/_rels/sheet1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdDrawing', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', '../drawings/drawing1.xml')])] },
      'xl/drawings/drawing1.xml': { kind: 'xml', nodes: [drawing] },
      'xl/drawings/_rels/drawing1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdChart', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart', '../charts/chart1.xml')])] },
      'xl/charts/chart1.xml': { kind: 'xml', nodes: [chartSpace] },
    },
  };
}

describe('readXlsxContent: chart graphic frames (absoluteAnchor)', () => {
  it("reads an xdr:absoluteAnchor graphic frame, its frame at the pos verbatim and its anchor fields on the re-based cell", () => {
    const document = readXlsxContent(absoluteChartPackage());
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets[0]?.embeddedObjects).toHaveLength(1);
    const chart = document.sheets[0]?.embeddedObjects?.[0];
    expect(chart?.objectKind).toBe('chart');
    // The frame keeps the page-absolute position verbatim (762000 x 190500 EMU = 60 x 15 pt); the anchor fields name the same re-based cell the picture row lands on: column 1 offset 7.5 pt, row 1 offset 0.
    expect(chart?.frame.xPt).toBeCloseTo(60, 5);
    expect(chart?.frame.yPt).toBeCloseTo(15, 5);
    expect(chart?.frame.widthPt).toBeCloseTo(144, 5);
    expect(chart?.frame.heightPt).toBeCloseTo(72, 5);
    expect(chart?.anchorColumn).toBe(1);
    expect(chart?.anchorRow).toBe(1);
    expect(chart?.offsetXPt).toBeCloseTo(7.5, 5);
    expect(chart?.offsetYPt).toBe(0);
    expect(chart?.document.kind).toBe('spreadsheet');
  });

  it('round-trips the whole document through ContentDocumentSchema, so the absolute-anchored chart object is schema-valid as read', () => {
    expect(ContentDocumentSchema.safeParse(readXlsxContent(absoluteChartPackage())).success).toBe(true);
  });
});

// One drawing part mixing all three anchor spellings over pictures (each resolving the same media part): the rows land in the part's own document order, not grouped by spelling -- the walk iterates the drawing's children once.
function mixedAnchorsPicturePackage(): Package {
  const picture = el('xdr:pic', {}, [
    el('xdr:nvPicPr', {}, [el('xdr:cNvPr', { id: '2', name: 'Picture 1' })]),
    el('xdr:blipFill', {}, [el('a:blip', { 'r:embed': 'rIdImage' })]),
    el('xdr:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '0', y: '0' }), el('a:ext', { cx: '0', cy: '0' })]), el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')])]),
  ]);
  const drawing = el('xdr:wsDr', {}, [
    el('xdr:oneCellAnchor', {}, [
      el('xdr:from', {}, [el('xdr:col', {}, [txt('0')]), el('xdr:colOff', {}, [txt('0')]), el('xdr:row', {}, [txt('2')]), el('xdr:rowOff', {}, [txt('0')])]),
      el('xdr:ext', { cx: '1828800', cy: '914400' }),
      picture,
      el('xdr:clientData'),
    ]),
    el('xdr:absoluteAnchor', {}, [
      el('xdr:pos', { x: '762000', y: '190500' }),
      el('xdr:ext', { cx: '1828800', cy: '914400' }),
      picture,
      el('xdr:clientData'),
    ]),
    el('xdr:twoCellAnchor', {}, [
      el('xdr:from', {}, [el('xdr:col', {}, [txt('0')]), el('xdr:colOff', {}, [txt('0')]), el('xdr:row', {}, [txt('3')]), el('xdr:rowOff', {}, [txt('0')])]),
      el('xdr:to', {}, [el('xdr:col', {}, [txt('1')]), el('xdr:colOff', {}, [txt('0')]), el('xdr:row', {}, [txt('4')]), el('xdr:rowOff', {}, [txt('0')])]),
      picture,
      el('xdr:clientData'),
    ]),
  ]);
  const worksheet = el('worksheet', {}, [
    el('cols', {}, [el('col', { min: '1', max: '1', width: '10' }), el('col', { min: '2', max: '2', width: '20' })]),
    el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1' }, [el('v', {}, [txt('1')])])])]),
    el('drawing', { 'r:id': 'rIdDrawing' }),
  ]);
  const relationship = (id: string, type: string, target: string) => el('Relationship', { Id: id, Type: type, Target: target });
  return {
    parts: {
      'xl/workbook.xml': { kind: 'xml', nodes: [el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Data', sheetId: '1', 'r:id': 'rIdSheet' })])])] },
      'xl/_rels/workbook.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdSheet', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml')])] },
      'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [worksheet] },
      'xl/worksheets/_rels/sheet1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdDrawing', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', '../drawings/drawing1.xml')])] },
      'xl/drawings/drawing1.xml': { kind: 'xml', nodes: [drawing] },
      'xl/drawings/_rels/drawing1.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [relationship('rIdImage', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', '../media/image1.png')])] },
      'xl/media/image1.png': { kind: 'binary', base64: TINY_PNG_BASE64 },
    },
  };
}

describe('readXlsxContent: drawing pictures (mixed anchor spellings)', () => {
  it('lands pictures from all three spellings in the drawing part\'s own document order, not grouped by spelling', () => {
    const document = readXlsxContent(mixedAnchorsPicturePackage());
    if (document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(document.sheets[0]?.images.map((image) => image.anchorRow)).toEqual([2, 1, 3]);
    expect(document.sheets[0]?.images.map((image) => image.anchorColumn)).toEqual([0, 1, 0]);
  });
});

// The two worksheet rule families no fixture in this repo carries and no harmonised vocabulary yet names (the construct inventory's own corpus gate defers freezing their shape until a real producer file is verified against): synthesized per ECMA-376, and quarantined verbatim onto each rule's anchor cell through the residue channel -- carried, restorable by a same-format writer, never interpreted here.
function worksheetOnlyPackage(worksheet: ReturnType<typeof el>): Package {
  const workbook = el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Data', sheetId: '1', 'r:id': 'rIdSheet' })])]);
  const relsRoot = el('Relationships', {}, [el('Relationship', { Id: 'rIdSheet', Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', Target: 'worksheets/sheet1.xml' })]);
  return { parts: { 'xl/workbook.xml': { kind: 'xml', nodes: [workbook] }, 'xl/_rels/workbook.xml.rels': { kind: 'xml', nodes: [relsRoot] }, 'xl/worksheets/sheet1.xml': { kind: 'xml', nodes: [worksheet] } } };
}

describe('readXlsxContent: dataValidation and conditionalFormatting (anchor-cell residue)', () => {
  function readFirstCellOf(worksheet: ReturnType<typeof el>) {
    const read = readXlsxContent(worksheetOnlyPackage(worksheet));
    if (read.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    return read.sheets[0]?.cells ?? [];
  }

  it('quarantines a dataValidation element verbatim on its range\'s anchor cell, materialising an empty cell to host it when none exists', () => {
    const cells = readFirstCellOf(
      el('worksheet', {}, [
        el('sheetData', {}, [el('row', { r: '2' }, [el('c', { r: 'B2' }, [el('v', {}, [txt('42')])])])]),
        el('dataValidations', { count: '1' }, [
          el('dataValidation', { type: 'whole', operator: 'between', allowBlank: '1', sqref: 'B2:D4' }, [el('formula1', {}, [txt('1')]), el('formula2', {}, [txt('10')])]),
        ]),
      ]),
    );
    const anchor = cells.find((cell) => cell.row === 1 && cell.column === 1);
    expect(anchor?.source).toEqual({
      format: 'xlsx',
      xml: '<dataValidation type="whole" operator="between" allowBlank="1" sqref="B2:D4"><formula1>1</formula1><formula2>10</formula2></dataValidation>',
    });
    // The covered-but-not-anchor cells stay untouched: the sqref inside the residue names the whole range, so one copy reconstructs it.
    expect(cells.find((cell) => cell.row === 1 && cell.column === 2)?.source).toBeUndefined();
  });

  it('quarantines a conditionalFormatting element (with its cfRule children) on its own anchor cell, and materialises an empty cell for a rule over empty cells', () => {
    const cells = readFirstCellOf(
      el('worksheet', {}, [
        el('sheetData', {}, [el('row', { r: '1' }, [el('c', { r: 'A1' }, [el('v', {}, [txt('5')])])])]),
        el('conditionalFormatting', { sqref: 'A1 A5:A9' }, [el('cfRule', { type: 'cellIs', dxfId: '0', priority: '1', operator: 'greaterThan' }, [el('formula', {}, [txt('3')])])]),
      ]),
    );
    const anchor = cells.find((cell) => cell.row === 0 && cell.column === 0);
    expect(anchor?.source).toEqual({
      format: 'xlsx',
      xml: '<conditionalFormatting sqref="A1 A5:A9"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>3</formula></cfRule></conditionalFormatting>',
    });
    // A1:AB5 -- the SECOND range of the sqref anchors nowhere here; the FIRST range's top-left (A1) is the anchor, matching the merge/comment anchoring convention.
    expect(cells.find((cell) => cell.row === 4 && cell.column === 0)).toBeUndefined();
  });

  it('keeps the first rule when two anchor at the same cell -- one residue slot per cell -- and leaves a rule whose sqref does not parse unattached', () => {
    const cells = readFirstCellOf(
      el('worksheet', {}, [
        el('sheetData', {}, []),
        el('dataValidations', { count: '2' }, [
          el('dataValidation', { type: 'list', sqref: 'C3' }, [el('formula1', {}, [txt('a,b,c')])]),
          el('dataValidation', { type: 'list', sqref: 'C3:E5' }, [el('formula1', {}, [txt('x,y,z')])]),
        ]),
        el('dataValidations', { count: '1' }, [el('dataValidation', { type: 'list', sqref: 'not a ref' })]),
      ]),
    );
    const anchor = cells.find((cell) => cell.row === 2 && cell.column === 2);
    expect(anchor?.source?.xml).toContain('a,b,c');
    expect(cells.filter((cell) => cell.source !== undefined)).toHaveLength(1);
  });
});
