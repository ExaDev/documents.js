import type { XmlElement, XmlNode } from 'ooxml.js';
import { attr } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { el } from '../../xml/fragment';
import { buildParagraph, DocxParagraph } from './paragraph';

function paragraphFromXml(): { container: XmlNode[]; paragraph: DocxParagraph; paragraphElement: XmlElement } {
  const paragraphElement = el('w:p', {}, [
    el('w:r', {}, [el('w:t', {}, [{ type: 'text', value: 'Hello ' }])]),
    el('w:r', {}, [el('w:t', {}, [{ type: 'text', value: 'world' }])]),
  ]);
  const container: XmlNode[] = [paragraphElement];
  return { container, paragraph: new DocxParagraph(container, paragraphElement), paragraphElement };
}

describe('DocxParagraph.text and runs', () => {
  it('concatenates text across all runs', () => {
    const { paragraph } = paragraphFromXml();
    expect(paragraph.text).toBe('Hello world');
  });

  it('runs() returns one DocxRun per w:r in document order', () => {
    const { paragraph } = paragraphFromXml();
    const runs = paragraph.runs();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.text).toBe('Hello ');
    expect(runs[1]?.text).toBe('world');
  });

  it('appendRun adds a run at the end', () => {
    const { paragraph } = paragraphFromXml();
    paragraph.appendRun({ text: '!' });
    expect(paragraph.text).toBe('Hello world!');
    expect(paragraph.runs()).toHaveLength(3);
  });

  it('insertRunAt inserts a run at the given run-index, not the raw child index', () => {
    const { paragraph } = paragraphFromXml();
    paragraph.insertRunAt(1, { text: 'brave ' });
    expect(paragraph.text).toBe('Hello brave world');
  });
});

describe('DocxParagraph styleId / alignment / list', () => {
  it('styleId defaults to undefined and can be set and cleared', () => {
    const { paragraph } = paragraphFromXml();
    expect(paragraph.styleId).toBeUndefined();
    paragraph.styleId = 'Heading1';
    expect(paragraph.styleId).toBe('Heading1');
    paragraph.styleId = undefined;
    expect(paragraph.styleId).toBeUndefined();
  });

  it('alignment defaults to undefined and can be set to each value and cleared', () => {
    const { paragraph } = paragraphFromXml();
    expect(paragraph.alignment).toBeUndefined();
    for (const value of ['left', 'center', 'right', 'justify'] as const) {
      paragraph.alignment = value;
      expect(paragraph.alignment).toBe(value);
    }
    paragraph.alignment = undefined;
    expect(paragraph.alignment).toBeUndefined();
  });

  it('list defaults to undefined and round-trips numId/level, and can be cleared', () => {
    const { paragraph } = paragraphFromXml();
    expect(paragraph.list).toBeUndefined();
    paragraph.list = { numId: '3', level: 2 };
    expect(paragraph.list).toEqual({ numId: '3', level: 2 });
    paragraph.list = undefined;
    expect(paragraph.list).toBeUndefined();
  });

  it('headingLevel defaults to undefined, stores as 0-based w:outlineLvl, and can be cleared', () => {
    const { paragraph, paragraphElement } = paragraphFromXml();
    expect(paragraph.headingLevel).toBeUndefined();
    paragraph.headingLevel = 2;
    // w:outlineLvl is 0-based where the schema's headingLevel is 1-based -- the same +1 mapping ooxml.js's own docx reader applies on the way back in.
    const pPr = paragraphElement.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'w:pPr');
    const outlineLvl = pPr?.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'w:outlineLvl');
    expect(outlineLvl === undefined ? undefined : attr(outlineLvl, 'w:val')).toBe('1');
    expect(paragraph.headingLevel).toBe(2);
    paragraph.headingLevel = undefined;
    expect(paragraph.headingLevel).toBeUndefined();
  });
});

describe('DocxParagraph.appendTab', () => {
  it('appends a w:tab element inside its own run, not a literal tab character in text', () => {
    const paragraphElement = el('w:p', {}, []);
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    paragraph.appendTab();
    const run = paragraphElement.children[0];
    if (run?.type !== 'element' || run.tag !== 'w:r') {
      throw new Error('expected a w:r child');
    }
    const tab = run.children[0];
    expect(tab?.type === 'element' ? tab.tag : undefined).toBe('w:tab');
  });

  it('interleaves correctly between real runs, in document order', () => {
    const paragraphElement = el('w:p', {}, []);
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    paragraph.appendRun({ text: 'before' });
    paragraph.appendTab();
    paragraph.appendRun({ text: 'after' });
    const tags = paragraphElement.children.map((c) => (c.type === 'element' ? c.tag : undefined));
    expect(tags).toEqual(['w:r', 'w:r', 'w:r']);
    expect(paragraph.text).toBe('beforeafter'); // w:tab contributes no text-content characters (ooxml.js's textContent has no WordprocessingML-specific knowledge of it) -- its presence is verified structurally above
  });
});

describe('DocxParagraph.remove', () => {
  it('removes the paragraph from its container and throws on further use', () => {
    const { container, paragraph } = paragraphFromXml();
    paragraph.remove();
    expect(container).toHaveLength(0);
    expect(() => paragraph.text).toThrow(/removed/);
  });
});

describe('buildParagraph', () => {
  it('builds an empty paragraph with no properties', () => {
    const paragraphElement = buildParagraph();
    expect(paragraphElement.children).toHaveLength(0);
  });

  it('builds a paragraph with initial text, style, and alignment', () => {
    const paragraphElement = buildParagraph({ text: 'Title', styleId: 'Heading1', alignment: 'center' });
    const paragraph = new DocxParagraph([paragraphElement], paragraphElement);
    expect(paragraph.text).toBe('Title');
    expect(paragraph.styleId).toBe('Heading1');
    expect(paragraph.alignment).toBe('center');
  });
});
