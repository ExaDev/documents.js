import { z } from 'zod';
import { ColorSchema, ContentStrokeStyleSchema, LayoutFontSchema, LayoutMetadataSchema } from 'document-schema.js';

// pdf-codec's own native document model: LayoutDocument, the positioned item layer readPdf assembles from a PDF's bytes and writePdf draws into new ones. Ported verbatim from document-schema.js's own src/layout.ts (its home from the content pivot until that package's 4.0.0 promoted DocumentPackage and dropped it) because a codec's native model belongs in the codec -- the same family pattern as ooxml.js's Package/XmlElement and markdown-codec's AST; only PDF's native model was ever a public shared-schema export, an accident of this package predating the content pivot. The item layer remains the honest boundary between what the format says (positions) and what we think it means (structure): when documents.js's reconstruction misjudges a wrapped paragraph, these items stay inspectable as the PDF's actual testimony. Reconstruction heuristics are semantic policy and stay in documents.js, not here. The shared leaf shapes the family composes from (Color, ContentStrokeStyleSchema, LayoutFont, LayoutMetadata) stay in document-schema.js and are imported above, so content and layout keep one definition of each.

// Bumped whenever LayoutDocumentSchema's shape changes incompatibly, so a value serialized by one version of a consumer can be recognised (and rejected, rather than silently misread) by another. Still 1: moving the schemas between packages changed where the family lives, not what it accepts.
export const LAYOUT_FORMAT_VERSION = 1;

// sourcePath is assigned by each format's reader at read time and copied onto emitted LayoutItems by the layout engine; this module only defines the field, it doesn't generate values. Known limitation: sourcePath values are stable within one read+layout pass over a single document, not across edits -- inserting content earlier in a document shifts every later path. This is not a stable identity scheme for incremental re-layout; it exists for tagged/accessible-PDF-style traceability and debugging, not edit-tracking.

// A single painted or annotated element on a page. Coordinates are always PDF user space: origin bottom-left, y increasing upward, unit = point. Every field carries an explicit Pt suffix so a caller can never accidentally mix this with ContentShape.frame's OOXML (top-left, y-down) space.
export const LayoutTextSchema = z.object({
  kind: z.literal('text'),
  text: z.string(),
  xPt: z.number(),
  yPt: z.number(), // baseline
  font: LayoutFontSchema,
  sizePt: z.number().positive(),
  color: ColorSchema,
  widthPt: z.number().nonnegative().optional(), // measured (write path) or reported (read path)
  rotationDeg: z.number().optional(),
  underline: z.boolean().optional(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path copied from the ContentDocument item this was laid out from
});
export type LayoutText = z.infer<typeof LayoutTextSchema>;

export const LayoutImageSchema = z.object({
  kind: z.literal('image'),
  imageId: z.string(), // key into LayoutDocument.images
  xPt: z.number(), // bottom-left corner
  yPt: z.number(),
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  rotationDeg: z.number().optional(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path copied from the ContentDocument item this was laid out from
});
export type LayoutImage = z.infer<typeof LayoutImageSchema>;

export const LayoutRectSchema = z.object({
  kind: z.literal('rect'),
  xPt: z.number(),
  yPt: z.number(),
  widthPt: z.number().nonnegative(),
  heightPt: z.number().nonnegative(),
  fill: ColorSchema.optional(),
  stroke: z.object({ color: ColorSchema, widthPt: z.number().positive() }).optional(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path copied from the ContentDocument item this was laid out from
});
export type LayoutRect = z.infer<typeof LayoutRectSchema>;

export const LayoutLineSchema = z.object({
  kind: z.literal('line'),
  x1Pt: z.number(),
  y1Pt: z.number(),
  x2Pt: z.number(),
  y2Pt: z.number(),
  color: ColorSchema,
  widthPt: z.number().positive(),
  style: ContentStrokeStyleSchema.optional(), // stroke dash pattern hint; absent means 'solid', matching ContentStrokeSchema's own documented default
  sourcePath: z.string().optional(), // deterministic, document-order-derived path copied from the ContentDocument item this was laid out from
});
export type LayoutLine = z.infer<typeof LayoutLineSchema>;

export const LayoutEllipseSchema = z.object({
  kind: z.literal('ellipse'),
  xPt: z.number(), // bottom-left corner of the bounding box
  yPt: z.number(),
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  fill: ColorSchema.optional(),
  stroke: z.object({ color: ColorSchema, widthPt: z.number().positive() }).optional(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path copied from the ContentDocument item this was laid out from
});
export type LayoutEllipse = z.infer<typeof LayoutEllipseSchema>;

// A path segment in page-absolute PDF user space (see LayoutPathSchema below), not the subpath's own local coordinate space -- unlike ContentVector's 'path' variant (document-schema.js's content.ts), which is still in the source shape's local, viewBox-relative space and needs a frame to place it. By the time a LayoutPath exists, the layout engine has already resolved every point through flipY and shape placement, matching how LayoutLine's x1Pt/y1Pt/x2Pt/y2Pt are already page-absolute rather than carrying a separate frame.
export const LayoutPathSegmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line'), xPt: z.number(), yPt: z.number() }),
  z.object({
    kind: z.literal('cubic'),
    c1xPt: z.number(),
    c1yPt: z.number(),
    c2xPt: z.number(),
    c2yPt: z.number(),
    xPt: z.number(),
    yPt: z.number(),
  }),
]);
export type LayoutPathSegment = z.infer<typeof LayoutPathSegmentSchema>;

// One contiguous subpath: an initial moveto point, then a sequence of line/cubic segments, closed or open -- the PDF content-stream model directly (m, then l/c per segment, then an optional h).
export const LayoutSubpathSchema = z.object({
  startXPt: z.number(),
  startYPt: z.number(),
  segments: z.array(LayoutPathSegmentSchema),
  closed: z.boolean(),
});
export type LayoutSubpath = z.infer<typeof LayoutSubpathSchema>;

// A general vector path: one or more subpaths sharing one fill/stroke, painted with the given fill rule (PDF's f vs f* / B vs B*) -- the LayoutRect/LayoutEllipse fill/stroke shape convention, reused verbatim, plus fillRule since a path (unlike a rect or ellipse) can be self-intersecting or contain nested/overlapping subpaths where nonzero vs evenodd actually changes what paints.
export const LayoutPathSchema = z.object({
  kind: z.literal('path'),
  subpaths: z.array(LayoutSubpathSchema),
  fill: ColorSchema.optional(),
  fillRule: z.enum(['nonzero', 'evenodd']).optional(),
  stroke: z.object({ color: ColorSchema, widthPt: z.number().positive() }).optional(),
  style: ContentStrokeStyleSchema.optional(), // stroke dash pattern hint; absent means 'solid', matching ContentStrokeSchema's own documented default
  sourcePath: z.string().optional(), // deterministic, document-order-derived path copied from the ContentDocument item this was laid out from
});
export type LayoutPath = z.infer<typeof LayoutPathSchema>;

// A URI annotation rectangle -- not painted content, but a clickable region.
export const LayoutLinkSchema = z.object({
  kind: z.literal('link'),
  uri: z.string(),
  xPt: z.number(),
  yPt: z.number(),
  widthPt: z.number().nonnegative(),
  heightPt: z.number().nonnegative(),
  sourcePath: z.string().optional(), // deterministic, document-order-derived path copied from the ContentDocument item this was laid out from
});
export type LayoutLink = z.infer<typeof LayoutLinkSchema>;

export const LayoutItemSchema = z.discriminatedUnion('kind', [
  LayoutTextSchema,
  LayoutImageSchema,
  LayoutRectSchema,
  LayoutLineSchema,
  LayoutEllipseSchema,
  LayoutPathSchema,
  LayoutLinkSchema,
]);
export type LayoutItem = z.infer<typeof LayoutItemSchema>;

export const LayoutPageSchema = z.object({
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  items: z.array(LayoutItemSchema), // paints in array order, like a PDF content stream
  // pptx speaker notes for the slide this page came from, if any -- carried as a private, non-visible entry on the PDF page's own dictionary, never painted into the page content. PDF has no native concept of hidden presenter notes, so this is a round-trip mechanism specific to a writer/reader pair that both honour it, not a real PDF feature -- a PDF produced by anything else will never have it, and a PDF consumer that doesn't specifically know this convention will never see it either.
  notes: z.string().optional(),
});
export type LayoutPage = z.infer<typeof LayoutPageSchema>;

// An entry in the top-level image registry: bytes live here once, keyed by imageId, so a repeated logo across many pages/slides embeds (or extracts) exactly once. Bytes are the original file bytes for the given format -- PNG bytes are re-encoded from decoded pixels where needed; JPEG bytes are the original encoded stream, verbatim, in both directions.
export const LayoutImageAssetSchema = z.object({
  format: z.enum(['png', 'jpeg']),
  base64: z.string(),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
});
export type LayoutImageAsset = z.infer<typeof LayoutImageAssetSchema>;

export const LayoutDocumentSchema = z.object({
  formatVersion: z.literal(LAYOUT_FORMAT_VERSION),
  metadata: LayoutMetadataSchema,
  pages: z.array(LayoutPageSchema),
  images: z.record(z.string(), LayoutImageAssetSchema),
});
export type LayoutDocument = z.infer<typeof LayoutDocumentSchema>;
