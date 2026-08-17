import { describe, expect, it } from 'vitest';
import { FORMAT_CAPABILITIES } from './capability';
import { resolveCompositionPlan } from './composition';
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
    expect(new Set(byVariant.get('spreadsheet'))).toEqual(new Set(['xlsx', 'ods', 'csv']));
    expect(new Set(byVariant.get('drawing'))).toEqual(new Set(['odg', 'svg']));
  });

  it('marks xlsx and csv as the spreadsheet members with no layout path of their own (ods carries the layout edge)', () => {
    expect(FORMAT_CAPABILITIES.xlsx.variant).toBe('spreadsheet');
    expect(FORMAT_CAPABILITIES.xlsx.hasLayoutPath).toBe(false);
    expect(FORMAT_CAPABILITIES.csv.variant).toBe('spreadsheet');
    expect(FORMAT_CAPABILITIES.csv.hasLayoutPath).toBe(false);
    expect(FORMAT_CAPABILITIES.ods.variant).toBe('spreadsheet');
    expect(FORMAT_CAPABILITIES.ods.hasLayoutPath).toBe(true);
  });

  it('marks svg as the drawing family\'s plain-text member with its own layout path (a sibling of odg, not an ods-style composed member)', () => {
    expect(FORMAT_CAPABILITIES.svg.variant).toBe('drawing');
    expect(FORMAT_CAPABILITIES.svg.hasLayoutPath).toBe(true);
  });

  it('has no undefined-variant format other than pdf and odf reporting a layout path', () => {
    for (const capability of Object.values(FORMAT_CAPABILITIES)) {
      if (capability.variant === undefined) {
        expect(capability.hasLayoutPath).toBe(false);
      }
    }
  });
});

describe('resolveCompositionPlan', () => {
  it('routes a same-variant pair as a single bridge hop (never through PDF)', () => {
    // docx -> odt: both wordprocessing, so the pathfinder prefers the cost-1 bridge over any PDF route.
    const plan = resolveCompositionPlan('docx', 'odt');
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe('bridge');
    expect(plan!.hops[0]!.from).toBe('docx');
    expect(plan!.hops[0]!.to).toBe('odt');
  });

  it('routes a cross-variant transform pair as a single bridge hop (never through PDF)', () => {
    // docx (wordprocessing) -> pptx (presentation): the wordprocessing->presentation transform is registered, so the pathfinder routes it as a cost-2 bridge, beating any PDF route (cost 3 + 3 = 6).
    const plan = resolveCompositionPlan('docx', 'pptx');
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe('bridge');
  });

  it('routes a toPdf pair as a single toPdf hop', () => {
    const plan = resolveCompositionPlan('docx', 'pdf');
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe('toPdf');
  });

  it('routes a fromPdf pair as a single fromPdf hop', () => {
    const plan = resolveCompositionPlan('pdf', 'docx');
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe('fromPdf');
  });

  it('composes xlsx -> pdf through ods (bridge then toPdf), since xlsx has no layout engine of its own', () => {
    const plan = resolveCompositionPlan('xlsx', 'pdf');
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(['bridge', 'toPdf']);
    expect(plan!.hops[0]!.from).toBe('xlsx');
    expect(plan!.hops[0]!.to).toBe('ods');
    expect(plan!.hops[1]!.from).toBe('ods');
    expect(plan!.hops[1]!.to).toBe('pdf');
  });

  it('composes pdf -> xlsx through ods (fromPdf then bridge)', () => {
    const plan = resolveCompositionPlan('pdf', 'xlsx');
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(['fromPdf', 'bridge']);
  });

  it('composes csv -> pdf through ods (bridge then toPdf), since csv has no layout engine of its own', () => {
    const plan = resolveCompositionPlan('csv', 'pdf');
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(['bridge', 'toPdf']);
    expect(plan!.hops[0]!.from).toBe('csv');
    expect(plan!.hops[0]!.to).toBe('ods');
    expect(plan!.hops[1]!.from).toBe('ods');
    expect(plan!.hops[1]!.to).toBe('pdf');
  });

  it('composes pdf -> csv through ods (fromPdf then bridge)', () => {
    const plan = resolveCompositionPlan('pdf', 'csv');
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(['fromPdf', 'bridge']);
  });

  it('routes svg -> pdf as a single toPdf hop, since svg rides the drawing layout engine odg feeds', () => {
    const plan = resolveCompositionPlan('svg', 'pdf');
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe('toPdf');
    expect(plan!.hops[0]!.from).toBe('svg');
    expect(plan!.hops[0]!.to).toBe('pdf');
  });

  it('routes pdf -> svg as a single fromPdf hop', () => {
    const plan = resolveCompositionPlan('pdf', 'svg');
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe('fromPdf');
    expect(plan!.hops[0]!.from).toBe('pdf');
    expect(plan!.hops[0]!.to).toBe('svg');
  });

  it('routes svg -> odg as a single same-variant bridge hop (the drawing family\'s plain-text member)', () => {
    const plan = resolveCompositionPlan('svg', 'odg');
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe('bridge');
    expect(plan!.hops[0]!.from).toBe('svg');
    expect(plan!.hops[0]!.to).toBe('odg');
  });

  it('composes csv -> markdown through ods and pdf (three hops), mirroring the xlsx -> markdown last-resort route', () => {
    const plan = resolveCompositionPlan('csv', 'markdown');
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(3);
  });

  it('composes xlsx -> markdown through ods and pdf (three hops), the lossiest route in the package', () => {
    const plan = resolveCompositionPlan('xlsx', 'markdown');
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(3);
  });

  it('prefers a native bridge over a PDF route for docx -> odt (cost 1 beats cost 6)', () => {
    // The pathfinder must prefer the direct same-variant bridge (cost 1) over a docx -> pdf -> odt route (cost 3 + 3 = 6).
    const plan = resolveCompositionPlan('docx', 'odt');
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe('bridge');
  });

  it('prefers a cross-variant transform bridge over a PDF route for docx -> odp (cost 2 beats cost 6)', () => {
    // docx (wordprocessing) -> odp (presentation): the transform bridge costs 2, the PDF route would cost 6.
    const plan = resolveCompositionPlan('docx', 'odp');
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe('bridge');
  });

  it('returns undefined for same-format pairs', () => {
    for (const format of Object.keys(FORMAT_CAPABILITIES) as DocumentFormat[]) {
      expect(resolveCompositionPlan(format, format)).toBeUndefined();
    }
  });

  it('returns undefined for odf -> pdf (deliberately excluded from the composition engine)', () => {
    // odf is a standalone formula document that renders through src/mathml's own formula-positioning path, not a ContentDocument -> LayoutDocument layout engine. The pathfinder excludes it; local.ts special-cases it with the hand-written odfToPdf.
    expect(resolveCompositionPlan('odf', 'pdf')).toBeUndefined();
  });

  it('returns undefined when odf is the target -- nothing in the composition graph routes to it', () => {
    expect(resolveCompositionPlan('pdf', 'odf')).toBeUndefined();
    expect(resolveCompositionPlan('docx', 'odf')).toBeUndefined();
    expect(resolveCompositionPlan('xlsx', 'odf')).toBeUndefined();
  });
});
