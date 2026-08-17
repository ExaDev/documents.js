import type { Box, Color, ContentBlock, ContentImageBlock, ContentShape, ContentStroke, ContentStrokeStyle, ContentVector } from 'document-schema.js';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, elementsWithTag } from '../../xml/query';
import { base64ToBytes } from '../../util/base64';
import { sniffImageFormat } from '../../image/sniff';
import { resolveStyleElementChain } from '../shared/cascade';
import { parseOdfColor } from '../shared/color';
import { parseLinePoints } from '../shared/geometry';
import { decodeOdfText } from '../shared/text';
import { mintOdfListNumId, readOdfListParagraphs, type OdfListIdState } from '../shared/list';
import { readOdfParagraph } from '../shared/paragraph';
import { readOdfTable } from '../shared/table';
import { parseOdfLength } from '../shared/units';
import { buildOdfSubpaths, parseOdfPathData, parseOdfPointsList, parseOdfViewBox, rawSubpathFromPoints } from '../shared/path';
import type { OdfShapeGeometry, OdfTransformFunction } from '../shared/transform';
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

// A draw:frame's own alternative text: svg:title (ODF's short title) preferred, svg:desc (its long description) used when a frame carries only the latter -- both are plain-text DIRECT CHILD ELEMENTS of draw:frame itself, not attributes, confirmed against real LibreOffice 26.2 output (a Calc image whose UNO Title/Description properties were both set round-trips as `<svg:title>...</svg:title><svg:desc>...</svg:desc>` siblings of the frame's own draw:image). ContentImageBlockSchema models exactly one altText string, so the two are collapsed with title first: LibreOffice's own HTML export writes svg:title into `alt=`, making it the closer match, and a frame carrying only a description still has genuine alternative text worth surfacing rather than dropping. Decoded via text.ts's own decodeOdfText (not a bare text-node concatenation) for the same reason every other ODF text getter in this package uses it -- a title/description containing a run of literal spaces or a tab is stored as text:s/text:tab elements.
function readFrameAltText(frame: XmlElement): string | undefined {
  const title = childrenWithTag(frame, 'svg:title')[0];
  const decodedTitle = title === undefined ? undefined : decodeOdfText(title);
  if (decodedTitle !== undefined && decodedTitle.length > 0) {
    return decodedTitle;
  }
  const description = childrenWithTag(frame, 'svg:desc')[0];
  const decodedDescription = description === undefined ? undefined : decodeOdfText(description);
  return decodedDescription !== undefined && decodedDescription.length > 0 ? decodedDescription : undefined;
}

// draw:image is a direct child of draw:frame, referencing its media part by a plain package path via xlink:href -- ODF has no relationships mechanism (see this package's own top-level README), so this IS the reference, not an indirection to resolve. Real saved .odp packages always use xlink:href against a real Pictures/ part (confirmed against a real LibreOffice-produced .odp); the flat-XML office:binary-data inline form is specific to the .fodp/.fods/.fodt single-file variants this reader (operating on a decoded zip-of-XML Package) never encounters, so it is not handled here. The frame is passed alongside its own draw:image purely for alt text, which lives on the FRAME (see readFrameAltText above), never on the image element.
export function readDrawImageBlock(image: XmlElement, frame: XmlElement, frameBox: Box, pkg: Package): ContentImageBlock | undefined {
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
  const block: ContentImageBlock = { kind: 'image', format, base64: part.base64, widthPt: frameBox.widthPt, heightPt: frameBox.heightPt };
  const altText = readFrameAltText(frame);
  if (altText !== undefined) {
    block.altText = altText;
  }
  return block;
}

// A draw:frame's content is exactly one of table:table, draw:text-box, or draw:image (verified against real LibreOffice output) -- table:table is checked FIRST because a real saved presentation table frame also carries a sibling draw:image (an .svm fallback preview LibreOffice writes for consumers that can't render a real table), which must not be mistaken for the frame's own image content.
//
// ODP LIST MEMBERSHIP -- minted numId, not the numId-less { level } shape: document-schema.js 3.3.0 made ContentListMembership.numId optional precisely so a reader whose source carries NO list identity could emit the honest minimal { level } (ooxml.js's pptx reader, whose a:pPr/@lvl is a bare depth attribute on the paragraph with no list element behind it -- a fabricated numId there would be a lie in the data). A slide text box is not that case: draw:text-box's own content model is exactly (text:p | text:list)*, and its text:list elements are the IDENTICAL structural containers the odt reader walks in office:text -- a slide can carry two of them (two bullet bodies in one text box, or one list in each of two frames), and a consumer grouping list paragraphs apart (rendering separate <ul>/<ol> elements, nesting an outline per list) must be able to tell them apart. The deciding criterion is exactly that: whether the source carries genuine list identity a consumer needs for grouping separate lists apart. ODP's text:list elements pass it, so this reader mints a per-encounter numId through the SAME shared machinery (typed/shared/list.ts: mintOdfListNumId/readOdfListParagraphs, including the ordered:/bullet: kind prefix) the odt reader uses -- emitting { level } alone would discard a real, source-grounded fact, not avoid a fabrication.
function readDrawFrameContent(frame: XmlElement, frameBox: Box, pkg: Package, listIdState: OdfListIdState): ContentBlock[] {
  const table = childrenWithTag(frame, 'table:table')[0];
  if (table !== undefined) {
    return [readOdfTable(table, pkg)];
  }
  const textBox = childrenWithTag(frame, 'draw:text-box')[0];
  if (textBox !== undefined) {
    // A direct-children walk (not the deep elementsWithTag search this branch used before list membership existed) covers draw:text-box's whole (text:p | text:list)* content model: a text:p reads as a plain paragraph with NO list membership, and a text:list reads through the shared walker, which attaches numId/level membership to every paragraph it finds at its actual text:list-in-text:list-item nesting depth -- document order across both child kinds is preserved, matching the flattened order the old deep search produced.
    const blocks: ContentBlock[] = [];
    for (const child of textBox.children) {
      if (child.type !== 'element') {
        continue;
      }
      if (child.tag === 'text:p') {
        blocks.push(readOdfParagraph(child, pkg));
      } else if (child.tag === 'text:list') {
        const numId = mintOdfListNumId(pkg, child, listIdState);
        blocks.push(...readOdfListParagraphs(child, { numId, level: 0 }, (element) => readOdfParagraph(element, pkg)));
      }
    }
    return blocks;
  }
  const image = childrenWithTag(frame, 'draw:image')[0];
  if (image !== undefined) {
    const block = readDrawImageBlock(image, frame, frameBox, pkg);
    return block === undefined ? [] : [block];
  }
  return [];
}

// Reads one draw:frame into a ContentShape, in the coordinate space `groupFunctions` maps FROM (its own immediate parent's local space) TO the page: composeOdfGroupTransform is the identity when groupFunctions is empty (the overwhelmingly common case -- a frame with no enclosing draw:g), so this is cheap for the non-grouped case. Returns undefined for a frame with no resolvable geometry of its own -- see transform.ts's resolveOdfShapeGeometry for the documented "inherited positioning" scope boundary this defers to. `listIdState` mints a text-box list's numId identity (see readDrawFrameContent's own ODP LIST MEMBERSHIP note) and defaults to a fresh counter so every pre-existing call site (ods's anchored-drawing reader, this file's own tests) keeps working unchanged -- a caller walking a WHOLE presentation (odp) threads one document-wide state so identities stay unique across every slide.
export function readDrawFrame(frame: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package, listIdState: OdfListIdState = { next: 1 }): ContentShape | undefined {
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
    blocks: readDrawFrameContent(frame, geometry.frame, pkg, listIdState),
  };
}

// Shared by both walkDrawShapes (odp) and walkDrawPageContent (odg, further down this file) -- "read an element's own draw:transform into a function list" is identical for both, so this stays a single private helper reused within this module rather than being duplicated per walker.
function readOwnTransformFunctions(element: XmlElement): OdfTransformFunction[] {
  const value = attrValue(element, 'draw:transform');
  return value === undefined ? [] : parseOdfTransform(value);
}

// Walks a shape container's direct children (a draw:page, or a draw:g's own children) in document order, flattening any draw:g group into `out`'s own flat ContentShape list: `groupFunctions` accumulates each enclosing group's own draw:transform, INNERMOST first (a nested group's own functions are prepended ahead of whatever its own parent already accumulated), so composeOdfGroupTransform at the leaf applies them in the correct innermost-to-outermost order -- mirroring ooxml.js's own p:grpSp flattening (src/typed/pptx/read.ts's walkShapeTreeChildren/composeGroupTransform), adapted to ODF's own transform-function-list model instead of OOXML's chOff/chExt scaling. See this file's own top-of-file note on why a bare vector-primitive shape (not wrapped in a draw:frame) is silently skipped here.
//
// `indexState` reuses the EXACT SAME paintOrderKey/DocumentIndexState machinery walkDrawPageContent (odg, further down this file) uses -- ContentShapeSchema carries the identical optional `paintOrder` field ContentSlideSchema's own shapes already declare, so a presentation shape gets the same real, spec-aware (draw:z-index-honouring, falling back to document-encounter order) paint-order value an odg drawing's shapes get, even though odp's own output array is never reordered by it (matching this walker's own pre-existing document-order-only behaviour -- only the STAMPED VALUE is new, not a new sort). Defaults to a fresh counter so every existing external call site (a single top-level call per slide, with no indexState argument) keeps working unchanged; recursion into a nested draw:g threads the SAME state onward so the counter stays monotonic across the whole slide, matching walkDrawPageContent's own threading discipline exactly.
//
// `listIdState` threads the text-box list numId counter (see readDrawFrameContent's own ODP LIST MEMBERSHIP note) through every frame of the walk, with the same fresh-counter default and the same recursive threading discipline as indexState -- odp passes one document-wide state (see readOdp) so a list's identity is unique across the whole presentation, never reset per slide or per group.
export function walkDrawShapes(children: readonly XmlNode[], groupFunctions: readonly OdfTransformFunction[], pkg: Package, out: ContentShape[], indexState: DocumentIndexState = { next: 0 }, listIdState: OdfListIdState = { next: 1 }): void {
  for (const node of children) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'draw:frame') {
      const zIndex = paintOrderKey(node, indexState);
      const shape = readDrawFrame(node, groupFunctions, pkg, listIdState);
      if (shape !== undefined) {
        out.push({ ...shape, paintOrder: zIndex });
      }
    } else if (node.tag === 'draw:g') {
      const ownFunctions = readOwnTransformFunctions(node);
      const nested = ownFunctions.length === 0 ? groupFunctions : [...ownFunctions, ...groupFunctions];
      walkDrawShapes(node.children, nested, pkg, out, indexState, listIdState);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Vector primitives (odg): draw:rect/draw:ellipse/draw:circle/draw:line/draw:path/draw:polygon/draw:polyline, plus a small recognised subset of draw:custom-shape presets -- everything readDrawPageContent (bottom of this file) needs beyond odp's own draw:frame/draw:g that walkDrawShapes above already covers.
//
// FILL/STROKE reading (readOdfFillAndStroke) was verified against real LibreOffice 26.2 .odg output (same macro-built fixtures as typed/shared/path.ts's own top-of-file note): a shape's fill/stroke live on its OWN graphic-family automatic style, walked via the SAME resolveStyleElementChain root-first cascade readFrameInsets above already uses (a shape can inherit fill/stroke from its style:parent-style-name chain exactly as it can inherit padding). draw:fill-color / svg:stroke-color+svg:stroke-width being ABSENT means "no fill"/"no stroke" (confirmed: a plain draw:line's own automatic style carries svg:stroke-* but no draw:fill-color at all -- lines have no area). An EXPLICIT draw:fill="none" / draw:stroke="none" was also confirmed (a rectangle with FillStyle/LineStyle set to NONE via the UNO API round-trips with literal draw:graphic-properties draw:fill="none" draw:stroke="none") and overrides any color/width also present in an earlier, less specific link of the cascade.
//
// FILL-RULE: svg:fill-rule is real, spec-defined ODF vocabulary (confirmed against the OASIS schema reference -- style:graphic-properties carries it via the text:style-graphic-fill-properties-attlist attribute group, enumerated to exactly "nonzero"/"evenodd", the same two values ContentVectorSchema's own path-variant fillRule field models) -- read directly here, the same one-to-one mapping this file already applies elsewhere (e.g. a custom-shape preset's own draw:type). Whether real LibreOffice output ever actually emits it (as opposed to always leaving self-intersecting paths on the nonzero default) was not re-verified against a live headless LibreOffice render for this change -- the same headless-soffice-hang constraint documented in the sibling documents.js package's own README blocked that -- but it is unambiguous, real, spec-valid vocabulary regardless of how often a given producer chooses to emit it, exactly like this file's own draw:z-index handling below.
//
// STROKE STYLE: draw:stroke itself is enumerated to exactly "none"/"solid"/"dash" (confirmed against the OASIS schema reference) -- there is no "dotted" or "double" value at the ODF attribute level at all. "dash" maps onto ContentStrokeStyleSchema's own 'dashed' member directly and unambiguously; that mapping is implemented here. Distinguishing a genuinely DOTTED pattern from a DASHED one would need inspecting the style's own referenced draw:stroke-dash element (draw:dots1/draw:dots1-length/draw:dots2/draw:dots2-length/draw:distance -- a repeating dot/dash run-length pattern, not a simple flag) and classifying short lengths as dots versus long ones as dashes: there is no ODF-declared threshold for that split, so any cutoff this reader picked would be an invented magic number, not a value read from the format -- left unresolved, deliberately, rather than guessed. "double" is not merely unread here: ODF's own vector-stroke model has no double-line rendering concept at all (unlike ContentBorderSchema's border context, where "double" is a genuine, distinct border style) -- a real, permanent model boundary, not a gap this reader could close by reading a different attribute.
//
// OUT OF SCOPE, named explicitly per this task's own brief -- none of these are silently dropped, they are documented, bounded approximations:
// - gradient/bitmap/hatch fills (draw:fill="gradient"/"bitmap"/"hatch") render as a flat colour: if the style
// ALSO carries a direct draw:fill-color (real LibreOffice output sometimes does, as a fallback swatch), that is used; otherwise fill resolves to undefined rather than resolving the actual gradient/bitmap/hatch definition (a whole separate style-part lookup this reader does not attempt).
// - the exact dash/dot run-length pattern of a "dash"-mode stroke (style:stroke-dash) is still not resolved --
//   only the solid/dashed distinction itself is (see STROKE STYLE above).
// - transparency/opacity (draw:opacity, svg:stroke-opacity) is not read at all; every fill/stroke is treated as
//   fully opaque, matching Color's own plain-RGB shape (no alpha channel).
type OdfFillRule = 'nonzero' | 'evenodd';

function readOdfFillAndStroke(element: XmlElement, pkg: Package): { fill: Color | undefined; fillRule: OdfFillRule | undefined; stroke: ContentStroke | undefined } {
  const styleName = attrValue(element, 'draw:style-name');
  const { elements } = resolveStyleElementChain(styleName, 'graphic', pkg);
  let fill: Color | undefined;
  let fillRule: OdfFillRule | undefined;
  let stroke: ContentStroke | undefined;
  let strokeStyle: ContentStrokeStyle | undefined;
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
    const fillRuleValue = attrValue(props, 'svg:fill-rule');
    if (fillRuleValue === 'nonzero' || fillRuleValue === 'evenodd') {
      fillRule = fillRuleValue;
    }
    const strokeMode = attrValue(props, 'draw:stroke');
    if (strokeMode === 'none') {
      stroke = undefined;
      strokeStyle = undefined;
    } else {
      if (strokeMode === 'dash') {
        strokeStyle = 'dashed';
      } else if (strokeMode === 'solid') {
        strokeStyle = 'solid';
      }
      const strokeColorValue = attrValue(props, 'svg:stroke-color');
      const strokeWidthValue = attrValue(props, 'svg:stroke-width');
      const strokeColor = strokeColorValue === undefined ? undefined : parseOdfColor(strokeColorValue);
      const strokeWidthPt = strokeWidthValue === undefined ? undefined : parseOdfLength(strokeWidthValue);
      if (strokeColor !== undefined && strokeWidthPt !== undefined && strokeWidthPt > 0) {
        stroke = { color: strokeColor, widthPt: strokeWidthPt };
      }
    }
  }
  return { fill, fillRule, stroke: stroke === undefined || strokeStyle === undefined ? stroke : { ...stroke, style: strokeStyle } };
}

// Resolves a vector primitive's own geometry -- frame (svg:x/y/width/height) AND rotationDeg (draw:transform's rotate()+translate()) -- reusing the EXACT SAME transform machinery (resolveOdfShapeGeometry, composeOdfGroupTransform) readDrawFrame above already uses for a draw:frame, composed with any enclosing draw:g's own transform. Nothing about ContentVectorSchema's own rect/ellipse/path variants makes this a smaller problem than the ContentShape case: each already carries a rotationDeg field of its own, so there is no separate rotation-resolution logic to write -- this is a direct extension of what already resolves rotation correctly, not a reimplementation.
function resolveVectorGeometry(element: XmlElement, groupFunctions: readonly OdfTransformFunction[]): OdfShapeGeometry | undefined {
  const geometry = resolveOdfShapeGeometry(element);
  if (geometry === undefined) {
    return undefined;
  }
  return composeOdfGroupTransform(groupFunctions, geometry);
}

function readDrawRectVector(element: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentVector | undefined {
  const geometry = resolveVectorGeometry(element, groupFunctions);
  if (geometry === undefined) {
    return undefined;
  }
  const { fill, stroke } = readOdfFillAndStroke(element, pkg);
  return { kind: 'rect', frame: geometry.frame, rotationDeg: geometry.rotationDeg, fill, stroke };
}

// draw:ellipse and draw:circle share an identical attribute shape (svg:x/y/width/height) -- confirmed against real LibreOffice output: an ellipse whose width and height happen to be EQUAL is written as draw:circle instead of draw:ellipse (a real, distinct ODF element the OASIS schema defines specifically for this case), with no attribute-shape difference otherwise. Both map to ContentVectorSchema's single 'ellipse' variant.
function readDrawEllipseVector(element: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentVector | undefined {
  const geometry = resolveVectorGeometry(element, groupFunctions);
  if (geometry === undefined) {
    return undefined;
  }
  const { fill, stroke } = readOdfFillAndStroke(element, pkg);
  return { kind: 'ellipse', frame: geometry.frame, rotationDeg: geometry.rotationDeg, fill, stroke };
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
  const geometry = resolveVectorGeometry(element, groupFunctions);
  if (geometry === undefined) {
    return undefined;
  }
  const frame = geometry.frame;
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
  const { fill, fillRule, stroke } = readOdfFillAndStroke(element, pkg);
  return { kind: 'path', frame, rotationDeg: geometry.rotationDeg, subpaths, fill, fillRule, stroke };
}

// A small, deliberately narrow subset of draw:custom-shape presets, identified by draw:enhanced-geometry's own draw:type attribute -- verified against real LibreOffice 26.2 output (the same macro-built fixtures as typed/shared/path.ts's own top-of-file note; LibreOffice's "Basic Shapes" gallery rectangle/rounded rectangle/ellipse each round-trip with draw:type="rectangle"/"round-rectangle"/"ellipse" respectively). Their OWN draw:enhanced-path (a "M ?f7 0 X 0 ?f8 L ..." formula-driven mini-language with ?fN/$N expression references and ODF-specific commands like X/Y/U that are NOT part of plain SVG at all) is deliberately never parsed -- evaluating draw:enhanced-geometry's formula language is explicitly out of scope for this reader (a v1.5+ gap, tracked, not attempted here) -- instead, each recognised preset maps to the CLOSEST ContentVector approximation built from the shape's own frame alone: 'ellipse' maps to the ellipse variant; 'rectangle' AND 'round-rectangle' both map to the plain rect variant (ContentVectorSchema has no rounded-corner concept at all, so a rounded rectangle reads with sharp corners -- a documented, bounded approximation, not a silent one).
const RECOGNIZED_CUSTOM_SHAPE_PRESETS: ReadonlySet<string> = new Set(['rectangle', 'round-rectangle', 'ellipse']);

function readCustomShapeVector(element: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentVector | undefined {
  const geometryElement = childrenWithTag(element, 'draw:enhanced-geometry')[0];
  const type = geometryElement === undefined ? undefined : attrValue(geometryElement, 'draw:type');
  if (type === undefined || !RECOGNIZED_CUSTOM_SHAPE_PRESETS.has(type)) {
    return undefined;
  }
  const geometry = resolveVectorGeometry(element, groupFunctions);
  if (geometry === undefined) {
    return undefined;
  }
  const { fill, stroke } = readOdfFillAndStroke(element, pkg);
  return { kind: type === 'ellipse' ? 'ellipse' : 'rect', frame: geometry.frame, rotationDeg: geometry.rotationDeg, fill, stroke };
}

// The fallback for an UNRECOGNISED draw:custom-shape preset (or one with no draw:enhanced-geometry/draw:type at all): produce text-only content -- a plain ContentShape carrying whatever real text:p runs the shape has, read through the same readOdfParagraph call readDrawFrameContent's own draw:text-box case uses (though without its list-membership walk -- an odg path, where a text:list's own text:p children are still FOUND by this deep search and read as plain paragraphs) -- rather than a vector primitive this reader cannot correctly derive without evaluating draw:enhanced-path's own formula language (see RECOGNIZED_CUSTOM_SHAPE_PRESETS' own note). A custom-shape's text:p children sit DIRECTLY under draw:custom-shape itself (confirmed against real LibreOffice output -- unlike draw:frame's own draw:text-box wrapper), so elementsWithTag is used here as a deep search that also finds a text:list's own text:p children should a custom shape carry one, reading them as plain paragraphs. An unrecognised preset with NO real text content at all (every run empty, matching this reader's own hand-built fixtures, which never populate a placeholder shape's own text) has nothing worth preserving and is skipped entirely -- this IS the "diagnostic-worthy note" this task's brief asks for: this comment IS that note, since neither this reader nor readOdg below has a diagnostics sink to report it through (matching readOdp/readOdt's own established "no diagnostics channel" posture elsewhere in this package).
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

// Walks a draw:page's (or a nested draw:g's) own direct children, producing TWO paint-ordered lists -- shapes (draw:frame content, plus any unrecognised draw:custom-shape salvaged as text) and vectors (every recognised vector primitive) -- mirroring walkDrawShapes' own draw:frame/draw:g flattening exactly (indexState is threaded by reference so z-index fallback stays monotonic across the WHOLE recursive walk, not reset per group) but additionally recognising the vector-primitive element kinds odp's own walkDrawShapes deliberately does not (see this file's own top-of-file note). Every produced ContentShape/ContentVector is stamped with its own resolved `paintOrder: zIndex` (not merely sorted by it and then discarded) -- ContentDrawPageSchema still keeps `shapes` and `vectors` as two SEPARATE arrays with no shared field connecting them, but since BOTH now carry the real zIndex value from the SAME single monotonic indexState counter threaded across the whole walk, a caller CAN recover their true relative paint order by comparing `paintOrder` directly across the two arrays -- the cross-array ordering gap this comment used to describe as unrecoverable is closed by this stamping, even though the schema's own two-array shape is unchanged.
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
        shapesOut.push({ value: { ...shape, paintOrder: zIndex }, zIndex });
      }
    } else if (node.tag === 'draw:g') {
      const ownFunctions = readOwnTransformFunctions(node);
      const nested = ownFunctions.length === 0 ? groupFunctions : [...ownFunctions, ...groupFunctions];
      walkDrawPageContent(node.children, nested, pkg, indexState, shapesOut, vectorsOut);
    } else if (node.tag === 'draw:rect') {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawRectVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: { ...vector, paintOrder: zIndex }, zIndex });
      }
    } else if (node.tag === 'draw:ellipse' || node.tag === 'draw:circle') {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawEllipseVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: { ...vector, paintOrder: zIndex }, zIndex });
      }
    } else if (node.tag === 'draw:line') {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawLineVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: { ...vector, paintOrder: zIndex }, zIndex });
      }
    } else if (node.tag === 'draw:path' || node.tag === 'draw:polygon' || node.tag === 'draw:polyline') {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawPathVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: { ...vector, paintOrder: zIndex }, zIndex });
      }
    } else if (node.tag === 'draw:custom-shape') {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readCustomShapeVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: { ...vector, paintOrder: zIndex }, zIndex });
      } else {
        const shape = readCustomShapeAsTextShape(node, groupFunctions, pkg);
        if (shape !== undefined) {
          shapesOut.push({ value: { ...shape, paintOrder: zIndex }, zIndex });
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
