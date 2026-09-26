import type {
  ContentBlock,
  ContentConstructStart,
  ContentDocument,
  ContentSection,
  LayoutFrame,
  ContentSheet,
} from "document-schema.js";
import {
  layoutItemToVector,
  recoverPageVectors,
  reconstructSheet,
} from "./reconstruct-presentations-prod";
import {
  clusterIntoLines,
  clusterIntoParagraphs,
  type TextParagraph,
  HALF_POINT_BUCKET_PT,
  modeOf,
  paragraphToContentParagraph,
} from "./reconstruct-lines";
import { recoverTables } from "./reconstruct-tables";

// Deep-imported from pdf-codec's asset-free read-side modules rather than its root barrel: the reconstruction path is part of this package's read-only graph (documents.js/read), and the barrel's write half would drag the vendored font assets into it. See src/read-graph.test.ts.
import type {
  LayoutAnnotation,
  LayoutFormField,
  LayoutImage,
  LayoutImageAsset,
  LayoutInternalLink,
  LayoutItem,
  LayoutLink,
  LayoutPage,
  LayoutStructureElement,
  LayoutText,
  LayoutDocument,
} from "pdf-codec";
import type { Margins } from "document-schema.js";
import { throwIfAborted } from "../ports/abort";
import { stampFrame } from "./shared";
import type { CellTypeInferenceSink } from "./cell-typing";

// A modest, deliberately nominal fallback for the rare edge case where even the widest measured text extent in the last recovered column is zero (e.g. a LayoutText item carrying no widthPt at all) — not claimed as a real recovered value, just enough to keep the resulting ContentSheetColumn structurally sane.
export const DEFAULT_COLUMN_WIDTH_FALLBACK_PT = 40;

export const NO_ITEMS: ReadonlySet<LayoutItem> = new Set();

// A horizontal gap exceeding 2 em within a line reads as tabbed/columnar content, not natural word spacing (plan Step 10, both the docx tab-insertion rule and the pptx same-line block split).

export interface ReconstructOptions {
  readonly signal?: AbortSignal;
  // Called once per recovered spreadsheet cell whose rendered text was either RE-TYPED away from a plain string or deliberately DECLINED as too ambiguous to re-type — reconstructSpreadsheet's own audit trail for a step that is, unavoidably, probabilistic. See src/layout/cell-typing.ts for the confidence bar each outcome is decided against. Cells whose text is not number/date/boolean-shaped at all are not reported: there was no inference to make, so there is nothing to audit.
  readonly onCellTypeInference?: CellTypeInferenceSink;
}

// LayoutDocument -> ContentDocument: PDF has no semantic paragraph/shape structure, just positioned glyphs and images, so both directions here are necessarily best-effort reconstructions from geometry — this is the plan's most explicit fidelity trade-off, not a bug to be perfected later. Every threshold below is either the exact value the implementation plan specifies (cited inline) or a documented, deliberately bounded heuristic.

export const ZERO_MARGINS: Margins = {
  topPt: 0,
  rightPt: 0,
  bottomPt: 0,
  leftPt: 0,
};

// ---------------------------------------------------------------------------
// PDF -> docx (wordprocessing): line clustering, then paragraph clustering.
// ---------------------------------------------------------------------------

export function reconstructWordprocessing(
  doc: LayoutDocument,
  options?: ReconstructOptions,
): ContentDocument {
  const signal = options?.signal;
  doc = dropHiddenLayerContent(doc);
  const headingLevels = headingSizeLevels(doc);
  const structure = indexStructure(doc);
  const sections: ContentSection[] = [];
  let currentGroup: LayoutPage[] = [];
  let groupStartPageIndex = 0;
  for (const page of doc.pages) {
    throwIfAborted(signal);
    if (currentGroup.length > 0 && !samePageSize(currentGroup[0]!, page)) {
      sections.push(
        buildSection(
          currentGroup,
          groupStartPageIndex,
          doc.images,
          headingLevels,
          doc.form,
          structure,
        ),
      );
      groupStartPageIndex += currentGroup.length;
      currentGroup = [];
    }
    currentGroup.push(page);
  }
  if (currentGroup.length > 0) {
    sections.push(
      buildSection(
        currentGroup,
        groupStartPageIndex,
        doc.images,
        headingLevels,
        doc.form,
        structure,
      ),
    );
  }
  return { kind: "wordprocessing", metadata: doc.metadata, sections };
}

// --- Optional-content visibility (#721): content in a layer the default configuration hides is not extracted as if visible. ---

// The layer an item carries, with the annotation-rectangle kinds (link, internalLink) reading as none — they are not layer-governed content.
function layerOf(item: LayoutItem): string | undefined {
  return item.kind === "link" || item.kind === "internalLink"
    ? undefined
    : item.layer;
}

// A shallow copy of the document whose pages carry only the items the default view shows — annotations stay regardless (a sticky note pinned over hidden content is still a note). Everything downstream (clustering, table recovery, vector recovery) then works on visible content only, with no per-consumer visibility logic to forget.
function dropHiddenLayerContent(doc: LayoutDocument): LayoutDocument {
  const hidden = new Set(
    (doc.layers ?? [])
      .filter((layer) => !layer.visible)
      .map((layer) => layer.name),
  );
  if (hidden.size === 0) {
    return doc;
  }
  return {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      items: page.items.filter(
        (item) => layerOf(item) === undefined || !hidden.has(layerOf(item)!),
      ),
    })),
  };
}

// --- Tagged structure (#760): the producer's own semantics, replacing geometric inference wherever the file states the fact. ---
//
// A tagged PDF is the one format state this reconstruction otherwise infers: headings, table cells, and grouping containers are STATED in /StructTreeRoot, not guessed from geometry. readPdf flattens that tree into LayoutDocument.structure and stamps each item with its owning element's id; the index below turns those two facts into the three queries the reconstruction consumes — the heading level an item's owning element chain implies, the cell/row/table a text item belongs to, and the chain of division elements (/Part /Sect /Div) enclosing it. Everything is a nearest-ancestor walk: a /Span inside an /H2 reads as heading content exactly as direct ownership would, the same way effective properties resolve down a style chain.

// H1..H6 in order: the level each tag carries is its own position in that sequence.
const HEADING_TAGS = ["H1", "H2", "H3", "H4", "H5", "H6"] as const;
const HEADING_LEVELS: ReadonlyMap<string, number> = new Map(
  HEADING_TAGS.map((tag, index) => [tag, index + 1] as const),
);
// The grouping types mapped to the schema's division construct — the shape document-schema.js's own construct vocabulary names tagged PDF's /Sect and /Div as its cross-format analogue for, plus /Part as the coarsest grouping. /Art and /BlockQuote stay out deliberately: they are semantic block containers closer to a block quote than a named division, and conflating them would invent grouping the schema keeps distinct.
const DIVISION_TYPES: ReadonlySet<string> = new Set(["Part", "Sect", "Div"]);
export const CELL_TYPES: ReadonlySet<string> = new Set(["TD", "TH"]);
export const ROW_TYPES: ReadonlySet<string> = new Set(["TR"]);
export const TABLE_TYPES: ReadonlySet<string> = new Set(["Table"]);

// One flattened structure element: its place in the tree stated as a parent link (the nested LayoutStructureElement only carries children), plus the pre-order position the tree walk assigned it — the document order rows and cells of a tagged table sort by.
export interface StructureNode {
  readonly id: string;
  readonly type: string;
  readonly parent: StructureNode | undefined;
  readonly order: number;
}

export interface StructureIndex {
  readonly nodeOfItem: (item: LayoutItem) => StructureNode | undefined;
}

// The link kinds carry no structure id by the same line the layer filter draws — an annotation is an anchored construct, not painted stream content.
export function indexStructure(
  doc: LayoutDocument,
): StructureIndex | undefined {
  if (doc.structure === undefined || doc.structure.length === 0) {
    return undefined;
  }
  const byId = new Map<string, StructureNode>();
  let order = 0;
  const walk = (
    element: LayoutStructureElement,
    parent: StructureNode | undefined,
  ): void => {
    const node: StructureNode = {
      id: element.id,
      type: element.type,
      parent,
      order: order++,
    };
    byId.set(element.id, node);
    for (const child of element.children) {
      walk(child, node);
    }
  };
  for (const root of doc.structure) {
    walk(root, undefined);
  }
  return {
    nodeOfItem: (item: LayoutItem): StructureNode | undefined =>
      item.kind === "link" || item.kind === "internalLink"
        ? undefined
        : byId.get(item.structure ?? ""),
  };
}

// The nearest node of one of `types` on the ancestor path from `node` (inclusive).
export function nearestOfType(
  node: StructureNode | undefined,
  types: ReadonlySet<string>,
): StructureNode | undefined {
  for (let current = node; current !== undefined; current = current.parent) {
    if (types.has(current.type)) {
      return current;
    }
  }
  return undefined;
}

// The heading level implied by an item's owning chain: the first H1..H6 element at or above its owner, or undefined when the chain names none.
function nearestHeadingLevel(
  node: StructureNode | undefined,
): number | undefined {
  for (let current = node; current !== undefined; current = current.parent) {
    const level = HEADING_LEVELS.get(current.type);
    if (level !== undefined) {
      return level;
    }
  }
  return undefined;
}

// A paragraph's heading resolution against the structure tree. A non-undefined result is AUTHORITATIVE: `level` set means the owning chain names an H element (regardless of font size), and `level` undefined means every item is tagged and none is heading-owned — the producer says body, which VETOES the geometric census rather than merely failing to confirm it. Undefined itself means structure makes no claim (some item untagged, or the items' levels disagree because clustering merged across a heading boundary), and the geometric census decides.
function structureHeadingLevel(
  items: readonly LayoutText[],
  structure: StructureIndex,
): { readonly level?: number } | undefined {
  if (
    items.length === 0 ||
    items.some((item) => structure.nodeOfItem(item) === undefined)
  ) {
    return undefined;
  }
  let level: number | undefined;
  for (const item of items) {
    const itemLevel = nearestHeadingLevel(structure.nodeOfItem(item));
    if (itemLevel === undefined) {
      return { level: undefined };
    }
    if (level === undefined) {
      level = itemLevel;
    } else if (level !== itemLevel) {
      return undefined;
    }
  }
  return { level };
}

// --- Heading inference from font size (ExaDev/documents.js#584 ask 2) -----------------------------------------
//
// PDF has no semantic headings, so reconstructing one is inference, and relative font size against the document's modal body size is the signal — the same category of heuristic the paragraph clustering above already applies to baseline spacing. The level is assigned by RANK, not by absolute ratio: every distinct size sitting at least HEADING_MIN_SIZE_DELTA_PT above the modal body size is a heading size, ranked largest-first into Heading1, Heading2, ... Ranking is what inverts this package's own write side exactly (the layout engine renders Heading1..4 at 28/22/18/14pt against a 12pt body, so '# Title / ## Section' round-trips its levels back), and it generalises honestly to foreign PDFs, where "the largest text is the title, the next largest are sections" is the well-worn reading. Sizes within the delta of the body — including this package's own Heading5 (12pt) and Heading6 (11pt) render sizes — carry no signal and stay paragraphs: a size a document's body itself can have is not evidence of anything.
//
// The census runs over every text item in the document, table text included: a paragraph's own dominant size must land on a census bucket to be classified, and the modal body size is strengthened, not skewed, by table text at body size. A document whose only text is headings degenerates to "the modal size is the heading size", classifying nothing — the conservative failure.
//
// A blank item — one whose recovered text is entirely whitespace — carries a real font size (a genuine visible-mode Tj at that size, unlike an empty string, which convertText in pdf-codec's own read.ts already drops before a LayoutText is ever built) but no content of its own to be a heading OF: a spacer run, a leader space, an editorial artifact left in a Word-authored specification (a heading-styled paragraph whose only content is a lone space, kept for pagination rather than a title). Counting it toward the census or a paragraph's dominant size would classify a blank paragraph as a heading purely from its font size, producing exactly the "bare '#' with nothing after it" ExaDev/documents.js#868 reports — so both the census and the per-paragraph lookup below exclude it, the same way an invisible or absent glyph already never reaches this stage at all.

// The smallest gap between the modal body size and a size that counts as heading-sized. 2pt admits the layout engine's own Heading4 (14pt against a 12pt body) with no margin to spare and excludes sub-point rounding jitter and nominal "slightly larger" text (13pt), which is genuinely indistinguishable from emphasis.
const HEADING_MIN_SIZE_DELTA_PT = 2;

// ATX's own ceiling: six '#' levels. A document with more than six distinct heading sizes clamps the deepest ones here rather than inventing deeper levels markdown cannot spell (markdown-codec's emitter clamps through document-schema.js's own clampHeadingLevel for the same reason).
const MAX_HEADING_LEVEL = 6;

function hasVisibleText(text: string): boolean {
  return text.trim().length > 0;
}

function headingSizeLevels(doc: LayoutDocument): ReadonlyMap<number, number> {
  const sizes: number[] = [];
  for (const page of doc.pages) {
    for (const item of page.items) {
      if (item.kind === "text" && hasVisibleText(item.text)) {
        sizes.push(item.sizePt);
      }
    }
  }
  if (sizes.length === 0) {
    return new Map();
  }
  const bodySizePt = modeOf(sizes, HALF_POINT_BUCKET_PT);
  const headingBuckets = new Set<number>();
  for (const size of sizes) {
    const bucket =
      Math.round(size / HALF_POINT_BUCKET_PT) * HALF_POINT_BUCKET_PT;
    if (bucket - bodySizePt >= HEADING_MIN_SIZE_DELTA_PT) {
      headingBuckets.add(bucket);
    }
  }
  const levels = new Map<number, number>();
  [...headingBuckets]
    .sort((a, b) => b - a)
    .forEach((bucket, index) => {
      levels.set(bucket, Math.min(index + 1, MAX_HEADING_LEVEL));
    });
  return levels;
}

// A clustered paragraph's dominant size, bucketed the same way the census buckets — the key its heading level (if any) is looked up by. Blank items are excluded here too, matching headingSizeLevels' own census: a paragraph whose only items are blank (an editorial spacer, never real content) has no items left to take a mode over, modeOf([], ...) returns 0, and 0pt never lands in the heading-bucket map — the same "no signal, stays a paragraph" outcome an all-body-size paragraph already gets, rather than inheriting a blank item's own heading-sized font.
function headingLevelOf(
  paragraph: TextParagraph,
  levels: ReadonlyMap<number, number>,
): number | undefined {
  return levels.get(
    modeOf(
      paragraph.lines
        .flatMap((line) => line.items)
        .filter((item) => hasVisibleText(item.text))
        .map((item) => item.sizePt),
      HALF_POINT_BUCKET_PT,
    ),
  );
}

function samePageSize(a: LayoutPage, b: LayoutPage): boolean {
  return a.widthPt === b.widthPt && a.heightPt === b.heightPt;
}

// Margins have no PDF equivalent to recover — there is no principled way to distinguish "intentional margin" from "wherever the content happened to start" from geometry alone, so this deliberately reports zero rather than fabricating a plausible-looking value (ZERO_MARGINS, defined above).
// startPageIndex is this section's own first page's absolute index in the whole LayoutDocument — a frame's pageIndex names a page of the SOURCE document, not a page within one section, so every block this section builds stamps absolute indices derived from it.
function buildSection(
  pages: readonly LayoutPage[],
  startPageIndex: number,
  images: Record<string, LayoutImageAsset>,
  headingLevels: ReadonlyMap<number, number>,
  form: readonly LayoutFormField[] | undefined,
  structure: StructureIndex | undefined,
): ContentSection {
  const blocks: ContentBlock[] = [];
  // Each content block's division chain, keyed by the block object itself so the marker splices reconcileLinks and the annotation/form construct appenders perform can never desync it — and so a block nobody recorded (a page break, a construct marker) passes through the division wrap without opening or closing anything.
  const divisionByBlock = new WeakMap<ContentBlock, readonly string[]>();
  pages.forEach((page, i) => {
    if (i > 0) {
      blocks.push({ kind: "pageBreak" });
    }
    blocks.push(
      ...reconstructPageBlocks(
        page,
        startPageIndex + i,
        images,
        headingLevels,
        form,
        structure,
        divisionByBlock,
      ),
    );
  });
  return {
    pageSize: { widthPt: pages[0]!.widthPt, heightPt: pages[0]!.heightPt },
    margins: ZERO_MARGINS,
    blocks: wrapDivisionExtents(blocks, divisionByBlock),
  };
}

// Table recovery runs FIRST, because it decides what is left for everything after it: text inside a recovered lattice belongs to the table, not to the page's paragraph flow, and the lattice's own strokes belong to the table's structure, not to the recovered vector content. Both recoveries are no-ops on a page without the geometry to support them, so a text-only page produces exactly the blocks it always did. See the shared recovery section below for the full reasoning behind each gate.
function reconstructPageBlocks(
  page: LayoutPage,
  pageIndex: number,
  images: Record<string, LayoutImageAsset>,
  headingLevels: ReadonlyMap<number, number>,
  form: readonly LayoutFormField[] | undefined,
  structure: StructureIndex | undefined,
  divisionByBlock: WeakMap<ContentBlock, readonly string[]>,
): ContentBlock[] {
  const recoveredTables = recoverTables(page, pageIndex, structure);
  const consumedText = new Set<LayoutText>();
  const claimedItems = new Set<LayoutItem>();
  for (const recovered of recoveredTables) {
    for (const item of recovered.consumedText) {
      consumedText.add(item);
    }
    for (const item of recovered.latticeItems) {
      claimedItems.add(item);
    }
  }
  const textItems = page.items.filter(
    (i): i is LayoutText => i.kind === "text" && !consumedText.has(i),
  );
  const imageItems = page.items.filter(
    (i): i is LayoutImage => i.kind === "image",
  );
  const lines = clusterIntoLines(textItems);
  const paragraphs = clusterIntoParagraphs(lines);

  // The one place a block's division chain is recorded from its own source items — the chain of /Part /Sect /Div elements enclosing them, common-prefixed across the cluster (a paragraph geometry merged across a division boundary claims only the divisions both halves share).
  const recordDivisions = (
    block: ContentBlock,
    items: readonly LayoutItem[],
  ): void => {
    if (structure !== undefined) {
      divisionByBlock.set(block, divisionChainOf(items, structure));
    }
  };

  const positioned: { yPt: number; block: ContentBlock }[] = [];
  for (const paragraph of paragraphs) {
    const paragraphItems = paragraph.lines.flatMap((line) => line.items);
    // Structure over geometry: an authoritative resolution replaces the census outright — including the level-undefined veto, where a producer-tagged body paragraph at heading SIZE stays a paragraph.
    const structural =
      structure === undefined
        ? undefined
        : structureHeadingLevel(paragraphItems, structure);
    const headingLevel =
      structural !== undefined
        ? structural.level
        : headingLevelOf(paragraph, headingLevels);
    const block = paragraphToContentParagraph(
      paragraph,
      pageIndex,
      headingLevel,
    );
    recordDivisions(block, paragraphItems);
    positioned.push({ yPt: paragraph.lines[0]!.baselineY, block });
  }
  for (const img of imageItems) {
    const asset = images[img.imageId];
    if (asset !== undefined) {
      const block: ContentBlock = {
        kind: "image",
        format: asset.format,
        base64: asset.base64,
        widthPt: img.widthPt,
        heightPt: img.heightPt,
      };
      stampFrame(block, pageIndex, {
        xPt: img.xPt,
        yPt: img.yPt,
        widthPt: img.widthPt,
        heightPt: img.heightPt,
      });
      recordDivisions(block, [img]);
      positioned.push({ yPt: img.yPt, block });
    }
  }
  for (const recovered of recoveredTables) {
    recordDivisions(recovered.table, [...recovered.consumedText]);
    positioned.push({ yPt: recovered.topYPt, block: recovered.table });
  }
  const recoveredVectors = recoverPageVectors(page, pageIndex, claimedItems);
  if (recoveredVectors !== undefined) {
    const vectorItems = page.items.filter(
      (item) =>
        !claimedItems.has(item) &&
        layoutItemToVector(item, page.heightPt) !== undefined,
    );
    recordDivisions(recoveredVectors.block, vectorItems);
    positioned.push({
      yPt: recoveredVectors.topYPt,
      block: recoveredVectors.block,
    });
  }
  positioned.sort((a, b) => b.yPt - a.yPt);
  const blocks = positioned.map((p) => p.block);
  reconcileLinks(blocks, page, pageIndex);
  appendAnnotationConstructs(blocks, page, pageIndex);
  appendFormFieldConstructs(blocks, form, pageIndex);
  return blocks;
}

// A block's division chain: for each item, the /Part /Sect /Div elements enclosing it outermost-first, common-prefixed across every item in the cluster — a paragraph the geometry merged across a division boundary claims only the divisions both halves share, never the one either half alone sits in.
function divisionChainOf(
  items: readonly LayoutItem[],
  structure: StructureIndex,
): readonly string[] {
  let prefix: readonly string[] | undefined;
  for (const item of items) {
    const chain: string[] = [];
    for (
      let current = structure.nodeOfItem(item);
      current !== undefined;
      current = current.parent
    ) {
      if (DIVISION_TYPES.has(current.type)) {
        chain.push(current.id);
      }
    }
    chain.reverse();
    if (prefix === undefined) {
      prefix = chain;
      continue;
    }
    let shared = 0;
    while (
      shared < prefix.length &&
      shared < chain.length &&
      prefix[shared] === chain[shared]
    ) {
      shared += 1;
    }
    prefix = prefix.slice(0, shared);
  }
  return prefix ?? [];
}

// Wraps a section flow's blocks in balanced division construct pairs: a /Sect extent becomes constructStart(division) before its first block and constructEnd after its last, nested divisions nesting naturally and a division spanning a page break holding one pair across it (a page break is not content — it neither opens nor closes anything). Markers must pair within one container's flow, so this runs once per ContentSection, the one container whose blocks array holds the whole extent. The descriptor carries no name: tagged PDF's /T is a display title, not the addressing name ODF text:name gives a division, and conflating them would invent an address the file never stated.
function wrapDivisionExtents(
  blocks: readonly ContentBlock[],
  divisionByBlock: WeakMap<ContentBlock, readonly string[]>,
): ContentBlock[] {
  const out: ContentBlock[] = [];
  const open: string[] = [];
  for (const block of blocks) {
    const chain = divisionByBlock.get(block);
    if (chain !== undefined) {
      while (open.length > 0 && !chain.includes(open[open.length - 1]!)) {
        out.push({ kind: "constructEnd" });
        open.pop();
      }
      for (const id of chain) {
        if (open.includes(id)) {
          continue;
        }
        out.push({ kind: "constructStart", descriptor: { kind: "division" } });
        open.push(id);
      }
    }
    out.push(block);
  }
  while (open.length > 0) {
    out.push({ kind: "constructEnd" });
    open.pop();
  }
  return out;
}

// --- Link reconciliation (#721): the row that names this file. An external URI link whose rect covers recovered runs becomes ContentRun.hyperlink on exactly those runs — the standing reconciliation that keeps run-level external hyperlinks out of construct form wherever a flat run field CAN express them. Everything else (an external link matching no run, and every internal link, whose target the run field cannot spell) becomes a link construct pair bracketing the single best-matching block. One block, never a wider extent: a construct's extent must not cross a heading or list scope (the schema's own rule), and a single block can never close a scope some earlier block opened — the conservative bound that keeps every emitted pair promotable.

function framesIntersect(
  a: { xPt: number; yPt: number; widthPt: number; heightPt: number },
  b: { xPt: number; yPt: number; widthPt: number; heightPt: number },
): boolean {
  return (
    a.xPt < b.xPt + b.widthPt &&
    b.xPt < a.xPt + a.widthPt &&
    a.yPt < b.yPt + b.heightPt &&
    b.yPt < a.yPt + a.heightPt
  );
}

function intersectionArea(
  a: { xPt: number; yPt: number; widthPt: number; heightPt: number },
  b: { xPt: number; yPt: number; widthPt: number; heightPt: number },
): number {
  const width =
    Math.min(a.xPt + a.widthPt, b.xPt + b.widthPt) - Math.max(a.xPt, b.xPt);
  const height =
    Math.min(a.yPt + a.heightPt, b.yPt + b.heightPt) - Math.max(a.yPt, b.yPt);
  return width > 0 && height > 0 ? width * height : 0;
}

function reconcileLinks(
  blocks: ContentBlock[],
  page: LayoutPage,
  pageIndex: number,
): void {
  for (const item of page.items) {
    if (item.kind !== "link" && item.kind !== "internalLink") {
      continue;
    }
    if (item.kind === "link") {
      let matchedRun = false;
      for (const block of blocks) {
        if (block.kind !== "paragraph") {
          continue;
        }
        for (const run of block.runs) {
          if (
            (run.frames ?? []).some(
              (frame) =>
                frame.pageIndex === pageIndex && framesIntersect(item, frame),
            )
          ) {
            run.hyperlink = item.uri;
            matchedRun = true;
          }
        }
      }
      if (matchedRun) {
        continue;
      }
    }
    wrapBestBlock(blocks, item, pageIndex, linkDescriptor(item));
  }
}

function linkDescriptor(
  item: LayoutLink | LayoutInternalLink,
): ContentConstructStart["descriptor"] {
  if (item.kind === "link") {
    return {
      kind: "link",
      target: { kind: "external", uri: item.uri },
      ...(item.title !== undefined ? { title: item.title } : {}),
    };
  }
  return {
    kind: "link",
    target: { kind: "internal", anchor: item.destination },
    ...(item.title !== undefined ? { title: item.title } : {}),
  };
}

// The frames a block carries on one page — every content block may carry frames; the construct markers themselves never do (a boundary renders nothing and occupies no space).
function blockFramesOn(block: ContentBlock, pageIndex: number): LayoutFrame[] {
  return block.kind === "constructStart" || block.kind === "constructEnd"
    ? []
    : (block.frames ?? []).filter((frame) => frame.pageIndex === pageIndex);
}

// Wraps the block with the largest intersection with `rect` in a construct pair; with no intersecting block, emits a point pair at the end of this page's blocks (an annotation rectangle that covers nothing anchors to a point, exactly as a footnote marker does).
function wrapBestBlock(
  blocks: ContentBlock[],
  rect: { xPt: number; yPt: number; widthPt: number; heightPt: number },
  pageIndex: number,
  descriptor: ContentConstructStart["descriptor"],
): void {
  let bestIndex = -1;
  let bestArea = 0;
  blocks.forEach((block, index) => {
    const area = blockFramesOn(block, pageIndex).reduce(
      (sum, frame) => sum + intersectionArea(rect, frame),
      0,
    );
    if (area > bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  });
  const start: ContentBlock = { kind: "constructStart", descriptor };
  const end: ContentBlock = { kind: "constructEnd" };
  if (bestIndex >= 0) {
    blocks.splice(bestIndex, 0, start);
    blocks.splice(bestIndex + 2, 0, end);
  } else {
    blocks.push(start, end);
  }
}

// --- Annotation constructs (#721): every page annotation becomes a point anchor(comment) construct, its body in the package-level definitions table under the same deterministic key the composition executor mints — the verdict row's marker-plus-definition split. The opaque kinds carry their raw dictionary through the descriptor's own residue field.
function appendAnnotationConstructs(
  blocks: ContentBlock[],
  page: LayoutPage,
  pageIndex: number,
): void {
  (page.annotations ?? []).forEach(
    (annotation: LayoutAnnotation, annotIndex: number) => {
      const key = `pdf-annot-${String(pageIndex)}-${String(annotIndex)}`;
      blocks.push(
        {
          kind: "constructStart",
          descriptor: {
            kind: "anchor",
            anchorType: "comment",
            name: key,
            definition: key,
            ...(annotation.source !== undefined
              ? { source: annotation.source }
              : {}),
          },
        },
        { kind: "constructEnd" },
      );
    },
  );
}

// --- AcroForm constructs (#721): a terminal field's widget becomes a contentControl pair around its best-matching block (a form field's own printed content is the text inside its rect), or a point pair when nothing matches. Groups emit nothing — they carry no content of their own and their children name them by prefix. Signature fields emit nothing here: certification binds to bytes a semantic pivot never reproduces, so they are residue, not a control.
function controlTypeOf(
  field: LayoutFormField,
): "plainText" | "checkbox" | "button" | "dropDown" | "comboBox" {
  if (field.fieldType === "text") {
    return "plainText";
  }
  if (field.fieldType === "button") {
    return "button";
  }
  if (field.fieldType === "combobox") {
    return "comboBox";
  }
  if (field.fieldType === "listbox") {
    return "dropDown";
  }
  return "checkbox"; // checkbox and radio: the boolean control — the harmonised vocabulary has no separate radio member
}

function appendFormFieldConstructs(
  blocks: ContentBlock[],
  form: readonly LayoutFormField[] | undefined,
  pageIndex: number,
): void {
  const visit = (fields: readonly LayoutFormField[]): void => {
    for (const field of fields) {
      visit(field.children);
      if (field.fieldType === "group" || field.fieldType === "signature") {
        continue;
      }
      for (const widget of field.widgets) {
        if (widget.pageIndex !== pageIndex) {
          continue;
        }
        wrapBestBlock(blocks, widget, pageIndex, {
          kind: "contentControl",
          controlType: controlTypeOf(field),
          tag: field.name,
          ...(field.alias !== undefined ? { alias: field.alias } : {}),
          ...(field.readOnly === true ? { lock: "content" } : {}),
          ...(field.value !== undefined ? { value: field.value } : {}),
          ...(field.checked !== undefined ? { checked: field.checked } : {}),
          ...(field.options !== undefined
            ? { options: [...field.options] }
            : {}),
        });
      }
    }
  };
  visit(form ?? []);
}

// ---------------------------------------------------------------------------
// PDF -> pptx (presentation): page = slide, cluster text into blocks.
// ---------------------------------------------------------------------------

export function reconstructSpreadsheet(
  doc: LayoutDocument,
  options?: ReconstructOptions,
): ContentDocument {
  const signal = options?.signal;
  const sheets: ContentSheet[] = doc.pages.map((page, index) => {
    throwIfAborted(signal);
    return reconstructSheet(page, index, options?.onCellTypeInference);
  });
  return { kind: "spreadsheet", metadata: doc.metadata, sheets };
}
