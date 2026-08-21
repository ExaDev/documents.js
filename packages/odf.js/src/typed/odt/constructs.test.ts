import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { flattenPackage } from 'document-schema.js';
import type { ContentParagraph } from 'document-schema.js';
import { readOdt, readOdtContent } from './read';

// DefinitionEntry's body is deliberately tenant-open (document-schema.js's definitions.ts), so a test reading an entry's body as block content narrows it itself rather than asserting.
function entryParagraphs(key: string, definitions: ReturnType<typeof readOdtContent>['definitions']): ContentParagraph[] {
  const body = definitions?.[key]?.body;
  if (!Array.isArray(body) || !body.every((block: unknown): block is ContentParagraph => typeof block === 'object' && block !== null && 'kind' in block && 'runs' in block && block.kind === 'paragraph')) {
    throw new Error(`expected a paragraph-only definitions body for ${key}`);
  }
  return body;
}

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

  it('places a nested section\'s marker pair over the nested section\'s own blocks when a paragraph precedes the outer wrapper', () => {
    // The nested wrapper's extent must be indexed against the ONE flat block list, not the recursive call's own local array: with 'before' occupying block 0, Inner's pair belongs around 'inner text' (inside Outer), and Outer's around everything of its own -- never around 'before'.
    const pkg = odtPackage([
      paragraph('before'),
      el('text:section', { 'text:name': 'Outer' }, [el('text:section', { 'text:name': 'Inner' }, [paragraph('inner text')])]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'constructStart', 'constructStart', 'paragraph', 'constructEnd', 'constructEnd']);
    const descriptors = blocks.filter((block) => block.kind === 'constructStart').map((block) => (block.kind === 'constructStart' ? block.descriptor : undefined));
    expect(descriptors).toEqual([{ kind: 'division', name: 'Outer' }, { kind: 'division', name: 'Inner' }]);
  });

  it('places a nested index wrapper\'s marker pair over its cached body blocks when a paragraph precedes the enclosing section', () => {
    const pkg = odtPackage([
      paragraph('before'),
      el('text:section', { 'text:name': 'S' }, [
        el('text:table-of-content', { 'text:name': 'TOC' }, [el('text:index-body', {}, [paragraph('entry')])]),
      ]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'constructStart', 'constructStart', 'paragraph', 'constructEnd', 'constructEnd']);
    const descriptors = blocks.filter((block) => block.kind === 'constructStart').map((block) => (block.kind === 'constructStart' ? block.descriptor : undefined));
    expect(descriptors).toEqual([{ kind: 'division', name: 'S' }, { kind: 'contentControl', controlType: 'index', tag: 'TOC' }]);
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
      const descriptor = blocks[0].descriptor;
      expect(descriptor.kind, tag).toBe('contentControl');
      if (descriptor.kind !== 'contentControl') {
        throw new Error('expected a content control descriptor');
      }
      expect(descriptor.controlType, tag).toBe('index');
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

  it('contributes nothing for frames at all under frames: \'none\' -- the opt-out a consumer with its own frame-detection passes takes', () => {
    const { sections } = readOdtContent(imagePackage(), { frames: 'none' });
    expect(sections[0]?.blocks).toHaveLength(1);
    expect(sections[0]?.blocks[0]?.kind).toBe('paragraph');
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

  it('extends a block-scoped bookmark ending after a paragraph\'s anchored frame over that frame\'s lifted block', () => {
    // The bookmark-end physically follows the frame in the paragraph's own child order, so the bookmark's block extent covers the paragraph AND the frame's lifted block -- the lifted encoding places those blocks after the paragraph precisely because they sat inside the bookmark's physical range.
    const pkg = odtPackage([
      el('text:p', {}, [
        el('text:bookmark-start', { 'text:name': 'around-frame' }),
        txt('Anchoring text '),
        el('draw:frame', { 'text:anchor-type': 'as-char', 'svg:width': '2cm', 'svg:height': '1cm' }, [
          el('draw:image', { 'xlink:href': 'Pictures/image1.png' }),
        ]),
        el('text:bookmark-end', { 'text:name': 'around-frame' }),
      ]),
      paragraph('after'),
    ]);
    pkg.parts['Pictures/image1.png'] = { kind: 'binary', base64: PNG_BASE64 };
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'image', 'constructEnd', 'paragraph']);
    if (blocks[0]?.kind !== 'constructStart') {
      throw new Error('expected the bookmark\'s constructStart marker');
    }
    expect(blocks[0].descriptor).toEqual({ kind: 'anchor', anchorType: 'bookmark', name: 'around-frame' });
  });

  it('excludes a paragraph\'s lifted frame from a bookmark whose end physically precedes the frame', () => {
    // The frame follows the bookmark-end in child order, so it sits outside the bookmark's physical range even though a draw:frame is not "content" for the paragraph-edge test -- the trailing half's extent stops before the lifted block.
    const pkg = odtPackage([
      el('text:p', {}, [
        el('text:bookmark-start', { 'text:name': 'before-frame' }),
        txt('Anchoring text '),
        el('text:bookmark-end', { 'text:name': 'before-frame' }),
        el('draw:frame', { 'text:anchor-type': 'as-char', 'svg:width': '2cm', 'svg:height': '1cm' }, [
          el('draw:image', { 'xlink:href': 'Pictures/image1.png' }),
        ]),
      ]),
      paragraph('after'),
    ]);
    pkg.parts['Pictures/image1.png'] = { kind: 'binary', base64: PNG_BASE64 };
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'constructEnd', 'image', 'paragraph']);
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

  it('reads an embedded spreadsheet (a Calc OLE object) as a ContentEmbeddedObjectBlock carrying the live sheet, not the frame\'s ObjectReplacements preview', () => {
    // Insert > Object > OLE Object > Spreadsheet in Writer: the frame carries BOTH a draw:object pointing at the sub-document directory and the usual ObjectReplacements preview draw:image beside it (typed/draw/embedded.ts's own confirmed real-output note), so the object must be checked first -- the block below is the sub-sheet read by ods's own reader, the odt->ods dispatch edge whose absence used to degrade this frame to its preview image.
    const pkg = odtPackage([
      el('text:p', {}, [
        txt('Quarterly figures '),
        el('draw:frame', { 'svg:x': '1cm', 'svg:y': '1cm', 'svg:width': '6cm', 'svg:height': '3cm' }, [
          el('draw:object', { 'xlink:href': './Object 3' }),
          el('draw:image', { 'xlink:href': 'ObjectReplacements/Object 3' }),
        ]),
      ]),
    ]);
    pkg.parts['Object 3/content.xml'] = {
      kind: 'xml',
      nodes: [
        el('office:document-content', {}, [
          el('office:body', {}, [
            el('office:spreadsheet', {}, [
              el('table:table', { 'table:name': 'Sheet1' }, [
                el('table:table-row', {}, [
                  el('table:table-cell', { 'office:value-type': 'float', 'office:value': '4' }, [el('text:p', {}, [txt('4')])]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ],
    };
    pkg.parts['ObjectReplacements/Object 3'] = { kind: 'binary', base64: PNG_BASE64 };
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'embeddedObject']);
    if (blocks[1]?.kind !== 'embeddedObject') {
      throw new Error('expected an embedded object block');
    }
    expect(blocks[1].objectKind).toBe('spreadsheet');
    expect(blocks[1].document.kind).toBe('spreadsheet');
    if (blocks[1].document.kind !== 'spreadsheet') {
      throw new Error('expected a spreadsheet document');
    }
    expect(blocks[1].document.sheets).toHaveLength(1);
    expect(blocks[1].document.sheets[0]?.name).toBe('Sheet1');
    expect(blocks[1].document.sheets[0]?.cells[0]?.value).toEqual({ kind: 'number', value: 4 });
    expect(blocks[1].frame.widthPt).toBeCloseTo(170.1, 0);
  });
});

describe('readOdtContent: office:forms in an ordinary text document', () => {
  it('reads the form tree as a pre-order sequence of point contentControl constructs, control kinds mapped from their form: tags and names as tags', () => {
    const pkg = odtPackage([
      paragraph('Text around the form.'),
      el('office:forms', {}, [
        el('form:form', { 'form:name': 'MainForm', 'form:command': '"customers"', 'form:command-type': 'table' }, [
          el('form:properties', {}, [el('form:property', { 'form:property-name': 'ObjIDinMSO', 'office:value': '1' })]),
          el('form:text', { 'form:name': 'firstName', 'form:data-field': 'first_name', 'form:current-value': 'Ada' }),
          el('form:checkbox', { 'form:name': 'active', 'form:current-state': 'checked' }),
          el('form:listbox', { 'form:name': 'tier' }),
          el('form:unknown-kind', { 'form:name': 'mystery' }),
        ]),
      ]),
      paragraph('Text after the form.'),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'constructStart',
      'constructEnd',
      'constructStart',
      'constructEnd',
      'constructStart',
      'constructEnd',
      'constructStart',
      'constructEnd',
      'constructStart',
      'constructEnd',
      'paragraph',
    ]);
    const descriptors = blocks.filter((block) => block.kind === 'constructStart').map((block) => (block.kind === 'constructStart' ? block.descriptor : undefined));
    expect(descriptors[0]).toMatchObject({ kind: 'contentControl', controlType: 'group', tag: 'MainForm' });
    expect(descriptors[1]).toMatchObject({ kind: 'contentControl', controlType: 'plainText', tag: 'firstName', value: 'Ada' });
    expect(descriptors[2]).toMatchObject({ kind: 'contentControl', controlType: 'checkbox', tag: 'active', checked: true });
    expect(descriptors[3]).toMatchObject({ kind: 'contentControl', controlType: 'dropDown', tag: 'tier' });
    expect(descriptors[4]).toMatchObject({ kind: 'contentControl', controlType: 'richText', tag: 'mystery' });
    // The form:properties bag quarantines into residue, and an unrecognised control kind quarantines its whole element.
    expect(descriptors[0]?.source).toMatchObject({ format: 'odt' });
    expect(descriptors[4]?.source).toMatchObject({ format: 'odt' });
    expect(descriptors[1]?.source).toBeUndefined();
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

  it('reads number:* data styles and office:font-face-decls from both parts into the same definitions table', () => {
    const pkg = odtPackage([paragraph('body')]);
    // content.xml's own automatic styles gain a data style; styles.xml declares the font faces.
    const contentRoot = pkg.parts['content.xml'];
    if (contentRoot?.kind !== 'xml') {
      throw new Error('expected an xml content part');
    }
    const documentContent = contentRoot.nodes[0];
    if (documentContent?.type !== 'element') {
      throw new Error('expected a document-content root');
    }
    documentContent.children.unshift(
      el('office:automatic-styles', {}, [
        el('number:currency-style', { 'style:name': 'GBP' }, [el('number:currency-symbol', { 'number:language': 'en', 'number:country': 'GB' }, [txt('\u00a3')]), el('number:number', { 'number:decimal-places': '2' })]),
      ]),
    );
    pkg.parts['styles.xml'] = {
      kind: 'xml',
      nodes: [
        el('office:document-styles', {}, [
          el('office:font-face-decls', {}, [el('style:font-face', { 'style:name': 'Liberation Serif', 'svg:font-family': '\u201cLiberation Serif\u201d', 'style:font-family-generic': 'roman', 'style:font-pitch': 'variable' })]),
        ]),
      ],
    };
    const document = readOdtContent(pkg);
    expect(document.definitions?.['dataStyle:GBP']).toMatchObject({ kind: 'dataStyle', name: 'GBP' });
    expect((document.definitions?.['dataStyle:GBP'] as { xml?: string }).xml).toContain('<number:currency-style');
    expect(document.definitions?.['fontFace:Liberation Serif']).toEqual({
      kind: 'fontFace',
      name: 'Liberation Serif',
      fontFamily: '\u201cLiberation Serif\u201d',
      familyGeneric: 'roman',
      pitch: 'variable',
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

  it('mints every note-body list\'s numId from one document-wide counter, so no two lists in the document share an identity', () => {
    const noteWithList = (id: string, citation: string): XmlElement =>
      el('text:note', { 'text:note-class': 'footnote', 'text:id': id }, [
        el('text:note-citation', {}, [txt(citation)]),
        el('text:note-body', {}, [el('text:list', {}, [el('text:list-item', {}, [el('text:p', {}, [txt('note list item')])])])]),
      ]);
    const pkg = odtPackage([
      el('text:p', {}, [txt('one'), noteWithList('ftn1', '1')]),
      el('text:p', {}, [txt('two'), noteWithList('ftn2', '2')]),
      el('text:list', {}, [el('text:list-item', {}, [el('text:p', {}, [txt('body list item')])])]),
    ]);
    const { sections, definitions } = readOdtContent(pkg);
    const noteBodyNumId = (key: string): string => entryParagraphs(key, definitions)[0]?.list?.numId ?? 'missing';
    const bodyListNumId = sections[0]?.blocks.map((block) => (block.kind === 'paragraph' ? block.list?.numId : undefined)).find((numId) => numId !== undefined);
    if (bodyListNumId === undefined) {
      throw new Error('expected the body list item paragraph');
    }
    const numIds = [noteBodyNumId('note:ftn1'), noteBodyNumId('note:ftn2'), bodyListNumId];
    // numId is an identity (list.ts's own header invariant: different text:list elements get different numIds), so all three must be pairwise distinct -- two notes' bodies are different lists exactly as a note body and the main body are.
    expect(new Set(numIds).size).toBe(3);
  });
});

// The quarantined residue rows that landed outside #764's slice (ExaDev/documents.js#769): inline constructs with no cross-format analogue (ruby, meta, the is-list-header flag) quarantine on their own paragraph; document-level tenants nothing else owns (xforms models, DDE declarations and links, vendor-extension elements) quarantine at the package tier; and the non-content parts quarantine at the package tier keyed by part path. Every fixture is programmatic, built to the OASIS grammar.
describe('readOdtContent: residue rows', () => {
  it('quarantines an xforms:model inside office:forms at the package tier, keyed xforms', () => {
    const pkg = odtPackage([
      el('office:forms', {}, [
        el('xforms:model', { id: 'Model1' }, [el('xforms:instance')]),
      ]),
    ]);
    const { source } = readOdtContent(pkg);
    expect(source?.xforms).toMatchObject({ format: 'odt' });
    expect(source?.xforms?.xml).toContain('<xforms:model id="Model1">');
  });

  it('quarantines a vendor-extension-namespace element at the package tier, keyed by its own tag', () => {
    const pkg = odtPackage([el('loext:content', {}, [txt('extension content')])]);
    const { source } = readOdtContent(pkg);
    expect(source?.['loext:content']?.format).toBe('odt');
    expect(source?.['loext:content']?.xml).toContain('<loext:content>');
  });

  it('quarantines DDE connection declarations and a section\'s text:dde-source at the package tier under their own keys', () => {
    const pkg = odtPackage([
      el('text:dde-connection-decls', {}, [
        el('text:dde-connection-decl', { 'text:name': 'conn1', 'office:dde-application': 'soffice', 'office:dde-topic': './tmp/topic', 'office:dde-item': 'item' }),
      ]),
      el('text:section', { 'text:name': 'Linked' }, [
        el('text:dde-source', { 'text:connection-name': 'conn1', 'text:dde-application': 'soffice' }),
        el('text:p', {}, [txt('cached')]),
      ]),
    ]);
    const { source } = readOdtContent(pkg);
    expect(source?.['dde-connections']?.xml).toContain('text:dde-connection-decl');
    expect(source?.['dde-links']?.xml).toContain('text:dde-source');
  });

  it('quarantines text:ruby and text:meta inline elements on their own paragraph, reading only the ruby-base as flow text', () => {
    const pkg = odtPackage([
      el('text:p', {}, [txt('annotated '), el('text:ruby', {}, [el('text:ruby-base', {}, [txt('base')]), el('text:ruby-text', {}, [txt('gloss')])]), el('text:meta', { 'text:xml-id': 'meta1' }, [txt(' after')])]),
    ]);
    const paragraphBlock = firstSectionBlocks(pkg)[0];
    if (paragraphBlock?.kind !== 'paragraph') {
      throw new Error('expected a paragraph block');
    }
    // The ruby-BASE renders as flow text and the meta's wrapped content stays in the flow; the ruby-TEXT gloss is annotation, not body text, so it appears in the residue alone.
    expect(paragraphBlock.runs.map((run) => run.text).join('')).toBe('annotated base after');
    expect(paragraphBlock.source?.format).toBe('odt');
    expect(paragraphBlock.source?.xml).toContain('<text:ruby>');
    expect(paragraphBlock.source?.xml).toContain('<text:ruby-text');
    expect(paragraphBlock.source?.xml).toContain('<text:meta');
  });

  it('quarantines a heading\'s text:is-list-header attribute as the heading paragraph\'s own residue', () => {
    const pkg = odtPackage([el('text:h', { 'text:outline-level': '1', 'text:is-list-header': 'true' }, [txt('List header heading')])]);
    const heading = firstSectionBlocks(pkg)[0];
    if (heading?.kind !== 'paragraph') {
      throw new Error('expected a paragraph block');
    }
    expect(heading.source?.xml).toContain('<text:h text:is-list-header="true"></text:h>');
  });

  it('quarantines a non-content XML part at the package tier keyed by its part path, and never the parts the reader consumes', () => {
    const pkg = odtPackage([el('text:p', {}, [txt('body')])]);
    pkg.parts['settings.xml'] = { kind: 'xml', nodes: [el('office:document-settings', {}, [el('config:config-item-set', { 'config:name': 'view-settings' })])] };
    pkg.parts['meta.xml'] = { kind: 'xml', nodes: [el('office:document-meta', {}, [el('meta:generator', {}, [txt('LibreOffice')])])] };
    pkg.parts['Thumbnails/thumbnail.png'] = { kind: 'binary', base64: 'iFA=' };
    const { source } = readOdtContent(pkg);
    expect(Object.keys(source ?? {}).sort()).toEqual(['settings.xml']);
    expect(source?.['settings.xml']?.xml).toContain('<office:document-settings');
  });

  it('splices the package-tier residue table onto readOdt\'s assembled package root', () => {
    const pkg = odtPackage([el('loext:content')]);
    const assembled = readOdt(pkg);
    expect(assembled.source?.['loext:content']?.format).toBe('odt');
  });
});
