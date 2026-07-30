import type { XmlNode } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { buildTable, DocxTable } from './table';

describe('buildTable', () => {
  it('builds a grid with the requested row/column count', () => {
    const tableElement = buildTable({ rows: 2, columns: 3 });
    const container: XmlNode[] = [tableElement];
    const table = new DocxTable(container, tableElement);
    expect(table.rows()).toHaveLength(2);
    expect(table.rows()[0]?.cells()).toHaveLength(3);
    expect(table.rows()[1]?.cells()).toHaveLength(3);
  });

  it('uses explicit column widths when given', () => {
    const tableElement = buildTable({ rows: 1, columns: 2, columnWidthsTwips: [3000, 6000] });
    const tblGrid = tableElement.children.find((c) => c.type === 'element' && c.tag === 'w:tblGrid');
    if (tblGrid?.type !== 'element') {
      throw new Error('expected w:tblGrid');
    }
    const widths = tblGrid.children
      .filter((c) => c.type === 'element')
      .map((c) => (c.type === 'element' ? c.attributes.find((a) => a.name === 'w:w')?.value : undefined));
    expect(widths).toEqual(['3000', '6000']);
  });
});

describe('DocxTable cell access and mutation', () => {
  it('cell(row, col) returns the right cell, and its text can be set via appendParagraph', () => {
    const tableElement = buildTable({ rows: 2, columns: 2 });
    const table = new DocxTable([tableElement], tableElement);
    const cell = table.cell(1, 1);
    cell.appendParagraph({ text: 'B2' });
    expect(table.cell(1, 1).text).toContain('B2');
    expect(table.cell(0, 0).text).toBe(''); // untouched cells start with one empty paragraph
  });

  it('throws for an out-of-range row or column', () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const table = new DocxTable([tableElement], tableElement);
    expect(() => table.cell(5, 0)).toThrow();
    expect(() => table.cell(0, 5)).toThrow();
  });

  it('appendRow adds a row with the given column count', () => {
    const tableElement = buildTable({ rows: 1, columns: 2 });
    const table = new DocxTable([tableElement], tableElement);
    table.appendRow(2);
    expect(table.rows()).toHaveLength(2);
    expect(table.rows()[1]?.cells()).toHaveLength(2);
  });

  it('remove() removes the table and throws on further use', () => {
    const tableElement = buildTable({ rows: 1, columns: 1 });
    const container: XmlNode[] = [tableElement];
    const table = new DocxTable(container, tableElement);
    table.remove();
    expect(container).toHaveLength(0);
    expect(() => table.rows()).toThrow(/removed/);
  });
});
