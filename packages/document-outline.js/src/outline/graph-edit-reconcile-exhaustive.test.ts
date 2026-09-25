import { describe, expect, it } from "vitest";
import { type PropertyGraph, contentHashV1 } from "./graph";
import { insertEdge, insertNode } from "./graph-edit";

// Exhaustive correctness proof for reconcileChildren (#935 round 10): every requested `children` sequence over a pool of 2 or 3 distinct ids, up to a bounded length, crossed with every GENUINE SUBSEQUENCE of that exact sequence as the pre-wired existing edge state — not merely the "first K occurrences of each id, independently" shape round 9's own generator was limited to. A genuine subsequence is built by choosing an arbitrary SUBSET of the request's own positions (in ascending order) and pre-wiring exactly those, in that order, as literal CONTAINS edges — covering every possible interleaving of which occurrences of which ids are already wired, including the interleaved shape round 9's classifier still mishandled: requested [A, B, A] with positions {1, 2} pre-wired gives existing edges [B, A], a genuine subsequence (drop the request's own first A) that round 9's per-id, front-to-back matcher paired incorrectly, because it matched each id's own occurrences against its own existing edges independently and never considered A's and B's existing edges relative to EACH OTHER.
//
// Choosing a subset of a sequence's own positions can never produce a relative ordering the source sequence itself does not exhibit, so every case this enumeration builds is, by construction, a genuine subsequence — the earlier round-9 suite's claim that an arbitrary subset "cannot be encoded" was true only of that round's own per-id matcher (which had no way to represent a pre-wiring that was not a prefix of each id's own occurrence count), not of the underlying data: an edge set recording exactly the wired positions above is a perfectly ordinary graph state, and the LCS-based classifier below reconciles it correctly. This enumeration therefore proves reconcileChildren's ORDER-CONSISTENT guarantee (exact reproduction, in order and multiplicity) exhaustively over the space it covers; the separate, genuinely order-INCONSISTENT case — existing edges wired in a relative order no subsequence of the request could produce at all — is not reachable this way and is covered by its own dedicated test below instead, which checks only the narrower no-inflation guarantee that case actually promises.
//
// Two pool sizes are run: 2 distinct ids up to length 6, and 3 distinct ids up to length 5 — a combined ~14,790-case enumeration (sum of 4^length for length 1..6, plus 6^length for length 1..5: poolSize^length sequences times 2^length position-subsets, at each length), preferred here over fast-check (not a dependency of this package) precisely because it is a genuine proof over that space rather than probabilistic sampling.
describe("write API: reconcileChildren reproduces every requested children list exhaustively, over every genuine-subsequence pre-wiring (#935 round 10)", () => {
  const EMPTY_GRAPH: PropertyGraph = { nodes: [], edges: [] };

  // Mints `count` distinct paragraph leaves up front, returning the graph carrying them plus their ids in mint order — the pool every generated `children` sequence indexes into.
  function mintLeafPool(count: number): {
    graph: PropertyGraph;
    pool: string[];
  } {
    let graph = EMPTY_GRAPH;
    const pool: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const minted = insertNode(graph, {
        kind: "paragraph",
        properties: {
          kind: "paragraph",
          runs: [{ text: `Leaf ${String(index)}.` }],
        },
      });
      graph = minted.graph;
      pool.push(minted.id);
    }
    return { graph, pool };
  }

  // Every sequence of the given length over a pool of `poolSize` distinct ids (as pool indices, not ids themselves): poolSize^length arrangements, covering every possible multiplicity and every relative order.
  function allSequences(length: number, poolSize: number): number[][] {
    if (length === 0) return [[]];
    const shorter = allSequences(length - 1, poolSize);
    const sequences: number[][] = [];
    for (const seq of shorter) {
      for (let label = 0; label < poolSize; label += 1) {
        sequences.push([...seq, label]);
      }
    }
    return sequences;
  }

  // Every subset of {0, ..., length - 1}, each returned ascending, via a bitmask enumeration — 2^length subsets, including the empty one (nothing pre-wired) and the full one (everything pre-wired).
  function allPositionSubsets(length: number): number[][] {
    const subsets: number[][] = [];
    for (let mask = 0; mask < 2 ** length; mask += 1) {
      const subset: number[] = [];
      for (let bit = 0; bit < length; bit += 1) {
        if ((mask & (1 << bit)) !== 0) subset.push(bit);
      }
      subsets.push(subset);
    }
    return subsets;
  }

  // Attaches exactly the requested positions named by `positions` (ascending) as literal CONTAINS edges from `id`, via plain sequential insertEdge appends — the resulting existing edges' mutual order is therefore exactly the same relative order those positions hold in `children`, which is what makes the pre-wiring a genuine subsequence rather than an arbitrary edge set.
  function preWirePositions(
    graph: PropertyGraph,
    id: string,
    children: readonly number[],
    pool: readonly string[],
    positions: readonly number[],
  ): PropertyGraph {
    return positions.reduce(
      (acc, position) => insertEdge(acc, id, pool[children[position]!]!),
      graph,
    );
  }

  function assertExactReconciliation(
    graph: PropertyGraph,
    id: string,
    children: readonly number[],
    pool: readonly string[],
    caseLabel: string,
  ): void {
    const contains = graph.edges
      .filter((edge) => edge.from === id && edge.kind === "CONTAINS")
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    try {
      expect(contains.map((edge) => edge.to)).toEqual(
        children.map((label) => pool[label]!),
      );
      expect(new Set(contains.map((edge) => edge.orderKey)).size).toBe(
        contains.length,
      );
    } catch (error) {
      throw new Error(`${caseLabel}: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  // Runs both the fresh-mint and dedup-hit reconciliation branches over every (sequence, genuine-subsequence pre-wiring) pair for a given pool size, up to `maxLength`.
  function runExhaustive(poolSize: number, maxLength: number): void {
    const { graph: baseGraph, pool } = mintLeafPool(poolSize);
    let casesRun = 0;
    for (let length = 1; length <= maxLength; length += 1) {
      for (const children of allSequences(length, poolSize)) {
        for (const preWired of allPositionSubsets(length)) {
          const caseLabel = `pool=${String(poolSize)} children=[${children.join(",")}] preWired=[${preWired.join(",")}]`;

          // Fresh-mint branch: children named explicitly, id computed with children folded into the hash, no prior CONTAINS edges of its own — pre-wiring attaches dangling edges onto that not-yet-minted id first.
          const sectionId = contentHashV1({
            kind: "section",
            children: children.map((label) => pool[label]!),
          });
          const wiredFresh = preWirePositions(
            baseGraph,
            sectionId,
            children,
            pool,
            preWired,
          );
          const freshMint = insertNode(wiredFresh, {
            kind: "section",
            properties: { kind: "section" },
            children: children.map((label) => pool[label]!),
          });
          expect(freshMint.id).toBe(sectionId);
          assertExactReconciliation(
            freshMint.graph,
            sectionId,
            children,
            pool,
            `fresh-mint ${caseLabel}`,
          );

          // Dedup-hit branch: children folded directly into `properties` at first mint (no `children` parameter, so no CONTAINS edges at all), pre-wiring attaches onto that already-minted id, then a second call names `children` explicitly and must reconcile against the pre-wired state.
          const foldedSpelling = insertNode(baseGraph, {
            kind: "section",
            properties: {
              kind: "section",
              children: children.map((label) => pool[label]!),
            },
          });
          const wiredDedup = preWirePositions(
            foldedSpelling.graph,
            foldedSpelling.id,
            children,
            pool,
            preWired,
          );
          const dedupHit = insertNode(wiredDedup, {
            kind: "section",
            properties: { kind: "section" },
            children: children.map((label) => pool[label]!),
          });
          expect(dedupHit.id).toBe(foldedSpelling.id);
          assertExactReconciliation(
            dedupHit.graph,
            foldedSpelling.id,
            children,
            pool,
            `dedup-hit ${caseLabel}`,
          );

          casesRun += 1;
        }
      }
    }
    // A sanity check on the enumeration itself: every (sequence, subset) pair must actually have run, exactly once each — sum over length 1..maxLength of poolSize^length * 2^length.
    const expectedCases = Array.from({ length: maxLength }, (_, i) => i + 1)
      .map((length) => poolSize ** length * 2 ** length)
      .reduce((total, count) => total + count, 0);
    expect(casesRun).toBe(expectedCases);
  }

  it("2-id pool, sequences up to length 6, every genuine-subsequence pre-wiring", () => {
    const maxLength = 6;
    runExhaustive(2, maxLength);
  });

  it("3-id pool, sequences up to length 5, every genuine-subsequence pre-wiring", () => {
    const poolSize = 3;
    const maxLength = 5;
    runExhaustive(poolSize, maxLength);
  });

  it("order-inconsistent pre-wiring never inflates multiplicity beyond max(existingCount, requestedCount) (#935 round 9's edge case)", () => {
    const { graph: baseGraph, pool } = mintLeafPool(2);
    const [a, b] = pool as [string, string];
    const sectionId = contentHashV1({ kind: "section", children: [a, b] });

    // Wire B then A — the reverse of the request's own order, and not constructible as any subsequence of [A, B] (a subsequence can never reverse its source's relative order), so this is the genuinely order-inconsistent shape no amount of insertion alone can reconcile into the requested order.
    const wired = insertEdge(insertEdge(baseGraph, sectionId, b), sectionId, a);

    const reconciled = insertNode(wired, {
      kind: "section",
      properties: { kind: "section" },
      children: [a, b],
    });
    expect(reconciled.id).toBe(sectionId);

    const contains = reconciled.graph.edges.filter(
      (edge) => edge.from === sectionId && edge.kind === "CONTAINS",
    );
    // No inflation: exactly one edge to each of A and B (max(existingCount, requestedCount) is 1 for both), never a third, freshly-minted edge for either — a naive LCS-only match (with no anti-inflation pass) would leave one of the two existing edges unmatched and mint a fresh duplicate here.
    expect(contains).toHaveLength(2);
    expect(contains.filter((edge) => edge.to === a)).toHaveLength(1);
    expect(contains.filter((edge) => edge.to === b)).toHaveLength(1);

    // A second pre-wiring, against a distinct id, for the anti-inflation pass's own multi-occurrence branch: two existing edges to the SAME id (A) rather than one each to two different ids, with A not requested at all. The LCS pass matches nothing (children holds only B), so both A edges land in the anti-inflation pass's unmatched-by-target bucket for A — the first populates the bucket, the second appends to it, which is the branch the case above never reaches since every existing edge there has a distinct target of its own.
    const bOnlyId = contentHashV1({ kind: "section", children: [b] });
    const bOnlyWired = insertEdge(
      insertEdge(baseGraph, bOnlyId, a),
      bOnlyId,
      a,
    );

    const bOnlyReconciled = insertNode(bOnlyWired, {
      kind: "section",
      properties: { kind: "section" },
      children: [b],
    });
    expect(bOnlyReconciled.id).toBe(bOnlyId);

    const bOnlyContains = bOnlyReconciled.graph.edges.filter(
      (edge) => edge.from === bOnlyId && edge.kind === "CONTAINS",
    );
    // A's two pre-wired, unmatched edges are left exactly as they were (multiplicity stays 2, neither dropped nor duplicated), and B — requested but never pre-wired — is inserted fresh at multiplicity 1.
    const expectedBOnlyContainsCount = 3;
    expect(bOnlyContains).toHaveLength(expectedBOnlyContainsCount);
    expect(bOnlyContains.filter((edge) => edge.to === a)).toHaveLength(2);
    expect(bOnlyContains.filter((edge) => edge.to === b)).toHaveLength(1);
  });

  // An independent reference model of the exact algorithm reconcileChildren's own doc comment describes (LCS classification, then the anti-inflation multiplicity pass, then anchor-relative insertion), written from that prose rather than copied from graph.ts's own implementation, so it fails to agree with graph.ts whenever graph.ts's own dp/backtrack/anti-inflation/anchor arithmetic diverges from the documented algorithm — including every off-by-one in the dp table's own bounds, the matchedIndex/matchedByOriginal array sizes, the backtrack's tie-break direction, and the anti-inflation pass's own bookkeeping. Genuinely distinct from the "every genuine-subsequence pre-wiring" exhaustive sweep above: that sweep only ever pre-wires SELECTED positions of `children` itself (by construction always a genuine subsequence of the request), a shape under which the module's own stronger guarantee (reconciliation reproduces `children` exactly) makes many internal wrong-choice bugs unobservable — any valid maximum-length assignment reconstructs the identical final order, so a backtrack tie-break bug or a dp off-by-one that still finds SOME maximum assignment slips through undetected. Order-INCONSISTENT existing wiring (arbitrary sequences the request cannot embed as a subsequence) carries no such masking guarantee, which is exactly where a wrong dp value or a wrong tie-break produces a genuinely different, independently-checkable final order.
  function reconcileOracle(
    existingSeq: readonly string[],
    children: readonly string[],
  ): string[] {
    const dp: number[][] = Array.from({ length: existingSeq.length + 1 }, () =>
      new Array<number>(children.length + 1).fill(0),
    );
    for (let i = existingSeq.length - 1; i >= 0; i -= 1) {
      for (let j = children.length - 1; j >= 0; j -= 1) {
        dp[i]![j] =
          existingSeq[i] === children[j]
            ? dp[i + 1]![j + 1]! + 1
            : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
    const matchedIndex = new Array<number | undefined>(children.length).fill(
      undefined,
    );
    const matchedByOriginal = new Array<number | undefined>(
      existingSeq.length,
    ).fill(undefined);
    let i = 0;
    let j = 0;
    while (i < existingSeq.length && j < children.length) {
      if (existingSeq[i] === children[j]) {
        matchedIndex[j] = i;
        matchedByOriginal[i] = j;
        i += 1;
        j += 1;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        i += 1;
      } else {
        j += 1;
      }
    }
    const unmatchedExistingByTarget = new Map<string, number[]>();
    existingSeq.forEach((value, index) => {
      if (matchedByOriginal[index] !== undefined) return;
      const bucket = unmatchedExistingByTarget.get(value);
      if (bucket === undefined) unmatchedExistingByTarget.set(value, [index]);
      else bucket.push(index);
    });
    const leftoverPointer = new Map<string, number>();
    children.forEach((value, position) => {
      if (matchedIndex[position] !== undefined) return;
      const leftovers = unmatchedExistingByTarget.get(value);
      if (leftovers === undefined) return;
      const pointer = leftoverPointer.get(value) ?? 0;
      if (pointer >= leftovers.length) return;
      matchedIndex[position] = leftovers[pointer]!;
      leftoverPointer.set(value, pointer + 1);
    });
    const anchorFor = (position: number): number => {
      for (let later = position + 1; later < children.length; later += 1) {
        const candidate = matchedIndex[later];
        if (candidate !== undefined) return candidate;
      }
      return existingSeq.length;
    };
    const insertedAtOrBefore: number[] = [];
    let current: string[] = [...existingSeq];
    for (let position = 0; position < children.length; position += 1) {
      if (matchedIndex[position] !== undefined) continue;
      const anchorIndex = anchorFor(position);
      const insertIndex =
        anchorIndex +
        insertedAtOrBefore.filter((inserted) => inserted <= anchorIndex).length;
      insertedAtOrBefore.push(anchorIndex);
      current = [
        ...current.slice(0, insertIndex),
        children[position]!,
        ...current.slice(insertIndex),
      ];
    }
    return current;
  }

  // Every sequence over a 3-label pool up to the given length — deliberately including sequences no `children` value could ever "pre-wire" as a genuine subsequence, unlike the exhaustive sweep above.
  function allLabelSequences(maxLength: number): string[][] {
    const alphabet = ["a", "b", "c"];
    const sequences: string[][] = [[]];
    for (let length = 1; length <= maxLength; length += 1) {
      for (const seq of allLabelSequences(length - 1)) {
        for (const label of alphabet) sequences.push([...seq, label]);
      }
    }
    return sequences;
  }

  it("agrees with an independently-modelled reference algorithm across arbitrary (not just genuinely-subsequence) existing wirings, over every combination of a 3-label pool", () => {
    const poolSize = 3;
    const { graph: baseGraph, pool } = mintLeafPool(poolSize);
    const byLabel = { a: pool[0]!, b: pool[1]!, c: pool[2]! };
    // Length 4, not poolSize: the anti-inflation pass's own multi-occurrence reuse (a bucket holding MORE than one leftover index for the same id, and a pointer advancing past its first entry to a second) can only ever matter to the final output when existing carries at least two UNMATCHED occurrences of the same id that children also asks for again — and forcing even one existing occurrence of a repeated id to go unmatched by direct LCS already needs a THIRD, differently-labelled element interspersed to break the trivial full match a homogeneous run would otherwise get for free (see this suite's own comment on the exhaustive-subsequence sweep above about full-length matches masking wrong-choice bugs). Two such occurrences plus one interleaved break needs four existing slots (e.g. [a,a,x,a]), one more than a length-3 wiring can ever hold — confirmed directly: a bucket.push/leftover-pointer-advance mutation on this pass survived the length-3 sweep untouched, killed only once existingSeqs reached length 4.
    const existingChildrenLength = 4; // every arbitrary existing wiring up to this length, subsequence or not
    const existingSeqs = allLabelSequences(existingChildrenLength);
    const childrenSeqs = allLabelSequences(existingChildrenLength).filter(
      (seq) => seq.length > 0,
    );
    let casesRun = 0;
    for (const existingSeq of existingSeqs) {
      for (const children of childrenSeqs) {
        const sectionId = contentHashV1({
          kind: "section",
          children: children.map((label) => byLabel[label as "a"]),
        });
        const wired = existingSeq.reduce(
          (acc, label) => insertEdge(acc, sectionId, byLabel[label as "a"]),
          baseGraph,
        );
        const reconciled = insertNode(wired, {
          kind: "section",
          properties: { kind: "section" },
          children: children.map((label) => byLabel[label as "a"]),
        });
        const actual = reconciled.graph.edges
          .filter((edge) => edge.from === sectionId && edge.kind === "CONTAINS")
          .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1))
          .map((edge) => edge.to);
        const expected = reconcileOracle(
          existingSeq.map((label) => byLabel[label as "a"]),
          children.map((label) => byLabel[label as "a"]),
        );
        expect(
          actual,
          `existing=[${existingSeq.join(",")}] children=[${children.join(",")}]`,
        ).toEqual(expected);
        casesRun += 1;
      }
    }
    expect(casesRun).toBe(existingSeqs.length * childrenSeqs.length);
  });
});
