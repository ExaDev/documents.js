import type { DocumentFormat } from "./port";

// This module models the real ContentDocument-variant compatibility this family already has (wordprocessing = {docx, odt, markdown}, presentation = {pptx, odp}, spreadsheet = {xlsx, ods, csv}, drawing = {odg, svg}) plus which nodes have a direct layout-engine path to/from LayoutDocument (FORMAT_CAPABILITIES below). The composition engine (src/convert/composition.ts) consumes FORMAT_CAPABILITIES' variant declarations to build its composition graph, and UnsupportedConversionError is thrown by convertDocument/local.ts for any pair the pathfinder cannot route. The former DIRECT_EDGES list and resolveConversionPath resolver have been superseded by the pathfinder (resolveCompositionPlan in composition.ts), which derives every resolvable pair from the same registry data.

// All five of document-schema.js's own ContentDocument kinds. 'formula' is a genuine member rather than a forward-looking one: readOdfFormulaContent produces a real `{kind:'formula', ...}` ContentDocument and odfToPdf consumes one, so `odf` below models it. Unlike the other four, it is a variant of exactly ONE format -- there is no second 'formula'-variant format to bridge it to, which is why a shared variant does not by itself imply a bridge edge exists.
export type ContentVariant =
  "wordprocessing" | "presentation" | "spreadsheet" | "drawing" | "formula";

export interface FormatCapability {
  readonly format: DocumentFormat;
  // The ContentDocument variant this format reads into / builds from, when it participates in that shared pivot at all. Only `pdf` leaves this undefined: it is the LayoutDocument pivot itself, not a ContentDocument variant at all.
  readonly variant?: ContentVariant;
  // Whether a direct layout-engine conversion (a real ContentDocument -> LayoutDocument -> PDF pipeline, or its reverse) already exists for this format today. `odf` is a one-way exception -- formula -> PDF only, with no reverse and no genuine round-trip layout pivot (see odfToPdf's own module comment on why pdf -> odf is not attempted) -- so it is modelled as false here even though its own one-way edge is still present as a special case in local.ts.
  readonly hasLayoutPath: boolean;
  // Whether this format can only be READ. A read-only format is a legitimate conversion SOURCE and can never be a target: its codec ships a reader and no writer, so there is nothing to build its bytes from. Stated per format rather than inferred, and required on every entry so a new format has to answer it -- the composition engine, buildDocumentBytes, and setDocumentMetadata each enforce the same answer at their own boundary, and READ_ONLY_FORMATS below is the one derivation they share.
  readonly readOnly: boolean;
}

export const FORMAT_CAPABILITIES: Readonly<
  Record<DocumentFormat, FormatCapability>
> = {
  docx: {
    format: "docx",
    variant: "wordprocessing",
    hasLayoutPath: true,
    readOnly: false,
  },
  odt: {
    format: "odt",
    variant: "wordprocessing",
    hasLayoutPath: true,
    readOnly: false,
  },
  pptx: {
    format: "pptx",
    variant: "presentation",
    hasLayoutPath: true,
    readOnly: false,
  },
  odp: {
    format: "odp",
    variant: "presentation",
    hasLayoutPath: true,
    readOnly: false,
  },
  ods: {
    format: "ods",
    variant: "spreadsheet",
    hasLayoutPath: true,
    readOnly: false,
  },
  // xlsx shares the spreadsheet ContentDocument variant with ods (readXlsxContent/buildXlsxPackage, both from ooxml.js) but has no layout-engine path of its own -- there is no convertSpreadsheetToLayout-equivalent xlsx entry point, only ods's. hasLayoutPath stays false: the composition engine routes xlsx <-> pdf through the ods bridge + ods's own layout engine rather than being a genuine ContentDocument -> LayoutDocument pipeline of xlsx's own.
  xlsx: {
    format: "xlsx",
    variant: "spreadsheet",
    hasLayoutPath: false,
    readOnly: false,
  },
  // csv shares the spreadsheet variant with xlsx/ods (readCsvContent/buildCsvText, src/csv/) and follows xlsx's routing exactly: plain text carries no layout of its own, so csv <-> pdf goes through the ods bridge + ods's layout engine. TSV is this same member with { delimiter: '\t' }, not a separate format -- see port.ts's own csv comment.
  csv: {
    format: "csv",
    variant: "spreadsheet",
    hasLayoutPath: false,
    readOnly: false,
  },
  odg: {
    format: "odg",
    variant: "drawing",
    hasLayoutPath: true,
    readOnly: false,
  },
  // svg shares the drawing ContentDocument variant with odg (readSvgContent/buildSvgText, src/svg/) and has a genuine layout-engine edge of its own: svgToPdf feeds the drawing ContentDocument it reads straight into the same convertDrawingToLayout engine odgToPdf already uses, so hasLayoutPath is true -- unlike csv's text-only entry, plain SVG text still describes real page geometry (a root viewBox is a page size), and the drawing layout engine renders it.
  svg: {
    format: "svg",
    variant: "drawing",
    hasLayoutPath: true,
    readOnly: false,
  },
  // odf reads into the 'formula' ContentDocument variant (readOdfFormulaContent), but hasLayoutPath stays false: odfToPdf renders its formula through writePdf's own separate formula positioning rather than a ContentDocument -> LayoutDocument layout engine, and there is no reverse pdf -> odf at all (see odfToPdf's own module comment in convert.ts).
  odf: {
    format: "odf",
    variant: "formula",
    hasLayoutPath: false,
    readOnly: true,
  },
  // markdown shares the wordprocessing variant with docx/odt (readMarkdownContent produces the identical WordprocessingContentDocument shape -- see convert.ts's own top-of-file comment) and has a genuine layout-engine edge of its own (markdownToPdf/pdfToMarkdown both reuse convertWordprocessingToLayout/reconstructWordprocessing unmodified), unlike xlsx above.
  markdown: {
    format: "markdown",
    variant: "wordprocessing",
    hasLayoutPath: true,
    readOnly: false,
  },
  // rtf shares the wordprocessing variant with docx/odt/markdown (readRtfContent/writeRtfContent, rtf-codec) but follows csv/xlsx's routing exactly rather than markdown's: rtf-codec has no layout engine of its own -- no convertWordprocessingToLayout-equivalent rtf entry point -- so hasLayoutPath stays false and the composition engine routes rtf <-> pdf through a same-variant bridge to docx/odt/markdown plus that format's own layout engine, never a direct rtf -> LayoutDocument pipeline.
  rtf: {
    format: "rtf",
    variant: "wordprocessing",
    hasLayoutPath: false,
    readOnly: false,
  },
  // wpd shares the wordprocessing variant with docx/odt/markdown/rtf (wpd-codec's readWpdContent), and is the first read-only member: wpd-codec ships a reader and no writer, deliberately -- see that package's own Scope. hasLayoutPath is true for markdown's reason rather than rtf's: what it reads is a wordprocessing ContentDocument convertWordprocessingToLayout renders unmodified, and with no reverse direction to keep symmetrical there is nothing to weigh that against, so wpd -> pdf is a direct layout pass rather than a build-and-re-read through a docx bridge.
  wpd: {
    format: "wpd",
    variant: "wordprocessing",
    hasLayoutPath: true,
    readOnly: true,
  },
  pdf: { format: "pdf", hasLayoutPath: false, readOnly: false },
};

// Every format that can only be read, derived from the capabilities above rather than restated. This is what buildDocumentBytes and setDocumentMetadata check to refuse a read-only TARGET with a reason instead of an internal-invariant message: a format with no writer is a caller error to name as a target, not a registry gap. The composition engine enforces the same fact structurally instead (nothing points at a read-only node in its graph), so it consults this set for nothing -- one fact, two enforcement points that cannot disagree, because both are downstream of the same declaration.
export const READ_ONLY_FORMATS: ReadonlySet<DocumentFormat> = new Set(
  Object.values(FORMAT_CAPABILITIES)
    .filter((capability) => capability.readOnly)
    .map((capability) => capability.format),
);

// Thrown when a requested (source, target) pair has no route in the composition graph (resolveCompositionPlan returned undefined) -- convertDocument and the local DocumentConverter (local.ts) reject rather than silently routing through a path the engine cannot resolve. A named class matching this package's own OdmUnresolvedSectionError/HsqldbSqlUnsupportedError convention for "recognised but unsupported", so a caller can branch on it rather than string-matching a message.
export class UnsupportedConversionError extends Error {
  readonly source: DocumentFormat;
  readonly target: DocumentFormat;

  constructor(source: DocumentFormat, target: DocumentFormat) {
    super(`unsupported conversion: ${source} -> ${target}`);
    this.name = "UnsupportedConversionError";
    this.source = source;
    this.target = target;
  }
}
