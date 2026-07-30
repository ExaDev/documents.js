import type { XmlNode } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { el } from '../../xml/fragment';
import { buildParagraph, DocxParagraph } from './paragraph';

function paragraphFromXml(): { container: XmlNode[]; paragraph: DocxParagraph } {
  const paragraphElement = el('w:p', {}, [
    el('w:r', {}, [el('w:t', {}, [{ type: 'text', value: 'Hello ' }])]),
    el('w:r', {}, [el('w:t', {}, [{ type: 'text', value: 'world' }])]),
  ]);
  const container: XmlNode[] = [paragraphElement];
  return { container, paragraph: new DocxParagraph(container, paragraphElement) };
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
