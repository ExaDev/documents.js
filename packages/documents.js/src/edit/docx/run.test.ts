import type { XmlNode } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { el } from '../../xml/fragment';
import { buildRun, DocxRun } from './run';

function runFromXml(): { container: XmlNode[]; run: DocxRun } {
  const runElement = el('w:r', {}, [el('w:t', {}, [{ type: 'text', value: 'Hello' }])]);
  const container: XmlNode[] = [runElement];
  return { container, run: new DocxRun(container, runElement) };
}

describe('DocxRun text', () => {
  it('reads and writes plain text', () => {
    const { run } = runFromXml();
    expect(run.text).toBe('Hello');
    run.text = 'Goodbye';
    expect(run.text).toBe('Goodbye');
  });

  it('XML-encodes special characters on write and decodes them back on read', () => {
    const { run } = runFromXml();
    run.text = 'Tom & Jerry <ok>';
    expect(run.text).toBe('Tom & Jerry <ok>');
  });

  it('sets xml:space="preserve" when the text has leading/trailing whitespace', () => {
    const { container, run } = runFromXml();
    run.text = '  padded  ';
    const runElement = container[0];
    if (runElement?.type !== 'element') {
      throw new Error('expected an element');
    }
    const tNode = runElement.children[0];
    if (tNode?.type !== 'element') {
      throw new Error('expected a w:t element');
    }
    expect(tNode.attributes).toContainEqual({ name: 'xml:space', value: 'preserve' });
  });
});

describe('DocxRun toggle properties', () => {
  it('bold/italic default to false and can be toggled on and off', () => {
    const { run } = runFromXml();
    expect(run.bold).toBe(false);
    expect(run.italic).toBe(false);
    run.bold = true;
    run.italic = true;
    expect(run.bold).toBe(true);
    expect(run.italic).toBe(true);
    run.bold = false;
    expect(run.bold).toBe(false);
    expect(run.italic).toBe(true); // unaffected by the other toggle
  });

  it('underline defaults to false, "single" when set true, "none" when set false', () => {
    const { run } = runFromXml();
    expect(run.underline).toBe(false);
    run.underline = true;
    expect(run.underline).toBe(true);
    run.underline = false;
    expect(run.underline).toBe(false);
  });
});

describe('DocxRun value properties', () => {
  it('fontFamily, sizePt, and color round-trip through get/set', () => {
    const { run } = runFromXml();
    expect(run.fontFamily).toBeUndefined();
    expect(run.sizePt).toBeUndefined();
    expect(run.color).toBeUndefined();

    run.fontFamily = 'Arial';
    run.sizePt = 14;
    run.color = { r: 1, g: 0, b: 0 };

    expect(run.fontFamily).toBe('Arial');
    expect(run.sizePt).toBe(14);
    expect(run.color).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('setting properties multiple times updates in place rather than duplicating rPr children', () => {
    const { container, run } = runFromXml();
    run.bold = true;
    run.fontFamily = 'Arial';
    run.fontFamily = 'Times New Roman';
    const runElement = container[0];
    if (runElement?.type !== 'element') {
      throw new Error('expected an element');
    }
    const rPr = runElement.children.find((c) => c.type === 'element' && c.tag === 'w:rPr');
    if (rPr?.type !== 'element') {
      throw new Error('expected w:rPr');
    }
    const rFontsCount = rPr.children.filter((c) => c.type === 'element' && c.tag === 'w:rFonts').length;
    expect(rFontsCount).toBe(1);
    expect(run.fontFamily).toBe('Times New Roman');
  });

  it('inserts w:rPr children in ECMA-376 schema order regardless of call order', () => {
    const { container, run } = runFromXml();
    run.sizePt = 12;
    run.color = { r: 0, g: 0, b: 0 };
    run.bold = true;
    run.fontFamily = 'Arial';
    const runElement = container[0];
    if (runElement?.type !== 'element') {
      throw new Error('expected an element');
    }
    const rPr = runElement.children.find((c) => c.type === 'element' && c.tag === 'w:rPr');
    if (rPr?.type !== 'element') {
      throw new Error('expected w:rPr');
    }
    const tags = rPr.children.filter((c) => c.type === 'element').map((c) => c.tag);
    expect(tags).toEqual(['w:rFonts', 'w:b', 'w:color', 'w:sz', 'w:szCs']);
  });
});

describe('DocxRun.remove', () => {
  it('removes the run from its container and throws on any further use', () => {
    const { container, run } = runFromXml();
    run.remove();
    expect(container).toHaveLength(0);
    expect(() => run.text).toThrow(/removed/);
    expect(() => {
      run.bold = true;
    }).toThrow(/removed/);
  });
});

describe('buildRun', () => {
  it('builds a run with no properties for plain text', () => {
    const runElement = buildRun({ text: 'Hi' });
    expect(runElement.children).toHaveLength(1);
    const run = new DocxRun([runElement], runElement);
    expect(run.text).toBe('Hi');
    expect(run.bold).toBe(false);
  });

  it('builds a run with initial formatting applied', () => {
    const runElement = buildRun({ text: 'Hi', bold: true, italic: true, sizePt: 16, fontFamily: 'Arial' });
    const run = new DocxRun([runElement], runElement);
    expect(run.bold).toBe(true);
    expect(run.italic).toBe(true);
    expect(run.sizePt).toBe(16);
    expect(run.fontFamily).toBe('Arial');
    expect(run.text).toBe('Hi');
  });
});
