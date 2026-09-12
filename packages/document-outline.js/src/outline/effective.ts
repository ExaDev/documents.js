import {
  applyParagraphStyleProperties,
  applyRunStyleProperties,
  isHeadingGroupNode,
  isListGroupNode,
  isSectionConstructGroupNode,
  isShapeConstructGroupNode,
  resolveStyleChain,
  type ContentParagraph,
  type ContentVector,
  type DocumentTree,
  type DrawPageGroupNode,
  type HeadingGroupNode,
  type ListChild,
  type ListGroupNode,
  type SectionChild,
  type SectionConstructGroupNode,
  type SectionGroupNode,
  type ShapeConstructGroupNode,
  type ShapeGroupNode,
  type SheetGroupNode,
  type SlideGroupNode,
  type StyleEntry,
  type StylesTable,
  type TreeGroup,
} from "document-schema.js";

// Effective-property resolution: the route every consumer that must not care how a package was serialised -- resolve-then-compare (the promotion's law ii: a factored and an unfactored serialisation of one document resolve to the same effective tree) and content hashing (hashes ride over resolved properties, so a hash names the document, not the producer's compression choices) -- goes through before touching content. A tree group may carry a `style` ref into the package's styles table (ExaDev/document-schema.js#21); this module resolves those refs away using document-schema.js's own overlay helpers (resolveStyleChain / applyParagraphStyleProperties / applyRunStyleProperties -- the mechanics are the schema's to own, the same single-authority rule that moved the tree vocabulary there) and returns the package with every ref consumed and the styles table dropped: effectivePackage(factored) deep-equals effectivePackage(unfactored), which is the whole point.
//
// Resolution semantics: a group's ref, plus every ancestor group's ref, overlays onto each PARAGRAPH in that group's subtree -- group anchors (heading and list groups carry ContentParagraph anchors) and bare paragraph leaves alike -- with the chain ordered outermost first so the nearest group's entry wins over further-out ones and the paragraph's own direct properties win over everything (applyParagraphStyleProperties / applyRunStyleProperties fill gaps, never overwrite). The run half of a resolved entry applies to every run of each paragraph it resolved for. The walk's boundary is the block flow: a table leaf's cell paragraphs and an embedded document's own content are leaf-local payload this walk does not rewrite (style entries carry paragraph/run properties for block flow; an embedded document is its own whole package context).
//
// A tree that references an id the styles table does not carry is malformed, and resolution runs loudly: resolveStyleChain throws on the unknown ref. Consistency between refs and the table is the producer's responsibility (the same deliberate non-enforcement DocumentTreeSchema applies to pages-versus-frames); once resolution runs, it runs completely or not at all.
export function effectivePackage(pkg: DocumentTree): DocumentTree {
  const styles = pkg.styles;
  // The common case is a styles-free package: no table means no group can legally carry a ref, so the package already IS its effective form. Returned as the same object, not a copy -- nothing anywhere needs rewriting, and embedding unchanged values is the family's ownership discipline.
  if (styles === undefined) return pkg;
  switch (pkg.kind) {
    case "wordprocessing":
      return withoutStyles({
        ...pkg,
        children: pkg.children.map((group) =>
          resolveSectionGroup(styles, [], group),
        ),
      });
    case "presentation":
      return withoutStyles({
        ...pkg,
        children: pkg.children.map((group) =>
          resolveSlideGroup(styles, [], group),
        ),
      });
    case "spreadsheet":
      // A sheet group's children are images and embedded objects -- no block-flow paragraphs anywhere -- so resolution never touches them; only the (possible) style ref on the sheet group itself is consumed.
      return withoutStyles({
        ...pkg,
        children: pkg.children.map(resolveSheetGroup),
      });
    case "drawing":
      return withoutStyles({
        ...pkg,
        children: pkg.children.map((group) =>
          resolveDrawPageGroup(styles, [], group),
        ),
      });
    case "formula":
      // The single ContentFormula child is a leaf, and refs exist only on group wrappers, so a formula package's effective form is simply itself minus the table.
      return withoutStyles({ ...pkg });
  }
}

// Copy-then-delete rather than destructuring `styles` out of the union: the arms' object types are what make the spread assignable to DocumentTree, and a destructured-away field would also be an unused binding the repo's lint rejects.
function withoutStyles(pkg: DocumentTree): DocumentTree {
  const copy: { styles?: StylesTable } & DocumentTree = { ...pkg };
  delete copy.styles;
  return copy;
}

// A group's chain extended by its own ref when it carries one: the array passed to everything inside the group, which is how a group's style applies to its whole subtree. Outermost-first order, so resolveStyleChain's overlay fold makes the nearest entry win over further-out ones.
function chainWithRef(
  chain: readonly string[],
  group: TreeGroup,
): readonly string[] {
  return group.style === undefined ? chain : [...chain, group.style];
}

function resolveSectionGroup(
  styles: StylesTable,
  chain: readonly string[],
  group: SectionGroupNode,
): SectionGroupNode {
  const own = chainWithRef(chain, group);
  const children = resolveSectionChildren(styles, own, group.children);
  if (group.style === undefined && children === group.children) return group;
  return { node: group.node, children };
}

function resolveSlideGroup(
  styles: StylesTable,
  chain: readonly string[],
  group: SlideGroupNode,
): SlideGroupNode {
  const own = chainWithRef(chain, group);
  let changed = group.style !== undefined;
  const children: ShapeGroupNode[] = [];
  for (const shape of group.children) {
    const resolved = resolveShapeGroup(styles, own, shape);
    changed ||= resolved !== shape;
    children.push(resolved);
  }
  if (!changed) return group;
  return { node: group.node, children };
}

function resolveSheetGroup(group: SheetGroupNode): SheetGroupNode {
  return group.style === undefined
    ? group
    : { node: group.node, children: group.children };
}

function resolveDrawPageGroup(
  styles: StylesTable,
  chain: readonly string[],
  group: DrawPageGroupNode,
): DrawPageGroupNode {
  const own = chainWithRef(chain, group);
  let changed = group.style !== undefined;
  const children: (ShapeGroupNode | ContentVector)[] = [];
  for (const child of group.children) {
    // A page's children are shape groups and vector leaves; only the groups can change (vectors carry no paragraphs).
    const resolved = isShapeGroup(child)
      ? resolveShapeGroup(styles, own, child)
      : child;
    changed ||= resolved !== child;
    children.push(resolved);
  }
  if (!changed) return group;
  return { node: group.node, children };
}

function resolveShapeGroup(
  styles: StylesTable,
  chain: readonly string[],
  group: ShapeGroupNode,
): ShapeGroupNode {
  const own = chainWithRef(chain, group);
  const children = resolveListChildren(styles, own, group.children);
  if (group.style === undefined && children === group.children) return group;
  return { node: group.node, children };
}

// A construct group carries the same optional style ref as every other wrapper (chainWithRef treats it identically), and its own children are a section flow it wraps -- resolved with resolveSectionChildren, same as a heading group's, not the flattening/reset a decompose walk applies when building the tree in the first place. That reset governs how a construct's extent nests when the tree is FIRST built; it says nothing about a later resolve pass over the tree the schema already validated, whose only job is threading each group's style chain down to the paragraphs in its subtree.
function resolveSectionConstructGroup(
  styles: StylesTable,
  chain: readonly string[],
  group: SectionConstructGroupNode,
): SectionConstructGroupNode {
  const own = chainWithRef(chain, group);
  const children = resolveSectionChildren(styles, own, group.children);
  if (group.style === undefined && children === group.children) return group;
  return { node: group.node, children };
}

// The ShapeChild/ListChild counterpart: a construct group wrapping a list/shape flow, resolved with resolveListChildren, same as a shape group's.
function resolveShapeConstructGroup(
  styles: StylesTable,
  chain: readonly string[],
  group: ShapeConstructGroupNode,
): ShapeConstructGroupNode {
  const own = chainWithRef(chain, group);
  const children = resolveListChildren(styles, own, group.children);
  if (group.style === undefined && children === group.children) return group;
  return { node: group.node, children };
}

function resolveHeadingGroup(
  styles: StylesTable,
  chain: readonly string[],
  group: HeadingGroupNode,
): HeadingGroupNode {
  const own = chainWithRef(chain, group);
  // Always resolved unconditionally, even for an empty chain: resolveStyleChain(styles, []) returns `{}` rather than throwing, and applyEntry({}, node) returns `node` by the identical reference -- so there is no separate "no entry" case to special-case here.
  const anchor = applyEntry(resolveStyleChain(styles, own), group.node);
  assertResolvedHeadingAnchor(anchor);
  const children = resolveSectionChildren(styles, own, group.children);
  if (
    group.style === undefined &&
    anchor === group.node &&
    children === group.children
  )
    return group;
  return { node: anchor, children };
}

function resolveListGroup(
  styles: StylesTable,
  chain: readonly string[],
  group: ListGroupNode,
): ListGroupNode {
  const own = chainWithRef(chain, group);
  // Identical reasoning to resolveHeadingGroup above: resolveStyleChain(styles, []) returns `{}` rather than throwing, and applyEntry({}, node) returns `node` by the identical reference, so there is no separate "no entry" case to special-case here.
  const anchor = applyEntry(resolveStyleChain(styles, own), group.node);
  assertResolvedListAnchor(anchor);
  const children = resolveListChildren(styles, own, group.children);
  if (
    group.style === undefined &&
    anchor === group.node &&
    children === group.children
  )
    return group;
  return { node: anchor, children };
}

// applyEntry is typed on the loose ContentParagraph, so a resolved anchor comes back with its REQUIRED grouping signal widened to optional; these assertions re-narrow it without a cast. Resolution fills gaps and never removes fields, so the signal always survives through this module's own construction path -- document-schema.js's applyParagraphStyleProperties (the only function that ever produces the `paragraph` either assertion receives here) builds its result as `{ ...paragraph }` first, so every field the input paragraph already carries survives verbatim regardless of what any StyleEntry supplies. Exported, like pdf-regions.ts's own internal helpers, purely so the throw itself -- a defensive guard against that fill-only contract ever regressing, not a case this module's own callers can trigger -- has a direct test exercising it instead of relying on a real resolution path that can never reach it.
export function assertResolvedHeadingAnchor(
  paragraph: ContentParagraph,
): asserts paragraph is ContentParagraph & { headingLevel: number } {
  if (paragraph.headingLevel === undefined)
    throw new Error(
      "effectivePackage: resolution dropped a heading anchor's headingLevel",
    );
}

export function assertResolvedListAnchor(
  paragraph: ContentParagraph,
): asserts paragraph is ContentParagraph & {
  list: NonNullable<ContentParagraph["list"]>;
} {
  if (paragraph.list === undefined)
    throw new Error(
      "effectivePackage: resolution dropped a list anchor's list membership",
    );
}

// One section-flow child position: nested heading/list groups recurse with this scope's chain, a bare paragraph leaf resolves against the chain (it carries no ref of its own -- refs are legal only on group wrappers), and every other leaf is its own payload, untouched.
function resolveSectionChildren(
  styles: StylesTable,
  chain: readonly string[],
  children: SectionChild[],
): SectionChild[] {
  let changed = false;
  const out: SectionChild[] = [];
  for (const child of children) {
    let resolved: SectionChild;
    if (isHeadingGroupNode(child))
      resolved = resolveHeadingGroup(styles, chain, child);
    else if (isListGroupNode(child))
      resolved = resolveListGroup(styles, chain, child);
    else if (isSectionConstructGroupNode(child))
      resolved = resolveSectionConstructGroup(styles, chain, child);
    else if (child.kind === "paragraph")
      resolved = resolveParagraphLeaf(styles, chain, child);
    else resolved = child;
    changed ||= resolved !== child;
    out.push(resolved);
  }
  return changed ? out : children;
}

// One list-flow child position -- the shared vocabulary of shape flows and list-group children (ListGroupNode | ShapeConstructGroupNode | ContentBlock), so one function serves both.
function resolveListChildren(
  styles: StylesTable,
  chain: readonly string[],
  children: ListChild[],
): ListChild[] {
  let changed = false;
  const out: ListChild[] = [];
  for (const child of children) {
    let resolved: ListChild;
    if (isListGroupNode(child))
      resolved = resolveListGroup(styles, chain, child);
    else if (isShapeConstructGroupNode(child))
      resolved = resolveShapeConstructGroup(styles, chain, child);
    else if (child.kind === "paragraph")
      resolved = resolveParagraphLeaf(styles, chain, child);
    else resolved = child;
    changed ||= resolved !== child;
    out.push(resolved);
  }
  return changed ? out : children;
}

// No separate empty-chain early return: an empty chain is exactly resolveStyleChain(styles, [])'s own no-refs case, which returns `{}` rather than throwing, and applyEntry({}, leaf) already returns `leaf` by the identical reference -- calling through unconditionally computes the exact same no-op a special case would skip computing.
function resolveParagraphLeaf(
  styles: StylesTable,
  chain: readonly string[],
  leaf: ContentParagraph,
): ContentParagraph {
  return applyEntry(resolveStyleChain(styles, chain), leaf);
}

// Applies one resolved entry to one paragraph: the entry's paragraph half fills the paragraph's own gaps, its run half fills each run's gaps. Pure -- unchanged halves return the same objects (applyParagraphStyleProperties itself returns the input paragraph when the entry has no paragraph half).
function applyEntry(
  entry: StyleEntry,
  paragraph: ContentParagraph,
): ContentParagraph {
  const withParagraph = applyParagraphStyleProperties(
    entry.paragraph,
    paragraph,
  );
  const runProperties = entry.run;
  if (runProperties === undefined) return withParagraph;
  return {
    ...withParagraph,
    runs: withParagraph.runs.map((run) =>
      applyRunStyleProperties(runProperties, run),
    ),
  };
}

// A drawPage child narrows to its shape-group arm by structure (a vector leaf carries `kind`, never `node`+`children`); the schema's own isShapeGroupNode takes unknown, but the local structural check keeps the narrowing inside the already-typed union without a widening round-trip.
function isShapeGroup(
  child: ShapeGroupNode | ContentVector,
): child is ShapeGroupNode {
  return "node" in child;
}
