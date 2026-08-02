import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { readOdfTable } from './table';

// Grammar verified against a real LibreOffice-generated .odp: a presentation's own draw:frame-wrapped table uses table:table/table:table-column/table:table-row/table:table-cell/table:covered-table-cell, column width via table:table-column's own table:style-name -> a style:family="table-column" style:style's style:table-column-properties/@style:column-width, row height the analogous table:family="table-row"/style:table-row-properties/@style:row-height -- and, notably, a real saved table frame carries an EXTRA sibling draw:image (an .svm fallback preview) alongside table:table, which shapes.ts's own readDrawFrameContent (not this module) is responsible for not mistaking for the frame's real content.

function contentPackage(automaticStyleChildren: XmlElement[] = []): Package['parts'][string] {
  return { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:automatic-styles', {}, automaticStyleChildren)])] };
}

function columnStyle(name: string, widthPt: number): XmlElement {
  return el('style:style', { 'style:name': name, 'style:family': 'table-column' }, [el('style:table-column-properties', { 'style:column-width': `${widthPt}pt` })]);
}

function rowStyle(name: string, heightPt: number): XmlElement {
  return el('style:style', { 'style:name': name, 'style:family': 'table-row' }, [el('style:table-row-properties', { 'style:row-height': `${heightPt}pt` })]);
}

function cellStyle(name: string, backgroundHex: string): XmlElement {
  return el('style:style', { 'style:name': name, 'style:family': 'table-cell' }, [el('style:table-cell-properties', { 'fo:background-color': backgroundHex })]);
}

function cellBorderStyle(name: string, cellPropertyAttrs: Record<string, string>): XmlElement {
  return el('style:style', { 'style:name': name, 'style:family': 'table-cell' }, [el('style:table-cell-properties', cellPropertyAttrs)]);
}

function cell(text: string, extraAttrs: Record<string, string> = {}): XmlElement {
  return el('table:table-cell', extraAttrs, [el('text:p', {}, [txt(text)])]);
}

describe('readOdfTable: columns', () => {
  it('resolves each table:table-column\'s own width via its table:style-name -> table-column family style', () => {
    const co1 = columnStyle('co1', 100);
    const co2 = columnStyle('co2', 150);
    const table = el('table:table', {}, [el('table:table-column', { 'table:style-name': 'co1' }), el('table:table-column', { 'table:style-name': 'co2' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([co1, co2]) } };
    expect(readOdfTable(table, pkg).columnWidthsPt).toEqual([100, 150]);
  });

  it('defaults an unresolvable column width to 0pt, matching ooxml.js\'s own established readTable convention', () => {
    const table = el('table:table', {}, [el('table:table-column')]);
    expect(readOdfTable(table, { parts: {} }).columnWidthsPt).toEqual([0]);
  });

  it('expands table:number-columns-repeated into that many repeated width entries', () => {
    const co1 = columnStyle('co1', 80);
    const table = el('table:table', {}, [el('table:table-column', { 'table:style-name': 'co1', 'table:number-columns-repeated': '3' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([co1]) } };
    expect(readOdfTable(table, pkg).columnWidthsPt).toEqual([80, 80, 80]);
  });
});

describe('readOdfTable: rows', () => {
  it('resolves each table:table-row\'s own height via its table:style-name -> table-row family style', () => {
    const ro1 = rowStyle('ro1', 20);
    const table = el('table:table', {}, [el('table:table-row', { 'table:style-name': 'ro1' }, [cell('x')])]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([ro1]) } };
    expect(readOdfTable(table, pkg).rows[0]?.heightPt).toBe(20);
  });

  it('leaves heightPt undefined (not 0) when unresolvable -- unlike column width, a missing row height is genuinely "unspecified"', () => {
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('x')])]);
    expect(readOdfTable(table, { parts: {} }).rows[0]?.heightPt).toBeUndefined();
  });

  it('expands table:number-rows-repeated into that many repeated rows', () => {
    const table = el('table:table', {}, [el('table:table-row', { 'table:number-rows-repeated': '2' }, [cell('x')])]);
    expect(readOdfTable(table, { parts: {} }).rows).toHaveLength(2);
  });
});

describe('readOdfTable: cell content, spans, and covered cells', () => {
  it('reads each cell\'s own text:p children as paragraph blocks', () => {
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('Hello')])]);
    const blocks = readOdfTable(table, { parts: {} }).rows[0]?.cells[0]?.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'Hello' }] });
  });

  it('reads table:number-columns-spanned/table:number-rows-spanned onto the anchor cell', () => {
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('Header', { 'table:number-columns-spanned': '2', 'table:number-rows-spanned': '3' }), el('table:covered-table-cell')])]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 3 });
  });

  it('reads a table:covered-table-cell as an empty placeholder cell, not the anchor\'s own content repeated', () => {
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('Header', { 'table:number-columns-spanned': '2' }), el('table:covered-table-cell')])]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells[1]).toEqual({ blocks: [] });
  });

  it('expands a covered-table-cell\'s own table:number-columns-repeated into that many empty placeholder cells', () => {
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('Header', { 'table:number-columns-spanned': '3' }), el('table:covered-table-cell', { 'table:number-columns-repeated': '2' })])]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells).toHaveLength(3);
    expect(row?.cells[1]).toEqual({ blocks: [] });
    expect(row?.cells[2]).toEqual({ blocks: [] });
  });

  it('leaves colSpan/rowSpan undefined for a plain, unspanned cell', () => {
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('plain')])]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells[0]?.colSpan).toBeUndefined();
    expect(row?.cells[0]?.rowSpan).toBeUndefined();
  });

  it('expands a cell\'s own table:number-columns-repeated into that many repeated cells', () => {
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('same', { 'table:number-columns-repeated': '3' })])]);
    const row = readOdfTable(table, { parts: {} }).rows[0];
    expect(row?.cells).toHaveLength(3);
    expect(row?.cells.every((c) => c.blocks[0]?.kind === 'paragraph')).toBe(true);
  });
});

describe('readOdfTable: cell background', () => {
  it('resolves fo:background-color from the cell\'s own table:style-name -> table-cell family style', () => {
    const ce1 = cellStyle('ce1', '#ff0000');
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('red', { 'table:style-name': 'ce1' })])]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([ce1]) } };
    expect(readOdfTable(table, pkg).rows[0]?.cells[0]?.background).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('leaves background undefined for a cell with no style-name', () => {
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('plain')])]);
    expect(readOdfTable(table, { parts: {} }).rows[0]?.cells[0]?.background).toBeUndefined();
  });
});

describe('readOdfTable: cell borders (odt/odp -- single-level table:style-name -> table-cell family style, matching background\'s own established lookup)', () => {
  it('expands the fo:border shorthand onto all four edges', () => {
    const ce1 = cellBorderStyle('ce1', { 'fo:border': '1pt solid #ff0000' });
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('bordered', { 'table:style-name': 'ce1' })])]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([ce1]) } };
    const borders = readOdfTable(table, pkg).rows[0]?.cells[0]?.borders;
    const expectedEdge = { color: { r: 1, g: 0, b: 0 }, widthPt: 1, style: 'solid' };
    expect(borders).toEqual({ left: expectedEdge, right: expectedEdge, top: expectedEdge, bottom: expectedEdge });
  });

  it('lets a per-edge fo:border-top override just that one edge, leaving the other three at the shorthand value', () => {
    const ce1 = cellBorderStyle('ce1', { 'fo:border': '1pt solid #000000', 'fo:border-top': '2pt dashed #00ff00' });
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('bordered', { 'table:style-name': 'ce1' })])]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([ce1]) } };
    const borders = readOdfTable(table, pkg).rows[0]?.cells[0]?.borders;
    expect(borders?.top).toEqual({ color: { r: 0, g: 1, b: 0 }, widthPt: 2, style: 'dashed' });
    expect(borders?.left).toEqual({ color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'solid' });
    expect(borders?.right).toEqual({ color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'solid' });
    expect(borders?.bottom).toEqual({ color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'solid' });
  });

  it('reads a border style ODF allows but ContentBorderSchema has no member for (e.g. "groove") as a real border with width/colour, but no style field', () => {
    const ce1 = cellBorderStyle('ce1', { 'fo:border-left': '0.5pt groove #123456' });
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('grooved', { 'table:style-name': 'ce1' })])]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([ce1]) } };
    const borders = readOdfTable(table, pkg).rows[0]?.cells[0]?.borders;
    expect(borders?.left).toEqual({ color: { r: 0x12 / 255, g: 0x34 / 255, b: 0x56 / 255 }, widthPt: 0.5 });
    expect(borders?.right).toBeUndefined();
  });

  it('treats a "none" border-style token as genuinely no border on that edge, not a real border', () => {
    const ce1 = cellBorderStyle('ce1', { 'fo:border': '1pt solid #000000', 'fo:border-bottom': '1pt none #000000' });
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('partial', { 'table:style-name': 'ce1' })])]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([ce1]) } };
    const borders = readOdfTable(table, pkg).rows[0]?.cells[0]?.borders;
    expect(borders?.bottom).toBeUndefined();
    expect(borders?.top).toBeDefined();
  });

  it('leaves borders undefined entirely for a cell whose style carries no fo:border(-*) attributes at all', () => {
    const ce1 = cellStyle('ce1', '#ff0000');
    const table = el('table:table', {}, [el('table:table-row', {}, [cell('red', { 'table:style-name': 'ce1' })])]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([ce1]) } };
    expect(readOdfTable(table, pkg).rows[0]?.cells[0]?.borders).toBeUndefined();
  });
});

describe('readOdfTable: overall shape', () => {
  it('always returns kind: "table"', () => {
    expect(readOdfTable(el('table:table'), { parts: {} }).kind).toBe('table');
  });

  it('handles an empty table:table with no columns or rows at all', () => {
    expect(readOdfTable(el('table:table'), { parts: {} })).toEqual({ kind: 'table', rows: [], columnWidthsPt: [] });
  });
});
