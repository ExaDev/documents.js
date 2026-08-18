import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { describe, expect, it } from 'vitest';
import type { ContentBlock, ContentImageBlock, ContentParagraph, ContentTable } from 'document-schema.js';
import { el, txt } from '../../xml/fragment';
import { readDocx } from './read';

// Ported from documents.js's src/ooxml/docx/read.test.ts, adapted to readDocx's own DocxDocument shape (sections directly, not wrapped in a ContentDocument discriminated union) and merged with this package's comment/footnote/header/footer coverage.

const HYPERLINK_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const THEME_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const PICTURE_GRAPHIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

// A genuine, minimal 1x1 transparent PNG -- real magic bytes, so sniffImageFormat actually recognises it, not a placeholder string.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// wp:inline and wp:anchor share the identical wp:extent/wp:docPr/a:graphic/a:graphicData/pic:pic/pic:blipFill/a:blip shape -- only the outer container tag (and, for wp:anchor, the positioning elements readDrawingImage deliberately never reads) differs.
function drawingElement(containerTag: 'wp:inline' | 'wp:anchor', rId: string, altText: string): XmlElement {
  return el('w:drawing', {}, [
    el(containerTag, {}, [
      el('wp:extent', { cx: '914400', cy: '457200' }), // 1in x 0.5in -> 72pt x 36pt
      el('wp:docPr', { id: '1', name: 'Picture 1', descr: altText }),
      el('a:graphic', {}, [
        el('a:graphicData', { uri: PICTURE_GRAPHIC_URI }, [el('pic:pic', {}, [el('pic:blipFill', {}, [el('a:blip', { 'r:embed': rId })])])]),
      ]),
    ]),
  ]);
}

function rels(entries: { id: string; type: string; target: string; external?: boolean }[]): XmlElement {
  return el(
    'Relationships',
    {},
    entries.map((e) => el('Relationship', e.external ? { Id: e.id, Type: e.type, Target: e.target, TargetMode: 'External' } : { Id: e.id, Type: e.type, Target: e.target })),
  );
}

function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== 'paragraph') {
    throw new Error('expected a paragraph block');
  }
  return block;
}

// The two construct-boundary markers have no sourcePath field at all (a boundary is not content), so reading one off an unnarrowed ContentBlock no longer type-checks -- this narrows past them for the assertions below, which only ever look at real content blocks.
function sourcePathOf(block: ContentBlock | undefined): string | undefined {
  if (block === undefined || block.kind === 'constructStart' || block.kind === 'constructEnd') {
    return undefined;
  }
  return block.sourcePath;
}

function asTable(block: ContentBlock | undefined): ContentTable {
  if (block?.kind !== 'table') {
    throw new Error('expected a table block');
  }
  return block;
}

function buildFixturePackage(): Package {
  const docDefaultsRPr = el('w:rPr', {}, [el('w:sz', { 'w:val': '20' })]);
  const normalStyle = el('w:style', { 'w:type': 'paragraph', 'w:styleId': 'Normal', 'w:default': '1' }, [el('w:rPr', {}, [el('w:rFonts', { 'w:asciiTheme': 'minorHAnsi' })])]);
  const heading1Style = el('w:style', { 'w:type': 'paragraph', 'w:styleId': 'Heading1' }, [
    el('w:basedOn', { 'w:val': 'Normal' }),
    el('w:rPr', {}, [el('w:b'), el('w:sz', { 'w:val': '36' })]),
  ]);
  const styles = el('w:styles', {}, [el('w:docDefaults', {}, [el('w:rPrDefault', {}, [docDefaultsRPr])]), normalStyle, heading1Style]);

  const titlePara = el('w:p', {}, [el('w:pPr', {}, [el('w:pStyle', { 'w:val': 'Heading1' })]), el('w:r', {}, [el('w:t', {}, [txt('Title')])])]);

  const pageBreakPara = el('w:p', {}, [el('w:pPr', {}, [el('w:pageBreakBefore')]), el('w:r', {}, [el('w:t', {}, [txt('After a page break')])])]);

  const hyperlinkPara = el('w:p', {}, [
    el('w:hyperlink', { 'r:id': 'rIdHlink' }, [el('w:r', {}, [el('w:t', {}, [txt('link text')])])]),
  ]);

  const fieldPara = el('w:p', {}, [
    el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]),
    el('w:r', {}, [el('w:instrText', {}, [txt(' PAGE ')])]),
    el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'separate' })]),
    el('w:r', {}, [el('w:t', {}, [txt('1')])]),
    el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'end' })]),
  ]);

  const insertedPara = el('w:ins', { 'w:id': '1' }, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Inserted')])])])]);
  const deletedPara = el('w:del', { 'w:id': '2' }, [el('w:p', {}, [el('w:r', {}, [el('w:delText', {}, [txt('Deleted')])])])]);

  const sdtPara = el('w:sdt', {}, [el('w:sdtContent', {}, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Content control')])])])])]);

  const altContent = el('mc:AlternateContent', {}, [
    el('mc:Choice', { Requires: 'wps' }, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Choice')])])])]),
    el('mc:Fallback', {}, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Fallback')])])])]),
  ]);

  const listPara = el('w:p', {}, [el('w:pPr', {}, [el('w:numPr', {}, [el('w:ilvl', { 'w:val': '1' }), el('w:numId', { 'w:val': '5' })])]), el('w:r', {}, [el('w:t', {}, [txt('List item')])])]);

  const tabBreakPara = el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('a')]), el('w:tab'), el('w:t', {}, [txt('b')]), el('w:br'), el('w:t', {}, [txt('c')])])]);

  const mergedCellBorders = el('w:tcBorders', {}, [
    el('w:top', { 'w:val': 'single', 'w:sz': '8', 'w:color': '00FF00' }),
    el('w:left', { 'w:val': 'nil' }),
    el('w:bottom', { 'w:val': 'dashed', 'w:color': 'auto' }),
  ]);
  const mergedCell = el('w:tc', {}, [el('w:tcPr', {}, [el('w:gridSpan', { 'w:val': '2' }), el('w:shd', { 'w:fill': 'FF0000' }), mergedCellBorders]), el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Merged')])])])]);
  const vMergeAnchor = el('w:tc', {}, [el('w:tcPr', {}, [el('w:vMerge', { 'w:val': 'restart' })]), el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Top')])])])]);
  const vMergeContinuation1 = el('w:tc', {}, [el('w:tcPr', {}, [el('w:vMerge')]), el('w:p')]);
  const vMergeContinuation2 = el('w:tc', {}, [el('w:tcPr', {}, [el('w:vMerge')]), el('w:p')]);
  const table = el('w:tbl', {}, [
    el('w:tblGrid', {}, [el('w:gridCol', { 'w:w': '2880' }), el('w:gridCol', { 'w:w': '2880' })]),
    el('w:tr', {}, [mergedCell]),
    el('w:tr', {}, [vMergeAnchor, el('w:tc', {}, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Right1')])])])])]),
    el('w:tr', {}, [vMergeContinuation1, el('w:tc', {}, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Right2')])])])])]),
    el('w:tr', {}, [vMergeContinuation2, el('w:tc', {}, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Right3')])])])])]),
  ]);

  const sectionBreakPara = el('w:p', {}, [
    el('w:pPr', {}, [el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '11906', 'w:h': '16838' }), el('w:pgMar', { 'w:top': '1440', 'w:right': '1440', 'w:bottom': '1440', 'w:left': '1440' })])]),
  ]);
  const secondSectionPara = el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Second section')])])]);
  const inlineImagePara = el('w:p', {}, [el('w:r', {}, [drawingElement('wp:inline', 'rIdInlineImage', 'Inline alt text')])]);
  const floatingImagePara = el('w:p', {}, [el('w:r', {}, [drawingElement('wp:anchor', 'rIdFloatingImage', 'Floating alt text')])]);
  const finalSectPr = el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '12240', 'w:h': '15840' }), el('w:pgMar', { 'w:top': '720', 'w:right': '720', 'w:bottom': '720', 'w:left': '720' })]);

  const body = el('w:body', {}, [
    titlePara,
    pageBreakPara,
    hyperlinkPara,
    fieldPara,
    insertedPara,
    deletedPara,
    sdtPara,
    altContent,
    listPara,
    tabBreakPara,
    table,
    sectionBreakPara,
    secondSectionPara,
    inlineImagePara,
    floatingImagePara,
    finalSectPr,
  ]);
  const document = el('w:document', {}, [body]);

  const theme = el('a:theme', {}, [el('a:themeElements', {}, [el('a:fontScheme', {}, [el('a:majorFont', {}, [el('a:latin', { typeface: 'Major Font' })]), el('a:minorFont', {}, [el('a:latin', { typeface: 'Minor Font' })])])])]);

  const documentRels = rels([
    { id: 'rIdHlink', type: HYPERLINK_REL, target: 'https://example.com', external: true },
    { id: 'rIdTheme', type: THEME_REL, target: 'theme/theme1.xml' },
    { id: 'rIdInlineImage', type: IMAGE_REL, target: 'media/image1.png' },
    { id: 'rIdFloatingImage', type: IMAGE_REL, target: 'media/image2.png' },
  ]);

  const core = el('cp:coreProperties', {}, [el('dc:title', {}, [txt('Fixture Document')])]);

  const numbering = el('w:numbering', {}, [
    el('w:abstractNum', { 'w:abstractNumId': '0' }, [
      el('w:lvl', { 'w:ilvl': '0' }, [el('w:start', { 'w:val': '1' }), el('w:numFmt', { 'w:val': 'decimal' }), el('w:lvlText', { 'w:val': '%1.' })]),
      el('w:lvl', { 'w:ilvl': '1' }, [el('w:start', { 'w:val': '1' }), el('w:numFmt', { 'w:val': 'lowerRoman' }), el('w:lvlText', { 'w:val': '%2)' })]),
    ]),
    el('w:num', { 'w:numId': '5' }, [el('w:abstractNumId', { 'w:val': '0' })]),
  ]);

  return {
    parts: {
      'word/document.xml': { kind: 'xml', nodes: [document] },
      'word/_rels/document.xml.rels': { kind: 'xml', nodes: [documentRels] },
      'word/styles.xml': { kind: 'xml', nodes: [styles] },
      'word/theme/theme1.xml': { kind: 'xml', nodes: [theme] },
      'word/numbering.xml': { kind: 'xml', nodes: [numbering] },
      'docProps/core.xml': { kind: 'xml', nodes: [core] },
      'word/media/image1.png': { kind: 'binary', base64: TINY_PNG_BASE64 },
      'word/media/image2.png': { kind: 'binary', base64: TINY_PNG_BASE64 },
    },
  };
}

describe('readDocx: metadata', () => {
  it('reads document metadata via readCoreProperties', () => {
    const doc = readDocx(buildFixturePackage());
    expect(doc.metadata.title).toBe('Fixture Document');
  });

  it('throws when the package has no word/document.xml', () => {
    expect(() => readDocx({ parts: {} })).toThrow(/word\/document\.xml/);
  });
});

describe('readDocx: style cascade', () => {
  it('resolves a named style through its basedOn chain, overriding docDefaults', () => {
    const doc = readDocx(buildFixturePackage());
    const title = asParagraph(doc.sections[0]?.blocks[0]);
    expect(title.styleId).toBe('Heading1');
    expect(title.runs[0]?.sizePt).toBe(18); // Heading1's own 36 half-points, overriding docDefaults' 20
    expect(title.runs[0]?.bold).toBe(true); // from Heading1
  });

  it('resolves a theme font reference from the default style', () => {
    const doc = readDocx(buildFixturePackage());
    // blocks: [0]=title [1]=pageBreak [2]=pageBreakPara [3]=hyperlinkPara [4]=fieldPara -- the field paragraph's run inherits Normal's asciiTheme reference (no style of its own).
    const fieldPara = asParagraph(doc.sections[0]?.blocks[4]);
    expect(fieldPara.runs[0]?.fontFamily).toBe('Minor Font');
  });
});

// A dedicated minimal fixture for heading-level resolution: a built-in Heading2 carrying its own w:outlineLvl, a custom style based on it (the case name-matching the styleId against /^Heading\d+$/ silently misses), a paragraph with a direct w:pPr/w:outlineLvl, one beyond the schema's six-level heading domain, and one with no outline level anywhere in its cascade.
function buildHeadingFixturePackage(): Package {
  const normalStyle = el('w:style', { 'w:type': 'paragraph', 'w:styleId': 'Normal', 'w:default': '1' }, []);
  const heading2Style = el('w:style', { 'w:type': 'paragraph', 'w:styleId': 'Heading2' }, [
    el('w:basedOn', { 'w:val': 'Normal' }),
    el('w:pPr', {}, [el('w:outlineLvl', { 'w:val': '1' })]),
  ]);
  const customSectionStyle = el('w:style', { 'w:type': 'paragraph', 'w:styleId': 'CustomSection' }, [
    el('w:basedOn', { 'w:val': 'Heading2' }),
  ]);
  const styles = el('w:styles', {}, [normalStyle, heading2Style, customSectionStyle]);

  const builtInHeadingPara = el('w:p', {}, [el('w:pPr', {}, [el('w:pStyle', { 'w:val': 'Heading2' })]), el('w:r', {}, [el('w:t', {}, [txt('Built-in heading')])])]);
  const customSectionPara = el('w:p', {}, [el('w:pPr', {}, [el('w:pStyle', { 'w:val': 'CustomSection' })]), el('w:r', {}, [el('w:t', {}, [txt('Custom section heading')])])]);
  const directOutlinePara = el('w:p', {}, [el('w:pPr', {}, [el('w:outlineLvl', { 'w:val': '0' })]), el('w:r', {}, [el('w:t', {}, [txt('Direct outline level')])])]);
  const beyondDomainPara = el('w:p', {}, [el('w:pPr', {}, [el('w:outlineLvl', { 'w:val': '8' })]), el('w:r', {}, [el('w:t', {}, [txt('Word level 9')])])]);
  const bodyPara = el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Body text')])])]);

  const body = el('w:body', {}, [builtInHeadingPara, customSectionPara, directOutlinePara, beyondDomainPara, bodyPara, el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '12240', 'w:h': '15840' })])]);
  return {
    parts: {
      'word/document.xml': { kind: 'xml', nodes: [el('w:document', {}, [body])] },
      'word/styles.xml': { kind: 'xml', nodes: [styles] },
    },
  };
}

describe('readDocx: heading levels', () => {
  it("resolves headingLevel from the style's own w:outlineLvl (0-based, +1), not by name-matching the styleId", () => {
    const doc = readDocx(buildHeadingFixturePackage());
    const builtIn = asParagraph(doc.sections[0]?.blocks[0]);
    expect(builtIn.styleId).toBe('Heading2');
    expect(builtIn.headingLevel).toBe(2);
  });

  it('a custom style based on a built-in heading resolves its level through w:basedOn while keeping its own styleId', () => {
    const doc = readDocx(buildHeadingFixturePackage());
    const custom = asParagraph(doc.sections[0]?.blocks[1]);
    expect(custom.styleId).toBe('CustomSection');
    expect(custom.headingLevel).toBe(2);
  });

  it('a direct w:pPr/w:outlineLvl populates headingLevel without any named style', () => {
    const doc = readDocx(buildHeadingFixturePackage());
    expect(asParagraph(doc.sections[0]?.blocks[2]).headingLevel).toBe(1);
  });

  it('narrows Word outline levels beyond six onto the schema heading domain\'s top level', () => {
    const doc = readDocx(buildHeadingFixturePackage());
    expect(asParagraph(doc.sections[0]?.blocks[3]).headingLevel).toBe(6);
  });

  it('leaves headingLevel undefined for a paragraph with no outline level anywhere in its cascade', () => {
    const doc = readDocx(buildHeadingFixturePackage());
    expect(asParagraph(doc.sections[0]?.blocks[4]).headingLevel).toBeUndefined();
  });
});

describe('readDocx: page breaks', () => {
  it('inserts a pageBreak block before a paragraph with w:pageBreakBefore', () => {
    const doc = readDocx(buildFixturePackage());
    expect(doc.sections[0]?.blocks[1]?.kind).toBe('pageBreak');
    expect(asParagraph(doc.sections[0]?.blocks[2]).runs[0]?.text).toBe('After a page break');
  });
});

describe('readDocx: hyperlinks', () => {
  it('resolves a hyperlink run\'s external target', () => {
    const doc = readDocx(buildFixturePackage());
    const hyperlinkPara = asParagraph(doc.sections[0]?.blocks[3]);
    expect(hyperlinkPara.runs[0]?.hyperlink).toBe('https://example.com');
  });
});

describe('readDocx: fields', () => {
  it('keeps only the cached result text between fldChar separate and end, dropping the field code', () => {
    const doc = readDocx(buildFixturePackage());
    const fieldPara = asParagraph(doc.sections[0]?.blocks[4]);
    expect(fieldPara.runs).toHaveLength(1);
    expect(fieldPara.runs[0]?.text).toBe('1');
  });
});

describe('readDocx: tracked changes', () => {
  it('includes content wrapped in w:ins', () => {
    const doc = readDocx(buildFixturePackage());
    const inserted = asParagraph(doc.sections[0]?.blocks[5]);
    expect(inserted.runs[0]?.text).toBe('Inserted');
  });

  it('excludes content wrapped in w:del entirely', () => {
    const doc = readDocx(buildFixturePackage());
    const blockTexts = doc.sections[0]?.blocks.map((b) => (b.kind === 'paragraph' ? b.runs.map((r) => r.text).join('') : b.kind));
    expect(blockTexts).not.toContain('Deleted');
  });
});

describe('readDocx: content controls and alternate content', () => {
  it('recurses into w:sdt/w:sdtContent', () => {
    const doc = readDocx(buildFixturePackage());
    const sdtBlock = asParagraph(doc.sections[0]?.blocks[6]);
    expect(sdtBlock.runs[0]?.text).toBe('Content control');
  });

  it('prefers mc:Fallback over mc:Choice', () => {
    const doc = readDocx(buildFixturePackage());
    const altBlock = asParagraph(doc.sections[0]?.blocks[7]);
    expect(altBlock.runs[0]?.text).toBe('Fallback');
  });
});

describe('readDocx: lists', () => {
  it('reads numId/level from w:numPr', () => {
    const doc = readDocx(buildFixturePackage());
    const listBlock = asParagraph(doc.sections[0]?.blocks[8]);
    expect(listBlock.list).toEqual({ numId: '5', level: 1 });
  });

  it('resolves that numId\'s own numbering definition from word/numbering.xml', () => {
    const doc = readDocx(buildFixturePackage());
    expect(doc.numbering['5']?.levels['1']).toEqual({ format: 'lowerRoman', text: '%2)', startAt: 1 });
    expect(doc.numbering['5']?.levels['0']).toEqual({ format: 'decimal', text: '%1.', startAt: 1 });
  });
});

describe('readDocx: run text with tab/break', () => {
  it('embeds w:tab as a literal tab and w:br as a literal newline within one run\'s text', () => {
    const doc = readDocx(buildFixturePackage());
    const tabBreakBlock = asParagraph(doc.sections[0]?.blocks[9]);
    expect(tabBreakBlock.runs[0]?.text).toBe('a\tb\nc');
  });
});

describe('readDocx: tables', () => {
  it('reads column widths and a horizontally-merged cell\'s colSpan and background', () => {
    const doc = readDocx(buildFixturePackage());
    const table = asTable(doc.sections[0]?.blocks[10]);
    expect(table.columnWidthsPt).toEqual([144, 144]);
    expect(table.rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(table.rows[0]?.cells[0]?.background).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('reads w:tcBorders into the cell\'s own borders, mapping style keywords and eighth-point widths, skipping a nil edge and resolving an auto colour to black', () => {
    const doc = readDocx(buildFixturePackage());
    const table = asTable(doc.sections[0]?.blocks[10]);
    const borders = table.rows[0]?.cells[0]?.borders;
    expect(borders?.top).toEqual({ color: { r: 0, g: 1, b: 0 }, widthPt: 1, style: 'solid' });
    expect(borders?.left).toBeUndefined();
    expect(borders?.bottom).toEqual({ color: { r: 0, g: 0, b: 0 }, widthPt: 0.5, style: 'dashed' });
    expect(borders?.right).toBeUndefined();
  });

  it('computes a vMerge anchor\'s rowSpan by scanning subsequent continuation rows, leaving them empty', () => {
    const doc = readDocx(buildFixturePackage());
    const table = asTable(doc.sections[0]?.blocks[10]);
    expect(table.rows[1]?.cells[0]?.rowSpan).toBe(3);
    expect(table.rows[2]?.cells[0]?.blocks).toEqual([]);
    expect(table.rows[3]?.cells[0]?.blocks).toEqual([]);
    expect(asParagraph(table.rows[1]?.cells[1]?.blocks[0]).runs[0]?.text).toBe('Right1');
  });

  it('reads w:trPr/w:trHeight@w:val (twips) into the row\'s own heightPt', () => {
    const tableEl = el('w:tbl', {}, [
      el('w:tblGrid', {}, [el('w:gridCol', { 'w:w': '2880' })]),
      el('w:tr', {}, [
        el('w:trPr', {}, [el('w:trHeight', { 'w:val': '560' })]),
        el('w:tc', {}, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('cell')])])])]),
      ]),
    ]);
    const body = el('w:body', {}, [tableEl, el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '12240', 'w:h': '15840' })])]);
    const document = el('w:document', {}, [body]);
    const pkg: Package = { parts: { 'word/document.xml': { kind: 'xml', nodes: [document] } } };
    const doc = readDocx(pkg);
    const table = asTable(doc.sections[0]?.blocks[0]);
    expect(table.rows[0]?.heightPt).toBeCloseTo(28, 5); // 560 twips / 20 = 28 pt
  });
});

describe('readDocx: sourcePath', () => {
  it('assigns sections[N].blocks[N] and sections[N].blocks[N].runs[N] in document order', () => {
    const doc = readDocx(buildFixturePackage());
    const title = asParagraph(doc.sections[0]?.blocks[0]);
    expect(title.sourcePath).toBe('sections[0].blocks[0]');
    expect(title.runs[0]?.sourcePath).toBe('sections[0].blocks[0].runs[0]');
    expect(sourcePathOf(doc.sections[0]?.blocks[1])).toBe('sections[0].blocks[1]'); // the pageBreak block
    const secondSection = asParagraph(doc.sections[1]?.blocks[0]);
    expect(secondSection.sourcePath).toBe('sections[1].blocks[0]');
    expect(secondSection.runs[0]?.sourcePath).toBe('sections[1].blocks[0].runs[0]');
  });

  it('assigns a multi-run paragraph\'s runs their own zero-based index', () => {
    const doc = readDocx(buildFixturePackage());
    const tabBreakBlock = asParagraph(doc.sections[0]?.blocks[9]);
    expect(tabBreakBlock.sourcePath).toBe('sections[0].blocks[9]');
    expect(tabBreakBlock.runs[0]?.sourcePath).toBe('sections[0].blocks[9].runs[0]');
  });

  it('nests a table cell\'s own blocks under sections[N].blocks[N].rows[N].cells[N].blocks[N]', () => {
    const doc = readDocx(buildFixturePackage());
    const table = asTable(doc.sections[0]?.blocks[10]);
    expect(table.sourcePath).toBe('sections[0].blocks[10]');
    const mergedCell = asParagraph(table.rows[0]?.cells[0]?.blocks[0]);
    expect(mergedCell.sourcePath).toBe('sections[0].blocks[10].rows[0].cells[0].blocks[0]');
    expect(mergedCell.runs[0]?.sourcePath).toBe('sections[0].blocks[10].rows[0].cells[0].blocks[0].runs[0]');
    const right1Cell = asParagraph(table.rows[1]?.cells[1]?.blocks[0]);
    expect(right1Cell.sourcePath).toBe('sections[0].blocks[10].rows[1].cells[1].blocks[0]');
  });
});

describe('readDocx: multi-section support', () => {
  it('starts a new section at a mid-document w:pPr/w:sectPr, with that section\'s own page size and margins', () => {
    const doc = readDocx(buildFixturePackage());
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]?.pageSize).toEqual({ widthPt: 595.3, heightPt: 841.9 }); // A4, twips->pt
    expect(doc.sections[0]?.margins).toEqual({ topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 });
  });

  it('closes the final section with the body\'s own trailing w:sectPr', () => {
    const doc = readDocx(buildFixturePackage());
    expect(doc.sections[1]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 }); // US Letter, twips->pt
    expect(doc.sections[1]?.margins).toEqual({ topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 });
    expect(asParagraph(doc.sections[1]?.blocks[0]).runs[0]?.text).toBe('Second section');
  });
});

function asImage(block: ContentBlock | undefined): ContentImageBlock {
  if (block?.kind !== 'image') {
    throw new Error('expected an image block');
  }
  return block;
}

describe('readDocx: images', () => {
  it('reads an inline (wp:inline) w:drawing as a real ContentImageBlock, sized from wp:extent EMU converted to points', () => {
    const doc = readDocx(buildFixturePackage());
    // section 1 blocks: [0] secondSectionPara, [1] inlineImagePara (empty text), [2] its image, [3] floatingImagePara, [4] its image.
    const image = asImage(doc.sections[1]?.blocks[2]);
    expect(image.format).toBe('png');
    expect(image.widthPt).toBe(72); // 914400 EMU -> 1in -> 72pt
    expect(image.heightPt).toBe(36); // 457200 EMU -> 0.5in -> 36pt
    expect(image.altText).toBe('Inline alt text');
    expect(image.base64).toBe('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
  });

  it('reads a floating/anchored (wp:anchor) w:drawing as a real ContentImageBlock too, falling back to inline block-flow placement since ContentImageBlock has no absolute position field', () => {
    const doc = readDocx(buildFixturePackage());
    const image = asImage(doc.sections[1]?.blocks[4]);
    expect(image.format).toBe('png');
    expect(image.altText).toBe('Floating alt text');
  });

  it('assigns the image its own sourcePath alongside its containing paragraph', () => {
    const doc = readDocx(buildFixturePackage());
    expect(sourcePathOf(doc.sections[1]?.blocks[2])).toBe('sections[1].blocks[2]');
  });
});

describe('readDocx: comments, footnotes, headers, footers', () => {
  it('reads comment author and text from word/comments.xml', () => {
    const pkg = buildFixturePackage();
    pkg.parts['word/comments.xml'] = { kind: 'xml', nodes: [el('w:comments', {}, [el('w:comment', { 'w:author': 'Ann' }, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('comment text')])])])])])] };
    const doc = readDocx(pkg);
    expect(doc.comments).toHaveLength(1);
    expect(doc.comments[0]?.author).toBe('Ann');
    expect(doc.comments[0]?.text).toBe('comment text');
  });

  it('reads footnotes and skips separator and continuation marks', () => {
    const pkg = buildFixturePackage();
    pkg.parts['word/footnotes.xml'] = {
      kind: 'xml',
      nodes: [
        el('w:footnotes', {}, [
          el('w:footnote', { 'w:id': '-1', 'w:type': 'separator' }, [el('w:p', {}, [el('w:r', {}, [el('w:t')])])]),
          el('w:footnote', { 'w:id': '1' }, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('real footnote')])])])]),
        ]),
      ],
    };
    const doc = readDocx(pkg);
    expect(doc.footnotes).toHaveLength(1);
    expect(doc.footnotes[0]?.text).toBe('real footnote');
    expect(doc.footnotes[0]?.type).toBeUndefined();
  });

  it('reads header and footer text from their parts', () => {
    const pkg = buildFixturePackage();
    pkg.parts['word/header1.xml'] = { kind: 'xml', nodes: [el('w:hdr', {}, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Header text')])])])])] };
    pkg.parts['word/footer1.xml'] = { kind: 'xml', nodes: [el('w:ftr', {}, [el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('Footer text')])])])])] };
    const doc = readDocx(pkg);
    expect(doc.headers).toEqual(['Header text']);
    expect(doc.footers).toEqual(['Footer text']);
  });

  it('leaves comments/footnotes/headers/footers empty when their parts are absent', () => {
    const doc = readDocx(buildFixturePackage());
    expect(doc.comments).toEqual([]);
    expect(doc.footnotes).toEqual([]);
    expect(doc.headers).toEqual([]);
    expect(doc.footers).toEqual([]);
  });
});
