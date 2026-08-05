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
  it('resolves every edge already in DIRECT_EDGES', () => {
    for (const edge of DIRECT_EDGES) {
      expect(resolveConversionPath(edge.source, edge.target)).toBe(edge);
    }
  });

  it('never proposes a same-format conversion', () => {
    for (const capability of Object.values(FORMAT_CAPABILITIES)) {
      expect(resolveConversionPath(capability.format, capability.format)).toBeUndefined();
    }
  });

  it('resolves xlsx <-> pdf now that xlsxToPdf/pdfToXlsx exist, even though those functions compose ods<->xlsx + ods<->pdf internally', () => {
    expect(resolveConversionPath('xlsx', 'pdf')).toBe(DIRECT_EDGES.find((edge) => edge.source === 'xlsx' && edge.target === 'pdf'));
    expect(resolveConversionPath('pdf', 'xlsx')).toBe(DIRECT_EDGES.find((edge) => edge.source === 'pdf' && edge.target === 'xlsx'));
  });

  it('finds no path for xlsx <-> pdf over an edge set with no direct xlsx<->pdf edge, since the resolver no longer composes a multi-hop path', () => {
    const edgesWithoutDirectXlsxPdf = DIRECT_EDGES.filter((edge) => !(edge.source === 'xlsx' && edge.target === 'pdf') && !(edge.source === 'pdf' && edge.target === 'xlsx'));

    expect(resolveConversionPath('xlsx', 'pdf', edgesWithoutDirectXlsxPdf)).toBeUndefined();
    expect(resolveConversionPath('pdf', 'xlsx', edgesWithoutDirectXlsxPdf)).toBeUndefined();
  });

  it('finds no path at all when the target is odf -- no edge in DIRECT_EDGES ever targets it, so nothing can reach it, composed or otherwise', () => {
    // odf's own edge is one-way (odf -> pdf only, see FORMAT_CAPABILITIES.odf) -- so 'odf' never appears as a target anywhere in DIRECT_EDGES.
    expect(resolveConversionPath('pdf', 'odf')).toBeUndefined();
    expect(resolveConversionPath('docx', 'odf')).toBeUndefined();
    expect(resolveConversionPath('xlsx', 'odf')).toBeUndefined();
  });

  it('finds no direct path for odg -> xlsx, since the resolver no longer composes a multi-hop route via pdf', () => {
    expect(resolveConversionPath('odg', 'xlsx')).toBeUndefined();
  });
});
