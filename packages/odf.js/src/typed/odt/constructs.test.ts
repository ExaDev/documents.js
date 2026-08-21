import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { flattenPackage } from 'document-schema.js';
import { readOdt, readOdtContent } from './read';

// The block-scope construct rows of the fidelity vocabulary (ExaDev/documents.js#719): text:section as a division, the TOC/index wrappers as index content controls, tracked changes as provenance, and the definitions-table tenants. Every fixture here is a programmatic package built with el/txt -- the fixture gate the issue itself states: real-producer verification for these constructs is outstanding, and the shapes below follow the OASIS ODF 1.2 element/attribute grammar rather than any single producer's output.

function odtPackage(textChildren: XmlElement[], automaticStyles: XmlElement[] = []): Package {
  return {
    parts: {
      'content.xml': {
        kind: 'xml',
        nodes: [el('office:document-content', {}, [el('office:automatic-styles', {}, automaticStyles), el('office:body', {}, [el('office:text', {}, textChildren)])])],
      },
    },
  };
}

function paragraph(text: string): XmlElement {
  return el('text:p', {}, [txt(text)]);
}

function firstSectionBlocks(pkg: Package) {
  const { sections } = readOdtContent(pkg);
  const section = sections[0];
  if (section === undefined) {
    throw new Error('expected at least one section');
  }
  return section.blocks;
}

describe('readOdtContent: text:section as a division construct', () => {
  it('brackets a section\'s blocks with a division constructStart/constructEnd pair carrying name and protected', () => {
    const pkg = odtPackage([
      paragraph('before'),
      el('text:section', { 'text:name': 'Chapter1', 'text:protected': 'true' }, [paragraph('inside')]),
      paragraph('after'),
    ]);
    expect(firstSectionBlocks(pkg)).toEqual([
      { kind: 'paragraph', runs: [{ text: 'before', bold: undefined, italic: undefined, underline: undefined, strike: undefined, fontFamily: undefined, sizePt: undefined, color: undefined }], styleId: undefined, alignment: undefined, spacingBeforePt: undefined, spacingAfterPt: undefined, lineSpacing: undefined, indentLeftPt: undefined, indentFirstLinePt: undefined },
      { kind: 'constructStart', descriptor: { kind: 'division', name: 'Chapter1', protected: true } },
      { kind: 'paragraph', runs: [{ text: 'inside', bold: undefined, italic: undefined, underline: undefined, strike: undefined, fontFamily: undefined, sizePt: undefined, color: undefined }], styleId: undefined, alignment: undefined, spacingBeforePt: undefined, spacingAfterPt: undefined, lineSpacing: undefined, indentLeftPt: undefined, indentFirstLinePt: undefined },
      { kind: 'constructEnd' },
      { kind: 'paragraph', runs: [{ text: 'after', bold: undefined, italic: undefined, underline: undefined, strike: undefined, fontFamily: undefined, sizePt: undefined, color: undefined }], styleId: undefined, alignment: undefined, spacingBeforePt: undefined, spacingAfterPt: undefined, lineSpacing: undefined, indentLeftPt: undefined, indentFirstLinePt: undefined },
    ]);
  });

  it('carries a text:section-source as division.source with its href and section-name', () => {
    const pkg = odtPackage([
      el('text:section', { 'text:name': 'LinkedChapter' }, [
        el('text:section-source', { 'xlink:href': '../chapter1.odt', 'text:section-name': 'InnerSection', 'text:filter-name': 'writer8' }),
        paragraph('cached'),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks[0]).toEqual({
      kind: 'constructStart',
      descriptor: { kind: 'division', name: 'LinkedChapter', source: { href: '../chapter1.odt', sectionName: 'InnerSection' } },
    });
  });

  it('reads the column count a section\'s own section-family style sets over its flow', () => {
    const sectionStyle = el('style:style', { 'style:name': 'Sect1', 'style:family': 'section' }, [
      el('style:section-properties', {}, [el('style:columns', { 'fo:column-count': '3' })]),
    ]);
    const pkg = odtPackage([el('text:section', { 'text:name': 'Columns', 'text:style-name': 'Sect1' }, [paragraph('columnar')])], [sectionStyle]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks[0]).toEqual({ kind: 'constructStart', descriptor: { kind: 'division', name: 'Columns', columnCount: 3 } });
  });

  it('nests a section inside a section as nested marker pairs', () => {
    const pkg = odtPackage([
      el('text:section', { 'text:name': 'Outer' }, [paragraph('outer text'), el('text:section', { 'text:name': 'Inner' }, [paragraph('inner text')])]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'constructStart', 'paragraph', 'constructEnd', 'constructEnd']);
  });

  it('survives the package boundary: flattenPackage(readOdt(pkg)) reproduces the flat reader\'s blocks with markers intact', () => {
    const pkg = odtPackage([
      el('text:section', { 'text:name': 'S1' }, [
        paragraph('first'),
        el('text:section', { 'text:name': 'S2' }, [paragraph('second')]),
      ]),
    ]);
    const flat = flattenPackage(readOdt(pkg));
    if (flat.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing document');
    }
    expect(flat.sections[0]?.blocks).toEqual(firstSectionBlocks(pkg));
  });
});

describe('readOdtContent: TOC and index wrappers as index content controls', () => {
  it('reads a text:table-of-content as an index contentControl bracketing its cached index-body blocks', () => {
    const pkg = odtPackage([
      el('text:table-of-content', { 'text:name': 'Table of Contents1' }, [
        el('text:table-of-content-source', { 'text:outline-level': '3' }),
        el('text:index-body', {}, [paragraph('Chapter One..........1')]),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'constructEnd']);
    if (blocks[0]?.kind !== 'constructStart') {
      throw new Error('expected a constructStart marker');
    }
    expect(blocks[0].descriptor).toEqual({
      kind: 'contentControl',
      controlType: 'index',
      tag: 'Table of Contents1',
      source: { format: 'odt', xml: '<text:table-of-content-source text:outline-level="3"></text:table-of-content-source>' },
    });
  });

  it('reads every index wrapper kind as the same index controlType, with the cached body and no wrapper-name fabrication', () => {
    for (const tag of ['text:alphabetical-index', 'text:bibliography', 'text:illustration-index', 'text:table-index', 'text:user-index', 'text:object-index']) {
      const pkg = odtPackage([
        el(tag, {}, [el('text:index-body', {}, [paragraph('entry')])]),
      ]);
      const blocks = firstSectionBlocks(pkg);
      expect(blocks.map((block) => block.kind), tag).toEqual(['constructStart', 'paragraph', 'constructEnd']);
      if (blocks[0]?.kind !== 'constructStart') {
        throw new Error('expected a constructStart marker');
      }
      expect(blocks[0].descriptor.kind, tag).toBe('contentControl');
      expect(blocks[0].descriptor.controlType, tag).toBe('index');
    }
  });

  it('reads an index-body\'s text:index-title blocks as ordinary cached body content', () => {
    const pkg = odtPackage([
      el('text:table-of-content', {}, [
        el('text:index-body', {}, [el('text:index-title', {}, [paragraph('Contents')]), paragraph('Chapter One..........1')]),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.filter((block) => block.kind === 'paragraph').map((block) => (block.kind === 'paragraph' ? block.runs[0]?.text : undefined))).toEqual(['Contents', 'Chapter One..........1']);
  });
});

describe('readOdtContent: tracked changes as provenance constructs', () => {
  const REGIONS: XmlElement[] = [
    el('text:tracked-changes', {}, [
      el('text:changed-region', { 'xml:id': 'ins1' }, [
        el('text:insertion', {}, [el('office:change-info', {}, [el('dc:creator', {}, [txt('A. Reviewer')]), el('dc:date', {}, [txt('2026-08-19T09:30:00')])])]),
      ]),
      el('text:changed-region', { 'xml:id': 'del1' }, [
        el('text:deletion', {}, [el('office:change-info', {}, [el('dc:creator', {}, [txt('D. Editor')]), el('dc:date', {}, [txt('2026-08-19T10:00:00')])])]),
      ]),
    ]),
  ];

  it('reads a point text:change as a run-level provenance extent resolved from its changed-region', () => {
    const pkg = odtPackage([...REGIONS, el('text:p', {}, [txt('inserted '), el('text:change', { 'text:change-id': 'ins1' }), txt('words')])]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks).toHaveLength(1);
    if (blocks[0]?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(blocks[0].constructs).toEqual([
      {
        descriptor: { kind: 'provenance', change: 'insertion', author: 'A. Reviewer', dateIso: '2026-08-19T09:30:00' },
        startRun: 1,
        endRun: 1,
      },
    ]);
  });

  it('pairs interior change-start/-end in one paragraph into a run-level provenance extent', () => {
    const pkg = odtPackage([
      ...REGIONS,
      el('text:p', {}, [txt('kept '), el('text:change-start', { 'text:change-id': 'del1' }), txt('deleted'), el('text:change-end', { 'text:change-id': 'del1' })]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    if (blocks[0]?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(blocks[0].constructs).toEqual([
      {
        descriptor: { kind: 'provenance', change: 'deletion', author: 'D. Editor', dateIso: '2026-08-19T10:00:00' },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it('brackets whole blocks with provenance markers when change-start leads one paragraph and change-end trails a later one', () => {
    const pkg = odtPackage([
      ...REGIONS,
      el('text:p', {}, [el('text:change-start', { 'text:change-id': 'ins1' }), txt('first inserted')]),
      el('text:p', {}, [txt('second inserted'), el('text:change-end', { 'text:change-id': 'ins1' })]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'paragraph', 'constructEnd']);
    if (blocks[0]?.kind !== 'constructStart') {
      throw new Error('expected a constructStart marker');
    }
    expect(blocks[0].descriptor).toEqual({ kind: 'provenance', change: 'insertion', author: 'A. Reviewer', dateIso: '2026-08-19T09:30:00' });
  });

  it('reads the region id spelled text:id (the ODF 1.0 form) as readily as xml:id', () => {
    const legacyRegions = [
      el('text:tracked-changes', {}, [
        el('text:changed-region', { 'text:id': 'fmt1' }, [
          el('text:format-change', {}, [el('office:change-info', {}, [el('dc:creator', {}, [txt('F. Stylist')])])]),
        ]),
      ]),
    ];
    const pkg = odtPackage([...legacyRegions, el('text:p', {}, [txt('restyled '), el('text:change', { 'text:change-id': 'fmt1' })])]);
    const blocks = firstSectionBlocks(pkg);
    if (blocks[0]?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(blocks[0].constructs).toEqual([
      { descriptor: { kind: 'provenance', change: 'formatChange', author: 'F. Stylist' }, startRun: 1, endRun: 1 },
    ]);
  });

  it('drops a change marker whose region id resolves to nothing, and contributes no blocks for the text:tracked-changes container itself', () => {
    const pkg = odtPackage([
      ...REGIONS,
      el('text:p', {}, [txt('orphan marker '), el('text:change', { 'text:change-id': 'nosuch' }), txt('here')]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks).toHaveLength(1);
    if (blocks[0]?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(blocks[0].constructs).toBeUndefined();
  });

  it('survives the package boundary with provenance markers intact', () => {
    const pkg = odtPackage([
      ...REGIONS,
      el('text:p', {}, [el('text:change-start', { 'text:change-id': 'del1' }), txt('gone')]),
      el('text:p', {}, [txt('also gone'), el('text:change-end', { 'text:change-id': 'del1' })]),
    ]);
    const flat = flattenPackage(readOdt(pkg));
    if (flat.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing document');
    }
    expect(flat.sections[0]?.blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'paragraph', 'constructEnd']);
  });
});

describe('readOdtContent: cross-paragraph bookmark pairing at block scope', () => {
  it('brackets the blocks a leading bookmark-start and a trailing bookmark-end span', () => {
    const pkg = odtPackage([
      el('text:p', {}, [el('text:bookmark-start', { 'text:name': 'range' }), txt('first')]),
      paragraph('middle'),
      el('text:p', {}, [txt('last'), el('text:bookmark-end', { 'text:name': 'range' })]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'paragraph', 'paragraph', 'constructEnd']);
    if (blocks[0]?.kind !== 'constructStart') {
      throw new Error('expected a constructStart marker');
    }
    expect(blocks[0].descriptor).toEqual({ kind: 'anchor', anchorType: 'bookmark', name: 'range' });
  });

  it('drops the later-opening extent of a genuinely crossing pair (bookmark opened before a section, closed inside it), keeping the earlier one -- the deterministic rule the docx reader applies to the identical shape', () => {
    const pkg = odtPackage([
      el('text:p', {}, [el('text:bookmark-start', { 'text:name': 'straddler' }), txt('before')]),
      el('text:section', { 'text:name': 'S' }, [
        el('text:p', {}, [txt('inside'), el('text:bookmark-end', { 'text:name': 'straddler' })]),
        paragraph('still inside'),
      ]),
      paragraph('after'),
    ]);
    const blocks = firstSectionBlocks(pkg);
    // The bookmark opens at block 0 and closes at 2; the division spans 1..3. The pair crosses, so exactly one survives: the bookmark, whose start precedes the division's -- the same outermost/earliest-start resolution acceptProperlyNested applies in the docx reader, and the drop document-schema.js ratifies for block-scoped crossings. The section's own blocks still read; only its wrapper marker is lost.
    expect(blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'paragraph', 'constructEnd', 'paragraph', 'paragraph']);
    if (blocks[0]?.kind !== 'constructStart') {
      throw new Error('expected a constructStart marker');
    }
    expect(blocks[0].descriptor).toEqual({ kind: 'anchor', anchorType: 'bookmark', name: 'straddler' });
  });
});

describe('readOdtContent: anchored draw:frames in text flow', () => {
  // A 1x1 transparent PNG -- the smallest bytes sniffImageFormat accepts as a real image part.
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  function imagePackage(): Package {
    return {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [
            el('office:document-content', {}, [
              el('office:body', {}, [
                el('office:text', {}, [
                  el('text:p', {}, [
                    txt('Text before the frame '),
                    el('draw:frame', { 'text:anchor-type': 'as-char', 'svg:width': '2cm', 'svg:height': '1cm' }, [
                      el('draw:image', { 'xlink:href': 'Pictures/image1.png' }),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ],
        },
        'Pictures/image1.png': { kind: 'binary', base64: PNG_BASE64 },
      },
    };
  }

  it('lifts an as-char image frame to a ContentImageBlock following its paragraph, sized by the frame', () => {
    const blocks = firstSectionBlocks(imagePackage());
    expect(blocks).toHaveLength(2);
    if (blocks[0]?.kind !== 'paragraph' || blocks[1]?.kind !== 'image') {
      throw new Error('expected a paragraph followed by a lifted image block');
    }
    expect(blocks[1].format).toBe('png');
    expect(blocks[1].widthPt).toBeCloseTo(56.7, 0);
    expect(blocks[1].heightPt).toBeCloseTo(28.35, 0);
  });

  it('splices a text-box frame\'s own blocks after its paragraph, in document order', () => {
    const pkg = odtPackage([
      el('text:p', {}, [
        txt('Body '),
        el('draw:frame', { 'svg:x': '1cm', 'svg:y': '2cm', 'svg:width': '4cm', 'svg:height': '2cm' }, [
          el('draw:text-box', {}, [el('text:p', {}, [txt('Box paragraph.')])]),
        ]),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph']);
    if (blocks[1]?.kind !== 'paragraph') {
      throw new Error('expected the text-box paragraph spliced after its anchor');
    }
    expect(blocks[1].runs[0]?.text).toBe('Box paragraph.');
  });

  it('reads an embedded formula frame as a ContentEmbeddedObjectBlock carrying the formula document', () => {
    const mathml = el('math', {}, [el('mrow', {}, [el('mi', {}, [txt('x')])])]);
    const pkg = odtPackage([
      el('text:p', {}, [
        el('draw:frame', { 'svg:x': '1cm', 'svg:y': '1cm', 'svg:width': '3cm', 'svg:height': '1cm' }, [
          el('draw:object', { 'xlink:href': './Object 1' }),
        ]),
      ]),
    ]);
    pkg.parts['Object 1/content.xml'] = { kind: 'xml', nodes: [mathml] };
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'embeddedObject']);
    if (blocks[1]?.kind !== 'embeddedObject') {
      throw new Error('expected an embedded object block');
    }
    expect(blocks[1].objectKind).toBe('formula');
    expect(blocks[1].document.kind).toBe('formula');
  });

  it('reads an embedded chart as a chart-kind object whose document is a frame-sized drawing page carrying the chart\'s cached data table, with the chart element quarantined in residue', () => {
    const pkg = odtPackage([
      el('text:p', {}, [
        el('draw:frame', { 'svg:x': '1cm', 'svg:y': '1cm', 'svg:width': '8cm', 'svg:height': '5cm' }, [
          el('draw:object', { 'xlink:href': './Object 2' }),
        ]),
      ]),
    ]);
    pkg.parts['Object 2/content.xml'] = {
      kind: 'xml',
      nodes: [
        el('office:document-content', {}, [
          el('office:body', {}, [
            el('office:chart', {}, [
              el('chart:chart', { 'chart:class': 'bar' }, [
                el('chart:plot-area', {}, [
                  el('table:table', { 'table:name': 'local-table' }, [
                    el('table:table-row', {}, [
                      el('table:table-cell', { 'office:value-type': 'string' }, [el('text:p', {}, [txt('Q1')])]),
                      el('table:table-cell', { 'office:value-type': 'float', 'office:value': '3' }, [el('text:p', {}, [txt('3')])]),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ],
    };
    const blocks = firstSectionBlocks(pkg);
    if (blocks[1]?.kind !== 'embeddedObject') {
      throw new Error('expected an embedded object block');
    }
    const embedded = blocks[1];
    expect(embedded.objectKind).toBe('chart');
    expect(embedded.document.kind).toBe('drawing');
    if (embedded.document.kind !== 'drawing') {
      throw new Error('expected a drawing document');
    }
    const page = embedded.document.pages[0];
    expect(page?.size.widthPt).toBeCloseTo(226.8, 0);
    expect(page?.size.heightPt).toBeCloseTo(141.75, 0);
    expect(page?.shapes[0]?.blocks[0]?.kind).toBe('table');
    expect(embedded.source?.format).toBe('odt');
    expect(embedded.source?.xml).toContain('<chart:chart chart:class="bar">');
  });
});

describe('readOdtContent: field master declarations as a definitions table', () => {
  it('reads variable, user-field, and sequence declarations into keyed definitions entries', () => {
    const pkg = odtPackage([
      el('text:variable-decls', {}, [
        el('text:variable-decl', { 'text:name': 'total', 'office:value-type': 'float' }),
      ]),
      el('text:user-field-decls', {}, [
        el('text:user-field-decl', { 'text:name': 'rate', 'office:value-type': 'percentage', 'office:value': '0.2', 'text:formula': 'oooc:=1/5' }),
      ]),
      el('text:sequence-decls', {}, [
        el('text:sequence-decl', { 'text:name': 'Illustration', 'text:display-outline-level': '0' }),
      ]),
      paragraph('body'),
    ]);
    const document = readOdtContent(pkg);
    expect(document.definitions).toEqual({
      'variable:total': { kind: 'fieldMaster', family: 'variable', name: 'total', valueType: 'float' },
      'user-field:rate': { kind: 'fieldMaster', family: 'user-field', name: 'rate', valueType: 'percentage', value: '0.2', formula: 'oooc:=1/5' },
      'sequence:Illustration': { kind: 'fieldMaster', family: 'sequence', name: 'Illustration', displayOutlineLevel: 0 },
    });
    expect(firstSectionBlocks(pkg)).toHaveLength(1);
  });

  it('carries the definitions table onto the assembled package root', () => {
    const pkg = odtPackage([
      el('text:sequence-decls', {}, [el('text:sequence-decl', { 'text:name': 'Table' })]),
      paragraph('body'),
    ]);
    expect(readOdt(pkg).definitions).toEqual({
      'sequence:Table': { kind: 'fieldMaster', family: 'sequence', name: 'Table' },
    });
  });

  it('mints note and annotation definitions alongside the field masters in one table, threaded from the block walk', () => {
    const pkg = odtPackage([
      el('text:p', {}, [
        txt('Claim'),
        el('text:note', { 'text:note-class': 'footnote', 'text:id': 'ftn1' }, [
          el('text:note-citation', {}, [txt('1')]),
          el('text:note-body', {}, [el('text:p', {}, [txt('The body.')])]),
        ]),
        el('office:annotation', { 'office:name': 'c1' }, [el('dc:creator', {}, [txt('R.')])]),
      ]),
      el('text:sequence-decls', {}, [el('text:sequence-decl', { 'text:name': 'Table' })]),
    ]);
    const document = readOdtContent(pkg);
    expect(Object.keys(document.definitions ?? {}).sort()).toEqual(['comment:c1', 'note:ftn1', 'sequence:Table']);
    expect(readOdt(pkg).definitions).toEqual(document.definitions);
  });
});
