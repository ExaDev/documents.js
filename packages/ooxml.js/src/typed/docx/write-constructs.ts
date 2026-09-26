import type {
  ConstructDescriptor,
  ContentBlock,
  ProvenanceDescriptor,
} from "document-schema.js";
import type { FlowItem, WriteState } from "./write";
import type { XmlElement, XmlNode } from "../../model/node";
import { buildSdtProperties } from "./write";
import { trailingEmptyRunElements } from "./write-links";
import { buildParagraph } from "./write-run";
import { buildDrawing, buildObjectElement } from "./write-embedded";
import { buildTable } from "./write-table";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { findConstructMarkerImbalance } from "document-schema.js";
import { isDeletedChange } from "./constructs";
// The flow-item and construct family of the docx writer, split from write.ts: parsing the section flow into items, field runs, content-control (sdt) constructs with their gallery restoration, and assembling the block flow. write.ts keeps run/paragraph/table emission and the package assembly.
export function parseFlow(blocks: readonly ContentBlock[]): FlowItem[] {
  const imbalance = findConstructMarkerImbalance(blocks);
  if (imbalance !== undefined) {
    throw new Error(
      `buildDocxPackageFromContent: construct markers do not balance (${imbalance.kind} at block ${String(imbalance.index)})`,
    );
  }
  const roots: FlowItem[] = [];
  const stack: FlowItem[][] = [roots];
  for (const block of blocks) {
    const current = stack[stack.length - 1]!;
    if (block.kind === "constructStart") {
      const item: FlowItem = {
        kind: "construct",
        descriptor: block.descriptor,
        children: [],
      };
      current.push(item);
      stack.push(item.children);
      continue;
    }
    if (block.kind === "constructEnd") {
      stack.pop();
      continue;
    }
    current.push({ kind: "block", block });
  }
  return roots;
}

// A field's own w:fldChar characters have to sit inside the extent's paragraphs rather than beside them, since that is exactly where the reader's block-scope test looks for them: the begin/instruction/separate group at the head of the first paragraph, the end at the tail of the last. These two walk the freshly-built nodes for those paragraphs, descending through whatever wrapper elements (w:ins, w:sdt) the extent's own nested constructs put in the way.
export function findParagraph(
  nodes: readonly XmlNode[],
  last: boolean,
): XmlElement | undefined {
  const ordered = last ? [...nodes].reverse() : nodes;
  for (const node of ordered) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "w:p") {
      return node;
    }
    if (node.tag === "w:tbl") {
      continue;
    }
    const nested = findParagraph(node.children, last);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

export function fieldCharRun(type: string): XmlElement {
  return el("w:r", {}, [el("w:fldChar", { "w:fldCharType": type })]);
}

export function fieldOpeningRuns(instruction: string): XmlElement[] {
  return [
    fieldCharRun("begin"),
    el("w:r", {}, [
      el("w:instrText", { "xml:space": "preserve" }, [
        txt(encodeXmlText(instruction)),
      ]),
    ]),
    fieldCharRun("separate"),
  ];
}

export function insertAfterProperties(
  paragraph: XmlElement,
  runs: readonly XmlElement[],
): void {
  const first = paragraph.children[0];
  const offset = first?.type === "element" && first.tag === "w:pPr" ? 1 : 0;
  paragraph.children.splice(offset, 0, ...runs);
}

export function buildFieldNodes(
  instruction: string,
  content: readonly XmlNode[],
): XmlNode[] {
  const first = findParagraph(content, false);
  const last = findParagraph(content, true);
  if (first === undefined || last === undefined) {
    return [
      el("w:p", {}, fieldOpeningRuns(instruction)),
      ...content,
      el("w:p", {}, [fieldCharRun("end")]),
    ];
  }
  insertAfterProperties(first, fieldOpeningRuns(instruction));
  last.children.push(fieldCharRun("end"));
  return [...content];
}

// `provenance` is the ambient tracked change, if any, this construct sits inside — a bookmark, content control, or field nested inside a tracked-change range does not interrupt that change, since it wraps at a different level (block-sibling markers, or an element around the extent) that coexists with the change wrapping the paragraphs' own marks and runs underneath. Every branch but the provenance one itself threads the ambient value straight through to whatever paragraphs its own content eventually reaches; the provenance branch replaces it with its own descriptor for its own extent, the ordinary nesting rule for two constructs of the same kind.
export function buildConstructNodes(
  descriptor: ConstructDescriptor,
  children: readonly FlowItem[],
  state: WriteState,
  deleted: boolean,
  provenance: ProvenanceDescriptor | undefined,
): XmlNode[] {
  if (descriptor.kind === "contentControl") {
    return [
      el("w:sdt", {}, [
        buildSdtProperties(descriptor),
        el(
          "w:sdtContent",
          {},
          buildFlowItems(children, state, deleted, provenance),
        ),
      ]),
    ];
  }
  if (descriptor.kind === "provenance") {
    // No block-level element here, and no branch on whether TRACKED_CHANGE_TAG_BY_CHANGE has an entry for this change: buildParagraph reads descriptor.change back out of the threaded provenance itself and decides there whether to wrap each paragraph's own runs in a tag, so this only needs to thread the descriptor through unconditionally — the ordinary nesting rule for two constructs of the same kind, replacing whatever ambient provenance this extent sits inside for every paragraph the extent reaches. A formatChange nested inside an outer tracked change (an insertion's own pPrChange, say) therefore correctly stops inheriting the outer change's own w:ins/w:del wrapper for its own extent, rather than silently carrying it through untouched.
    return buildFlowItems(
      children,
      state,
      deleted || isDeletedChange(descriptor.change),
      descriptor,
    );
  }
  if (descriptor.kind === "anchor" && descriptor.anchorType === "bookmark") {
    const id = String(state.counters.nextMarkerId++);
    return [
      el("w:bookmarkStart", {
        "w:id": id,
        "w:name": encodeXmlText(descriptor.name),
      }),
      ...buildFlowItems(children, state, deleted, provenance),
      el("w:bookmarkEnd", { "w:id": id }),
    ];
  }
  // A comment extent spanning more than one paragraph reads back as a block-scoped construct (constructs.ts's own block/run split, mirroring the identical bookmark case immediately above) rather than a run-level one — its own w:id is descriptor.name verbatim, the SAME join key the run-level comment-range branch in interleaveRunConstructExtents writes, since both are the identical comments.xml entry's own id. The comment's own reference mark (w:commentReference) is never block-scoped — it is always a single run inside whichever one paragraph carries it — so it is handled entirely by the run-level noteReferences branch regardless of whether the range wrapping it here is block- or run-scoped.
  if (descriptor.kind === "anchor" && descriptor.anchorType === "comment") {
    const id = encodeXmlText(descriptor.name);
    return [
      el("w:commentRangeStart", { "w:id": id }),
      ...buildFlowItems(children, state, deleted, provenance),
      el("w:commentRangeEnd", { "w:id": id }),
    ];
  }
  if (descriptor.kind === "field") {
    return buildFieldNodes(
      descriptor.instruction,
      buildFlowItems(children, state, deleted, provenance),
    );
  }
  return buildFlowItems(children, state, deleted, provenance);
}

// `provenance` propagates a tracked change down to the paragraphs it wraps so each paragraph's own mark — and its own runs — carry the same change; it flows straight through a nested non-provenance construct (buildConstructNodes threads it on), since a bookmark or content control nested inside a tracked-change range does not interrupt the change, and only stops where a nested provenance construct replaces it with its own descriptor for its own extent.
//
// `pendingPageBreak` carries a still-unattached w:pageBreakBefore forward across sibling items in `items`, since the paragraph that break belongs to may not be the very next item: it can be inside a nested construct (a page-break-before paragraph that also opens a bookmark or tracked change), or there may be no paragraph at all before the next table or image. The construct branch below re-delegates a pending break into that construct's own children (as a synthetic leading pageBreak block) so the same paragraph-attachment logic finds it however deep it is nested; the table and image branches, which cannot carry w:pageBreakBefore themselves, materialise it as their own leading empty paragraph instead.
export function buildFlowItems(
  items: readonly FlowItem[],
  state: WriteState,
  deleted: boolean,
  provenance: ProvenanceDescriptor | undefined,
): XmlNode[] {
  const nodes: XmlNode[] = [];
  let pendingPageBreak = false;
  let lastParagraph: XmlElement | undefined;
  let availableImageRuns: XmlElement[] = [];
  for (const item of items) {
    if (item.kind === "construct") {
      const pageBreakItem: FlowItem = {
        kind: "block",
        block: { kind: "pageBreak" },
      };
      const constructChildren = pendingPageBreak
        ? [pageBreakItem, ...item.children]
        : item.children;
      nodes.push(
        ...buildConstructNodes(
          item.descriptor,
          constructChildren,
          state,
          deleted,
          provenance,
        ),
      );
      pendingPageBreak = false;
      lastParagraph = undefined;
      availableImageRuns = [];
      continue;
    }
    const block = item.block;
    if (block.kind === "pageBreak") {
      pendingPageBreak = true;
      continue;
    }
    if (block.kind === "paragraph") {
      const paragraph = buildParagraph(
        block,
        state,
        pendingPageBreak,
        deleted,
        provenance,
      );
      pendingPageBreak = false;
      lastParagraph = paragraph;
      availableImageRuns = trailingEmptyRunElements(block, paragraph);
      nodes.push(paragraph);
      continue;
    }
    if (block.kind === "image") {
      if (pendingPageBreak) {
        const breakParagraph = el("w:p", {}, [
          el("w:pPr", {}, [el("w:pageBreakBefore")]),
        ]);
        nodes.push(breakParagraph);
        lastParagraph = breakParagraph;
        availableImageRuns = [];
        pendingPageBreak = false;
      }
      const drawing = buildDrawing(block, state);
      const reusable = availableImageRuns.shift();
      if (reusable !== undefined) {
        reusable.children.push(drawing);
      } else if (lastParagraph !== undefined) {
        lastParagraph.children.push(el("w:r", {}, [drawing]));
      } else {
        const paragraph = el("w:p", {}, [el("w:r", {}, [drawing])]);
        lastParagraph = paragraph;
        nodes.push(paragraph);
      }
      continue;
    }
    if (block.kind === "table") {
      if (pendingPageBreak) {
        nodes.push(el("w:p", {}, [el("w:pPr", {}, [el("w:pageBreakBefore")])]));
        pendingPageBreak = false;
      }
      nodes.push(buildTable(block, state, deleted));
      lastParagraph = undefined;
      availableImageRuns = [];
      continue;
    }
    // The embedded-object inverse of readParagraphLiftedBlocks: the reader lifted the w:object out of the paragraph that contained it as a sibling block, so the writer puts it back into that paragraph's trailing empty run (the run an object-only w:r reads back as), falling back to a fresh run on the last paragraph or a paragraph of its own — the same placement ladder an image follows, since both were lifted by the same convention. A pending page break is materialised first because a w:object cannot carry w:pageBreakBefore itself, exactly as for an image.
    if (block.kind === "embeddedObject") {
      if (pendingPageBreak) {
        const breakParagraph = el("w:p", {}, [
          el("w:pPr", {}, [el("w:pageBreakBefore")]),
        ]);
        nodes.push(breakParagraph);
        lastParagraph = breakParagraph;
        availableImageRuns = [];
        pendingPageBreak = false;
      }
      const object = buildObjectElement(block, state);
      const reusable = availableImageRuns.shift();
      if (reusable !== undefined) {
        reusable.children.push(object);
      } else if (lastParagraph !== undefined) {
        lastParagraph.children.push(el("w:r", {}, [object]));
      } else {
        const paragraph = el("w:p", {}, [el("w:r", {}, [object])]);
        lastParagraph = paragraph;
        nodes.push(paragraph);
      }
      continue;
    }
  }
  if (pendingPageBreak) {
    nodes.push(el("w:p", {}, [el("w:pPr", {}, [el("w:pageBreakBefore")])]));
  }
  return nodes;
}

export function buildBlockFlow(
  blocks: readonly ContentBlock[],
  state: WriteState,
  deleted: boolean,
): XmlNode[] {
  return buildFlowItems(parseFlow(blocks), state, deleted, undefined);
}
