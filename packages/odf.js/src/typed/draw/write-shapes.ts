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
  buildOdfListStyle,
  closeListPlan,
  listKindOf,
  planListMembership,
  writeOdfList,
  type ListPlanState,
  type OdfListEntry,
} from "../shared/list";

// The write-side mirror of typed/draw/shapes.ts's own readDrawFrame/walkDrawShapes: one ContentShape -> the draw:frame element those functions read back, shared between odp (typed/odp/write.ts, the first caller) and a future odg writer, exactly as the read side's own shapes.ts is shared between readOdp and readOdg (see typed/odg/read.ts's own FACTORING DECISION note for why the split sits here). What differs between the two formats on the write side -- odp's own document-wide list-numId threading versus a per-shape default, a slide's presentation:notes, a drawing page's own vector primitives -- stays in each format's own write.ts; this module owns only the one thing genuinely identical between them: turning a ContentShape into a real draw:frame.
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

// Validates and discriminates a shape's `blocks` into the one content kind its draw:frame will carry, canonicalising any paragraph-level list membership onto the SAME ListPlanState (typed/shared/list.ts) the caller threads across whatever scope its own format requires (odp threads one state across the whole presentation; a future odg writer may choose the same, or reset per shape -- this function does not decide that, it only ever reads the state it is given). Force-closes the plan's currently open run FIRST, unconditionally: a list can never structurally span two shapes (each is its own draw:text-box), so a caller must never see the previous shape's run silently continue into this one even if their raw numIds happen to coincide.
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
// The exact algebraic inverse of typed/shared/transform.ts's own resolveOdfShapeGeometry, derived (not guessed) from that module's own documented composition rule: a rotated frame is written as draw:transform="rotate(<radians>) translate(<tx> <ty>)", the SAME two-function, rotate-then-translate shape that module's own top-of-file note verifies empirically against real LibreOffice output. Solving resolveOdfShapeGeometry's own center/rotationDeg formulas for the translate() offset that reproduces a GIVEN frame+rotationDeg (rather than re-deriving the composition rule itself, which transform.ts already establishes) gives: angleRad = -rotationDeg * PI / 180                              (netRotationDeg's own inverse) tx = frame.xPt + W/2 - (W/2)*cos(angleRad) - (H/2)*sin(angleRad) ty = frame.yPt + H/2 - (H/2)*cos(angleRad) + (W/2)*sin(angleRad) Verified algebraically against resolveOdfShapeGeometry's own center computation and pinned by this module's own round-trip test suite (write-shapes.test.ts), which reads written output back through resolveOdfShapeGeometry directly. A rotated round trip is exact up to ordinary IEEE-754 floating-point rounding (two trig evaluations, not a lossy approximation), which is why rotationDeg===0 is treated identically to rotationDeg===undefined below: resolveOdfShapeGeometry's own read side already collapses a net rotation of exactly zero to undefined (see its own "rotationDeg === 0 ? undefined : rotationDeg"), so writing a rotate(0) transform for a literal 0 input would round-trip to undefined and silently fail a strict equality check -- treating the two alike here is this writer's OWN half of that same collapse, not a new approximation.
function frameGeometryAttrs(
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

// One ContentShape -> the draw:frame element typed/draw/shapes.ts's own readDrawFrame reads back: geometry (svg:x/y/width/height, or draw:transform when rotated), an interned graphic-family style carrying the shape's own text insets (when non-zero), and exactly one of table:table/draw:text-box/draw:image as decided by planShapeContent. `listState` is the caller's own ListPlanState (typed/shared/list.ts) -- see planShapeContent's own note on why this module never decides its own threading policy.
export function writeDrawFrame(
  shape: ContentShape,
  listState: ListPlanState,
  state: DrawShapeWriteState,
): XmlElement {
  const attributes: Record<string, string> = {
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

// Writes a whole page's (or slide's) own shapes in document order -- the convenience wrapper typed/odp/write.ts calls per slide and a future odg writer will call per drawing page, matching typed/draw/shapes.ts's own readDrawPageContent as the shared entry point on the read side. Vector primitives (draw:rect/ellipse/line/path/polygon/polyline/custom-shape) are NOT handled here: ContentShape carries none of them (that is ContentVector's own vocabulary, a ContentDrawPage-only concept per document-schema.js's own drawing content model), so a future odg writer producing those will do so alongside this function's own output, not through it.
export function writeDrawShapes(
  shapes: readonly ContentShape[],
  listState: ListPlanState,
  state: DrawShapeWriteState,
): XmlElement[] {
  return shapes.map((shape) => writeDrawFrame(shape, listState, state));
}
