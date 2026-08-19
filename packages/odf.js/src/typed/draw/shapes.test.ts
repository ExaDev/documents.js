import { describe, expect, it } from 'vitest';
import type { ContentShape } from 'document-schema.js';
import type { Package } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { bytesToBase64 } from '../../util/base64';
import { readDrawFrame, readDrawPageContent, walkDrawShapes } from './shapes';

function contentPackage(automaticStyleChildren: XmlElement[] = []): Package['parts'][string] {
  return { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:automatic-styles', {}, automaticStyleChildren)])] };
}

function graphicStyle(name: string, attrs: Record<string, string>, extra: Record<string, string> = {}): XmlElement {
  return el('style:style', { 'style:name': name, 'style:family': 'graphic', ...extra }, [el('style:graphic-properties', attrs)]);
}

// Only the PNG magic-byte signature matters to sniffImageFormat -- the rest is arbitrary filler, not a real encoded image, matching ooxml.js's own read.test.ts convention.
function tinyPngBase64(): string {
  return bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
}

describe('readDrawFrame: geometry', () => {
  it('reads a plain, unrotated frame\'s own svg:x/svg:y/svg:width/svg:height with no group transform', () => {
    const frame = el('draw:frame', { 'svg:x': '10pt', 'svg:y': '20pt', 'svg:width': '100pt', 'svg:height': '50pt' });
    const shape = readDrawFrame(frame, [], { parts: {} });
    expect(shape?.frame).toEqual({ xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 });
    expect(shape?.rotationDeg).toBeUndefined();
  });

  it('returns undefined for a frame with no resolvable geometry at all (the documented inherited-positioning scope boundary)', () => {
    expect(readDrawFrame(el('draw:frame'), [], { parts: {} })).toBeUndefined();
  });

  it('reads the frame\'s own draw:name', () => {
    const frame = el('draw:frame', { 'draw:name': 'My Shape', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    expect(readDrawFrame(frame, [], { parts: {} })?.name).toBe('My Shape');
  });
});

describe('readDrawFrame: insets from the graphic-family style cascade', () => {
  it('reads fo:padding-* from the frame\'s own draw:style-name -> graphic family style', () => {
    const gr1 = graphicStyle('gr1', { 'fo:padding-left': '0.25cm', 'fo:padding-top': '0.125cm', 'fo:padding-right': '0.25cm', 'fo:padding-bottom': '0.125cm' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const frame = el('draw:frame', { 'draw:style-name': 'gr1', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const shape = readDrawFrame(frame, [], pkg);
    expect(shape?.insetLeftPt).toBeCloseTo(0.25 * (72 / 2.54), 6);
    expect(shape?.insetTopPt).toBeCloseTo(0.125 * (72 / 2.54), 6);
  });

  it('inherits padding via style:parent-style-name -- the real LibreOffice pattern where a shape\'s own automatic style rarely repeats "standard"\'s own padding declaration', () => {
    const standard = graphicStyle('standard', { 'fo:padding-left': '0.25cm', 'fo:padding-top': '0.125cm', 'fo:padding-right': '0.25cm', 'fo:padding-bottom': '0.125cm' });
    const gr1 = graphicStyle('gr1', { 'fo:min-height': '1.867cm' }, { 'style:parent-style-name': 'standard' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([standard, gr1]) } };
    const frame = el('draw:frame', { 'draw:style-name': 'gr1', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const shape = readDrawFrame(frame, [], pkg);
    expect(shape?.insetLeftPt).toBeCloseTo(0.25 * (72 / 2.54), 6);
    expect(shape?.insetBottomPt).toBeCloseTo(0.125 * (72 / 2.54), 6);
  });

  it('defaults every inset to 0 when the frame has no draw:style-name at all', () => {
    const frame = el('draw:frame', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const shape = readDrawFrame(frame, [], { parts: {} });
    expect(shape).toMatchObject({ insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 });
  });
});

describe('readDrawFrame: content dispatch', () => {
  const box = { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '100pt', 'svg:height': '50pt' };

  it('reads a draw:text-box\'s own text:p children as paragraph blocks', () => {
    const frame = el('draw:frame', box, [el('draw:text-box', {}, [el('text:p', {}, [txt('Hello')])])]);
    const shape = readDrawFrame(frame, [], { parts: {} });
    expect(shape?.blocks).toEqual([{ kind: 'paragraph', runs: [{ text: 'Hello', bold: undefined, italic: undefined, underline: undefined, strike: undefined, fontFamily: undefined, sizePt: undefined, color: undefined }], styleId: undefined, alignment: undefined, spacingBeforePt: undefined, spacingAfterPt: undefined, lineSpacing: undefined, indentLeftPt: undefined, indentFirstLinePt: undefined }]);
  });

  it('reads a text:list\'s own text:list-item > text:p paragraphs with list membership attached -- one minted numId across nesting, level read off the XML nesting depth (unstyled, so the numId carries no kind prefix)', () => {
    const list = el('text:list', {}, [
      el('text:list-item', {}, [el('text:p', {}, [txt('item one')])]),
      el('text:list-item', {}, [el('text:p', {}, [txt('item two')]), el('text:list', {}, [el('text:list-item', {}, [el('text:p', {}, [txt('item two.1')])])])]),
    ]);
    const frame = el('draw:frame', box, [el('draw:text-box', {}, [list])]);
    const shape = readDrawFrame(frame, [], { parts: {} });
    expect(shape?.blocks.map((b) => (b.kind === 'paragraph' ? b.runs.map((r) => r.text).join('') : undefined))).toEqual(['item one', 'item two', 'item two.1']);
    expect(shape?.blocks.map((b) => (b.kind === 'paragraph' ? b.list : undefined))).toEqual([{ numId: 'list1', level: 0 }, { numId: 'list1', level: 0 }, { numId: 'list1', level: 1 }]);
  });

  it('reads a draw:image\'s referenced media part, sniffed and sized to the frame\'s own resolved box', () => {
    const pkg: Package = { parts: { 'Pictures/img1.png': { kind: 'binary', base64: tinyPngBase64() } } };
    const frame = el('draw:frame', box, [el('draw:image', { 'xlink:href': 'Pictures/img1.png' })]);
    const shape = readDrawFrame(frame, [], pkg);
    expect(shape?.blocks).toEqual([{ kind: 'image', format: 'png', base64: tinyPngBase64(), widthPt: 100, heightPt: 50 }]);
  });

  it('reads the frame\'s own svg:title as the image block\'s altText -- alt text lives on the FRAME, not the draw:image element', () => {
    const pkg: Package = { parts: { 'Pictures/img1.png': { kind: 'binary', base64: tinyPngBase64() } } };
    const frame = el('draw:frame', box, [el('draw:image', { 'xlink:href': 'Pictures/img1.png' }), el('svg:title', {}, [txt('Chequered swatch')]), el('svg:desc', {}, [txt('A longer description')])]);
    expect(readDrawFrame(frame, [], pkg)?.blocks[0]).toMatchObject({ kind: 'image', altText: 'Chequered swatch' });
  });

  it('falls back to svg:desc when the frame carries a description but no title', () => {
    const pkg: Package = { parts: { 'Pictures/img1.png': { kind: 'binary', base64: tinyPngBase64() } } };
    const frame = el('draw:frame', box, [el('draw:image', { 'xlink:href': 'Pictures/img1.png' }), el('svg:desc', {}, [txt('A longer description')])]);
    expect(readDrawFrame(frame, [], pkg)?.blocks[0]).toMatchObject({ kind: 'image', altText: 'A longer description' });
  });

  it('leaves altText undefined (omitted, not empty-string) for a frame with neither svg:title nor svg:desc', () => {
    const pkg: Package = { parts: { 'Pictures/img1.png': { kind: 'binary', base64: tinyPngBase64() } } };
    const frame = el('draw:frame', box, [el('draw:image', { 'xlink:href': 'Pictures/img1.png' })]);
    expect(readDrawFrame(frame, [], pkg)?.blocks[0]).not.toHaveProperty('altText');
  });

  it('returns no blocks (not a thrown error) for a draw:image whose referenced part is missing', () => {
    const frame = el('draw:frame', box, [el('draw:image', { 'xlink:href': 'Pictures/missing.png' })]);
    expect(readDrawFrame(frame, [], { parts: {} })?.blocks).toEqual([]);
  });

  it('reads a table:table child as a single ContentTable block', () => {
    const table = el('table:table', {}, [el('table:table-row', {}, [el('table:table-cell', {}, [el('text:p', {}, [txt('cell')])])])]);
    const frame = el('draw:frame', box, [table]);
    const shape = readDrawFrame(frame, [], { parts: {} });
    expect(shape?.blocks).toHaveLength(1);
    expect(shape?.blocks[0]?.kind).toBe('table');
  });

  it('prefers table:table over a sibling draw:image fallback preview -- the real LibreOffice-generated shape both a table frame and its own .svm preview image share', () => {
    const table = el('table:table', {}, [el('table:table-row', {}, [el('table:table-cell', {}, [el('text:p', {}, [txt('cell')])])])]);
    const preview = el('draw:image', { 'xlink:href': 'Pictures/TablePreview1.svm' });
    const frame = el('draw:frame', box, [table, preview]);
    const shape = readDrawFrame(frame, [], { parts: {} });
    expect(shape?.blocks).toHaveLength(1);
    expect(shape?.blocks[0]?.kind).toBe('table');
  });

  it('reads an empty frame (no text-box/image/table child at all) as an empty blocks array', () => {
    const frame = el('draw:frame', box);
    expect(readDrawFrame(frame, [], { parts: {} })?.blocks).toEqual([]);
  });
});

describe('readDrawFrame: rotation via draw:transform', () => {
  it('composes into a center-pivoting frame + rotationDeg -- see transform.test.ts for the pixel-verified geometry this delegates to', () => {
    const frame = el('draw:frame', { 'svg:width': '200pt', 'svg:height': '60pt', 'draw:transform': 'rotate(1.5707963267948966) translate(100pt 100pt)' });
    const shape = readDrawFrame(frame, [], { parts: {} });
    expect(shape?.frame.xPt).toBeCloseTo(30, 6);
    expect(shape?.frame.yPt).toBeCloseTo(-30, 6);
    expect(shape?.rotationDeg).toBeCloseTo(-90, 6);
  });
});

describe('walkDrawShapes: flat, non-grouped content', () => {
  it('collects every draw:frame at the top level, in document order', () => {
    const frame1 = el('draw:frame', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const frame2 = el('draw:frame', { 'svg:x': '20pt', 'svg:y': '20pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const out: ContentShape[] = [];
    walkDrawShapes([frame1, frame2], [], { parts: {} }, out);
    expect(out.map((s) => s.frame.xPt)).toEqual([0, 20]);
  });

  it('skips a top-level element that is neither draw:frame nor draw:g (a bare vector-primitive shape, out of this task\'s documented scope)', () => {
    const out: ContentShape[] = [];
    walkDrawShapes([el('draw:rect', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' })], [], { parts: {} }, out);
    expect(out).toEqual([]);
  });

  it('drops a draw:frame with no resolvable geometry rather than pushing a fabricated shape', () => {
    const out: ContentShape[] = [];
    walkDrawShapes([el('draw:frame')], [], { parts: {} }, out);
    expect(out).toEqual([]);
  });
});

describe('walkDrawShapes: draw:g group flattening', () => {
  it('flattens a group\'s children into the parent\'s own flat shape list -- a real LibreOffice-generated group carries NO draw:transform of its own, so children keep their own literal, already-page-space coordinates unchanged', () => {
    const shapeA = el('draw:frame', { 'draw:name': 'A', 'svg:x': '50pt', 'svg:y': '50pt', 'svg:width': '80pt', 'svg:height': '40pt' });
    const shapeB = el('draw:frame', { 'draw:name': 'B', 'svg:x': '150pt', 'svg:y': '50pt', 'svg:width': '80pt', 'svg:height': '40pt' });
    const group = el('draw:g', {}, [shapeA, shapeB]);
    const out: ContentShape[] = [];
    walkDrawShapes([group], [], { parts: {} }, out);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: 'A', frame: { xPt: 50, yPt: 50, widthPt: 80, heightPt: 40 } });
    expect(out[1]).toMatchObject({ name: 'B', frame: { xPt: 150, yPt: 50, widthPt: 80, heightPt: 40 } });
  });

  it('composes a group\'s own draw:transform onto each child -- a concrete before/after example: child center (90,70) rotated+translated by the group becomes center (170,10)', () => {
    // Before: child A's own box is x:50 y:50 w:80 h:40 -> local center (90, 70).
    const shapeA = el('draw:frame', { 'svg:x': '50pt', 'svg:y': '50pt', 'svg:width': '80pt', 'svg:height': '40pt' });
    // Group transform: rotate(pi/2) translate(100pt 100pt) -- verified against a real render in transform.test.ts.
    const group = el('draw:g', { 'draw:transform': 'rotate(1.5707963267948966) translate(100pt 100pt)' }, [shapeA]);
    const out: ContentShape[] = [];
    walkDrawShapes([group], [], { parts: {} }, out);
    expect(out).toHaveLength(1);
    // After: applyOdfTransform(groupFunctions, {90,70}) -> rotate: (70,-90) -> translate: (170,10) -> frame top-left = center - halfSize = (170-40, 10-20) = (130,-10).
    expect(out[0]?.frame.xPt).toBeCloseTo(130, 6);
    expect(out[0]?.frame.yPt).toBeCloseTo(-10, 6);
    expect(out[0]?.frame.widthPt).toBeCloseTo(80, 6); // unchanged -- no scale in ODF's own group model
    expect(out[0]?.frame.heightPt).toBeCloseTo(40, 6);
    expect(out[0]?.rotationDeg).toBeCloseTo(-90, 6);
  });

  it('composes NESTED groups innermost-first: an inner group\'s own transform applies to the child before the outer group\'s own transform applies to the result', () => {
    const shape = el('draw:frame', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const inner = el('draw:g', { 'draw:transform': 'translate(10pt 0pt)' }, [shape]);
    const outer = el('draw:g', { 'draw:transform': 'translate(0pt 10pt)' }, [inner]);
    const out: ContentShape[] = [];
    walkDrawShapes([outer], [], { parts: {} }, out);
    // Child local center (5,5) -> inner translate (10,0) -> (15,5) -> outer translate (0,10) -> (15,15) -> top-left (10,10).
    expect(out[0]?.frame.xPt).toBeCloseTo(10, 6);
    expect(out[0]?.frame.yPt).toBeCloseTo(10, 6);
  });

  it('flattens an EMPTY group (no children) into nothing, without error', () => {
    const out: ContentShape[] = [];
    walkDrawShapes([el('draw:g')], [], { parts: {} }, out);
    expect(out).toEqual([]);
  });
});

// Vector primitives (odg) -- fixtures below reuse real geometry/attribute shapes verified against genuine LibreOffice 26.2 .odg output (a StarBasic macro run headlessly via the UNO API, NOT hand-authored guesses -- see typed/shared/path.ts's own top-of-file note for the exact verification method and the real svg:d/draw:points strings these fixtures are drawn from).

function vectorPackage(pkg: Package = { parts: {} }): Package {
  return pkg;
}

describe('readDrawPageContent: draw:rect / draw:ellipse / draw:circle', () => {
  it('reads a plain draw:rect into the rect variant, with fill+stroke from its own graphic-family style', () => {
    const gr1 = graphicStyle('gr1', { 'draw:fill-color': '#ff0000', 'svg:stroke-color': '#000000', 'svg:stroke-width': '0.05cm' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const rect = el('draw:rect', { 'draw:style-name': 'gr1', 'svg:x': '1cm', 'svg:y': '1cm', 'svg:width': '5cm', 'svg:height': '3cm' });
    const { vectors } = readDrawPageContent([rect], pkg);
    expect(vectors).toHaveLength(1);
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.frame.widthPt).toBeCloseTo(5 * (72 / 2.54), 6);
    expect(vector.fill).toEqual({ r: 1, g: 0, b: 0 });
    expect(vector.stroke?.color).toEqual({ r: 0, g: 0, b: 0 });
    expect(vector.stroke?.widthPt).toBeCloseTo(0.05 * (72 / 2.54), 6);
  });

  it('reads draw:ellipse and draw:circle into the SAME ellipse variant -- real LibreOffice output writes draw:circle instead of draw:ellipse specifically when width equals height, with no other attribute-shape difference', () => {
    const ellipse = el('draw:ellipse', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '50pt', 'svg:height': '30pt' });
    const circle = el('draw:circle', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '40pt', 'svg:height': '40pt' });
    const { vectors } = readDrawPageContent([ellipse, circle], { parts: {} });
    expect(vectors.map((v) => v.kind)).toEqual(['ellipse', 'ellipse']);
  });

  it('reads no fill/no stroke when the style carries neither -- a real draw:line\'s own automatic style has no draw:fill-color at all', () => {
    const rect = el('draw:rect', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { vectors } = readDrawPageContent([rect], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.fill).toBeUndefined();
    expect(vector.stroke).toBeUndefined();
  });

  it('honours an explicit draw:fill="none"/draw:stroke="none" override -- confirmed real LibreOffice output for a shape with FillStyle/LineStyle explicitly set to NONE', () => {
    const gr1 = graphicStyle('gr1', { 'draw:fill': 'none', 'draw:stroke': 'none' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const rect = el('draw:rect', { 'draw:style-name': 'gr1', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { vectors } = readDrawPageContent([rect], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.fill).toBeUndefined();
    expect(vector.stroke).toBeUndefined();
  });

  it('drops a rect/ellipse with no resolvable geometry at all rather than emitting a fabricated one', () => {
    expect(readDrawPageContent([el('draw:rect')], { parts: {} }).vectors).toEqual([]);
    expect(readDrawPageContent([el('draw:ellipse')], { parts: {} }).vectors).toEqual([]);
  });
});

describe('readDrawPageContent: draw:line', () => {
  it('reads svg:x1/y1/x2/y2 into the line variant\'s from/to points, requiring a resolvable stroke', () => {
    const gr1 = graphicStyle('gr1', { 'svg:stroke-color': '#0000ff', 'svg:stroke-width': '0.03cm' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const line = el('draw:line', { 'draw:style-name': 'gr1', 'svg:x1': '9cm', 'svg:y1': '1cm', 'svg:x2': '13cm', 'svg:y2': '4cm' });
    const { vectors } = readDrawPageContent([line], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'line') {
      throw new Error('expected a line vector');
    }
    expect(vector.from.xPt).toBeCloseTo(9 * (72 / 2.54), 6);
    expect(vector.to.yPt).toBeCloseTo(4 * (72 / 2.54), 6);
    expect(vector.stroke.color).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('drops a line with no resolvable stroke -- an invisible line has nothing to paint, matching ContentVectorSchema requiring stroke on the line variant', () => {
    const line = el('draw:line', { 'svg:x1': '0pt', 'svg:y1': '0pt', 'svg:x2': '10pt', 'svg:y2': '10pt' });
    expect(readDrawPageContent([line], { parts: {} }).vectors).toEqual([]);
  });

  it('applies an enclosing group\'s own draw:transform to both endpoints directly (no box/pivot needed for a two-point line)', () => {
    const gr1 = graphicStyle('gr1', { 'svg:stroke-color': '#000000', 'svg:stroke-width': '1pt' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const line = el('draw:line', { 'draw:style-name': 'gr1', 'svg:x1': '0pt', 'svg:y1': '0pt', 'svg:x2': '10pt', 'svg:y2': '0pt' });
    const group = el('draw:g', { 'draw:transform': 'translate(5pt 5pt)' }, [line]);
    const { vectors } = readDrawPageContent([group], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'line') {
      throw new Error('expected a line vector');
    }
    expect(vector.from).toEqual({ xPt: 5, yPt: 5 });
    expect(vector.to).toEqual({ xPt: 15, yPt: 5 });
  });
});

describe('readDrawPageContent: draw:path (svg:d) and draw:polygon/draw:polyline (draw:points)', () => {
  it('parses a real LibreOffice-written closed curve svg:d ("M0 4000h3000c1000 0 1000-4000-1000-4000z") into one line segment then one cubic segment, closed', () => {
    const path = el('draw:path', {
      'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '100pt', 'svg:height': '100pt',
      'svg:viewBox': '0 0 4000 4000',
      'svg:d': 'M0 4000h3000c1000 0 1000-4000-1000-4000z',
    });
    const { vectors } = readDrawPageContent([path], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    expect(vector.subpaths).toHaveLength(1);
    const subpath = vector.subpaths[0];
    // viewBox 4000x4000 -> frame 100x100pt: scale factor 0.025 on both axes.
    expect(subpath?.start).toEqual({ xPt: 0, yPt: 100 });
    expect(subpath?.closed).toBe(true);
    expect(subpath?.segments).toEqual([
      { kind: 'line', to: { xPt: 75, yPt: 100 } },
      { kind: 'cubic', control1: { xPt: 100, yPt: 100 }, control2: { xPt: 100, yPt: 0 }, to: { xPt: 50, yPt: 0 } },
    ]);
  });

  it('the SAME geometry from an OPEN source shape omits the closing z -- closed reads false', () => {
    const path = el('draw:path', {
      'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '100pt', 'svg:height': '100pt',
      'svg:viewBox': '0 0 4000 4000',
      'svg:d': 'M0 4000h3000c1000 0 1000-4000-1000-4000',
    });
    const { vectors } = readDrawPageContent([path], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    expect(vector.subpaths[0]?.closed).toBe(false);
  });

  it('parses a genuinely diagonal segment (svg:d "l" command, real LibreOffice output) as a line segment, not dropped or misread as horizontal/vertical', () => {
    const path = el('draw:path', {
      'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '48.37pt', 'svg:height': '46.58pt',
      'svg:viewBox': '0 0 4837 4658',
      'svg:d': 'M0 4658l3000-4500c1500-1000 3000 3000 500 4500z',
    });
    const { vectors } = readDrawPageContent([path], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    // viewBox 4837x4658 -> frame 48.37x46.58pt: scale factor exactly 0.01 on both axes.
    expect(vector.subpaths[0]?.segments[0]).toEqual({ kind: 'line', to: { xPt: 30, yPt: 1.58 } });
  });

  it('reads draw:polygon\'s own draw:points list (real LibreOffice output, comma/space-delimited "x,y" pairs -- a completely different grammar from svg:d) into a single CLOSED straight-line-only subpath', () => {
    const polygon = el('draw:polygon', {
      'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '40pt', 'svg:height': '30pt',
      'svg:viewBox': '0 0 4000 3000',
      'draw:points': '0,3000 2000,0 4000,3000 2000,1500',
    });
    const { vectors } = readDrawPageContent([polygon], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    expect(vector.subpaths[0]?.closed).toBe(true);
    expect(vector.subpaths[0]?.start).toEqual({ xPt: 0, yPt: 30 });
    expect(vector.subpaths[0]?.segments).toEqual([
      { kind: 'line', to: { xPt: 20, yPt: 0 } },
      { kind: 'line', to: { xPt: 40, yPt: 30 } },
      { kind: 'line', to: { xPt: 20, yPt: 15 } },
    ]);
  });

  it('reads draw:polyline\'s own draw:points identically, but OPEN', () => {
    const polyline = el('draw:polyline', {
      'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '40pt', 'svg:height': '30pt',
      'svg:viewBox': '0 0 4000 3000',
      'draw:points': '0,3000 2000,0',
    });
    const { vectors } = readDrawPageContent([polyline], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    expect(vector.subpaths[0]?.closed).toBe(false);
  });

  it('drops a path/polygon/polyline with no resolvable svg:viewBox -- there is no way to scale the raw numbers into the frame\'s own point space', () => {
    const path = el('draw:path', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt', 'svg:d': 'M0 0L10 10z' });
    expect(readDrawPageContent([path], { parts: {} }).vectors).toEqual([]);
  });
});

describe('readDrawPageContent: draw:custom-shape presets', () => {
  function customShape(name: string, type: string, extra: Record<string, string> = {}): XmlElement {
    return el('draw:custom-shape', { 'draw:name': name, 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '50pt', 'svg:height': '30pt', ...extra }, [
      el('draw:enhanced-geometry', { 'svg:viewBox': '0 0 21600 21600', 'draw:type': type }),
    ]);
  }

  it('recognises the "rectangle" preset -- maps to the rect variant using the shape\'s own frame, without evaluating draw:enhanced-path', () => {
    const { vectors } = readDrawPageContent([customShape('CustomRect1', 'rectangle')], { parts: {} });
    expect(vectors[0]).toMatchObject({ kind: 'rect', frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 30 } });
  });

  it('recognises the "round-rectangle" preset -- also approximates to the plain rect variant (no rounded-corner concept in ContentVectorSchema)', () => {
    const { vectors } = readDrawPageContent([customShape('CustomRoundRect1', 'round-rectangle')], { parts: {} });
    expect(vectors[0]).toMatchObject({ kind: 'rect' });
  });

  it('recognises the "ellipse" preset -- maps to the ellipse variant', () => {
    const { vectors } = readDrawPageContent([customShape('CustomEllipse1', 'ellipse')], { parts: {} });
    expect(vectors[0]).toMatchObject({ kind: 'ellipse' });
  });

  it('an UNRECOGNISED preset (e.g. "smiley", real LibreOffice basic-shapes-gallery type name) with real text content salvages as a text-only ContentShape, not a vector', () => {
    const shape = el('draw:custom-shape', { 'draw:name': 'CustomSmiley1', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '50pt', 'svg:height': '30pt' }, [
      el('text:p', {}, [txt('Hello')]),
      el('draw:enhanced-geometry', { 'svg:viewBox': '0 0 21600 21600', 'draw:type': 'smiley' }),
    ]);
    const { shapes, vectors } = readDrawPageContent([shape], { parts: {} });
    expect(vectors).toEqual([]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'Hello' }] });
  });

  it('an unrecognised preset with NO real text content is skipped entirely -- nothing worth preserving', () => {
    const { shapes, vectors } = readDrawPageContent([customShape('CustomSmiley1', 'smiley')], { parts: {} });
    expect(shapes).toEqual([]);
    expect(vectors).toEqual([]);
  });

  it('a custom-shape with NO draw:enhanced-geometry at all is treated the same as an unrecognised preset', () => {
    const shape = el('draw:custom-shape', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '50pt', 'svg:height': '30pt' });
    expect(readDrawPageContent([shape], { parts: {} }).vectors).toEqual([]);
  });
});

describe('readDrawPageContent: draw:z-index paint order', () => {
  it('sorts vectors by an EXPLICIT draw:z-index, overriding raw document order -- a shape written FIRST in the XML but with the HIGHEST z-index paints LAST (on top)', () => {
    // Three rects, distinguished by fill colour (ContentVectorSchema's rect variant carries no name field). Document order: red, green, blue. z-index order: green(0) < blue(1) < red(2).
    const styles = [
      graphicStyle('red', { 'draw:fill-color': '#ff0000' }),
      graphicStyle('green', { 'draw:fill-color': '#00ff00' }),
      graphicStyle('blue', { 'draw:fill-color': '#0000ff' }),
    ];
    const pkg: Package = { parts: { 'content.xml': contentPackage(styles) } };
    const rectRedFirstInDocument = el('draw:rect', { 'draw:style-name': 'red', 'draw:z-index': '2', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const rectGreenSecondInDocument = el('draw:rect', { 'draw:style-name': 'green', 'draw:z-index': '0', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const rectBlueThirdInDocument = el('draw:rect', { 'draw:style-name': 'blue', 'draw:z-index': '1', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { vectors } = readDrawPageContent([rectRedFirstInDocument, rectGreenSecondInDocument, rectBlueThirdInDocument], pkg);
    // Sorted by z-index ascending (bottom to top): green(0), blue(1), red(2) -- NOT document order (red, green, blue).
    expect(vectors.map((v) => (v.kind === 'rect' ? v.fill : undefined))).toEqual([
      { r: 0, g: 1, b: 0 },
      { r: 0, g: 0, b: 1 },
      { r: 1, g: 0, b: 0 },
    ]);
  });

  it('falls back to document-encounter order when draw:z-index is absent -- the REAL LibreOffice case (its own writer never emits draw:z-index; document order already IS paint order after any UI-side reordering)', () => {
    const rectA = el('draw:rect', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const ellipseB = el('draw:ellipse', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { vectors } = readDrawPageContent([rectA, ellipseB], { parts: {} });
    expect(vectors.map((v) => v.kind)).toEqual(['rect', 'ellipse']);
  });

  it('keeps shapes and vectors as two independently paint-ordered arrays, threading ONE monotonic document-index counter across a mixed shapes+vectors+group walk', () => {
    const frame = el('draw:frame', { 'draw:name': 'Frame1', 'draw:z-index': '5', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' }, [
      el('draw:text-box', {}, [el('text:p', {}, [txt('hi')])]),
    ]);
    const rect = el('draw:rect', { 'draw:z-index': '0', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const group = el('draw:g', {}, [rect]);
    const { shapes, vectors } = readDrawPageContent([frame, group], { parts: {} });
    expect(shapes).toHaveLength(1);
    expect(vectors).toHaveLength(1);
  });
});

describe('readDrawPageContent: group flattening for vector primitives', () => {
  it('applies an enclosing draw:g\'s own translate to a rect\'s frame, exactly like it already does for draw:frame', () => {
    const rect = el('draw:rect', { 'svg:x': '10pt', 'svg:y': '10pt', 'svg:width': '20pt', 'svg:height': '20pt' });
    const group = el('draw:g', { 'draw:transform': 'translate(5pt 5pt)' }, [rect]);
    const { vectors } = readDrawPageContent([group], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.frame.xPt).toBeCloseTo(15, 6);
    expect(vector.frame.yPt).toBeCloseTo(15, 6);
  });

  it('recurses through nested groups for vector primitives, mirroring walkDrawShapes\' own innermost-first composition', () => {
    const rect = el('draw:rect', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const inner = el('draw:g', { 'draw:transform': 'translate(10pt 0pt)' }, [rect]);
    const outer = el('draw:g', { 'draw:transform': 'translate(0pt 10pt)' }, [inner]);
    const { vectors } = readDrawPageContent([outer], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.frame.xPt).toBeCloseTo(10, 6);
    expect(vector.frame.yPt).toBeCloseTo(10, 6);
  });
});

describe('readDrawPageContent: unhandled node kinds', () => {
  it('ignores a non-element node (text/comment) without error', () => {
    const nodes: XmlNode[] = [{ type: 'text', value: 'stray text' }];
    expect(readDrawPageContent(nodes, { parts: {} })).toEqual({ shapes: [], vectors: [] });
  });

  it('ignores an element tag this reader has no vocabulary for (e.g. dr3d:scene, draw:connector) -- skipped entirely, not an error', () => {
    const scene = el('dr3d:scene', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    expect(readDrawPageContent([scene], { parts: {} })).toEqual({ shapes: [], vectors: [] });
  });

  it('produces an empty result for a genuinely empty page', () => {
    expect(readDrawPageContent([], vectorPackage())).toEqual({ shapes: [], vectors: [] });
  });
});

describe('readDrawPageContent: vector rotation via draw:transform -- reuses the SAME geometry machinery draw:frame already resolves rotation through', () => {
  it('reads a rotated draw:rect\'s own rotationDeg, not just its unrotated frame', () => {
    const rect = el('draw:rect', { 'svg:width': '200pt', 'svg:height': '60pt', 'draw:transform': 'rotate(1.5707963267948966) translate(100pt 100pt)' });
    const { vectors } = readDrawPageContent([rect], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.frame.xPt).toBeCloseTo(30, 6);
    expect(vector.frame.yPt).toBeCloseTo(-30, 6);
    expect(vector.rotationDeg).toBeCloseTo(-90, 6);
  });

  it('reads a rotated draw:ellipse\'s own rotationDeg', () => {
    const ellipse = el('draw:ellipse', { 'svg:width': '200pt', 'svg:height': '60pt', 'draw:transform': 'rotate(1.5707963267948966) translate(100pt 100pt)' });
    const { vectors } = readDrawPageContent([ellipse], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'ellipse') {
      throw new Error('expected an ellipse vector');
    }
    expect(vector.rotationDeg).toBeCloseTo(-90, 6);
  });

  it('reads a rotated draw:path\'s own rotationDeg alongside its normally-scaled subpaths', () => {
    const path = el('draw:path', {
      'svg:width': '100pt', 'svg:height': '100pt',
      'svg:viewBox': '0 0 4000 4000',
      'svg:d': 'M0 4000h3000c1000 0 1000-4000-1000-4000z',
      'draw:transform': 'rotate(1.5707963267948966) translate(100pt 100pt)',
    });
    const { vectors } = readDrawPageContent([path], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    expect(vector.rotationDeg).toBeCloseTo(-90, 6);
    expect(vector.subpaths).toHaveLength(1);
  });

  it('composes an enclosing draw:g\'s own rotation onto a vector primitive\'s rotationDeg, exactly like it already does for draw:frame', () => {
    const rect = el('draw:rect', { 'svg:x': '50pt', 'svg:y': '50pt', 'svg:width': '80pt', 'svg:height': '40pt' });
    const group = el('draw:g', { 'draw:transform': 'rotate(1.5707963267948966) translate(100pt 100pt)' }, [rect]);
    const { vectors } = readDrawPageContent([group], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.rotationDeg).toBeCloseTo(-90, 6);
  });

  it('leaves rotationDeg undefined for an unrotated vector, matching draw:frame\'s own convention', () => {
    const rect = el('draw:rect', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { vectors } = readDrawPageContent([rect], { parts: {} });
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.rotationDeg).toBeUndefined();
  });
});

describe('readDrawPageContent / walkDrawShapes: paintOrder stamping', () => {
  it('stamps the resolved zIndex onto each ContentVector, in addition to using it to sort the vectors array', () => {
    const rectA = el('draw:rect', { 'draw:z-index': '5', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const rectB = el('draw:rect', { 'draw:z-index': '1', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { vectors } = readDrawPageContent([rectA, rectB], { parts: {} });
    expect(vectors.map((v) => v.paintOrder)).toEqual([1, 5]);
  });

  it('stamps a document-encounter fallback index (not just undefined) when draw:z-index is absent', () => {
    const rectA = el('draw:rect', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const rectB = el('draw:rect', { 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { vectors } = readDrawPageContent([rectA, rectB], { parts: {} });
    expect(vectors.map((v) => v.paintOrder)).toEqual([0, 1]);
  });

  it('stamps ONE shared monotonic paintOrder across shapes AND vectors, so cross-array relative paint order is recoverable by comparing the stamped values directly', () => {
    const frame = el('draw:frame', { 'draw:z-index': '0', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' }, [
      el('draw:text-box', {}, [el('text:p', {}, [txt('hi')])]),
    ]);
    const rect = el('draw:rect', { 'draw:z-index': '1', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { shapes, vectors } = readDrawPageContent([frame, rect], { parts: {} });
    expect(shapes[0]?.paintOrder).toBe(0);
    expect(vectors[0]?.paintOrder).toBe(1);
  });

  it('walkDrawShapes (odp) stamps the identical paintOrder value onto each ContentShape it produces, without reordering its own output array', () => {
    const frameA = el('draw:frame', { 'draw:name': 'A', 'draw:z-index': '5', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const frameB = el('draw:frame', { 'draw:name': 'B', 'draw:z-index': '1', 'svg:x': '20pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const out: ContentShape[] = [];
    walkDrawShapes([frameA, frameB], [], { parts: {} }, out);
    // Document order is unchanged (A then B) -- only the stamped value reflects the real z-index.
    expect(out.map((s) => s.name)).toEqual(['A', 'B']);
    expect(out.map((s) => s.paintOrder)).toEqual([5, 1]);
  });

  it('walkDrawShapes threads its own indexState across a recursive draw:g walk, keeping the document-encounter fallback monotonic', () => {
    const frameA = el('draw:frame', { 'draw:name': 'A', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const frameB = el('draw:frame', { 'draw:name': 'B', 'svg:x': '20pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const group = el('draw:g', {}, [frameB]);
    const out: ContentShape[] = [];
    walkDrawShapes([frameA, group], [], { parts: {} }, out);
    expect(out.map((s) => s.paintOrder)).toEqual([0, 1]);
  });
});

describe('readDrawPageContent: svg:fill-rule (path vectors only -- rect/ellipse have no fillRule field at all)', () => {
  function pathWithProps(extra: Record<string, string> = {}, styleAttrs: Record<string, string> = {}): { path: XmlElement; pkg: Package } {
    const gr1 = graphicStyle('gr1', { 'draw:fill-color': '#ff0000', ...styleAttrs });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const path = el('draw:path', {
      'draw:style-name': 'gr1',
      'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '100pt', 'svg:height': '100pt',
      'svg:viewBox': '0 0 4000 4000',
      'svg:d': 'M0 4000h3000c1000 0 1000-4000-1000-4000z',
      ...extra,
    });
    return { path, pkg };
  }

  it('reads svg:fill-rule="evenodd" from the path\'s own graphic-family style', () => {
    const { path, pkg } = pathWithProps({}, { 'svg:fill-rule': 'evenodd' });
    const { vectors } = readDrawPageContent([path], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    expect(vector.fillRule).toBe('evenodd');
  });

  it('reads svg:fill-rule="nonzero" explicitly too, not just treating its absence as nonzero', () => {
    const { path, pkg } = pathWithProps({}, { 'svg:fill-rule': 'nonzero' });
    const { vectors } = readDrawPageContent([path], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    expect(vector.fillRule).toBe('nonzero');
  });

  it('leaves fillRule undefined when the style carries no svg:fill-rule at all -- defaults to nonzero downstream, but is not fabricated here', () => {
    const { path, pkg } = pathWithProps();
    const { vectors } = readDrawPageContent([path], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    expect(vector.fillRule).toBeUndefined();
  });

  // A genuine two-subpath "letter O" shape: an outer square and an inner square "hole", both wound in the SAME rotational direction (right, down, left, up from each one's own top-left corner). This is the real-world case svg:fill-rule actually distinguishes -- with two same-direction subpaths, 'nonzero' fills the inner square too (winding number 2 there, still != 0, so no hole at all), while 'evenodd' toggles at every boundary crossing and genuinely punches the hole (winding parity 0 inside the inner square). Both subpaths' own points are read back correctly regardless of fillRule -- this test's real assertion is that reading the attribute itself survives the full readDrawPageContent path, not just a synthetic single-loop svg:d.
  it('reads svg:fill-rule="evenodd" from a real two-subpath donut/letter-O path with a hole', () => {
    const gr1 = graphicStyle('gr1', { 'draw:fill-color': '#000000', 'svg:fill-rule': 'evenodd' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const path = el('draw:path', {
      'draw:style-name': 'gr1',
      'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '100pt', 'svg:height': '100pt',
      'svg:viewBox': '0 0 4000 4000',
      // Outer square (0,0)-(4000,4000), then inner square (1000,1000)-(3000,3000) -- both traced right/down/left/up, i.e. the identical winding direction.
      'svg:d': 'M0 0H4000V4000H0ZM1000 1000H3000V3000H1000Z',
    });
    const { vectors } = readDrawPageContent([path], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    expect(vector.fillRule).toBe('evenodd');
    expect(vector.subpaths).toHaveLength(2);
    expect(vector.subpaths[0]?.closed).toBe(true);
    expect(vector.subpaths[1]?.closed).toBe(true);
    // The inner subpath's own points survive intact (scaled from the shared 4000x4000 viewBox onto the 100pt x 100pt frame -- 1000/4000 * 100 = 25, 3000/4000 * 100 = 75).
    expect(vector.subpaths[1]?.start).toEqual({ xPt: 25, yPt: 25 });
  });
});

describe('readDrawPageContent: stroke style (solid/dashed) from draw:stroke', () => {
  it('maps draw:stroke="dash" onto ContentStrokeSchema\'s own "dashed" member', () => {
    const gr1 = graphicStyle('gr1', { 'svg:stroke-color': '#000000', 'svg:stroke-width': '1pt', 'draw:stroke': 'dash' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const rect = el('draw:rect', { 'draw:style-name': 'gr1', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { vectors } = readDrawPageContent([rect], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.stroke?.style).toBe('dashed');
  });

  it('maps an explicit draw:stroke="solid" onto ContentStrokeSchema\'s own "solid" member', () => {
    const gr1 = graphicStyle('gr1', { 'svg:stroke-color': '#000000', 'svg:stroke-width': '1pt', 'draw:stroke': 'solid' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const rect = el('draw:rect', { 'draw:style-name': 'gr1', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { vectors } = readDrawPageContent([rect], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.stroke?.style).toBe('solid');
  });

  it('leaves style undefined when draw:stroke is absent -- no fabricated default', () => {
    const gr1 = graphicStyle('gr1', { 'svg:stroke-color': '#000000', 'svg:stroke-width': '1pt' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const rect = el('draw:rect', { 'draw:style-name': 'gr1', 'svg:x': '0pt', 'svg:y': '0pt', 'svg:width': '10pt', 'svg:height': '10pt' });
    const { vectors } = readDrawPageContent([rect], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(vector.stroke?.style).toBeUndefined();
  });

  it('applies to draw:line strokes too, since readOdfFillAndStroke is shared -- not just rect/ellipse/path', () => {
    const gr1 = graphicStyle('gr1', { 'svg:stroke-color': '#000000', 'svg:stroke-width': '1pt', 'draw:stroke': 'dash' });
    const pkg: Package = { parts: { 'content.xml': contentPackage([gr1]) } };
    const line = el('draw:line', { 'draw:style-name': 'gr1', 'svg:x1': '0pt', 'svg:y1': '0pt', 'svg:x2': '10pt', 'svg:y2': '10pt' });
    const { vectors } = readDrawPageContent([line], pkg);
    const vector = vectors[0];
    if (vector?.kind !== 'line') {
      throw new Error('expected a line vector');
    }
    expect(vector.stroke.style).toBe('dashed');
  });
});
