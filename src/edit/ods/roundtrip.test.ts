import type { Package, XmlElement } from 'odf.js';
import { readOdsContent } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { minimalOdsBytes } from '../../test-support/ods';
import { COLUMN_REPEAT_ATTR, COLUMN_TAG, ROW_REPEAT_ATTR, ROW_TAG, isElementWithTag } from './address';
import { createOds, openOds } from './editor';

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  return parent.children.find((c): c is XmlElement => c.type === 'element' && c.tag === tag);
}

function findTableElement(pkg: Package): XmlElement {
  const contentPart = pkg.parts['content.xml'];
  const root = contentPart?.kind === 'xml' ? contentPart.nodes.find((n): n is XmlElement => n.type === 'element') : undefined;
  const body = root === undefined ? undefined : directChild(root, 'office:body');
  const spreadsheet = body === undefined ? undefined : directChild(body, 'office:spreadsheet');
  const table = spreadsheet === undefined ? undefined : directChild(spreadsheet, 'table:table');
  if (table === undefined) {
    throw new Error('expected a table:table element');
  }
  return table;
}

// The task's own headline requirement: open a REAL ods, set every ContentCellValueSchema variant across several cells, add a formula, save, and reread with odf.js's own readOdsContent -- not this package's own getters -- to prove the bytes on disk (not just this editor's in-memory view of them) are correct.
describe('open -> edit -> save -> reopen: every ContentCellValueSchema variant survives a real readOdsContent cycle', () => {
  it('number/percentage/currency/boolean/date/time/string/empty all round-trip to their correct kind and value', () => {
    const editor = openOds(minimalOdsBytes());
    const sheet = editor.sheet('Data');

    sheet.cell(10, 0).value = { kind: 'number', value: 123.456 };
    sheet.cell(10, 1).value = { kind: 'percentage', value: 0.75 };
    sheet.cell(10, 2).value = { kind: 'currency', value: 5, currency: 'EUR' };
    sheet.cell(10, 3).value = { kind: 'boolean', value: true };
    sheet.cell(10, 4).value = { kind: 'boolean', value: false };
    sheet.cell(10, 5).value = { kind: 'date', value: '2026-12-25' };
    sheet.cell(10, 6).value = { kind: 'time', value: 'PT09H30M00S' };
    sheet.cell(10, 7).value = { kind: 'string', value: 'plain text' };
    sheet.cell(10, 8).value = { kind: 'empty' };
    sheet.cell(10, 8).displayText = 'still visible even though empty'; // an empty-kind cell with real display content must still survive rereading, unlike a genuinely untouched placeholder.

    const formulaCell = sheet.cell(11, 0);
    formulaCell.formula = 'of:=SUM([.A11:.C11])';
    formulaCell.value = { kind: 'number', value: 128.206 };

    const reread = readOdsContent(editor.toPackage()); // reread from the SAME in-memory package this editor produced
    const rereadFromBytes = readOdsContent(openOds(editor.toBytes()).toPackage()); // and independently from a fresh byte round trip, to catch anything that only breaks through actual (de)serialization

    for (const document of [reread, rereadFromBytes]) {
      const dataSheet = document.sheets.find((s) => s.name === 'Data');
      if (dataSheet === undefined) {
        throw new Error('expected the Data sheet to survive');
      }
      const byPosition = new Map(dataSheet.cells.map((c) => [`${c.row},${c.column}`, c]));

      expect(byPosition.get('10,0')?.value).toEqual({ kind: 'number', value: 123.456 });
      expect(byPosition.get('10,1')?.value).toEqual({ kind: 'percentage', value: 0.75 });
      expect(byPosition.get('10,2')?.value).toEqual({ kind: 'currency', value: 5, currency: 'EUR' });
      expect(byPosition.get('10,3')?.value).toEqual({ kind: 'boolean', value: true });
      expect(byPosition.get('10,4')?.value).toEqual({ kind: 'boolean', value: false });
      expect(byPosition.get('10,5')?.value).toEqual({ kind: 'date', value: '2026-12-25' });
      expect(byPosition.get('10,6')?.value).toEqual({ kind: 'time', value: 'PT09H30M00S' });
      expect(byPosition.get('10,7')?.value).toEqual({ kind: 'string', value: 'plain text' });
      expect(byPosition.get('10,8')?.value).toEqual({ kind: 'empty' });
      expect(byPosition.get('10,8')?.displayText).toBe('still visible even though empty');

      expect(byPosition.get('11,0')?.formula).toBe('of:=SUM([.A11:.C11])');
      expect(byPosition.get('11,0')?.value).toEqual({ kind: 'number', value: 128.206 });
    }
  });

  it('error survives as the documented, deliberate string translation -- ODF has no error value-type to round-trip to', () => {
    const editor = openOds(minimalOdsBytes());
    const sheet = editor.sheet('Data');
    sheet.cell(20, 0).value = { kind: 'error', value: '#DIV/0!' };

    const document = readOdsContent(openOds(editor.toBytes()).toPackage());
    const dataSheet = document.sheets.find((s) => s.name === 'Data')!;
    const cell = dataSheet.cells.find((c) => c.row === 20 && c.column === 0);
    expect(cell?.value).toEqual({ kind: 'string', value: '#DIV/0!' });
    expect(cell?.displayText).toBe('#DIV/0!');
  });

  it('a merged range survives: the anchor carries its span, the covered position is entirely absent from cells[]', () => {
    const editor = openOds(minimalOdsBytes());
    const sheet = editor.sheet('Data');
    const anchor = sheet.mergeCells(15, 0, 2, 3);
    anchor.value = { kind: 'string', value: 'Merged Header' };

    const document = readOdsContent(openOds(editor.toBytes()).toPackage());
    const dataSheet = document.sheets.find((s) => s.name === 'Data')!;
    const anchorCell = dataSheet.cells.find((c) => c.row === 15 && c.column === 0);
    expect(anchorCell?.value).toEqual({ kind: 'string', value: 'Merged Header' });
    expect(anchorCell?.rowSpan).toBe(2);
    expect(anchorCell?.colSpan).toBe(3);
    expect(dataSheet.cells.some((c) => c.row === 15 && c.column === 1)).toBe(false);
    expect(dataSheet.cells.some((c) => c.row === 16 && c.column === 2)).toBe(false);
  });
});

describe('write-side repeat-count avoidance: a far-out cell address never materializes the skipped range', () => {
  it('setting row 500, column 50 on a fresh sheet produces a bounded, small number of XML elements -- never 500 x 50 cell objects', () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(500, 50).value = { kind: 'number', value: 1 };

    const table = findTableElement(editor.toPackage());

    const rowElements = table.children.filter(isElementWithTag(ROW_TAG));
    // Exactly two table:table-row elements: a rows-0..499 placeholder (table:number-rows-repeated="500") and row 500 itself.
    expect(rowElements).toHaveLength(2);
    expect(rowElements[0]?.attributes.find((a) => a.name === ROW_REPEAT_ATTR)?.value).toBe('500');
    expect(rowElements[1]?.attributes.some((a) => a.name === ROW_REPEAT_ATTR)).toBe(false);

    const targetRow = rowElements[1]!;
    const cellElements = targetRow.children.filter((c): c is XmlElement => c.type === 'element');
    expect(cellElements).toHaveLength(2);
    expect(cellElements[0]?.attributes.find((a) => a.name === COLUMN_REPEAT_ATTR)?.value).toBe('50');

    // The table's own declared columns cover at least 51, but as ONE run, not 51 separate elements.
    const columnElements = table.children.filter(isElementWithTag(COLUMN_TAG));
    expect(columnElements.length).toBeLessThanOrEqual(2);
  });

  it('and reading that same file back through odf.js\'s own readOdsContent is fast -- proof the file itself, not just this editor\'s in-memory view, stayed compact', () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(50000, 500).value = { kind: 'string', value: 'far away' };
    const bytes = editor.toBytes();

    const start = performance.now();
    const document = readOdsContent(openOds(bytes).toPackage());
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(3000);

    const sheetOut = document.sheets.find((s) => s.name === sheet.name)!;
    expect(sheetOut.cells).toHaveLength(1);
    expect(sheetOut.cells[0]).toMatchObject({ row: 50000, column: 500, value: { kind: 'string', value: 'far away' } });
  });

  it('editing a position inside an EXISTING large repeated run (opened from a real file) splits it in O(1), never expanding it element-by-element', () => {
    // Simulates the real-world hazard odf.js's own read.ts/a1.ts document: a genuine LibreOffice template's trailing rows compressed into one huge table:number-rows-repeated run. Build one directly (a fresh sheet's own gap-fill from a first far-out write already produces exactly this shape).
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.cell(1000000, 0).value = { kind: 'number', value: 1 }; // creates a single ~1,000,000-row placeholder run, per the test above.

    const start = performance.now();
    sheet.cell(500000, 0).value = { kind: 'number', value: 2 }; // falls squarely inside that placeholder run.
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(500);

    expect(sheet.cell(1000000, 0).value).toEqual({ kind: 'number', value: 1 });
    expect(sheet.cell(500000, 0).value).toEqual({ kind: 'number', value: 2 });
  });
});
