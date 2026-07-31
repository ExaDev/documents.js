import { describe, expect, it } from 'vitest';
import { createOdt } from './editor';
import { buildParagraph, OdtParagraph } from './paragraph';

describe('OdtParagraph text', () => {
  it('aggregates text across multiple runs, including a bare tab', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: 'Left' });
    paragraph.appendTab();
    paragraph.appendRun({ text: 'Right' });
    expect(paragraph.text).toBe('Left\tRight');
  });
});

describe('OdtParagraph.runs / appendRun / insertRunAt', () => {
  it('appendRun appends in order, runs() reflects them', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: 'A' });
    paragraph.appendRun({ text: 'B' });
    expect(paragraph.runs().map((r) => r.text)).toEqual(['A', 'B']);
  });

  it('insertRunAt inserts at the requested run position', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: 'First' });
    paragraph.appendRun({ text: 'Third' });
    paragraph.insertRunAt(1, { text: 'Second' });
    expect(paragraph.runs().map((r) => r.text)).toEqual(['First', 'Second', 'Third']);
  });
});

describe('OdtParagraph.styleId', () => {
  it('reads and writes text:style-name directly, bypassing StyleRegistry', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    expect(paragraph.styleId).toBeUndefined();
    paragraph.styleId = 'Heading_20_1';
    expect(paragraph.styleId).toBe('Heading_20_1');
    paragraph.styleId = undefined;
    expect(paragraph.styleId).toBeUndefined();
  });
});

describe('OdtParagraph.alignment', () => {
  it('reads and writes alignment via a freshly-interned automatic style', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    expect(paragraph.alignment).toBeUndefined();
    paragraph.alignment = 'center';
    expect(paragraph.alignment).toBe('center');
    paragraph.alignment = 'right';
    expect(paragraph.alignment).toBe('right');
  });
});

describe('buildParagraph', () => {
  it('builds a paragraph with initial text and styleId applied', () => {
    const editor = createOdt();
    const paragraphElement = buildParagraph(editor.toPackage(), { text: 'Hi', styleId: 'Standard' });
    const paragraph = new OdtParagraph([paragraphElement], paragraphElement, editor.toPackage());
    expect(paragraph.text).toBe('Hi');
    expect(paragraph.styleId).toBe('Standard');
  });

  // styleId and alignment both ultimately target the same text:style-name attribute (ODF has no separate inline alignment attribute the way WordprocessingML's w:jc is independent of w:pStyle) -- applying alignment always resolve-merges-interns a fresh automatic style and repoints text:style-name at it, so a styleId set earlier in the same buildParagraph call is superseded, not layered underneath. This is the same direct-formatting-flattens-the-cascade trade-off applyStyleChange's own comment (props.ts) documents for any two sequential setter calls, styleId included.
  it('alignment applied after styleId supersedes styleId, rather than layering under it', () => {
    const editor = createOdt();
    const paragraphElement = buildParagraph(editor.toPackage(), { text: 'Hi', styleId: 'Standard', alignment: 'center' });
    const paragraph = new OdtParagraph([paragraphElement], paragraphElement, editor.toPackage());
    expect(paragraph.alignment).toBe('center');
    expect(paragraph.styleId).not.toBe('Standard');
  });
});

describe('OdtParagraph.remove', () => {
  it('removes the paragraph from its body and throws on any further use', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph({ text: 'Bye' });
    expect(editor.paragraphs()).toHaveLength(1);
    paragraph.remove();
    expect(editor.paragraphs()).toHaveLength(0);
    expect(() => paragraph.text).toThrow(/removed/);
  });
});
