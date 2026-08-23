import { z } from 'zod';
import { ColorSchema, ContentStrokeStyleSchema, LayoutFontSchema, LayoutMetadataSchema, SourceResidueSchema } from 'document-schema.js';

// pdf-codec's own native document model: LayoutDocument, the positioned item layer readPdf assembles from a PDF's bytes and writePdf draws into new ones. Ported verbatim from document-schema.js's own src/layout.ts (its home from the content pivot until that package's 4.0.0 promoted DocumentTree and dropped it) because a codec's native model belongs in the codec -- the same family pattern as ooxml.js's Package/XmlElement and markdown-codec's AST; only PDF's native model was ever a public shared-schema export, an accident of this package predating the content pivot. The item layer remains the honest boundary between what the format says (positions) and what we think it means (structure): when documents.js's reconstruction misjudges a wrapped paragraph, these items stay inspectable as the PDF's actual testimony. Reconstruction heuristics are semantic policy and stay in documents.js, not here. The shared leaf shapes the family composes from (Color, ContentStrokeStyleSchema, LayoutFont, LayoutMetadata) stay in document-schema.js and are imported above, so content and layout keep one definition of each.

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
  layer: z.string().optional(), // the optional-content group this item belongs to (a /OC BDC span or XObject dict), naming an entry in LayoutDocument.layers
  actualText: z.string().optional(), // a /ActualText marked-content span over this run: the producer's own replacement reading for extraction
  alt: z.string().optional(), // a /Alt marked-content span over this run: the producer's alternate description
  structure: z.string().optional(), // the id of the owning element in LayoutDocument.structure -- tagged PDF's (page, MCID) association through /ParentTree
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
  layer: z.string().optional(), // the optional-content group this item belongs to, naming an entry in LayoutDocument.layers
  structure: z.string().optional(), // the id of the owning element in LayoutDocument.structure -- tagged PDF's (page, MCID) association through /ParentTree
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
  layer: z.string().optional(), // the optional-content group this item belongs to, naming an entry in LayoutDocument.layers
  structure: z.string().optional(), // the id of the owning element in LayoutDocument.structure -- tagged PDF's (page, MCID) association through /ParentTree
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
  layer: z.string().optional(), // the optional-content group this item belongs to, naming an entry in LayoutDocument.layers
  structure: z.string().optional(), // the id of the owning element in LayoutDocument.structure -- tagged PDF's (page, MCID) association through /ParentTree
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
  layer: z.string().optional(), // the optional-content group this item belongs to, naming an entry in LayoutDocument.layers
  structure: z.string().optional(), // the id of the owning element in LayoutDocument.structure -- tagged PDF's (page, MCID) association through /ParentTree
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
  layer: z.string().optional(), // the optional-content group this item belongs to, naming an entry in LayoutDocument.layers
  structure: z.string().optional(), // the id of the owning element in LayoutDocument.structure -- tagged PDF's (page, MCID) association through /ParentTree
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
  title: z.string().optional(), // the link annotation's own /Contents, where the producer wrote one
  sourcePath: z.string().optional(), // deterministic, document-order-derived path copied from the ContentDocument item this was laid out from
});
export type LayoutLink = z.infer<typeof LayoutLinkSchema>;

// An internal navigation annotation rectangle: a /Dest (direct or named) or /A /GoTo link whose target is a destination in THIS document rather than a URI. Its own item kind rather than a `destination` field on LayoutLink because LayoutLink.uri is required by every existing producer and consumer -- widening it to optional would be a breaking type change for all of them, while a new discriminated-union member is additive (TS-breaking only for a consumer switching exhaustively over item kinds, the same caveat every additive union member carries).
export const LayoutInternalLinkSchema = z.object({
  kind: z.literal('internalLink'),
  destination: z.string(), // a key into LayoutDocument.destinations -- a named destination's own name, or a reader-minted name for a direct destination array
  xPt: z.number(),
  yPt: z.number(),
  widthPt: z.number().nonnegative(),
  heightPt: z.number().nonnegative(),
  title: z.string().optional(), // the link annotation's own /Contents, where the producer wrote one
});
export type LayoutInternalLink = z.infer<typeof LayoutInternalLinkSchema>;

export const LayoutItemSchema = z.discriminatedUnion('kind', [
  LayoutTextSchema,
  LayoutImageSchema,
  LayoutRectSchema,
  LayoutLineSchema,
  LayoutEllipseSchema,
  LayoutPathSchema,
  LayoutLinkSchema,
  LayoutInternalLinkSchema,
]);
export type LayoutItem = z.infer<typeof LayoutItemSchema>;

// One non-link, non-widget annotation on a page (#721): a sticky note (/Subtype /Text a third party authored), a FreeText, or a /QuadPoints markup annotation -- or an opaque kind (Stamp, Ink, ...) whose facts ride the quarantined residue channel. /QuadPoints transform through the same page matrix as the rect, so a consumer matches them against recovered items in one space.
export const LayoutAnnotationQuadSchema = z.tuple([
  z.object({ xPt: z.number(), yPt: z.number() }),
  z.object({ xPt: z.number(), yPt: z.number() }),
  z.object({ xPt: z.number(), yPt: z.number() }),
  z.object({ xPt: z.number(), yPt: z.number() }),
]);
export type LayoutAnnotationQuad = z.infer<typeof LayoutAnnotationQuadSchema>;

export const LayoutAnnotationSchema = z.object({
  subtype: z.string(), // the annotation's own /Subtype, kept verbatim -- the semantic set is small and real-world producers emit more kinds than any closed enum here should claim
  xPt: z.number(),
  yPt: z.number(),
  widthPt: z.number().nonnegative(),
  heightPt: z.number().nonnegative(),
  contents: z.string().optional(), // /Contents: the note body, typed remark, or annotation label
  author: z.string().optional(), // /T
  modifiedIso: z.string().optional(), // /M, parsed through the shared PDF date profile
  quads: z.array(LayoutAnnotationQuadSchema).optional(), // /QuadPoints, page-space, four points per quad
  source: SourceResidueSchema.optional(), // the raw annotation dictionary in PDF syntax, for kinds with no cross-format analogue
});
export type LayoutAnnotation = z.infer<typeof LayoutAnnotationSchema>;

export const LayoutPageSchema = z.object({
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  items: z.array(LayoutItemSchema), // paints in array order, like a PDF content stream
  annotations: z.array(LayoutAnnotationSchema).optional(),
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

// --- Document-level navigation surfaces (#721): destinations and the outline, read from /Dests, /Names /Dests, and /Outlines. ---

// What a destination says about its target page's view (ISO 32000-1 12.3.6): the display destination type plus whichever coordinates that type actually carries. Absent coordinates were null (or the type does not define them) in the source -- never 0, which would assert a position the file did not state.
export const LayoutDestinationTargetSchema = z.object({
  kind: z.enum(['xyz', 'fit', 'fitH', 'fitV', 'fitR', 'fitB', 'fitBH', 'fitBV']),
  leftPt: z.number().optional(),
  topPt: z.number().optional(),
  bottomPt: z.number().optional(),
  rightPt: z.number().optional(),
  zoom: z.number().optional(),
});
export type LayoutDestinationTarget = z.infer<typeof LayoutDestinationTargetSchema>;

export const LayoutDestinationSchema = z.object({
  name: z.string(), // the named destination's own name, or a reader-minted `destN` for a direct destination array (minted names never collide with real ones -- the minter skips taken names)
  pageIndex: z.number().int().nonnegative(),
  target: LayoutDestinationTargetSchema,
});
export type LayoutDestination = z.infer<typeof LayoutDestinationSchema>;

// One /Outlines bookmark: its target is always a destinations-table name, so an outline entry and an internal link targeting the same place name the same destination.
export const LayoutOutlineItemSchema: z.ZodType<LayoutOutlineItem, LayoutOutlineItem> = z.lazy(() =>
  z.object({
    title: z.string(),
    destination: z.string().optional(),
    children: z.array(LayoutOutlineItemSchema),
  }),
);
export interface LayoutOutlineItem {
  readonly title: string;
  readonly destination?: string;
  readonly children: readonly LayoutOutlineItem[];
}

// An embedded file (/Names /EmbeddedFiles entry, /FileAttachment annotation filespec, or /AF associated file): decoded bytes as base64, the filespec's own name and description, and the stream's MIME type where it declared one.
export const LayoutAttachmentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  base64: z.string(),
});
export type LayoutAttachment = z.infer<typeof LayoutAttachmentSchema>;

// One AcroForm widget placement: the page a widget annotation sits on plus its rectangle, in the same page space every other item carries.
export const LayoutFormWidgetSchema = z.object({
  pageIndex: z.number().int().nonnegative(),
  xPt: z.number(),
  yPt: z.number(),
  widthPt: z.number().nonnegative(),
  heightPt: z.number().nonnegative(),
});
export type LayoutFormWidget = z.infer<typeof LayoutFormWidgetSchema>;

// One AcroForm field (#721 phase 5): terminal fields carry /FT (mapped to the harmonised control vocabulary), the scalar /V where one exists, /Opt choices, /TU alias, and the /Ff ReadOnly bit; non-terminal fields are groups whose children carry fully-qualified names (the /T chain joined with '.'). Signature fields read as facts only -- certification binds to bytes a semantic pivot never reproduces, so a consumer treats them as residue, never as a control.
export interface LayoutFormField {
  readonly name: string;
  readonly fieldType: 'text' | 'checkbox' | 'radio' | 'button' | 'listbox' | 'combobox' | 'signature' | 'group';
  readonly value?: string;
  readonly checked?: boolean;
  readonly options?: readonly string[];
  readonly alias?: string;
  readonly readOnly?: boolean;
  readonly widgets: readonly LayoutFormWidget[];
  readonly children: readonly LayoutFormField[];
}
export const LayoutFormFieldSchema: z.ZodType<LayoutFormField, LayoutFormField> = z.lazy(() =>
  z.object({
    name: z.string(),
    fieldType: z.enum(['text', 'checkbox', 'radio', 'button', 'listbox', 'combobox', 'signature', 'group']),
    value: z.string().optional(),
    checked: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    alias: z.string().optional(),
    readOnly: z.boolean().optional(),
    widgets: z.array(LayoutFormWidgetSchema),
    children: z.array(LayoutFormFieldSchema),
  }),
);

// One optional-content group with its visibility under the document's default configuration (/OCProperties /D): BaseState adjusted by the /ON and /OFF lists. `visible` is the DEFAULT VIEW's state, not a mandate -- a consumer decides what an invisible layer's content means for it.
export const LayoutLayerSchema = z.object({
  name: z.string(), // the OCG's /Name, or a reader-minted layerN when the producer left it unnamed
  visible: z.boolean(),
});
export type LayoutLayer = z.infer<typeof LayoutLayerSchema>;

// One tagged-PDF structure element (#760, ISO 32000-1 14.7.2): a node of the /StructTreeRoot tree. `type` is the element's /S with /RoleMap applied -- a custom name the role map maps lands here as its standard target, and an unmapped custom name stays verbatim (the honest spelling when no standard mapping exists). `title` is /T, `language` a per-element /Lang override (own, or resolved from a /ClassMap entry's attributes), `alt`/`actualText` the element-level accessibility attributes. `id` is reader-minted in document order -- the key an extracted item's own `structure` field names, exactly as a layer name names a row of `layers`.
export const LayoutStructureElementSchema: z.ZodType<LayoutStructureElement, LayoutStructureElement> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.string(),
    title: z.string().optional(),
    language: z.string().optional(),
    alt: z.string().optional(),
    actualText: z.string().optional(),
    children: z.array(LayoutStructureElementSchema),
  }),
);
export interface LayoutStructureElement {
  readonly id: string;
  readonly type: string;
  readonly title?: string;
  readonly language?: string;
  readonly alt?: string;
  readonly actualText?: string;
  readonly children: readonly LayoutStructureElement[];
}

export const LayoutDocumentSchema = z.object({
  formatVersion: z.literal(LAYOUT_FORMAT_VERSION),
  metadata: LayoutMetadataSchema,
  pages: z.array(LayoutPageSchema),
  images: z.record(z.string(), LayoutImageAssetSchema),
  destinations: z.array(LayoutDestinationSchema).optional(),
  outline: z.array(LayoutOutlineItemSchema).optional(),
  attachments: z.array(LayoutAttachmentSchema).optional(),
  layers: z.array(LayoutLayerSchema).optional(),
  structure: z.array(LayoutStructureElementSchema).optional(), // the tagged-PDF /StructTreeRoot element tree, present only in a tagged document
  form: z.array(LayoutFormFieldSchema).optional(),
  // The package-level half of the quarantined residue channel (document-schema.js's SourceResidue): whole-document PDF facts no content node owns -- the raw XMP packet, output intents, viewer/session behaviour, private application data, the trailer /ID. Keyed by the fact's own name, opaque to everything downstream exactly as the channel's contract states.
  source: z.record(z.string(), SourceResidueSchema).optional(),
});
export type LayoutDocument = z.infer<typeof LayoutDocumentSchema>;
