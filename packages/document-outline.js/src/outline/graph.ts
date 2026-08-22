import type {
  DefinitionsTable,
  DocumentTree,
  TreeGroup,
  TreeLeaf,
  StylesTable,
} from 'document-schema.js';
import { chainWithRef } from './effective';
import { contentHashV1 } from './hash';
import { initialOrderKeys, keyBetween, type OrderKey } from './order';

// The content-addressed graph projection of ExaDev/documents.js#659: one or several tree-form DocumentTrees exported as a property graph (nodes + typed edges) with content-based deduplication, no DocumentTree schema change. Node identity is COMPUTED, not stored: every content node's id is the stableContentHash of its own projected content -- the canonicalise-then-hash recipe this package already publishes (src/outline/hash.ts), applied bottom-up as a Merkle DAG. A leaf's hash covers its own content; a group's hash covers its own properties plus its children's hashes (and the hash of whatever table entry its refs point at), so a node can be shared by any number of parents -- arbitrary fan-out, data-bearing internal nodes, multi-parent sharing, exactly git's and IPFS's object model rather than a strict binary Merkle tree.
//
// Containment is an EDGE, not tree position, because a shared node has no single position: (parent)-[:CONTAINS {order}]->(child), order being the child's index in the parent's document order (graph edges are unordered by default and document order is semantically load-bearing). A style ref becomes (group)-[:STYLED_BY {order: 0}]->(entry) and an anchor descriptor's definitions ref becomes (node)-[:DEFINED_BY]->(entry); policy-extracted property values become (node)-[:PROPERTY {path}]->(value). Every edge carries an order so #660's ordered style chains and fractional ordering keys extend the vocabulary without reshaping it.
//
// DEREFFING BEFORE HASHING is the load-bearing rule for cross-document dedup: a `style: 's1'` ref (or an anchor's `definition: 'n1'`) is a document-local label with no cross-document meaning -- every assembled package mints its own s1, s2, ... keys -- so the projector substitutes the referenced ENTRY'S content hash into the referencing node's hash input and never hashes the bare key. Two structurally identical paragraphs whose documents name an identical style entry differently therefore dedupe to one node. Hashing runs in dependency order for the same reason: table entries first, tree nodes second (using the already-computed entry hashes) -- and an entry's own body may reference further entries (a footnote body carrying an anchor marker naming a note of its own), so an entry's walk recurses through the same deref while a cycle of entries, which no content hash can cover, is refused loudly.
//
// The document ROOT is the one node whose id is not computed: content hashing the root would change its id on every edit (any interior edit cascades up the DAG), which is the wrong identity scheme for "this document" as a persistently addressed thing. The caller assigns a stable external id -- a git ref pointing at a moving commit hash -- and the projection uses it verbatim. Package-level metadata/symbolTable/pages/source stay direct properties of the root even when two documents' values coincide: they are per-document identity facts, not reused content.
//
// EDITS fall out of content-hash identity rather than being implemented: modifying a node's content mints a NEW node (the old one persists, still referenced by whatever pointed at it -- free version history if orphans are never pruned); inserting a sibling touches only the local order values after the insertion point, because identity never depended on position.
//
// The EXTRACT-OR-INLINE decision is one pluggable policy consulted uniformly at every level -- root envelope fields, table entries, tree-node properties, individual scalars -- as (path, value) => extract | inline, with paths relative to the OWNING node (the entity whose content the value sits in) and continuing through nested values. The default extracts exactly the definitions-table facility's entries (styles, definitions, layers, attachments, destinations -- the reused content the tables exist to hold) and leaves everything else inline: an assembled package's recurring property tuples are already factored into its tables by minting's own recurrence rule (src/factor-styles.ts in document-schema.js), so a one-off italic stays inline and a style used by two paragraphs arrives as a table entry this projection surfaces as one shared node. The default performs no frequency survey of its own: on an assembled package the tables ARE minting's extract decision -- its recurrence rule factored the tuples it chose to share and left the rest inline by design (runner-up tuples at a wrapper, since a wrapper mints at most one entry; the per-node facts style entries are banned from carrying; and non-property content such as recurring text, which the worked example pins as inline -- sharing happens at the node level), so a surveying default would second-guess minting's compression rather than fill a gap. A hand-built or round-tripped tree that never ran the factoring pass can carry recurring style-shaped tuples inline, where a survey generalised to any value would extract and this default inlines; factorStyles first is the caller's route to the canonical spelling, and effectivePackage first is the route to factoring-invariant hashes -- a factored and an unfactored spelling of one document deliberately project to different node ids for the nodes the style rides, because the hash covers each node's own projected content, never style-resolved content. A custom policy can widen extraction to any value at any path -- extracted values become kind 'value' nodes joined by PROPERTY edges carrying the property path.
//
// Dedup itself needs no bespoke merge logic: identical content yields an identical hash yields an identical id, so the projection keeps one node per id and one edge per (from, to, kind, order, path) tuple, which is exactly what a graph store's native upsert (Neo4j MERGE, an RDF store keyed by the hash) would do with this output. An identical whole subtree collapses to one shared subtree with only the seam edges from each document's own ancestors being document-specific; a single shared leaf inside otherwise-different structure shares only that leaf. Table entries that nothing references are still emitted as nodes -- they are document content, reachable by kind queries.
//
// ExaDev/documents.js#660 hardens four things about the projection above without reshaping it:
// 1. `order` is a fractional/lexicographic OrderKey (src/outline/order.ts), not a dense integer -- so an insertion anywhere in a sibling list (a future incremental editor built on this projection) mints one fresh key between its neighbours and touches no other edge, where a dense integer would renumber every later sibling. The initial batch this projector mints for one parent's children (or one node's style chain, point 3 below) is `initialOrderKeys(n)`, evenly spaced fresh keys in one call.
// 2. Every content node's id is computed by `contentHashV1` -- the published stableContentHash recipe under an explicit version name, so a genuine future change to the recipe ships as `contentHashV2` rather than silently changing what every id ever minted under this name means.
// 3. Node ids are NEVER a caller-supplied value for a content node -- there is no parameter anywhere in this module's public surface (GraphDocument, ExtractionPolicy, GraphProjectionOptions) through which a caller could hand the projector an id for a node it is about to insert; every content node's id is always contentHashV1 of that node's own projected content, computed by the projector itself, immediately before that node is minted. The one deliberate, documented exception is the DOCUMENT ROOT (see above): its id is the caller-assigned GraphDocument.id, because a root names a persistent document identity across edits rather than a piece of content, and that is the one place this module's public surface DOES accept a caller-supplied id, by design.
// 4. STYLED_BY is no longer one edge per group's own ref -- it is one edge per entry in that node's full style-resolution chain (ancestor refs, outermost first, then the node's own ref last), matching document-schema.js's own resolveStyleChain fold (`nearest wins`, i.e. later-in-the-chain overlays win). Each edge is stamped with its position in that chain using the same OrderKey scheme as point 1, so a consumer can reconstruct resolveStyleChain's result by walking a node's STYLED_BY edges in order and overlaying each target entry in turn. The chain is threaded down through the tree with `chainWithRef` (src/outline/effective.ts, exported for exactly this reuse) -- the identical one-line rule effectivePackage already uses, not a second copy. Scope note: only GROUP nodes carry this chain, because `style` is a field of tree GROUPS in the schema (SectionGroupNode, HeadingGroupNode, …); an ordinary block-flow leaf (a bare paragraph, a table, …) sitting inside a styled ancestor's subtree does not itself carry a `style` field and is not given synthetic STYLED_BY edges here, even though effectivePackage's OWN leaf-level resolution (resolveParagraphLeaf) does apply the surrounding chain to such a leaf when computing its EFFECTIVE properties -- a deliberate, narrower scope for this projection's edges than for that resolution.

export type GraphEdgeKind = 'CONTAINS' | 'STYLED_BY' | 'DEFINED_BY' | 'PROPERTY';

// A property path relative to the owning node: keys of records, indices of arrays (['runs', 0, 'text']), continuing through values an extraction promoted to their own nodes.
export type PropertyPath = readonly (string | number)[];

export type ExtractionDecision = 'extract' | 'inline';

// The pluggable extract-or-inline decision. Pure by contract: the projector consults it with the same (path, value) for a table entry both when it walks the root's tables and when a tree ref dereferences that entry, so one entry has one decision for the whole projection.
export type ExtractionPolicy = (path: PropertyPath, value: unknown) => ExtractionDecision;

export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly [property: string]: unknown;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: GraphEdgeKind;
  readonly order: OrderKey;
  readonly path?: PropertyPath;
}

// DEFINED_BY and PROPERTY edges are never one of several siblings sharing a position (a node has at most one DEFINED_BY per path, one PROPERTY per path) -- `order` is part of the shared GraphEdge shape rather than being CONTAINS/STYLED_BY-only, so these two kinds stamp the one fixed key every such edge shares instead of leaving the field meaningless.
const SOLE_ORDER_KEY: OrderKey = keyBetween(undefined, undefined);

export interface PropertyGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

// One document to project: the caller-assigned stable id (used verbatim as the ROOT node's id ONLY -- see the module header's refinement 3 note) and the package itself. This `id` is deliberately the one and only place this module's public surface accepts a caller-supplied node id: there is no equivalent field anywhere a CONTENT node could be inserted, because a content node's id is always contentHashV1 of its own projected content, computed by the projector itself and never accepted as input.
export interface GraphDocument {
  readonly id: string;
  readonly package: DocumentTree;
}

export interface GraphProjectionOptions {
  readonly policy?: ExtractionPolicy;
}

// The five root fields of the definitions-table facility (src/definitions.ts in document-schema.js), in the fixed order the root walk visits them. styles is its own tenant with its own entry shape; the other four share the tenant-generic DefinitionsTable type.
const TABLE_FIELDS = ['styles', 'definitions', 'layers', 'attachments', 'destinations'] as const;
type TableField = (typeof TABLE_FIELDS)[number];

type TableValue = StylesTable | DefinitionsTable;

// The graph kind each table's entries carry: styles are 'styleEntry', every generic-table entry is 'definitionEntry' (its own tenant vocabulary stays inside the entry's content, where the kind discriminator already distinguishes tenants).
function entryKindOf(field: TableField): string {
  return field === 'styles' ? 'styleEntry' : 'definitionEntry';
}

// A table entry's node face. A generic entry's own `kind` discriminator (footnote, layer, attachment, destination...) is CONTENT -- it distinguishes tenants, and the hash covers it verbatim -- but `kind` is also the graph vocabulary's word for what a node IS, so the face re-houses the tenant discriminator under `tenantKind` and the graph kind wins. That makes `id`, `kind`, and `tenantKind` the face vocabulary's reserved words: an entry body spelling any of them is shadowed in the FACE by the vocabulary's own use (the body's value still hashes verbatim -- only the node's graph face is affected).
function entryNodeFace(id: string, field: TableField, properties: Record<string, unknown>): GraphNode {
  const face: Record<string, unknown> = { ...properties };
  const tenantKind = face.kind;
  delete face.kind;
  return { ...face, ...(tenantKind === undefined ? {} : { tenantKind }), id, kind: entryKindOf(field) };
}

const TABLE_FIELD_NAMES = new Set<string>(TABLE_FIELDS);

// The default policy: extract every table entry (the reused content the definitions facility exists to hold), inline everything else -- envelope facts, tree-node properties, scalars -- including table entries' own innards (an entry is a unit; its halves are not re-factored). Declared as an ExtractionPolicy rather than a standalone two-parameter function so the default is typed exactly as the custom policies it sits beside (and composes with), with no unused second parameter to spell.
export const defaultExtractionPolicy: ExtractionPolicy = (path) =>
  path.length === 2 && typeof path[0] === 'string' && TABLE_FIELD_NAMES.has(path[0]) ? 'extract' : 'inline';

// The projected own-content walk of one value: `hash` is what feeds the owning node's stableContentHash (refs dereferenced to entry hashes, extracted values replaced by their node ids), `properties` is the graph face (the same content minus ref keys and extracted keys, which become edges), and `edges` are the DEFINED_BY/PROPERTY relations discovered inside, for the owner to emit under its own id once that id is known.
interface Walked {
  readonly hash: unknown;
  readonly properties: unknown;
  readonly edges: readonly WalkEdge[];
}

interface WalkEdge {
  readonly path: PropertyPath;
  readonly to: string;
  readonly kind: 'DEFINED_BY' | 'PROPERTY';
}

// The walk of a record value, where the hash input and graph face are both records -- the shape every node mint reads.
interface RecordWalked {
  readonly hash: Record<string, unknown>;
  readonly properties: Record<string, unknown>;
  readonly edges: readonly WalkEdge[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The record narrowing every payload walk enters through: zod-inferred object types carry no string index signature, so they do not ASSIGN to Record<string, unknown> even though every property is unknown-compatible -- this assert-narrow (the family's assertHeadingAnchor pattern) states the invariant loudly instead of casting: every schema payload is a plain record, and a non-record payload would be a walk bug worth a stack trace, not a silent pass-through.
function recordOf(value: object): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('projectDocumentGraph: schema payload is not a plain record');
  }
  return value;
}

// One document's projection state: the node/edge accumulators (shared across the whole run), the policy, and the memoised per-table entry decisions that keep the root's table walk and every tree ref in agreement.
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
  private readonly tableDecisions = new Map<string, { status: 'extract'; id: string; walked: RecordWalked } | { status: 'inline'; walked: RecordWalked }>();

  // Entries whose decision walk is currently on the stack. An entry's body may itself carry an anchor descriptor naming another entry (a footnote body referencing a note of its own), so an entry's walk recurses through the same deref -- same-key re-entry means an entry is reachable from its own body, a cycle no content hash can cover (the hash would have to include itself), refused here by name rather than walked to a stack overflow.
  private readonly decidingEntries = new Set<string>();

  private tableOf(field: TableField): TableValue | undefined {
    return this.pkg[field];
  }

  // Decides one entry (memoised) -- policy-asked with the entry's document path [field, key], walked once, node minted when extracted.
  private decideEntry(field: TableField, key: string): { status: 'extract'; id: string; walked: RecordWalked } | { status: 'inline'; walked: RecordWalked } {
    const memoKey = `${field}\u0000${key}`;
    const memo = this.tableDecisions.get(memoKey);
    if (memo !== undefined) return memo;
    if (this.decidingEntries.has(memoKey)) {
      throw new Error(`projectDocumentGraph: ${field} table entry "${key}" is reachable from its own body (a cycle of definition refs)`);
    }
    const table = this.tableOf(field);
    const entry = table?.[key];
    if (entry === undefined) {
      throw new Error(`projectDocumentGraph: ${field} table entry "${key}" referenced but not present`);
    }
    this.decidingEntries.add(memoKey);
    const walked = this.walkRecord(recordOf(entry), [field, key]);
    this.decidingEntries.delete(memoKey);
    if (this.policy([field, key], entry) === 'extract') {
      const id = contentHashV1(walked.hash);
      const decided = { status: 'extract' as const, id, walked };
      this.tableDecisions.set(memoKey, decided);
      this.pendingEntryNodes.push(entryNodeFace(id, field, walked.properties));
      return decided;
    }
    const decided = { status: 'inline' as const, walked };
    this.tableDecisions.set(memoKey, decided);
    return decided;
  }

  // Resolves a style ref from a group wrapper: the entry's decided fate, with the loud refusal on a ref the table does not carry (a malformed package, in the family's all-or-nothing resolution tradition).
  private resolveStyleRef(ref: string): { id?: string; walked: RecordWalked } {
    if (this.styles === undefined || this.styles[ref] === undefined) {
      throw new Error(`projectDocumentGraph: style ref "${ref}" names no entry in the styles table`);
    }
    const decided = this.decideEntry('styles', ref);
    return decided.status === 'extract' ? { id: decided.id, walked: decided.walked } : { walked: decided.walked };
  }

  // Resolves an anchor descriptor's definitions ref the same way.
  private resolveDefinitionRef(ref: string): { id?: string; walked: RecordWalked } {
    if (this.definitions === undefined || this.definitions[ref] === undefined) {
      throw new Error(`projectDocumentGraph: definition ref "${ref}" names no entry in the definitions table`);
    }
    const decided = this.decideEntry('definitions', ref);
    return decided.status === 'extract' ? { id: decided.id, walked: decided.walked } : { walked: decided.walked };
  }

  private addNode(node: GraphNode): void {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
  }

  private addEdge(edge: GraphEdge): void {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}\u0000${edge.order}\u0000${edge.path === undefined ? '' : JSON.stringify(edge.path)}`;
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

  private walkRecord(value: Record<string, unknown>, path: PropertyPath): RecordWalked {
    const hash: Record<string, unknown> = {};
    const properties: Record<string, unknown> = {};
    const edges: WalkEdge[] = [];
    for (const key of Object.keys(value)) {
      if (key === '$schema') continue; // a serialised dump's release label is transport metadata, not content -- the hash recipe's own rule 1, kept true for the graph face too
      const child = value[key];
      if (key === 'definition' && typeof child === 'string' && value.kind === 'anchor') {
        const resolved = this.resolveDefinitionRef(child);
        if (resolved.id !== undefined) {
          hash.definition = resolved.id;
          edges.push({ path: [...path, 'definition'], to: resolved.id, kind: 'DEFINED_BY' });
        } else {
          hash.definition = resolved.walked.hash;
          properties.definition = resolved.walked.properties;
        }
        continue;
      }
      const childPath: PropertyPath = [...path, key];
      if (this.policy(childPath, child) === 'extract') {
        const id = this.mintValueNode(child, childPath);
        hash[key] = id;
        edges.push({ path: childPath, to: id, kind: 'PROPERTY' });
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
      this.addNode({ ...walked.properties, id, kind: 'value' });
      this.emitWalkEdges(id, walked.edges);
      return id;
    }
    const walked = this.walk(value, path);
    const id = contentHashV1(walked.hash);
    this.addNode({ id, kind: 'value', value: walked.properties });
    this.emitWalkEdges(id, walked.edges);
    return id;
  }

  private emitWalkEdges(ownerId: string, walkedEdges: readonly WalkEdge[]): void {
    for (const edge of walkedEdges) {
      this.addEdge({ from: ownerId, to: edge.to, kind: edge.kind, order: SOLE_ORDER_KEY, path: edge.path });
    }
  }

  // The whole document: root node (caller id, envelope facts inline, leftover inlined table entries inline), table-entry nodes (decided and minted up front, emitted sorted by id so differently-spelled key sets yield the same node order), then the tree in pre-order with CONTAINS/STYLED_BY/DEFINED_BY edges.
  project(): void {
    const envelope: Record<string, unknown> = { metadata: this.pkg.metadata };
    if (this.pkg.symbolTable !== undefined) envelope.symbolTable = this.pkg.symbolTable;
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
        if (decided.status === 'inline') leftover[key] = decided.walked.properties;
      }
      if (Object.keys(leftover).length > 0) leftoverTables[field] = leftover;
    }

    // The root node lands first, then this document's entry nodes in content-id order, then the tree in pre-order.
    this.addNode({
      ...envelopeWalk.properties,
      ...leftoverTables,
      id: this.documentId,
      kind: 'documentPackage',
      documentKind: this.pkg.kind,
    });
    for (const node of this.pendingEntryNodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      this.addNode(node);
    }

    // Children first (ids needed for the root's CONTAINS edges), edges assembled own-first so each parent's edges precede its descendants'. Fractional order keys (ExaDev/documents.js#660's refinement 1) rather than dense indices -- the root carries no style ref of its own, so every top-level child starts its style chain empty.
    const rootOrderKeys = initialOrderKeys(this.pkg.children.length);
    const childResults = this.pkg.children.map((child, index) => {
      const result = this.projectChild(child, []);
      this.addEdge({ from: this.documentId, to: result.id, kind: 'CONTAINS', order: rootOrderKeys[index]! });
      return result;
    });
    this.emitWalkEdges(this.documentId, envelopeWalk.edges);
    for (const result of childResults) {
      for (const edge of result.edges) this.addEdge(edge);
    }
  }

  // `chain` is the ordered (outermost-first) list of style refs carried by every OPEN ancestor group above this child -- see chainWithRef and the module-header note on refinement 4's scope (groups only, never threaded onto a bare leaf's own edges).
  private projectChild(child: AnyChild, chain: readonly string[]): { id: string; edges: GraphEdge[] } {
    if (isGroupChild(child)) return this.projectGroup(child, chain);
    return this.projectLeaf(child);
  }

  // One tree group: own payload walked generically (refs dereferenced, extractions substituted), children projected recursively, hash input = walked payload + child ids + the style entry's id -- the Merkle-DAG rule. The wrapper's style key never reaches the node's properties: extracted, it is a STYLED_BY edge; inlined by a custom policy, the dereferenced ENTRY CONTENT is spelled in place (never the local key). Node IDENTITY reflects only this group's OWN ref (never the ancestor chain): folding ancestor context into the hash would make an identical subtree hash differently under two different ancestors, defeating the whole point of content-addressed sharing -- ancestor context is expressed only as the STYLED_BY edges below, never as part of what this node IS.
  private projectGroup(group: TreeGroup, chain: readonly string[]): { id: string; edges: GraphEdge[] } {
    const own = chainWithRef(chain, group); // this group's full style-resolution chain, outermost-first, threaded onward to its own children.
    const walked = this.walkRecord(recordOf(group.node), []);
    const childOrderKeys = initialOrderKeys(group.children.length);
    const childResults = group.children.map((child, index) => ({ result: this.projectChild(child, own), order: childOrderKeys[index]! }));
    const hashInput: Record<string, unknown> = {
      ...walked.hash,
      children: childResults.map(({ result }) => result.id),
    };
    const face: Record<string, unknown> = { ...walked.properties };
    if (group.style !== undefined) {
      const resolved = this.resolveStyleRef(group.style);
      if (resolved.id !== undefined) {
        hashInput.style = resolved.id;
      } else {
        hashInput.style = resolved.walked.hash;
        face.style = resolved.walked.properties;
      }
    }
    const id = contentHashV1(hashInput);
    const edges: GraphEdge[] = childResults.map(({ result, order }) => ({
      from: id,
      to: result.id,
      kind: 'CONTAINS' as const,
      order,
    }));
    // Ordered STYLED_BY (ExaDev/documents.js#660's refinement 4): one edge per entry in `own`, outermost-first, each stamped with its chain position via the same OrderKey scheme CONTAINS uses above -- so a consumer walking this node's STYLED_BY edges in order and overlaying each target entry in turn reproduces resolveStyleChain's own result. A chain entry a custom policy chooses to INLINE (rather than extract to its own node) has no node to point an edge at, so it is skipped here exactly as the single-ref case always skipped one -- the entry's content is still visible via `face.style` above, but only for this group's own ref; an inlined ANCESTOR entry has no node on this group to carry it and is simply not reflected in this group's edges, a known, narrow limitation of pairing a custom inlining policy with ancestor chains.
    if (own.length > 0) {
      const chainOrderKeys = initialOrderKeys(own.length);
      own.forEach((ref, index) => {
        const resolved = this.resolveStyleRef(ref);
        if (resolved.id !== undefined) {
          edges.push({ from: id, to: resolved.id, kind: 'STYLED_BY', order: chainOrderKeys[index]! });
        }
      });
    }
    this.addNode({ ...face, id, kind: kindOf(recordOf(group.node)) });
    this.emitWalkEdges(id, walked.edges);
    return { id, edges: [...edges, ...childResults.flatMap(({ result }) => result.edges)] };
  }

  // One tree leaf: its own walked content is the whole hash input.
  private projectLeaf(leaf: AnyChild): { id: string; edges: GraphEdge[] } {
    const walked = this.walkRecord(recordOf(leaf), []);
    const id = contentHashV1(walked.hash);
    this.addNode({ ...walked.properties, id, kind: kindOf(recordOf(leaf)) });
    this.emitWalkEdges(id, walked.edges);
    return { id, edges: [] };
  }
}

// Everything that can sit at a child position of any container, root groups included: the schema's own group and leaf unions, so every per-kind children array assigns into one walk.
type AnyChild = TreeGroup | TreeLeaf;

function isGroupChild(child: AnyChild): child is TreeGroup {
  return 'node' in child && 'children' in child;
}

// A projected node's graph kind: the payload's own kind tag when it carries one (paragraph, section, slide, sheet, drawPage, the construct kinds, the vector kinds, image, pageBreak, table, embeddedObject as a block leaf); the three kind-less payloads get structural names -- a sheet-anchored embedded object, a formula document's single leaf, and a shape group's frame descriptor.
function kindOf(payload: Record<string, unknown>): string {
  if (typeof payload.kind === 'string') return payload.kind;
  if ('objectKind' in payload) return 'embeddedObject';
  if ('mathml' in payload) return 'formula';
  return 'shape';
}

// Projects one or several DocumentTrees into a single deduplicated property graph. Documents project in input order; content nodes are deduplicated by content-hash id across the whole run, so a value shared by any two positions -- within one document or across several -- is one node with one edge per referencing position.
export function projectDocumentGraph(documents: readonly GraphDocument[], options: GraphProjectionOptions = {}): PropertyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const policy = options.policy ?? defaultExtractionPolicy;
  const documentIds = new Set<string>();
  for (const document of documents) {
    // A repeated document id would silently merge two roots (first write wins) and lose a document -- the root id is the one identity this projection trusts the caller to assign, so it refuses a collision loudly.
    if (documentIds.has(document.id)) {
      throw new Error(`projectDocumentGraph: document id "${document.id}" assigned to more than one document`);
    }
    documentIds.add(document.id);
    new DocumentProjection(document.id, document.package, policy, nodes, edges).project();
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
