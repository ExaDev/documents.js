import { z } from 'zod';
import { ContentDrawPageSchema, ContentSectionSchema, ContentSheetSchema, ContentSlideSchema, LayoutMetadataSchema } from 'document-schema.js';

// Bumped whenever ContentDocumentSchema's shape changes incompatibly.
export const CONTENT_FORMAT_VERSION = 1;

// ContentDocument is the top-level envelope this package's own conversion pipeline reads and writes; everything it wraps (ContentSection, ContentSlide, ContentSheet, ContentDrawPage, and the full ContentBlock vocabulary beneath them) now lives in document-schema.js, the sibling schema package shared with ooxml.js. The envelope itself stays here rather than moving too, since documents.js owns its own CONTENT_FORMAT_VERSION independent of document-schema.js's own versioning. The 'spreadsheet' and 'drawing' variants each mirror document-schema.js's own ContentDocumentSchema union member exactly (a sheets array of ContentSheet; a pages array of ContentDrawPage).
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
