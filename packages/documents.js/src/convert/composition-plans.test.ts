import { encodeMarkdownText } from '../markdown/text';
import { createDocx } from '../edit/docx/editor';
import { minimalOdtBytes } from '../test-support/odt';
import { minimalOdpBytes } from '../test-support/odp';
import { richMarkdownText } from '../test-support/markdown';
import { describe, expect, it } from 'vitest';
import { convertDocument, resolveCompositionPlan } from './composition';
import type { DocumentFormat } from './port';
import { createLocalDocumentConverter } from './local';

describe('resolveCompositionPlan route verification', () => {
  // Every format pair the port exposes (minus the special-case odf -> pdf) must resolve. The pathfinder routes all pairs of non-odf formats within the 3-hop cap, so this covers every same-variant bridge, cross-variant transform, toPdf/fromPdf edge, and composed multi-hop route.
  const allSupportedPairs = createLocalDocumentConverter()
    .conversions.filter((pair) => !(pair.source === 'odf' && pair.target === 'pdf'));

  it('resolves every supported pair (no supported-pair regression)', () => {
    for (const { source, target } of allSupportedPairs) {
      const plan = resolveCompositionPlan(source, target);
      expect(plan, `${source} -> ${target}`).toBeDefined();
    }
  });

  it('same-variant pairs resolve as a single bridge hop (never through PDF)', () => {
    const sameVariant: [DocumentFormat, DocumentFormat][] = [
      ['docx', 'odt'], ['odt', 'docx'], ['docx', 'markdown'], ['odt', 'markdown'],
      ['markdown', 'docx'], ['markdown', 'odt'],
    ];
    for (const [s, t] of sameVariant) {
      const plan = resolveCompositionPlan(s, t)!;
      expect(plan.hops.length, `${s} -> ${t}`).toBe(1);
      expect(plan.hops[0]!.executor, `${s} -> ${t}`).toBe('bridge');
    }
  });

  it('cross-variant transform pairs resolve as a single bridge hop (never through PDF)', () => {
    // All wordprocessing <-> presentation pairs, including the ones the pathfinder newly routes (markdown <-> pptx, markdown <-> odp, docx <-> odp, odt <-> pptx) that were not in the former DIRECT_EDGES list.
    const crossVariant: [DocumentFormat, DocumentFormat][] = [
      ['docx', 'pptx'], ['pptx', 'docx'], ['odt', 'odp'], ['odp', 'odt'],
      ['docx', 'odp'], ['odp', 'docx'], ['odt', 'pptx'], ['pptx', 'odt'],
      ['markdown', 'pptx'], ['pptx', 'markdown'], ['markdown', 'odp'], ['odp', 'markdown'],
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

  it('xlsx -> markdown composes through ods and pdf (3 hops)', () => {
    const plan = resolveCompositionPlan('xlsx', 'markdown')!;
    expect(plan.hops).toHaveLength(3);
  });

  it('odg -> xlsx composes through pdf and ods (3 hops)', () => {
    const plan = resolveCompositionPlan('odg', 'xlsx')!;
    expect(plan.hops).toHaveLength(3);
  });

  it('odf -> pdf does NOT resolve (special-cased outside the composition engine)', () => {
    expect(resolveCompositionPlan('odf', 'pdf')).toBeUndefined();
  });
});

// --- Tests for the newly-exposed high-value cross-variant pairs (wordprocessing <-> presentation transform): these were unreachable through the former DIRECT_EDGES list (only docx<->pptx and odt<->odp were registered) but the pathfinder routes every wordprocessing-format <-> presentation-format pair through the same transform. Each test converts real fixture bytes through convertDocument and asserts the output is a valid package of the target format. ---

function isZip(bytes: Uint8Array<ArrayBuffer>): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

describe('convertDocument: newly-exposed cross-variant pairs', () => {
  it('markdown -> pptx produces a valid pptx package', () => {
    const bytes = convertDocument('markdown', 'pptx', encodeMarkdownText(richMarkdownText()));
    expect(isZip(bytes)).toBe(true);
  });

  it('pptx -> markdown produces non-empty markdown text', () => {
    const bytes = convertDocument('pptx', 'markdown', convertDocument('markdown', 'pptx', encodeMarkdownText(richMarkdownText())));
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('markdown -> odp produces a valid odp package', () => {
    const bytes = convertDocument('markdown', 'odp', encodeMarkdownText(richMarkdownText()));
    expect(isZip(bytes)).toBe(true);
  });

  it('odp -> markdown produces non-empty markdown text', () => {
    const bytes = convertDocument('odp', 'markdown', minimalOdpBytes());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('docx -> odp produces a valid odp package', () => {
    const editor = createDocx();
    editor.body.appendParagraph({ styleId: 'Heading1' }).appendRun({ text: 'Slide title' });
    editor.body.appendParagraph().appendRun({ text: 'Slide content' });
    const bytes = convertDocument('docx', 'odp', editor.toBytes());
    expect(isZip(bytes)).toBe(true);
  });

  it('odp -> docx produces a valid docx package', () => {
    const bytes = convertDocument('odp', 'docx', minimalOdpBytes());
    expect(isZip(bytes)).toBe(true);
  });

  it('odt -> pptx produces a valid pptx package', () => {
    const bytes = convertDocument('odt', 'pptx', minimalOdtBytes());
    expect(isZip(bytes)).toBe(true);
  });

  it('pptx -> odt produces a valid odt package', () => {
    const bytes = convertDocument('pptx', 'odt', minimalOdpBytes());
    expect(isZip(bytes)).toBe(true);
  });
});
