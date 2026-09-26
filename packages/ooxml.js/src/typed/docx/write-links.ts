import type {
  AnchorDescriptor,
  ContentParagraph,
  FieldDescriptor,
  LinkDescriptor,
} from "document-schema.js";
import { NOTE_REFERENCE_TAG, RunPositions } from "./write";
import type { WriteState } from "./write";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { fieldCharRun } from "./write-constructs";
import { findRunConstructFault } from "document-schema.js";
// The internal-link reconciliation family of the docx writer, split from write.ts: the run-position interleave, wrapping internal-link runs in hyperlink elements, and trailing empty-run handling. write.ts keeps the surrounding emission.
// The write side of a run-level construct extent (document-schema.js's ContentParagraph.constructs): a bookmark's two halves, a comment extent's commentRangeStart/End pair, and a field's fldChar characters go back between the runs their ranges name, the exact inverse of the reader's run-position walk, so each reads back at the positions it was written from. A comment/footnote/endnote reference mark is not a boundary marker at all: it mutates the run element already sitting at its own recorded index (handled above this function's own boundary-map loop, before the early-return guard, since a paragraph carrying only a reference mark and no bookmark/field/comment-extent must still get it). An internal link wraps its runs in one w:hyperlink/@w:anchor element (wrapInternalLinks below); everything else, a run-scoped content control, writes its paragraph's content untouched and loses only the descriptor, the same content-preserving policy the block-level foreign constructs follow. At a shared boundary the halves go out in three groups, closes of extents that opened earlier, then opens, then point extents (startRun === endRun) as one adjacent group each, a convention the reader is indifferent to (both halves land on the same run position either way) but one the written XML needs: WordprocessingML pairs the halves by w:id with start-before-end ordering, so a point's end emitted among the boundary's closes would precede its own start, and pairing point halves keeps two points at one position from interleaving by id, which is the shape Word itself writes for adjacent point bookmarks.
export function interleaveRunConstructExtents(
  runElements: readonly XmlElement[],
  paragraph: ContentParagraph,
  state: WriteState,
): XmlElement[] {
  if (paragraph.constructs === undefined) {
    return [...runElements];
  }
  const fault = findRunConstructFault(paragraph);
  if (fault !== undefined) {
    throw new Error(
      `buildDocxPackageFromContent: run-level construct extent at index ${String(fault.index)} of a paragraph does not name real runs (${fault.kind})`,
    );
  }
  const bookmarks = paragraph.constructs.filter(
    (
      extent,
    ): extent is {
      descriptor: AnchorDescriptor;
      startRun: number;
      endRun: number;
    } =>
      extent.descriptor.kind === "anchor" &&
      extent.descriptor.anchorType === "bookmark",
  );
  const fields = paragraph.constructs.filter(
    (
      extent,
    ): extent is {
      descriptor: FieldDescriptor;
      startRun: number;
      endRun: number;
    } => extent.descriptor.kind === "field",
  );
  const links: InternalLinkExtent[] = [];
  for (const extent of paragraph.constructs) {
    if (
      extent.descriptor.kind === "link" &&
      extent.descriptor.target.kind === "internal"
    ) {
      links.push({
        descriptor: extent.descriptor,
        startRun: extent.startRun,
        endRun: extent.endRun,
        anchor: extent.descriptor.target.anchor,
      });
    }
  }
  // A comment's extent (startRun !== endRun) and its reference mark (always startRun === endRun, whether it names a comment, footnote, or endnote) are two independently-recorded RunConstructExtent entries the reader can never tell apart from a genuinely zero-width comment extent once both have flattened onto the same anchorType — a real producer never writes one of those, so width is the honest discriminator here, the same "no clean encoding, so no attempt to guess" policy this file already applies to a crossing extent.
  const commentRanges = paragraph.constructs.filter(
    (
      extent,
    ): extent is {
      descriptor: AnchorDescriptor;
      startRun: number;
      endRun: number;
    } =>
      extent.descriptor.kind === "anchor" &&
      extent.descriptor.anchorType === "comment" &&
      extent.startRun !== extent.endRun,
  );
  const noteReferences = paragraph.constructs.filter(
    (
      extent,
    ): extent is {
      descriptor: AnchorDescriptor & {
        anchorType: "comment" | "footnote" | "endnote";
      };
      startRun: number;
      endRun: number;
    } =>
      extent.descriptor.kind === "anchor" &&
      (extent.descriptor.anchorType === "comment" ||
        extent.descriptor.anchorType === "footnote" ||
        extent.descriptor.anchorType === "endnote") &&
      extent.startRun === extent.endRun,
  );
  // A reference mark renders as a child of the run it sits at, never as its own inserted run (readDocxContent's recordReferenceAnchor records the point at the reference-carrying run's own index, not a boundary before or after it — see typed/docx/read.ts's own comment on that function), so this mutates the already-built run element in place rather than going through the position-indexed opening/closing/point maps every other construct kind below uses.
  for (const reference of noteReferences) {
    const target = runElements[reference.startRun];
    if (target === undefined) {
      throw new Error(
        `buildDocxPackageFromContent: a ${reference.descriptor.anchorType} reference at run index ${String(reference.startRun)} of a paragraph does not name a real run`,
      );
    }
    target.children.push(
      el(NOTE_REFERENCE_TAG[reference.descriptor.anchorType], {
        "w:id": encodeXmlText(reference.descriptor.name),
      }),
    );
  }
  // No early return for the all-empty case: when bookmarks, fields and commentRanges are all empty, closingAt/openingAt/pointAt below never gain an entry, so the general loop's `out` ends up exactly `[...runElements]` anyway — the early return was a second spelling of the same result, never an observable difference.
  const closingAt = new Map<number, XmlElement[]>();
  const openingAt = new Map<number, XmlElement[]>();
  const pointAt = new Map<number, XmlElement[]>();
  const push = (
    map: Map<number, XmlElement[]>,
    position: number,
    element: XmlElement,
  ): void => {
    const existing = map.get(position);
    if (existing === undefined) {
      map.set(position, [element]);
    } else {
      existing.push(element);
    }
  };
  for (const bookmark of bookmarks) {
    const id = String(state.counters.nextMarkerId++);
    const open = el("w:bookmarkStart", {
      "w:id": id,
      "w:name": encodeXmlText(bookmark.descriptor.name),
    });
    const close = el("w:bookmarkEnd", { "w:id": id });
    if (bookmark.startRun === bookmark.endRun) {
      // A point extent's halves are emitted as one adjacent pair, never split across the close/open groups: its end among the closes would precede its own start, and its start among the opens would let a second point at the same position interleave with it by id.
      push(pointAt, bookmark.startRun, open);
      push(pointAt, bookmark.startRun, close);
    } else {
      push(openingAt, bookmark.startRun, open);
      push(closingAt, bookmark.endRun, close);
    }
  }
  // A field's own characters spell begin + instruction + separate as one group at the extent's opening boundary (the instruction rides its own w:instrText run, exactly where the reader's code-run walk collects it from), and the end character at the closing boundary.
  for (const field of fields) {
    const opening = [
      fieldCharRun("begin"),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [
          txt(encodeXmlText(field.descriptor.instruction)),
        ]),
      ]),
      fieldCharRun("separate"),
    ];
    if (field.startRun === field.endRun) {
      for (const run of opening) {
        push(pointAt, field.startRun, run);
      }
      push(pointAt, field.startRun, fieldCharRun("end"));
    } else {
      for (const run of opening) {
        push(openingAt, field.startRun, run);
      }
      push(closingAt, field.endRun, fieldCharRun("end"));
    }
  }
  // Unlike a bookmark's own w:id (an internal marker id this writer mints fresh, since nothing outside the pair reads it), a comment extent's w:id must be the SAME value word/comments.xml's own w:comment carries for this comment — the join key the reader pairs them back through — so descriptor.name is written verbatim rather than through state.counters.
  for (const range of commentRanges) {
    const id = encodeXmlText(range.descriptor.name);
    push(openingAt, range.startRun, el("w:commentRangeStart", { "w:id": id }));
    push(closingAt, range.endRun, el("w:commentRangeEnd", { "w:id": id }));
  }
  const out: XmlElement[] = [];
  const positions = new RunPositions(runElements);
  for (let position = 0; position <= runElements.length; position++) {
    for (const close of closingAt.get(position) ?? []) {
      out.push(close);
    }
    for (const open of openingAt.get(position) ?? []) {
      out.push(open);
    }
    for (const half of pointAt.get(position) ?? []) {
      out.push(half);
    }
    const run = runElements[position];
    if (run !== undefined) {
      out.push(run);
    }
  }
  return wrapInternalLinks(out, positions, links);
}

// One internal-target link extent, the only link shape with a run-level spelling here: an external target rides ContentRun.hyperlink on each covered run instead.
export interface InternalLinkExtent {
  readonly descriptor: LinkDescriptor;
  readonly startRun: number;
  readonly endRun: number;
  readonly anchor: string;
}

// Wraps each internal link extent's runs in one w:hyperlink/@w:anchor element — the inverse of the reader's internal-hyperlink walk. A link whose slice cannot be wrapped — it crosses another link's (WordprocessingML has no nested w:hyperlink, and Word itself cannot produce the shape), or it covers a run carrying an external hyperlink of its own (already a w:hyperlink) — writes its runs plain and loses only the descriptor, the content-preserving policy every unwritable construct kind here follows.
//
// No wrap-overlap bookkeeping is needed for the internal-link wraps themselves, and an earlier version that tracked wrapped index ranges was removed: nesting is already impossible by construction here. A link crossing or contained in an earlier link's wrap has its start or end run sitting inside that wrap's w:hyperlink element, so `first`/`last` never both resolve and the guard below skips it; a link CONTAINING an earlier one cannot be processed after it, because the sort order (ascending start, then longer extent first at a shared start) always reaches the containing extent first. Index-range overlap tracking in addition to that could only ever fire on links whose slices are genuinely disjoint (adjacent links, whose stale pre-wrap indices still intersect), losing a descriptor the writer could have written.
export function wrapInternalLinks(
  elements: readonly XmlElement[],
  positions: RunPositions,
  links: readonly InternalLinkExtent[],
): XmlElement[] {
  // No links-length early return: the loop below handles an empty list identically (zero iterations, out still the input array), so the guard would only be a second spelling of the same fact.
  let out: readonly XmlElement[] = elements;
  for (const link of [...links].sort(
    (a, b) => a.startRun - b.startRun || b.endRun - a.endRun,
  )) {
    let first = -1;
    let last = -1;
    out.forEach((element, index) => {
      const position = positions.positionOf(element);
      if (position === link.startRun) {
        first = index;
      }
      if (position === link.endRun - 1) {
        last = index;
      }
    });
    // No separate `last === -1` check: last starts at -1 and only ever moves forward, so whenever first has resolved to a real index (>= 0), `last < first` already catches an unresolved last on its own — the two conditions were never independently observable.
    if (first === -1 || last < first) {
      continue;
    }
    const slice = out.slice(first, last + 1);
    // No nesting a hyperlink inside a hyperlink — the only shape that can still reach this test is a slice carrying a run's own external-target wrapper element, since internal-link overlap is unreachable by the sort-and-lookup argument above.
    const carriesHyperlink = slice.some(
      (element) => element.tag === "w:hyperlink",
    );
    if (carriesHyperlink) {
      continue;
    }
    out = [
      ...out.slice(0, first),
      el("w:hyperlink", { "w:anchor": encodeXmlText(link.anchor) }, slice),
      ...out.slice(last + 1),
    ];
  }
  return [...out];
}

// readDocxContent lifts a paragraph's own images out into sibling blocks after it, so the inverse puts each one back into the run it came out of: the paragraph's trailing empty-text runs, in order, are exactly the runs a drawing-only run reads back as. An image with no such run left takes a fresh one.
export function trailingEmptyRunElements(
  paragraph: ContentParagraph,
  element: XmlElement,
): XmlElement[] {
  const runElements: XmlElement[] = [];
  for (const child of element.children) {
    if (
      child.type === "element" &&
      (child.tag === "w:r" || child.tag === "w:hyperlink")
    ) {
      runElements.push(child);
    }
  }
  const trailing: XmlElement[] = [];
  for (let index = paragraph.runs.length - 1; index >= 0; index--) {
    const run = paragraph.runs[index];
    const runElement = runElements[index];
    // No separate run.hyperlink check: buildRun always wraps a hyperlink-carrying run in its own w:hyperlink element, so the structural tag test below already states that fact — spelling it twice left each spelling unobservable (either one alone still caught the case).
    if (
      run === undefined ||
      runElement === undefined ||
      run.text !== "" ||
      runElement.tag !== "w:r"
    ) {
      break;
    }
    trailing.unshift(runElement);
  }
  return trailing;
}

// --- tables -------------------------------------------------------------------------------------------------------
