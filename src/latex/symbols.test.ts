import type { ContentDocument } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import type { LatexDiagnostic } from './diagnostics';
import { extractSymbolDefinitionsFromProse } from './symbols';

// The prose scanner's conservatism is the point (precision over recall): every case below pins a boundary the matcher must respect -- the two where/let forms it reads, and the shapes it declines rather than mis-seeding the table.

function wordprocessing(paragraphs: readonly string[]): ContentDocument {
  return {
    kind: 'wordprocessing',
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: {},
    sections: [{ pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 }, blocks: paragraphs.map((text) => ({ kind: 'paragraph' as const, runs: [{ text }] })) }],
  };
}

describe('extractSymbolDefinitionsFromProse', () => {
  it('seeds a table entry from "where R is the resistance per unit length"', () => {
    const document = wordprocessing(['Consider a line. Where R is the resistance per unit length, the loss grows.']);
    const diagnostics: LatexDiagnostic[] = [];
    const entries = extractSymbolDefinitionsFromProse(document, (diagnostic) => diagnostics.push(diagnostic));
    expect(entries).toEqual([
      {
        glyph: 'R',
        scope: 'document',
        id: 'symbols:R',
        definitionSource: 'Where R is the resistance per unit length, the loss grows.',
      },
    ]);
    expect(diagnostics).toEqual([{ code: 'symbols/prose-definition-found', detail: '"R" from: Where R is the resistance per unit length, the loss grows.' }]);
  });

  it('seeds from "let x be the voltage" and Greek-letter subjects', () => {
    const document = wordprocessing(['Let x be the voltage across the load. Let α denote the attenuation constant.']);
    const entries = extractSymbolDefinitionsFromProse(document);
    expect(entries.map((entry) => entry.glyph)).toEqual(['x', 'α']);
    expect(entries.map((entry) => entry.id)).toEqual(['symbols:x', 'symbols:α']);
  });

  it('seeds an underscore-subscripted glyph whole (m_e), the table\'s own written-form convention', () => {
    const entries = extractSymbolDefinitionsFromProse(wordprocessing(['where m_e is the electron mass']));
    expect(entries.map((entry) => entry.glyph)).toEqual(['m_e']);
  });

  it('declines whole words -- "where the resistance is high" seeds nothing', () => {
    expect(extractSymbolDefinitionsFromProse(wordprocessing(['where the resistance is high']))).toEqual([]);
  });

  it('declines non-defining verbs -- "where R varies along the line" seeds nothing', () => {
    expect(extractSymbolDefinitionsFromProse(wordprocessing(['where R varies along the line']))).toEqual([]);
  });

  it('declines definitions buried mid-sentence without a where/let head', () => {
    expect(extractSymbolDefinitionsFromProse(wordprocessing(['The quantity R is the resistance per unit length.']))).toEqual([]);
  });

  it('keeps the first definition of a repeated glyph and reports each find through the sink', () => {
    const diagnostics: LatexDiagnostic[] = [];
    const entries = extractSymbolDefinitionsFromProse(wordprocessing(['where R is the resistance per unit length. where R is something else entirely.']), (diagnostic) => diagnostics.push(diagnostic));
    expect(entries).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
  });

  it('scans every section\'s paragraphs and ignores non-wordprocessing arms entirely', () => {
    const multiSection: ContentDocument = {
      kind: 'wordprocessing',
      formatVersion: CONTENT_FORMAT_VERSION,
      metadata: {},
      sections: [
        { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 }, blocks: [{ kind: 'paragraph', runs: [{ text: 'where a is one thing' }] }] },
        { pageSize: { widthPt: 595, heightPt: 842 }, margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 }, blocks: [{ kind: 'paragraph', runs: [{ text: 'unrelated prose' }] }, { kind: 'pageBreak' }] },
      ],
    };
    expect(extractSymbolDefinitionsFromProse(multiSection).map((entry) => entry.glyph)).toEqual(['a']);
    const formula: ContentDocument = { kind: 'formula', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, formula: { mathml: [] } };
    expect(extractSymbolDefinitionsFromProse(formula)).toEqual([]);
  });
});
