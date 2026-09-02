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
}

export const FORMAT_CAPABILITIES: Readonly<
  Record<DocumentFormat, FormatCapability>
> = {
  docx: { format: "docx", variant: "wordprocessing", hasLayoutPath: true },
  odt: { format: "odt", variant: "wordprocessing", hasLayoutPath: true },
  pptx: { format: "pptx", variant: "presentation", hasLayoutPath: true },
  odp: { format: "odp", variant: "presentation", hasLayoutPath: true },
  ods: { format: "ods", variant: "spreadsheet", hasLayoutPath: true },
  // xlsx shares the spreadsheet ContentDocument variant with ods (readXlsxContent/buildXlsxPackage, both from ooxml.js) but has no layout-engine path of its own -- there is no convertSpreadsheetToLayout-equivalent xlsx entry point, only ods's. hasLayoutPath stays false: the composition engine routes xlsx <-> pdf through the ods bridge + ods's own layout engine rather than being a genuine ContentDocument -> LayoutDocument pipeline of xlsx's own.
  xlsx: { format: "xlsx", variant: "spreadsheet", hasLayoutPath: false },
  // csv shares the spreadsheet variant with xlsx/ods (readCsvContent/buildCsvText, src/csv/) and follows xlsx's routing exactly: plain text carries no layout of its own, so csv <-> pdf goes through the ods bridge + ods's layout engine. TSV is this same member with { delimiter: '\t' }, not a separate format -- see port.ts's own csv comment.
  csv: { format: "csv", variant: "spreadsheet", hasLayoutPath: false },
  odg: { format: "odg", variant: "drawing", hasLayoutPath: true },
  // svg shares the drawing ContentDocument variant with odg (readSvgContent/buildSvgText, src/svg/) and has a genuine layout-engine edge of its own: svgToPdf feeds the drawing ContentDocument it reads straight into the same convertDrawingToLayout engine odgToPdf already uses, so hasLayoutPath is true -- unlike csv's text-only entry, plain SVG text still describes real page geometry (a root viewBox is a page size), and the drawing layout engine renders it.
  svg: { format: "svg", variant: "drawing", hasLayoutPath: true },
  // odf reads into the 'formula' ContentDocument variant (readOdfFormulaContent), but hasLayoutPath stays false: odfToPdf renders its formula through writePdf's own separate formula positioning rather than a ContentDocument -> LayoutDocument layout engine, and there is no reverse pdf -> odf at all (see odfToPdf's own module comment in convert.ts).
  odf: { format: "odf", variant: "formula", hasLayoutPath: false },
  // markdown shares the wordprocessing variant with docx/odt (readMarkdownContent produces the identical WordprocessingContentDocument shape -- see convert.ts's own top-of-file comment) and has a genuine layout-engine edge of its own (markdownToPdf/pdfToMarkdown both reuse convertWordprocessingToLayout/reconstructWordprocessing unmodified), unlike xlsx above.
  markdown: {
    format: "markdown",
    variant: "wordprocessing",
    hasLayoutPath: true,
  },
  // epub shares the wordprocessing ContentDocument variant with docx/odt/markdown (readEpubContent/writeEpubContent, epub-codec) but, unlike markdown, has no layout engine of its own -- epub-codec has no LayoutDocument/layout-engine integration at all (no epubToLayout/layoutToEpub entry point exists, since epub-codec depends only on document-schema.js), so there is no ContentDocument -> LayoutDocument pipeline for it to plug into here. hasLayoutPath stays false, mirroring xlsx/csv exactly: the composition engine routes epub <-> pdf through a same-variant bridge to whichever wordprocessing-format sibling the pathfinder happens to reach first, plus that sibling's own layout engine -- never a genuine epub <-> LayoutDocument pipeline of epub's own. Traced against composition.ts's actual CONTENT_FORMATS order and buildCompositionGraph's Map-insertion-order tie-break (composition-plans.test.ts pins the resolved route): epub -> pdf resolves as [epub -> docx (bridge), docx -> pdf (toPdf)] -- docx is the wordprocessing member CONTENT_FORMATS lists first, so it is the first same-variant neighbour Dijkstra records a minimum-cost predecessor through, and every wordprocessing-variant toPdf edge costs the same (3), so the tie never gets re-broken in odt's or markdown's favour. One real consequence of epub's own hasLayoutPath:false stacking with xlsx's/csv's identical flag: xlsx<->epub and csv<->epub are the only (non-odf) pairs resolveCompositionPlan cannot route at all -- reaching pdf from xlsx/csv already costs a same-variant bridge to ods plus a toPdf hop (2 hops), and leaving pdf toward epub already costs a fromPdf hop plus a same-variant bridge to docx (2 hops), so either direction needs 4 hops total against the pathfinder's 3-hop cap (see local.test.ts's own dedicated test pinning this).
  epub: { format: "epub", variant: "wordprocessing", hasLayoutPath: false },
  pdf: { format: "pdf", hasLayoutPath: false },
};

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
