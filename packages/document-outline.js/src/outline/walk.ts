import type { GraphEdge, GraphEdgeKind, PropertyGraph } from './graph';

// Edge-kind-aware cycle safety (ExaDev/documents.js#660's refinement 5). CONTAINS edges are provably acyclic BY CONSTRUCTION in this projection: a group's id is contentHashV1 of (among other things) its children's already-computed ids, so a node's hash can never depend on itself, and neither can any node reachable purely through CONTAINS -- the whole containment graph is a Merkle DAG, the same reason git and IPFS never need a visited-set walking their own object graphs by containment. Every OTHER edge kind this module defines today (STYLED_BY, DEFINED_BY, PROPERTY) happens to point at content nodes too -- so in practice nothing this projector emits can cycle either, whatever its kind -- but that is a fact about today's specific edges, not a structural guarantee the way CONTAINS's is: a future edge kind that names a genuine cross-reference rather than a content dereference (two footnotes pointing at each other, say) could legitimately cycle, and nothing about this module would stop it from being added. Concretely as of ExaDev/documents.js#660: no cycling edge kind exists in this projector's own output yet, so the guarded path below is exercised only by the synthetic cycle in walk.test.ts, not by anything projectDocumentGraph itself can currently produce.
//
// walkGraph is the one shared traversal every consumer of this contract should use rather than hand-rolling a walk per call site: it looks up each edge kind's policy and, for a GUARDED kind, tracks the set of nodes already open on the CURRENT path (throwing GraphCycleError the moment a guarded edge would revisit one of them) while an ACYCLIC kind is walked with no bookkeeping at all -- no membership check, no set copy -- because a policy that names a kind acyclic is asserting exactly that no bookkeeping can ever be needed for it. That asymmetry is deliberate and is what the refinement asks for: correctness where it is not yet proven (every kind but CONTAINS, by default) and zero overhead where it provably is (CONTAINS). A node reached twice through two DIFFERENT, non-overlapping paths -- exactly how a shared/deduplicated node is meant to be reached in this projection -- is not a cycle and is visited (and passed to `visit`) once per path, same as any DAG walk; only reappearing on the SAME path throws.
//
// Scope note mirrored from the walker's own guardedPath bookkeeping: the visited set tracks nodes entered via a GUARDED edge on the current path, not every node regardless of kind. A pathological mixed cycle that closes back onto a node reached ONLY through acyclic (CONTAINS) edges, via a guarded edge as the closing step, would not be caught -- but as the first paragraph argues, no edge this projector emits today can point at an ancestor at all (every non-root node's id is a pure function of already-hashed content, computed bottom-up, regardless of which edge kind later references it), so this gap has nothing to bite on yet. A future reference-style edge kind that is NOT itself a content-hash dereference and that could point from a descendant back up at one of its own ancestors should be modelled as guarded for every edge along such a path, not only the one that would close the loop, to get full protection from this walker.
export type CyclePolicy = 'acyclic' | 'guarded';

export type EdgeKindCyclePolicy = Readonly<Record<GraphEdgeKind, CyclePolicy>>;

// CONTAINS is the one kind this projection can prove acyclic by construction; every other kind defaults to guarded until a future edge kind earns the same proof.
export const DEFAULT_EDGE_CYCLE_POLICY: EdgeKindCyclePolicy = {
  CONTAINS: 'acyclic',
  STYLED_BY: 'guarded',
  DEFINED_BY: 'guarded',
  PROPERTY: 'guarded',
};

export class GraphCycleError extends Error {}

export interface WalkOptions {
  // Restricts the walk to these edge kinds; all four by default. A CONTAINS-only walk is exactly the zero-bookkeeping case this refinement is about.
  readonly edgeKinds?: readonly GraphEdgeKind[];
  // Overrides which kinds are treated as guarded vs acyclic; DEFAULT_EDGE_CYCLE_POLICY otherwise. Widening a kind to 'acyclic' here is a caller's assertion about ITS OWN data, not something this module verifies.
  readonly policy?: EdgeKindCyclePolicy;
}

// Depth-first walk from `rootId` over `graph`'s edges (or the subset `options.edgeKinds` names), calling `visit(nodeId, edge)` once for the root (`edge` undefined) and once per edge traversed to reach a node. See the module header for the exact cycle-guard contract.
export function walkGraph(
  graph: PropertyGraph,
  rootId: string,
  visit: (nodeId: string, edge: GraphEdge | undefined) => void,
  options: WalkOptions = {},
): void {
  const policy = options.policy ?? DEFAULT_EDGE_CYCLE_POLICY;
  const allowedKinds = options.edgeKinds === undefined ? undefined : new Set(options.edgeKinds);
  const edgesByFrom = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    if (allowedKinds !== undefined && !allowedKinds.has(edge.kind)) continue;
    const outgoing = edgesByFrom.get(edge.from);
    if (outgoing === undefined) edgesByFrom.set(edge.from, [edge]);
    else outgoing.push(edge);
  }

  // `guardedPath` holds only the nodes entered via a GUARDED edge on the path from the root to here -- see the module header's scope note on why an acyclic-kind step never adds to (or even looks at) this set. Passed by reference and reused across acyclic steps (no copy, no allocation); copied with the new node added only when about to take a guarded step, so that step's descendants see the extended path but siblings reached via a later edge from the SAME node do not see each other's guarded-path additions.
  const walkFrom = (nodeId: string, edge: GraphEdge | undefined, guardedPath: ReadonlySet<string>): void => {
    visit(nodeId, edge);
    for (const outgoing of edgesByFrom.get(nodeId) ?? []) {
      if (policy[outgoing.kind] === 'guarded') {
        if (guardedPath.has(outgoing.to)) {
          throw new GraphCycleError(`walkGraph: cycle detected at node "${outgoing.to}" via a ${outgoing.kind} edge`);
        }
        walkFrom(outgoing.to, outgoing, new Set([...guardedPath, outgoing.to]));
      } else {
        walkFrom(outgoing.to, outgoing, guardedPath); // acyclic kind (CONTAINS by default): no membership check, no new set -- the zero-bookkeeping path.
      }
    }
  };
  walkFrom(rootId, undefined, new Set());
}
