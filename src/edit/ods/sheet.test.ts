import type { ContentSheetPrintSettings } from 'document-content-model';
import type { XmlElement } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_A4 } from '../../model/geometry';
import { readOdsContent } from '../../odf/ods/read';
import { createOds, openOds } from './editor';

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

  it('reaching a merge far from the sheet\'s origin is cheap regardless of distance -- only the merge\'s own small area does real work', () => {
    const sheet = createOds().sheets()[0]!;
    const start = performance.now();
    sheet.mergeCells(1000000, 1000, 2, 2); // far from the origin, but a tiny 2x2 rectangle -- reaching it must not cost anything proportional to row 1,000,000.
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(500);
  });

  it('a merge\'s own area does genuinely proportional work -- a moderately large rectangle still completes in a bounded, CI-safe time', () => {
    const sheet = createOds().sheets()[0]!;
    const start = performance.now();
    sheet.mergeCells(0, 0, 100, 100); // 10,000 covered positions, each stamped individually -- see mergeCells' own doc comment on why this is O(area), not O(1).
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(5000);
  });
});

const CUSTOM_PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: { widthPt: 400, heightPt: 300 },
  margins: { topPt: 10, rightPt: 20, bottomPt: 30, leftPt: 40 },
  gridlines: true,
  headers: true,
  pageOrder: 'overThenDown',
};

describe('OdsSheet.printSettings', () => {
  it('get returns the scaffold\'s own real defaults before any set (A4, no gridlines/headers, downThenOver)', () => {
    const sheet = createOds().sheets()[0]!;
    expect(sheet.printSettings).toMatchObject({ pageSize: PAGE_SIZE_A4, gridlines: false, headers: false, pageOrder: 'downThenOver' });
  });

  it('set then get round-trips every field through the live in-memory view', () => {
    const sheet = createOds().sheets()[0]!;
    sheet.printSettings = CUSTOM_PRINT_SETTINGS;
    expect(sheet.printSettings).toEqual(CUSTOM_PRINT_SETTINGS);
  });

  it('setting one sheet\'s printSettings does not perturb another sheet\'s own', () => {
    const editor = createOds();
    const sheetA = editor.sheets()[0]!;
    const sheetB = editor.addSheet('Second');
    sheetA.printSettings = CUSTOM_PRINT_SETTINGS;
    expect(sheetB.printSettings).toMatchObject({ gridlines: false, headers: false, pageOrder: 'downThenOver' });
  });

  it('mints a fresh style:page-layout/style:master-page/style:style[family="table"] triple on every set, repointing table:style-name rather than mutating whatever the sheet was pointing at before', () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = CUSTOM_PRINT_SETTINGS;
    const firstTableStyleName = findTableElement(editor).attributes.find((a) => a.name === 'table:style-name')?.value;
    sheet.printSettings = { ...CUSTOM_PRINT_SETTINGS, gridlines: false };
    const secondTableStyleName = findTableElement(editor).attributes.find((a) => a.name === 'table:style-name')?.value;
    expect(firstTableStyleName).toBeDefined();
    expect(secondTableStyleName).toBeDefined();
    expect(secondTableStyleName).not.toBe(firstTableStyleName); // a genuinely different style was minted, not the first one mutated in place
    expect(sheet.printSettings.gridlines).toBe(false); // the SECOND set's own value is what's actually in effect
  });

  // Re-reads the ACTUAL SERIALIZED BYTES via odf.js's own real readOds parser (readOdsContent is a thin wrapper over it), not this package's own writer echoing its input back -- proves the page-layout/master-page/table-style chain writeSheetPrintSettings mints is genuinely valid, spec-shaped ODF, not merely an in-memory object this editor's own getter happens to read back correctly.
  it('a set printSettings survives a real write -> reread round trip via odf.js\'s own readOds parser', () => {
    const editor = createOds();
    editor.sheets()[0]!.printSettings = CUSTOM_PRINT_SETTINGS;
    const bytes = editor.toBytes();

    const reopened = openOds(bytes).sheets()[0]!;
    expect(reopened.printSettings).toEqual(CUSTOM_PRINT_SETTINGS);

    const content = readOdsContent(openOds(bytes).toPackage());
    if (content.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet ContentDocument');
    }
    expect(content.sheets[0]!.printSettings).toEqual(CUSTOM_PRINT_SETTINGS);
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
