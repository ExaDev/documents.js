import {
  applyParagraphStyleProperties,
  applyRunStyleProperties,
  ContentFormulaSchema,
  resolveStyleChain,
  type ContentBlock,
  type ContentDocument,
  type ContentDrawPage,
  type ContentEmbeddedObject,
  type ContentParagraph,
  type ContentSection,
  type ContentShape,
  type ContentSheet,
  type ContentSheetImage,
  type ContentSlide,
  type ContentVector,
  type DocumentPackage,
  type HeadingGroupNode,
  type ListGroupNode,
  type SectionChild,
  type ShapeGroupNode,
  type StyleEntry,
  type StylesTable,
} from 'document-schema.js';

// The tree-to-flat half of the package boundary, ported from document-outline.js's phase-1 reference (pre-re-charter history) onto schema 4's tree types, with the styles resolution the reference left as a separate effective/effectiveTree seam fused directly into the walk: the flat codec-exchange form is ALWAYS fully materialised (no table, no refs -- document-schema.js#21's own rule), so materialising and restructuring are one pass here. Resolution semantics are the reviewed reference's: a group's ref plus every ancestor group's ref overlays onto each paragraph in that group's subtree -- group anchors (heading and list groups carry ContentParagraph anchors) and bare paragraph leaves alike -- with the chain ordered outermost first so the nearest group's entry wins over further-out ones and the paragraph's own direct properties win over everything (applyParagraphStyleProperties / applyRunStyleProperties fill gaps, never overwrite). The run half of a resolved entry applies to every run of each paragraph it resolved for. The walk's boundary is the block flow: a table leaf's cell paragraphs and an embedded document's own content are leaf-local payload this walk does not rewrite, exactly as resolution does not.
//
// For a styles-free package the walk emits the SAME node objects the tree embeds (no copies -- the ownership discipline decompose.ts states), so flattenPackage(assemblePackage(c)) shares every content node with c unless minting factored a property tuple onto a wrapper ref (those paragraphs come back as resolved copies carrying identical values).

// A group's chain extended by its own ref when it carries one: the array passed to everything inside the group, which is how a group's style applies to its whole subtree. Outermost-first order, so resolveStyleChain's overlay fold makes the nearest entry win over further-out ones.
function chainWithRef(chain: readonly string[], group: { readonly style?: string }): readonly string[] {
  return group.style === undefined ? chain : [...chain, group.style];
}

// The resolved entry a chain names, or undefined for an empty chain. resolveStyleChain itself is the loud refusal on a ref the styles table does not carry: consistency between refs and the table is the producer's responsibility, and once resolution runs it runs completely or not at all.
function entryOf(styles: StylesTable | undefined, chain: readonly string[]): StyleEntry | undefined {
  if (chain.length === 0) return undefined;
  if (styles === undefined) {
    throw new Error('flattenPackage: a group carries a style ref but the package has no styles table');
  }
  return resolveStyleChain(styles, chain);
}

// Applies one resolved entry to one paragraph: the entry's paragraph half fills the paragraph's own gaps, its run half fills each run's gaps. Pure -- unchanged halves return the same objects (applyParagraphStyleProperties itself returns the input paragraph when the entry has no paragraph half).
function applyEntry(entry: StyleEntry, paragraph: ContentParagraph): ContentParagraph {
  const withParagraph = applyParagraphStyleProperties(entry.paragraph, paragraph);
  const runProperties = entry.run;
  if (runProperties === undefined) return withParagraph;
  return { ...withParagraph, runs: withParagraph.runs.map((run) => applyRunStyleProperties(runProperties, run)) };
}

// The exact inverse of decompose: a pre-order walk over the tree reconstituting sections, slides, sheets, and pages in document order, re-emitting every group-represented paragraph as an ordinary block (a heading or list group's anchor paragraph IS the block; it was never copied, only wrapped) with every style ref resolved away into materialised direct properties. Leaf nodes pass through as the same objects. The result is schema-valid against ContentDocumentSchema and structurally identical to the source document the tree was assembled from -- the bijection law flattenPackage(assemblePackage(c)) reproduces c exactly, pinned in bijection.test.ts.
export function flattenPackage(pkg: DocumentPackage): ContentDocument {
  const styles = pkg.styles;
  const envelope = {
    metadata: pkg.metadata,
    ...(pkg.symbolTable !== undefined ? { symbolTable: pkg.symbolTable } : {}),
  };
  switch (pkg.kind) {
    case 'wordprocessing':
      return {
        kind: 'wordprocessing',
        ...envelope,
        sections: pkg.children.map((group): ContentSection => ({
          ...untag(group.node),
          blocks: flattenSectionChildren(styles, chainWithRef([], group), group.children),
        })),
      };
    case 'presentation':
      return {
        kind: 'presentation',
        ...envelope,
        slides: pkg.children.map((group): ContentSlide => {
          const chain = chainWithRef([], group);
          return { ...untag(group.node), shapes: group.children.map((shape) => flattenShape(styles, chain, shape)) };
        }),
      };
    case 'spreadsheet':
      return {
        kind: 'spreadsheet',
        ...envelope,
        sheets: pkg.children.map((group): ContentSheet => {
          // The schema allows a style ref on every group node, but a sheet group holds no block flow, so a chain built here has nothing to resolve onto -- refuse rather than pass the ref by silently, the same all-or-nothing rule as entryOf's missing-table refusal below. Minting never stamps a ref on a sheet (its extent is always empty); the guard is for hand-built trees.
          if (group.style !== undefined) {
            throw new Error('flattenPackage: a sheet group carries a style ref but a sheet holds no block flow to resolve it onto');
          }
          const images: ContentSheetImage[] = [];
          const embedded: ContentEmbeddedObject[] = [];
          for (const child of group.children) {
            // ContentSheetImage carries a `kind` ('image') and ContentEmbeddedObject carries none, so the property's presence partitions the two sibling arrays exactly as decompose concatenated them.
            if ('kind' in child) images.push(child);
            else embedded.push(child);
          }
          // embeddedObjects is rebuilt only when the sheet actually carried embedded objects, so a sheet whose field was absent round-trips with it absent again -- absent-versus-present is content here, not a default to fill in. The one declared exception: a present-but-empty array (schema-legal, emitted by no codec) is indistinguishable from an absent field once decompose has concatenated images and embedded objects into one children array, so it normalises to absent (bijection.test.ts declares the normalisation on both sides).
          return { ...untag(group.node), images, ...(embedded.length > 0 ? { embeddedObjects: embedded } : {}) };
        }),
      };
    case 'drawing':
      return {
        kind: 'drawing',
        ...envelope,
        pages: pkg.children.map((group): ContentDrawPage => {
          const chain = chainWithRef([], group);
          const shapes: ContentShape[] = [];
          const vectors: ContentVector[] = [];
          for (const child of group.children) {
            // Shape groups carry `node`; vectors do not -- the presence check reverses decompose's fixed shapes-then-vectors concatenation without re-inspecting payloads.
            if ('node' in child) shapes.push(flattenShape(styles, chain, child));
            else vectors.push(child);
          }
          return { ...untag(group.node), shapes, vectors };
        }),
      };
    case 'formula': {
      // A formula document is the one tree shape with no container: exactly one node, the ContentFormula leaf itself.
      const first = pkg.children[0];
      if (pkg.children.length !== 1 || first === undefined || !ContentFormulaSchema.safeParse(first).success) {
        throw new Error('flattenPackage: a formula package takes exactly one ContentFormula node');
      }
      return { kind: 'formula', ...envelope, formula: first };
    }
  }
}

// Strips a container descriptor's tree-only `kind` tag, keeping every other field by spread rather than by naming them: decompose rest-spreads each flat container's fields into its descriptor (minus the arrays that became children), so a container field added by a future schema release rides the descriptor, and flatten must hand it back without this package ever naming it. Copy-then-delete rather than destructuring the tag out, because the repo's lint bans unused bindings outright and a destructured-away tag would be exactly that.
function untag<D extends { kind: string }>(descriptor: D): Omit<D, 'kind'> {
  const copy: { kind?: D['kind'] } & Omit<D, 'kind'> = { ...descriptor };
  delete copy.kind;
  return copy;
}

function flattenShape(styles: StylesTable | undefined, chain: readonly string[], group: ShapeGroupNode): ContentShape {
  // A shape group's descriptor needs no untagging -- ContentShape carries no kind, so the descriptor is every field except blocks and the blocks ride straight back on.
  return { ...group.node, blocks: flattenListChildren(styles, chainWithRef(chain, group), group.children) };
}

// One section-flow child walk: nested heading/list groups recurse with their extended chain, a bare paragraph leaf resolves against the incoming chain (it carries no ref of its own -- refs are legal only on group wrappers), and every other leaf is its own payload, untouched.
function flattenSectionChildren(styles: StylesTable | undefined, chain: readonly string[], children: readonly SectionChild[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const child of children) {
    if (isHeadingGroup(child)) {
      const own = chainWithRef(chain, child);
      blocks.push(resolveAnchor(styles, own, child.node), ...flattenSectionChildren(styles, own, child.children));
    } else if (isListGroup(child)) {
      const own = chainWithRef(chain, child);
      blocks.push(resolveAnchor(styles, own, child.node), ...flattenListChildren(styles, own, child.children));
    } else if (child.kind === 'paragraph') {
      const entry = entryOf(styles, chain);
      blocks.push(entry === undefined ? child : applyEntry(entry, child));
    } else {
      blocks.push(child);
    }
  }
  return blocks;
}

// The shared vocabulary of shape flows and list-group children (ListGroupNode | ContentBlock), so one walk serves both.
function flattenListChildren(styles: StylesTable | undefined, chain: readonly string[], children: readonly (ListGroupNode | ContentBlock)[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const child of children) {
    if (isListGroup(child)) {
      const own = chainWithRef(chain, child);
      blocks.push(resolveAnchor(styles, own, child.node), ...flattenListChildren(styles, own, child.children));
    } else if (child.kind === 'paragraph') {
      const entry = entryOf(styles, chain);
      blocks.push(entry === undefined ? child : applyEntry(entry, child));
    } else {
      blocks.push(child);
    }
  }
  return blocks;
}

// Structural narrows over the already-typed child unions, avoiding a widening round-trip through the schema's unknown-taking guards inside this module's own walks: both group kinds carry `node`+`children`, no block leaf does.
function isHeadingGroup(child: SectionChild): child is HeadingGroupNode {
  return 'node' in child && 'children' in child && child.node.kind === 'paragraph' && child.node.headingLevel !== undefined;
}

function isListGroup(child: SectionChild | ListGroupNode | ContentBlock): child is ListGroupNode {
  return 'node' in child && 'children' in child && child.node.kind === 'paragraph' && child.node.list !== undefined;
}

// One group anchor under its own chain: an empty chain leaves the anchor object as-is (the ownership discipline -- no copies when nothing resolves), anything else resolves the entry and applies it; the anchor's required grouping signal survives gap-fill by construction, and a resolved heading/list anchor keeps its narrowed type through the shared ContentParagraph return.
function resolveAnchor(styles: StylesTable | undefined, chain: readonly string[], anchor: HeadingGroupNode['node'] | ListGroupNode['node']): ContentParagraph {
  const entry = entryOf(styles, chain);
  if (entry === undefined) return anchor;
  return applyEntry(entry, anchor);
}
