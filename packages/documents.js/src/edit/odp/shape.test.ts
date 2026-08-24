import type { XmlNode } from 'odf.js';
import { resolveOdfShapeGeometry } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { createEmptyOdpPackage } from './scaffold';
import { buildImageFrame, buildTextBoxFrame, OdpShape } from './shape';

describe('buildTextBoxFrame / OdpShape frame and text', () => {
  it('round-trips frame in points', () => {
    const pkg = createEmptyOdpPackage();
    const frame = { xPt: 72, yPt: 36, widthPt: 200, heightPt: 100 };
    const frameElement = buildTextBoxFrame(pkg, frame, 'Hello');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    expect(shape.frame).toEqual(frame);
  });

  it('round-trips text', () => {
    const pkg = createEmptyOdpPackage();
    const frameElement = buildTextBoxFrame(pkg, { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hello world');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    expect(shape.text).toBe('Hello world');
  });

  it('setting text replaces the previous paragraph rather than appending another', () => {
    const pkg = createEmptyOdpPackage();
    const frameElement = buildTextBoxFrame(pkg, { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'First');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    shape.text = 'Second';
    expect(shape.text).toBe('Second');
    expect(shape.paragraphs()).toHaveLength(1);
  });

  it('setting frame updates the underlying svg:x/y/width/height in place', () => {
    const pkg = createEmptyOdpPackage();
    const frameElement = buildTextBoxFrame(pkg, { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    const newFrame = { xPt: 50, yPt: 60, widthPt: 300, heightPt: 150 };
    shape.frame = newFrame;
    expect(shape.frame).toEqual(newFrame);
  });

  it('remove() removes the shape and throws on further use', () => {
    const pkg = createEmptyOdpPackage();
    const frameElement = buildTextBoxFrame(pkg, { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, 'Hi');
    const container: XmlNode[] = [frameElement];
    const shape = new OdpShape(container, frameElement, pkg);
    shape.remove();
    expect(container).toHaveLength(0);
    expect(() => shape.text).toThrow(/removed/);
  });

  it('appendParagraph reuses OdtParagraph/OdtRun wholesale, including bold/colour styling via applyStyleChange', () => {
    const pkg = createEmptyOdpPackage();
    const frameElement = buildTextBoxFrame(pkg, { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 }, '');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    shape.paragraphs()[0]?.remove();
    const paragraph = shape.appendParagraph({ alignment: 'center' });
    const run = paragraph.appendRun({ text: 'Styled' });
    run.bold = true;
    run.color = { r: 1, g: 0, b: 0 };
    expect(shape.text).toBe('Styled');
    expect(paragraph.alignment).toBe('center');
    expect(run.bold).toBe(true);
    expect(run.color).toEqual({ r: 1, g: 0, b: 0 });
  });
});

describe('OdpShape.addList', () => {
  it('builds a text:list inside the text box, readable by decodeOdfText as ordinary paragraph text within it', () => {
    const pkg = createEmptyOdpPackage();
    const frameElement = buildTextBoxFrame(pkg, { xPt: 0, yPt: 0, widthPt: 200, heightPt: 100 }, '');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    shape.paragraphs()[0]?.remove();
    const list = shape.addList();
    list.addItem().appendParagraph({ text: 'First bullet' });
    list.addItem().appendParagraph({ text: 'Second bullet' });

    const textBox = frameElement.children.find((c) => c.type === 'element' && c.tag === 'draw:text-box');
    const listElement = textBox?.type === 'element' ? textBox.children.find((c) => c.type === 'element' && c.tag === 'text:list') : undefined;
    expect(listElement?.type === 'element' ? listElement.children.filter((c) => c.type === 'element' && c.tag === 'text:list-item') : []).toHaveLength(2);
  });
});

describe('OdpShape.rotationDeg', () => {
  it('is undefined for an unrotated shape', () => {
    const pkg = createEmptyOdpPackage();
    const frameElement = buildTextBoxFrame(pkg, { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 }, 'Hi');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    expect(shape.rotationDeg).toBeUndefined();
  });

  // Round trip through odf.js's own resolveOdfShapeGeometry (the exact function this package's own read path -- odf.js's readOdpContent -- uses), not just through OdpShape's own getter: this proves buildTransformAttr's draw:transform genuinely reproduces frame+rotationDeg for a real ODF consumer's reading, not merely for this class's own paired getter/setter.
  it('setting rotationDeg produces a draw:transform that resolveOdfShapeGeometry reads back to the same frame and rotation', () => {
    const pkg = createEmptyOdpPackage();
    const frame = { xPt: 50, yPt: 50, widthPt: 200, heightPt: 60 };
    const frameElement = buildTextBoxFrame(pkg, frame, 'Hi');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    shape.rotationDeg = 30;
    expect(shape.rotationDeg).toBeCloseTo(30, 9);
    expect(shape.frame?.xPt).toBeCloseTo(frame.xPt, 6);
    expect(shape.frame?.yPt).toBeCloseTo(frame.yPt, 6);
    expect(shape.frame?.widthPt).toBeCloseTo(frame.widthPt, 6);
    expect(shape.frame?.heightPt).toBeCloseTo(frame.heightPt, 6);

    const geometry = resolveOdfShapeGeometry(frameElement);
    expect(geometry?.rotationDeg).toBeCloseTo(30, 9);
    expect(geometry?.frame.xPt).toBeCloseTo(frame.xPt, 6);
    expect(geometry?.frame.yPt).toBeCloseTo(frame.yPt, 6);
  });

  it('carries no svg:x/svg:y once rotated -- draw:transform replaces them entirely', () => {
    const pkg = createEmptyOdpPackage();
    const frameElement = buildTextBoxFrame(pkg, { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 }, 'Hi');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    shape.rotationDeg = 45;
    expect(frameElement.attributes.some((a) => a.name === 'svg:x')).toBe(false);
    expect(frameElement.attributes.some((a) => a.name === 'svg:y')).toBe(false);
    expect(frameElement.attributes.some((a) => a.name === 'draw:transform')).toBe(true);
  });

  it('setting rotationDeg to undefined after a rotation restores plain svg:x/svg:y and removes draw:transform', () => {
    const pkg = createEmptyOdpPackage();
    const frame = { xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 };
    const frameElement = buildTextBoxFrame(pkg, frame, 'Hi');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    shape.rotationDeg = 45;
    shape.rotationDeg = undefined;
    expect(shape.rotationDeg).toBeUndefined();
    expect(shape.frame).toEqual(frame);
    expect(frameElement.attributes.some((a) => a.name === 'draw:transform')).toBe(false);
  });

  it('setting frame after rotating preserves the rotation', () => {
    const pkg = createEmptyOdpPackage();
    const frameElement = buildTextBoxFrame(pkg, { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 }, 'Hi');
    const shape = new OdpShape([frameElement], frameElement, pkg);
    shape.rotationDeg = 15;
    const newFrame = { xPt: 40, yPt: 40, widthPt: 120, heightPt: 60 };
    shape.frame = newFrame;
    expect(shape.rotationDeg).toBeCloseTo(15, 9);
    expect(shape.frame.xPt).toBeCloseTo(newFrame.xPt, 6);
    expect(shape.frame.yPt).toBeCloseTo(newFrame.yPt, 6);
  });
});

describe('buildImageFrame', () => {
  it('embeds the media part path and frame', () => {
    const pkg = createEmptyOdpPackage();
    const frame = { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 };
    const frameElement = buildImageFrame('Pictures/image1.png', frame);
    const shape = new OdpShape([frameElement], frameElement, pkg);
    expect(shape.frame).toEqual(frame);
    const image = frameElement.children.find((c) => c.type === 'element' && c.tag === 'draw:image');
    expect(image?.type === 'element' ? image.attributes : undefined).toContainEqual({ name: 'xlink:href', value: 'Pictures/image1.png' });
  });
});
