import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { describe, expect, it } from 'vitest';
import type { ContentBlock, ContentEmbeddedObjectBlock, ContentImageBlock, ContentParagraph, ContentTable } from 'document-schema.js';
import { el, txt } from '../../xml/fragment';
import { bytesToBase64 } from '../../util/base64';
import { zipPackage } from '../../zip';
import { minimalXlsxBytes } from '../../test-support/embedded';
import { PptxDocumentSchema, readPptxContent } from './read';

// Ported from documents.js's src/ooxml/pptx/read.test.ts, adapted to readPptxContent's own PptxDocument shape (no wrapping ContentDocument discriminant) and dropping the dependency on documents.js's own PNG encoder (out of this port's scope): sniffImageFormat only inspects magic bytes, so a bare PNG-signature-prefixed byte array stands in for a real encoded PNG here.

function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== 'paragraph') {
    throw new Error('expected a paragraph block');
  }
  return block;
}

function asTable(block: ContentBlock | undefined): ContentTable {
  if (block?.kind !== 'table') {
    throw new Error('expected a table block');
  }
  return block;
}

function asImage(block: ContentBlock | undefined): ContentImageBlock {
  if (block?.kind !== 'image') {
    throw new Error('expected an image block');
  }
  return block;
}

function asEmbeddedObject(block: ContentBlock | undefined): ContentEmbeddedObjectBlock {
  if (block?.kind !== 'embeddedObject') {
    throw new Error('expected an embeddedObject block');
  }
  return block;
}

const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const SLIDE_LAYOUT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';
const SLIDE_MASTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster';
const THEME_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const HYPERLINK_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const NOTES_SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';
const CHART_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';

function rels(entries: { id: string; type: string; target: string; external?: boolean }[]): XmlElement {
  return el(
    'Relationships',
    {},
    entries.map((e) => el('Relationship', e.external ? { Id: e.id, Type: e.type, Target: e.target, TargetMode: 'External' } : { Id: e.id, Type: e.type, Target: e.target })),
  );
}

// Only the PNG magic-byte signature matters to sniffImageFormat -- the rest is arbitrary filler, not a real encoded image.
function tinyPngBase64(): string {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  return bytesToBase64(bytes);
}

function buildFixturePackage(): Package {
  // --- slide1: title placeholder (inherited geometry + run cascade), hyperlink, underline/strike, image, table, group.
  const titleRun1 = el('a:r', {}, [el('a:t', {}, [txt('Hello')])]); // no own rPr: fully inherits from master titleStyle
  const titleRun2 = el('a:r', { }, [el('a:rPr', { sz: '2000', i: '1' }), el('a:t', {}, [txt(' World')])]); // explicit size+italic override, rest inherited
  const titlePara = el('a:p', {}, [titleRun1, titleRun2]);
  const titleShape = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '2', name: 'Title 1' }), el('p:cNvSpPr'), el('p:nvPr', {}, [el('p:ph', { type: 'title' })])]),
    el('p:spPr'), // no own xfrm -- must inherit from layout
    el('p:txBody', {}, [titlePara]),
  ]);

  const hyperlinkRun = el('a:r', {}, [el('a:rPr', {}, [el('a:hlinkClick', { 'r:id': 'rIdHlink' })]), el('a:t', {}, [txt('link text')])]);
  const styledRun = el('a:r', {}, [el('a:rPr', { u: 'sng', strike: 'sngStrike' }), el('a:t', {}, [txt('styled')])]);
  const bodyPara = el(
    'a:p',
    {},
    [el('a:pPr', { algn: 'ctr', marL: '457200', indent: '-457200' }, [el('a:spcBef', {}, [el('a:spcPts', { val: '600' })]), el('a:lnSpc', {}, [el('a:spcPct', { val: '150000' })])]), hyperlinkRun, styledRun],
  );
  const bodyShape = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '3', name: 'Body 1' }), el('p:cNvSpPr'), el('p:nvPr')]),
    el('p:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '914400', y: '2286000' }), el('a:ext', { cx: '3657600', cy: '914400' })])]),
    el('p:txBody', {}, [el('a:bodyPr', { lIns: '182880', tIns: '91440', rIns: '182880', bIns: '91440' }, [el('a:normAutofit', { fontScale: '92000', lnSpcReduction: '10000' })]), bodyPara]),
  ]);

  const picShape = el('p:pic', {}, [
    el('p:nvPicPr', {}, [el('p:cNvPr', { id: '4', name: 'Picture 1' }), el('p:cNvPicPr'), el('p:nvPr')]),
    el('p:blipFill', {}, [el('a:blip', { 'r:embed': 'rIdImage' })]),
    el('p:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '635000', y: '635000' }), el('a:ext', { cx: '1016000', cy: '1016000' })])]),
  ]);

  const mergedCell = el('a:tc', { gridSpan: '2' }, [el('a:txBody', {}, [el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt('Merged')])])])])]);
  const continuationCell = el('a:tc', { hMerge: '1' }, [el('a:txBody', {}, [el('a:p')])]);
  const cellA = el('a:tc', {}, [el('a:tcPr', {}, [el('a:solidFill', {}, [el('a:srgbClr', { val: 'FF0000' })])]), el('a:txBody', {}, [el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt('A')])])])])]);
  const cellB = el('a:tc', {}, [el('a:txBody', {}, [el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt('B')])])])])]);
  const tbl = el('a:tbl', {}, [
    el('a:tblGrid', {}, [el('a:gridCol', { w: '1270000' }), el('a:gridCol', { w: '1905000' })]),
    el('a:tr', { h: '457200' }, [mergedCell, continuationCell]),
    el('a:tr', {}, [cellA, cellB]),
  ]);
  const tableFrame = el('p:graphicFrame', {}, [
    el('p:nvGraphicFramePr', {}, [el('p:cNvPr', { id: '5', name: 'Table 1' })]),
    el('p:xfrm', {}, [el('a:off', { x: '914400', y: '3657600' }), el('a:ext', { cx: '3175000', cy: '914400' })]),
    el('a:graphic', {}, [el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/table' }, [tbl])]),
  ]);

  const groupChildShape = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '7', name: 'Grouped shape' }), el('p:cNvSpPr'), el('p:nvPr')]),
    el('p:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '127000', y: '127000' }), el('a:ext', { cx: '254000', cy: '254000' })])]),
    el('p:txBody', {}, [el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt('Grouped')])])])]),
  ]);
  const groupShape = el('p:grpSp', {}, [
    el('p:nvGrpSpPr', {}, [el('p:cNvPr', { id: '6', name: 'Group 1' })]),
    el(
      'p:grpSpPr',
      {},
      [el('a:xfrm', {}, [el('a:off', { x: '1270000', y: '1270000' }), el('a:ext', { cx: '2540000', cy: '2540000' }), el('a:chOff', { x: '0', y: '0' }), el('a:chExt', { cx: '1270000', cy: '1270000' })])],
    ),
    groupChildShape,
  ]);

  const spTree1 = el('p:spTree', {}, [titleShape, bodyShape, picShape, tableFrame, groupShape]);
  const slide1 = el('p:sld', {}, [el('p:cSld', {}, [spTree1])]);

  const slide1Rels = rels([
    { id: 'rIdLayout', type: SLIDE_LAYOUT_REL, target: '../slideLayouts/slideLayout1.xml' },
    { id: 'rIdImage', type: IMAGE_REL, target: '../media/image1.png' },
    { id: 'rIdHlink', type: HYPERLINK_REL, target: 'https://example.com', external: true },
    { id: 'rIdNotes', type: NOTES_SLIDE_REL, target: '../notesSlides/notesSlide1.xml' },
  ]);

  // --- slide2: standalone, rotated shape, no layout/master.
  const slide2Shape = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '2', name: 'Rotated' }), el('p:cNvSpPr'), el('p:nvPr')]),
    el('p:spPr', {}, [el('a:xfrm', { rot: '2700000' }, [el('a:off', { x: '127000', y: '127000' }), el('a:ext', { cx: '635000', cy: '635000' })])]),
    el('p:txBody', {}, [el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt('Second Slide')])])])]),
  ]);
  const slide2 = el('p:sld', {}, [el('p:cSld', {}, [el('p:spTree', {}, [slide2Shape])])]);

  // --- notesSlide1: a body placeholder with the actual speaker notes.
  const notesShape = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '2', name: 'Notes Placeholder' }), el('p:cNvSpPr'), el('p:nvPr', {}, [el('p:ph', { type: 'body', idx: '1' })])]),
    el('p:spPr'),
    el('p:txBody', {}, [el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt('Speaker notes here')])])])]),
  ]);
  const slideNumShape = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '3', name: 'Slide Number Placeholder' }), el('p:cNvSpPr'), el('p:nvPr', {}, [el('p:ph', { type: 'sldNum', idx: '2' })])]),
    el('p:spPr'),
    el('p:txBody', {}, [el('a:p', {}, [el('a:fld', { id: '{00000000-0000-0000-0000-000000000000}', type: 'slidenum' }, [el('a:t', {}, [txt('1')])])])]),
  ]);
  const notesSlide1 = el('p:notes', {}, [el('p:cSld', {}, [el('p:spTree', {}, [notesShape, slideNumShape])])]);

  // --- layout: title placeholder with the geometry the slide's own title inherits.
  const layoutTitleShape = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '2', name: 'Title Placeholder' }), el('p:cNvSpPr'), el('p:nvPr', {}, [el('p:ph', { type: 'title' })])]),
    el('p:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '914400', y: '457200' }), el('a:ext', { cx: '10363200', cy: '1143000' })])]),
  ]);
  const layout1 = el('p:sldLayout', {}, [el('p:cSld', {}, [el('p:spTree', {}, [layoutTitleShape])])]);
  const layout1Rels = rels([{ id: 'rId1', type: SLIDE_MASTER_REL, target: '../slideMasters/slideMaster1.xml' }]);

  // --- master: clrMap, txStyles (the run-property cascade the title/body text inherits).
  const master1 = el('p:sldMaster', {}, [
    el('p:cSld', {}, [el('p:spTree')]),
    el('p:clrMap', { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', hlink: 'hlink', folHlink: 'folHlink' }),
    el('p:txStyles', {}, [
      el('p:titleStyle', {}, [
        el('a:lvl1pPr', {}, [
          el('a:defRPr', { sz: '4400', b: '1' }, [el('a:latin', { typeface: '+mj-lt' }), el('a:solidFill', {}, [el('a:schemeClr', { val: 'tx1' })])]),
        ]),
      ]),
      el('p:bodyStyle', {}, [el('a:lvl1pPr', {}, [el('a:defRPr', { sz: '1800' })])]),
      el('p:otherStyle', {}, [el('a:lvl1pPr', {}, [el('a:defRPr', { sz: '1200' })])]),
    ]),
  ]);
  const master1Rels = rels([{ id: 'rId1', type: THEME_REL, target: '../theme/theme1.xml' }]);

  const theme1 = el('a:theme', {}, [
    el('a:themeElements', {}, [
      el('a:clrScheme', {}, [
        el('a:dk1', {}, [el('a:sysClr', { val: 'windowText', lastClr: '000000' })]),
        el('a:lt1', {}, [el('a:sysClr', { val: 'window', lastClr: 'FFFFFF' })]),
      ]),
      el('a:fontScheme', {}, [el('a:majorFont', {}, [el('a:latin', { typeface: 'Aptos Display' })]), el('a:minorFont', {}, [el('a:latin', { typeface: 'Aptos' })])]),
    ]),
  ]);

  const presentation = el('p:presentation', {}, [
    el('p:sldIdLst', {}, [el('p:sldId', { id: '257', 'r:id': 'rIdSlide2' }), el('p:sldId', { id: '256', 'r:id': 'rIdSlide1' })]),
    el('p:sldSz', { cx: '12192000', cy: '6858000' }),
  ]);
  const presentationRels = rels([
    { id: 'rIdSlide2', type: SLIDE_REL, target: 'slides/slide2.xml' },
    { id: 'rIdSlide1', type: SLIDE_REL, target: 'slides/slide1.xml' },
  ]);

  const core = el('cp:coreProperties', {}, [el('dc:title', {}, [txt('Fixture Deck')])]);

  return {
    parts: {
      'ppt/presentation.xml': { kind: 'xml', nodes: [presentation] },
      'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [presentationRels] },
      'ppt/slides/slide1.xml': { kind: 'xml', nodes: [slide1] },
      'ppt/slides/_rels/slide1.xml.rels': { kind: 'xml', nodes: [slide1Rels] },
      'ppt/slides/slide2.xml': { kind: 'xml', nodes: [slide2] },
      'ppt/notesSlides/notesSlide1.xml': { kind: 'xml', nodes: [notesSlide1] },
      'ppt/slideLayouts/slideLayout1.xml': { kind: 'xml', nodes: [layout1] },
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': { kind: 'xml', nodes: [layout1Rels] },
      'ppt/slideMasters/slideMaster1.xml': { kind: 'xml', nodes: [master1] },
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': { kind: 'xml', nodes: [master1Rels] },
      'ppt/theme/theme1.xml': { kind: 'xml', nodes: [theme1] },
      'ppt/media/image1.png': { kind: 'binary', base64: tinyPngBase64() },
      'docProps/core.xml': { kind: 'xml', nodes: [core] },
    },
  };
}

describe('readPptxContent: slide size and order', () => {
  it('reads slide size from p:sldSz', () => {
    const doc = readPptxContent(buildFixturePackage());
    expect(doc.slides[0]?.size).toEqual({ widthPt: 960, heightPt: 540 });
  });

  it('orders slides via p:sldIdLst, not slide filename order', () => {
    const doc = readPptxContent(buildFixturePackage());
    // sldIdLst lists slide2 before slide1, so slides[0] must be slide2's content ("Second Slide").
    const firstShapeText = asParagraph(doc.slides[0]?.shapes[0]?.blocks[0]).runs[0]?.text;
    expect(firstShapeText).toBe('Second Slide');
  });

  it('reads document metadata via readCoreProperties', () => {
    const doc = readPptxContent(buildFixturePackage());
    expect(doc.metadata.title).toBe('Fixture Deck');
  });
});

describe('readPptxContent: placeholder inheritance and run cascade', () => {
  it('inherits the title placeholder\'s geometry from the layout when the slide has none of its own', () => {
    const doc = readPptxContent(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    expect(titleShape?.frame).toEqual({ xPt: 72, yPt: 36, widthPt: 816, heightPt: 90 });
  });

  it('a run with no own rPr fully inherits size/bold/font/colour from the master titleStyle', () => {
    const doc = readPptxContent(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    const run = asParagraph(titleShape?.blocks[0]).runs[0];
    expect(run?.text).toBe('Hello');
    expect(run?.sizePt).toBe(44);
    expect(run?.bold).toBe(true);
    expect(run?.fontFamily).toBe('Aptos Display'); // +mj-lt resolved via the theme
    expect(run?.color).toEqual({ r: 0, g: 0, b: 0 }); // tx1 -> dk1 via clrMap -> black
  });

  it('a run\'s own explicit properties override the cascade only for the fields it sets', () => {
    const doc = readPptxContent(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    const run = asParagraph(titleShape?.blocks[0]).runs[1];
    expect(run?.text).toBe(' World');
    expect(run?.sizePt).toBe(20); // overridden
    expect(run?.italic).toBe(true); // overridden
    expect(run?.bold).toBe(true); // still inherited from the master
    expect(run?.fontFamily).toBe('Aptos Display'); // still inherited
  });
});

describe('readPptxContent: paragraph formatting', () => {
  it('reads alignment, indent, absolute spacing, and percentage line spacing', () => {
    const doc = readPptxContent(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === 'Body 1');
    const para = asParagraph(bodyShape?.blocks[0]);
    expect(para.alignment).toBe('center');
    expect(para.indentLeftPt).toBe(36);
    expect(para.indentFirstLinePt).toBe(-36);
    expect(para.spacingBeforePt).toBe(6);
    expect(para.lineSpacing).toBe(1.5);
  });

  it('resolves an external hyperlink through the slide\'s own relationships', () => {
    const doc = readPptxContent(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === 'Body 1');
    const para = asParagraph(bodyShape?.blocks[0]);
    expect(para.runs[0]?.hyperlink).toBe('https://example.com');
  });

  it('reads underline and strikethrough', () => {
    const doc = readPptxContent(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === 'Body 1');
    const para = asParagraph(bodyShape?.blocks[0]);
    expect(para.runs[1]?.underline).toBe(true);
    expect(para.runs[1]?.strike).toBe(true);
  });
});

describe('readPptxContent: text-box insets and autofit', () => {
  it('reads explicit a:bodyPr insets and a:normAutofit scaling', () => {
    const doc = readPptxContent(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === 'Body 1');
    expect(bodyShape?.insetLeftPt).toBe(14.4);
    expect(bodyShape?.insetTopPt).toBe(7.2);
    expect(bodyShape?.insetRightPt).toBe(14.4);
    expect(bodyShape?.insetBottomPt).toBe(7.2);
    expect(bodyShape?.fontScale).toBe(0.92);
    expect(bodyShape?.lineSpacingReduction).toBe(0.1);
  });

  it('falls back to ECMA-376\'s default insets when a:bodyPr is absent, with no autofit', () => {
    const doc = readPptxContent(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    expect(titleShape?.insetLeftPt).toBe(7.2);
    expect(titleShape?.insetTopPt).toBe(3.6);
    expect(titleShape?.insetRightPt).toBe(7.2);
    expect(titleShape?.insetBottomPt).toBe(3.6);
    expect(titleShape?.fontScale).toBeUndefined();
    expect(titleShape?.lineSpacingReduction).toBeUndefined();
  });

  it('reads zero insets for a picture, which has no text body at all', () => {
    const doc = readPptxContent(buildFixturePackage());
    const picShape = doc.slides[1]?.shapes.find((s) => s.name === 'Picture 1');
    expect(picShape?.insetLeftPt).toBe(0);
    expect(picShape?.insetTopPt).toBe(0);
    expect(picShape?.insetRightPt).toBe(0);
    expect(picShape?.insetBottomPt).toBe(0);
  });
});

describe('readPptxContent: images', () => {
  it('reads a PNG image, sized to the shape\'s own frame', () => {
    const doc = readPptxContent(buildFixturePackage());
    const picShape = doc.slides[1]?.shapes.find((s) => s.name === 'Picture 1');
    const image = asImage(picShape?.blocks[0]);
    expect(image.kind).toBe('image');
    expect(image.format).toBe('png');
    expect(image.widthPt).toBe(80);
    expect(image.heightPt).toBe(80);
  });
});

describe('readPptxContent: tables', () => {
  it('reads column widths, a merged cell\'s colSpan, and its continuation cell as empty', () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === 'Table 1');
    const table = asTable(tableShape?.blocks[0]);
    expect(table.columnWidthsPt).toEqual([100, 150]);
    expect(table.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(asParagraph(table.rows[0]?.cells[0]?.blocks[0]).runs[0]?.text).toBe('Merged');
    expect(table.rows[0]?.cells[1]?.blocks).toEqual([]);
  });

  it('reads a row\'s explicit height, and leaves it undefined when a:tr has no h attribute', () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === 'Table 1');
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[0]?.heightPt).toBe(36);
    expect(table.rows[1]?.heightPt).toBeUndefined();
  });

  it('reads a cell\'s background fill', () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === 'Table 1');
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[1]?.cells[0]?.background).toEqual({ r: 1, g: 0, b: 0 });
  });
});

describe('readPptxContent: group shapes', () => {
  it('flattens a group\'s child shape into the slide\'s flat shape list at its absolute (transformed) position', () => {
    const doc = readPptxContent(buildFixturePackage());
    const grouped = doc.slides[1]?.shapes.find((s) => s.name === 'Grouped shape');
    // group off=(100,100)pt ext=(200,200)pt, chOff=(0,0) chExt=(100,100)pt -> scale 2x; child local (10,10,20,20)pt -> absolute (120,120,40,40)pt.
    expect(grouped?.frame).toEqual({ xPt: 120, yPt: 120, widthPt: 40, heightPt: 40 });
  });
});

describe('readPptxContent: rotation', () => {
  it('carries a shape\'s own rotationDeg through unchanged', () => {
    const doc = readPptxContent(buildFixturePackage());
    const rotated = doc.slides[0]?.shapes.find((s) => s.name === 'Rotated');
    expect(rotated?.rotationDeg).toBe(45);
  });

  it('leaves rotationDeg undefined for an unrotated shape', () => {
    const doc = readPptxContent(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    expect(titleShape?.rotationDeg).toBeUndefined();
  });
});

// Real ECMA-376 composition through rotated/flipped ancestor groups (see composeGroupTransform/applyGroupTransform/composeShapeRotationDeg in src/typed/shared/drawingml.ts for the derivation these fixtures exercise end to end, through actual XML parsing rather than calling the helpers directly).
function rotationCompositionFixturePackage(): Package {
  // Group A: off=(100,100)pt ext=(200,200)pt chOff=(0,0)pt chExt=(200,200)pt (scale 1:1) rot=90deg, no flip. Child shape (unrotated) at local off=(150,50)pt ext=(20,20)pt. Group centre = (200,200); child's canonical (unrotated) box centre = (260,160), i.e. (60,-40) from the group centre. Rotating 90deg clockwise (verified: east (1,0) -> south (0,1)) sends (60,-40) = 60*east + 40*north to 60*south + 40*east = (40,60). Final centre (240,260), top-left (230,250). Rotation: shape's own rot (0) composed with the group's unmirrored composite (90) = 90.
  const rotGroupChild = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '101', name: 'InRotGroup' }), el('p:cNvSpPr'), el('p:nvPr')]),
    el('p:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '1905000', y: '635000' }), el('a:ext', { cx: '254000', cy: '254000' })])]),
    el('p:txBody', {}, [el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt('In rotated group')])])])]),
  ]);
  const rotGroup = el('p:grpSp', {}, [
    el('p:nvGrpSpPr', {}, [el('p:cNvPr', { id: '100', name: 'RotGroup' })]),
    el('p:grpSpPr', {}, [
      el('a:xfrm', { rot: '5400000' }, [el('a:off', { x: '1270000', y: '1270000' }), el('a:ext', { cx: '2540000', cy: '2540000' }), el('a:chOff', { x: '0', y: '0' }), el('a:chExt', { cx: '2540000', cy: '2540000' })]),
    ]),
    rotGroupChild,
  ]);

  // Group B: identical geometry to Group A, but rot=90deg AND flipH=1. Child shape carries its OWN rot=30deg, to prove the flip negates the sense of that own rotation (composeShapeRotationDeg: mirrored parent -> 90 - 30 = 60, not 90 + 30 = 120). Position: the group's flip mirrors dx across the vertical axis before rotating: 60 -> -60, dy stays -40. Rotating 90deg clockwise sends (-60,-40) = 60*west + 40*north to 60*north + 40*east = (40,-60). Final centre (240,140), top-left (230,130).
  const rotFlipGroupChild = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '111', name: 'InRotFlipGroup' }), el('p:cNvSpPr'), el('p:nvPr')]),
    el('p:spPr', {}, [el('a:xfrm', { rot: '1800000' }, [el('a:off', { x: '1905000', y: '635000' }), el('a:ext', { cx: '254000', cy: '254000' })])]),
    el('p:txBody', {}, [el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt('In rotated and flipped group')])])])]),
  ]);
  const rotFlipGroup = el('p:grpSp', {}, [
    el('p:nvGrpSpPr', {}, [el('p:cNvPr', { id: '110', name: 'RotFlipGroup' })]),
    el('p:grpSpPr', {}, [
      el('a:xfrm', { rot: '5400000', flipH: '1' }, [
        el('a:off', { x: '1270000', y: '1270000' }),
        el('a:ext', { cx: '2540000', cy: '2540000' }),
        el('a:chOff', { x: '0', y: '0' }),
        el('a:chExt', { cx: '2540000', cy: '2540000' }),
      ]),
    ]),
    rotFlipGroupChild,
  ]);

  // Two-level nesting: outer group off=(0,0)pt ext=(400,400)pt chOff=(0,0)pt chExt=(400,400)pt rot=90deg, no flip; inner group nested inside it at off=(200,0)pt ext=(200,200)pt chOff=(0,0)pt chExt=(200,200)pt rot=90deg, no flip; shape inside the inner group at local off=(50,50)pt ext=(20,20)pt, unrotated. Inner group's own off/ext, mapped through the outer group's 90deg rotation about its centre (200,200): canonical box centre (300,100) -> (100,-100) from outer centre -> rotated to (100,100) -> final centre (300,300), top-left (200,200); composite rotation = 90+90 = 180 (outer unmirrored, so angles add). Shape's canonical box centre inside the inner group's own (200,200)-centred, 180deg-composite frame: local centre (60,60) -> canonical (260,260) -> (-40,-40) from inner centre (300,300) -> rotating 180deg negates both -> (40,40) -> final centre (340,340), top-left (330,330). Rotation: shape's own rot (0) composed with the (unmirrored) 180deg composite = 180.
  const nestedInnerChild = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '122', name: 'InNestedGroups' }), el('p:cNvSpPr'), el('p:nvPr')]),
    el('p:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '635000', y: '635000' }), el('a:ext', { cx: '254000', cy: '254000' })])]),
    el('p:txBody', {}, [el('a:p', {}, [el('a:r', {}, [el('a:t', {}, [txt('In nested rotated groups')])])])]),
  ]);
  const nestedInnerGroup = el('p:grpSp', {}, [
    el('p:nvGrpSpPr', {}, [el('p:cNvPr', { id: '121', name: 'InnerRotGroup' })]),
    el('p:grpSpPr', {}, [
      el('a:xfrm', { rot: '5400000' }, [el('a:off', { x: '2540000', y: '0' }), el('a:ext', { cx: '2540000', cy: '2540000' }), el('a:chOff', { x: '0', y: '0' }), el('a:chExt', { cx: '2540000', cy: '2540000' })]),
    ]),
    nestedInnerChild,
  ]);
  const nestedOuterGroup = el('p:grpSp', {}, [
    el('p:nvGrpSpPr', {}, [el('p:cNvPr', { id: '120', name: 'OuterRotGroup' })]),
    el('p:grpSpPr', {}, [
      el('a:xfrm', { rot: '5400000' }, [el('a:off', { x: '0', y: '0' }), el('a:ext', { cx: '5080000', cy: '5080000' }), el('a:chOff', { x: '0', y: '0' }), el('a:chExt', { cx: '5080000', cy: '5080000' })]),
    ]),
    nestedInnerGroup,
  ]);

  const spTree = el('p:spTree', {}, [rotGroup, rotFlipGroup, nestedOuterGroup]);
  const slide = el('p:sld', {}, [el('p:cSld', {}, [spTree])]);
  const presentation = el('p:presentation', {}, [el('p:sldIdLst', {}, [el('p:sldId', { id: '256', 'r:id': 'rId1' })])]);
  const presentationRels = rels([{ id: 'rId1', type: SLIDE_REL, target: 'slides/slide1.xml' }]);

  return {
    parts: {
      'ppt/presentation.xml': { kind: 'xml', nodes: [presentation] },
      'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [presentationRels] },
      'ppt/slides/slide1.xml': { kind: 'xml', nodes: [slide] },
    },
  };
}

describe('readPptxContent: rotation composed through rotated/flipped ancestor groups', () => {
  it('composes an unrotated shape\'s position and rotation through a single rotated (unflipped) group', () => {
    const doc = readPptxContent(rotationCompositionFixturePackage());
    const shape = doc.slides[0]?.shapes.find((s) => s.name === 'InRotGroup');
    expect(shape?.frame.xPt).toBeCloseTo(230, 9);
    expect(shape?.frame.yPt).toBeCloseTo(250, 9);
    expect(shape?.frame.widthPt).toBe(20);
    expect(shape?.frame.heightPt).toBe(20);
    expect(shape?.rotationDeg).toBe(90);
  });

  it('composes a shape\'s own rotation through a rotated AND flipped group, negating the sense of the shape\'s own rotation', () => {
    const doc = readPptxContent(rotationCompositionFixturePackage());
    const shape = doc.slides[0]?.shapes.find((s) => s.name === 'InRotFlipGroup');
    expect(shape?.frame.xPt).toBeCloseTo(230, 9);
    expect(shape?.frame.yPt).toBeCloseTo(130, 9);
    // 90 (group) - 30 (own) = 60, not 90 + 30 = 120 -- the group's flipH negates the sign of the shape's own rotation.
    expect(shape?.rotationDeg).toBe(60);
  });

  it('composes position and rotation through two levels of nested rotated groups', () => {
    const doc = readPptxContent(rotationCompositionFixturePackage());
    const shape = doc.slides[0]?.shapes.find((s) => s.name === 'InNestedGroups');
    expect(shape?.frame.xPt).toBeCloseTo(330, 9);
    expect(shape?.frame.yPt).toBeCloseTo(330, 9);
    // 90 (outer) + 90 (inner) + 0 (own) = 180.
    expect(shape?.rotationDeg).toBe(180);
  });
});

describe('readPptxContent: sourcePath', () => {
  it('assigns slides[N].shapes[N] to each shape, in the flattened document order', () => {
    const doc = readPptxContent(buildFixturePackage());
    // sldIdLst orders slide2 before slide1, so slides[0] is slide2 (one shape) and slides[1] is slide1.
    expect(doc.slides[0]?.shapes[0]?.sourcePath).toBe('slides[0].shapes[0]');
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === 'Body 1');
    expect(titleShape?.sourcePath).toBe('slides[1].shapes[0]');
    expect(bodyShape?.sourcePath).toBe('slides[1].shapes[1]');
  });

  it('assigns slides[N].shapes[N].blocks[N] and .runs[N] to a shape\'s paragraph content', () => {
    const doc = readPptxContent(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    const titlePara = asParagraph(titleShape?.blocks[0]);
    expect(titlePara.sourcePath).toBe('slides[1].shapes[0].blocks[0]');
    expect(titlePara.runs[0]?.sourcePath).toBe('slides[1].shapes[0].blocks[0].runs[0]');
    expect(titlePara.runs[1]?.sourcePath).toBe('slides[1].shapes[0].blocks[0].runs[1]');
  });

  it('assigns a group\'s flattened child shape its own position in the slide\'s flat shape list', () => {
    const doc = readPptxContent(buildFixturePackage());
    const grouped = doc.slides[1]?.shapes.find((s) => s.name === 'Grouped shape');
    // spTree1 order: title(0), body(1), pic(2), table(3), grouped child(4).
    expect(grouped?.sourcePath).toBe('slides[1].shapes[4]');
    expect(asParagraph(grouped?.blocks[0]).sourcePath).toBe('slides[1].shapes[4].blocks[0]');
  });

  it('nests a table shape\'s own cell content under slides[N].shapes[N].blocks[N].rows[N].cells[N].blocks[N]', () => {
    const doc = readPptxContent(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === 'Table 1');
    const table = asTable(tableShape?.blocks[0]);
    expect(table.sourcePath).toBe('slides[1].shapes[3].blocks[0]');
    const mergedCellPara = asParagraph(table.rows[0]?.cells[0]?.blocks[0]);
    expect(mergedCellPara.sourcePath).toBe('slides[1].shapes[3].blocks[0].rows[0].cells[0].blocks[0]');
    expect(mergedCellPara.runs[0]?.sourcePath).toBe('slides[1].shapes[3].blocks[0].rows[0].cells[0].blocks[0].runs[0]');
    const cellBPara = asParagraph(table.rows[1]?.cells[1]?.blocks[0]);
    expect(cellBPara.sourcePath).toBe('slides[1].shapes[3].blocks[0].rows[1].cells[1].blocks[0]');
  });
});

describe('readPptxContent: notes', () => {
  it('prefers the notes slide\'s own body placeholder over concatenating every a:t (excluding the slide-number field)', () => {
    const doc = readPptxContent(buildFixturePackage());
    expect(doc.slides[1]?.notes).toBe('Speaker notes here');
  });

  it('is an empty string for a slide with no notesSlide relationship', () => {
    const doc = readPptxContent(buildFixturePackage());
    expect(doc.slides[0]?.notes).toBe('');
  });
});

// A chart graphic frame's c:chart child resolves through the slide's own relationships to a chart part, whose cached series/category model reads as the same table block shape an a:tbl frame produces (readChartTable in src/typed/pptx/chart.ts). Series 1 is named through a cached c:strRef and stops at two categories; series 2 is named through an inline c:v literal and carries a third category series 1 never labels -- exercising both name forms and the category union.
function chartFixturePackage(): Package {
  const revenue = el('c:ser', {}, [
    el('c:tx', {}, [el('c:strRef', {}, [el('c:f', {}, [txt('Sheet1!$B$1')]), el('c:strCache', {}, [el('c:ptCount', { val: '1' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('Revenue')])])])])]),
    el('c:cat', {}, [el('c:strRef', {}, [el('c:strCache', {}, [el('c:ptCount', { val: '2' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('Q1')])]), el('c:pt', { idx: '1' }, [el('c:v', {}, [txt('Q2')])])])])]),
    el('c:val', {}, [el('c:numRef', {}, [el('c:numCache', {}, [el('c:ptCount', { val: '2' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('8.5')])]), el('c:pt', { idx: '1' }, [el('c:v', {}, [txt('12')])])])])]),
  ]);
  const cost = el('c:ser', {}, [
    el('c:tx', {}, [el('c:v', {}, [txt('Cost')])]),
    el('c:cat', {}, [el('c:strRef', {}, [el('c:strCache', {}, [el('c:ptCount', { val: '3' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('Q1')])]), el('c:pt', { idx: '1' }, [el('c:v', {}, [txt('Q2')])]), el('c:pt', { idx: '2' }, [el('c:v', {}, [txt('Q3')])])])])]),
    el('c:val', {}, [el('c:numRef', {}, [el('c:numCache', {}, [el('c:ptCount', { val: '3' }), el('c:pt', { idx: '0' }, [el('c:v', {}, [txt('4')])]), el('c:pt', { idx: '1' }, [el('c:v', {}, [txt('5')])]), el('c:pt', { idx: '2' }, [el('c:v', {}, [txt('6')])])])])]),
  ]);
  const chartSpace = el('c:chartSpace', {}, [el('c:chart', {}, [el('c:plotArea', {}, [el('c:barChart', {}, [revenue, cost])])])]);

  const chartFrame = el('p:graphicFrame', {}, [
    el('p:nvGraphicFramePr', {}, [el('p:cNvPr', { id: '2', name: 'Chart 1' })]),
    el('p:xfrm', {}, [el('a:off', { x: '914400', y: '1828800' }), el('a:ext', { cx: '4572000', cy: '2743200' })]),
    el('a:graphic', {}, [el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/chart' }, [el('c:chart', { 'r:id': 'rIdChart' })])]),
  ]);
  const slide = el('p:sld', {}, [el('p:cSld', {}, [el('p:spTree', {}, [chartFrame])])]);
  const presentation = el('p:presentation', {}, [el('p:sldIdLst', {}, [el('p:sldId', { id: '256', 'r:id': 'rId1' })])]);
  const presentationRels = rels([{ id: 'rId1', type: SLIDE_REL, target: 'slides/slide1.xml' }]);
  const slideRels = rels([{ id: 'rIdChart', type: CHART_REL, target: '../charts/chart1.xml' }]);

  return {
    parts: {
      'ppt/presentation.xml': { kind: 'xml', nodes: [presentation] },
      'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [presentationRels] },
      'ppt/slides/slide1.xml': { kind: 'xml', nodes: [slide] },
      'ppt/slides/_rels/slide1.xml.rels': { kind: 'xml', nodes: [slideRels] },
      'ppt/charts/chart1.xml': { kind: 'xml', nodes: [chartSpace] },
    },
  };
}

function cellText(block: ContentBlock | undefined, row: number, column: number): string | undefined {
  if (block?.kind !== 'table') {
    throw new Error('expected a table block');
  }
  return asParagraph(block.rows[row]?.cells[column]?.blocks[0]).runs[0]?.text;
}

describe('readPptxContent: chart graphic frames', () => {
  it('reads the chart part\'s cached series/category model as a table block', () => {
    const doc = readPptxContent(chartFixturePackage());
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === 'Chart 1');
    const table = asTable(chartShape?.blocks[0]);
    // Header row: empty corner cell over the category column, then one column per series.
    expect(table.rows[0]?.cells[0]?.blocks).toEqual([]);
    expect(cellText(table, 0, 1)).toBe('Revenue');
    expect(cellText(table, 0, 2)).toBe('Cost');
  });

  it('reads one row per category index, in index order, with each series\' cached value in its own column', () => {
    const doc = readPptxContent(chartFixturePackage());
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === 'Chart 1');
    const table = asTable(chartShape?.blocks[0]);
    expect(cellText(table, 1, 0)).toBe('Q1');
    expect(cellText(table, 1, 1)).toBe('8.5');
    expect(cellText(table, 1, 2)).toBe('4');
    expect(cellText(table, 3, 0)).toBe('Q3');
    // A category only series 2 labels still gets its row; series 1 has no cached value there, which reads as an empty cell.
    expect(table.rows[3]?.cells[1]?.blocks).toEqual([]);
    expect(cellText(table, 3, 2)).toBe('6');
  });

  it('splits the frame\'s own width evenly across the category and series columns', () => {
    const doc = readPptxContent(chartFixturePackage());
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === 'Chart 1');
    expect(asTable(chartShape?.blocks[0]).columnWidthsPt).toEqual([120, 120, 120]);
  });

  it('keeps the frame\'s geometry with empty content when the chart reference resolves to no readable chart', () => {
    // The c:chart r:id points at a relationship the slide does not carry.
    const brokenFrame = el('p:graphicFrame', {}, [
      el('p:nvGraphicFramePr', {}, [el('p:cNvPr', { id: '2', name: 'Chart 1' })]),
      el('p:xfrm', {}, [el('a:off', { x: '914400', y: '1828800' }), el('a:ext', { cx: '4572000', cy: '2743200' })]),
      el('a:graphic', {}, [el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/chart' }, [el('c:chart', { 'r:id': 'rIdMissing' })])]),
    ]);
    const slide = el('p:sld', {}, [el('p:cSld', {}, [el('p:spTree', {}, [brokenFrame])])]);
    const presentation = el('p:presentation', {}, [el('p:sldIdLst', {}, [el('p:sldId', { id: '256', 'r:id': 'rId1' })])]);
    const pkg: Package = {
      parts: {
        'ppt/presentation.xml': { kind: 'xml', nodes: [presentation] },
        'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [rels([{ id: 'rId1', type: SLIDE_REL, target: 'slides/slide1.xml' }])] },
        'ppt/slides/slide1.xml': { kind: 'xml', nodes: [slide] },
      },
    };
    const doc = readPptxContent(pkg);
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === 'Chart 1');
    expect(chartShape?.frame).toEqual({ xPt: 72, yPt: 144, widthPt: 360, heightPt: 216 });
    expect(chartShape?.blocks).toEqual([]);
  });

  it('assigns sourcePath into the chart table\'s cells', () => {
    const doc = readPptxContent(chartFixturePackage());
    const chartShape = doc.slides[0]?.shapes.find((s) => s.name === 'Chart 1');
    const table = asTable(chartShape?.blocks[0]);
    expect(table.sourcePath).toBe('slides[0].shapes[0].blocks[0]');
    expect(asParagraph(table.rows[1]?.cells[1]?.blocks[0]).sourcePath).toBe('slides[0].shapes[0].blocks[0].rows[1].cells[1].blocks[0]');
  });
});

// A SmartArt graphic frame's dgm:relIds carries four relationship ids; only r:dm (the data model -- the semantic graph of nodes and text) is read. The tree below: doc -> [Strategy (node 1, srcOrd 0), Cost (node 2, srcOrd 1), textless (node 4, srcOrd 2), Assistant (asst 5, srcOrd 3)], with Strategy -> [Quality/Details (node 3), a parTrans point whose text must not surface]. cxnLst order is deliberately scrambled against srcOrd to prove the sort, and a presOf edge to node 2 must not duplicate its text (readDiagramText in src/typed/pptx/diagram.ts).
function smartArtFixturePackage(): Package {
  const para = (...runs: XmlElement[]) => el('a:p', {}, runs);
  const r = (text: string) => el('a:r', {}, [el('a:t', {}, [txt(text)])]);
  const textPt = (modelId: string, type: string | undefined, paragraphs: XmlElement[]): XmlElement =>
    el('dgm:pt', type === undefined ? { modelId } : { modelId, type }, [el('dgm:t', {}, [el('a:bodyPr'), el('a:lstStyle'), ...paragraphs])]);
  const cxn = (srcId: string, destId: string, srcOrd: string, type?: string) =>
    el('dgm:cxn', type === undefined ? { modelId: `${srcId}-${destId}`, srcId, destId, srcOrd, destOrd: '0' } : { modelId: `${srcId}-${destId}`, type, srcId, destId, srcOrd, destOrd: '0' });

  const dataModel = el('dgm:dataModel', {}, [
    el('dgm:ptLst', {}, [
      textPt('0', 'doc', [para()]),
      textPt('1', undefined, [para(r('Strategy'))]),
      textPt('2', undefined, [para(r('Cost'))]),
      textPt('3', undefined, [para(r('Quality')), para(r('Details'))]),
      textPt('4', undefined, [para()]),
      textPt('5', 'asst', [para(r('Assistant'))]),
      textPt('6', 'parTrans', [para(r('transition text'))]),
    ]),
    el('dgm:cxnLst', {}, [
      cxn('0', '2', '1'),
      cxn('0', '1', '0'),
      cxn('0', '4', '2'),
      cxn('0', '5', '3'),
      cxn('1', '3', '0'),
      cxn('1', '6', '1'),
      cxn('0', '2', '9', 'presOf'),
    ]),
  ]);

  const diagramFrame = el('p:graphicFrame', {}, [
    el('p:nvGraphicFramePr', {}, [el('p:cNvPr', { id: '2', name: 'Diagram 1' })]),
    el('p:xfrm', {}, [el('a:off', { x: '914400', y: '1828800' }), el('a:ext', { cx: '4572000', cy: '2743200' })]),
    el('a:graphic', {}, [el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/diagram' }, [el('dgm:relIds', { 'r:dm': 'rIdDm', 'r:lo': 'rIdLo', 'r:qs': 'rIdQs', 'r:cs': 'rIdCs' })])]),
  ]);
  const slide = el('p:sld', {}, [el('p:cSld', {}, [el('p:spTree', {}, [diagramFrame])])]);
  const presentation = el('p:presentation', {}, [el('p:sldIdLst', {}, [el('p:sldId', { id: '256', 'r:id': 'rId1' })])]);
  const presentationRels = rels([{ id: 'rId1', type: SLIDE_REL, target: 'slides/slide1.xml' }]);
  const slideRels = rels([{ id: 'rIdDm', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData', target: '../diagrams/data1.xml' }]);

  return {
    parts: {
      'ppt/presentation.xml': { kind: 'xml', nodes: [presentation] },
      'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [presentationRels] },
      'ppt/slides/slide1.xml': { kind: 'xml', nodes: [slide] },
      'ppt/slides/_rels/slide1.xml.rels': { kind: 'xml', nodes: [slideRels] },
      'ppt/diagrams/data1.xml': { kind: 'xml', nodes: [dataModel] },
    },
  };
}

describe('readPptxContent: SmartArt graphic frames', () => {
  it('reads the data model\'s node text as paragraphs in diagram order (depth-first, siblings by srcOrd)', () => {
    const doc = readPptxContent(smartArtFixturePackage());
    const diagramShape = doc.slides[0]?.shapes.find((s) => s.name === 'Diagram 1');
    const texts = (diagramShape?.blocks ?? []).map((b) => asParagraph(b).runs.map((run) => run.text).join(''));
    expect(texts).toEqual(['Strategy', 'Quality', 'Details', 'Cost', 'Assistant']);
  });

  it('keeps the frame\'s geometry with empty content when the data model relationship resolves to no readable part', () => {
    const pkg = smartArtFixturePackage();
    delete pkg.parts['ppt/diagrams/data1.xml'];
    const doc = readPptxContent(pkg);
    const diagramShape = doc.slides[0]?.shapes.find((s) => s.name === 'Diagram 1');
    expect(diagramShape?.frame).toEqual({ xPt: 72, yPt: 144, widthPt: 360, heightPt: 216 });
    expect(diagramShape?.blocks).toEqual([]);
  });

  it('assigns sourcePath to each diagram paragraph', () => {
    const doc = readPptxContent(smartArtFixturePackage());
    const diagramShape = doc.slides[0]?.shapes.find((s) => s.name === 'Diagram 1');
    expect(asParagraph(diagramShape?.blocks[0]).sourcePath).toBe('slides[0].shapes[0].blocks[0]');
    expect(asParagraph(diagramShape?.blocks[4]).sourcePath).toBe('slides[0].shapes[0].blocks[4]');
  });
});

// An OLE graphic frame's a:graphicData wraps an mc:AlternateContent: the mc:Choice side's p:oleObj names the embedded payload, while the mc:Fallback side repeats the p:oleObj carrying the raster picture every renderer actually displays. The payload target is parameterised so a test can point rIdOle at whatever part shape it needs (the ZIP-payload case reuses the default .xlsx target; the classic-OLE case retargets to a .bin part) -- the fixture itself ships no embeddings part, so the default fixture keeps exercising exactly the fallback/progId paths.
function oleFixturePackage(payloadTarget = '../embeddings/oleObject1.xlsx'): Package {
  const choiceOleObj = el('p:oleObj', { spid: '3', 'r:id': 'rIdOle', progId: 'Excel.Sheet.12', showAsIcon: '0' }, [el('p:embed')]);
  const fallbackOleObj = el('p:oleObj', { spid: '3', 'r:id': 'rIdOle', progId: 'Excel.Sheet.12' }, [
    el('p:pic', {}, [
      el('p:nvPicPr', {}, [el('p:cNvPr', { id: '4', name: 'Fallback Picture' }), el('p:cNvPicPr'), el('p:nvPr')]),
      el('p:blipFill', {}, [el('a:blip', { 'r:embed': 'rIdFallback' })]),
    ]),
  ]);
  const oleFrame = el('p:graphicFrame', {}, [
    el('p:nvGraphicFramePr', {}, [el('p:cNvPr', { id: '2', name: 'Object 1' })]),
    el('p:xfrm', {}, [el('a:off', { x: '914400', y: '1828800' }), el('a:ext', { cx: '4572000', cy: '2743200' })]),
    el('a:graphic', {}, [
      el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/presentationml/2006/ole' }, [
        el('mc:AlternateContent', {}, [el('mc:Choice', { Requires: 'v' }, [choiceOleObj]), el('mc:Fallback', {}, [fallbackOleObj])]),
      ]),
    ]),
  ]);
  const slide = el('p:sld', {}, [el('p:cSld', {}, [el('p:spTree', {}, [oleFrame])])]);
  const presentation = el('p:presentation', {}, [el('p:sldIdLst', {}, [el('p:sldId', { id: '256', 'r:id': 'rId1' })])]);
  const presentationRels = rels([{ id: 'rId1', type: SLIDE_REL, target: 'slides/slide1.xml' }]);
  const slideRels = rels([
    { id: 'rIdOle', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject', target: payloadTarget },
    { id: 'rIdFallback', type: IMAGE_REL, target: '../media/oleFallback.png' },
  ]);

  return {
    parts: {
      'ppt/presentation.xml': { kind: 'xml', nodes: [presentation] },
      'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [presentationRels] },
      'ppt/slides/slide1.xml': { kind: 'xml', nodes: [slide] },
      'ppt/slides/_rels/slide1.xml.rels': { kind: 'xml', nodes: [slideRels] },
      'ppt/media/oleFallback.png': { kind: 'binary', base64: tinyPngBase64() },
    },
  };
}

describe('readPptxContent: OLE graphic frames', () => {
  it('reads the fallback picture as an image block sized to the frame', () => {
    const doc = readPptxContent(oleFixturePackage());
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === 'Object 1');
    const image = asImage(oleShape?.blocks[0]);
    expect(image.format).toBe('png');
    expect(image.base64).toBe(tinyPngBase64());
    expect(image.widthPt).toBe(360);
    expect(image.heightPt).toBe(216);
  });

  it('records the object\'s progId as a paragraph when no fallback picture resolves', () => {
    // The fallback relationship points at a part the package does not carry.
    const pkg = oleFixturePackage();
    delete pkg.parts['ppt/media/oleFallback.png'];
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === 'Object 1');
    expect(oleShape?.frame).toEqual({ xPt: 72, yPt: 144, widthPt: 360, heightPt: 216 });
    expect(asParagraph(oleShape?.blocks[0]).runs[0]?.text).toBe('Excel.Sheet.12');
  });

  it('keeps the frame\'s geometry with empty content when neither picture nor progId is present', () => {
    // The p:oleObj carries no progId and the graphicData holds no fallback picture at all.
    const bareFrame = el('p:graphicFrame', {}, [
      el('p:nvGraphicFramePr', {}, [el('p:cNvPr', { id: '2', name: 'Object 1' })]),
      el('p:xfrm', {}, [el('a:off', { x: '914400', y: '1828800' }), el('a:ext', { cx: '4572000', cy: '2743200' })]),
      el('a:graphic', {}, [el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/presentationml/2006/ole' }, [el('p:oleObj', { spid: '3' })])]),
    ]);
    const slide = el('p:sld', {}, [el('p:cSld', {}, [el('p:spTree', {}, [bareFrame])])]);
    const presentation = el('p:presentation', {}, [el('p:sldIdLst', {}, [el('p:sldId', { id: '256', 'r:id': 'rId1' })])]);
    const pkg: Package = {
      parts: {
        'ppt/presentation.xml': { kind: 'xml', nodes: [presentation] },
        'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [rels([{ id: 'rId1', type: SLIDE_REL, target: 'slides/slide1.xml' }])] },
        'ppt/slides/slide1.xml': { kind: 'xml', nodes: [slide] },
      },
    };
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === 'Object 1');
    expect(oleShape?.frame).toEqual({ xPt: 72, yPt: 144, widthPt: 360, heightPt: 216 });
    expect(oleShape?.blocks).toEqual([]);
  });

  it('assigns sourcePath to the fallback image block', () => {
    const doc = readPptxContent(oleFixturePackage());
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === 'Object 1');
    expect(asImage(oleShape?.blocks[0]).sourcePath).toBe('slides[0].shapes[0].blocks[0]');
  });

  it('recovers a ZIP-payload OLE object as an embeddedObject block alongside the fallback picture', () => {
    // The payload part the fixture's rIdOle already targets now really exists: a minimal xlsx, as a modern producer writes an embedded workbook.
    const pkg = oleFixturePackage();
    pkg.parts['ppt/embeddings/oleObject1.xlsx'] = { kind: 'binary', base64: bytesToBase64(minimalXlsxBytes()) };
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === 'Object 1');
    // Both blocks: the picture every renderer displays, and the recovered sub-document's content.
    expect(asImage(oleShape?.blocks[0]).format).toBe('png');
    const embedded = asEmbeddedObject(oleShape?.blocks[1]);
    expect(embedded.objectKind).toBe('spreadsheet');
    expect(embedded.frame).toEqual({ xPt: 72, yPt: 144, widthPt: 360, heightPt: 216 });
    // The nested document is the genuinely decoded workbook, not just an envelope block.
    const sheet = embedded.document.kind === 'spreadsheet' ? embedded.document.sheets[0] : undefined;
    expect(sheet?.name).toBe('Embedded');
    expect(sheet?.cells[0]?.value).toEqual({ kind: 'string', value: 'Recovered cell' });
  });

  it('keeps a non-ZIP OLE payload on exactly the fallback-picture behaviour, with no embedded block', () => {
    // The classic OLE compound-file .bin payload: rIdOle retargeted at a part whose bytes carry the OLE/CFB magic -- no reader in this ecosystem decodes it, so the frame's content is exactly what it was before embedded recovery existed.
    const pkg = oleFixturePackage('../embeddings/oleObject1.bin');
    pkg.parts['ppt/embeddings/oleObject1.bin'] = { kind: 'binary', base64: bytesToBase64(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x01, 0x02, 0x03, 0x04])) };
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === 'Object 1');
    expect(oleShape?.blocks).toHaveLength(1);
    expect(asImage(oleShape?.blocks[0]).format).toBe('png');
  });

  it('keeps the fallback-picture behaviour when the payload is a ZIP but not a recognisable package, so the host read is never poisoned', () => {
    // A ZIP payload that fails to decode as one of the three OOXML flavours (here: a plain archive) must be a non-event for the host slide, exactly like a non-ZIP payload -- one bad embedded object can never fail the whole document read.
    const pkg = oleFixturePackage('../embeddings/payload.zip');
    pkg.parts['ppt/embeddings/payload.zip'] = { kind: 'binary', base64: bytesToBase64(zipPackage({ 'readme.txt': new TextEncoder().encode('not a document package') })) };
    const doc = readPptxContent(pkg);
    const oleShape = doc.slides[0]?.shapes.find((s) => s.name === 'Object 1');
    expect(oleShape?.blocks).toHaveLength(1);
    expect(asImage(oleShape?.blocks[0]).format).toBe('png');
  });
});

// One body shape whose paragraphs exercise every a:pPr/@lvl spelling: absent (both as no a:pPr at all and as an a:pPr carrying no lvl), an explicit zero (distinct from absent: present-and-valid, so it emits), a real outline level, and the three malformed spellings that must degrade to no list (readOutlineLevel in src/typed/pptx/read.ts).
function outlineLevelFixturePackage(): Package {
  const para = (pPrAttrs: Record<string, string> | undefined, text: string): XmlElement =>
    el('a:p', {}, [...(pPrAttrs === undefined ? [] : [el('a:pPr', pPrAttrs)]), el('a:r', {}, [el('a:t', {}, [txt(text)])])]);

  const outlineShape = el('p:sp', {}, [
    el('p:nvSpPr', {}, [el('p:cNvPr', { id: '2', name: 'Outline Body' }), el('p:cNvSpPr'), el('p:nvPr')]),
    el('p:spPr', {}, [el('a:xfrm', {}, [el('a:off', { x: '914400', y: '914400' }), el('a:ext', { cx: '4572000', cy: '4572000' })])]),
    el('p:txBody', {}, [
      para(undefined, 'no pPr'),
      para({}, 'pPr without lvl'),
      para({ lvl: '0' }, 'explicit zero'),
      para({ lvl: '2' }, 'level two'),
      para({ lvl: 'two' }, 'non-numeric'),
      para({ lvl: '-1' }, 'negative'),
      para({ lvl: '1.5' }, 'fractional'),
    ]),
  ]);

  const slide = el('p:sld', {}, [el('p:cSld', {}, [el('p:spTree', {}, [outlineShape])])]);
  const presentation = el('p:presentation', {}, [el('p:sldIdLst', {}, [el('p:sldId', { id: '256', 'r:id': 'rId1' })])]);
  const presentationRels = rels([{ id: 'rId1', type: SLIDE_REL, target: 'slides/slide1.xml' }]);

  return {
    parts: {
      'ppt/presentation.xml': { kind: 'xml', nodes: [presentation] },
      'ppt/_rels/presentation.xml.rels': { kind: 'xml', nodes: [presentationRels] },
      'ppt/slides/slide1.xml': { kind: 'xml', nodes: [slide] },
    },
  };
}

function outlineParagraph(text: string): ContentParagraph {
  const doc = readPptxContent(outlineLevelFixturePackage());
  const shape = doc.slides[0]?.shapes.find((s) => s.name === 'Outline Body');
  return asParagraph(shape?.blocks.find((b) => b.kind === 'paragraph' && asParagraph(b).runs[0]?.text === text));
}

describe('readPptxContent: paragraph outline levels', () => {
  it('reads a:pPr/@lvl into list.level, with no numId -- DrawingML paragraphs carry no numbering identity', () => {
    const para = outlineParagraph('level two');
    expect(para.list).toEqual({ level: 2 });
    expect(para.list?.numId).toBeUndefined();
  });

  it('emits list membership that validates against ContentListMembershipSchema with numId optional (document-schema.js 3.3.0)', () => {
    const doc = readPptxContent(outlineLevelFixturePackage());
    expect(() => PptxDocumentSchema.parse(doc)).not.toThrow();
  });

  it('emits no list when @lvl is absent, whether a:pPr exists or not', () => {
    expect(outlineParagraph('no pPr').list).toBeUndefined();
    expect(outlineParagraph('pPr without lvl').list).toBeUndefined();
  });

  it('emits { level: 0 } for an explicit lvl="0" -- present-and-valid, unlike the absent default', () => {
    expect(outlineParagraph('explicit zero').list).toEqual({ level: 0 });
  });

  it('degrades malformed @lvl values to no list while keeping the paragraph readable', () => {
    for (const text of ['non-numeric', 'negative', 'fractional']) {
      const para = outlineParagraph(text);
      expect(para.list).toBeUndefined();
      expect(para.runs[0]?.text).toBe(text);
    }
  });

  it('reads a slide of mixed levels back in document order', () => {
    const doc = readPptxContent(outlineLevelFixturePackage());
    const shape = doc.slides[0]?.shapes.find((s) => s.name === 'Outline Body');
    const read = (shape?.blocks ?? []).map((b) => {
      const para = asParagraph(b);
      return { text: para.runs[0]?.text, list: para.list };
    });
    expect(read).toEqual([
      { text: 'no pPr', list: undefined },
      { text: 'pPr without lvl', list: undefined },
      { text: 'explicit zero', list: { level: 0 } },
      { text: 'level two', list: { level: 2 } },
      { text: 'non-numeric', list: undefined },
      { text: 'negative', list: undefined },
      { text: 'fractional', list: undefined },
    ]);
  });
});
