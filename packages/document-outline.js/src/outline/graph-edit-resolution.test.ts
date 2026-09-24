import { describe, expect, it } from "vitest";
import {
  type ExtractionPolicy,
  type PropertyGraph,
  contentHashV1,
  orderKeys,
  projectDocumentGraph,
} from "./graph";
import {
  AmbiguousEdgeError,
  AmbiguousSiblingError,
  ContainsCycleError,
  UnknownEdgeError,
  insertEdge,
  insertNode,
  removeEdge,
  replaceEdge,
} from "./graph-edit";
import {
  paragraph,
  sectionGroup,
  wordprocessingPackage,
} from "../test-support/fixtures";

describe("write API: insertEdge refuses a CONTAINS cycle (#935)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("insertEdge refuses to attach a CONTAINS edge that would close a cycle (re-parenting a node under its own descendant)", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Leaf." }] },
    });
    const group = insertNode(leaf.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leaf.id],
    });
    // group already CONTAINS leaf; attaching leaf -> group would close a cycle (leaf -> group -> leaf), which is exactly the shape that used to crash walkPropertyGraph's CONTAINS-only walk with a stack overflow once someone walked it.
    let caught: unknown;
    try {
      insertEdge(group.graph, leaf.id, group.id);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContainsCycleError);
    const cycleError = caught as ContainsCycleError;
    expect(cycleError.from).toBe(leaf.id);
    expect(cycleError.to).toBe(group.id);
  });

  it("insertEdge refuses a CONTAINS self-loop", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Solo." }] },
    });
    expect(() => insertEdge(leaf.graph, leaf.id, leaf.id)).toThrow(
      ContainsCycleError,
    );
  });

  it("insertEdge still allows attaching one already-minted node under two independent parents — multi-parent DAG sharing is not a cycle", () => {
    const shared = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Shared." }] },
    });
    let graph = insertEdge(shared.graph, "parentA", shared.id);
    graph = insertEdge(graph, "parentB", shared.id);
    const contains = graph.edges
      .filter((edge) => edge.kind === "CONTAINS")
      .map((edge) => `${edge.from}->${edge.to}`);
    expect(contains).toEqual([
      `parentA->${shared.id}`,
      `parentB->${shared.id}`,
    ]);
  });

  it("insertNode refuses a CONTAINS cycle closing through an id that had no node when the first edge was attached, since its fresh-mint children-wiring is checked exactly like insertEdge's own attachment rather than a node-lookup-based check that could not see a cycle closing through an id with no node yet", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Leaf." }] },
    });
    // Compute the section's id WITHOUT minting it — exactly the shape that defeated the old node-presence-gated check.
    const sectionId = contentHashV1({
      kind: "section",
      children: [leaf.id],
    });
    // insertEdge onto a not-yet-existing id is allowed by design (a dangling forward edge); at this point it closes no cycle, since sectionId has no outgoing CONTAINS edges yet.
    const withDanglingEdge = insertEdge(leaf.graph, leaf.id, sectionId);
    expect(
      withDanglingEdge.edges.some(
        (edge) => edge.from === leaf.id && edge.to === sectionId,
      ),
    ).toBe(true);
    expect(withDanglingEdge.nodes.some((node) => node.id === sectionId)).toBe(
      false,
    );

    // Minting the section now, with children: [leaf.id], would wire section -> leaf on top of the already-attached leaf -> section edge, closing the cycle. Must throw, not silently succeed and leave a graph walkPropertyGraph can no longer traverse.
    let caught: unknown;
    try {
      insertNode(withDanglingEdge, {
        kind: "section",
        properties: { kind: "section" },
        children: [leaf.id],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContainsCycleError);
    const cycleError = caught as ContainsCycleError;
    expect(cycleError.from).toBe(sectionId);
    expect(cycleError.to).toBe(leaf.id);

    // The graph never actually gained the section node or the section -> leaf edge — insertNode threw before either was appended.
    expect(withDanglingEdge.nodes.some((node) => node.id === sectionId)).toBe(
      false,
    );
    expect(
      withDanglingEdge.edges.some(
        (edge) => edge.from === sectionId && edge.to === leaf.id,
      ),
    ).toBe(false);
  });

  it("insertNode refuses ContainsCycleError for a multi-child fresh mint when only a LATER child in the list closes the cycle, and mints nothing before the throw", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Leaf." }] },
    });
    const otherLeaf = insertNode(leaf.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Other." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [otherLeaf.id, leaf.id],
    });
    const withDanglingEdge = insertEdge(otherLeaf.graph, leaf.id, sectionId);

    expect(() =>
      insertNode(withDanglingEdge, {
        kind: "section",
        properties: { kind: "section" },
        children: [otherLeaf.id, leaf.id],
      }),
    ).toThrow(ContainsCycleError);
    // otherLeaf's own CONTAINS edge from the not-yet-existing section id must not have been left behind by the throw.
    expect(
      withDanglingEdge.edges.some(
        (edge) => edge.from === sectionId && edge.to === otherLeaf.id,
      ),
    ).toBe(false);
  });
});

describe("write API: insertEdge refuses an ambiguous before/after sibling only on a genuine orderKey tie (#935)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("insertEdge resolves before/after deterministically — against the EARLIEST match in orderKey order — when the named sibling id matches more than one edge but those edges carry distinct orderKeys, rather than refusing the ordinary two-identical-children shape as ambiguous", () => {
    const v = insertNode(EMPTY_GRAPH, {
      kind: "value",
      properties: { value: "shared" },
    });
    // Two sequential insertEdge appends of the SAME target: insertEdge's own bisection never ties two of its own siblings, so these two PROPERTY edges to v.id carry distinct orderKeys even though they share a target — exactly the "duplicate CONTAINS/PROPERTY children with distinct orderKeys" shape this module resolves deterministically, rather than refusing.
    let graph = insertEdge(v.graph, "parent", v.id, {
      kind: "PROPERTY",
      path: ["a"],
    });
    graph = insertEdge(graph, "parent", v.id, {
      kind: "PROPERTY",
      path: ["b"],
    });
    const matches = graph.edges.filter(
      (edge) =>
        edge.from === "parent" && edge.kind === "PROPERTY" && edge.to === v.id,
    );
    expect(matches).toHaveLength(2);
    expect(new Set(matches.map((edge) => edge.orderKey)).size).toBe(2); // genuinely distinct, not tied

    const other = insertNode(graph, {
      kind: "value",
      properties: { value: "other" },
    });
    // Must NOT throw: the earliest of the two v.id matches (path "a", the lower orderKey) is the deterministic boundary for "after v.id".
    const result = insertEdge(other.graph, "parent", other.id, {
      kind: "PROPERTY",
      position: { at: "after", siblingId: v.id },
      path: ["c"],
    });
    const ordered = result.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "PROPERTY")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(ordered.map((edge) => edge.path)).toEqual([["a"], ["c"], ["b"]]);
  });

  it("insertEdge refuses an ambiguous before/after position when the named sibling id matches more than one edge that GENUINELY TIE on orderKey — projectDocumentGraph's own emitWalkEdges mints exactly this shape when two metadata fields extract to the identical shared value node", () => {
    const extractSameValueTwice: ExtractionPolicy = (path) =>
      path.length === 2 &&
      path[0] === "metadata" &&
      (path[1] === "title" || path[1] === "subject")
        ? "extract"
        : "inline";
    const pkg = wordprocessingPackage([sectionGroup([paragraph("Body.")])], {
      metadata: { title: "shared", subject: "shared" },
    });
    const graph = projectDocumentGraph([{ id: "doc", package: pkg }], {
      policy: extractSameValueTwice,
    });
    const tied = graph.edges.filter(
      (edge) => edge.from === "doc" && edge.kind === "PROPERTY",
    );
    // Identical content ("shared") dedupes to ONE value node, referenced by TWO PROPERTY edges (one per metadata key) — both minted by emitWalkEdges at the uniform floor orderKey, a genuine tie.
    expect(tied).toHaveLength(2);
    expect(tied[0]!.to).toBe(tied[1]!.to);
    expect(tied[0]!.orderKey).toBe(tied[1]!.orderKey);

    const other = insertNode(graph, {
      kind: "value",
      properties: { value: "other" },
    });
    let caught: unknown;
    try {
      insertEdge(other.graph, "doc", other.id, {
        kind: "PROPERTY",
        position: { at: "after", siblingId: tied[0]!.to },
        path: ["metadata", "creator"],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AmbiguousSiblingError);
    const ambiguous = caught as AmbiguousSiblingError;
    expect(ambiguous.from).toBe("doc");
    expect(ambiguous.kind).toBe("PROPERTY");
    expect(ambiguous.siblingId).toBe(tied[0]!.to);
    expect(ambiguous.matchCount).toBe(2);
  });

  it("insertEdge resolves a duplicate CONTAINS child deterministically against its earliest occurrence, rather than hard-blocking the ordinary two-identical-children shape", () => {
    const shared = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Shared." }] },
    });
    // "parent" CONTAINS the same shared node twice, at two different (necessarily distinct) sibling positions.
    let graph = insertEdge(shared.graph, "parent", shared.id);
    graph = insertEdge(graph, "parent", shared.id, { position: { at: "end" } });
    const sharedEdges = graph.edges.filter(
      (edge) =>
        edge.from === "parent" &&
        edge.kind === "CONTAINS" &&
        edge.to === shared.id,
    );
    expect(sharedEdges).toHaveLength(2);
    expect(new Set(sharedEdges.map((edge) => edge.orderKey)).size).toBe(2);

    const newLeaf = insertNode(graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "New." }] },
    });
    // Must resolve against the FIRST occurrence, not throw AmbiguousSiblingError.
    const result = insertEdge(newLeaf.graph, "parent", newLeaf.id, {
      position: { at: "before", siblingId: shared.id },
    });
    const ordered = result.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([newLeaf.id, shared.id, shared.id]);
  });

  it("insertEdge resolves before/after normally when the named sibling matches exactly one edge, even when other siblings share its orderKey-tying structure", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    let graph = insertEdge(b.graph, "parent", a.id);
    graph = insertEdge(graph, "parent", b.id, {
      position: { at: "after", siblingId: a.id },
    });
    const ordered = graph.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([a.id, b.id]);
  });
});

// Exhaustive correctness proof for reconcileChildren (#935 round 10): every requested `children` sequence over a pool of 2 or 3 distinct ids, up to a bounded length, crossed with every GENUINE SUBSEQUENCE of that exact sequence as the pre-wired existing edge state — not merely the "first K occurrences of each id, independently" shape round 9's own generator was limited to. A genuine subsequence is built by choosing an arbitrary SUBSET of the request's own positions (in ascending order) and pre-wiring exactly those, in that order, as literal CONTAINS edges — covering every possible interleaving of which occurrences of which ids are already wired, including the interleaved shape round 9's classifier still mishandled: requested [A, B, A] with positions {1, 2} pre-wired gives existing edges [B, A], a genuine subsequence (drop the request's own first A) that round 9's per-id, front-to-back matcher paired incorrectly, because it matched each id's own occurrences against its own existing edges independently and never considered A's and B's existing edges relative to EACH OTHER.
//
// Choosing a subset of a sequence's own positions can never produce a relative ordering the source sequence itself does not exhibit, so every case this enumeration builds is, by construction, a genuine subsequence — the earlier round-9 suite's claim that an arbitrary subset "cannot be encoded" was true only of that round's own per-id matcher (which had no way to represent a pre-wiring that was not a prefix of each id's own occurrence count), not of the underlying data: an edge set recording exactly the wired positions above is a perfectly ordinary graph state, and the LCS-based classifier below reconciles it correctly. This enumeration therefore proves reconcileChildren's ORDER-CONSISTENT guarantee (exact reproduction, in order and multiplicity) exhaustively over the space it covers; the separate, genuinely order-INCONSISTENT case — existing edges wired in a relative order no subsequence of the request could produce at all — is not reachable this way and is covered by its own dedicated test below instead, which checks only the narrower no-inflation guarantee that case actually promises.
//
// Two pool sizes are run: 2 distinct ids up to length 6, and 3 distinct ids up to length 5 — a combined ~14,790-case enumeration (sum of 4^length for length 1..6, plus 6^length for length 1..5: poolSize^length sequences times 2^length position-subsets, at each length), preferred here over fast-check (not a dependency of this package) precisely because it is a genuine proof over that space rather than probabilistic sampling.
describe("insertEdge sibling filtering by kind, not just from", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("resolves a before/after position against only the named kind's own siblings, ignoring a CONTAINS sibling to the same id at the same position", () => {
    // Two edges from the same "parent", to the same two targets, but of DIFFERENT kinds — CONTAINS and STYLED_BY — interleaved so that filtering by the wrong (hardcoded) kind would see a different sibling list than filtering by the real `kind` parameter, and therefore resolve `{ at: 'after', siblingId: a.id }` to a different position.
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
    // Wire two STYLED_BY siblings (a then b) and a THIRD, unrelated CONTAINS sibling to c — if siblingInsertIndex's own kind filter were replaced by a hardcoded "CONTAINS" (or any other single literal), it would see only the CONTAINS sibling to c and resolve the position against that instead of the real STYLED_BY pair.
    const wired = insertEdge(
      insertEdge(
        insertEdge(b.graph, "parent", a.id, { kind: "STYLED_BY" }),
        "parent",
        b.id,
        {
          kind: "STYLED_BY",
        },
      ),
      "parent",
      c.id,
    );
    const result = insertEdge(wired, "parent", c.id, {
      kind: "STYLED_BY",
      position: { at: "after", siblingId: a.id },
    });
    const styledBy = result.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "STYLED_BY")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    // c lands right after a (between a and b), among the STYLED_BY siblings specifically — not appended past the single unrelated CONTAINS sibling, and not refused as ambiguous by conflating the two kinds.
    expect(styledBy).toEqual([a.id, c.id, b.id]);
  });
});

describe("insertEdge: the CONTAINS cycle check is scoped to CONTAINS edges alone", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("does not run the cycle check for a non-CONTAINS edge, even when attaching it would close a CONTAINS cycle", () => {
    const x = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "X." }] },
    });
    const y = insertNode(x.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Y." }] },
    });
    // x CONTAINS y, so y reaches x's own would-be child position: attaching a further CONTAINS edge y -> x would close a cycle.
    const wired = insertEdge(y.graph, x.id, y.id);
    expect(() => insertEdge(wired, y.id, x.id)).toThrow(ContainsCycleError);
    // The identical y -> x attachment as a STYLED_BY edge is not a CONTAINS edge at all, so the cycle check must never run for it — it succeeds even though "x" (the `to`) already reaches "y" (the `from`) via the CONTAINS edge above.
    const styled = insertEdge(wired, y.id, x.id, { kind: "STYLED_BY" });
    const styledEdge = styled.edges.find(
      (edge) => edge.from === y.id && edge.kind === "STYLED_BY",
    );
    expect(styledEdge?.to).toBe(x.id);
  });
});

describe("insertEdge sorts its own siblings by orderKey before resolving a position", () => {
  it("resolves a before/after position against the sorted index, not the edges array's own raw position", () => {
    const a = {
      from: "p",
      to: "a",
      kind: "STYLED_BY" as const,
      orderKey: orderKeys.orderKeyForIndex(0),
    };
    const b = {
      from: "p",
      to: "b",
      kind: "STYLED_BY" as const,
      orderKey: orderKeys.orderKeyForIndex(1),
    };
    const c = {
      from: "p",
      to: "c",
      kind: "STYLED_BY" as const,
      orderKey: orderKeys.orderKeyForIndex(2),
    };
    // Deliberately out of orderKey order in the edges ARRAY (c, b, a): "a"'s SORTED index is 0 (before b), but its RAW array index is 2 (last). An unsorted read would resolve "after a" to raw-index 3 — past the end of the raw array — bisecting via orderKeyAfter(a's key) into a wide, high-valued key (base-36 orderKeyAfter escapes to a short, lexicographically large string). A correctly-sorted read resolves "after a" to sorted-index 1, bisecting via orderKeyBetween(a, b) into a narrow key strictly less than b.
    const graph: PropertyGraph = { nodes: [], edges: [c, b, a] };
    const result = insertEdge(graph, "p", "d", {
      kind: "STYLED_BY",
      position: { at: "after", siblingId: "a" },
    });
    const inserted = result.edges.find((edge) => edge.to === "d");
    expect(inserted).toBeDefined();
    expect(inserted!.orderKey < b.orderKey).toBe(true);
  });
});
describe("write API: removeEdge / replaceEdge (#1004)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("removeEdge detaches the one matching CONTAINS edge and leaves every other edge and every node untouched", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const wired = insertEdge(
      insertEdge(
        // Two decoys, each satisfying exactly one clause of selectEdge's own (from, to, kind) match and not the other: a CONTAINS edge to A from a DIFFERENT owner (right to/kind, wrong from), and a STYLED_BY edge from "parent" to A (right from/to, wrong kind). Neither may count as a match for removeEdge(wired, "parent", a.id) — a filter with either clause forced true would over-match one of these and either throw AmbiguousEdgeError or detach the wrong edge.
        insertEdge(
          insertEdge(b.graph, "unrelated-parent", a.id),
          "parent",
          a.id,
          { kind: "STYLED_BY" },
        ),
        "parent",
        a.id,
      ),
      "parent",
      b.id,
    );

    const bEdgeBefore = wired.edges.find(
      (edge) => edge.from === "parent" && edge.to === b.id,
    )!;

    const result = removeEdge(wired, "parent", a.id);
    const contains = result.edges.filter(
      (edge) => edge.from === "parent" && edge.kind === "CONTAINS",
    );
    expect(contains).toEqual([bEdgeBefore]);
    // The two decoys survive untouched: only the genuine (parent, a, CONTAINS) match was ever removed.
    expect(
      result.edges.some(
        (edge) => edge.from === "unrelated-parent" && edge.to === a.id,
      ),
    ).toBe(true);
    expect(
      result.edges.some(
        (edge) =>
          edge.from === "parent" &&
          edge.to === a.id &&
          edge.kind === "STYLED_BY",
      ),
    ).toBe(true);
    // Nodes are never pruned by removeEdge — the detached edge's own target, however unreferenced it may now be, is exactly the orphan this module's own top comment already treats as intentional free version history.
    expect(result.nodes).toEqual(wired.nodes);
  });

  it("removeEdge throws UnknownEdgeError, naming the fields that produced the refusal, when no edge matches (from, to, kind)", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    let caught: unknown;
    try {
      removeEdge(a.graph, "parent", a.id);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnknownEdgeError);
    const unknown = caught as UnknownEdgeError;
    expect(unknown.from).toBe("parent");
    expect(unknown.to).toBe(a.id);
    expect(unknown.kind).toBe("CONTAINS");
    expect(unknown.path).toBeUndefined();
  });

  it("removeEdge disambiguates two PROPERTY edges sharing (from, to, kind) via path, and throws AmbiguousEdgeError naming the match count when path is omitted", () => {
    const v = insertNode(EMPTY_GRAPH, {
      kind: "value",
      properties: { value: "shared" },
    });
    let graph = insertEdge(v.graph, "owner", v.id, {
      kind: "PROPERTY",
      path: ["a"],
    });
    graph = insertEdge(graph, "owner", v.id, { kind: "PROPERTY", path: ["b"] });

    let caught: unknown;
    try {
      removeEdge(graph, "owner", v.id, { kind: "PROPERTY" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AmbiguousEdgeError);
    const ambiguous = caught as AmbiguousEdgeError;
    expect(ambiguous.from).toBe("owner");
    expect(ambiguous.to).toBe(v.id);
    expect(ambiguous.kind).toBe("PROPERTY");
    expect(ambiguous.matchCount).toBe(2);

    // Naming the exact path resolves it unambiguously.
    const result = removeEdge(graph, "owner", v.id, {
      kind: "PROPERTY",
      path: ["a"],
    });
    const remaining = result.edges.filter(
      (edge) => edge.from === "owner" && edge.kind === "PROPERTY",
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.path).toEqual(["b"]);
  });

  it("replaceEdge repoints an edge onto a new target while reusing the OLD edge's own orderKey and path unchanged, rather than appending at a fresh position", () => {
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
    // Three siblings under "parent": a, b, c — b is the one being replaced.
    let graph = insertEdge(c.graph, "parent", a.id);
    graph = insertEdge(graph, "parent", b.id);
    graph = insertEdge(graph, "parent", c.id);
    const before = graph.edges.find(
      (edge) => edge.from === "parent" && edge.to === b.id,
    )!;

    const replacement = insertNode(graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B, revised." }] },
    });
    const result = replaceEdge(
      replacement.graph,
      "parent",
      b.id,
      replacement.id,
    );

    const ordered = result.edges
      .filter((edge) => edge.from === "parent" && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    // Same three-slot order (a, replacement, c) — the replacement lands exactly where b sat, not appended after c.
    expect(ordered.map((edge) => edge.to)).toEqual([
      a.id,
      replacement.id,
      c.id,
    ]);
    const replaced = ordered.find((edge) => edge.to === replacement.id)!;
    expect(replaced.orderKey).toBe(before.orderKey);
    // The old edge carried no path, so the replacement must genuinely omit the key too.
    expect("path" in replaced).toBe(false);
    // The old edge to b is gone; b itself is still an untouched, unreferenced orphan in graph.nodes.
    expect(result.edges.some((edge) => edge.to === b.id)).toBe(false);
    expect(result.nodes.some((node) => node.id === b.id)).toBe(true);
  });

  it("replaceEdge carries an edge's own path over unchanged onto the new target", () => {
    const v = insertNode(EMPTY_GRAPH, {
      kind: "value",
      properties: { value: "old" },
    });
    const graph = insertEdge(v.graph, "owner", v.id, {
      kind: "PROPERTY",
      path: ["metadata", "title"],
    });
    const w = insertNode(graph, {
      kind: "value",
      properties: { value: "new" },
    });
    const oldEdge = graph.edges.find(
      (edge) => edge.from === "owner" && edge.kind === "PROPERTY",
    )!;
    const result = replaceEdge(w.graph, "owner", v.id, w.id, {
      kind: "PROPERTY",
      path: ["metadata", "title"],
    });
    const edges = result.edges.filter(
      (edge) => edge.from === "owner" && edge.kind === "PROPERTY",
    );
    expect(edges).toEqual([{ ...oldEdge, to: w.id }]);
  });

  it("replaceEdge refuses a CONTAINS replacement that would close a self-loop cycle, but allows a genuine no-op replacement onto the SAME target — proving the cycle check runs with the edge being replaced already excluded, not the raw pre-replace edge set", () => {
    const leaf = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Leaf." }] },
    });
    const group = insertNode(leaf.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leaf.id],
    });

    // group -[CONTAINS]-> leaf already exists; replacing it with group -[CONTAINS]-> group would make group contain itself.
    expect(() => replaceEdge(group.graph, group.id, leaf.id, group.id)).toThrow(
      ContainsCycleError,
    );

    // A genuine no-op replacement (new target identical to the old one) must NOT be refused as a self-cycle: with the edge being replaced excluded from the check, leaf has no remaining CONTAINS children of its own, so nothing reaches back to group.
    const noOp = replaceEdge(group.graph, group.id, leaf.id, leaf.id);
    expect(
      noOp.edges.filter(
        (edge) => edge.from === group.id && edge.to === leaf.id,
      ),
    ).toHaveLength(1);
  });

  it("replaceEdge throws UnknownEdgeError when the old edge does not exist, and never mints a fresh unrelated edge in its place", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    expect(() => replaceEdge(b.graph, "parent", a.id, b.id)).toThrow(
      UnknownEdgeError,
    );
    expect(b.graph.edges.some((edge) => edge.from === "parent")).toBe(false);
  });

  it("never runs the CONTAINS-cycle check for a non-CONTAINS replacement, even when the new target genuinely has an unrelated CONTAINS path back to `from`", () => {
    // A hand-built graph (bypassing insertEdge's own CONTAINS-attachment check, which is not what this test targets) where "b" already CONTAINS-reaches "a": a -[CONTAINS]-> b -[CONTAINS]-> a is a genuine, pre-existing cycle in the raw edge data. replaceEdge's own STYLED_BY replacement below repoints a to "b", which (were the CONTAINS-cycle check to wrongly run for a non-CONTAINS kind) would be refused since "b" already reaches "a" — but a STYLED_BY replacement has nothing to do with CONTAINS reachability at all, and must succeed.
    const graph: PropertyGraph = {
      nodes: [
        { id: "a", kind: "t" },
        { id: "b", kind: "t" },
        { id: "c", kind: "t" },
      ],
      edges: [
        { from: "a", to: "b", kind: "CONTAINS", orderKey: "k0" },
        { from: "b", to: "a", kind: "CONTAINS", orderKey: "k0" },
        { from: "a", to: "c", kind: "STYLED_BY", orderKey: "k0" },
      ],
    };
    const replaced = replaceEdge(graph, "a", "c", "b", { kind: "STYLED_BY" });
    expect(
      replaced.edges.filter(
        (edge) => edge.from === "a" && edge.kind === "STYLED_BY",
      ),
    ).toEqual([{ from: "a", to: "b", kind: "STYLED_BY", orderKey: "k0" }]);
  });
});
