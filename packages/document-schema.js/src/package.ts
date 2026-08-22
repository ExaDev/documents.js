import { z } from 'zod';
import { contentDocumentSharedFields, ContentFormulaSchema } from './content';
import { DefinitionsTableSchema, StylesTableSchema } from './definitions';
import { PageSizeSchema } from './geometry';
import { LayoutMetadataSchema } from './metadata';
import { DrawPageGroupSchema, SectionGroupSchema, SheetGroupSchema, SlideGroupSchema } from './package-node';
import { SourceResidueSchema } from './source';

// DocumentTree is the single hierarchical artefact: structure, layout, and content fused in one tree (ExaDev/document-schema.js#20). The root carries what no tree node can -- the document kind (moved up from the retired flat `content` field; the empty documents are legal, so the kind cannot be inferred from the children and the envelope keeps it explicit), the required metadata, the optional document-level symbolTable (the same shared fields every ContentDocument arm spreads -- one declaration, spliced in from src/content.ts), and the envelope's optional tables and arrays: `pages` (each rendered page's own size, indexed to match every content node's own `frames[].pageIndex` -- present once a layout pass has run, absent for a content-only package), the package-level table facility of src/definitions.ts -- `styles`, `definitions`, and the three construct tables `layers`/`attachments`/`destinations` added in 4.1.0 -- and the keyed `source` residue table (src/source.ts, ExaDev/documents.js#718): the package-level half of the quarantined residue channel, for whole-package facts no content node owns. Everything structural hangs off `children`: one group per top-level container (a section, slide, sheet, or draw page), each holding its own content tree -- see src/package-node.ts for the node vocabulary and its structural discrimination rule.

// The package tree and the flat ContentDocument are one format in two encodings, related by three laws (stated on the issues, proven property-wise by document-outline.js's decompose/flatten over real corpus documents, run here over the whole schema vocabulary in src/bijection.test.ts, and re-run by documents.js over its own real-format corpus): (i) strict structural equality holds both directions for a table-free package -- decompose(flatten(pkg)) and flatten(decompose(pkg)) reproduce it exactly; (ii) effective-property equality holds universally -- once styles are resolved (resolve-then-compare, src/definitions.ts), a factored and an unfactored serialisation of one document compare equal; (iii) minting is idempotent -- factoring a second time mints the identical table. The codecs keep producing flat ContentDocuments (their natural reading shape); decomposition runs once where a package is assembled and flatten runs once where a builder consumes one. Both directions live in this package (src/decompose.ts, src/flatten.ts, src/factor-styles.ts) so that every codec can reach them without depending on a package that depends on it.

// This is a genuinely breaking shape change from the previous `{ formatVersion, content, pages }` envelope, which is why it rides a major (4.0.0). The old envelope's `formatVersion` field is gone with no replacement field: a serialised package states its version through the release-pinned $schema URI its dumper stamped (documentTreeWithSchema, src/schema-io.ts), and an ingesting documentFromJson dispatches on that URI -- the URI is the version, not a hand-kept integer. ContentDocument (the flat codec-exchange form) survives unchanged in role minus its own retired formatVersion literal, and nothing about the content model itself changed: every block, run, cell, and frame field a 3.x package carried still validates in its old flat shape -- only the envelope around it moved.

// The five arms duplicate their kind literals rather than factoring through a base schema, because z.discriminatedUnion() needs each member as a plain z.object carrying its own literal `kind` field in place (the same reason ContentDocumentSchema's own arms spread contentDocumentSharedFields); the children type is the one thing that differs per arm, and the union says exactly which root group each kind takes -- a wordprocessing package of section groups, a presentation of slide groups, a spreadsheet of sheet groups, a drawing of drawPage groups, and a formula package whose single child is the ContentFormula leaf itself (a formula has no container structure to group).
// The three package-level tables the pdf inventory proposed (ExaDev/pdf-codec#66, landed by ExaDev/document-schema.js#24) are additive optional root fields typed as the SAME generic definitions table the `definitions` field already uses -- kind-tagged loose entries, no new entry shape minted anywhere. Separate root fields rather than three more tenants of `definitions` for the reason `styles` is its own field despite being the facility's first tenant: each table is its own key namespace, so a layer and a destination may share a name without colliding, and a consumer reaches the table it wants without filtering. The `kind` discriminator still earns its keep inside each of them, because each table holds more than one tenant: a layers table carries optional-content group definitions alongside their configuration and radio-button-group entries, and a destinations table carries named destinations alongside the outline/navigation entries the same PDF names-tree walk produces -- ExaDev/document-schema.js#24 names that table "navigation/destinations" for exactly that reason. Per-tenant entry fields stay the tenant's own, never this package's, exactly as src/definitions.ts states.
const packageEnvelopeFields = {
  metadata: LayoutMetadataSchema,
  ...contentDocumentSharedFields,
  pages: z.array(PageSizeSchema).optional(),
  styles: StylesTableSchema.optional(),
  definitions: DefinitionsTableSchema.optional(),
  layers: DefinitionsTableSchema.optional(), // optional-content / layer definitions: PDF `/OCProperties` groups and their configuration, ODF Draw's layer model. Definitions only -- which content belongs to which layer is a membership fact the producing codec carries on its own item model (pdf-codec owns that model since 4.0.0), and no inventory asks for a layer ref on a content-tree node.
  attachments: DefinitionsTableSchema.optional(), // package attachments: PDF `/Names /EmbeddedFiles`, `/FileAttachment`, `/EF`, `/AF`, and the docx/ODF package attachments that make the facility cross-format rather than PDF-specific.
  destinations: DefinitionsTableSchema.optional(), // named destinations and the navigation tree that resolves against them: PDF `/Dests`, the `/Names` name tree, and `/Outlines`. This is the other end of a `link` construct's internal target (src/construct.ts) -- an internal target names either an `anchor` construct or an entry here.
  source: z.record(z.string(), SourceResidueSchema).optional(), // the package-level half of the quarantined residue channel (src/source.ts): whole-package facts no content node owns -- an unmapped markdown frontmatter key, a PDF XMP packet, a docx custom XML store. Keyed by the producer's own identifier for what each entry reconstructs (a part path, a named store, 'frontmatter'), opaque to this package exactly as a definitions-table id is. Its own root field rather than a `definitions` tenant for the same reason `styles` is: separate key namespaces, and a consumer reaches residue without filtering kind-tagged entries. Like the other tables it is tree-only -- the flat ContentDocument is the codec-exchange CONTENT shape and carries per-node residue on its nodes, while package-level residue rides the assembled tree (factorStyles re-carries it, src/factor-styles.ts).
};

export const DocumentTreeSchema = z.discriminatedUnion('kind', [
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
    // Exactly one: decompose emits a single ContentFormula and flatten requires exactly one (document-outline.js's phase-1 reference throws on any other count), so the schema states the cardinality the bijection needs rather than admitting trees that cannot round-trip.
    children: z.array(ContentFormulaSchema).length(1),
  }),
]);
export type DocumentTree = z.infer<typeof DocumentTreeSchema>;
