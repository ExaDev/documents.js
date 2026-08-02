import { describe, expect, it } from 'vitest';
import { DIRECT_EDGES, FORMAT_CAPABILITIES, resolveConversionPath } from './capability';
import type { DocumentFormat } from './port';

describe('FORMAT_CAPABILITIES', () => {
  it('groups every format by its real ContentDocument-variant compatibility', () => {
    const byVariant = new Map<string, DocumentFormat[]>();
    for (const capability of Object.values(FORMAT_CAPABILITIES)) {
      if (capability.variant === undefined) {
        continue;
      }
      const formats = byVariant.get(capability.variant) ?? [];
      formats.push(capability.format);
      byVariant.set(capability.variant, formats);
    }

    expect(new Set(byVariant.get('wordprocessing'))).toEqual(new Set(['docx', 'odt', 'markdown']));
    expect(new Set(byVariant.get('presentation'))).toEqual(new Set(['pptx', 'odp']));
    expect(new Set(byVariant.get('spreadsheet'))).toEqual(new Set(['xlsx', 'ods']));
    expect(new Set(byVariant.get('drawing'))).toEqual(new Set(['odg']));
  });

  it('is the one node sharing a variant with a layout-path sibling but having no layout path of its own', () => {
    expect(FORMAT_CAPABILITIES.xlsx.variant).toBe('spreadsheet');
    expect(FORMAT_CAPABILITIES.xlsx.hasLayoutPath).toBe(false);
    expect(FORMAT_CAPABILITIES.ods.variant).toBe('spreadsheet');
    expect(FORMAT_CAPABILITIES.ods.hasLayoutPath).toBe(true);
  });

  it('has no undefined-variant format other than pdf and odf reporting a layout path', () => {
    for (const capability of Object.values(FORMAT_CAPABILITIES)) {
      if (capability.variant === undefined) {
        expect(capability.hasLayoutPath).toBe(false);
      }
    }
  });
});

describe('resolveConversionPath', () => {
  it('resolves a direct strategy for every edge already in DIRECT_EDGES', () => {
    for (const edge of DIRECT_EDGES) {
      const strategy = resolveConversionPath(edge.source, edge.target);
      expect(strategy).toEqual({ kind: 'direct', edge });
    }
  });

  it('never proposes a same-format conversion', () => {
    for (const capability of Object.values(FORMAT_CAPABILITIES)) {
      expect(resolveConversionPath(capability.format, capability.format)).toBeUndefined();
    }
  });

  it('resolves a direct strategy for xlsx <-> pdf now that xlsxToPdf/pdfToXlsx exist, even though those functions compose ods<->xlsx + ods<->pdf internally', () => {
    expect(resolveConversionPath('xlsx', 'pdf')).toEqual({ kind: 'direct', edge: DIRECT_EDGES.find((edge) => edge.source === 'xlsx' && edge.target === 'pdf') });
    expect(resolveConversionPath('pdf', 'xlsx')).toEqual({ kind: 'direct', edge: DIRECT_EDGES.find((edge) => edge.source === 'pdf' && edge.target === 'xlsx') });
  });

  it('still composes the one-hop xlsx -> ods -> pdf path over an edge set with no direct xlsx<->pdf edge, proving the resolver\'s own composition mechanism independently of whether a direct edge happens to exist today', () => {
    const edgesWithoutDirectXlsxPdf = DIRECT_EDGES.filter((edge) => !(edge.source === 'xlsx' && edge.target === 'pdf') && !(edge.source === 'pdf' && edge.target === 'xlsx'));

    const toPdf = resolveConversionPath('xlsx', 'pdf', edgesWithoutDirectXlsxPdf);
    expect(toPdf?.kind).toBe('composed');
    if (toPdf?.kind !== 'composed') {
      throw new Error('expected a composed strategy');
    }
    expect(toPdf.via).toBe('ods');
    expect(toPdf.first).toEqual({ kind: 'bridge', source: 'xlsx', target: 'ods', convert: toPdf.first.convert });
    expect(toPdf.second).toEqual({ kind: 'toPdf', source: 'ods', target: 'pdf', convert: toPdf.second.convert });

    const fromPdf = resolveConversionPath('pdf', 'xlsx', edgesWithoutDirectXlsxPdf);
    expect(fromPdf?.kind).toBe('composed');
    if (fromPdf?.kind !== 'composed') {
      throw new Error('expected a composed strategy');
    }
    expect(fromPdf.via).toBe('ods');
    expect(fromPdf.first).toEqual({ kind: 'fromPdf', source: 'pdf', target: 'ods', convert: fromPdf.first.convert });
    expect(fromPdf.second).toEqual({ kind: 'bridge', source: 'ods', target: 'xlsx', convert: fromPdf.second.convert });
  });

  it('finds no path at all when the target is odf -- no edge in DIRECT_EDGES ever targets it, so nothing can reach it, composed or otherwise', () => {
    // odf's own edge is one-way (odf -> pdf only, see FORMAT_CAPABILITIES.odf) -- so 'odf' never appears as a target anywhere in DIRECT_EDGES.
    expect(resolveConversionPath('pdf', 'odf')).toBeUndefined();
    expect(resolveConversionPath('docx', 'odf')).toBeUndefined();
    expect(resolveConversionPath('xlsx', 'odf')).toBeUndefined();
  });

  it('now composes odg -> xlsx via pdf, now that pdf has a direct edge to xlsx (pdfToXlsx) -- this pair had no path at all before that edge existed', () => {
    const strategy = resolveConversionPath('odg', 'xlsx');
    expect(strategy?.kind).toBe('composed');
    if (strategy?.kind !== 'composed') {
      throw new Error('expected a composed strategy');
    }
    expect(strategy.via).toBe('pdf');
    expect(strategy.first).toEqual({ kind: 'toPdf', source: 'odg', target: 'pdf', convert: strategy.first.convert });
    expect(strategy.second).toEqual({ kind: 'fromPdf', source: 'pdf', target: 'xlsx', convert: strategy.second.convert });
  });
});
