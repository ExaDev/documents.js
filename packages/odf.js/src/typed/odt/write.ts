import type {
  ConstructDescriptor,
  ContentBlock,
  ContentConstructEnd,
  ContentConstructStart,
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
import type { DefinitionEntry } from "document-schema.js";
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
import { imageExtension } from "../shared/image";
import { writeOdfMetadata } from "../shared/metadata";
import {
  preformattedStyleElement,
  writeOdfParagraph,
} from "../shared/paragraph";
import { writeOdfTable, type OdfTableWriteContext } from "../shared/table";
import {
  canonicalOdfConstructDescriptor,
  odfRunConstructWriteKind,
  writeOdfDivision,
  writeOdfIndexWrapper,
  writeOdfBookmarkEnd,
  writeOdfBookmarkStart,
  writeOdfPackageResidue,
  type OdfDivisionWriteContext,
} from "../shared/constructs";
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
// WHAT THIS WRITER WRITES AND WHAT IT STILL REFUSES, and why it refuses rather than dropping: the fidelity constructs readOdtContent reads are semantic content, so writing a document that silently lost one would be worse than not writing it at all -- a block or paragraph carrying a construct this writer does not yet resolve is refused BY NAME (see assertWritableBlock/assertWritableParagraph), never silently dropped. As of ExaDev/documents.js#969, that is no longer every construct: a FIELD and a BOOKMARK anchor (point or ranged, entirely within one paragraph) are written from ContentParagraph.constructs, via typed/shared/paragraph.ts's writeOdfParagraphChildren; a DIVISION (text:section) and an INDEX WRAPPER (text:table-of-content and its six siblings) are written from a block-scope constructStart/constructEnd pair, via typed/shared/constructs.ts's writeOdfDivision/writeOdfIndexWrapper (see assertWritableBlock/isWritableOdfDivisionOrIndexDescriptor and writeSectionBlocks' own construct stack). A BLOCK-SCOPE bookmark range is written too: its two halves (text:bookmark-start/-end) splice onto the extent's own first and last paragraph elements at the leading/trailing edge positions isOdfBlockScopedHalf reads back. A NOTE anchor (footnote or endnote) writes when the definitions table holds its body: writeOdt passes the tree's own table, the anchor becomes an inline text:note carrying its citation and a body written from the entry's blocks. Still refused: a note or comment anchor with no definitions table in reach (writeOdtContent called bare), and a TRACKED-CHANGE provenance wrapper (the identical wiring against its own definition kind); a tracked-change/comment range that SPANS SEVERAL BLOCKS (the identical splice machinery the bookmark case now has, but against marker halves whose definitions-table body still needs wiring); a block-scope bookmark range whose extent contains no paragraph at all (nothing to carry the halves); office:forms controls (the reader's own point-pair encoding, readOdfFormControlConstructs in typed/shared/forms.ts, flattens a form's real parent/child nesting into a flat pre-order sequence of point constructs with no extent of its own, so there is no reliable way back to the original form:form/form:<kind> tree from what gets read); and embedded objects (ExaDev/documents.js#972's own write-side sub-document infrastructure, tracked separately). Every one of those is still refused by name, not dropped. The quarantined residue channel is separate again: a whole non-content package part (settings.xml and the like) is restored verbatim by writeOdt itself, via the shared writeOdfPackageResidue helper, once writeOdtContent has built the rest of the package -- that part is never touched or interpreted by anything below, so re-emitting it is genuinely safe. A construct's own residue, and the body-walk quarantine buckets a paragraph or block can carry (dde-links, xforms, a vendor-extension tag), stay dropped: re-emitting one of those into a paragraph or block the writer is regenerating from a possibly-edited document would be actively wrong, since there is no structural position left to safely reinsert it at (the one narrow, deliberate exception is an index wrapper's own *-source residue, read back purely to recover WHICH of the seven wrapper elements to write -- structural identity, never re-emitted content -- see odfIndexWrapperTag's own note). That narrower drop is stated in normaliseOdtContent, and tracked as the restorable-fidelity gap it is.

const CONTENT_PART = "content.xml";
const STYLES_PART = "styles.xml";
const PICTURES_DIRECTORY = "Pictures";

export interface OdtWriteOptions {
  // The ODF version stamped on each part's office:version and on the manifest. Defaults to the current standard.
  readonly version?: string;
  // The definitions table note anchors resolve against. writeOdt (the DocumentTree entry point) passes the tree's own definitions table here automatically; a caller of writeOdtContent with note-bearing paragraphs must supply the table itself or the write refuses those anchors by name.
  readonly definitions?: Readonly<Record<string, DefinitionEntry>>;
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

// The block-scope construct markers pass through planning as-is: a marker carries no formatting or list membership of its own to restate, so there is nothing for the plan to do beyond deciding WHERE in the flow it lands (see planSection below, which treats a marker as a flow boundary the same way a table already is: it flushes a pending page break and closes any open list run before it, rather than trying to nest inside one).
interface PlannedConstructStart {
  readonly kind: "constructStart";
  readonly descriptor: ContentConstructStart["descriptor"];
}
interface PlannedConstructEnd {
  readonly kind: "constructEnd";
}

type PlannedBlock =
  | PlannedParagraph
  | PlannedTable
  | PlannedImage
  | PlannedConstructStart
  | PlannedConstructEnd;

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

// A run-level construct extent this paragraph carries is writable when odfRunConstructWriteKind (typed/shared/constructs.ts) resolves it: a field (always, from its own cached instruction) or a bookmark anchor (point or range, both spelled as text:bookmark/-start/-end). Every other run-level construct -- a footnote/endnote/comment anchor, a tracked-change provenance wrapper -- has no writer yet and is refused by name, matching every writer's established fidelity-construct stance.
function assertWritableParagraph(
  paragraph: ContentParagraph,
  definitions: Readonly<Record<string, DefinitionEntry>> | undefined,
): void {
  for (const extent of paragraph.constructs ?? []) {
    if (odfRunConstructWriteKind(extent, definitions) === undefined) {
      const anchorType =
        extent.descriptor.kind === "anchor"
          ? ` of anchor type "${extent.descriptor.anchorType}"`
          : "";
      throw unsupported(
        `a run-level construct extent this writer does not spell back yet (a "${extent.descriptor.kind}" construct${anchorType})`,
        "a paragraph",
      );
    }
  }
}

// Whether a block-scope construct marker's own descriptor is one writeSectionBlocks knows how to wrap: a division (text:section) and an index wrapper (contentControl "index", text:table-of-content and its six siblings) are real WRAPPING elements, so their inverse is exactly "write the wrapper around the blocks between the matching constructStart/constructEnd" (see writeConstructWrapper below). Every other block-scope construct -- a bookmark/tracked-change/comment range spanning several whole PARAGRAPHS, or an office:forms control -- has no writer yet: those need a marker element spliced onto the first/last paragraph INSIDE the extent rather than a wrapping element around it, a materially different write path this pass does not build. The run-scoped case of the identical anchor/field kinds -- entirely within one paragraph -- IS written (assertWritableParagraph above), so only the block-scoped, multi-paragraph-spanning case remains refused here.
function isWritableOdfDivisionOrIndexDescriptor(
  descriptor: ConstructDescriptor,
): boolean {
  return (
    descriptor.kind === "division" ||
    (descriptor.kind === "contentControl" &&
      descriptor.controlType === "index") ||
    (descriptor.kind === "anchor" && descriptor.anchorType === "bookmark")
  );
}

// An assertion signature rather than a plain check, so the walk below narrows to exactly the block kinds this writer knows how to place without a second, redundant test for the kinds this one already refused.
function assertWritableBlock(
  block: ContentBlock,
  blockDefinitions: Readonly<Record<string, DefinitionEntry>> | undefined,
): asserts block is
  | ContentParagraph
  | ContentTable
  | ContentImageBlock
  | ContentPageBreak
  | ContentConstructStart
  | ContentConstructEnd {
  if (block.kind === "constructStart") {
    if (!isWritableOdfDivisionOrIndexDescriptor(block.descriptor)) {
      throw unsupported(
        `a block-scope construct boundary marker for a "${block.descriptor.kind}" construct this writer does not yet wrap`,
        "a section's block flow",
      );
    }
    return;
  }
  if (block.kind === "constructEnd") {
    return;
  }
  if (block.kind === "embeddedObject") {
    throw unsupported("an embedded object", "a section's block flow");
  }
  if (block.kind === "paragraph") {
    assertWritableParagraph(block, blockDefinitions);
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
  definitions: Readonly<Record<string, DefinitionEntry>> | undefined,
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
    assertWritableBlock(block, definitions);
    if (block.kind === "pageBreak") {
      // Two page breaks in a row need two paragraphs to carry them: fo:break-before states a break BEFORE something, so the first one is flushed onto an empty paragraph of its own rather than collapsing into the second.
      flushPendingPageBreak();
      pendingPageBreak = true;
      continue;
    }
    if (block.kind === "paragraph") {
      // A membership with no numId at all (ContentListMembershipSchema makes it optional, for a source format carrying only a depth) still names a real list here -- it just names one whose identity the source never stated, so it gets its own run key and its own minted numId on the way back in, exactly as any other list does. planListMembership (typed/shared/list.ts) owns this canonicalisation.
      const canonicalId = planListMembership(block.list, listState);
      const paragraph = canonicalParagraph(block, canonicalId, true);
      pushParagraph(
        pendingPageBreak ? { ...paragraph, pageBreakBefore: true } : paragraph,
      );
      pendingPageBreak = false;
      continue;
    }
    if (block.kind === "table") {
      flushPendingPageBreak();
      closeListRun();
      // canonicalTable renumbers any list membership a cell's own paragraphs carry onto this SAME listState, in document order, exactly as the paragraph branch above does for body-level membership -- a list minted inside a cell needs an identity as unique as one minted anywhere else in the document, and readOdtContent's own listIdState mints in this identical interleaved order on the way back in.
      blocks.push({ kind: "table", table: canonicalTable(block, listState) });
      continue;
    }
    if (block.kind === "constructStart" || block.kind === "constructEnd") {
      // A construct boundary is a flow boundary exactly the way a table already is: it never continues an open list run into or out of its own extent, matching the identical treatment the table branch above already gives non-paragraph, non-image content. writeSectionBlocks (below) is what actually re-wraps the blocks between a matching pair; this plan just states where in the flow they land.
      flushPendingPageBreak();
      closeListRun();
      blocks.push(
        block.kind === "constructStart"
          ? { kind: "constructStart", descriptor: block.descriptor }
          : { kind: "constructEnd" },
      );
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

function planDocument(
  sections: readonly ContentSection[],
  definitions: Readonly<Record<string, DefinitionEntry>> | undefined,
): PlannedSection[] {
  // A wordprocessing document with no sections has no page geometry at all, and an .odt always has at least one page style -- writing one would mean inventing a page size and margins the caller never stated, and reading the result back would report a section the input never had. Refused, rather than fabricated.
  if (sections.length === 0) {
    throw new Error(
      "writeOdt: a wordprocessing document with no sections has no page geometry to write -- an .odt always carries at least one page style, and inventing one would report back a section the document never had",
    );
  }
  const listState: ListPlanState = { next: 1 };
  return sections.map((section, index) =>
    planSection(section, index > 0, listState, definitions),
  );
}

// --- the canonical form: what reading this writer's own output back produces --------------------------------------
//
// canonicalTable/canonicalImage now live in typed/shared/canonicalise.ts, reused verbatim rather than restated: writeOdfTable is the one table writer/reader pair every caller in this package shares (odt's own top-level tables, or one nested inside an odp/odg shape), and an image part is copied byte-for-byte regardless of which writer placed it.

// The one canonical ContentDocument a written-and-reread document equals, and therefore the exact statement of what this writer preserves and what ODF (or this package's own reader) cannot carry back. Idempotent by construction -- every step below is already a fixed point of itself -- so it is a genuine equivalence, applied to both sides of the round-trip law rather than to the reader's output alone.
//
// What it restates, each forced by the format rather than chosen here:
// - RUNS are segmented into what ODF's inline content model can express (typed/shared/paragraph.ts's segmentOdfParagraphRuns): empty runs vanish, adjacent identically-formatted runs merge, and a run containing a tab, a line break, or a collapsing space run splits at it. A paragraph carrying run-level CONSTRUCTS (a field, a bookmark) segments the identical way except that merging never crosses a construct's own startRun/endRun boundary (segmentOdfParagraphRunsMapped), and its constructs field survives with each extent's bounds remapped onto the resulting canonical run indices -- the descriptor itself is untouched, since neither construct this writer resolves loses any of its own state on the way through.
// - A PAGE BREAK block becomes pageBreakBefore on the paragraph that follows it, or on an empty paragraph of its own when nothing follows it that could carry one -- ODF has no standalone page-break element.
// - An IMAGE with no paragraph before it in its section gains an empty anchor paragraph, since a draw:frame is anchored inside a paragraph, never beside one.
// - LIST identities are renumbered onto the reader's own per-encounter minting, keeping the incoming ordered:/bullet: kind. ContentListMembership's `checked` and `itemId` are dropped: ODF list items carry neither a checkbox nor an item identity.
// - styleId is dropped except on a heading, whose identity is structural (text:h/@text:outline-level) rather than a style name; codeLanguage is dropped for the same reason (no ODF spelling).
// - A CELL at a position covered by another cell's span becomes empty, which is all a table:covered-table-cell can say; an absent border style becomes the "solid" that ContentBorderSchema already documents absence to mean.
// - breakType is 'nextPage' on every section after the first and absent on the first: an ODF page-style switch is defined to force a page break, so the three other members have no spelling here.
// - Per-node residue (`source`), `sourcePath`, and `frames` are dropped -- a construct's or block's own residue is not re-emitted (the restorable-fidelity gap this writer's own scope note names; the package-level residue table on the DocumentTree, by contrast, IS restored, by writeOdt rather than by this normaliser, since normaliseOdtContent works over the flat ContentDocument that table has no place on), and the other two are a reader's and a layout pass's own facts, not content.
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
  // No definitions table here: the canonical form works over the flat ContentDocument, which has no root to hold one -- note anchors pass through untouched (their bodies are the tree-level write's concern, via writeOdt).
  const planned = planDocument(document.sections, undefined);
  return {
    kind: "wordprocessing",
    metadata: canonicalMetadata(document.metadata),
    sections: planned.map((section, index) => {
      const blocks: ContentBlock[] = section.blocks.map((block) => {
        switch (block.kind) {
          case "paragraph":
            // Already canonical: planSection ran canonicalParagraph(..., true) when it planned this block, mapping any run-level construct extents onto the SAME segmented run list this block's own runs already state.
            return block.paragraph;
          case "table":
            // Already canonical: planSection ran canonicalTable when it planned this block, threading the SAME listState its own paragraph branch renumbers body-level list membership through.
            return block.table;
          case "image":
            return canonicalImage(block.image);
          case "constructStart":
            // canonicalOdfConstructDescriptor (typed/shared/constructs.ts) restates the one fact a block-scope marker CAN carry that a round trip reshapes: an index wrapper's own bare *-source residue, re-serialised through the identical parse/build pass writeOdfIndexWrapper's own read-back takes. Everything else about the marker -- its extent's blocks -- is restated individually, in the same map, exactly as it would be at the document's top level.
            return {
              kind: "constructStart",
              descriptor: canonicalOdfConstructDescriptor(block.descriptor),
            };
          case "constructEnd":
            return { kind: "constructEnd" };
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
  nextSectionStyle: number;
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

// The OdfTableWriteContext (typed/shared/table.ts) a table:table write threads through: table:name minting off this document's own nextTable counter -- the SAME counter for a top-level table and for any table nested inside one of its own cells, so the two can never collide -- and list-style minting off this document's own listStyleByKind cache, so a list run inside a cell reuses the identical style a body-level list of the same kind would.
function tableWriteContext(state: OdtWriteState): OdfTableWriteContext {
  return {
    registry: state.registry,
    mintTableName: () => {
      const name = `Table${state.nextTable}`;
      state.nextTable += 1;
      return name;
    },
    mintListStyleName: (kind) => listStyleNameFor(kind, state),
  };
}

// An image's own package part plus the draw:frame that references it. The frame carries only svg:width/svg:height and an as-char anchor: an inline image's position IS the character flow, which is the geometry shape readDrawFrame's own flow-positioning path reads back (a frame with a size and no svg:x/svg:y).
function writeImageFrame(
  image: ContentImageBlock,
  state: OdtWriteState,
): XmlElement {
  const extension = imageExtension(image.format);
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

// One division/index-wrapper construct still being written: the extent's own children accumulate here, separately from whatever array surrounds the construct, until the matching constructEnd closes it and the wrapper element (division or index) is built around them and pushed into ITS OWN surrounding array in turn -- a plain stack, so constructs nest correctly to arbitrary depth with no special-casing.
interface OpenOdtConstruct {
  readonly descriptor: ContentConstructStart["descriptor"];
  readonly children: XmlNode[];
  // A bookmark anchor is not a wrapper: instead of building an element around the extent's children, its two halves (writeOdfBookmarkStart/End) splice onto the extent's own first and last PARAGRAPH elements, at the leading/trailing edge positions isOdfBlockScopedHalf reads back. startSpliced/lastParagraph track that as the paragraphs are written; a bookmark extent that closes without ever having written a paragraph is refused at that point rather than silently emitting halves nothing reads back.
  readonly bookmarkName: string | undefined;
  startSpliced: boolean;
  lastParagraph: XmlElement | undefined;
}

// Writes one planned section's blocks into office:text's own child list (or, once a division/index wrapper is open, into that wrapper's own accumulating children instead -- see the construct stack below). The paragraph elements are built first and the list grouping is layered over them, because a paragraph does not know it is in a list -- ODF membership is the containers around it (see typed/shared/list.ts), so grouping is this walk's job rather than the paragraph writer's.
function writeSectionBlocks(
  section: PlannedSection,
  parentStyleName: string | undefined,
  state: OdtWriteState,
  out: XmlNode[],
  definitions: Readonly<Record<string, DefinitionEntry>> | undefined,
): void {
  // The paragraph the next image anchors into: an image is a draw:frame inside a paragraph, and planSection has already guaranteed one exists before any image.
  let anchorParagraph: XmlElement | undefined;
  // The list run currently open. Its text:list element is pushed into the current output array as soon as the run starts, so document order is settled immediately, and its contents are filled in when the run closes -- the nesting structure of a list is a fact about the whole run (a level-2 item lives inside the item before it), which no per-paragraph append could decide on its own. A construct boundary always closes it first (see the constructStart/constructEnd branches below), matching how a table already does.
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

  const constructStack: OpenOdtConstruct[] = [];
  const currentOut = (): XmlNode[] =>
    constructStack.length === 0
      ? out
      : constructStack[constructStack.length - 1]!.children;
  const divisionContext: OdfDivisionWriteContext = {
    mintSectionStyleName: (columnCount) => {
      const name = `Sect${state.nextSectionStyle}`;
      state.nextSectionStyle += 1;
      state.stylesAutomaticStyles.children.push(
        el("style:style", { "style:name": name, "style:family": "section" }, [
          el("style:section-properties", {}, [
            el("style:columns", { "fo:column-count": String(columnCount) }),
          ]),
        ]),
      );
      return name;
    },
  };

  for (const [index, block] of section.blocks.entries()) {
    if (block.kind === "constructStart") {
      closeList();
      anchorParagraph = undefined;
      constructStack.push({
        descriptor: block.descriptor,
        children: [],
        bookmarkName:
          block.descriptor.kind === "anchor" &&
          block.descriptor.anchorType === "bookmark"
            ? block.descriptor.name
            : undefined,
        startSpliced: false,
        lastParagraph: undefined,
      });
      continue;
    }
    if (block.kind === "constructEnd") {
      closeList();
      anchorParagraph = undefined;
      const open = constructStack.pop();
      if (open === undefined) {
        throw new Error(
          "writeOdt: internal error -- a constructEnd block reached the writer with no matching constructStart open, which document-schema.js's own marker-balance contract is supposed to guarantee",
        );
      }
      if (open.bookmarkName !== undefined) {
        if (open.lastParagraph === undefined) {
          throw unsupported(
            `a block-scope bookmark range whose extent contains no paragraph to carry its halves`,
            "a section's block flow",
          );
        }
        open.lastParagraph.children.push(
          writeOdfBookmarkEnd(open.bookmarkName),
        );
        currentOut().push(...open.children);
      } else if (open.descriptor.kind === "division") {
        currentOut().push(
          writeOdfDivision(open.descriptor, open.children, divisionContext),
        );
      } else if (
        open.descriptor.kind === "contentControl" &&
        open.descriptor.controlType === "index"
      ) {
        currentOut().push(writeOdfIndexWrapper(open.descriptor, open.children));
      } else {
        // isWritableOdfDivisionOrIndexDescriptor already refused any other descriptor kind at plan time (assertWritableBlock), so this branch is unreachable in practice -- kept only so the exhaustiveness above stays a real check rather than an assumption.
        throw new Error(
          `writeOdt: internal error -- an open construct with an unwritable descriptor kind "${open.descriptor.kind}" reached writeSectionBlocks, which assertWritableBlock is supposed to have refused before planning`,
        );
      }
      continue;
    }
    if (block.kind === "paragraph") {
      const paragraph = block.paragraph;
      const element = writeOdfParagraph(paragraph, state.registry, {
        ...(index === 0 && parentStyleName !== undefined
          ? { parentStyleName }
          : {}),
        definitions,
      });
      anchorParagraph = element;
      for (const open of constructStack) {
        if (open.bookmarkName === undefined) {
          continue;
        }
        if (!open.startSpliced) {
          open.startSpliced = true;
          element.children.unshift(writeOdfBookmarkStart(open.bookmarkName));
        }
        open.lastParagraph = element;
      }
      const membership = paragraph.list;
      if (membership?.numId === undefined) {
        closeList();
        currentOut().push(element);
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
        currentOut().push(listElement);
      }
      openList.entries.push({ level: membership.level, element });
      continue;
    }
    if (block.kind === "table") {
      closeList();
      anchorParagraph = undefined;
      currentOut().push(writeOdfTable(block.table, tableWriteContext(state)));
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

  const definitions = options.definitions;
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
    nextSectionStyle: 1,
    listStyleByKind: new Map(),
  };
  // Minted unconditionally, once per document, rather than only when a preformatted paragraph is actually found: a document-wide pre-scan just to decide whether to skip one small, otherwise-inert element is more machinery than the element itself costs. writeOdfParagraph references this style's own name for ANY paragraph.preformatted paragraph it writes -- body text here, and (via typed/shared/table.ts's own writeOdfParagraph calls, sharing this exact registry/part) a document table cell's paragraphs too -- so it must already exist by the time the first such paragraph is written.
  state.stylesNamedStyles.children.push(preformattedStyleElement());

  const planned = planDocument(document.sections, definitions);
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
      definitions,
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
  // The tree's own definitions table is the bodies note and comment anchors name -- the flat ContentDocument flattenTree produces has no root to hold one, so this is the one place the table crosses into the write.
  const pkg = writeOdtContent(flattenTree(document), {
    ...options,
    definitions: document.definitions ?? options.definitions,
  });
  writeOdfPackageResidue(pkg, "odt", document.source);
  syncManifest(pkg, { version: options.version ?? DEFAULT_ODF_VERSION });
  return pkg;
}
