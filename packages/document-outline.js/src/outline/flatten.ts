import {
  CONTENT_FORMAT_VERSION,
  ContentFormulaSchema,
  type ContentBlock,
  type ContentDocument,
  type ContentEmbeddedObject,
  type ContentFormula,
  type ContentSection,
  type ContentShape,
  type ContentSheet,
  type ContentSheetImage,
  type ContentSlide,
  type ContentVector,
  type LayoutMetadata,
  type SymbolTable,
} from 'document-schema.js';
import { isDrawPageGroup, isSectionGroup, isSheetGroup, isSlideGroup } from './package-node';
import type { PackageRoot, SectionChild, ShapeGroupNode } from './package-node';

// The document-level fields a package tree cannot carry: the tree holds only containers and content nodes, so the envelope flatten needs to rebuild a ContentDocument -- its kind, its required metadata, and the optional document-level symbolTable -- travels beside the tree rather than inside it. kind is here and not inferred from the top-level nodes because the empty documents are legal (a presentation with no slides, a wordprocessing document with no sections, both decompose to an empty root array) and an inferred kind would make flatten(decompose(pkg)) impossible for exactly those -- the envelope keeps the bijection total. metadata and symbolTable round-trip through here verbatim, which is what makes flatten(decompose(pkg)) reproduce pkg.content exactly rather than up to document-level fields.
export interface DocumentEnvelope {
  kind: ContentDocument['kind'];
  metadata: LayoutMetadata;
  symbolTable?: SymbolTable;
}

// Extracts the envelope of a ContentDocument for the flatten call -- flatten(decompose(pkg), documentEnvelope(pkg.content)) is the exact inverse of decompose, and this helper keeps every caller from hand-picking the three fields.
export function documentEnvelope(content: ContentDocument): DocumentEnvelope {
  return {
    kind: content.kind,
    metadata: content.metadata,
    ...(content.symbolTable !== undefined ? { symbolTable: content.symbolTable } : {}),
  };
}

// The exact inverse of decompose: a pre-order walk over the tree reconstituting sections, slides, sheets, and pages in document order, re-emitting every group-represented paragraph as an ordinary block (a heading or list group's anchor paragraph IS the block; it was never copied, only wrapped). Leaf nodes pass through as the same objects. The result is schema-valid against ContentDocumentSchema and structurally identical to the source document -- the bijection law flatten(decompose(pkg)) reproduces pkg.content exactly, pinned in bijection.test.ts.
export function flatten(nodes: readonly PackageRoot[], envelope: DocumentEnvelope): ContentDocument {
  // Annotated rather than inferred: a literal containing a conditional spread widens its literal-typed properties, which would turn formatVersion's literal 3 into number and fail the ContentDocument arms' own literal field. typeof keeps the value derived from document-schema.js's constant rather than restating a 3 here.
  const shared: { formatVersion: typeof CONTENT_FORMAT_VERSION; metadata: LayoutMetadata; symbolTable?: SymbolTable } = {
    formatVersion: CONTENT_FORMAT_VERSION,
    metadata: envelope.metadata,
    ...(envelope.symbolTable !== undefined ? { symbolTable: envelope.symbolTable } : {}),
  };
  switch (envelope.kind) {
    case 'wordprocessing':
      return {
        kind: 'wordprocessing',
        ...shared,
        sections: nodes.map((group): ContentSection => {
          if (!isSectionGroup(group)) throw new Error('flatten: a wordprocessing envelope takes section groups only');
          return { ...untag(group.node), blocks: flattenBlocks(group.children) };
        }),
      };
    case 'presentation':
      return {
        kind: 'presentation',
        ...shared,
        slides: nodes.map((group): ContentSlide => {
          if (!isSlideGroup(group)) throw new Error('flatten: a presentation envelope takes slide groups only');
          return { ...untag(group.node), shapes: group.children.map(flattenShape) };
        }),
      };
    case 'spreadsheet':
      return {
        kind: 'spreadsheet',
        ...shared,
        sheets: nodes.map((group): ContentSheet => {
          if (!isSheetGroup(group)) throw new Error('flatten: a spreadsheet envelope takes sheet groups only');
          const images: ContentSheetImage[] = [];
          const embedded: ContentEmbeddedObject[] = [];
          for (const child of group.children) {
            // ContentSheetImage carries a `kind` ('image') and ContentEmbeddedObject carries none, so the property's presence partitions the two sibling arrays exactly as decompose concatenated them.
            if ('kind' in child) images.push(child);
            else embedded.push(child);
          }
          // embeddedObjects is rebuilt only when the sheet actually carried embedded objects, so a sheet whose field was absent round-trips with it absent again -- absent-versus-present is content here, not a default to fill in.
          return { ...untag(group.node), images, ...(embedded.length > 0 ? { embeddedObjects: embedded } : {}) };
        }),
      };
    case 'drawing':
      return {
        kind: 'drawing',
        ...shared,
        pages: nodes.map((group) => {
          if (!isDrawPageGroup(group)) throw new Error('flatten: a drawing envelope takes drawPage groups only');
          const shapes: ContentShape[] = [];
          const vectors: ContentVector[] = [];
          for (const child of group.children) {
            // Shape groups carry `node`; vectors do not -- the presence check reverses decompose's fixed shapes-then-vectors concatenation without re-inspecting payloads.
            if ('node' in child) shapes.push(flattenShape(child));
            else vectors.push(child);
          }
          return { ...untag(group.node), shapes, vectors };
        }),
      };
    case 'formula': {
      // A formula document is the one tree shape with no container: exactly one node, the ContentFormula leaf itself.
      const first = nodes[0];
      if (nodes.length !== 1 || first === undefined || !isContentFormula(first)) {
        throw new Error('flatten: a formula envelope takes exactly one ContentFormula node');
      }
      return { kind: 'formula', ...shared, formula: first };
    }
  }
}

// Strips a container descriptor's tree-only `kind` tag, keeping every other field by spread rather than by naming them: decompose rest-spreads each flat container's fields into its descriptor (minus the arrays that became children), so a container field added by a future schema release rides the descriptor, and flatten must hand it back without this package ever naming it. Copy-then-delete rather than destructuring the tag out, because the repo's lint bans unused bindings outright and a destructured-away tag would be exactly that.
function untag<D extends { kind: string }>(descriptor: D): Omit<D, 'kind'> {
  const copy: { kind?: D['kind'] } & Omit<D, 'kind'> = { ...descriptor };
  delete copy.kind;
  return copy;
}

function flattenShape(group: ShapeGroupNode): ContentShape {
  // A shape group's descriptor needs no untagging -- ContentShape carries no kind, so the descriptor is every field except blocks and the blocks ride straight back on.
  return { ...group.node, blocks: flattenBlocks(group.children) };
}

// Walks one block flow in document order: an anchor group emits its own paragraph first, then its children's flow below it (pre-order -- exactly the order the blocks occupied before decompose grouped them); a leaf emits itself. ShapeChild[] and ListChild[] are both sub-ranges of SectionChild, so one function serves section flows, heading-group flows, list-group flows, and shape flows alike.
function flattenBlocks(children: readonly SectionChild[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const child of children) {
    if ('node' in child && 'children' in child) {
      blocks.push(child.node, ...flattenBlocks(child.children));
    } else {
      blocks.push(child);
    }
  }
  return blocks;
}

function isContentFormula(value: PackageRoot): value is ContentFormula {
  return ContentFormulaSchema.safeParse(value).success;
}
