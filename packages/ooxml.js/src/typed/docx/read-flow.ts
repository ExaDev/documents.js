import type {
  AnchorDescriptor,
  ContentBlock,
  ContentControlDescriptor,
  ContentSection,
  Margins,
  PageSize,
  ProvenanceChange,
} from "document-schema.js";
import {
  CONVENTIONAL_DOCUMENT_PART_PATH,
  DEFAULT_MARGINS,
  FOOTER_REL_SUFFIX,
  HEADER_REL_SUFFIX,
  THEME_REL_SUFFIX,
  hasPageBreakBefore,
  readMargins,
  readPageSize,
  readParagraphBlocks,
  readSectionBreakType,
} from "./read";
import type {
  ConstructExtent,
  ParagraphContentIndex,
  RangeMarkerFamily,
} from "./constructs";
import type { DocxReadContext } from "./read";
import type { DrawingTheme } from "../shared/drawingml";
import { EMPTY_THEME, readTheme } from "../shared/drawingml";
import type {
  HeaderFooterPart,
  SectionHeaderFooterReferences,
} from "./read-schemas";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import {
  PROVENANCE_CHANGE_BY_TAG,
  bookmarkAnchorDescriptor,
  contentBearingChildren,
  fieldCharType,
  indexParagraphContent,
  insertConstructMarkers,
  isDeletedChange,
  isLeadingContentPosition,
  isTrailingContentPosition,
  readContentControlDescriptor,
  readFormControlDescriptor,
  readProvenanceDescriptor,
  runInstructionText,
} from "./constructs";
import type { Package } from "../../model/package";
import type { Relationship } from "../util";
import type { XmlElement, XmlNode } from "../../model/node";
import { assignSourcePaths } from "../shared/source-path";
import { associateFigureCaptions } from "./figure-captions";
import {
  attr,
  childrenWithTag,
  decodeEntities,
  resolveRelationships,
  rootElement,
} from "../util";
import { findMainPartPath, hasPart } from "../opc";
import { readTable } from "./read-table";
// The section-flow machinery of the docx reader, split from read.ts: flow state with range markers and open fields, paragraph collection, block scopes, section header/footer resolution and the section reader. read.ts keeps run and paragraph reading and the document assembly.
// --- the block flow walk, and the construct extents it discovers along the way ---------------------------------------

export interface SectionBreak {
  readonly index: number;
  readonly sectPr: XmlElement;
}

// A range marker's two halves (a bookmark's, a comment extent's) are id-paired rather than nested, so neither half can be turned into a marker until both have been seen and both have been shown to sit at a block boundary: `index` is the block position the half sits at, and `qualified` records whether it sat outside every content-bearing child of its paragraph (or at block level, where it always does). See resolveRangeMarkerExtents for the pairing itself.
export interface RangeMarkerEvent {
  readonly family: RangeMarkerFamily;
  readonly id: string;
  readonly name: string | undefined;
  readonly kind: "start" | "end";
  readonly index: number;
  readonly qualified: boolean;
  readonly order: number;
}

// A complex field opened by a w:fldChar begin and still waiting for its matching end, which may be several paragraphs away (a TOC field's begin sits in its first entry's paragraph and its end in a paragraph of its own after the last). `formControl` holds the legacy w:ffData verdict when the begin run carries one: a form field is ONE construct (a contentControl), so its block extent takes the control descriptor rather than a field descriptor beside it.
export interface OpenField {
  instruction: string;
  inCode: boolean;
  readonly startIndex: number;
  readonly qualifiedStart: boolean;
  readonly order: number;
  readonly formControl: ContentControlDescriptor | undefined;
}

export interface FlowState {
  readonly blocks: ContentBlock[];
  readonly extents: ConstructExtent[];
  readonly sectionBreaks: SectionBreak[];
  readonly rangeMarkerEvents: RangeMarkerEvent[];
  readonly openFields: OpenField[];
  order: number;
}

export function newFlowState(): FlowState {
  return {
    blocks: [],
    extents: [],
    sectionBreaks: [],
    rangeMarkerEvents: [],
    openFields: [],
    order: 0,
  };
}

// The one place the walk's discovery-order counter advances, so every one of its call sites shares a single mutation surface rather than each inlining its own `state.order++`: nine sites, each independently mutable, used to let a lone site's own UpdateOperator flip survive unnoticed whenever nothing discovered strictly after it could ever share that extent's exact block range (every such candidate is provably discovered earlier — a leading same-paragraph marker or an enclosing wrapper — so its own order value is fixed before this call runs and the flip is invisible in isolation). Routed through one function, a flipped decrement instead applies to the counter as a whole, reversing every discovery-order tie-break in the walk at once — including the ones between two bookmarks or a bookmark and the content control it wraps, which the existing "discovery-order tie-breaks" tests already pin exactly, so that single shared mutation is caught where the nine scattered ones individually were not.
export function nextOrder(state: FlowState): number {
  return state.order++;
}

// Pairs the flow's range-marker halves (bookmarks, comment extents) by family+w:id into extents. A pair survives only when it has exactly one start and one end in this block list, both sit at a block boundary (and, for a bookmark, the start carries a name), and the end does not precede the start. Everything else — a half whose partner lies in a different block list (inside a table cell, or on the far side of a structured document tag), a duplicate id, a pair whose extent is a sub-sequence of one paragraph's runs — has no block-scoped encoding and is not emitted as a marker pair; the run-level case lands on the paragraph's own constructs field instead (runRangeMarkerExtents, called from readParagraph), and the rest stay dropped.
export function resolveRangeMarkerExtents(
  events: readonly RangeMarkerEvent[],
): ConstructExtent[] {
  const byId = new Map<string, RangeMarkerEvent[]>();
  for (const event of events) {
    const key = `${event.family}:${event.id}`;
    const existing = byId.get(key);
    if (existing === undefined) {
      byId.set(key, [event]);
    } else {
      existing.push(event);
    }
  }
  const extents: ConstructExtent[] = [];
  for (const halves of byId.values()) {
    const start = halves.filter((half) => half.kind === "start");
    const end = halves.filter((half) => half.kind === "end");
    const open = start[0];
    const close = end[0];
    if (
      start.length !== 1 ||
      end.length !== 1 ||
      open === undefined ||
      close === undefined
    ) {
      continue;
    }
    const descriptor: AnchorDescriptor | undefined =
      open.family === "comment"
        ? { kind: "anchor", anchorType: "comment", name: open.id }
        : open.name === undefined
          ? undefined
          : bookmarkAnchorDescriptor(open.name);
    if (
      descriptor === undefined ||
      !open.qualified ||
      !close.qualified ||
      close.index < open.index
    ) {
      continue;
    }
    extents.push({
      startIndex: open.index,
      endIndex: close.index,
      order: open.order,
      descriptor,
    });
  }
  return extents;
}

// A paragraph whose every content-bearing child is the same tracked-change element — Word's own spelling of a wholly inserted, deleted, or moved paragraph, which puts the change inside the paragraph rather than wrapping it. The extent is the whole paragraph, so this is block-scoped; a paragraph mixing tracked and untracked children is a run-level change with no encoding here. Author and date come from the first such element: a paragraph split across several same-tag elements by different authors carries only the first, since the descriptor names one author.
export function wholeParagraphTrackedChange(
  index: ParagraphContentIndex,
): { element: XmlElement; change: ProvenanceChange } | undefined {
  const content = contentBearingChildren(index);
  const first = content[0];
  if (first === undefined) {
    return undefined;
  }
  const change = PROVENANCE_CHANGE_BY_TAG.get(first.tag);
  if (
    change === undefined ||
    !content.every((child) => child.tag === first.tag)
  ) {
    return undefined;
  }
  return { element: first, change };
}

// A range-marker half inside a paragraph brackets whole blocks only when it sits outside every content-bearing child: a leading half opens (or closes) at the paragraph itself, a trailing one at the position after the paragraph's last block. A half between content children marks a sub-sequence of runs and is recorded as unqualified so resolveRangeMarkerExtents drops the whole pair rather than emitting a marker at the wrong place — dropping it from the BLOCK stream is not losing it when both halves sit in one paragraph, because runRangeMarkerExtents picks the pair up onto that paragraph's constructs field.
export function recordParagraphRangeMarkers(
  index: ParagraphContentIndex,
  paragraphIndex: number,
  endIndex: number,
  state: FlowState,
): void {
  index.elements.forEach((element, position) => {
    if (
      element.tag !== "w:bookmarkStart" &&
      element.tag !== "w:bookmarkEnd" &&
      element.tag !== "w:commentRangeStart" &&
      element.tag !== "w:commentRangeEnd"
    ) {
      return;
    }
    const id = attr(element, "w:id");
    if (id === undefined) {
      return;
    }
    const family: RangeMarkerFamily =
      element.tag === "w:bookmarkStart" || element.tag === "w:bookmarkEnd"
        ? "bookmark"
        : "comment";
    const start =
      element.tag === "w:bookmarkStart" ||
      element.tag === "w:commentRangeStart";
    // isLeadingContentPosition/isTrailingContentPosition (constructs.ts) are the exact same "before or after every content-bearing child" test isBlockScopedHalf applies to a run-level half — shared rather than duplicated, since both derive the identical fact from a ParagraphContentIndex.
    const leading = isLeadingContentPosition(index, position);
    const trailing = isTrailingContentPosition(index, position);
    if (start) {
      // Only a bookmark's start half carries a @w:name in real markup, and the pairing below reads a name only for bookmarks (a comment extent is named by its own w:id), so reading @w:name unconditionally is safe even for a comment start carrying one.
      const name = attr(element, "w:name");
      state.rangeMarkerEvents.push({
        family,
        id,
        name: name === undefined ? undefined : decodeEntities(name),
        kind: "start",
        index: leading ? paragraphIndex : endIndex,
        qualified: leading || trailing,
        order: nextOrder(state),
      });
      return;
    }
    state.rangeMarkerEvents.push({
      family,
      id,
      name: undefined,
      kind: "end",
      index: trailing ? endIndex : paragraphIndex,
      qualified: leading || trailing,
      order: nextOrder(state),
    });
  });
}

// A field is block-scoped when its opening w:fldChar begin is the paragraph's first content-bearing child and its closing w:fldChar end is the last content-bearing child of whichever paragraph closes it — the multi-paragraph TOC shape, and the single-paragraph case where the field is the paragraph's entire content. A w:fldSimple is block-scoped on the same test: it must be its paragraph's only content-bearing child. A field beginning or ending mid-paragraph ("Page 3 of 10", a cross-reference inside a sentence) covers a sub-sequence of runs and has no encoding here; its cached result text still reaches the output as ordinary run text, exactly as before, so only the field-ness and the instruction are lost.
//
// The field's cached result is deliberately never spelled on the descriptor: FieldDescriptor.cachedResult is for a field whose result is a scalar, and a block-scoped field's result is the block content its extent already wraps — document-schema.js states the two are the block and the scalar case of one fact, never two encodings of the same one.
export function scanParagraphFields(
  index: ParagraphContentIndex,
  paragraphIndex: number,
  endIndex: number,
  state: FlowState,
): void {
  const content = contentBearingChildren(index);
  content.forEach((child, position) => {
    if (child.tag === "w:fldSimple") {
      if (content.length === 1) {
        state.extents.push({
          startIndex: paragraphIndex,
          endIndex,
          order: nextOrder(state),
          descriptor: {
            kind: "field",
            instruction: decodeEntities(attr(child, "w:instr") ?? ""),
          },
        });
      }
      return;
    }
    if (child.tag !== "w:r") {
      return;
    }
    const type = fieldCharType(child);
    if (type === "begin") {
      state.openFields.push({
        instruction: "",
        inCode: true,
        startIndex: paragraphIndex,
        qualifiedStart: position === 0,
        order: nextOrder(state),
        formControl: readFormControlDescriptor(child),
      });
      return;
    }
    if (type === "separate") {
      const open = state.openFields[state.openFields.length - 1];
      if (open !== undefined) {
        open.inCode = false;
      }
      return;
    }
    if (type === "end") {
      const open = state.openFields.pop();
      if (
        open !== undefined &&
        open.qualifiedStart &&
        position === content.length - 1
      ) {
        state.extents.push({
          startIndex: open.startIndex,
          endIndex,
          order: open.order,
          descriptor: open.formControl ?? {
            kind: "field",
            instruction: open.instruction,
          },
        });
      }
      return;
    }
    const open = state.openFields[state.openFields.length - 1];
    if (open?.inCode === true) {
      open.instruction += runInstructionText(child);
    }
  });
}

export function collectParagraph(
  paragraph: XmlElement,
  ctx: DocxReadContext,
  state: FlowState,
  carryDeletions: boolean,
): void {
  const index = indexParagraphContent(paragraph);
  const tracked = wholeParagraphTrackedChange(index);
  const paragraphDeleted =
    carryDeletions ||
    (tracked !== undefined && isDeletedChange(tracked.change));

  if (hasPageBreakBefore(paragraph)) {
    state.blocks.push({ kind: "pageBreak" });
  }
  // The pageBreak block above sits outside every extent recorded here: it is the paragraph's own w:pageBreakBefore rendered as a preceding block, not part of any construct that brackets the paragraph. A mid-run page-type w:br produces its own pageBreak block too, spliced between the two ContentParagraph halves readParagraphBlocks returns for it — see that function's own doc comment. The lifted media blocks readParagraphBlocks now appends sit INSIDE the extent, exactly where the separate push below used to place them.
  const paragraphIndex = state.blocks.length;
  state.blocks.push(...readParagraphBlocks(paragraph, ctx, paragraphDeleted));
  const endIndex = state.blocks.length;

  if (tracked !== undefined) {
    state.extents.push({
      startIndex: paragraphIndex,
      endIndex,
      order: nextOrder(state),
      descriptor: readProvenanceDescriptor(tracked.element, tracked.change),
    });
  }
  recordParagraphRangeMarkers(index, paragraphIndex, endIndex, state);
  scanParagraphFields(index, paragraphIndex, endIndex, state);

  const pPr = childrenWithTag(paragraph, "w:pPr")[0];
  const sectPr =
    pPr === undefined ? undefined : childrenWithTag(pPr, "w:sectPr")[0];
  if (sectPr !== undefined) {
    state.sectionBreaks.push({ index: state.blocks.length, sectPr });
  }
}

// Walks block-level content (w:p, w:tbl) into one flat block list plus the construct extents bracketing it. A structured document tag (w:sdt), a tracked change (w:ins/w:del/w:moveFrom/w:moveTo), and mc:AlternateContent (Fallback preferred, else the first Choice) all recurse into the SAME list rather than starting a nested one: the first two become construct extents over the blocks they contributed, and alternate content is unwrapped as before, since a taken branch is content rather than a construct. Any w:drawing or w:object found inside a paragraph is surfaced as a sibling ContentImageBlock/ContentEmbeddedObjectBlock immediately following that paragraph's own block — see readParagraphLiftedBlocks.
export function collectFlowNodes(
  nodes: readonly XmlNode[],
  ctx: DocxReadContext,
  state: FlowState,
  carryDeletions: boolean,
): void {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "w:p") {
      collectParagraph(node, ctx, state, carryDeletions);
      continue;
    }
    if (node.tag === "w:tbl") {
      state.blocks.push(readTable(node, ctx, carryDeletions));
      continue;
    }
    if (node.tag === "w:sdt") {
      const order = nextOrder(state);
      const startIndex = state.blocks.length;
      const sdtContent = childrenWithTag(node, "w:sdtContent")[0];
      if (sdtContent !== undefined) {
        collectFlowNodes(sdtContent.children, ctx, state, carryDeletions);
      }
      state.extents.push({
        startIndex,
        endIndex: state.blocks.length,
        order,
        descriptor: readContentControlDescriptor(node),
      });
      continue;
    }
    const change = PROVENANCE_CHANGE_BY_TAG.get(node.tag);
    if (change !== undefined) {
      const order = nextOrder(state);
      const startIndex = state.blocks.length;
      collectFlowNodes(
        node.children,
        ctx,
        state,
        carryDeletions || isDeletedChange(change),
      );
      state.extents.push({
        startIndex,
        endIndex: state.blocks.length,
        order,
        descriptor: readProvenanceDescriptor(node, change),
      });
      continue;
    }
    if (node.tag === "mc:AlternateContent") {
      const target =
        childrenWithTag(node, "mc:Fallback")[0] ??
        childrenWithTag(node, "mc:Choice")[0];
      if (target !== undefined) {
        collectFlowNodes(target.children, ctx, state, carryDeletions);
      }
      continue;
    }
    if (node.tag === "w:bookmarkStart" || node.tag === "w:commentRangeStart") {
      const id = attr(node, "w:id");
      // Only a bookmark start carries a @w:name in real markup, and the pairing reads a name only for bookmarks (a comment extent is named by its own w:id), so the unconditional read is safe even for a comment start carrying one.
      const name = attr(node, "w:name");
      if (id !== undefined) {
        state.rangeMarkerEvents.push({
          family: node.tag === "w:bookmarkStart" ? "bookmark" : "comment",
          id,
          name: name === undefined ? undefined : decodeEntities(name),
          kind: "start",
          index: state.blocks.length,
          qualified: true,
          order: nextOrder(state),
        });
      }
      continue;
    }
    if (node.tag === "w:bookmarkEnd" || node.tag === "w:commentRangeEnd") {
      const id = attr(node, "w:id");
      if (id !== undefined) {
        state.rangeMarkerEvents.push({
          family: node.tag === "w:bookmarkEnd" ? "bookmark" : "comment",
          id,
          name: undefined,
          kind: "end",
          index: state.blocks.length,
          qualified: true,
          order: nextOrder(state),
        });
      }
      continue;
    }
    if (node.tag === "w:sectPr") {
      state.sectionBreaks.push({ index: state.blocks.length, sectPr: node });
    }
  }
}

// One self-contained bracket scope: a table cell's own content, or a header/footer's, walked and closed with its markers spliced in. The document body is not read through this — see readSections, which splits one walk across several sections.
export function readBlockScope(
  nodes: readonly XmlNode[],
  ctx: DocxReadContext,
  carryDeletions: boolean,
): ContentBlock[] {
  const state = newFlowState();
  collectFlowNodes(nodes, ctx, state, carryDeletions);
  return insertConstructMarkers(associateFigureCaptions(state.blocks), [
    ...state.extents,
    ...resolveRangeMarkerExtents(state.rangeMarkerEvents),
  ]);
}

// A mid-document section break is an otherwise-ordinary w:p whose w:pPr carries its own w:sectPr, describing the section that paragraph (and everything since the previous break) belongs to; the body's own trailing w:sectPr (a direct child, not nested in any paragraph) closes the final section. Multi-section support falls out of this directly: the body is walked once, and each break just cuts the resulting block list.
//
// Every section's blocks are their own bracket scope, so an extent straddling a section break is dropped rather than being split into two half-constructs — one of the not-representable cases document-schema.js's extent-scope note ratifies (cross-list pairing is ids, and the marker contract refuses ids), and the reason the split happens after the walk rather than during it (a construct's own two ends are only known once both have been seen).
// One section's own header/footer references, read from its w:sectPr exactly as spelled: each w:headerReference/w:footerReference names a part through the document's own relationships and a slot (default/first/even). A reference whose r:id resolves to no relationship is left out rather than recorded against a target that does not exist.
export function readSectionHeaderFooters(
  sectPr: XmlElement,
  ctx: DocxReadContext,
): SectionHeaderFooterReferences {
  const references: SectionHeaderFooterReferences = {};
  for (const tag of ["w:headerReference", "w:footerReference"] as const) {
    const slot: Partial<Record<"default" | "first" | "even", string>> = {};
    for (const reference of childrenWithTag(sectPr, tag)) {
      const type = attr(reference, "w:type");
      const rId = attr(reference, "r:id");
      const target = rId === undefined ? undefined : ctx.rels.get(rId)?.target;
      if (
        (type === "default" || type === "first" || type === "even") &&
        target !== undefined
      ) {
        slot[type] = target;
      }
    }
    if (Object.keys(slot).length > 0) {
      references[tag === "w:headerReference" ? "header" : "footer"] = slot;
    }
  }
  return references;
}

// The part holding the document body, named by the package root's own officeDocument relationship. The conventional word/document.xml is the fallback for a package that declares no usable such relationship, which is the shape every package this reader's own test fixtures build takes.
export function resolveDocxMainPartPath(pkg: Package): string {
  return findMainPartPath(pkg) ?? CONVENTIONAL_DOCUMENT_PART_PATH;
}

// Every header/footer part in the package, in sorted package-key order: the ones the main part declares a header/footer relationship to, unioned with every part matching the conventional word/header*/word/footer* path shape. The union is deliberate — a package whose body sits somewhere other than word/ keeps its header parts wherever its own relationships say, while an orphaned part nothing references still surfaces here rather than nowhere, as it always has.
export function headerFooterPartPaths(
  pkg: Package,
  documentPartPath: string,
): string[] {
  const paths = new Set(
    Object.keys(pkg.parts).filter(
      (path) =>
        (path.startsWith("word/header") || path.startsWith("word/footer")) &&
        path.endsWith(".xml"),
    ),
  );
  for (const relationship of resolveRelationships(
    pkg,
    documentPartPath,
  ).values()) {
    if (
      (relationship.type.endsWith(HEADER_REL_SUFFIX) ||
        relationship.type.endsWith(FOOTER_REL_SUFFIX)) &&
      relationship.targetMode !== "External" &&
      hasPart(pkg, relationship.target)
    ) {
      paths.add(relationship.target);
    }
  }
  return [...paths].sort();
}

// Each header/footer part as block flow: the part's own body walked by the same collectFlowNodes machinery the document body uses, against the part's OWN relationships (an image inside a header resolves through the header part's rels, not the document's) while sharing the document's style/theme cascade. Parts are listed in sorted package-key order, one entry per part; headerFooterPartPaths above decides which parts those are.
export function readHeaderFooterParts(
  pkg: Package,
  documentPartPath: string,
  ctx: DocxReadContext,
): HeaderFooterPart[] {
  const parts: HeaderFooterPart[] = [];
  for (const path of headerFooterPartPaths(pkg, documentPartPath)) {
    const root = rootElement(pkg.parts[path]);
    if (root === undefined) {
      continue;
    }
    const kind = root.tag === "w:ftr" ? "footer" : "header";
    const partCtx: DocxReadContext = {
      styles: ctx.styles,
      rels: resolveRelationships(pkg, path),
      pkg,
    };
    parts.push({
      path,
      kind,
      blocks: readBlockScope(root.children, partCtx, false),
    });
  }
  return parts;
}

export function readSections(
  body: XmlElement,
  ctx: DocxReadContext,
): {
  sections: ContentSection[];
  headerFooters: SectionHeaderFooterReferences[];
} {
  const state = newFlowState();
  collectFlowNodes(body.children, ctx, state, false);
  const extents = [
    ...state.extents,
    ...resolveRangeMarkerExtents(state.rangeMarkerEvents),
  ];

  function sliceSection(
    pageSize: Readonly<PageSize>,
    margins: Readonly<Margins>,
    breakType: ContentSection["breakType"],
    from: number,
    to: number,
  ): ContentSection {
    const contained = extents
      .filter((extent) => extent.startIndex >= from && extent.endIndex <= to)
      .map((extent) => ({
        ...extent,
        startIndex: extent.startIndex - from,
        endIndex: extent.endIndex - from,
      }));
    return {
      pageSize,
      margins,
      ...(breakType === undefined ? {} : { breakType }),
      blocks: insertConstructMarkers(
        associateFigureCaptions(state.blocks.slice(from, to)),
        contained,
      ),
    };
  }

  const sections: ContentSection[] = [];
  const headerFooters: SectionHeaderFooterReferences[] = [];
  let from = 0;
  for (const sectionBreak of state.sectionBreaks) {
    sections.push(
      sliceSection(
        readPageSize(sectionBreak.sectPr),
        readMargins(sectionBreak.sectPr),
        readSectionBreakType(sectionBreak.sectPr),
        from,
        sectionBreak.index,
      ),
    );
    headerFooters.push(readSectionHeaderFooters(sectionBreak.sectPr, ctx));
    from = sectionBreak.index;
  }
  if (from < state.blocks.length || sections.length === 0) {
    sections.push(
      sliceSection(
        PAGE_SIZE_LETTER,
        DEFAULT_MARGINS,
        undefined,
        from,
        state.blocks.length,
      ),
    );
    headerFooters.push({});
  }
  sections.forEach((section, sectionIndex) => {
    assignSourcePaths(section.blocks, `sections[${sectionIndex}]`);
  });
  return { sections, headerFooters };
}

export function readDocumentTheme(
  pkg: Package,
  docRels: ReadonlyMap<string, Relationship>,
): DrawingTheme {
  for (const rel of docRels.values()) {
    if (rel.type.endsWith(THEME_REL_SUFFIX)) {
      const themeRoot = rootElement(pkg.parts[rel.target]);
      if (themeRoot !== undefined) {
        return readTheme(themeRoot);
      }
    }
  }
  return EMPTY_THEME;
}
