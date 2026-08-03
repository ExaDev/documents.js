import { rootElement } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { createOdt } from './editor';

describe('OdtTable', () => {
  it('appendTable builds the right row/column count with paragraph-per-cell', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });
    table.cell(0, 0).appendParagraph({ text: 'A1' });
    table.cell(0, 1).appendParagraph({ text: 'B1' });
    expect(table.rows()).toHaveLength(2);
    expect(table.rows()[0]!.cells()).toHaveLength(2);
    expect(table.cell(0, 0).text).toContain('A1');
    expect(table.cell(0, 1).text).toContain('B1');
  });

  it('appendRow adds a row with the given column count', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    table.appendRow(2);
    expect(table.rows()).toHaveLength(2);
    expect(table.rows()[1]!.cells()).toHaveLength(2);
  });

  it('cell() throws for an out-of-range row or column', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    expect(() => table.cell(5, 0)).toThrow(/row 5/);
    expect(() => table.cell(0, 5)).toThrow(/column 5/);
  });

  it('colSpan/rowSpan write and read table:number-columns/rows-spanned, and clearing them removes the attribute', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    const cell = table.cell(0, 0);
    expect(cell.colSpan).toBeUndefined();
    expect(cell.rowSpan).toBeUndefined();
    cell.colSpan = 2;
    cell.rowSpan = 3;
    expect(cell.colSpan).toBe(2);
    expect(cell.rowSpan).toBe(3);
    cell.colSpan = undefined;
    cell.rowSpan = undefined;
    expect(cell.colSpan).toBeUndefined();
    expect(cell.rowSpan).toBeUndefined();
  });

  it('appendEmptyRow + appendCell/appendCoveredCell build a row cell by cell, matching appendRow\'s own uniform-grid cell count', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 0, columns: 2 });
    const row = table.appendEmptyRow();
    const cell = row.appendCell();
    cell.paragraphs()[0]!.appendRun({ text: 'A1' });
    row.appendCoveredCell();
    expect(table.rows()).toHaveLength(1);
    // cells() only surfaces table:table-cell, not table:covered-table-cell, so the covered placeholder is invisible to it -- matching odf.js's own readTableRow, which reads a covered-table-cell as a distinct, contentless entry.
    expect(table.rows()[0]!.cells()).toHaveLength(1);
    expect(table.rows()[0]!.cells()[0]!.text).toBe('A1');
  });

  it('remove() removes the table and throws on any further use', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    expect(editor.tables()).toHaveLength(1);
    table.remove();
    expect(editor.tables()).toHaveLength(0);
    expect(() => table.rows()).toThrow(/removed/);
  });

  it('distinct column widths intern distinct table-column styles; identical widths across two tables reuse the same one', () => {
    const editor = createOdt();
    editor.body.appendTable({ rows: 1, columns: 2, columnWidthsPt: [100, 200] });
    editor.body.appendTable({ rows: 1, columns: 1, columnWidthsPt: [100] });

    const contentPart = editor.toPackage().parts['content.xml'];
    const root = rootElement(contentPart?.kind === 'xml' ? contentPart.nodes : []);
    const automaticStyles = root?.children.find((c) => c.type === 'element' && c.tag === 'office:automatic-styles');
    const columnStyles =
      automaticStyles?.type === 'element'
        ? automaticStyles.children.filter((c) => c.type === 'element' && c.tag === 'style:style' && c.attributes.some((a) => a.name === 'style:family' && a.value === 'table-column'))
        : [];
    // Two distinct widths (100pt, 200pt) across the first table, plus the second table's 100pt column reusing the first table's own 100pt style -- so exactly two table-column styles total, not three.
    expect(columnStyles).toHaveLength(2);
  });
});
