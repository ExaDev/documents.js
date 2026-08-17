import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import type { ContentBlock, ContentParagraph, ContentTable } from 'document-schema.js';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import { el, txt } from '../../xml/fragment';
import { parsePackage } from '../../package-io/read';
import { parseOdfLength } from '../shared/units';
import { readOdt } from './read';

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

describe('readOdt: kitchen-sink.odt (real LibreOffice output)', () => {
  const kitchenSink = loadFixture('kitchen-sink.odt');
  const { metadata, sections } = readOdt(kitchenSink);
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

describe('readOdt: minimal.odt (real LibreOffice output, default/unmodified page style)', () => {
  const minimal = loadFixture('minimal.odt');
  const { metadata, sections } = readOdt(minimal);
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

describe('readOdt: error and fallback paths (synthetic packages -- not something real LibreOffice output can exercise)', () => {
  it('throws when the package has no content.xml part at all', () => {
    expect(() => readOdt({ parts: {} })).toThrow(/content\.xml/);
  });

  it('throws when content.xml has no office:body/office:text element', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body')])] } } };
    expect(() => readOdt(pkg)).toThrow(/office:text/);
  });

  it('falls back to document-schema.js\'s own PAGE_SIZE_A4/2cm-margin defaults when styles.xml is missing entirely', () => {
    const pkg: Package = {
      parts: {
        'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text', {}, [el('text:p', {}, [txt('hello')])])])])] },
      },
    };
    const { sections } = readOdt(pkg);
    expect(sections[0]?.pageSize).toEqual(PAGE_SIZE_A4);
    expect(sections[0]?.margins.topPt).toBeCloseTo(knownLength('2cm'), 5);
  });

  it('reads an empty office:text as a section with no blocks, rather than throwing', () => {
    const pkg: Package = {
      parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text')])])] } },
    };
    const { sections } = readOdt(pkg);
    expect(sections[0]?.blocks).toEqual([]);
  });
});
