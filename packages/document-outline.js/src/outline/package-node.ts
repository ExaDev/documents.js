import { z } from 'zod';
import {
  BoxSchema,
  ContentParagraphSchema,
  ContentSheetCellSchema,
  ContentSheetColumnSchema,
  ContentSheetPrintSettingsSchema,
  ContentSheetRowSchema,
  MarginsSchema,
  PageSizeSchema,
  type ContentBlock,
  type ContentDrawPage,
  type ContentEmbeddedObject,
  type ContentListMembership,
  type ContentParagraph,
  type ContentSection,
  type ContentShape,
  type ContentSheet,
  type ContentFormula,
  type ContentSheetImage,
  type ContentSlide,
  type ContentVector,
} from 'document-schema.js';
import { isOutlineLeaf, type OutlineLeaf } from './node';

// The package tree (ExaDev/document-schema.js#20's promoted DocumentPackage, phase 1 per ExaDev/document-outline.js#2): groups are `{ node, children }` where node embeds either an anchor paragraph (heading and list groups carry the full ContentParagraph, runs and formatting and frames included, never a projected text label) or a container descriptor (section / slide / sheet / drawPage, each tagged with a `kind` the flat container type does not carry). Bare leaves carry their own `kind` and never `children` -- discrimination is structural on node+children, because the earlier "anything with kind is a leaf" rule collided with `{ kind: 'slide' }` groups. Grouping never crosses container boundaries: a shape is its own group with its inner blocks grouped inside it, a sheet's grid rides on the sheet node, and an embedded document (the recursive ContentEmbeddedObject arm) stays intact as one leaf.

// The leaf payloads of a package tree are exactly the outline's leaf payloads -- the same five-member union over document-schema.js's own types (block flow, sheet-anchored images, whole embedded documents, textless drawing vectors, a formula document's ContentFormula). Aliased rather than re-declared: the outline projects over these payloads for its TOC view while decompose/flatten round-trip them as structure, and two hand copies of one union would drift the first time a payload type changed.
export type PackageLeaf = OutlineLeaf;

// A section container descriptor: every ContentSection field except its blocks, tagged 'section'. The blocks are what the group's children carry, grouped by heading and list level. Section groups are mandatory in a package tree (not one tree per document): a ContentSection carries pre-layout page geometry that a plain rendered-pages array cannot hold, and reconstruction routinely produces multi-section documents, so without section groups the flatten bijection is unsatisfiable.
export type SectionDescriptor = Omit<ContentSection, 'blocks'> & { kind: 'section' };

// A slide container descriptor: every ContentSlide field except its shapes, tagged 'slide'. Each shape becomes one shape group child, so grouping never crosses a shape boundary -- the flat shape order is preserved by the children's order. notes rides the descriptor because it is slide-level data with no block-flow position, exactly like a section's own margins.
export type SlideDescriptor = Omit<ContentSlide, 'shapes'> & { kind: 'slide' };

// A sheet container descriptor: every ContentSheet field except the two arrays whose members become children, tagged 'sheet'. The grid (cells, columns, rows) and printSettings are addressable data rather than block flow, so they ride ON the sheet node while children carry the images and embedded objects.
export type SheetDescriptor = Omit<ContentSheet, 'images' | 'embeddedObjects'> & { kind: 'sheet' };

// A drawing-page container descriptor: every ContentDrawPage field except its shapes and vectors, tagged 'drawPage'. Shapes become shape-group children and vectors become bare-leaf children (in that fixed order -- see decompose), so only the page's own geometry rides the descriptor.
export type DrawPageDescriptor = Omit<ContentDrawPage, 'shapes' | 'vectors'> & { kind: 'drawPage' };

// A shape group's node payload: every ContentShape field except its blocks, which the group's children carry grouped by list level. Unlike the four container descriptors this carries no `kind` tag, because ContentShape has none to give -- a shape group is identified structurally by its frame and insets (isShapeDescriptor below).
export type ShapeDescriptor = Omit<ContentShape, 'blocks'>;

// The anchor of a heading group: the heading paragraph itself, embedded whole. The tree never reduces a heading to its text -- that is the outline's OutlineNode projection, and a decomposition that kept only labels would be lossy by construction.
export type HeadingParagraph = ContentParagraph & { headingLevel: number };

// The anchor of a list-item group: the list paragraph itself, embedded whole, for the same reason.
export type ListParagraph = ContentParagraph & { list: ContentListMembership };

// What a section's (or a heading group's) block flow decomposes into: heading groups, list groups, and bare block leaves. Headings nest under headings and lists nest inside the open heading scope or under deeper list items; a plain paragraph is a leaf that closes the list nesting.
export type SectionChild = HeadingGroupNode | ListGroupNode | ContentBlock;

// What a shape's block flow decomposes into: list groups and bare leaves only. Shapes carry no heading hierarchy of their own -- list.level is the only depth signal a slide or drawing shape's paragraphs actually carry, the same rule buildOutline applies -- so a paragraph with headingLevel but no list membership sits flat as a leaf here.
export type ShapeChild = ListGroupNode | ContentBlock;

// A list group's children: deeper list groups and block leaves. A heading never appears below a list group, because opening a heading resets the list nesting before it opens its own group (the stack semantics in decompose), so the two nesting orders never invert.
export type ListChild = ListGroupNode | ContentBlock;

export interface SectionGroupNode {
  readonly node: SectionDescriptor;
  children: SectionChild[];
}

export interface SlideGroupNode {
  readonly node: SlideDescriptor;
  children: ShapeGroupNode[];
}

export interface SheetGroupNode {
  readonly node: SheetDescriptor;
  children: SheetChild[];
}

// What a sheet's children are: its anchored images and its whole embedded documents, in that order (the two live in sibling arrays with no cross-array ordering field, and this fixed order is what flatten's type partition reverses). Cells are addressable data, never children -- they ride the sheet descriptor.
export type SheetChild = ContentSheetImage | ContentEmbeddedObject;

export interface DrawPageGroupNode {
  readonly node: DrawPageDescriptor;
  children: DrawPageChild[];
}

// What a drawing page's children are: shape groups then vector leaves, in that fixed order (again sibling arrays with no cross-array ordering; the order matches the schema's own declaration order and buildOutline's, and flatten's partition reverses it exactly).
export type DrawPageChild = ShapeGroupNode | ContentVector;

export interface ShapeGroupNode {
  readonly node: ShapeDescriptor;
  children: ShapeChild[];
}

export interface HeadingGroupNode {
  readonly node: HeadingParagraph;
  children: SectionChild[];
}

export interface ListGroupNode {
  readonly node: ListParagraph;
  children: ListChild[];
}

export type PackageGroup =
  | SectionGroupNode
  | SlideGroupNode
  | SheetGroupNode
  | DrawPageGroupNode
  | ShapeGroupNode
  | HeadingGroupNode
  | ListGroupNode;

export type PackageNode = PackageGroup | PackageLeaf;

// What decompose returns and flatten accepts: one group per top-level container (sections, slides, sheets, draw pages), except a formula document, which has no container structure at all and is its single ContentFormula leaf. Narrower than PackageNode on purpose -- the top level cannot legally hold a shape group or a stray block, and the type says so.
export type PackageRoot = SectionGroupNode | SlideGroupNode | SheetGroupNode | DrawPageGroupNode | ContentFormula;

// Property-presence predicates over ContentParagraph, so decompose's branches narrow the paragraph itself (not just a property access) to the anchor types above -- a plain property `!== undefined` check narrows the access, never the object, and `{ node: paragraph }` needs the narrowed object.
export function isHeadingParagraph(paragraph: ContentParagraph): paragraph is HeadingParagraph {
  return paragraph.headingLevel !== undefined;
}

export function isListParagraph(paragraph: ContentParagraph): paragraph is ListParagraph {
  return paragraph.list !== undefined;
}

// Per-kind root narrowers. These exist because TypeScript does not narrow a union from a comparison against a NESTED discriminant (`group.node.kind === 'section'` narrows group.node at best, never `group`, whose children type then stays the whole union) -- an explicit predicate narrows the group itself, which is what flatten's per-kind walks need. They take PackageRoot (the top-level union) rather than unknown: a consumer validating untrusted input validates with isPackageNode first, and these answer the narrower question "which kind of root is this already-typed root".
export function isSectionGroup(value: PackageRoot): value is SectionGroupNode {
  return 'node' in value && value.node.kind === 'section';
}

export function isSlideGroup(value: PackageRoot): value is SlideGroupNode {
  return 'node' in value && value.node.kind === 'slide';
}

export function isSheetGroup(value: PackageRoot): value is SheetGroupNode {
  return 'node' in value && value.node.kind === 'sheet';
}

export function isDrawPageGroup(value: PackageRoot): value is DrawPageGroupNode {
  return 'node' in value && value.node.kind === 'drawPage';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Descriptor validation delegates to document-schema.js's own exported schemas field by field rather than hand-rolling parallel structural guards -- the shapes are document-schema.js's to own, and a hand copy here would drift the first time a schema field changed (the same delegation node.ts's leaf union uses). The `kind` tags are this package's own: they exist only in the tree encoding, so their literal check is the one thing hand-written here.

function isSectionDescriptor(value: unknown): value is SectionDescriptor {
  return (
    isRecord(value) &&
    value.kind === 'section' &&
    PageSizeSchema.safeParse(value.pageSize).success &&
    MarginsSchema.safeParse(value.margins).success
  );
}

function isSlideDescriptor(value: unknown): value is SlideDescriptor {
  return (
    isRecord(value) &&
    value.kind === 'slide' &&
    PageSizeSchema.safeParse(value.size).success &&
    typeof value.notes === 'string'
  );
}

function isSheetDescriptor(value: unknown): value is SheetDescriptor {
  return (
    isRecord(value) &&
    value.kind === 'sheet' &&
    typeof value.name === 'string' &&
    Array.isArray(value.cells) &&
    value.cells.every((cell) => ContentSheetCellSchema.safeParse(cell).success) &&
    Array.isArray(value.columns) &&
    value.columns.every((column) => ContentSheetColumnSchema.safeParse(column).success) &&
    Array.isArray(value.rows) &&
    value.rows.every((row) => ContentSheetRowSchema.safeParse(row).success) &&
    ContentSheetPrintSettingsSchema.safeParse(value.printSettings).success
  );
}

function isDrawPageDescriptor(value: unknown): value is DrawPageDescriptor {
  return isRecord(value) && value.kind === 'drawPage' && PageSizeSchema.safeParse(value.size).success;
}

// No kind tag to discriminate on (ContentShape has none), so a shape descriptor is identified by the fields every ContentShape carries besides blocks: a valid frame and the four insets. Requiring blocks' ABSENCE keeps a raw ContentShape from validating as its own descriptor, and requiring kind's absence keeps it clear of the anchor paragraphs (kind 'paragraph') and the four container descriptors. Optional fields (name, rotationDeg, paintOrder, ...) are trusted-present-if-present rather than deep-checked -- the same deliberately-minimal depth document-schema.js's own ContentBlock guard applies to its recursive members.
function isShapeDescriptor(value: unknown): value is ShapeDescriptor {
  return (
    isRecord(value) &&
    !('kind' in value) &&
    !('blocks' in value) &&
    BoxSchema.safeParse(value.frame).success &&
    typeof value.insetLeftPt === 'number' &&
    value.insetLeftPt >= 0 &&
    typeof value.insetTopPt === 'number' &&
    value.insetTopPt >= 0 &&
    typeof value.insetRightPt === 'number' &&
    value.insetRightPt >= 0 &&
    typeof value.insetBottomPt === 'number' &&
    value.insetBottomPt >= 0
  );
}

// An anchor paragraph: a valid ContentParagraph that actually carries a grouping signal. A paragraph with neither headingLevel nor list membership is block-flow content, not a group anchor, and belongs at a leaf position -- so a tree that wrapped one in {node, children} would not validate as a group here.
function isAnchorParagraph(value: unknown): value is HeadingParagraph | ListParagraph {
  return (
    isRecord(value) &&
    ContentParagraphSchema.safeParse(value).success &&
    (value.headingLevel !== undefined || value.list !== undefined)
  );
}

// Recursive structural guard, hand-written for the same reason document-schema.js hand-writes isContentBlock and node.ts isOutlineNode: z.lazy() collapses the static type of a recursive schema to `unknown` under the pinned zod 4, so the recursion lives in a plain function guard instead. Discrimination rule: a record whose `node` is a valid descriptor or anchor paragraph and whose `children` array holds only valid package nodes is a group; anything else must validate as a leaf. No leaf payload carries a top-level `node` or `children` field, so the two classes cannot be confused in either direction.
export function isPackageGroup(value: unknown): value is PackageGroup {
  if (!isRecord(value) || !isRecord(value.node) || !Array.isArray(value.children)) return false;
  if (!value.children.every(isPackageNode)) return false;
  return (
    isSectionDescriptor(value.node) ||
    isSlideDescriptor(value.node) ||
    isSheetDescriptor(value.node) ||
    isDrawPageDescriptor(value.node) ||
    isShapeDescriptor(value.node) ||
    isAnchorParagraph(value.node)
  );
}

export function isPackageLeaf(value: unknown): value is PackageLeaf {
  return isOutlineLeaf(value);
}

export function isPackageNode(value: unknown): value is PackageNode {
  return isPackageGroup(value) || isPackageLeaf(value);
}

// The zod faces of the guards above -- usable wherever a schema value is needed (array element, object property, safeParse of external input). Deliberately z.custom, not z.lazy: see isPackageGroup.
export const PackageGroupSchema = z.custom<PackageGroup>(isPackageGroup);
export const PackageLeafSchema = z.custom<PackageLeaf>(isPackageLeaf);
export const PackageNodeSchema = z.custom<PackageNode>(isPackageNode);
