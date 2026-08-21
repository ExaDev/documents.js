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

describe('readOdtContent: cross-references (the odf slice of #750)', () => {
  it('reads a point text:reference-mark as a bookmark anchor extent at its run position', () => {
    const pkg = odtPackage([el('text:p', {}, [txt('see '), el('text:reference-mark', { 'text:name': 'target1' }), txt(' here')])]);
    const blocks = firstSectionBlocks(pkg);
    if (blocks[0]?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(blocks[0].constructs).toEqual([
      { descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'target1' }, startRun: 1, endRun: 1 },
    ]);
  });

  it('pairs interior text:reference-mark-start/-end into a run-level anchor extent', () => {
    const pkg = odtPackage([
      el('text:p', {}, [txt('the '), el('text:reference-mark-start', { 'text:name': 'span1' }), txt('marked words'), el('text:reference-mark-end', { 'text:name': 'span1' }), txt(' end')]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    if (blocks[0]?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(blocks[0].constructs).toEqual([
      { descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'span1' }, startRun: 1, endRun: 2 },
    ]);
  });

  it('pairs reference-mark halves at paragraph edges across blocks into constructStart/constructEnd markers', () => {
    const pkg = odtPackage([
      el('text:p', {}, [el('text:reference-mark-start', { 'text:name': 'across' }), txt('first')]),
      paragraph('middle'),
      el('text:p', {}, [txt('last'), el('text:reference-mark-end', { 'text:name': 'across' })]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'paragraph', 'paragraph', 'constructEnd']);
    if (blocks[0]?.kind !== 'constructStart') {
      throw new Error('expected a constructStart marker');
    }
    expect(blocks[0].descriptor).toEqual({ kind: 'anchor', anchorType: 'bookmark', name: 'across' });
  });

  it('does not pair a reference-mark half with a bookmark half sharing the same name', () => {
    const pkg = odtPackage([
      el('text:p', {}, [el('text:bookmark-start', { 'text:name': 'shared' }), txt('text'), el('text:reference-mark-end', { 'text:name': 'shared' })]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    if (blocks[0]?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(blocks[0].constructs).toBeUndefined();
  });

  it('reads a text:reference-ref display as a field extent over its cached text run', () => {
    const pkg = odtPackage([
      el('text:p', {}, [txt('on page '), el('text:reference-ref', { 'text:ref-name': 'target1', 'text:reference-format': 'page' }, [txt('12')])]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    if (blocks[0]?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(blocks[0].runs.map((run) => run.text)).toEqual(['on page ', '12']);
    expect(blocks[0].constructs).toEqual([
      {
        descriptor: {
          kind: 'field',
          instruction: '<text:reference-ref text:ref-name="target1" text:reference-format="page"></text:reference-ref>',
          cachedResult: '12',
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it('reads a text:bookmark-ref display as a field extent over its cached text run', () => {
    const pkg = odtPackage([
      el('text:p', {}, [txt('see chapter '), el('text:bookmark-ref', { 'text:ref-name': 'span1', 'text:reference-format': 'chapter' }, [txt('3')])]),
    ]);
    const blocks = firstSectionBlocks(pkg);
    if (blocks[0]?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(blocks[0].constructs).toEqual([
      {
        descriptor: {
          kind: 'field',
          instruction: '<text:bookmark-ref text:ref-name="span1" text:reference-format="chapter"></text:bookmark-ref>',
          cachedResult: '3',
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it('survives the package boundary with reference-mark marker pairs intact', () => {
    const pkg = odtPackage([
      el('text:p', {}, [el('text:reference-mark-start', { 'text:name': 'x' }), txt('first')]),
      el('text:p', {}, [txt('last'), el('text:reference-mark-end', { 'text:name': 'x' })]),
    ]);
    const flat = flattenPackage(readOdt(pkg));
    if (flat.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing document');
    }
    expect(flat.sections[0]?.blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'paragraph', 'constructEnd']);
  });
});

describe('readOdtContent: master pages and header/footer content (#769)', () => {
  function stylesPackage(stylesRootChildren: XmlElement[], textChildren: XmlElement[]): Package {
    return {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text', {}, textChildren)])])],
        },
        'styles.xml': {
          kind: 'xml',
          nodes: [el('office:document-styles', {}, stylesRootChildren)],
        },
      },
    };
  }

  function readGeometry(entry: unknown): { pageSize: { widthPt: number; heightPt: number }; margins: { topPt: number } } {
    if (
      typeof entry !== 'object' || entry === null || !('pageSize' in entry) || !('margins' in entry) ||
      typeof entry.pageSize !== 'object' || entry.pageSize === null || !('widthPt' in entry.pageSize) || !('heightPt' in entry.pageSize) ||
      typeof entry.margins !== 'object' || entry.margins === null || !('topPt' in entry.margins) ||
      typeof entry.pageSize.widthPt !== 'number' || typeof entry.pageSize.heightPt !== 'number' || typeof entry.margins.topPt !== 'number'
    ) {
      throw new Error('expected a masterPage entry carrying resolved geometry');
    }
    return { pageSize: entry.pageSize, margins: entry.margins };
  }

  function headerFooterParagraphs(entry: unknown, slot: string): ContentParagraph[] {
    if (typeof entry !== 'object' || entry === null || !('kind' in entry)) {
      throw new Error('expected a masterPage definitions entry');
    }
    const blocks = (entry as Record<string, unknown>)[slot];
    if (!Array.isArray(blocks) || !blocks.every((block: unknown): block is ContentParagraph => typeof block === 'object' && block !== null && 'kind' in block && 'runs' in block && block.kind === 'paragraph')) {
      throw new Error(`expected a paragraph-only ${slot} body`);
    }
    return blocks;
  }

  it('reads every style:master-page into a keyed masterPage definitions entry with its resolved page geometry', () => {
    const pkg = stylesPackage(
      [
        el('office:automatic-styles', {}, [
          el('style:page-layout', { 'style:name': 'PM-portrait' }, [el('style:page-layout-properties', { 'fo:page-width': '21cm', 'fo:page-height': '29.7cm', 'fo:margin-top': '2cm', 'fo:margin-bottom': '2cm', 'fo:margin-left': '2cm', 'fo:margin-right': '2cm' })]),
          el('style:page-layout', { 'style:name': 'PM-landscape' }, [el('style:page-layout-properties', { 'fo:page-width': '29.7cm', 'fo:page-height': '21cm', 'fo:margin-top': '1cm', 'fo:margin-bottom': '1cm', 'fo:margin-left': '1cm', 'fo:margin-right': '1cm' })]),
        ]),
        el('office:master-styles', {}, [
          el('style:master-page', { 'style:name': 'Standard', 'style:page-layout-name': 'PM-portrait' }),
          el('style:master-page', { 'style:name': 'Landscape', 'style:page-layout-name': 'PM-landscape' }),
        ]),
      ],
      [paragraph('body')],
    );
    const document = readOdtContent(pkg);
    const standard = document.definitions?.['masterPage:Standard'];
    const landscape = document.definitions?.['masterPage:Landscape'];
    expect(standard).toMatchObject({ kind: 'masterPage', name: 'Standard' });
    const standardPage = readGeometry(standard);
    expect(standardPage.pageSize.widthPt).toBeCloseTo(595.3, 0);
    expect(standardPage.pageSize.heightPt).toBeCloseTo(841.9, 0);
    expect(standardPage.margins.topPt).toBeCloseTo(56.7, 0);
    expect(landscape).toMatchObject({ kind: 'masterPage', name: 'Landscape' });
    expect(readGeometry(landscape).pageSize.widthPt).toBeCloseTo(841.9, 0);
    // The section's own geometry still comes from the FIRST master page in document order -- unchanged.
    expect(document.sections[0]?.pageSize.widthPt).toBeCloseTo(595.3, 0);
  });

  it('reads style:header and style:footer content as block flow on the master-page entry', () => {
    const pkg = stylesPackage(
      [
        el('office:master-styles', {}, [
          el('style:master-page', { 'style:name': 'Standard' }, [
            el('style:header', {}, [el('text:p', {}, [txt('Header text.')])]),
            el('style:footer', {}, [el('text:p', {}, [txt('Footer text.')])]),
          ]),
        ]),
      ],
      [paragraph('body')],
    );
    const document = readOdtContent(pkg);
    const entry = document.definitions?.['masterPage:Standard'];
    expect(headerFooterParagraphs(entry, 'header')[0]?.runs[0]?.text).toBe('Header text.');
    expect(headerFooterParagraphs(entry, 'footer')[0]?.runs[0]?.text).toBe('Footer text.');
  });

  it('reads the left/right header and footer slots under their own ODF slot keys', () => {
    const pkg = stylesPackage(
      [
        el('office:master-styles', {}, [
          el('style:master-page', { 'style:name': 'Standard' }, [
            el('style:header-left', {}, [el('text:p', {}, [txt('Left header.')])]),
            el('style:header-right', {}, [el('text:p', {}, [txt('Right header.')])]),
            el('style:footer-left', {}, [el('text:p', {}, [txt('Left footer.')])]),
          ]),
        ]),
      ],
      [paragraph('body')],
    );
    const document = readOdtContent(pkg);
    const entry = document.definitions?.['masterPage:Standard'];
    expect(headerFooterParagraphs(entry, 'headerLeft')[0]?.runs[0]?.text).toBe('Left header.');
    expect(headerFooterParagraphs(entry, 'headerRight')[0]?.runs[0]?.text).toBe('Right header.');
    expect(headerFooterParagraphs(entry, 'footerLeft')[0]?.runs[0]?.text).toBe('Left footer.');
    expect(entry).not.toHaveProperty('footer');
    expect(entry).not.toHaveProperty('footerRight');
    expect(entry).not.toHaveProperty('header');
  });

  it('reads a header paragraph\'s inline constructs (a field extent) through the same run walk as body paragraphs', () => {
    const pkg = stylesPackage(
      [
        el('office:master-styles', {}, [
          el('style:master-page', { 'style:name': 'Standard' }, [
            el('style:header', {}, [el('text:p', {}, [txt('Page '), el('text:page-number', {}, [txt('4')])])]),
          ]),
        ]),
      ],
      [paragraph('body')],
    );
    const document = readOdtContent(pkg);
    const header = headerFooterParagraphs(document.definitions?.['masterPage:Standard'], 'header');
    expect(header[0]?.runs.map((run) => run.text)).toEqual(['Page ', '4']);
    expect(header[0]?.constructs).toEqual([
      { descriptor: { kind: 'field', instruction: '<text:page-number></text:page-number>', cachedResult: '4' }, startRun: 1, endRun: 2 },
    ]);
  });

  it('omits a master-page entry whose own name is absent, and carries entries onto the assembled package root', () => {
    const pkg = stylesPackage(
      [
        el('office:master-styles', {}, [
          el('style:master-page', { 'style:name': 'Standard' }),
          el('style:master-page', {}),
        ]),
      ],
      [paragraph('body')],
    );
    const document = readOdtContent(pkg);
    expect(Object.keys(document.definitions ?? {})).toEqual(['masterPage:Standard']);
    expect(readOdt(pkg).definitions).toEqual({ 'masterPage:Standard': { kind: 'masterPage', name: 'Standard' } });
  });
});

describe('readOdtContent: fo:break-before and fo:break-after as pageBreak blocks (#769)', () => {
  const BREAK_STYLES: XmlElement[] = [
    el('style:style', { 'style:name': 'BreakBefore', 'style:family': 'paragraph' }, [el('style:paragraph-properties', { 'fo:break-before': 'page' })]),
    el('style:style', { 'style:name': 'BreakAfter', 'style:family': 'paragraph' }, [el('style:paragraph-properties', { 'fo:break-after': 'page' })]),
    el('style:style', { 'style:name': 'BreakParent', 'style:family': 'paragraph' }, [el('style:paragraph-properties', { 'fo:break-before': 'page' })]),
    el('style:style', { 'style:name': 'BreakChild', 'style:family': 'paragraph', 'style:parent-style-name': 'BreakParent' }, [el('style:paragraph-properties', { 'fo:break-before': 'auto' })]),
    el('style:style', { 'style:name': 'NoBreak', 'style:family': 'paragraph' }, [el('style:paragraph-properties', { 'fo:break-before': 'auto', 'fo:break-after': 'auto' })]),
    el('style:style', { 'style:name': 'BreakEvenPage', 'style:family': 'paragraph' }, [el('style:paragraph-properties', { 'fo:break-before': 'odd-page' })]),
  ];

  it('emits a pageBreak block before a paragraph whose resolved paragraph style carries fo:break-before="page"', () => {
    const pkg = odtPackage([paragraph('first'), el('text:p', { 'text:style-name': 'BreakBefore' }, [txt('chapter start')])], BREAK_STYLES);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
    if (blocks[2]?.kind !== 'paragraph') {
      throw new Error('expected the break-before paragraph');
    }
    expect(blocks[2].runs[0]?.text).toBe('chapter start');
  });

  it('emits a pageBreak block after a paragraph whose resolved paragraph style carries fo:break-after="page"', () => {
    const pkg = odtPackage([el('text:p', { 'text:style-name': 'BreakAfter' }, [txt('chapter end')]), paragraph('next')], BREAK_STYLES);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
  });

  it('resolves the break through the style parent chain, with the nearest declaration winning', () => {
    const pkg = odtPackage([el('text:p', { 'text:style-name': 'BreakChild' }, [txt('inherited auto wins')])], BREAK_STYLES);
    expect(firstSectionBlocks(pkg).map((block) => block.kind)).toEqual(['paragraph']);
  });

  it('reads an odd-page or even-page break as a page break', () => {
    const pkg = odtPackage([el('text:p', { 'text:style-name': 'BreakEvenPage' }, [txt('right-hand start')])], BREAK_STYLES);
    expect(firstSectionBlocks(pkg).map((block) => block.kind)).toEqual(['pageBreak', 'paragraph']);
  });

  it('emits no pageBreak block for a style that declares only fo:break-before="auto"', () => {
    const pkg = odtPackage([el('text:p', { 'text:style-name': 'NoBreak' }, [txt('plain')])], BREAK_STYLES);
    expect(firstSectionBlocks(pkg).map((block) => block.kind)).toEqual(['paragraph']);
  });

  it('keeps a block-scoped bookmark extent indexed past the leading pageBreak block its paragraph also produces', () => {
    const pkg = odtPackage(
      [
        el('text:p', {}, [el('text:bookmark-start', { 'text:name': 'chapter' }), txt('cover')]),
        el('text:p', { 'text:style-name': 'BreakBefore' }, [txt('chapter start'), el('text:bookmark-end', { 'text:name': 'chapter' })]),
      ],
      BREAK_STYLES,
    );
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'pageBreak', 'paragraph', 'constructEnd']);
  });

  it('survives the package boundary with the pageBreak blocks intact', () => {
    const pkg = odtPackage([el('text:p', { 'text:style-name': 'BreakBefore' }, [txt('chapter start')])], BREAK_STYLES);
    const flat = flattenPackage(readOdt(pkg));
    if (flat.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing document');
    }
    expect(flat.sections[0]?.blocks.map((block) => block.kind)).toEqual(['pageBreak', 'paragraph']);
  });

  it('strips the break attributes from the paragraph\'s style residue, so the break fact lives in one place', () => {
    // A style carrying BOTH a modelled unknown (fo:keep-with-next) and the break: the element still quarantines for the unknown, but its serialised copy no longer restates the break the pageBreak block already encodes.
    const styles: XmlElement[] = [
      el('style:style', { 'style:name': 'BreakAndKeep', 'style:family': 'paragraph' }, [el('style:paragraph-properties', { 'fo:break-before': 'page', 'fo:keep-with-next': 'always' })]),
    ];
    const pkg = odtPackage([el('text:p', { 'text:style-name': 'BreakAndKeep' }, [txt('kept with next')])], styles);
    const blocks = firstSectionBlocks(pkg);
    expect(blocks.map((block) => block.kind)).toEqual(['pageBreak', 'paragraph']);
    if (blocks[1]?.kind !== 'paragraph') {
      throw new Error('expected a paragraph');
    }
    expect(blocks[1].source?.format).toBe('odt');
    expect(blocks[1].source?.xml).toContain('fo:keep-with-next');
    expect(blocks[1].source?.xml).not.toContain('fo:break-before');
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
