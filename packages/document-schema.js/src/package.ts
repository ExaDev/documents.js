import { z } from 'zod';
import { contentDocumentSharedFields, ContentFormulaSchema } from './content';
import { DefinitionsTableSchema, StylesTableSchema } from './definitions';
import { PageSizeSchema } from './geometry';
import { LayoutMetadataSchema } from './metadata';
import { DrawPageGroupSchema, SectionGroupSchema, SheetGroupSchema, SlideGroupSchema } from './package-node';

// DocumentPackage is the single hierarchical artefact: structure, layout, and content fused in one tree (ExaDev/document-schema.js#20). The root carries what no tree node can -- the document kind (moved up from the retired flat `content` field; the empty documents are legal, so the kind cannot be inferred from the children and the envelope keeps it explicit), the required metadata, the optional document-level symbolTable (the same shared fields every ContentDocument arm spreads -- one declaration, spliced in from src/content.ts), and the envelope's three optional tables and arrays: `pages` (each rendered page's own size, indexed to match every content node's own `frames[].pageIndex` -- present once a layout pass has run, absent for a content-only package), `styles` and `definitions` (the package-level definitions-table facility, src/definitions.ts). Everything structural hangs off `children`: one group per top-level container (a section, slide, sheet, or draw page), each holding its own content tree -- see src/package-node.ts for the node vocabulary and its structural discrimination rule.

// The package tree and the flat ContentDocument are one format in two encodings, related by three laws (stated on the issues and proven property-wise by document-outline.js's decompose/flatten over real corpus documents, with documents.js re-running the same assertions over its own corpus at the package boundary): (i) strict structural equality holds both directions for a table-free package -- decompose(flatten(pkg)) and flatten(decompose(pkg)) reproduce it exactly; (ii) effective-property equality holds universally -- once styles are resolved (resolve-then-compare, src/definitions.ts), a factored and an unfactored serialisation of one document compare equal; (iii) minting is idempotent -- factoring a second time mints the identical table. The codecs keep producing flat ContentDocuments (their natural reading shape); decomposition runs once at the package boundary in documents.js and flatten runs once where a builder consumes a package.

// This is a genuinely breaking shape change from the previous `{ formatVersion, content, pages }` envelope, which is why it rides a major (4.0.0). The old envelope's `formatVersion` field is gone with no replacement field: a serialised package states its version through the release-pinned $schema URI its dumper stamped (documentPackageWithSchema, src/schema-io.ts), and an ingesting documentFromJson dispatches on that URI -- the URI is the version, not a hand-kept integer. ContentDocument (the flat codec-exchange form) survives unchanged in role minus its own retired formatVersion literal, and nothing about the content model itself changed: every block, run, cell, and frame field a 3.x package carried still validates in its old flat shape -- only the envelope around it moved.

// The five arms duplicate their kind literals rather than factoring through a base schema, because z.discriminatedUnion() needs each member as a plain z.object carrying its own literal `kind` field in place (the same reason ContentDocumentSchema's own arms spread contentDocumentSharedFields); the children type is the one thing that differs per arm, and the union says exactly which root group each kind takes -- a wordprocessing package of section groups, a presentation of slide groups, a spreadsheet of sheet groups, a drawing of drawPage groups, and a formula package whose single child is the ContentFormula leaf itself (a formula has no container structure to group).
const packageEnvelopeFields = {
  metadata: LayoutMetadataSchema,
  ...contentDocumentSharedFields,
  pages: z.array(PageSizeSchema).optional(),
  styles: StylesTableSchema.optional(),
  definitions: DefinitionsTableSchema.optional(),
};

export const DocumentPackageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wordprocessing'),
    ...packageEnvelopeFields,
    children: z.array(SectionGroupSchema),
  }),
  z.object({
    kind: z.literal('presentation'),
    ...packageEnvelopeFields,
    children: z.array(SlideGroupSchema),
  }),
  z.object({
    kind: z.literal('spreadsheet'),
    ...packageEnvelopeFields,
    children: z.array(SheetGroupSchema),
  }),
  z.object({
    kind: z.literal('drawing'),
    ...packageEnvelopeFields,
    children: z.array(DrawPageGroupSchema),
  }),
  z.object({
    kind: z.literal('formula'),
    ...packageEnvelopeFields,
    children: z.array(ContentFormulaSchema),
  }),
]);
export type DocumentPackage = z.infer<typeof DocumentPackageSchema>;
