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
