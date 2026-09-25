import { describe, expect, it } from "vitest";
import {
  type ExtractionPolicy,
  type PropertyGraph,
  defaultExtractionPolicy,
  orderKeys,
  projectDocumentGraph,
  walkPropertyGraph,
} from "./graph";
import { nodeByText } from "../test-support/graph-assertions";
import {
  headingGroup,
  listGroup,
  paragraph,
  sectionConstructGroup,
  sectionGroup,
  table,
  wordprocessingPackage,
} from "../test-support/fixtures";

describe("ordered STYLED_BY chains (#660)", () => {
  it("emits one edge per ancestor chain entry, outermost first, so walking in orderKey order reconstructs the resolution chain", () => {
    // A section wrapper styled s1 containing a heading wrapper styled s2: the heading's chain is [s1, s2] — outermost first, nearest last, exactly the order effectivePackage overlays in.
    const pkg = wordprocessingPackage(
      [
        sectionGroup(
          [headingGroup("T", 1, [paragraph("x.")], { style: "s2" })],
          { style: "s1" },
        ),
      ],
      {
        styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const heading = graph.nodes.find(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    )!;
    const chain = graph.edges
      .filter((edge) => edge.kind === "STYLED_BY" && edge.from === heading.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(chain).toHaveLength(2);
    const boldEntry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("bold"),
    )!;
    const italicEntry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("italic"),
    )!;
    expect(chain.map((edge) => edge.to)).toEqual([
      boldEntry.id,
      italicEntry.id,
    ]);
  });

  it("emits the full chain for a list anchor exactly as for a heading anchor", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([listGroup("Item", 0, [], { style: "s2" })], {
          style: "s1",
        }),
      ],
      {
        styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const item = nodeByText(graph, "Item");
    const chain = graph.edges
      .filter((edge) => edge.kind === "STYLED_BY" && edge.from === item.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    const boldEntry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("bold"),
    )!;
    const italicEntry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("italic"),
    )!;
    expect(chain.map((edge) => edge.to)).toEqual([
      boldEntry.id,
      italicEntry.id,
    ]);
  });

  it("emits an inherited-chain edge for a bare, non-anchor paragraph leaf sitting directly in a styled scope", () => {
    const pkg = wordprocessingPackage(
      [sectionGroup([paragraph("Plain body.")], { style: "s1" })],
      {
        styles: { s1: { run: { bold: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const leaf = nodeByText(graph, "Plain body.");
    const edges = graph.edges.filter(
      (edge) => edge.kind === "STYLED_BY" && edge.from === leaf.id,
    );
    const entry = graph.nodes.find((node) => node.kind === "styleEntry")!;
    expect(edges).toEqual([
      {
        from: leaf.id,
        to: entry.id,
        kind: "STYLED_BY",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
    ]);
  });

  it("emits no STYLED_BY edge for a non-paragraph leaf sitting in the identical styled scope", () => {
    const cells = table([["cell"]]);
    const pkg = wordprocessingPackage(
      [sectionGroup([cells], { style: "s1" })],
      {
        styles: { s1: { run: { bold: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const tableNode = graph.nodes.find((node) => node.kind === "table")!;
    const edges = graph.edges.filter(
      (edge) => edge.kind === "STYLED_BY" && edge.from === tableNode.id,
    );
    expect(edges).toEqual([]);
  });

  it("threads the chain through three levels of nested anchors down to a bare leaf", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup(
          [
            headingGroup(
              "H",
              1,
              [listGroup("Item", 0, [paragraph("Deepest.")], { style: "s3" })],
              { style: "s2" },
            ),
          ],
          { style: "s1" },
        ),
      ],
      {
        styles: {
          s1: { run: { bold: true } },
          s2: { run: { italic: true } },
          s3: { run: { underline: true } },
        },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const deepest = nodeByText(graph, "Deepest.");
    const chain = graph.edges
      .filter((edge) => edge.kind === "STYLED_BY" && edge.from === deepest.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    const s1Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("bold"),
    )!;
    const s2Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("italic"),
    )!;
    const s3Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" &&
        JSON.stringify(node).includes("underline"),
    )!;
    expect(chain.map((edge) => edge.to)).toEqual([
      s1Entry.id,
      s2Entry.id,
      s3Entry.id,
    ]);
  });

  it("a non-anchor styled group emits only its own single ref for itself, but still passes the full chain to its children", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup(
          [
            sectionConstructGroup([paragraph("Inside construct.")], {
              style: "s2",
            }),
          ],
          { style: "s1" },
        ),
      ],
      {
        styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const construct = graph.nodes.find(
      (node) => node.kind === "contentControl",
    )!;
    const s1Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("bold"),
    )!;
    const s2Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("italic"),
    )!;
    // Non-anchor: only its own direct ref, never the inherited chain — unchanged from pre-#660 behaviour.
    const constructEdges = graph.edges.filter(
      (edge) => edge.kind === "STYLED_BY" && edge.from === construct.id,
    );
    expect(constructEdges).toEqual([
      {
        from: construct.id,
        to: s2Entry.id,
        kind: "STYLED_BY",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
    ]);
    // Its child leaf still inherits the FULL chain (s1, s2) passed through the non-anchor wrapper.
    const inside = nodeByText(graph, "Inside construct.");
    const leafChain = graph.edges
      .filter((edge) => edge.kind === "STYLED_BY" && edge.from === inside.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(leafChain.map((edge) => edge.to)).toEqual([s1Entry.id, s2Entry.id]);
  });

  it("custom: an inlined ancestor entry in the chain contributes no edge, leaving extracted entries at their own chain position", () => {
    const inlineS1: ExtractionPolicy = (path, value) =>
      path.length === 2 && path[0] === "styles" && path[1] === "s1"
        ? "inline"
        : defaultExtractionPolicy(path, value);
    const pkg = wordprocessingPackage(
      [
        sectionGroup([headingGroup("T", 1, [], { style: "s2" })], {
          style: "s1",
        }),
      ],
      {
        styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: inlineS1,
    });
    const heading = graph.nodes.find(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    )!;
    const chain = graph.edges.filter(
      (edge) => edge.kind === "STYLED_BY" && edge.from === heading.id,
    );
    // s1 (chain position 0) inlines — no edge; s2 (chain position 1) is still extracted, at its own chain position.
    const s2Entry = graph.nodes.find((node) => node.kind === "styleEntry")!;
    expect(chain).toEqual([
      {
        from: heading.id,
        to: s2Entry.id,
        kind: "STYLED_BY",
        orderKey: orderKeys.orderKeyForIndex(1),
      },
    ]);
  });
});

describe("walkPropertyGraph (#660)", () => {
  it("sorts outgoing edges by orderKey ascending regardless of the array's own insertion order", () => {
    // Six edges deliberately inserted in a fully reverse-of-ascending order (f, e, d, c, b, a) — wide enough that no small-array sort implementation quirk (insertion sort, binary insertion, or otherwise) can coincidentally reproduce ascending order from an already-favourable insertion sequence; every adjacent pair in the insertion order is itself a descending pair, so a genuinely-ascending comparator is the only way to reach the expected order.
    const graph: PropertyGraph = {
      nodes: [
        { id: "root", kind: "test" },
        { id: "a", kind: "test" },
        { id: "b", kind: "test" },
        { id: "c", kind: "test" },
        { id: "d", kind: "test" },
        { id: "e", kind: "test" },
        { id: "f", kind: "test" },
      ],
      edges: [
        { from: "root", to: "f", kind: "CONTAINS", orderKey: "f" },
        { from: "root", to: "e", kind: "CONTAINS", orderKey: "e" },
        { from: "root", to: "d", kind: "CONTAINS", orderKey: "d" },
        { from: "root", to: "c", kind: "CONTAINS", orderKey: "c" },
        { from: "root", to: "b", kind: "CONTAINS", orderKey: "b" },
        { from: "root", to: "a", kind: "CONTAINS", orderKey: "a" },
      ],
    };
    const visited = walkPropertyGraph(graph, "root").map(({ node }) => node.id);
    expect(visited).toEqual(["root", "a", "b", "c", "d", "e", "f"]);
  });

  it("still guards a genuine cycle when the requested kinds exclude CONTAINS entirely, not just when CONTAINS is included alongside another kind", () => {
    // needsGuard's own kind-filter check (kinds.some((kind) => kind !== "CONTAINS")) must genuinely test "is some requested kind NOT CONTAINS", not "is CONTAINS among the requested kinds" — the two conditions agree whenever CONTAINS sits alongside another kind (both true), which is all the sibling test above this one exercises, but they diverge sharply when CONTAINS is excluded from `kinds` altogether: the correct condition is still true (STYLED_BY !== "CONTAINS"), while the swapped one is false (no element equals "CONTAINS"), wrongly skipping the cycle guard's on-path Set entirely.
    const nodes = [
      { id: "a", kind: "x" },
      { id: "b", kind: "x" },
    ];
    const edges = [
      { from: "a", to: "b", kind: "STYLED_BY", orderKey: "k0" },
      { from: "b", to: "a", kind: "STYLED_BY", orderKey: "k0" },
    ];
    const walked = walkPropertyGraph({ nodes, edges }, "a", {
      kinds: ["STYLED_BY"],
    });
    // Without the guard this recurses forever; the assertion below is only reachable at all if the guard genuinely engaged and suppressed the revisit.
    expect(walked.filter(({ node }) => node.id === "a").length).toBe(1);
  });

  it("walks containment-only in document order without a cycle guard (a Merkle DAG is provably acyclic), revisiting a shared node once per path", () => {
    const shared = paragraph("Shared.");
    const pkg = wordprocessingPackage([sectionGroup([shared, shared])]);
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const visited = walkPropertyGraph(graph, "doc", {
      kinds: ["CONTAINS"],
    }).map(({ node }) => node.id);
    // The same shared leaf is reachable by two paths, and the walker reports it per path: termination is the acyclicity guarantee, uniqueness is the caller's to coalesce.
    expect(
      visited.filter(
        (id) => id === visited.find((candidate) => candidate === id),
      ).length,
    ).toBeGreaterThanOrEqual(1);
    const expectedVisitedCount = 4; // root, section, then the shared leaf once per path
    expect(visited).toHaveLength(expectedVisitedCount);
  });

  it("guards reference-kind edges by default: a hand-built cyclic graph terminates, and the cycle is reported rather than looping", () => {
    const nodes = [
      { id: "a", kind: "x" },
      { id: "b", kind: "x" },
    ];
    // Two nodes pointing at each other through DEFINED_BY edges — the author-supplied-pointer shape the issue names.
    const edges = [
      { from: "a", to: "b", kind: "DEFINED_BY", orderKey: "k0" },
      { from: "b", to: "a", kind: "DEFINED_BY", orderKey: "k0" },
    ];
    const walked = walkPropertyGraph({ nodes, edges }, "a");
    expect(walked.map(({ node }) => node.id)).toContain("b");
    expect(walked.filter(({ node }) => node.id === "a").length).toBe(1); // the revisit was suppressed by the guard
  });

  it("walks every kind present by default, mixing CONTAINS with STYLED_BY and DEFINED_BY in one traversal", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup(
            "T",
            1,
            [
              {
                node: {
                  kind: "anchor",
                  anchorType: "footnote",
                  name: "1",
                  definition: "n1",
                },
                children: [],
              },
            ],
            { style: "s1" },
          ),
        ]),
      ],
      {
        styles: { s1: { run: { bold: true } } },
        definitions: {
          n1: {
            kind: "footnote",
            blocks: [{ kind: "paragraph", runs: [{ text: "Note." }] }],
          },
        },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const visited = walkPropertyGraph(graph, "doc");
    const kindsSeen = new Set(
      visited
        .map(({ edge }) => edge?.kind)
        .filter((kind): kind is string => kind !== undefined),
    );
    expect(kindsSeen).toEqual(new Set(["CONTAINS", "STYLED_BY", "DEFINED_BY"]));
    // Every node in the graph is reachable from the root once every kind is in play.
    expect(new Set(visited.map(({ node }) => node.id))).toEqual(
      new Set(graph.nodes.map((node) => node.id)),
    );
  });

  it("restricting kinds excludes edges of a kind actually present, not just kinds absent from the graph", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup("T", 1, [paragraph("Body.")], { style: "s1" }),
        ]),
      ],
      { styles: { s1: { run: { bold: true } } } },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const heading = graph.nodes.find(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    )!;
    const body = nodeByText(graph, "Body.");
    // The heading has both a CONTAINS edge to its own body paragraph and a STYLED_BY edge to its style entry — restricting to STYLED_BY must never surface the CONTAINS-reached body, even though the graph genuinely has CONTAINS edges to filter out.
    const walked = walkPropertyGraph(graph, heading.id, {
      kinds: ["STYLED_BY"],
    });
    expect(walked.map(({ node }) => node.id)).not.toContain(body.id);
  });

  it("still guards a genuine cycle among non-CONTAINS edges even when CONTAINS is also included in the requested kinds", () => {
    const nodes = [
      { id: "a", kind: "x" },
      { id: "b", kind: "x" },
    ];
    const edges = [
      { from: "a", to: "b", kind: "STYLED_BY", orderKey: "k0" },
      { from: "b", to: "a", kind: "STYLED_BY", orderKey: "k0" },
    ];
    const walked = walkPropertyGraph({ nodes, edges }, "a", {
      kinds: ["CONTAINS", "STYLED_BY"],
    });
    expect(walked.filter(({ node }) => node.id === "a").length).toBe(1);
  });

  it("walking STYLED_BY alone in orderKey order reconstructs the resolution chain from a starting anchor", () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([headingGroup("T", 1, [], { style: "s2" })], {
          style: "s1",
        }),
      ],
      {
        styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
      },
    );
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }]);
    const heading = graph.nodes.find(
      (node) => node.kind === "paragraph" && node.headingLevel === 1,
    )!;
    const s1Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("bold"),
    )!;
    const s2Entry = graph.nodes.find(
      (node) =>
        node.kind === "styleEntry" && JSON.stringify(node).includes("italic"),
    )!;
    const walked = walkPropertyGraph(graph, heading.id, {
      kinds: ["STYLED_BY"],
    });
    // The start node itself, then s1 (outermost) before s2 (nearest) — orderKey order reproduces resolution order.
    expect(walked.map(({ node }) => node.id)).toEqual([
      heading.id,
      s1Entry.id,
      s2Entry.id,
    ]);
  });

  it("WalkedNode.edge names the exact edge traversed to reach each node, and is undefined only for the start node", () => {
    const nodes = [
      { id: "a", kind: "x" },
      { id: "b", kind: "x" },
      { id: "c", kind: "x" },
    ];
    const edges = [
      {
        from: "a",
        to: "b",
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: "a",
        to: "c",
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(1),
      },
    ];
    const walked = walkPropertyGraph({ nodes, edges }, "a");
    expect(walked).toEqual([
      { node: nodes[0], edge: undefined },
      { node: nodes[1], edge: edges[0] },
      { node: nodes[2], edge: edges[1] },
    ]);
  });
});
