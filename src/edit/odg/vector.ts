import type { Package, XmlElement, XmlNode } from 'odf.js';
import { buildOdfSubpaths, formatOdfLength, parseBox, parseLinePoints, parseOdfPathData, parseOdfViewBox } from 'odf.js';
import type { Box, Color, ContentPathPoint, ContentStroke, ContentSubpath } from 'document-schema.js';
import { attr } from 'ooxml.js';
import { removeChild, setAttr } from '../../xml/edit';
import { el } from '../../xml/fragment';
import { buildGraphicStyle, readGraphicFill, readGraphicStroke, setGraphicFill, setGraphicStroke } from './style';
import { buildSvgPathData, buildSvgViewBox } from './svg-path';

// Live-view classes over odg's own vector-primitive elements -- draw:rect/draw:ellipse/draw:line/draw:path, the geometry a drawing carries that a presentation typically doesn't (see odf.js's own typed/draw/shapes.ts top-of-file note, which this module's builders are the write-side counterpart to). Unlike OdpShape's draw:frame, NONE of these ever carry a draw:transform/rotation -- ContentVectorSchema's own rect/ellipse/path variants have no rotationDeg field at all (document-schema.js's content.ts; see shapes.ts's own resolveVectorFrame comment for why the reader discards it), so frame get/set here is always plain svg:x/y/width/height, never draw:transform.
//
// Every constructed vector element carries an empty <text:p/> child, matching real LibreOffice output for every vector-primitive kind (confirmed against odf.js's own typed/shared/path.ts and typed/odg/read.test.ts ground-truth fixtures, and this package's own test-support/odg.ts) even though odf.js's own reader never actually reads it back for any ContentVector variant -- it is schema-valid, harmless, and keeps a freshly written .odg indistinguishable in shape from a real LibreOffice-authored one.

function directTextP(): XmlElement {
  return el('text:p');
}

// ---------------------------------------------------------------------------------------------------------------
// draw:rect / draw:ellipse -- identical attribute shape (svg:x/y/width/height, see shapes.ts's own readDrawRectVector/readDrawEllipseVector, which share this exact geometry resolution), differing only in tag and hence ContentVector.kind. One live-view class serves both; `kind` reflects whichever tag the element actually carries.

export interface BoxVectorInit {
  readonly frame: Box;
  readonly fill?: Color;
  readonly stroke?: ContentStroke;
}

export type OdgBoxVectorKind = 'rect' | 'ellipse';

function buildBoxVectorElement(pkg: Package, tag: 'draw:rect' | 'draw:ellipse', init: BoxVectorInit): XmlElement {
  const styleName = buildGraphicStyle(pkg, { fill: init.fill, stroke: init.stroke });
  return el(
    tag,
    {
      'draw:style-name': styleName,
      'svg:x': formatOdfLength(init.frame.xPt),
      'svg:y': formatOdfLength(init.frame.yPt),
      'svg:width': formatOdfLength(init.frame.widthPt),
      'svg:height': formatOdfLength(init.frame.heightPt),
    },
    [directTextP()],
  );
}

export function buildRectElement(pkg: Package, init: BoxVectorInit): XmlElement {
  return buildBoxVectorElement(pkg, 'draw:rect', init);
}

export function buildEllipseElement(pkg: Package, init: BoxVectorInit): XmlElement {
  return buildBoxVectorElement(pkg, 'draw:ellipse', init);
}

export class OdgBoxVector {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly pkg: Package;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, pkg: Package) {
    this.container = container;
    this.node = node;
    this.pkg = pkg;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this OdgBoxVector has been removed from its page and can no longer be used');
    }
    return this.node;
  }

  get kind(): OdgBoxVectorKind {
    return this.live().tag === 'draw:ellipse' ? 'ellipse' : 'rect';
  }

  get name(): string | undefined {
    return attr(this.live(), 'draw:name');
  }

  get frame(): Box | undefined {
    return parseBox(this.live());
  }

  set frame(value: Box) {
    const node = this.live();
    setAttr(node, 'svg:x', formatOdfLength(value.xPt));
    setAttr(node, 'svg:y', formatOdfLength(value.yPt));
    setAttr(node, 'svg:width', formatOdfLength(value.widthPt));
    setAttr(node, 'svg:height', formatOdfLength(value.heightPt));
  }

  get fill(): Color | undefined {
    return readGraphicFill(this.pkg, this.live());
  }

  set fill(value: Color | undefined) {
    setGraphicFill(this.pkg, this.live(), value);
  }

  get stroke(): ContentStroke | undefined {
    return readGraphicStroke(this.pkg, this.live());
  }

  set stroke(value: ContentStroke | undefined) {
    setGraphicStroke(this.pkg, this.live(), value);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// draw:line -- carries no svg:x/y/width/height box at all, just two endpoints (svg:x1/y1/x2/y2, see shapes.ts's own readDrawLineVector / odf.js's own parseLinePoints). ContentVectorSchema's own 'line' variant REQUIRES a stroke (an invisible line paints nothing worth keeping), so stroke here is a mandatory init field and a mandatory setter argument, unlike the optional fill/stroke on the box/path variants.

export interface LineVectorInit {
  readonly from: ContentPathPoint;
  readonly to: ContentPathPoint;
  readonly stroke: ContentStroke;
}

export function buildLineElement(pkg: Package, init: LineVectorInit): XmlElement {
  const styleName = buildGraphicStyle(pkg, { stroke: init.stroke });
  return el(
    'draw:line',
    {
      'draw:style-name': styleName,
      'svg:x1': formatOdfLength(init.from.xPt),
      'svg:y1': formatOdfLength(init.from.yPt),
      'svg:x2': formatOdfLength(init.to.xPt),
      'svg:y2': formatOdfLength(init.to.yPt),
    },
    [directTextP()],
  );
}

export class OdgLineVector {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly pkg: Package;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, pkg: Package) {
    this.container = container;
    this.node = node;
    this.pkg = pkg;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this OdgLineVector has been removed from its page and can no longer be used');
    }
    return this.node;
  }

  get name(): string | undefined {
    return attr(this.live(), 'draw:name');
  }

  get from(): ContentPathPoint | undefined {
    return parseLinePoints(this.live())?.from;
  }

  set from(value: ContentPathPoint) {
    const node = this.live();
    setAttr(node, 'svg:x1', formatOdfLength(value.xPt));
    setAttr(node, 'svg:y1', formatOdfLength(value.yPt));
  }

  get to(): ContentPathPoint | undefined {
    return parseLinePoints(this.live())?.to;
  }

  set to(value: ContentPathPoint) {
    const node = this.live();
    setAttr(node, 'svg:x2', formatOdfLength(value.xPt));
    setAttr(node, 'svg:y2', formatOdfLength(value.yPt));
  }

  get stroke(): ContentStroke | undefined {
    return readGraphicStroke(this.pkg, this.live());
  }

  set stroke(value: ContentStroke) {
    setGraphicStroke(this.pkg, this.live(), value);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// draw:path -- svg:d (real curves) plus svg:viewBox (see svg-path.ts's own top-of-file note on why this writer always anchors viewBox at "0 0 {widthPt} {heightPt}"). frame's own setter deliberately touches ONLY svg:x/y/width/height, leaving svg:viewBox/svg:d untouched -- this is not an oversight but the correct ODF resize semantics: a real ODF consumer resizing a curved shape leaves its own viewBox/d alone and lets the box's width/height stretch it, exactly what buildOdfSubpaths' own scale factor (frame.widthPt/viewBox.width) already does on any later reparse. ContentVectorSchema's own 'path' variant has no fillRule field ODF populates (odf.js's own readDrawPathVector never sets one -- there is no established ODF attribute for it in this codebase's verified vocabulary), so this writer does not attempt to express one either.

export interface PathVectorInit {
  readonly frame: Box;
  readonly subpaths: readonly ContentSubpath[];
  readonly fill?: Color;
  readonly stroke?: ContentStroke;
}

export function buildPathElement(pkg: Package, init: PathVectorInit): XmlElement {
  const styleName = buildGraphicStyle(pkg, { fill: init.fill, stroke: init.stroke });
  return el(
    'draw:path',
    {
      'draw:style-name': styleName,
      'svg:x': formatOdfLength(init.frame.xPt),
      'svg:y': formatOdfLength(init.frame.yPt),
      'svg:width': formatOdfLength(init.frame.widthPt),
      'svg:height': formatOdfLength(init.frame.heightPt),
      'svg:viewBox': buildSvgViewBox(init.frame.widthPt, init.frame.heightPt),
      'svg:d': buildSvgPathData(init.subpaths),
    },
    [directTextP()],
  );
}

export class OdgPathVector {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly pkg: Package;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, pkg: Package) {
    this.container = container;
    this.node = node;
    this.pkg = pkg;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error('this OdgPathVector has been removed from its page and can no longer be used');
    }
    return this.node;
  }

  get name(): string | undefined {
    return attr(this.live(), 'draw:name');
  }

  get frame(): Box | undefined {
    return parseBox(this.live());
  }

  set frame(value: Box) {
    const node = this.live();
    setAttr(node, 'svg:x', formatOdfLength(value.xPt));
    setAttr(node, 'svg:y', formatOdfLength(value.yPt));
    setAttr(node, 'svg:width', formatOdfLength(value.widthPt));
    setAttr(node, 'svg:height', formatOdfLength(value.heightPt));
  }

  get fill(): Color | undefined {
    return readGraphicFill(this.pkg, this.live());
  }

  set fill(value: Color | undefined) {
    setGraphicFill(this.pkg, this.live(), value);
  }

  get stroke(): ContentStroke | undefined {
    return readGraphicStroke(this.pkg, this.live());
  }

  set stroke(value: ContentStroke | undefined) {
    setGraphicStroke(this.pkg, this.live(), value);
  }

  // Reparses svg:viewBox + svg:d through odf.js's OWN real parser (parseOdfViewBox / parseOdfPathData / buildOdfSubpaths, the exact same functions readDrawPathVector uses) every call, scaled against the CURRENT frame -- rather than caching whatever ContentSubpath[] the caller originally passed to addPath/PathVectorInit. This is both a genuinely live accessor (reflects a later `.frame =` resize, per this class's own frame-setter note) and the round-trip proof this module's own test suite leans on: every read of subpaths re-derives from the real written-and-reparsed XML, never from a cached JS value.
  get subpaths(): ContentSubpath[] {
    const node = this.live();
    const viewBoxValue = attr(node, 'svg:viewBox');
    const dValue = attr(node, 'svg:d');
    const frame = parseBox(node);
    if (viewBoxValue === undefined || dValue === undefined || frame === undefined) {
      return [];
    }
    const viewBox = parseOdfViewBox(viewBoxValue);
    if (viewBox === undefined) {
      return [];
    }
    return buildOdfSubpaths(parseOdfPathData(dValue), viewBox, frame);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}
