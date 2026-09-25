import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ProvenanceDescriptor,
  RunConstructExtent,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { collectOdfProvenanceRegions } from "./constructs";
import {
  insertOdfConstructMarkers,
  odfMarkerHalfEventIndex,
  pairOdfMarkerHalves,
  resolveOdfMarkerEvents,
  type OdfConstructExtent,
  type OdfMarkerEvent,
  type OdfMarkerHalf,
} from "./constructs-markers";
import {} from "./constructs-definitions";

// Every fixture here is a programmatic package/element built with el/txt, matching the sibling odt/constructs.test.ts's own fixture-gate convention.

function paragraphWithSiblings(
  siblings: readonly XmlNode[],
  halfIndex: number,
): { paragraph: XmlElement; half: XmlElement } {
  const bookmarkHalf = el("text:bookmark-start", { "text:name": "b" });
  const children = [...siblings];
  children.splice(halfIndex, 0, bookmarkHalf);
  const paragraph = el("text:p", {}, children);
  return { paragraph, half: bookmarkHalf };
}

describe("isContentBearingNode (via odfMarkerHalfEventIndex)", () => {
  const baseEventIndex = 5;
  // A half is judged NOT at a paragraph edge (interior) exactly when a genuinely content-bearing sibling precedes it — so each case below plants exactly one such sibling before the half and checks the half stops qualifying as "leading".
  const contentBearingBefore: { label: string; sibling: XmlNode }[] = [
    { label: "a non-empty text node", sibling: txt("hi") },
    { label: "a field element", sibling: el("text:date", {}) },
    { label: "text:s", sibling: el("text:s", {}) },
    { label: "text:tab", sibling: el("text:tab", {}) },
    { label: "text:line-break", sibling: el("text:line-break", {}) },
    { label: "text:span", sibling: el("text:span", {}) },
    { label: "text:a", sibling: el("text:a", {}) },
    { label: "text:note", sibling: el("text:note", {}) },
    { label: "office:annotation", sibling: el("office:annotation", {}) },
  ];

  it.each(contentBearingBefore)(
    "$label preceding the half, with another one trailing it, makes the half genuinely interior",
    ({ sibling }) => {
      // A trailing text:span (itself always content-bearing) pins the half off the trailing edge too, so a content-bearing leading sibling is the only thing that can still make this interior (neither leading nor trailing).
      const { paragraph, half: bookmarkHalf } = paragraphWithSiblings(
        [sibling, el("text:span", {})],
        1,
      );
      const marker: OdfMarkerHalf = {
        kind: "bookmark",
        side: "start",
        key: "b",
        element: bookmarkHalf,
        parent: paragraph,
        runPosition: 0,
        order: 0,
        descriptor: () => undefined,
      };
      expect(
        odfMarkerHalfEventIndex(marker, paragraph, baseEventIndex),
      ).toBeUndefined();
    },
  );

  it("an empty text node preceding the half does not move it off the leading edge", () => {
    const { paragraph, half: bookmarkHalf } = paragraphWithSiblings(
      [txt("")],
      1,
    );
    const marker: OdfMarkerHalf = {
      kind: "bookmark",
      side: "start",
      key: "b",
      element: bookmarkHalf,
      parent: paragraph,
      runPosition: 0,
      order: 0,
      descriptor: () => undefined,
    };
    expect(odfMarkerHalfEventIndex(marker, paragraph, baseEventIndex)).toBe(
      baseEventIndex,
    );
  });

  it("a non-content-bearing element (e.g. another bookmark half) preceding the half does not move it off the leading edge", () => {
    const decoy = el("text:bookmark-end", { "text:name": "other" });
    const { paragraph, half: bookmarkHalf } = paragraphWithSiblings([decoy], 1);
    const marker: OdfMarkerHalf = {
      kind: "bookmark",
      side: "start",
      key: "b",
      element: bookmarkHalf,
      parent: paragraph,
      runPosition: 0,
      order: 0,
      descriptor: () => undefined,
    };
    expect(odfMarkerHalfEventIndex(marker, paragraph, baseEventIndex)).toBe(
      baseEventIndex,
    );
  });

  it("a comment node (neither text nor element) preceding the half does not move it off the leading edge", () => {
    const comment: XmlNode = { type: "comment", value: "c" };
    const { paragraph, half: bookmarkHalf } = paragraphWithSiblings(
      [comment],
      1,
    );
    const marker: OdfMarkerHalf = {
      kind: "bookmark",
      side: "start",
      key: "b",
      element: bookmarkHalf,
      parent: paragraph,
      runPosition: 0,
      order: 0,
      descriptor: () => undefined,
    };
    expect(odfMarkerHalfEventIndex(marker, paragraph, baseEventIndex)).toBe(
      baseEventIndex,
    );
  });

  it("returns undefined when the half's own recorded parent is not the paragraph passed in, even though the half is a genuine child of that other parent", () => {
    // The half's own recorded parent is a real container that DOES hold it as a child (so a bypassed guard would not accidentally bail out on the later indexOf === -1 check instead) — only the mismatch against the paragraph argument itself should short-circuit this.
    const bookmarkHalf = el("text:bookmark-start", { "text:name": "b" });
    const other = el("text:p", {}, [bookmarkHalf]);
    const marker: OdfMarkerHalf = {
      kind: "bookmark",
      side: "start",
      key: "b",
      element: bookmarkHalf,
      parent: other,
      runPosition: 0,
      order: 0,
      descriptor: () => undefined,
    };
    const paragraph = el("text:p", {});
    expect(
      odfMarkerHalfEventIndex(marker, paragraph, baseEventIndex),
    ).toBeUndefined();
  });

  it("returns undefined when the half element is not actually among its own recorded parent's children", () => {
    const paragraph = el("text:p", {}, [txt("x")]);
    const orphan = el("text:bookmark-start", { "text:name": "b" });
    const marker: OdfMarkerHalf = {
      kind: "bookmark",
      side: "start",
      key: "b",
      element: orphan,
      parent: paragraph,
      runPosition: 0,
      order: 0,
      descriptor: () => undefined,
    };
    expect(
      odfMarkerHalfEventIndex(marker, paragraph, baseEventIndex),
    ).toBeUndefined();
  });
});

function half(overrides: Partial<OdfMarkerHalf>): OdfMarkerHalf {
  const element = el("text:bookmark-start", {});
  return {
    kind: "bookmark",
    side: "start",
    key: "k",
    element,
    parent: el("text:p", {}),
    runPosition: 0,
    order: 0,
    descriptor: () => undefined,
    ...overrides,
  };
}

describe("pairOdfMarkerHalves", () => {
  const paragraph = el("text:p", {});

  // Every start/end half below carries a genuinely RESOLVING descriptor — so if a bypassed length check let the pairing proceed anyway, it would actually build an extent from starts[0]/ends[0], not merely fall through some other guard (an unresolved descriptor) that would mask the very check under test.
  const resolvingDescriptor: RunConstructExtent["descriptor"] = {
    kind: "anchor",
    anchorType: "bookmark",
    name: "k",
  };

  it("drops a key with no start half at all", () => {
    const end = half({
      side: "end",
      element: el("text:bookmark-end", {}),
      descriptor: () => resolvingDescriptor,
    });
    const { extents } = pairOdfMarkerHalves([end], paragraph);
    expect(extents).toEqual([]);
  });

  it("drops a key with two start halves", () => {
    const startA = half({
      side: "start",
      element: el("text:bookmark-start", { id: "a" }),
      descriptor: () => resolvingDescriptor,
    });
    const startB = half({
      side: "start",
      element: el("text:bookmark-start", { id: "b" }),
      descriptor: () => resolvingDescriptor,
    });
    const end = half({
      side: "end",
      element: el("text:bookmark-end", {}),
      descriptor: () => resolvingDescriptor,
    });
    const { extents } = pairOdfMarkerHalves([startA, startB, end], paragraph);
    expect(extents).toEqual([]);
  });

  it("drops a key with two end halves", () => {
    const start = half({
      side: "start",
      element: el("text:bookmark-start", {}),
      descriptor: () => resolvingDescriptor,
    });
    const endA = half({
      side: "end",
      element: el("text:bookmark-end", { id: "a" }),
      descriptor: () => resolvingDescriptor,
    });
    const endB = half({
      side: "end",
      element: el("text:bookmark-end", { id: "b" }),
      descriptor: () => resolvingDescriptor,
    });
    const { extents } = pairOdfMarkerHalves([start, endA, endB], paragraph);
    expect(extents).toEqual([]);
  });

  it("drops a pair whose end precedes its start", () => {
    const start = half({
      side: "start",
      runPosition: 3,
      descriptor: () => ({ kind: "anchor", anchorType: "bookmark", name: "k" }),
    });
    const end = half({
      side: "end",
      runPosition: 1,
      element: el("text:bookmark-end", {}),
    });
    const { extents } = pairOdfMarkerHalves([start, end], paragraph);
    expect(extents).toEqual([]);
  });

  it("keeps a pair whose end sits at exactly the same run position as its start (a genuine zero-width range)", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "k",
    };
    const start = half({
      side: "start",
      runPosition: 2,
      descriptor: () => descriptor,
    });
    const end = half({
      side: "end",
      runPosition: 2,
      element: el("text:bookmark-end", {}),
    });
    const { extents } = pairOdfMarkerHalves([start, end], paragraph);
    expect(extents).toEqual([{ descriptor, startRun: 2, endRun: 2 }]);
  });

  it("drops a pair whose descriptor resolves to undefined", () => {
    const start = half({ side: "start", descriptor: () => undefined });
    const end = half({ side: "end", element: el("text:bookmark-end", {}) });
    const { extents } = pairOdfMarkerHalves([start, end], paragraph);
    expect(extents).toEqual([]);
  });

  it("marks both halves of a completed pair as paired, not only the start", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "k",
    };
    const startElement = el("text:bookmark-start", {});
    const endElement = el("text:bookmark-end", {});
    const start = half({
      side: "start",
      element: startElement,
      descriptor: () => descriptor,
    });
    const end = half({ side: "end", element: endElement });
    const { paired } = pairOdfMarkerHalves([start, end], paragraph);
    expect(paired.has(startElement)).toBe(true);
    expect(paired.has(endElement)).toBe(true);
  });

  it("drops a pair whose both halves are block-scoped (that is the block-marker path's own extent)", () => {
    const startElement = el("text:bookmark-start", {});
    const endElement = el("text:bookmark-end", {});
    const container = el("text:p", {}, [startElement, endElement]);
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "k",
    };
    const start = half({
      side: "start",
      element: startElement,
      parent: container,
      runPosition: 0,
      descriptor: () => descriptor,
    });
    const end = half({
      side: "end",
      element: endElement,
      parent: container,
      runPosition: 0,
    });
    const { extents } = pairOdfMarkerHalves([start, end], container);
    expect(extents).toEqual([]);
  });
});

function event(overrides: Partial<OdfMarkerEvent>): OdfMarkerEvent {
  return {
    kind: "bookmark",
    side: "start",
    key: "k",
    index: 0,
    qualified: true,
    order: 0,
    descriptor: () => undefined,
    element: el("text:bookmark-start", {}),
    ...overrides,
  };
}

describe("resolveOdfMarkerEvents", () => {
  // Every start/end event below carries a genuinely RESOLVING descriptor — so if a bypassed length check let the pairing proceed anyway, it would actually build an extent from starts[0]/ends[0], not merely fall through some other guard (an unresolved descriptor) that would mask the very check under test.
  const resolvingDescriptor: RunConstructExtent["descriptor"] = {
    kind: "anchor",
    anchorType: "bookmark",
    name: "k",
  };

  it("drops a key with no qualified start", () => {
    const end = event({
      side: "end",
      element: el("text:bookmark-end", {}),
      descriptor: () => resolvingDescriptor,
    });
    const { extents } = resolveOdfMarkerEvents([end]);
    expect(extents).toEqual([]);
  });

  it("drops a key with two qualified starts", () => {
    const startA = event({
      element: el("text:bookmark-start", { id: "a" }),
      descriptor: () => resolvingDescriptor,
    });
    const startB = event({
      element: el("text:bookmark-start", { id: "b" }),
      descriptor: () => resolvingDescriptor,
    });
    const end = event({
      side: "end",
      element: el("text:bookmark-end", {}),
      descriptor: () => resolvingDescriptor,
    });
    const { extents } = resolveOdfMarkerEvents([startA, startB, end]);
    expect(extents).toEqual([]);
  });

  it("drops a key with two qualified ends", () => {
    const start = event({ descriptor: () => resolvingDescriptor });
    const endA = event({
      side: "end",
      element: el("text:bookmark-end", { id: "a" }),
      descriptor: () => resolvingDescriptor,
    });
    const endB = event({
      side: "end",
      element: el("text:bookmark-end", { id: "b" }),
      descriptor: () => resolvingDescriptor,
    });
    const { extents } = resolveOdfMarkerEvents([start, endA, endB]);
    expect(extents).toEqual([]);
  });

  it("drops a pair whose end index precedes its start index", () => {
    const start = event({
      index: 3,
      descriptor: () => ({ kind: "anchor", anchorType: "bookmark", name: "k" }),
    });
    const end = event({
      side: "end",
      index: 1,
      element: el("text:bookmark-end", {}),
    });
    const { extents } = resolveOdfMarkerEvents([start, end]);
    expect(extents).toEqual([]);
  });

  it("keeps a pair whose end index equals its start index (a point extent)", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "k",
    };
    const start = event({ index: 4, order: 7, descriptor: () => descriptor });
    const end = event({
      side: "end",
      index: 4,
      element: el("text:bookmark-end", {}),
    });
    const { extents } = resolveOdfMarkerEvents([start, end]);
    expect(extents).toEqual([
      { startIndex: 4, endIndex: 4, order: 7, descriptor },
    ]);
  });

  it("marks both halves of a completed pair as paired, not only the start", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "k",
    };
    const startElement = el("text:bookmark-start", {});
    const endElement = el("text:bookmark-end", {});
    const start = event({
      element: startElement,
      descriptor: () => descriptor,
    });
    const end = event({ side: "end", element: endElement });
    const { paired } = resolveOdfMarkerEvents([start, end]);
    expect(paired.has(startElement)).toBe(true);
    expect(paired.has(endElement)).toBe(true);
  });
});

describe("insertOdfConstructMarkers", () => {
  it("returns every defined block, unmodified, when there are no extents at all", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "a" }] },
      { kind: "paragraph", runs: [{ text: "b" }] },
    ];
    expect(insertOdfConstructMarkers(blocks, [])).toEqual(blocks);
  });

  it("orders two constructs opening at the same index outermost-first, by descending end index", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "a" }] },
    ];
    const outer: OdfConstructExtent = {
      startIndex: 0,
      endIndex: 1,
      order: 0,
      descriptor: { kind: "division" },
    };
    const inner: OdfConstructExtent = {
      startIndex: 0,
      endIndex: 0,
      order: 1,
      descriptor: { kind: "division", name: "inner" },
    };
    // Passed inner-first, deliberately the wrong order, so a real sort is what puts the outer extent ahead of the inner one — a comparator collapsed to always-equal (a stable sort's no-op) would leave this input order untouched instead.
    const result = insertOdfConstructMarkers(blocks, [inner, outer]);
    // The outer extent (endIndex 1) must open before the inner one (endIndex 0), which itself closes immediately (a point extent) before the outer's own block.
    expect(result).toEqual([
      { kind: "constructStart", descriptor: outer.descriptor },
      { kind: "constructStart", descriptor: inner.descriptor },
      { kind: "constructEnd" },
      blocks[0],
      { kind: "constructEnd" },
    ]);
  });

  it("sorts primarily by ascending start index, not merely by end index", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "a" }] },
      { kind: "paragraph", runs: [{ text: "b" }] },
    ];
    // A long-running extent starting first but ending LAST, and a short point extent starting second but ending FIRST — a comparator that fell back to comparing end index (as it would if the start-index clause were dropped from the OR chain) would sort these in the opposite order, and would additionally reject the long extent outright as improperly nested inside the point extent.
    const long: OdfConstructExtent = {
      startIndex: 0,
      endIndex: 2,
      order: 0,
      descriptor: { kind: "division" },
    };
    const point: OdfConstructExtent = {
      startIndex: 1,
      endIndex: 1,
      order: 0,
      descriptor: { kind: "division", name: "point" },
    };
    const result = insertOdfConstructMarkers(blocks, [point, long]);
    expect(result).toEqual([
      { kind: "constructStart", descriptor: long.descriptor },
      blocks[0],
      { kind: "constructStart", descriptor: point.descriptor },
      { kind: "constructEnd" },
      blocks[1],
      { kind: "constructEnd" },
    ]);
  });
});

describe("collectOdfProvenanceRegions", () => {
  it("skips a text:changed-region whose only child is not a recognised change kind", () => {
    const region = el("text:changed-region", { "xml:id": "r1" }, [
      el("text:format-change-irrelevant", {}),
    ]);
    const out = new Map<string, ProvenanceDescriptor>();
    collectOdfProvenanceRegions([region], out);
    expect(out.size).toBe(0);
  });

  it("finds the real change element by its own tag, not merely the first child element", () => {
    const region = el("text:changed-region", { "xml:id": "r1" }, [
      el("some:decoy", {}),
      el("text:insertion", {}),
    ]);
    const out = new Map<string, ProvenanceDescriptor>();
    collectOdfProvenanceRegions([region], out);
    expect(out.get("r1")?.change).toBe("insertion");
  });

  it("finds office:change-info by its own tag, not merely the first child of the change element", () => {
    const region = el("text:changed-region", { "xml:id": "r1" }, [
      el("text:insertion", {}, [
        el("some:decoy", {}),
        el("office:change-info", {}, [
          el("dc:creator", {}, [txt("Real Author")]),
        ]),
      ]),
    ]);
    const out = new Map<string, ProvenanceDescriptor>();
    collectOdfProvenanceRegions([region], out);
    expect(out.get("r1")?.author).toBe("Real Author");
  });

  it("finds dc:creator by its own tag, not merely the first child of office:change-info", () => {
    const region = el("text:changed-region", { "xml:id": "r1" }, [
      el("text:insertion", {}, [
        el("office:change-info", {}, [
          el("some:decoy", {}),
          el("dc:creator", {}, [txt("Real Author")]),
        ]),
      ]),
    ]);
    const out = new Map<string, ProvenanceDescriptor>();
    collectOdfProvenanceRegions([region], out);
    expect(out.get("r1")?.author).toBe("Real Author");
  });

  it("finds dc:date by its own tag, not merely the first child of office:change-info", () => {
    const region = el("text:changed-region", { "xml:id": "r1" }, [
      el("text:insertion", {}, [
        el("office:change-info", {}, [
          el("some:decoy", {}),
          el("dc:date", {}, [txt("2024-01-01T00:00:00Z")]),
        ]),
      ]),
    ]);
    const out = new Map<string, ProvenanceDescriptor>();
    collectOdfProvenanceRegions([region], out);
    expect(out.get("r1")?.dateIso).toBe("2024-01-01T00:00:00Z");
  });
});
