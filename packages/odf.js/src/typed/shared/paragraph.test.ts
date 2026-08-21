import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { readOdfParagraph } from './paragraph';

function contentPackage(automaticStyleChildren: XmlElement[] = []): Package['parts'][string] {
  return { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:automatic-styles', {}, automaticStyleChildren)])] };
}

function styleStyle(name: string, family: string, extra: Record<string, string>, children: XmlElement[] = []): XmlElement {
  return el('style:style', { 'style:name': name, 'style:family': family, ...extra }, children);
}

function textProps(attrs: Record<string, string>): XmlElement {
  return el('style:text-properties', attrs);
}

function paragraphProps(attrs: Record<string, string>): XmlElement {
  return el('style:paragraph-properties', attrs);
}

describe('readOdfParagraph: plain text and whitespace-run elements', () => {
  it('reads a bare text:p with no style-name as a single unstyled run', () => {
    const p = el('text:p', {}, [txt('Hello')]);
    const pkg: Package = { parts: {} };
    expect(readOdfParagraph(p, pkg)).toEqual({
      kind: 'paragraph',
      runs: [{ text: 'Hello', bold: undefined, italic: undefined, underline: undefined, strike: undefined, fontFamily: undefined, sizePt: undefined, color: undefined }],
      styleId: undefined,
      alignment: undefined,
      spacingBeforePt: undefined,
      spacingAfterPt: undefined,
      lineSpacing: undefined,
      indentLeftPt: undefined,
      indentFirstLinePt: undefined,
    });
  });

  it('expands text:s/text:tab/text:line-break into their own runs, exactly as text.ts\'s own decodeOdfText expands them, rather than dropping them as zero-length text nodes', () => {
    const p = el('text:p', {}, [txt('A'), el('text:s', { 'text:c': '3' }), txt('B'), el('text:tab'), txt('C'), el('text:line-break'), txt('D')]);
    const pkg: Package = { parts: {} };
    const runs = readOdfParagraph(p, pkg).runs.map((run) => run.text);
    expect(runs).toEqual(['A', '   ', 'B', '\t', 'C', '\n', 'D']);
  });

  it('a text:s with no text:c attribute expands to exactly one space (the ODF schema default)', () => {
    const p = el('text:p', {}, [el('text:s')]);
    expect(readOdfParagraph(p, { parts: {} }).runs.map((r) => r.text)).toEqual([' ']);
  });

  it('an empty text:p produces no runs at all', () => {
    expect(readOdfParagraph(el('text:p'), { parts: {} }).runs).toEqual([]);
  });

  it('a zero-length text node contributes no run', () => {
    const p = el('text:p', {}, [txt('')]);
    expect(readOdfParagraph(p, { parts: {} }).runs).toEqual([]);
  });

  it('a bookmark or other zero-width marker child contributes no run, matching text.ts\'s own zero-length treatment (a field, by contrast, DOES contribute its cached text -- see the construct extents suite below)', () => {
    const p = el('text:p', {}, [txt('A'), el('text:bookmark', { 'text:name': 'x' }), txt('B')]);
    expect(readOdfParagraph(p, { parts: {} }).runs.map((r) => r.text)).toEqual(['A', 'B']);
  });
});

describe('readOdfParagraph: paragraph-level formatting', () => {
  it('resolves alignment/spacing/indent from the paragraph\'s own text:style-name, via the "paragraph" family cascade', () => {
    const p1 = styleStyle('P1', 'paragraph', {}, [paragraphProps({ 'fo:text-align': 'center', 'fo:margin-top': '12pt', 'fo:margin-bottom': '6pt', 'fo:margin-left': '18pt', 'fo:text-indent': '9pt' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([p1]) } };
    const p = el('text:p', { 'text:style-name': 'P1' }, [txt('Hi')]);
    const result = readOdfParagraph(p, pkg);
    expect(result.styleId).toBe('P1');
    expect(result.alignment).toBe('center');
    expect(result.spacingBeforePt).toBe(12);
    expect(result.spacingAfterPt).toBe(6);
    expect(result.indentLeftPt).toBe(18);
    expect(result.indentFirstLinePt).toBe(9);
  });

  it('un-spanned text within a styled paragraph inherits the paragraph style\'s own text-properties as its run formatting', () => {
    const p1 = styleStyle('P1', 'paragraph', {}, [textProps({ 'fo:font-weight': 'bold', 'fo:font-size': '14pt' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([p1]) } };
    const p = el('text:p', { 'text:style-name': 'P1' }, [txt('Bold text')]);
    const [run] = readOdfParagraph(p, pkg).runs;
    expect(run?.bold).toBe(true);
    expect(run?.sizePt).toBe(14);
  });
});

describe('readOdfParagraph: text:span run formatting', () => {
  it('a text:span\'s own resolved "text"-family properties override the paragraph\'s own base for exactly the span\'s own text', () => {
    const p1 = styleStyle('P1', 'paragraph', {}, [textProps({ 'fo:font-weight': 'bold', 'fo:font-size': '12pt' })]);
    const t1 = styleStyle('T1', 'text', {}, [textProps({ 'fo:font-style': 'italic' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([p1, t1]) } };
    const p = el('text:p', { 'text:style-name': 'P1' }, [txt('plain '), el('text:span', { 'text:style-name': 'T1' }, [txt('italic')]), txt(' plain again')]);

    const runs = readOdfParagraph(p, pkg).runs;
    expect(runs).toHaveLength(3);
    expect(runs[0]).toMatchObject({ text: 'plain ', bold: true, italic: undefined });
    expect(runs[1]).toMatchObject({ text: 'italic', bold: true, italic: true }); // inherits bold from the paragraph base, adds its own italic
    expect(runs[2]).toMatchObject({ text: ' plain again', bold: true, italic: undefined });
  });

  it('a text:span\'s own field wins over the paragraph base when both set the same field', () => {
    const p1 = styleStyle('P1', 'paragraph', {}, [textProps({ 'fo:font-size': '12pt' })]);
    const t1 = styleStyle('T1', 'text', {}, [textProps({ 'fo:font-size': '20pt' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([p1, t1]) } };
    const p = el('text:p', { 'text:style-name': 'P1' }, [el('text:span', { 'text:style-name': 'T1' }, [txt('big')])]);
    expect(readOdfParagraph(p, pkg).runs[0]?.sizePt).toBe(20);
  });

  it('a nested text:span layers its own properties over its own (already-merged) parent span, not just the top-level paragraph base', () => {
    const t1 = styleStyle('T1', 'text', {}, [textProps({ 'fo:font-weight': 'bold' })]);
    const t2 = styleStyle('T2', 'text', {}, [textProps({ 'fo:font-style': 'italic' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([t1, t2]) } };
    const p = el('text:p', {}, [el('text:span', { 'text:style-name': 'T1' }, [el('text:span', { 'text:style-name': 'T2' }, [txt('both')])])]);
    expect(readOdfParagraph(p, pkg).runs[0]).toMatchObject({ text: 'both', bold: true, italic: true });
  });

  it('text:s/text:tab/text:line-break inside a text:span carry the span\'s own resolved formatting too', () => {
    const t1 = styleStyle('T1', 'text', {}, [textProps({ 'fo:font-weight': 'bold' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([t1]) } };
    const p = el('text:p', {}, [el('text:span', { 'text:style-name': 'T1' }, [txt('A'), el('text:tab'), txt('B')])]);
    const runs = readOdfParagraph(p, pkg).runs;
    expect(runs.every((run) => run.bold === true)).toBe(true);
    expect(runs.map((r) => r.text)).toEqual(['A', '\t', 'B']);
  });

  it('a text:span with no text:style-name at all still recurses into its own children using the paragraph base unchanged', () => {
    const p = el('text:p', {}, [el('text:span', {}, [txt('unstyled span text')])]);
    expect(readOdfParagraph(p, { parts: {} }).runs[0]).toMatchObject({ text: 'unstyled span text', bold: undefined });
  });
});

describe('readOdfParagraph: text:a hyperlink recovery', () => {
  it('reads a text:a/xlink:href wrapping a text:span, stamping hyperlink on the run while preserving the span formatting and text', () => {
    const t1 = styleStyle('T1', 'text', {}, [textProps({ 'fo:font-weight': 'bold' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([t1]) } };
    const p = el('text:p', {}, [el('text:a', { 'xlink:href': 'https://example.com' }, [el('text:span', { 'text:style-name': 'T1' }, [txt('link text')])])]);
    const [run] = readOdfParagraph(p, pkg).runs;
    expect(run).toMatchObject({ text: 'link text', bold: true, hyperlink: 'https://example.com' });
  });

  it('stamps hyperlink on plain text directly inside a text:a, with no span', () => {
    const p = el('text:p', {}, [el('text:a', { 'xlink:href': 'https://example.com/plain' }, [txt('click here')])]);
    expect(readOdfParagraph(p, { parts: {} }).runs[0]).toMatchObject({ text: 'click here', hyperlink: 'https://example.com/plain' });
  });

  it('does not stamp hyperlink on runs outside the text:a', () => {
    const p = el('text:p', {}, [txt('before '), el('text:a', { 'xlink:href': 'https://example.com' }, [txt('link')]), txt(' after')]);
    const runs = readOdfParagraph(p, { parts: {} }).runs;
    expect(runs).toEqual([
      { text: 'before ', bold: undefined, italic: undefined, underline: undefined, strike: undefined, fontFamily: undefined, sizePt: undefined, color: undefined },
      { text: 'link', bold: undefined, italic: undefined, underline: undefined, strike: undefined, fontFamily: undefined, sizePt: undefined, color: undefined, hyperlink: 'https://example.com' },
      { text: ' after', bold: undefined, italic: undefined, underline: undefined, strike: undefined, fontFamily: undefined, sizePt: undefined, color: undefined },
    ]);
  });
});

describe('readOdfParagraph: run-level construct extents (fields, bookmarks)', () => {
  it('reads a simple field as a run carrying its cached text plus a field extent covering exactly that run', () => {
    const p = el('text:p', {}, [txt('Page '), el('text:page-number', { 'style:num-format': 'arabic' }, [txt('3')]), txt(' of 10')]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.runs.map((run) => run.text)).toEqual(['Page ', '3', ' of 10']);
    expect(paragraph.constructs).toEqual([
      {
        descriptor: {
          kind: 'field',
          instruction: '<text:page-number style:num-format="arabic"></text:page-number>',
          cachedResult: '3',
        },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it('reads a variable-set field instance the same way as an everyday simple field', () => {
    const p = el('text:p', {}, [
      el('text:variable-set', { 'text:name': 'total', 'office:value-type': 'float', 'office:value': '42', 'text:formula': 'oooc:=6*7' }, [txt('42')]),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.runs.map((run) => run.text)).toEqual(['42']);
    expect(paragraph.constructs?.[0]?.descriptor).toEqual({
      kind: 'field',
      instruction: '<text:variable-set text:name="total" office:value-type="float" office:value="42" text:formula="oooc:=6*7"></text:variable-set>',
      cachedResult: '42',
    });
  });

  it('reads a field with no cached text as a point extent and emits no run for it', () => {
    const p = el('text:p', {}, [txt('A'), el('text:title'), txt('B')]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.runs.map((run) => run.text)).toEqual(['A', 'B']);
    expect(paragraph.constructs).toEqual([
      { descriptor: { kind: 'field', instruction: '<text:title></text:title>' }, startRun: 1, endRun: 1 },
    ]);
  });

  it('leaves constructs absent when the paragraph carries no field, bookmark, or marker at all', () => {
    const p = el('text:p', {}, [txt('plain')]);
    expect(readOdfParagraph(p, { parts: {} }).constructs).toBeUndefined();
  });

  it('reads a point text:bookmark as a zero-width bookmark anchor at its run position', () => {
    const p = el('text:p', {}, [txt('before '), el('text:bookmark', { 'text:name': 'target' }), txt('after')]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.constructs).toEqual([
      { descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'target' }, startRun: 1, endRun: 1 },
    ]);
  });

  it('pairs text:bookmark-start/-end inside one paragraph into a run extent over the runs between them', () => {
    const p = el('text:p', {}, [
      txt('outside '),
      el('text:bookmark-start', { 'text:name': 'span' }),
      txt('inside'),
      el('text:bookmark-end', { 'text:name': 'span' }),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.constructs).toEqual([
      { descriptor: { kind: 'anchor', anchorType: 'bookmark', name: 'span' }, startRun: 1, endRun: 2 },
    ]);
  });

  it('keeps crossing in-paragraph bookmark extents as two entries, since run ranges are data rather than brackets', () => {
    const p = el('text:p', {}, [
      txt('a '),
      el('text:bookmark-start', { 'text:name': 'outer' }),
      txt('one '),
      el('text:bookmark-start', { 'text:name': 'inner' }),
      txt('two '),
      el('text:bookmark-end', { 'text:name': 'outer' }),
      txt('three'),
      el('text:bookmark-end', { 'text:name': 'inner' }),
      txt(' b'),
    ]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.constructs?.map((extent) => extent.descriptor)).toEqual([
      { kind: 'anchor', anchorType: 'bookmark', name: 'outer' },
      { kind: 'anchor', anchorType: 'bookmark', name: 'inner' },
    ]);
    expect(paragraph.constructs?.map((extent) => [extent.startRun, extent.endRun])).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });

  it('does not pair a bookmark whose halves both sit at paragraph edges -- that pair brackets whole blocks and belongs to the block-scope reader, never to both encodings', () => {
    const p = el('text:p', {}, [el('text:bookmark-start', { 'text:name': 'whole' }), txt('whole paragraph is marked'), el('text:bookmark-end', { 'text:name': 'whole' })]);
    const paragraph = readOdfParagraph(p, { parts: {} });
    expect(paragraph.constructs).toBeUndefined();
  });

  it('does not emit a run extent for a bookmark half pair missing its partner or its name', () => {
    const p = el('text:p', {}, [el('text:bookmark-start', { 'text:name': 'lonely' }), txt('text'), el('text:bookmark-end', { 'text:name': 'other' })]);
    expect(readOdfParagraph(p, { parts: {} }).constructs).toBeUndefined();
  });

  it('resolves a field inside a text:span with the span formatting on its cached run, extent still indexed against the paragraph flat run list', () => {
    const t1 = styleStyle('T1', 'text', {}, [textProps({ 'fo:font-weight': 'bold' })]);
    const pkg: Package = { parts: { 'content.xml': contentPackage([t1]) } };
    const p = el('text:p', {}, [el('text:span', { 'text:style-name': 'T1' }, [el('text:date', { 'style:data-style-name': 'N80' }, [txt('2026-08-21')])])]);
    const paragraph = readOdfParagraph(p, pkg);
    expect(paragraph.runs[0]).toMatchObject({ text: '2026-08-21', bold: true });
    expect(paragraph.constructs).toEqual([
      {
        descriptor: { kind: 'field', instruction: '<text:date style:data-style-name="N80"></text:date>', cachedResult: '2026-08-21' },
        startRun: 0,
        endRun: 1,
      },
    ]);
  });
});
