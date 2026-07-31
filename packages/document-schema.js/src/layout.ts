import { z } from 'zod';
import { ColorSchema } from './color';
import { LayoutMetadataSchema } from './metadata';
import { LayoutFontSchema } from './style';

// Bumped whenever LayoutDocumentSchema's shape changes incompatibly, so a value serialized by one version of a consumer can be recognised (and rejected, rather than silently misread) by another.
export const LAYOUT_FORMAT_VERSION = 1;

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
});
export type LayoutEllipse = z.infer<typeof LayoutEllipseSchema>;

// A URI annotation rectangle -- not painted content, but a clickable region.
export const LayoutLinkSchema = z.object({
  kind: z.literal('link'),
  uri: z.string(),
  xPt: z.number(),
  yPt: z.number(),
  widthPt: z.number().nonnegative(),
  heightPt: z.number().nonnegative(),
});
export type LayoutLink = z.infer<typeof LayoutLinkSchema>;

export const LayoutItemSchema = z.discriminatedUnion('kind', [
  LayoutTextSchema,
  LayoutImageSchema,
  LayoutRectSchema,
  LayoutLineSchema,
  LayoutEllipseSchema,
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
