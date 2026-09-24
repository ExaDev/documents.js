import { describe, expect, it } from "vitest";
import {
  type PropertyGraph,
  contentHashV1,
  orderKeyAscComparator,
  orderKeys,
} from "./graph";
import {
  ContainsCycleError,
  NodeKindMismatchError,
  insertEdge,
  insertNode,
} from "./graph-edit";

describe("write API: insertNode's fresh-mint children-wiring reconciles pre-existing dangling CONTAINS edges (#935)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("reconciles against pre-existing dangling edges by their own sorted orderKey, not by the edges array's own creation order", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const leafC = insertNode(leafB.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "C." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafB.id, leafC.id],
    });
    // Attached in an order that scrambles the edges ARRAY relative to sorted orderKey: C first (appended, gets the widest/earliest key), then A at the very start, then B spliced between A and C — so the array's own creation order is [C, A, B] even though the orderKeys sort as A, B, C.
    const withC = insertEdge(leafC.graph, sectionId, leafC.id);
    const withA = insertEdge(withC, sectionId, leafA.id, {
      position: { at: "start" },
    });
    const withDangling = insertEdge(withA, sectionId, leafB.id, {
      position: { at: "before", siblingId: leafC.id },
    });

    const result = insertNode(withDangling, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id, leafC.id],
    });
    // A correct sorted read recognises every requested child as already wired in the requested order and inserts nothing new; a broken sort could fail to match the existing subsequence and mint spurious duplicate edges instead.
    const contains = result.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    expect(contains).toHaveLength(3);
    // Genuinely exercises byOrderKeyAsc, not just "no duplicates": reading originalSiblings by CREATION order (unsorted) would see [C, A, B], which is NOT a subsequence of the requested [A, B, C] (C can never precede A in a subsequence of [A,B,C]) — so a broken sort would fail to match at least one requested position against its existing edge and mint a spurious extra one, changing this exact final order.
    expect(
      contains
        .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
        .map((edge) => edge.to),
    ).toEqual([leafA.id, leafB.id, leafC.id]);
  });

  it("insertNode does not duplicate a CONTAINS edge that insertEdge already attached onto this id before it had a node", () => {
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
    // leafA is wired under the section before the section has a node of its own — the exact "edge exists before its node" shape insertEdge tolerates by design.
    const withDanglingEdge = insertEdge(leafB.graph, sectionId, leafA.id);
    expect(
      withDanglingEdge.edges.filter(
        (edge) => edge.from === sectionId && edge.to === leafA.id,
      ),
    ).toHaveLength(1);

    const section = insertNode(withDanglingEdge, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id],
    });
    expect(section.id).toBe(sectionId);

    const contains = section.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    // Exactly one edge per child — the fresh-mint wiring must not have minted a second, byte-identical copy of the edge insertEdge already attached to leafA.
    expect(contains).toHaveLength(2);
    expect(contains.filter((edge) => edge.to === leafA.id)).toHaveLength(1);
    expect(contains.filter((edge) => edge.to === leafB.id)).toHaveLength(1);
    // Document order still matches the requested children order.
    const ordered = [...contains]
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([leafA.id, leafB.id]);
  });

  it("insertNode does not tie a freshly minted child's orderKey against a pre-existing dangling CONTAINS edge to a different child sitting at that same index-derived key", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const leafC = insertNode(leafB.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "C." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafB.id, leafC.id],
    });
    // leafC is wired under the not-yet-minted section first, so it lands at orderKeyForIndex(0) — the same floor key a bare index-keyed fresh mint would hand its own first requested child (leafA) without consulting this edge at all.
    const withDanglingEdge = insertEdge(leafC.graph, sectionId, leafC.id);
    const danglingEdge = withDanglingEdge.edges.find(
      (edge) => edge.from === sectionId,
    )!;
    expect(danglingEdge.orderKey).toBe(orderKeys.orderKeyForIndex(0));

    const section = insertNode(withDanglingEdge, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id, leafC.id],
    });

    const contains = section.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    expect(contains).toHaveLength(3);
    const orderKeysUsed = contains.map((edge) => edge.orderKey);
    // No two siblings share an orderKey — the degenerate shape boundedOrderKey/siblingInsertIndex refuse everywhere else in this module.
    expect(new Set(orderKeysUsed).size).toBe(orderKeysUsed.length);
    // Requested document order is preserved once the tie is resolved.
    const ordered = [...contains]
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([leafA.id, leafB.id, leafC.id]);
  });

  it("insertNode's fresh-mint reconciliation preserves a repeated child id's own multiplicity and position, not just its first occurrence", () => {
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
      children: [leafA.id, leafB.id, leafA.id],
    });
    // Wire only ONE occurrence of leafA — the REPEATED id — directly, before the section has a node of its own; leafB has no existing edge at all. A plain existingChildren Set (membership only, no count) sees leafA present and treats BOTH of its requested occurrences as already satisfied, silently dropping the second one; a multiplicity-aware reconciliation must recognise that only the first occurrence is actually wired and the second is still missing.
    const withDanglingEdge = insertEdge(leafB.graph, sectionId, leafA.id);

    const section = insertNode(withDanglingEdge, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id, leafA.id],
    });
    expect(section.id).toBe(sectionId);

    const contains = section.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    // Three edges total — both requested occurrences of leafA survive, not just the one that was already wired.
    expect(contains).toHaveLength(3);
    expect(contains.filter((edge) => edge.to === leafA.id)).toHaveLength(2);
    expect(contains.filter((edge) => edge.to === leafB.id)).toHaveLength(1);
    const ordered = [...contains]
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([leafA.id, leafB.id, leafA.id]);
  });

  it("insertNode's fresh-mint reconciliation anchors a missing child to the SPECIFIC pre-wired occurrence of a repeated sibling id, not to whichever occurrence of that id sorts earliest", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafX = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "X." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafX.id, leafA.id],
    });
    // Wire BOTH occurrences of the repeated id (leafA) directly, in requested order, before the section has a node of its own. leafX — the one genuinely missing child — must anchor to the SECOND of these two leafA edges specifically: anchoring by the bare value "leafA" instead resolves (via insertEdge's own before/after lookup) to whichever leafA edge sorts earliest, landing leafX before the FIRST leafA rather than between the two.
    const firstA = insertEdge(leafX.graph, sectionId, leafA.id);
    const secondA = insertEdge(firstA, sectionId, leafA.id);

    const section = insertNode(secondA, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafX.id, leafA.id],
    });
    expect(section.id).toBe(sectionId);

    const ordered = section.graph.edges
      .filter((edge) => edge.from === sectionId && edge.kind === "CONTAINS")
      .sort((p, q) => (p.orderKey < q.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    // The exact requested order is reproduced: leafX lands between the two leafA occurrences, not before the first (or after the second).
    expect(ordered).toEqual([leafA.id, leafX.id, leafA.id]);
  });

  it("a fresh mint with no pre-existing CONTAINS edges at all still mints the wide, evenly spaced orderKeyForIndex(index) keys directly, without paying for reconciliation", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const leafB = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });
    const section = insertNode(leafB.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id],
    });
    const contains = section.graph.edges.filter(
      (edge) => edge.from === section.id && edge.kind === "CONTAINS",
    );
    expect(contains).toEqual([
      {
        from: section.id,
        to: leafA.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(0),
      },
      {
        from: section.id,
        to: leafB.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(1),
      },
    ]);
  });

  it("reconciliation counts only this id's own CONTAINS edges as pre-existing siblings, never a differently-kinded or differently-owned edge that happens to sit in the same graph", () => {
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
    // Three decoys, each satisfying exactly one clause of the (from === id && kind === "CONTAINS") filter and not the other: a STYLED_BY edge FROM this id (right owner, wrong kind), a CONTAINS edge from a wholly unrelated id TO leafA (wrong owner, right kind, right target), and a CONTAINS edge from this id's own dangling attachment reused for a genuinely different (unrequested) child. A filter with either clause dropped, or swapped to `||`, would miscount `originalSiblings`/`currentSiblings` against these decoys.
    const withDecoys = insertEdge(
      insertEdge(
        insertEdge(leafB.graph, sectionId, leafA.id, { kind: "STYLED_BY" }),
        "unrelated-id",
        leafA.id,
      ),
      sectionId,
      leafA.id,
    );
    const reconciled = insertNode(withDecoys, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafB.id],
    });
    expect(reconciled.id).toBe(sectionId);
    const contains = reconciled.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    // Exactly one edge to A (the genuine pre-wired CONTAINS decoy is reused, not duplicated) and one freshly inserted to B — the STYLED_BY and unrelated-id decoys must never have been treated as part of this id's own CONTAINS sibling set.
    expect(contains).toHaveLength(2);
    expect(contains.filter((edge) => edge.to === leafA.id)).toHaveLength(1);
    expect(contains.filter((edge) => edge.to === leafB.id)).toHaveLength(1);
  });

  it("reconciliation refuses a CONTAINS cycle when an unmatched child would close one, exactly as insertEdge's own attachment does", () => {
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const loopNode = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Loop." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, loopNode.id],
    });
    // Pre-wire the section's genuine first child (A), so hasPriorContainsEdges is true and insertNode's fresh mint routes through reconcileChildren rather than its own plain forEach loop — reconcileChildren's OWN assertNoContainsCycle call (for a child position the LCS pass left unmatched, requiring a fresh insertion) is what this test targets, not insertNode's separate check for the no-prior-edges case (already covered elsewhere).
    const withA = insertEdge(loopNode.graph, sectionId, leafA.id);
    // loopNode already dangles a CONTAINS edge back at the not-yet-existing sectionId: attaching sectionId's own second, genuinely unmatched child (loopNode) would close that cycle.
    const cyclic = insertEdge(withA, loopNode.id, sectionId);
    expect(() =>
      insertNode(cyclic, {
        kind: "section",
        properties: { kind: "section" },
        children: [leafA.id, loopNode.id],
      }),
    ).toThrow(ContainsCycleError);
  });
});

describe("write API: insertNode handles a dedup hit's kind and children correctly (#935)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("insertNode throws NodeKindMismatchError when two different requested kinds hash to the identical id, rather than silently handing back the first call's kind", () => {
    const first = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { text: "Same content." },
    });
    let caught: unknown;
    try {
      insertNode(first.graph, {
        kind: "heading",
        properties: { text: "Same content." },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NodeKindMismatchError);
    const mismatch = caught as NodeKindMismatchError;
    expect(mismatch.id).toBe(first.id);
    expect(mismatch.existingKind).toBe("paragraph");
    expect(mismatch.requestedKind).toBe("heading");
    // Confirms the collision is genuine: `kind` never enters hashInput, so both calls really do compute the identical id.
    expect(contentHashV1({ text: "Same content." })).toBe(first.id);
  });

  it("insertNode succeeds as a plain no-op dedup when the SAME kind is re-requested for an id already in the graph", () => {
    const first = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { text: "Same content." },
    });
    const second = insertNode(first.graph, {
      kind: "paragraph",
      properties: { text: "Same content." },
    });
    expect(second.id).toBe(first.id);
    expect(second.graph).toEqual(first.graph);
  });

  it("insertNode reconciles a dedup hit's requested children rather than silently dropping them when an earlier call minted the identical id via a different spelling", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });

    // First spelling: "children" folded directly into properties as ordinary data, with no top-level `children` parameter at all — mints the node with NO CONTAINS edges, since insertNode only ever emits them from the explicit parameter.
    const foldedSpelling = insertNode(b.graph, {
      kind: "section",
      properties: { kind: "section", children: [a.id, b.id] },
    });
    expect(
      foldedSpelling.graph.edges.filter(
        (edge) => edge.from === foldedSpelling.id && edge.kind === "CONTAINS",
      ),
    ).toEqual([]);

    // Second spelling of the IDENTICAL content: `children` given as the explicit top-level parameter this time — hashInput folds `properties` + `children` into the same shape either spelling arrives at, so this is a genuine dedup hit against the node the first spelling already minted.
    const explicitSpelling = insertNode(foldedSpelling.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [a.id, b.id],
    });
    expect(explicitSpelling.id).toBe(foldedSpelling.id);

    // The requested CONTAINS edges must be present now — not silently dropped just because the id already existed under the no-edges spelling.
    const childEdges = explicitSpelling.graph.edges
      .filter(
        (edge) => edge.from === explicitSpelling.id && edge.kind === "CONTAINS",
      )
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(childEdges.map((edge) => edge.to)).toEqual([a.id, b.id]);
  });

  it("insertNode's dedup reconciliation inserts each missing child at its OWN requested position relative to already-present siblings, rather than always appending missing ones at the end — so the reconciled CONTAINS order agrees with the order the node's own content-hash was minted from", () => {
    const x = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "X." }] },
    });
    const a = insertNode(x.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const y = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Y." }] },
    });

    // Folded spelling mints the section with NO CONTAINS edges (established behaviour above); the requested order is [x, a, y].
    const foldedSpelling = insertNode(y.graph, {
      kind: "section",
      properties: { kind: "section", children: [x.id, a.id, y.id] },
    });

    // Wire only the MIDDLE child directly, as if some earlier caller had partially populated this id's containment before the full reconciling call arrives.
    const partiallyWired = insertEdge(
      foldedSpelling.graph,
      foldedSpelling.id,
      a.id,
    );

    // Explicit spelling of the IDENTICAL content — a genuine dedup hit — requesting the full [x, a, y] order. x and y are both missing; a naive "append missing at the end" would produce [a, x, y], disagreeing with the order the id was actually minted from.
    const explicitSpelling = insertNode(partiallyWired, {
      kind: "section",
      properties: { kind: "section" },
      children: [x.id, a.id, y.id],
    });
    expect(explicitSpelling.id).toBe(foldedSpelling.id);

    const ordered = explicitSpelling.graph.edges
      .filter(
        (edge) => edge.from === explicitSpelling.id && edge.kind === "CONTAINS",
      )
      .sort((p, q) => (p.orderKey < q.orderKey ? -1 : 1))
      .map((edge) => edge.to);
    expect(ordered).toEqual([x.id, a.id, y.id]);
  });

  it("insertNode's dedup reconciliation preserves a repeated child id's own multiplicity and position, not just its first occurrence", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const b = insertNode(a.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "B." }] },
    });

    // Folded spelling mints the section with NO CONTAINS edges (established behaviour above), requesting [a, b, a] — a repeated id, the same shape projectDocumentGraph and insertEdge already support elsewhere in this file.
    const foldedSpelling = insertNode(b.graph, {
      kind: "section",
      properties: { kind: "section", children: [a.id, b.id, a.id] },
    });

    // Wire only ONE occurrence of a — the REPEATED id — directly, as if an earlier caller had partially populated this id's containment before the full reconciling call arrives; b has no existing edge at all. A plain existingChildren Set (membership only, no count) sees a present and treats BOTH requested occurrences as satisfied, silently dropping the second; a multiplicity-aware reconciliation must recognise only the first occurrence is wired and the second is still missing.
    const partiallyWired = insertEdge(
      foldedSpelling.graph,
      foldedSpelling.id,
      a.id,
    );

    const explicitSpelling = insertNode(partiallyWired, {
      kind: "section",
      properties: { kind: "section" },
      children: [a.id, b.id, a.id],
    });
    expect(explicitSpelling.id).toBe(foldedSpelling.id);

    const ordered = explicitSpelling.graph.edges
      .filter(
        (edge) => edge.from === explicitSpelling.id && edge.kind === "CONTAINS",
      )
      .sort((p, q) => (p.orderKey < q.orderKey ? -1 : 1));
    // Three edges total — both requested occurrences of a survive, not just one.
    expect(ordered).toHaveLength(3);
    expect(ordered.filter((edge) => edge.to === a.id)).toHaveLength(2);
    expect(ordered.map((edge) => edge.to)).toEqual([a.id, b.id, a.id]);
  });

  it("insertNode's dedup reconciliation is idempotent: requesting the same children twice adds no duplicate edges", () => {
    const a = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const first = insertNode(a.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [a.id],
    });
    const second = insertNode(first.graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [a.id],
    });
    expect(second.id).toBe(first.id);
    expect(second.graph).toEqual(first.graph);
  });
});

describe("reconcileChildren's originalSiblings: sorted and filtered, not raw creation order", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  it("reads pre-existing CONTAINS edges by their own sorted orderKey, not by the edges array's own literal order", () => {
    // A pure reordering with no duplicated id (existingSeq a permutation of children, one occurrence each) can never expose an unsorted read on its own: the anti-inflation pass pairs every unmatched existing edge against an unmatched requested occurrence of the identical id regardless of which specific index either side carries, so a scrambled-but-balanced originalSiblings still ends with every position "matched" (no edge minted, no edge moved) whether or not it was sorted first — reconcileChildren never rewrites an existing edge's own orderKey, so the OUTPUT graph is then bit-for-bit identical either way. Genuinely exposing the sort needs a requested id with NO existing edge at all, so a real insertion happens, anchored against whichever position the (correctly or incorrectly ordered) LCS match assigns it next to.
    const leafX = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "X." }] },
    });
    const leafY = insertNode(leafX.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Y." }] },
    });
    const leafNew = insertNode(leafY.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "New." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafX.id, leafNew.id, leafY.id],
    });
    const x = {
      from: sectionId,
      to: leafX.id,
      kind: "CONTAINS" as const,
      orderKey: orderKeys.orderKeyForIndex(0),
    };
    const y = {
      from: sectionId,
      to: leafY.id,
      kind: "CONTAINS" as const,
      orderKey: orderKeys.orderKeyForIndex(1),
    };
    // Deliberately out of orderKey order in the edges ARRAY itself (y, x): reading originalSiblings by array order sees existingSeq = [Y, X] against requested [X, New, Y]. The LCS match over that UNSORTED sequence pairs requested X with existing index 1 and requested Y with existing index 0 (the only assignment an unsorted read can find), anchoring the missing New occurrence to index 0 — inserting it BEFORE the sorted set's own first sibling. A correctly-sorted read (existingSeq = [X, Y]) instead anchors New to the sorted set's actual second position, inserting it strictly BETWEEN X and Y.
    const graph: PropertyGraph = { nodes: leafNew.graph.nodes, edges: [y, x] };
    const result = insertNode(graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafX.id, leafNew.id, leafY.id],
    });
    const contains = result.graph.edges
      .filter((edge) => edge.from === sectionId && edge.kind === "CONTAINS")
      .sort(orderKeyAscComparator)
      .map((edge) => edge.to);
    expect(contains).toEqual([leafX.id, leafNew.id, leafY.id]);
  });

  it("ignores a decoy edge sharing the owner id or the CONTAINS kind but not both", () => {
    // Requests leafA TWICE: with only one genuine existing edge, reconciliation must insert a fresh second CONTAINS edge for the missing occurrence — UNLESS a decoy is wrongly counted as one of sectionId's own existing siblings, in which case it would falsely look like the second occurrence is already wired and no new edge would be inserted. A single-occurrence request can't expose this: reconciliation never deletes an existing edge just because originalSiblings over-counted it, so a decoy wrongly included alongside one real match produces the identical final edge count as a decoy correctly excluded.
    const leafA = insertNode(EMPTY_GRAPH, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "A." }] },
    });
    const other = insertNode(leafA.graph, {
      kind: "paragraph",
      properties: { kind: "paragraph", runs: [{ text: "Other." }] },
    });
    const sectionId = contentHashV1({
      kind: "section",
      children: [leafA.id, leafA.id],
    });
    const genuine = {
      from: sectionId,
      to: leafA.id,
      kind: "CONTAINS" as const,
      orderKey: orderKeys.orderKeyForIndex(0),
    };
    // A decoy from a DIFFERENT owner, still CONTAINS, also targeting leafA — must never be read as one of sectionId's own existing siblings.
    const decoyFrom = {
      from: other.id,
      to: leafA.id,
      kind: "CONTAINS" as const,
      orderKey: orderKeys.orderKeyForIndex(0),
    };
    // A decoy from sectionId, but a different kind, also targeting leafA — must never be read as a CONTAINS sibling.
    const decoyKind = {
      from: sectionId,
      to: leafA.id,
      kind: "STYLED_BY" as const,
      orderKey: orderKeys.orderKeyForIndex(0),
    };
    const graph: PropertyGraph = {
      nodes: other.graph.nodes,
      edges: [genuine, decoyFrom, decoyKind],
    };
    const result = insertNode(graph, {
      kind: "section",
      properties: { kind: "section" },
      children: [leafA.id, leafA.id],
    });
    const contains = result.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    // The genuine edge plus one freshly inserted edge for the second requested occurrence — if either decoy were wrongly counted as an existing sectionId/CONTAINS sibling, it would falsely satisfy the second occurrence and this length would drop to 1.
    expect(contains).toHaveLength(2);
  });
});
