
import type { ContentDocument, ContentVector } from 'document-schema.js';
import type { Package, XmlElement } from 'odf.js';
import { bytesToBase64, childrenWithTag, decodePackage, encodePackage, elementsWithTag, findChildElement, readDrawPageContent, rootElement } from 'odf.js';
import { attr } from 'ooxml.js';
import { encodePng } from 'byte-codec';
import { describe, expect, it } from 'vitest';
import { readOdtContent } from '../../odf/odt/read';
import { rotationsOf, VECTOR_FIXTURE, vectorDrawingBlock, withoutRotation } from '../../test-support/vectors';
import { buildOdtPackage } from './content';
import { OdtEditor } from './editor';

// A genuine, decodable 2x2 PNG -- readOdtContent's own image detection (src/odf/image/detect.ts) calls odf.js's own readDrawImageBlock, which sniffs the actual bytes and returns undefined for anything it cannot recognise as a real image format.
function tinyPngBase64(): string {
  return bytesToBase64(encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]) }));
}

function wordDoc(sections: Extract<ContentDocument, { kind: 'wordprocessing' }>['sections']): ContentDocument {
  return { kind: 'wordprocessing', metadata: {}, sections };
}

function contentRoot(pkg: Package): XmlElement {
  const part = pkg.parts['content.xml'];
  const root = part?.kind === 'xml' ? rootElement(part.nodes) : undefined;
  if (root === undefined) {
    throw new Error('expected an xml content.xml part with a root element');
  }
  return root;
}

function officeText(pkg: Package): XmlElement {
  const root = contentRoot(pkg);
  const body = findChildElement(root.children, 'office:body');
  const text = body === undefined ? undefined : findChildElement(body.children, 'office:text');
  if (text === undefined) {
    throw new Error('expected an office:body/office:text element');
  }
  return text;
}

// Every vector this package wrote into a text document's flow, read back through odf.js's OWN readDrawPageContent -- the same reader readOdgContent uses for a real drawing page -- rather than through an inverse written alongside the writer. A text-anchored vector lives inside the text:p it is anchored to (see OdtBody.appendVectors), so this hands that paragraph's children to the reader exactly as readOdg hands it a draw:page's.
function readFlowVectors(pkg: Package): ContentVector[] {
  return childrenWithTag(officeText(pkg), 'text:p').flatMap((paragraph) => readDrawPageContent(paragraph.children, pkg).vectors);
}

describe('buildOdtPackage', () => {
  it('throws for a presentation ContentDocument', () => {
    expect(() => buildOdtPackage({ kind: 'presentation', metadata: {}, slides: [] })).toThrow(/wordprocessing/);
  });

  it('builds a paragraph with styled runs', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: 'paragraph',
            alignment: 'center',
            runs: [
              { text: 'Bold red ', bold: true, color: { r: 1, g: 0, b: 0 } },
              { text: 'plain', fontFamily: 'Georgia', sizePt: 14 },
            ],
          },
        ],
      },
    ]);
    const editor = new OdtEditor(buildOdtPackage(content));
    const [paragraph] = editor.paragraphs();
    expect(paragraph?.text).toBe('Bold red plain');
    expect(paragraph?.alignment).toBe('center');
    const runs = paragraph!.runs();
    expect(runs[0]).toMatchObject({ text: 'Bold red ', bold: true, color: { r: 1, g: 0, b: 0 } });
    expect(runs[1]).toMatchObject({ text: 'plain', fontFamily: 'Georgia', sizePt: 14 });
  });

  it('inserts a real text:tab element for a run whose text is exactly a tab character', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [{ kind: 'paragraph', runs: [{ text: 'Left' }, { text: '\t' }, { text: 'Right' }] }],
      },
    ]);
    const editor = new OdtEditor(buildOdtPackage(content));
    const [paragraph] = editor.paragraphs();
    // runs() only surfaces text:span children, and the tab was written as a bare text:tab (not wrapped in a span) -- so paragraph.text (which does see it, via decodeOdfText) carries the tab, but runs() shows only the two real spans.
    expect(paragraph!.runs().map((r) => r.text)).toEqual(['Left', 'Right']);
    expect(paragraph!.text).toBe('Left\tRight');
  });

  // The heading contract the whole bridge hangs off: a paragraph carrying the canonical headingLevel becomes a real text:h element with text:outline-level and the ODF Heading_20_N style spelling -- never the producer's verbatim "Heading2", a synthetic cross-format shape no odt defines. Read back, odf.js's readParagraphOrHeading derives both spellings from the one text:h, restoring the exact input.
  it('writes a headingLevel paragraph as a real text:h, not a styled text:p, and round-trips it', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          { kind: 'paragraph', styleId: 'Heading2', headingLevel: 2, runs: [{ text: 'Chapter' }] },
          { kind: 'paragraph', runs: [{ text: 'Body' }] },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    const [heading] = childrenWithTag(officeText(pkg), 'text:h');
    expect(heading).toBeDefined();
    expect(attr(heading!, 'text:outline-level')).toBe('2');
    expect(attr(heading!, 'text:style-name')).toBe('Heading_20_2');
    expect(childrenWithTag(officeText(pkg), 'text:p')).toHaveLength(1);
    const roundTripped = readOdtContent(pkg);
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    expect(roundTripped.sections[0]!.blocks[0]).toMatchObject({ kind: 'paragraph', styleId: 'Heading2', headingLevel: 2, runs: [{ text: 'Chapter' }] });
  });

  // The promote lands BEFORE the applyStyleChange-based setters, so alignment resolves the heading style's own cascade and layers on top of it -- both facts then survive the round trip together, rather than the alignment intern repointing the paragraph away from its heading identity or vice versa.
  it('layers paragraph properties on top of the promoted heading style', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [{ kind: 'paragraph', styleId: 'Heading1', headingLevel: 1, alignment: 'center', runs: [{ text: 'Title' }] }],
      },
    ]);
    const roundTripped = readOdtContent(buildOdtPackage(content));
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    expect(roundTripped.sections[0]!.blocks[0]).toMatchObject({ kind: 'paragraph', headingLevel: 1, alignment: 'center' });
  });

  it('writes a headingLevel paragraph inside a list item as the text:h ODF allows there', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [{ kind: 'paragraph', list: { numId: 'L1', level: 0 }, headingLevel: 2, runs: [{ text: 'Item heading' }] }],
      },
    ]);
    const pkg = buildOdtPackage(content);
    // text:list-item directly contains its member text:p/text:h elements -- the heading sits inside the item, not beside the list.
    expect(elementsWithTag([officeText(pkg)], 'text:h')).toHaveLength(1);
    const roundTripped = readOdtContent(pkg);
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    expect(roundTripped.sections[0]!.blocks[0]).toMatchObject({ kind: 'paragraph', headingLevel: 2, list: { level: 0 }, runs: [{ text: 'Item heading' }] });
  });

  // odf.js's own reader reads table:table-cell content as text:p only (typed/shared/table.ts), so promoting a cell paragraph to text:h would write text its own reader cannot read back. The write side mirrors that scope: a cell heading stays a text:p carrying its text and the style reference, the heading level degrading exactly as the reader's own documented cell-scope gap does.
  it('keeps a heading paragraph inside a table cell a text:p, mirroring odf.js\'s own cell reading scope', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: 'table',
            columnWidthsPt: [100],
            rows: [{ cells: [{ blocks: [{ kind: 'paragraph', styleId: 'Heading3', headingLevel: 3, runs: [{ text: 'Cell heading' }] }] }] }],
          },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    expect(elementsWithTag([contentRoot(pkg)], 'text:h')).toHaveLength(0);
    const roundTripped = readOdtContent(pkg);
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const table = roundTripped.sections[0]!.blocks[0];
    if (table?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    expect(table.rows[0]!.cells[0]!.blocks[0]).toMatchObject({ kind: 'paragraph', styleId: 'Heading3', runs: [{ text: 'Cell heading' }] });
  });

  it('inserts a page break between sections', () => {
    const content: ContentDocument = {
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        { pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, blocks: [{ kind: 'paragraph', runs: [{ text: 'Section one' }] }] },
        { pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, blocks: [{ kind: 'paragraph', runs: [{ text: 'Section two' }] }] },
      ],
    };
    const editor = new OdtEditor(buildOdtPackage(content));
    const paragraphTexts = editor.paragraphs().map((p) => p.text);
    expect(paragraphTexts).toContain('Section one');
    expect(paragraphTexts).toContain('Section two');
  });

  it('builds a table with the right row/column count and cell text', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: 'table',
            columnWidthsPt: [100, 100],
            rows: [
              { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'A1' }] }] }, { blocks: [{ kind: 'paragraph', runs: [{ text: 'B1' }] }] }] },
              { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'A2' }] }] }, { blocks: [{ kind: 'paragraph', runs: [{ text: 'B2' }] }] }] },
            ],
          },
        ],
      },
    ]);
    const editor = new OdtEditor(buildOdtPackage(content));
    const [table] = editor.tables();
    const rows = table!.rows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cells()).toHaveLength(2);
    expect(rows[0]!.cells()[0]!.text).toBe('A1');
    expect(rows[1]!.cells()[1]!.text).toBe('B2');
  });

  it('a vertically merged (rowSpan) cell survives a build-then-read round trip as merged, not as two ordinary cells', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: 'table',
            columnWidthsPt: [100, 100],
            rows: [
              { cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'A1' }] }], rowSpan: 2 }, { blocks: [{ kind: 'paragraph', runs: [{ text: 'B1' }] }] }] },
              { cells: [{ blocks: [] }, { blocks: [{ kind: 'paragraph', runs: [{ text: 'B2' }] }] }] },
            ],
          },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    const roundTripped = readOdtContent(pkg);
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const tableBlock = roundTripped.sections[0]!.blocks[0];
    expect(tableBlock?.kind).toBe('table');
    if (tableBlock?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    // ODF keeps one array entry per grid position regardless of merges, so both rows still report two cells each.
    expect(tableBlock.rows[0]?.cells).toHaveLength(2);
    expect(tableBlock.rows[1]?.cells).toHaveLength(2);
    expect(tableBlock.rows[0]?.cells[0]?.rowSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[0]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'A1' }] });
    expect(tableBlock.rows[1]?.cells[0]?.rowSpan).toBeUndefined();
    expect(tableBlock.rows[1]?.cells[0]?.blocks).toEqual([]);
    expect(tableBlock.rows[0]?.cells[1]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'B1' }] });
    expect(tableBlock.rows[1]?.cells[1]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'B2' }] });
  });

  it('a horizontally merged (colSpan) cell survives a build-then-read round trip as merged, not as two ordinary cells', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: 'table',
            columnWidthsPt: [100, 100],
            rows: [{ cells: [{ blocks: [{ kind: 'paragraph', runs: [{ text: 'A1' }] }], colSpan: 2 }, { blocks: [] }] }],
          },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    const roundTripped = readOdtContent(pkg);
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const tableBlock = roundTripped.sections[0]!.blocks[0];
    expect(tableBlock?.kind).toBe('table');
    if (tableBlock?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    // ODF writes a real table:covered-table-cell placeholder for the consumed column, unlike docx's gridSpan-collapse -- so this row still reports two cells.
    expect(tableBlock.rows[0]?.cells).toHaveLength(2);
    expect(tableBlock.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(tableBlock.rows[0]?.cells[0]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'A1' }] });
    expect(tableBlock.rows[0]?.cells[1]?.blocks).toEqual([]);
  });

  it('inserts an image block as media, referenced from its own paragraph, and reads back through readOdtContent', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [{ kind: 'image', format: 'png', base64: tinyPngBase64(), widthPt: 100, heightPt: 50 }],
      },
    ]);
    const pkg = buildOdtPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) => p.startsWith('Pictures/'));
    expect(mediaParts).toHaveLength(1);
    // A bare image block with no preceding paragraph still gets one real text:p to anchor into (appendBlock's own 'image' case, mirroring buildDocxPackage's identical fallback) -- exactly one physical paragraph was written.
    expect(new OdtEditor(pkg).paragraphs()).toHaveLength(1);

    const recovered = readOdtContent(decodePackage(encodePackage(pkg)));
    if (recovered.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    // readOdtContent's own image detection never consumes the paragraph it finds the image in (see src/odf/odt/read.ts's own top-of-file comment) -- so the single physical text:p reads back as an empty paragraph block immediately followed by the image block, the identical two-block shape ooxml.js's own readDocx produces for a docx inline image with no surrounding text.
    expect(recovered.sections[0]!.blocks.map((block) => block.kind)).toEqual(['paragraph', 'image']);
    expect(recovered.sections[0]!.blocks[1]).toMatchObject({ kind: 'image', format: 'png', widthPt: 100, heightPt: 50 });
  });

  it('merges a real paragraph immediately followed by an image into one physical paragraph, not two', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          { kind: 'paragraph', runs: [{ text: 'Before' }] },
          { kind: 'paragraph', styleId: 'Standard', runs: [{ text: '' }] },
          { kind: 'image', format: 'png', base64: tinyPngBase64(), widthPt: 100, heightPt: 50 },
          { kind: 'paragraph', runs: [{ text: 'After' }] },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    // Exactly three real text:p elements were written -- if the merge failed, the empty run-carrying paragraph and its image would have landed as two separate paragraphs, producing four.
    const editor = new OdtEditor(pkg);
    expect(editor.paragraphs().map((p) => p.text)).toEqual(['Before', '', 'After']);

    // Reading the three physical paragraphs back splits the merged one into its own [paragraph, image] pair again (see the test above), so the four LOGICAL blocks the source declared survive exactly -- the merge only ever avoids an extra spurious PHYSICAL paragraph, never a logical one.
    const recovered = readOdtContent(decodePackage(encodePackage(pkg)));
    if (recovered.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    expect(recovered.sections[0]!.blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'image', 'paragraph']);
  });

  it('writes an image inside a table cell, unlike buildDocxPackage\'s own documented table-cell limitation', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [
          {
            kind: 'table',
            columnWidthsPt: [200, 200],
            rows: [{ cells: [{ blocks: [{ kind: 'image', format: 'png', base64: tinyPngBase64(), widthPt: 100, heightPt: 50 }] }, { blocks: [{ kind: 'paragraph', runs: [{ text: 'B1' }] }] }] }],
          },
        ],
      },
    ]);
    const pkg = buildOdtPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) => p.startsWith('Pictures/'));
    expect(mediaParts).toHaveLength(1);

    const editor = new OdtEditor(pkg);
    const [table] = editor.tables();
    const [row] = table!.rows();
    const [firstCell, secondCell] = row!.cells();
    expect(firstCell!.paragraphs()).toHaveLength(1); // the image reused the cell's own pre-built first paragraph, no stray blank one alongside it
    expect(secondCell!.text).toBe('B1');
  });

  it('writes a recovered drawing block as real draw: vector primitives that survive a build-then-read round trip', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [{ kind: 'paragraph', runs: [{ text: 'Before' }] }, vectorDrawingBlock({ widthPt: 612, heightPt: 792 }), { kind: 'paragraph', runs: [{ text: 'After' }] }],
      },
    ]);
    // Re-encoded and re-decoded, so what is read back has genuinely been through the zip/XML serialiser rather than being the same in-memory tree the writer produced.
    const pkg = decodePackage(encodePackage(buildOdtPackage(content)));
    const recovered = readFlowVectors(pkg);
    expect(withoutRotation(recovered)).toEqual(withoutRotation(VECTOR_FIXTURE));
    expect(rotationsOf(recovered)).toEqual([undefined, undefined, undefined, undefined, expect.closeTo(30, 4)]);
    // The surrounding text is untouched: the vectors sit in one anchor paragraph of their own between the two real ones.
    expect(new OdtEditor(pkg).paragraphs().map((p) => p.text)).toEqual(['Before', '', 'After']);
  });

  it('recovers a written drawing block back out through readOdtContent, not just through odf.js\'s own readDrawPageContent', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [{ kind: 'paragraph', runs: [{ text: 'Before' }] }, vectorDrawingBlock({ widthPt: 612, heightPt: 792 }), { kind: 'paragraph', runs: [{ text: 'After' }] }],
      },
    ]);
    const pkg = decodePackage(encodePackage(buildOdtPackage(content)));
    const roundTripped = readOdtContent(pkg);
    if (roundTripped.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const blocks = roundTripped.sections[0]!.blocks;
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'embeddedObject', 'paragraph']);
    const drawingBlock = blocks[1];
    if (drawingBlock?.kind !== 'embeddedObject' || drawingBlock.document.kind !== 'drawing') {
      throw new Error('expected a drawing-kind embeddedObject block');
    }
    expect(withoutRotation(drawingBlock.document.pages[0]?.vectors ?? [])).toEqual(withoutRotation(VECTOR_FIXTURE));
    expect(rotationsOf(drawingBlock.document.pages[0]?.vectors ?? [])).toEqual([undefined, undefined, undefined, undefined, expect.closeTo(30, 4)]);
  });

  // A vector's coordinates are page-absolute (that is what reconstructWordprocessing recovers), so an anchor paragraph is not enough on its own: without style:vertical-rel="page" every shape would be measured from wherever its anchor paragraph flowed to instead.
  it('anchors each vector to its paragraph but positions it against the page, behind the text', () => {
    const content = wordDoc([
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
        blocks: [vectorDrawingBlock({ widthPt: 612, heightPt: 792 })],
      },
    ]);
    const pkg = decodePackage(encodePackage(buildOdtPackage(content)));
    const [anchorParagraph] = childrenWithTag(officeText(pkg), 'text:p');
    const vectorElements = anchorParagraph!.children.filter((child): child is XmlElement => child.type === 'element');
    expect(vectorElements.map((element) => element.tag)).toEqual(['draw:rect', 'draw:ellipse', 'draw:line', 'draw:path', 'draw:rect']);
    expect(vectorElements.map((element) => attr(element, 'text:anchor-type'))).toEqual(Array.from(vectorElements, () => 'paragraph'));

    const automaticStyles = findChildElement(contentRoot(pkg).children, 'office:automatic-styles');
    if (automaticStyles === undefined) {
      throw new Error('expected an office:automatic-styles element');
    }
    const graphicProperties = childrenWithTag(automaticStyles, 'style:style')
      .filter((style) => attr(style, 'style:family') === 'graphic')
      .flatMap((style) => childrenWithTag(style, 'style:graphic-properties'));
    expect(graphicProperties).toHaveLength(vectorElements.length);
    for (const properties of graphicProperties) {
      expect(attr(properties, 'style:horizontal-rel')).toBe('page');
      expect(attr(properties, 'style:vertical-rel')).toBe('page');
      expect(attr(properties, 'style:run-through')).toBe('background');
      expect(attr(properties, 'style:wrap')).toBe('run-through');
    }
  });
});
