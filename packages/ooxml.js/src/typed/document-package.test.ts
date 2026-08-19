import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DocumentPackage, SectionGroupNode, SlideGroupNode } from 'document-schema.js';
import { flattenPackage, isHeadingGroupNode, isListGroupNode, isShapeGroupNode } from 'document-schema.js';
import { decodePackage, encodePackage } from '../codec';
import type { XmlElement, XmlNode } from '../model/node';
import { el, txt } from '../xml/fragment';
import { buildDocxPackage, buildXlsxPackage, readDocx, readPptx, readXlsx } from './document-package';
import { readDocxContent } from './docx/read';
import { buildDocxPackageFromContent } from './docx/write';
import { readPptxContent } from './pptx/read';
import { buildXlsxPackageFromContent } from './xlsx/build';
import { readXlsxContent } from './xlsx/content';

// The DocumentPackage-native surface, exercised end to end over real bytes rather than over an in-memory Package: every round trip below starts by zipping a package to bytes and decoding it back, so what these assert is the whole bytes -> DocumentPackage -> bytes path a consumer actually drives, not just the tree adapter in isolation. Three separate properties are worth pinning per format, and each has its own test: the tree's SHAPE (that decomposition really happened -- one group per container, headings and lists nested inside their section group -- rather than a flat block list wearing a package envelope), the FLATTEN INVERSE (that the tree materialises back to exactly the flat content the content-level reader produces, which is what makes the two APIs interchangeable rather than merely adjacent), and the BYTE ROUND TRIP (that a package written back out and read again reproduces the same tree).

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'xlsx', 'fixtures');

const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PKG_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PML_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

const CT_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const CT_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const CT_SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const REL_OFFICE_DOCUMENT = `${REL_NS}/officeDocument`;
const REL_SLIDE = `${REL_NS}/slide`;

function contentTypes(overrides: { part: string; type: string }[]): XmlElement {
  return el('Types', { xmlns: CONTENT_TYPES_NS }, [
    el('Default', { Extension: 'rels', ContentType: 'application/vnd.openxmlformats-package.relationships+xml' }),
    el('Default', { Extension: 'xml', ContentType: 'application/xml' }),
    ...overrides.map((override) => el('Override', { PartName: override.part, ContentType: override.type })),
  ]);
}

function relationships(entries: { id: string; type: string; target: string }[]): XmlElement {
  return el('Relationships', { xmlns: PKG_RELS_NS }, entries.map((entry) => el('Relationship', { Id: entry.id, Type: entry.type, Target: entry.target })));
}

// --- docx ---------------------------------------------------------------------------------------------------------

// A section carrying, in order: a level-1 heading (w:outlineLvl, ECMA-376's own heading mechanism), a body paragraph, two paragraphs of one numbered list (w:numPr), and a table. That mix is what makes the tree assertions meaningful -- a heading opens a group that swallows the blocks after it, a list opens its own, and a table stays a leaf.
function docxBody(): XmlNode {
  const heading = el('w:p', {}, [el('w:pPr', {}, [el('w:outlineLvl', { 'w:val': '0' })]), el('w:r', {}, [el('w:t', {}, [txt('Quarterly report')])])]);
  const body = el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Revenue rose across every region.')])])]);
  const bullet = (text: string): XmlNode =>
    el('w:p', {}, [el('w:pPr', {}, [el('w:numPr', {}, [el('w:ilvl', { 'w:val': '0' }), el('w:numId', { 'w:val': '3' })])]), el('w:r', {}, [el('w:t', {}, [txt(text)])])]);
  const cell = (text: string): XmlNode => el('w:tc', {}, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt(text)])])])]);
  const table = el('w:tbl', {}, [el('w:tr', {}, [cell('Region'), cell('Total')]), el('w:tr', {}, [cell('EMEA'), cell('42')])]);
  const sectPr = el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '11906', 'w:h': '16838' }), el('w:pgMar', { 'w:top': '1440', 'w:right': '1440', 'w:bottom': '1440', 'w:left': '1440' })]);
  return el('w:body', {}, [heading, body, bullet('Cut hosting spend'), bullet('Renew the CDN contract'), table, sectPr]);
}

function docxBytes(): Uint8Array<ArrayBuffer> {
  return encodePackage({
    parts: {
      '[Content_Types].xml': { kind: 'xml', nodes: [contentTypes([{ part: '/word/document.xml', type: CT_DOCX }])] },
      '_rels/.rels': { kind: 'xml', nodes: [relationships([{ id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'word/document.xml' }])] },
      'word/document.xml': { kind: 'xml', nodes: [el('w:document', { 'xmlns:w': WML_NS }, [docxBody()])] },
    },
  });
}

function sectionGroups(document: DocumentPackage): SectionGroupNode[] {
  if (document.kind !== 'wordprocessing') {
    throw new Error(`expected a wordprocessing package, got "${document.kind}"`);
  }
  return document.children;
}

describe('readDocx: docx bytes -> DocumentPackage', () => {
  it('reads a wordprocessing package with one section group per section, the section geometry riding the group node', () => {
    const document = readDocx(decodePackage(docxBytes()));

    expect(document.kind).toBe('wordprocessing');
    const groups = sectionGroups(document);
    expect(groups).toHaveLength(1);
    // A4 in points: 11906/16838 twips at 20 twips per point.
    expect(groups[0]?.node.pageSize).toEqual({ widthPt: 595.3, heightPt: 841.9 });
  });

  it('promotes the heading and the list into their own groups rather than leaving a flat block run', () => {
    const children = sectionGroups(readDocx(decodePackage(docxBytes())))[0]?.children ?? [];

    const heading = children.find(isHeadingGroupNode);
    expect(heading?.node.runs[0]?.text).toBe('Quarterly report');
    expect(heading?.node.headingLevel).toBe(1);

    // The heading group owns everything after it in the section, so the body paragraph and both list groups nest inside the heading's own children rather than sitting beside it.
    const lists = heading?.children.filter(isListGroupNode) ?? [];
    expect(lists.map((group) => group.node.runs[0]?.text)).toEqual(['Cut hosting spend', 'Renew the CDN contract']);
    expect(lists[0]?.node.list).toEqual({ numId: '3', level: 0 });

    // The table follows the last bullet at the same list level, so it lands inside that bullet's own group -- and stays a leaf there: decomposition groups a container's block flow, it never descends into a table's cells.
    const table = lists[1]?.children.find((child) => 'kind' in child && child.kind === 'table');
    expect(table?.kind === 'table' ? table.rows[0]?.cells[0]?.blocks[0] : undefined).toMatchObject({ kind: 'paragraph', runs: [{ text: 'Region' }] });
  });

  it('flattens back to exactly the sections and metadata readDocxContent reads', () => {
    const pkg = decodePackage(docxBytes());
    const flattened = flattenPackage(readDocx(pkg));
    const content = readDocxContent(pkg);

    expect(flattened.kind).toBe('wordprocessing');
    expect(flattened.metadata).toEqual(content.metadata);
    expect(flattened.kind === 'wordprocessing' ? flattened.sections : undefined).toEqual(content.sections);
  });
});

describe('buildDocxPackage: DocumentPackage -> docx bytes', () => {
  it('round-trips bytes -> DocumentPackage -> bytes -> DocumentPackage unchanged', () => {
    const first = readDocx(decodePackage(docxBytes()));
    const written = encodePackage(buildDocxPackage(first));
    const second = readDocx(decodePackage(written));

    expect(second).toEqual(first);
  });

  it('writes a complete package whose own parts decode back to the same tree', () => {
    const document = readDocx(decodePackage(docxBytes()));
    const built = buildDocxPackage(document);

    expect(Object.keys(built.parts)).toContain('[Content_Types].xml');
    expect(Object.keys(built.parts)).toContain('_rels/.rels');
    expect(Object.keys(built.parts)).toContain('word/document.xml');
    expect(readDocx(decodePackage(encodePackage(built)))).toEqual(document);
  });

  it('carries the heading, list, and table content through the write side, not merely the tree shape', () => {
    const written = encodePackage(buildDocxPackage(readDocx(decodePackage(docxBytes()))));
    const blocks = readDocxContent(decodePackage(written)).sections[0]?.blocks ?? [];

    const texts = blocks.flatMap((block) => (block.kind === 'paragraph' ? [block.runs.map((run) => run.text).join('')] : []));
    expect(texts).toEqual(['Quarterly report', 'Revenue rose across every region.', 'Cut hosting spend', 'Renew the CDN contract']);
    const table = blocks.find((block) => block.kind === 'table');
    expect(table?.kind === 'table' ? table.rows[1]?.cells[1]?.blocks[0] : undefined).toMatchObject({ kind: 'paragraph', runs: [{ text: '42' }] });
  });

  it('builds the same package the flat pair builds, so routing through the tree costs no fidelity of its own', () => {
    const pkg = decodePackage(docxBytes());

    expect(buildDocxPackage(readDocx(pkg))).toEqual(buildDocxPackageFromContent(readDocxContent(pkg)));
  });

  it('refuses a package whose kind is not wordprocessing', () => {
    const spreadsheet = readXlsx(decodePackage(new Uint8Array(readFileSync(join(FIXTURES_DIR, 'minimal.xlsx')))));

    expect(() => buildDocxPackage(spreadsheet)).toThrow('buildDocxPackage: expected a DocumentPackage of kind "wordprocessing", got "spreadsheet"');
  });
});

// --- pptx ---------------------------------------------------------------------------------------------------------

function pptxShape(name: string, paragraphs: string[]): XmlElement {
  return el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '2', name }), el('p:nvPr', {})]),
    el('p:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '914400', y: '457200' }), el('a:ext', { cx: '5486400', cy: '1143000' })])]),
    el('p:txBody', {}, paragraphs.map((text) => el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt(text)])])]))),
  ]);
}

function pptxBytes(): Uint8Array<ArrayBuffer> {
  const slide = el('p:sld', { 'xmlns:p': PML_NS, 'xmlns:a': DML_NS }, [
    el('p:cSld', {}, [el('p:spTree', {}, [pptxShape('Title 1', ['Roadmap']), pptxShape('Body 2', ['Ship the codec', 'Then the CLI'])])]),
  ]);
  const presentation = el('p:presentation', { 'xmlns:p': PML_NS, 'xmlns:r': REL_NS }, [
    el('p:sldIdLst', {}, [el('p:sldId', { id: '256', 'r:id': 'rId1' })]),
    el('p:sldSz', { cx: '12192000', cy: '6858000' }),
  ]);
  return encodePackage({
    parts: {
      '[Content_Types].xml': {
        kind: 'xml',
        nodes: [contentTypes([{ part: '/ppt/presentation.xml', type: CT_PPTX }, { part: '/ppt/slides/slide1.xml', type: CT_SLIDE }])],
      },
      '_rels/.rels': { kind: 'xml', nodes: [relationships([{ id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'ppt/presentation.xml' }])] },
      'ppt/presentation.xml': { kind: 'xml', nodes: [presentation] },
      'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [relationships([{ id: 'rId1', type: REL_SLIDE, target: 'slides/slide1.xml' }])] },
      'ppt/slides/slide1.xml': { kind: 'xml', nodes: [slide] },
    },
  });
}

function slideGroups(document: DocumentPackage): SlideGroupNode[] {
  if (document.kind !== 'presentation') {
    throw new Error(`expected a presentation package, got "${document.kind}"`);
  }
  return document.children;
}

describe('readPptx: pptx bytes -> DocumentPackage', () => {
  it('reads a presentation package with one slide group per slide, each shape its own group inside it', () => {
    const document = readPptx(decodePackage(pptxBytes()));

    expect(document.kind).toBe('presentation');
    const slides = slideGroups(document);
    expect(slides).toHaveLength(1);
    // 12192000/6858000 EMU at 12700 EMU per point: the 16:9 slide size.
    expect(slides[0]?.node.size).toEqual({ widthPt: 960, heightPt: 540 });

    const shapes = slides[0]?.children.filter(isShapeGroupNode) ?? [];
    expect(shapes).toHaveLength(2);
    // A slide's paragraphs stay inside the shape that holds them -- flattening them across shapes would be a table-of-contents projection, not a decomposition.
    expect(shapes[1]?.children.filter((child) => 'kind' in child && child.kind === 'paragraph')).toHaveLength(2);
  });

  it('flattens back to exactly the slides and metadata readPptxContent reads', () => {
    const pkg = decodePackage(pptxBytes());
    const flattened = flattenPackage(readPptx(pkg));
    const content = readPptxContent(pkg);

    expect(flattened.kind).toBe('presentation');
    expect(flattened.metadata).toEqual(content.metadata);
    expect(flattened.kind === 'presentation' ? flattened.slides : undefined).toEqual(content.slides);
  });
});

// --- xlsx ---------------------------------------------------------------------------------------------------------

function fixtureBytes(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

describe('readXlsx / buildXlsxPackage: the xlsx DocumentPackage boundary', () => {
  it('reads a real LibreOffice-authored workbook into a spreadsheet package with one sheet group per sheet', () => {
    const document = readXlsx(decodePackage(fixtureBytes('kitchen-sink.xlsx')));

    expect(document.kind).toBe('spreadsheet');
    const sheets = document.kind === 'spreadsheet' ? document.children : [];
    expect(sheets.length).toBeGreaterThan(0);
    // A sheet's grid rides ON the group node (a ContentSheet minus its images and embedded objects), never scattered into children.
    expect(sheets[0]?.node.cells.length).toBeGreaterThan(0);
  });

  it('flattens back to exactly the ContentDocument readXlsxContent reads', () => {
    const pkg = decodePackage(fixtureBytes('kitchen-sink.xlsx'));

    expect(flattenPackage(readXlsx(pkg))).toEqual(readXlsxContent(pkg));
  });

  it('round-trips real workbook bytes -> DocumentPackage -> bytes with the cell values intact', () => {
    const first = readXlsx(decodePackage(fixtureBytes('kitchen-sink.xlsx')));
    const second = readXlsx(decodePackage(encodePackage(buildXlsxPackage(first))));

    const firstSheets = first.kind === 'spreadsheet' ? first.children : [];
    const secondSheets = second.kind === 'spreadsheet' ? second.children : [];
    expect(secondSheets.map((group) => group.node.name)).toEqual(firstSheets.map((group) => group.node.name));
    expect(secondSheets[0]?.node.cells.map((cell) => cell.value)).toEqual(firstSheets[0]?.node.cells.map((cell) => cell.value));
  });

  it('builds byte-for-byte the package the flat pair builds, so routing through the tree costs no fidelity of its own', () => {
    // The load-bearing property of this whole module: the tree path and the flat path are the same path. Stated as package equality rather than as a round-trip fixed point because the flat pair has two documented, pre-existing losses of its own -- cell comments are read but never written, and column widths re-approximate through xlsx's character-width unit on every write -- and neither is this module's to fix or to hide. What IS this module's to guarantee is that decompose-then-flatten adds nothing to that list, which is exactly what an identical built package says.
    const pkg = decodePackage(fixtureBytes('kitchen-sink.xlsx'));

    expect(buildXlsxPackage(readXlsx(pkg))).toEqual(buildXlsxPackageFromContent(readXlsxContent(pkg)));
  });

  it('refuses a package whose kind is not spreadsheet', () => {
    const wordprocessing = readDocx(decodePackage(docxBytes()));

    expect(() => buildXlsxPackage(wordprocessing)).toThrow('buildXlsxPackage: expected a DocumentPackage of kind "spreadsheet", got "wordprocessing"');
  });
});
