import { ContentBlockSchema, ContentSectionSchema } from "document-schema.js";
import { DocumentMetadataSchema } from "../shared/metadata";
import { NumberingDefinitionSchema } from "./numbering";
import { z } from "zod";
// The Zod schemas of the docx reader, split from read.ts: comments, footnotes, header/footer parts, section references and the document wrapper. read.ts keeps the XML readers.
// Block-scoped fidelity constructs (structured document tags, complex and simple fields, bookmarks, tracked insertions/deletions/moves) are read into document-schema.js's constructStart/constructEnd marker pairs bracketing the blocks they span, and a construct covering a sub-sequence of one paragraph's runs is read onto that paragraph's own run-level constructs field (ContentParagraph.constructs): a mid-paragraph bookmark or comment extent (id-paired halves), a mid-paragraph complex or simple field (whose cached result still reaches the output as ordinary run text, exactly as before — only the field-ness used to be lost), an internal @w:anchor hyperlink, and a footnote/endnote/comment reference mark. A legacy w:ffData form field reads as a contentControl at whichever scope its field sits at, with the whole w:ffData element quarantined verbatim in the descriptor's residue. See typed/docx/constructs.ts for the descriptor shapes and the scope rules that decide which real-world occurrences are representable and which are not.

export const CommentSchema = z.object({
  id: z.string().optional(), // w:comment/@w:id — the key a comment extent's own name joins this body back through (see the run-level anchor extents)
  author: z.string().optional(),
  text: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const FootnoteSchema = z.object({
  id: z.string().optional(), // w:footnote/@w:id (or w:endnote/@w:id) — the key a note reference's own name joins this body back through
  type: z.string().optional(),
  text: z.string(),
});
export type Footnote = z.infer<typeof FootnoteSchema>;

// One header/footer part read as content rather than as concatenated text: the part's own body walked by the same block machinery as the document body (its own construct-marker bracket scope, its own relationships for images), plus the part's own path — the identity a section reference names.
export const HeaderFooterPartSchema = z.object({
  path: z.string(),
  kind: z.enum(["header", "footer"]),
  blocks: z.array(ContentBlockSchema),
});
export type HeaderFooterPart = z.infer<typeof HeaderFooterPartSchema>;

// The reference slots a w:sectPr spells: which header/footer part each of the default, first-page, and even-page slots uses, named by part path. Word's own inheritance rule — a section with no reference for a slot reuses the previous section's — is a consumer concern, recorded here exactly as spelled; the evenAndOddHeaders setting in word/settings.xml that gates whether Word renders the even slot at all is not read.
export const SectionHeaderFooterReferencesSchema = z.object({
  header: z
    .partialRecord(z.enum(["default", "first", "even"]), z.string())
    .optional(),
  footer: z
    .partialRecord(z.enum(["default", "first", "even"]), z.string())
    .optional(),
});
export type SectionHeaderFooterReferences = z.infer<
  typeof SectionHeaderFooterReferencesSchema
>;

export const DocxDocumentSchema = z.object({
  metadata: DocumentMetadataSchema,
  sections: z.array(ContentSectionSchema),
  comments: z.array(CommentSchema),
  footnotes: z.array(FootnoteSchema),
  endnotes: z.array(FootnoteSchema),
  // The structural view of the header/footer layer: each part as block flow (referenced or not), and per-section references (positional, one entry per `sections` entry) naming those parts by path.
  headerFooterParts: z.array(HeaderFooterPartSchema),
  sectionHeaderFooters: z.array(SectionHeaderFooterReferencesSchema),
  // word/numbering.xml's own abstractNum/num definitions, keyed by w:numId — see numbering.ts's own doc comment for why this sits as a separate top-level field rather than folded into ContentListMembership (the numId/level membership every list paragraph already carries via ContentParagraph.list, read unchanged by readListMembership below).
  numbering: z.record(z.string(), NumberingDefinitionSchema),
});
export type DocxDocument = z.infer<typeof DocxDocumentSchema>;
