import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import type { ContentBlock, ContentParagraph, ContentTable } from 'document-schema.js';
import { flattenTree, PAGE_SIZE_A4 } from 'document-schema.js';
import { el, txt } from '../../xml/fragment';
import { parsePackage } from '../../package-io/read';
import { parseOdfLength } from '../shared/units';
import { assertPackageRoundTrip, wordprocessingPackage } from '../../test-support/document-tree';
import { readOdt, readOdtContent } from './read';

// This suite reads real, unmodified LibreOffice 26.2-generated .odt fixtures (src/typed/odt/fixtures/*.odt, built via a headless UNO Basic macro -- see this repository's own commit history for the exact macro -- never hand-edited afterwards) rather than programmatically reconstructing the expected XML shapes: the task this reader was built against is explicit that whitespace preservation, list nesting, and merged-cell handling must each be proven against genuine producer output, not just this package's own idea of what that output looks like. A handful of narrow error/fallback-path tests at the end use small, synthetic, hand-built packages instead (via el/txt, matching this package's other typed-reader tests), since those specific paths -- a missing content.xml, a missing office:text -- are not something any real LibreOffice document can ever actually produce.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

function knownLength(value: string): number {
  const parsed = parseOdfLength(value);
  if (parsed === undefined) {
    throw new Error(`test fixture error: "${value}" is not a valid ODF length literal`);
  }
  return parsed;
}

function isParagraph(block: ContentBlock | undefined): block is ContentParagraph {
  return block?.kind === 'paragraph';
}

function isTable(block: ContentBlock | undefined): block is ContentTable {
  return block?.kind === 'table';
}

function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (!isParagraph(block)) {
    throw new Error('expected a paragraph block');
  }
  return block;
}

function asTable(block: ContentBlock | undefined): ContentTable {
  if (!isTable(block)) {
    throw new Error('expected a table block');
  }
  return block;
}

describe('readOdtContent: kitchen-sink.odt (real LibreOffice output)', () => {
  const kitchenSink = loadFixture('kitchen-sink.odt');
  const { metadata, sections } = readOdtContent(kitchenSink);
  const section = sections[0];
  if (section === undefined) {
    throw new Error('expected at least one section');
  }
  const blocks = section.blocks;

  it('produces exactly one section', () => {
    expect(sections).toHaveLength(1);
  });

  it('reads document metadata from a real meta.xml', () => {
    expect(metadata.title).toBe('Kitchen Sink Test Document');
    expect(metadata.subject).toBe('odf.js readOdt fixture');
    expect(metadata.author).toBe('odf.js test suite');
    expect(metadata.keywords).toEqual(['odf', 'fixture']);
  });

  it('reads the explicitly-set page size and margins from the first master page', () => {
    expect(section.pageSize.widthPt).toBeCloseTo(knownLength('20.001cm'), 5);
    expect(section.pageSize.heightPt).toBeCloseTo(knownLength('25cm'), 5);
    expect(section.margins.topPt).toBeCloseTo(knownLength('2cm'), 5);
    expect(section.margins.bottomPt).toBeCloseTo(knownLength('2cm'), 5);
    expect(section.margins.leftPt).toBeCloseTo(knownLength('1.499cm'), 5);
    expect(section.margins.rightPt).toBeCloseTo(knownLength('1.499cm'), 5);
  });

  it('maps a level-1 heading (text:h, text:outline-level="1") onto styleId "Heading1" and headingLevel 1', () => {
    const chapterOne = asParagraph(blocks[0]);
    expect(chapterOne.styleId).toBe('Heading1');
    expect(chapterOne.headingLevel).toBe(1);
    expect(chapterOne.runs.map((r) => r.text).join('')).toBe('Chapter One');
  });

  it('maps a level-2 heading onto styleId "Heading2" and headingLevel 2', () => {
    const sectionHeading = blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Section One Point One');
    expect(asParagraph(sectionHeading).styleId).toBe('Heading2');
    expect(asParagraph(sectionHeading).headingLevel).toBe(2);
  });

  it('reads plain multi-paragraph body text in document order', () => {
    const first = asParagraph(blocks[1]);
    const second = asParagraph(blocks[2]);
    expect(first.runs.map((r) => r.text).join('')).toContain('first paragraph of chapter one');
    expect(second.runs.map((r) => r.text).join('')).toContain('second paragraph, immediately following');
  });

  it('splits a paragraph into multiple runs at text:span boundaries, resolving each span\'s own bold/italic formatting', () => {
    const mixed = blocks.find((b) => b.kind === 'paragraph' && b.runs.some((r) => r.text === 'bold text'));
    const paragraph = asParagraph(mixed);
    expect(paragraph.runs.length).toBeGreaterThanOrEqual(6);
    const boldRun = paragraph.runs.find((r) => r.text === 'bold text');
    const italicRun = paragraph.runs.find((r) => r.text === 'italic text');
    const boldItalicRun = paragraph.runs.find((r) => r.text === 'bold italic');
    expect(boldRun?.bold).toBe(true);
    expect(boldRun?.italic).toBeFalsy();
    expect(italicRun?.italic).toBe(true);
    expect(italicRun?.bold).toBeFalsy();
    expect(boldItalicRun?.bold).toBe(true);
    expect(boldItalicRun?.italic).toBe(true);
  });

  it('preserves whitespace through decodeOdfText-equivalent handling: a text:s run of 3 spaces, a text:tab, and a text:line-break', () => {
    const whitespaceParagraph = blocks.find((b) => b.kind === 'paragraph' && b.runs.some((r) => r.text.includes('Word1')));
    const paragraph = asParagraph(whitespaceParagraph);
    const fullText = paragraph.runs.map((r) => r.text).join('');
    expect(fullText).toBe('Word1   Word2\tWord3\nWord4');
  });

  it('reads a 2-level nested bulleted list as one numId, level 0 for top-level items and level 1 for nested items', () => {
    const bulletA = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Bullet A'));
    const bulletB = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Bullet B'));
    const nested1 = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Bullet B nested 1'));
    const nested2 = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Bullet B nested 2'));
    const bulletC = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Bullet C'));

    expect(bulletA.list?.level).toBe(0);
    expect(bulletB.list?.level).toBe(0);
    expect(nested1.list?.level).toBe(1);
    expect(nested2.list?.level).toBe(1);
    expect(bulletC.list?.level).toBe(0);

    const numId = bulletA.list?.numId;
    expect(numId).toBeDefined();
    expect(bulletB.list?.numId).toBe(numId);
    expect(nested1.list?.numId).toBe(numId);
    expect(nested2.list?.numId).toBe(numId);
    expect(bulletC.list?.numId).toBe(numId);
  });

  it('reads a 2-level nested numbered list as a DIFFERENT numId from the bulleted list', () => {
    const bulletA = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Bullet A'));
    const numA = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Num A'));
    const numB = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Num B'));
    const numNested1 = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Num B nested 1'));
    const numC = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Num C'));

    expect(numA.list?.level).toBe(0);
    expect(numB.list?.level).toBe(0);
    expect(numNested1.list?.level).toBe(1);
    expect(numC.list?.level).toBe(0);

    const numId = numA.list?.numId;
    expect(numId).toBeDefined();
    expect(numId).not.toBe(bulletA.list?.numId);
    expect(numB.list?.numId).toBe(numId);
    expect(numNested1.list?.numId).toBe(numId);
    expect(numC.list?.numId).toBe(numId);
  });

  it('does not carry list membership onto the heading immediately following the numbered list', () => {
    const tableSection = asParagraph(blocks.find((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Table Section'));
    expect(tableSection.list).toBeUndefined();
    expect(tableSection.styleId).toBe('Heading1');
    expect(tableSection.headingLevel).toBe(1);
  });

  it('reads a table with a genuinely merged cell: colSpan on the anchor cell, an empty placeholder cell for the covered cell (mirroring ooxml.js\'s own vMerge-continuation convention), and the third cell unaffected', () => {
    const table = asTable(blocks.find((b) => b.kind === 'table'));
    expect(table.columnWidthsPt).toHaveLength(3);
    expect(table.columnWidthsPt.every((w) => w > 0)).toBe(true);
    expect(table.rows).toHaveLength(3);

    const headerRow = table.rows[0];
    expect(headerRow?.cells).toHaveLength(3);
    expect(headerRow?.cells[0]?.colSpan).toBe(2);
    expect(asParagraph(headerRow?.cells[0]?.blocks[0]).runs[0]?.text).toBe('Merged Header');
    expect(headerRow?.cells[1]).toEqual({ blocks: [] });
    expect(asParagraph(headerRow?.cells[2]?.blocks[0]).runs[0]?.text).toBe('C');
  });

  it('reads the table\'s own data rows in document order', () => {
    const table = asTable(blocks.find((b) => b.kind === 'table'));
    const row2Texts = table.rows[1]?.cells.map((cell) => asParagraph(cell.blocks[0]).runs[0]?.text);
    const row3Texts = table.rows[2]?.cells.map((cell) => asParagraph(cell.blocks[0]).runs[0]?.text);
    expect(row2Texts).toEqual(['A1', 'B1', 'C1']);
    expect(row3Texts).toEqual(['A2', 'B2', 'C2']);
  });

  it('reads the final chapter heading and paragraph after the table, in document order', () => {
    const chapterTwoIndex = blocks.findIndex((b) => b.kind === 'paragraph' && b.runs[0]?.text === 'Chapter Two');
    expect(chapterTwoIndex).toBeGreaterThan(-1);
    const chapterTwo = asParagraph(blocks[chapterTwoIndex]);
    expect(chapterTwo.styleId).toBe('Heading1');
    expect(chapterTwo.headingLevel).toBe(1);
    const closing = asParagraph(blocks[chapterTwoIndex + 1]);
    expect(closing.runs.map((r) => r.text).join('')).toContain("second chapter's opening paragraph");
  });
});

describe('readOdtContent: minimal.odt (real LibreOffice output, default/unmodified page style)', () => {
  const minimal = loadFixture('minimal.odt');
  const { metadata, sections } = readOdtContent(minimal);
  const section = sections[0];
  if (section === undefined) {
    throw new Error('expected at least one section');
  }

  it('reads document metadata', () => {
    expect(metadata.title).toBe('Minimal Test Document');
    expect(metadata.author).toBe('odf.js test suite');
  });

  it('reads LibreOffice\'s own default (unmodified) page geometry from the first master page -- A4, 2cm margins', () => {
    expect(section.pageSize.widthPt).toBeCloseTo(knownLength('21.001cm'), 5);
    expect(section.pageSize.heightPt).toBeCloseTo(knownLength('29.7cm'), 5);
    expect(section.margins.topPt).toBeCloseTo(knownLength('2cm'), 5);
    expect(section.margins.leftPt).toBeCloseTo(knownLength('2cm'), 5);
  });

  it('reads a heading and a single body paragraph, with no list and no table', () => {
    expect(section.blocks).toHaveLength(2);
    const heading = asParagraph(section.blocks[0]);
    expect(heading.styleId).toBe('Heading1');
    expect(heading.headingLevel).toBe(1);
    expect(heading.runs.map((r) => r.text).join('')).toBe('Minimal Document');
    const body = asParagraph(section.blocks[1]);
    expect(body.list).toBeUndefined();
  });
});

describe('readOdtContent: master pages after the first, and header/footer content (synthetic packages built to the OASIS grammar)', () => {
  // Every package below carries content.xml + styles.xml with two style:master-page elements: "Standard" (A4 portrait) and "Landscape" (A4 landscape), matching the shape a real Writer document's own mid-document page-style switch produces. The fixtures are programmatic per the issue's own stated gate: real-producer verification for these rows is outstanding (shared with the corpus gate).
  function masterPage(name: string, pageLayoutName: string, children: XmlElement[] = []): XmlElement {
    return el('style:master-page', { 'style:name': name, 'style:page-layout-name': pageLayoutName }, children);
  }

  function pageLayout(name: string, widthPt: string, heightPt: string): XmlElement {
    return el('style:page-layout', { 'style:name': name }, [el('style:page-layout-properties', { 'fo:page-width': widthPt, 'fo:page-height': heightPt })]);
  }

  function packageWith(textChildren: XmlElement[], automaticStyles: XmlElement[] = [], landscapeChildren: XmlElement[] = []): Package {
    return {
      parts: {
        'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:automatic-styles', {}, automaticStyles), el('office:body', {}, [el('office:text', {}, textChildren)])])] },
        'styles.xml': {
          kind: 'xml',
          nodes: [
            el('office:document-styles', {}, [
              el('office:automatic-styles', {}, [pageLayout('PM1', '210mm', '297mm'), pageLayout('PM2', '297mm', '210mm')]),
              el('office:master-styles', {}, [masterPage('Standard', 'PM1'), masterPage('Landscape', 'PM2', landscapeChildren)]),
            ]),
          ],
        },
      },
    };
  }

  it('keeps one section when no paragraph style names a master page', () => {
    const pkg = packageWith([el('text:p', {}, [txt('body')])]);
    const { sections } = readOdtContent(pkg);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.breakType).toBeUndefined();
  });

  it('splits a second section at a paragraph whose style switches master page, with that master page\'s geometry and breakType nextPage', () => {
    const switchStyle = el('style:style', { 'style:name': 'LandscapePara', 'style:family': 'paragraph' }, [
      el('style:paragraph-properties', { 'style:master-page-name': 'Landscape' }),
    ]);
    const pkg = packageWith(
      [el('text:p', {}, [txt('portrait')]), el('text:p', { 'text:style-name': 'LandscapePara' }, [txt('landscape')])],
      [switchStyle],
    );
    const { sections, sectionMasterPages } = readOdtContent(pkg);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.pageSize).toEqual({ widthPt: knownLength('210mm'), heightPt: knownLength('297mm') });
    expect(sections[1]?.pageSize).toEqual({ widthPt: knownLength('297mm'), heightPt: knownLength('210mm') });
    expect(sections[1]?.breakType).toBe('nextPage');
    expect(sections[1]?.blocks).toHaveLength(1);
    expect(sectionMasterPages).toEqual(['Standard', 'Landscape']);
  });

  it('starts the document on the master page the first paragraph names, without an empty leading section', () => {
    const switchStyle = el('style:style', { 'style:name': 'LandscapePara', 'style:family': 'paragraph' }, [
      el('style:paragraph-properties', { 'style:master-page-name': 'Landscape' }),
    ]);
    const pkg = packageWith([el('text:p', { 'text:style-name': 'LandscapePara' }, [txt('starts landscape')])], [switchStyle]);
    const { sections, sectionMasterPages } = readOdtContent(pkg);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.pageSize.widthPt).toBeCloseTo(knownLength('297mm'), 5);
    expect(sectionMasterPages).toEqual(['Landscape']);
  });

  it('survives the package boundary: the split sections, geometry, and breakType all flatten back out of readOdt\'s tree exactly', () => {
    const switchStyle = el('style:style', { 'style:name': 'LandscapePara', 'style:family': 'paragraph' }, [
      el('style:paragraph-properties', { 'style:master-page-name': 'Landscape' }),
    ]);
    const pkg = packageWith(
      [el('text:p', {}, [txt('portrait')]), el('text:p', { 'text:style-name': 'LandscapePara' }, [txt('landscape')])],
      [switchStyle],
    );
    const flat = flattenTree(readOdt(pkg));
    if (flat.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing document');
    }
    const { sections } = readOdtContent(pkg);
    expect(flat.sections).toEqual(sections);
  });

  it('drops a construct extent that spans the master-page switch, keeping each section\'s own markers balanced', () => {
    const switchStyle = el('style:style', { 'style:name': 'LandscapePara', 'style:family': 'paragraph' }, [
      el('style:paragraph-properties', { 'style:master-page-name': 'Landscape' }),
    ]);
    const pkg = packageWith(
      [el('text:section', { 'text:name': 'SpansSwitch' }, [el('text:p', {}, [txt('before')]), el('text:p', { 'text:style-name': 'LandscapePara' }, [txt('after')])])],
      [switchStyle],
    );
    const { sections } = readOdtContent(pkg);
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      // Each section's marker list balances on its own -- the division's extent crossed the section boundary, and a pair split across two block lists has no encoding (the same ratification a table-cell-straddling pair takes).
      expect(section.blocks.filter((block) => block.kind === 'constructStart')).toHaveLength(0);
      expect(section.blocks.filter((block) => block.kind === 'constructEnd')).toHaveLength(0);
    }
  });

  it('reads a master page\'s style:header and style:footer as block content keyed to that master page', () => {
    const pkg = packageWith([el('text:p', {}, [txt('body')])], [], [
      el('style:header', {}, [el('text:p', {}, [txt('Header line')])]),
      el('style:footer', {}, [el('text:p', {}, [el('text:page-number', {}, [txt('2')])])]),
    ]);
    const { headerFooterParts } = readOdtContent(pkg);
    expect(headerFooterParts).toHaveLength(2);
    expect(headerFooterParts?.[0]).toMatchObject({ masterPage: 'Landscape', kind: 'header', variant: 'default' });
    expect(headerFooterParts?.[0]?.blocks).toHaveLength(1);
    expect(headerFooterParts?.[1]).toMatchObject({ masterPage: 'Landscape', kind: 'footer', variant: 'default' });
    // A field inside a footer is real run content with its field extent, not a bare string.
    const footerParagraph = headerFooterParts?.[1]?.blocks[0];
    expect(footerParagraph).toMatchObject({ kind: 'paragraph', runs: [{ text: '2' }] });
  });

  it('reads the left and first header variants under their own variant names, and skips a style:display="false" header', () => {
    const pkg = packageWith([el('text:p', {}, [txt('body')])], [], [
      el('style:header', { 'style:display': 'false' }),
      el('style:header-left', {}, [el('text:p', {}, [txt('left header')])]),
      el('style:header-first', {}, [el('text:p', {}, [txt('first header')])]),
      el('style:footer-first', {}, [el('text:p', {}, [txt('first footer')])]),
    ]);
    const { headerFooterParts } = readOdtContent(pkg);
    expect(headerFooterParts?.map((part) => `${part.kind}:${part.variant}`)).toEqual(['header:left', 'header:first', 'footer:first']);
  });
});

describe('readOdtContent: error and fallback paths (synthetic packages -- not something real LibreOffice output can exercise)', () => {
  it('throws when the package has no content.xml part at all', () => {
    expect(() => readOdtContent({ parts: {} })).toThrow(/content\.xml/);
  });

  it('throws when content.xml has no office:body/office:text element', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body')])] } } };
    expect(() => readOdtContent(pkg)).toThrow(/office:text/);
  });

  it('falls back to document-schema.js\'s own PAGE_SIZE_A4/2cm-margin defaults when styles.xml is missing entirely', () => {
    const pkg: Package = {
      parts: {
        'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text', {}, [el('text:p', {}, [txt('hello')])])])])] },
      },
    };
    const { sections } = readOdtContent(pkg);
    expect(sections[0]?.pageSize).toEqual(PAGE_SIZE_A4);
    expect(sections[0]?.margins.topPt).toBeCloseTo(knownLength('2cm'), 5);
  });

  it('reads an empty office:text as a section with no blocks, rather than throwing', () => {
    const pkg: Package = {
      parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text')])])] } },
    };
    const { sections } = readOdtContent(pkg);
    expect(sections[0]?.blocks).toEqual([]);
  });
});

describe('readOdt: the package-native reader over the same real fixtures', () => {
  it('assembles kitchen-sink.odt into a wordprocessing package whose tree flattens back to readOdtContent output exactly', () => {
    const pkg = loadFixture('kitchen-sink.odt');
    const content = readOdtContent(pkg);
    const documentPackage = readOdt(pkg);

    expect(documentPackage.kind).toBe('wordprocessing');
    // The definitions table is tree-only by design (the flat ContentDocument is the codec-exchange content shape and has no root to hold one), so the round-trip harness below compares against the flat projection -- readOdt's own root carries the fixture's sequence declarations, pinned in the constructs suite.
    expect(documentPackage.metadata).toEqual(content.metadata);
    // One section group per ContentSection -- the tree's mandatory top-level grouping, not a flattening of the section's own blocks.
    expect(documentPackage.children).toHaveLength(content.sections.length);
    assertPackageRoundTrip(documentPackage, { kind: 'wordprocessing', metadata: content.metadata, sections: content.sections });
  });

  it('groups this fixture\'s headings into real heading groups carrying their following blocks, rather than a flat block list', () => {
    const documentPackage = wordprocessingPackage(readOdt(loadFixture('kitchen-sink.odt')));
    const section = documentPackage.children[0];
    if (section === undefined) {
      throw new Error('expected one section group');
    }
    // Every top-level child of this fixture's section is a heading group (its body paragraphs and its table sit INSIDE the heading they follow), which is precisely the structure the flat ContentSection.blocks list cannot express.
    for (const child of section.children) {
      if (!('node' in child) || !('kind' in child.node) || child.node.kind !== 'paragraph') {
        throw new Error('expected every top-level section child to be a heading group');
      }
      expect(child.node.headingLevel).toBeGreaterThanOrEqual(1);
      expect(child.children.length).toBeGreaterThan(0);
    }
    expect(section.children.length).toBeGreaterThan(1);
  });

  it('mints a real styles table over the repeated run properties this fixture actually carries', () => {
    const documentPackage = wordprocessingPackage(readOdt(loadFixture('kitchen-sink.odt')));
    // Not an assertion that some fixed entry exists: the fixture's own repeated property tuples are what mint, so the check is that minting HAPPENED and that every ref in the tree names an entry the table defines.
    const styles = documentPackage.styles;
    expect(styles).toBeDefined();
    expect(Object.keys(styles ?? {}).length).toBeGreaterThan(0);
    for (const section of documentPackage.children) {
      for (const child of section.children) {
        if ('node' in child && child.style !== undefined) {
          expect(styles?.[child.style]).toBeDefined();
        }
      }
    }
  });

  it('assembles minimal.odt into a package that round-trips identically', () => {
    const pkg = loadFixture('minimal.odt');
    const content = readOdtContent(pkg);
    assertPackageRoundTrip(readOdt(pkg), { kind: 'wordprocessing', metadata: content.metadata, sections: content.sections });
  });

  it('throws from the package-native reader exactly as the content reader does, on a package with no content.xml', () => {
    const pkg: Package = { parts: {} };
    expect(() => readOdt(pkg)).toThrow('readOdtContent: package has no content.xml part');
  });
});
