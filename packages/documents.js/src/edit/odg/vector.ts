import type { Package, XmlElement, XmlNode } from "odf.js";
import {
  buildOdfSubpaths,
  formatOdfLength,
  parseLinePoints,
  parseOdfPathData,
  parseOdfViewBox,
  resolveOdfShapeGeometry,
} from "odf.js";
import type {
  Box,
  Color,
  ContentPathPoint,
  ContentStroke,
  ContentSubpath,
  ContentVector,
} from "document-schema.js";
import { attr } from "ooxml.js";
import { removeChild, setAttr } from "../../xml/edit";
import { el } from "../../xml/fragment";
import { applyOdfGeometry } from "../geometry";
import {
  buildGraphicStyle,
  readGraphicFill,
  readGraphicStroke,
  setGraphicFill,
  setGraphicStroke,
} from "./style";
import { buildSvgPathData, buildSvgViewBox } from "./svg-path";

// Live-view classes over odg's own vector-primitive elements -- draw:rect/draw:ellipse/draw:line/draw:path, the geometry a drawing carries that a presentation typically doesn't (see odf.js's own typed/draw/shapes.ts top-of-file note, which this module's builders are the write-side counterpart to).
//
// ROTATION: a rect/ellipse/path vector carries a genuine rotationDeg, exactly as a draw:frame does. ContentVectorSchema models one on all three variants, odf.js's own readDrawRectVector/readDrawEllipseVector/readDrawPathVector each resolve one through resolveOdfShapeGeometry (the identical function readDrawFrame uses), and this module writes one back through applyOdfGeometry (src/edit/geometry.ts) -- the same shared write-side inverse OdpShape's own rotationDeg setter uses, rather than a second, independently-derived rotation convention. Frame get/set consequently goes through resolveOdfShapeGeometry too, never a bare svg:x/y read: a rotated element carries draw:transform and NO svg:x/svg:y at all, so reading the box attributes directly would silently report a rotated vector as having no frame. draw:line is the exception on every count -- two endpoints rather than a box, no draw:transform in odf.js's own reader, and no rotationDeg field on ContentVectorSchema's 'line' variant to carry one.
//
// Every constructed vector element carries an empty <text:p/> child, matching real LibreOffice output for every vector-primitive kind (confirmed against odf.js's own typed/shared/path.ts and typed/odg/read.test.ts ground-truth fixtures, and this package's own test-support/odg.ts) even though odf.js's own reader never actually reads it back for any ContentVector variant -- it is schema-valid, harmless, and keeps a freshly written .odg indistinguishable in shape from a real LibreOffice-authored one.

function directTextP(): XmlElement {
  return el("text:p");
}

// ---------------------------------------------------------------------------------------------------------------
// draw:rect / draw:ellipse -- identical attribute shape (svg:x/y/width/height, see shapes.ts's own readDrawRectVector/readDrawEllipseVector, which share this exact geometry resolution), differing only in tag and hence ContentVector.kind. One live-view class serves both; `kind` reflects whichever tag the element actually carries.

export interface BoxVectorInit {
  readonly frame: Box;
  readonly fill?: Color;
  readonly stroke?: ContentStroke;
  readonly textFlowAnchored?: boolean;
}

export type OdgBoxVectorKind = "rect" | "ellipse";

function buildBoxVectorElement(
  pkg: Package,
  tag: "draw:rect" | "draw:ellipse",
  init: BoxVectorInit,
): XmlElement {
  const styleName = buildGraphicStyle(pkg, {
    fill: init.fill,
    stroke: init.stroke,
    textFlowAnchored: init.textFlowAnchored,
  });
  return el(
    tag,
    {
      "draw:style-name": styleName,
      "svg:x": formatOdfLength(init.frame.xPt),
      "svg:y": formatOdfLength(init.frame.yPt),
      "svg:width": formatOdfLength(init.frame.widthPt),
      "svg:height": formatOdfLength(init.frame.heightPt),
    },
    [directTextP()],
  );
}

export function buildRectElement(
  pkg: Package,
  init: BoxVectorInit,
): XmlElement {
  return buildBoxVectorElement(pkg, "draw:rect", init);
}

export function buildEllipseElement(
  pkg: Package,
  init: BoxVectorInit,
): XmlElement {
  return buildBoxVectorElement(pkg, "draw:ellipse", init);
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
      throw new Error(
        "this OdgBoxVector has been removed from its page and can no longer be used",
      );
    }
    return this.node;
  }

  get kind(): OdgBoxVectorKind {
    return this.live().tag === "draw:ellipse" ? "ellipse" : "rect";
  }

  get name(): string | undefined {
    return attr(this.live(), "draw:name");
  }

  get frame(): Box | undefined {
    return resolveOdfShapeGeometry(this.live())?.frame;
  }

  set frame(value: Box) {
    applyOdfGeometry(this.live(), value, this.rotationDeg);
  }

  get rotationDeg(): number | undefined {
    return resolveOdfShapeGeometry(this.live())?.rotationDeg;
  }

  set rotationDeg(value: number | undefined) {
    const currentFrame = this.frame;
    if (currentFrame === undefined) {
      throw new Error(
        "cannot set rotationDeg on a vector with no resolvable frame (missing svg:width/svg:height)",
      );
    }
    applyOdfGeometry(this.live(), currentFrame, value);
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
  readonly textFlowAnchored?: boolean;
}

export function buildLineElement(
  pkg: Package,
  init: LineVectorInit,
): XmlElement {
  const styleName = buildGraphicStyle(pkg, {
    stroke: init.stroke,
    textFlowAnchored: init.textFlowAnchored,
  });
  return el(
    "draw:line",
    {
      "draw:style-name": styleName,
      "svg:x1": formatOdfLength(init.from.xPt),
      "svg:y1": formatOdfLength(init.from.yPt),
      "svg:x2": formatOdfLength(init.to.xPt),
      "svg:y2": formatOdfLength(init.to.yPt),
    },
    [directTextP()],
  );
}

export class OdgLineVector {
  // A fixed discriminant, unlike OdgBoxVector's own tag-derived getter -- draw:line is the only element this class ever wraps.
  readonly kind = "line";

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
      throw new Error(
        "this OdgLineVector has been removed from its page and can no longer be used",
      );
    }
    return this.node;
  }

  get name(): string | undefined {
    return attr(this.live(), "draw:name");
  }

  get from(): ContentPathPoint | undefined {
    return parseLinePoints(this.live())?.from;
  }

  set from(value: ContentPathPoint) {
    const node = this.live();
    setAttr(node, "svg:x1", formatOdfLength(value.xPt));
    setAttr(node, "svg:y1", formatOdfLength(value.yPt));
  }

  get to(): ContentPathPoint | undefined {
    return parseLinePoints(this.live())?.to;
  }

  set to(value: ContentPathPoint) {
    const node = this.live();
    setAttr(node, "svg:x2", formatOdfLength(value.xPt));
    setAttr(node, "svg:y2", formatOdfLength(value.yPt));
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
  readonly textFlowAnchored?: boolean;
}

export function buildPathElement(
  pkg: Package,
  init: PathVectorInit,
): XmlElement {
  const styleName = buildGraphicStyle(pkg, {
    fill: init.fill,
    stroke: init.stroke,
    textFlowAnchored: init.textFlowAnchored,
  });
  return el(
    "draw:path",
    {
      "draw:style-name": styleName,
      "svg:x": formatOdfLength(init.frame.xPt),
      "svg:y": formatOdfLength(init.frame.yPt),
      "svg:width": formatOdfLength(init.frame.widthPt),
      "svg:height": formatOdfLength(init.frame.heightPt),
      "svg:viewBox": buildSvgViewBox(init.frame.widthPt, init.frame.heightPt),
      "svg:d": buildSvgPathData(init.subpaths),
    },
    [directTextP()],
  );
}

export class OdgPathVector {
  // A fixed discriminant, for the same reason OdgLineVector's is: draw:path is the only element this class ever wraps.
  readonly kind = "path";

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
      throw new Error(
        "this OdgPathVector has been removed from its page and can no longer be used",
      );
    }
    return this.node;
  }

  get name(): string | undefined {
    return attr(this.live(), "draw:name");
  }

  get frame(): Box | undefined {
    return resolveOdfShapeGeometry(this.live())?.frame;
  }

  set frame(value: Box) {
    applyOdfGeometry(this.live(), value, this.rotationDeg);
  }

  get rotationDeg(): number | undefined {
    return resolveOdfShapeGeometry(this.live())?.rotationDeg;
  }

  set rotationDeg(value: number | undefined) {
    const currentFrame = this.frame;
    if (currentFrame === undefined) {
      throw new Error(
        "cannot set rotationDeg on a vector with no resolvable frame (missing svg:width/svg:height)",
      );
    }
    applyOdfGeometry(this.live(), currentFrame, value);
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
    const viewBoxValue = attr(node, "svg:viewBox");
    const dValue = attr(node, "svg:d");
    const frame = resolveOdfShapeGeometry(node)?.frame;
    if (
      viewBoxValue === undefined ||
      dValue === undefined ||
      frame === undefined
    ) {
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

// ---------------------------------------------------------------------------------------------------------------
// The three classes above as one union, discriminated on `kind` -- the same four-member vocabulary ContentVectorSchema's own variants carry ('rect'/'ellipse'/'line'/'path'), so a caller holding an OdgVector narrows it exactly as it would narrow a ContentVector. OdgBoxVector's own kind is the one member resolved from the live element's tag rather than being fixed per class, since one class serves both draw:rect and draw:ellipse (see its own note above).

export type OdgVectorKind = OdgBoxVectorKind | "line" | "path";

export type OdgVector = OdgBoxVector | OdgLineVector | OdgPathVector;

// Wraps whichever vector-primitive element `node` actually is in its matching live-view class, or reports undefined for an element that is not a vector primitive at all (a draw:frame, most commonly -- draw:page mixes frames and vectors in one children list, since document order IS paint order for both). This is the read-side inverse of buildRectElement/buildEllipseElement/buildLineElement/buildPathElement above, and the single place tag-to-class dispatch lives: OdgPage.vectors (page.ts) is its caller.
export function wrapVectorElement(
  container: XmlNode[],
  node: XmlElement,
  pkg: Package,
): OdgVector | undefined {
  switch (node.tag) {
    case "draw:rect":
    case "draw:ellipse":
      return new OdgBoxVector(container, node, pkg);
    case "draw:line":
      return new OdgLineVector(container, node, pkg);
    case "draw:path":
      return new OdgPathVector(container, node, pkg);
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// One ContentVector -> its matching draw:* element, rotation included. The single dispatch point every ODF container that writes vector geometry goes through -- OdgPage.addVector (a drawing page), OdpSlide.addVector (a presentation's draw:page, structurally the same element), and OdtBody.appendVectors (a text document's flow) -- so a rect/ellipse/line/path is built exactly one way regardless of which document kind it lands in. draw:rect/draw:ellipse/draw:line/draw:path carry byte-for-byte the same attribute vocabulary in all three, which is precisely why odt and odp reuse this module rather than growing writers of their own.
//
// `textFlowAnchored` is the one genuine per-container difference: a page-level vector is positioned directly against its page and declares no anchor at all, while one living inside a text:p must say what its coordinates are measured against (see style.ts's own TEXT_FLOW_ANCHOR_ATTRS). text:anchor-type is the element-level half of that pair; the style carries the rest.

export interface VectorElementOptions {
  readonly textFlowAnchored?: boolean;
}

export function buildVectorElement(
  pkg: Package,
  vector: ContentVector,
  options?: VectorElementOptions,
): XmlElement {
  const textFlowAnchored = options?.textFlowAnchored;
  const element = buildUnanchoredVectorElement(pkg, vector, textFlowAnchored);
  if (textFlowAnchored === true) {
    setAttr(element, "text:anchor-type", "paragraph");
  }
  return element;
}

// buildVectorElement plus the append-and-wrap step every container-level caller then repeats: OdgPage.addVector and OdpSlide.addVector are each nothing but this against their own draw:page's children list. Dispatches to the matching live-view class straight off the ContentVector's own discriminant rather than re-deriving it from the built element's tag, so there is no impossible "not a vector after all" branch to narrow away.
export function appendVectorTo(
  container: XmlNode[],
  pkg: Package,
  vector: ContentVector,
  options?: VectorElementOptions,
): OdgVector {
  const element = buildVectorElement(pkg, vector, options);
  container.push(element);
  switch (vector.kind) {
    case "line":
      return new OdgLineVector(container, element, pkg);
    case "path":
      return new OdgPathVector(container, element, pkg);
    case "rect":
    case "ellipse":
      return new OdgBoxVector(container, element, pkg);
  }
}

function buildUnanchoredVectorElement(
  pkg: Package,
  vector: ContentVector,
  textFlowAnchored: boolean | undefined,
): XmlElement {
  // 'line' is the one variant ContentVectorSchema gives no rotationDeg at all (two endpoints already encode any orientation a line can have), so it needs no applyOdfGeometry pass and returns straight from its builder.
  if (vector.kind === "line") {
    return buildLineElement(pkg, {
      from: vector.from,
      to: vector.to,
      stroke: vector.stroke,
      textFlowAnchored,
    });
  }
  const element =
    vector.kind === "rect"
      ? buildRectElement(pkg, {
          frame: vector.frame,
          fill: vector.fill,
          stroke: vector.stroke,
          textFlowAnchored,
        })
      : vector.kind === "ellipse"
        ? buildEllipseElement(pkg, {
            frame: vector.frame,
            fill: vector.fill,
            stroke: vector.stroke,
            textFlowAnchored,
          })
        : buildPathElement(pkg, {
            frame: vector.frame,
            subpaths: vector.subpaths,
            fill: vector.fill,
            stroke: vector.stroke,
            textFlowAnchored,
          });
  if (vector.rotationDeg !== undefined) {
    // Rewrites the plain svg:x/svg:y the builder just wrote into the draw:transform form a rotated ODF shape actually uses -- ODF never carries both (see src/edit/geometry.ts's own applyOdfGeometry note).
    applyOdfGeometry(element, vector.frame, vector.rotationDeg);
  }
  return element;
}
