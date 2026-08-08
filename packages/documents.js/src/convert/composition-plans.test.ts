import { describe, expect, it } from 'vitest';
import { resolveCompositionPlan } from './composition';
import type { DocumentFormat } from './port';

describe('resolveCompositionPlan route verification', () => {
  // Every DIRECT_EDGES pair (except odf->pdf, which is special-cased) must resolve.
  const directPairs: [DocumentFormat, DocumentFormat][] = [
    ['docx', 'pdf'], ['odt', 'pdf'], ['pptx', 'pdf'], ['odp', 'pdf'],
    ['ods', 'pdf'], ['odg', 'pdf'], ['xlsx', 'pdf'], ['markdown', 'pdf'],
    ['pdf', 'docx'], ['pdf', 'odt'], ['pdf', 'pptx'], ['pdf', 'odp'],
    ['pdf', 'ods'], ['pdf', 'odg'], ['pdf', 'xlsx'], ['pdf', 'markdown'],
    ['odt', 'docx'], ['docx', 'odt'], ['odp', 'pptx'], ['pptx', 'odp'],
    ['ods', 'xlsx'], ['xlsx', 'ods'], ['markdown', 'docx'], ['docx', 'markdown'],
    ['markdown', 'odt'], ['odt', 'markdown'],
    ['docx', 'pptx'], ['pptx', 'docx'], ['odt', 'odp'], ['odp', 'odt'],
    ['xlsx', 'markdown'], ['markdown', 'xlsx'],
  ];
  it('resolves every DIRECT_EDGES pair (no supported-pair regression)', () => {
    for (const [s, t] of directPairs) {
      const plan = resolveCompositionPlan(s, t);
      expect(plan, `${s} -> ${t}`).toBeDefined();
    }
  });
  it('same-variant pairs resolve as a single bridge hop (never through PDF)', () => {
    const sameVariant: [DocumentFormat, DocumentFormat][] = [
      ['docx', 'odt'], ['odt', 'docx'], ['docx', 'markdown'], ['odt', 'markdown'],
    ];
    for (const [s, t] of sameVariant) {
      const plan = resolveCompositionPlan(s, t)!;
      expect(plan.hops.length, `${s} -> ${t}`).toBe(1);
      expect(plan.hops[0]!.executor, `${s} -> ${t}`).toBe('bridge');
    }
  });
  it('cross-variant transform pairs resolve as a single bridge hop (never through PDF)', () => {
    const crossVariant: [DocumentFormat, DocumentFormat][] = [
      ['docx', 'pptx'], ['pptx', 'docx'], ['odt', 'odp'], ['odp', 'odt'],
    ];
    for (const [s, t] of crossVariant) {
      const plan = resolveCompositionPlan(s, t)!;
      expect(plan.hops.length, `${s} -> ${t}`).toBe(1);
      expect(plan.hops[0]!.executor, `${s} -> ${t}`).toBe('bridge');
    }
  });
  it('xlsx <-> pdf composes through ods (2 hops), never a direct toPdf', () => {
    const xlsxToPdf = resolveCompositionPlan('xlsx', 'pdf')!;
    expect(xlsxToPdf.hops.map((h) => h.executor)).toEqual(['bridge', 'toPdf']);
    const pdfToXlsx = resolveCompositionPlan('pdf', 'xlsx')!;
    expect(pdfToXlsx.hops.map((h) => h.executor)).toEqual(['fromPdf', 'bridge']);
  });
  it('odf -> pdf does NOT resolve (special-cased outside the composition engine)', () => {
    expect(resolveCompositionPlan('odf', 'pdf')).toBeUndefined();
  });
});
