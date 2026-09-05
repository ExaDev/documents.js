import { z } from "zod";

import { TextDirectionSchema } from "./style";

// The metadata shape shared by ContentDocument and the DocumentTree tree root. Ported from documents.js's src/model/layout.ts (LayoutMetadataSchema), extracted into its own file back when a layout model lived in this package, so content.ts never depended on that model for it -- a content model depending on the layout model for its own metadata type was backwards. `producer` is a PDF-only concept (the tool that wrote the PDF); it has no OOXML/ODF equivalent and is simply absent -- never set -- when a ContentDocument or a purely-semantic reader (e.g. ooxml.js's own DocumentMetadata) populates this shape.
export const LayoutMetadataSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  subject: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  creator: z.string().optional(),
  producer: z.string().optional(),
  createdIso: z.string().optional(), // ISO-8601
  modifiedIso: z.string().optional(),
  lastPrintedIso: z.string().optional(), // ISO-8601 -- OOXML/legacy-binary SummaryInformation's own "last printed" timestamp; absent when the format carries no such fact at all, not merely when a document has never been printed
  language: z.string().optional(), // the document's own declared language: PDF's catalog /Lang, an IETF BCP 47 tag. One field, not a per-node fact -- a document that mixes languages states the exceptions per content, which is a producer-specific concern no shared shape here models.
  direction: TextDirectionSchema.optional(), // RTF's own \rtldoc/\ltrdoc scope -- the whole-document level of the four this format states direction at (see ContentRun.direction, ContentParagraph.direction, ContentTableRow.direction for the other three)
  publisher: z.string().optional(), // EPUB's dc:publisher; OOXML/legacy-binary's own "company" (below) is a distinct, producer-organisation concept, not this
  contributor: z.string().optional(), // EPUB's dc:contributor
  rights: z.string().optional(), // EPUB's dc:rights
  identifier: z.string().optional(), // EPUB's dc:identifier, e.g. an ISBN or UUID urn
  comments: z.string().optional(), // OOXML/legacy-binary SummaryInformation's own free-text "comments" property
  company: z.string().optional(), // OOXML/legacy-binary DocumentSummaryInformation's own "company" property -- the producing organisation, not a person
  manager: z.string().optional(), // OOXML/legacy-binary DocumentSummaryInformation's own "manager" property
});
export type LayoutMetadata = z.infer<typeof LayoutMetadataSchema>;
