import { describe, expect, it } from 'vitest';
import type { ContentShape } from 'document-content-model';
import type { Package } from '../../model/package';
import type { XmlElement } from '../../model/node';
import { el, txt } from '../../xml/fragment';
import { bytesToBase64 } from '../../util/base64';
import { readDrawFrame, walkDrawShapes } from './shapes';

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

  it('flattens a text:list\'s own text:list-item > text:p paragraphs (list numbering membership is a documented, separate gap -- text is never dropped)', () => {
    const list = el('text:list', {}, [el('text:list-item', {}, [el('text:p', {}, [txt('item one')])]), el('text:list-item', {}, [el('text:p', {}, [txt('item two')])])]);
    const frame = el('draw:frame', box, [el('draw:text-box', {}, [list])]);
    const shape = readDrawFrame(frame, [], { parts: {} });
    expect(shape?.blocks.map((b) => (b.kind === 'paragraph' ? b.runs.map((r) => r.text).join('') : undefined))).toEqual(['item one', 'item two']);
  });

  it('reads a draw:image\'s referenced media part, sniffed and sized to the frame\'s own resolved box', () => {
    const pkg: Package = { parts: { 'Pictures/img1.png': { kind: 'binary', base64: tinyPngBase64() } } };
    const frame = el('draw:frame', box, [el('draw:image', { 'xlink:href': 'Pictures/img1.png' })]);
    const shape = readDrawFrame(frame, [], pkg);
    expect(shape?.blocks).toEqual([{ kind: 'image', format: 'png', base64: tinyPngBase64(), widthPt: 100, heightPt: 50 }]);
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
