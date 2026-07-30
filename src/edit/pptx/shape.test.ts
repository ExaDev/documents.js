import type { XmlNode } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { buildPictureShape, buildTextBoxShape, PptxShape } from './shape';

describe('buildTextBoxShape / PptxShape frame and text', () => {
  it('round-trips frame in points, converting through EMU', () => {
    const frame = { xPt: 72, yPt: 36, widthPt: 200, heightPt: 100 };
    const shapeElement = buildTextBoxShape(frame, 'Hello', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    expect(shape.frame).toEqual(frame);
  });

  it('round-trips text', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hello world', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    expect(shape.text).toBe('Hello world');
  });

  it('setting text replaces the previous paragraph rather than appending another', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'First', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    shape.text = 'Second';
    expect(shape.text).toBe('Second');
  });

  it('setting frame updates the underlying a:off/a:ext in place', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const shape = new PptxShape([shapeElement], shapeElement);
    const newFrame = { xPt: 50, yPt: 60, widthPt: 300, heightPt: 150 };
    shape.frame = newFrame;
    expect(shape.frame).toEqual(newFrame);
  });

  it('remove() removes the shape and throws on further use', () => {
    const shapeElement = buildTextBoxShape({ xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi', 2);
    const container: XmlNode[] = [shapeElement];
    const shape = new PptxShape(container, shapeElement);
    shape.remove();
    expect(container).toHaveLength(0);
    expect(() => shape.text).toThrow(/removed/);
  });
});

describe('buildPictureShape', () => {
  it('embeds the relationship id and frame', () => {
    const frame = { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 };
    const shapeElement = buildPictureShape(frame, 'rId5', 3);
    const shape = new PptxShape([shapeElement], shapeElement);
    expect(shape.frame).toEqual(frame);
    const blipFill = shapeElement.children.find((c) => c.type === 'element' && c.tag === 'p:blipFill');
    if (blipFill?.type !== 'element') {
      throw new Error('expected p:blipFill');
    }
    const blip = blipFill.children.find((c) => c.type === 'element' && c.tag === 'a:blip');
    expect(blip?.type === 'element' ? blip.attributes : undefined).toContainEqual({ name: 'r:embed', value: 'rId5' });
  });
});
