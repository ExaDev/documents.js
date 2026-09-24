import {
  contentHashV1,
  edgeKey,
  orderKeyAscComparator,
  orderKeys,
  type GraphEdge,
  type GraphEdgeKind,
  type GraphNode,
  type PropertyGraph,
  type PropertyPath,
} from "./graph";
import { OrderKeyBudgetExhaustedError } from "./order-keys";

// The write side of this projection (ExaDev/documents.js#935): projectDocumentGraph only ever reads a whole DocumentTree, so a caller building an interactive editor on top of its output had no way to mint a new content node or attach one into an existing graph. `insertNode` mints a node; `insertEdge` attaches an already-minted node into a graph at a sibling position. Neither owns any tree, table, or extraction-policy state — there is no styles/definitions table to resolve a ref against once a caller is working at the graph level — so a node whose identity should fold in a dereferenced entry is built the same way the read side builds one: mint the entry's own node first, then mint the referencing node with the entry's id already substituted into `properties`, exactly as `walkRecord` substitutes an entry's id into `hash` before hashing the referencing node above.
//
// Mutating a node is not a separate operation: content-addressing already means "mutate" is "mint a new version" (this module's own top comment, EDITS), so a caller mutates by calling insertNode again with the changed content, getting back a new id, then insertEdge-ing that new id in wherever the old one was referenced. The old node and its edges are left exactly as they were — neither function ever removes or rewrites existing graph state — which is the free version history the top comment already promises orphans deliver.
//
// That recipe covers minting the new version and attaching it; detaching the old one is `replaceEdge`'s own job (ExaDev/documents.js#1004): insertEdge-ing the new id alone would add a second edge from the same parent alongside the old edge rather than removing or repointing it, so a caller wanting the new version to REPLACE the old one at that position — not sit beside it — calls `replaceEdge(graph, from, oldId, newId, { kind })` instead of a second `insertEdge`. `replaceEdge` reuses the replaced edge's own orderKey (and path) rather than mining a fresh position, so the new version lands in exactly the slot the old one held. Free version history for the ORPHANED node (nothing referencing the old id) is unaffected either way and remains exactly as described above; `replaceEdge` only ever changes the edge set, never `graph.nodes` — pruning an orphan it creates is deliberately out of scope, same as every other orphan this module leaves alone.
//
// Neither function recomputes an ANCESTOR's id when a new child is attached beneath it: a compound node's id was folded from whatever children list it was minted with (the Merkle-DAG rule projectGroup applies), and attaching one more CONTAINS edge to an already-minted node does not retroactively change that node's own id, exactly as adding a blob to a git tree does not change a tree object already written to the object store in place — git mints a new tree object instead, and a ref is what moves to point at it. A caller wanting an ancestor's id to reflect a new descendant re-mints that ancestor with insertNode (its own unchanged `properties` plus the updated `children` list) and re-wires whichever of ITS OWN referrers should see the new version, one level at a time, up to (never including) the document root — whose id is caller-assigned and content-independent for exactly this reason, so a root-level insertion needs no cascade at all: mint the new subtree, then insertEdge it under the root id directly.
//
// insertNode's own children-wiring is NOT exempt from the CONTAINS-cycle check just because it folds each child's id into the freshly-minted parent's own hash: that folding proves a fresh id was never equal to any id minted before it existed, which is not the same claim as "no edge anywhere in the graph already points at this id." insertEdge tolerates attaching an edge to a `to` that names no node yet (walkPropertyGraph's own tolerance of an edge naming an absent node is the read-side mirror of this), so a caller can `insertEdge` a forward edge onto an id it has computed but not yet minted, then `insertNode` that exact id with a `children` list that points back through that edge — closing a cycle no amount of hash-folding could have anticipated, because the id did not exist when the first edge was attached. insertNode therefore runs the identical edge-only cycle check insertEdge runs, once per child, before appending that child's CONTAINS edge (throwing ContainsCycleError just as insertEdge does), rather than trusting hash-folding alone to keep its own children-wiring acyclic.

// One new content node's input: `kind` is the graph vocabulary word for what the node is — this module's own mint sites decide it four different ways (a payload's own discriminant for a leaf/group, a fixed word for a table entry or an extracted value), so the write side asks for it explicitly rather than guessing a single recipe — `properties` is the node's own content, and `children`, when given, names the ids of already-minted nodes this node is to CONTAIN, in document order. `children` folds into the id's hash input exactly as projectGroup folds its own children's ids into `hashInput`, but never into the face: children live only as the CONTAINS edges insertNode also emits alongside the node, never as a node property, matching every group node projectDocumentGraph itself mints. Omitting `children` entirely (not an empty array) is what a leaf-shaped node needs: an empty array is itself content (a group that folds `children: []` into its hash, and is entitled to gain CONTAINS children later without changing that already-minted id being nonsensical for identity purposes), whereas omission means "this node's identity has never depended on a children list at all," exactly how projectLeaf's own hash input carries no `children` key.
export interface InsertNodeContent {
  readonly kind: string;
  readonly properties: Record<string, unknown>;
  readonly children?: readonly string[];
}

export interface InsertNodeResult {
  readonly graph: PropertyGraph;
  readonly id: string;
}

// Thrown by insertNode when the freshly computed id already names a node in `graph` whose `kind` does not match the one just requested — a genuine content-hash collision across two different kinds, possible precisely because `kind` is asked for explicitly rather than folded into the hash (see insertNode's own comment below for why that exclusion is correct, not a gap). Silently handing the caller back the EXISTING node's kind here would be indistinguishable from the two-different-contents-sharing-an-id failure mode insertNode's hash discipline otherwise guards against, so this is refused loudly instead of resolved by an arbitrary "first write wins" rule. A named class, in the OrderKeyBudgetExhaustedError/UnknownSiblingError family convention.
export class NodeKindMismatchError extends Error {
  readonly id: string;
  readonly existingKind: string;
  readonly requestedKind: string;

  constructor(id: string, existingKind: string, requestedKind: string) {
    super(
      `insertNode: id "${id}" already names a node of kind "${existingKind}", cannot also be kind "${requestedKind}"`,
    );
    this.name = "NodeKindMismatchError";
    this.id = id;
    this.existingKind = existingKind;
    this.requestedKind = requestedKind;
  }
}

// Reconciles a fresh mint's or a dedup hit's requested `children` against the graph's already-existing CONTAINS edges from `id`: two insertNode calls can mint the identical id via different spellings of the same content — `children` named explicitly vs. an equal-valued field folded directly into `properties` — and only the explicit-`children` spelling ever asks insertNode to emit CONTAINS edges, so the call that finally reconciles must not have its own requested containment silently dropped just because some of it already exists (a dedup hit's own prior spelling, or a dangling edge some earlier standalone insertEdge call already attached onto this not-yet-minted id). Both insertNode call sites share this one function precisely because "what's already wired" and "what's requested" is the identical reconciliation problem either way.
//
// Reconciliation is by MULTIPLICITY, not set membership: `children` can legitimately repeat an id — two identical CONTAINS children under one section is a shape this module's own projectDocumentGraph and insertEdge tests both exercise directly — so "is this id already wired" is never a single yes/no per id, it is "how many of this id are already wired, out of how many the Nth requested occurrence still needs." A plain Set of already-wired ids — this function's own first implementation — cannot represent "one occurrence of A is wired, a second is not": it treated every later occurrence of an already-seen id as satisfied too, silently dropping a repeated id's own extra occurrences.
//
// Classification and anchoring both work against SPECIFIC EXISTING EDGES, never a bare id value — the second, subtler defect the first multiplicity-aware rewrite still carried. `originalSiblings` is `id`'s existing CONTAINS edges sorted once, up front, into a fixed reference list this function never mutates or reorders again. A matched position records WHICH `originalSiblings` index it resolved to, not the id it matched: anchoring a missing occurrence against "the value X" is ambiguous the instant X repeats, because a before/after lookup by id (`siblingInsertIndex`, used by `insertEdge`'s public position API) always resolves ties in orderKey order to X's EARLIEST existing edge — the wrong occurrence whenever the intended anchor is a later one, e.g. requested `[A, X, A]` with both `A`s already wired: `X` must land between the two `A`s, but anchoring by the bare value "A" finds the FIRST `A` and inserts `X` before it instead, misplacing it at the front. Anchoring by a specific `originalSiblings` index rather than a value sidesteps this: there is only ever one edge a given index can mean.
//
// The classification pass itself (ExaDev/documents.js#935 round 10) is a longest-common-subsequence match between `originalSiblings`' own target sequence and the full requested `children` list, not a per-id front-to-back count: matching the Nth requested occurrence of an id to the Nth not-yet-claimed existing edge to that SAME id — independently per id, this function's own round-9 shape — ignores how that id's existing edges sit relative to every OTHER id's existing edges, and can misassign which requested position an existing edge satisfies whenever two ids' existing edges are interleaved in an order that is itself a genuine subsequence of the request (requested `[A, B, A]` against existing edges wired `[B, A]` — dropping the request's own first `A` from `[A, B, A]` does yield `[B, A]`, so this is a real, order-consistent pre-wiring, not a malformed one — yet the per-id matcher pairs request position 0's `A` with the SECOND existing `A`, an assignment no global reading of the two sequences together would produce). The LCS match instead considers both sequences at once: a maximum set of (existing index, requested position) pairs with existing indices increasing exactly where requested positions increase, computed by the standard dynamic-program over `originalSiblings.length + 1` by `children.length + 1` prefixes and read back into `matchedIndex` by a forward walk that takes a match the instant both sequences agree and otherwise advances whichever side the table says still carries the larger remaining match (ties broken toward advancing the existing side, so a requested position matches as early as an optimal assignment allows).
//
// An existing edge the LCS pass leaves unmatched is not necessarily genuinely extra: the request can still hold an unmatched occurrence of that SAME id, just not one reachable by any assignment that keeps both sequences' relative order intact throughout — originalSiblings wired in an order the request's own interleaving cannot embed at all, e.g. requested `[A, B]` against existing edges wired `[B, A]` (this exact shape is impossible to construct as any subsequence of `[A, B]`, since a subsequence's own elements never reverse the source's relative order). Leaving such an edge unmatched and inserting a fresh one for the position it could have satisfied would silently inflate that id's multiplicity past both the existing and requested counts — so a second, per-id pass pairs every remaining unmatched existing edge against a remaining unmatched requested occurrence of the identical id, front to back on each side, whenever one exists. This pairing deliberately does not attempt to preserve global order — no order-preserving assignment of these specific edges exists by construction, or the LCS pass would already have found it — it exists purely to cap each id's final multiplicity at `max(existingCount, requestedCount)` for that id, never beyond it.
//
// A missing occurrence's anchor is the `originalSiblings` index of the nearest LATER requested position already matched, or `originalSiblings.length` (past the end) when nothing later matched — the same "before the next already-wired position, or at the end" rule as before, just resolved against a fixed index rather than a value that can drift or repeat. That anchor index is translated into the anchor's CURRENT position among `id`'s live CONTAINS siblings by counting how many of this reconcile's OWN prior insertions already landed at or before the same anchor index: `originalSiblings` itself is never reordered, so every earlier insertion's own (equally fixed) anchor index is exactly how far it shifted everything from that index onward. This is what lets a run of several consecutive missing occurrences sharing one anchor interleave in requested order — each is placed by a running numeric offset, never re-resolved by value against the by-then-mutated live sibling list.
//
// The insertion itself reuses insertEdge's own CONTAINS-cycle check, bisection, and rebalance-on-exhaustion primitives directly (`assertNoContainsCycle`, `boundedOrderKey`, `rebalancedInsert`) rather than calling insertEdge with a before/after position — that position parameter is exactly the value-based lookup this function must not go through, so the same guarantees are reached by index instead of by name. Only a position classified as missing is ever placed this way — an already-matched occurrence is never moved. Walking CONTAINS edges from `id` after reconciliation reproduces the exact requested `children` list, in order and multiplicity both, whenever `originalSiblings`' own target sequence is a genuine subsequence of `children` — a strictly wider guarantee than round 9's per-id matcher offered, since it now holds for any order-consistent interleaving across ids, not only a prefix of each id's own occurrences. When `originalSiblings` is not even a subsequence of `children` (a genuine cross-id ordering conflict, existing containment wired in a relative order the request cannot embed), reconciliation still terminates safely and never inflates any id's multiplicity past `max(existingCount, requestedCount)`, but the resulting order is not guaranteed to equal `children`, because existing containment is never reordered to fit a new request — reconciliation inserts what is missing around what already exists, it does not re-sort what already exists. Requesting an identical `children` list twice stays the no-op past-the-first-call behaviour this module has always promised, because every position is then classified as already matched and none are inserted.
// Bounds-checked in place of a bare `row[index]!`: every legitimate row/column pair reconcileChildren's own backtrack computes stays within a dp row's real dimensions, so this can only ever throw if the backtrack's own loop bounds were themselves wrong — a genuine correctness bug, not a defensive "just in case". That throw is exactly what makes a boundary mutation of the backtrack's own `i`/`j` loop conditions (e.g. `<` weakened to `<=`) an observable failure instead of a silently-absorbed one-past-the-end no-op: `row[index]` alone would just read `undefined` and carry on. Hoisted out of reconcileChildren's own closure and exported purely so the direct unit test below can prove the throw itself fires, since no legitimate call through reconcileChildren can ever actually trigger it.
export function dpAt(row: readonly number[], index: number): number {
  if (index < 0 || index >= row.length) {
    throw new Error(
      `reconcileChildren: dp lookup index ${String(index)} out of bounds (0..${String(row.length - 1)})`,
    );
  }
  return row[index]!;
}

function reconcileChildren(
  graph: PropertyGraph,
  id: string,
  children: readonly string[] | undefined,
): PropertyGraph {
  if (children === undefined) return graph;

  // The fixed reference list every classification and anchor below resolves against: `id`'s existing CONTAINS edges, sorted once. This array is never mutated or reordered by this function — an index into it names one specific, unchanging existing edge for the rest of the call.
  const originalSiblings = graph.edges
    .filter((edge) => edge.from === id && edge.kind === "CONTAINS")
    .sort(orderKeyAscComparator);

  const existingSeq = originalSiblings.map((edge) => edge.to);

  // Longest-common-subsequence length table between `existingSeq` (rows) and `children` (columns), built from the bottom-right corner backwards so the forward backtrack below can read `dp[i + 1]`/`dp[j + 1]` as "the best match achievable over the rest of both sequences from here". This full 2D table is O(existingSeq.length * children.length) in space, up from the O(existingSeq.length + children.length) a handful of per-id running counters needed before this LCS rewrite — only reachable at all when `id` already carries CONTAINS edges, and bounded by how many siblings one node and one reconcile call actually have, which stays small even for a heavily edited document.
  const dp: number[][] = Array.from({ length: existingSeq.length + 1 }, () =>
    new Array<number>(children.length + 1).fill(0),
  );
  for (let i = existingSeq.length - 1; i >= 0; i -= 1) {
    for (let j = children.length - 1; j >= 0; j -= 1) {
      dp[i]![j] =
        existingSeq[i] === children[j]
          ? dpAt(dp[i + 1]!, j + 1) + 1
          : Math.max(dpAt(dp[i + 1]!, j), dpAt(dp[i]!, j + 1));
    }
  }

  // Forward backtrack from (0, 0): a matching pair is taken the instant both sequences agree at the current pointers — not because it is the only move an optimal assignment could ever take there (existingSeq [A, B] against children [A, A] has more than one assignment reaching a maximum common subsequence), but because the standard LCS recurrence guarantees taking an agreeing pair is always part of AT LEAST ONE maximum common subsequence, which is all a single deterministic backtrack needs. Otherwise whichever pointer leads to the branch the table says still carries the larger remaining match advances — a genuine tie breaks toward advancing `i` (the existing side), so a requested position matches as early as any optimal assignment allows.
  //
  // Both maps below are keyed by index rather than sized arrays: neither key space is ever read by `.length` or iterated as a whole, only ever looked up by a specific position/index and checked for presence, so a Map's own "no entry" semantics already say everything a pre-sized, pre-filled array's "still holds its initial fill value" would — there is no separate "was this ever populated" fact a fixed initial size could add.
  const matchedIndex = new Map<number, number>();
  const matchedByOriginal = new Map<number, number>();
  {
    let i = 0;
    let j = 0;
    while (i < existingSeq.length && j < children.length) {
      if (existingSeq[i] === children[j]) {
        matchedIndex.set(j, i);
        matchedByOriginal.set(i, j);
        i += 1;
        j += 1;
      } else if (dpAt(dp[i + 1]!, j) >= dpAt(dp[i]!, j + 1)) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }

  // Anti-inflation pass: pairs every existing edge the LCS match above left unmatched against a remaining unmatched requested occurrence of the identical id, front to back on each side — see this function's own doc comment above for why this cannot preserve global order (no order-preserving assignment of these specific edges exists, or the LCS pass would already have found it) and why it must run anyway (capping each id's final multiplicity at max(existingCount, requestedCount), never minting a fresh edge for a position an existing one could satisfy).
  const unmatchedExistingByTarget = new Map<string, number[]>();
  originalSiblings.forEach((edge, index) => {
    if (matchedByOriginal.has(index)) return;
    const bucket = unmatchedExistingByTarget.get(edge.to);
    if (bucket === undefined) unmatchedExistingByTarget.set(edge.to, [index]);
    else bucket.push(index);
  });
  const leftoverPointer = new Map<string, number>();
  children.forEach((childId, position) => {
    if (matchedIndex.has(position)) return;
    const leftovers = unmatchedExistingByTarget.get(childId);
    if (leftovers === undefined) return;
    const pointer = leftoverPointer.get(childId) ?? 0;
    if (pointer >= leftovers.length) return;
    matchedIndex.set(position, leftovers[pointer]!);
    leftoverPointer.set(childId, pointer + 1);
  });

  // A missing position's anchor: the `originalSiblings` index of the nearest LATER requested position already matched, or `originalSiblings.length` (past the end) when nothing later matched. Precomputed once, back to front, over `[...children.entries()].reverse()` rather than scanned per call with an explicit "later > position" comparison: `position` is never itself a key in `matchedIndex` (this map's only two writers, the LCS backtrack and the anti-inflation pass above, both write exclusively at positions that end up matched, and this array is only ever read for a position the caller has already confirmed is NOT in `matchedIndex`), so any comparison boundary drawn at "later === position" is unobservable by construction — not a gap in this function's tests, a fact about what `matchedIndex` can ever contain. Anchoring the traversal to `children`'s own reversed entries, rather than a separately-mutable length/index pair, means there is no boundary comparison left for a mutation to weaken at all.
  //
  // Keyed by position rather than a pre-sized array: every position this precompute writes is read back exactly once via anchorFor, never by `.length` or as a whole, so a Map's own get() already says everything a fixed-length array's initial size would — there is no separate "was this ever populated" fact that size could add, the same reasoning matchedIndex/matchedByOriginal above already follow.
  const anchorAt = new Map<number, number>();
  let runningAnchor = originalSiblings.length;
  for (const [position] of [...children.entries()].reverse()) {
    anchorAt.set(position, runningAnchor);
    const matchedHere = matchedIndex.get(position);
    if (matchedHere !== undefined) runningAnchor = matchedHere;
  }
  const anchorFor = (position: number): number => anchorAt.get(position)!;

  // Every anchor index this loop has already inserted an occurrence at or before, in insertion order — what lets each new insertion compute its own CURRENT position (its fixed anchor index, shifted right by however many earlier insertions in this same reconcile landed at or before that same index) without ever re-deriving a position from the live sibling list by value.
  const insertedAtOrBefore: number[] = [];

  return children.reduce((acc, childId, position) => {
    if (matchedIndex.has(position)) return acc; // already matched to a specific existing edge — never moved
    assertNoContainsCycle(acc.edges, id, childId);
    const anchorIndex = anchorFor(position);
    const insertIndex =
      anchorIndex +
      insertedAtOrBefore.filter((inserted) => inserted <= anchorIndex).length;
    insertedAtOrBefore.push(anchorIndex);
    const currentSiblings = acc.edges
      .filter((edge) => edge.from === id && edge.kind === "CONTAINS")
      .sort(orderKeyAscComparator);
    return runOrRebalance(
      () => {
        const orderKey = boundedOrderKey(currentSiblings, insertIndex);
        const edge: GraphEdge = {
          from: id,
          to: childId,
          kind: "CONTAINS",
          orderKey,
        };
        return { nodes: acc.nodes, edges: [...acc.edges, edge] };
      },
      () =>
        rebalancedInsert(
          acc,
          id,
          childId,
          "CONTAINS",
          currentSiblings,
          insertIndex,
          undefined,
        ),
    );
  }, graph);
}

// Mints one new node with the identical discipline as every read-side mint site: `id` is computed from content alone via contentHashV1 and spread into the face AFTER the content (`{ ...properties, id, kind }`), so a `properties` field named `id` or `kind` is shadowed unconditionally, and `InsertNodeContent` carries no `id` field at all — there is no parameter a caller-supplied id could occupy. `kind` is deliberately excluded from the hash INPUT itself, the same reason mintValueNode's own `kind: 'value'` and entryNodeFace's graph-vocabulary kind are never folded into their hashes either: it is the graph vocabulary's word for what a node IS, asked for explicitly because this module's own mint sites decide it four different ways, not a fact about the node's content that identity should hinge on. Content identical to a node already present in `graph` dedupes to the existing node rather than minting a duplicate (this function's own `existing` lookup below) — checked against the existing node's own `kind` first (NodeKindMismatchError above covers a genuine collision across kinds), then reconciled against its own CONTAINS edges at each child's OWN requested position (reconcileChildren above) rather than assumed to already match or simply appended, since two differently spelled calls can hash identically while only one of them declared `children` at all.
//
// When `children` is given for a genuinely fresh id — one no earlier `insertEdge` call has ever pointed a dangling CONTAINS edge onto (the common case, checked by scanning `graph.edges` for `from === id` before minting anything) — this mints one CONTAINS edge per child at `orderKeys.orderKeyForIndex(index)`, the WIDE, evenly spaced keys a fresh mint wants (exactly as projectGroup mints them for a freshly walked TreeGroup), leaving room for a later insertEdge to bisect between them without a rebalance; each of those child edges is still checked with `assertNoContainsCycle` first, exactly like insertEdge's own CONTAINS attachment, and throws `ContainsCycleError` when `to` (the child) already reaches `from` (this node's own about-to-be-minted id) — folding the child's hash into this node's hash proves this id could never have existed before now, but says nothing about an edge some EARLIER call already pointed at this not-yet-existing id (insertEdge tolerates exactly that), so the check cannot be skipped just because this is a fresh mint. But when `graph` already carries one or more CONTAINS edges from this id — exactly the dangling-edge shape the cycle check above exists to catch, an id named by an `insertEdge` call before any node with that id existed — minting every child at its own bare `orderKeyForIndex(index)` regardless of what is already there is unsafe: an already-attached edge can sit at a key a fresh mint is about to hand to an unrelated sibling (an order-key TIE, the exact degenerate shape `boundedOrderKey` and `siblingInsertIndex` refuse everywhere else in this module) or can already BE the edge a fresh mint is about to re-mint (a byte-identical duplicate, violating `addEdge`'s own one-edge-per-tuple invariant on the read side). So a fresh mint with pre-existing CONTAINS edges routes every child through the identical `reconcileChildren` machinery the dedup-hit branch above already uses: a child already wired is left exactly as it is, and a genuinely new one is inserted at its own requested position via the same bisection (or automatic rebalance) `insertEdge` itself uses, anchored to a SPECIFIC existing edge by index rather than to a bare id value, which cannot produce a tie, a duplicate, or a misplaced anchor by construction.
export function insertNode(
  graph: PropertyGraph,
  content: InsertNodeContent,
): InsertNodeResult {
  const hashInput: Record<string, unknown> =
    content.children === undefined
      ? content.properties
      : { ...content.properties, children: content.children };
  const id = contentHashV1(hashInput);
  const existing = graph.nodes.find((node) => node.id === id);
  if (existing !== undefined) {
    if (existing.kind !== content.kind) {
      throw new NodeKindMismatchError(id, existing.kind, content.kind);
    }
    return { graph: reconcileChildren(graph, id, content.children), id };
  }
  const node: GraphNode = { ...content.properties, id, kind: content.kind };
  const minted: PropertyGraph = {
    nodes: [...graph.nodes, node],
    edges: graph.edges,
  };
  if (content.children === undefined) {
    return { graph: minted, id };
  }
  const hasPriorContainsEdges = graph.edges.some(
    (edge) => edge.from === id && edge.kind === "CONTAINS",
  );
  if (hasPriorContainsEdges) {
    return { graph: reconcileChildren(minted, id, content.children), id };
  }
  let edges = minted.edges;
  content.children.forEach((childId, index) => {
    assertNoContainsCycle(edges, id, childId);
    edges = [
      ...edges,
      {
        from: id,
        to: childId,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(index),
      },
    ];
  });
  return { graph: { nodes: minted.nodes, edges }, id };
}

// Where a new edge lands among an existing sibling list: `start`/`end` are the two boundaries an empty or non-empty list needs, `before`/`after` name an existing sibling to land relative to. A named sibling not found among `from`'s existing edges of the requested `kind` is a genuine caller error — there is no position to compute otherwise — and is refused loudly, as UnknownSiblingError, rather than silently falling back to an end position, in this module's own "refuses a ref the table does not carry" tradition.
export type InsertPosition =
  | { readonly at: "start" }
  | { readonly at: "end" }
  | { readonly at: "before"; readonly siblingId: string }
  | { readonly at: "after"; readonly siblingId: string };

export interface InsertEdgeOptions {
  readonly kind?: GraphEdgeKind;
  readonly position?: InsertPosition;
  readonly path?: PropertyPath;
}

// Thrown by siblingInsertIndex when `position` names a sibling id that is not among `from`'s existing edges of the requested `kind` — there is no position to compute otherwise, so this module refuses loudly rather than silently falling back to an end position, in its own "refuses a ref the table does not carry" tradition (decideEntry's own refusal above is the same pattern). A named class, in the OrderKeyBudgetExhaustedError/ConstructMarkerImbalanceError family convention, carrying the three facts that produced the refusal as structured fields rather than only a formatted message, so a caller narrows with `instanceof` and reads `from`/`kind`/`siblingId` directly instead of parsing the message string.
export class UnknownSiblingError extends Error {
  readonly from: string;
  readonly kind: GraphEdgeKind;
  readonly siblingId: string;

  constructor(from: string, kind: GraphEdgeKind, siblingId: string) {
    super(
      `insertEdge: sibling "${siblingId}" names no existing ${kind} edge from "${from}"`,
    );
    this.name = "UnknownSiblingError";
    this.from = from;
    this.kind = kind;
    this.siblingId = siblingId;
  }
}

// Thrown by siblingInsertIndex when `position` names a sibling id that matches more than one of `from`'s existing edges of the requested `kind` AND those matches genuinely tie on orderKey — a parent can carry more than one edge of the same kind to the same target (two identical CONTAINS children under one section, or two PROPERTY edges from one owner to one shared `value` node, disambiguated only by `path`), but `siblings` is already sorted ascending by orderKey before position resolution runs, so when the matching edges carry DISTINCT orderKeys, "the earliest one in that sorted order" is a deterministic, reproducible answer, not a guess dependent on insertion order — resolving against it is exactly as principled as resolving against the only match in the common case, so that shape is not refused. Only a genuine orderKey TIE among the matches has no such boundary: nothing distinguishes "first" from "second" among keys that compare equal (this module's own emitWalkEdges mints every PROPERTY/DEFINED_BY edge from one owner at the identical floor key for exactly this reason — they carry no real document-order sequence), so before/after names no single position to resolve against and this is refused loudly instead, in the identical "a named ref must resolve to exactly one thing or not at all" tradition UnknownSiblingError already established for the zero-match case.
export class AmbiguousSiblingError extends Error {
  readonly from: string;
  readonly kind: GraphEdgeKind;
  readonly siblingId: string;
  readonly matchCount: number;

  constructor(
    from: string,
    kind: GraphEdgeKind,
    siblingId: string,
    matchCount: number,
  ) {
    super(
      `insertEdge: sibling "${siblingId}" names ${String(matchCount)} existing ${kind} edges from "${from}", not exactly one — before/after has no single position to resolve against`,
    );
    this.name = "AmbiguousSiblingError";
    this.from = from;
    this.kind = kind;
    this.siblingId = siblingId;
    this.matchCount = matchCount;
  }
}

// Resolves `position` against `siblings` (already sorted ascending by orderKey) to a plain array index — where the new edge would sit if `siblings` were spliced at that index — rather than an orderKey directly, so the same lookup serves both the fast bisection path and the rebalance fallback below. A named sibling matching no edge is refused as UnknownSiblingError. A named sibling matching more than one edge of the same kind from the same owner resolves to the earliest such match in sorted order — a deterministic answer, not an insertion-order guess — UNLESS those matches genuinely tie on orderKey, in which case there is no principled "earliest" and it is refused as AmbiguousSiblingError (its own comment above).
function siblingInsertIndex(
  siblings: readonly GraphEdge[],
  position: InsertPosition,
  from: string,
  kind: GraphEdgeKind,
): number {
  if (position.at === "start") return 0;
  if (position.at === "end") return siblings.length;
  const matches: number[] = [];
  siblings.forEach((edge, index) => {
    if (edge.to === position.siblingId) matches.push(index);
  });
  if (matches.length === 0) {
    throw new UnknownSiblingError(from, kind, position.siblingId);
  }
  // No separate matches.length > 1 guard: by this point matches.length is already >= 1 (the zero case just refused above), and for a single-element array `new Set([x]).size` is trivially 1, equal to matchedOrderKeys.length, so running this check unconditionally never throws for a single match either.
  const matchedOrderKeys = matches.map((index) => siblings[index]!.orderKey);
  if (new Set(matchedOrderKeys).size !== matchedOrderKeys.length) {
    throw new AmbiguousSiblingError(
      from,
      kind,
      position.siblingId,
      matches.length,
    );
  }
  const index = matches[0]!;
  return position.at === "before" ? index : index + 1;
}

// The fast path: bisect between whichever of `siblings[index - 1]`/`siblings[index]` exist, falling back to orderKeyForIndex(0) only when NEITHER does (a genuinely empty sibling list — the same wide key a fresh projection mints for its own first child, not a defensive default masking a lookup failure). Throws OrderKeyBudgetExhaustedError when the two neighbours have no room left, which insertEdge below catches and answers with a full rebalance rather than surfacing to the caller — exactly what a real sibling list needs to keep working once bisection is exhausted, most commonly `start` against a first child that (like every first child projectDocumentGraph itself ever mints) already sits at the scheme's own floor.
//
// Two adjacent siblings sharing one orderKey are a SEPARATE no-room case from a narrow-but-nonempty interval, and are checked for explicitly, before ever calling orderKeyBetween: this module's own emitWalkEdges mints every PROPERTY/DEFINED_BY edge from one owner at the uniform floor key, by design, since those edges carry no real document-order sequence for orderKey to encode (only `path` disambiguates them) — so a tied pair here is an expected shape this module itself produces, not a malformed graph. orderKeyBetween's own precondition ("low must sort strictly before high") is written for a genuine caller error — a reversed pair, low > high — and throws a plain Error for that; asking it to also cover the tied case would make one precondition violation throw two different error classes depending on which of "equal" or "reversed" produced it. Recognising the tie here instead, ahead of the call, keeps that plain-Error/OrderKeyBudgetExhaustedError split consistent (genuine misuse vs. legitimate no-room-left) and routes the tie through the identical rebalance fallback insertEdge already has for a narrow interval. Exported purely for the direct unit test below pinning this exact tied-siblings message: insertEdge's own catch swallows it into a silent rebalance, so no test reaching this function only through insertEdge/reconcileChildren ever observes the string itself.
export function boundedOrderKey(
  siblings: readonly GraphEdge[],
  index: number,
): string {
  const before = siblings[index - 1];
  const after = siblings[index];
  if (before === undefined && after === undefined)
    return orderKeys.orderKeyForIndex(0);
  if (before === undefined) return orderKeys.orderKeyBefore(after!.orderKey);
  if (after === undefined) return orderKeys.orderKeyAfter(before.orderKey);
  if (before.orderKey === after.orderKey) {
    throw new OrderKeyBudgetExhaustedError(
      "boundedOrderKey: adjacent siblings share one orderKey, leaving no room to bisect; rebalance with renumberedOrderKeys",
    );
  }
  return orderKeys.orderKeyBetween(before.orderKey, after.orderKey);
}

// Runs `attempt`, answering an OrderKeyBudgetExhaustedError alone with a full rebalance via `onExhausted`; any other error propagates unchanged. Shared by reconcileChildren's and insertEdge's own identical try/catch, both built around this exact call shape (bisect via boundedOrderKey, rebalance on its one named exhaustion signal). The rethrow branch is a defensive guard no legitimate call through either of those two call sites can ever actually trigger: boundedOrderKey's own tied-key check runs before orderKeyBetween is ever called, and the sibling list handed to it is freshly sorted ascending immediately before every call, so orderKeyBetween's "low must sort strictly before high" precondition can never fail here — exported purely so the direct unit test below can prove the rethrow itself works, the same reasoning effective.ts's assertResolvedHeadingAnchor already documents for an equivalent unreachable-in-practice guard.
export function runOrRebalance<T>(attempt: () => T, onExhausted: () => T): T {
  try {
    return attempt();
  } catch (error) {
    if (!(error instanceof OrderKeyBudgetExhaustedError)) throw error;
    return onExhausted();
  }
}

// The rebalance fallback: mints a fresh, evenly spaced key for every one of `from`'s existing `kind` edges plus the new one, in the same relative order (renumberedOrderKeys — the identical rebalance orderKeyBetween's own exhaustion already names as the answer), then replaces exactly those existing edges in `graph` with their rebuilt versions. Every OTHER edge in `graph` — a different `from`, a different `kind`, or a wholly unrelated edge — is carried over untouched; only the one sibling group that ran out of room is ever rewritten.
//
// A KNOWN, PRE-EXISTING TRADE-OFF (order-keys.ts's own scheme, unchanged by this write API): renumberedOrderKeys always re-establishes orderKeyForIndex(0) — the all-zero '00000000' floor — as the new first sibling's key, so a sibling group that has just paid for a full rebalance is immediately back at the exact floor a further front-insert (`{ at: 'start' }`) will exhaust again. Repeated front-inserts into the same sibling group therefore each pay the full rebalance cost, not merely the first one; there is no cheaper "leave headroom below the floor" alternative within this scheme, because '00000000' is definitionally the bottom of the base-36 key space (orderKeyBefore's own refusal). This is a property of the order-key scheme itself, not something insertEdge's own rebalance logic could avoid without changing what a rebalance mints.
function rebalancedInsert(
  graph: PropertyGraph,
  from: string,
  to: string,
  kind: GraphEdgeKind,
  siblings: readonly GraphEdge[],
  index: number,
  path: PropertyPath | undefined,
): PropertyGraph {
  const ordered: {
    readonly to: string;
    readonly path: PropertyPath | undefined;
  }[] = [
    ...siblings
      .slice(0, index)
      .map((edge) => ({ to: edge.to, path: edge.path })),
    { to, path },
    ...siblings.slice(index).map((edge) => ({ to: edge.to, path: edge.path })),
  ];
  const keys = orderKeys.renumberedOrderKeys(ordered.length);
  const rebuilt: GraphEdge[] = ordered.map((entry, position) => ({
    from,
    to: entry.to,
    kind,
    orderKey: keys[position]!,
    ...(entry.path === undefined ? {} : { path: entry.path }),
  }));
  const replaced = new Set(siblings.map(edgeKey));
  const kept = graph.edges.filter((edge) => !replaced.has(edgeKey(edge)));
  return { nodes: graph.nodes, edges: [...kept, ...rebuilt] };
}

// Thrown when attaching a CONTAINS edge would close a cycle: `to` already reaches `from` via existing CONTAINS edges (most directly, re-parenting a node underneath its own descendant in one call), so attaching `from -> to` would make `from` its own transitive ancestor. Both insertEdge's own attachment and insertNode's fresh-mint children-wiring throw this, via the identical `assertNoContainsCycle` check just below — the ONE place in this module a CONTAINS edge is ever appended onto an already-existing `PropertyGraph` without going through that check is nowhere: projectDocumentGraph's own tree walk is the only other CONTAINS source, and it is acyclic by a different, structural argument (every child's id is already known before its parent's id is computed, so a parent can never be a descendant of a child it has not yet been assigned an id relative to). A named class, in the OrderKeyBudgetExhaustedError/UnknownSiblingError family convention, carrying the two ids that produced the refusal as structured fields.
export class ContainsCycleError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(
      `insertEdge: attaching CONTAINS "${from}" -> "${to}" would close a cycle — "${to}" already reaches "${from}"`,
    );
    this.name = "ContainsCycleError";
    this.from = from;
    this.to = to;
  }
}

// Whether `to` already reaches `from` by following CONTAINS edges alone — the reachability test both insertEdge and insertNode's fresh-mint children-wiring run before ever appending a CONTAINS edge. Deliberately edge-only: it builds its own from->to[] adjacency straight out of `edges` and never once consults a node list, which is the actual fix for the hazard a node-lookup-based check (walkPropertyGraph's own `nodesById.get` short-circuit) cannot close — insertEdge tolerates attaching an edge to a `to` that names no node in `graph.nodes` yet (walkPropertyGraph's own "an edge naming a node absent from this graph is not this walker's concern to diagnose" is the read-side mirror of that same tolerance), so a caller can attach a forward edge onto an id it has merely computed, then a LATER insertNode call can mint exactly that id with a `children` list pointing back through it — closing a cycle that never had a node to look up at the moment the first edge was attached. Searching from `to` and stopping the instant `from` is found (rather than walking outward from `from` and collecting everything reachable, or building the whole reachable set before checking membership) keeps the common, no-cycle case cheap: most attachments touch a small, recently-visited neighbourhood, not the whole graph.
function containsWouldReach(
  edges: readonly GraphEdge[],
  from: string,
  to: string,
): boolean {
  const childrenOf = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== "CONTAINS") continue;
    const bucket = childrenOf.get(edge.from);
    if (bucket === undefined) childrenOf.set(edge.from, [edge.to]);
    else bucket.push(edge.to);
  }
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of childrenOf.get(current) ?? []) stack.push(next);
  }
  return false;
}

// Throws ContainsCycleError when containsWouldReach says attaching CONTAINS `from -> to` would close a cycle; a plain pass-through otherwise. The single choke point insertEdge and insertNode both call before appending a CONTAINS edge, so neither can drift from the other's notion of what counts as a cycle.
function assertNoContainsCycle(
  edges: readonly GraphEdge[],
  from: string,
  to: string,
): void {
  if (containsWouldReach(edges, from, to)) {
    throw new ContainsCycleError(from, to);
  }
}

// Attaches an already-minted node (from insertNode, or any other node already present in `graph`) into `graph` as one new edge, at a sibling position among `from`'s existing edges of the same `kind` — the "inserting a sibling touches only that one new CONTAINS edge's orderKey" edit this module's own top comment names, extended to a full rebalance on the rare occasions bisection alone cannot express the requested position. Defaults to a CONTAINS edge appended after `from`'s existing children, the common "add one more child" case; pass `kind`/`position`/`path` for a STYLED_BY/DEFINED_BY/PROPERTY edge or a specific sibling position. Never mutates `graph` — returns a new PropertyGraph, the same pure-function discipline insertNode follows.
export function insertEdge(
  graph: PropertyGraph,
  from: string,
  to: string,
  options: InsertEdgeOptions = {},
): PropertyGraph {
  const kind = options.kind ?? "CONTAINS";
  // A CONTAINS edge is the one kind this function ever attaches without a hash relationship backing its acyclicity on its own (ContainsCycleError's own comment explains why hash-folding is not enough), so it is the one kind checked here, before position resolution even runs.
  if (kind === "CONTAINS") {
    assertNoContainsCycle(graph.edges, from, to);
  }
  const position = options.position ?? { at: "end" };
  const siblings = graph.edges
    .filter((edge) => edge.from === from && edge.kind === kind)
    .sort(orderKeyAscComparator);
  const index = siblingInsertIndex(siblings, position, from, kind);
  return runOrRebalance(
    () => {
      const orderKey = boundedOrderKey(siblings, index);
      const edge: GraphEdge = {
        from,
        to,
        kind,
        orderKey,
        ...(options.path === undefined ? {} : { path: options.path }),
      };
      return { nodes: graph.nodes, edges: [...graph.edges, edge] };
    },
    () =>
      rebalancedInsert(graph, from, to, kind, siblings, index, options.path),
  );
}

// Whether two edges' own `path` fields name the same property path — `undefined` matches only `undefined` (an edge with no path is not "the same path" as one carrying an empty array), otherwise structural equality via JSON.stringify, the same comparison edgeKey itself already relies on for its own dedup key. No separate undefined special-case is needed: JSON.stringify(undefined) is the JS value `undefined` itself, not a string, so comparing the two stringified results already agrees with `a === b` whenever either argument is undefined (both undefined: undefined === undefined; exactly one undefined: undefined === "[...]", always false).
function pathsEqual(
  a: PropertyPath | undefined,
  b: PropertyPath | undefined,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Thrown by selectEdge (removeEdge/replaceEdge's own shared resolution, just below) when the requested (from, to, kind[, path]) names no edge in `graph.edges` — there is no edge to remove or replace otherwise, so this module refuses loudly rather than silently no-op'ing on `removeEdge` or silently minting a fresh, unrelated edge on `replaceEdge`, in the identical UnknownSiblingError tradition above. A named class carrying the fields that produced the refusal as structured data rather than only a formatted message, matching this module's own UnknownSiblingError/AmbiguousSiblingError/ContainsCycleError convention.
export class UnknownEdgeError extends Error {
  readonly from: string;
  readonly to: string;
  readonly kind: GraphEdgeKind;
  readonly path: PropertyPath | undefined;

  constructor(
    from: string,
    to: string,
    kind: GraphEdgeKind,
    path: PropertyPath | undefined,
  ) {
    super(
      `no ${kind} edge from "${from}" to "${to}"${path === undefined ? "" : ` at path ${JSON.stringify(path)}`} exists to select`,
    );
    this.name = "UnknownEdgeError";
    this.from = from;
    this.to = to;
    this.kind = kind;
    this.path = path;
  }
}

// Thrown by selectEdge when (from, to, kind[, path]) names more than one edge — a parent can carry more than one edge of the same kind to the same target (two identical CONTAINS children under one section, or two PROPERTY/DEFINED_BY edges from one owner extracting to one shared value node), and `path` is the one field left to disambiguate once (from, to, kind) alone does not; when `path` was already supplied and matches STILL number more than one, the edges are identical in every field selectEdge can compare — nothing left to disambiguate against, only the caller's own knowledge of orderKey could pick one, and this module deliberately does not ask a caller of removeEdge/replaceEdge to already know an edge's current orderKey (unlike insertEdge's own before/after sibling positioning, which is a different operation resolving a NEW edge's position, not an existing edge's identity). Refused loudly either way, in the identical "resolves to exactly one thing or not at all" tradition AmbiguousSiblingError already established.
export class AmbiguousEdgeError extends Error {
  readonly from: string;
  readonly to: string;
  readonly kind: GraphEdgeKind;
  readonly path: PropertyPath | undefined;
  readonly matchCount: number;

  constructor(
    from: string,
    to: string,
    kind: GraphEdgeKind,
    path: PropertyPath | undefined,
    matchCount: number,
  ) {
    super(
      path === undefined
        ? `${String(matchCount)} ${kind} edges from "${from}" to "${to}" match — pass \`path\` to disambiguate`
        : `${String(matchCount)} ${kind} edges from "${from}" to "${to}" at path ${JSON.stringify(path)} match — these edges are identical in every field removeEdge/replaceEdge can compare, so none of them can be selected unambiguously`,
    );
    this.name = "AmbiguousEdgeError";
    this.from = from;
    this.to = to;
    this.kind = kind;
    this.path = path;
    this.matchCount = matchCount;
  }
}

// Resolves (from, to, kind[, path]) against `edges` to the one GraphEdge it names — the shared selection removeEdge and replaceEdge both build on, so the two can never drift into two different notions of "the edge this call means". Deliberately keyed on (from, to, kind, path) rather than the full edgeKey tuple: a caller wanting to detach or repoint an edge is not expected to already know its current orderKey (that is exactly the field a caller of insertEdge never supplies either — it is this module's own bookkeeping for document order, not part of an edge's logical identity), so orderKey plays no part in selection here, only in what replaceEdge later carries over unchanged. Zero matches refuses as UnknownEdgeError; more than one refuses as AmbiguousEdgeError — both classes' own comments above explain why "pick the first match" is never the right silent fallback for either failure.
function selectEdge(
  edges: readonly GraphEdge[],
  from: string,
  to: string,
  kind: GraphEdgeKind,
  path: PropertyPath | undefined,
): GraphEdge {
  const matches = edges.filter(
    (edge) =>
      edge.from === from &&
      edge.to === to &&
      edge.kind === kind &&
      (path === undefined || pathsEqual(edge.path, path)),
  );
  if (matches.length === 0) throw new UnknownEdgeError(from, to, kind, path);
  if (matches.length > 1) {
    throw new AmbiguousEdgeError(from, to, kind, path, matches.length);
  }
  return matches[0]!;
}

export interface RemoveEdgeOptions {
  readonly kind?: GraphEdgeKind;
  readonly path?: PropertyPath;
}

// Detaches one existing edge from `graph`, resolved via selectEdge's (from, to, kind[, path]) lookup — the "detach" primitive #1004 names as missing from insertNode/insertEdge's own pair, which together could mint and attach a new node but never remove or repoint what an ancestor already pointed at. Deliberately leaves `graph.nodes` untouched: the detached edge's own `to` node, quite possibly unreferenced now, is exactly the "orphan = free version history" case this module's top comment already documents as intentional — cascading the removal to prune that node is explicitly out of scope (#1004's own stated exclusion), same as it is for every other node that ends up unreferenced by any other means. Never mutates `graph`; returns a new PropertyGraph, the same pure-function discipline insertNode/insertEdge follow.
export function removeEdge(
  graph: PropertyGraph,
  from: string,
  to: string,
  options: RemoveEdgeOptions = {},
): PropertyGraph {
  const kind = options.kind ?? "CONTAINS";
  const edge = selectEdge(graph.edges, from, to, kind, options.path);
  return {
    nodes: graph.nodes,
    edges: graph.edges.filter((candidate) => candidate !== edge),
  };
}

export interface ReplaceEdgeOptions {
  readonly kind?: GraphEdgeKind;
  readonly path?: PropertyPath;
}

// Atomically repoints one existing edge from `oldTo` to `newTo`, settling #1004's own open question ("what happens to the position slot when replacing in place") in the direction its issue text already named as the natural answer: the selected edge's own orderKey — and path — carry over onto `newTo` UNCHANGED, rather than routing through insertEdge's bisection/rebalance machinery to mint a fresh position, so the new version lands in exactly the slot the old one held, not appended after it. This is deliberately one atomic call rather than a caller composing `removeEdge` then `insertEdge` themselves: two separate calls leave a window in which some other mutation (another insertEdge landing on the same sibling list, say) could run between them and invalidate the position the caller meant to preserve, or — for CONTAINS — a cycle check that only sees the fully-detached state one of the two calls produces, never the other. One call resolves the old edge and produces its replacement from that exact same GraphEdge, with nothing else able to interleave.
//
// A CONTAINS replacement re-checks acyclicity exactly like insertEdge does, but against `graph.edges` with the edge BEING replaced already excluded — not the raw pre-replace edge set — since that edge is being atomically removed as part of this same call and must not count as a pre-existing path when asking whether `newTo` would close a cycle back to `from`; counting it would make every genuine no-op replacement (newTo identical to oldTo) look like it closes a cycle through itself, and would also block legitimate replacements where the only path from newTo back to from ran through the very edge being removed.
export function replaceEdge(
  graph: PropertyGraph,
  from: string,
  oldTo: string,
  newTo: string,
  options: ReplaceEdgeOptions = {},
): PropertyGraph {
  const kind = options.kind ?? "CONTAINS";
  const edge = selectEdge(graph.edges, from, oldTo, kind, options.path);
  const withoutOld = graph.edges.filter((candidate) => candidate !== edge);
  if (kind === "CONTAINS") {
    assertNoContainsCycle(withoutOld, from, newTo);
  }
  const replacement: GraphEdge = {
    from,
    to: newTo,
    kind,
    orderKey: edge.orderKey,
    ...(edge.path === undefined ? {} : { path: edge.path }),
  };
  return { nodes: graph.nodes, edges: [...withoutOld, replacement] };
}
