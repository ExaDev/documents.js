import { describe, expect, it } from 'vitest';
import type { ConstructDescriptor, ContentBlock, ContentSection } from 'document-schema.js';
import { findConstructMarkerImbalance } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlNode } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { decodePackage, encodePackage } from '../../codec';
import { elementsWithTag, rootElement } from '../util';
import { readDocxContent } from './read';
import { buildDocxPackageFromContent } from './write';

// The round trip these tests actually assert: a docx read into sections, written back out through buildDocxPackageFromContent, and read again must produce the identical sections. Every fixture below is a real word/document.xml body, so the assertion is over the whole pair rather than over the writer's XML in isolation -- what the writer emits only matters inasmuch as readDocxContent reads the same model back out of it.

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const HYPERLINK_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const PICTURE_GRAPHIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

function docxPackage(bodyChildren: XmlNode[], extraParts: Package['parts'] = {}): Package {
  const body = el('w:body', {}, [...bodyChildren, el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '12240', 'w:h': '15840' }), el('w:pgMar', { 'w:top': '1440', 'w:right': '1440', 'w:bottom': '1440', 'w:left': '1440' })])]);
  return { parts: { 'word/document.xml': { kind: 'xml', nodes: [el('w:document', {}, [body])] }, ...extraParts } };
}

function para(text: string, ...extra: XmlNode[]): XmlNode {
  return el('w:p', {}, [...extra, el('w:r', {}, [el('w:t', {}, [txt(text)])])]);
}

// Read, write, read: the second read's sections are what every assertion compares against the first's.
function roundTrip(source: Package): { before: ContentSection[]; after: ContentSection[]; written: Package } {
  const before = readDocxContent(source);
  const written = buildDocxPackageFromContent(before);
  return { before: before.sections, after: readDocxContent(written).sections, written };
}

function expectStableRoundTrip(source: Package): ContentSection[] {
  const { before, after } = roundTrip(source);
  expect(after).toEqual(before);
  return after;
}

// The written order of a paragraph's run-and-bookmark children, described by bookmark NAME rather than the id the writer mints: an order assertion over the writer's own XML, which the round-trip assertions cannot express (readDocxContent pairs halves by id at run positions, so it reads an inverted pair back as the same extent it wrote from).
function writtenBookmarkOrder(paragraphElement: XmlNode | undefined): string[] | undefined {
  if (paragraphElement?.type !== 'element') {
    return undefined;
  }
  const nameById = new Map<string, string>();
  for (const child of paragraphElement.children) {
    if (child.type === 'element' && child.tag === 'w:bookmarkStart') {
      const id = child.attributes.find((attribute) => attribute.name === 'w:id')?.value;
      const name = child.attributes.find((attribute) => attribute.name === 'w:name')?.value;
      if (id !== undefined && name !== undefined) {
        nameById.set(id, name);
      }
    }
  }
  const described: string[] = [];
  for (const child of paragraphElement.children) {
    if (child.type !== 'element' || (child.tag !== 'w:r' && child.tag !== 'w:bookmarkStart' && child.tag !== 'w:bookmarkEnd')) {
      continue;
    }
    if (child.tag === 'w:r') {
      described.push('run');
      continue;
    }
    const id = child.attributes.find((attribute) => attribute.name === 'w:id')?.value ?? '';
    described.push(`${child.tag === 'w:bookmarkStart' ? 'start' : 'end'}(${nameById.get(id) ?? id})`);
  }
  return described;
}

describe('buildDocxPackageFromContent: package scaffolding', () => {
  it('writes a package that re-zips and decodes back to the same parts', () => {
    const pkg = buildDocxPackageFromContent(readDocxContent(docxPackage([para('hello')])));
    const reDecoded = decodePackage(encodePackage(pkg));
    expect(Object.keys(reDecoded.parts).sort()).toEqual(Object.keys(pkg.parts).sort());
    expect(readDocxContent(reDecoded).sections).toEqual(readDocxContent(pkg).sections);
  });

  it('declares every part it writes in [Content_Types].xml, including the media default for an embedded image', () => {
    const drawing = el('w:drawing', {}, [
      el('wp:inline', {}, [
        el('wp:extent', { cx: '914400', cy: '457200' }),
        el('wp:docPr', { id: '1', name: 'Picture 1' }),
        el('a:graphic', {}, [el('a:graphicData', { uri: PICTURE_GRAPHIC_URI }, [el('pic:pic', {}, [el('pic:blipFill', {}, [el('a:blip', { 'r:embed': 'rIdImg' })])])])]),
      ]),
    ]);
    const source = docxPackage([el('w:p', {}, [el('w:r', {}, [drawing])])], {
      'word/_rels/document.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [el('Relationship', { Id: 'rIdImg', Type: IMAGE_REL, Target: 'media/image1.png' })])] },
      'word/media/image1.png': { kind: 'binary', base64: TINY_PNG_BASE64 },
    });
    const written = buildDocxPackageFromContent(readDocxContent(source));
    expect(written.parts['word/media/image1.png']).toEqual({ kind: 'binary', base64: TINY_PNG_BASE64 });
    const types = rootElement(written.parts['[Content_Types].xml']);
    const declared = elementsWithTag(types === undefined ? [] : [types], 'Default').map((element) => element.attributes.find((a) => a.name === 'Extension')?.value);
    expect(declared).toContain('png');
  });

  it('writes core and extended properties that read back as the same metadata', () => {
    const core = el('cp:coreProperties', {}, [
      el('dc:title', {}, [txt('Round trip')]),
      el('dc:creator', {}, [txt('Ada Lovelace')]),
      el('dc:subject', {}, [txt('fidelity')]),
      el('cp:keywords', {}, [txt('one, two')]),
      el('dcterms:created', {}, [txt('2026-08-18T09:00:00Z')]),
    ]);
    const app = el('Properties', {}, [el('Application', {}, [txt('ooxml.js')])]);
    const source = docxPackage([para('body')], { 'docProps/core.xml': { kind: 'xml', nodes: [core] }, 'docProps/app.xml': { kind: 'xml', nodes: [app] } });
    const before = readDocxContent(source);
    expect(readDocxContent(buildDocxPackageFromContent(before)).metadata).toEqual(before.metadata);
  });

  it('writes an empty document for a content value carrying no sections at all', () => {
    const sections = readDocxContent(buildDocxPackageFromContent({ sections: [] })).sections;
    expect(sections).toHaveLength(1);
    expect(sections[0]?.blocks).toEqual([]);
  });

  it('refuses a block list whose construct markers do not balance rather than writing a document that cannot be read back', () => {
    const blocks: ContentBlock[] = [{ kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'unclosed' } }, { kind: 'paragraph', runs: [{ text: 'x' }] }];
    expect(() => buildDocxPackageFromContent({ sections: [{ pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks }] })).toThrow(/unclosedStart/);
  });
});

describe('buildDocxPackageFromContent: content round trip', () => {
  it('round-trips paragraph properties, run formatting, headings, lists, and page breaks', () => {
    const styled = el('w:p', {}, [
      el('w:pPr', {}, [
        el('w:pStyle', { 'w:val': 'Heading2' }),
        el('w:numPr', {}, [el('w:ilvl', { 'w:val': '2' }), el('w:numId', { 'w:val': '7' })]),
        el('w:spacing', { 'w:before': '240', 'w:after': '120', 'w:line': '360', 'w:lineRule': 'auto' }),
        el('w:ind', { 'w:left': '720', 'w:hanging': '360' }),
        el('w:jc', { 'w:val': 'both' }),
        el('w:outlineLvl', { 'w:val': '1' }),
      ]),
      el('w:r', {}, [el('w:rPr', {}, [el('w:b'), el('w:i'), el('w:u', { 'w:val': 'single' }), el('w:strike'), el('w:rFonts', { 'w:ascii': 'Georgia' }), el('w:sz', { 'w:val': '28' }), el('w:color', { 'w:val': 'ff0000' })]), el('w:t', {}, [txt('styled')])]),
      el('w:r', {}, [el('w:t', {}, [txt('a')]), el('w:tab'), el('w:t', {}, [txt('b')]), el('w:br'), el('w:t', {}, [txt('c')])]),
    ]);
    const pageBreak = el('w:p', {}, [el('w:pPr', {}, [el('w:pageBreakBefore')]), el('w:r', {}, [el('w:t', {}, [txt('next page')])])]);
    const sections = expectStableRoundTrip(docxPackage([styled, pageBreak]));
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
  });

  // A heading with a page break before it and Word's own _Toc bookmark around it -- one of the commonest shapes in a real document with a table of contents. collectParagraph pushes the pageBreak block before the paragraph it belongs to, so a construct whose extent starts at that same paragraph opens one block later: the page break and the construct are siblings in the flat list, not nested. The page break must still land immediately before the paragraph that carries it, not at the end of the section with a spurious empty paragraph appended.
  it('keeps a page break immediately before the paragraph that opens a construct there, instead of moving it to the end of the flow', () => {
    const source = docxPackage([
      para('before'),
      el('w:p', {}, [
        el('w:pPr', {}, [el('w:pageBreakBefore')]),
        el('w:bookmarkStart', { 'w:id': '3', 'w:name': '_Toc9' }),
        el('w:r', {}, [el('w:t', {}, [txt('Chapter 1')])]),
        el('w:bookmarkEnd', { 'w:id': '3' }),
      ]),
    ]);
    const before = readDocxContent(source);
    expect(before.sections[0]?.blocks.map((block) => block.kind)).toEqual(['paragraph', 'pageBreak', 'constructStart', 'paragraph', 'constructEnd']);
    const after = readDocxContent(buildDocxPackageFromContent(before)).sections[0]?.blocks ?? [];
    expect(findConstructMarkerImbalance(after)).toBeUndefined();
    const paragraphs = after.flatMap((block) => (block.kind === 'paragraph' ? [block] : []));
    // No spurious paragraph gained on the way out, and "Chapter 1" is not displaced to the end of the flow.
    expect(paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual(['before', 'Chapter 1']);
    const kinds = after.map((block) => block.kind);
    expect(kinds.filter((kind) => kind === 'pageBreak')).toHaveLength(1);
    expect(kinds.indexOf('pageBreak')).toBeLessThan(kinds.lastIndexOf('paragraph'));
  });

  // A ContentDocument from another codec (markdown-codec, odf.js, pdf-codec) can hand this writer a page break directly followed by a table, a shape readDocxContent itself never produces but buildDocxPackageFromContent still has to honour: WordprocessingML has no page-break element for a table to carry, so the break becomes its own empty paragraph immediately before the table, not displaced after it.
  it('keeps a page break immediately before a table rather than displacing it after the table', () => {
    const blocks: ContentBlock[] = [
      { kind: 'paragraph', runs: [{ text: 'before' }] },
      { kind: 'pageBreak' },
      { kind: 'table', columnWidthsPt: [72], rows: [{ cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'cell' }] }] }] }] },
    ];
    const written = buildDocxPackageFromContent({ sections: [{ pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks }] });
    const after = readDocxContent(written).sections[0]?.blocks ?? [];
    const kinds = after.map((block) => block.kind);
    expect(kinds.indexOf('pageBreak')).toBeGreaterThan(-1);
    expect(kinds.indexOf('pageBreak')).toBeLessThan(kinds.indexOf('table'));
  });

  // The source relationship spells its query separator as the XML entity '&amp;'; the projection decodes it, and the writer re-encodes it once -- the whole point of the pair being that a target survives the trip spelled the same way, not doubly encoded.
  it('round-trips an external hyperlink through a freshly minted relationship, sharing one relationship per target', () => {
    const link = (text: string): XmlNode => el('w:p', {}, [el('w:hyperlink', { 'r:id': 'rIdHlink' }, [el('w:r', {}, [el('w:t', {}, [txt(text)])])])]);
    const source = docxPackage([link('first'), link('second')], {
      'word/_rels/document.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [el('Relationship', { Id: 'rIdHlink', Type: HYPERLINK_REL, Target: 'https://example.com/a?x=1&amp;y=2', TargetMode: 'External' })])] },
    });
    const { after, written } = roundTrip(source);
    const paragraph = after[0]?.blocks[0];
    expect(paragraph?.kind === 'paragraph' ? paragraph.runs[0]?.hyperlink : undefined).toBe('https://example.com/a?x=1&y=2');
    const rels = rootElement(written.parts['word/_rels/document.xml.rels']);
    expect(elementsWithTag(rels === undefined ? [] : [rels], 'Relationship')).toHaveLength(1);
  });

  it('round-trips a table\'s grid, spans, shading, borders, and row heights', () => {
    const borders = el('w:tcBorders', {}, [el('w:top', { 'w:val': 'single', 'w:sz': '8', 'w:color': '00ff00' }), el('w:bottom', { 'w:val': 'dashed', 'w:color': 'auto' })]);
    const spanned = el('w:tc', {}, [el('w:tcPr', {}, [el('w:gridSpan', { 'w:val': '2' }), el('w:shd', { 'w:fill': 'ff0000' }), borders]), para('merged')]);
    const anchor = el('w:tc', {}, [el('w:tcPr', {}, [el('w:vMerge', { 'w:val': 'restart' })]), para('top')]);
    const continuation = el('w:tc', {}, [el('w:tcPr', {}, [el('w:vMerge')]), el('w:p')]);
    const table = el('w:tbl', {}, [
      el('w:tblGrid', {}, [el('w:gridCol', { 'w:w': '2880' }), el('w:gridCol', { 'w:w': '1440' })]),
      el('w:tr', {}, [el('w:trPr', {}, [el('w:trHeight', { 'w:val': '560' })]), spanned]),
      el('w:tr', {}, [anchor, el('w:tc', {}, [para('right one')])]),
      el('w:tr', {}, [continuation, el('w:tc', {}, [para('right two')])]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([table]));
    const written = sections[0]?.blocks[0];
    if (written?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    expect(written.rows[1]?.cells[0]?.rowSpan).toBe(2);
    expect(written.rows[0]?.cells[0]?.colSpan).toBe(2);
  });

  it('round-trips an image back into the run it was lifted out of, rather than adding a paragraph for it', () => {
    const drawing = (rId: string, alt: string): XmlNode =>
      el('w:drawing', {}, [
        el('wp:inline', {}, [
          el('wp:extent', { cx: '914400', cy: '457200' }),
          el('wp:docPr', { id: '1', name: 'Picture 1', descr: alt }),
          el('a:graphic', {}, [el('a:graphicData', { uri: PICTURE_GRAPHIC_URI }, [el('pic:pic', {}, [el('pic:blipFill', {}, [el('a:blip', { 'r:embed': rId })])])])]),
        ]),
      ]);
    const source = docxPackage(
      [
        el('w:p', {}, [el('w:r', {}, [drawing('rIdImg', 'alone')])]),
        el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('caption')])]), el('w:r', {}, [drawing('rIdImg', 'after text')])]),
      ],
      {
        'word/_rels/document.xml.rels': { kind: 'xml', nodes: [el('Relationships', {}, [el('Relationship', { Id: 'rIdImg', Type: IMAGE_REL, Target: 'media/image1.png' })])] },
        'word/media/image1.png': { kind: 'binary', base64: TINY_PNG_BASE64 },
      },
    );
    const sections = expectStableRoundTrip(source);
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual(['paragraph', 'image', 'paragraph', 'image']);
  });

  it('round-trips several sections, keeping each break on the paragraph that carries it', () => {
    const firstBreak = el('w:p', {}, [el('w:pPr', {}, [el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '11906', 'w:h': '16838' }), el('w:pgMar', { 'w:top': '720', 'w:right': '720', 'w:bottom': '720', 'w:left': '720' })])])]);
    const sections = expectStableRoundTrip(docxPackage([para('first'), firstBreak, para('second')]));
    expect(sections).toHaveLength(2);
    expect(sections[0]?.pageSize.widthPt).toBeCloseTo(595.3, 1);
  });

  // A bookmark closing exactly where a section ends: the section's own flow ends in a childless w:bookmarkEnd marker, not a w:p, so attachSectionBreak has to descend into the construct to find the paragraph the break actually belongs to, the same way buildFieldNodes' own findParagraph already does for a field.
  it('attaches a mid-document section break to the true last paragraph even when a construct closes at the end of the section', () => {
    const closingParagraph = el('w:p', {}, [
      el('w:pPr', {}, [el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '11906', 'w:h': '16838' }), el('w:pgMar', { 'w:top': '720', 'w:right': '720', 'w:bottom': '720', 'w:left': '720' })])]),
      el('w:r', {}, [el('w:t', {}, [txt('end of section one')])]),
    ]);
    const source = docxPackage([el('w:bookmarkStart', { 'w:id': '1', 'w:name': 'closing' }), closingParagraph, el('w:bookmarkEnd', { 'w:id': '1' }), para('second')]);
    const sections = expectStableRoundTrip(source);
    expect(sections).toHaveLength(2);
    // No spurious empty paragraph gained on the way out to carry the break.
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'constructEnd']);
  });
});

describe('buildDocxPackageFromContent: construct round trip', () => {
  it('round-trips a content control with its type, tag, alias, lock, and options', () => {
    const sdt = el('w:sdt', {}, [
      el('w:sdtPr', {}, [el('w:alias', { 'w:val': 'Status' }), el('w:tag', { 'w:val': 'status' }), el('w:lock', { 'w:val': 'sdtLocked' }), el('w:dropDownList', {}, [el('w:listItem', { 'w:displayText': 'Draft' }), el('w:listItem', { 'w:displayText': 'Final' })])]),
      el('w:sdtContent', {}, [para('Draft')]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([sdt]));
    const start = sections[0]?.blocks[0];
    expect(start?.kind === 'constructStart' ? start.descriptor : undefined).toEqual({ kind: 'contentControl', controlType: 'dropDown', tag: 'status', alias: 'Status', lock: 'container', options: ['Draft', 'Final'] });
  });

  it('round-trips a checkbox, a date, and a table-of-contents control through their own docx spellings', () => {
    const control = (properties: XmlNode[], text: string): XmlNode => el('w:sdt', {}, [el('w:sdtPr', {}, properties), el('w:sdtContent', {}, [para(text)])]);
    const source = docxPackage([
      control([el('w14:checkbox', {}, [el('w14:checked', { 'w14:val': '1' })])], 'X'),
      control([el('w:date', { 'w:fullDate': '2026-08-18T00:00:00Z' })], '18 August 2026'),
      control([el('w:docPartObj', {}, [el('w:docPartGallery', { 'w:val': 'Table of Contents' })])], 'Chapter 1'),
    ]);
    const sections = expectStableRoundTrip(source);
    const descriptors = (sections[0]?.blocks ?? []).flatMap((block) => (block.kind === 'constructStart' ? [block.descriptor] : []));
    expect(descriptors).toEqual([
      { kind: 'contentControl', controlType: 'checkbox', checked: true },
      { kind: 'contentControl', controlType: 'date', value: '2026-08-18T00:00:00Z' },
      { kind: 'contentControl', controlType: 'index' },
    ]);
  });

  it('round-trips a non-TOC gallery through the residue channel: the docPartObj degrades to richText on read and is restored on write', () => {
    // The restorable tier's first consumer (document-schema.js's residue channel): a Cover Pages SDT reads back as a richText control carrying its w:docPartObj verbatim in descriptor.source, and the writer re-emits the element from that residue in place of the default w:richText type element -- so the same-format pair loses the gallery name no longer.
    const coverPage = el('w:sdt', {}, [
      el('w:sdtPr', {}, [el('w:alias', { 'w:val': 'Title' }), el('w:docPartObj', {}, [el('w:docPartGallery', { 'w:val': 'Cover Pages' })])]),
      el('w:sdtContent', {}, [para('Title page')]),
    ]);
    const { before, after, written } = roundTrip(docxPackage([coverPage]));
    expect(after).toEqual(before);
    const descriptor = before[0]?.blocks[0];
    expect(descriptor?.kind === 'constructStart' ? descriptor.descriptor : undefined).toEqual({
      kind: 'contentControl',
      controlType: 'richText',
      alias: 'Title',
      source: { format: 'docx', xml: '<w:docPartObj><w:docPartGallery w:val="Cover Pages"></w:docPartGallery></w:docPartObj>' },
    });
    const document = rootElement(written.parts['word/document.xml']);
    const galleries = document === undefined ? [] : elementsWithTag([document], 'w:docPartGallery');
    expect(galleries.map((gallery) => gallery.attributes.find((attribute) => attribute.name === 'w:val')?.value)).toEqual(['Cover Pages']);
  });

  it('does not restore gallery residue on a controlType the reader never mints it on: a hand-built plainText control keeps its w:text element', () => {
    // Restoration is gated on the controlType the reader mints the residue on (richText, constructs.ts's degradation verdict), not on residue shape alone: a hand-built descriptor of any other controlType carrying docPartObj-shaped docx residue keeps its own semantic type element rather than having it silently replaced, and the residue stays quarantined for the same-format consumer that owns it.
    const written = buildDocxPackageFromContent({
      sections: [{
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [
          { kind: 'constructStart', descriptor: { kind: 'contentControl', controlType: 'plainText', source: { format: 'docx', xml: '<w:docPartObj><w:docPartGallery w:val="Cover Pages"></w:docPartGallery></w:docPartObj>' } } },
          { kind: 'paragraph', runs: [{ text: 'plain' }] },
          { kind: 'constructEnd' },
        ],
      }],
    });
    const document = rootElement(written.parts['word/document.xml']);
    const root = document === undefined ? [] : [document];
    expect(elementsWithTag(root, 'w:text')).toHaveLength(1);
    expect(elementsWithTag(root, 'w:docPartObj')).toHaveLength(0);
  });

  it('round-trips a tracked insertion and a tracked deletion, keeping the deleted text as deleted text, and wraps each paragraph\'s own runs rather than the paragraph itself', () => {
    const ins = el('w:ins', { 'w:id': '1', 'w:author': 'Ada', 'w:date': '2026-08-18T09:00:00Z' }, [para('added')]);
    const del = el('w:del', { 'w:id': '2', 'w:author': 'Grace' }, [el('w:p', {}, [el('w:r', {}, [el('w:delText', {}, [txt('removed')])])])]);
    const { before, after, written } = roundTrip(docxPackage([ins, del]));
    expect(after).toEqual(before);
    const document = rootElement(written.parts['word/document.xml']);
    const root = document === undefined ? [] : [document];
    expect(elementsWithTag(root, 'w:delText')).toHaveLength(1);
    // CT_RunTrackChange (reached through EG_RunLevelElts) has no w:p in its content model: w:ins/w:del must wrap the paragraph's own runs, never the w:p element itself, and CT_TrackChange's own w:author is required on every one of them.
    for (const element of [...elementsWithTag(root, 'w:ins'), ...elementsWithTag(root, 'w:del')]) {
      expect(element.children.some((child) => child.type === 'element' && child.tag === 'w:p')).toBe(false);
      expect(element.attributes.some((a) => a.name === 'w:author')).toBe(true);
    }
  });

  it('mints its own author for a tracked change whose descriptor carries none, rather than omitting the required attribute', () => {
    const blocks: ContentBlock[] = [
      { kind: 'constructStart', descriptor: { kind: 'provenance', change: 'insertion' } },
      { kind: 'paragraph', runs: [{ text: 'anonymous' }] },
      { kind: 'constructEnd' },
    ];
    const written = buildDocxPackageFromContent({ sections: [{ pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks }] });
    const document = rootElement(written.parts['word/document.xml']);
    const insEls = elementsWithTag(document === undefined ? [] : [document], 'w:ins');
    expect(insEls.length).toBeGreaterThan(0);
    for (const element of insEls) {
      const author = element.attributes.find((a) => a.name === 'w:author')?.value;
      expect(author).toBeTruthy();
    }
  });

  it('threads a tracked change through a nested bookmark down to the paragraph it wraps, rather than dropping it', () => {
    const blocks: ContentBlock[] = [
      { kind: 'constructStart', descriptor: { kind: 'provenance', change: 'insertion', author: 'Ada' } },
      { kind: 'constructStart', descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'intro' } },
      { kind: 'paragraph', runs: [{ text: 'nested' }] },
      { kind: 'constructEnd' },
      { kind: 'constructEnd' },
    ];
    const written = buildDocxPackageFromContent({ sections: [{ pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks }] });
    const document = rootElement(written.parts['word/document.xml']);
    const body = document === undefined ? undefined : document.children[0];
    expect(body?.type === 'element' ? body.children.map((child) => (child.type === 'element' ? child.tag : child.type)) : undefined).toEqual(['w:bookmarkStart', 'w:p', 'w:bookmarkEnd', 'w:sectPr']);
    const descriptors = readDocxContent(written).sections[0]?.blocks.flatMap((block) => (block.kind === 'constructStart' ? [block.descriptor] : [])) ?? [];
    expect(descriptors).toContainEqual({ kind: 'anchor', anchorType: 'bookmark', name: 'intro' });
    expect(descriptors).toContainEqual({ kind: 'provenance', change: 'insertion', author: 'Ada' });
  });

  it('round-trips a move pair as its own two provenance changes', () => {
    const moveFrom = el('w:p', {}, [el('w:moveFrom', { 'w:id': '1', 'w:author': 'Ada' }, [el('w:r', {}, [el('w:delText', {}, [txt('moved')])])])]);
    const moveTo = el('w:p', {}, [el('w:moveTo', { 'w:id': '2', 'w:author': 'Ada' }, [el('w:r', {}, [el('w:t', {}, [txt('moved')])])])]);
    const sections = expectStableRoundTrip(docxPackage([moveFrom, moveTo]));
    const descriptors = (sections[0]?.blocks ?? []).flatMap((block) => (block.kind === 'constructStart' ? [block.descriptor] : []));
    expect(descriptors).toEqual([
      { kind: 'provenance', change: 'moveFrom', author: 'Ada' },
      { kind: 'provenance', change: 'moveTo', author: 'Ada' },
    ]);
  });

  it('round-trips a bookmark spanning several paragraphs', () => {
    const source = docxPackage([el('w:bookmarkStart', { 'w:id': '1', 'w:name': 'intro' }), para('one'), para('two'), el('w:bookmarkEnd', { 'w:id': '1' }), para('outside')]);
    const sections = expectStableRoundTrip(source);
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual(['constructStart', 'paragraph', 'paragraph', 'constructEnd', 'paragraph']);
  });

  it('round-trips a bookmark Word wrote inside a heading paragraph as a block-level pair around it', () => {
    const source = docxPackage([el('w:p', {}, [el('w:bookmarkStart', { 'w:id': '3', 'w:name': '_Toc9' }), el('w:r', {}, [el('w:t', {}, [txt('Chapter')])]), el('w:bookmarkEnd', { 'w:id': '3' })])]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const document = rootElement(written.parts['word/document.xml']);
    const body = document === undefined ? undefined : document.children[0];
    expect(body?.type === 'element' ? body.children.map((child) => (child.type === 'element' ? child.tag : child.type)) : undefined).toEqual(['w:bookmarkStart', 'w:p', 'w:bookmarkEnd', 'w:sectPr']);
  });

  it('round-trips a bookmark whose extent is a sub-sequence of one paragraph\'s runs, as a run-level construct extent', () => {
    const source = docxPackage([
      el('w:p', {}, [
        el('w:r', {}, [el('w:t', {}, [txt('before ')])]),
        el('w:bookmarkStart', { 'w:id': '4', 'w:name': 'midway' }),
        el('w:r', {}, [el('w:t', {}, [txt('marked')])]),
        el('w:bookmarkEnd', { 'w:id': '4' }),
        el('w:r', {}, [el('w:t', {}, [txt(' after')])]),
      ]),
    ]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const paragraph = before[0]?.blocks[0];
    expect(paragraph?.kind === 'paragraph' ? paragraph.constructs : undefined).toEqual([
      { descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'midway' }, startRun: 1, endRun: 2 },
    ]);
    // The writer puts the halves back between the runs the range names -- inside the paragraph, never around it.
    const document = rootElement(written.parts['word/document.xml']);
    const body = document === undefined ? undefined : document.children[0];
    const paragraphElement = body?.type === 'element' ? body.children.find((child) => child.type === 'element' && child.tag === 'w:p') : undefined;
    const tags = paragraphElement?.type === 'element' ? paragraphElement.children.map((child) => (child.type === 'element' ? child.tag : child.type)) : undefined;
    expect(tags).toEqual(['w:r', 'w:bookmarkStart', 'w:r', 'w:bookmarkEnd', 'w:r']);
  });

  it('round-trips two bookmarks whose run-level extents cross, keeping both', () => {
    const source = docxPackage([
      el('w:p', {}, [
        el('w:r', {}, [el('w:t', {}, [txt('one ')])]),
        el('w:bookmarkStart', { 'w:id': '1', 'w:name': 'first' }),
        el('w:r', {}, [el('w:t', {}, [txt('two ')])]),
        el('w:bookmarkStart', { 'w:id': '2', 'w:name': 'second' }),
        el('w:r', {}, [el('w:t', {}, [txt('three ')])]),
        el('w:bookmarkEnd', { 'w:id': '1' }),
        el('w:r', {}, [el('w:t', {}, [txt(' four')])]),
        el('w:bookmarkEnd', { 'w:id': '2' }),
      ]),
    ]);
    const sections = expectStableRoundTrip(source);
    const paragraph = sections[0]?.blocks[0];
    expect(paragraph?.kind === 'paragraph' ? paragraph.constructs : undefined).toEqual([
      { descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'first' }, startRun: 1, endRun: 3 },
      { descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'second' }, startRun: 2, endRun: 4 },
    ]);
  });

  it('round-trips a point run extent and one reaching the paragraph\'s tail', () => {
    const source = docxPackage([
      el('w:p', {}, [
        el('w:r', {}, [el('w:t', {}, [txt('unmarked ')])]),
        el('w:bookmarkStart', { 'w:id': '5', 'w:name': 'tail' }),
        el('w:r', {}, [el('w:t', {}, [txt('marked')])]),
        el('w:bookmarkStart', { 'w:id': '6', 'w:name': 'point' }),
        el('w:bookmarkEnd', { 'w:id': '6' }),
        el('w:r', {}, [el('w:t', {}, [txt(' also')])]),
        el('w:bookmarkEnd', { 'w:id': '5' }),
      ]),
    ]);
    const sections = expectStableRoundTrip(source);
    const paragraph = sections[0]?.blocks[0];
    expect(paragraph?.kind === 'paragraph' ? paragraph.constructs : undefined).toEqual([
      { descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'tail' }, startRun: 1, endRun: 3 },
      { descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'point' }, startRun: 2, endRun: 2 },
    ]);
  });

  it('writes a point run extent\'s own halves as a start-then-end pair, not an inverted one', () => {
    // WordprocessingML pairs w:bookmarkStart/End by w:id with start-before-end ordering, so the ORDER of a point extent's own two halves is load-bearing for every consumer that pairs by id and order (Word included): the boundary convention of emitting closes before opens exists for two DIFFERENT extents meeting at one boundary, and applied to a point's own halves it would put the bookmarkEnd first. The written order of the neighbouring range extent is pinned too -- its close lands after the last run it covers, the point pair between the runs its position names.
    const source = docxPackage([
      el('w:p', {}, [
        el('w:r', {}, [el('w:t', {}, [txt('unmarked ')])]),
        el('w:bookmarkStart', { 'w:id': '5', 'w:name': 'tail' }),
        el('w:r', {}, [el('w:t', {}, [txt('marked')])]),
        el('w:bookmarkStart', { 'w:id': '6', 'w:name': 'point' }),
        el('w:bookmarkEnd', { 'w:id': '6' }),
        el('w:r', {}, [el('w:t', {}, [txt(' also')])]),
        el('w:bookmarkEnd', { 'w:id': '5' }),
      ]),
    ]);
    const { written } = roundTrip(source);
    const document = rootElement(written.parts['word/document.xml']);
    const body = document === undefined ? undefined : document.children[0];
    const paragraphElement = body?.type === 'element' ? body.children.find((child) => child.type === 'element' && child.tag === 'w:p') : undefined;
    expect(writtenBookmarkOrder(paragraphElement)).toEqual(['run', 'start(tail)', 'run', 'start(point)', 'end(point)', 'run', 'end(tail)']);
  });

  it('writes two point run extents sharing one run position with each start before its own end', () => {
    const source = docxPackage([
      el('w:p', {}, [
        el('w:r', {}, [el('w:t', {}, [txt('one ')])]),
        el('w:bookmarkStart', { 'w:id': '1', 'w:name': 'first' }),
        el('w:bookmarkEnd', { 'w:id': '1' }),
        el('w:bookmarkStart', { 'w:id': '2', 'w:name': 'second' }),
        el('w:bookmarkEnd', { 'w:id': '2' }),
        el('w:r', {}, [el('w:t', {}, [txt('two')])]),
      ]),
    ]);
    const { written } = roundTrip(source);
    const document = rootElement(written.parts['word/document.xml']);
    const body = document === undefined ? undefined : document.children[0];
    const paragraphElement = body?.type === 'element' ? body.children.find((child) => child.type === 'element' && child.tag === 'w:p') : undefined;
    expect(writtenBookmarkOrder(paragraphElement)).toEqual(['run', 'start(first)', 'end(first)', 'start(second)', 'end(second)', 'run']);
  });

  it('writes a non-bookmark run-level construct extent as its paragraph\'s own content, with no markers', () => {
    // The kinds readDocxContent never produces at run level, which a ContentDocument from another codec still can: a run-scoped field or content control has no w:r-level spelling here, so its runs write as ordinary content and only the descriptor is lost -- the same content-preserving policy the block-level foreign constructs above follow.
    const written = buildDocxPackageFromContent({
      sections: [{
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [
          {
            kind: 'paragraph',
            runs: [{ text: 'plain ' }, { text: 'fielded' }],
            constructs: [{ descriptor: { kind: 'field', instruction: 'DATE' }, startRun: 1, endRun: 2 }],
          },
        ],
      }],
    });
    const document = rootElement(written.parts['word/document.xml']);
    expect(elementsWithTag(document === undefined ? [] : [document], 'w:bookmarkStart')).toHaveLength(0);
    expect(elementsWithTag(document === undefined ? [] : [document], 'w:fldChar')).toHaveLength(0);
    const roundTripped = readDocxContent(written).sections[0]?.blocks[0];
    expect(roundTripped?.kind === 'paragraph' ? roundTripped.runs.map((run) => run.text).join('') : undefined).toBe('plain fielded');
  });

  it('refuses a run-level extent whose range does not name real runs, rather than writing markers at a made-up position', () => {
    const faulty = {
      sections: [{
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [
          {
            kind: 'paragraph' as const,
            runs: [{ text: 'x' }],
            constructs: [{ descriptor: { kind: 'anchor' as const, anchorType: 'bookmark' as const, name: 'beyond' }, startRun: 0, endRun: 5 }],
          },
        ],
      }],
    };
    expect(() => buildDocxPackageFromContent(faulty)).toThrowError(/run-level construct extent/);
  });

  it('round-trips a multi-paragraph complex field, putting its characters back inside the extent\'s own paragraphs', () => {
    const source = docxPackage([
      el('w:p', {}, [
        el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]),
        el('w:r', {}, [el('w:instrText', {}, [txt(' TOC \\o "1-3" \\h ')])]),
        el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'separate' })]),
        el('w:r', {}, [el('w:t', {}, [txt('Chapter 1')])]),
      ]),
      para('Chapter 2'),
      el('w:p', {}, [el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'end' })])]),
    ]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const start = after[0]?.blocks[0];
    expect(start?.kind === 'constructStart' ? start.descriptor : undefined).toEqual({ kind: 'field', instruction: ' TOC \\o "1-3" \\h ' });
    const document = rootElement(written.parts['word/document.xml']);
    const body = document === undefined ? undefined : document.children[0];
    // The field's own characters live inside the extent's paragraphs, so the body gains no paragraph of its own for them.
    expect(body?.type === 'element' ? body.children.filter((child) => child.type === 'element' && child.tag === 'w:p').length : undefined).toBe(3);
  });

  it('round-trips a simple field that is a paragraph\'s whole content', () => {
    const sections = expectStableRoundTrip(docxPackage([el('w:p', {}, [el('w:fldSimple', { 'w:instr': ' PAGE ' }, [el('w:r', {}, [el('w:t', {}, [txt('4')])])])])]));
    const start = sections[0]?.blocks[0];
    expect(start?.kind === 'constructStart' ? start.descriptor : undefined).toEqual({ kind: 'field', instruction: ' PAGE ' });
  });

  // The kinds readDocxContent never produces, which a ContentDocument from another codec still can. Each writes its content and drops only the descriptor, since WordprocessingML has no block-level element for any of them -- what must never happen is an element written where it does not parse.
  it.each([
    ['a block-scoped link', { kind: 'link', target: { kind: 'external', uri: 'https://example.com' } }],
    ['a named division', { kind: 'division', name: 'part-one' }],
    ['a format-change provenance', { kind: 'provenance', change: 'formatChange', author: 'Ada' }],
    ['a footnote anchor', { kind: 'anchor', anchorType: 'footnote', name: '1' }],
  ] satisfies [string, ConstructDescriptor][])('writes %s as its own content, with no wrapper element and no lost paragraph', (_label, descriptor) => {
    const blocks: ContentBlock[] = [{ kind: 'constructStart', descriptor }, { kind: 'paragraph', runs: [{ text: 'inside' }] }, { kind: 'constructEnd' }];
    const written = buildDocxPackageFromContent({ sections: [{ pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks }] });
    const roundTripped = readDocxContent(written).sections[0]?.blocks ?? [];
    expect(roundTripped.map((block) => block.kind)).toEqual(['paragraph']);
    const paragraph = roundTripped[0];
    expect(paragraph?.kind === 'paragraph' ? paragraph.runs[0]?.text : undefined).toBe('inside');
  });

  it('round-trips constructs nested inside each other, and inside a table cell', () => {
    // A content control wrapping a wholly tracked-inserted paragraph -- Word's own nesting order, since CT_RunTrackChange has no w:p in its content model and so can never be the structural outer element around a block-level w:sdt.
    const trackedParagraph = el('w:p', {}, [
      el('w:pPr', {}, [el('w:rPr', {}, [el('w:ins', { 'w:id': '1', 'w:author': 'Ada' })])]),
      el('w:ins', { 'w:id': '2', 'w:author': 'Ada' }, [el('w:r', {}, [el('w:t', {}, [txt('controlled')])])]),
    ]);
    const outer = el('w:sdt', {}, [el('w:sdtPr', {}, [el('w:richText')]), el('w:sdtContent', {}, [trackedParagraph])]);
    const cellControl = el('w:sdt', {}, [el('w:sdtPr', {}, [el('w:text')]), el('w:sdtContent', {}, [para('in a cell')])]);
    const table = el('w:tbl', {}, [el('w:tblGrid', {}, [el('w:gridCol', { 'w:w': '2880' })]), el('w:tr', {}, [el('w:tc', {}, [cellControl])])]);
    const sections = expectStableRoundTrip(docxPackage([outer, table]));
    for (const section of sections) {
      expect(findConstructMarkerImbalance(section.blocks)).toBeUndefined();
    }
  });
});
