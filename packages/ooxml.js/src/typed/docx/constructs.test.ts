import { describe, expect, it } from 'vitest';
import type { ConstructDescriptor, ContentBlock } from 'document-schema.js';
import { findConstructMarkerImbalance } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlNode } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { readDocxContent } from './read';
import { insertConstructMarkers } from './constructs';

// The block-scope rule in action: which real docx spellings of a structured document tag, field, bookmark, or tracked change become a constructStart/constructEnd pair, and which ones (the run-level occurrences, and the pairs whose extents cross) are deliberately not representable. Every fixture here is a whole word/document.xml body, so each case is read exactly as readDocxContent would read a real file.

function docxPackage(bodyChildren: XmlNode[]): Package {
  const body = el('w:body', {}, [...bodyChildren, el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '12240', 'w:h': '15840' })])]);
  return { parts: { 'word/document.xml': { kind: 'xml', nodes: [el('w:document', {}, [body])] } } };
}

function para(text: string, ...extra: XmlNode[]): XmlNode {
  return el('w:p', {}, [...extra, el('w:r', {}, [el('w:t', {}, [txt(text)])])]);
}

function blocksOf(bodyChildren: XmlNode[]): ContentBlock[] {
  return readDocxContent(docxPackage(bodyChildren)).sections[0]?.blocks ?? [];
}

// A compact, order-preserving projection of a block list: each construct marker as its descriptor (or a bare close), each paragraph as its text, everything else as its kind -- so a test asserts the whole shape at once rather than probing indices one at a time.
function outline(blocks: readonly ContentBlock[]): (string | ConstructDescriptor)[] {
  return blocks.map((block) => {
    if (block.kind === 'constructStart') {
      return block.descriptor;
    }
    if (block.kind === 'constructEnd') {
      return ')';
    }
    if (block.kind === 'paragraph') {
      return block.runs.map((run) => run.text).join('');
    }
    return block.kind;
  });
}

describe('docx constructs: structured document tags', () => {
  it('reads a block-level w:sdt as a contentControl construct bracketing its own content', () => {
    const sdt = el('w:sdt', {}, [
      el('w:sdtPr', {}, [el('w:alias', { 'w:val': 'Author name' }), el('w:tag', { 'w:val': 'author' }), el('w:lock', { 'w:val': 'sdtContentLocked' }), el('w:text')]),
      el('w:sdtContent', {}, [para('Ada Lovelace')]),
    ]);
    expect(outline(blocksOf([sdt]))).toEqual([
      { kind: 'contentControl', controlType: 'plainText', tag: 'author', alias: 'Author name', lock: 'both' },
      'Ada Lovelace',
      ')',
    ]);
  });

  it('reads a dropdown control\'s own w:listItem entries as the descriptor options', () => {
    const sdt = el('w:sdt', {}, [
      el('w:sdtPr', {}, [el('w:dropDownList', {}, [el('w:listItem', { 'w:displayText': 'Draft', 'w:value': 'D' }), el('w:listItem', { 'w:displayText': 'Final', 'w:value': 'F' })])]),
      el('w:sdtContent', {}, [para('Draft')]),
    ]);
    expect(outline(blocksOf([sdt]))[0]).toEqual({ kind: 'contentControl', controlType: 'dropDown', options: ['Draft', 'Final'] });
  });

  it('reads a w14 checkbox control\'s checked state as a boolean rather than through the scalar value field', () => {
    const checked = el('w:sdt', {}, [
      el('w:sdtPr', {}, [el('w14:checkbox', {}, [el('w14:checked', { 'w14:val': '1' })])]),
      el('w:sdtContent', {}, [para('X')]),
    ]);
    const unchecked = el('w:sdt', {}, [
      el('w:sdtPr', {}, [el('w14:checkbox', {}, [el('w14:checked', { 'w14:val': '0' })])]),
      el('w:sdtContent', {}, [para('')]),
    ]);
    expect(outline(blocksOf([checked]))[0]).toEqual({ kind: 'contentControl', controlType: 'checkbox', checked: true });
    expect(outline(blocksOf([unchecked]))[0]).toEqual({ kind: 'contentControl', controlType: 'checkbox', checked: false });
  });

  it('reads a date control\'s w:fullDate as the control\'s scalar value', () => {
    const sdt = el('w:sdt', {}, [
      el('w:sdtPr', {}, [el('w:date', { 'w:fullDate': '2026-08-18T00:00:00Z' })]),
      el('w:sdtContent', {}, [para('18 August 2026')]),
    ]);
    expect(outline(blocksOf([sdt]))[0]).toEqual({ kind: 'contentControl', controlType: 'date', value: '2026-08-18T00:00:00Z' });
  });

  it('reads a Table of Contents docPartObj gallery as an index control, and any other gallery as a plain rich-text container', () => {
    const toc = el('w:sdt', {}, [
      el('w:sdtPr', {}, [el('w:docPartObj', {}, [el('w:docPartGallery', { 'w:val': 'Table of Contents' }), el('w:docPartUnique')])]),
      el('w:sdtContent', {}, [para('Chapter 1')]),
    ]);
    const coverPage = el('w:sdt', {}, [
      el('w:sdtPr', {}, [el('w:docPartObj', {}, [el('w:docPartGallery', { 'w:val': 'Cover Pages' })])]),
      el('w:sdtContent', {}, [para('Title page')]),
    ]);
    expect(outline(blocksOf([toc]))[0]).toEqual({ kind: 'contentControl', controlType: 'index' });
    expect(outline(blocksOf([coverPage]))[0]).toEqual({ kind: 'contentControl', controlType: 'richText' });
  });

  it('nests a content control inside a tracked insertion as nested marker pairs, innermost closing first', () => {
    const sdt = el('w:sdt', {}, [el('w:sdtPr', {}, [el('w:richText')]), el('w:sdtContent', {}, [para('Nested')])]);
    const ins = el('w:ins', { 'w:id': '1', 'w:author': 'Ada' }, [sdt]);
    expect(outline(blocksOf([ins]))).toEqual([
      { kind: 'provenance', change: 'insertion', author: 'Ada' },
      { kind: 'contentControl', controlType: 'richText' },
      'Nested',
      ')',
      ')',
    ]);
  });

  it('reads an inline w:sdt\'s content as ordinary runs, with no construct marker for a run-level extent', () => {
    const inlineSdt = el('w:p', {}, [
      el('w:r', {}, [el('w:t', {}, [txt('before ')])]),
      el('w:sdt', {}, [el('w:sdtPr', {}, [el('w:text')]), el('w:sdtContent', {}, [el('w:r', {}, [el('w:t', {}, [txt('inside')])])])]),
      el('w:r', {}, [el('w:t', {}, [txt(' after')])]),
    ]);
    expect(outline(blocksOf([inlineSdt]))).toEqual(['before inside after']);
  });
});

describe('docx constructs: tracked changes', () => {
  it('reads a whole paragraph whose every content child is a w:ins as an insertion construct', () => {
    const paragraph = el('w:p', {}, [
      el('w:pPr', {}, [el('w:rPr', {}, [el('w:ins', { 'w:id': '1', 'w:author': 'Ada', 'w:date': '2026-08-18T09:00:00Z' })])]),
      el('w:ins', { 'w:id': '2', 'w:author': 'Ada', 'w:date': '2026-08-18T09:00:00Z' }, [el('w:r', {}, [el('w:t', {}, [txt('Added line')])])]),
    ]);
    expect(outline(blocksOf([paragraph]))).toEqual([
      { kind: 'provenance', change: 'insertion', author: 'Ada', dateIso: '2026-08-18T09:00:00Z' },
      'Added line',
      ')',
    ]);
  });

  it('carries a wholly deleted paragraph\'s w:delText as the deletion construct\'s own content', () => {
    const paragraph = el('w:p', {}, [
      el('w:del', { 'w:id': '1', 'w:author': 'Grace' }, [el('w:r', {}, [el('w:delText', {}, [txt('Removed line')])])]),
    ]);
    expect(outline(blocksOf([paragraph]))).toEqual([{ kind: 'provenance', change: 'deletion', author: 'Grace' }, 'Removed line', ')']);
  });

  it('reads w:moveFrom and w:moveTo as their own provenance changes, the move-from side carrying its w:delText', () => {
    const moveFrom = el('w:p', {}, [el('w:moveFrom', { 'w:id': '1', 'w:author': 'Ada' }, [el('w:r', {}, [el('w:delText', {}, [txt('Moved')])])])]);
    const moveTo = el('w:p', {}, [el('w:moveTo', { 'w:id': '2', 'w:author': 'Ada' }, [el('w:r', {}, [el('w:t', {}, [txt('Moved')])])])]);
    expect(outline(blocksOf([moveFrom, moveTo]))).toEqual([
      { kind: 'provenance', change: 'moveFrom', author: 'Ada' },
      'Moved',
      ')',
      { kind: 'provenance', change: 'moveTo', author: 'Ada' },
      'Moved',
      ')',
    ]);
  });

  it('leaves a paragraph mixing tracked and untracked runs unbracketed, and still drops its mid-paragraph deletion', () => {
    const paragraph = el('w:p', {}, [
      el('w:r', {}, [el('w:t', {}, [txt('kept ')])]),
      el('w:ins', { 'w:id': '1', 'w:author': 'Ada' }, [el('w:r', {}, [el('w:t', {}, [txt('added ')])])]),
      el('w:del', { 'w:id': '2', 'w:author': 'Ada' }, [el('w:r', {}, [el('w:delText', {}, [txt('removed')])])]),
    ]);
    expect(outline(blocksOf([paragraph]))).toEqual(['kept added ']);
  });

  // This block-level w:del (a tracked-change element wrapping whole w:p elements directly) is not a shape Word itself ever emits -- CT_RunTrackChange has no w:p in its content model, so this is reader tolerance of malformed input, not a spelling buildDocxPackageFromContent produces. Word's own multi-paragraph deletion repeats the in-paragraph shape (a w:del wrapping each paragraph's own runs, with that paragraph's own mark also marked deleted) once per paragraph; see write.test.ts's own round-trip coverage for the writer's actual output shape.
  it('reads a block-level w:del wrapping whole paragraphs as one deletion construct over both', () => {
    const del = el('w:del', { 'w:id': '1', 'w:author': 'Grace', 'w:date': '2026-08-18T10:00:00Z' }, [
      el('w:p', {}, [el('w:r', {}, [el('w:delText', {}, [txt('first')])])]),
      el('w:p', {}, [el('w:r', {}, [el('w:delText', {}, [txt('second')])])]),
    ]);
    expect(outline(blocksOf([del]))).toEqual([
      { kind: 'provenance', change: 'deletion', author: 'Grace', dateIso: '2026-08-18T10:00:00Z' },
      'first',
      'second',
      ')',
    ]);
  });
});

describe('docx constructs: bookmarks', () => {
  it('reads a body-level bookmark pair as an anchor construct over the blocks between its halves', () => {
    const body = [el('w:bookmarkStart', { 'w:id': '1', 'w:name': 'intro' }), para('one'), para('two'), el('w:bookmarkEnd', { 'w:id': '1' }), para('outside')];
    expect(outline(blocksOf(body))).toEqual([{ kind: 'anchor', anchorType: 'bookmark', name: 'intro' }, 'one', 'two', ')', 'outside']);
  });

  it('reads a bookmark opening at the head of one paragraph and closing at the tail of a later one', () => {
    const body = [
      el('w:p', {}, [el('w:bookmarkStart', { 'w:id': '7', 'w:name': '_Toc1' }), el('w:r', {}, [el('w:t', {}, [txt('heading')])])]),
      para('body'),
      el('w:p', {}, [el('w:r', {}, [el('w:t', {}, [txt('last')])]), el('w:bookmarkEnd', { 'w:id': '7' })]),
    ];
    expect(outline(blocksOf(body))).toEqual([{ kind: 'anchor', anchorType: 'bookmark', name: '_Toc1' }, 'heading', 'body', 'last', ')']);
  });

  it('reads a bookmark wrapping exactly one whole paragraph, the shape Word gives a heading it can cross-reference', () => {
    const body = [
      el('w:p', {}, [el('w:bookmarkStart', { 'w:id': '3', 'w:name': '_Ref9' }), el('w:r', {}, [el('w:t', {}, [txt('Chapter')])]), el('w:bookmarkEnd', { 'w:id': '3' })]),
    ];
    expect(outline(blocksOf(body))).toEqual([{ kind: 'anchor', anchorType: 'bookmark', name: '_Ref9' }, 'Chapter', ')']);
  });

  it('drops a bookmark whose extent is a sub-sequence of one paragraph\'s runs', () => {
    const body = [
      el('w:p', {}, [
        el('w:r', {}, [el('w:t', {}, [txt('before ')])]),
        el('w:bookmarkStart', { 'w:id': '4', 'w:name': 'midway' }),
        el('w:r', {}, [el('w:t', {}, [txt('marked')])]),
        el('w:bookmarkEnd', { 'w:id': '4' }),
        el('w:r', {}, [el('w:t', {}, [txt(' after')])]),
      ]),
    ];
    expect(outline(blocksOf(body))).toEqual(['before marked after']);
  });

  it('drops a bookmark whose two halves sit in different block lists', () => {
    const cell = el('w:tc', {}, [para('cell'), el('w:bookmarkEnd', { 'w:id': '5' })]);
    const body = [
      el('w:bookmarkStart', { 'w:id': '5', 'w:name': 'straddles' }),
      el('w:tbl', {}, [el('w:tblGrid', {}, [el('w:gridCol', { 'w:w': '2880' })]), el('w:tr', {}, [cell])]),
    ];
    expect(outline(blocksOf(body))).toEqual(['table']);
  });

  it('drops the later of two bookmarks whose extents cross rather than nest', () => {
    const body = [
      el('w:bookmarkStart', { 'w:id': '1', 'w:name': 'outerish' }),
      para('one'),
      el('w:bookmarkStart', { 'w:id': '2', 'w:name': 'crosser' }),
      para('two'),
      el('w:bookmarkEnd', { 'w:id': '1' }),
      para('three'),
      el('w:bookmarkEnd', { 'w:id': '2' }),
    ];
    expect(outline(blocksOf(body))).toEqual([{ kind: 'anchor', anchorType: 'bookmark', name: 'outerish' }, 'one', 'two', ')', 'three']);
  });

  it('reads a bookmark with nothing between its halves as a point anchor -- an immediately closed pair', () => {
    const body = [para('one'), el('w:bookmarkStart', { 'w:id': '9', 'w:name': 'point' }), el('w:bookmarkEnd', { 'w:id': '9' }), para('two')];
    expect(outline(blocksOf(body))).toEqual(['one', { kind: 'anchor', anchorType: 'bookmark', name: 'point' }, ')', 'two']);
  });
});

describe('docx constructs: fields', () => {
  it('reads a multi-paragraph complex field as one field construct over every paragraph it spans', () => {
    const body = [
      el('w:p', {}, [
        el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]),
        el('w:r', {}, [el('w:instrText', {}, [txt(' TOC \\o "1-3" \\h ')])]),
        el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'separate' })]),
        el('w:r', {}, [el('w:t', {}, [txt('Chapter 1')])]),
      ]),
      para('Chapter 2'),
      el('w:p', {}, [el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'end' })])]),
      para('after'),
    ];
    expect(outline(blocksOf(body))).toEqual([
      { kind: 'field', instruction: ' TOC \\o "1-3" \\h ' },
      'Chapter 1',
      'Chapter 2',
      '',
      ')',
      'after',
    ]);
  });

  it('reads a w:fldSimple that is a paragraph\'s only content as a field construct over that paragraph', () => {
    const body = [el('w:p', {}, [el('w:fldSimple', { 'w:instr': ' PAGE ' }, [el('w:r', {}, [el('w:t', {}, [txt('4')])])])])];
    expect(outline(blocksOf(body))).toEqual([{ kind: 'field', instruction: ' PAGE ' }, '4', ')']);
  });

  it('leaves a mid-paragraph field unbracketed while still keeping its cached result text', () => {
    const body = [
      el('w:p', {}, [
        el('w:r', {}, [el('w:t', {}, [txt('Page ')])]),
        el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]),
        el('w:r', {}, [el('w:instrText', {}, [txt(' PAGE ')])]),
        el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'separate' })]),
        el('w:r', {}, [el('w:t', {}, [txt('3')])]),
        el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'end' })]),
        el('w:r', {}, [el('w:t', {}, [txt(' of 10')])]),
      ]),
    ];
    expect(outline(blocksOf(body))).toEqual(['Page 3 of 10']);
  });

  it('still brackets a whole-paragraph field followed by a run carrying nothing but its own formatting', () => {
    const body = [
      el('w:p', {}, [
        el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]),
        el('w:r', {}, [el('w:instrText', {}, [txt(' DATE ')])]),
        el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'separate' })]),
        el('w:r', {}, [el('w:t', {}, [txt('18/08/2026')])]),
        el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'end' })]),
        el('w:r', {}, [el('w:rPr', {}, [el('w:b')])]),
      ]),
    ];
    expect(outline(blocksOf(body))).toEqual([{ kind: 'field', instruction: ' DATE ' }, '18/08/2026', ')']);
  });
});

describe('docx constructs: scope boundaries', () => {
  it('brackets a construct inside a table cell within that cell\'s own block list', () => {
    const sdt = el('w:sdt', {}, [el('w:sdtPr', {}, [el('w:richText')]), el('w:sdtContent', {}, [para('in a cell')])]);
    const body = [el('w:tbl', {}, [el('w:tblGrid', {}, [el('w:gridCol', { 'w:w': '2880' })]), el('w:tr', {}, [el('w:tc', {}, [sdt])])])];
    const table = blocksOf(body)[0];
    if (table?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    expect(outline(table.rows[0]?.cells[0]?.blocks ?? [])).toEqual([{ kind: 'contentControl', controlType: 'richText' }, 'in a cell', ')']);
  });

  it('drops a bookmark whose extent straddles a section break rather than splitting it across two sections', () => {
    const sectionBreak = el('w:p', {}, [el('w:pPr', {}, [el('w:sectPr', {}, [el('w:pgSz', { 'w:w': '11906', 'w:h': '16838' })])])]);
    const body = [el('w:bookmarkStart', { 'w:id': '1', 'w:name': 'straddles' }), para('first section'), sectionBreak, para('second section'), el('w:bookmarkEnd', { 'w:id': '1' })];
    const doc = readDocxContent(docxPackage(body));
    expect(outline(doc.sections[0]?.blocks ?? [])).toEqual(['first section', '']);
    expect(outline(doc.sections[1]?.blocks ?? [])).toEqual(['second section']);
  });

  it('leaves every section\'s markers balanced by document-schema.js\'s own bracket-matching check', () => {
    const sdt = el('w:sdt', {}, [el('w:sdtPr', {}, [el('w:richText')]), el('w:sdtContent', {}, [para('controlled')])]);
    const body = [el('w:bookmarkStart', { 'w:id': '1', 'w:name': 'b' }), sdt, el('w:ins', { 'w:id': '2' }, [para('added')]), el('w:bookmarkEnd', { 'w:id': '1' })];
    for (const section of readDocxContent(docxPackage(body)).sections) {
      expect(findConstructMarkerImbalance(section.blocks)).toBeUndefined();
    }
  });
});

describe('insertConstructMarkers', () => {
  const anchor = (name: string): ConstructDescriptor => ({ kind: 'anchor', anchorType: 'bookmark', name });
  const blocks: ContentBlock[] = [
    { kind: 'paragraph', runs: [{ text: 'a' }] },
    { kind: 'paragraph', runs: [{ text: 'b' }] },
    { kind: 'paragraph', runs: [{ text: 'c' }] },
  ];

  it('opens the enclosing extent first when two extents share a start position', () => {
    const marked = insertConstructMarkers(blocks, [
      { startIndex: 0, endIndex: 1, order: 1, descriptor: anchor('inner') },
      { startIndex: 0, endIndex: 3, order: 0, descriptor: anchor('outer') },
    ]);
    expect(outline(marked)).toEqual([anchor('outer'), anchor('inner'), 'a', ')', 'b', 'c', ')']);
  });

  it('closes an extent before opening one that starts where it ended', () => {
    const marked = insertConstructMarkers(blocks, [
      { startIndex: 0, endIndex: 2, order: 0, descriptor: anchor('first') },
      { startIndex: 2, endIndex: 3, order: 1, descriptor: anchor('second') },
    ]);
    expect(outline(marked)).toEqual([anchor('first'), 'a', 'b', ')', anchor('second'), 'c', ')']);
  });

  it('keeps the block list unchanged when there are no extents at all', () => {
    expect(insertConstructMarkers(blocks, [])).toEqual(blocks);
  });
});
