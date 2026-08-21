import { describe, expect, it } from 'vitest';
import type { LayoutText } from './layout';
import { readPdf } from './read';
import { minimalClassicXrefPdf, taggedStructurePdf } from './test-support/pdf';

// Tagged structure (#760): the /StructTreeRoot element tree (the /K walk, /RoleMap resolution, /ClassMap attribute resolution, per-element /T //Lang //Alt //ActualText) and the (page, MCID) association through /ParentTree that stamps an owning element id onto extracted items. This is the one place PDF carries real semantics natively; everything downstream (documents.js's heading levels, division constructs, and lattice-free table recovery) is a consumer of these two facts.

describe('readPdf: tagged structure tree', () => {
  it('reads the element tree with reader-minted ids, role-mapped types, and element attributes', () => {
    const doc = readPdf(taggedStructurePdf());
    expect(doc.structure).toEqual([
      { id: 'struct1', type: 'H1', title: 'Opening', children: [] },
      { id: 'struct2', type: 'P', language: 'en', children: [] },
      {
        id: 'struct3',
        type: 'Table',
        alt: 'Quarterly figures',
        children: [
          {
            id: 'struct4',
            type: 'TR',
            children: [
              { id: 'struct5', type: 'TH', children: [] },
              { id: 'struct6', type: 'TH', children: [] },
            ],
          },
          {
            id: 'struct7',
            type: 'TR',
            children: [
              { id: 'struct8', type: 'TD', children: [] },
              { id: 'struct9', type: 'TD', actualText: 'Quatre', children: [] },
            ],
          },
        ],
      },
      { id: 'struct10', type: 'Sect', title: 'Section deux', language: 'fr', children: [{ id: 'struct11', type: 'P', children: [] }] },
      { id: 'struct12', type: 'Aside', children: [] },
    ]);
  });

  it('leaves the structure field absent in an untagged document', () => {
    const doc = readPdf(minimalClassicXrefPdf());
    expect(doc.structure).toBeUndefined();
    expect(doc.pages[0]!.items[0]).not.toHaveProperty('structure');
  });
});

describe('readPdf: marked-content association', () => {
  it('stamps each item inside a /MCID span with its owning element id, keyed per page', () => {
    const doc = readPdf(taggedStructurePdf());
    const structureNames = (pageIndex: number): { text: string; structure?: string }[] =>
      doc.pages[pageIndex]!.items.filter((i): i is LayoutText => i.kind === 'text').map((t) => ({ text: t.text, ...(t.structure !== undefined ? { structure: t.structure } : {}) }));
    expect(structureNames(0)).toEqual([
      { text: 'Chapter title', structure: 'struct1' },
      { text: 'Body paragraph', structure: 'struct2' },
      { text: 'Name', structure: 'struct5' },
      { text: 'Value', structure: 'struct6' },
      { text: 'Alpha', structure: 'struct8' },
      { text: 'One', structure: 'struct9' },
    ]);
    // MCID 0 on page 2 belongs to a different element than MCID 0 on page 1 -- and unmarked text carries no field at all.
    expect(structureNames(1)).toEqual([
      { text: 'Paragraphe francais', structure: 'struct11' },
      { text: 'Untagged' },
    ]);
  });
});
