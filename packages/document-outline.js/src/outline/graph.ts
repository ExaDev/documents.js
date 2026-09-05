import type {
  DefinitionsTable,
  DocumentTree,
  StylesTable,
  TreeGroup,
  TreeLeaf,
} from "document-schema.js";
import { stableContentHash } from "./hash";
import {
  OrderKeyBudgetExhaustedError,
  orderKeyAfter,
  orderKeyBefore,
  orderKeyBetween,
  orderKeyForIndex,
  renumberedOrderKeys,
} from "./order-keys";

// The content-addressed graph projection of ExaDev/documents.js#659: one or several tree-form DocumentTrees exported as a property graph (nodes + typed edges) with content-based deduplication, no DocumentTree schema change. Node identity is COMPUTED, not stored: every content node's id is the stableContentHash of its own projected content -- the canonicalise-then-hash recipe this package already publishes (src/outline/hash.ts), applied bottom-up as a Merkle DAG. A leaf's hash covers its own content; a group's hash covers its own properties plus its children's hashes (and the hash of whatever table entry its refs point at), so a node can be shared by any number of parents -- arbitrary fan-out, data-bearing internal nodes, multi-parent sharing, exactly git's and IPFS's object model rather than a strict binary Merkle tree.
//
// Containment is an EDGE, not tree position, because a shared node has no single position: (parent)-[:CONTAINS {orderKey}]->(child), orderKey being a fractional/lexicographic string derived from the child's index in the parent's document order (graph edges are unordered by default and document order is semantically load-bearing). A style ref becomes one or more (group|leaf)-[:STYLED_BY {orderKey}]->(entry) edges -- one per entry in the resolved ancestor chain, outermost first (ExaDev/documents.js#660) -- and an anchor descriptor's definitions ref becomes (node)-[:DEFINED_BY {orderKey}]->(entry); policy-extracted property values become (node)-[:PROPERTY {orderKey, path}]->(value). Every edge carries an orderKey rather than a dense integer so a later single insertion (an editor building on this projection) can mint one new key strictly between its neighbours without renumbering any edge that did not move -- see src/outline/order-keys.ts, re-exported here as `orderKeys`.
//
// DEREFFING BEFORE HASHING is the load-bearing rule for cross-document dedup: a `style: 's1'` ref (or an anchor's `definition: 'n1'`) is a document-local label with no cross-document meaning -- every assembled package mints its own s1, s2, ... keys -- so the projector substitutes the referenced ENTRY'S content hash into the referencing node's hash input and never hashes the bare key. Two structurally identical paragraphs whose documents name an identical style entry differently therefore dedupe to one node. Hashing runs in dependency order for the same reason: table entries first, tree nodes second (using the already-computed entry hashes) -- and an entry's own body may reference further entries (a footnote body carrying an anchor marker naming a note of its own), so an entry's walk recurses through the same deref while a cycle of entries, which no content hash can cover, is refused loudly.
//
// The document ROOT is the one node whose id is not computed: content hashing the root would change its id on every edit (any interior edit cascades up the DAG), which is the wrong identity scheme for "this document" as a persistently addressed thing. The caller assigns a stable external id -- a git ref pointing at a moving commit hash -- and the projection uses it verbatim. Package-level metadata/symbolTable/pages/source stay direct properties of the root even when two documents' values coincide: they are per-document identity facts, not reused content.
//
// EDITS fall out of content-hash identity rather than being implemented: modifying a node's content mints a NEW node (the old one persists, still referenced by whatever pointed at it -- free version history if orphans are never pruned); inserting a sibling touches only that one new CONTAINS edge's orderKey (minted with orderKeyBetween between two neighbours, orderKeyBefore/orderKeyAfter at a drifted list's ends, or a fresh renumberedOrderKeys rebalance once the budget is exhausted), because identity never depended on position and a fractional key never forces its neighbours to move.
//
// The EXTRACT-OR-INLINE decision is one pluggable policy consulted uniformly at every level -- root envelope fields, table entries, tree-node properties, individual scalars -- as (path, value) => extract | inline, with paths relative to the OWNING node (the entity whose content the value sits in) and continuing through nested values. The default extracts exactly the definitions-table facility's entries (styles, definitions, layers, attachments, destinations -- the reused content the tables exist to hold) and leaves everything else inline: an assembled package's recurring property tuples are already factored into its tables by minting's own recurrence rule (src/factor-styles.ts in document-schema.js), so a one-off italic stays inline and a style used by two paragraphs arrives as a table entry this projection surfaces as one shared node. The default performs no frequency survey of its own: on an assembled package the tables ARE minting's extract decision -- its recurrence rule factored the tuples it chose to share and left the rest inline by design (runner-up tuples at a wrapper, since a wrapper mints at most one entry; the per-node facts style entries are banned from carrying; and non-property content such as recurring text, which the worked example pins as inline -- sharing happens at the node level), so a surveying default would second-guess minting's compression rather than fill a gap. A hand-built or round-tripped tree that never ran the factoring pass can carry recurring style-shaped tuples inline, where a survey generalised to any value would extract and this default inlines; factorStyles first is the caller's route to the canonical spelling, and effectivePackage first is the route to factoring-invariant hashes -- a factored and an unfactored spelling of one document deliberately project to different node ids for the nodes the style rides, because the hash covers each node's own projected content, never style-resolved content. A custom policy can widen extraction to any value at any path -- extracted values become kind 'value' nodes joined by PROPERTY edges carrying the property path.
//
// Dedup itself needs no bespoke merge logic: identical content yields an identical hash yields an identical id, so the projection keeps one node per id and one edge per (from, to, kind, orderKey, path) tuple, which is exactly what a graph store's native upsert (Neo4j MERGE, an RDF store keyed by the hash) would do with this output. An identical whole subtree collapses to one shared subtree with only the seam edges from each document's own ancestors being document-specific; a single shared leaf inside otherwise-different structure shares only that leaf. Table entries that nothing references are still emitted as nodes -- they are document content, reachable by kind queries.
//
// ExaDev/documents.js#660 hardens this projection for use as a real graph-native store rather than a one-shot export: (1) CONTAINS/STYLED_BY/DEFINED_BY/PROPERTY edges carry a fractional orderKey instead of a dense integer, so a later insertion touches one edge, never a renumber (order-keys.ts, re-exported as `orderKeys`); (2) `contentHashV1` names this module's own node-identity recipe as a versioned contract, independent of hash.ts's own leafContentHash contract even though they share an implementation today; (3) no content node's id is ever caller-supplied -- see the doc comment on DocumentProjection; (4) a heading or list anchor, and a bare paragraph leaf, emit one STYLED_BY edge per entry in their resolved style chain rather than only their own direct ref, so a consumer can walk the whole resolution chain from edges alone; (5) `walkPropertyGraph` is a shared traversal with a cycle guard that activates automatically whenever a non-CONTAINS edge kind is in play.

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

// The dedup/identity key for one edge -- (from, to, kind, orderKey, path) -- shared by DocumentProjection's own addEdge below and the write API's rebalancing insert further down, so the two never drift into two different notions of "the same edge".
function edgeKey(edge: GraphEdge): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}\u0000${edge.orderKey}\u0000${edge.path === undefined ? "" : JSON.stringify(edge.path)}`;
}

// The fractional/lexicographic order-key primitive (src/outline/order-keys.ts), re-exported under one namespace so a caller minting edges of their own (an editor inserting a sibling into an already-projected graph) reaches every operation through `orderKeys.*` rather than a second subpath import -- the projection itself only ever calls `orderKeyForIndex`, but `orderKeyBetween`/`orderKeyBefore`/`orderKeyAfter`/`renumberedOrderKeys` are this module's published answer to "how do I add one more between", "how do I extend past either end", and "how do I rebalance" for exactly that consumer.
export const orderKeys = {
  orderKeyForIndex,
  orderKeyBetween,
  orderKeyBefore,
  orderKeyAfter,
  renumberedOrderKeys,
};

// OrderKeyBudgetExhaustedError, the order-key module's named rebalance signal, reaches consumers from src/index.ts directly rather than being relayed through here. This module is not a barrel, and the root surface was always where that class was meant to appear.

// This projection's node-identity recipe, under the name it is published as (ExaDev/documents.js#660): it reaches consumers from this package's root barrel, where stableContentHash deliberately does not appear -- outline/hash is reachable only by subpath. The two are the same function today. If graph node identity ever genuinely needs to diverge from the leaf-hash recipe, that is a deliberate change made at the time, for its own reason.
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

// A table entry's node face. A generic entry's own `kind` discriminator (footnote, layer, attachment, destination...) is CONTENT -- it distinguishes tenants, and the hash covers it verbatim -- but `kind` is also the graph vocabulary's word for what a node IS, so the face re-houses the tenant discriminator under `tenantKind` and the graph kind wins. That makes `id`, `kind`, and `tenantKind` the face vocabulary's reserved words: an entry body spelling any of them is shadowed in the FACE by the vocabulary's own use (the body's value still hashes verbatim -- only the node's graph face is affected).
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

// The default policy: extract every table entry (the reused content the definitions facility exists to hold), inline everything else -- envelope facts, tree-node properties, scalars -- including table entries' own innards (an entry is a unit; its halves are not re-factored). Declared as an ExtractionPolicy rather than a standalone two-parameter function so the default is typed exactly as the custom policies it sits beside (and composes with), with no unused second parameter to spell.
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

// The walk of a record value, where the hash input and graph face are both records -- the shape every node mint reads.
interface RecordWalked {
  readonly hash: Record<string, unknown>;
  readonly properties: Record<string, unknown>;
  readonly edges: readonly WalkEdge[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The record narrowing every payload walk enters through: zod-inferred object types carry no string index signature, so they do not ASSIGN to Record<string, unknown> even though every property is unknown-compatible -- this assert-narrow (the family's assertHeadingAnchor pattern) states the invariant loudly instead of casting: every schema payload is a plain record, and a non-record payload would be a walk bug worth a stack trace, not a silent pass-through.
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
// NO CONTENT NODE'S ID IS EVER CALLER-SUPPLIED (ExaDev/documents.js#660): every mint site below -- entryNodeFace, projectLeaf, projectGroup, mintValueNode, and the root in project() -- computes `id` via contentHashV1 and spreads it into the node face AFTER the content (`{ ...content, id, kind }`), so a content field that happens to be named `id` or `kind` is shadowed by the real computed value at every single mint site, unconditionally, the same discipline git applies to a blob's hash. `insertNode` (ExaDev/documents.js#935, published near the bottom of this module beside `insertEdge`) is this module's write/insert API: it preserves the property STRUCTURALLY rather than by validation, because `InsertNodeContent` has no `id` field at all -- there is no parameter through which a caller could supply one even by mistake -- and `insertNode` computes `id` from exactly the content handed in (folding in `children` when given, the same Merkle-DAG rule `projectGroup` applies to its own children's ids) and spreads it after that content at its own single mint site, the identical discipline every read-side mint site already follows. A write path that instead accepted a caller-supplied id and merely checked it against a recomputed one would reopen the two failure modes this guards against (two different contents sharing an id, or one content split across two ids) even with the check in place -- which is why the fix is a parameter that structurally cannot carry one, not a validated one.
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

  // The entry nodes this document's table walk minted, flushed in content-id order once the whole root walk has decided them -- two spellings of one table (different local keys, different insertion orders) then emit the same nodes in the same order, because content order is the only order a content-addressed projection can canonically have.
  private pendingEntryNodes: GraphNode[] = [];

  // A table entry's decided fate: extracted (node id minted, referencing nodes substitute the id) or inlined (referencing nodes fold the walked content). Memoised so the root walk and every tree ref see one decision per entry.
  private readonly tableDecisions = new Map<
    string,
    | { status: "extract"; id: string; walked: RecordWalked }
    | { status: "inline"; walked: RecordWalked }
  >();

  // Entries whose decision walk is currently on the stack. An entry's body may itself carry an anchor descriptor naming another entry (a footnote body referencing a note of its own), so an entry's walk recurses through the same deref -- same-key re-entry means an entry is reachable from its own body, a cycle no content hash can cover (the hash would have to include itself), refused here by name rather than walked to a stack overflow.
  private readonly decidingEntries = new Set<string>();

  private tableOf(field: TableField): TableValue | undefined {
    return this.pkg[field];
  }

  // Decides one entry (memoised) -- policy-asked with the entry's document path [field, key], walked once, node minted when extracted.
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
    this.decidingEntries.add(memoKey);
    const walked = this.walkRecord(recordOf(entry), [field, key]);
    this.decidingEntries.delete(memoKey);
    if (this.policy([field, key], entry) === "extract") {
      const id = contentHashV1(walked.hash);
      const decided = { status: "extract" as const, id, walked };
      this.tableDecisions.set(memoKey, decided);
      this.pendingEntryNodes.push(entryNodeFace(id, field, walked.properties));
      return decided;
    }
    const decided = { status: "inline" as const, walked };
    this.tableDecisions.set(memoKey, decided);
    return decided;
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

  private addNode(node: GraphNode): void {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
  }

  private addEdge(edge: GraphEdge): void {
    const key = edgeKey(edge);
    if (!this.edges.has(key)) this.edges.set(key, edge);
  }

  // The generic own-content walk: records rebuild key by key (asking the policy at every property, array elements are never extraction candidates -- a whole element cannot move to a node without breaking its position, while its properties stay addressable), arrays walk their elements, scalars pass through. The one typed ref inside content is an anchor descriptor's `definition` key, recognised by the containing record's own `kind: 'anchor'` discriminator -- the discriminator, not the key name alone, because the walk reads definitions-table bodies too and those bodies are tenant vocabulary where a same-named key is content (a glossary entry's `definition` is the term's meaning, and one that coincidentally names a real key must stay content rather than silently enter a hash as a ref id). Dereferenced per the module's rule: the referenced entry's hash for the hash input, never the bare local key.
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
      if (key === "$schema") continue; // a serialised dump's release label is transport metadata, not content -- the hash recipe's own rule 1, kept true for the graph face too
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

  // Mints the node for a policy-extracted value: its id is the content hash of its own walked content, its kind is 'value', and a record value's properties are its walked face (a scalar or array rides under `value` -- a bare node with no properties would lose its payload). One walk per value, never two -- the id and the face must read the same walk.
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

  // DEFINED_BY/PROPERTY relations discovered inside one owner's own content walk: always one owner-relative position (0), never a document-order sequence like CONTAINS/STYLED_BY's -- an owner's `path` already disambiguates more than one such edge from the same owner, so the orderKey exists here only to satisfy the edge shape uniformly, not to carry a real sequence.
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

    // Decide every present table's entries first: dependency order, so the tree's ref substitutions read memoised decisions (an entry's own body may reference further entries through its anchor markers -- decideEntry recurses through the deref and refuses a cycle among entries loudly). Inlined entries fold back into a root table property; a table whose every entry extracted leaves no property behind.
    const leftoverTables: Record<string, Record<string, unknown>> = {};
    for (const field of TABLE_FIELDS) {
      const table = this.tableOf(field);
      if (table === undefined) continue;
      const leftover: Record<string, unknown> = {};
      for (const key of Object.keys(table).sort()) {
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
    for (const node of this.pendingEntryNodes.sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )) {
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

  // One STYLED_BY edge per entry of `chain` that a custom policy has not inlined, outermost-first (ExaDev/documents.js#660): shared by an anchor group's inherited-plus-own chain and a bare paragraph leaf's inherited-only chain, since both resolve the same way once the chain to walk is settled. An inlined position (resolved.id === undefined) contributes no edge here -- its content already rides wherever the caller folded it (a group's own inlined ref folds into its own face/hashInput outside this helper; an inherited inlined position was never surfaced before #660 and stays un-emitted, per the design's "edge-emission only" constraint).
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

  // One tree group: own payload walked generically (refs dereferenced, extractions substituted), children projected recursively, hash input = walked payload + child ids + the style entry's id -- the Merkle-DAG rule. The wrapper's style key never reaches the node's properties: extracted, it is a STYLED_BY edge; inlined by a custom policy, the dereferenced ENTRY CONTENT is spelled in place (never the local key). `chain` is the ancestor style refs resolved so far (outermost first, ExaDev/documents.js#660); `own` extends it by this group's own ref exactly as effective.ts's chainWithRef does, and is what descendants receive -- but only a heading/list ANCHOR (isAnchor, the same paragraph-node discriminant effective.ts resolves against) actually emits edges for the inherited portion: every other wrapper kind is not a resolution target in effective.ts either, so its behaviour is unchanged from pre-#660 (at most its own single ref, never the inherited chain).
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
    // Hash/face folding reads only this group's OWN ref, exactly as before #660 -- the inherited portion of `own` never touches identity, only edge emission below.
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
    const isAnchor = kindOf(recordOf(group.node)) === "paragraph"; // true for HeadingGroupNode/ListGroupNode only -- no other group kind's node carries kind: 'paragraph'
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

  // One tree leaf: its own walked content is the whole hash input, untouched by `chain` -- a leaf's identity has never depended on ancestor style, and #660 does not change that. A bare, non-anchor paragraph leaf (the isGroupChild dispatch in projectChild guarantees anchors never reach here) additionally emits one STYLED_BY edge per inherited chain entry, since a leaf carries no ref of its own to append.
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
  return "node" in child && "children" in child;
}

// A projected node's graph kind: the payload's own kind tag when it carries one (paragraph, section, slide, sheet, drawPage, the construct kinds, the vector kinds, image, pageBreak, table, embeddedObject as a block leaf); the three kind-less payloads get structural names -- a sheet-anchored embedded object, a formula document's single leaf, and a shape group's frame descriptor.
function kindOf(payload: Record<string, unknown>): string {
  if (typeof payload.kind === "string") return payload.kind;
  if ("objectKind" in payload) return "embeddedObject";
  if ("mathml" in payload) return "formula";
  return "shape";
}

// Projects one or several DocumentTrees into a single deduplicated property graph. Documents project in input order; content nodes are deduplicated by content-hash id across the whole run, so a value shared by any two positions -- within one document or across several -- is one node with one edge per referencing position.
export function projectDocumentGraph(
  documents: readonly GraphDocument[],
  options: GraphProjectionOptions = {},
): PropertyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const policy = options.policy ?? defaultExtractionPolicy;
  const documentIds = new Set<string>();
  for (const document of documents) {
    // A repeated document id would silently merge two roots (first write wins) and lose a document -- the root id is the one identity this projection trusts the caller to assign, so it refuses a collision loudly.
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

// An edge shape wide enough for walkPropertyGraph to traverse: this module's own GraphEdge satisfies it structurally (GraphEdgeKind is a string), and so does a hand-built graph using a caller's own edge-kind vocabulary -- the walk itself only ever compares kinds and orderKeys as opaque strings, so pinning the parameter to GraphEdgeKind's own closed vocabulary would refuse a legitimately different, caller-defined graph for no reason the traversal itself needs.
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

// A shared pre-order depth-first walker over a PropertyGraph (ExaDev/documents.js#660), so every consumer of this projection's output -- an outline renderer walking CONTAINS, a style-chain reader walking STYLED_BY, a generic graph browser walking everything -- shares one traversal and one cycle policy instead of each hand-rolling its own. At each node, outgoing edges (edge.from === node.id) are filtered to `options.kinds` when given, else every kind present, and visited sorted ascending by orderKey -- which is what makes a CONTAINS walk reproduce document order and a STYLED_BY walk reproduce the resolution chain in order (#660's whole point for ordering keys).
//
// The cycle guard is derived from the kinds being traversed, never separately configured: CONTAINS alone needs no guard at all (a Merkle DAG is provably acyclic by construction -- every edge points from a node whose hash already covers the target's hash, so a path can never lead back to its own ancestor) and the on-stack set is not even allocated in that case, purely as an optimisation, never a behavioural branch. Traversing any other kind (including the default "every kind present", since STYLED_BY/DEFINED_BY/PROPERTY edges carry no acyclicity guarantee of their own -- a hand-built or malicious graph can point them anywhere) maintains a Set of the current DFS path's node ids; descending into a neighbour already on that path is skipped entirely (no WalkedNode emitted, no recursion), which suppresses a true cycle while still visiting a node reached via two different, non-nested paths once per path, because neither occurrence is an ancestor of the other -- exactly the same multi-parent sharing a CONTAINS walk already relies on.
export function walkPropertyGraph(
  graph: GraphLike,
  startId: string,
  options?: WalkPropertyGraphOptions,
): readonly WalkedNode[] {
  const kinds = options?.kinds;
  const kindSet = kinds === undefined ? undefined : new Set<string>(kinds);
  const needsGuard =
    kinds === undefined || kinds.some((kind) => kind !== "CONTAINS");
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoingByFrom = new Map<string, GraphEdgeLike[]>();
  for (const edge of graph.edges) {
    if (kindSet !== undefined && !kindSet.has(edge.kind)) continue;
    const bucket = outgoingByFrom.get(edge.from);
    if (bucket === undefined) outgoingByFrom.set(edge.from, [edge]);
    else bucket.push(edge);
  }
  for (const bucket of outgoingByFrom.values())
    bucket.sort((a, b) =>
      a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0,
    );

  const onPath = needsGuard ? new Set<string>() : undefined;
  const visited: WalkedNode[] = [];

  function visit(nodeId: string, edge: GraphEdgeLike | undefined): void {
    const node = nodesById.get(nodeId);
    if (node === undefined) return; // an edge naming a node absent from this graph is not this walker's concern to diagnose
    visited.push({ node, edge });
    onPath?.add(nodeId);
    for (const outgoing of outgoingByFrom.get(nodeId) ?? []) {
      if (onPath?.has(outgoing.to) === true) continue; // already an ancestor on this path: a genuine cycle, suppressed rather than recursed into
      visit(outgoing.to, outgoing);
    }
    onPath?.delete(nodeId);
  }

  visit(startId, undefined);
  return visited;
}

// The write side of this projection (ExaDev/documents.js#935): projectDocumentGraph only ever reads a whole DocumentTree, so a caller building an interactive editor on top of its output had no way to mint a new content node or attach one into an existing graph. `insertNode` mints a node; `insertEdge` attaches an already-minted node into a graph at a sibling position. Neither owns any tree, table, or extraction-policy state -- there is no styles/definitions table to resolve a ref against once a caller is working at the graph level -- so a node whose identity should fold in a dereferenced entry is built the same way the read side builds one: mint the entry's own node first, then mint the referencing node with the entry's id already substituted into `properties`, exactly as `walkRecord` substitutes an entry's id into `hash` before hashing the referencing node above.
//
// Mutating a node is not a separate operation: content-addressing already means "mutate" is "mint a new version" (this module's own top comment, EDITS), so a caller mutates by calling insertNode again with the changed content, getting back a new id, then insertEdge-ing that new id in wherever the old one was referenced. The old node and its edges are left exactly as they were -- neither function ever removes or rewrites existing graph state -- which is the free version history the top comment already promises orphans deliver.
//
// Neither function recomputes an ANCESTOR's id when a new child is attached beneath it: a compound node's id was folded from whatever children list it was minted with (the Merkle-DAG rule projectGroup applies), and attaching one more CONTAINS edge to an already-minted node does not retroactively change that node's own id, exactly as adding a blob to a git tree does not change a tree object already written to the object store in place -- git mints a new tree object instead, and a ref is what moves to point at it. A caller wanting an ancestor's id to reflect a new descendant re-mints that ancestor with insertNode (its own unchanged `properties` plus the updated `children` list) and re-wires whichever of ITS OWN referrers should see the new version, one level at a time, up to (never including) the document root -- whose id is caller-assigned and content-independent for exactly this reason, so a root-level insertion needs no cascade at all: mint the new subtree, then insertEdge it under the root id directly.

// One new content node's input: `kind` is the graph vocabulary word for what the node is -- this module's own mint sites decide it four different ways (a payload's own discriminant for a leaf/group, a fixed word for a table entry or an extracted value), so the write side asks for it explicitly rather than guessing a single recipe -- `properties` is the node's own content, and `children`, when given, names the ids of already-minted nodes this node is to CONTAIN, in document order. `children` folds into the id's hash input exactly as projectGroup folds its own children's ids into `hashInput`, but never into the face: children live only as the CONTAINS edges insertNode also emits alongside the node, never as a node property, matching every group node projectDocumentGraph itself mints. Omitting `children` entirely (not an empty array) is what a leaf-shaped node needs: an empty array is itself content (a group that folds `children: []` into its hash, and is entitled to gain CONTAINS children later without changing that already-minted id being nonsensical for identity purposes), whereas omission means "this node's identity has never depended on a children list at all," exactly how projectLeaf's own hash input carries no `children` key.
export interface InsertNodeContent {
  readonly kind: string;
  readonly properties: Record<string, unknown>;
  readonly children?: readonly string[];
}

export interface InsertNodeResult {
  readonly graph: PropertyGraph;
  readonly id: string;
}

// Mints one new node with the identical discipline as every read-side mint site: `id` is computed from content alone via contentHashV1 and spread into the face AFTER the content (`{ ...properties, id, kind }`), so a `properties` field named `id` or `kind` is shadowed unconditionally, and `InsertNodeContent` carries no `id` field at all -- there is no parameter a caller-supplied id could occupy. When `children` is given, this also emits one CONTAINS edge per child at `orderKeys.orderKeyForIndex(index)`, the WIDE, evenly spaced keys a fresh mint wants (exactly as projectGroup mints them for a freshly walked TreeGroup), leaving room for a later insertEdge to bisect between them without a rebalance. Content identical to a node already present in `graph` dedupes to the existing node and mints no duplicate edges either (addNode's own upsert-once rule): the freshly computed `id` could not already be a node in `graph` unless its content already matched exactly, so re-inserting the same subtree twice is a no-op past the first call, and no edge keyed from that id can already exist either.
export function insertNode(
  graph: PropertyGraph,
  content: InsertNodeContent,
): InsertNodeResult {
  const hashInput: Record<string, unknown> =
    content.children === undefined
      ? content.properties
      : { ...content.properties, children: content.children };
  const id = contentHashV1(hashInput);
  if (graph.nodes.some((node) => node.id === id)) return { graph, id };
  const node: GraphNode = { ...content.properties, id, kind: content.kind };
  const childEdges: readonly GraphEdge[] =
    content.children === undefined
      ? []
      : content.children.map((childId, index) => ({
          from: id,
          to: childId,
          kind: "CONTAINS",
          orderKey: orderKeys.orderKeyForIndex(index),
        }));
  return {
    graph: {
      nodes: [...graph.nodes, node],
      edges: [...graph.edges, ...childEdges],
    },
    id,
  };
}

// Where a new edge lands among an existing sibling list: `start`/`end` are the two boundaries an empty or non-empty list needs, `before`/`after` name an existing sibling to land relative to. A named sibling not found among `from`'s existing edges of the requested `kind` is a genuine caller error -- there is no position to compute otherwise -- and is refused loudly, as UnknownSiblingError, rather than silently falling back to an end position, in this module's own "refuses a ref the table does not carry" tradition.
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

// Thrown by siblingInsertIndex when `position` names a sibling id that is not among `from`'s existing edges of the requested `kind` -- there is no position to compute otherwise, so this module refuses loudly rather than silently falling back to an end position, in its own "refuses a ref the table does not carry" tradition (decideEntry's own refusal above is the same pattern). A named class, in the OrderKeyBudgetExhaustedError/ConstructMarkerImbalanceError family convention, carrying the three facts that produced the refusal as structured fields rather than only a formatted message, so a caller narrows with `instanceof` and reads `from`/`kind`/`siblingId` directly instead of parsing the message string.
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

// Resolves `position` against `siblings` (already sorted ascending by orderKey) to a plain array index -- where the new edge would sit if `siblings` were spliced at that index -- rather than an orderKey directly, so the same lookup serves both the fast bisection path and the rebalance fallback below. A named sibling not found is refused here, once, for every position variant that names one.
function siblingInsertIndex(
  siblings: readonly GraphEdge[],
  position: InsertPosition,
  from: string,
  kind: GraphEdgeKind,
): number {
  if (position.at === "start") return 0;
  if (position.at === "end") return siblings.length;
  const index = siblings.findIndex((edge) => edge.to === position.siblingId);
  if (index === -1) {
    throw new UnknownSiblingError(from, kind, position.siblingId);
  }
  return position.at === "before" ? index : index + 1;
}

// The fast path: bisect between whichever of `siblings[index - 1]`/`siblings[index]` exist, falling back to orderKeyForIndex(0) only when NEITHER does (a genuinely empty sibling list -- the same wide key a fresh projection mints for its own first child, not a defensive default masking a lookup failure). Throws OrderKeyBudgetExhaustedError when the two neighbours have no room left, which insertEdge below catches and answers with a full rebalance rather than surfacing to the caller -- exactly what a real sibling list needs to keep working once bisection is exhausted, most commonly `start` against a first child that (like every first child projectDocumentGraph itself ever mints) already sits at the scheme's own floor.
//
// Two adjacent siblings sharing one orderKey are a SEPARATE no-room case from a narrow-but-nonempty interval, and are checked for explicitly, before ever calling orderKeyBetween: this module's own emitWalkEdges mints every PROPERTY/DEFINED_BY edge from one owner at the uniform floor key, by design, since those edges carry no real document-order sequence for orderKey to encode (only `path` disambiguates them) -- so a tied pair here is an expected shape this module itself produces, not a malformed graph. orderKeyBetween's own precondition ("low must sort strictly before high") is written for a genuine caller error -- a reversed pair, low > high -- and throws a plain Error for that; asking it to also cover the tied case would make one precondition violation throw two different error classes depending on which of "equal" or "reversed" produced it. Recognising the tie here instead, ahead of the call, keeps that plain-Error/OrderKeyBudgetExhaustedError split consistent (genuine misuse vs. legitimate no-room-left) and routes the tie through the identical rebalance fallback insertEdge already has for a narrow interval.
function boundedOrderKey(
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

// The rebalance fallback: mints a fresh, evenly spaced key for every one of `from`'s existing `kind` edges plus the new one, in the same relative order (renumberedOrderKeys -- the identical rebalance orderKeyBetween's own exhaustion already names as the answer), then replaces exactly those existing edges in `graph` with their rebuilt versions. Every OTHER edge in `graph` -- a different `from`, a different `kind`, or a wholly unrelated edge -- is carried over untouched; only the one sibling group that ran out of room is ever rewritten.
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

// Attaches an already-minted node (from insertNode, or any other node already present in `graph`) into `graph` as one new edge, at a sibling position among `from`'s existing edges of the same `kind` -- the "inserting a sibling touches only that one new CONTAINS edge's orderKey" edit this module's own top comment names, extended to a full rebalance on the rare occasions bisection alone cannot express the requested position. Defaults to a CONTAINS edge appended after `from`'s existing children, the common "add one more child" case; pass `kind`/`position`/`path` for a STYLED_BY/DEFINED_BY/PROPERTY edge or a specific sibling position. Never mutates `graph` -- returns a new PropertyGraph, the same pure-function discipline insertNode follows.
export function insertEdge(
  graph: PropertyGraph,
  from: string,
  to: string,
  options: InsertEdgeOptions = {},
): PropertyGraph {
  const kind = options.kind ?? "CONTAINS";
  const position = options.position ?? { at: "end" };
  const siblings = graph.edges
    .filter((edge) => edge.from === from && edge.kind === kind)
    .sort((a, b) =>
      a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0,
    );
  const index = siblingInsertIndex(siblings, position, from, kind);
  let orderKey: string;
  try {
    orderKey = boundedOrderKey(siblings, index);
  } catch (error) {
    if (!(error instanceof OrderKeyBudgetExhaustedError)) throw error;
    return rebalancedInsert(
      graph,
      from,
      to,
      kind,
      siblings,
      index,
      options.path,
    );
  }
  const edge: GraphEdge = {
    from,
    to,
    kind,
    orderKey,
    ...(options.path === undefined ? {} : { path: options.path }),
  };
  return { nodes: graph.nodes, edges: [...graph.edges, edge] };
}
