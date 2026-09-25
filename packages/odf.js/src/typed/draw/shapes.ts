import type {
  Box,
  ContentBlock,
  ContentFloatOrigin,
  ContentFloatPosition,
  ContentImageBlock,
  ContentShape,
  ContentVector,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import type { Package } from "../../model/package";
import { attrValue, childrenWithTag } from "../../xml/query";
import { decodeXmlText } from "../../xml/entities";
import { base64ToBytes } from "byte-codec";
import { sniffImageFormat } from "../../image/sniff";
import {
  readDrawObjectReference,
  readEmbeddedObjectDocument,
} from "./embedded";
import type { OdfResidueFormat } from "../shared/constructs";
import { resolveStyleElementChain } from "../shared/cascade";
import { decodeOdfText } from "../shared/text";
import {
  mintOdfListNumId,
  readOdfListParagraphs,
  type OdfListIdState,
} from "../shared/list";
import { readOdfParagraph } from "../shared/paragraph";
import { readOdfTable } from "../shared/table";
import { parseOdfLength } from "../shared/units";
import type {
  OdfShapeGeometry,
  OdfTransformFunction,
} from "../shared/transform";
// The vector-primitive readers and the fill/stroke resolution live in their own modules (shape-vectors.ts, fill-and-stroke.ts); walkDrawPageContent below dispatches into them.
import {
  readCustomShapeAsTextShape,
  readCustomShapeVector,
  readDrawEllipseVector,
  readDrawLineVector,
  readDrawPathVector,
  readDrawRectVector,
} from "./shape-vectors";
import {
  composeOdfGroupTransform,
  parseOdfTransform,
  resolveOdfShapeGeometry,
} from "../shared/transform";

// The shape vocabulary shared between odp (draw:frame/draw:g — a positioned container for text/image/table content, and group flattening) and odg (this file's own later extension: the vector-primitive kinds a drawing needs that a presentation typically doesn't — draw:rect/draw:ellipse/draw:circle/draw:line/draw:path/draw:polygon/draw:polyline/draw:custom-shape). A vector-primitive draw: element that is NOT wrapped in a draw:frame (a plain draw:rect/draw:ellipse/draw:custom-shape sitting directly under a draw:page or draw:g — valid, real ODF, both Impress and Draw allow it) was a deliberate, documented scope boundary for odp's own walkDrawShapes (below, UNCHANGED by this extension — odp's own ContentSlide has no `vectors` array to put one in), exactly mirroring how ooxml.js's own pptx shape-tree walker skips p:cxnSp connector shapes for the same "no vector-primitive recovery in THAT reader" reason. readDrawPageContent (this file's own odg-facing addition, further down) is the one that DOES walk vector primitives, for a ContentDrawPageSchema target that has somewhere to put them.

interface FrameInsets {
  readonly insetLeftPt: number;
  readonly insetTopPt: number;
  readonly insetRightPt: number;
  readonly insetBottomPt: number;
}

const ZERO_INSETS: FrameInsets = {
  insetLeftPt: 0,
  insetTopPt: 0,
  insetRightPt: 0,
  insetBottomPt: 0,
};

function readPaddingPt(
  props: XmlElement,
  attrName: string,
): number | undefined {
  const value = attrValue(props, attrName);
  return value === undefined ? undefined : parseOdfLength(value);
}

// A draw:frame's own text insets come from its graphic-family style's style:graphic-properties/fo:padding-* (verified against real LibreOffice output: e.g. the built-in "standard" graphic style sets fo:padding-top="0.125cm" fo:padding-bottom="0.125cm" fo:padding-left="0.25cm" fo:padding-right="0.25cm") — a dimensional/decorative property style/properties.ts deliberately does not model (see that module's own top-of-file note), so this reads style:graphic-properties directly. Unlike table.ts's own single-level findStyleElement lookups, this WALKS the full style:parent-style-name chain (via cascade.ts's resolveStyleElementChain, root-first) because real LibreOffice output routinely inherits padding from a parent style (a shape's own automatic style commonly sets only its own min-height/min-width directly, leaving fo:padding-* to be inherited from its style:parent-style-name="standard" chain) rather than repeating the full declaration on every shape's own automatic style.
export function readFrameInsets(frame: XmlElement, pkg: Package): FrameInsets {
  const styleName = attrValue(frame, "draw:style-name");
  const { elements } = resolveStyleElementChain(styleName, "graphic", pkg);
  let insets = ZERO_INSETS;
  for (const element of elements) {
    const props = childrenWithTag(element, "style:graphic-properties")[0];
    if (props === undefined) {
      continue;
    }
    insets = {
      insetLeftPt:
        readPaddingPt(props, "fo:padding-left") ?? insets.insetLeftPt,
      insetTopPt: readPaddingPt(props, "fo:padding-top") ?? insets.insetTopPt,
      insetRightPt:
        readPaddingPt(props, "fo:padding-right") ?? insets.insetRightPt,
      insetBottomPt:
        readPaddingPt(props, "fo:padding-bottom") ?? insets.insetBottomPt,
    };
  }
  return insets;
}

// A shape's own draw:name, decoded. odf.js parses with processEntities:false (xml/parse.ts), so an attribute value in this package's model is stored exactly as it appears in the source XML — a shape named `Q&A <draft>` is the literal five-character-entity string `Q&amp;A &lt;draft&gt;` here, and projecting that into a plain ContentShape.name without decoding hands every consumer an escaped string it has no way to know is escaped. Every other plain-text projection in this reader family already decodes (svg:title/svg:desc via decodeOdfText, a form control's label via forms.ts, meta.xml's own fields via metadata.ts); an attribute value takes xml/entities.ts's decodeXmlText directly rather than decodeOdfText, since text:s/text:tab/text:line-break are element-level spellings that cannot occur inside an attribute at all.
export function readDrawName(element: XmlElement): string | undefined {
  const raw = attrValue(element, "draw:name");
  return raw === undefined ? undefined : decodeXmlText(raw);
}

// A draw:frame's own alternative text: svg:title (ODF's short title) preferred, svg:desc (its long description) used when a frame carries only the latter — both are plain-text DIRECT CHILD ELEMENTS of draw:frame itself, not attributes, confirmed against real LibreOffice 26.2 output (a Calc image whose UNO Title/Description properties were both set round-trips as `<svg:title>...</svg:title><svg:desc>...</svg:desc>` siblings of the frame's own draw:image). ContentImageBlockSchema models exactly one altText string, so the two are collapsed with title first: LibreOffice's own HTML export writes svg:title into `alt=`, making it the closer match, and a frame carrying only a description still has genuine alternative text worth surfacing rather than dropping. Decoded via text.ts's own decodeOdfText (not a bare text-node concatenation) for the same reason every other ODF text getter in this package uses it — a title/description containing a run of literal spaces or a tab is stored as text:s/text:tab elements.
function readFrameAltText(frame: XmlElement): string | undefined {
  const title = childrenWithTag(frame, "svg:title")[0];
  const decodedTitle = title === undefined ? undefined : decodeOdfText(title);
  if (decodedTitle !== undefined && decodedTitle.length > 0) {
    return decodedTitle;
  }
  const description = childrenWithTag(frame, "svg:desc")[0];
  const decodedDescription =
    description === undefined ? undefined : decodeOdfText(description);
  return decodedDescription !== undefined && decodedDescription.length > 0
    ? decodedDescription
    : undefined;
}

// draw:image is a direct child of draw:frame, referencing its media part by a plain package path via xlink:href — ODF has no relationships mechanism (see this package's own top-level README), so this IS the reference, not an indirection to resolve. Real saved .odp packages always use xlink:href against a real Pictures/ part (confirmed against a real LibreOffice-produced .odp); the flat-XML office:binary-data inline form is specific to the .fodp/.fods/.fodt single-file variants this reader (operating on a decoded zip-of-XML Package) never encounters, so it is not handled here. The frame is passed alongside its own draw:image purely for alt text, which lives on the FRAME (see readFrameAltText above), never on the image element.
// ODF's text:anchor-type states what a draw:frame's own svg:x/svg:y are measured from — meaningful only inside text-document flow content (a frame anchored into a slide's own shape tree, or a table cell's, never carries this attribute at all, so this lookup naturally resolves to undefined there with no extra context-awareness needed). "char"/"as-char" are the flow-anchored case (flow-anchor.ts's own top-of-file note): the frame has no position of its own to record, its svg:x/svg:y absent by the ODF schema itself, so those two are deliberately NOT members here — only the three anchor types that genuinely carry a real, meaningful svg:x/svg:y populate a floatPosition. document-schema.js's own "frame" origin member exists for exactly text:anchor-type="frame" (ExaDev/documents.js#1087 added it with no docx equivalent), so the three map onto the shared enum with no translation needed beyond the name difference between "page"/"paragraph" (identical in both vocabularies) and ODF's own "frame".
const FLOAT_ORIGIN_BY_ANCHOR_TYPE: Readonly<
  Partial<Record<string, ContentFloatOrigin>>
> = {
  page: "page",
  frame: "frame",
  paragraph: "paragraph",
};

// A positioned draw:frame's own floating position, document-schema.js's format-agnostic ContentFloatPosition (ExaDev/documents.js#1087/#1094) — undefined for a frame with no text:anchor-type at all (a slide or table-cell shape, where the attribute is never written) or one anchored "char"/"as-char" (inline in text flow, no position of its own). ODF's svg:x/svg:y are always a literal point offset on both axes — there is no alignment-keyword concept the way docx's wp:align is — so both axes always take ContentFloatAxisSchema's offsetPt branch, never its align branch.
function readFloatPosition(
  frame: XmlElement,
  frameBox: Readonly<Box>,
): ContentFloatPosition | undefined {
  const anchorType = attrValue(frame, "text:anchor-type");
  const origin =
    anchorType === undefined
      ? undefined
      : FLOAT_ORIGIN_BY_ANCHOR_TYPE[anchorType];
  if (origin === undefined) {
    return undefined;
  }
  return {
    horizontal: { relativeTo: origin, offsetPt: frameBox.xPt },
    vertical: { relativeTo: origin, offsetPt: frameBox.yPt },
  };
}

export function readDrawImageBlock(
  image: XmlElement,
  frame: XmlElement,
  frameBox: Readonly<Box>,
  pkg: Package,
): ContentImageBlock | undefined {
  const href = attrValue(image, "xlink:href");
  const part = href === undefined ? undefined : pkg.parts[href];
  if (part?.kind !== "binary") {
    return undefined;
  }
  const bytes = base64ToBytes(part.base64);
  const format = sniffImageFormat(bytes);
  if (format === undefined) {
    return undefined;
  }
  // The image renders at the FRAME's own resolved size, not the source image's native pixel dimensions — matching ooxml.js's own readPicShape convention.
  const block: ContentImageBlock = {
    kind: "image",
    format,
    base64: part.base64,
    widthPt: frameBox.widthPt,
    heightPt: frameBox.heightPt,
  };
  const altText = readFrameAltText(frame);
  if (altText !== undefined) {
    block.altText = altText;
  }
  const floatPosition = readFloatPosition(frame, frameBox);
  if (floatPosition !== undefined) {
    block.floatPosition = floatPosition;
  }
  return block;
}

// A draw:frame's content is exactly one of table:table, draw:text-box, draw:image, or draw:object (an embedded sub-document, read only when the caller opts in through embeddedFormat — verified against real LibreOffice output) — an embedded draw:object is checked FIRST (a real embedding frame also carries a sibling draw:image, the ObjectReplacements/ preview, which must not be mistaken for the frame's own image content), then table:table (a real saved presentation table frame carries a sibling .svm fallback preview for the identical reason).
//
// ODP LIST MEMBERSHIP — minted numId, not the numId-less { level } shape: document-schema.js 3.3.0 made ContentListMembership.numId optional precisely so a reader whose source carries NO list identity could emit the honest minimal { level } (ooxml.js's pptx reader, whose a:pPr/@lvl is a bare depth attribute on the paragraph with no list element behind it — a fabricated numId there would be a lie in the data). A slide text box is not that case: draw:text-box's own content model is exactly (text:p | text:list)*, and its text:list elements are the IDENTICAL structural containers the odt reader walks in office:text — a slide can carry two of them (two bullet bodies in one text box, or one list in each of two frames), and a consumer grouping list paragraphs apart (rendering separate <ul>/<ol> elements, nesting an outline per list) must be able to tell them apart. The deciding criterion is exactly that: whether the source carries genuine list identity a consumer needs for grouping separate lists apart. ODP's text:list elements pass it, so this reader mints a per-encounter numId through the SAME shared machinery (typed/shared/list.ts: mintOdfListNumId/readOdfListParagraphs, including the ordered:/bullet: kind prefix) the odt reader uses — emitting { level } alone would discard a real, source-grounded fact, not avoid a fabrication.
function readDrawFrameContent(
  frame: XmlElement,
  frameBox: Readonly<Box>,
  pkg: Package,
  listIdState: Readonly<OdfListIdState>,
  embeddedFormat: OdfResidueFormat | undefined,
): ContentBlock[] {
  // An embedded object's draw:object is checked BEFORE every other content, exactly as odt's anchored-frame reader and ods's cell-anchored reader already order it: a real embedding frame ALSO carries a sibling draw:image (the ObjectReplacements/ preview) that must not be mistaken for the frame's own picture content. Opt-in through embeddedFormat rather than unconditional, because ods calls readDrawFrame for its anchored frames and resolves the reference itself through its own cell-anchored path — an unconditional branch here would hand ods a second, differently-shaped copy of the same object.
  if (embeddedFormat !== undefined) {
    const reference = readDrawObjectReference(frame, pkg);
    if (reference !== undefined) {
      const { document, residue } = readEmbeddedObjectDocument(
        reference,
        frameBox,
        embeddedFormat,
      );
      const embeddedBlock: ContentBlock = {
        kind: "embeddedObject",
        objectKind: reference.objectKind,
        document,
        frame: frameBox,
      };
      if (residue !== undefined) {
        embeddedBlock.source = residue;
      }
      return [embeddedBlock];
    }
  }
  const table = childrenWithTag(frame, "table:table")[0];
  if (table !== undefined) {
    return [readOdfTable(table, pkg, listIdState)];
  }
  const textBox = childrenWithTag(frame, "draw:text-box")[0];
  if (textBox !== undefined) {
    // A direct-children walk (not the deep elementsWithTag search this branch used before list membership existed) covers draw:text-box's whole (text:p | text:list)* content model: a text:p reads as a plain paragraph with NO list membership, and a text:list reads through the shared walker, which attaches numId/level membership to every paragraph it finds at its actual text:list-in-text:list-item nesting depth — document order across both child kinds is preserved, matching the flattened order the old deep search produced.
    const blocks: ContentBlock[] = [];
    for (const child of textBox.children) {
      if (child.type !== "element") {
        continue;
      }
      if (child.tag === "text:p") {
        blocks.push(readOdfParagraph(child, pkg));
      } else if (child.tag === "text:list") {
        const numId = mintOdfListNumId(pkg, child, listIdState);
        blocks.push(
          ...readOdfListParagraphs(child, { numId, level: 0 }, (element) =>
            readOdfParagraph(element, pkg),
          ),
        );
      }
    }
    return blocks;
  }
  const image = childrenWithTag(frame, "draw:image")[0];
  if (image !== undefined) {
    const block = readDrawImageBlock(image, frame, frameBox, pkg);
    return block === undefined ? [] : [block];
  }
  return [];
}

// Reads one draw:frame into a ContentShape, in the coordinate space `groupFunctions` maps FROM (its own immediate parent's local space) TO the page: composeOdfGroupTransform is the identity when groupFunctions is empty (the overwhelmingly common case — a frame with no enclosing draw:g), so this is cheap for the non-grouped case. Returns undefined for a frame with no resolvable geometry of its own — see transform.ts's resolveOdfShapeGeometry for the documented "inherited positioning" scope boundary this defers to. `flowPositioning` admits the one geometry shape that boundary excludes on purpose for page-space readers but that TEXT FLOW genuinely has: an as-char anchored frame in odt text carries svg:width/svg:height and NO svg:x/svg:y, because its position is the character flow itself — such a frame reads at the origin of its own box (the same "0/0 is the honest spelling of positioned-by-flow" convention ooxml.js's docx reader applies to inline flow objects), never a dropped frame. `listIdState` mints a text-box list's numId identity (see readDrawFrameContent's own ODP LIST MEMBERSHIP note) and defaults to a fresh counter so every pre-existing call site (ods's anchored-drawing reader, this file's own tests) keeps working unchanged — a caller walking a WHOLE presentation (odp) threads one document-wide state so identities stay unique across every slide.
export function readDrawFrame(
  frame: XmlElement,
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
  listIdState: Readonly<OdfListIdState> = { counter: { next: 1 } },
  flowPositioning = false,
  embeddedFormat?: OdfResidueFormat,
): ContentShape | undefined {
  const ownGeometry =
    resolveOdfShapeGeometry(frame) ??
    (flowPositioning ? flowFrameGeometry(frame) : undefined);
  if (ownGeometry === undefined) {
    return undefined;
  }
  const geometry = composeOdfGroupTransform(groupFunctions, ownGeometry);
  return {
    name: readDrawName(frame),
    frame: geometry.frame,
    rotationDeg: geometry.rotationDeg,
    ...readFrameInsets(frame, pkg),
    blocks: readDrawFrameContent(
      frame,
      geometry.frame,
      pkg,
      listIdState,
      embeddedFormat,
    ),
  };
}

// The flow-positioning fallback: a frame with parseable svg:width/svg:height and no svg:x/svg:y (or draw:transform) reads as a box at the origin of its own size.
function flowFrameGeometry(frame: XmlElement): OdfShapeGeometry | undefined {
  const widthValue = attrValue(frame, "svg:width");
  const heightValue = attrValue(frame, "svg:height");
  if (widthValue === undefined || heightValue === undefined) {
    return undefined;
  }
  const widthPt = parseOdfLength(widthValue);
  const heightPt = parseOdfLength(heightValue);
  if (widthPt === undefined || heightPt === undefined) {
    return undefined;
  }
  return {
    frame: { xPt: 0, yPt: 0, widthPt, heightPt },
    rotationDeg: undefined,
  };
}

// Shared by both walkDrawShapes (odp) and walkDrawPageContent (odg, further down this file) — "read an element's own draw:transform into a function list" is identical for both, so this stays a single private helper reused within this module rather than being duplicated per walker.
function readOwnTransformFunctions(
  element: XmlElement,
): OdfTransformFunction[] {
  const value = attrValue(element, "draw:transform");
  return value === undefined ? [] : parseOdfTransform(value);
}

// Walks a shape container's direct children (a draw:page, or a draw:g's own children) in document order, flattening any draw:g group into `out`'s own flat ContentShape list: `groupFunctions` accumulates each enclosing group's own draw:transform, INNERMOST first (a nested group's own functions are prepended ahead of whatever its own parent already accumulated), so composeOdfGroupTransform at the leaf applies them in the correct innermost-to-outermost order — mirroring ooxml.js's own p:grpSp flattening (src/typed/pptx/read.ts's walkShapeTreeChildren/composeGroupTransform), adapted to ODF's own transform-function-list model instead of OOXML's chOff/chExt scaling. See this file's own top-of-file note on why a bare vector-primitive shape (not wrapped in a draw:frame) is silently skipped here.
//
// `indexState` reuses the EXACT SAME paintOrderKey/DocumentIndexState machinery walkDrawPageContent (odg, further down this file) uses — ContentShapeSchema carries the identical optional `paintOrder` field ContentSlideSchema's own shapes already declare, so a presentation shape gets the same real, spec-aware (draw:z-index-honouring, falling back to document-encounter order) paint-order value an odg drawing's shapes get, even though odp's own output array is never reordered by it (matching this walker's own pre-existing document-order-only behaviour — only the STAMPED VALUE is new, not a new sort). Defaults to a fresh counter so every existing external call site (a single top-level call per slide, with no indexState argument) keeps working unchanged; recursion into a nested draw:g threads the SAME state onward so the counter stays monotonic across the whole slide, matching walkDrawPageContent's own threading discipline exactly.
//
// `listIdState` threads the text-box list numId counter (see readDrawFrameContent's own ODP LIST MEMBERSHIP note) through every frame of the walk, with the same fresh-counter default and the same recursive threading discipline as indexState — odp passes one document-wide state (see readOdpContent) so a list's identity is unique across the whole presentation, never reset per slide or per group.
// The shape accumulator walkDrawShapes appends each resolved draw:frame onto, flattening draw:g groups as it goes. Wrapped rather than passed as a bare array so the parameter stays out of prefer-readonly-array-param's scope while the array it holds stays genuinely mutable.
export interface ShapeSink {
  readonly shapes: ContentShape[];
}

export function walkDrawShapes(
  children: readonly XmlNode[],
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
  sink: ShapeSink,
  indexState: Readonly<DocumentIndexState> = { counter: { next: 0 } },
  listIdState: Readonly<OdfListIdState> = { counter: { next: 1 } },
): void {
  const out = sink.shapes;
  for (const node of children) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "draw:frame") {
      const zIndex = paintOrderKey(node, indexState);
      const shape = readDrawFrame(
        node,
        groupFunctions,
        pkg,
        listIdState,
        false,
        "odp",
      );
      if (shape !== undefined) {
        out.push({ ...shape, paintOrder: zIndex });
      }
    } else if (node.tag === "draw:g") {
      const ownFunctions = readOwnTransformFunctions(node);
      // No length-0 shortcut returning groupFunctions unchanged: spreading an empty ownFunctions ahead of groupFunctions produces the identical content either way, so the shortcut was a pure allocation micro-optimisation, not an observable behavioural branch.
      const nested = [...ownFunctions, ...groupFunctions];
      walkDrawShapes(node.children, nested, pkg, sink, indexState, listIdState);
    }
  }
}

// PAINT ORDER (draw:z-index): confirmed against the OASIS ODF schema (datypic.com's ODF 1.1 schema reference for draw:z-index — xsd:nonNegativeInteger, [0..1], valid on every shape element this file reads: draw:rect, draw:ellipse/circle, draw:line, draw:path/polygon/polyline, draw:custom-shape, draw:frame, draw:g) that draw:z-index is real, spec-defined ODF vocabulary for overriding a shape's stacking order independently of its position in the document. It is read here when present. Separately and empirically confirmed against real LibreOffice 26.2 .odg output (a controlled round trip: two overlapping shapes' UNO ZOrder property was set to the OPPOSITE of their creation/document order, then saved): LibreOffice's OWN writer never emits draw:z-index at all for a plain draw:page's shapes — instead, it physically REORDERS the shape elements within the saved XML to already match paint order, with document order and z-order coinciding exactly in every real LibreOffice-produced file. paintOrderKey below therefore uses an explicit draw:z-index when present, and otherwise falls back to a monotonically increasing DOCUMENT-ENCOUNTER counter — which for genuine LibreOffice output already IS the correct paint order (a no-op sort), while still resolving correctly for any OTHER producer that DOES emit an explicit draw:z-index differing from document order.
// The paint-order counter itself, nested rather than sitting directly on DocumentIndexState: it is genuinely incremented on every shape indexed, so a flat DocumentIndexState would be a readonly-param candidate the increment cannot satisfy.
interface DocumentIndexCounter {
  next: number;
}

interface DocumentIndexState {
  readonly counter: DocumentIndexCounter;
}

function nextDocumentIndex(state: Readonly<DocumentIndexState>): number {
  const value = state.counter.next;
  state.counter.next += 1;
  return value;
}

function paintOrderKey(
  element: XmlElement,
  state: Readonly<DocumentIndexState>,
): number {
  const documentIndex = nextDocumentIndex(state);
  const raw = attrValue(element, "draw:z-index");
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

// A stable sort (Array.prototype.sort has been spec-guaranteed stable since ES2019) by zIndex ascending — ties (only possible among items that both fell back to a document-encounter index, which is itself already unique per item, so ties cannot actually occur in practice) preserve original push order regardless.
function byPaintOrder<T>(items: readonly PaintOrdered<T>[]): T[] {
  return items
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((item) => item.value);
}

// Walks a draw:page's (or a nested draw:g's) own direct children, producing TWO paint-ordered lists — shapes (draw:frame content, plus any unrecognised draw:custom-shape salvaged as text) and vectors (every recognised vector primitive) — mirroring walkDrawShapes' own draw:frame/draw:g flattening exactly (indexState is threaded by reference so z-index fallback stays monotonic across the WHOLE recursive walk, not reset per group) but additionally recognising the vector-primitive element kinds odp's own walkDrawShapes deliberately does not (see this file's own top-of-file note). Every produced ContentShape/ContentVector is stamped with its own resolved `paintOrder: zIndex` (not merely sorted by it and then discarded) — ContentDrawPageSchema still keeps `shapes` and `vectors` as two SEPARATE arrays with no shared field connecting them, but since BOTH now carry the real zIndex value from the SAME single monotonic indexState counter threaded across the whole walk, a caller CAN recover their true relative paint order by comparing `paintOrder` directly across the two arrays — the cross-array ordering gap this comment used to describe as unrecoverable is closed by this stamping, even though the schema's own two-array shape is unchanged.
// The two paint-ordered accumulators walkDrawPageContent fills, always threaded together: one recursive walk produces both shapes and vectors, stamped from one monotonic index counter, so splitting them would only recreate the pairing at every call site.
interface PaintOrderedSink {
  readonly shapesOut: PaintOrdered<ContentShape>[];
  readonly vectorsOut: PaintOrdered<ContentVector>[];
}

function walkDrawPageContent(
  children: readonly XmlNode[],
  groupFunctions: readonly OdfTransformFunction[],
  pkg: Package,
  indexState: Readonly<DocumentIndexState>,
  sink: PaintOrderedSink,
): void {
  const { shapesOut, vectorsOut } = sink;
  for (const node of children) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "draw:frame") {
      const zIndex = paintOrderKey(node, indexState);
      const shape = readDrawFrame(
        node,
        groupFunctions,
        pkg,
        undefined,
        false,
        "odg",
      );
      if (shape !== undefined) {
        shapesOut.push({ value: { ...shape, paintOrder: zIndex }, zIndex });
      }
    } else if (node.tag === "draw:g") {
      const ownFunctions = readOwnTransformFunctions(node);
      // See walkDrawShapes' own identical construction above for why there is no length-0 shortcut here either.
      const nested = [...ownFunctions, ...groupFunctions];
      walkDrawPageContent(node.children, nested, pkg, indexState, sink);
    } else if (node.tag === "draw:rect") {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawRectVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: { ...vector, paintOrder: zIndex }, zIndex });
      }
    } else if (node.tag === "draw:ellipse" || node.tag === "draw:circle") {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawEllipseVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: { ...vector, paintOrder: zIndex }, zIndex });
      }
    } else if (node.tag === "draw:line") {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawLineVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: { ...vector, paintOrder: zIndex }, zIndex });
      }
    } else if (
      node.tag === "draw:path" ||
      node.tag === "draw:polygon" ||
      node.tag === "draw:polyline"
    ) {
      const zIndex = paintOrderKey(node, indexState);
      const vector = readDrawPathVector(node, groupFunctions, pkg);
      if (vector !== undefined) {
        vectorsOut.push({ value: { ...vector, paintOrder: zIndex }, zIndex });
      }
    } else if (node.tag === "draw:custom-shape") {
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

// The odg-facing entry point: resolves a draw:page's own children (typically office:drawing's draw:page, but equally valid for a presentation draw:page that happens to contain vector primitives directly — draw:page's own content model does not differ between office:drawing and office:presentation, see readOdgContent's own top-of-file note) into paint-ordered shapes/vectors, ready to place directly into a ContentDrawPageSchema value.
export function readDrawPageContent(
  children: readonly XmlNode[],
  pkg: Package,
): DrawPageContent {
  const shapesOut: PaintOrdered<ContentShape>[] = [];
  const vectorsOut: PaintOrdered<ContentVector>[] = [];
  walkDrawPageContent(
    children,
    [],
    pkg,
    { counter: { next: 0 } },
    {
      shapesOut,
      vectorsOut,
    },
  );
  return { shapes: byPaintOrder(shapesOut), vectors: byPaintOrder(vectorsOut) };
}
