import type {
  Box,
  ContentBlock,
  ContentDocument,
  ContentShape,
  ContentSlide,
  DocumentTree,
  LayoutMetadata,
  PageSize,
} from "document-schema.js";
import { flattenTree, PAGE_SIZE_A4 } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { ODF_MEDIA_TYPES } from "../../media-type";
import { syncManifest } from "../../manifest";
import {
  createOdfPackage,
  odfPartContainer,
  DEFAULT_ODF_VERSION,
} from "../../package-io/scaffold";
import { StyleRegistry } from "../../styles/registry";
import { el } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { formatOdfLength } from "../shared/units";
import { writeOdfMetadata } from "../shared/metadata";
import { buildOdfInlineNodes, segmentOdfText } from "../shared/text";
import type { ListPlanState } from "../shared/list";
import {
  canonicalImage,
  canonicalParagraph,
  canonicalTable,
} from "../shared/canonicalise";
import {
  createDrawShapeWriteState,
  planShapeContent,
  writeDrawShapes,
} from "../draw/write-shapes";

// ContentDocument (the 'presentation' arm) -> a real .odp Package: the inverse of typed/odp/read.ts, and this package's third content WRITER, following the same discipline typed/odt/write.ts's own top-of-file note states in full (read that file first -- this one restates only what differs). Every mapping below is stated as the exact inverse of the corresponding read in typed/odp/read.ts, and the correctness property this writer is held to is the same one every writer in this family is held to: its own package reads back as the document it was given (see normaliseOdpContent below for the one canonical form that equality is stated against, and write.test.ts / write-round-trip.test.ts for both halves).
//
// WHAT'S GENUINELY NEW HERE, beyond odt's own three forced facts (no direct formatting, no standalone page break, whitespace as structure -- all three still apply, inherited via typed/shared/canonicalise.ts and typed/draw/write-shapes.ts): a PRESENTATION has no office:text body flow at all -- its content is a sequence of draw:page elements, each carrying POSITIONED shapes (draw:frame, geometry-first) rather than flowed blocks, plus its own presentation:notes and its own page geometry (a presentation genuinely allows different slides to reference different master pages/page-layouts, unlike OOXML's single document-level p:sldSz -- see typed/odp/read.ts's own readSlideSize note). This module's own job is therefore: one style:master-page + style:page-layout pair per slide (mirroring odt's one per section, never deduplicated across slides for the same reason odt never deduplicates across sections), a draw:page wrapping that slide's own shapes (delegated entirely to typed/draw/write-shapes.ts's writeDrawShapes -- the shared shape writer this format's own write path exists to prove out for a later odg writer), and a presentation:notes built from ContentSlide.notes.
//
// WHAT THIS WRITER DOES NOT WRITE, and why it refuses rather than dropping: every shape/paragraph-level fidelity constraint typed/draw/write-shapes.ts's own planShapeContent already refuses by name (a run-level construct extent, an embedded object, a construct boundary marker, a heading inside a shape's own text, a page break inside a shape's own text, a table or image mixed with other shape content) applies here unchanged, since this module calls that shared validation rather than re-deriving it. Beyond that: a slide's own `source` residue (the transition/animation/sound facts typed/odp/read.ts quarantines) is dropped, the same deliberate exception odt's own residue channel makes -- residue is opaque by construction, so re-emitting it would be actively wrong rather than merely incomplete. `.odg` (drawings) and `.sxi` (the OpenOffice.org 1.x presentation format, which needs this writer to invert its own transform against) are NOT covered by this module -- both are separate, tracked follow-up work built on top of what this module and typed/draw/write-shapes.ts establish.

const CONTENT_PART = "content.xml";
const STYLES_PART = "styles.xml";

export interface OdpWriteOptions {
  // The ODF version stamped on each part's office:version and on the manifest. Defaults to the current standard.
  readonly version?: string;
}

// --- the canonical form: what reading this writer's own output back produces ----------------------------------------
//
// Metadata, per-shape content, and a nested table/image are all canonicalised through typed/shared/canonicalise.ts, the exact same statement typed/odt/write.ts's own normaliseOdtContent already makes for those pieces -- restated here only for what genuinely differs at the presentation level.
//
// ONE THING THIS CANONICAL FORM DELIBERATELY DOES NOT STATE, and cannot: a ROTATED shape's own frame/rotationDeg survive a write-then-read round trip only up to ordinary IEEE-754 floating-point rounding (typed/draw/write-shapes.ts's own frameGeometryAttrs is an exact algebraic inverse of typed/shared/transform.ts's resolveOdfShapeGeometry, not an approximation, but two independent trig evaluations on each side of the round trip are not guaranteed bit-identical). canonicalShape below passes a shape's own frame/rotationDeg through VERBATIM rather than attempting to predict the exact float a real round trip will produce -- write-round-trip.test.ts's own rotated-shape cases compare geometry with an explicit numeric tolerance instead of the blanket structural-equality helper every other case uses, and this canonicaliser is what they run that comparison against on both sides.
function canonicalMetadata(metadata: LayoutMetadata): LayoutMetadata {
  const canonical: LayoutMetadata = {};
  if (metadata.title !== undefined) {
    canonical.title = metadata.title;
  }
  if (metadata.author !== undefined) {
    canonical.author = metadata.author;
  }
  if (metadata.subject !== undefined) {
    canonical.subject = metadata.subject;
  }
  if (metadata.keywords !== undefined && metadata.keywords.length > 0) {
    canonical.keywords = [...metadata.keywords];
  }
  if (metadata.creator !== undefined) {
    canonical.creator = metadata.creator;
  }
  if (metadata.createdIso !== undefined) {
    canonical.createdIso = metadata.createdIso;
  }
  if (metadata.modifiedIso !== undefined) {
    canonical.modifiedIso = metadata.modifiedIso;
  }
  return canonical;
}

// One ContentShape in the exact shape reading the written document back produces: geometry/insets/name pass through verbatim (see this module's own top-of-file note on rotationDeg's floating-point caveat specifically), and `blocks` is rebuilt from whichever of the three content kinds planShapeContent (typed/draw/write-shapes.ts) resolves the INPUT's own blocks to -- the identical validation and list-numId canonicalisation the writer itself runs, so this function and writeDrawFrame can never disagree about which shapes are writable at all.
//
// THE ONE FORCED FACT THIS FUNCTION RESTATES RATHER THAN PASSING THROUGH: an image's own widthPt/heightPt become the ENCLOSING SHAPE's frame widthPt/heightPt, never the input image block's own values. ODF's draw:image has no size of its own at all -- it is a bare content reference inside a draw:frame, and the frame's own svg:width/svg:height IS the rendered size (typed/draw/shapes.ts's own readDrawImageBlock note: "The image renders at the FRAME's own resolved size, not the source image's native pixel dimensions"). A caller-supplied image block whose width/height genuinely differ from its enclosing shape's frame is therefore not a smaller round trip, it is describing something ODF cannot express -- the frame wins, silently overriding the block's own stated size, exactly as reading the written document back will.
function canonicalShape(
  shape: ContentShape,
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
    blocks,
  };
  if (shape.name !== undefined) {
    canonical.name = shape.name;
  }
  // rotationDeg === 0 collapses to absent, the same collapse writeDrawFrame's own frameGeometryAttrs applies on write (see typed/draw/write-shapes.ts's own note: resolveOdfShapeGeometry's read side already treats a net rotation of exactly zero as undefined).
  if (shape.rotationDeg !== undefined && shape.rotationDeg !== 0) {
    canonical.rotationDeg = shape.rotationDeg;
  }
  return canonical;
}

function canonicalSlide(
  slide: ContentSlide,
  listState: ListPlanState,
): ContentSlide {
  return {
    size: slide.size,
    shapes: slide.shapes.map((shape) => canonicalShape(shape, listState)),
    notes: slide.notes,
  };
}

// The return type is the presentation arm specifically rather than the whole ContentDocument union: this function accepts any document so it can refuse a wrong-kind one by name, but it only ever RETURNS a presentation one, sparing every caller a re-narrowing step over a fact that is already settled -- matching normaliseOdtContent's own convention.
export function normaliseOdpContent(
  document: ContentDocument,
): Extract<ContentDocument, { kind: "presentation" }> {
  if (document.kind !== "presentation") {
    throw new Error(
      `normaliseOdpContent: expected a 'presentation' document, got '${document.kind}'`,
    );
  }
  const listState: ListPlanState = { next: 1 };
  return {
    kind: "presentation",
    metadata: canonicalMetadata(document.metadata),
    slides: document.slides.map((slide) => canonicalSlide(slide, listState)),
  };
}

// --- the writer -----------------------------------------------------------------------------------------------------

// One slide's own style:page-layout, mirroring typed/odt/write.ts's own pageLayoutElement minus margins -- ContentSlide carries no margins concept at all (a presentation's own shapes are positioned absolutely, never flowed inside a margin box the way an odt paragraph is).
function slidePageLayoutElement(name: string, pageSize: PageSize): XmlElement {
  return el("style:page-layout", { "style:name": encodeXmlText(name) }, [
    el("style:page-layout-properties", {
      "fo:page-width": formatOdfLength(pageSize.widthPt),
      "fo:page-height": formatOdfLength(pageSize.heightPt),
      "style:print-orientation":
        pageSize.widthPt > pageSize.heightPt ? "landscape" : "portrait",
    }),
  ]);
}

// The speaker-notes text frame's own placeholder position/size. readSlideNotes (typed/odp/read.ts) never inspects this frame's own geometry at all -- it deep-searches for text:p anywhere under presentation:notes regardless of position -- so this geometry has no bearing on round-trip correctness through this package's own reader; it exists purely to keep the written frame valid, real-consumer-renderable ODF (verified against real LibreOffice -- see the package README's own LibreOffice-verification section), sized as a typical notes-page text placeholder occupying the lower half of an A4-portrait notes page. A real LibreOffice-authored notes page positions its own text box against a SEPARATE notes-page master/layout this writer does not model, since ContentSlide carries no notes-page geometry of its own to write.
const NOTES_FRAME_BOX: Box = { xPt: 42, yPt: 320, widthPt: 500, heightPt: 260 };

// presentation:notes carries its own style:page-layout-name, matching every real LibreOffice-produced notes page (confirmed against real LibreOffice 26.2 output: a notes page is sized for PRINTING and always references a page-layout of its own, independent of whatever on-screen size each slide's own page-layout states -- so there is exactly one notes geometry for the whole presentation, not one per slide). notesPageLayoutState mints it lazily, the first time any slide actually has notes to write, so a presentation with no speaker notes at all never carries an unused page-layout.
//
// A KNOWN, NAMED GAP rather than a silent one: this writer's presentation:notes is well-formed per the OASIS schema and parses through real LibreOffice with no error and no data loss (soffice --headless --convert-to fodp preserves the notes TEXT byte-for-byte -- see the package README's own LibreOffice-verification section for the exact commands and output) -- but LibreOffice's own AutoLayout placeholder-matching does not bind this writer's minimal presentation:notes/draw:frame to its internal Notes view the way a placeholder frame carrying LibreOffice's own internal presentation-page-layout machinery would; instead it re-homes the frame's content onto the slide's own visible shape list on import, alongside a separately synthesised, empty notes placeholder of LibreOffice's own. Reproduced across several attempted fixes (style:page-layout-name alone, presentation:class="notes", presentation:placeholder="true", a minted presentation-family style referenced by presentation:style-name under both a generic and a master-page-matching name, an explicit draw:layer-set with draw:layer="backgroundobjects", and moving the element earlier in draw:page's own child order) -- none, alone, changed the outcome, and LibreOffice's own placeholder-binding heuristic for AutoLayout slides is undocumented in the OASIS schema itself, so further narrowing needs either a primary LibreOffice source-level investigation or a real Impress-authored notes-page fixture to diff against byte-for-byte, both out of scope for this PR. ContentSlide.notes carries no placeholder-kind information for a future fix to model against, either, so this is tracked as a follow-up rather than attempted further here.
interface NotesPageLayoutState {
  name: string | undefined;
}

function notesPageLayoutName(
  state: NotesPageLayoutState,
  stylesAutomaticStyles: XmlElement,
): string {
  if (state.name !== undefined) {
    return state.name;
  }
  const name = "PM0";
  state.name = name;
  stylesAutomaticStyles.children.push(
    el("style:page-layout", { "style:name": name }, [
      el("style:page-layout-properties", {
        "fo:page-width": formatOdfLength(PAGE_SIZE_A4.widthPt),
        "fo:page-height": formatOdfLength(PAGE_SIZE_A4.heightPt),
        "style:print-orientation": "portrait",
      }),
    ]),
  );
  return name;
}

// presentation:notes -> a draw:frame > draw:text-box carrying one text:p per line of ContentSlide.notes, mirroring the "typically" structure typed/odp/read.ts's own readSlideNotes documents real LibreOffice output taking. Undefined for empty notes: readSlideNotes already returns "" for a draw:page with no presentation:notes element at all, so an empty string needs no element written to round-trip. Splitting on "\n" rather than writing one text:line-break-carrying paragraph is a free choice, not a forced one -- readSlideNotes's own decodeOdfText already converts an EMBEDDED text:line-break to "\n" exactly as it converts a paragraph boundary to "\n" via its own join, so either representation reads back identical; one text:p per line is what real Impress output actually looks like.
function writeSlideNotes(
  notes: string,
  state: NotesPageLayoutState,
  stylesAutomaticStyles: XmlElement,
): XmlElement | undefined {
  if (notes.length === 0) {
    return undefined;
  }
  const paragraphs = notes
    .split("\n")
    .map((line) =>
      el("text:p", {}, buildOdfInlineNodes(segmentOdfText(line, true, true))),
    );
  const frame = el(
    "draw:frame",
    {
      "presentation:class": "notes",
      "svg:x": formatOdfLength(NOTES_FRAME_BOX.xPt),
      "svg:y": formatOdfLength(NOTES_FRAME_BOX.yPt),
      "svg:width": formatOdfLength(NOTES_FRAME_BOX.widthPt),
      "svg:height": formatOdfLength(NOTES_FRAME_BOX.heightPt),
    },
    [el("draw:text-box", {}, paragraphs)],
  );
  return el(
    "presentation:notes",
    {
      "style:page-layout-name": notesPageLayoutName(
        state,
        stylesAutomaticStyles,
      ),
    },
    [frame],
  );
}

// Package assembly. The order matters in one place only, matching writeOdtContent's own note: the style registry is constructed over content.xml AFTER the package skeleton exists and BEFORE any shape is written, since interning appends to the very office:automatic-styles container the skeleton created.
export function writeOdpContent(
  document: ContentDocument,
  options: OdpWriteOptions = {},
): Package {
  if (document.kind !== "presentation") {
    throw new Error(
      `writeOdpContent: expected a 'presentation' document, got '${document.kind}' -- odf.js writes .odp from the presentation arm only`,
    );
  }
  const version = options.version ?? DEFAULT_ODF_VERSION;
  const presentationElement = el("office:presentation");
  const pkg = createOdfPackage(
    ODF_MEDIA_TYPES.odp,
    presentationElement,
    version,
  );

  const registry = StyleRegistry.forPart(pkg, CONTENT_PART, {
    otherPart: { pkg, partPath: STYLES_PART },
  });
  const contentAutomaticStyles = odfPartContainer(
    pkg,
    CONTENT_PART,
    "office:automatic-styles",
  );
  const stylesAutomaticStyles = odfPartContainer(
    pkg,
    STYLES_PART,
    "office:automatic-styles",
  );
  const masterStyles = odfPartContainer(
    pkg,
    STYLES_PART,
    "office:master-styles",
  );

  const shapeState = createDrawShapeWriteState(
    pkg,
    registry,
    contentAutomaticStyles,
  );
  // One counter across the WHOLE presentation, matching readOdpContent's own listIdState threading (typed/odp/read.ts) -- two lists on different slides must mint different identities exactly as two lists in different sections of one odt body do.
  const listState: ListPlanState = { next: 1 };
  const notesPageLayout: NotesPageLayoutState = { name: undefined };

  document.slides.forEach((slide, index) => {
    const masterPageName = `MP${index + 1}`;
    const pageLayoutName = `PM${index + 1}`;
    stylesAutomaticStyles.children.push(
      slidePageLayoutElement(pageLayoutName, slide.size),
    );
    masterStyles.children.push(
      el("style:master-page", {
        "style:name": encodeXmlText(masterPageName),
        "style:page-layout-name": encodeXmlText(pageLayoutName),
      }),
    );

    const shapeElements = writeDrawShapes(slide.shapes, listState, shapeState);
    const notesElement = writeSlideNotes(
      slide.notes,
      notesPageLayout,
      stylesAutomaticStyles,
    );
    const children: XmlNode[] = [...shapeElements];
    if (notesElement !== undefined) {
      children.push(notesElement);
    }
    presentationElement.children.push(
      el(
        "draw:page",
        { "draw:master-page-name": encodeXmlText(masterPageName) },
        children,
      ),
    );
  });

  writeOdfMetadata(pkg, document.metadata, version);
  syncManifest(pkg, { version });
  return pkg;
}

// DocumentTree -> a real .odp Package: this module's PRIMARY entry point, and the exact mirror of writeOdt's own relationship to writeOdtContent. The tree is flattened through document-schema.js's own flattenTree -- the inverse of the assembleTree readOdp calls -- so a tree read from one .odp and written back out crosses the package boundary exactly once in each direction, with every style ref resolved on the way out.
export function writeOdp(
  document: DocumentTree,
  options: OdpWriteOptions = {},
): Package {
  return writeOdpContent(flattenTree(document), options);
}
