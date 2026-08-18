import { z } from 'zod';
import {
  ContentBlockSchema,
  ContentDrawPageSchema,
  ContentEmbeddedObjectSchema,
  ContentFormulaSchema,
  ContentListMembershipSchema,
  ContentParagraphSchema,
  ContentSectionSchema,
  ContentShapeSchema,
  ContentSheetImageSchema,
  ContentSheetSchema,
  ContentSlideSchema,
  ContentVectorSchema,
  type ContentBlock,
  type ContentEmbeddedObject,
  type ContentFormula,
  type ContentSheetImage,
  type ContentVector,
} from './content';
import { ConstructDescriptorSchema, type ConstructDescriptor } from './construct';

// The package tree's node vocabulary (ExaDev/document-schema.js#20's promoted DocumentPackage, as proven by document-outline.js's phase-1 reference implementation -- this module is that shape's schema-home port). Groups are `{ node, children }` where node embeds either an anchor paragraph (heading and list groups carry the full ContentParagraph, runs and formatting and frames included, never a projected text label) or a container descriptor (section / slide / sheet / drawPage, each tagged with a `kind` the flat container type does not carry). Bare leaves carry their own `kind` and never `children` -- discrimination is structural on node+children, because the earlier "anything with kind is a leaf" rule collided with `{ kind: 'slide' }` groups. Grouping never crosses container boundaries: a shape is its own group with its inner blocks grouped inside it, a sheet's grid rides on the sheet node, and an embedded document (the recursive ContentEmbeddedObject arm) stays intact as one leaf. A group may additionally carry `style` -- a string ref into the package's styles table (ExaDev/document-schema.js#21); refs exist only here, never on ContentDocument nodes, so the flat codec-exchange form is always fully materialised. Since 4.1.0 a group's node may also be a construct descriptor (src/construct.ts, ExaDev/document-schema.js#24) -- a contentControl, field, anchor, link, provenance, or division wrapping the block extent it spans -- which is what the tree's construct-capable-from-day-one design was for: the kinds landed additively, so a 4.0.0 tree carrying none of them parses identically under this release.

// The descriptors are built from the content schemas themselves by omit+extend rather than re-declared field by field, so a field added to a container schema in a future release rides its descriptor automatically -- the zod-first spelling of the reference implementation's `Omit<ContentSection, 'blocks'> & { kind: 'section' }` types. Each is strict: the omitted array (the one whose members became the group's children) is rejected, not merely absent, so a raw flat container smuggled in as a descriptor fails validation instead of parsing to a descriptor that silently dropped its content.
export const SectionDescriptorSchema = ContentSectionSchema.omit({ blocks: true })
  .extend({ kind: z.literal('section') })
  .strict();
export type SectionDescriptor = z.infer<typeof SectionDescriptorSchema>;

export const SlideDescriptorSchema = ContentSlideSchema.omit({ shapes: true })
  .extend({ kind: z.literal('slide') })
  .strict();
export type SlideDescriptor = z.infer<typeof SlideDescriptorSchema>;

export const SheetDescriptorSchema = ContentSheetSchema.omit({ images: true, embeddedObjects: true })
  .extend({ kind: z.literal('sheet') })
  .strict();
export type SheetDescriptor = z.infer<typeof SheetDescriptorSchema>;

export const DrawPageDescriptorSchema = ContentDrawPageSchema.omit({ shapes: true, vectors: true })
  .extend({ kind: z.literal('drawPage') })
  .strict();
export type DrawPageDescriptor = z.infer<typeof DrawPageDescriptorSchema>;

// A shape group's node payload: every ContentShape field except its blocks, which the group's children carry grouped by list level. Unlike the four container descriptors this carries no `kind` tag, because ContentShape has none to give -- a shape group is identified structurally by its frame and insets.
export const ShapeDescriptorSchema = ContentShapeSchema.omit({ blocks: true }).strict();
export type ShapeDescriptor = z.infer<typeof ShapeDescriptorSchema>;

// The anchor of a heading group: the heading paragraph itself, embedded whole. The tree never reduces a heading to its text -- that is the outline package's OutlineNode projection, and a decomposition that kept only labels would be lossy by construction. headingLevel moves from optional to required here because a paragraph with neither headingLevel nor list membership is block-flow content, not a group anchor, and belongs at a leaf position -- a tree that wrapped one in { node, children } does not validate.
export const HeadingParagraphSchema = ContentParagraphSchema.extend({
  headingLevel: z.number().int().positive(),
});
export type HeadingParagraph = z.infer<typeof HeadingParagraphSchema>;

// The anchor of a list-item group: the list paragraph itself, embedded whole, for the same reason. list is required here for the same reason headingLevel is above.
export const ListParagraphSchema = ContentParagraphSchema.extend({
  list: ContentListMembershipSchema,
});
export type ListParagraph = z.infer<typeof ListParagraphSchema>;

// The leaf payloads of a package tree, across all five document kinds: wordprocessing/presentation/drawing block flow yields ContentBlock leaves, spreadsheets additionally yield sheet-anchored images (ContentSheetImage) and whole embedded documents (ContentEmbeddedObject, which is not itself a ContentBlock -- it has no `kind` discriminator), drawings yield textless vector primitives (ContentVector), and a formula document yields its single ContentFormula. One union, so one guard set serves every kind.
export type PackageLeaf = ContentBlock | ContentSheetImage | ContentEmbeddedObject | ContentVector | ContentFormula;

// What a section's (or a heading group's) block flow holds: heading groups, list groups, construct groups, and bare block leaves. Headings nest under headings and lists nest inside the open heading scope or under deeper list items; a plain paragraph is a leaf.
export type SectionChild = HeadingGroupNode | ListGroupNode | SectionConstructGroupNode | ContentBlock;

// What a shape's block flow holds: list groups, construct groups, and bare leaves only. Shapes carry no heading hierarchy of their own -- list.level is the only depth signal a slide or drawing shape's paragraphs actually carry -- so a paragraph with headingLevel but no list membership sits flat as a leaf here.
export type ShapeChild = ListGroupNode | ShapeConstructGroupNode | ContentBlock;

// A list group's children: deeper list groups, construct groups, and block leaves. A heading never appears below a list group, because opening a heading resets the list nesting before it opens its own group. The construct group here is the shape-scoped one for exactly that reason: a list item's flow and a shape's flow admit the same children, as ListChild and ShapeChild have always spelled identically.
export type ListChild = ListGroupNode | ShapeConstructGroupNode | ContentBlock;

// What a sheet's children are: its anchored images and its whole embedded documents, in that order (the two live in sibling arrays with no cross-array ordering field, and flatten's type partition reverses this fixed order). Cells are addressable data, never children -- they ride the sheet descriptor.
export type SheetChild = ContentSheetImage | ContentEmbeddedObject;

// What a drawing page's children are: shape groups then vector leaves, in that fixed order (again sibling arrays with no cross-array ordering; flatten's partition reverses it exactly).
export type DrawPageChild = ShapeGroupNode | ContentVector;

export interface SectionGroupNode {
  readonly node: SectionDescriptor;
  style?: string;
  children: SectionChild[];
}

export interface SlideGroupNode {
  readonly node: SlideDescriptor;
  style?: string;
  children: ShapeGroupNode[];
}

export interface SheetGroupNode {
  readonly node: SheetDescriptor;
  style?: string;
  children: SheetChild[];
}

export interface DrawPageGroupNode {
  readonly node: DrawPageDescriptor;
  style?: string;
  children: DrawPageChild[];
}

export interface ShapeGroupNode {
  readonly node: ShapeDescriptor;
  style?: string;
  children: ShapeChild[];
}

export interface HeadingGroupNode {
  readonly node: HeadingParagraph;
  style?: string;
  children: SectionChild[];
}

export interface ListGroupNode {
  readonly node: ListParagraph;
  style?: string;
  children: ListChild[];
}

// The construct groups (src/construct.ts, ExaDev/document-schema.js#24): the same `{ node, children }` wrapper every other group uses, with a construct descriptor as its node and the extent it spans as its children. Two variants, because a construct is transparent to the flow it wraps and the two block flows admit different children: one in a section's or heading group's flow (where headings may nest), one in a shape's or list item's (where they may not). A construct group nests in and around every other group -- a provenance wrapper inside a content control inside a division is a real docx shape -- because both variants are members of the very child unions their own children are drawn from.
export interface SectionConstructGroupNode {
  readonly node: ConstructDescriptor;
  style?: string;
  children: SectionChild[];
}

export interface ShapeConstructGroupNode {
  readonly node: ConstructDescriptor;
  style?: string;
  children: ShapeChild[];
}

export type PackageGroup =
  | SectionGroupNode
  | SlideGroupNode
  | SheetGroupNode
  | DrawPageGroupNode
  | ShapeGroupNode
  | HeadingGroupNode
  | ListGroupNode
  | SectionConstructGroupNode
  | ShapeConstructGroupNode;

export type PackageNode = PackageGroup | PackageLeaf;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The shared wrapper shape every group guard checks: a record whose `node` is itself a record, whose `children` is an array of values each satisfying that group kind's own child predicate, whose optional `style` ref is a string when present, and which carries no other keys -- every group fragment in content-json-schema-defs.ts declares additionalProperties: false over exactly { node, style, children }, so a wrapper with any fourth key must fail here too, or documentFromJson would accept a value the published .schema.json rejects. Per-kind child predicates (not one generic isPackageNode) are what make these guards the untrusted-input boundary: a tree that hangs a paragraph leaf directly off a slide group, or a section group off a sheet, is structurally illegal and rejects here, where the reference implementation's own guard checks children generically (it walks trees it constructed itself; this schema's job is to validate trees it did not).
function isGroupWrapper(value: Record<string, unknown>, isChild: (child: unknown) => boolean): boolean {
  if (!isRecord(value.node)) return false;
  if (value.style !== undefined && typeof value.style !== 'string') return false;
  if (!Object.keys(value).every((key) => key === 'node' || key === 'style' || key === 'children')) return false;
  return Array.isArray(value.children) && value.children.every(isChild);
}

// The leaf arm of every child predicate: a value carrying a top-level `style` key is rejected before the content schema ever sees it. A style ref is legal only on a group wrapper (the resolution chain, src/definitions.ts, walks group ancestors and never leaf payloads), and the content schemas deliberately accept-and-ignore unknown keys -- they are the shared flat-model schemas, and tightening them to strict would change flat ContentDocument parsing far beyond the package tree -- so without this check a leaf-position ref would parse, sit inert through resolution, and still be rejected by the published JSON Schema leaf fragments (additionalProperties: false over exactly the payload's own fields): a tree documentFromJson accepts that the CDN-published .schema.json forbids. Rejecting the key here keeps the runtime guard and the published face aligned at the one boundary this module owns.
function isLeafChild(schema: z.ZodType, value: unknown): boolean {
  if (isRecord(value) && 'style' in value) return false;
  return schema.safeParse(value).success;
}

function isSectionChild(value: unknown): value is SectionChild {
  return (
    isHeadingGroupNode(value) ||
    isListGroupNode(value) ||
    isSectionConstructGroupNode(value) ||
    isLeafChild(ContentBlockSchema, value)
  );
}

function isShapeChild(value: unknown): value is ShapeChild {
  return isListGroupNode(value) || isShapeConstructGroupNode(value) || isLeafChild(ContentBlockSchema, value);
}

function isListChild(value: unknown): value is ListChild {
  return isListGroupNode(value) || isShapeConstructGroupNode(value) || isLeafChild(ContentBlockSchema, value);
}

function isSheetChild(value: unknown): value is SheetChild {
  return isLeafChild(ContentSheetImageSchema, value) || isLeafChild(ContentEmbeddedObjectSchema, value);
}

function isDrawPageChild(value: unknown): value is DrawPageChild {
  return isShapeGroupNode(value) || isLeafChild(ContentVectorSchema, value);
}

// Every group guard tests its own node payload BEFORE walking its children, and the order is load-bearing rather than stylistic: a child predicate tries each group arm in turn, so a guard that walked the whole subtree first and only then rejected on the node would make each arm pay for the entire subtree before failing, and the cost of validating one tree would be (arms per flow) raised to the power of its depth. Node payloads discriminate in constant time and no two group kinds share one (container descriptors carry their own container kind, construct descriptors their construct kind, and the two paragraph anchors are the only pair that can both match one node), so checking the node first means at most one arm ever descends. The conjunction is otherwise unchanged -- both halves are pure predicates, so the order affects only how much work a rejection does.
export function isSectionGroupNode(value: unknown): value is SectionGroupNode {
  return (
    isRecord(value) && SectionDescriptorSchema.safeParse(value.node).success && isGroupWrapper(value, isSectionChild)
  );
}

export function isSlideGroupNode(value: unknown): value is SlideGroupNode {
  return isRecord(value) && SlideDescriptorSchema.safeParse(value.node).success && isGroupWrapper(value, isShapeGroupNode);
}

export function isSheetGroupNode(value: unknown): value is SheetGroupNode {
  return isRecord(value) && SheetDescriptorSchema.safeParse(value.node).success && isGroupWrapper(value, isSheetChild);
}

export function isDrawPageGroupNode(value: unknown): value is DrawPageGroupNode {
  return (
    isRecord(value) && DrawPageDescriptorSchema.safeParse(value.node).success && isGroupWrapper(value, isDrawPageChild)
  );
}

export function isShapeGroupNode(value: unknown): value is ShapeGroupNode {
  return isRecord(value) && ShapeDescriptorSchema.safeParse(value.node).success && isGroupWrapper(value, isShapeChild);
}

export function isHeadingGroupNode(value: unknown): value is HeadingGroupNode {
  return isRecord(value) && HeadingParagraphSchema.safeParse(value.node).success && isGroupWrapper(value, isSectionChild);
}

export function isListGroupNode(value: unknown): value is ListGroupNode {
  return isRecord(value) && ListParagraphSchema.safeParse(value.node).success && isGroupWrapper(value, isListChild);
}

// The two construct-group guards. Nothing else in the vocabulary can be confused for one: every other group's node is either a container descriptor tagged with its own container kind or a ContentParagraph, and no construct descriptor's `kind` collides with any of those, so the child predicates' arm order carries no first-match hazard.
export function isSectionConstructGroupNode(value: unknown): value is SectionConstructGroupNode {
  return (
    isRecord(value) && ConstructDescriptorSchema.safeParse(value.node).success && isGroupWrapper(value, isSectionChild)
  );
}

export function isShapeConstructGroupNode(value: unknown): value is ShapeConstructGroupNode {
  return isRecord(value) && ConstructDescriptorSchema.safeParse(value.node).success && isGroupWrapper(value, isShapeChild);
}

// Leaf validation delegates to the content model's own exported schemas rather than hand-rolling a second, parallel structural guard per payload -- the shapes are src/content.ts's to own, and a hand copy here would drift the first time a schema field changes. The union's first-match-wins order is safe because no leaf type is a structural subset of a later member that would change the verdict.
const packageLeafUnion = z.union([
  ContentBlockSchema,
  ContentSheetImageSchema,
  ContentEmbeddedObjectSchema,
  ContentVectorSchema,
  ContentFormulaSchema,
]);

export function isPackageLeaf(value: unknown): value is PackageLeaf {
  return packageLeafUnion.safeParse(value).success;
}

export function isPackageGroup(value: unknown): value is PackageGroup {
  return (
    isSectionGroupNode(value) ||
    isSlideGroupNode(value) ||
    isSheetGroupNode(value) ||
    isDrawPageGroupNode(value) ||
    isShapeGroupNode(value) ||
    isHeadingGroupNode(value) ||
    isListGroupNode(value) ||
    isSectionConstructGroupNode(value) ||
    isShapeConstructGroupNode(value)
  );
}

export function isPackageNode(value: unknown): value is PackageNode {
  return isPackageGroup(value) || isPackageLeaf(value);
}

// The zod faces of the guards above -- usable wherever a schema value is needed (array element, object property, safeParse of external input). Deliberately z.custom, not z.lazy: z.lazy() collapses the static type of a recursive schema to `unknown` under the pinned zod 4, so the recursion lives in the plain function guards instead (ContentBlockSchema in src/content.ts is the family precedent, OutlineNodeSchema in document-outline.js the direct one).
export const SectionGroupSchema = z.custom<SectionGroupNode>(isSectionGroupNode);
export const SlideGroupSchema = z.custom<SlideGroupNode>(isSlideGroupNode);
export const SheetGroupSchema = z.custom<SheetGroupNode>(isSheetGroupNode);
export const DrawPageGroupSchema = z.custom<DrawPageGroupNode>(isDrawPageGroupNode);
export const ShapeGroupSchema = z.custom<ShapeGroupNode>(isShapeGroupNode);
export const HeadingGroupSchema = z.custom<HeadingGroupNode>(isHeadingGroupNode);
export const ListGroupSchema = z.custom<ListGroupNode>(isListGroupNode);
export const SectionConstructGroupSchema = z.custom<SectionConstructGroupNode>(isSectionConstructGroupNode);
export const ShapeConstructGroupSchema = z.custom<ShapeConstructGroupNode>(isShapeConstructGroupNode);
export const PackageGroupSchema = z.custom<PackageGroup>(isPackageGroup);
export const PackageLeafSchema = z.custom<PackageLeaf>(isPackageLeaf);
export const PackageNodeSchema = z.custom<PackageNode>(isPackageNode);
