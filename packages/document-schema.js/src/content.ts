import { z } from 'zod';
import { ColorSchema } from './color';
import type { Color } from './color';
import { BoxSchema, MarginsSchema, PageSizeSchema } from './geometry';
import type { Box } from './geometry';
import { LayoutMetadataSchema } from './metadata';
import { AlignmentSchema } from './style';

// The shared block model underlying a wordprocessing document's sections and a presentation document's slides. Ported from ooxml.js's src/typed/shared/content.ts (itself ported from documents.js's src/model/content.ts) -- the canonical home now; ooxml.js and documents.js both import this instead of maintaining their own copy. The ContentDocument envelope below (formatVersion + kind + wordprocessing/presentation/spreadsheet/drawing variants) is this package's own addition on top of that shared vocabulary, matching documents.js's existing model/content.ts shape, since a caller needs a single top-level value to carry through a conversion pipeline.

// sourcePath is assigned by each format's reader at read time and copied onto emitted LayoutItems by the layout engine; this package only defines the field, it doesn't generate values. Known limitation: sourcePath values are stable within one read+layout pass over a single document, not across edits -- inserting content earlier in a document shifts every later path. This is not a stable identity scheme for incremental re-layout; it exists for tagged/accessible-PDF-style traceability and debugging, not edit-tracking.

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
});
export type ContentRun = z.infer<typeof ContentRunSchema>;

export const ContentListMembershipSchema = z.object({
  numId: z.string(), // w:numId
  level: z.number().int().nonnegative(), // w:ilvl
});
export type ContentListMembership = z.infer<typeof ContentListMembershipSchema>;

export const ContentParagraphSchema = z.object({
  kind: z.literal('paragraph'),
  runs: z.array(ContentRunSchema),
  styleId: z.string().optional(), // w:pStyle/@w:val, e.g. 'Heading1'
  alignment: AlignmentSchema.optional(),
  list: ContentListMembershipSchema.optional(),
  spacingBeforePt: z.number().optional(),
  spacingAfterPt: z.number().optional(),
  lineSpacing: z.number().positive().optional(), // multiple of single line height
  indentLeftPt: z.number().optional(),
  indentFirstLinePt: z.number().optional(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
});
export type ContentParagraph = z.infer<typeof ContentParagraphSchema>;

export const ContentImageBlockSchema = z.object({
  kind: z.literal('image'),
  format: z.enum(['png', 'jpeg']),
  base64: z.string(),
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  altText: z.string().optional(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
});
export type ContentImageBlock = z.infer<typeof ContentImageBlockSchema>;

export const ContentPageBreakSchema = z.object({
  kind: z.literal('pageBreak'),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
});
export type ContentPageBreak = z.infer<typeof ContentPageBreakSchema>;

// ContentTable is mutually recursive with ContentBlock (a cell contains blocks, which may themselves be tables) -- hand-written, mirroring ooxml.js's own XmlElement/isXmlNode pattern, since z.lazy() collapses to `unknown` for recursive children in the pinned Zod version.
export interface ContentTableCell {
  blocks: ContentBlock[];
  colSpan?: number;
  rowSpan?: number;
  background?: Color;
  borders?: ContentCellBorders;
  sourcePath?: string;
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
}

// ContentEmbeddedObject is mutually recursive with ContentDocument (an embedded object carries a whole ContentDocument, which can itself contain another embedded object -- e.g. a formula embedded inside a drawing embedded inside a spreadsheet) -- hand-written, mirroring ContentTable/ContentBlock's own recursive-guard-plus-z.custom pattern immediately below, since z.lazy() collapses to `unknown` for recursive children in this pinned Zod version. objectKind names what the embedded thing conceptually is: 'formula' is a short inline equation/OLE-formula object, expected to be short enough that a layout engine can reasonably lay it out and render it; the other four objectKind values name an embedded whole sub-document of that ContentDocument kind (an embedded spreadsheet range, a nested drawing, etc.) and are expected to round-trip through this model losslessly without ever being laid out or rendered -- this package holds schemas only, so no rendering/layout logic lives here regardless of objectKind.
export type ContentEmbeddedObjectKind = 'formula' | 'wordprocessing' | 'presentation' | 'spreadsheet' | 'drawing';

export interface ContentEmbeddedObject {
  objectKind: ContentEmbeddedObjectKind;
  document: ContentDocument;
  frame: Box; // page-space position and size, in the same xPt/yPt/widthPt/heightPt convention as ContentShape.frame
}

// The block-level anchoring point for an embedded object inside a wordprocessing section's or a presentation/drawing shape's own block flow -- reuses ContentEmbeddedObject's fields directly (frame included) rather than nesting a separate `embeddedObject: ContentEmbeddedObject` field, since ContentEmbeddedObject already carries its own frame and duplicating it would just be two copies of the same position.
export interface ContentEmbeddedObjectBlock extends ContentEmbeddedObject {
  kind: 'embeddedObject';
  sourcePath?: string; // deterministic, document-order-derived path assigned by the format reader
}

export type ContentBlock = ContentParagraph | ContentTable | ContentImageBlock | ContentPageBreak | ContentEmbeddedObjectBlock;

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
    ContentDocumentSchema.safeParse(value.document).success
  );
}

function isContentEmbeddedObjectBlock(value: unknown): value is ContentEmbeddedObjectBlock {
  return isRecord(value) && value.kind === 'embeddedObject' && isContentEmbeddedObject(value);
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
  return false;
}

export const ContentBlockSchema = z.custom<ContentBlock>(isContentBlock);

// Standalone schema for an embedded object on its own, independent of the block-level wrapper below -- this is what ContentSheetSchema.embeddedObjects (a sheet has no block-flow concept to anchor into) validates each entry against.
export const ContentEmbeddedObjectSchema = z.custom<ContentEmbeddedObject>(isContentEmbeddedObject);

// Standalone schema for the ContentBlock 'embeddedObject' variant, matching the sibling per-kind block schemas above (ContentParagraphSchema, ContentImageBlockSchema, ContentPageBreakSchema) even though ContentBlockSchema itself validates every kind, embeddedObject included, through the single custom guard above.
export const ContentEmbeddedObjectBlockSchema = z.custom<ContentEmbeddedObjectBlock>(isContentEmbeddedObjectBlock);

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

// A cell's own computed/typed value, one variant per ODF office:value-type. formula and displayText live on ContentSheetCellSchema itself, not per-variant here, since a formula can produce any of these value kinds and displayText is a per-cell rendering concern, not part of the value's own type.
export const ContentCellValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('number'), value: z.number() }),
  z.object({ kind: z.literal('percentage'), value: z.number() }), // the underlying numeric value, e.g. 0.5 for a cell displaying "50%"
  z.object({ kind: z.literal('currency'), value: z.number(), currency: z.string().optional() }), // currency is the ISO 4217 code (e.g. 'USD'), mirroring ODF's office:currency
  z.object({ kind: z.literal('boolean'), value: z.boolean() }),
  z.object({ kind: z.literal('date'), value: z.string() }), // ISO-8601 date, e.g. '2026-07-30'
  z.object({ kind: z.literal('time'), value: z.string() }), // ISO-8601 time, e.g. '13:30:00'
  z.object({ kind: z.literal('string'), value: z.string() }),
  z.object({ kind: z.literal('error'), value: z.string() }), // the producer's own error text, e.g. '#DIV/0!'
  z.object({ kind: z.literal('empty') }), // a cell that is present (formatted, merged, etc.) but carries no value
]);
export type ContentCellValue = z.infer<typeof ContentCellValueSchema>;

// row/column are the cell's own position, not implied by array index -- ContentSheetSchema.cells is sparse, since real sheets are sparse. displayText is the producer's own rendered string for `value` (its number-format/locale/currency-symbol applied already) and is required on every cell that exists in this array, since a cell with nothing to display simply isn't included; it is what makes spreadsheet-to-PDF rendering tractable without this package reimplementing a number-format/locale engine. formula, if present, is carried verbatim in whatever syntax the source format used. colSpan/rowSpan are set on the anchor cell only, matching how ContentTableCell already handles merged cells. alignment is an override of the existing value-kind default (numeric right, boolean/error centre, string left); absent means that default still applies. verticalAlignment has no value-kind default to fall back to, so its own absence means 'bottom' outright, matching a real spreadsheet's own typical default.
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
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
});
export type ContentSheetCell = z.infer<typeof ContentSheetCellSchema>;

export const ContentSheetColumnSchema = z.object({
  index: z.number().int().nonnegative(),
  widthPt: z.number().nonnegative(),
  hidden: z.boolean().optional(),
});
export type ContentSheetColumn = z.infer<typeof ContentSheetColumnSchema>;

export const ContentSheetRowSchema = z.object({
  index: z.number().int().nonnegative(),
  heightPt: z.number().nonnegative(),
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
  scale: z.number().positive().optional(), // print scale, percentage or fraction depending on the source format's own convention
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
  }),
  z.object({
    kind: z.literal('ellipse'),
    frame: BoxSchema,
    rotationDeg: z.number().optional(),
    fill: ColorSchema.optional(),
    stroke: ContentStrokeSchema.optional(),
    paintOrder: z.number().optional(),
    sourcePath: z.string().optional(),
  }),
  z.object({
    kind: z.literal('line'),
    from: ContentPathPointSchema,
    to: ContentPathPointSchema,
    stroke: ContentStrokeSchema,
    paintOrder: z.number().optional(),
    sourcePath: z.string().optional(),
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

// Bumped whenever ContentDocumentSchema's shape changes incompatibly.
export const CONTENT_FORMAT_VERSION = 1;

export const ContentDocumentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wordprocessing'),
    formatVersion: z.literal(CONTENT_FORMAT_VERSION),
    metadata: LayoutMetadataSchema,
    sections: z.array(ContentSectionSchema),
  }),
  z.object({
    kind: z.literal('presentation'),
    formatVersion: z.literal(CONTENT_FORMAT_VERSION),
    metadata: LayoutMetadataSchema,
    slides: z.array(ContentSlideSchema),
  }),
  z.object({
    kind: z.literal('spreadsheet'),
    formatVersion: z.literal(CONTENT_FORMAT_VERSION),
    metadata: LayoutMetadataSchema,
    sheets: z.array(ContentSheetSchema),
  }),
  z.object({
    kind: z.literal('drawing'),
    formatVersion: z.literal(CONTENT_FORMAT_VERSION),
    metadata: LayoutMetadataSchema,
    pages: z.array(ContentDrawPageSchema),
  }),
]);
export type ContentDocument = z.infer<typeof ContentDocumentSchema>;
