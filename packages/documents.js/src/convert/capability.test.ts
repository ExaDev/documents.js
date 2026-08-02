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

    expect(new Set(byVariant.get('wordprocessing'))).toEqual(new Set(['docx', 'odt']));
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

  it('composes the one-hop xlsx -> ods -> pdf path today, even though it is not yet a direct edge', () => {
    const strategy = resolveConversionPath('xlsx', 'pdf');
    expect(strategy?.kind).toBe('composed');
    if (strategy?.kind !== 'composed') {
      throw new Error('expected a composed strategy');
    }
    expect(strategy.via).toBe('ods');
    expect(strategy.first).toEqual({ kind: 'bridge', source: 'xlsx', target: 'ods', convert: strategy.first.convert });
    expect(strategy.second).toEqual({ kind: 'toPdf', source: 'ods', target: 'pdf', convert: strategy.second.convert });
  });

  it('composes the one-hop pdf -> ods -> xlsx path today, even though it is not yet a direct edge', () => {
    const strategy = resolveConversionPath('pdf', 'xlsx');
    expect(strategy?.kind).toBe('composed');
    if (strategy?.kind !== 'composed') {
      throw new Error('expected a composed strategy');
    }
    expect(strategy.via).toBe('ods');
    expect(strategy.first).toEqual({ kind: 'fromPdf', source: 'pdf', target: 'ods', convert: strategy.first.convert });
    expect(strategy.second).toEqual({ kind: 'bridge', source: 'ods', target: 'xlsx', convert: strategy.second.convert });
  });

  it('finds no path at all between two formats with no direct edge and no shared intermediate', () => {
    // No edge in DIRECT_EDGES ever targets 'odf' -- odf's own edge is one-way (odf -> pdf only, see FORMAT_CAPABILITIES.odf) -- so nothing can reach it, composed or otherwise.
    expect(resolveConversionPath('pdf', 'odf')).toBeUndefined();
    // odg's only edge is odg -> pdf, and pdf has no edge to xlsx (only ods bridges to xlsx) -- so odg -> xlsx has no direct edge and no shared one-hop intermediate either.
    expect(resolveConversionPath('odg', 'xlsx')).toBeUndefined();
  });
});
