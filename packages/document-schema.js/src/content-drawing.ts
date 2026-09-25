import { z } from "zod";
import { ColorSchema } from "./color";
import { BoxSchema, LayoutFrameSchema, PageSizeSchema } from "./geometry";
import { SourceResidueSchema } from "./source";
import {
  CONTENT_ANNOTATION_FIELDS,
  ContentStrokeStyleSchema,
  contentBlockSchemaBox,
} from "./content-vocabulary";

// The drawing content model, split from content.ts: a presentation shape and slide (ContentShapeSchema/ContentSlideSchema) and the standalone vector primitives (stroke dashes, gradient/hatch/bitmap fills, path segments, ContentVectorSchema, ContentDrawPageSchema). ContentShapeSchema's own blocks field reaches the block schema through z.lazy, deferred past module evaluation, exactly as it did inside content.ts.
// A pptx or odp shape's frame, in the pivot's own convention: top-left origin, y down, in points — a pptx reader converts from EMU (a:xfrm), an odp reader converts from ODF's own unit-suffixed lengths (svg:x/y/width/height) and radians (draw:transform's rotate()), but both land in this one shape. rotationDeg is clockwise about the frame's own centre and undefined rather than 0 for an unrotated shape — keeping the common case field-free rather than a stored, always-present zero. insetLeftPt/insetTopPt/insetRightPt/insetBottomPt are always present (never optional): every shape has SOME inset, whether from an explicit source-format attribute or that format's own documented default, and a picture/table (which has no text body at all) resolves to zero rather than leaving the field absent. fontScale/lineSpacingReduction are OOXML-specific (from DrawingML's a:normAutofit, present only when the source shape actually has autofit-shrunk text) and stay undefined for shapes read from any other format. paintOrder is a shared, cross-array z-ordering hint (also on every ContentVectorSchema variant) for a page that mixes shapes and vectors — deliberately a plain z.number() rather than an integer, to allow fractional insertion between two existing values later; harmless and unused on a ContentSlide, which has no sibling vectors array to order against.
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
  readingOrder: z.number().optional(), // where this shape falls in the order a person reading the slide would take it, recovered from the shapes' geometry rather than from p:spTree order (which is z-order and bears no relation to layout). Expressed as a rank ON the shape, exactly as paintOrder is, rather than by ordering the shapes array: sourcePath is assigned as slides[N].shapes[N] and must keep naming the position it names, so the array stays in document order and a consumer reading a slide as prose sorts by this instead. Same plain z.number() as paintOrder and for the same reason — a fractional value can be inserted between two existing ones later. Absent when the reader could not resolve an order
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  frames: z.array(LayoutFrameSchema).optional(), // this shape's own rendered position(s), once a layout pass has fused one in — see FusedNode above
  ...CONTENT_ANNOTATION_FIELDS,
  blocks: z.lazy(() => z.array(contentBlockSchemaBox.value!)),
});
export type ContentShape = z.infer<typeof ContentShapeSchema>;

export const ContentSlideSchema = z.object({
  size: PageSizeSchema,
  shapes: z.array(ContentShapeSchema),
  notes: z.string(),
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts); rides the tree's slide descriptor automatically (omit+extend, src/package-node.ts)
  ...CONTENT_ANNOTATION_FIELDS,
});
export type ContentSlide = z.infer<typeof ContentSlideSchema>;

// Drawing content model: pure vector primitives with no docx/pptx analogue, for a standalone drawing document (odf.js's .odg target). ContentShapeSchema (text-in-a-frame, already shared with presentations) covers text content; ContentVectorSchema below covers everything ContentShape can't — raw rectangles, ellipses, lines, and free-form paths.

// The real run-length pattern behind a 'dashed' ContentStroke (ExaDev/documents.js#954) — ODF's own <draw:stroke-dash> element (OASIS ODF 1.3 section 16.42.9), a repeating dot/dash sequence: dots1 copies of a dots1LengthPt-long dash, then (optionally) dots2 copies of a dots2LengthPt-long dash, each pair separated by distancePt of gap, the whole sequence repeating along the stroke. dots2/dots2LengthPt are absent for a single-length dash pattern (ODF's own draw:dots2 is optional — a plain "dash-dash-dash" pattern with no alternating second length at all, not a zero-count second sequence). A consumer with no interest in the exact pattern can keep treating ContentStrokeStyleSchema's own 'dashed' as the whole story; this is the closer look for one that wants it.
export const ContentStrokeDashSchema = z.object({
  dots1: z.number().int().positive(),
  dots1LengthPt: z.number().positive(),
  dots2: z.number().int().positive().optional(),
  dots2LengthPt: z.number().positive().optional(),
  distancePt: z.number().nonnegative(),
});
export type ContentStrokeDash = z.infer<typeof ContentStrokeDashSchema>;

export const ContentStrokeSchema = z.object({
  color: ColorSchema,
  widthPt: z.number().positive(),
  style: ContentStrokeStyleSchema.optional(), // absent means 'solid'
  opacity: z.number().min(0).max(1).optional(), // svg:stroke-opacity (OASIS ODF 1.3 section 20.410-ish — style:graphic-properties) — absent means fully opaque, matching Color's own plain-RGB shape (no alpha channel) rather than a stored, always-present 1
  dashPattern: ContentStrokeDashSchema.optional(), // present only when style is 'dashed' AND the source resolved a real <draw:stroke-dash> definition for it (ExaDev/documents.js#954) — a 'dashed' stroke whose dash definition could not be resolved keeps style alone, exactly as before this field existed
});
export type ContentStroke = z.infer<typeof ContentStrokeSchema>;

// The real definition behind a non-flat vector fill (ExaDev/documents.js#954) — gradient/bitmap/hatch, the three fill kinds a bare Color cannot express at all. Additive alongside ContentVectorSchema's existing `fill: ColorSchema.optional()` field on every fillable variant below, not a replacement for it: `fill` stays the flat, single-colour approximation (a representative swatch, exactly as it already behaved before this field existed — see readOdfFillAndStroke's own top-of-file note in odf.js for which swatch a gradient/hatch/bitmap fill resolves to), while `fillPattern` carries the real, lossless definition for a consumer that wants to render it properly. Kept as a genuinely separate field rather than widening `fill` itself into this union so every existing consumer of ContentVector's flat Color fill (documents.js's SVG writer, its layout/drawing.ts and edit/odg editor, document-cli's TUI) keeps typechecking unchanged.
export const ContentGradientStyleSchema = z.enum([
  "linear",
  "axial",
  "radial",
  "ellipsoid",
  "square",
  "rectangular",
]); // OASIS ODF 1.3 section 19.218.2 (draw:style on <draw:gradient>) — the complete, exhaustive enumeration.
export type ContentGradientStyle = z.infer<typeof ContentGradientStyleSchema>;

export const ContentGradientFillSchema = z.object({
  kind: z.literal("gradient"),
  style: ContentGradientStyleSchema,
  startColor: ColorSchema,
  endColor: ColorSchema,
  angleDeg: z.number().optional(), // <draw:gradient>'s own draw:angle (OASIS ODF 1.3 section 19.112), stored in the source's own angle convention as-is — ignored by the source itself for a 'radial' style, so absent there. There is no second format's gradient angle in this codebase yet to normalise against.
});
export type ContentGradientFill = z.infer<typeof ContentGradientFillSchema>;

export const ContentHatchStyleSchema = z.enum(["single", "double", "triple"]); // OASIS ODF 1.3 section 19.218.3 (draw:style on <draw:hatch>) — the complete, exhaustive enumeration.
export type ContentHatchStyle = z.infer<typeof ContentHatchStyleSchema>;

export const ContentHatchFillSchema = z.object({
  kind: z.literal("hatch"),
  style: ContentHatchStyleSchema,
  color: ColorSchema,
  distancePt: z.number().nonnegative(),
  rotationDeg: z.number().optional(),
});
export type ContentHatchFill = z.infer<typeof ContentHatchFillSchema>;

// A bitmap fill's own raster image, resolved from the <draw:fill-image> definition its owning style references — the same format/base64 pairing ContentImageBlockSchema already carries for an embedded picture, without that schema's own sizing/positioning fields (a fill image tiles/stretches across whatever shape references it, it has no size or position of its own the way a placed picture does).
export const ContentBitmapFillSchema = z.object({
  kind: z.literal("bitmap"),
  format: z.enum(["png", "jpeg", "svg", "gif"]),
  base64: z.string(),
});
export type ContentBitmapFill = z.infer<typeof ContentBitmapFillSchema>;

export const ContentFillPatternSchema = z.discriminatedUnion("kind", [
  ContentGradientFillSchema,
  ContentHatchFillSchema,
  ContentBitmapFillSchema,
]);
export type ContentFillPattern = z.infer<typeof ContentFillPatternSchema>;

export const ContentPathPointSchema = z.object({
  xPt: z.number(),
  yPt: z.number(),
});
export type ContentPathPoint = z.infer<typeof ContentPathPointSchema>;

// A path segment in the enclosing ContentVector 'path' shape's own local coordinate space — not page-absolute. This is the content-side counterpart to a future LayoutPath on the layout side (not built yet, separate later work).
export const ContentPathSegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), to: ContentPathPointSchema }),
  z.object({
    kind: z.literal("cubic"),
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

// rotationDeg is deliberately not added to the 'line' variant: a line's rotation is already fully expressible via its own two endpoints, so a separate rotation field there would create two ways to say one thing with no defined pivot for it to rotate about. Where present, rotationDeg matches ContentShapeSchema's own documented semantics exactly: clockwise-on-screen degrees about the frame's own centre, undefined rather than 0 for an unrotated vector. paintOrder is the same shared, cross-array z-ordering hint ContentShapeSchema carries — see that schema's own comment.
export const ContentVectorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rect"),
    frame: BoxSchema,
    rotationDeg: z.number().optional(),
    fill: ColorSchema.optional(),
    fillPattern: ContentFillPatternSchema.optional(), // present only when the source fill is genuinely non-flat (gradient/bitmap/hatch) and its real definition resolved — see ContentFillPatternSchema's own comment
    fillOpacity: z.number().min(0).max(1).optional(), // absent means fully opaque, matching Color's own plain-RGB shape
    stroke: ContentStrokeSchema.optional(),
    paintOrder: z.number().optional(),
    sourcePath: z.string().optional(),
    source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
    frames: z.array(LayoutFrameSchema).optional(), // this vector's own rendered position(s), once a layout pass has fused one in — see FusedNode above
    ...CONTENT_ANNOTATION_FIELDS,
  }),
  z.object({
    kind: z.literal("ellipse"),
    frame: BoxSchema,
    rotationDeg: z.number().optional(),
    fill: ColorSchema.optional(),
    fillPattern: ContentFillPatternSchema.optional(),
    fillOpacity: z.number().min(0).max(1).optional(),
    stroke: ContentStrokeSchema.optional(),
    paintOrder: z.number().optional(),
    sourcePath: z.string().optional(),
    source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
    frames: z.array(LayoutFrameSchema).optional(),
    ...CONTENT_ANNOTATION_FIELDS,
  }),
  z.object({
    kind: z.literal("line"),
    from: ContentPathPointSchema,
    to: ContentPathPointSchema,
    stroke: ContentStrokeSchema,
    paintOrder: z.number().optional(),
    sourcePath: z.string().optional(),
    source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
    frames: z.array(LayoutFrameSchema).optional(),
    ...CONTENT_ANNOTATION_FIELDS,
  }),
  z.object({
    kind: z.literal("path"),
    frame: BoxSchema, // page-space placement and the size of the path's own local coordinate space, distinct from the subpaths' local-space points below
    rotationDeg: z.number().optional(),
    subpaths: z.array(ContentSubpathSchema),
    fill: ColorSchema.optional(),
    fillPattern: ContentFillPatternSchema.optional(),
    fillOpacity: z.number().min(0).max(1).optional(),
    fillRule: z.enum(["nonzero", "evenodd"]).optional(),
    stroke: ContentStrokeSchema.optional(),
    paintOrder: z.number().optional(),
    sourcePath: z.string().optional(),
    source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
    frames: z.array(LayoutFrameSchema).optional(),
    ...CONTENT_ANNOTATION_FIELDS,
  }),
]);
export type ContentVector = z.infer<typeof ContentVectorSchema>;

// vectors is deliberately a sibling array to shapes, not folded into ContentBlock — a vector primitive has no business inside a paragraph-flow block model.
export const ContentDrawPageSchema = z.object({
  size: PageSizeSchema,
  shapes: z.array(ContentShapeSchema),
  vectors: z.array(ContentVectorSchema),
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts); rides the tree's draw-page descriptor automatically (omit+extend, src/package-node.ts)
  ...CONTENT_ANNOTATION_FIELDS,
});
export type ContentDrawPage = z.infer<typeof ContentDrawPageSchema>;
