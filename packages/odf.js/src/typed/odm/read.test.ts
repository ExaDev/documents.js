import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import { el, txt } from '../../xml/fragment';
import { parsePackage } from '../../package-io/read';
import { readOdm } from './read';

// This suite reads a real, unmodified LibreOffice 26.2-generated .odm fixture (src/typed/odm/fixtures/two-chapters.odm, built via a headless UNO Basic macro -- see read.ts's own top-of-file note for the exact UNO calls -- never hand-edited afterwards) for the genuine-producer-shape assertions, mirroring readOdtContent's and readOdsContent's own established convention. Its two linked chapters (fixtures/chapter1.odt, fixtures/chapter2.odt) are checked in alongside it for realism -- a genuine master document is meaningless without its sibling files on disk -- though readOdm itself never opens them; it only ever reads the master document's own content.xml. A handful of narrow scope-boundary/error-path tests at the end use small, synthetic, hand-built packages instead (via el/txt), for shapes no genuine master document produced by this verification ever exercises (a non-master text:section with no text:section-source, a malformed section missing a required attribute) or that plain ODF cannot produce at all (a missing content.xml).

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

describe('readOdm: two-chapters.odm (real LibreOffice output)', () => {
  const { sections } = readOdm(loadFixture('two-chapters.odm'));

  it('reads exactly two chapters, in document order', () => {
    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.name)).toEqual(['Chapter1', 'Chapter2']);
  });

  it("reads each chapter's own text:section-source href and filter-name", () => {
    expect(sections[0]).toMatchObject({ name: 'Chapter1', href: '../chapter1.odt', filterName: 'writer8' });
    expect(sections[1]).toMatchObject({ name: 'Chapter2', href: '../chapter2.odt', filterName: 'writer8' });
  });

  it('never populates inlineContent -- not even for Chapter1, whose real text:section DOES carry ten non-empty child elements (LibreOffice\'s own chapter-numbering-continuity placeholders, not chapter content -- see read.ts\'s own top-of-file note)', () => {
    expect('inlineContent' in (sections[0] ?? {})).toBe(false);
    expect('inlineContent' in (sections[1] ?? {})).toBe(false);
    expect(sections[0]?.inlineContent).toBeUndefined();
    expect(sections[1]?.inlineContent).toBeUndefined();
  });
});

describe('readOdm: scope boundaries and error paths (synthetic packages)', () => {
  it('throws when the package has no content.xml part at all', () => {
    expect(() => readOdm({ parts: {} })).toThrow(/content\.xml/);
  });

  it('throws when content.xml is not an XML part', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'binary', base64: '' } } };
    expect(() => readOdm(pkg)).toThrow(/content\.xml/);
  });

  it('throws when content.xml has no office:body/office:text element', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body')])] } } };
    expect(() => readOdm(pkg)).toThrow(/office:text/);
  });

  it('reads an office:text with no sections at all as an empty sections array, rather than throwing', () => {
    const pkg: Package = {
      parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text')])])] } },
    };
    expect(readOdm(pkg).sections).toEqual([]);
  });

  it('skips a top-level text:section with no text:section-source child -- ODF\'s generic, non-master-document section (e.g. multi-column layout), not a chapter reference', () => {
    const plainSection = el('text:section', { 'text:name': 'ColumnLayout', 'text:style-name': 'Sect1' }, [el('text:p', {}, [txt('ordinary in-document content, not a linked chapter')])]);
    const pkg: Package = {
      parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text', {}, [plainSection])])])] } },
    };
    expect(readOdm(pkg).sections).toEqual([]);
  });

  it('skips a text:section-source-bearing section missing its own required text:name, without failing the whole document', () => {
    const unnamed = el('text:section', { 'text:style-name': 'Sect1' }, [el('text:section-source', { 'xlink:href': 'chapter.odt' })]);
    const named = el('text:section', { 'text:name': 'Chapter1', 'text:style-name': 'Sect1' }, [el('text:section-source', { 'xlink:href': 'chapter1.odt' })]);
    const pkg: Package = {
      parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text', {}, [unnamed, named])])])] } },
    };
    expect(readOdm(pkg).sections).toEqual([{ name: 'Chapter1', href: 'chapter1.odt' }]);
  });

  it('skips a section whose text:section-source is missing its own required xlink:href', () => {
    const noHref = el('text:section', { 'text:name': 'Chapter1', 'text:style-name': 'Sect1' }, [el('text:section-source', { 'text:filter-name': 'writer8' })]);
    const pkg: Package = {
      parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text', {}, [noHref])])])] } },
    };
    expect(readOdm(pkg).sections).toEqual([]);
  });

  it('omits filterName entirely (rather than reporting it as undefined) when text:section-source carries no text:filter-name attribute', () => {
    const section = el('text:section', { 'text:name': 'Chapter1', 'text:style-name': 'Sect1' }, [el('text:section-source', { 'xlink:href': 'chapter1.odt' })]);
    const pkg: Package = {
      parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text', {}, [section])])])] } },
    };
    const [result] = readOdm(pkg).sections;
    expect(result).toEqual({ name: 'Chapter1', href: 'chapter1.odt' });
    expect('filterName' in (result ?? {})).toBe(false);
  });

  it('preserves document order across more than two chapters, with a skipped (non-chapter) section in between not disturbing the order of the valid ones around it', () => {
    const chapter1 = el('text:section', { 'text:name': 'Chapter1', 'text:style-name': 'Sect1' }, [el('text:section-source', { 'xlink:href': 'chapter1.odt', 'text:filter-name': 'writer8' })]);
    const interlude = el('text:section', { 'text:name': 'Interlude', 'text:style-name': 'Sect1' }, [el('text:p', {}, [txt('not a linked chapter')])]);
    const chapter2 = el('text:section', { 'text:name': 'Chapter2', 'text:style-name': 'Sect1' }, [el('text:section-source', { 'xlink:href': 'chapter2.odt', 'text:filter-name': 'writer8' })]);
    const chapter3 = el('text:section', { 'text:name': 'Chapter3', 'text:style-name': 'Sect1' }, [el('text:section-source', { 'xlink:href': 'chapter3.odt', 'text:filter-name': 'writer8' })]);
    const pkg: Package = {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text', {}, [chapter1, interlude, chapter2, chapter3])])])],
        },
      },
    };
    expect(readOdm(pkg).sections.map((section) => section.name)).toEqual(['Chapter1', 'Chapter2', 'Chapter3']);
  });
});
