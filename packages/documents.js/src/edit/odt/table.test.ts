import { decodePackage, encodePackage, rootElement } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { readOdtContent } from '../../odf/odt/read';
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

  it('paragraphs() surfaces a text:h cell child as a paragraph with its headingLevel readable, matching OdtBody.paragraphs\'s own both-tag walk', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 1 });
    const cell = table.cell(0, 0);
    cell.paragraphs()[0]!.appendRun({ text: 'Cell heading' });
    cell.paragraphs()[0]!.headingLevel = 2;
    // The headingLevel setter retagged the cell's own first paragraph element to text:h in place -- the cell read view must still see it, or a heading written into a cell (buildOdtPackage's own populateCellBlocks now does exactly that) would be invisible to the editor surface and cell.text would silently drop its words.
    expect(cell.paragraphs()).toHaveLength(1);
    expect(cell.paragraphs()[0]!.headingLevel).toBe(2);
    expect(cell.paragraphs()[0]!.text).toBe('Cell heading');
    expect(cell.text).toBe('Cell heading');
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

describe('OdtTableRow.mergeCellsHorizontally', () => {
  it('merges colSpan grid columns into one cell, retagging the consumed positions to table:covered-table-cell', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 4 });
    table.cell(0, 2).appendParagraph({ text: 'consumed content' });

    const anchor = table.rows()[0]!.mergeCellsHorizontally(1, 2);
    anchor.appendParagraph({ text: 'anchor content' });

    // 4 grid positions still exist: 1 unmerged real cell (col 0), 1 anchor real cell with colSpan=2 (col 1), 1 table:covered-table-cell (col 2), and 1 unmerged real cell (col 3) -- 3 real cells total
    expect(table.rows()[0]!.cells()).toHaveLength(3);
    expect(table.cell(0, 1).colSpan).toBe(2);
    expect(table.cell(0, 1).text).toContain('anchor content');

    const pkg = decodePackage(encodePackage(editor.toPackage()));
    const content = readOdtContent(pkg);
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected wordprocessing content');
    }
    const roundTrippedTable = content.sections[0]?.blocks.find((b) => b.kind === 'table');
    if (roundTrippedTable?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    // the grid-position invariant: 4 entries total (1 plain + 1 merged-anchor + 2 covered), matching the 4 real grid columns
    expect(roundTrippedTable.rows[0]?.cells).toHaveLength(4);
    expect(roundTrippedTable.rows[0]?.cells[1]?.colSpan).toBe(2);
  });

  it('throws a clear error when the anchor position is already covered by another merge', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 4 });
    table.rows()[0]!.mergeCellsHorizontally(0, 2);
    expect(() => table.rows()[0]!.mergeCellsHorizontally(1, 1)).toThrow(/already covered/);
  });

  it('silently discards a consumed cell that already had real text, with no error', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 3 });
    table.cell(0, 0).appendParagraph({ text: 'anchor' });
    table.cell(0, 1).appendParagraph({ text: 'about to be discarded' });

    expect(() => table.rows()[0]!.mergeCellsHorizontally(0, 2)).not.toThrow();
    expect(table.rows()[0]!.cells()).toHaveLength(2);
  });

  it('throws for an out-of-range startColumnIndex or a colSpan exceeding the row width', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 1, columns: 2 });
    expect(() => table.rows()[0]!.mergeCellsHorizontally(5, 1)).toThrow(/does not exist/);
    expect(() => table.rows()[0]!.mergeCellsHorizontally(0, 5)).toThrow(/exceeds/);
    expect(() => table.rows()[0]!.mergeCellsHorizontally(0, 0)).toThrow(/positive integer/);
  });
});

describe('OdtTable.mergeCells', () => {
  it('merges a rowSpan x colSpan rectangle, proving the true-grid-column-index property through a prior horizontal merge', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 4 });

    // First, horizontally merge row 0's columns 1-2 -- this changes row 0's own shape (3 real cells instead of 4).
    table.rows()[0]!.mergeCellsHorizontally(1, 2);

    // Now merge a rowSpan=2 rectangle starting at grid column 1, spanning 2 columns, over BOTH rows -- this must correctly find grid column 1 in row 0 (now the already-merged anchor) and mark row 1's TRUE grid columns 1 and 2 as covered, despite row 0's own different real-cell-count shape.
    const anchor = table.mergeCells(0, 1, 2, 2);
    anchor.appendParagraph({ text: 'block' });

    expect(table.cell(0, 1).colSpan).toBe(2);
    expect(table.cell(0, 1).rowSpan).toBe(2);
    // row 1 now has 2 real cells (col 0 and col 3) plus 2 covered positions (cols 1-2)
    expect(table.rows()[1]!.cells()).toHaveLength(2);

    const pkg = decodePackage(encodePackage(editor.toPackage()));
    const content = readOdtContent(pkg);
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected wordprocessing content');
    }
    const roundTrippedTable = content.sections[0]?.blocks.find((b) => b.kind === 'table');
    if (roundTrippedTable?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    // both rows keep the full 4-grid-position shape
    expect(roundTrippedTable.rows[0]?.cells).toHaveLength(4);
    expect(roundTrippedTable.rows[1]?.cells).toHaveLength(4);
    expect(roundTrippedTable.rows[0]?.cells[1]?.colSpan).toBe(2);
    expect(roundTrippedTable.rows[0]?.cells[1]?.rowSpan).toBe(2);
  });

  it('throws a clear error when the already-covered-anchor guard fires through mergeCells', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 3 });
    table.mergeCells(0, 0, 2, 2);
    expect(() => table.mergeCells(0, 1, 1, 1)).toThrow(/already covered/);
  });

  it('silently discards consumed content, matching the docx primitive\'s own precedent', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });
    table.cell(0, 1).appendParagraph({ text: 'discarded' });
    table.cell(1, 0).appendParagraph({ text: 'also discarded' });
    expect(() => table.mergeCells(0, 0, 2, 2)).not.toThrow();
  });

  it('throws for an out-of-range startRow or a rowSpan exceeding the table height', () => {
    const editor = createOdt();
    const table = editor.body.appendTable({ rows: 2, columns: 2 });
    expect(() => table.mergeCells(5, 0, 1, 1)).toThrow(/does not exist/);
    expect(() => table.mergeCells(0, 0, 5, 1)).toThrow(/exceeds/);
    expect(() => table.mergeCells(0, 0, 0, 1)).toThrow(/positive integer/);
  });
});
