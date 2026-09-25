// The paired-marker machinery, split from constructs.ts: one paragraph's marker halves (bookmark, reference-mark, tracked-change, annotation) paired into run-level construct extents, and the block-scope event stream the odt reader resolves spanning constructs through. The descriptor readers, residue channels and element writers stay in constructs.ts; this module imports them back from it (safe in ESM: every cross-binding use sits inside a hoisted function declaration).
//
import type {
  ConstructDescriptor,
  ContentBlock,
  RunConstructExtent,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import { isOdfFieldElement } from "./text";

// One half of a paired marker construct encountered during a paragraph's run walk: bookmark halves pair by text:name, reference-mark range halves by their own text:name (a separate pairing family — ODF keeps bookmark names and reference-mark names in separate namespaces, so one document may legally carry a bookmark and a reference-mark under the same name and each must pair only with its own spelling), tracked-change markers by text:change-id, annotations by office:name. `parent` is kept so the pairing can ask whether the half is a DIRECT child of the paragraph element (only a direct child can sit at a paragraph edge and qualify for block scope); a half nested inside a text:span or text:a is interior to the paragraph's run sequence by construction. `runPosition` is the count of runs the walk had emitted when it reached the half — exactly what a RunConstructExtent's startRun/endRun names. `descriptor` is deferred so the payload is built only for a half that actually wins a pairing, and may resolve to undefined — a tracked-change half whose text:change-id names no text:changed-region has no descriptor to carry, and both pairings below drop such a pair rather than emitting a marker shell with nothing inside it.
export type OdfMarkerKind =
  "bookmark" | "referenceMark" | "change" | "annotation";

export interface OdfMarkerHalf {
  readonly kind: OdfMarkerKind;
  readonly side: "start" | "end";
  readonly key: string;
  readonly element: XmlElement;
  readonly parent: XmlElement;
  readonly runPosition: number;
  readonly order: number;
  readonly descriptor: () => RunConstructExtent["descriptor"] | undefined;
}

// Whether a node contributes content to its paragraph's run sequence: every child kind the run walk turns into at least one possible run, plus the constructs whose cached text renders (fields, notes, annotations). Markers that never render (bookmark halves, an empty field) are not content, which is what makes "sitting outside every content-bearing child" the test for a paragraph edge. A field with no cached text renders nothing but is still counted as content, deliberately: an edge test that depended on whether a producer cached a value would make the block-versus-run-scope verdict depend on a rendering accident, and the conservative failure (a bookmark half judged interior, dropping only that pair) is strictly safer than the alternative (a half judged at an edge it does not occupy).
function isContentBearingNode(node: XmlNode): boolean {
  if (node.type === "text") {
    return node.value.length > 0;
  }
  if (node.type !== "element") {
    return false;
  }
  return (
    isOdfFieldElement(node) ||
    node.tag === "text:s" ||
    node.tag === "text:tab" ||
    node.tag === "text:line-break" ||
    node.tag === "text:span" ||
    node.tag === "text:a" ||
    node.tag === "text:note" ||
    node.tag === "office:annotation"
  );
}

// A direct-child index is at a paragraph edge when no content-bearing sibling precedes it (leading) or none follows it (trailing).
function edgePosition(
  siblings: readonly XmlNode[],
  index: number,
): "leading" | "trailing" | undefined {
  let leading = true;
  for (let before = 0; before < index; before += 1) {
    if (isContentBearingNode(siblings[before]!)) {
      leading = false;
      break;
    }
  }
  if (leading) {
    return "leading";
  }
  for (let after = index + 1; after < siblings.length; after += 1) {
    if (isContentBearingNode(siblings[after]!)) {
      return undefined;
    }
  }
  return "trailing";
}

// The block index a block-scoped half opens or closes at: a leading half sits at its own paragraph's block position, a trailing one just past it (so a leading start with a trailing end in the same paragraph brackets exactly that paragraph), advanced past the lifted-frame blocks that physically precede the half in the paragraph's own child order — a reader that lifts a paragraph's anchored frames to blocks after it passes that count, so a bookmark ending after a frame covers the frame's block while one ending before it does not. Undefined when the half is not block-scoped — interior to the paragraph's run sequence, or nested inside a container element.
export function odfMarkerHalfEventIndex(
  half: OdfMarkerHalf,
  paragraphElement: XmlElement,
  paragraphStartIndex: number,
  liftedBlocksBeforeHalf = 0,
): number | undefined {
  if (half.parent !== paragraphElement) {
    return undefined;
  }
  const index = half.parent.children.indexOf(half.element);
  if (index === -1) {
    return undefined;
  }
  const edge = edgePosition(half.parent.children, index);
  if (edge === "leading") {
    return paragraphStartIndex;
  }
  return edge === "trailing"
    ? paragraphStartIndex + 1 + liftedBlocksBeforeHalf
    : undefined;
}

// Whether a half brackets whole blocks rather than a run sub-sequence: a direct child of the paragraph sitting outside every content-bearing sibling. A half whose parent is not the paragraph element (one nested inside a text:span or text:a) is never block-scoped, since its parent is itself content.
export function isOdfBlockScopedHalf(
  half: OdfMarkerHalf,
  paragraphElement: XmlElement,
): boolean {
  return odfMarkerHalfEventIndex(half, paragraphElement, 0) !== undefined;
}

// Pairs one paragraph's own marker halves by their key into run-level construct extents (document-schema.js's RunConstructExtent): a pair both of whose halves sit in THIS paragraph and are not both block-scoped becomes an entry on the paragraph's constructs field. A pair with both halves block-scoped is skipped — that is the block-marker path's extent (the odt reader emits its constructStart/constructEnd pair, and one occurrence must never carry both encodings); a half whose partner sits in a different paragraph is never seen here at all, so the block reader alone decides its fate. Everything else mirrors the docx rules: exactly one start and one end per pairing family and key (grouped `kind key`, the identical discrimination resolveOdfMarkerEvents applies at block scope — a bookmark and a reference-mark may share a name and must never pair across their families), and an end that does not precede its start. Crossing pairs need no special case — run ranges are data, not brackets, so two extents that overlap are two entries. The returned `paired` set names the half ELEMENTS a completed pair consumed, so the caller can give an unpaired annotation start its point-anchor fallback without re-emitting a paired one.
export function pairOdfMarkerHalves(
  halves: readonly OdfMarkerHalf[],
  paragraphElement: XmlElement,
): { extents: RunConstructExtent[]; paired: Set<XmlElement> } {
  const byKey = new Map<string, OdfMarkerHalf[]>();
  for (const half of halves) {
    const existing = byKey.get(`${half.kind} ${half.key}`);
    if (existing === undefined) {
      byKey.set(`${half.kind} ${half.key}`, [half]);
    } else {
      existing.push(half);
    }
  }
  const extents: RunConstructExtent[] = [];
  const paired = new Set<XmlElement>();
  for (const pair of byKey.values()) {
    const starts = pair.filter((half) => half.side === "start");
    const ends = pair.filter((half) => half.side === "end");
    const open = starts[0];
    const close = ends[0];
    if (
      starts.length !== 1 ||
      ends.length !== 1 ||
      open === undefined ||
      close === undefined
    ) {
      continue;
    }
    if (close.runPosition < open.runPosition) {
      continue;
    }
    if (
      isOdfBlockScopedHalf(open, paragraphElement) &&
      isOdfBlockScopedHalf(close, paragraphElement)
    ) {
      continue;
    }
    const descriptor = open.descriptor();
    if (descriptor === undefined) {
      continue;
    }
    extents.push({
      descriptor,
      startRun: open.runPosition,
      endRun: close.runPosition,
    });
    paired.add(open.element);
    paired.add(close.element);
  }
  return { extents, paired };
}

// --- block-scope construct extents and marker splicing ------------------------------------------------------------

// One construct's span over a block list, half-open: startIndex is the first block it covers, endIndex one past the last, so a point construct has startIndex === endIndex. `order` is discovery order in the source, the deterministic tie-break between two extents covering the identical range.
export interface OdfConstructExtent {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly order: number;
  readonly descriptor: ConstructDescriptor;
}

// Outermost first at a shared start (the longer extent opens before the one nested inside it), then source order.
function compareOdfExtents(
  a: OdfConstructExtent,
  b: OdfConstructExtent,
): number {
  return (
    a.startIndex - b.startIndex || b.endIndex - a.endIndex || a.order - b.order
  );
}

// The flat form pairs markers as balanced brackets, so a crossing extent — one that opens inside another and closes outside it — has no encoding at all: bracket matching would re-pair the two into a nesting the source never had. Crossing pairs are dropped here, which is the drop document-schema.js ratifies for block-scoped crossings; within one paragraph, by contrast, crossing extents stay as two entries on the paragraph's constructs field, because run ranges are data rather than brackets. Wrapper elements (text:section, an index wrapper) nest by XML construction and can never cross; only the paired-marker families (bookmarks, tracked changes, annotations) can produce a crossing pair.
function acceptProperlyNestedOdfExtents(
  extents: readonly OdfConstructExtent[],
): OdfConstructExtent[] {
  const sorted = [...extents].sort(compareOdfExtents);
  const accepted: OdfConstructExtent[] = [];
  const open: OdfConstructExtent[] = [];
  for (const extent of sorted) {
    while (
      open.length > 0 &&
      open[open.length - 1]!.endIndex <= extent.startIndex
    ) {
      open.pop();
    }
    const enclosing = open[open.length - 1];
    if (enclosing !== undefined && enclosing.endIndex < extent.endIndex) {
      continue;
    }
    accepted.push(extent);
    open.push(extent);
  }
  return accepted;
}

// Splices each extent's constructStart/constructEnd pair into the block list around the blocks it covers, producing the flat encoding document-schema.js's findConstructMarkerImbalance validates: markers balance, and a close always matches the nearest still-open start in the same list. The identical algorithm ooxml.js's typed/docx/constructs.ts runs over WordprocessingML, reimplemented here because odf.js deliberately does not depend on that package.
export function insertOdfConstructMarkers(
  blocks: readonly ContentBlock[],
  extents: readonly OdfConstructExtent[],
): ContentBlock[] {
  // No early return for an empty extents list: with nested/openingAt both empty, the loop below already reduces to "copy every defined block in order", which is exactly `[...blocks]` — a dedicated guard was a redundant, behaviourally unobservable shortcut for the same result.
  const nested = acceptProperlyNestedOdfExtents(extents);
  const openingAt = new Map<number, OdfConstructExtent[]>();
  for (const extent of nested) {
    const existing = openingAt.get(extent.startIndex);
    if (existing === undefined) {
      openingAt.set(extent.startIndex, [extent]);
    } else {
      existing.push(extent);
    }
  }

  const out: ContentBlock[] = [];
  const open: OdfConstructExtent[] = [];
  for (let index = 0; index <= blocks.length; index += 1) {
    while (open.length > 0 && open[open.length - 1]!.endIndex === index) {
      open.pop();
      out.push({ kind: "constructEnd" });
    }
    for (const extent of openingAt.get(index) ?? []) {
      out.push({ kind: "constructStart", descriptor: extent.descriptor });
      if (extent.endIndex === index) {
        out.push({ kind: "constructEnd" });
      } else {
        open.push(extent);
      }
    }
    const block = blocks[index];
    if (block !== undefined) {
      out.push(block);
    }
  }
  return out;
}

// A marker half promoted to block scope: the block index it opens or closes at (a leading half at its own paragraph's position, a trailing one just past it, advanced past the lifted-frame blocks physically preceding the half — mirroring how ooxml.js's bookmark events index a leading half at the paragraph and a trailing one at endIndex), whether it actually qualified, and the discovery order.
export interface OdfMarkerEvent {
  readonly kind: OdfMarkerKind;
  readonly side: "start" | "end";
  readonly key: string;
  readonly index: number;
  readonly qualified: boolean;
  readonly order: number;
  readonly descriptor: () => RunConstructExtent["descriptor"] | undefined;
  readonly element: XmlElement;
}

// Pairs the flow's marker events by (kind, key) into block-scoped extents. A pair survives only when it has exactly one start and one end, both halves qualified (sat at a paragraph edge), a descriptor that resolves, and an end that does not precede its start. Everything else — a half whose partner sits interior to some paragraph, a pair split across two block lists (inside a table cell and outside it), a dangling half — has no block-scoped encoding and stays dropped, the same rules the docx flow applies to w:bookmarkStart/End for the same reasons. The returned `paired` set names the half ELEMENTS a completed pair consumed, for the same unpaired-annotation fallback the paragraph-level pairing reports.
export function resolveOdfMarkerEvents(events: readonly OdfMarkerEvent[]): {
  extents: OdfConstructExtent[];
  paired: Set<XmlElement>;
} {
  const byKey = new Map<string, OdfMarkerEvent[]>();
  for (const event of events) {
    const mapKey = `${event.kind} ${event.key}`;
    const existing = byKey.get(mapKey);
    if (existing === undefined) {
      byKey.set(mapKey, [event]);
    } else {
      existing.push(event);
    }
  }
  const extents: OdfConstructExtent[] = [];
  const paired = new Set<XmlElement>();
  for (const pair of byKey.values()) {
    const starts = pair.filter(
      (event) => event.side === "start" && event.qualified,
    );
    const ends = pair.filter(
      (event) => event.side === "end" && event.qualified,
    );
    const open = starts[0];
    const close = ends[0];
    if (
      starts.length !== 1 ||
      ends.length !== 1 ||
      open === undefined ||
      close === undefined
    ) {
      continue;
    }
    if (close.index < open.index) {
      continue;
    }
    const descriptor = open.descriptor();
    if (descriptor === undefined) {
      continue;
    }
    extents.push({
      startIndex: open.index,
      endIndex: close.index,
      order: open.order,
      descriptor,
    });
    paired.add(open.element);
    paired.add(close.element);
  }
  return { extents, paired };
}
