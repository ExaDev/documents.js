import { describe, expect, it } from 'vitest';
import {
  AnchorDescriptorSchema,
  ConstructDescriptorSchema,
  ContentControlDescriptorSchema,
  DivisionDescriptorSchema,
  FieldDescriptorSchema,
  LinkDescriptorSchema,
  ProvenanceDescriptorSchema,
  type ConstructDescriptor,
} from './construct';

// Each accepted case below is a real construct from one of the four inventories, spelled with the fields that inventory's own verdict row said the kind has to carry -- not a synthetic minimal object -- so a field quietly dropped from a descriptor fails here rather than at the codec that needed it.

describe('contentControl accepts the real control shapes the inventories name', () => {
  it('accepts a docx block SDT with its tag, alias, and lock (ooxml.js#65: w:sdtPr alias/tag/lock)', () => {
    const sdt: ConstructDescriptor = {
      kind: 'contentControl',
      controlType: 'richText',
      tag: 'ClientName',
      alias: 'Client name',
      lock: 'container',
    };
    expect(ContentControlDescriptorSchema.safeParse(sdt).success).toBe(true);
    expect(ConstructDescriptorSchema.safeParse(sdt).success).toBe(true);
  });

  it('accepts a legacy w:ffData checkbox and a ddList with its options (ooxml.js#65: checkbox/ddList/textInput)', () => {
    expect(
      ContentControlDescriptorSchema.safeParse({ kind: 'contentControl', controlType: 'checkbox', checked: true })
        .success,
    ).toBe(true);
    expect(
      ContentControlDescriptorSchema.safeParse({
        kind: 'contentControl',
        controlType: 'dropDown',
        options: ['Draft', 'Final'],
        value: 'Draft',
      }).success,
    ).toBe(true);
  });

  it('accepts a PDF AcroForm text widget and a non-terminal field-tree node (pdf-codec#66: /FT /Tx with /V, /Fields recursion)', () => {
    expect(
      ContentControlDescriptorSchema.safeParse({
        kind: 'contentControl',
        controlType: 'plainText',
        tag: 'address.line1',
        alias: 'Street address',
        value: '10 Downing Street',
        lock: 'content',
      }).success,
    ).toBe(true);
    expect(ContentControlDescriptorSchema.safeParse({ kind: 'contentControl', controlType: 'group' }).success).toBe(
      true,
    );
  });

  it('accepts an ODF index wrapper as a typed container (odf.js#59: text:table-of-content and kin)', () => {
    expect(
      ContentControlDescriptorSchema.safeParse({ kind: 'contentControl', controlType: 'index', alias: 'Table of Contents' })
        .success,
    ).toBe(true);
  });

  it('rejects near-misses: an unknown control type, an unknown lock, a non-string option, and an extra key', () => {
    expect(ContentControlDescriptorSchema.safeParse({ kind: 'contentControl', controlType: 'w:sdt' }).success).toBe(false);
    expect(
      ContentControlDescriptorSchema.safeParse({ kind: 'contentControl', controlType: 'richText', lock: 'readOnly' })
        .success,
    ).toBe(false);
    expect(
      ContentControlDescriptorSchema.safeParse({ kind: 'contentControl', controlType: 'dropDown', options: [1, 2] })
        .success,
    ).toBe(false);
    expect(
      ContentControlDescriptorSchema.safeParse({ kind: 'contentControl', controlType: 'richText', sdtPr: '<w:sdtPr/>' })
        .success,
    ).toBe(false);
  });

  it('rejects a control with no controlType -- the kind exists to say what kind of control produced the content', () => {
    expect(ContentControlDescriptorSchema.safeParse({ kind: 'contentControl' }).success).toBe(false);
  });
});

describe('field carries an instruction, with the cached scalar result beside it', () => {
  it('accepts a docx complex field and a pptx a:fld (ooxml.js#65: w:instrText, a:fld slidenum)', () => {
    expect(
      FieldDescriptorSchema.safeParse({ kind: 'field', instruction: 'TOC \\o "1-3" \\h \\z \\u' }).success,
    ).toBe(true);
    expect(FieldDescriptorSchema.safeParse({ kind: 'field', instruction: 'slidenum', cachedResult: '7' }).success).toBe(
      true,
    );
  });

  it('accepts an ODF simple field with its cached text (odf.js#59: text:page-number and the everyday family)', () => {
    expect(
      FieldDescriptorSchema.safeParse({ kind: 'field', instruction: 'text:page-number', cachedResult: '12' }).success,
    ).toBe(true);
  });

  it('rejects a field with no instruction, and one carrying an invented harmonised type', () => {
    expect(FieldDescriptorSchema.safeParse({ kind: 'field', cachedResult: '12' }).success).toBe(false);
    expect(
      FieldDescriptorSchema.safeParse({ kind: 'field', instruction: 'PAGE', fieldType: 'pageNumber' }).success,
    ).toBe(false);
  });
});

describe('anchor names an extent or a reference site, and points at its definition when it has one', () => {
  it('accepts a docx bookmark and an ODF text:bookmark (ooxml.js#65, odf.js#59)', () => {
    expect(AnchorDescriptorSchema.safeParse({ kind: 'anchor', anchorType: 'bookmark', name: '_Toc12345' }).success).toBe(
      true,
    );
  });

  it('accepts the marker-plus-definition split every inventory landed on: footnote, endnote, and comment markers', () => {
    for (const anchorType of ['footnote', 'endnote', 'comment'] as const) {
      expect(
        AnchorDescriptorSchema.safeParse({ kind: 'anchor', anchorType, name: '1', definition: 'n1' }).success,
      ).toBe(true);
    }
  });

  it('rejects an unnamed anchor and an unknown anchor type', () => {
    expect(AnchorDescriptorSchema.safeParse({ kind: 'anchor', anchorType: 'bookmark' }).success).toBe(false);
    expect(AnchorDescriptorSchema.safeParse({ kind: 'anchor', anchorType: 'annotation', name: 'a' }).success).toBe(false);
  });
});

describe('link carries the target vocabulary a flat run field cannot express', () => {
  it('accepts an external target with a markdown title (markdown-codec#63: link/image titles are dropped everywhere today)', () => {
    expect(
      LinkDescriptorSchema.safeParse({
        kind: 'link',
        target: { kind: 'external', uri: 'https://example.com' },
        title: 'Example home page',
      }).success,
    ).toBe(true);
  });

  it('accepts an internal target -- docx @w:anchor, a pptx slide jump, a PDF GoTo//Dest (the one new vocabulary #24 asks for)', () => {
    expect(
      LinkDescriptorSchema.safeParse({ kind: 'link', target: { kind: 'internal', anchor: '_Toc12345' } }).success,
    ).toBe(true);
  });

  it('rejects a target that names neither family, and a mixed target carrying both a uri and an anchor', () => {
    expect(LinkDescriptorSchema.safeParse({ kind: 'link', target: { uri: 'https://example.com' } }).success).toBe(false);
    expect(
      LinkDescriptorSchema.safeParse({
        kind: 'link',
        target: { kind: 'external', uri: 'https://example.com', anchor: '_Toc1' },
      }).success,
    ).toBe(false);
  });
});

describe('provenance records who changed what, and when', () => {
  it('accepts docx w:ins/w:del and ODF text:changed-region shapes, including the move pair', () => {
    for (const change of ['insertion', 'deletion', 'moveFrom', 'moveTo', 'formatChange'] as const) {
      expect(
        ProvenanceDescriptorSchema.safeParse({
          kind: 'provenance',
          change,
          author: 'A. Reviewer',
          dateIso: '2026-08-18T09:00:00Z',
        }).success,
      ).toBe(true);
    }
  });

  it('rejects an unknown change class and an anonymous wrapper with no change at all', () => {
    expect(ProvenanceDescriptorSchema.safeParse({ kind: 'provenance', change: 'w:ins' }).success).toBe(false);
    expect(ProvenanceDescriptorSchema.safeParse({ kind: 'provenance', author: 'A. Reviewer' }).success).toBe(false);
  });
});

describe('division is the ODF text:section shape, decided first-class rather than degraded', () => {
  it('accepts a named, protected, multi-column division (odf.js#59: columns, protection, naming)', () => {
    expect(
      DivisionDescriptorSchema.safeParse({ kind: 'division', name: 'Chapter1', columnCount: 2, protected: true })
        .success,
    ).toBe(true);
  });

  it('accepts the odm external-chapter link (odf.js#59: text:section-source href plus text:section-name)', () => {
    expect(
      DivisionDescriptorSchema.safeParse({
        kind: 'division',
        name: 'Chapter1',
        linked: { href: '../chapters/one.odt', sectionName: 'Body' },
      }).success,
    ).toBe(true);
  });

  it('accepts a bare division -- every field is optional because only ODF requires a name', () => {
    expect(DivisionDescriptorSchema.safeParse({ kind: 'division' }).success).toBe(true);
  });

  it('rejects a fractional or zero column count, and a linked link with no href', () => {
    expect(DivisionDescriptorSchema.safeParse({ kind: 'division', columnCount: 1.5 }).success).toBe(false);
    expect(DivisionDescriptorSchema.safeParse({ kind: 'division', columnCount: 0 }).success).toBe(false);
    expect(DivisionDescriptorSchema.safeParse({ kind: 'division', linked: { sectionName: 'Body' } }).success).toBe(false);
  });

  it('is not spelled "section" -- that kind is the page-geometry container descriptor, and one word cannot mean both', () => {
    expect(
      ConstructDescriptorSchema.safeParse({
        kind: 'section',
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
      }).success,
    ).toBe(false);
  });
});

describe('the construct descriptor union', () => {
  it('admits exactly the six kinds and nothing else', () => {
    const kinds = ['contentControl', 'field', 'anchor', 'link', 'provenance', 'division'];
    const descriptors: ConstructDescriptor[] = [
      { kind: 'contentControl', controlType: 'richText' },
      { kind: 'field', instruction: 'PAGE' },
      { kind: 'anchor', anchorType: 'bookmark', name: 'b1' },
      { kind: 'link', target: { kind: 'external', uri: 'https://example.com' } },
      { kind: 'provenance', change: 'insertion' },
      { kind: 'division' },
    ];
    expect(descriptors.map((descriptor) => descriptor.kind)).toEqual(kinds);
    for (const descriptor of descriptors) {
      expect(ConstructDescriptorSchema.safeParse(descriptor).success).toBe(true);
    }
    expect(ConstructDescriptorSchema.safeParse({ kind: 'residue', xml: '<w:proofErr/>' }).success).toBe(false);
  });

  it('survives a JSON round trip unchanged', () => {
    const descriptor: ConstructDescriptor = {
      kind: 'link',
      target: { kind: 'internal', anchor: 'destination-3' },
      title: 'Chapter 3',
    };
    const roundTripped: unknown = JSON.parse(JSON.stringify(descriptor));
    expect(ConstructDescriptorSchema.parse(roundTripped)).toEqual(descriptor);
  });
});

describe('the quarantined residue field on construct descriptors', () => {
  // A construct with no cross-format analogue degrades to the nearest semantic kind with its format-specific specifics quarantined in residue -- the descriptor IS the construct's node payload, so the descriptor carries the same per-node `source` field every content node carries, and a matched marker pair moves it across the flat/tree boundary untouched (the descriptor object is embedded, never copied). This is the channel reaching the descriptor's node position, not the descriptor-only escape hatch the module header warns against: the field, its shape, and its opacity contract are src/source.ts's, spelt identically everywhere.

  it('rides on every descriptor kind, including division, riding the flat form inside the constructStart marker\'s own descriptor payload', () => {
    const residue = { format: 'docx', xml: '<w:docPartObj><w:docPartGallery w:val="Cover Pages"/></w:docPartObj>' };
    const carriers = [
      { kind: 'contentControl', controlType: 'richText', source: residue },
      { kind: 'field', instruction: 'PAGE', source: residue },
      { kind: 'anchor', anchorType: 'bookmark', name: 'b1', source: residue },
      { kind: 'link', target: { kind: 'external', uri: 'https://example.com' }, source: residue },
      { kind: 'provenance', change: 'insertion', source: residue },
      { kind: 'division', source: residue },
    ];
    for (const descriptor of carriers) {
      expect(ConstructDescriptorSchema.safeParse(descriptor).success).toBe(true);
      const roundTripped: unknown = JSON.parse(JSON.stringify(descriptor));
      expect(ConstructDescriptorSchema.parse(roundTripped)).toEqual(descriptor);
    }
  });

  it('carries residue on division alongside its own linked external-chapter link, now that #743 freed `source` from that field', () => {
    expect(
      DivisionDescriptorSchema.safeParse({ kind: 'division', name: 'Ch1', source: { format: 'odt', xml: '<text:filter-name>x</text:filter-name>' } })
        .success,
    ).toBe(true);
    expect(
      DivisionDescriptorSchema.safeParse({
        kind: 'division',
        name: 'Ch1',
        linked: { href: 'chapter2.odt' },
        source: { format: 'odt', xml: '<text:filter-name>writer8</text:filter-name>' },
      }).success,
    ).toBe(true);
  });
});
