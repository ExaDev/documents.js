import { z } from 'zod';
import { ColorSchema } from './color';
import type { Color } from './color';
import { ConstructDescriptorSchema } from './construct';
import { BoxSchema, LayoutFrameSchema, MarginsSchema, PageSizeSchema } from './geometry';
import type { Box, LayoutFrame } from './geometry';
import { MathExpressionSchema, MathPresentationSchema, MathProvenanceSchema, SymbolTableSchema } from './math';
import { MathMlNodeSchema } from './mathml';
import { LayoutMetadataSchema } from './metadata';
import { AlignmentSchema } from './style';

// The shared block model underlying a wordprocessing document's sections and a presentation document's slides. Ported from ooxml.js's src/typed/shared/content.ts (itself ported from documents.js's src/model/content.ts) -- the canonical home now; ooxml.js and documents.js both import this instead of maintaining their own copy. The ContentDocument envelope below (kind + wordprocessing/presentation/spreadsheet/drawing/formula variants) is this package's own addition on top of that shared vocabulary, matching documents.js's existing model/content.ts shape, since a caller needs a single top-level value to carry through a conversion pipeline.

// sourcePath is assigned by each format's reader at read time; this package only defines the field, it doesn't generate values. Known limitation: sourcePath values are stable within one read+layout pass over a single document, not across edits -- inserting content earlier in a document shifts every later path. It exists for tagged/accessible-PDF-style traceability and debugging, not edit-tracking, and not (any more, see `frames` immediately below) as the mechanism a node's own rendered position is found through.

// The fusion primitive every content-kind leaf below adds via its own literal `frames?: LayoutFrame[]` field (Zod's discriminated-union/object model needs the field spliced in field-by-field per variant, not layered on generically through this generic type) -- FusedNode<T> names that exact pattern once, for a consumer describing "a content node carrying its own rendered position(s)" in the general case rather than repeating the union of leaf types by hand. A node's own `frames` entries record wherever -- and on however many pages -- its rendered content actually landed, replacing DocumentPackage's old two-tree design of correlating a wholly separate LayoutDocument's own positioned items back to their originating ContentDocument node purely by matching sourcePath strings (see src/package.ts). A node with more than one frame appeared in more than one rendered position -- a paragraph's runs wrapping across a page boundary is the common case -- without the content itself needing to be split or duplicated. `frames` is absent on a content-only value that has never been through a layout pass, exactly mirroring how DocumentPackage.layout used to be absent for the same reason.
export type FusedNode<T> = T & { frames?: LayoutFrame[] };

export const ContentRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  fontFamily: z.string().optional(),
  sizePt: z.number().positive().optional(),
  color: ColorSchema.optional(),
  hyperlink: z.string().optional(), // resolved external URI
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  frames: z.array(LayoutFrameSchema).optional(), // this run's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
});
export type ContentRun = z.infer<typeof ContentRunSchema>;

export const ContentListMembershipSchema = z.object({
  numId: z.string().optional(), // identifies a shared numbering definition when the source format has one -- docx's w:numId, ODF's minted structural identity -- and is absent when the format carries only a depth (OOXML drawing paragraphs' a:pPr/@lvl), where fabricating one would invent numbering identity the source never had
  level: z.number().int().nonnegative(), // w:ilvl
});
export type ContentListMembership = z.infer<typeof ContentListMembershipSchema>;

export const ContentParagraphSchema = z.object({
  kind: z.literal('paragraph'),
  runs: z.array(ContentRunSchema),
  styleId: z.string().optional(), // w:pStyle/@w:val, e.g. 'Heading1' -- round-trip-only: a producer's own style name, meaningful only to a consumer that already knows that producer's naming convention
  headingLevel: z.number().int().positive().optional(), // canonical, format-agnostic heading depth (1 = the outermost heading), independent of styleId's own producer-specific spelling -- e.g. docx's w:outlineLvl (0-based, so read as level + 1), odf's text:outline-level (already 1-based), markdown's '#' count. Deliberately unbounded here (ODF alone permits ten levels): a format whose own vocabulary tops out lower than what's present (six for HTML/Markdown) clamps on its own way out, via clampHeadingLevel below, rather than this canonical field silently losing information a richer source format actually carried.
  alignment: AlignmentSchema.optional(),
  list: ContentListMembershipSchema.optional(),
  spacingBeforePt: z.number().optional(),
  spacingAfterPt: z.number().optional(),
  lineSpacing: z.number().positive().optional(), // multiple of single line height
  indentLeftPt: z.number().optional(),
  indentFirstLinePt: z.number().optional(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  frames: z.array(LayoutFrameSchema).optional(), // this paragraph's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
});
export type ContentParagraph = z.infer<typeof ContentParagraphSchema>;

// Clamps an arbitrary heading level to the 1-6 range every consumer whose own heading vocabulary tops out at six shares -- HTML/Markdown's h1-h6, docx's built-in Heading1-Heading6 style set. Exported so a writer targeting one of those (markdown-codec's own private clamp-to-6 logic on write is the motivating case) can share this exact clamp instead of reimplementing it. Deliberately simple: rounds a fractional level to the nearest integer first (a level is conceptually a whole step of depth; a producer should never genuinely hand this a fraction, but rounding rather than truncating avoids silently favouring shallower headings if one ever does), then clamps into [1, 6].
export function clampHeadingLevel(level: number): number {
  return Math.min(6, Math.max(1, Math.round(level)));
}

export const ContentImageBlockSchema = z.object({
  kind: z.literal('image'),
  format: z.enum(['png', 'jpeg']),
  base64: z.string(),
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  altText: z.string().optional(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  frames: z.array(LayoutFrameSchema).optional(), // this image's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
});
export type ContentImageBlock = z.infer<typeof ContentImageBlockSchema>;

export const ContentPageBreakSchema = z.object({
  kind: z.literal('pageBreak'),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  frames: z.array(LayoutFrameSchema).optional(), // where this page break actually landed, once a layout pass has fused one in -- see FusedNode above
});
export type ContentPageBreak = z.infer<typeof ContentPageBreakSchema>;

// -- Construct boundary markers: the flat form's encoding of a fidelity construct (src/construct.ts) --
//
// The package tree carries a construct as a group -- `{ node: <descriptor>, children: <the extent it spans> }` (src/package-node.ts) -- but the flat form has no wrapper to hang an extent off: a section's, shape's, or table cell's content is one block list and nothing else. So the flat encoding of a construct is a matched pair of markers bracketing the blocks it spans, and decompose promotes each pair into the group the tree already has. The pair is what makes the 4.1.0 descriptor vocabulary reachable at all from the only shape a codec ever produces: every codec (ooxml.js, odf.js, markdown-codec, pdf-codec) reads and writes ContentDocument, so a construct facility wired only onto the tree is a facility no codec can emit into.
//
// THE BRACKET-MATCHING CONTRACT, stated once and binding on every producer and consumer: markers pair exactly as balanced parentheses do -- a `constructEnd` closes the nearest preceding still-open `constructStart` in the SAME block list, and the blocks between them are that construct's extent. That is the entire pairing mechanism; there is deliberately no id, name, or other pairing key on either marker. Matching never straddles a block list: a pair opened in a section's blocks closes in that same array, and a pair opened inside a table cell closes inside that cell -- which is also the only way a construct inside a table is expressible in EITHER encoding, since decomposition treats a table as one leaf and never descends into its cells. A block list whose markers do not balance (an end with no open start, or a start still open when the list ends) is malformed input rather than a shape to repair: see findConstructMarkerImbalance below, the one shared definition of that check.
//
// BALANCE IS NECESSARY BUT NOT SUFFICIENT: a marker's extent must also not cross a heading-group or list-group scope boundary. Headings and list items carry no delimiter of their own in the flat form -- a heading paragraph's scope runs until the next paragraph in the same block list whose headingLevel is shallower than or equal to its own, and a list item's scope runs until nesting shallows back out, exactly the nesting decompose infers when it builds HeadingGroupNode/ListGroupNode (src/package-node.ts) from a flat list. A constructStart/constructEnd pair whose extent contains a paragraph that would close a heading or list scope already open when the pair started leaves decompose no single correct tree to build: nesting the construct group inside that still-closing scope strands the closing paragraph with no legal parent for it, while closing the scope at the constructStart and hoisting the construct group out silently moves everything after the closing paragraph out of a scope it belonged to -- two different, equally legal-looking trees from one balanced input, and neither is more correct than the other. findConstructMarkerImbalance below cannot see this: balance is a property of the marker pair alone, not of what sits between the two markers, and this package does not check it either -- unlike balance, detecting a scope crossing means walking the same heading/list nesting decompose already builds while constructing the tree, so decompose (documents.js) is the sole enforcement point. Exactly as it already rejects rather than repairs an unbalanced pair, decompose must reject a scope-crossing extent rather than silently choosing between the two divergent trees it could otherwise produce. A producer emitting a marker pair (ooxml.js, odf.js, markdown-codec, pdf-codec) must never open one inside a heading or list scope that some other block inside the extent then closes.
//
// WHY NO ID ON EITHER MARKER: an id would have to be minted by whichever producer emitted the pair and then reproduced byte-for-byte by flatten to satisfy the encoding pair's own first law, flatten(decompose(x)) === x (src/package.ts). A construct group carries a descriptor and its children and nothing else, so a marker id would be a value with no home on the tree side and no deterministic way back -- whereas a bare bracket has nothing to reproduce and nothing to get wrong. Bracket matching also already generalises to arbitrary nesting depth and to different construct kinds nested inside each other, which is the whole of what a pairing key would have bought.
//
// WHY NO style, sourcePath, OR frames: a marker is a boundary, not content -- it renders nothing, occupies no space, and has no position -- so `frames` and `sourcePath`, which every real block leaf carries, would name facts a boundary does not have. A `style` ref would be worse: refs are a tree-only, table-compression concept (the flat form is always fully materialised, ExaDev/document-schema.js#21), and a construct group's own style ref never resolves onto the construct itself -- a construct group is a wrapper with no anchor of its own, so its ref only extends the chain passed to its children, which are ordinary blocks and paragraphs already carrying their own fully-resolved direct properties by the time they reach a marker. Nothing on either marker beyond the descriptor the open marker names.
export const ContentConstructStartSchema = z.object({
  kind: z.literal('constructStart'),
  descriptor: ConstructDescriptorSchema, // the construct this marker opens -- the identical payload a construct group carries as its `node`, so promoting a pair into a group moves this value across untouched
});
export type ContentConstructStart = z.infer<typeof ContentConstructStartSchema>;

// The close half of the pair: its kind is its entire payload, for the reasons stated above. Which construct it closes is a fact about the sequence it sits in, never a fact stored on the marker.
export const ContentConstructEndSchema = z.object({
  kind: z.literal('constructEnd'),
});
export type ContentConstructEnd = z.infer<typeof ContentConstructEndSchema>;

// ContentTable is mutually recursive with ContentBlock (a cell contains blocks, which may themselves be tables) -- hand-written, mirroring ooxml.js's own XmlElement/isXmlNode pattern, since z.lazy() collapses to `unknown` for recursive children in the pinned Zod version.
export interface ContentTableCell {
  blocks: ContentBlock[];
  colSpan?: number;
  rowSpan?: number;
  background?: Color;
  borders?: ContentCellBorders;
  sourcePath?: string;
  frames?: LayoutFrame[]; // this cell's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
}

export interface ContentTableRow {
  cells: ContentTableCell[];
  // pptx tables carry an explicit row height (a:tr/@h); docx tables do not model one at the row level in the same way, so this is undefined there.
  heightPt?: number;
}

export interface ContentTable {
  kind: 'table';
  rows: ContentTableRow[];
  columnWidthsPt: number[];
  sourcePath?: string; // deterministic, document-order-derived path assigned by the format reader
  frames?: LayoutFrame[]; // this table's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
}

// ContentEmbeddedObject is mutually recursive with ContentDocument (an embedded object carries a whole ContentDocument, which can itself contain another embedded object -- e.g. a formula embedded inside a drawing embedded inside a spreadsheet) -- hand-written, mirroring ContentTable/ContentBlock's own recursive-guard-plus-z.custom pattern immediately below, since z.lazy() collapses to `unknown` for recursive children in this pinned Zod version. Every objectKind names an embedded whole sub-document of the identically-named ContentDocument kind, 'formula' included now that ContentDocument has a real 'formula' variant of its own (below) -- so an embedded equation carries genuine MathML rather than, as before, a wordprocessing document standing in for one. That pairing is a producer convention, not a constraint this schema enforces: objectKind and document.kind are independently typed, and nothing here rejects a mismatched pair. A 'formula' object is expected to be short enough that a layout engine can reasonably lay it out and render it; the other four are expected to round-trip through this model losslessly without ever being laid out or rendered. This package holds schemas only, so no rendering/layout logic lives here regardless of objectKind.
export type ContentEmbeddedObjectKind = 'formula' | 'wordprocessing' | 'presentation' | 'spreadsheet' | 'drawing';

export interface ContentEmbeddedObject {
  objectKind: ContentEmbeddedObjectKind;
  document: ContentDocument;
  frame: Box; // page-space position and size, in the same xPt/yPt/widthPt/heightPt convention as ContentShape.frame
  // Cell-anchor position, mirroring ContentSheetImageSchema's own anchorRow/anchorColumn/offsetXPt/offsetYPt field names and types exactly (src/content.ts's ContentSheetImageSchema, further down this file) -- all four optional here, unlike on ContentSheetImageSchema where they're required, since only a spreadsheet-anchored embedded object (one held in ContentSheetSchema.embeddedObjects) ever sets them; a wordprocessing/presentation/drawing embedded object has no cell to anchor into and simply omits all four.
  anchorRow?: number;
  anchorColumn?: number;
  offsetXPt?: number; // offset from the anchor cell's own top-left corner
  offsetYPt?: number;
}

// The block-level anchoring point for an embedded object inside a wordprocessing section's or a presentation/drawing shape's own block flow -- reuses ContentEmbeddedObject's fields directly (frame included) rather than nesting a separate `embeddedObject: ContentEmbeddedObject` field, since ContentEmbeddedObject already carries its own frame and duplicating it would just be two copies of the same position.
export interface ContentEmbeddedObjectBlock extends ContentEmbeddedObject {
  kind: 'embeddedObject';
  sourcePath?: string; // deterministic, document-order-derived path assigned by the format reader
  frames?: LayoutFrame[]; // this embedded object's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
}

// The two boundary markers join the union at the end, so a 4.1.0 block list parses identically here and a consumer switching exhaustively over the union is the only thing this addition breaks -- the same additive-plus-exhaustive-switch trade the construct descriptor kinds themselves made. The package tree admits every member of this union at a leaf position EXCEPT the two markers (src/package-node.ts's PackageBlockLeaf): a construct is a group there, and one fact carried in two encodings inside one tree would break the encoding pair's laws.
export type ContentBlock =
  | ContentParagraph
  | ContentTable
  | ContentImageBlock
  | ContentPageBreak
  | ContentEmbeddedObjectBlock
  | ContentConstructStart
  | ContentConstructEnd;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContentRun(value: unknown): value is ContentRun {
  return isRecord(value) && typeof value.text === 'string';
}

function isContentTableCell(value: unknown): value is ContentTableCell {
  return isRecord(value) && Array.isArray(value.blocks) && value.blocks.every(isContentBlock);
}

function isContentTableRow(value: unknown): value is ContentTableRow {
  return (
    isRecord(value) &&
    Array.isArray(value.cells) &&
    value.cells.every(isContentTableCell) &&
    (value.heightPt === undefined || typeof value.heightPt === 'number')
  );
}

function isContentEmbeddedObjectKind(value: unknown): value is ContentEmbeddedObjectKind {
  return (
    value === 'formula' ||
    value === 'wordprocessing' ||
    value === 'presentation' ||
    value === 'spreadsheet' ||
    value === 'drawing'
  );
}

// Delegates document validation to ContentDocumentSchema itself (defined further down this file) instead of hand-rolling a second, parallel structural guard for every ContentDocument variant -- ContentDocumentSchema is a plain Zod discriminated union of ordinary object schemas, not a self-referential z.lazy schema, so one already-built schema value validating another already-built schema value at runtime carries none of the "collapses to unknown" risk that motivates the z.custom pattern in the first place; that risk is specific to Zod's own static type inference over a self-referential schema *definition*. ContentDocumentSchema is referenced here only inside this function's body (a closure), and by the time this function is ever called the whole module -- including ContentDocumentSchema's own const assignment later in this file -- has already finished evaluating.
function isContentEmbeddedObject(value: unknown): value is ContentEmbeddedObject {
  return (
    isRecord(value) &&
    isContentEmbeddedObjectKind(value.objectKind) &&
    BoxSchema.safeParse(value.frame).success &&
    ContentDocumentSchema.safeParse(value.document).success &&
    (value.anchorRow === undefined ||
      (typeof value.anchorRow === 'number' && Number.isInteger(value.anchorRow) && value.anchorRow >= 0)) &&
    (value.anchorColumn === undefined ||
      (typeof value.anchorColumn === 'number' && Number.isInteger(value.anchorColumn) && value.anchorColumn >= 0)) &&
    (value.offsetXPt === undefined || typeof value.offsetXPt === 'number') &&
    (value.offsetYPt === undefined || typeof value.offsetYPt === 'number')
  );
}

function isContentEmbeddedObjectBlock(value: unknown): value is ContentEmbeddedObjectBlock {
  return isRecord(value) && value.kind === 'embeddedObject' && isContentEmbeddedObject(value);
}

// The two marker guards, exported for the consumers that have to recognise a boundary without parsing the whole block: the package tree's leaf predicates, which reject them (src/package-node.ts), and findConstructMarkerImbalance below, which walks a block list looking for exactly these two kinds.
export function isContentConstructStart(value: unknown): value is ContentConstructStart {
  return (
    isRecord(value) && value.kind === 'constructStart' && ConstructDescriptorSchema.safeParse(value.descriptor).success
  );
}

export function isContentConstructEnd(value: unknown): value is ContentConstructEnd {
  return isRecord(value) && value.kind === 'constructEnd';
}

// Recursive structural guard. Used via z.custom so table cells (and now embedded-object documents) validate without a recursive Zod schema (which collapses to `unknown` under z.lazy in this Zod version).
export function isContentBlock(value: unknown): value is ContentBlock {
  if (!isRecord(value)) {
    return false;
  }
  const kind = value.kind;
  if (kind === 'paragraph') {
    return Array.isArray(value.runs) && value.runs.every(isContentRun);
  }
  if (kind === 'image') {
    return (
      (value.format === 'png' || value.format === 'jpeg') &&
      typeof value.base64 === 'string' &&
      typeof value.widthPt === 'number' &&
      typeof value.heightPt === 'number'
    );
  }
  if (kind === 'pageBreak') {
    return true;
  }
  if (kind === 'table') {
    return (
      Array.isArray(value.rows) &&
      value.rows.every(isContentTableRow) &&
      Array.isArray(value.columnWidthsPt) &&
      value.columnWidthsPt.every((w) => typeof w === 'number')
    );
  }
  if (kind === 'embeddedObject') {
    return isContentEmbeddedObject(value);
  }
  if (kind === 'constructStart') {
    return isContentConstructStart(value);
  }
  if (kind === 'constructEnd') {
    return true;
  }
  return false;
}

export const ContentBlockSchema = z.custom<ContentBlock>(isContentBlock);

// Standalone schema for an embedded object on its own, independent of the block-level wrapper below -- this is what ContentSheetSchema.embeddedObjects (a sheet has no block-flow concept to anchor into) validates each entry against.
export const ContentEmbeddedObjectSchema = z.custom<ContentEmbeddedObject>(isContentEmbeddedObject);

// Standalone schema for the ContentBlock 'embeddedObject' variant, matching the sibling per-kind block schemas above (ContentParagraphSchema, ContentImageBlockSchema, ContentPageBreakSchema) even though ContentBlockSchema itself validates every kind, embeddedObject included, through the single custom guard above.
export const ContentEmbeddedObjectBlockSchema = z.custom<ContentEmbeddedObjectBlock>(isContentEmbeddedObjectBlock);

// Where a block list's construct markers stop balancing: an `unmatchedEnd` is a close with no construct open at that point, an `unclosedStart` is an open still standing when the list ended. `index` is the offending block's own position in the list -- the close itself for the first, and for the second the OUTERMOST still-open start, since that is where the unbalanced region begins rather than where the walk happened to notice it.
export type ConstructMarkerImbalance =
  | { kind: 'unmatchedEnd'; index: number }
  | { kind: 'unclosedStart'; index: number };

// The one shared definition of the bracket-matching contract's balance check (see the marker schemas above for the contract itself): returns the first place a block list's markers fail to match, or undefined when they balance. It lives here rather than in each consumer because at least three of them must agree exactly -- every codec that emits a pair, and documents.js's decompose, which promotes each matched pair into a construct group and so must reject a list it cannot promote instead of silently repairing one -- and because no schema can express it: balance is a property of a block list's sequence, not of any block in it, so ContentBlockSchema validating every member says nothing about whether the members pair up.
//
// Deliberately non-recursive. Each block list is its own bracket scope (a table cell's list matches independently of the list containing the table), so a caller walking nested lists calls this once per list -- which is exactly the walk decompose already performs -- rather than this helper duplicating that walk with its own idea of where the nested lists are.
export function findConstructMarkerImbalance(blocks: readonly ContentBlock[]): ConstructMarkerImbalance | undefined {
  const openStartIndices: number[] = [];
  for (const [index, block] of blocks.entries()) {
    if (isContentConstructStart(block)) {
      openStartIndices.push(index);
    } else if (isContentConstructEnd(block) && openStartIndices.pop() === undefined) {
      return { kind: 'unmatchedEnd', index };
    }
  }
  const outermostUnclosed = openStartIndices[0];
  if (outermostUnclosed !== undefined) {
    return { kind: 'unclosedStart', index: outermostUnclosed };
  }
  return undefined;
}

// Shared stroke/border style vocabulary -- reused by ContentStrokeSchema (drawing vector primitives, defined further down alongside them) and by ContentTableCellSchema/ContentSheetCellSchema's own per-side border fields immediately below, so a border always carries the same solid/dashed/dotted/double vocabulary regardless of which content leaf it decorates. Absent means 'solid' wherever this is optional.
export const ContentStrokeStyleSchema = z.enum(['solid', 'dashed', 'dotted', 'double']);
export type ContentStrokeStyle = z.infer<typeof ContentStrokeStyleSchema>;

// A single border edge -- distinct from ContentStrokeSchema only in that a border is always exactly one side of a rectangular cell, never a freestanding line/path stroke; both share the same colour/width/style vocabulary.
export const ContentBorderSchema = z.object({
  color: ColorSchema,
  widthPt: z.number().positive(),
  style: ContentStrokeStyleSchema.optional(), // absent means 'solid'
});
export type ContentBorder = z.infer<typeof ContentBorderSchema>;

// Per-side borders for a rectangular cell (table or sheet) -- each side independently optional, since a real cell frequently has some sides bordered and others not.
export const ContentCellBordersSchema = z.object({
  left: ContentBorderSchema.optional(),
  right: ContentBorderSchema.optional(),
  top: ContentBorderSchema.optional(),
  bottom: ContentBorderSchema.optional(),
});
export type ContentCellBorders = z.infer<typeof ContentCellBordersSchema>;

export const ContentTableCellSchema = z.object({
  blocks: z.array(ContentBlockSchema),
  colSpan: z.number().int().positive().optional(),
  rowSpan: z.number().int().positive().optional(),
  background: ColorSchema.optional(),
  borders: ContentCellBordersSchema.optional(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  frames: z.array(LayoutFrameSchema).optional(), // this cell's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
});

export const ContentTableRowSchema = z.object({
  cells: z.array(ContentTableCellSchema),
  heightPt: z.number().positive().optional(),
});

export const ContentTableSchema = z.object({
  kind: z.literal('table'),
  rows: z.array(ContentTableRowSchema),
  columnWidthsPt: z.array(z.number().positive()),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  frames: z.array(LayoutFrameSchema).optional(), // this table's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
});

// A docx section: a run of pages sharing one page size/margins (a w:sectPr boundary starts a new one).
export const ContentSectionSchema = z.object({
  pageSize: PageSizeSchema,
  margins: MarginsSchema,
  blocks: z.array(ContentBlockSchema),
});
export type ContentSection = z.infer<typeof ContentSectionSchema>;

// A pptx or odp shape's frame, in the pivot's own convention: top-left origin, y down, in points -- a pptx reader converts from EMU (a:xfrm), an odp reader converts from ODF's own unit-suffixed lengths (svg:x/y/width/height) and radians (draw:transform's rotate()), but both land in this one shape. rotationDeg is clockwise about the frame's own centre and undefined rather than 0 for an unrotated shape -- keeping the common case field-free rather than a stored, always-present zero. insetLeftPt/insetTopPt/insetRightPt/insetBottomPt are always present (never optional): every shape has SOME inset, whether from an explicit source-format attribute or that format's own documented default, and a picture/table (which has no text body at all) resolves to zero rather than leaving the field absent. fontScale/lineSpacingReduction are OOXML-specific (from DrawingML's a:normAutofit, present only when the source shape actually has autofit-shrunk text) and stay undefined for shapes read from any other format. paintOrder is a shared, cross-array z-ordering hint (also on every ContentVectorSchema variant) for a page that mixes shapes and vectors -- deliberately a plain z.number() rather than an integer, to allow fractional insertion between two existing values later; harmless and unused on a ContentSlide, which has no sibling vectors array to order against.
export const ContentShapeSchema = z.object({
  name: z.string().optional(),
  frame: BoxSchema,
  rotationDeg: z.number().optional(),
  insetLeftPt: z.number().nonnegative(),
  insetTopPt: z.number().nonnegative(),
  insetRightPt: z.number().nonnegative(),
  insetBottomPt: z.number().nonnegative(),
  fontScale: z.number().positive().optional(),
  lineSpacingReduction: z.number().nonnegative().optional(),
  paintOrder: z.number().optional(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  frames: z.array(LayoutFrameSchema).optional(), // this shape's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
  blocks: z.array(ContentBlockSchema),
});
export type ContentShape = z.infer<typeof ContentShapeSchema>;

export const ContentSlideSchema = z.object({
  size: PageSizeSchema,
  shapes: z.array(ContentShapeSchema),
  notes: z.string(),
});
export type ContentSlide = z.infer<typeof ContentSlideSchema>;

// Spreadsheet content model. Mirrors ODF's own office:value-type vocabulary for cell values (ContentCellValueSchema) plus the sparse cell/column/row addressing and print-settings shape every spreadsheet format (xlsx, ods) shares. No reader or writer in any package consumes this yet -- it exists so odf.js can target a stable, correctly-typed shape for its own .ods reader.

// A decimal-string pattern schema for an exact, arbitrary-precision numeric representation -- optional sign, no leading zeros (other than a bare '0'), an optional fractional part. Deliberately a string, not z.bigint(): bigint is not JSON-serializable and z.toJSONSchema() cannot represent it at all, even with unrepresentable: 'any' (it would silently emit an empty schema).
export const DecimalStringSchema = z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/);
export type DecimalString = z.infer<typeof DecimalStringSchema>;

// A cell's own computed/typed value, one variant per ODF office:value-type, plus a 'dateTime' variant ODF has no separate type for (see below). formula and displayText live on ContentSheetCellSchema itself, not per-variant here, since a formula can produce any of these value kinds and displayText is a per-cell rendering concern, not part of the value's own type. exactValue is an additive-optional sidecar on the number/percentage/currency variants only (the ones a real spreadsheet stores as an arbitrary-precision decimal underneath): value always remains the nearest IEEE-754 double approximation, present and populated exactly as before; exactValue, when present, is the authoritative exact decimal representation, and a producer should only set it when `String(Number(exactValue))` would not round-trip back to `exactValue` exactly -- so it is absent for the overwhelming majority of real cells (anything a double already represents exactly) and adds zero bytes to ordinary documents.
//
// -- Canonical date/time wire spelling -- The three temporal variants below each carry their value as a string, and that string has exactly one permitted spelling, stated here once and binding on every producer (odf.js, ooxml.js, and documents.js's own hsqldb/firebird decoders alike): 'date' is an ISO 8601 calendar date, `YYYY-MM-DD`; 'time' is a plain ISO 8601 wall-clock time of day, `HH:MM:SS` (24-hour, zero-padded, seconds always present, no date part, no timezone designator, and NOT ODF's own `PTnHnMnS` duration spelling, which a producer reading `office:time-value` must convert from); 'dateTime' is an ISO 8601 combined date and time, `YYYY-MM-DDTHH:MM:SS`, with a `.sss` fractional-seconds part and/or a `Z`/`+HH:MM` offset appended only when the source genuinely carried one. Anything else -- a locale-formatted rendering, a serial number, a bare `HH:MM` -- belongs in the cell's own displayText, never in `value`. This is a wire-format contract, not a validated one: the schemas below are plain z.string(), since a regex here would reject a real value a producer has not yet been updated to normalise, turning a fidelity bug into a hard parse failure. Producers converge on this spelling in their own later releases; this comment is the definition they converge on.
export const ContentCellValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('number'), value: z.number(), exactValue: DecimalStringSchema.optional() }),
  z.object({ kind: z.literal('percentage'), value: z.number(), exactValue: DecimalStringSchema.optional() }), // the underlying numeric value, e.g. 0.5 for a cell displaying "50%"
  z.object({ kind: z.literal('currency'), value: z.number(), currency: z.string().optional(), exactValue: DecimalStringSchema.optional() }), // currency is the ISO 4217 code (e.g. 'USD'), mirroring ODF's office:currency
  z.object({ kind: z.literal('boolean'), value: z.boolean() }),
  z.object({ kind: z.literal('date'), value: z.string() }), // ISO 8601 calendar date, YYYY-MM-DD, e.g. '2026-07-30' -- a date with no time-of-day component; use 'dateTime' when the source carries both
  z.object({ kind: z.literal('time'), value: z.string() }), // ISO 8601 wall-clock time of day, HH:MM:SS, e.g. '13:30:00' -- never ODF's PTnHnMnS duration spelling
  z.object({ kind: z.literal('dateTime'), value: z.string() }), // ISO 8601 combined date and time, YYYY-MM-DDTHH:MM:SS, e.g. '2026-07-30T13:30:00' -- a genuine single date+time value (an HSQLDB/Firebird TIMESTAMP column, or xlsx's one t="d" cell type, which covers date and date+time alike), distinct from 'date' rather than collapsed onto it
  z.object({ kind: z.literal('string'), value: z.string() }),
  z.object({ kind: z.literal('error'), value: z.string() }), // the producer's own error text, e.g. '#DIV/0!'
  z.object({ kind: z.literal('empty') }), // a cell that is present (formatted, merged, etc.) but carries no value
]);
export type ContentCellValue = z.infer<typeof ContentCellValueSchema>;

// A cell-anchored annotation, one shape deliberately covering both mechanisms a real spreadsheet uses for comments -- xlsx's legacy single notes and its newer threaded comments alike: a legacy note is a comment whose replies stay absent, a threaded comment is one whose replies array is populated, so no separate union or kind discriminant is needed. Replies are flat -- a reply never carries replies of its own -- matching how threaded comments nest in the source formats. createdAt is an ISO 8601 date-time in the source format's own spelling and precision (e.g. '2026-08-17T09:30:00Z'), present only when the source recorded one; a wire contract stated here rather than a validated one, for the same reason as ContentCellValueSchema's own temporal strings above -- a regex would turn a producer not yet normalised to ISO 8601 into a hard parse failure.
export const ContentSheetCellCommentSchema = z.object({
  text: z.string(),
  author: z.string().optional(),
  createdAt: z.string().optional(),
  replies: z.array(z.object({ text: z.string(), author: z.string().optional() })).optional(),
});
export type ContentSheetCellComment = z.infer<typeof ContentSheetCellCommentSchema>;

// row/column are the cell's own position, not implied by array index -- ContentSheetSchema.cells is sparse, since real sheets are sparse. displayText is the producer's own rendered string for `value` (its number-format/locale/currency-symbol applied already) and is required on every cell that exists in this array, since a cell with nothing to display simply isn't included; it is what makes spreadsheet-to-PDF rendering tractable without this package reimplementing a number-format/locale engine. formula, if present, is carried verbatim in whatever syntax the source format used. colSpan/rowSpan are set on the anchor cell only, matching how ContentTableCell already handles merged cells. alignment is an override of the existing value-kind default (numeric right, boolean/error centre, string left); absent means that default still applies. verticalAlignment has no value-kind default to fall back to, so its own absence means 'bottom' outright, matching a real spreadsheet's own typical default. comment, when present, is the cell's annotation (ContentSheetCellCommentSchema above) and never affects rendering -- it is carried for fidelity, so inspecting or round-tripping a document does not silently drop what the author pinned to that cell.
export const ContentSheetCellSchema = z.object({
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  value: ContentCellValueSchema,
  formula: z.string().optional(),
  displayText: z.string(),
  runs: z.array(ContentRunSchema).optional(), // the rare case of genuinely mixed inline formatting within one cell's text; absent when the cell's formatting is uniform
  colSpan: z.number().int().positive().optional(),
  rowSpan: z.number().int().positive().optional(),
  background: ColorSchema.optional(),
  borders: ContentCellBordersSchema.optional(),
  alignment: AlignmentSchema.optional(), // override; absent means the existing value-kind default
  verticalAlignment: z.enum(['top', 'middle', 'bottom']).optional(), // absent means 'bottom'
  comment: ContentSheetCellCommentSchema.optional(), // a cell-anchored annotation -- a legacy note or a threaded comment; see ContentSheetCellCommentSchema above
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  frames: z.array(LayoutFrameSchema).optional(), // this cell's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
});
export type ContentSheetCell = z.infer<typeof ContentSheetCellSchema>;

// widthPt/heightPt are optional-positive rather than required-nonnegative: an entry exists in these arrays whenever a column/row carries ANY per-axis property (a width, or merely `hidden`), and a real spreadsheet frequently has one without a declared size at all. Making the size required forced such an entry to state an explicit 0, which a consumer then had to treat as authoritative -- rendering a zero-width column instead of the application's own default width, and so producing a zero-size grid from a file that renders perfectly well elsewhere. Absent now means exactly "no declared size, use the application default"; 0 is no longer expressible, which is correct, since a genuinely zero-sized column is `hidden: true`, not a zero width.
export const ContentSheetColumnSchema = z.object({
  index: z.number().int().nonnegative(),
  widthPt: z.number().positive().optional(),
  hidden: z.boolean().optional(),
});
export type ContentSheetColumn = z.infer<typeof ContentSheetColumnSchema>;

export const ContentSheetRowSchema = z.object({
  index: z.number().int().nonnegative(),
  heightPt: z.number().positive().optional(),
  hidden: z.boolean().optional(),
});
export type ContentSheetRow = z.infer<typeof ContentSheetRowSchema>;

export const ContentSheetPrintRangeSchema = z.object({
  startRow: z.number().int().nonnegative(),
  startColumn: z.number().int().nonnegative(),
  endRow: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
});
export type ContentSheetPrintRange = z.infer<typeof ContentSheetPrintRangeSchema>;

export const ContentSheetRepeatRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type ContentSheetRepeatRange = z.infer<typeof ContentSheetRepeatRangeSchema>;

export const ContentSheetPrintSettingsSchema = z.object({
  pageSize: PageSizeSchema,
  margins: MarginsSchema,
  printRange: ContentSheetPrintRangeSchema.optional(), // absent means "print the whole used range"
  scalePercent: z.number().positive().optional(), // print scale as a percentage: 100 means actual size, 50 means half size. Named for its unit rather than the bare `scale` it replaced, which left percentage-vs-fraction to the source format's own convention and so made 1 ambiguous between "1% of actual size" and "actual size".
  fitToPages: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
  repeatRows: ContentSheetRepeatRangeSchema.optional(), // rows repeated as a header band on every printed page
  repeatColumns: ContentSheetRepeatRangeSchema.optional(), // columns repeated as a header band on every printed page
  gridlines: z.boolean(),
  headers: z.boolean(), // row/column header display (the "A, B, C" / "1, 2, 3" chrome, not a repeated print header band)
  pageOrder: z.enum(['downThenOver', 'overThenDown']),
  manualBreaks: z
    .object({ rows: z.array(z.number().int().nonnegative()), columns: z.array(z.number().int().nonnegative()) })
    .optional(),
});
export type ContentSheetPrintSettings = z.infer<typeof ContentSheetPrintSettingsSchema>;

// A spreadsheet-anchored image: cell-relative placement (an xlsx/ods "anchor cell + pixel offset" style position) on top of ContentImageBlockSchema's own existing fields, rather than a second, independent image shape.
export const ContentSheetImageSchema = ContentImageBlockSchema.extend({
  anchorRow: z.number().int().nonnegative(),
  anchorColumn: z.number().int().nonnegative(),
  offsetXPt: z.number(), // offset from the anchor cell's own top-left corner
  offsetYPt: z.number(),
});
export type ContentSheetImage = z.infer<typeof ContentSheetImageSchema>;

// embeddedObjects is its own explicit array here, unlike the wordprocessing/presentation/drawing cases above, since a spreadsheet has no block-flow concept for an embedded object to anchor into the way ContentBlock's 'embeddedObject' variant does for the other three kinds.
export const ContentSheetSchema = z.object({
  name: z.string(),
  cells: z.array(ContentSheetCellSchema),
  columns: z.array(ContentSheetColumnSchema),
  rows: z.array(ContentSheetRowSchema),
  images: z.array(ContentSheetImageSchema),
  printSettings: ContentSheetPrintSettingsSchema,
  embeddedObjects: z.array(ContentEmbeddedObjectSchema).optional(),
});
export type ContentSheet = z.infer<typeof ContentSheetSchema>;

// Drawing content model: pure vector primitives with no docx/pptx analogue, for a standalone drawing document (odf.js's .odg target). ContentShapeSchema (text-in-a-frame, already shared with presentations) covers text content; ContentVectorSchema below covers everything ContentShape can't -- raw rectangles, ellipses, lines, and free-form paths.

export const ContentStrokeSchema = z.object({
  color: ColorSchema,
  widthPt: z.number().positive(),
  style: ContentStrokeStyleSchema.optional(), // absent means 'solid'
});
export type ContentStroke = z.infer<typeof ContentStrokeSchema>;

export const ContentPathPointSchema = z.object({
  xPt: z.number(),
  yPt: z.number(),
});
export type ContentPathPoint = z.infer<typeof ContentPathPointSchema>;

// A path segment in the enclosing ContentVector 'path' shape's own local coordinate space -- not page-absolute. This is the content-side counterpart to a future LayoutPath on the layout side (not built yet, separate later work).
export const ContentPathSegmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line'), to: ContentPathPointSchema }),
  z.object({
    kind: z.literal('cubic'),
    control1: ContentPathPointSchema,
    control2: ContentPathPointSchema,
    to: ContentPathPointSchema,
  }),
]);
export type ContentPathSegment = z.infer<typeof ContentPathSegmentSchema>;

export const ContentSubpathSchema = z.object({
  start: ContentPathPointSchema,
  segments: z.array(ContentPathSegmentSchema),
  closed: z.boolean(),
});
export type ContentSubpath = z.infer<typeof ContentSubpathSchema>;

// rotationDeg is deliberately not added to the 'line' variant: a line's rotation is already fully expressible via its own two endpoints, so a separate rotation field there would create two ways to say one thing with no defined pivot for it to rotate about. Where present, rotationDeg matches ContentShapeSchema's own documented semantics exactly: clockwise-on-screen degrees about the frame's own centre, undefined rather than 0 for an unrotated vector. paintOrder is the same shared, cross-array z-ordering hint ContentShapeSchema carries -- see that schema's own comment.
export const ContentVectorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rect'),
    frame: BoxSchema,
    rotationDeg: z.number().optional(),
    fill: ColorSchema.optional(),
    stroke: ContentStrokeSchema.optional(),
    paintOrder: z.number().optional(),
    sourcePath: z.string().optional(),
    frames: z.array(LayoutFrameSchema).optional(), // this vector's own rendered position(s), once a layout pass has fused one in -- see FusedNode above
  }),
  z.object({
    kind: z.literal('ellipse'),
    frame: BoxSchema,
    rotationDeg: z.number().optional(),
    fill: ColorSchema.optional(),
    stroke: ContentStrokeSchema.optional(),
    paintOrder: z.number().optional(),
    sourcePath: z.string().optional(),
    frames: z.array(LayoutFrameSchema).optional(),
  }),
  z.object({
    kind: z.literal('line'),
    from: ContentPathPointSchema,
    to: ContentPathPointSchema,
    stroke: ContentStrokeSchema,
    paintOrder: z.number().optional(),
    sourcePath: z.string().optional(),
    frames: z.array(LayoutFrameSchema).optional(),
  }),
  z.object({
    kind: z.literal('path'),
    frame: BoxSchema, // page-space placement and the size of the path's own local coordinate space, distinct from the subpaths' local-space points below
    rotationDeg: z.number().optional(),
    subpaths: z.array(ContentSubpathSchema),
    fill: ColorSchema.optional(),
    fillRule: z.enum(['nonzero', 'evenodd']).optional(),
    stroke: ContentStrokeSchema.optional(),
    paintOrder: z.number().optional(),
    sourcePath: z.string().optional(),
    frames: z.array(LayoutFrameSchema).optional(),
  }),
]);
export type ContentVector = z.infer<typeof ContentVectorSchema>;

// vectors is deliberately a sibling array to shapes, not folded into ContentBlock -- a vector primitive has no business inside a paragraph-flow block model.
export const ContentDrawPageSchema = z.object({
  size: PageSizeSchema,
  shapes: z.array(ContentShapeSchema),
  vectors: z.array(ContentVectorSchema),
});
export type ContentDrawPage = z.infer<typeof ContentDrawPageSchema>;

// Formula content model: a standalone equation document (an ODF .odf formula document, or the equation an embedded 'formula' object carries). Unlike the other four kinds this has no page/slide/sheet structure at all -- a formula is one expression, positioned by whatever embeds it, so there is nothing here to paginate or place. Whatever embeds it supplies position through its own frames field (a ContentEmbeddedObjectBlock's frames describe the rendered box the equation occupies); the semantic payload here is position-independent by nature, and the fusion invariant deliberately reaches no further into a formula than that box.
//
// A formula's meaning is carried as two co-equal authoritative layers, joined in this one shape: `presentation` (rendering-authoritative) and `content` (computation-authoritative), alongside the source formats' own trees and strings. Neither layer is stored derived from the other -- string-to-tree lowering is total (worst case an `unparsed` node), tree-to-string rendering is partial, and storage takes the recoverable side by carrying both verbatim. The atomic pair-edit rule: editing one layer must never silently mutate the other -- an editor changing `content` leaves `presentation` byte-identical unless it explicitly rewrites both -- and any canonical form used to match or diff the two layers is a derived view computed at comparison time, never written back in place. That rule is documentation-stated rather than Zod-enforced on purpose: the schema's job is to carry both layers losslessly, and a producer that mutates one layer in place is misbehaving in a way no input shape can prevent -- consumers comparing layers recompute their own canonical views rather than trusting either layer to be normalised.
export const ContentFormulaSchema = z.object({
  // The formula's own MathML presentation-layer tree, carried as raw XML nodes (see src/mathml.ts for why that, rather than a MathML-specific element vocabulary). An array rather than a single root because a real formula part's content is a node list -- an XML declaration and/or whitespace text nodes commonly precede the <math> element itself, and dropping them on the way in would make this model lossy for no gain. Required even when the source carried no MathML of its own (a LaTeX-authored equation lowered on the way in): such a formula carries an empty array, which keeps every existing constructor of this shape valid.
  mathml: z.array(MathMlNodeSchema),
  // The equivalent StarMath source, when the producing format carried one alongside the MathML (ODF stores it as the formula's own annotation). Purely informational: MathML is the authoritative content, and a consumer that renders from starMath instead is rendering a secondary encoding of the same expression.
  starMath: z.string().optional(),
  // The rendering-authoritative layer: the formula's LaTeX, stored verbatim (src/math.ts's MathPresentationSchema). A renderer serialises this string exactly as it stands and never re-emits it from the semantic layer below. Absent on a formula whose source offered nothing LaTeX-shaped, in which case rendering falls back to the MathML tree above.
  presentation: MathPresentationSchema.optional(),
  // The computation-authoritative layer: a MathExpression tree (src/math.ts). Absent means nobody has lowered this formula to semantics yet; an `unparsed` node inside it means somebody tried and hit a construct the grammar does not cover -- coverage gaps stay visible data, never parse failures. The symbol and unit references inside resolve against the embedding document's own symbolTable field (below).
  content: MathExpressionSchema.optional(),
  // Where this formula came from and what has touched it since (src/math.ts's MathProvenanceSchema).
  provenance: MathProvenanceSchema.optional(),
});
export type ContentFormula = z.infer<typeof ContentFormulaSchema>;

// ContentDocument carries no formatVersion of its own: it is the in-process codec-exchange type the codecs hand each other and never a serialised artefact in its own right, so it has no version to declare. Versioning lives entirely at the serialised-artefact boundary -- a dumped document or package states its version through the release-pinned $schema URI its dumper stamped (src/schema-io.ts), which is also what an ingesting documentFromJson dispatches on. Releases 1.x-3.x carried a per-arm formatVersion literal here; 4.0.0 retired it (ExaDev/document-schema.js#20's errata).

// Fields every one of the five ContentDocument arms below carries in addition to its own kind and metadata -- currently the document-level math symbol table (SymbolTableSchema, src/math.ts): the curation layer mapping each written symbol glyph to its quantity kind, preferred unit, and definition, alongside the unit registry a formula's expressions resolve their symbol and unit references against. Spliced into each arm via spread rather than factored through a base schema the arms extend, because z.discriminatedUnion() needs each member as a plain z.object carrying its own literal `kind` field in place. Optional on every arm: a document with no lowered math content (most of them) simply omits it, and the table is presentation-inert by construction -- it curates what symbols mean, never how any formula renders -- so its presence or absence changes no rendering. Exported because DocumentPackageSchema's own arms (src/package.ts) spread the identical field set -- one declaration, so a shared field added here reaches the package root without a second edit.
export const contentDocumentSharedFields = {
  symbolTable: SymbolTableSchema.optional(),
};

export const ContentDocumentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wordprocessing'),
    metadata: LayoutMetadataSchema,
    ...contentDocumentSharedFields,
    sections: z.array(ContentSectionSchema),
  }),
  z.object({
    kind: z.literal('presentation'),
    metadata: LayoutMetadataSchema,
    ...contentDocumentSharedFields,
    slides: z.array(ContentSlideSchema),
  }),
  z.object({
    kind: z.literal('spreadsheet'),
    metadata: LayoutMetadataSchema,
    ...contentDocumentSharedFields,
    sheets: z.array(ContentSheetSchema),
  }),
  z.object({
    kind: z.literal('drawing'),
    metadata: LayoutMetadataSchema,
    ...contentDocumentSharedFields,
    pages: z.array(ContentDrawPageSchema),
  }),
  z.object({
    kind: z.literal('formula'),
    metadata: LayoutMetadataSchema,
    ...contentDocumentSharedFields,
    formula: ContentFormulaSchema,
  }),
]);
export type ContentDocument = z.infer<typeof ContentDocumentSchema>;
