import { buildXlsxPackage, decodePackage as decodeOoxmlPackage, encodePackage as encodeOoxmlPackage, readXlsxContent } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { decodeCsvText, encodeCsvText } from '../csv/text';
import { TSV_DELIMITER, parseCsvRecords } from '../csv/records';
import { CsvSheetNotSpecifiedError } from '../csv/write';
import { csvToMarkdown, csvToOds, csvToPdf, csvToXlsx, markdownToCsv, odsToCsv, pdfToCsv, xlsxToCsv } from './convert';
import { createLocalDocumentConverter } from './local';

const CSV_TEXT = 'Name,Amount\nWidget,42.5\nGadget,7\n';
const csvBytes = (): Uint8Array<ArrayBuffer> => encodeCsvText(CSV_TEXT);

describe('csv composition: same-variant bridges', () => {
  it('csvToXlsx produces a real xlsx whose cells carry the header verbatim and the re-typed data values', () => {
    const xlsxBytes = csvToXlsx(csvBytes());
    const content = readXlsxContent(decodeOoxmlPackage(xlsxBytes));
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    const sheet = content.sheets[0]!;
    const cellAt = (row: number, column: number) => sheet.cells.find((cell) => cell.row === row && cell.column === column);
    expect(cellAt(0, 0)?.value).toEqual({ kind: 'string', value: 'Name' });
    expect(cellAt(1, 0)?.value).toEqual({ kind: 'string', value: 'Widget' });
    expect(cellAt(1, 1)?.value).toEqual({ kind: 'number', value: 42.5 });
    expect(cellAt(2, 1)?.value).toEqual({ kind: 'number', value: 7 });
  });

  it('csvToOds accepts the TSV delimiter option, parsing the identical grid from tab-separated text', () => {
    const tsvBytes = encodeCsvText('Name\tAmount\nWidget\t42.5\nGadget\t7\n');
    const csvFromTsv = odsToCsv(csvToOds(tsvBytes, { delimiter: TSV_DELIMITER }));
    expect(parseCsvRecords(decodeCsvText(csvFromTsv))).toEqual(parseCsvRecords(CSV_TEXT));
  });

  it('odsToCsv/xlsxToCsv emit the rendered cells of real ods and xlsx fixtures', () => {
    expect(parseCsvRecords(decodeCsvText(odsToCsv(csvToOds(csvBytes()))))).toEqual(parseCsvRecords(CSV_TEXT));
    expect(parseCsvRecords(decodeCsvText(xlsxToCsv(csvToXlsx(csvBytes()))))).toEqual(parseCsvRecords(CSV_TEXT));
  });

  it('xlsxToCsv on a multi-sheet source throws CsvSheetNotSpecifiedError naming every sheet, and { sheet } selects one', () => {
    const oneSheet = csvToXlsx(encodeCsvText('A\n1\n'));
    // Build a genuine two-sheet xlsx through ooxml.js's own builder rather than mutating bridge output.
    const sheetOne = readXlsxContent(decodeOoxmlPackage(oneSheet));
    if (sheetOne.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    const twoSheets = { ...sheetOne, sheets: [...sheetOne.sheets, { ...sheetOne.sheets[0]!, name: 'Second' }] };
    const xlsxBytes = encodeOoxmlPackage(buildXlsxPackage(twoSheets));
    expect(() => xlsxToCsv(xlsxBytes)).toThrow(CsvSheetNotSpecifiedError);
    expect(parseCsvRecords(decodeCsvText(xlsxToCsv(xlsxBytes, { sheet: 'Second' })))).toEqual([['A'], ['1']]);
  });
});

describe('csv composition: PDF pivot', () => {
  it('csvToPdf produces valid PDF bytes (composed csv -> ods -> pdf, since csv has no layout engine of its own)', () => {
    const pdfBytes = csvToPdf(csvBytes());
    expect(new TextDecoder('latin1').decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');
  });

  it('pdfToCsv round-trips the rendered header and cell text back to records', () => {
    const csvRoundTripped = pdfToCsv(csvToPdf(csvBytes()));
    const records = parseCsvRecords(decodeCsvText(csvRoundTripped));
    expect(records[0]).toEqual(['Name', 'Amount']);
    expect(records[1]?.[0]).toBe('Widget');
    expect(records[1]?.[1]).toBe('42.5');
  });

  it('csvToPdf threads onCellTypeInference through to the read hop, exposing the audit channel the ergonomic layer previously lacked', () => {
    const events: string[] = [];
    csvToPdf(csvBytes(), { onCellTypeInference: (event) => events.push(`${event.row}:${event.column}:${event.outcome}`) });
    // The sink reports decisions only: the header (never re-typed) and the plain-text names (no typing candidate) fire nothing, leaving exactly the two numeric retypes.
    expect(events).toEqual(['1:1:retyped', '2:1:retyped']);
  });
});

describe('csv composition: pdf-composed last-resort pair', () => {
  it('csvToMarkdown produces markdown carrying the rendered cell text', () => {
    const markdown = new TextDecoder().decode(csvToMarkdown(csvBytes()));
    expect(markdown).toContain('Name');
    expect(markdown).toContain('Widget');
  });

  it('markdownToCsv produces well-formed RFC 4180 records from a markdown table', () => {
    const markdownBytes = new TextEncoder().encode('| A | B |\n| --- | --- |\n| one | two |\n');
    const csvFromMarkdown = markdownToCsv(markdownBytes);
    expect(parseCsvRecords(decodeCsvText(csvFromMarkdown)).length).toBeGreaterThan(0);
  });
});

describe('csv through the DocumentConverter port', () => {
  it('routes csv -> xlsx and reports the target format', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'csv', bytes: csvBytes() }, targetFormat: 'xlsx' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('xlsx');
    const content = readXlsxContent(decodeOoxmlPackage(result.document.bytes));
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(content.sheets[0]?.cells.find((cell) => cell.row === 1 && cell.column === 1)?.value).toEqual({ kind: 'number', value: 42.5 });
  });

  it('routes csv -> pdf and produces valid PDF bytes', async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert({ source: { format: 'csv', bytes: csvBytes() }, targetFormat: 'pdf' }, { signal: new AbortController().signal });
    expect(result.document.format).toBe('pdf');
    expect(new TextDecoder('latin1').decode(result.document.bytes.subarray(0, 5))).toBe('%PDF-');
  });
});
