import { describe, expect, it } from 'vitest';
import type { PdfDiagnostic } from './diagnostics';
import type { LayoutText } from './layout';
import { readPdf } from './read';
import { minimalClassicXrefPdf, parentTreeMissingEntryPdf, taggedStructureInvertedParentsPdf, taggedStructurePdf } from './test-support/pdf';

// Tagged structure (#760): the /StructTreeRoot element tree (the /K walk, /RoleMap resolution, /ClassMap attribute resolution, per-element /T //Lang //Alt //ActualText) and the (page, MCID) association through /ParentTree that stamps an owning element id onto extracted items -- each page keyed by its OWN /StructParents value, whose entry is an array of owning elements indexed by MCID (14.7.4.4). This is the one place PDF carries real semantics natively; everything downstream (documents.js's heading levels, division constructs, and lattice-free table recovery) is a consumer of these two facts.

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

  it('keys each page by its own /StructParents value, not its position in the page tree, and skips array entries that name no element', () => {
    const doc = readPdf(taggedStructureInvertedParentsPdf());
    const structureNames = (pageIndex: number): { text: string; structure?: string }[] =>
      doc.pages[pageIndex]!.items.filter((i): i is LayoutText => i.kind === 'text').map((t) => ({ text: t.text, ...(t.structure !== undefined ? { structure: t.structure } : {}) }));
    // Page 1 declares /StructParents 7 and page 2 declares /StructParents 0 -- the inverse of their indices; a reader keying by position hands each page the other page's element.
    expect(structureNames(0)).toEqual([{ text: 'First page', structure: 'struct1' }]);
    // Page 2's array opens with a null for an MCID no element owns, so its stream marks MCID 1.
    expect(structureNames(1)).toEqual([{ text: 'Second page', structure: 'struct2' }]);
  });

  it('reports a diagnostic when a page declares /StructParents the parent tree does not carry', () => {
    const diagnostics: PdfDiagnostic[] = [];
    const doc = readPdf(parentTreeMissingEntryPdf(), { sink: (d) => diagnostics.push(d) });
    expect(diagnostics.some((d) => d.code === 'pdf/parent-tree-missing-entry')).toBe(true);
    // The tree's key 0 names an owner for MCID 0, but the page declares /StructParents 4: no owner, and no accidental lookup through the position-shaped key either.
    expect(doc.pages[0]!.items[0]).not.toHaveProperty('structure');
  });
});
