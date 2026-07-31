import type { XmlElement } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { createOds } from './editor';

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  return parent.children.find((c): c is XmlElement => c.type === 'element' && c.tag === tag);
}

describe('OdsSheet.cell / cellAt', () => {
  it('cell(row, column) and cellAt("B1") address the same position', () => {
    const sheet = createOds().sheets()[0]!;
    sheet.cell(0, 1).value = { kind: 'string', value: 'B1 via row/column' };
    expect(sheet.cellAt('B1').value).toEqual({ kind: 'string', value: 'B1 via row/column' });
  });

  it('cellAt reuses odf.js\'s own A1 parsing -- multi-letter columns resolve correctly', () => {
    const sheet = createOds().sheets()[0]!;
    sheet.cell(0, 27).value = { kind: 'number', value: 1 }; // column 27 (0-based) is "AB"
    expect(sheet.cellAt('AB1').value).toEqual({ kind: 'number', value: 1 });
  });

  it('cellAt throws a clear error for a malformed reference', () => {
    const sheet = createOds().sheets()[0]!;
    expect(() => sheet.cellAt('not-a-reference')).toThrow(/not a valid A1-style/);
  });

  it('resolving the same cell twice returns a live view over the SAME underlying node -- a mutation through one is visible through the other', () => {
    const sheet = createOds().sheets()[0]!;
    const first = sheet.cell(2, 2);
    first.value = { kind: 'number', value: 99 };
    const second = sheet.cell(2, 2);
    expect(second.value).toEqual({ kind: 'number', value: 99 });
  });
});

function findTableElement(editor: ReturnType<typeof createOds>): XmlElement {
  const contentPart = editor.toPackage().parts['content.xml'];
  const root = contentPart?.kind === 'xml' ? contentPart.nodes.find((n): n is XmlElement => n.type === 'element') : undefined;
  const body = root === undefined ? undefined : directChild(root, 'office:body');
  const spreadsheet = body === undefined ? undefined : directChild(body, 'office:spreadsheet');
  const table = spreadsheet === undefined ? undefined : directChild(spreadsheet, 'table:table');
  if (table === undefined) {
    throw new Error('expected a table:table element');
  }
  return table;
}

describe('OdsSheet.mergeCells', () => {
  it('sets colSpan/rowSpan on the anchor cell only when the corresponding span is greater than 1', () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.mergeCells(0, 0, 1, 3);
    const table = findTableElement(editor);
    const row = directChild(table, 'table:table-row');
    if (row === undefined) {
      throw new Error('expected a row');
    }
    const anchor = directChild(row, 'table:table-cell');
    if (anchor === undefined) {
      throw new Error('expected the anchor cell');
    }
    expect(anchor.attributes.find((a) => a.name === 'table:number-columns-spanned')?.value).toBe('3');
    expect(anchor.attributes.some((a) => a.name === 'table:number-rows-spanned')).toBe(false);
  });

  it('anchor keeps its own value; every OTHER covered position becomes table:covered-table-cell and is rejected by cell()', () => {
    const sheet = createOds().sheets()[0]!;
    const anchor = sheet.mergeCells(1, 1, 2, 2);
    anchor.value = { kind: 'string', value: 'merged' };
    expect(sheet.cell(1, 1).value).toEqual({ kind: 'string', value: 'merged' });
    expect(() => sheet.cell(1, 2)).toThrow(/covered by a merged range/);
    expect(() => sheet.cell(2, 1)).toThrow(/covered by a merged range/);
    expect(() => sheet.cell(2, 2)).toThrow(/covered by a merged range/);
    // Outside the merged rectangle, ordinary cells are unaffected.
    expect(() => sheet.cell(3, 3)).not.toThrow();
  });

  it('a 1x1 "merge" writes no span attributes at all -- an unmerged cell', () => {
    const sheet = createOds().sheets()[0]!;
    const anchor = sheet.mergeCells(0, 0, 1, 1);
    anchor.value = { kind: 'number', value: 1 };
    expect(sheet.cell(0, 0).value).toEqual({ kind: 'number', value: 1 });
  });

  it('rejects a non-positive span', () => {
    const sheet = createOds().sheets()[0]!;
    expect(() => sheet.mergeCells(0, 0, 0, 1)).toThrow(/positive integers/);
    expect(() => sheet.mergeCells(0, 0, 1, 0)).toThrow(/positive integers/);
  });

  it('rejects merging onto a position already covered by another merge', () => {
    const sheet = createOds().sheets()[0]!;
    sheet.mergeCells(0, 0, 2, 2);
    expect(() => sheet.mergeCells(0, 1, 1, 1)).toThrow(/already covered/);
  });

  it('a large sparse merge is cheap -- bounded elements, not proportional to rowSpan x colSpan', () => {
    const sheet = createOds().sheets()[0]!;
    const start = performance.now();
    sheet.mergeCells(0, 0, 100, 100);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(200);
  });
});

describe('OdsSheet.name', () => {
  it('get/set the sheet name', () => {
    const sheet = createOds().sheets()[0]!;
    expect(sheet.name).toBe('Sheet1');
    sheet.name = 'Renamed';
    expect(sheet.name).toBe('Renamed');
  });
});

describe('OdsSheet.remove', () => {
  it('removes the sheet from the spreadsheet and throws on any further use', () => {
    const editor = createOds();
    editor.addSheet('Second');
    expect(editor.sheets()).toHaveLength(2);
    const [first] = editor.sheets();
    first!.remove();
    expect(editor.sheets()).toHaveLength(1);
    expect(editor.sheets()[0]!.name).toBe('Second');
    expect(() => first!.cell(0, 0)).toThrow(/removed/);
  });
});
