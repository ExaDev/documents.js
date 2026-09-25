import { z } from "zod";
import { ColorSchema } from "./color";
import { ConstructDescriptorSchema } from "./construct";
import { BoxSchema, LayoutFrameSchema } from "./geometry";
import { SourceResidueSchema } from "./source";
import { TextDirectionSchema } from "./style";
// Type-only: erased at build time, so this edge never reaches the bundler.
import type {
  ContentBlock,
  ContentDocument,
  ContentEmbeddedObject,
} from "./content";
// Read only inside the z.lazy thunk an embedded object document field wraps, deferred past module evaluation.

// The leaf vocabularies every content-model module shares, split from content.ts: the annotation channel (origin/transcript/interpretation plus the spreadable CONTENT_ANNOTATION_FIELDS group), the run-font property shape and the run and run-extent schemas, the stroke/border style enums, the float-position family, the image family, and the embedded-object family. This module imports nothing from content.ts at module-evaluation time (an embedded object's document field reads content.ts's schema box from inside a z.lazy thunk, deferred until after evaluation), so every other content module can depend on it freely and the graph stays acyclic for the bundler.
export const ContentOriginSchema = z.enum([
  "chart",
  "diagram",
  "table",
  "image",
  "notes",
  "body",
]);
export type ContentOrigin = z.infer<typeof ContentOriginSchema>;

// A verbatim reading of content whose own words are in pixels — OCR over a scanned page, a model asked to transcribe a figure's axis labels. mechanism: 'deterministic' for a reproducible reader (re-parsing yields the same text and therefore the same content hash), 'model' for a vision model's reading (handles layout, rotation and handwriting far better, and can produce plausible text that is not there — which is exactly why the distinction decides whether a sentence may be quoted).
export const ContentTranscriptSchema = z.object({
  text: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  mechanism: z.enum(["deterministic", "model"]),
});
export type ContentTranscript = z.infer<typeof ContentTranscriptSchema>;

// A model's output about the node it is attached to. transcript and description are independent optionals — either, both, or neither; the annotation with neither but a `by` is legal but says nothing and is a producer error no schema can usefully reject. `by` records which model produced the fields and when (ISO 8601), for provenance in exactly the reports that cite this content as evidence.
export const ContentInterpretationSchema = z.object({
  transcript: ContentTranscriptSchema.optional(),
  description: z.string().optional(),
  by: z
    .object({
      model: z.string(),
      at: z.string(), // ISO 8601 timestamp — a free string, not a parsed date: the schema's job is to carry the value, and formats' own timestamp spellings vary more than one parser should rule on
    })
    .optional(),
});
export type ContentInterpretation = z.infer<typeof ContentInterpretationSchema>;

// The two annotation fields as one spreadable group, so each node schema below states them with the identical spelling (the CONTENT_EMBEDDED_OBJECT_FIELDS discipline). origin first, interpretation second — the same order this block documents them in.
const CONTENT_ANNOTATION_FIELDS = {
  origin: ContentOriginSchema.optional(), // what this node's content IS, when the reader knows (a table read out of a chart's cached numbers, a shape group that together forms a diagram) — absent when the reader has nothing to say, which is the common case for ordinary prose
  interpretation: ContentInterpretationSchema.optional(), // what a model made of this content, attached by the consumer that ran it — see the annotation-channel block above; no codec reads or writes this field
};
export { CONTENT_ANNOTATION_FIELDS };

// The canonical run-level font property vocabulary: the seven formatting properties every text-bearing surface in this model can state about its typeface, defined once here and reused everywhere the same set is needed — a ContentRun's own inline fields (spread into the schema below), a styles entry's run half (src/definitions.ts wraps this exact shape in a strictObject), and a spreadsheet cell's uniform font (ContentSheetCell.font, via ContentFontSchema below). One shape, three consumers, no drift: a font property added here reaches every surface that carries fonts, and no consumer can grow a private member the others lack — the identical single-source discipline IMAGE_FORMATS applies to the image format enum further down.
const RUN_FONT_PROPERTY_SHAPE = {
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  fontFamily: z.string().optional(),
  sizePt: z.number().positive().optional(),
  color: ColorSchema.optional(),
} as const;
export { RUN_FONT_PROPERTY_SHAPE };

// A standalone font descriptor: exactly the run font vocabulary above, carried where a font is stated without a run of text to sit on inline — a spreadsheet cell whose formatting is uniform (ContentSheetCell.font). A ContentRun states the identical properties inline instead of nesting one of these; a hypothetical other consumer (a theme, a default) reuses this schema rather than restating the set.
export const ContentFontSchema = z.object(RUN_FONT_PROPERTY_SHAPE);
export type ContentFont = z.infer<typeof ContentFontSchema>;

export const ContentRunSchema = z.object({
  text: z.string(),
  ...RUN_FONT_PROPERTY_SHAPE,
  hyperlink: z.string().optional(), // resolved external URI
  verticalAlign: z.enum(["superscript", "subscript"]).optional(), // absent means baseline
  direction: TextDirectionSchema.optional(), // RTF's own \rtlch/\ltrch scope — the run-level of the four this format states direction at (see ContentParagraph.direction, ContentTableRow.direction, LayoutMetadata.direction for the other three)
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  frames: z.array(LayoutFrameSchema).optional(), // this run's own rendered position(s), once a layout pass has fused one in — see FusedNode above
  ...CONTENT_ANNOTATION_FIELDS,
});
export type ContentRun = z.infer<typeof ContentRunSchema>;

// A run-scoped construct extent: one construct (src/construct.ts) whose extent is a sub-sequence of ONE paragraph's runs — the mechanism the marker pair below deliberately is not, and the answer to the deferral construct.ts carried since 4.1.0 ("wait on a run-level extent mechanism rather than being forced into a block wrapper that would split the paragraph"). The entry is a descriptor plus a half-open run range: runs startRun..endRun are the extent, startRun === endRun is a point anchor at the boundary before run startRun, and endRun === runs.length reaches the paragraph's end. Ranges are data, not brackets — two entries may cross freely (WordprocessingML's own bookmarks overlap by w:id with no imposed nesting), which is exactly what a bracket pair cannot express and the reason this is an extent array rather than markers spliced into the runs.
export const RunConstructExtentSchema = z.object({
  descriptor: ConstructDescriptorSchema, // the construct this extent opens — the identical payload a construct group or a constructStart marker carries, so one descriptor vocabulary serves both scopes
  startRun: z.number().int().nonnegative(), // the first run of the extent, counting only the runs this paragraph itself carries
  endRun: z.number().int().nonnegative(), // one past the last run of the extent; equal to startRun for a point anchor
});
export type RunConstructExtent = z.infer<typeof RunConstructExtentSchema>;

// Shared stroke/border style vocabulary — reused by ContentStrokeSchema (drawing vector primitives, defined further down alongside them) and by ContentTableCellSchema/ContentSheetCellSchema's own per-side border fields further down, so a border always carries the same solid/dashed/dotted/double vocabulary regardless of which content leaf it decorates. Absent means 'solid' wherever this is optional.
export const ContentStrokeStyleSchema = z.enum([
  "solid",
  "dashed",
  "dotted",
  "double",
]);
export type ContentStrokeStyle = z.infer<typeof ContentStrokeStyleSchema>;

// A single border edge — distinct from ContentStrokeSchema only in that a border is always exactly one side of a rectangular cell, never a freestanding line/path stroke; both share the same colour/width/style vocabulary.
export const ContentBorderSchema = z.object({
  color: ColorSchema,
  widthPt: z.number().positive(),
  style: ContentStrokeStyleSchema.optional(), // absent means 'solid'
});
export type ContentBorder = z.infer<typeof ContentBorderSchema>;

// Where a floating image's position is measured FROM, on one axis — the union of every real origin docx's wp:positionH/wp:positionV (ECMA-376 Part 1 20.4.2.7/20.4.2.8, ST_RelFromH/ST_RelFromV) and ODF's own draw:frame anchoring (text:anchor-type="page"/"paragraph"/"frame", the anchor point svg:x/svg:y is itself measured from) between them use. docx's own two axes don't share one flat enum in ECMA-376 — ST_RelFromH has leftMargin/rightMargin/insideMargin/outsideMargin/column/character, ST_RelFromV has topMargin/bottomMargin/insideMargin/outsideMargin/paragraph/line — but nothing here is axis-specific in what it MEANS (leftMargin is still "the page's own left margin" on whichever axis it appears), so one shared enum covers both rather than forcing two near-identical ones a reader would otherwise have to keep in sync by hand.
export const ContentFloatOriginSchema = z.enum([
  "page",
  "margin",
  "leftMargin",
  "rightMargin",
  "topMargin",
  "bottomMargin",
  "insideMargin",
  "outsideMargin",
  "column",
  "character",
  "paragraph",
  "line",
  "frame", // ODF's text:anchor-type="frame" — anchored to a containing frame's own coordinate system, a case docx's relativeFrom vocabulary has no member for at all
]);
export type ContentFloatOrigin = z.infer<typeof ContentFloatOriginSchema>;

// docx's own wp:align keyword vocabulary (ECMA-376 ST_AlignH/ST_AlignV) — again one shared enum rather than two near-identical axis-specific ones, since "left"/"right" only ever appear on the horizontal axis and "top"/"bottom" only ever on the vertical in real producer output, so nothing is lost by not splitting them.
export const ContentFloatAlignSchema = z.enum([
  "left",
  "right",
  "top",
  "bottom",
  "center",
  "inside",
  "outside",
]);
export type ContentFloatAlign = z.infer<typeof ContentFloatAlignSchema>;

// One axis of a floating image's anchored position: an explicit point offset (docx's wp:posOffset, converted from EMU; ODF's svg:x/svg:y, already points) XOR a named alignment keyword (docx's wp:align only — ODF's draw:frame has no alignment-keyword concept at all, so an odt-sourced axis is always the offsetPt branch). offsetPt/align are genuinely mutually exclusive in both source formats (docx's own wp:positionH/wp:positionV schema is itself a choice between the two, never both at once), so this is a plain union of two strict, structurally-distinguished shapes rather than one object with both fields optional — an object naming both would be a state neither format can actually produce.
export const ContentFloatAxisSchema = z.union([
  z.strictObject({
    relativeTo: ContentFloatOriginSchema,
    offsetPt: z.number(),
  }),
  z.strictObject({
    relativeTo: ContentFloatOriginSchema,
    align: ContentFloatAlignSchema,
  }),
]);
export type ContentFloatAxis = z.infer<typeof ContentFloatAxisSchema>;

// A floating/anchored image's real position, independent of any layout pass — the source format's own native anchoring metadata (docx's wp:anchor, ODF's draw:frame with a paragraph/page/frame anchor type), as opposed to `frames` below (a rendered position a LAYOUT ENGINE computed, which this is not). Both axes are always present together: neither docx's wp:anchor nor ODF's positioned draw:frame ever states only one.
export const ContentFloatPositionSchema = z.object({
  horizontal: ContentFloatAxisSchema,
  vertical: ContentFloatAxisSchema,
});
export type ContentFloatPosition = z.infer<typeof ContentFloatPositionSchema>;

// The closed image-format vocabulary, stated once so the schema enum, the runtime type guard (isContentBlock below), and every consumer that needs to enumerate the set read one tuple rather than three hand-kept lists — the guard admitting only png/jpeg while the enum accepted png/jpeg/svg/gif was exactly the drift this single source exists to make impossible, caught on ExaDev/documents.js#1197 after the two lists had already diverged once. svg/gif carry the enum's own documented degradation contract (see the format field's comment): a codec whose reader cannot decode one of the members degrades to alt text with a diagnostic rather than being forced to adopt it.
export const IMAGE_FORMATS = ["png", "jpeg", "svg", "gif"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

// No separate `typeof value === "string"` guard: Array.prototype.includes compares by strict equality against IMAGE_FORMATS's own string elements, so it can only ever return true for a value that already IS one of those strings — a non-string value never satisfies it either way, making the typeof check redundant rather than a genuine second condition.
export function isImageFormat(value: unknown): value is ImageFormat {
  return IMAGE_FORMATS.includes(value as ImageFormat);
}

// The source's own compressed bytes for an image filter this family has no encoder for — JBIG2 (ITU-T T.88) and JPEG 2000 (ISO/IEC 15444-1). pdf-codec decodes both for real on read, but its writer can only re-emit such an image by re-encoding the decoded pixels through a filter it does have an encoder for, since a hand-written JBIG2 encoder is research-grade symbol-dictionary design and a JPEG 2000 encoder is the full EBCOT/wavelet stack — so a pdf-to-pdf round trip through this model was lossy for exactly these two filters. Carrying the original stream beside the canonical decoded representation lets a same-format writer re-embed it verbatim (zero generation loss), while every other consumer keeps reading `base64`, which stays the always-decodable canonical. Deliberately never set for a filter this family can already encode: a jpeg IS its own compressed bytes (format: 'jpeg' already passes through verbatim in both directions), and flate/ccitt are re-encoded from pixels losslessly (pdf-codec's bilevel writer even prefers CCITT G4 by size), so an original for those would be a second spelling of data the writer can already reproduce. jbig2GlobalsBase64 carries the image's /JBIG2Globals stream when the source had one — without it, a symbol-dictionary-carrying JBIG2 stream cannot decode, so verbatim re-embedding without the globals would produce a file no viewer can render.
export const ContentImageOriginalSchema = z.object({
  filter: z.enum(["jbig2", "jpeg2000"]),
  base64: z.string(),
  jbig2GlobalsBase64: z.string().optional(),
});
export type ContentImageOriginal = z.infer<typeof ContentImageOriginalSchema>;

export const ContentImageBlockSchema = z.object({
  kind: z.literal("image"),
  format: z.enum(IMAGE_FORMATS), // svg/gif added for epub's own manifest image kinds; a codec whose reader cannot yet decode one of the four degrades to alt text with a diagnostic exactly as it did before this field existed, rather than being forced to adopt them the moment they exist here
  base64: z.string(),
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  altText: z.string().optional(),
  original: ContentImageOriginalSchema.optional(), // the source's own compressed bytes for a no-encoder filter (JBIG2, JPEG 2000) — see ContentImageOriginalSchema above. base64 stays the canonical decoded representation every consumer renders; a same-format writer re-embeds these bytes verbatim instead of re-encoding, and a cross-format consumer ignores the field entirely, since the only writers that can re-embed a JBIG2/JPX stream are the ones whose source format carried it
  anchorRunIndex: z.number().int().nonnegative().optional(), // for an image a reader LIFTED out of a paragraph's own run stream (media found inside a paragraph's runs, surfaced as its own sibling block because ContentRun has no field to carry it): the index of the run in that sibling paragraph's own runs array whose text the image originally followed. anchorOffset then names the character position within that run's text after which the image sat, so the position becomes recoverable rather than structural — "the image in paragraph 12, after 'approved by'" instead of adjacency guesswork. The run whose text PRECEDES the image is the one named (an image at the paragraph's very start is (0, 0); one at its end is (last, last.text.length); one between two runs is (i, runs[i].text.length)); the paragraph itself is the sibling block the image was lifted into this list from, associated by adjacency exactly as before. Absent when the image was authored as its own block-level figure (the common case — position within a paragraph is meaningless for it) or when the lifting reader does not know the position
  anchorOffset: z.number().int().nonnegative().optional(), // the character position within runs[anchorRunIndex].text after which the image sat — always present with anchorRunIndex, never alone (the pair is one fact)
  caption: z.string().optional(), // the visible caption written beside this figure (a docx Caption-styled paragraph, which is what Word's Insert Caption produces) — ASSOCIATED with the image, never moved into it: the caption is real prose the document contains and stays its own paragraph block, so a flat-text projection carries it exactly once. Distinct from altText, which is invisible accessibility text existing nowhere else in the block list. Absent when the figure has no caption beside it, which is the common case
  floatPosition: ContentFloatPositionSchema.optional(), // this image's own source-native anchored position (docx w:drawing/wp:anchor; ODF draw:frame) — absent for an inline image (docx wp:inline; ODF text:anchor-type="as-char"/"char"), which has no anchored position of its own to record, placed in block flow at the point it was encountered instead
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  source: SourceResidueSchema.optional(), // quarantined residue — opaque text this format carries and no other format interprets (src/source.ts)
  frames: z.array(LayoutFrameSchema).optional(), // this image's own rendered position(s), once a layout pass has fused one in — see FusedNode above
  ...CONTENT_ANNOTATION_FIELDS,
});
export type ContentImageBlock = z.infer<typeof ContentImageBlockSchema>;

// A private box for ContentBlockSchema's own not-yet-built value, read from inside z.lazy thunks (a table cell's blocks, a shape's blocks) so the schema can be referenced before its own declaration finishes; populated by content.ts once ContentBlockSchema is built.
export const contentBlockSchemaBox: {
  value?: z.ZodType<ContentBlock, ContentBlock>;
} = {};

// A private box for ContentDocumentSchema's own not-yet-built value, read from both here and from ContentEmbeddedObjectSchema's own `document` field below, matching ContentBlockSchema's own identical box above. @typescript-eslint/no-use-before-define flags any textual reference to a not-yet-declared variable, even one read only from inside a closure that cannot possibly run before module evaluation finishes and the real value further down has already been built, and forward-declaring ContentDocumentSchema itself with `let` trips `prefer-const` the other way instead (a `let` assigned its value exactly once, in a later statement, is exactly what that rule flags). A boxed value sidesteps both: the box is a `const` declared up front, so nothing references it before its own declaration, and writing its `.value` property later is a mutation, not a variable reassignment. The non-null assertion on each read is exactly the case this package's own eslint config turns nonNullAssertion off for: neither reader can run before `contentDocumentSchemaBox.value` is set below.
export const contentDocumentSchemaBox: {
  value?: z.ZodType<ContentDocument, ContentDocument>;
} = {};

// The shared field set between ContentEmbeddedObjectSchema (the standalone schema ContentSheetSchema.embeddedObjects validates each entry against — a sheet has no block-flow concept to anchor an embedded object into) and ContentEmbeddedObjectBlockSchema (the ContentBlock 'embeddedObject' variant, which reuses these fields directly rather than nesting a separate `embeddedObject` field, mirroring the ContentEmbeddedObjectBlock interface's own `extends` relationship above). document is the genuine mutual-recursion edge back to a whole ContentDocument (an embedded object can carry another embedded object nested inside it), so it goes through z.lazy() exactly like ContentTableCellSchema's own `blocks` field below, reading contentDocumentSchemaBox.value (see that box's own comment above isContentEmbeddedObject) rather than ContentDocumentSchema directly, since ContentDocumentSchema itself is not yet a binding at this point in the module, and by the time either lazy thunk is actually called to validate something, the whole module has finished evaluating and the box has been populated.
const CONTENT_EMBEDDED_OBJECT_FIELDS = {
  objectKind: z.enum([
    "formula",
    "wordprocessing",
    "presentation",
    "spreadsheet",
    "drawing",
    "chart",
  ]),
  document: z.lazy(() => contentDocumentSchemaBox.value!),
  frame: BoxSchema,
  anchorRow: z.number().int().nonnegative().optional(),
  anchorColumn: z.number().int().nonnegative().optional(),
  offsetXPt: z.number().optional(),
  offsetYPt: z.number().optional(),
  source: SourceResidueSchema.optional(),
  ...CONTENT_ANNOTATION_FIELDS,
};

// Standalone schema for an embedded object on its own, independent of the block-level wrapper below. Annotated with both z.ZodType type parameters for the identical reason MathExpressionSchema is (see that schema's own comment in src/math.ts): this schema has no transform, so Input and Output are genuinely identical, and supplying only Output would leave Input at `unknown` — invisible to this package's own tests but not to a z.codec() consumer elsewhere in the workspace. Not itself a member of any z.discriminatedUnion (only ContentEmbeddedObjectBlockSchema, its own extended sibling below, is), so annotating it directly carries none of the propValues-widening risk that rules out annotating a union member.
export const ContentEmbeddedObjectSchema: z.ZodType<
  ContentEmbeddedObject,
  ContentEmbeddedObject
> = z.object(CONTENT_EMBEDDED_OBJECT_FIELDS);

// Standalone schema for the ContentBlock 'embeddedObject' variant, matching the sibling per-kind block schemas above (ContentParagraphSchema, ContentImageBlockSchema, ContentPageBreakSchema). Deliberately its own z.object() spreading CONTENT_EMBEDDED_OBJECT_FIELDS rather than ContentEmbeddedObjectSchema.extend({...}): ContentEmbeddedObjectSchema is annotated z.ZodType<ContentEmbeddedObject, ContentEmbeddedObject> above, which has no .extend() method of its own (that is a ZodObject-specific method the generic ZodType base does not expose) — and this schema needs to stay an unannotated, plain z.object() regardless, since it is a ContentBlockSchema union member (the identical "leave every discriminated-union member unannotated" rule the math/mathml recursive variants already follow).
export const ContentEmbeddedObjectBlockSchema = z.object({
  kind: z.literal("embeddedObject"),
  ...CONTENT_EMBEDDED_OBJECT_FIELDS,
  sourcePath: z.string().optional(), // deterministic, document-order-derived path assigned by the format reader
  frames: z.array(LayoutFrameSchema).optional(), // this embedded object's own rendered position(s), once a layout pass has fused one in — see FusedNode above
});
