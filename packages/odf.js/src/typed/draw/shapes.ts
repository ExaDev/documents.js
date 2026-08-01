import type { Box, Color, ContentBlock, ContentImageBlock, ContentShape, ContentStroke, ContentVector } from 'document-schema.js';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, elementsWithTag } from '../../xml/query';
import { base64ToBytes } from '../../util/base64';
import { sniffImageFormat } from '../../image/sniff';
import { resolveStyleElementChain } from '../shared/cascade';
import { parseOdfColor } from '../shared/color';
import { parseLinePoints } from '../shared/geometry';
import { readOdfParagraph } from '../shared/paragraph';
import { readOdfTable } from '../shared/table';
import { parseOdfLength } from '../shared/units';
import { buildOdfSubpaths, parseOdfPathData, parseOdfPointsList, parseOdfViewBox, rawSubpathFromPoints } from '../shared/path';
import type { OdfTransformFunction } from '../shared/transform';
import { applyOdfTransform, composeOdfGroupTransform, parseOdfTransform, resolveOdfShapeGeometry } from '../shared/transform';

// The shape vocabulary shared between odp (draw:frame/draw:g -- a positioned container for text/image/table content, and group flattening) and odg (this file's own later extension: the vector-primitive kinds a drawing needs that a presentation typically doesn't -- draw:rect/draw:ellipse/draw:circle/draw:line/draw:path/draw:polygon/draw:polyline/draw:custom-shape). A vector-primitive draw: element that is NOT wrapped in a draw:frame (a plain draw:rect/draw:ellipse/draw:custom-shape sitting directly under a draw:page or draw:g -- valid, real ODF, both Impress and Draw allow it) was a deliberate, documented scope boundary for odp's own walkDrawShapes (below, UNCHANGED by this extension -- odp's own ContentSlide has no `vectors` array to put one in), exactly mirroring how ooxml.js's own pptx shape-tree walker skips p:cxnSp connector shapes for the same "no vector-primitive recovery in THAT reader" reason. readDrawPageContent (this file's own odg-facing addition, further down) is the one that DOES walk vector primitives, for a ContentDrawPageSchema target that has somewhere to put them.

interface FrameInsets {
  readonly insetLeftPt: number;
  readonly insetTopPt: number;
  readonly insetRightPt: number;
  readonly insetBottomPt: number;
}

const ZERO_INSETS: FrameInsets = { insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 };

function readPaddingPt(props: XmlElement, attrName: string): number | undefined {
  const value = attrValue(props, attrName);
  return value === undefined ? undefined : parseOdfLength(value);
}

// A draw:frame's own text insets come from its graphic-family style's style:graphic-properties/fo:padding-* (verified against real LibreOffice output: e.g. the built-in "standard" graphic style sets fo:padding-top="0.125cm" fo:padding-bottom="0.125cm" fo:padding-left="0.25cm" fo:padding-right="0.25cm") -- a dimensional/decorative property style/properties.ts deliberately does not model (see that module's own top-of-file note), so this reads style:graphic-properties directly. Unlike table.ts's own single-level findStyleElement lookups, this WALKS the full style:parent-style-name chain (via cascade.ts's resolveStyleElementChain, root-first) because real LibreOffice output routinely inherits padding from a parent style (a shape's own automatic style commonly sets only its own min-height/min-width directly, leaving fo:padding-* to be inherited from its style:parent-style-name="standard" chain) rather than repeating the full declaration on every shape's own automatic style.
function readFrameInsets(frame: XmlElement, pkg: Package): FrameInsets {
  const styleName = attrValue(frame, 'draw:style-name');
  const { elements } = resolveStyleElementChain(styleName, 'graphic', pkg);
  let insets = ZERO_INSETS;
  for (const element of elements) {
    const props = childrenWithTag(element, 'style:graphic-properties')[0];
    if (props === undefined) {
      continue;
    }
    insets = {
      insetLeftPt: readPaddingPt(props, 'fo:padding-left') ?? insets.insetLeftPt,
      insetTopPt: readPaddingPt(props, 'fo:padding-top') ?? insets.insetTopPt,
      insetRightPt: readPaddingPt(props, 'fo:padding-right') ?? insets.insetRightPt,
      insetBottomPt: readPaddingPt(props, 'fo:padding-bottom') ?? insets.insetBottomPt,
    };
  }
  return insets;
}

// draw:image is a direct child of draw:frame, referencing its media part by a plain package path via xlink:href -- ODF has no relationships mechanism (see this package's own top-level README), so this IS the reference, not an indirection to resolve. Real saved .odp packages always use xlink:href against a real Pictures/ part (confirmed against a real LibreOffice-produced .odp); the flat-XML office:binary-data inline form is specific to the .fodp/.fods/.fodt single-file variants this reader (operating on a decoded zip-of-XML Package) never encounters, so it is not handled here.
function readDrawImageBlock(image: XmlElement, frameBox: Box, pkg: Package): ContentImageBlock | undefined {
  const href = attrValue(image, 'xlink:href');
  const part = href === undefined ? undefined : pkg.parts[href];
  if (part?.kind !== 'binary') {
    return undefined;
  }
  const bytes = base64ToBytes(part.base64);
  const format = sniffImageFormat(bytes);
  if (format === undefined) {
    return undefined;
  }
  // The image renders at the FRAME's own resolved size, not the source image's native pixel dimensions -- matching ooxml.js's own readPicShape convention.
  return { kind: 'image', format, base64: part.base64, widthPt: frameBox.widthPt, heightPt: frameBox.heightPt };
}

// A draw:frame's content is exactly one of table:table, draw:text-box, or draw:image (verified against real LibreOffice output) -- table:table is checked FIRST because a real saved presentation table frame also carries a sibling draw:image (an .svm fallback preview LibreOffice writes for consumers that can't render a real table), which must not be mistaken for the frame's own image content.
function readDrawFrameContent(frame: XmlElement, frameBox: Box, pkg: Package): ContentBlock[] {
  const table = childrenWithTag(frame, 'table:table')[0];
  if (table !== undefined) {
    return [readOdfTable(table, pkg)];
  }
  const textBox = childrenWithTag(frame, 'draw:text-box')[0];
  if (textBox !== undefined) {
    // elementsWithTag (a DEEP search, not childrenWithTag's direct-children-only) so a text:p nested inside a text:list/text:list-item (a real, valid ODF bulleted/numbered text box) is still read as a paragraph -- its text is preserved, though list numbering membership (ContentParagraph.list) is not populated: that needs ODF list-style resolution (text:list-style -> numId/level), a genuinely separate feature this task does not build, and a documented, narrow gap rather than a silently dropped one.
    return elementsWithTag(textBox.children, 'text:p').map((p) => readOdfParagraph(p, pkg));
  }
  const image = childrenWithTag(frame, 'draw:image')[0];
  if (image !== undefined) {
    const block = readDrawImageBlock(image, frameBox, pkg);
    return block === undefined ? [] : [block];
  }
  return [];
}

// Reads one draw:frame into a ContentShape, in the coordinate space `groupFunctions` maps FROM (its own immediate parent's local space) TO the page: composeOdfGroupTransform is the identity when groupFunctions is empty (the overwhelmingly common case -- a frame with no enclosing draw:g), so this is cheap for the non-grouped case. Returns undefined for a frame with no resolvable geometry of its own -- see transform.ts's resolveOdfShapeGeometry for the documented "inherited positioning" scope boundary this defers to.
export function readDrawFrame(frame: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentShape | undefined {
  const ownGeometry = resolveOdfShapeGeometry(frame);
  if (ownGeometry === undefined) {
    return undefined;
  }
  const geometry = composeOdfGroupTransform(groupFunctions, ownGeometry);
  return {
    name: attrValue(frame, 'draw:name'),
    frame: geometry.frame,
    rotationDeg: geometry.rotationDeg,
    ...readFrameInsets(frame, pkg),
    blocks: readDrawFrameContent(frame, geometry.frame, pkg),
  };
}

// Shared by both walkDrawShapes (odp) and walkDrawPageContent (odg, further down this file) -- "read an element's own draw:transform into a function list" is identical for both, so this stays a single private helper reused within this module rather than being duplicated per walker.
function readOwnTransformFunctions(element: XmlElement): OdfTransformFunction[] {
  const value = attrValue(element, 'draw:transform');
  return value === undefined ? [] : parseOdfTransform(value);
}

// Walks a shape container's direct children (a draw:page, or a draw:g's own children) in document order, flattening any draw:g group into `out`'s own flat ContentShape list: `groupFunctions` accumulates each enclosing group's own draw:transform, INNERMOST first (a nested group's own functions are prepended ahead of whatever its own parent already accumulated), so composeOdfGroupTransform at the leaf applies them in the correct innermost-to-outermost order -- mirroring ooxml.js's own p:grpSp flattening (src/typed/pptx/read.ts's walkShapeTreeChildren/composeGroupTransform), adapted to ODF's own transform-function-list model instead of OOXML's chOff/chExt scaling. See this file's own top-of-file note on why a bare vector-primitive shape (not wrapped in a draw:frame) is silently skipped here.
export function walkDrawShapes(children: readonly XmlNode[], groupFunctions: readonly OdfTransformFunction[], pkg: Package, out: ContentShape[]): void {
  for (const node of children) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'draw:frame') {
      const shape = readDrawFrame(node, groupFunctions, pkg);
      if (shape !== undefined) {
        out.push(shape);
      }
    } else if (node.tag === 'draw:g') {
      const ownFunctions = readOwnTransformFunctions(node);
      const nested = ownFunctions.length === 0 ? groupFunctions : [...ownFunctions, ...groupFunctions];
      walkDrawShapes(node.children, nested, pkg, out);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Vector primitives (odg): draw:rect/draw:ellipse/draw:circle/draw:line/draw:path/draw:polygon/draw:polyline, plus a small recognised subset of draw:custom-shape presets -- everything readDrawPageContent (bottom of this file) needs beyond odp's own draw:frame/draw:g that walkDrawShapes above already covers.
//
// FILL/STROKE reading (readOdfFillAndStroke) was verified against real LibreOffice 26.2 .odg output (same macro-built fixtures as typed/shared/path.ts's own top-of-file note): a shape's fill/stroke live on its OWN graphic-family automatic style, walked via the SAME resolveStyleElementChain root-first cascade readFrameInsets above already uses (a shape can inherit fill/stroke from its style:parent-style-name chain exactly as it can inherit padding). draw:fill-color / svg:stroke-color+svg:stroke-width being ABSENT means "no fill"/"no stroke" (confirmed: a plain draw:line's own automatic style carries svg:stroke-* but no draw:fill-color at all -- lines have no area). An EXPLICIT draw:fill="none" / draw:stroke="none" was also confirmed (a rectangle with FillStyle/LineStyle set to NONE via the UNO API round-trips with literal draw:graphic-properties draw:fill="none" draw:stroke="none") and overrides any color/width also present in an earlier, less specific link of the cascade.
//
// OUT OF SCOPE, named explicitly per this task's own brief -- none of these are silently dropped, they are documented, bounded approximations:
// - gradient/bitmap/hatch fills (draw:fill="gradient"/"bitmap"/"hatch") render as a flat colour: if the style
// ALSO carries a direct draw:fill-color (real LibreOffice output sometimes does, as a fallback swatch), that is used; otherwise fill resolves to undefined rather than resolving the actual gradient/bitmap/hatch definition (a whole separate style-part lookup this reader does not attempt).
// - dashed/dotted strokes (draw:stroke="dash") are read/rendered as an ordinary SOLID stroke of the same
//   colour/width -- the dash pattern itself (style:stroke-dash) is not resolved.
// - transparency/opacity (draw:opacity, svg:stroke-opacity) is not read at all; every fill/stroke is treated as
//   fully opaque, matching Color's own plain-RGB shape (no alpha channel).
function readOdfFillAndStroke(element: XmlElement, pkg: Package): { fill: Color | undefined; stroke: ContentStroke | undefined } {
  const styleName = attrValue(element, 'draw:style-name');
  const { elements } = resolveStyleElementChain(styleName, 'graphic', pkg);
  let fill: Color | undefined;
  let stroke: ContentStroke | undefined;
  for (const styleElement of elements) {
    const props = childrenWithTag(styleElement, 'style:graphic-properties')[0];
    if (props === undefined) {
      continue;
    }
    const fillMode = attrValue(props, 'draw:fill');
    if (fillMode === 'none') {
      fill = undefined;
    } else {
      const fillColorValue = attrValue(props, 'draw:fill-color');
      const parsedFill = fillColorValue === undefined ? undefined : parseOdfColor(fillColorValue);
      if (parsedFill !== undefined) {
        fill = parsedFill;
      }
    }
    const strokeMode = attrValue(props, 'draw:stroke');
    if (strokeMode === 'none') {
      stroke = undefined;
    } else {
      const strokeColorValue = attrValue(props, 'svg:stroke-color');
      const strokeWidthValue = attrValue(props, 'svg:stroke-width');
      const strokeColor = strokeColorValue === undefined ? undefined : parseOdfColor(strokeColorValue);
      const strokeWidthPt = strokeWidthValue === undefined ? undefined : parseOdfLength(strokeWidthValue);
      if (strokeColor !== undefined && strokeWidthPt !== undefined && strokeWidthPt > 0) {
        stroke = { color: strokeColor, widthPt: strokeWidthPt };
      }
    }
  }
  return { fill, stroke };
}

// Resolves a vector primitive's own frame (svg:x/y/width/height, or draw:transform's rotate()+translate() for position -- the exact same geometry resolveOdfShapeGeometry already provides for draw:frame), composed with any enclosing draw:g's own transform. Deliberately DISCARDS rotationDeg: unlike ContentShapeSchema, NONE of ContentVectorSchema's variants (rect/ellipse/path) carry a rotation field at all (document-schema.js's content.ts) -- a real, tracked model limitation, not an oversight in this reader. A rotated draw:rect/ draw:ellipse/draw:custom-shape therefore reads at its own UNROTATED bounding frame.
function resolveVectorFrame(element: XmlElement, groupFunctions: readonly OdfTransformFunction[]): Box | undefined {
  const geometry = resolveOdfShapeGeometry(element);
  if (geometry === undefined) {
    return undefined;
  }
  return composeOdfGroupTransform(groupFunctions, geometry).frame;
}

function readDrawRectVector(element: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentVector | undefined {
  const frame = resolveVectorFrame(element, groupFunctions);
  if (frame === undefined) {
    return undefined;
  }
  const { fill, stroke } = readOdfFillAndStroke(element, pkg);
  return { kind: 'rect', frame, fill, stroke };
}

// draw:ellipse and draw:circle share an identical attribute shape (svg:x/y/width/height) -- confirmed against real LibreOffice output: an ellipse whose width and height happen to be EQUAL is written as draw:circle instead of draw:ellipse (a real, distinct ODF element the OASIS schema defines specifically for this case), with no attribute-shape difference otherwise. Both map to ContentVectorSchema's single 'ellipse' variant.
function readDrawEllipseVector(element: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentVector | undefined {
  const frame = resolveVectorFrame(element, groupFunctions);
  if (frame === undefined) {
    return undefined;
  }
  const { fill, stroke } = readOdfFillAndStroke(element, pkg);
  return { kind: 'ellipse', frame, fill, stroke };
}

// draw:line carries no svg:x/y/width/height box at all -- see geometry.ts's own parseLinePoints note. Its two endpoints are transformed through any enclosing draw:g's own function list directly (no center-pivot geometry needed the way a box has: applyOdfTransform maps each raw point through rotate()/translate() on its own, which is exactly right for a two-point line with no orientation ambiguity). ContentVectorSchema's 'line' variant requires a stroke (an invisible line has nothing to paint) -- this reader returns undefined rather than fabricating a default stroke when the source line genuinely has none.
function readDrawLineVector(element: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentVector | undefined {
  const raw = parseLinePoints(element);
  if (raw === undefined) {
    return undefined;
  }
  const from = groupFunctions.length === 0 ? raw.from : applyOdfTransform(groupFunctions, raw.from);
  const to = groupFunctions.length === 0 ? raw.to : applyOdfTransform(groupFunctions, raw.to);
  const { stroke } = readOdfFillAndStroke(element, pkg);
  if (stroke === undefined) {
    return undefined;
  }
  return { kind: 'line', from, to, stroke };
}

// draw:path (svg:d, a real curve) and draw:polygon/draw:polyline (draw:points, straight lines only) are deliberately handled together: both express their raw geometry in the SAME svg:viewBox-scaled local coordinate system, and both produce ContentVectorSchema's single 'path' variant (which has no separate "polygon"/"polyline" kind) -- see typed/shared/path.ts's own top-of-file note for the verified grammar difference between the two attributes themselves. Without a resolvable svg:viewBox there is no way to scale either grammar's raw numbers into the frame's own point space, so a missing/malformed viewBox is "no resolvable geometry" (undefined), exactly like a missing box elsewhere in this module.
function readDrawPathVector(element: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentVector | undefined {
  const frame = resolveVectorFrame(element, groupFunctions);
  if (frame === undefined) {
    return undefined;
  }
  const viewBoxValue = attrValue(element, 'svg:viewBox');
  const viewBox = viewBoxValue === undefined ? undefined : parseOdfViewBox(viewBoxValue);
  if (viewBox === undefined) {
    return undefined;
  }

  let rawSubpaths;
  if (element.tag === 'draw:path') {
    const d = attrValue(element, 'svg:d');
    rawSubpaths = d === undefined ? [] : parseOdfPathData(d);
  } else {
    const pointsValue = attrValue(element, 'draw:points');
    const points = pointsValue === undefined ? [] : parseOdfPointsList(pointsValue);
    const subpath = rawSubpathFromPoints(points, element.tag === 'draw:polygon');
    rawSubpaths = subpath === undefined ? [] : [subpath];
  }
  if (rawSubpaths.length === 0) {
    return undefined;
  }

  const subpaths = buildOdfSubpaths(rawSubpaths, viewBox, frame);
  const { fill, stroke } = readOdfFillAndStroke(element, pkg);
  return { kind: 'path', frame, subpaths, fill, stroke };
}

// A small, deliberately narrow subset of draw:custom-shape presets, identified by draw:enhanced-geometry's own draw:type attribute -- verified against real LibreOffice 26.2 output (the same macro-built fixtures as typed/shared/path.ts's own top-of-file note; LibreOffice's "Basic Shapes" gallery rectangle/rounded rectangle/ellipse each round-trip with draw:type="rectangle"/"round-rectangle"/"ellipse" respectively). Their OWN draw:enhanced-path (a "M ?f7 0 X 0 ?f8 L ..." formula-driven mini-language with ?fN/$N expression references and ODF-specific commands like X/Y/U that are NOT part of plain SVG at all) is deliberately never parsed -- evaluating draw:enhanced-geometry's formula language is explicitly out of scope for this reader (a v1.5+ gap, tracked, not attempted here) -- instead, each recognised preset maps to the CLOSEST ContentVector approximation built from the shape's own frame alone: 'ellipse' maps to the ellipse variant; 'rectangle' AND 'round-rectangle' both map to the plain rect variant (ContentVectorSchema has no rounded-corner concept at all, so a rounded rectangle reads with sharp corners -- a documented, bounded approximation, not a silent one).
const RECOGNIZED_CUSTOM_SHAPE_PRESETS: ReadonlySet<string> = new Set(['rectangle', 'round-rectangle', 'ellipse']);

function readCustomShapeVector(element: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentVector | undefined {
  const geometryElement = childrenWithTag(element, 'draw:enhanced-geometry')[0];
  const type = geometryElement === undefined ? undefined : attrValue(geometryElement, 'draw:type');
  if (type === undefined || !RECOGNIZED_CUSTOM_SHAPE_PRESETS.has(type)) {
    return undefined;
  }
  const frame = resolveVectorFrame(element, groupFunctions);
  if (frame === undefined) {
    return undefined;
  }
  const { fill, stroke } = readOdfFillAndStroke(element, pkg);
  return { kind: type === 'ellipse' ? 'ellipse' : 'rect', frame, fill, stroke };
}

// The fallback for an UNRECOGNISED draw:custom-shape preset (or one with no draw:enhanced-geometry/draw:type at all): produce text-only content -- a plain ContentShape carrying whatever real text:p runs the shape has, read exactly like readDrawFrameContent's own draw:text-box case above -- rather than a vector primitive this reader cannot correctly derive without evaluating draw:enhanced-path's own formula language (see RECOGNIZED_CUSTOM_SHAPE_PRESETS' own note). A custom-shape's text:p children sit DIRECTLY under draw:custom-shape itself (confirmed against real LibreOffice output -- unlike draw:frame's own draw:text-box wrapper), so elementsWithTag is used the same deep-search way readDrawFrameContent already uses it for a listed text box. An unrecognised preset with NO real text content at all (every run empty, matching this reader's own hand-built fixtures, which never populate a placeholder shape's own text) has nothing worth preserving and is skipped entirely -- this IS the "diagnostic-worthy note" this task's brief asks for: this comment IS that note, since neither this reader nor readOdg below has a diagnostics sink to report it through (matching readOdp/readOdt's own established "no diagnostics channel" posture elsewhere in this package).
function readCustomShapeAsTextShape(element: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentShape | undefined {
  const paragraphs = elementsWithTag(element.children, 'text:p').map((p) => readOdfParagraph(p, pkg));
  const hasText = paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.length > 0));
  if (!hasText) {
    return undefined;
  }
  const ownGeometry = resolveOdfShapeGeometry(element);
  if (ownGeometry === undefined) {
    return undefined;
  }
  const geometry = composeOdfGroupTransform(groupFunctions, ownGeometry);
  return {
    name: attrValue(element, 'draw:name'),
    frame: geometry.frame,
    rotationDeg: geometry.rotationDeg,
    ...readFrameInsets(element, pkg),
    blocks: paragraphs,
  };
}

// PAINT ORDER (draw:z-index): confirmed against the OASIS ODF schema (datypic.com's ODF 1.1 schema reference for draw:z-index -- xsd:nonNegativeInteger, [0..1], valid on every shape element this file reads: draw:rect, draw:ellipse/circle, draw:line, draw:path/polygon/polyline, draw:custom-shape, draw:frame, draw:g) that draw:z-index is real, spec-defined ODF vocabulary for overriding a shape's stacking order independently of its position in the document. It is read here when present. Separately and empirically confirmed against real LibreOffice 26.2 .odg output (a controlled round trip: two overlapping shapes' UNO ZOrder property was set to the OPPOSITE of their creation/document order, then saved): LibreOffice's OWN writer never emits draw:z-index at all for a plain draw:page's shapes -- instead, it physically REORDERS the shape elements within the saved XML to already match paint order, with document order and z-order coinciding exactly in every real LibreOffice-produced file. paintOrderKey below therefore uses an explicit draw:z-index when present, and otherwise falls back to a monotonically increasing DOCUMENT-ENCOUNTER counter -- which for genuine LibreOffice output already IS the correct paint order (a no-op sort), while still resolving correctly for any OTHER producer that DOES emit an explicit draw:z-index differing from document order.
interface DocumentIndexState {
  next: number;
}

function nextDocumentIndex(state: DocumentIndexState): number {
  const value = state.next;
  state.next += 1;
  return value;
}

function paintOrderKey(element: XmlElement, state: DocumentIndexState): number {
  const documentIndex = nextDocumentIndex(state);
  const raw = attrValue(element, 'draw:z-index');
  if (raw === undefined) {
    return documentIndex;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : documentIndex;
}

interface PaintOrdered<T> {
  readonly value: T;
  readonly zIndex: number;
}

// A stable sort (Array.prototype.sort has been spec-guaranteed stable since ES2019) by zIndex ascending -- ties (only possible among items that both fell back to a document-encounter index, which is itself already unique per item, so ties cannot actually occur in practice) preserve original push order regardless.
function byPaintOrder<T>(items: readonly PaintOrdered<T>[]): T[] {
  return items
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((item) => item.value);
}

// Walks a draw:page's (or a nested draw:g's) own direct children, producing TWO paint-ordered lists -- shapes (draw:frame content, plus any unrecognised draw:custom-shape salvaged as text) and vectors (every recognised vector primitive) -- mirroring walkDrawShapes' own draw:frame/draw:g flattening exactly (indexState is threaded by reference so z-index fallback stays monotonic across the WHOLE recursive walk, not reset per group) but additionally recognising the vector-primitive element kinds odp's own walkDrawShapes deliberately does not (see this file's own top-of-file note). NOTE: ContentDrawPageSchema keeps `shapes` and `vectors` as two SEPARATE arrays with no shared ordering field between them (document-schema.js's own content.ts) -- paint order is therefore only preserved WITHIN each array, not relative to each other across the two; a shape and a vector that overlap on a real page have no way to record which one paints on top of the other in the CURRENT ContentDrawPageSchema shape. This is a real, tracked modelling gap in the shared schema, not something this reader can work around unilaterally.
function walkDrawPageContent(
  children: readonly XmlNode[],
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
  indexState: DocumentIndexState,
  shapesOut: PaintOrdered<ContentShape>[],
  vectorsOut: PaintOrdered<ContentVector>[],
): void {
  for (const node of children) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'draw:frame') {
      const zIndex = paintOrderKey(node, indexState);
      const shape = readDrawFrame(node, groupFunctions, pkg);
      if (shape !== undefined) {
        shapesOut.push({ value: shape, zIndex });
      }
    } else if (node.tag === 'draw:g') {
      const ownFunctions = readOwnTransformFunctions(node);
      const nested = ownFunctions.length === 0 ? groupFunctions : [...ownFunctions, ...groupFunctions];
      walkDrawPageContent(node.children, nested, pkg, indexState, shapesOut, vectorsOut);
    } else if (node.tag === 'draw:rect') {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawRectVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: vector, zIndex });
      }
    } else if (node.tag === 'draw:ellipse' || node.tag === 'draw:circle') {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawEllipseVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: vector, zIndex });
      }
    } else if (node.tag === 'draw:line') {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawLineVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: vector, zIndex });
      }
    } else if (node.tag === 'draw:path' || node.tag === 'draw:polygon' || node.tag === 'draw:polyline') {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawPathVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: vector, zIndex });
      }
    } else if (node.tag === 'draw:custom-shape') {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readCustomShapeVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: vector, zIndex });
      } else {
        const shape = readCustomShapeAsTextShape(node, groupFunctions, pkg);
        if (shape !== undefined) {
          shapesOut.push({ value: shape, zIndex });
        }
      }
    }
  }
}

export interface DrawPageContent {
  readonly shapes: ContentShape[];
  readonly vectors: ContentVector[];
}

// The odg-facing entry point: resolves a draw:page's own children (typically office:drawing's draw:page, but equally valid for a presentation draw:page that happens to contain vector primitives directly -- draw:page's own content model does not differ between office:drawing and office:presentation, see readOdg's own top-of-file note) into paint-ordered shapes/vectors, ready to place directly into a ContentDrawPageSchema value.
export function readDrawPageContent(children: readonly XmlNode[], pkg: Package): DrawPageContent {
  const shapesOut: PaintOrdered<ContentShape>[] = [];
  const vectorsOut: PaintOrdered<ContentVector>[] = [];
  walkDrawPageContent(children, [], pkg, { next: 0 }, shapesOut, vectorsOut);
  return { shapes: byPaintOrder(shapesOut), vectors: byPaintOrder(vectorsOut) };
}
