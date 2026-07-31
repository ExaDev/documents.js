import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { describe, expect, it } from 'vitest';
import type { ContentBlock, ContentImageBlock, ContentParagraph, ContentTable } from '../shared/content';
import { el, txt } from '../../test-support/fragment';
import { bytesToBase64 } from '../../util/base64';
import { readPptx } from './read';

// Ported from documents.js's src/ooxml/pptx/read.test.ts, adapted to readPptx's own PptxDocument shape (no wrapping ContentDocument discriminant) and dropping the dependency on documents.js's own PNG encoder (out of this port's scope): sniffImageFormat only inspects magic bytes, so a bare PNG-signature-prefixed byte array stands in for a real encoded PNG here.

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

const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const SLIDE_LAYOUT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';
const SLIDE_MASTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster';
const THEME_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const HYPERLINK_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const NOTES_SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

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

describe('readPptx: slide size and order', () => {
  it('reads slide size from p:sldSz', () => {
    const doc = readPptx(buildFixturePackage());
    expect(doc.slides[0]?.size).toEqual({ widthPt: 960, heightPt: 540 });
  });

  it('orders slides via p:sldIdLst, not slide filename order', () => {
    const doc = readPptx(buildFixturePackage());
    // sldIdLst lists slide2 before slide1, so slides[0] must be slide2's content ("Second Slide").
    const firstShapeText = asParagraph(doc.slides[0]?.shapes[0]?.blocks[0]).runs[0]?.text;
    expect(firstShapeText).toBe('Second Slide');
  });

  it('reads document metadata via readCoreProperties', () => {
    const doc = readPptx(buildFixturePackage());
    expect(doc.metadata.title).toBe('Fixture Deck');
  });
});

describe('readPptx: placeholder inheritance and run cascade', () => {
  it('inherits the title placeholder\'s geometry from the layout when the slide has none of its own', () => {
    const doc = readPptx(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    expect(titleShape?.frame).toEqual({ xPt: 72, yPt: 36, widthPt: 816, heightPt: 90 });
  });

  it('a run with no own rPr fully inherits size/bold/font/colour from the master titleStyle', () => {
    const doc = readPptx(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    const run = asParagraph(titleShape?.blocks[0]).runs[0];
    expect(run?.text).toBe('Hello');
    expect(run?.sizePt).toBe(44);
    expect(run?.bold).toBe(true);
    expect(run?.fontFamily).toBe('Aptos Display'); // +mj-lt resolved via the theme
    expect(run?.color).toEqual({ r: 0, g: 0, b: 0 }); // tx1 -> dk1 via clrMap -> black
  });

  it('a run\'s own explicit properties override the cascade only for the fields it sets', () => {
    const doc = readPptx(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    const run = asParagraph(titleShape?.blocks[0]).runs[1];
    expect(run?.text).toBe(' World');
    expect(run?.sizePt).toBe(20); // overridden
    expect(run?.italic).toBe(true); // overridden
    expect(run?.bold).toBe(true); // still inherited from the master
    expect(run?.fontFamily).toBe('Aptos Display'); // still inherited
  });
});

describe('readPptx: paragraph formatting', () => {
  it('reads alignment, indent, absolute spacing, and percentage line spacing', () => {
    const doc = readPptx(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === 'Body 1');
    const para = asParagraph(bodyShape?.blocks[0]);
    expect(para.alignment).toBe('center');
    expect(para.indentLeftPt).toBe(36);
    expect(para.indentFirstLinePt).toBe(-36);
    expect(para.spacingBeforePt).toBe(6);
    expect(para.lineSpacing).toBe(1.5);
  });

  it('resolves an external hyperlink through the slide\'s own relationships', () => {
    const doc = readPptx(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === 'Body 1');
    const para = asParagraph(bodyShape?.blocks[0]);
    expect(para.runs[0]?.hyperlink).toBe('https://example.com');
  });

  it('reads underline and strikethrough', () => {
    const doc = readPptx(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === 'Body 1');
    const para = asParagraph(bodyShape?.blocks[0]);
    expect(para.runs[1]?.underline).toBe(true);
    expect(para.runs[1]?.strike).toBe(true);
  });
});

describe('readPptx: text-box insets and autofit', () => {
  it('reads explicit a:bodyPr insets and a:normAutofit scaling', () => {
    const doc = readPptx(buildFixturePackage());
    const bodyShape = doc.slides[1]?.shapes.find((s) => s.name === 'Body 1');
    expect(bodyShape?.insetLeftPt).toBe(14.4);
    expect(bodyShape?.insetTopPt).toBe(7.2);
    expect(bodyShape?.insetRightPt).toBe(14.4);
    expect(bodyShape?.insetBottomPt).toBe(7.2);
    expect(bodyShape?.fontScale).toBe(0.92);
    expect(bodyShape?.lineSpacingReduction).toBe(0.1);
  });

  it('falls back to ECMA-376\'s default insets when a:bodyPr is absent, with no autofit', () => {
    const doc = readPptx(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    expect(titleShape?.insetLeftPt).toBe(7.2);
    expect(titleShape?.insetTopPt).toBe(3.6);
    expect(titleShape?.insetRightPt).toBe(7.2);
    expect(titleShape?.insetBottomPt).toBe(3.6);
    expect(titleShape?.fontScale).toBeUndefined();
    expect(titleShape?.lineSpacingReduction).toBeUndefined();
  });

  it('reads zero insets for a picture, which has no text body at all', () => {
    const doc = readPptx(buildFixturePackage());
    const picShape = doc.slides[1]?.shapes.find((s) => s.name === 'Picture 1');
    expect(picShape?.insetLeftPt).toBe(0);
    expect(picShape?.insetTopPt).toBe(0);
    expect(picShape?.insetRightPt).toBe(0);
    expect(picShape?.insetBottomPt).toBe(0);
  });
});

describe('readPptx: images', () => {
  it('reads a PNG image, sized to the shape\'s own frame', () => {
    const doc = readPptx(buildFixturePackage());
    const picShape = doc.slides[1]?.shapes.find((s) => s.name === 'Picture 1');
    const image = asImage(picShape?.blocks[0]);
    expect(image.kind).toBe('image');
    expect(image.format).toBe('png');
    expect(image.widthPt).toBe(80);
    expect(image.heightPt).toBe(80);
  });
});

describe('readPptx: tables', () => {
  it('reads column widths, a merged cell\'s colSpan, and its continuation cell as empty', () => {
    const doc = readPptx(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === 'Table 1');
    const table = asTable(tableShape?.blocks[0]);
    expect(table.columnWidthsPt).toEqual([100, 150]);
    expect(table.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(asParagraph(table.rows[0]?.cells[0]?.blocks[0]).runs[0]?.text).toBe('Merged');
    expect(table.rows[0]?.cells[1]?.blocks).toEqual([]);
  });

  it('reads a row\'s explicit height, and leaves it undefined when a:tr has no h attribute', () => {
    const doc = readPptx(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === 'Table 1');
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[0]?.heightPt).toBe(36);
    expect(table.rows[1]?.heightPt).toBeUndefined();
  });

  it('reads a cell\'s background fill', () => {
    const doc = readPptx(buildFixturePackage());
    const tableShape = doc.slides[1]?.shapes.find((s) => s.name === 'Table 1');
    const table = asTable(tableShape?.blocks[0]);
    expect(table.rows[1]?.cells[0]?.background).toEqual({ r: 1, g: 0, b: 0 });
  });
});

describe('readPptx: group shapes', () => {
  it('flattens a group\'s child shape into the slide\'s flat shape list at its absolute (transformed) position', () => {
    const doc = readPptx(buildFixturePackage());
    const grouped = doc.slides[1]?.shapes.find((s) => s.name === 'Grouped shape');
    // group off=(100,100)pt ext=(200,200)pt, chOff=(0,0) chExt=(100,100)pt -> scale 2x; child local (10,10,20,20)pt -> absolute (120,120,40,40)pt.
    expect(grouped?.frame).toEqual({ xPt: 120, yPt: 120, widthPt: 40, heightPt: 40 });
  });
});

describe('readPptx: rotation', () => {
  it('carries a shape\'s own rotationDeg through unchanged', () => {
    const doc = readPptx(buildFixturePackage());
    const rotated = doc.slides[0]?.shapes.find((s) => s.name === 'Rotated');
    expect(rotated?.rotationDeg).toBe(45);
  });

  it('leaves rotationDeg undefined for an unrotated shape', () => {
    const doc = readPptx(buildFixturePackage());
    const titleShape = doc.slides[1]?.shapes.find((s) => s.name === 'Title 1');
    expect(titleShape?.rotationDeg).toBeUndefined();
  });
});

describe('readPptx: notes', () => {
  it('prefers the notes slide\'s own body placeholder over concatenating every a:t (excluding the slide-number field)', () => {
    const doc = readPptx(buildFixturePackage());
    expect(doc.slides[1]?.notes).toBe('Speaker notes here');
  });

  it('is an empty string for a slide with no notesSlide relationship', () => {
    const doc = readPptx(buildFixturePackage());
    expect(doc.slides[0]?.notes).toBe('');
  });
});
