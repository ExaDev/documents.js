import { z } from 'zod';

// The metadata shape shared by ContentDocument and the DocumentPackage tree root. Ported from documents.js's src/model/layout.ts (LayoutMetadataSchema), extracted into its own file back when a layout model lived in this package, so content.ts never depended on that model for it -- a content model depending on the layout model for its own metadata type was backwards. `producer` is a PDF-only concept (the tool that wrote the PDF); it has no OOXML/ODF equivalent and is simply absent -- never set -- when a ContentDocument or a purely-semantic reader (e.g. ooxml.js's own DocumentMetadata) populates this shape.
export const LayoutMetadataSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  subject: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  creator: z.string().optional(),
  producer: z.string().optional(),
  createdIso: z.string().optional(), // ISO-8601
  modifiedIso: z.string().optional(),
  language: z.string().optional(), // the document's own declared language: PDF's catalog /Lang, an IETF BCP 47 tag. One field, not a per-node fact -- a document that mixes languages states the exceptions per content, which is a producer-specific concern no shared shape here models.
});
export type LayoutMetadata = z.infer<typeof LayoutMetadataSchema>;
