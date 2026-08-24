import type { XmlNode } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { createEmptyOdgPackage } from './scaffold';
import { buildEllipseElement, buildLineElement, buildPathElement, buildRectElement, OdgBoxVector, OdgLineVector, OdgPathVector } from './vector';

const RED = { r: 1, g: 0, b: 0 };
const BLACK = { r: 0, g: 0, b: 0 };

describe('OdgBoxVector (draw:rect / draw:ellipse)', () => {
  it('round-trips frame, fill, and stroke for a rect', () => {
    const pkg = createEmptyOdgPackage();
    const frame = { xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 };
    const element = buildRectElement(pkg, { frame, fill: RED, stroke: { color: BLACK, widthPt: 2 } });
    const vector = new OdgBoxVector([element], element, pkg);
    expect(vector.kind).toBe('rect');
    expect(vector.frame).toEqual(frame);
    expect(vector.fill).toEqual(RED);
    expect(vector.stroke).toEqual({ color: BLACK, widthPt: 2 });
  });

  it('an ellipse reports kind "ellipse"', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildEllipseElement(pkg, { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    const vector = new OdgBoxVector([element], element, pkg);
    expect(vector.kind).toBe('ellipse');
  });

  it('a vector with neither fill nor stroke reads back as undefined for both', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildRectElement(pkg, { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    const vector = new OdgBoxVector([element], element, pkg);
    expect(vector.fill).toBeUndefined();
    expect(vector.stroke).toBeUndefined();
  });

  it('setting frame updates svg:x/y/width/height in place', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildRectElement(pkg, { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    const vector = new OdgBoxVector([element], element, pkg);
    const newFrame = { xPt: 50, yPt: 60, widthPt: 300, heightPt: 150 };
    vector.frame = newFrame;
    expect(vector.frame).toEqual(newFrame);
  });

  it('setting fill/stroke after creation updates what is read back, without disturbing the other', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildRectElement(pkg, { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, fill: RED });
    const vector = new OdgBoxVector([element], element, pkg);
    vector.stroke = { color: BLACK, widthPt: 1 };
    expect(vector.fill).toEqual(RED);
    expect(vector.stroke).toEqual({ color: BLACK, widthPt: 1 });
  });

  it('remove() removes the vector and throws on further use', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildRectElement(pkg, { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    const container: XmlNode[] = [element];
    const vector = new OdgBoxVector(container, element, pkg);
    vector.remove();
    expect(container).toHaveLength(0);
    expect(() => vector.frame).toThrow(/removed/);
  });
});

describe('OdgLineVector (draw:line)', () => {
  it('round-trips from/to/stroke', () => {
    const pkg = createEmptyOdgPackage();
    const from = { xPt: 0, yPt: 0 };
    const to = { xPt: 100, yPt: 50 };
    const stroke = { color: BLACK, widthPt: 3 };
    const element = buildLineElement(pkg, { from, to, stroke });
    const vector = new OdgLineVector([element], element, pkg);
    expect(vector.from).toEqual(from);
    expect(vector.to).toEqual(to);
    expect(vector.stroke).toEqual(stroke);
  });

  it('setting from/to independently updates only the relevant endpoint', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildLineElement(pkg, { from: { xPt: 0, yPt: 0 }, to: { xPt: 10, yPt: 10 }, stroke: { color: BLACK, widthPt: 1 } });
    const vector = new OdgLineVector([element], element, pkg);
    vector.from = { xPt: 5, yPt: 5 };
    expect(vector.from).toEqual({ xPt: 5, yPt: 5 });
    expect(vector.to).toEqual({ xPt: 10, yPt: 10 });
  });

  it('remove() removes the vector and throws on further use', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildLineElement(pkg, { from: { xPt: 0, yPt: 0 }, to: { xPt: 10, yPt: 10 }, stroke: { color: BLACK, widthPt: 1 } });
    const container: XmlNode[] = [element];
    const vector = new OdgLineVector(container, element, pkg);
    vector.remove();
    expect(container).toHaveLength(0);
    expect(() => vector.from).toThrow(/removed/);
  });
});

describe('OdgPathVector (draw:path)', () => {
  const CURVE_SUBPATHS = [
    {
      start: { xPt: 0, yPt: 80 },
      closed: true,
      segments: [
        { kind: 'line' as const, to: { xPt: 60, yPt: 80 } },
        { kind: 'cubic' as const, control1: { xPt: 80, yPt: 80 }, control2: { xPt: 80, yPt: 0 }, to: { xPt: 40, yPt: 0 } },
      ],
    },
  ];

  it('round-trips frame, fill, stroke, and a genuinely curved subpath', () => {
    const pkg = createEmptyOdgPackage();
    const frame = { xPt: 20, yPt: 30, widthPt: 80, heightPt: 80 };
    const element = buildPathElement(pkg, { frame, subpaths: CURVE_SUBPATHS, fill: RED, stroke: { color: BLACK, widthPt: 1 } });
    const vector = new OdgPathVector([element], element, pkg);
    expect(vector.frame).toEqual(frame);
    expect(vector.fill).toEqual(RED);
    expect(vector.stroke).toEqual({ color: BLACK, widthPt: 1 });
    // subpaths is re-derived from the actual written svg:viewBox/svg:d every call, through odf.js's own real parser -- this IS the round-trip proof, not merely echoing back a cached JS value.
    expect(vector.subpaths).toEqual(CURVE_SUBPATHS);
  });

  it('re-parses through odf.js\'s own parser even for a plain straight-line-only path', () => {
    const pkg = createEmptyOdgPackage();
    const subpaths = [{ start: { xPt: 0, yPt: 0 }, closed: false, segments: [{ kind: 'line' as const, to: { xPt: 10, yPt: 10 } }] }];
    const element = buildPathElement(pkg, { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, subpaths });
    const vector = new OdgPathVector([element], element, pkg);
    expect(vector.subpaths).toEqual(subpaths);
  });

  it('setting frame after creation rescales the local coordinate space on reparse (viewBox/d stay fixed, exactly matching real ODF resize semantics)', () => {
    const pkg = createEmptyOdgPackage();
    const frame = { xPt: 0, yPt: 0, widthPt: 80, heightPt: 80 };
    const element = buildPathElement(pkg, { frame, subpaths: CURVE_SUBPATHS });
    const vector = new OdgPathVector([element], element, pkg);
    vector.frame = { xPt: 0, yPt: 0, widthPt: 160, heightPt: 80 };
    // Doubling the frame width (viewBox/d unchanged) doubles every point's own x, leaving y untouched.
    expect(vector.subpaths[0]?.start).toEqual({ xPt: 0, yPt: 80 });
    expect(vector.subpaths[0]?.segments[0]).toEqual({ kind: 'line', to: { xPt: 120, yPt: 80 } });
  });

  it('remove() removes the vector and throws on further use', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildPathElement(pkg, { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, subpaths: CURVE_SUBPATHS });
    const container: XmlNode[] = [element];
    const vector = new OdgPathVector(container, element, pkg);
    vector.remove();
    expect(container).toHaveLength(0);
    expect(() => vector.frame).toThrow(/removed/);
  });
});

// --- Rotation: the write-side inverse of odf.js's own resolveOdfShapeGeometry, mirroring OdpShape.rotationDeg ---

describe('vector rotation', () => {
  it('round-trips a rect\'s own rotationDeg and frame back through odf.js\'s own geometry resolver', () => {
    const pkg = createEmptyOdgPackage();
    const frame = { xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 };
    const element = buildRectElement(pkg, { frame, fill: RED });
    const vector = new OdgBoxVector([element], element, pkg);
    expect(vector.rotationDeg).toBeUndefined();

    vector.rotationDeg = 30;
    // Read back through resolveOdfShapeGeometry (what OdgBoxVector.frame/rotationDeg both consult, and what odf.js's own readDrawRectVector uses), not through the raw attributes -- a rotated element carries draw:transform and no svg:x/svg:y at all.
    expect(vector.rotationDeg).toBeCloseTo(30, 6);
    expect(vector.frame?.xPt).toBeCloseTo(frame.xPt, 6);
    expect(vector.frame?.yPt).toBeCloseTo(frame.yPt, 6);
    expect(vector.frame?.widthPt).toBeCloseTo(frame.widthPt, 6);
    expect(vector.frame?.heightPt).toBeCloseTo(frame.heightPt, 6);
  });

  it('writes a real draw:transform and drops svg:x/svg:y when rotated, restoring them when the rotation is cleared', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildEllipseElement(pkg, { frame: { xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 } });
    const vector = new OdgBoxVector([element], element, pkg);

    vector.rotationDeg = 45;
    expect(element.attributes.some((a) => a.name === 'draw:transform')).toBe(true);
    expect(element.attributes.some((a) => a.name === 'svg:x')).toBe(false);

    vector.rotationDeg = undefined;
    expect(element.attributes.some((a) => a.name === 'draw:transform')).toBe(false);
    expect(element.attributes.some((a) => a.name === 'svg:x')).toBe(true);
    expect(vector.frame).toEqual({ xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 });
  });

  it('keeps a rotation in place when only the frame is later changed', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildRectElement(pkg, { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    const vector = new OdgBoxVector([element], element, pkg);
    vector.rotationDeg = 20;
    vector.frame = { xPt: 50, yPt: 60, widthPt: 300, heightPt: 150 };
    expect(vector.rotationDeg).toBeCloseTo(20, 6);
    expect(vector.frame.xPt).toBeCloseTo(50, 6);
    expect(vector.frame.yPt).toBeCloseTo(60, 6);
  });

  it('round-trips a path vector\'s own rotationDeg, and still reparses its subpaths against the rotated frame', () => {
    const pkg = createEmptyOdgPackage();
    const frame = { xPt: 10, yPt: 20, widthPt: 80, heightPt: 40 };
    const subpaths = [{ start: { xPt: 0, yPt: 0 }, closed: true, segments: [{ kind: 'line' as const, to: { xPt: 80, yPt: 0 } }, { kind: 'line' as const, to: { xPt: 80, yPt: 40 } }] }];
    const element = buildPathElement(pkg, { frame, subpaths, fill: RED });
    const vector = new OdgPathVector([element], element, pkg);

    vector.rotationDeg = 15;
    expect(vector.rotationDeg).toBeCloseTo(15, 6);
    // subpaths re-derive from svg:viewBox + svg:d scaled against the resolved frame -- rotation lives on the frame, not in svg:d, so the local points are unchanged.
    const [subpath] = vector.subpaths;
    expect(subpath?.start).toEqual({ xPt: 0, yPt: 0 });
    expect(subpath?.segments).toHaveLength(2);
  });

  it('throws rather than silently doing nothing when the element has no resolvable frame', () => {
    const pkg = createEmptyOdgPackage();
    const element = buildRectElement(pkg, { frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    element.attributes = element.attributes.filter((a) => a.name !== 'svg:width' && a.name !== 'svg:height');
    const vector = new OdgBoxVector([element], element, pkg);
    expect(() => { vector.rotationDeg = 10; }).toThrow(/no resolvable frame/);
  });
});
