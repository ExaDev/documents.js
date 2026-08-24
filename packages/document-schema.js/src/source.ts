import { z } from "zod";

// Channel 2 of the two-channel fidelity model (ExaDev/document-schema.js#22, landed here by ExaDev/documents.js#718): the quarantined residue channel, beside channel 1's harmonised semantic construct vocabulary (src/construct.ts). A construct with no cross-format analogue degrades to the nearest semantic kind with its format-specific specifics here; a content node carrying producer data no semantic field expresses carries it here; a whole non-content package fact (an unmapped markdown frontmatter key, a PDF XMP packet) rides the package-level table (src/package.ts). This generalises the per-node practice that already existed: starMath beside canonical MathML on ContentFormula, styleId's opaque producer style names, sourcePath traceability -- same quarantine discipline (opaque, carried verbatim, never rendered), now stated once as one field with one shape everywhere a node can carry it.
//
// THE QUARANTINE CONTRACT, binding on this package and stated as the enforcement stance #718 asks for: residue is schema-validated as opaque text and NEVER semantically interpreted. Within this package that is structural, not aspirational -- no module reads, resolves, normalises, factors, or branches on a `source` value: decompose and flatten carry the node objects embedding it verbatim (the bijection laws extend to it unchanged), minting's key lists exclude it (factorStyles can no more factor residue than it can frames or sourcePath, and for the same reason -- the styles table's strict entry objects reject the key outright), and schema validation checks only that `xml` is text. Outside this package the contract is a usage rule: a SAME-FORMAT writer may re-emit its own residue verbatim -- that re-emission is the restorable-fidelity tier's whole mechanism, and re-serialising opaque text is not interpreting it -- but no consumer derives semantics from it (renders it, converts it into semantic nodes, or lets it change content behaviour), and a consumer of any other format must leave it alone, which is exactly what `format` exists to make decidable.

// Which format's dialect a residue value's xml is written in -- one member per reader that exists in this workspace today (ooxml.js's docx/pptx/xlsx, odf.js's odt/ods/odp/odg/odm/odb/odf, markdown-codec, pdf-codec), each named by a real reader rather than invented for symmetry, per the family's vocabulary discipline. The point of the field: a same-format writer can tell residue it may restore from residue it must not touch, without reading the xml. Closed on purpose -- a format this workspace gains a reader for adds a member, additively.
export const SourceFormatSchema = z.enum([
  "docx",
  "pptx",
  "xlsx",
  "odt",
  "ods",
  "odp",
  "odg",
  "odm",
  "odb",
  "odf",
  "markdown",
  "pdf",
]);
export type SourceFormat = z.infer<typeof SourceFormatSchema>;

// One quarantined residue value: `format` names the producing format (so restorability is decidable without reading the text), `xml` is that format's own serialisation of whatever has no cross-format meaning -- a WordprocessingML element, an ODF attribute spelling, a raw markdown HTML block, a PDF XMP packet. Strict on purpose: exactly two keys, so residue cannot accrete side channels, and the opacity claim stays honest -- this object carries text and a format name and nothing else.
export const SourceResidueSchema = z.strictObject({
  format: SourceFormatSchema,
  xml: z.string(), // opaque text -- schema validation stops at "is a string"; everything about the content is the producer's to know and a same-format restorer's to re-emit verbatim
});
export type SourceResidue = z.infer<typeof SourceResidueSchema>;
