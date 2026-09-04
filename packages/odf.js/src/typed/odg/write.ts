import type {
  ContentDocument,
  ContentDrawPage,
  ContentShape,
  ContentVector,
  DocumentTree,
  PageSize,
} from "document-schema.js";
import { flattenTree } from "document-schema.js";
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
import { canonicalMetadata } from "../shared/canonicalise";
import type { ListPlanState } from "../shared/list";
import {
  canonicalDrawShape,
  createDrawShapeWriteState,
  writeDrawShapes,
} from "../draw/write-shapes";
import { canonicalDrawVector, writeDrawVectors } from "../draw/write-vectors";

// ContentDocument (the 'drawing' arm) -> a real .odg Package: the inverse of typed/odg/read.ts, and this package's fourth content WRITER, following the same discipline typed/odt/write.ts's own top-of-file note states in full (read that file first -- this one restates only what differs). The correctness property is the one every writer in this family is held to: its own package reads back as the document it was given (see normaliseOdgContent below for the canonical form that equality is stated against, and write.test.ts / write-round-trip.test.ts for both halves).
//
// WHAT IS SHARED WITH odp RATHER THAN REBUILT: a drawing's own draw:page content model is structurally identical to a presentation's (typed/odg/read.ts's own top-of-file note states the evidence for that -- one format-agnostic schema fragment, verified against a real .odg), so this module reuses the same three pieces the odp writer already established and adds nothing of its own to them: typed/draw/write-shapes.ts's writeDrawShapes for a page's own text-in-a-frame shapes, its canonicalDrawShape for what reading one back produces, and the same style:master-page/style:page-layout-per-page structure (never deduplicated across pages, for the same reason odt never deduplicates across sections: ODF genuinely allows different pages to reference different geometry, and a writer that shared one layout would silently normalise a document that used two).
//
// WHAT IS GENUINELY NEW HERE, and the whole reason this module exists rather than a `kind` argument to writeOdpContent: a drawing page carries VECTOR PRIMITIVES -- ContentDrawPage's own `vectors` array, a second sibling array beside `shapes`, holding rect/ellipse/line/path values that a ContentShape has no vocabulary for at all. Writing them is typed/draw/write-vectors.ts's job (see that module for every attribute name and every refusal); placing them, ordering them, and stating what reading them back produces is this module's.
//
// WHAT THIS FORMAT DOES NOT HAVE, so this writer is smaller than odp's rather than larger: there is no notes concept (presentation:notes is a slide's, and ContentDrawPage carries no notes field), and no fidelity-construct vocabulary of its own -- readOdgContent reads neither. The shape-level refusals still apply verbatim, since they come from typed/draw/write-shapes.ts's planShapeContent rather than from anything odp-specific: a run-level construct extent, an embedded object, a construct boundary marker, a heading or a page break inside a shape's own text, and a table or image mixed with other shape content. A page's own `source` residue (the unmapped shape kinds and vendor-extension elements typed/odg/read.ts quarantines) is dropped, the same deliberate exception every other writer here makes -- residue is opaque by construction, so re-emitting it would be actively wrong rather than merely incomplete.
//
// `.sxd` (the OpenOffice.org 1.x drawing format) is NOT covered by this module. It needs exactly what `.sxw`/`.sxc`/`.sxi` needed of their own ODF writers -- this writer's output run through transformToOoo1Package -- and is tracked as its own follow-up rather than built here.

const CONTENT_PART = "content.xml";
const STYLES_PART = "styles.xml";

export interface OdgWriteOptions {
  // The ODF version stamped on each part's office:version and on the manifest. Defaults to the current standard.
  readonly version?: string;
}

// --- the canonical form: what reading this writer's own output back produces ----------------------------------------
//
// Metadata is canonicalised through typed/shared/canonicalise.ts and a shape through typed/draw/write-shapes.ts's canonicalDrawShape, both shared verbatim with the other writers here; a vector through typed/draw/write-vectors.ts's canonicalDrawVector. Each of those states its own forced facts and its own named drops, and this module restates none of them -- what follows is only what is genuinely the DRAWING PAGE's own.
//
// THE TWO PAGE-LEVEL FACTS THIS CANONICAL FORM STATES, both forced by readDrawPageContent (typed/draw/shapes.ts) rather than chosen here:
//
// 1. DOCUMENT-ENCOUNTER ORDER SPANS BOTH ARRAYS. The reader walks a draw:page's children ONCE, with a single monotonic counter, stamping every shape and every vector it meets; an element carrying no draw:z-index takes its own position in that one walk. This writer emits a page's shapes first (one draw:frame each, in `shapes` array order) and then its vectors (in `vectors` array order), so a shape's encounter index is its index in `shapes` and a vector's is `shapes.length` plus its index in `vectors` -- which is exactly what this function passes as each item's `documentIndex`. The shapes-before-vectors emit order is this writer's own choice and is stated rather than implied: ContentDrawPage's two arrays carry no interleaving information beyond paintOrder itself, so a page whose items state no paint order at all has no cross-array order for a writer to preserve, and one has to be picked. Any item that DOES state an ODF-spellable paintOrder carries a real draw:z-index and is therefore ordered by that, not by where it was emitted -- which is what makes the choice a tiebreak for the unspelled case rather than a reordering of a stated one.
//
// 2. BOTH ARRAYS COME BACK SORTED BY PAINT ORDER. readDrawPageContent's own byPaintOrder sorts each of its two output arrays before returning them (a stable sort, so equal keys keep their walk order), which is the one structural difference between this canonical form and odp's: walkDrawShapes stamps a paint order but never reorders, because a slide has no sibling vectors array for the value to be comparable across. A drawing page does, so the reader sorts -- and a document whose input arrays are not already in paint order therefore comes back reordered, exactly as stated here.
function sortByPaintOrder<T extends { readonly paintOrder?: number }>(
  items: readonly T[],
): T[] {
  return items
    .slice()
    .sort((a, b) => (a.paintOrder ?? 0) - (b.paintOrder ?? 0));
}

function canonicalPage(
  page: ContentDrawPage,
  listState: ListPlanState,
): ContentDrawPage {
  const shapes: ContentShape[] = page.shapes.map((shape, index) =>
    canonicalDrawShape(shape, index, listState),
  );
  const vectors: ContentVector[] = page.vectors.map((vector, index) =>
    canonicalDrawVector(vector, page.shapes.length + index),
  );
  return {
    size: page.size,
    shapes: sortByPaintOrder(shapes),
    vectors: sortByPaintOrder(vectors),
  };
}

// The return type is the drawing arm specifically rather than the whole ContentDocument union: this function accepts any document so it can refuse a wrong-kind one by name, but it only ever RETURNS a drawing one, sparing every caller a re-narrowing step over a fact that is already settled -- matching normaliseOdtContent's own convention.
export function normaliseOdgContent(
  document: ContentDocument,
): Extract<ContentDocument, { kind: "drawing" }> {
  if (document.kind !== "drawing") {
    throw new Error(
      `normaliseOdgContent: expected a 'drawing' document, got '${document.kind}'`,
    );
  }
  const listState: ListPlanState = { next: 1 };
  return {
    kind: "drawing",
    metadata: canonicalMetadata(document.metadata),
    pages: document.pages.map((page) => canonicalPage(page, listState)),
  };
}

// --- the writer -----------------------------------------------------------------------------------------------------

// One page's own style:page-layout, identical to typed/odp/write.ts's own slidePageLayoutElement: ContentDrawPage carries no margins concept either (a drawing's own content is positioned absolutely, never flowed inside a margin box), and resolveDrawPageSize -- the shared master-page chain typed/shared/masterpage.ts owns, which readOdgContent and readOdpContent both walk -- reads back exactly the two fo:page-* attributes written here.
function drawPageLayoutElement(name: string, pageSize: PageSize): XmlElement {
  return el("style:page-layout", { "style:name": encodeXmlText(name) }, [
    el("style:page-layout-properties", {
      "fo:page-width": formatOdfLength(pageSize.widthPt),
      "fo:page-height": formatOdfLength(pageSize.heightPt),
      "style:print-orientation":
        pageSize.widthPt > pageSize.heightPt ? "landscape" : "portrait",
    }),
  ]);
}

// Package assembly. The order matters in one place only, matching writeOdtContent's own note: the style registry is constructed over content.xml AFTER the package skeleton exists and BEFORE any shape or vector is written, since interning appends to the very office:automatic-styles container the skeleton created.
export function writeOdgContent(
  document: ContentDocument,
  options: OdgWriteOptions = {},
): Package {
  if (document.kind !== "drawing") {
    throw new Error(
      `writeOdgContent: expected a 'drawing' document, got '${document.kind}' -- odf.js writes .odg from the drawing arm only`,
    );
  }
  const version = options.version ?? DEFAULT_ODF_VERSION;
  const drawingElement = el("office:drawing");
  const pkg = createOdfPackage(ODF_MEDIA_TYPES.odg, drawingElement, version);

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
  // One counter across the WHOLE drawing, matching readOdpContent's own document-wide threading of the same state: two lists on different pages must mint different identities exactly as two lists in different sections of one odt body do.
  const listState: ListPlanState = { next: 1 };

  document.pages.forEach((page, index) => {
    const masterPageName = `MP${index + 1}`;
    const pageLayoutName = `PM${index + 1}`;
    stylesAutomaticStyles.children.push(
      drawPageLayoutElement(pageLayoutName, page.size),
    );
    masterStyles.children.push(
      el("style:master-page", {
        "style:name": encodeXmlText(masterPageName),
        "style:page-layout-name": encodeXmlText(pageLayoutName),
      }),
    );

    // Shapes first, then vectors -- the emit order normaliseOdgContent's own note states in full, and the order its documentIndex arithmetic is the exact counterpart of.
    const children: XmlNode[] = [
      ...writeDrawShapes(page.shapes, listState, shapeState),
      ...writeDrawVectors(page.vectors, shapeState),
    ];
    drawingElement.children.push(
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

// DocumentTree -> a real .odg Package: this module's PRIMARY entry point, and the exact mirror of writeOdp's own relationship to writeOdpContent. The tree is flattened through document-schema.js's own flattenTree -- the inverse of the assembleTree readOdg calls -- so a tree read from one .odg and written back out crosses the package boundary exactly once in each direction, with every style ref resolved on the way out.
export function writeOdg(
  document: DocumentTree,
  options: OdgWriteOptions = {},
): Package {
  return writeOdgContent(flattenTree(document), options);
}
