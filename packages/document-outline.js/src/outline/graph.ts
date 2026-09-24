import type {
  DefinitionsTable,
  DocumentTree,
  StylesTable,
  TreeGroup,
  TreeLeaf,
} from "document-schema.js";
import { stableContentHash } from "./hash";
import {
  orderKeyAfter,
  orderKeyBefore,
  orderKeyBetween,
  orderKeyForIndex,
  renumberedOrderKeys,
} from "./order-keys";

// The content-addressed graph projection of ExaDev/documents.js#659: one or several tree-form DocumentTrees exported as a property graph (nodes + typed edges) with content-based deduplication, no DocumentTree schema change. Node identity is COMPUTED, not stored: every content node's id is the stableContentHash of its own projected content — the canonicalise-then-hash recipe this package already publishes (src/outline/hash.ts), applied bottom-up as a Merkle DAG. A leaf's hash covers its own content; a group's hash covers its own properties plus its children's hashes (and the hash of whatever table entry its refs point at), so a node can be shared by any number of parents — arbitrary fan-out, data-bearing internal nodes, multi-parent sharing, exactly git's and IPFS's object model rather than a strict binary Merkle tree.
//
// Containment is an EDGE, not tree position, because a shared node has no single position: (parent)-[:CONTAINS {orderKey}]->(child), orderKey being a fractional/lexicographic string derived from the child's index in the parent's document order (graph edges are unordered by default and document order is semantically load-bearing). A style ref becomes one or more (group|leaf)-[:STYLED_BY {orderKey}]->(entry) edges — one per entry in the resolved ancestor chain, outermost first (ExaDev/documents.js#660) — and an anchor descriptor's definitions ref becomes (node)-[:DEFINED_BY {orderKey}]->(entry); policy-extracted property values become (node)-[:PROPERTY {orderKey, path}]->(value). Every edge carries an orderKey rather than a dense integer so a later single insertion (an editor building on this projection) can mint one new key strictly between its neighbours without renumbering any edge that did not move — see src/outline/order-keys.ts, re-exported here as `orderKeys`.
//
// DEREFFING BEFORE HASHING is the load-bearing rule for cross-document dedup: a `style: 's1'` ref (or an anchor's `definition: 'n1'`) is a document-local label with no cross-document meaning — every assembled package mints its own s1, s2, ... keys — so the projector substitutes the referenced ENTRY'S content hash into the referencing node's hash input and never hashes the bare key. Two structurally identical paragraphs whose documents name an identical style entry differently therefore dedupe to one node. Hashing runs in dependency order for the same reason: table entries first, tree nodes second (using the already-computed entry hashes) — and an entry's own body may reference further entries (a footnote body carrying an anchor marker naming a note of its own), so an entry's walk recurses through the same deref while a cycle of entries, which no content hash can cover, is refused loudly.
//
// The document ROOT is the one node whose id is not computed: content hashing the root would change its id on every edit (any interior edit cascades up the DAG), which is the wrong identity scheme for "this document" as a persistently addressed thing. The caller assigns a stable external id — a git ref pointing at a moving commit hash — and the projection uses it verbatim. Package-level metadata/symbolTable/pages/source stay direct properties of the root even when two documents' values coincide: they are per-document identity facts, not reused content.
//
// EDITS fall out of content-hash identity rather than being implemented: modifying a node's content mints a NEW node (the old one persists, still referenced by whatever pointed at it — free version history if orphans are never pruned); inserting a sibling touches only that one new CONTAINS edge's orderKey (minted with orderKeyBetween between two neighbours, orderKeyBefore/orderKeyAfter at a drifted list's ends, or a fresh renumberedOrderKeys rebalance once the budget is exhausted), because identity never depended on position and a fractional key never forces its neighbours to move.
//
// The EXTRACT-OR-INLINE decision is one pluggable policy consulted uniformly at every level — root envelope fields, table entries, tree-node properties, individual scalars — as (path, value) => extract | inline, with paths relative to the OWNING node (the entity whose content the value sits in) and continuing through nested values. The default extracts exactly the definitions-table facility's entries (styles, definitions, layers, attachments, destinations — the reused content the tables exist to hold) and leaves everything else inline: an assembled package's recurring property tuples are already factored into its tables by minting's own recurrence rule (src/factor-styles.ts in document-schema.js), so a one-off italic stays inline and a style used by two paragraphs arrives as a table entry this projection surfaces as one shared node. The default performs no frequency survey of its own: on an assembled package the tables ARE minting's extract decision — its recurrence rule factored the tuples it chose to share and left the rest inline by design (runner-up tuples at a wrapper, since a wrapper mints at most one entry; the per-node facts style entries are banned from carrying; and non-property content such as recurring text, which the worked example pins as inline — sharing happens at the node level), so a surveying default would second-guess minting's compression rather than fill a gap. A hand-built or round-tripped tree that never ran the factoring pass can carry recurring style-shaped tuples inline, where a survey generalised to any value would extract and this default inlines; factorStyles first is the caller's route to the canonical spelling, and effectivePackage first is the route to factoring-invariant hashes — a factored and an unfactored spelling of one document deliberately project to different node ids for the nodes the style rides, because the hash covers each node's own projected content, never style-resolved content. A custom policy can widen extraction to any value at any path — extracted values become kind 'value' nodes joined by PROPERTY edges carrying the property path.
//
// Dedup itself needs no bespoke merge logic: identical content yields an identical hash yields an identical id, so the projection keeps one node per id and one edge per (from, to, kind, orderKey, path) tuple, which is exactly what a graph store's native upsert (Neo4j MERGE, an RDF store keyed by the hash) would do with this output. An identical whole subtree collapses to one shared subtree with only the seam edges from each document's own ancestors being document-specific; a single shared leaf inside otherwise-different structure shares only that leaf. Table entries that nothing references are still emitted as nodes — they are document content, reachable by kind queries.
//
// ExaDev/documents.js#660 hardens this projection for use as a real graph-native store rather than a one-shot export: (1) CONTAINS/STYLED_BY/DEFINED_BY/PROPERTY edges carry a fractional orderKey instead of a dense integer, so a later insertion touches one edge, never a renumber (order-keys.ts, re-exported as `orderKeys`); (2) `contentHashV1` names this module's own node-identity recipe as a versioned contract, independent of hash.ts's own leafContentHash contract even though they share an implementation today; (3) no content node's id is ever caller-supplied — see the doc comment on DocumentProjection; (4) a heading or list anchor, and a bare paragraph leaf, emit one STYLED_BY edge per entry in their resolved style chain rather than only their own direct ref, so a consumer can walk the whole resolution chain from edges alone; (5) `walkPropertyGraph` is a shared traversal with a cycle guard that activates automatically whenever a non-CONTAINS edge kind is in play; (6) every CONTAINS edge this projection ever attaches onto an already-existing `PropertyGraph` — `insertEdge`'s own attachment, and `insertNode`'s fresh-mint children-wiring alike — passes through one shared, edge-only reachability check (`containsWouldReach`) before it is appended, and is refused as `ContainsCycleError` when `to` already reaches `from`. This check deliberately never consults `graph.nodes`: an id can be the target of an `insertEdge` call before any node with that id exists (dangling edges to a not-yet-minted id are allowed, matching `walkPropertyGraph`'s own tolerance of an edge naming an absent node), and a *later* `insertNode` call can mint exactly that id — folding a child's hash into a freshly-minted parent's own hash prevents the parent from being ITS OWN pre-existing descendant, but says nothing about an edge some earlier call already pointed at the parent's not-yet-computed id, which is exactly the shape that needs an edge-only, node-presence-independent search to catch. The "a path can never lead back to its own ancestor" guarantee `walkPropertyGraph`'s CONTAINS-only fast path relies on holds because this one check gates every CONTAINS attachment across the projection, not because hash-folding alone makes every CONTAINS edge acyclic.

export type GraphEdgeKind =
  "CONTAINS" | "STYLED_BY" | "DEFINED_BY" | "PROPERTY";

// A property path relative to the owning node: keys of records, indices of arrays (['runs', 0, 'text']), continuing through values an extraction promoted to their own nodes.
export type PropertyPath = readonly (string | number)[];

export type ExtractionDecision = "extract" | "inline";

// The pluggable extract-or-inline decision. Pure by contract: the projector consults it with the same (path, value) for a table entry both when it walks the root's tables and when a tree ref dereferences that entry, so one entry has one decision for the whole projection.
export type ExtractionPolicy = (
  path: PropertyPath,
  value: unknown,
) => ExtractionDecision;

export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly [property: string]: unknown;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: GraphEdgeKind;
  readonly orderKey: string;
  readonly path?: PropertyPath;
}

export interface PropertyGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

// Ascending orderKey comparator, shared by every sort site across this module and its outline/graph-edit.ts sibling (walkPropertyGraph's per-node outgoing-edge order here, reconcileChildren's and insertEdge's own sibling lists there) rather than several separately-typed-out copies: one definition means one set of mutants to kill, not several identical sets, and one caller change (were the comparison ever wrong) fixes every sort site at once. Exported purely for the direct unit test pinning its exact -1/0/1 return values.
export function orderKeyAscComparator(
  a: { readonly orderKey: string },
  b: { readonly orderKey: string },
): number {
  return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0;
}

// Ascending id comparator for entry nodes awaiting emission (DocumentProjection's own pendingEntryNodes below): a tie (two entries content-hashing to the identical id) leaves their relative order exactly as pushed, since Array.prototype.sort is stable and a genuine tie can only ever be reordered by a broken comparator, never by a correct one. Exported purely for the direct unit test below pinning its exact -1/0/1 return values, including the tie case, the same reason orderKeyAscComparator above is exported.
export function entryIdAscComparator(
  a: { readonly id: string },
  b: { readonly id: string },
): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// The dedup/identity key for one edge — (from, to, kind, orderKey, path) — shared by DocumentProjection's own addEdge below and outline/graph-edit.ts's write API rebalancing insert, so the two never drift into two different notions of "the same edge". Exported for that cross-module use, not because a caller outside this projection has any reason to call it directly.
export function edgeKey(edge: GraphEdge): string {
  // No special-casing for a missing `path`: JSON.stringify(undefined) is the JS value `undefined`, which interpolates as the literal text "undefined" here — a placeholder that can never collide with a genuine JSON.stringify(path) output, since PropertyPath is always a JSON array and JSON.stringify of an array always starts with `[`.
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}\u0000${edge.orderKey}\u0000${JSON.stringify(edge.path)}`;
}

// The fractional/lexicographic order-key primitive (src/outline/order-keys.ts), re-exported under one namespace so a caller minting edges of their own (an editor inserting a sibling into an already-projected graph) reaches every operation through `orderKeys.*` rather than a second subpath import — the projection itself only ever calls `orderKeyForIndex`, but `orderKeyBetween`/`orderKeyBefore`/`orderKeyAfter`/`renumberedOrderKeys` are this module's published answer to "how do I add one more between", "how do I extend past either end", and "how do I rebalance" for exactly that consumer.
export const orderKeys = {
  orderKeyForIndex,
  orderKeyBetween,
  orderKeyBefore,
  orderKeyAfter,
  renumberedOrderKeys,
};

// OrderKeyBudgetExhaustedError, the order-key module's named rebalance signal, reaches consumers from src/index.ts directly rather than being relayed through here. This module is not a barrel, and the root surface was always where that class was meant to appear.

// This projection's node-identity recipe, under the name it is published as (ExaDev/documents.js#660): it reaches consumers from this package's root barrel, where stableContentHash deliberately does not appear — outline/hash is reachable only by subpath. The two are the same function today. If graph node identity ever genuinely needs to diverge from the leaf-hash recipe, that is a deliberate change made at the time, for its own reason.
export const contentHashV1 = stableContentHash;

// One document to project: the caller-assigned stable id (used verbatim as the root node's id) and the package itself.
export interface GraphDocument {
  readonly id: string;
  readonly package: DocumentTree;
}

export interface GraphProjectionOptions {
  readonly policy?: ExtractionPolicy;
}

// The five root fields of the definitions-table facility (src/definitions.ts in document-schema.js), in the fixed order the root walk visits them. styles is its own tenant with its own entry shape; the other four share the tenant-generic DefinitionsTable type.
const TABLE_FIELDS = [
  "styles",
  "definitions",
  "layers",
  "attachments",
  "destinations",
] as const;
type TableField = (typeof TABLE_FIELDS)[number];

type TableValue = StylesTable | DefinitionsTable;

// The graph kind each table's entries carry: styles are 'styleEntry', every generic-table entry is 'definitionEntry' (its own tenant vocabulary stays inside the entry's content, where the kind discriminator already distinguishes tenants).
function entryKindOf(field: TableField): string {
  return field === "styles" ? "styleEntry" : "definitionEntry";
}

// A table entry's node face. A generic entry's own `kind` discriminator (footnote, layer, attachment, destination...) is CONTENT — it distinguishes tenants, and the hash covers it verbatim — but `kind` is also the graph vocabulary's word for what a node IS, so the face re-houses the tenant discriminator under `tenantKind` and the graph kind wins. That makes `id`, `kind`, and `tenantKind` the face vocabulary's reserved words: an entry body spelling any of them is shadowed in the FACE by the vocabulary's own use (the body's value still hashes verbatim — only the node's graph face is affected).
function entryNodeFace(
  id: string,
  field: TableField,
  properties: Record<string, unknown>,
): GraphNode {
  const face: Record<string, unknown> = { ...properties };
  const tenantKind = face.kind;
  delete face.kind;
  return {
    ...face,
    ...(tenantKind === undefined ? {} : { tenantKind }),
    id,
    kind: entryKindOf(field),
  };
}

const TABLE_FIELD_NAMES = new Set<string>(TABLE_FIELDS);

// The default policy: extract every table entry (the reused content the definitions facility exists to hold), inline everything else — envelope facts, tree-node properties, scalars — including table entries' own innards (an entry is a unit; its halves are not re-factored). Declared as an ExtractionPolicy rather than a standalone two-parameter function so the default is typed exactly as the custom policies it sits beside (and composes with), with no unused second parameter to spell.
export const defaultExtractionPolicy: ExtractionPolicy = (path) =>
  path.length === 2 &&
  typeof path[0] === "string" &&
  TABLE_FIELD_NAMES.has(path[0])
    ? "extract"
    : "inline";

// The projected own-content walk of one value: `hash` is what feeds the owning node's stableContentHash (refs dereferenced to entry hashes, extracted values replaced by their node ids), `properties` is the graph face (the same content minus ref keys and extracted keys, which become edges), and `edges` are the DEFINED_BY/PROPERTY relations discovered inside, for the owner to emit under its own id once that id is known.
interface Walked {
  readonly hash: unknown;
  readonly properties: unknown;
  readonly edges: readonly WalkEdge[];
}

interface WalkEdge {
  readonly path: PropertyPath;
  readonly to: string;
  readonly kind: "DEFINED_BY" | "PROPERTY";
}

// The walk of a record value, where the hash input and graph face are both records — the shape every node mint reads.
interface RecordWalked {
  readonly hash: Record<string, unknown>;
  readonly properties: Record<string, unknown>;
  readonly edges: readonly WalkEdge[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The record narrowing every payload walk enters through: zod-inferred object types carry no string index signature, so they do not ASSIGN to Record<string, unknown> even though every property is unknown-compatible — this assert-narrow (the family's assertHeadingAnchor pattern) states the invariant loudly instead of casting: every schema payload is a plain record, and a non-record payload would be a walk bug worth a stack trace, not a silent pass-through.
function recordOf(value: object): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(
      "projectDocumentGraph: schema payload is not a plain record",
    );
  }
  return value;
}

// One document's projection state: the node/edge accumulators (shared across the whole run), the policy, and the memoised per-table entry decisions that keep the root's table walk and every tree ref in agreement.
//
// NO CONTENT NODE'S ID IS EVER CALLER-SUPPLIED (ExaDev/documents.js#660): every mint site below — entryNodeFace, projectLeaf, projectGroup, mintValueNode, and the root in project() — computes `id` via contentHashV1 and spreads it into the node face AFTER the content (`{ ...content, id, kind }`), so a content field that happens to be named `id` or `kind` is shadowed by the real computed value at every single mint site, unconditionally, the same discipline git applies to a blob's hash. `insertNode` (ExaDev/documents.js#935, published in this package's outline/graph-edit.ts sibling module beside `insertEdge`) is that module's write/insert API: it preserves the property STRUCTURALLY rather than by validation, because `InsertNodeContent` has no `id` field at all — there is no parameter through which a caller could supply one even by mistake — and `insertNode` computes `id` from exactly the content handed in (folding in `children` when given, the same Merkle-DAG rule `projectGroup` applies to its own children's ids) and spreads it after that content at its own single mint site, the identical discipline every read-side mint site already follows. A write path that instead accepted a caller-supplied id and merely checked it against a recomputed one would reopen the two failure modes this guards against (two different contents sharing an id, or one content split across two ids) even with the check in place — which is why the fix is a parameter that structurally cannot carry one, not a validated one.
class DocumentProjection {
  private readonly styles: StylesTable | undefined;
  private readonly definitions: DefinitionsTable | undefined;

  constructor(
    private readonly documentId: string,
    private readonly pkg: DocumentTree,
    private readonly policy: ExtractionPolicy,
    private readonly nodes: Map<string, GraphNode>,
    private readonly edges: Map<string, GraphEdge>,
  ) {
    this.styles = pkg.styles;
    this.definitions = pkg.definitions;
  }

  // The entry nodes this document's table walk minted, flushed in content-id order once the whole root walk has decided them — two spellings of one table (different local keys, different insertion orders) then emit the same nodes in the same order, because content order is the only order a content-addressed projection can canonically have.
  private readonly pendingEntryNodes: GraphNode[] = [];

  // A table entry's decided fate: extracted (node id minted, referencing nodes substitute the id) or inlined (referencing nodes fold the walked content). Memoised so the root walk and every tree ref see one decision per entry.
  private readonly tableDecisions = new Map<
    string,
    | { status: "extract"; id: string; walked: RecordWalked }
    | { status: "inline"; walked: RecordWalked }
  >();

  // Entries whose decision walk is currently on the stack. An entry's body may itself carry an anchor descriptor naming another entry (a footnote body referencing a note of its own), so an entry's walk recurses through the same deref — same-key re-entry means an entry is reachable from its own body, a cycle no content hash can cover (the hash would have to include itself), refused here by name rather than walked to a stack overflow.
  private readonly decidingEntries = new Set<string>();

  private tableOf(field: TableField): TableValue | undefined {
    return this.pkg[field];
  }

  // Decides one entry (memoised) — policy-asked with the entry's document path [field, key], walked once, node minted when extracted.
  private decideEntry(
    field: TableField,
    key: string,
  ):
    | { status: "extract"; id: string; walked: RecordWalked }
    | { status: "inline"; walked: RecordWalked } {
    const memoKey = `${field}\u0000${key}`;
    const memo = this.tableDecisions.get(memoKey);
    if (memo !== undefined) return memo;
    if (this.decidingEntries.has(memoKey)) {
      throw new Error(
        `projectDocumentGraph: ${field} table entry "${key}" is reachable from its own body (a cycle of definition refs)`,
      );
    }
    const table = this.tableOf(field);
    const entry = table?.[key];
    if (entry === undefined) {
      throw new Error(
        `projectDocumentGraph: ${field} table entry "${key}" referenced but not present`,
      );
    }
    // this.decidingEntries never needs a matching delete once decided: every path below unconditionally populates this.tableDecisions for memoKey before returning, and the memo check at the top of this method always short-circuits any later call for the same key before it could ever reach the decidingEntries.has(memoKey) cycle check above — so a stale "still deciding" marker for an already-decided key is never read again.
    this.decidingEntries.add(memoKey);
    const walked = this.walkRecord(recordOf(entry), [field, key]);
    if (this.policy([field, key], entry) === "extract") {
      const id = contentHashV1(walked.hash);
      const decided = { status: "extract" as const, id, walked };
      this.pendingEntryNodes.push(entryNodeFace(id, field, walked.properties));
      // Chained through .get() (rather than a bare .set() statement) so the memoisation write is inseparable from the value this method returns: this Map is decideEntry's only cache, so a caller reads back exactly what was just stored.
      return this.tableDecisions.set(memoKey, decided).get(memoKey)!;
    }
    const decided = { status: "inline" as const, walked };
    return this.tableDecisions.set(memoKey, decided).get(memoKey)!;
  }

  // Resolves a style ref from a group wrapper: the entry's decided fate, with the loud refusal on a ref the table does not carry (a malformed package, in the family's all-or-nothing resolution tradition).
  private resolveStyleRef(ref: string): { id?: string; walked: RecordWalked } {
    if (this.styles?.[ref] === undefined) {
      throw new Error(
        `projectDocumentGraph: style ref "${ref}" names no entry in the styles table`,
      );
    }
    const decided = this.decideEntry("styles", ref);
    return decided.status === "extract"
      ? { id: decided.id, walked: decided.walked }
      : { walked: decided.walked };
  }

  // Resolves an anchor descriptor's definitions ref the same way.
  private resolveDefinitionRef(ref: string): {
    id?: string;
    walked: RecordWalked;
  } {
    if (this.definitions?.[ref] === undefined) {
      throw new Error(
        `projectDocumentGraph: definition ref "${ref}" names no entry in the definitions table`,
      );
    }
    const decided = this.decideEntry("definitions", ref);
    return decided.status === "extract"
      ? { id: decided.id, walked: decided.walked }
      : { walked: decided.walked };
  }

  // Unconditional set, not an upsert-once guard: two mint sites computing the identical `node.id` necessarily walked identical content through the identical recipe (contentHashV1 is a pure function of that content) — for the two entry-tenant families that could otherwise collide, a StyleEntry never carries its own `kind` field while every generic-table entry (DefinitionEntrySchema) always requires one, so a styles-table id can never coincide with a definitions/layers/attachments/destinations-table id, and any two entries WITHIN the generic-table family already map to the identical graph `kind` ("definitionEntry") regardless of which tenant table minted them. Overwriting an existing entry for the same id therefore writes back the identical value.
  private addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  // Unconditional set, not an upsert-once guard: edgeKey's own five components (from, to, kind, orderKey, path) are exactly GraphEdge's whole field set, so two edges producing the identical key are already structurally identical objects — overwriting one with the other writes back the identical value.
  private addEdge(edge: GraphEdge): void {
    this.edges.set(edgeKey(edge), edge);
  }

  // The generic own-content walk: records rebuild key by key (asking the policy at every property, array elements are never extraction candidates — a whole element cannot move to a node without breaking its position, while its properties stay addressable), arrays walk their elements, scalars pass through. The one typed ref inside content is an anchor descriptor's `definition` key, recognised by the containing record's own `kind: 'anchor'` discriminator — the discriminator, not the key name alone, because the walk reads definitions-table bodies too and those bodies are tenant vocabulary where a same-named key is content (a glossary entry's `definition` is the term's meaning, and one that coincidentally names a real key must stay content rather than silently enter a hash as a ref id). Dereferenced per the module's rule: the referenced entry's hash for the hash input, never the bare local key.
  private walk(value: unknown, path: PropertyPath): Walked {
    if (Array.isArray(value)) {
      const hashes: unknown[] = [];
      const properties: unknown[] = [];
      const edges: WalkEdge[] = [];
      value.forEach((element, index) => {
        const walked = this.walk(element, [...path, index]);
        hashes.push(walked.hash);
        properties.push(walked.properties);
        edges.push(...walked.edges);
      });
      return { hash: hashes, properties, edges };
    }
    if (isRecord(value)) return this.walkRecord(value, path);
    return { hash: value, properties: value, edges: [] };
  }

  private walkRecord(
    value: Record<string, unknown>,
    path: PropertyPath,
  ): RecordWalked {
    const hash: Record<string, unknown> = {};
    const properties: Record<string, unknown> = {};
    const edges: WalkEdge[] = [];
    for (const key of Object.keys(value)) {
      if (key === "$schema") continue; // a serialised dump's release label is transport metadata, not content — the hash recipe's own rule 1, kept true for the graph face too
      const child = value[key];
      if (
        key === "definition" &&
        typeof child === "string" &&
        value.kind === "anchor"
      ) {
        const resolved = this.resolveDefinitionRef(child);
        if (resolved.id !== undefined) {
          hash.definition = resolved.id;
          edges.push({
            path: [...path, "definition"],
            to: resolved.id,
            kind: "DEFINED_BY",
          });
        } else {
          hash.definition = resolved.walked.hash;
          properties.definition = resolved.walked.properties;
        }
        continue;
      }
      const childPath: PropertyPath = [...path, key];
      if (this.policy(childPath, child) === "extract") {
        const id = this.mintValueNode(child, childPath);
        hash[key] = id;
        edges.push({ path: childPath, to: id, kind: "PROPERTY" });
        continue;
      }
      const walked = this.walk(child, childPath);
      hash[key] = walked.hash;
      properties[key] = walked.properties;
      edges.push(...walked.edges);
    }
    return { hash, properties, edges };
  }

  // Mints the node for a policy-extracted value: its id is the content hash of its own walked content, its kind is 'value', and a record value's properties are its walked face (a scalar or array rides under `value` — a bare node with no properties would lose its payload). One walk per value, never two — the id and the face must read the same walk.
  private mintValueNode(value: unknown, path: PropertyPath): string {
    if (isRecord(value)) {
      const walked = this.walkRecord(value, path);
      const id = contentHashV1(walked.hash);
      this.addNode({ ...walked.properties, id, kind: "value" });
      this.emitWalkEdges(id, walked.edges);
      return id;
    }
    const walked = this.walk(value, path);
    const id = contentHashV1(walked.hash);
    this.addNode({ id, kind: "value", value: walked.properties });
    this.emitWalkEdges(id, walked.edges);
    return id;
  }

  // DEFINED_BY/PROPERTY relations discovered inside one owner's own content walk: always one owner-relative position (0), never a document-order sequence like CONTAINS/STYLED_BY's — an owner's `path` already disambiguates more than one such edge from the same owner, so the orderKey exists here only to satisfy the edge shape uniformly, not to carry a real sequence.
  private emitWalkEdges(
    ownerId: string,
    walkedEdges: readonly WalkEdge[],
  ): void {
    for (const edge of walkedEdges) {
      this.addEdge({
        from: ownerId,
        to: edge.to,
        kind: edge.kind,
        orderKey: orderKeys.orderKeyForIndex(0),
        path: edge.path,
      });
    }
  }

  // The whole document: root node (caller id, envelope facts inline, leftover inlined table entries inline), table-entry nodes (decided and minted up front, emitted sorted by id so differently-spelled key sets yield the same node order), then the tree in pre-order with CONTAINS/STYLED_BY/DEFINED_BY edges.
  project(): void {
    const envelope: Record<string, unknown> = { metadata: this.pkg.metadata };
    if (this.pkg.symbolTable !== undefined)
      envelope.symbolTable = this.pkg.symbolTable;
    if (this.pkg.pages !== undefined) envelope.pages = this.pkg.pages;
    if (this.pkg.source !== undefined) envelope.source = this.pkg.source;
    const envelopeWalk = this.walkRecord(envelope, []);

    // Decide every present table's entries first: dependency order, so the tree's ref substitutions read memoised decisions (an entry's own body may reference further entries through its anchor markers — decideEntry recurses through the deref and refuses a cycle among entries loudly). Inlined entries fold back into a root table property; a table whose every entry extracted leaves no property behind.
    const leftoverTables: Record<string, Record<string, unknown>> = {};
    for (const field of TABLE_FIELDS) {
      const table = this.tableOf(field);
      if (table === undefined) continue;
      const leftover: Record<string, unknown> = {};
      // Visiting order need not be sorted: decideEntry is memoised and its own per-entry decision never depends on which OTHER entry was decided first (a reference to another entry resolves through the identical deref regardless of outer iteration order, and object key order is never itself compared by any equality check downstream), so plain Object.keys(table) decides the identical set of entries with the identical values.
      for (const key of Object.keys(table)) {
        const decided = this.decideEntry(field, key);
        if (decided.status === "inline")
          leftover[key] = decided.walked.properties;
      }
      if (Object.keys(leftover).length > 0) leftoverTables[field] = leftover;
    }

    // The root node lands first, then this document's entry nodes in content-id order, then the tree in pre-order.
    this.addNode({
      ...envelopeWalk.properties,
      ...leftoverTables,
      id: this.documentId,
      kind: "documentTree",
      documentKind: this.pkg.kind,
    });
    for (const node of this.pendingEntryNodes.sort(entryIdAscComparator)) {
      this.addNode(node);
    }

    // Children first (ids needed for the root's CONTAINS edges), edges assembled own-first so each parent's edges precede its descendants'. The root carries no style ref of its own, so every child starts resolution with an empty chain.
    const childResults = this.pkg.children.map((child, index) => {
      const result = this.projectChild(child, []);
      this.addEdge({
        from: this.documentId,
        to: result.id,
        kind: "CONTAINS",
        orderKey: orderKeys.orderKeyForIndex(index),
      });
      return result;
    });
    this.emitWalkEdges(this.documentId, envelopeWalk.edges);
    for (const result of childResults) {
      for (const edge of result.edges) this.addEdge(edge);
    }
  }

  private projectChild(
    child: AnyChild,
    chain: readonly string[],
  ): { id: string; edges: GraphEdge[] } {
    if (isGroupChild(child)) return this.projectGroup(child, chain);
    return this.projectLeaf(child, chain);
  }

  // One STYLED_BY edge per entry of `chain` that a custom policy has not inlined, outermost-first (ExaDev/documents.js#660): shared by an anchor group's inherited-plus-own chain and a bare paragraph leaf's inherited-only chain, since both resolve the same way once the chain to walk is settled. An inlined position (resolved.id === undefined) contributes no edge here — its content already rides wherever the caller folded it (a group's own inlined ref folds into its own face/hashInput outside this helper; an inherited inlined position was never surfaced before #660 and stays un-emitted, per the design's "edge-emission only" constraint).
  private styleChainEdges(
    ownerId: string,
    chain: readonly string[],
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];
    chain.forEach((ref, position) => {
      const resolved = this.resolveStyleRef(ref);
      if (resolved.id !== undefined) {
        edges.push({
          from: ownerId,
          to: resolved.id,
          kind: "STYLED_BY",
          orderKey: orderKeys.orderKeyForIndex(position),
        });
      }
    });
    return edges;
  }

  // One tree group: own payload walked generically (refs dereferenced, extractions substituted), children projected recursively, hash input = walked payload + child ids + the style entry's id — the Merkle-DAG rule. The wrapper's style key never reaches the node's properties: extracted, it is a STYLED_BY edge; inlined by a custom policy, the dereferenced ENTRY CONTENT is spelled in place (never the local key). `chain` is the ancestor style refs resolved so far (outermost first, ExaDev/documents.js#660); `own` extends it by this group's own ref exactly as effective.ts's chainWithRef does, and is what descendants receive — but only a heading/list ANCHOR (isAnchor, the same paragraph-node discriminant effective.ts resolves against) actually emits edges for the inherited portion: every other wrapper kind is not a resolution target in effective.ts either, so its behaviour is unchanged from pre-#660 (at most its own single ref, never the inherited chain).
  private projectGroup(
    group: TreeGroup,
    chain: readonly string[],
  ): { id: string; edges: GraphEdge[] } {
    const walked = this.walkRecord(recordOf(group.node), []);
    const own = group.style === undefined ? chain : [...chain, group.style];
    const childResults = group.children.map((child, index) => ({
      result: this.projectChild(child, own),
      index,
    }));
    const hashInput: Record<string, unknown> = {
      ...walked.hash,
      children: childResults.map(({ result }) => result.id),
    };
    const face: Record<string, unknown> = { ...walked.properties };
    // Hash/face folding reads only this group's OWN ref, exactly as before #660 — the inherited portion of `own` never touches identity, only edge emission below.
    let styledByOwn: { to: string } | undefined;
    if (group.style !== undefined) {
      const resolved = this.resolveStyleRef(group.style);
      if (resolved.id !== undefined) {
        hashInput.style = resolved.id;
        styledByOwn = { to: resolved.id };
      } else {
        hashInput.style = resolved.walked.hash;
        face.style = resolved.walked.properties;
      }
    }
    const id = contentHashV1(hashInput);
    const isAnchor = kindOf(recordOf(group.node)) === "paragraph"; // true for HeadingGroupNode/ListGroupNode only — no other group kind's node carries kind: 'paragraph'
    const edges: GraphEdge[] = childResults.map(({ result, index }) => ({
      from: id,
      to: result.id,
      kind: "CONTAINS" as const,
      orderKey: orderKeys.orderKeyForIndex(index),
    }));
    if (isAnchor) {
      edges.push(...this.styleChainEdges(id, own));
    } else if (styledByOwn !== undefined) {
      edges.push({
        from: id,
        to: styledByOwn.to,
        kind: "STYLED_BY",
        orderKey: orderKeys.orderKeyForIndex(0),
      });
    }
    this.addNode({ ...face, id, kind: kindOf(recordOf(group.node)) });
    this.emitWalkEdges(id, walked.edges);
    return {
      id,
      edges: [...edges, ...childResults.flatMap(({ result }) => result.edges)],
    };
  }

  // One tree leaf: its own walked content is the whole hash input, untouched by `chain` — a leaf's identity has never depended on ancestor style, and #660 does not change that. A bare, non-anchor paragraph leaf (the isGroupChild dispatch in projectChild guarantees anchors never reach here) additionally emits one STYLED_BY edge per inherited chain entry, since a leaf carries no ref of its own to append.
  private projectLeaf(
    leaf: AnyChild,
    chain: readonly string[],
  ): { id: string; edges: GraphEdge[] } {
    const walked = this.walkRecord(recordOf(leaf), []);
    const id = contentHashV1(walked.hash);
    this.addNode({ ...walked.properties, id, kind: kindOf(recordOf(leaf)) });
    this.emitWalkEdges(id, walked.edges);
    const styledBy =
      kindOf(recordOf(leaf)) === "paragraph"
        ? this.styleChainEdges(id, chain)
        : [];
    return { id, edges: styledBy };
  }
}

// Everything that can sit at a child position of any container, root groups included: the schema's own group and leaf unions, so every per-kind children array assigns into one walk.
type AnyChild = TreeGroup | TreeLeaf;

function isGroupChild(child: AnyChild): child is TreeGroup {
  // A single field check, not a pair: for any schema-valid TreeGroup | TreeLeaf value, `node` and `children` are always co-present (every TreeGroup carries both, by its own type) or co-absent (no TreeLeaf variant carries either), so checking one is exactly as discriminating as checking both.
  return "node" in child;
}

// A projected node's graph kind: the payload's own kind tag when it carries one (paragraph, section, slide, sheet, drawPage, the construct kinds, the vector kinds, image, pageBreak, table, embeddedObject as a block leaf); the three kind-less payloads get structural names — a sheet-anchored embedded object, a formula document's single leaf, and a shape group's frame descriptor.
function kindOf(payload: Record<string, unknown>): string {
  if (typeof payload.kind === "string") return payload.kind;
  if ("objectKind" in payload) return "embeddedObject";
  if ("mathml" in payload) return "formula";
  return "shape";
}

// Projects one or several DocumentTrees into a single deduplicated property graph. Documents project in input order; content nodes are deduplicated by content-hash id across the whole run, so a value shared by any two positions — within one document or across several — is one node with one edge per referencing position.
export function projectDocumentGraph(
  documents: readonly GraphDocument[],
  options: GraphProjectionOptions = {},
): PropertyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const policy = options.policy ?? defaultExtractionPolicy;
  const documentIds = new Set<string>();
  for (const document of documents) {
    // A repeated document id would silently merge two roots (first write wins) and lose a document — the root id is the one identity this projection trusts the caller to assign, so it refuses a collision loudly.
    if (documentIds.has(document.id)) {
      throw new Error(
        `projectDocumentGraph: document id "${document.id}" assigned to more than one document`,
      );
    }
    documentIds.add(document.id);
    new DocumentProjection(
      document.id,
      document.package,
      policy,
      nodes,
      edges,
    ).project();
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

// An edge shape wide enough for walkPropertyGraph to traverse: this module's own GraphEdge satisfies it structurally (GraphEdgeKind is a string), and so does a hand-built graph using a caller's own edge-kind vocabulary — the walk itself only ever compares kinds and orderKeys as opaque strings, so pinning the parameter to GraphEdgeKind's own closed vocabulary would refuse a legitimately different, caller-defined graph for no reason the traversal itself needs.
export interface GraphEdgeLike {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly orderKey: string;
  readonly path?: PropertyPath;
}

// The graph-shaped input walkPropertyGraph accepts: a PropertyGraph already satisfies this (a GraphEdge is a GraphEdgeLike with its kind narrowed), and so does any other { nodes, edges } value with the same field shapes.
export interface GraphLike {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdgeLike[];
}

// One entry of a walkPropertyGraph traversal: the node reached, and the edge traversed to reach it (undefined only for the start node, which is reached by no edge at all).
export interface WalkedNode {
  readonly node: GraphNode;
  readonly edge: GraphEdgeLike | undefined;
}

export interface WalkPropertyGraphOptions {
  // Restrict traversal to these edge kinds; omit to traverse every kind present at each node.
  readonly kinds?: readonly GraphEdgeKind[];
}

// A shared pre-order depth-first walker over a PropertyGraph (ExaDev/documents.js#660), so every consumer of this projection's output — an outline renderer walking CONTAINS, a style-chain reader walking STYLED_BY, a generic graph browser walking everything — shares one traversal and one cycle policy instead of each hand-rolling its own. At each node, outgoing edges (edge.from === node.id) are filtered to `options.kinds` when given, else every kind present, and visited sorted ascending by orderKey — which is what makes a CONTAINS walk reproduce document order and a STYLED_BY walk reproduce the resolution chain in order (#660's whole point for ordering keys).
//
// The cycle guard is derived from the kinds being traversed, never separately configured: CONTAINS alone needs no guard at all — every CONTAINS edge minted directly by projectDocumentGraph's own tree walk points from a node whose hash already covers the target's hash, so a path built purely from those edges can never lead back to its own ancestor. A CONTAINS edge insertEdge or insertNode attaches onto an already-existing PropertyGraph carries no such hash relationship by itself — an id can be the target of an insertEdge call before any node with that id exists, and a later insertNode call can mint exactly that id, so hash-folding alone cannot rule out a cycle closing across two calls — so both of those attachment sites refuse any CONTAINS attachment that would close a cycle back to one of `to`'s own descendants (ContainsCycleError), via one shared, edge-only reachability check that works correctly whether or not the endpoints are nodes yet (see the note above ContainsCycleError in outline/graph-edit.ts for why node presence cannot be the test). The acyclicity this fast path relies on is upheld by that shared refusal being the ONLY way a CONTAINS edge ever enters a graph outside of projectDocumentGraph's own tree walk, not by every CONTAINS edge remaining hash-derived. The on-stack set below is allocated and maintained unconditionally, including for a CONTAINS-only walk where it can provably never actually suppress anything — a few unused Set operations, not a behavioural branch. Traversing any other kind (including the default "every kind present", since STYLED_BY/DEFINED_BY/PROPERTY edges carry no acyclicity guarantee of their own — a hand-built or malicious graph can point them anywhere) maintains a Set of the current DFS path's node ids; descending into a neighbour already on that path is skipped entirely (no WalkedNode emitted, no recursion), which suppresses a true cycle while still visiting a node reached via two different, non-nested paths once per path, because neither occurrence is an ancestor of the other — exactly the same multi-parent sharing a CONTAINS walk already relies on.
export function walkPropertyGraph(
  graph: GraphLike,
  startId: string,
  options?: WalkPropertyGraphOptions,
): readonly WalkedNode[] {
  const kinds = options?.kinds;
  const kindSet = kinds === undefined ? undefined : new Set<string>(kinds);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoingByFrom = new Map<string, GraphEdgeLike[]>();
  for (const edge of graph.edges) {
    if (kindSet !== undefined && !kindSet.has(edge.kind)) continue;
    const bucket = outgoingByFrom.get(edge.from);
    if (bucket === undefined) outgoingByFrom.set(edge.from, [edge]);
    else bucket.push(edge);
  }
  for (const bucket of outgoingByFrom.values())
    bucket.sort(orderKeyAscComparator);

  // Always allocated, even for a CONTAINS-only walk where it is provably never needed (every CONTAINS edge projectDocumentGraph itself mints is hash-derived and therefore acyclic, per this function's own module comment): the guard's own on-path Set tracks only the CURRENT DFS ancestors, never nodes finished and popped off it, so it costs nothing but a few unused Set operations for a graph that can never actually cycle on CONTAINS alone.
  const onPath = new Set<string>();
  const visited: WalkedNode[] = [];

  function visit(nodeId: string, edge: GraphEdgeLike | undefined): void {
    const node = nodesById.get(nodeId);
    if (node === undefined) return; // an edge naming a node absent from this graph is not this walker's concern to diagnose
    visited.push({ node, edge });
    onPath.add(nodeId);
    for (const outgoing of outgoingByFrom.get(nodeId) ?? []) {
      if (onPath.has(outgoing.to)) continue; // already an ancestor on this path: a genuine cycle, suppressed rather than recursed into
      visit(outgoing.to, outgoing);
    }
    onPath.delete(nodeId);
  }

  visit(startId, undefined);
  return visited;
}
