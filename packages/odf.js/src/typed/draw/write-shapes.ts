import type {
  Box,
  ContentBlock,
  ContentImageBlock,
  ContentParagraph,
  ContentShape,
  ContentTable,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import type { Package } from "../../model/package";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { type StyleRegistry } from "../../styles/registry";
import { formatOdfLength } from "../shared/units";
import { writeOdfParagraph } from "../shared/paragraph";
import { writeOdfTable } from "../shared/table";
import {
  canonicalImage,
  canonicalParagraph,
  canonicalTable,
} from "../shared/canonicalise";
import {
  buildOdfListStyle,
  closeListPlan,
  listKindOf,
  planListMembership,
  writeOdfList,
  type ListPlanState,
  type OdfListEntry,
} from "../shared/list";

// The write-side mirror of typed/draw/shapes.ts's own readDrawFrame/walkDrawShapes: one ContentShape -> the draw:frame element those functions read back, shared between odp (typed/odp/write.ts, the first caller) and odg (typed/odg/write.ts), exactly as the read side's own shapes.ts is shared between readOdp and readOdg (see typed/odg/read.ts's own FACTORING DECISION note for why the split sits here). What differs between the two formats on the write side -- a slide's presentation:notes, a drawing page's own vector primitives -- stays in each format's own write.ts (or, for the vectors, in this directory's own typed/draw/write-vectors.ts); this module owns only the one thing genuinely identical between them: turning a ContentShape into a real draw:frame, and stating the canonical form reading one back produces.
//
// THE ONE HARD CONSTRAINT THIS MODULE IS BUILT AROUND: a draw:frame's content is exactly ONE of table:table, draw:text-box, or draw:image (readDrawFrameContent's own top-of-file note, verified against real LibreOffice output) -- never a mix, and never more than one. planShapeContent below is the single place that decides which of the three a shape's own `blocks` array maps to, refusing by name (rather than silently dropping) any combination ODF has no spelling for.

function unsupportedShapeContent(what: string): Error {
  return new Error(
    `writeDrawFrame: a shape carries ${what}, which this writer does not write yet -- refusing rather than producing a document that silently lost it. See ExaDev/documents.js for the tracked follow-up covering the fidelity constructs.`,
  );
}

// One shape's content, discriminated into the exact three shapes a draw:frame can hold. `paragraphs` for the text case already carries its final, write-ready list membership (numId resolved by the caller's own ListPlanState, per this module's own top-of-file note) -- planShapeContent both validates the block combination and, for the text case, performs that resolution in the same pass, so a caller can never see an intermediate state where the two have drifted apart.
export type ShapeContentPlan =
  | { readonly kind: "text"; readonly paragraphs: readonly ContentParagraph[] }
  | { readonly kind: "table"; readonly table: ContentTable }
  | { readonly kind: "image"; readonly image: ContentImageBlock };

// Validates and discriminates a shape's `blocks` into the one content kind its draw:frame will carry, canonicalising any paragraph-level list membership onto the SAME ListPlanState (typed/shared/list.ts) the caller threads across whatever scope its own format requires (odp threads one state across the whole presentation and odg one across the whole drawing, each matching its own reader's threading -- this function does not decide that, it only ever reads the state it is given). Force-closes the plan's currently open run FIRST, unconditionally: a list can never structurally span two shapes (each is its own draw:text-box), so a caller must never see the previous shape's run silently continue into this one even if their raw numIds happen to coincide.
//
// Refusals, each by name rather than a silent drop:
// - a table or an image found ALONGSIDE any other block (only a shape whose blocks are ALL paragraphs, or whose blocks are EXACTLY one table, or EXACTLY one image, has a real draw:frame spelling);
// - a page break (no ODF spelling inside a shape's own text -- draw:text-box has no page concept at all);
// - an embedded object or a construct boundary marker (the same fidelity constructs odt's own writer refuses, not yet handled here);
// - a heading (a shape's own draw:text-box content model is (text:p | text:list)* with no text:h at all -- readDrawFrameContent's own text-box walk only ever looks for those two tags, so a text:h written here would be silently invisible on the way back in, not merely unusual).
export function planShapeContent(
  blocks: readonly ContentBlock[],
  listState: ListPlanState,
): ShapeContentPlan {
  closeListPlan(listState);
  if (blocks.length === 1) {
    const only = blocks[0]!;
    if (only.kind === "table") {
      return { kind: "table", table: only };
    }
    if (only.kind === "image") {
      return { kind: "image", image: only };
    }
  }

  const paragraphs: ContentParagraph[] = [];
  for (const block of blocks) {
    if (block.kind === "table") {
      throw unsupportedShapeContent(
        "a table alongside other content (a draw:frame's own content is exactly one of table:table/draw:text-box/draw:image, never a mix)",
      );
    }
    if (block.kind === "image") {
      throw unsupportedShapeContent(
        "an image alongside other content (same reason)",
      );
    }
    if (block.kind === "pageBreak") {
      throw unsupportedShapeContent(
        "a page break (no ODF spelling inside a shape's own text)",
      );
    }
    if (block.kind === "embeddedObject") {
      throw unsupportedShapeContent("an embedded object");
    }
    if (block.kind === "constructStart" || block.kind === "constructEnd") {
      throw unsupportedShapeContent("a construct boundary marker");
    }
    // block.kind === "paragraph" here, by elimination over ContentBlock's own discriminant.
    if (block.constructs !== undefined && block.constructs.length > 0) {
      throw unsupportedShapeContent(
        "a run-level construct extent (a field, bookmark, note, annotation, or tracked change)",
      );
    }
    if (block.headingLevel !== undefined) {
      throw unsupportedShapeContent(
        "a heading (a shape's own draw:text-box has no text:h reading path)",
      );
    }
    const canonicalId = planListMembership(block.list, listState);
    paragraphs.push(
      canonicalId === undefined
        ? { ...block, list: undefined }
        : { ...block, list: { numId: canonicalId, level: block.list!.level } },
    );
  }
  return { kind: "text", paragraphs };
}

// The mutable state one shape-writing walk threads: the automatic-style registry every formatting decision interns through (shared with whatever else the caller's own writer is minting styles for), the counters that mint document-unique names (an image's own part path, a nested table's own table:name, a text-box list's own list-style), and the bullet/ordered list-style cache -- one text:list-style per kind, minted on first use, matching odt/write.ts's own OdtWriteState.listStyleByKind.
export interface DrawShapeWriteState {
  readonly pkg: Package;
  readonly registry: StyleRegistry;
  // The container a minted text:list-style (below) is appended to -- content.xml's own office:automatic-styles, the same container the caller's own StyleRegistry interns paragraph/text/graphic styles into, so every automatic style a shape writer mints lands in one place.
  readonly contentAutomaticStyles: XmlElement;
  nextImage: number;
  nextTable: number;
  nextListStyle: number;
  readonly listStyleByKind: Map<"ordered" | "bullet", string>;
}

export function createDrawShapeWriteState(
  pkg: Package,
  registry: StyleRegistry,
  contentAutomaticStyles: XmlElement,
): DrawShapeWriteState {
  return {
    pkg,
    registry,
    contentAutomaticStyles,
    nextImage: 1,
    nextTable: 1,
    nextListStyle: 1,
    listStyleByKind: new Map(),
  };
}

// Mints (or reuses) one text:list-style per kind -- a document with fifty bullet lists across its slides needs one bullet list-style, not fifty identical ones, matching typed/odt/write.ts's own listStyleNameFor exactly.
function listStyleNameFor(
  kind: "ordered" | "bullet",
  state: DrawShapeWriteState,
): string {
  const existing = state.listStyleByKind.get(kind);
  if (existing !== undefined) {
    return existing;
  }
  const name = `SL${state.nextListStyle}`;
  state.nextListStyle += 1;
  state.listStyleByKind.set(kind, name);
  state.contentAutomaticStyles.children.push(buildOdfListStyle(name, kind));
  return name;
}

// --- geometry: Box + rotationDeg -> either plain svg:x/y/width/height, or svg:width/height + draw:transform ----------
//
// The exact algebraic inverse of typed/shared/transform.ts's own resolveOdfShapeGeometry, derived (not guessed) from that module's own documented composition rule: a rotated frame is written as draw:transform="rotate(<radians>) translate(<tx> <ty>)", the SAME two-function, rotate-then-translate shape that module's own top-of-file note verifies empirically against real LibreOffice output. Solving resolveOdfShapeGeometry's own center/rotationDeg formulas for the translate() offset that reproduces a GIVEN frame+rotationDeg (rather than re-deriving the composition rule itself, which transform.ts already establishes) gives: angleRad = -rotationDeg * PI / 180                              (netRotationDeg's own inverse) tx = frame.xPt + W/2 - (W/2)*cos(angleRad) - (H/2)*sin(angleRad) ty = frame.yPt + H/2 - (H/2)*cos(angleRad) + (W/2)*sin(angleRad) Verified algebraically against resolveOdfShapeGeometry's own center computation, and pinned by the rotation suites of typed/odp/write-round-trip.test.ts and typed/odg/write-round-trip.test.ts, which read written output back through the real readers (and therefore through resolveOdfShapeGeometry) rather than asserting the formula against itself. A rotated round trip is exact up to ordinary IEEE-754 floating-point rounding (two trig evaluations, not a lossy approximation), which is why rotationDeg===0 is treated identically to rotationDeg===undefined below: resolveOdfShapeGeometry's own read side already collapses a net rotation of exactly zero to undefined (see its own "rotationDeg === 0 ? undefined : rotationDeg"), so writing a rotate(0) transform for a literal 0 input would round-trip to undefined and silently fail a strict equality check -- treating the two alike here is this writer's OWN half of that same collapse, not a new approximation.
//
// Exported because a VECTOR primitive's own geometry is the identical problem, not merely a similar one: typed/draw/shapes.ts's resolveVectorGeometry resolves a draw:rect/draw:ellipse/draw:path through the very same resolveOdfShapeGeometry call readDrawFrame uses, so its inverse is this function unchanged. The name still says "frame" because that is what it takes -- a ContentVector's own placement field is spelled `frame` too.
export function frameGeometryAttrs(
  frame: Box,
  rotationDeg: number | undefined,
): Record<string, string> {
  if (rotationDeg === undefined || rotationDeg === 0) {
    return {
      "svg:x": formatOdfLength(frame.xPt),
      "svg:y": formatOdfLength(frame.yPt),
      "svg:width": formatOdfLength(frame.widthPt),
      "svg:height": formatOdfLength(frame.heightPt),
    };
  }
  const angleRad = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const halfWidthPt = frame.widthPt / 2;
  const halfHeightPt = frame.heightPt / 2;
  const txPt = frame.xPt + halfWidthPt - halfWidthPt * cos - halfHeightPt * sin;
  const tyPt =
    frame.yPt + halfHeightPt - halfHeightPt * cos + halfWidthPt * sin;
  return {
    "svg:width": formatOdfLength(frame.widthPt),
    "svg:height": formatOdfLength(frame.heightPt),
    "draw:transform": `rotate(${angleRad}) translate(${formatOdfLength(txPt)} ${formatOdfLength(tyPt)})`,
  };
}

// --- insets: fo:padding-* on a graphic-family automatic style -----------------------------------------------------
//
// A dimensional/decorative property styles/properties.ts deliberately does not model (see that module's own top-of-file note), so this reaches it through StyleRegistry's own propertyElements seam -- the identical pattern typed/shared/table.ts already uses for a cell's fill/border/column-width/row-height (see that module's own top-of-file note on the seam itself). Written only when at least one inset is non-zero: a shape with no draw:style-name at all reads back with every inset at ZERO_INSETS regardless (typed/draw/shapes.ts's own readFrameInsets), so an all-zero shape needs no style minted for a fact the reader already defaults to.
function shapeGraphicStyleName(
  shape: {
    readonly insetLeftPt: number;
    readonly insetTopPt: number;
    readonly insetRightPt: number;
    readonly insetBottomPt: number;
  },
  state: DrawShapeWriteState,
): string | undefined {
  if (
    shape.insetLeftPt === 0 &&
    shape.insetTopPt === 0 &&
    shape.insetRightPt === 0 &&
    shape.insetBottomPt === 0
  ) {
    return undefined;
  }
  return state.registry.intern({
    properties: {},
    family: "graphic",
    propertyElements: [
      el("style:graphic-properties", {
        "fo:padding-left": formatOdfLength(shape.insetLeftPt),
        "fo:padding-top": formatOdfLength(shape.insetTopPt),
        "fo:padding-right": formatOdfLength(shape.insetRightPt),
        "fo:padding-bottom": formatOdfLength(shape.insetBottomPt),
      }),
    ],
  });
}

// --- content: the three draw:frame bodies planShapeContent above can produce ----------------------------------------

// draw:text-box's own (text:p | text:list)* content model: every paragraph writeOdfParagraph produces, with consecutive paragraphs sharing one list membership grouped into a single text:list (nested per level via typed/shared/list.ts's own writeOdfList) -- the exact mirror of typed/odt/write.ts's own writeSectionBlocks list-tracking, simplified since a shape's own text content never interleaves a table or an anchored image inside its paragraph flow (planShapeContent above has already refused any block combination that would need to).
function writeShapeTextBox(
  paragraphs: readonly ContentParagraph[],
  state: DrawShapeWriteState,
): XmlElement {
  const out: XmlNode[] = [];
  let openList:
    { numId: string; entries: OdfListEntry[]; element: XmlElement } | undefined;

  const closeList = (): void => {
    if (openList === undefined) {
      return;
    }
    const kind = listKindOf(openList.numId);
    const built = writeOdfList(
      openList.entries,
      kind === undefined ? undefined : listStyleNameFor(kind, state),
    );
    openList.element.attributes = built.attributes;
    openList.element.children = built.children;
    openList = undefined;
  };

  for (const paragraph of paragraphs) {
    const element = writeOdfParagraph(paragraph, state.registry);
    const membership = paragraph.list;
    // planShapeContent has already canonicalised every membership it kept to carry a real numId (never a bare {level}), so this guard is equivalent to `membership === undefined` at runtime -- phrased via optional chaining, matching typed/odt/write.ts's own writeSectionBlocks, so TypeScript narrows membership.numId to a plain string for the rest of this iteration rather than needing a non-null assertion below.
    if (membership?.numId === undefined) {
      closeList();
      out.push(element);
      continue;
    }
    if (openList !== undefined && openList.numId !== membership.numId) {
      closeList();
    }
    if (openList === undefined) {
      const listElement = el("text:list");
      openList = { numId: membership.numId, entries: [], element: listElement };
      out.push(listElement);
    }
    openList.entries.push({ level: membership.level, element });
  }
  closeList();
  return el("draw:text-box", {}, out);
}

const PICTURES_DIRECTORY = "Pictures";

// draw:image, a direct child of the frame -- the exact mirror of typed/odt/write.ts's own writeImageFrame, minus the as-char anchor attributes that call is odt-specific: this frame carries real svg:x/y/width/height (or draw:transform) of its own, written by writeDrawFrame below, not the character-flow positioning an inline odt image uses.
function writeShapeImage(
  image: ContentImageBlock,
  state: DrawShapeWriteState,
): XmlNode[] {
  const extension = image.format === "png" ? "png" : "jpg";
  const path = `${PICTURES_DIRECTORY}/image${state.nextImage}.${extension}`;
  state.nextImage += 1;
  state.pkg.parts[path] = { kind: "binary", base64: image.base64 };
  const children: XmlNode[] = [
    el("draw:image", {
      "xlink:href": encodeXmlText(path),
      "xlink:type": "simple",
      "xlink:show": "embed",
      "xlink:actuate": "onLoad",
    }),
  ];
  if (image.altText !== undefined) {
    children.push(el("svg:title", {}, [txt(encodeXmlText(image.altText))]));
  }
  return children;
}

// --- the shape writer -----------------------------------------------------------------------------------------------

// --- paint order: ContentShape.paintOrder -> draw:z-index -----------------------------------------------------------
//
// draw:z-index is the ONE spelling ODF has for a shape's stacking order independent of its position in the document, and typed/draw/shapes.ts's own paintOrderKey already reads it back (see that module's own PAINT ORDER note for the schema citation -- xsd:nonNegativeInteger, valid on draw:frame -- and for the empirical finding that real LibreOffice output never emits it, relying on document order alone, which its own reader falls back to). Writing it is therefore not a new convention this module invents: typed/ods/write.ts's own anchored-drawing frames already carry one, and the odp/odg reader already resolves one.
//
// A paintOrder ODF cannot spell -- negative, fractional (ContentShapeSchema declares a plain z.number() deliberately, "to allow fractional insertion between two existing values later"), or too large to round-trip through JavaScript's own shortest-round-trip String() without switching to exponent notation (Number.isSafeInteger's own 2^53 bound, well under xsd:nonNegativeInteger's own unbounded range but the largest this codec's String(zIndex) call below can spell without repeating the exact "e" defect formatOdfLength's own expandExponential was written to close, see that function's own note) -- is NOT approximated by rounding it to a neighbouring integer: that would silently reorder a shape past a sibling, changing what the document renders as. The attribute is omitted instead, and the reader's own document-encounter fallback then supplies this shape's position in its page's own shape order, which is exactly what an unspelled paint order means. typed/odp/write.ts's canonicalShape states that fallback as part of its canonical form, reading it back off THIS function so the two can never disagree.
export function odfZIndexOf(
  paintOrder: number | undefined,
): number | undefined {
  if (
    paintOrder === undefined ||
    !Number.isSafeInteger(paintOrder) ||
    paintOrder < 0
  ) {
    return undefined;
  }
  return paintOrder;
}

// One ContentShape -> the draw:frame element typed/draw/shapes.ts's own readDrawFrame reads back: geometry (svg:x/y/width/height, or draw:transform when rotated), an interned graphic-family style carrying the shape's own text insets (when non-zero), and exactly one of table:table/draw:text-box/draw:image as decided by planShapeContent. `listState` is the caller's own ListPlanState (typed/shared/list.ts) -- see planShapeContent's own note on why this module never decides its own threading policy.
export function writeDrawFrame(
  shape: ContentShape,
  listState: ListPlanState,
  state: DrawShapeWriteState,
): XmlElement {
  const zIndex = odfZIndexOf(shape.paintOrder);
  const attributes: Record<string, string> = {
    ...(zIndex === undefined ? {} : { "draw:z-index": String(zIndex) }),
    ...frameGeometryAttrs(shape.frame, shape.rotationDeg),
  };
  if (shape.name !== undefined) {
    attributes["draw:name"] = encodeXmlText(shape.name);
  }
  const styleName = shapeGraphicStyleName(shape, state);
  if (styleName !== undefined) {
    attributes["draw:style-name"] = encodeXmlText(styleName);
  }

  const content = planShapeContent(shape.blocks, listState);
  const children: XmlNode[] =
    content.kind === "table"
      ? [
          writeOdfTable(
            content.table,
            state.registry,
            `DrawTable${state.nextTable++}`,
          ),
        ]
      : content.kind === "image"
        ? writeShapeImage(content.image, state)
        : [writeShapeTextBox(content.paragraphs, state)];

  return el("draw:frame", attributes, children);
}

// --- the canonical form: what reading a written draw:frame back produces --------------------------------------------
//
// One ContentShape in the exact shape reading the written document back produces: geometry/insets/name pass through verbatim (a ROTATED shape's own frame/rotationDeg survive only up to ordinary IEEE-754 floating-point rounding -- frameGeometryAttrs above is an exact algebraic inverse of resolveOdfShapeGeometry, but two independent trig evaluations on each side of a round trip are not guaranteed bit-identical, so this passes them through rather than predicting the exact float, and each format's own rotation suite compares them with an explicit numeric tolerance), and `blocks` is rebuilt from whichever of the three content kinds planShapeContent above resolves the INPUT's own blocks to -- the identical validation and list-numId canonicalisation writeDrawFrame itself runs, so this function and that one can never disagree about which shapes are writable at all. Lives here, beside the writer whose output it describes, so odp and odg state one canonical form rather than two that could drift.
//
// THE ONE FORCED FACT THIS FUNCTION RESTATES RATHER THAN PASSING THROUGH: an image's own widthPt/heightPt become the ENCLOSING SHAPE's frame widthPt/heightPt, never the input image block's own values. ODF's draw:image has no size of its own at all -- it is a bare content reference inside a draw:frame, and the frame's own svg:width/svg:height IS the rendered size (typed/draw/shapes.ts's own readDrawImageBlock note: "The image renders at the FRAME's own resolved size, not the source image's native pixel dimensions"). A caller-supplied image block whose width/height genuinely differ from its enclosing shape's frame is therefore not a smaller round trip, it is describing something ODF cannot express -- the frame wins, silently overriding the block's own stated size, exactly as reading the written document back will.
//
// PAINT ORDER is always present on the way back, never optional: the readers' own walkers stamp every frame they read (typed/draw/shapes.ts's paintOrderKey), so this canonical form states the same value. A paintOrder ODF can spell (a non-negative safe integer -- see odfZIndexOf above, which this reads the answer off rather than re-deriving) is written as draw:z-index and comes back exactly; anything else -- absent, negative, or fractional -- writes no attribute and comes back as the shape's own DOCUMENT-ENCOUNTER index, which the CALLER supplies as `documentIndex` because only the caller knows what its own page emits and in what order (odp emits one draw:frame per shape and nothing else, so a shape's index in its slide's own shapes array is its encounter index; odg emits its page's vectors after its shapes, so a shape's encounter index is still its array index but a vector's is offset past every shape -- see typed/odg/write.ts).
//
// THE FIVE FIELDS THIS FUNCTION DROPS, each named rather than left silent, matching typed/odt/write.ts's own normaliseOdtContent convention:
// - fontScale / lineSpacingReduction are DrawingML's own a:normAutofit percentages -- the font-shrink factor PowerPoint COMPUTED to make overflowing text fit, stored in the file (ooxml.js's src/typed/pptx/read.ts reads both). ODF stores no such computed factor anywhere: its own autofit vocabulary (draw:fit-to-size on the shape's graphic properties) is a MODE flag, saying that a consumer should shrink text to fit, not by how much. Writing it would therefore invent a fact the input never stated (a mode, from a factor) while still losing the factor, and this package's own reader reads nothing back from it -- so the loss is stated here instead of approximated. A real pptx -> odp conversion drops autofit shrink state, and this is the line that says so.
// - `sourcePath`, `source`, and `frames` are dropped for the reasons odt's own writer already gives for the identical fields (normaliseOdtContent names all three too): sourcePath is a READER's own diagnostic path (the writer has no document to have read it from), residue is quarantined, opaque text belonging to whichever format produced it -- re-emitting it into a different document would be actively wrong rather than merely incomplete -- and frames is a LAYOUT pass's own rendered-position record, which a writer that runs before any layout pass has none of to carry. Not a gap this writer introduces; existing, consistent precedent.
export function canonicalDrawShape(
  shape: ContentShape,
  documentIndex: number,
  listState: ListPlanState,
): ContentShape {
  const content = planShapeContent(shape.blocks, listState);
  const blocks: ContentBlock[] =
    content.kind === "table"
      ? [canonicalTable(content.table)]
      : content.kind === "image"
        ? [
            {
              ...canonicalImage(content.image),
              widthPt: shape.frame.widthPt,
              heightPt: shape.frame.heightPt,
            },
          ]
        : content.paragraphs.map((paragraph) =>
            canonicalParagraph(paragraph, paragraph.list?.numId),
          );
  const canonical: ContentShape = {
    frame: shape.frame,
    insetLeftPt: shape.insetLeftPt,
    insetTopPt: shape.insetTopPt,
    insetRightPt: shape.insetRightPt,
    insetBottomPt: shape.insetBottomPt,
    paintOrder: odfZIndexOf(shape.paintOrder) ?? documentIndex,
    blocks,
  };
  if (shape.name !== undefined) {
    canonical.name = shape.name;
  }
  // rotationDeg === 0 collapses to absent, the same collapse frameGeometryAttrs above applies on write (see its own note: resolveOdfShapeGeometry's read side already treats a net rotation of exactly zero as undefined).
  if (shape.rotationDeg !== undefined && shape.rotationDeg !== 0) {
    canonical.rotationDeg = shape.rotationDeg;
  }
  return canonical;
}

// Writes a whole page's (or slide's) own shapes in document order -- the convenience wrapper typed/odp/write.ts calls per slide and typed/odg/write.ts calls per drawing page, matching typed/draw/shapes.ts's own readDrawPageContent as the shared entry point on the read side. Vector primitives (draw:rect/ellipse/line/path/polygon/polyline/custom-shape) are NOT handled here: ContentShape carries none of them (that is ContentVector's own vocabulary, a ContentDrawPage-only concept per document-schema.js's own drawing content model), so typed/draw/write-vectors.ts's writeDrawVectors produces those alongside this function's own output, not through it.
export function writeDrawShapes(
  shapes: readonly ContentShape[],
  listState: ListPlanState,
  state: DrawShapeWriteState,
): XmlElement[] {
  return shapes.map((shape) => writeDrawFrame(shape, listState, state));
}
