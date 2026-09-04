import type {
  ContentBlock,
  ContentDocument,
  ContentImageBlock,
  ContentPageBreak,
  ContentParagraph,
  ContentSection,
  ContentTable,
  DocumentTree,
  Margins,
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
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { formatOdfLength } from "../shared/units";
import { writeOdfMetadata } from "../shared/metadata";
import { writeOdfParagraph } from "../shared/paragraph";
import { writeOdfTable } from "../shared/table";
import {
  canonicalImage,
  canonicalMetadata,
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

// ContentDocument (the 'wordprocessing' arm) -> a real .odt Package: the inverse of typed/odt/read.ts, and the first content WRITER in this package's typed layer, which was read-only until now. Every mapping below is stated as the exact inverse of the corresponding read in that module rather than as an independent idea of what an .odt should look like, because the correctness property this writer is actually held to is that its own package reads back as the document it was given (see normaliseOdtContent below for the one canonical form that equality is stated against, and write.test.ts / write-round-trip.test.ts for both halves).
//
// THE THREE THINGS ODF FORCES ON A WRITER, none of which a docx writer faces:
// 1. NO DIRECT FORMATTING. A run cannot carry bold; it must reference a named automatic style that does. Every formatting difference therefore goes through StyleRegistry (src/styles/registry.ts) -- the same interning layer the reader's own adoption rules are written against -- so two identically-formatted runs anywhere in the document reference one style rather than minting one each.
// 2. NO STANDALONE PAGE BREAK, AND NO SECTION ELEMENT. A page break is fo:break-before on a paragraph style, and a change of page geometry is a paragraph style naming a different style:master-page. ContentSection's own boundary is therefore written as a master-page switch on the first paragraph of each section after the first, which is exactly the switch readOdtContent splits sections at.
// 3. WHITESPACE IS STRUCTURE. A run of two or more spaces, a tab, and a line break are elements, not characters (see typed/shared/text.ts). A run whose text contains one is split at it, because ODF has no spelling that would keep it whole.
//
// WHAT THIS WRITER DOES NOT WRITE, and why it refuses rather than dropping: the fidelity constructs readOdtContent reads (fields, bookmarks, notes, annotations, tracked changes, divisions, index wrappers, forms) and embedded objects are semantic content, so writing a document that silently lost them would be worse than not writing it at all -- a block or paragraph carrying one is refused by name (see assertWritableBlock/assertWritableParagraph). The quarantined residue channel is the one deliberate exception to that stance: residue is opaque by construction and re-emitting a paragraph's own style-chain residue into the paragraph would be actively wrong, so it is dropped, stated in normaliseOdtContent, and tracked as the restorable-fidelity gap it is.

const CONTENT_PART = "content.xml";
const STYLES_PART = "styles.xml";
const PICTURES_DIRECTORY = "Pictures";

export interface OdtWriteOptions {
  // The ODF version stamped on each part's office:version and on the manifest. Defaults to the current standard.
  readonly version?: string;
  // Stamps the package as a document template (ODF_MEDIA_TYPES.ott) rather than a regular document (ODF_MEDIA_TYPES.odt) -- the "mimetype" part and the manifest root entry syncManifest derives from it, both of which createOdfPackage/syncManifest already key off whatever media type is passed in. Nothing else about the writer's own output changes: ODF makes no other structural distinction between a document and its template. Defaults to false.
  readonly template?: boolean;
}

// --- the block plan: one description of an .odt's block flow, shared by the writer and the normaliser -------------
//
// Three of ODF's structural facts are not expressible in the flat block list a caller hands in, so the writer has to restate that list before it can emit anything: a page break has to land ON a paragraph, an anchored image has to hang OFF one, and a section boundary has to be carried BY one. Planning that restatement once, here, is what lets normaliseOdtContent state the canonical form exactly -- the normaliser and the writer read the same plan, so they can never disagree about what the writer will produce.

interface PlannedParagraph {
  readonly kind: "paragraph";
  readonly paragraph: ContentParagraph;
}

interface PlannedTable {
  readonly kind: "table";
  readonly table: ContentTable;
}

interface PlannedImage {
  readonly kind: "image";
  readonly image: ContentImageBlock;
}

type PlannedBlock = PlannedParagraph | PlannedTable | PlannedImage;

interface PlannedSection {
  readonly pageSize: PageSize;
  readonly margins: Margins;
  readonly blocks: PlannedBlock[];
}

// The list-identity counter one document's plan threads: readOdtContent mints a numId per top-level text:list encountered in document order across the WHOLE body, so the plan has to number lists the same way -- once per maximal run of consecutive list paragraphs sharing an incoming numId, across sections, never per distinct numId string (two separate runs carrying one numId are two ODF lists, and the reader will say so). ListPlanState/planListMembership/closeListPlan/listKindOf/canonicalNumId are shared with typed/odp/write.ts (typed/shared/list.ts's own top-of-file note on the write-side canonicalisation both formats need identically) rather than redeclared here.

function unsupported(what: string, where: string): Error {
  return new Error(
    `writeOdt: ${where} carries ${what}, which this writer does not write yet -- refusing rather than producing an .odt that silently lost it. See ExaDev/documents.js for the tracked follow-up covering the fidelity constructs and embedded objects.`,
  );
}

function assertWritableParagraph(paragraph: ContentParagraph): void {
  if (paragraph.constructs !== undefined && paragraph.constructs.length > 0) {
    throw unsupported(
      "run-level construct extents (a field, bookmark, note, annotation, or tracked change)",
      "a paragraph",
    );
  }
}

// An assertion signature rather than a plain check, so the walk below narrows to exactly the four block kinds this writer knows how to place without a second, redundant test for the kinds this one already refused.
function assertWritableBlock(
  block: ContentBlock,
): asserts block is
  ContentParagraph | ContentTable | ContentImageBlock | ContentPageBreak {
  if (block.kind === "constructStart" || block.kind === "constructEnd") {
    throw unsupported("a construct boundary marker", "a section's block flow");
  }
  if (block.kind === "embeddedObject") {
    throw unsupported("an embedded object", "a section's block flow");
  }
  if (block.kind === "paragraph") {
    assertWritableParagraph(block);
  }
}

// canonicalParagraph (headingLevel/alignment/list/spacing/indent/pageBreak, run segmentation and colour quantisation) now lives in typed/shared/canonicalise.ts, reused verbatim by typed/odp/write.ts for a shape's own text paragraphs and a table nested inside a shape -- see that module's own top-of-file note.

function emptyAnchorParagraph(pageBreakBefore: boolean): ContentParagraph {
  return pageBreakBefore
    ? { kind: "paragraph", runs: [], pageBreakBefore: true }
    : { kind: "paragraph", runs: [] };
}

// Plans one section's block flow. `needsLeadingParagraph` is set for every section after the first, whose page-style switch has to ride on a paragraph -- if the section does not already start with one, an empty paragraph is opened for it, exactly as an image with nothing to anchor to opens one.
function planSection(
  section: ContentSection,
  needsLeadingParagraph: boolean,
  listState: ListPlanState,
): PlannedSection {
  const blocks: PlannedBlock[] = [];
  let pendingPageBreak = false;

  const pushParagraph = (paragraph: ContentParagraph): void => {
    blocks.push({ kind: "paragraph", paragraph });
  };

  // Whether this section has already planned a paragraph an image could anchor into, read back off the plan itself rather than tracked in a flag beside it: the plan is the only thing that decides the answer, and one source of truth cannot drift from itself. The scan is short by construction -- the first image with nothing before it opens an anchor paragraph, so from then on the nearest paragraph is at most a run of consecutive images away.
  const hasPlannedParagraph = (): boolean => {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (blocks[index]!.kind === "paragraph") {
        return true;
      }
    }
    return false;
  };

  // A list run closes the moment anything that is not one of its own paragraphs is emitted. An anchored image does NOT close it: the image hangs off the paragraph it follows, inside that paragraph's own list item, so the list element itself is uninterrupted -- which is exactly how the reader sees it on the way back.
  const closeListRun = (): void => {
    closeListPlan(listState);
  };

  const flushPendingPageBreak = (): void => {
    if (pendingPageBreak) {
      pushParagraph(emptyAnchorParagraph(true));
      closeListRun();
      pendingPageBreak = false;
    }
  };

  if (needsLeadingParagraph) {
    const first = section.blocks.find(
      (block) =>
        block.kind !== "constructStart" && block.kind !== "constructEnd",
    );
    if (first?.kind !== "paragraph") {
      pushParagraph(emptyAnchorParagraph(false));
    }
  }

  for (const block of section.blocks) {
    assertWritableBlock(block);
    if (block.kind === "pageBreak") {
      // Two page breaks in a row need two paragraphs to carry them: fo:break-before states a break BEFORE something, so the first one is flushed onto an empty paragraph of its own rather than collapsing into the second.
      flushPendingPageBreak();
      pendingPageBreak = true;
      continue;
    }
    if (block.kind === "paragraph") {
      // A membership with no numId at all (ContentListMembershipSchema makes it optional, for a source format carrying only a depth) still names a real list here -- it just names one whose identity the source never stated, so it gets its own run key and its own minted numId on the way back in, exactly as any other list does. planListMembership (typed/shared/list.ts) owns this canonicalisation.
      const canonicalId = planListMembership(block.list, listState);
      const paragraph = canonicalParagraph(block, canonicalId);
      pushParagraph(
        pendingPageBreak ? { ...paragraph, pageBreakBefore: true } : paragraph,
      );
      pendingPageBreak = false;
      continue;
    }
    if (block.kind === "table") {
      flushPendingPageBreak();
      closeListRun();
      blocks.push({ kind: "table", table: block });
      continue;
    }
    // An image: ODF anchors a draw:frame inside a paragraph, never beside one, so an image with no paragraph before it in this section opens an empty one to hang off. The anchor paragraph doubles as the page break's own host when one is pending.
    flushPendingPageBreak();
    if (!hasPlannedParagraph()) {
      pushParagraph(emptyAnchorParagraph(false));
    }
    blocks.push({ kind: "image", image: block });
  }

  flushPendingPageBreak();
  return { pageSize: section.pageSize, margins: section.margins, blocks };
}

function planDocument(sections: readonly ContentSection[]): PlannedSection[] {
  // A wordprocessing document with no sections has no page geometry at all, and an .odt always has at least one page style -- writing one would mean inventing a page size and margins the caller never stated, and reading the result back would report a section the input never had. Refused, rather than fabricated.
  if (sections.length === 0) {
    throw new Error(
      "writeOdt: a wordprocessing document with no sections has no page geometry to write -- an .odt always carries at least one page style, and inventing one would report back a section the document never had",
    );
  }
  const listState: ListPlanState = { next: 1 };
  return sections.map((section, index) =>
    planSection(section, index > 0, listState),
  );
}

// --- the canonical form: what reading this writer's own output back produces --------------------------------------
//
// canonicalTable/canonicalImage now live in typed/shared/canonicalise.ts, reused verbatim rather than restated: writeOdfTable is the one table writer/reader pair every caller in this package shares (odt's own top-level tables, or one nested inside an odp/odg shape), and an image part is copied byte-for-byte regardless of which writer placed it.

// The one canonical ContentDocument a written-and-reread document equals, and therefore the exact statement of what this writer preserves and what ODF (or this package's own reader) cannot carry back. Idempotent by construction -- every step below is already a fixed point of itself -- so it is a genuine equivalence, applied to both sides of the round-trip law rather than to the reader's output alone.
//
// What it restates, each forced by the format rather than chosen here:
// - RUNS are segmented into what ODF's inline content model can express (typed/shared/paragraph.ts's segmentOdfParagraphRuns): empty runs vanish, adjacent identically-formatted runs merge, and a run containing a tab, a line break, or a collapsing space run splits at it.
// - A PAGE BREAK block becomes pageBreakBefore on the paragraph that follows it, or on an empty paragraph of its own when nothing follows it that could carry one -- ODF has no standalone page-break element.
// - An IMAGE with no paragraph before it in its section gains an empty anchor paragraph, since a draw:frame is anchored inside a paragraph, never beside one.
// - LIST identities are renumbered onto the reader's own per-encounter minting, keeping the incoming ordered:/bullet: kind. ContentListMembership's `checked` and `itemId` are dropped: ODF list items carry neither a checkbox nor an item identity.
// - styleId is dropped except on a heading, whose identity is structural (text:h/@text:outline-level) rather than a style name; codeLanguage is dropped for the same reason (no ODF spelling).
// - A CELL at a position covered by another cell's span becomes empty, which is all a table:covered-table-cell can say; an absent border style becomes the "solid" that ContentBorderSchema already documents absence to mean.
// - breakType is 'nextPage' on every section after the first and absent on the first: an ODF page-style switch is defined to force a page break, so the three other members have no spelling here.
// - The residue channel (`source`), `sourcePath`, and `frames` are dropped -- residue is not re-emitted (the restorable-fidelity gap this writer's own scope note names), and the other two are a reader's and a layout pass's own facts, not content.
// - metadata's `producer` (a PDF-only concept) and `language` are dropped: nothing writes the first, and while dc:language IS written, readOdfMetadata does not read it back.
// The return type is the wordprocessing arm specifically rather than the whole ContentDocument union: this function accepts any document so it can refuse a wrong-kind one by name, but it only ever RETURNS a wordprocessing one, and saying so spares every caller a re-narrowing step over a fact that is already settled.
export function normaliseOdtContent(
  document: ContentDocument,
): Extract<ContentDocument, { kind: "wordprocessing" }> {
  if (document.kind !== "wordprocessing") {
    throw new Error(
      `normaliseOdtContent: expected a 'wordprocessing' document, got '${document.kind}'`,
    );
  }
  const planned = planDocument(document.sections);
  return {
    kind: "wordprocessing",
    metadata: canonicalMetadata(document.metadata),
    sections: planned.map((section, index) => {
      const blocks: ContentBlock[] = section.blocks.map((block) => {
        switch (block.kind) {
          case "paragraph":
            return block.paragraph;
          case "table":
            return canonicalTable(block.table);
          case "image":
            return canonicalImage(block.image);
        }
      });
      return index === 0
        ? { pageSize: section.pageSize, margins: section.margins, blocks }
        : {
            pageSize: section.pageSize,
            margins: section.margins,
            blocks,
            breakType: "nextPage" as const,
          };
    }),
  };
}

// --- the writer ---------------------------------------------------------------------------------------------------

// The mutable state one document's write threads: the automatic-style registry every formatting decision interns through, the containers new styles and content are appended to, and the counters that mint the document-unique names ODF requires (a table's table:name, a picture's part path, a list style's style:name).
interface OdtWriteState {
  readonly pkg: Package;
  readonly registry: StyleRegistry;
  readonly contentAutomaticStyles: XmlElement;
  readonly stylesNamedStyles: XmlElement;
  readonly stylesAutomaticStyles: XmlElement;
  readonly masterStyles: XmlElement;
  nextTable: number;
  nextImage: number;
  nextListStyle: number;
  // One text:list-style per kind, minted on first use: a document with fifty bullet lists needs one bullet list-style, not fifty identical ones.
  readonly listStyleByKind: Map<"ordered" | "bullet", string>;
}

function pageLayoutElement(
  name: string,
  pageSize: PageSize,
  margins: Margins,
): XmlElement {
  return el("style:page-layout", { "style:name": encodeXmlText(name) }, [
    el("style:page-layout-properties", {
      "fo:page-width": formatOdfLength(pageSize.widthPt),
      "fo:page-height": formatOdfLength(pageSize.heightPt),
      // Derived from the geometry rather than carried: ODF states orientation separately from the dimensions, and a producer that omits it leaves a consumer to guess at a fact the dimensions already settle.
      "style:print-orientation":
        pageSize.widthPt > pageSize.heightPt ? "landscape" : "portrait",
      "fo:margin-top": formatOdfLength(margins.topPt),
      "fo:margin-right": formatOdfLength(margins.rightPt),
      "fo:margin-bottom": formatOdfLength(margins.bottomPt),
      "fo:margin-left": formatOdfLength(margins.leftPt),
    }),
  ]);
}

// The named paragraph style a section boundary rides on. ODF states a page-style switch as style:master-page-name ON THE style:style ELEMENT ITSELF -- verified by a controlled LibreOffice round trip (a document carrying it there renders the second page at the second master page's own size and survives a re-save verbatim; the same document carrying it on style:paragraph-properties instead renders one page and has the attribute stripped) -- so that is where it is written, and resolveParagraphMasterPageName reads it from the same place. The style carries nothing else: a style:paragraph-properties child holding, say, style:page-number would be formatting this package does not model, which would quarantine as residue on every section-opening paragraph for no gain.
//
// It is a NAMED style in office:styles rather than an automatic one because a section's first paragraph usually has formatting of its own: its automatic style names this one as its style:parent-style-name, and LibreOffice honours a switch reached only through the parent chain (verified in the same round trip), exactly as this package's own root-first chain walk does.
function sectionBreakStyleElement(
  name: string,
  masterPageName: string,
): XmlElement {
  return el("style:style", {
    "style:name": encodeXmlText(name),
    "style:family": "paragraph",
    "style:master-page-name": encodeXmlText(masterPageName),
  });
}

function listStyleNameFor(
  kind: "ordered" | "bullet",
  state: OdtWriteState,
): string {
  const existing = state.listStyleByKind.get(kind);
  if (existing !== undefined) {
    return existing;
  }
  const name = `L${state.nextListStyle}`;
  state.nextListStyle += 1;
  state.listStyleByKind.set(kind, name);
  state.contentAutomaticStyles.children.push(buildOdfListStyle(name, kind));
  return name;
}

// An image's own package part plus the draw:frame that references it. The frame carries only svg:width/svg:height and an as-char anchor: an inline image's position IS the character flow, which is the geometry shape readDrawFrame's own flow-positioning path reads back (a frame with a size and no svg:x/svg:y).
function writeImageFrame(
  image: ContentImageBlock,
  state: OdtWriteState,
): XmlElement {
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
    // svg:title is a plain-text child element of the frame, not an attribute, and is the one readFrameAltText prefers.
    children.push(el("svg:title", {}, [txt(encodeXmlText(image.altText))]));
  }
  return el(
    "draw:frame",
    {
      "text:anchor-type": "as-char",
      "svg:width": formatOdfLength(image.widthPt),
      "svg:height": formatOdfLength(image.heightPt),
    },
    children,
  );
}

// Writes one planned section's blocks into office:text's own child list. The paragraph elements are built first and the list grouping is layered over them, because a paragraph does not know it is in a list -- ODF membership is the containers around it (see typed/shared/list.ts), so grouping is this walk's job rather than the paragraph writer's.
function writeSectionBlocks(
  section: PlannedSection,
  parentStyleName: string | undefined,
  state: OdtWriteState,
  out: XmlNode[],
): void {
  // The paragraph the next image anchors into: an image is a draw:frame inside a paragraph, and planSection has already guaranteed one exists before any image.
  let anchorParagraph: XmlElement | undefined;
  // The list run currently open. Its text:list element is pushed into `out` as soon as the run starts, so document order is settled immediately, and its contents are filled in when the run closes -- the nesting structure of a list is a fact about the whole run (a level-2 item lives inside the item before it), which no per-paragraph append could decide on its own.
  let openList:
    | {
        readonly numId: string;
        readonly entries: OdfListEntry[];
        readonly element: XmlElement;
      }
    | undefined;

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

  for (const [index, block] of section.blocks.entries()) {
    if (block.kind === "paragraph") {
      const paragraph = block.paragraph;
      const element = writeOdfParagraph(paragraph, state.registry, {
        ...(index === 0 && parentStyleName !== undefined
          ? { parentStyleName }
          : {}),
      });
      anchorParagraph = element;
      const membership = paragraph.list;
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
        openList = {
          numId: membership.numId,
          entries: [],
          element: listElement,
        };
        out.push(listElement);
      }
      openList.entries.push({ level: membership.level, element });
      continue;
    }
    if (block.kind === "table") {
      closeList();
      anchorParagraph = undefined;
      out.push(
        writeOdfTable(block.table, state.registry, `Table${state.nextTable}`),
      );
      state.nextTable += 1;
      continue;
    }
    if (anchorParagraph === undefined) {
      throw new Error(
        "writeOdt: internal error -- an image block reached the writer with no anchor paragraph before it, which planSection is supposed to guarantee",
      );
    }
    anchorParagraph.children.push(writeImageFrame(block.image, state));
  }
  closeList();
}

// Package assembly. The order matters in one place only: the style registry is constructed over content.xml AFTER the package skeleton exists and BEFORE any paragraph is written, since interning appends to the very office:automatic-styles container the skeleton created.
export function writeOdtContent(
  document: ContentDocument,
  options: OdtWriteOptions = {},
): Package {
  if (document.kind !== "wordprocessing") {
    throw new Error(
      `writeOdtContent: expected a 'wordprocessing' document, got '${document.kind}' -- odf.js writes .odt from the wordprocessing arm only`,
    );
  }
  const version = options.version ?? DEFAULT_ODF_VERSION;
  const textElement = el("office:text");
  const pkg = createOdfPackage(
    options.template ? ODF_MEDIA_TYPES.ott : ODF_MEDIA_TYPES.odt,
    textElement,
    version,
  );

  const state: OdtWriteState = {
    pkg,
    registry: StyleRegistry.forPart(pkg, CONTENT_PART, {
      otherPart: { pkg, partPath: STYLES_PART },
    }),
    contentAutomaticStyles: odfPartContainer(
      pkg,
      CONTENT_PART,
      "office:automatic-styles",
    ),
    stylesNamedStyles: odfPartContainer(pkg, STYLES_PART, "office:styles"),
    stylesAutomaticStyles: odfPartContainer(
      pkg,
      STYLES_PART,
      "office:automatic-styles",
    ),
    masterStyles: odfPartContainer(pkg, STYLES_PART, "office:master-styles"),
    nextTable: 1,
    nextImage: 1,
    nextListStyle: 1,
    listStyleByKind: new Map(),
  };

  const planned = planDocument(document.sections);
  for (const [index, section] of planned.entries()) {
    const masterPageName = `MP${index + 1}`;
    const pageLayoutName = `PM${index + 1}`;
    state.stylesAutomaticStyles.children.push(
      pageLayoutElement(pageLayoutName, section.pageSize, section.margins),
    );
    state.masterStyles.children.push(
      el("style:master-page", {
        "style:name": encodeXmlText(masterPageName),
        "style:page-layout-name": encodeXmlText(pageLayoutName),
      }),
    );
    if (index > 0) {
      state.stylesNamedStyles.children.push(
        sectionBreakStyleElement(`${masterPageName}Start`, masterPageName),
      );
    }
  }

  for (const [index, section] of planned.entries()) {
    writeSectionBlocks(
      section,
      index === 0 ? undefined : `MP${index + 1}Start`,
      state,
      textElement.children,
    );
  }

  writeOdfMetadata(pkg, document.metadata, version);
  syncManifest(pkg, { version });
  return pkg;
}

// DocumentTree -> a real .odt Package: this module's PRIMARY entry point, and the exact mirror of readOdt's own relationship to readOdtContent. The tree is flattened through document-schema.js's own flattenTree -- the inverse of the assembleTree readOdt calls -- so a tree read from one .odt and written back out crosses the package boundary exactly once in each direction, with every style ref resolved on the way out.
export function writeOdt(
  document: DocumentTree,
  options: OdtWriteOptions = {},
): Package {
  return writeOdtContent(flattenTree(document), options);
}
