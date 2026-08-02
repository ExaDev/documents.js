import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import { el } from '../../xml/fragment';
import { parsePackage } from '../../package-io/read';
import { CellFormatTable, DEFAULT_CELL_FORMAT_INDEX, GENERAL_NUM_FMT_ID, readCellFormatCodes } from './styles';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function stylesPackage(styleSheet: ReturnType<typeof el>): Package {
  return { parts: { 'xl/styles.xml': { kind: 'xml', nodes: [styleSheet] } } };
}

describe('readCellFormatCodes: real LibreOffice output (kitchen-sink.xlsx)', () => {
  const pkg = parsePackage(new Uint8Array(readFileSync(join(FIXTURES_DIR, 'kitchen-sink.xlsx'))));
  const codes = readCellFormatCodes(pkg);

  it('resolves one code per <cellXfs><xf>, in document order, so the index IS a cell\'s own s attribute', () => {
    expect(codes).toEqual([
      'General',
      '"TRUE";"TRUE";"FALSE"',
      '[$-809]yyyy\\-mm\\-dd',
      '[$-809]hh:mm:ss',
      '[$-809]0.00%',
      '[$GBP-809]#,##0.00',
      'General',
    ]);
  });

  it('decodes the XML entities a real formatCode attribute carries -- the quoted literals would tokenize as bare codes otherwise', () => {
    expect(codes[1]).not.toContain('&quot;');
  });
});

describe('readCellFormatCodes: the built-in table, the <numFmts> overlay, and the gaps', () => {
  it('resolves an id the file never declares from ECMA-376\'s own built-in table', () => {
    const pkg = stylesPackage(el('styleSheet', {}, [el('cellXfs', {}, [el('xf', { numFmtId: '9' }), el('xf', { numFmtId: '14' })])]));
    expect(readCellFormatCodes(pkg)).toEqual(['0%', 'mm-dd-yy']);
  });

  it('lets a producer-declared <numFmt> win UNCONDITIONALLY, even over an id inside the built-in range', () => {
    const pkg = stylesPackage(
      el('styleSheet', {}, [
        el('numFmts', {}, [el('numFmt', { numFmtId: '9', formatCode: '[$USD-409]#,##0.00' })]),
        el('cellXfs', {}, [el('xf', { numFmtId: '9' })]),
      ]),
    );
    expect(readCellFormatCodes(pkg)).toEqual(['[$USD-409]#,##0.00']);
  });

  it('treats an <xf> with no numFmtId at all as General (CT_Xf/@numFmtId\'s own schema default)', () => {
    const pkg = stylesPackage(el('styleSheet', {}, [el('cellXfs', {}, [el('xf', {})])]));
    expect(readCellFormatCodes(pkg)).toEqual(['General']);
  });

  it('reports undefined -- not General -- for an id with no code anywhere (a reserved 23-36 id, or a dangling custom reference)', () => {
    const pkg = stylesPackage(el('styleSheet', {}, [el('cellXfs', {}, [el('xf', { numFmtId: '30' }), el('xf', { numFmtId: '9999' }), el('xf', { numFmtId: 'nonsense' })])]));
    expect(readCellFormatCodes(pkg)).toEqual([undefined, undefined, undefined]);
  });

  it('reads an empty list for a package with no xl/styles.xml, and for a styleSheet with no <cellXfs>', () => {
    expect(readCellFormatCodes({ parts: {} })).toEqual([]);
    expect(readCellFormatCodes(stylesPackage(el('styleSheet', {}, [])))).toEqual([]);
  });
});

describe('CellFormatTable: the write-side interner, mirroring SharedStringTable', () => {
  it('starts with the General default at index 0 and declares nothing until something is interned', () => {
    const table = new CellFormatTable();
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID]);
    expect(table.declarations()).toEqual([]);
    expect(table.intern({ kind: 'builtin', id: GENERAL_NUM_FMT_ID })).toBe(DEFAULT_CELL_FORMAT_INDEX);
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID]);
  });

  it('references a built-in format by its own id, declaring no <numFmt> for it', () => {
    const table = new CellFormatTable();
    expect(table.intern({ kind: 'builtin', id: 10 })).toBe(1);
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID, 10]);
    expect(table.declarations()).toEqual([]);
  });

  it('assigns custom codes ids from 164 upward, the first id a file may declare for itself', () => {
    const table = new CellFormatTable();
    expect(table.intern({ kind: 'custom', code: 'yyyy\\-mm\\-dd' })).toBe(1);
    expect(table.intern({ kind: 'custom', code: '"TRUE";"TRUE";"FALSE"' })).toBe(2);
    expect(table.declarations()).toEqual([
      { id: 164, code: 'yyyy\\-mm\\-dd' },
      { id: 165, code: '"TRUE";"TRUE";"FALSE"' },
    ]);
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID, 164, 165]);
  });

  it('hands the same index back for a repeated format, interning one xf per FORMAT rather than one per request', () => {
    const table = new CellFormatTable();
    const first = table.intern({ kind: 'custom', code: '[$GBP]#,##0.00' });
    expect(table.intern({ kind: 'custom', code: '[$GBP]#,##0.00' })).toBe(first);
    expect(table.intern({ kind: 'builtin', id: 21 })).not.toBe(first);
    expect(table.intern({ kind: 'builtin', id: 21 })).toBe(2);
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID, 164, 21]);
    expect(table.declarations()).toHaveLength(1);
  });

  it('keeps built-in ids and custom codes in separate key spaces, so a code that looks like an id cannot collide with one', () => {
    const table = new CellFormatTable();
    expect(table.intern({ kind: 'builtin', id: 4 })).toBe(1);
    expect(table.intern({ kind: 'custom', code: '4' })).toBe(2);
    expect(table.cellFormats()).toEqual([GENERAL_NUM_FMT_ID, 4, 164]);
  });
});
