import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import { el } from '../../xml/fragment';
import { parsePackage } from '../../package-io/read';
import { readCellFormatCodes } from './styles';

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
