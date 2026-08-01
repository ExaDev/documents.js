import { describe, expect, it } from 'vitest';
import type { ContentDocument, ContentSheet } from 'document-content-model';
import { CONTENT_FORMAT_VERSION, PAGE_SIZE_A4, PAGE_SIZE_LETTER } from 'document-content-model';
import { encodePackage } from '../../codec';
import { parsePackage } from '../../package-io/read';
import { rootElement } from '../util';
import { buildXlsxPackage } from './build';
import { readXlsxContent } from './content';

// buildXlsxPackage's own real-LibreOffice validation (`soffice --headless --convert-to ods` against a genuine built .xlsx, confirming Excel/LibreOffice actually open the file rather than merely well-formed XML) is a manual verification step, deliberately NOT wired into this vitest suite -- this package's CI runners have no LibreOffice installed (unlike documents.js's own gitignored, opt-in test:corpus project, which exists for exactly this reason: real-third-party-software checks that need a local tool this repo's CI can't assume). This suite instead verifies everything checkable in-process: the produced Package's own XML structure (parsed back through this package's own lossless parsePackage/encodePackage, never assumed), and that readXlsxContent(buildXlsxPackage(x)) round-trips the real content.

const KITCHEN_SINK_SHEET: ContentSheet = {
  name: 'Data',
  cells: [
    { row: 0, column: 0, value: { kind: 'string', value: 'Name' }, displayText: 'Name' },
    { row: 0, column: 1, value: { kind: 'string', value: 'Amount' }, displayText: 'Amount' },
    { row: 1, column: 0, value: { kind: 'string', value: 'Acme Corp' }, displayText: 'Acme Corp' },
    { row: 1, column: 1, value: { kind: 'number', value: 1234.56 }, displayText: '1234.56' },
    { row: 2, column: 0, value: { kind: 'boolean', value: true }, displayText: 'TRUE' },
    { row: 3, column: 0, value: { kind: 'number', value: 3 }, formula: 'SUM(B2:B3)', displayText: '3' },
    { row: 4, column: 0, value: { kind: 'error', value: '#DIV/0!' }, formula: '1/0', displayText: '#DIV/0!' },
    // A repeated text value -- exercises shared-string deduplication (both cells must intern to the SAME index).
    { row: 5, column: 0, value: { kind: 'string', value: 'Acme Corp' }, displayText: 'Acme Corp' },
    // The anchor of a 2x2 merge.
    { row: 6, column: 0, value: { kind: 'string', value: 'Merged Cell' }, displayText: 'Merged Cell', colSpan: 2, rowSpan: 2 },
    // A cell containing text that needs XML escaping.
    { row: 8, column: 0, value: { kind: 'string', value: 'Tom & Jerry <b>' }, displayText: 'Tom & Jerry <b>' },
  ],
  columns: [
    { index: 0, widthPt: 100 },
    { index: 1, widthPt: 60, hidden: true },
  ],
  rows: [
    { index: 0, heightPt: 20 },
    { index: 9, heightPt: 15, hidden: true },
  ],
  images: [],
  printSettings: {
    pageSize: PAGE_SIZE_A4,
    margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
    printRange: { startRow: 0, startColumn: 0, endRow: 9, endColumn: 1 },
    scale: 125,
    repeatRows: { start: 0, end: 0 },
    repeatColumns: { start: 0, end: 0 },
    gridlines: true,
    headers: true,
    pageOrder: 'overThenDown',
    manualBreaks: { rows: [5], columns: [1] },
  },
};

const SUMMARY_SHEET: ContentSheet = {
  name: 'Summary',
  cells: [{ row: 0, column: 0, value: { kind: 'number', value: 42 }, displayText: '42' }],
  columns: [],
  rows: [],
  images: [],
  printSettings: {
    pageSize: PAGE_SIZE_LETTER,
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    fitToPages: { width: 1, height: 3 },
    gridlines: false,
    headers: false,
    pageOrder: 'downThenOver',
  },
};

const DOCUMENT: ContentDocument = {
  kind: 'spreadsheet',
  formatVersion: CONTENT_FORMAT_VERSION,
  metadata: { title: 'Kitchen Sink', author: 'Test Suite', keywords: ['a', 'b'], createdIso: '2026-07-31T00:00:00Z' },
  sheets: [KITCHEN_SINK_SHEET, SUMMARY_SHEET],
};

describe('buildXlsxPackage: rejects a non-spreadsheet ContentDocument', () => {
  it('throws for a wordprocessing document', () => {
    const wrongKind: ContentDocument = { kind: 'wordprocessing', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, sections: [] };
    expect(() => buildXlsxPackage(wrongKind)).toThrow(/spreadsheet/);
  });
});

describe('buildXlsxPackage: produces a structurally valid xlsx package', () => {
  const pkg = buildXlsxPackage(DOCUMENT);

  it('writes every required OPC/SpreadsheetML part', () => {
    expect(Object.keys(pkg.parts).sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'docProps/app.xml',
        'docProps/core.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/sharedStrings.xml',
        'xl/styles.xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ].sort(),
    );
  });

  it('round-trips through the lossless byte codec (encodePackage -> parsePackage -> byte-identical structure)', () => {
    const bytes = encodePackage(pkg);
    const reparsed = parsePackage(bytes);
    expect(reparsed).toEqual(pkg);
  });

  it('deduplicates a repeated string value into a single shared-string entry', () => {
    const sharedStrings = rootElement(pkg.parts['xl/sharedStrings.xml']);
    if (sharedStrings === undefined) {
      throw new Error('expected xl/sharedStrings.xml to have a root element');
    }
    const siCount = sharedStrings.children.filter((node) => node.type === 'element' && node.tag === 'si').length;
    // "Name", "Amount", "Acme Corp" (deduplicated across rows 1 and 5), "Merged Cell", "Tom & Jerry <b>" -- 5 unique strings, not 6.
    expect(siCount).toBe(5);
  });

  it('writes a genuinely minimal but structurally complete xl/styles.xml (fonts, both reserved fills, borders, cellStyleXfs, cellXfs, cellStyles)', () => {
    const styles = rootElement(pkg.parts['xl/styles.xml']);
    if (styles === undefined) {
      throw new Error('expected xl/styles.xml to have a root element');
    }
    const tags = styles.children.filter((node) => node.type === 'element').map((node) => (node.type === 'element' ? node.tag : ''));
    expect(tags).toEqual(['fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles']);
  });
});

describe('readXlsxContent(buildXlsxPackage(x)) round-trips real content', () => {
  const pkg = buildXlsxPackage(DOCUMENT);
  const roundTripped = readXlsxContent(pkg);
  if (roundTripped.kind !== 'spreadsheet') {
    throw new Error('expected a spreadsheet ContentDocument');
  }
  const [data, summary] = roundTripped.sheets;
  if (data === undefined || summary === undefined) {
    throw new Error('expected both sheets to survive the round trip');
  }

  it('preserves sheet names and order', () => {
    expect(roundTripped.sheets.map((sheet) => sheet.name)).toEqual(['Data', 'Summary']);
  });

  it('preserves every cell value kind, including the deduplicated shared string and the XML-special-character text', () => {
    expect(data.cells.find((cell) => cell.row === 0 && cell.column === 0)?.value).toEqual({ kind: 'string', value: 'Name' });
    expect(data.cells.find((cell) => cell.row === 1 && cell.column === 1)?.value).toEqual({ kind: 'number', value: 1234.56 });
    expect(data.cells.find((cell) => cell.row === 2 && cell.column === 0)?.value).toEqual({ kind: 'boolean', value: true });
    expect(data.cells.find((cell) => cell.row === 4 && cell.column === 0)?.value).toEqual({ kind: 'error', value: '#DIV/0!' });
    expect(data.cells.find((cell) => cell.row === 5 && cell.column === 0)?.value).toEqual({ kind: 'string', value: 'Acme Corp' });
    expect(data.cells.find((cell) => cell.row === 8 && cell.column === 0)?.value).toEqual({ kind: 'string', value: 'Tom & Jerry <b>' });
  });

  it('preserves formulas', () => {
    expect(data.cells.find((cell) => cell.row === 3 && cell.column === 0)?.formula).toBe('SUM(B2:B3)');
    expect(data.cells.find((cell) => cell.row === 4 && cell.column === 0)?.formula).toBe('1/0');
  });

  it('preserves the merged range as colSpan/rowSpan on the anchor cell', () => {
    const anchor = data.cells.find((cell) => cell.row === 6 && cell.column === 0);
    expect(anchor).toMatchObject({ colSpan: 2, rowSpan: 2 });
  });

  it('preserves column widths (within the documented approximation) and hidden flags', () => {
    const hiddenColumn = data.columns.find((column) => column.index === 1);
    expect(hiddenColumn?.hidden).toBe(true);
    const firstColumn = data.columns.find((column) => column.index === 0);
    expect(firstColumn?.widthPt).toBeGreaterThan(80); // approximate, not exact -- see units.ts's own documented round-trip caveat
    expect(firstColumn?.widthPt).toBeLessThan(120);
  });

  it('preserves row heights and hidden flags', () => {
    expect(data.rows.find((row) => row.index === 0)?.heightPt).toBe(20);
    const hiddenRow = data.rows.find((row) => row.index === 9);
    expect(hiddenRow?.hidden).toBe(true);
    expect(hiddenRow?.heightPt).toBe(15);
  });

  it('preserves print settings: page size, scale, gridlines/headers, page order, print range, repeat rows/columns, manual breaks', () => {
    expect(data.printSettings.pageSize).toEqual(PAGE_SIZE_A4);
    expect(data.printSettings.scale).toBe(125);
    expect(data.printSettings.fitToPages).toBeUndefined();
    expect(data.printSettings.gridlines).toBe(true);
    expect(data.printSettings.headers).toBe(true);
    expect(data.printSettings.pageOrder).toBe('overThenDown');
    expect(data.printSettings.printRange).toEqual({ startRow: 0, startColumn: 0, endRow: 9, endColumn: 1 });
    expect(data.printSettings.repeatRows).toEqual({ start: 0, end: 0 });
    expect(data.printSettings.repeatColumns).toEqual({ start: 0, end: 0 });
    expect(data.printSettings.manualBreaks).toEqual({ rows: [5], columns: [1] });
  });

  it('preserves the Summary sheet\'s fit-to-page settings and Letter page size', () => {
    expect(summary.printSettings.pageSize).toEqual(PAGE_SIZE_LETTER);
    expect(summary.printSettings.fitToPages).toEqual({ width: 1, height: 3 });
    expect(summary.printSettings.scale).toBeUndefined();
    expect(summary.cells.find((cell) => cell.row === 0 && cell.column === 0)?.value).toEqual({ kind: 'number', value: 42 });
  });

  it('preserves document metadata', () => {
    expect(roundTripped.metadata.title).toBe('Kitchen Sink');
    expect(roundTripped.metadata.author).toBe('Test Suite');
    expect(roundTripped.metadata.keywords).toEqual(['a', 'b']);
  });
});

describe('buildXlsxPackage: an empty sheet with no cells/columns/rows still produces a structurally valid worksheet', () => {
  const emptyDocument: ContentDocument = {
    kind: 'spreadsheet',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {},
    sheets: [
      {
        name: 'Empty',
        cells: [],
        columns: [],
        rows: [],
        images: [],
        printSettings: { pageSize: PAGE_SIZE_LETTER, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, gridlines: false, headers: false, pageOrder: 'downThenOver' },
      },
    ],
  };

  it('builds and round-trips without throwing, dimension falling back to "A1"', () => {
    const pkg = buildXlsxPackage(emptyDocument);
    const worksheet = rootElement(pkg.parts['xl/worksheets/sheet1.xml']);
    if (worksheet === undefined) {
      throw new Error('expected a worksheet root element');
    }
    const dimension = worksheet.children.find((node) => node.type === 'element' && node.tag === 'dimension');
    expect(dimension?.type === 'element' ? dimension.attributes.find((a) => a.name === 'ref')?.value : undefined).toBe('A1');

    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(roundTripped.sheets[0]?.cells).toEqual([]);
  });
});

describe('buildXlsxPackage: a formula cell with a cached STRING result writes t="str" literally, never shared-string-indexed', () => {
  const document: ContentDocument = {
    kind: 'spreadsheet',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {},
    sheets: [
      {
        name: 'Sheet1',
        cells: [{ row: 0, column: 0, value: { kind: 'string', value: 'ab' }, formula: 'CONCATENATE("a","b")', displayText: 'ab' }],
        columns: [],
        rows: [],
        images: [],
        printSettings: { pageSize: PAGE_SIZE_LETTER, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, gridlines: false, headers: false, pageOrder: 'downThenOver' },
      },
    ],
  };

  it('writes t="str" with a literal <v>, not a shared-string index, and the sharedStrings table stays empty', () => {
    const pkg = buildXlsxPackage(document);
    const worksheet = rootElement(pkg.parts['xl/worksheets/sheet1.xml']);
    if (worksheet === undefined) {
      throw new Error('expected a worksheet root element');
    }
    const sheetData = worksheet.children.find((node) => node.type === 'element' && node.tag === 'sheetData');
    const row = sheetData?.type === 'element' ? sheetData.children.find((node) => node.type === 'element' && node.tag === 'row') : undefined;
    const cell = row?.type === 'element' ? row.children.find((node) => node.type === 'element' && node.tag === 'c') : undefined;
    expect(cell?.type === 'element' ? cell.attributes.find((a) => a.name === 't')?.value : undefined).toBe('str');

    const sharedStrings = rootElement(pkg.parts['xl/sharedStrings.xml']);
    expect(sharedStrings?.attributes.find((a) => a.name === 'count')?.value).toBe('0');

    const roundTripped = readXlsxContent(pkg);
    if (roundTripped.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(roundTripped.sheets[0]?.cells[0]).toMatchObject({ value: { kind: 'string', value: 'ab' }, formula: 'CONCATENATE("a","b")' });
  });
});
