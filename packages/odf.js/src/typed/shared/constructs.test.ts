import { describe, expect, it } from "vitest";
import type {
  ConstructDescriptor,
  ContentBlock,
  ContentControlDescriptor,
  DefinitionEntry,
  DivisionDescriptor,
  ProvenanceDescriptor,
  RunConstructExtent,
  SourceResidue,
} from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import {
  canonicalOdfConstructDescriptor,
  collectOdfDataStyleDefinitions,
  collectOdfFieldMasterDefinitions,
  collectOdfFontFaceDefinitions,
  collectOdfNamedExpressions,
  collectOdfNonContentPartResidue,
  collectOdfProvenanceRegions,
  insertOdfConstructMarkers,
  isEmbeddedObjectPart,
  odfDivisionDescriptor,
  odfIndexControlDescriptor,
  odfIndexWrapperTag,
  odfMarkerHalfEventIndex,
  odfRunConstructWriteKind,
  pairOdfMarkerHalves,
  parseOdfFieldInstruction,
  resolveOdfMarkerEvents,
  writeOdfDivision,
  writeOdfIndexWrapper,
  writeOdfPackageResidue,
  writeOdfTrackedChanges,
  type OdfConstructExtent,
  type OdfMarkerEvent,
  type OdfMarkerHalf,
} from "./constructs";

// Every fixture here is a programmatic package/element built with el/txt, matching the sibling odt/constructs.test.ts's own fixture-gate convention.

function part(nodes: XmlNode[]): Package {
  return { parts: { "settings.xml": { kind: "xml", nodes } } };
}

describe("isEmbeddedObjectPart", () => {
  it("quarantines an Object-N directory's own part path", () => {
    expect(isEmbeddedObjectPart("Object 1/content.xml")).toBe(true);
    expect(isEmbeddedObjectPart("Object 12/content.xml")).toBe(true);
  });
  it("does not match a path whose first segment merely ends with the Object-N shape", () => {
    expect(isEmbeddedObjectPart("XObject 1/content.xml")).toBe(false);
  });
  it("does not match a path whose first segment has trailing content after the digits", () => {
    expect(isEmbeddedObjectPart("Object 1x/content.xml")).toBe(false);
  });
  it("does not match a path with no digits at all", () => {
    expect(isEmbeddedObjectPart("Object/content.xml")).toBe(false);
  });
});

describe("collectOdfNonContentPartResidue", () => {
  it("quarantines nothing for a non-content part whose nodes carry no element at all", () => {
    const pkg = part([{ type: "declaration", attributes: [] }]);
    const out: Record<string, SourceResidue> = {};
    collectOdfNonContentPartResidue(pkg, "odt", out);
    expect(out).toEqual({});
  });
  it("quarantines a non-content part carrying a real element", () => {
    const pkg = part([el("config:config-item-set", {}, [])]);
    const out: Record<string, SourceResidue> = {};
    collectOdfNonContentPartResidue(pkg, "odt", out);
    expect(out["settings.xml"]?.xml).toContain("config:config-item-set");
  });
});

describe("writeOdfPackageResidue", () => {
  const baseline: SourceResidue = { format: "odt", xml: "<foo/>" };

  it("does nothing when source is undefined", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", undefined);
    expect(pkg.parts).toEqual({});
  });

  it("skips an entry whose residue format does not match the writer's own format", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", {
      "settings.xml": { format: "ods", xml: "<foo/>" },
    });
    expect(pkg.parts).toEqual({});
  });

  it("skips an entry whose key does not end .xml", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", { "settings.bin": baseline });
    expect(pkg.parts).toEqual({});
  });

  it("skips an entry keyed at one of this writer's own consumed part paths", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", { "content.xml": baseline });
    expect(pkg.parts).toEqual({});
  });

  it("skips an entry keyed inside an embedded object's own Object-N directory", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", { "Object 1/content.xml": baseline });
    expect(pkg.parts).toEqual({});
  });

  it("restores an eligible entry as a real xml part with the exact declaration attributes", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", { "settings.xml": baseline });
    const restored = pkg.parts["settings.xml"];
    if (restored?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const [declaration] = restored.nodes;
    if (declaration?.type !== "declaration") {
      throw new Error("expected a leading declaration node");
    }
    expect(declaration.attributes).toEqual([
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
    ]);
  });

  it("filters non-element nodes out of the parsed residue body, keeping only the real element", () => {
    const pkg: Package = { parts: {} };
    writeOdfPackageResidue(pkg, "odt", {
      "settings.xml": { format: "odt", xml: "<!--c--><foo/>" },
    });
    const restored = pkg.parts["settings.xml"];
    if (restored?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const [, body] = restored.nodes;
    expect(body).toEqual({
      type: "element",
      tag: "foo",
      attributes: [],
      children: [],
    });
  });
});

function sectionPackage(styles: XmlElement[]): Package {
  return {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: [
          el("office:document-content", {}, [
            el("office:automatic-styles", {}, styles),
          ]),
        ],
      },
    },
  };
}

describe("odfDivisionDescriptor", () => {
  it("carries no name property when text:name is absent", () => {
    const descriptor = odfDivisionDescriptor(
      el("text:section", {}),
      sectionPackage([]),
    );
    expect(descriptor).not.toHaveProperty("name");
  });

  it('reads text:protected="false" as an explicit false, not an absent flag', () => {
    const descriptor = odfDivisionDescriptor(
      el("text:section", { "text:protected": "false" }),
      sectionPackage([]),
    );
    expect(descriptor.protected).toBe(false);
  });

  it("carries no protected property when text:protected is absent", () => {
    const descriptor = odfDivisionDescriptor(
      el("text:section", {}),
      sectionPackage([]),
    );
    expect(descriptor).not.toHaveProperty("protected");
  });

  it("carries no columnCount property when the section carries no resolvable column count", () => {
    const descriptor = odfDivisionDescriptor(
      el("text:section", {}),
      sectionPackage([]),
    );
    expect(descriptor).not.toHaveProperty("columnCount");
  });

  it("resolves a section's own column count only from the exact style matching both family and name", () => {
    const styles = [
      // right name, wrong family -- must not match
      el(
        "style:style",
        { "style:family": "paragraph", "style:name": "Sect1" },
        [
          el("style:section-properties", {}, [
            el("style:columns", { "fo:column-count": "9" }),
          ]),
        ],
      ),
      // right family, wrong name -- must not match
      el("style:style", { "style:family": "section", "style:name": "Other" }, [
        el("style:section-properties", {}, [
          el("style:columns", { "fo:column-count": "9" }),
        ]),
      ]),
      // right family and name -- the real match
      el("style:style", { "style:family": "section", "style:name": "Sect1" }, [
        el("style:section-properties", {}, [
          el("style:columns", { "fo:column-count": "3" }),
        ]),
      ]),
    ];
    const descriptor = odfDivisionDescriptor(
      el("text:section", { "text:style-name": "Sect1" }),
      sectionPackage(styles),
    );
    expect(descriptor.columnCount).toBe(3);
  });

  it("treats a zero column count as no fact", () => {
    const styles = [
      el("style:style", { "style:family": "section", "style:name": "Sect1" }, [
        el("style:section-properties", {}, [
          el("style:columns", { "fo:column-count": "0" }),
        ]),
      ]),
    ];
    const descriptor = odfDivisionDescriptor(
      el("text:section", { "text:style-name": "Sect1" }),
      sectionPackage(styles),
    );
    expect(descriptor).not.toHaveProperty("columnCount");
  });

  it("treats a negative column count as no fact", () => {
    const styles = [
      el("style:style", { "style:family": "section", "style:name": "Sect1" }, [
        el("style:section-properties", {}, [
          el("style:columns", { "fo:column-count": "-5" }),
        ]),
      ]),
    ];
    const descriptor = odfDivisionDescriptor(
      el("text:section", { "text:style-name": "Sect1" }),
      sectionPackage(styles),
    );
    expect(descriptor).not.toHaveProperty("columnCount");
  });

  it("carries no linked.sectionName when the section-source has no text:section-name", () => {
    const descriptor = odfDivisionDescriptor(
      el("text:section", {}, [
        el("text:section-source", { "xlink:href": "chapter.odt" }),
      ]),
      sectionPackage([]),
    );
    expect(descriptor.linked).toEqual({ href: "chapter.odt" });
  });
});

describe("odfIndexControlDescriptor", () => {
  it("carries no tag property when the wrapper has no text:name", () => {
    const descriptor = odfIndexControlDescriptor(
      el("text:table-of-content", {}),
    );
    expect(descriptor).not.toHaveProperty("tag");
  });
});

function paragraphWithSiblings(
  siblings: XmlNode[],
  halfIndex: number,
): { paragraph: XmlElement; half: XmlElement } {
  const half = el("text:bookmark-start", { "text:name": "b" });
  const children = [...siblings];
  children.splice(halfIndex, 0, half);
  const paragraph = el("text:p", {}, children);
  return { paragraph, half };
}

describe("isContentBearingNode (via odfMarkerHalfEventIndex)", () => {
  // A half is judged NOT at a paragraph edge (interior) exactly when a genuinely content-bearing sibling precedes it -- so each case below plants exactly one such sibling before the half and checks the half stops qualifying as "leading".
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
      const { paragraph, half } = paragraphWithSiblings(
        [sibling, el("text:span", {})],
        1,
      );
      const marker: OdfMarkerHalf = {
        kind: "bookmark",
        side: "start",
        key: "b",
        element: half,
        parent: paragraph,
        runPosition: 0,
        order: 0,
        descriptor: () => undefined,
      };
      expect(odfMarkerHalfEventIndex(marker, paragraph, 5)).toBeUndefined();
    },
  );

  it("an empty text node preceding the half does not move it off the leading edge", () => {
    const { paragraph, half } = paragraphWithSiblings([txt("")], 1);
    const marker: OdfMarkerHalf = {
      kind: "bookmark",
      side: "start",
      key: "b",
      element: half,
      parent: paragraph,
      runPosition: 0,
      order: 0,
      descriptor: () => undefined,
    };
    expect(odfMarkerHalfEventIndex(marker, paragraph, 5)).toBe(5);
  });

  it("a non-content-bearing element (e.g. another bookmark half) preceding the half does not move it off the leading edge", () => {
    const decoy = el("text:bookmark-end", { "text:name": "other" });
    const { paragraph, half } = paragraphWithSiblings([decoy], 1);
    const marker: OdfMarkerHalf = {
      kind: "bookmark",
      side: "start",
      key: "b",
      element: half,
      parent: paragraph,
      runPosition: 0,
      order: 0,
      descriptor: () => undefined,
    };
    expect(odfMarkerHalfEventIndex(marker, paragraph, 5)).toBe(5);
  });

  it("returns undefined when the half's own recorded parent is not the paragraph passed in", () => {
    const other = el("text:p", {});
    const half = el("text:bookmark-start", { "text:name": "b" });
    const marker: OdfMarkerHalf = {
      kind: "bookmark",
      side: "start",
      key: "b",
      element: half,
      parent: other,
      runPosition: 0,
      order: 0,
      descriptor: () => undefined,
    };
    const paragraph = el("text:p", {}, [half]);
    expect(odfMarkerHalfEventIndex(marker, paragraph, 5)).toBeUndefined();
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
    expect(odfMarkerHalfEventIndex(marker, paragraph, 5)).toBeUndefined();
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

  it("drops a key with no start half at all", () => {
    const end = half({ side: "end", element: el("text:bookmark-end", {}) });
    const { extents } = pairOdfMarkerHalves([end], paragraph);
    expect(extents).toEqual([]);
  });

  it("drops a key with two start halves", () => {
    const startA = half({
      side: "start",
      element: el("text:bookmark-start", { id: "a" }),
    });
    const startB = half({
      side: "start",
      element: el("text:bookmark-start", { id: "b" }),
    });
    const end = half({ side: "end", element: el("text:bookmark-end", {}) });
    const { extents } = pairOdfMarkerHalves([startA, startB, end], paragraph);
    expect(extents).toEqual([]);
  });

  it("drops a key with two end halves", () => {
    const start = half({
      side: "start",
      element: el("text:bookmark-start", {}),
    });
    const endA = half({
      side: "end",
      element: el("text:bookmark-end", { id: "a" }),
    });
    const endB = half({
      side: "end",
      element: el("text:bookmark-end", { id: "b" }),
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
  it("drops a key with no qualified start", () => {
    const end = event({ side: "end", element: el("text:bookmark-end", {}) });
    const { extents } = resolveOdfMarkerEvents([end]);
    expect(extents).toEqual([]);
  });

  it("drops a key with two qualified starts", () => {
    const startA = event({ element: el("text:bookmark-start", { id: "a" }) });
    const startB = event({ element: el("text:bookmark-start", { id: "b" }) });
    const end = event({ side: "end", element: el("text:bookmark-end", {}) });
    const { extents } = resolveOdfMarkerEvents([startA, startB, end]);
    expect(extents).toEqual([]);
  });

  it("drops a key with two qualified ends", () => {
    const start = event({});
    const endA = event({
      side: "end",
      element: el("text:bookmark-end", { id: "a" }),
    });
    const endB = event({
      side: "end",
      element: el("text:bookmark-end", { id: "b" }),
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
    const result = insertOdfConstructMarkers(blocks, [outer, inner]);
    // The outer extent (endIndex 1) must open before the inner one (endIndex 0), which itself closes immediately (a point extent) before the outer's own block.
    expect(result).toEqual([
      { kind: "constructStart", descriptor: outer.descriptor },
      { kind: "constructStart", descriptor: inner.descriptor },
      { kind: "constructEnd" },
      blocks[0],
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

describe("collectOdfFieldMasterDefinitions (readOdfFieldMasterEntry)", () => {
  it("skips a declaration with no text:name at all", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFieldMasterDefinitions(
      [el("text:variable-decls", {}, [el("text:variable-decl", {})])],
      out,
    );
    expect(out).toEqual({});
  });

  it("carries no valueType/value/stringValue/formula when their attributes are absent", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFieldMasterDefinitions(
      [
        el("text:variable-decls", {}, [
          el("text:variable-decl", { "text:name": "v1" }),
        ]),
      ],
      out,
    );
    const entry = out["variable:v1"];
    expect(entry).not.toHaveProperty("valueType");
    expect(entry).not.toHaveProperty("value");
    expect(entry).not.toHaveProperty("stringValue");
    expect(entry).not.toHaveProperty("formula");
  });

  it("reads office:string-value specifically, not some other attribute", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFieldMasterDefinitions(
      [
        el("text:variable-decls", {}, [
          el("text:variable-decl", {
            "text:name": "v1",
            "office:string-value": "hello",
          }),
        ]),
      ],
      out,
    );
    expect(out["variable:v1"]?.stringValue).toBe("hello");
  });

  it("omits displayOutlineLevel for a negative value", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFieldMasterDefinitions(
      [
        el("text:sequence-decls", {}, [
          el("text:sequence-decl", {
            "text:name": "s1",
            "text:display-outline-level": "-1",
          }),
        ]),
      ],
      out,
    );
    expect(out["sequence:s1"]).not.toHaveProperty("displayOutlineLevel");
  });

  it("keeps displayOutlineLevel for a valid non-negative integer", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFieldMasterDefinitions(
      [
        el("text:sequence-decls", {}, [
          el("text:sequence-decl", {
            "text:name": "s1",
            "text:display-outline-level": "2",
          }),
        ]),
      ],
      out,
    );
    expect(out["sequence:s1"]).toHaveProperty("displayOutlineLevel", 2);
  });
});

describe("collectOdfDataStyleDefinitions", () => {
  it("skips a data style element with no style:name", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfDataStyleDefinitions([el("number:date-style", {})], out);
    expect(out).toEqual({});
  });
});

describe("collectOdfFontFaceDefinitions", () => {
  it("skips a font face with a name but no font family", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFontFaceDefinitions(
      [el("style:font-face", { "style:name": "F1" })],
      out,
    );
    expect(out).toEqual({});
  });

  it("skips a font face with a font family but no name", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFontFaceDefinitions(
      [el("style:font-face", { "svg:font-family": "Arial" })],
      out,
    );
    expect(out).toEqual({});
  });

  it("carries no familyGeneric/pitch when their attributes are absent", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFontFaceDefinitions(
      [
        el("style:font-face", {
          "style:name": "F1",
          "svg:font-family": "Arial",
        }),
      ],
      out,
    );
    const entry = out["fontFace:F1"];
    expect(entry).not.toHaveProperty("familyGeneric");
    expect(entry).not.toHaveProperty("pitch");
  });
});

describe("collectOdfNamedExpressions", () => {
  it("skips a child with no table:name", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [el("table:named-expressions", {}, [el("table:named-range", {})])],
      out,
    );
    expect(out).toEqual({});
  });

  it("skips a named-range with no table:cell-range-address", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-range", { "table:name": "n1" }),
        ]),
      ],
      out,
    );
    expect(out).toEqual({});
  });

  it("carries no baseCellAddress for a named-range when it is absent", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-range", {
            "table:name": "n1",
            "table:cell-range-address": "$A$1:$A$2",
          }),
        ]),
      ],
      out,
    );
    expect(out["named-range:n1"]).not.toHaveProperty("baseCellAddress");
  });

  it("carries baseCellAddress for a named-range when present", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-range", {
            "table:name": "n1",
            "table:cell-range-address": "$A$1:$A$2",
            "table:base-cell-address": "$A$1",
          }),
        ]),
      ],
      out,
    );
    expect(out["named-range:n1"]?.baseCellAddress).toBe("$A$1");
  });

  it("does not treat a child of neither known tag as a named-expression even when it carries an expression attribute", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:not-a-real-tag", {
            "table:name": "n1",
            "table:expression": "1+1",
          }),
        ]),
      ],
      out,
    );
    expect(out).toEqual({});
  });

  it("skips a named-expression with no table:expression", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-expression", { "table:name": "e1" }),
        ]),
      ],
      out,
    );
    expect(out).toEqual({});
  });

  it("carries baseCellAddress for a named-expression when present", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-expression", {
            "table:name": "e1",
            "table:expression": "1+1",
            "table:base-cell-address": "$A$1",
          }),
        ]),
      ],
      out,
    );
    expect(out["named-expression:e1"]?.baseCellAddress).toBe("$A$1");
  });
});

describe("parseOdfFieldInstruction", () => {
  it("finds the real top-level element, skipping a leading non-element node", () => {
    const element = parseOdfFieldInstruction('<!--c--><foo a="1"/>');
    expect(element.tag).toBe("foo");
  });
});

describe("canonicalOdfConstructDescriptor", () => {
  it("passes a non-index contentControl through unchanged", () => {
    const descriptor: ConstructDescriptor = {
      kind: "contentControl",
      controlType: "richText",
    };
    expect(canonicalOdfConstructDescriptor(descriptor)).toEqual(descriptor);
  });

  it("passes an index contentControl with no source through unchanged, without dereferencing a source that isn't there", () => {
    const descriptor: ConstructDescriptor = {
      kind: "contentControl",
      controlType: "index",
    };
    expect(() => canonicalOdfConstructDescriptor(descriptor)).not.toThrow();
    expect(canonicalOdfConstructDescriptor(descriptor)).toEqual(descriptor);
  });
});

describe("writeOdfTrackedChanges", () => {
  it("wraps every region in a text:tracked-changes element, spelled exactly", () => {
    expect(writeOdfTrackedChanges([]).tag).toBe("text:tracked-changes");
  });

  it("writes no office:change-info at all when neither author nor date is present", () => {
    const region = el("text:tracked-changes-region-probe", {});
    const result = writeOdfTrackedChanges([
      { id: "r1", descriptor: { kind: "provenance", change: "insertion" } },
    ]);
    const [regionEl] = result.children;
    if (regionEl?.type !== "element") {
      throw new Error("expected a text:changed-region element");
    }
    const [changeEl] = regionEl.children;
    if (changeEl?.type !== "element") {
      throw new Error("expected a change element");
    }
    expect(changeEl.children).toEqual([]);
    void region;
  });
});

describe("odfRunConstructWriteKind", () => {
  function extent(
    descriptor: RunConstructExtent["descriptor"],
    startRun: number,
    endRun: number,
  ): RunConstructExtent {
    return { descriptor, startRun, endRun };
  }

  it("distinguishes a zero-width bookmark point from a ranged bookmark", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "b",
    };
    expect(odfRunConstructWriteKind(extent(descriptor, 2, 2))).toBe(
      "bookmarkPoint",
    );
    expect(odfRunConstructWriteKind(extent(descriptor, 2, 4))).toBe(
      "bookmarkRange",
    );
  });

  it("refuses a footnote anchor with no definition key at all", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "footnote",
      name: "n1",
    };
    expect(
      odfRunConstructWriteKind(extent(descriptor, 0, 0), {}),
    ).toBeUndefined();
  });

  it("refuses a footnote anchor whose definition key is not actually in the definitions table", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "footnote",
      name: "n1",
      definition: "note:n1",
    };
    expect(
      odfRunConstructWriteKind(extent(descriptor, 0, 0), {}),
    ).toBeUndefined();
  });

  it("writes a footnote as note and a comment as comment, once their definition resolves", () => {
    const noteDescriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "footnote",
      name: "n1",
      definition: "note:n1",
    };
    const commentDescriptor: RunConstructExtent["descriptor"] = {
      kind: "anchor",
      anchorType: "comment",
      name: "c1",
      definition: "comment:c1",
    };
    const definitions: Record<string, DefinitionEntry> = {
      "note:n1": { kind: "footnote", body: [] },
      "comment:c1": { kind: "comment", body: [] },
    };
    expect(
      odfRunConstructWriteKind(extent(noteDescriptor, 0, 0), definitions),
    ).toBe("note");
    expect(
      odfRunConstructWriteKind(extent(commentDescriptor, 0, 0), definitions),
    ).toBe("comment");
  });

  it("refuses a moveFrom/moveTo provenance change (no ODF spelling exists for either)", () => {
    const moveFrom: RunConstructExtent["descriptor"] = {
      kind: "provenance",
      change: "moveFrom",
    };
    const moveTo: RunConstructExtent["descriptor"] = {
      kind: "provenance",
      change: "moveTo",
    };
    const changeIds = new Map<ProvenanceDescriptor, string>([
      [moveFrom, "id1"],
      [moveTo, "id2"],
    ]);
    expect(
      odfRunConstructWriteKind(extent(moveFrom, 0, 0), {}, changeIds),
    ).toBeUndefined();
    expect(
      odfRunConstructWriteKind(extent(moveTo, 0, 0), {}, changeIds),
    ).toBeUndefined();
  });

  it("refuses a provenance change with no minted region id at all", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "provenance",
      change: "insertion",
    };
    expect(
      odfRunConstructWriteKind(extent(descriptor, 0, 0), {}),
    ).toBeUndefined();
  });

  it("distinguishes a zero-width change point from a ranged change, once minted", () => {
    const descriptor: RunConstructExtent["descriptor"] = {
      kind: "provenance",
      change: "insertion",
    };
    const changeIds = new Map<ProvenanceDescriptor, string>([
      [descriptor, "id1"],
    ]);
    expect(
      odfRunConstructWriteKind(extent(descriptor, 3, 3), {}, changeIds),
    ).toBe("changePoint");
    expect(
      odfRunConstructWriteKind(extent(descriptor, 3, 5), {}, changeIds),
    ).toBe("changeRange");
  });
});

describe("writeOdfDivision", () => {
  it("carries no text:section-name when the linked division names none", () => {
    const descriptor: DivisionDescriptor = {
      kind: "division",
      linked: { href: "chapter.odt" },
    };
    const result = writeOdfDivision(descriptor, [], {
      mintSectionStyleName: () => "S1",
    });
    const sourceEl = result.children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "text:section-source",
    );
    expect(sourceEl?.attributes).toEqual([
      { name: "xlink:type", value: "simple" },
      { name: "xlink:href", value: "chapter.odt" },
    ]);
  });
});

describe("odfIndexWrapperTag / writeOdfIndexWrapper", () => {
  function descriptorWithSourceXml(xml: string): ContentControlDescriptor {
    return {
      kind: "contentControl",
      controlType: "index",
      source: { format: "odt", xml },
    };
  }

  it("finds the real *-source element, skipping a leading non-element node", () => {
    expect(
      odfIndexWrapperTag(
        descriptorWithSourceXml("<!--c--><text:table-of-content-source/>"),
      ),
    ).toBe("text:table-of-content");
  });

  it("throws when the residue's own top-level element does not end in -source", () => {
    expect(() =>
      odfIndexWrapperTag(descriptorWithSourceXml("<text:table-of-content/>")),
    ).toThrow();
  });

  it("throws when the stripped tag is not one of the seven recognised index wrapper tags", () => {
    expect(() =>
      odfIndexWrapperTag(descriptorWithSourceXml("<text:bogus-source/>")),
    ).toThrow();
  });

  it("writes the bare *-source child and the recovered wrapper tag together", () => {
    const descriptor = descriptorWithSourceXml(
      "<text:table-of-content-source/>",
    );
    const result = writeOdfIndexWrapper(descriptor, []);
    expect(result.tag).toBe("text:table-of-content");
    expect(
      result.children.some(
        (child) =>
          child.type === "element" &&
          child.tag === "text:table-of-content-source",
      ),
    ).toBe(true);
  });
});
