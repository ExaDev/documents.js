import type {
  ContentBlock,
  ContentDocument,
  ContentParagraph,
  ContentRun,
  DocumentPackage,
  PageSize,
  SectionChild,
  SectionGroupNode,
  ShapeGroupNode,
  SlideGroupNode,
  StyleEntry,
  StyleParagraphProperties,
  StyleRunProperties,
  StylesTable,
  HeadingGroupNode,
  ListGroupNode,
  DrawPageGroupNode,
  HeadingParagraph,
} from 'document-schema.js';
import { canonicalKey } from './canonicalise';
import { decomposeSection, decomposeSlide, decomposeSheet, decomposeDrawPage } from './decompose';
import { flattenPackage } from './flatten';

// The styles minting half of the package boundary (document-schema.js#21's factoring pass, which the schema deliberately leaves to documents.js): assemblePackage = decompose then factorStyles, and the two are separate passes so minting idempotence stays independently testable. Minting walks the freshly decomposed tree, finds property tuples that repeat, and hoists each onto a wrapper ref + styles-table entry -- pure compression over the one tree a conversion just built, never a second authority for content.
//
// The mintable property sets are exactly the schema's own style halves (StyleParagraphProperties / StyleRunProperties) minus `list`: frames, sourcePath, and styleId are per-node facts the schema's strict entry objects already refuse outright (the ban list), and `list` is additionally excluded here because it is a grouping signal -- decompose's own stack semantics and the anchor schema (ListParagraphSchema requires list on a list group's node) read it off the node object, so a membership factored into the table would move structure the tree itself must keep stating. headingLevel is not a StyleParagraphProperties field at all, so heading anchors are equally safe by construction.
//
// Exactness -- the promotion's law (ii), that a factored and an unfactored serialisation of one document resolve to the same effective properties -- is guaranteed by two rules, both consequences of the resolution helpers being gap-fill-never-overwrite (applyParagraphStyleProperties / applyRunStyleProperties):
//
// 1. A minted tuple's keys must be carried by EVERY paragraph (for the paragraph half) and EVERY run of every extent paragraph (for the run half) of the wrapper's whole subtree extent -- the block-flow paragraphs resolution overlays the ref onto (group anchors and bare paragraph leaves; a table leaf's cell paragraphs and an embedded document's own content are outside the walk, exactly as they are outside resolution). A key a node already carries wins over the entry whatever its value, so unstripped extent nodes are untouched; a key a node lacks would be FILLED, so the every-node-carries-it condition is what makes the fill a no-op for everyone except the stripped positions it restores.
// 2. A key already minted by an ancestor wrapper's entry is frozen for every wrapper below it: resolution overlays the chain outermost-first with the nearest entry winning, so a nested entry re-minting an ancestor's key with a different value would silently rewrite the value the ancestor's ref restores for its own stripped positions. Freezing keeps already-factored keys out of every deeper candidate.
//
// Minting order and identity per the plan's locked rules: wrappers are visited outermost-first (pre-order, document order); a wrapper mints at most one entry (optionally carrying both halves) when some paragraph tuple and/or run tuple occurs on two or more positions in its extent that no wrapper on its root-to-leaf chain has already factored (the factored bookkeeping is branch-scoped, never global -- see Branch); the best tuple at a wrapper is the most frequent, tie-broken by first occurrence in document order -- a total rule, since a position joins exactly one tuple group, so two distinct tuples can never share a first occurrence. Identical entries minted at several wrappers share one table entry; ids are s1, s2, ... in (descending total frequency, first wrapper visit) order -- itself total, because one wrapper mints at most one entry, so distinct entries always have distinct first visits -- and the pass is deterministic.
//
// The whole pass is a pure function of the MATERIALISED content: factorStyles flattens its input first (resolving any refs it already carries), so factoring a second time computes the identical plan over the identical values and mints the identical table -- law (iii), minting idempotence, holds by construction. Stripping copies only the paragraphs and runs whose keys moved to a table entry (never the caller's nodes in place -- decompose embedded those, and the layout pass's frames ride on them); every other node in the minted tree is the same object the flat content owns. Strips apply per chain, not per node object: the same paragraph or run object may legally sit at positions under two sibling wrappers (a caller-built document that pushes one node into two sections is a two-position tree once serialised), and each position is stripped only by a wrapper whose ref that position's own chain resolves -- flatten resolves per position, so minting strips per position too (see WrapperStrips).

// The paragraph half's mintable keys, in the schema's own declaration order (StyleParagraphProperties minus `list`; see the module doc for why list never factors).
const PARAGRAPH_STYLE_KEYS = ['alignment', 'spacingBeforePt', 'spacingAfterPt', 'lineSpacing', 'indentLeftPt', 'indentFirstLinePt'] as const;

// The run half's mintable keys -- StyleRunProperties' full field set, schema declaration order.
const RUN_STYLE_KEYS = ['bold', 'italic', 'underline', 'strike', 'fontFamily', 'sizePt', 'color'] as const;

type ParagraphKey = (typeof PARAGRAPH_STYLE_KEYS)[number];
type RunKey = (typeof RUN_STYLE_KEYS)[number];

// The wrapper kinds that can carry a ref and hold block-flow paragraphs. SheetGroupNode fits the wrapper shape but its children are images and embedded objects -- no paragraphs, an always-empty extent -- so it never mints and is excluded from the walk's type.
type MintWrapper = SectionGroupNode | SlideGroupNode | DrawPageGroupNode | ShapeGroupNode | HeadingGroupNode | ListGroupNode;

// One child position of any block flow: the union of the section, list, and shape flows' child vocabularies (ListChild and ShapeChild are both ListGroupNode | ContentBlock, sub-ranges of SectionChild), so the extent walk serves all three with one function.
type FlowChild = SectionChild;

// Per-kind narrowers over MintWrapper. These exist because TypeScript does not narrow a union from a comparison against a NESTED discriminant (`wrapper.node.kind === 'section'` narrows wrapper.node at best, never `wrapper`) -- the identical reason document-schema.js's own package-node.ts writes per-kind predicates, and an explicit guard is what narrows the wrapper itself. A shape group is the no-kind arm (ContentShape carries no kind field); heading and list groups share the 'paragraph' node discriminant and stay one arm because the minting walk treats every anchor alike.
function isShapeGroupWrapper(wrapper: MintWrapper): wrapper is ShapeGroupNode {
  return !('kind' in wrapper.node);
}

function isAnchorGroupWrapper(wrapper: MintWrapper): wrapper is HeadingGroupNode | ListGroupNode {
  return 'kind' in wrapper.node && wrapper.node.kind === 'paragraph';
}

function isSlideGroupWrapper(wrapper: MintWrapper): wrapper is SlideGroupNode {
  return 'kind' in wrapper.node && wrapper.node.kind === 'slide';
}

function isDrawPageGroupWrapper(wrapper: MintWrapper): wrapper is DrawPageGroupNode {
  return 'kind' in wrapper.node && wrapper.node.kind === 'drawPage';
}

// Heading vs list within the anchor arm, discriminated the way decompose constructs them (a paragraph carrying both signals becomes a heading anchor -- headings win).
function isHeadingGroup(group: HeadingGroupNode | ListGroupNode): group is HeadingGroupNode {
  return group.node.headingLevel !== undefined;
}

// Assembles the tree-form DocumentPackage every construction site reports: decompose the flat content into its children, splice the envelope fields (kind, metadata, symbolTable) out of the content onto the root, carry `pages` when a layout pass produced rendered page sizes, then mint the styles table over the result. `pages` is spread-copied because the schema's array field is mutable while callers hand us readonly views of the layout engine's own array.
export function assemblePackage(content: ContentDocument, pages?: readonly PageSize[]): DocumentPackage {
  const envelope = {
    metadata: content.metadata,
    ...(content.symbolTable !== undefined ? { symbolTable: content.symbolTable } : {}),
    ...(pages !== undefined ? { pages: [...pages] } : {}),
  };
  switch (content.kind) {
    case 'wordprocessing':
      return mint({ kind: 'wordprocessing', ...envelope, children: content.sections.map(decomposeSection) });
    case 'presentation':
      return mint({ kind: 'presentation', ...envelope, children: content.slides.map(decomposeSlide) });
    case 'spreadsheet':
      return mint({ kind: 'spreadsheet', ...envelope, children: content.sheets.map(decomposeSheet) });
    case 'drawing':
      return mint({ kind: 'drawing', ...envelope, children: content.pages.map(decomposeDrawPage) });
    case 'formula':
      // A formula package's single child is a leaf -- no wrappers, no paragraphs -- so minting is necessarily a no-op; it routes through mint anyway so the return shape stays one code path.
      return mint({ kind: 'formula', ...envelope, children: [content.formula] });
  }
}

// Re-factors an already-assembled package. The input is flattened first (materialising its refs), so this both re-mints a minted package to the identical table (law iii) and factors any hand-built or round-tripped tree a caller hands in. `pages` and `definitions` ride the input through: neither has a spelling on the flat ContentDocument, so the flatten step cannot carry them and the reassembled tree would otherwise drop them silently. Minting never reads `definitions` -- the table is per-document caller data, not style content the pass has any business rewriting.
export function factorStyles(pkg: DocumentPackage): DocumentPackage {
  const reassembled = assemblePackage(flattenPackage(pkg), pkg.pages);
  if (pkg.definitions === undefined) return reassembled;
  return { ...reassembled, definitions: pkg.definitions };
}

// --- The plan: extents, candidates, selection -----------------------------------------------------------

// The paragraphs a wrapper's ref would overlay onto: the wrapper's own anchor (heading and list groups) plus, recursively, nested group anchors and bare paragraph leaves inside the block flow. This is exactly flatten.ts's resolution extent -- the same walk boundary, the same exclusions -- because exactness is proven against exactly the nodes resolution touches.
function extentOf(wrapper: MintWrapper): ContentParagraph[] {
  if (isShapeGroupWrapper(wrapper)) {
    // A shape group: no anchor of its own, its list-flow children carry everything.
    return flowExtent(wrapper.children);
  }
  if (isAnchorGroupWrapper(wrapper)) {
    return [wrapper.node, ...flowExtent(wrapper.children)];
  }
  if (isSlideGroupWrapper(wrapper)) {
    return wrapper.children.flatMap(extentOf);
  }
  if (isDrawPageGroupWrapper(wrapper)) {
    const paragraphs: ContentParagraph[] = [];
    for (const child of wrapper.children) {
      if ('node' in child) paragraphs.push(...extentOf(child));
    }
    return paragraphs;
  }
  // A section group: no anchor, its whole flow is the extent.
  return flowExtent(wrapper.children);
}

// The block-flow extent of one section/heading/list/shape child list: nested heading and list groups contribute their anchors and recurse, bare paragraph leaves contribute themselves, every other leaf (tables, images, page breaks, embedded objects) contributes nothing.
function flowExtent(children: readonly FlowChild[]): ContentParagraph[] {
  const paragraphs: ContentParagraph[] = [];
  for (const child of children) {
    if ('node' in child && 'children' in child) {
      paragraphs.push(...extentOf(child));
    } else if (child.kind === 'paragraph') {
      paragraphs.push(child);
    }
  }
  return paragraphs;
}

// A tuple of just the keys in `keys` that the paragraph actually carries -- the candidate identity for the paragraph namespace. Absent keys are omitted, not set to undefined, so canonicalKey treats both spellings of absence identically.
function paragraphTuple(paragraph: ContentParagraph, keys: readonly ParagraphKey[]): StyleParagraphProperties {
  const tuple: Record<string, unknown> = {};
  for (const key of keys) {
    if (paragraph[key] !== undefined) tuple[key] = paragraph[key];
  }
  return tuple;
}

function runTuple(run: ContentRun, keys: readonly RunKey[]): StyleRunProperties {
  const tuple: Record<string, unknown> = {};
  for (const key of keys) {
    if (run[key] !== undefined) tuple[key] = run[key];
  }
  return tuple;
}

// The keys (from the mintable set, minus the ancestor-frozen ones) that EVERY paragraph in the extent carries -- rule 1's every-node-carries-it condition, computed before grouping so candidates can only form over keys the whole extent shares.
function commonParagraphKeys(extent: readonly ContentParagraph[], frozen: ReadonlySet<ParagraphKey>): readonly ParagraphKey[] {
  return PARAGRAPH_STYLE_KEYS.filter((key) => !frozen.has(key) && extent.every((paragraph) => paragraph[key] !== undefined));
}

function commonRunKeys(extent: readonly ContentParagraph[], frozen: ReadonlySet<RunKey>): readonly RunKey[] {
  const runs = extent.flatMap((paragraph) => paragraph.runs);
  if (runs.length === 0) return [];
  return RUN_STYLE_KEYS.filter((key) => !frozen.has(key) && runs.every((run) => run[key] !== undefined));
}

interface ParagraphCandidate {
  readonly tuple: StyleParagraphProperties;
  readonly keys: readonly ParagraphKey[];
  readonly positions: ContentParagraph[];
}

interface RunCandidate {
  readonly tuple: StyleRunProperties;
  readonly keys: readonly RunKey[];
  readonly positions: ContentRun[];
}

// Groups the not-yet-factored positions by their restricted tuple and returns the best candidate -- the one occurring on two or more positions, most frequent first, then earliest first position -- or undefined when no tuple reaches the threshold. The frequency threshold is the plan's own economy rule: a singleton ref plus its table entry is larger than the inline tuple it would replace.
function bestParagraphCandidate(extent: readonly ContentParagraph[], keys: readonly ParagraphKey[], factored: ReadonlySet<ContentParagraph>): ParagraphCandidate | undefined {
  const groups = new Map<string, ParagraphCandidate>();
  for (const paragraph of extent) {
    if (factored.has(paragraph)) continue;
    const tuple = paragraphTuple(paragraph, keys);
    if (Object.keys(tuple).length === 0) continue;
    const key = canonicalKey(tuple);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, { tuple, keys, positions: [paragraph] });
    else existing.positions.push(paragraph);
  }
  return bestGroup(groups);
}

function bestRunCandidate(extent: readonly ContentParagraph[], keys: readonly RunKey[], factored: ReadonlySet<ContentRun>): RunCandidate | undefined {
  const groups = new Map<string, RunCandidate>();
  for (const paragraph of extent) {
    for (const run of paragraph.runs) {
      if (factored.has(run)) continue;
      const tuple = runTuple(run, keys);
      if (Object.keys(tuple).length === 0) continue;
      const key = canonicalKey(tuple);
      const existing = groups.get(key);
      if (existing === undefined) groups.set(key, { tuple, keys, positions: [run] });
      else existing.positions.push(run);
    }
  }
  return bestGroup(groups);
}

// The shared (most frequent, earliest) choice over a tuple -> positions grouping. Map iteration order is first-occurrence insertion order, so iterating in insertion order and taking the first strictly-more-frequent group resolves frequency first and falls back to document order for ties. The rule is total at two arms: a position joins exactly one tuple group, so two distinct tuples can never share a first occurrence.
function bestGroup<T extends { readonly tuple: unknown; readonly positions: unknown[] }>(groups: Map<string, T>): T | undefined {
  let best: T | undefined;
  for (const group of groups.values()) {
    if (group.positions.length < 2) continue;
    if (best === undefined || group.positions.length > best.positions.length) best = group;
  }
  return best;
}

// --- The plan walk and the apply phase -------------------------------------------------------------------

// The strips one minting wrapper's selection recorded: the keys its entry takes off each paragraph and each run it factored. Held per wrapper and consulted per chain during the rebuild, so the same node object aliased at positions under two sibling wrappers is stripped by each branch's own minter (or by neither) -- flatten resolves refs per position, so minting must strip per position too. A single node-keyed strip map cannot express that: it would apply one branch's strip at every position, and a position whose own chain minted nothing (or minted a different key set) would lose the stripped properties with no ref to restore them.
interface WrapperStrips {
  readonly paragraphs: Map<ContentParagraph, readonly ParagraphKey[]>;
  readonly runs: Map<ContentRun, readonly RunKey[]>;
}

// The mutable working state of one minting run: the refs the rebuild stamps and the per-wrapper strips it applies. The plan's chain-scoped inputs (frozen keys, factored positions) live in Branch instead, threaded through plan() copy-on-descend so they never survive into the rebuild.
interface MintState {
  // wrapper object identity -> the entry id its ref names (consumed by the rebuild walk).
  readonly wrapperRefs: Map<MintWrapper, string>;
  // minted wrapper object identity -> the strips its own entry recorded (the rebuild walk threads the records of its chain, innermost first).
  readonly wrapperStrips: Map<MintWrapper, WrapperStrips>;
}

// The chain-scoped planning context one plan() call sees: the keys an ancestor's entry froze for everything below it, and the positions an ancestor's entry already factored (restoring those is that ancestor ref's job). Copy-on-descend, so a factored position is invisible to every SIBLING branch: the same paragraph or run object may legally sit at positions under two sibling wrappers (a caller-built document that pushes one node into two sections is a two-position tree once serialised), and chain-global bookkeeping would let the first wrapper's mint suppress the second branch's own mint -- leaving the second position's chain ref-less while a strip still took its properties, silently breaking law (i). Branch-scoped, the sibling mints the identical entry content, shares the table entry through the canonical key, and carries its own ref, so both positions resolve back.
interface Branch {
  readonly frozenParagraphs: ReadonlySet<ParagraphKey>;
  readonly frozenRuns: ReadonlySet<RunKey>;
  readonly factoredParagraphs: ReadonlySet<ContentParagraph>;
  readonly factoredRuns: ReadonlySet<ContentRun>;
}

// One accumulated table entry: its resolved content, the wrappers referencing it, and the ordering inputs (total stripped positions and the first wrapper's pre-order visit index).
interface MintedEntry {
  readonly content: StyleEntry;
  readonly wrappers: MintWrapper[];
  frequency: number;
  firstVisit: number;
}

// Visits one wrapper outermost-first: selects at most one entry here, records its strips against this wrapper, freezes its keys for everything below, then recurses into the child wrappers with the branch bookkeeping extended (copy-on-descend, so sibling branches stay independent). `visit.index` numbers wrappers in pre-order -- the "first occurrence" arm of the entry ordering rule.
function plan(wrapper: MintWrapper, visit: { index: number }, branch: Branch, state: MintState, entries: Map<string, MintedEntry>): void {
  const extent = extentOf(wrapper);
  const paragraphCandidate = extent.length > 0 ? bestParagraphCandidate(extent, commonParagraphKeys(extent, branch.frozenParagraphs), branch.factoredParagraphs) : undefined;
  const runCandidate = extent.length > 0 ? bestRunCandidate(extent, commonRunKeys(extent, branch.frozenRuns), branch.factoredRuns) : undefined;

  const nextFrozenParagraphs = new Set(branch.frozenParagraphs);
  const nextFrozenRuns = new Set(branch.frozenRuns);
  const nextFactoredParagraphs = new Set(branch.factoredParagraphs);
  const nextFactoredRuns = new Set(branch.factoredRuns);
  if (paragraphCandidate !== undefined || runCandidate !== undefined) {
    const content: StyleEntry = {
      ...(paragraphCandidate !== undefined ? { paragraph: paragraphCandidate.tuple } : {}),
      ...(runCandidate !== undefined ? { run: runCandidate.tuple } : {}),
    };
    const contentKey = canonicalKey(content);
    const existing = entries.get(contentKey);
    if (existing === undefined) {
      entries.set(contentKey, { content, wrappers: [wrapper], frequency: (paragraphCandidate?.positions.length ?? 0) + (runCandidate?.positions.length ?? 0), firstVisit: visit.index });
    } else {
      existing.wrappers.push(wrapper);
      existing.frequency += (paragraphCandidate?.positions.length ?? 0) + (runCandidate?.positions.length ?? 0);
    }
    const strips: WrapperStrips = { paragraphs: new Map(), runs: new Map() };
    if (paragraphCandidate !== undefined) {
      for (const paragraph of paragraphCandidate.positions) {
        nextFactoredParagraphs.add(paragraph);
        strips.paragraphs.set(paragraph, paragraphCandidate.keys);
      }
      for (const key of paragraphCandidate.keys) nextFrozenParagraphs.add(key);
    }
    if (runCandidate !== undefined) {
      for (const run of runCandidate.positions) {
        nextFactoredRuns.add(run);
        strips.runs.set(run, runCandidate.keys);
      }
      for (const key of runCandidate.keys) nextFrozenRuns.add(key);
    }
    state.wrapperStrips.set(wrapper, strips);
  }

  visit.index += 1;
  const next: Branch = { frozenParagraphs: nextFrozenParagraphs, frozenRuns: nextFrozenRuns, factoredParagraphs: nextFactoredParagraphs, factoredRuns: nextFactoredRuns };
  for (const child of childWrappers(wrapper)) {
    plan(child, visit, next, state, entries);
  }
}

// The direct child wrappers of a wrapper, in document order -- the pre-order walk's recursion set.
function childWrappers(wrapper: MintWrapper): MintWrapper[] {
  if (isShapeGroupWrapper(wrapper) || isAnchorGroupWrapper(wrapper)) {
    // A shape's flow and a heading/list group's flow share the loop: nested groups are the child wrappers, leaves are not. An explicit loop rather than filter's type-guard overload because children arrives as a union of array types, whose filter signature TypeScript resolves without the predicate.
    const wrappers: MintWrapper[] = [];
    for (const child of wrapper.children) {
      if ('node' in child && 'children' in child) wrappers.push(child);
    }
    return wrappers;
  }
  if (isSlideGroupWrapper(wrapper)) {
    return [...wrapper.children];
  }
  if (isDrawPageGroupWrapper(wrapper)) {
    const shapes: ShapeGroupNode[] = [];
    for (const child of wrapper.children) {
      if ('node' in child) shapes.push(child);
    }
    return shapes;
  }
  // A section group: its flow's nested groups are the child wrappers.
  const wrappers: MintWrapper[] = [];
  for (const child of wrapper.children) {
    if ('node' in child && 'children' in child) wrappers.push(child);
  }
  return wrappers;
}

// The entry point over a whole tree: plan (outermost-first, freezing keys and factoring positions down each chain), order the entries, then rebuild the tree stamping refs and stripping keys per chain.
function mint(pkg: DocumentPackage): DocumentPackage {
  const state: MintState = {
    wrapperRefs: new Map(),
    wrapperStrips: new Map(),
  };
  const entries = new Map<string, MintedEntry>();
  const visit = { index: 0 };
  const rootBranch: Branch = { frozenParagraphs: new Set(), frozenRuns: new Set(), factoredParagraphs: new Set(), factoredRuns: new Set() };
  switch (pkg.kind) {
    case 'wordprocessing':
      for (const root of pkg.children) plan(root, visit, rootBranch, state, entries);
      break;
    case 'presentation':
      for (const root of pkg.children) plan(root, visit, rootBranch, state, entries);
      break;
    case 'drawing':
      for (const root of pkg.children) plan(root, visit, rootBranch, state, entries);
      break;
    // A spreadsheet's roots are sheet groups (no block flow, never minted) and a formula package's single child is a leaf: neither holds a wrapper to visit.
    case 'spreadsheet':
    case 'formula':
      break;
  }
  if (entries.size === 0) {
    return pkg;
  }
  // Entry ids in (descending total frequency, first wrapper visit) order -- the deterministic table order the plan locks. The comparator is total at two arms: one wrapper mints at most one entry, so distinct entries always have distinct first visits and a further tie-break arm could never bind.
  const ordered = [...entries.values()].sort((a, b) => b.frequency - a.frequency || a.firstVisit - b.firstVisit);
  const styles: StylesTable = {};
  ordered.forEach((entry, index) => {
    const id = `s${index + 1}`;
    styles[id] = entry.content;
    for (const wrapper of entry.wrappers) state.wrapperRefs.set(wrapper, id);
  });
  // Per-arm spreads rather than one spread of the union: a literal containing a union spread widens its discriminant-narrowed properties and stops assigning to DocumentPackageSchema's inferred type, so each arm rebuilds itself with its own children type.
  switch (pkg.kind) {
    case 'wordprocessing':
      return { ...pkg, styles, children: pkg.children.map((group) => rebuildSectionGroup(group, [], state)) };
    case 'presentation':
      return { ...pkg, styles, children: pkg.children.map((group) => rebuildSlideGroup(group, [], state)) };
    case 'drawing':
      return { ...pkg, styles, children: pkg.children.map((group) => rebuildDrawPageGroup(group, [], state)) };
    // No wrapper was visited for these arms (sheets hold no block flow; a formula package holds one leaf), so entries is empty and the early return above has already fired -- the arms exist for switch totality only.
    case 'spreadsheet':
    case 'formula':
      return { ...pkg, styles };
  }
}

// The strip records of every minted wrapper on the current rebuild chain, outermost first (each rebuild level appends its own record before walking its children). A node's strip is the LAST record naming it -- the chain is outermost-first, so the last is the innermost, and branch-scoped factoring gives each chain at most one minter per node anyway, which is what makes the per-position rule exact: an aliased node is stripped by its own branch's record and never by a sibling's.
type ChainStrips = readonly WrapperStrips[];

// The chain one level deeper than `group`: unchanged when this wrapper minted nothing, extended by its own strips when it did.
function innerChain(group: MintWrapper, chain: ChainStrips, state: MintState): ChainStrips {
  const own = state.wrapperStrips.get(group);
  return own === undefined ? chain : [...chain, own];
}

// The strip a wrapper on `chain` recorded against `paragraph`, or undefined when no wrapper on the chain factored it (the paragraph rides through as the same object).
function paragraphStripsOf(chain: ChainStrips, paragraph: ContentParagraph): readonly ParagraphKey[] | undefined {
  let result: readonly ParagraphKey[] | undefined;
  for (const strips of chain) {
    const found = strips.paragraphs.get(paragraph);
    if (found !== undefined) result = found;
  }
  return result;
}

function runStripsOf(chain: ChainStrips, run: ContentRun): readonly RunKey[] | undefined {
  let result: readonly RunKey[] | undefined;
  for (const strips of chain) {
    const found = strips.runs.get(run);
    if (found !== undefined) result = found;
  }
  return result;
}

// One slide group: stamp its ref when minted, rebuild its shapes below it, and return the same object when neither changed.
function rebuildSlideGroup(group: SlideGroupNode, chain: ChainStrips, state: MintState): SlideGroupNode {
  const inner = innerChain(group, chain, state);
  const children = group.children.map((shape) => rebuildShapeGroup(shape, inner, state));
  const ref = state.wrapperRefs.get(group);
  const unchanged = ref === undefined && children.every((child, index) => child === group.children[index]);
  return unchanged ? group : { node: group.node, ...(ref !== undefined ? { style: ref } : {}), children };
}

// One draw-page group: its shape children rebuild, its vector leaves pass through unchanged (no paragraphs to strip, no ref to carry -- a vector is a leaf).
function rebuildDrawPageGroup(group: DrawPageGroupNode, chain: ChainStrips, state: MintState): DrawPageGroupNode {
  const inner = innerChain(group, chain, state);
  const children = group.children.map((child) => ('node' in child ? rebuildShapeGroup(child, inner, state) : child));
  const ref = state.wrapperRefs.get(group);
  const unchanged = ref === undefined && children.every((child, index) => child === group.children[index]);
  return unchanged ? group : { node: group.node, ...(ref !== undefined ? { style: ref } : {}), children };
}

// One section group: stamp its ref when minted, rebuild its flow below it, and return the same object when neither changed.
function rebuildSectionGroup(group: SectionGroupNode, chain: ChainStrips, state: MintState): SectionGroupNode {
  const inner = innerChain(group, chain, state);
  const children = group.children.map((child) => rebuildSectionChild(child, inner, state));
  const ref = state.wrapperRefs.get(group);
  const unchanged = ref === undefined && children.every((child, index) => child === group.children[index]);
  return unchanged ? group : { node: group.node, ...(ref !== undefined ? { style: ref } : {}), children };
}

// One section-flow child position: a heading group recurses through the section-flow vocabulary, a list group through the list-flow vocabulary (its own children are ListChild, the shared list/shape vocabulary), a bare paragraph leaf is copied only when stripped, every other leaf passes through as the same object.
function rebuildSectionChild(child: SectionChild, chain: ChainStrips, state: MintState): SectionChild {
  if ('node' in child && 'children' in child) {
    return isHeadingGroup(child) ? rebuildHeadingGroup(child, chain, state, rebuildSectionChild) : rebuildListGroup(child, chain, state, rebuildListChild);
  }
  if (child.kind === 'paragraph') {
    return rebuildParagraph(child, chain);
  }
  return child;
}

// One list-flow child position -- the shared vocabulary of list-group children and shape flows.
function rebuildListChild(child: ListGroupNode | ContentBlock, chain: ChainStrips, state: MintState): ListGroupNode | ContentBlock {
  if ('node' in child && 'children' in child) {
    return rebuildListGroup(child, chain, state, rebuildListChild);
  }
  if (child.kind === 'paragraph') {
    return rebuildParagraph(child, chain);
  }
  return child;
}

// A shape group: no anchor of its own, its list-flow children rebuilt through the shared walk.
function rebuildShapeGroup(group: ShapeGroupNode, chain: ChainStrips, state: MintState): ShapeGroupNode {
  const inner = innerChain(group, chain, state);
  const children = group.children.map((child) => rebuildListChild(child, inner, state));
  const ref = state.wrapperRefs.get(group);
  const unchanged = ref === undefined && children.every((child, index) => child === group.children[index]);
  return unchanged ? group : { node: group.node, ...(ref !== undefined ? { style: ref } : {}), children };
}

function rebuildHeadingGroup(group: HeadingGroupNode, chain: ChainStrips, state: MintState, rebuildChild: (child: SectionChild, chain: ChainStrips, state: MintState) => SectionChild): HeadingGroupNode {
  const inner = innerChain(group, chain, state);
  const anchor = rebuildParagraph(group.node, inner);
  assertHeadingAnchor(anchor);
  const children = group.children.map((child) => rebuildChild(child, inner, state));
  const ref = state.wrapperRefs.get(group);
  const unchanged = ref === undefined && anchor === group.node && children.every((child, index) => child === group.children[index]);
  return unchanged ? group : { node: anchor, ...(ref !== undefined ? { style: ref } : {}), children };
}

function rebuildListGroup(group: ListGroupNode, chain: ChainStrips, state: MintState, rebuildChild: (child: ListGroupNode | ContentBlock, chain: ChainStrips, state: MintState) => ListGroupNode | ContentBlock): ListGroupNode {
  const inner = innerChain(group, chain, state);
  const anchor = rebuildParagraph(group.node, inner);
  assertListAnchor(anchor);
  const children = group.children.map((child) => rebuildChild(child, inner, state));
  const ref = state.wrapperRefs.get(group);
  const unchanged = ref === undefined && anchor === group.node && children.every((child, index) => child === group.children[index]);
  return unchanged ? group : { node: anchor, ...(ref !== undefined ? { style: ref } : {}), children };
}

// rebuildParagraph is typed on the loose ContentParagraph, so a rebuilt anchor comes back with its REQUIRED grouping signal widened to optional; these assertions re-narrow it without a cast, exactly as flatten.ts does for resolved anchors. Stripping only ever deletes mintable style keys (never headingLevel or list -- see the module doc), so the signal always survives; the throw is the loud guard if that contract ever broke.
function assertHeadingAnchor(paragraph: ContentParagraph): asserts paragraph is HeadingParagraph {
  if (paragraph.headingLevel === undefined) throw new Error("factorStyles: stripping dropped a heading anchor's headingLevel");
}

function assertListAnchor(paragraph: ContentParagraph): asserts paragraph is ListGroupNode['node'] {
  if (paragraph.list === undefined) throw new Error("factorStyles: stripping dropped a list anchor's list membership");
}

// One paragraph (leaf or anchor): stripped -- copied sans its minted keys -- when a wrapper on its chain factored it (chain-scoped, so an aliased position is stripped by its own branch's minter, never another branch's), with its runs rebuilt through the same copy-or-share rule. Returns the same object when nothing under it changed.
function rebuildParagraph(paragraph: ContentParagraph, chain: ChainStrips): ContentParagraph {
  const strips = paragraphStripsOf(chain, paragraph);
  const base = strips === undefined ? paragraph : stripParagraphKeys(paragraph, strips);
  let changed = base !== paragraph;
  const runs: ContentRun[] = [];
  for (const run of base.runs) {
    const runStrips = runStripsOf(chain, run);
    const rebuilt = runStrips === undefined ? run : stripRunKeys(run, runStrips);
    changed ||= rebuilt !== run;
    runs.push(rebuilt);
  }
  if (!changed) return paragraph;
  return { ...base, runs };
}

// Copies a paragraph sans the named keys -- copy-then-delete, never destructuring the keys out (an unused binding) and never mutating the input (decompose embedded the caller's own node objects, and the layout pass's frames ride on them). Every mintable paragraph key is optional on ContentParagraph, so the deletes are type-honest.
function stripParagraphKeys(paragraph: ContentParagraph, keys: readonly ParagraphKey[]): ContentParagraph {
  const copy: ContentParagraph = { ...paragraph };
  for (const key of keys) delete copy[key];
  return copy;
}

function stripRunKeys(run: ContentRun, keys: readonly RunKey[]): ContentRun {
  const copy: ContentRun = { ...run };
  for (const key of keys) delete copy[key];
  return copy;
}
