import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import { el, txt } from '../../xml/fragment';
import { parsePackage } from '../../package-io/read';
import { readOdbReport } from './report';

// Every assertion below is against src/typed/odb/fixtures/form-and-report.odb, a real, unmodified LibreOffice 26.2 Report Builder report (see typed/odb/report.ts's own top-of-file note for the six structural findings it produced, and typed/odb/read.ts's for how the fixture was generated and cross-verified). The rpt: vocabulary has no ratified public schema this package could have read the shape off instead, so real producer output is the ONLY ground truth here -- most of all for the two things that would have been got wrong by assumption: the detail band's nesting inside the innermost group, and a group key being a formula rather than a bare column name.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

describe('readOdbReport: form-and-report.odb (real LibreOffice Report Builder output)', () => {
  const report = readOdbReport(loadFixture('form-and-report.odb'), 'SalesByRegion');

  it('reports the report\'s user-visible name alongside the opaque persistent path its sub-document actually lives at', () => {
    expect(report.name).toBe('SalesByRegion');
    expect(report.href).toBe('reports/Obj11');
  });

  it('reads the data binding: a report bound to the saved QUERY by name, not to a table or a literal SQL string', () => {
    expect(report.command).toBe('HighValueSales');
    expect(report.commandType).toBe('query');
    expect(report.caption).toBe('Sales by region');
  });

  it('reads office:mimetype, which describes the report\'s RENDERED output rather than the definition file itself', () => {
    expect(report.mimeType).toBe('application/vnd.oasis.opendocument.text');
  });

  it('reads the report header band and its static label', () => {
    expect(report.reportHeader).toEqual({
      kind: 'report-header',
      name: 'Report Header',
      elements: [{ tag: 'rpt:fixed-content', name: 'Label field', text: 'Sales by region' }],
    });
  });

  it('reads the page header band\'s two column labels, in document order', () => {
    expect(report.pageHeader?.elements.map((element) => element.text)).toEqual(['Customer', 'Amount']);
  });

  it('reads an empty band as genuinely empty rather than omitting it -- the page footer exists but was never populated', () => {
    expect(report.pageFooter).toEqual({ kind: 'page-footer', name: 'Page Footer', elements: [] });
  });

  it('finds the detail band even though it is nested TWO levels deep inside the group chain, not a sibling of the other bands', () => {
    expect(report.detail?.kind).toBe('detail');
    expect(report.detail?.elements).toEqual([
      { tag: 'rpt:formatted-text', name: 'Formatted field', formula: 'field:[CUSTOMER]', dataField: 'CUSTOMER' },
      { tag: 'rpt:formatted-text', name: 'Formatted field', formula: 'field:[AMOUNT]', dataField: 'AMOUNT' },
    ]);
  });

  it('reads the outer group: a formula group-expression, a bare-column sort-expression, and ascending sort order', () => {
    const outer = report.groups[0];
    expect(report.groups).toHaveLength(1);
    expect(outer?.groupExpression).toBe('rpt:HASCHANGED("REGION")');
    expect(outer?.sortExpression).toBe('REGION');
    expect(outer?.sortAscending).toBe(true);
  });

  it('reads the inner group as a nested child of the outer one, never as a second top-level group', () => {
    const inner = report.groups[0]?.groups[0];
    expect(report.groups[0]?.groups).toHaveLength(1);
    expect(inner?.sortExpression).toBe('QUARTER');
    expect(inner?.groups).toEqual([]);
  });

  it('reads the inner group\'s own page-break and keep-together layout attributes as real booleans and a verbatim string', () => {
    const inner = report.groups[0]?.groups[0];
    expect(inner?.startNewColumn).toBe(true);
    expect(inner?.resetPageNumber).toBe(true);
    expect(inner?.keepTogether).toBe('whole-group');
  });

  it('omits the layout attributes entirely on the outer group, which declares none of them', () => {
    const outer = report.groups[0] ?? { functions: [], groups: [] };
    expect('startNewColumn' in outer).toBe(false);
    expect('resetPageNumber' in outer).toBe(false);
    expect('keepTogether' in outer).toBe(false);
  });

  it('reads the report-level rpt:function LibreOffice minted for the prefix-character grouping, which the inner group\'s expression references by name', () => {
    expect(report.functions).toEqual([{ name: 'LEFT_QUARTER', formula: 'rpt:LEFT([QUARTER];2)' }]);
    expect(report.groups[0]?.groups[0]?.groupExpression).toBe('rpt:HASCHANGED("LEFT_QUARTER")');
  });

  it('reads each group footer\'s SUM as a computed expression -- a formula with no dataField, unlike a plain bound field', () => {
    for (const footer of [report.groups[0]?.footer, report.groups[0]?.groups[0]?.footer, report.reportFooter]) {
      const sum = footer?.elements.find((element) => element.tag === 'rpt:formatted-text');
      expect(sum?.formula).toBe('rpt:SUM([AMOUNT])');
      expect('dataField' in (sum ?? {})).toBe(false);
    }
  });

  it('reads each footer\'s label alongside its SUM, in document order', () => {
    expect(report.groups[0]?.groups[0]?.footer?.elements.map((element) => element.text ?? element.formula)).toEqual(['Quarter total:', 'rpt:SUM([AMOUNT])']);
    expect(report.groups[0]?.footer?.elements.map((element) => element.text ?? element.formula)).toEqual(['Region total:', 'rpt:SUM([AMOUNT])']);
    expect(report.reportFooter?.elements.map((element) => element.text ?? element.formula)).toEqual(['Grand total:', 'rpt:SUM([AMOUNT])']);
  });

  it('reads each group header\'s single bound field, unwrapping the "field:[COLUMN]" formula into a real column name', () => {
    expect(report.groups[0]?.header?.elements).toEqual([{ tag: 'rpt:formatted-text', name: 'Formatted field', formula: 'field:[REGION]', dataField: 'REGION' }]);
    expect(report.groups[0]?.groups[0]?.header?.elements).toEqual([{ tag: 'rpt:formatted-text', name: 'Formatted field', formula: 'field:[QUARTER]', dataField: 'QUARTER' }]);
  });

  it('never reconstructs the band layout table itself -- only its own producer-assigned name is carried', () => {
    expect(report.detail?.name).toBe('Detail');
    expect(report.detail).not.toHaveProperty('rows');
    expect(report.detail).not.toHaveProperty('columns');
  });
});

describe('readOdbReport: synthetic report shapes', () => {
  function reportPackage(reportChildren: ReturnType<typeof el>[], reportAttrs: Record<string, string> = {}): Package {
    return {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [
            el('office:document-content', {}, [
              el('office:body', {}, [
                el('office:database', {}, [el('db:reports', {}, [el('db:component', { 'db:name': 'R', 'xlink:href': 'reports/Obj1' })])]),
              ]),
            ]),
          ],
        },
        'reports/Obj1/content.xml': {
          kind: 'xml',
          nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:report', reportAttrs, reportChildren)])])],
        },
      },
    };
  }

  it('finds a detail band sitting directly under office:report, the shape a report with no groups at all really produces', () => {
    const pkg = reportPackage([
      el('rpt:detail', {}, [
        el('table:table', { 'table:name': 'Detail' }, [
          el('table:table-row', {}, [
            el('table:table-cell', {}, [el('text:p', {}, [el('rpt:formatted-text', { 'rpt:formula': 'field:[X]' }, [el('rpt:report-element', {}, [el('rpt:report-component', { 'draw:name': 'Formatted field' })])])])]),
          ]),
        ]),
      ]),
    ]);
    const report = readOdbReport(pkg, 'R');
    expect(report.groups).toEqual([]);
    expect(report.detail?.elements).toEqual([{ tag: 'rpt:formatted-text', name: 'Formatted field', formula: 'field:[X]', dataField: 'X' }]);
  });

  it('reads a group-scoped rpt:function separately from the report-level ones', () => {
    const pkg = reportPackage([
      el('rpt:function', { 'rpt:name': 'ReportTotal', 'rpt:formula': 'rpt:SUM([AMOUNT])' }),
      el('rpt:group', { 'rpt:sort-expression': 'REGION' }, [el('rpt:function', { 'rpt:name': 'GroupTotal', 'rpt:formula': 'rpt:SUM([QTY])' })]),
    ]);
    const report = readOdbReport(pkg, 'R');
    expect(report.functions).toEqual([{ name: 'ReportTotal', formula: 'rpt:SUM([AMOUNT])' }]);
    expect(report.groups[0]?.functions).toEqual([{ name: 'GroupTotal', formula: 'rpt:SUM([QTY])' }]);
  });

  it('skips an rpt:function missing either of its mandatory attributes rather than returning it half-populated', () => {
    const pkg = reportPackage([el('rpt:function', { 'rpt:name': 'NoFormula' }), el('rpt:function', { 'rpt:formula': 'rpt:SUM([A])' })]);
    expect(readOdbReport(pkg, 'R').functions).toEqual([]);
  });

  it('never treats a bare rpt: element with no rpt:report-element child as a control', () => {
    const pkg = reportPackage([
      el('rpt:detail', {}, [el('table:table', { 'table:name': 'Detail' }, [el('table:table-cell', {}, [el('rpt:conditional-print-expression', { 'rpt:formula': 'rpt:[X]>1' })])])]),
    ]);
    expect(readOdbReport(pkg, 'R').detail?.elements).toEqual([]);
  });

  it('leaves a formula this reader does not recognise as a bound field standing verbatim, never partially parsed', () => {
    const pkg = reportPackage([
      el('rpt:detail', {}, [
        el('table:table', {}, [el('rpt:formatted-text', { 'rpt:formula': 'field:[]' }, [el('rpt:report-element', {})]), el('rpt:formatted-text', { 'rpt:formula': 'rpt:NOW()' }, [el('rpt:report-element', {})])]),
      ]),
    ]);
    expect(readOdbReport(pkg, 'R').detail?.elements).toEqual([
      { tag: 'rpt:formatted-text', formula: 'field:[]' },
      { tag: 'rpt:formatted-text', formula: 'rpt:NOW()' },
    ]);
  });

  it('joins a label split across several text nodes and a nested text:span into one string', () => {
    const pkg = reportPackage([
      el('rpt:report-header', {}, [
        el('table:table', {}, [
          el('rpt:fixed-content', {}, [el('text:p', {}, [txt('Total '), el('text:span', {}, [txt('for')]), txt(' region')]), el('rpt:report-element', {})]),
        ]),
      ]),
    ]);
    expect(readOdbReport(pkg, 'R').reportHeader?.elements[0]?.text).toBe('Total for region');
  });
});

describe('readOdbReport: error paths', () => {
  const baseContent = {
    kind: 'xml' as const,
    nodes: [
      el('office:document-content', {}, [
        el('office:body', {}, [el('office:database', {}, [el('db:reports', {}, [el('db:component', { 'db:name': 'R', 'xlink:href': 'reports/Obj1' })])])]),
      ]),
    ],
  };

  it('throws when the .odb declares no report by that name', () => {
    expect(() => readOdbReport({ parts: { 'content.xml': baseContent } }, 'Missing')).toThrow(/no report named "Missing"/);
  });

  it('throws when the declared sub-document is absent from the package', () => {
    expect(() => readOdbReport({ parts: { 'content.xml': baseContent } }, 'R')).toThrow(/reports\/Obj1\/content\.xml/);
  });

  it('throws when the sub-document has no office:body/office:report element -- e.g. an ordinary text sub-document', () => {
    const pkg: Package = {
      parts: {
        'content.xml': baseContent,
        'reports/Obj1/content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text')])])] },
      },
    };
    expect(() => readOdbReport(pkg, 'R')).toThrow(/office:report/);
  });
});
