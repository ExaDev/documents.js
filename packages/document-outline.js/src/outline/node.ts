import { z } from "zod";
import { isTreeLeaf, type TreeLeaf } from "document-schema.js";

// Every payload that can sit at an outline leaf position, across all five document kinds. Since document-schema.js 4.0.0 this is exactly that package's own TreeLeaf union (ExaDev/document-schema.js#20 promoted DocumentTree to the tree form and moved the node vocabulary into the schema) -- aliased here rather than re-declared, because two hand copies of one union would drift the first time a payload type changed. The outline projects over these payloads for its TOC view while consumers walk them as structure.
export type OutlineLeaf = TreeLeaf;

// A non-leaf outline position: either a nested group or one of the leaf payloads above. Distinguishable structurally without a discriminator field because no leaf type carries a top-level `children` array (or `text`/`level`), while every group carries all three.
export type OutlineChild = OutlineNode | OutlineLeaf;

// One node of the outline tree -- this package's own projection type, deliberately distinct from the package tree's own group vocabulary: an OutlineNode is the TOC view of a tree (a label, a source level, and nested children), not a lossless structural node. `text` is the group's own display label (a heading's text, a list paragraph's text, or the synthetic "Slide N" / sheet name / "Page N" / formula label). `level` is the node's SOURCE level signal carried verbatim, not its tree depth: heading groups carry ContentParagraph.headingLevel (1-based, 1 = outermost), list-item groups carry ContentParagraph.list.level (0-based, the scale the source formats themselves use), and the synthetic per-slide/sheet/page/formula groups are level 1. Tree depth is always recoverable from the nesting itself -- consumers rendering indentation must nest, not read `level`, because a slide group (level 1) legitimately contains list items at levels 0, 1, 2... on the list scale. `children` mixes nested groups and leaf payloads in document order. text/level are readonly because they are fixed at construction; children is a mutable array because the builder pushes into it while assembling a scope (and consumers receive the same arrays it grew). Deep immutability is not claimed -- as with document-schema.js's own inferred types, the type describes the shape, and mutation discipline is the caller's.
export interface OutlineNode {
  readonly text: string;
  readonly level: number;
  children: OutlineChild[];
}

// Leaf validation is document-schema.js's own guard -- the payloads are its TreeLeaf union, so its isTreeLeaf is the single authority on what a valid leaf is. This alias exists so the outline's guard set keeps a leaf-side member symmetrical with isOutlineNode/isOutlineChild.
export function isOutlineLeaf(value: unknown): value is OutlineLeaf {
  return isTreeLeaf(value);
}

// The child-position guard: one predicate covering both classes of outline child, so a whole tree (or the root array buildOutline returns) validates with a single every() call.
export function isOutlineChild(value: unknown): value is OutlineChild {
  return isOutlineNode(value) || isOutlineLeaf(value);
}

// Recursive structural guard, hand-written for the same reason document-schema.js hand-writes isContentBlock: z.lazy() collapses the static type of a recursive schema to `unknown` under the pinned zod 4, so OutlineNodeSchema is a z.custom over this guard instead. Discrimination rule: a record with a string `text`, a number `level`, and an array `children` (every element itself a valid child) is a group; anything else must validate as a leaf. No leaf schema has a top-level `text`, `level`, or `children` field, so the two classes cannot be confused in either direction.
export function isOutlineNode(value: unknown): value is OutlineNode {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  if (!("text" in value) || typeof value.text !== "string") return false;
  if (
    !("level" in value) ||
    typeof value.level !== "number" ||
    !Number.isFinite(value.level)
  )
    return false;
  if (!("children" in value) || !Array.isArray(value.children)) return false;
  return value.children.every(isOutlineChild);
}

// The zod face of the guard above -- usable wherever a schema value is needed (array element, object property, safeParse of external input). Deliberately z.custom, not z.lazy: see isOutlineNode.
export const OutlineNodeSchema = z.custom<OutlineNode>(isOutlineNode);
