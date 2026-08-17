import { z } from 'zod';
import {
  ContentBlockSchema,
  ContentEmbeddedObjectSchema,
  ContentFormulaSchema,
  ContentSheetImageSchema,
  ContentVectorSchema,
  type ContentBlock,
  type ContentEmbeddedObject,
  type ContentFormula,
  type ContentSheetImage,
  type ContentVector,
} from 'document-schema.js';

// Every payload that can sit at an outline leaf position, across all five ContentDocument kinds: wordprocessing/presentation/drawing block flow yields ContentBlock leaves, spreadsheets additionally yield sheet-anchored images (ContentSheetImage) and whole embedded documents (ContentEmbeddedObject, which is not itself a ContentBlock -- it has no `kind` discriminator), drawings yield textless vector primitives (ContentVector), and a formula document yields its single ContentFormula. The union is what makes one flatten/leaf-text/hash helper set serve every kind.
export type OutlineLeaf =
  | ContentBlock
  | ContentSheetImage
  | ContentEmbeddedObject
  | ContentVector
  | ContentFormula;

// A non-leaf outline position: either a nested group or one of the leaf payloads above. Distinguishable structurally without a discriminator field because no leaf type carries a top-level `children` array (or `text`/`level`), while every group carries all three.
export type OutlineChild = OutlineNode | OutlineLeaf;

// One node of the outline tree. `text` is the group's own display label (a heading's text, a list paragraph's text, or the synthetic "Slide N" / sheet name / "Page N" / formula label). `level` is the node's SOURCE level signal carried verbatim, not its tree depth: heading groups carry ContentParagraph.headingLevel (1-based, 1 = outermost), list-item groups carry ContentParagraph.list.level (0-based, the scale the source formats themselves use), and the synthetic per-slide/sheet/page/formula groups are level 1. Tree depth is always recoverable from the nesting itself -- consumers rendering indentation must nest, not read `level`, because a slide group (level 1) legitimately contains list items at levels 0, 1, 2... on the list scale. `children` mixes nested groups and leaf payloads in document order.
// text/level are readonly because they are fixed at construction; children is a mutable array because the builder pushes into it while assembling a scope (and consumers receive the same arrays it grew). Deep immutability is not claimed -- as with document-schema.js's own inferred types, the type describes the shape, and mutation discipline is the caller's.
export interface OutlineNode {
  readonly text: string;
  readonly level: number;
  children: OutlineChild[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Leaf validation delegates to document-schema.js's own exported schemas rather than hand-rolling a second, parallel structural guard for each leaf type -- the shapes are document-schema.js's to own, and a hand copy here would drift the first time a schema field changes. ContentBlockSchema et al. are themselves z.custom schemas with hand-written guards (the family's established pattern for recursive/self-referential content), so safeParse is a plain function call per candidate, and the union's first-match-wins order is safe because no leaf type is a structural subset of a later member that would change the verdict.
const OutlineLeafSchema = z.union([
  ContentBlockSchema,
  ContentSheetImageSchema,
  ContentEmbeddedObjectSchema,
  ContentVectorSchema,
  ContentFormulaSchema,
]);

export function isOutlineLeaf(value: unknown): value is OutlineLeaf {
  return OutlineLeafSchema.safeParse(value).success;
}

// The child-position guard: one predicate covering both classes of outline child, so a whole tree (or the root array buildOutline returns) validates with a single every() call.
export function isOutlineChild(value: unknown): value is OutlineChild {
  return isOutlineNode(value) || isOutlineLeaf(value);
}

// Recursive structural guard, hand-written for the same reason document-schema.js hand-writes isContentBlock: z.lazy() collapses the static type of a recursive schema to `unknown` under the pinned zod 4, so OutlineNodeSchema is a z.custom over this guard instead. Discrimination rule: a record with a string `text`, a number `level`, and an array `children` (every element itself a valid child) is a group; anything else must validate as a leaf. No leaf schema has a top-level `text`, `level`, or `children` field, so the two classes cannot be confused in either direction.
export function isOutlineNode(value: unknown): value is OutlineNode {
  if (!isRecord(value)) return false;
  if (typeof value.text !== 'string') return false;
  if (typeof value.level !== 'number' || !Number.isFinite(value.level)) return false;
  if (!Array.isArray(value.children)) return false;
  return value.children.every(isOutlineChild);
}

// The zod face of the guard above -- usable wherever a schema value is needed (array element, object property, safeParse of external input). Deliberately z.custom, not z.lazy: see isOutlineNode.
export const OutlineNodeSchema = z.custom<OutlineNode>(isOutlineNode);
