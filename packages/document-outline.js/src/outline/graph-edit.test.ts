import { describe, expect, it } from "vitest";
import { OrderKeyBudgetExhaustedError } from "./order-keys";
import {
  type ExtractionPolicy,
  type GraphEdge,
  type PropertyGraph,
  contentHashV1,
  orderKeys,
  projectDocumentGraph,
} from "./graph";
import {
  AmbiguousEdgeError,
  AmbiguousSiblingError,
  ContainsCycleError,
  NodeKindMismatchError,
  UnknownEdgeError,
  UnknownSiblingError,
  boundedOrderKey,
  dpAt,
  insertEdge,
  insertNode,
  runOrRebalance,
} from "./graph-edit";
import {
  expectSchemaValid,
  nodeByText,
} from "../test-support/graph-assertions";
import {
  paragraph,
  sectionGroup,
  wordprocessingPackage,
} from "../test-support/fixtures";

describe("write API: insertNode / insertEdge (#935)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("mints a real content-addressed id for a newly inserted node, ignoring an id-shaped field in its own content", () => {
    const { graph, id } = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: {
        kind: "paragraph",
        runs: [{ text: "Inserted." }],
        id: "caller-chosen",
      },
    });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toBe("caller-chosen");
    const node = graph.nodes.find((candidate) => candidate.id === id)!;
    expect(node.id).toBe(id);
    expect(node.id).not.toBe("caller-chosen");
    // InsertNodeContent carries no id field at all — the supplied "id" reaches the node only as ordinary hashed content, then is shadowed on the face by the real computed value, exactly the discipline every read-side mint site already follows.
    expect(
      contentHashV1({
        kind: "paragraph",
        runs: [{ text: "Inserted." }],
        id: "caller-chosen",
      }),
    ).toBe(id);
  });

  it("shadows a properties field named kind with the explicit kind parameter, the same discipline mintValueNode applies", () => {
    const { graph, id } = insertNode(EMPTY_GRAPH, {
      kind: "value",
      properties: { kind: "not-a-real-graph-kind", title: "T" },
    });
    const node = graph.nodes.find((candidate) => candidate.id === id)!;
    expect(node.kind).toBe("value");
    expect(node.title).toBe("T");
  });

  it("folds children into the hash input exactly as projectGroup does: omitting children and passing an empty list mint different ids", () => {
    const leafOnly = insertNode(EMPTY_GRAPH, {
      kind: "section",
      properties: { kind: "section" },
    });
    const emptyChildren = insertNode(EMPTY_GRAPH, {
      kind: "section",
      properties: { kind: "section" },
      children: [],
    });
    expect(leafOnly.id).not.toBe(emptyChildren.id);
    expect(leafOnly.id).toBe(contentHashV1({ kind: "section" }));
    expect(emptyChildren.id).toBe(
      contentHashV1({ kind: "section", children: [] }),
    );
  });

  it("mints one CONTAINS edge per child at orderKeyForIndex(index), and re-inserting identical content is a no-op past the first call", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const group = insertNode(leafB.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id],
    });
    const childEdges = group.graph.edges.filter(
      (edge) => edge.from === group.id && edge.kind === "CONTAINS",
    );
    expect(childEdges).toEqual([
      {
        from: group.id,
        to: leafA.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: group.id,
        to: leafB.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(1),
      },
    ]);
    // Re-inserting the identical leaf again mints the identical id and adds no second copy of the node.
    const again = insertNode(group.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    expect(again.id).toBe(leafA.id);
    expect(again.graph).toEqual(group.graph);
  });

  it('hasPriorContainsEdges\' own (from === id && kind === "CONTAINS") check ignores a decoy edge satisfying only one clause, still taking the wide-key fresh-mint fast path rather than reconciliation', () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafB.id],
    });
    // Two decoys, each satisfying exactly one clause: a STYLED_BY edge FROM sectionId (right owner, wrong kind) and a CONTAINS edge from an unrelated id (wrong owner, right kind). Neither is a genuine prior CONTAINS edge from sectionId itself, so hasPriorContainsEdges must read false and insertNode must still take its own plain, wide-key mint loop — reconcileChildren's bisection-based insertion would produce different (though still validly ordered) keys for a first-ever child, which the exact orderKeyForIndex equality below would catch.
    const withDecoys = insertEdge(
      insertEdge(leafB.graph, sectionId, leafA.id, { kind: "STYLED_BY" }),
      "unrelated-id",
      leafA.id,
    );
    const group = insertNode(withDecoys, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id],
    });
    const childEdges = group.graph.edges.filter(
      (edge) => edge.from === group.id && edge.kind === "CONTAINS",
    );
    expect(childEdges).toEqual([
      {
        from: group.id,
        to: leafA.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: group.id,
        to: leafB.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(1),
      },
    ]);
  });

  it("re-projecting after insertion is consistent: a subtree built via insertNode/insertEdge mints the identical ids and edges projectDocumentGraph mints for the equivalent DocumentTree", () => {
    const pkg = wordprocessingPackage([
      sectionGroup([paragraph("First."), paragraph("Second.")]),
    ]);
    expectSchemaValid(pkg, "consistency");
    const real = projectDocumentGraph([{ id: "doc", package: pkg }]);

    const first = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "First." }] },
    });
    const second = insertNode(first.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Second." }] },
    });
    const section = insertNode(second.graph, {
      kind: "section",
      properties: {
        pageSize: { widthPt: 595, heightPt: 842 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        kind: "section",
      },
      children: [first.id, second.id],
    });
    const built = insertEdge(section.graph, "doc", section.id);

    const realFirst = nodeByText(real, "First.");
    const realSecond = nodeByText(real, "Second.");
    const realSection = real.nodes.find((node) => node.kind === "section")!;

    expect(first.id).toBe(realFirst.id);
    expect(second.id).toBe(realSecond.id);
    expect(section.id).toBe(realSection.id);

    const realSectionContains = real.edges.filter(
      (edge) => edge.from === realSection.id && edge.kind === "CONTAINS",
    );
    const builtSectionContains = built.edges.filter(
      (edge) => edge.from === section.id && edge.kind === "CONTAINS",
    );
    expect(builtSectionContains).toEqual(realSectionContains);

    const realRootContains = real.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "CONTAINS",
    );
    const builtRootContains = built.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "CONTAINS",
    );
    expect(builtRootContains).toEqual(realRootContains);
  });

  it("insertEdge rebalances the whole sibling list when bisection has no room left, rather than surfacing the exhaustion", () => {
    const b = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const graphWithB = insertEdge(b.graph, "parent", b.id); // b lands at orderKeyForIndex(0), the scheme's own floor
    const originalBKey = graphWithB.edges[0]!.orderKey;
    expect(originalBKey).toBe(orderKeys.orderKeyForIndex(0));
    // The floor genuinely has no room below it — this is the exact exhaustion insertEdge must catch and rebalance past.
    expect(() => orderKeys.orderKeyBefore(originalBKey)).toThrow(
      OrderKeyBudgetExhaustedError,
    );

    const a = insertNode(graphWithB, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    // An edge that must survive the rebalance untouched: a different `from`, sharing nothing with "parent"'s own sibling group being rebalanced — proves rebalancedInsert's own `kept` filter genuinely carries over every OTHER edge in the graph, not just happening to end up empty because every edge present was part of the rebalanced group.
    const withUnrelated = insertEdge(a.graph, "unrelated-parent", a.id);
    const rebalanced = insertEdge(withUnrelated, "parent", a.id, {
      position: { at: "start" },
    });

    const contains = rebalanced.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(contains.map((edge) => edge.to)).toEqual([a.id, b.id]);
    // b's own edge really was rewritten, not merely left in place beneath a new one: its orderKey changed, and the pair now carries a fresh, evenly spaced renumberedOrderKeys(2) set.
    expect(contains.find((edge) => edge.to === b.id)!.orderKey).not.toBe(
      originalBKey,
    );
    expect(contains.map((edge) => edge.orderKey)).toEqual(
      orderKeys.renumberedOrderKeys(2),
    );
    // Neither edge carried a path, so the rebuilt edges must genuinely omit the key, not carry it as `undefined`.
    for (const edge of contains) expect("path" in edge).toBe(false);
    // The unrelated edge is untouched: still present, unchanged.
    expect(
      rebalanced.edges.filter((edge) => edge.from === "unrelated-parent"),
    ).toHaveLength(1);
  });

  it("insertEdge: start/end/before/after mint keys that sort into the requested position, and reject a sibling id the parent does not carry", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const c = insertNode(b.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "C." }] },
    });
    const d = insertNode(c.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "D." }] },
    });
    const e = insertNode(d.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "E." }] },
    });

    let graph = insertEdge(e.graph, "parent", b.id); // default: end
    graph = insertEdge(graph, "parent", d.id); // default: end — b, d
    graph = insertEdge(graph, "parent", a.id, { position: { at: "start" } }); // a, b, d
    graph = insertEdge(graph, "parent", e.id, { position: { at: "end" } }); // a, b, d, e
    graph = insertEdge(graph, "parent", c.id, {
      position: { at: "after", siblingId: b.id },
    }); // a, b, c, d, e

    const orderedEdges = graph.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(orderedEdges.map((edge) => edge.to)).toEqual([
      a.id,
      b.id,
      c.id,
      d.id,
      e.id,
    ]);
    // None of these calls passed a `path` option, so every minted edge must genuinely omit the key.
    for (const edge of orderedEdges) expect("path" in edge).toBe(false);

    let caught: unknown;
    try {
      insertEdge(graph, "parent", a.id, {
        position: { at: "before", siblingId: "not-a-real-sibling" },
      });
    } catch (error) {
      caught = error;
    }
    // A named error class with structured fields, this module's own convention (OrderKeyBudgetExhaustedError), rather than a message a caller would have to parse.
    expect(caught).toBeInstanceOf(UnknownSiblingError);
    const unknownSibling = caught as UnknownSiblingError;
    expect(unknownSibling.from).toBe("parent");
    expect(unknownSibling.kind).toBe("CONTAINS");
    expect(unknownSibling.siblingId).toBe("not-a-real-sibling");
  });

  it("insertEdge never mutates the graph handed to it", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Solo." }] },
    });
    const before = leaf.graph;
    insertEdge(before, "parent", leaf.id);
    expect(before.edges).toEqual([]);
  });

  it("insertEdge rebalances rather than throwing when two adjacent siblings already share one orderKey (e.g. the uniform floor key emitWalkEdges mints for every PROPERTY/DEFINED_BY edge from one owner)", () => {
    // Extract two metadata scalars off the same document root: emitWalkEdges (graph.ts's own PROPERTY/DEFINED_BY emission) gives both edges orderKeyForIndex(0) — a real tie between two siblings of the SAME kind from the SAME owner, not merely a narrow interval.
    const extractMetadataScalars: ExtractionPolicy = (path) =>
      path.length === 2 &&
      path[0] === "metadata" &&
      (path[1] === "title" || path[1] === "author")
        ? "extract"
        : "inline";
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      metadata: { title: "T", author: "A" },
    });
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: extractMetadataScalars,
    });
    const tiedSiblings = graph.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "PROPERTY",
    );
    expect(tiedSiblings).toHaveLength(2);
    expect(tiedSiblings[0]!.orderKey).toBe(tiedSiblings[1]!.orderKey);
    expect(tiedSiblings[0]!.orderKey).toBe(orderKeys.orderKeyForIndex(0));

    const inserted = insertNode(graph, {
      kind: "value",
      properties: { value: "inserted" },
    });
    // Inserting directly between the two tied siblings is exactly the case boundedOrderKey must recognise before ever calling orderKeyBetween(tied, tied) — this must rebalance, not throw.
    const result = insertEdge(inserted.graph, "doc", inserted.id, {
      kind: "PROPERTY",
      position: { at: "after", siblingId: tiedSiblings[0]!.to },
      path: ["metadata", "inserted"],
    });

    const rebalanced = result.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "PROPERTY",
    );
    const expectedRebalancedCount = 3;
    expect(rebalanced).toHaveLength(expectedRebalancedCount);
    // The tie is gone — every sibling now sorts uniquely.
    expect(new Set(rebalanced.map((edge) => edge.orderKey)).size).toBe(
      expectedRebalancedCount,
    );
    const ordered = [...rebalanced].sort((x, y) =>
      x.orderKey < y.orderKey ? -1 : 1,
    );
    expect(ordered.map((edge) => edge.to)).toEqual([
      tiedSiblings[0]!.to,
      inserted.id,
      tiedSiblings[1]!.to,
    ]);
    // Each rebalanced edge kept its own path — rebalancedInsert carries path through, it does not drop it.
    expect(ordered.map((edge) => edge.path)).toEqual([
      tiedSiblings[0]!.path,
      ["metadata", "inserted"],
      tiedSiblings[1]!.path,
    ]);
  });

  it("front-inserting against a tied PROPERTY sibling group still renumbers it into a real sequence — verified directly rather than left as an assumption", () => {
    // { at: 'start' } against a single tied PROPERTY sibling walks the orderKeyBefore(floor) path, which was already OrderKeyBudgetExhaustedError before the tie fix above (unrelated code path — `before` is undefined here, not tied-with-`after`), so this is pre-existing rebalance behaviour, not something the tie fix changed. Documented here so it is a verified fact, not an unverified assumption.
    const extractMetadataScalars: ExtractionPolicy = (path) =>
      path.length === 2 && path[0] === "metadata" && path[1] === "title"
        ? "extract"
        : "inline";
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      metadata: { title: "T" },
    });
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: extractMetadataScalars,
    });
    const original = graph.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "PROPERTY",
    );
    expect(original).toHaveLength(1);
    expect(original[0]!.orderKey).toBe(orderKeys.orderKeyForIndex(0)); // the uniform floor key, carrying no real sequence

    const inserted = insertNode(graph, {
      kind: "value",
      properties: { value: "inserted" },
    });
    const result = insertEdge(inserted.graph, "doc", inserted.id, {
      kind: "PROPERTY",
      position: { at: "start" },
      path: ["metadata", "inserted"],
    });

    const after = result.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "PROPERTY",
    );
    expect(after).toHaveLength(2);
    // The pre-existing PROPERTY edge's orderKey really was rewritten by the rebalance — confirmed, not assumed. Harmless here: PROPERTY/DEFINED_BY edge identity (edgeKey) is disambiguated by `path` as much as by orderKey, and this edge's own path is untouched.
    const originalAfterInsert = after.find(
      (edge) => edge.path === original[0]!.path,
    )!;
    expect(originalAfterInsert.orderKey).not.toBe(original[0]!.orderKey);
    expect(originalAfterInsert.path).toEqual(original[0]!.path);
  });
});

describe("containsWouldReach internals (#935)", () => {
  it("only follows CONTAINS edges, never a STYLED_BY edge that happens to point the same direction", () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: "a", kind: "x" },
        { id: "b", kind: "x" },
      ],
      edges: [{ from: "a", to: "b", kind: "STYLED_BY", orderKey: "k0" }],
    };
    expect(() => insertEdge(graph, "b", "a")).not.toThrow();
  });

  it("checks every CONTAINS child of a node with more than one, not only the first", () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: "x", kind: "t" },
        { id: "p", kind: "t" },
        { id: "q", kind: "t" },
        { id: "target", kind: "t" },
      ],
      edges: [
        { from: "x", to: "p", kind: "CONTAINS", orderKey: "k0" },
        { from: "x", to: "q", kind: "CONTAINS", orderKey: "k1" },
        { from: "q", to: "target", kind: "CONTAINS", orderKey: "k0" },
      ],
    };
    // x reaches target only through its SECOND child q — a check that only ever recorded the first CONTAINS child per node would miss this path entirely.
    expect(() => insertEdge(graph, "target", "x")).toThrow(ContainsCycleError);
  });

  it("terminates instead of looping forever when the existing edges already contain a genuine CONTAINS cycle unrelated to the new attachment", () => {
    const graph: PropertyGraph = {
      nodes: [
        { id: "p", kind: "t" },
        { id: "q", kind: "t" },
        { id: "x", kind: "t" },
      ],
      edges: [
        { from: "p", to: "q", kind: "CONTAINS", orderKey: "k0" },
        { from: "q", to: "p", kind: "CONTAINS", orderKey: "k0" },
      ],
    };
    expect(() => insertEdge(graph, "x", "p")).not.toThrow();
  });

  it("a dead-end search (the target has no CONTAINS children of its own) genuinely finds nothing, not a fabricated match", () => {
    // childrenOf.get(current) is undefined at a genuine dead end (a leaf with no CONTAINS children recorded at all), and the DFS's own `?? []` must contribute nothing further to the stack there. Naming the new edge's own `from` "Stryker was here" turns any fallback OTHER than a genuinely empty array into a self-fulfilling false positive: a placeholder array whose element happens to equal `from` would make the dead-end's own popped placeholder satisfy `current === from` on the very next iteration, incorrectly reporting a cycle that doesn't exist.
    const leaf = insertNode(
      { nodes: [], edges: [] },
      {
        kind: "paragraph",
        properties: { kind: "paragraph", runs: [{ text: "Leaf." }] },
      },
    );
    expect(() =>
      insertEdge(leaf.graph, "Stryker was here", leaf.id),
    ).not.toThrow();
  });
});

// Every named error class's own `.name` and message text, checked directly against a real construction rather than only via `toThrow(SomeClass)` (which never reads either field) — each class's own module comment explains why the message is worded the way it is.
describe("named error classes: identity and message text", () => {
  it("NodeKindMismatchError", () => {
    const error = new NodeKindMismatchError("id1", "paragraph", "table");
    expect(error.name).toBe("NodeKindMismatchError");
    expect(error.message).toBe(
      'insertNode: id "id1" already names a node of kind "paragraph", cannot also be kind "table"',
    );
  });

  it("UnknownSiblingError", () => {
    const error = new UnknownSiblingError("from1", "CONTAINS", "sib1");
    expect(error.name).toBe("UnknownSiblingError");
    expect(error.message).toBe(
      'insertEdge: sibling "sib1" names no existing CONTAINS edge from "from1"',
    );
  });

  it("AmbiguousSiblingError", () => {
    const ambiguousEdgeCount = 3;
    const error = new AmbiguousSiblingError(
      "from1",
      "CONTAINS",
      "sib1",
      ambiguousEdgeCount,
    );
    expect(error.name).toBe("AmbiguousSiblingError");
    expect(error.message).toBe(
      'insertEdge: sibling "sib1" names 3 existing CONTAINS edges from "from1", not exactly one — before/after has no single position to resolve against',
    );
  });

  it("UnknownEdgeError, with and without a path", () => {
    const withoutPath = new UnknownEdgeError(
      "from1",
      "to1",
      "CONTAINS",
      undefined,
    );
    expect(withoutPath.name).toBe("UnknownEdgeError");
    expect(withoutPath.message).toBe(
      'no CONTAINS edge from "from1" to "to1" exists to select',
    );
    const withPath = new UnknownEdgeError("from1", "to1", "PROPERTY", ["a", 0]);
    expect(withPath.message).toBe(
      'no PROPERTY edge from "from1" to "to1" at path ["a",0] exists to select',
    );
  });

  it("AmbiguousEdgeError, with and without a path", () => {
    const withoutPath = new AmbiguousEdgeError(
      "from1",
      "to1",
      "CONTAINS",
      undefined,
      2,
    );
    expect(withoutPath.name).toBe("AmbiguousEdgeError");
    expect(withoutPath.message).toBe(
      '2 CONTAINS edges from "from1" to "to1" match — pass `path` to disambiguate',
    );
    const withPath = new AmbiguousEdgeError(
      "from1",
      "to1",
      "PROPERTY",
      ["a"],
      2,
    );
    expect(withPath.message).toBe(
      '2 PROPERTY edges from "from1" to "to1" at path ["a"] match — these edges are identical in every field removeEdge/replaceEdge can compare, so none of them can be selected unambiguously',
    );
  });

  it("ContainsCycleError", () => {
    const error = new ContainsCycleError("from1", "to1");
    expect(error.name).toBe("ContainsCycleError");
    expect(error.message).toBe(
      'insertEdge: attaching CONTAINS "from1" -> "to1" would close a cycle — "to1" already reaches "from1"',
    );
  });
});

describe("runOrRebalance", () => {
  it("returns the attempt's own result when it succeeds, never calling onExhausted", () => {
    let exhaustedCalled = false;
    expect(
      runOrRebalance(
        () => "ok",
        () => {
          exhaustedCalled = true;
          return "rebalanced";
        },
      ),
    ).toBe("ok");
    expect(exhaustedCalled).toBe(false);
  });

  it("answers an OrderKeyBudgetExhaustedError with the rebalance callback's own result", () => {
    expect(
      runOrRebalance(
        () => {
          throw new OrderKeyBudgetExhaustedError("no room");
        },
        () => "rebalanced",
      ),
    ).toBe("rebalanced");
  });

  it("rethrows any error that isn't OrderKeyBudgetExhaustedError, never calling onExhausted", () => {
    expect(() =>
      runOrRebalance(
        () => {
          throw new Error("boom");
        },
        () => "never",
      ),
    ).toThrow("boom");
  });
});

describe("boundedOrderKey", () => {
  it("throws the exact tied-siblings message when two adjacent siblings already share one orderKey", () => {
    const tie = orderKeys.orderKeyForIndex(0);
    const siblings: GraphEdge[] = [
      { from: "p", to: "a", kind: "PROPERTY", orderKey: tie },
      { from: "p", to: "b", kind: "PROPERTY", orderKey: tie },
    ];
    expect(() => boundedOrderKey(siblings, 1)).toThrow(
      "boundedOrderKey: adjacent siblings share one orderKey, leaving no room to bisect; rebalance with renumberedOrderKeys",
    );
  });
});

describe("dpAt", () => {
  // Arbitrary DP row content, distinct enough per position to catch an off-by-one read.
  const dpRowStep = 10;
  const dpRow = Array.from(
    { length: 3 },
    (_, index) => (index + 1) * dpRowStep,
  );

  it("returns the value at a valid index", () => {
    const validIndex = 1;
    expect(dpAt(dpRow, validIndex)).toBe(dpRow[validIndex]);
  });

  it("throws with the exact out-of-bounds message for an index past the row's length", () => {
    const outOfBoundsIndex = dpRow.length;
    expect(() => dpAt(dpRow, outOfBoundsIndex)).toThrow(
      "reconcileChildren: dp lookup index 3 out of bounds (0..2)",
    );
  });

  it("throws with the exact out-of-bounds message for a negative index", () => {
    expect(() => dpAt(dpRow, -1)).toThrow(
      "reconcileChildren: dp lookup index -1 out of bounds (0..2)",
    );
  });
});
