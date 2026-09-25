// The block plan for an .odt write, split from write.ts: the restatement of a caller's flat block list into the section-carried, anchor-paragraph-carrying plan ODF's content model actually needs, computed once so the writer and the normaliser read the same plan and can never disagree. write.ts keeps the emission side (writeSectionBlocks, writeOdtContent, writeOdt) and normaliseOdtContent, which import the plan back from here (safe in ESM: every cross-binding use sits inside a hoisted function declaration).
//
import type {
  ContentConstructStart,
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
  ContentParagraph,
  ContentSection,
  ContentTable,
  DefinitionEntry,
  Margins,
  PageSize,
  ProvenanceDescriptor,
} from "document-schema.js";
import {
  closeListPlan,
  planListMembership,
  type ListPlanState,
} from "../shared/list";
import { canonicalParagraph, canonicalTable } from "../shared/canonicalise";
// assertWritableBlock stays in write.ts (the emission side owns the refusal vocabulary); importing it back is safe because every use sits inside a hoisted function declaration.
import { assertWritableBlock } from "./write";

// --- the block plan: one description of an .odt's block flow, shared by the writer and the normaliser -------------
//
// Three of ODF's structural facts are not expressible in the flat block list a caller hands in, so the writer has to restate that list before it can emit anything: a page break has to land ON a paragraph, an anchored image has to hang OFF one, and a section boundary has to be carried BY one. Planning that restatement once, here, is what lets normaliseOdtContent state the canonical form exactly — the normaliser and the writer read the same plan, so they can never disagree about what the writer will produce.

export interface PlannedParagraph {
  readonly kind: "paragraph";
  readonly paragraph: ContentParagraph;
}

export interface PlannedTable {
  readonly kind: "table";
  readonly table: ContentTable;
}

export interface PlannedImage {
  readonly kind: "image";
  readonly image: ContentImageBlock;
}

// The block-scope construct markers pass through planning as-is: a marker carries no formatting or list membership of its own to restate, so there is nothing for the plan to do beyond deciding WHERE in the flow it lands (see planSection below, which treats a marker as a flow boundary the same way a table already is: it flushes a pending page break and closes any open list run before it, rather than trying to nest inside one).
export interface PlannedConstructStart {
  readonly kind: "constructStart";
  readonly descriptor: ContentConstructStart["descriptor"];
}
export interface PlannedConstructEnd {
  readonly kind: "constructEnd";
}
export interface PlannedEmbeddedObject {
  readonly kind: "embeddedObject";
  readonly object: ContentEmbeddedObjectBlock;
}

type PlannedBlock =
  | PlannedParagraph
  | PlannedTable
  | PlannedImage
  | PlannedEmbeddedObject
  | PlannedConstructStart
  | PlannedConstructEnd;

export interface PlannedSection {
  readonly pageSize: PageSize;
  readonly margins: Margins;
  readonly blocks: PlannedBlock[];
}

// The list-identity counter one document's plan threads: readOdtContent mints a numId per top-level text:list encountered in document order across the WHOLE body, so the plan has to number lists the same way — once per maximal run of consecutive list paragraphs sharing an incoming numId, across sections, never per distinct numId string (two separate runs carrying one numId are two ODF lists, and the reader will say so). ListPlanState/planListMembership/closeListPlan/listKindOf/canonicalNumId are shared with typed/odp/write.ts (typed/shared/list.ts's own top-of-file note on the write-side canonicalisation both formats need identically) rather than redeclared here.

// canonicalParagraph (headingLevel/alignment/list/spacing/indent/pageBreak, run segmentation and colour quantisation) now lives in typed/shared/canonicalise.ts, reused verbatim by typed/odp/write.ts for a shape's own text paragraphs and a table nested inside a shape — see that module's own top-of-file note.

export function emptyAnchorParagraph(
  pageBreakBefore: boolean,
): ContentParagraph {
  return pageBreakBefore
    ? { kind: "paragraph", runs: [], pageBreakBefore: true }
    : { kind: "paragraph", runs: [] };
}

// Plans one section's block flow. `needsLeadingParagraph` is set for every section after the first, whose page-style switch has to ride on a paragraph — if the section does not already start with one, an empty paragraph is opened for it, exactly as an image with nothing to anchor to opens one.
export function planSection(
  section: ContentSection,
  needsLeadingParagraph: boolean,
  listState: Readonly<ListPlanState>,
  definitions: Readonly<Record<string, DefinitionEntry>> | undefined,
  changeIds: ReadonlyMap<ProvenanceDescriptor, string> | undefined,
): PlannedSection {
  const blocks: PlannedBlock[] = [];
  let pendingPageBreak = false;

  const pushParagraph = (paragraph: ContentParagraph): void => {
    blocks.push({ kind: "paragraph", paragraph });
  };

  // Whether this section has already planned a paragraph an image could anchor into, read back off the plan itself rather than tracked in a flag beside it: the plan is the only thing that decides the answer, and one source of truth cannot drift from itself. The scan is short by construction — the first image with nothing before it opens an anchor paragraph, so from then on the nearest paragraph is at most a run of consecutive images away.
  const hasPlannedParagraph = (): boolean => {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (blocks[index]!.kind === "paragraph") {
        return true;
      }
    }
    return false;
  };

  // A list run closes the moment anything that is not one of its own paragraphs is emitted. An anchored image does NOT close it: the image hangs off the paragraph it follows, inside that paragraph's own list item, so the list element itself is uninterrupted — which is exactly how the reader sees it on the way back.
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
    assertWritableBlock(block, definitions, changeIds);
    if (block.kind === "pageBreak") {
      // Two page breaks in a row need two paragraphs to carry them: fo:break-before states a break BEFORE something, so the first one is flushed onto an empty paragraph of its own rather than collapsing into the second.
      flushPendingPageBreak();
      pendingPageBreak = true;
      continue;
    }
    if (block.kind === "paragraph") {
      // A membership with no numId at all (ContentListMembershipSchema makes it optional, for a source format carrying only a depth) still names a real list here — it just names one whose identity the source never stated, so it gets its own run key and its own minted numId on the way back in, exactly as any other list does. planListMembership (typed/shared/list.ts) owns this canonicalisation.
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
      // canonicalTable renumbers any list membership a cell's own paragraphs carry onto this SAME listState, in document order, exactly as the paragraph branch above does for body-level membership — a list minted inside a cell needs an identity as unique as one minted anywhere else in the document, and readOdtContent's own listIdState mints in this identical interleaved order on the way back in.
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
    if (block.kind === "embeddedObject") {
      // An embedded object anchors exactly as an image does — a draw:frame inside a paragraph, its own sub-package keyed under "Object N/" — so it shares the image arm's anchor-paragraph and page-break handling verbatim.
      flushPendingPageBreak();
      if (!hasPlannedParagraph()) {
        pushParagraph(emptyAnchorParagraph(false));
      }
      blocks.push({ kind: "embeddedObject", object: block });
      continue;
    }
    // An image: ODF anchors a draw:frame inside a paragraph, never beside one, so an image with no paragraph before it in this section opens an empty one to hang off. The anchor paragraph doubles as the page break's own host when one is pending. The loop's final fallthrough arm.
    flushPendingPageBreak();
    if (!hasPlannedParagraph()) {
      pushParagraph(emptyAnchorParagraph(false));
    }
    blocks.push({ kind: "image", image: block });
  }
  // An embedded object anchors exactly as an image does — a draw:frame inside a paragraph, its own sub-package keyed under "Object N/" — so it shares the image arm's anchor-paragraph and page-break handling verbatim. This is the loop's final fallthrough arm (everything else continued above), exactly as the image arm was before it.
  flushPendingPageBreak();
  if (!hasPlannedParagraph()) {
    pushParagraph(emptyAnchorParagraph(false));
  }
  flushPendingPageBreak();
  return { pageSize: section.pageSize, margins: section.margins, blocks };
}

export function planDocument(
  sections: readonly ContentSection[],
  definitions: Readonly<Record<string, DefinitionEntry>> | undefined,
  changeIds: ReadonlyMap<ProvenanceDescriptor, string> | undefined,
): PlannedSection[] {
  // A wordprocessing document with no sections has no page geometry at all, and an .odt always has at least one page style — writing one would mean inventing a page size and margins the caller never stated, and reading the result back would report a section the input never had. Refused, rather than fabricated.
  if (sections.length === 0) {
    throw new Error(
      "writeOdt: a wordprocessing document with no sections has no page geometry to write — an .odt always carries at least one page style, and inventing one would report back a section the document never had",
    );
  }
  const listState: ListPlanState = { cursor: { next: 1 } };
  return sections.map((section, index) =>
    planSection(section, index > 0, listState, definitions, changeIds),
  );
}
