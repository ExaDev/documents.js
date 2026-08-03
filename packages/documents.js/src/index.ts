// documents.js's public surface: bidirectional docx/pptx/odt/odp/ods/odg <-> PDF conversion, a read+write live-view editor for docx/pptx/odt/odp/ods/odg, and a hand-written PDF codec, built on ooxml.js's lossless OOXML core and odf.js's lossless ODF core.

// --- ooxml.js's lossless OOXML core, re-exported so consumers need only this one dependency. Its own typed readers (readDocx/readPptx/readXlsx) and their result types are deliberately NOT re-exported here: readDocxContent/readPptxContent (below) already wrap readDocx/readPptx into ContentDocument, so exposing both the wrapper and the thing it wraps would be a trap -- two overlapping entry points to the same underlying read, one of which (readDocx/readPptx's own comments/footnotes/headers/footers) carries fields ContentDocument doesn't model at all. ---
export {
  type Attribute,
  AttributeSchema,
  type BinaryPart,
  BinaryPartSchema,
  type Comment,
  CommentSchema,
  type CompactAttrPairs,
  type CompactPackage,
  CompactPackageSchema,
  type CompactPart,
  CompactPartSchema,
  type CompactXmlNode,
  CompactXmlNodeSchema,
  type DefinedName,
  DefinedNameSchema,
  type Package,
  PackageSchema,
  type Part,
  PartSchema,
  type Relationship,
  type XmlCdata,
  XmlCdataSchema,
  type XmlComment,
  XmlCommentSchema,
  type XmlDeclaration,
  XmlDeclarationSchema,
  type XmlElement,
  XmlElementSchema,
  type XmlNode,
  XmlNodeSchema,
  type XmlPart,
  XmlPartSchema,
  type XmlPi,
  XmlPiSchema,
  type XmlText,
  XmlTextSchema,
  attr,
  base64ToBytes,
  buildXml,
  bytesToBase64,
  childrenWithTag,
  compactCodec,
  compactPackageCodec,
  decodeCompactPackage,
  decodeEntities,
  decodePackage,
  elementsWithTag,
  encodeCompactPackage,
  encodePackage,
  fromCompact,
  isCompactXmlNode,
  isXmlNode,
  packageCodec,
  parsePackage,
  parseXml,
  resolveRelationships,
  rootElement,
  serializePackage,
  textContent,
  toCompact,
  unzipPackage,
  walk,
  xmlCodec,
  zipPackage,
} from 'ooxml.js';

// --- The semantic content model: one read+write-capable model for both docx and pptx, instead of ooxml.js's two one-way, lossy, format-specific typed readers. The full vocabulary (ContentDocument, ContentBlock, and everything beneath them) is sourced from document-schema.js, the sibling schema package shared with ooxml.js and odf.js -- this package defines no schema of its own here, only consumes and re-exports document-schema.js's. ---
export type {
  ContentBlock,
  ContentCellValue,
  ContentDocument,
  ContentDrawPage,
  ContentImageBlock,
  ContentListMembership,
  ContentPageBreak,
  ContentParagraph,
  ContentPathPoint,
  ContentPathSegment,
  ContentRun,
  ContentSection,
  ContentShape,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetImage,
  ContentSheetPrintRange,
  ContentSheetPrintSettings,
  ContentSheetRepeatRange,
  ContentSheetRow,
  ContentSlide,
  ContentStroke,
  ContentSubpath,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
  ContentVector,
} from 'document-schema.js';
export {
  CONTENT_FORMAT_VERSION,
  ContentBlockSchema,
  ContentCellValueSchema,
  ContentDocumentSchema,
  ContentDrawPageSchema,
  ContentImageBlockSchema,
  ContentPageBreakSchema,
  ContentParagraphSchema,
  ContentPathPointSchema,
  ContentPathSegmentSchema,
  ContentRunSchema,
  ContentSectionSchema,
  ContentShapeSchema,
  ContentSheetCellSchema,
  ContentSheetColumnSchema,
  ContentSheetPrintRangeSchema,
  ContentSheetPrintSettingsSchema,
  ContentSheetRepeatRangeSchema,
  ContentSheetRowSchema,
  ContentSheetSchema,
  ContentSlideSchema,
  ContentStrokeSchema,
  ContentSubpathSchema,
  ContentTableCellSchema,
  ContentTableRowSchema,
  ContentTableSchema,
  ContentVectorSchema,
  isContentBlock,
} from 'document-schema.js';

// --- The PDF-side pivot model, also sourced from document-schema.js. ---
export type { LayoutDocument, LayoutEllipse, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLine, LayoutLink, LayoutMetadata, LayoutPage, LayoutPath, LayoutPathSegment, LayoutRect, LayoutSubpath, LayoutText } from 'document-schema.js';
export { LAYOUT_FORMAT_VERSION } from 'document-schema.js';

// --- document-schema.js's own DocumentPackage type/schema (the envelope pairing a ContentDocument with a LayoutDocument) and its self-describing-JSON helpers. contentDocumentWithSchema / documentSchemaKindOf / documentFromJson's ContentDocument branch / ContentDocumentJson all operate on the identical ContentDocument type exported above. ---
export type {
  ContentDocumentJson,
  DocumentJsonResult,
  DocumentPackage,
  DocumentPackageJson,
  DocumentSchemaKind,
  LayoutDocumentJson,
} from 'document-schema.js';
export {
  contentDocumentWithSchema,
  documentFromJson,
  documentPackageWithSchema,
  DocumentPackageSchema,
  documentSchemaKindOf,
  layoutDocumentWithSchema,
  LayoutDocumentSchema,
  schemaUriFor,
  UnrecognizedDocumentSchemaError,
} from 'document-schema.js';

// --- Shared model primitives used by both pivot models. ---
export type { Box, Margins, PageSize } from './model/geometry';
export { flipY, PAGE_SIZE_A4, PAGE_SIZE_LETTER, SLIDE_SIZE_STANDARD, SLIDE_SIZE_WIDESCREEN } from './model/geometry';
export type { LayoutColor } from './model/color';
export { COLOR_BLACK, rgbHexToColor } from './model/color';
export type { Alignment, LayoutFont } from './model/style';
export { DEFAULT_LAYOUT_FONT } from './model/style';
// Magic-byte-validated Uint8Array schemas, so a caller passing the wrong format -- to these functions directly, or as the input/output schema half of a z.codec() below -- gets a clear Zod validation error instead of a confusing failure three layers down. The Odt/Ods/Odp/Odg schemas check the package's actual declared media type (see src/model/bytes.ts), a stronger check than Docx/PptxBytesSchema's generic ZIP-signature check. MarkdownBytesSchema is architecturally different from every other schema here -- it checks only well-formed UTF-8, since markdown has no magic bytes or format-level header of its own to check (see src/model/bytes.ts's own comment).
export { DocxBytesSchema, MarkdownBytesSchema, OdgBytesSchema, OdpBytesSchema, OdsBytesSchema, OdtBytesSchema, PdfBytesSchema, PptxBytesSchema, XlsxBytesSchema } from './model/bytes';

// --- The live-view read+write editors: a real manipulation API for docx/pptx content, since ooxml.js's own typed readers explicitly forbid write-back. ---
export type { DocxBody } from './edit/docx/editor';
export { createDocx, DocxEditor, openDocx } from './edit/docx/editor';
export { DocxParagraph } from './edit/docx/paragraph';
export { DocxRun } from './edit/docx/run';
export type { DocxVerticalMerge } from './edit/docx/table';
export { DocxTable, DocxTableCell, DocxTableRow } from './edit/docx/table';
export type { BuildDocxPackageOptions } from './edit/docx/content';
export { buildDocxPackage } from './edit/docx/content';

export type { SlideImageInit, SlideTableInit, TextBoxInit } from './edit/pptx/slide';
export { createPptx, openPptx, PptxEditor } from './edit/pptx/editor';
export { PptxSlide } from './edit/pptx/slide';
export type { DrawingParagraphInit, DrawingRunInit } from './edit/pptx/shape';
export { PptxShape } from './edit/pptx/shape';
export type { PptxTableInit } from './edit/pptx/table';
export { PptxTable, PptxTableCell, PptxTableRow } from './edit/pptx/table';
export { buildPptxPackage } from './edit/pptx/content';

export type { OdtBody } from './edit/odt/editor';
export { createOdt, OdtEditor, openOdt } from './edit/odt/editor';
export type { ParagraphInit as OdtParagraphInit } from './edit/odt/paragraph';
export { OdtParagraph } from './edit/odt/paragraph';
export type { RunInit as OdtRunInit } from './edit/odt/run';
export { OdtRun } from './edit/odt/run';
export { OdtList, OdtListItem } from './edit/odt/list';
export type { TableInit as OdtTableInit } from './edit/odt/table';
export { OdtTable, OdtTableCell, OdtTableRow } from './edit/odt/table';
export { buildOdtPackage } from './edit/odt/content';

export type { SlideImageInit as OdpSlideImageInit, SlideTableInit as OdpSlideTableInit, TextBoxInit as OdpTextBoxInit } from './edit/odp/slide';
export { createOdp, OdpEditor, openOdp } from './edit/odp/editor';
export { OdpSlide } from './edit/odp/slide';
export { OdpShape } from './edit/odp/shape';
export { buildOdpPackage } from './edit/odp/content';

export { createOds, OdsEditor, openOds } from './edit/ods/editor';
export { OdsSheet } from './edit/ods/sheet';
export { OdsCell } from './edit/ods/cell';
export { buildOdsPackage } from './edit/ods/content';

export type { PageImageInit as OdgPageImageInit, TextBoxInit as OdgTextBoxInit } from './edit/odg/page';
export { createOdg, OdgEditor, openOdg } from './edit/odg/editor';
export { OdgPage } from './edit/odg/page';
// draw:frame content (text boxes/images) reuses OdpShape wholesale -- see edit/odg/page.ts's own top-of-file note; there is no separate OdgShape class.
export type { BoxVectorInit as OdgBoxVectorInit, LineVectorInit as OdgLineVectorInit, PathVectorInit as OdgPathVectorInit } from './edit/odg/vector';
export { OdgBoxVector, OdgLineVector, OdgPathVector } from './edit/odg/vector';
export { buildOdgPackage } from './edit/odg/content';

// --- The hand-written PDF codec, now an external dependency -- see pdf-codec's own README (https://github.com/ExaDev/pdf-codec) for its internals. ---
export type { ReadPdfOptions } from 'pdf-codec';
export { readPdf } from 'pdf-codec';
export type { WritePdfOptions } from 'pdf-codec';
export { writePdf } from 'pdf-codec';
export type { PdfDiagnostic, PdfDiagnosticSeverity, PdfDiagnosticSink } from 'pdf-codec';
export { NOOP_DIAGNOSTIC_SINK, PdfEncryptedError, PdfParseError } from 'pdf-codec';
export type { WinAnsiSubstitution } from 'pdf-codec';
// A schema-validated z.codec() pair over readPdf/writePdf (PDF bytes <-> LayoutDocument), mirroring ooxml.js's own packageCodec -- the no-extra-options form; use readPdf/writePdf directly for cancellation, diagnostics, a custom clock, or WinAnsi-substitution reporting.
export { pdfCodec } from 'pdf-codec';
// The embedded math font (STIX Two Math, OFL-1.1 -- see pdf-codec's own README), parsed once and cached: loadMathFont().font exposes glyphId/glyphSpaceWidth/cffBytes/descriptor directly, and .metricsAt(sizePt) is the MathFontMetrics factory src/mathml's own layoutFormula consumes. Exported for a caller that wants to lay out a formula (via layoutFormula below) without going through odfToPdf's own fixed pipeline.
export type { LoadedMathFont, MathFont, MathFontDescriptorMetrics } from 'pdf-codec';
export { loadMathFont } from 'pdf-codec';

// --- MathML presentation-layer typesetting: a pure box-model layout engine (no PDF or ODF knowledge of its own -- see src/mathml/'s own module comments), consuming odf.js's readOdfFormula's own raw MathML tree via a locally-defined, structurally-compatible node type. odfToPdf (below) and the odt/odp embedded-formula layout paths (src/layout/engine.ts, src/layout/slides.ts) are its two real callers; exported directly too, for a caller that wants to lay out a formula (e.g. onto a custom page layout) without going through either. ---
export type { LayoutFormulaOptions } from './mathml/layout';
export { layoutFormula } from './mathml/layout';
export type { MathBox, MathColor, MathDiagnostic, MathDiagnosticKind, MathGlyphRun, MathLayoutItem, MathLayoutResult, MathRule, MathStroke } from './mathml/layout-types';
export type { MathFontMetrics, MathGlyphMetrics } from './mathml/metrics';
export type { MathMlAttribute, MathMlElement, MathMlNode, MathMlText } from './mathml/nodes';
export { elementChildren, elementLocalName, firstChildByLocalName, isMathMlElement, localName, textContent as mathMlTextContent } from './mathml/nodes';
export type { OperatorProperties } from './mathml/operators';
export { operatorProperties } from './mathml/operators';
export type { MathVariant } from './mathml/variant';
export { applyMathVariant, isMathVariant, mapMathVariant } from './mathml/variant';

// --- MathML -> OMML (ECMA-376 Part 1's own Office Math Markup Language) structural translation: the WRITE-side counterpart to layoutFormula above, covering the identical construct set so a formula rendered to PDF and the same formula written into a docx degrade in exactly the same places. buildDocxPackage is its real caller (an embedded formula becomes genuine, editable Word math rather than a plain-text stand-in); exported directly for a caller assembling OOXML math itself, e.g. into a docx opened through openDocx. ---
export type { OmmlDiagnostic, OmmlDiagnosticKind, OmmlWriteResult } from './omml/write';
export { buildOfficeMath, buildOfficeMathParagraph } from './omml/write';

// --- Format <-> ContentDocument readers and layout algorithms, each independently usable rather than only reachable through the ergonomic conversions below. ---
export { readDocxContent } from './ooxml/docx/read';
export { readPptxContent } from './ooxml/pptx/read';
export { readOdtContent } from './odf/odt/read';
export { readOdpContent } from './odf/odp/read';
export { readOdsContent } from './odf/ods/read';
export { readOdgContent } from './odf/odg/read';
export { readOdfEmbeddedFormula, readOdfFormulaContent } from './odf/formula/read';
// markdown <-> ContentDocument -- readMarkdownContent/buildMarkdownText are thin adapters over markdown-codec's own readMarkdown/writeMarkdown (see src/markdown/read.ts's own module comment), never re-exported here directly for the same reason readDocx/readPptx aren't (see this section's own top-of-file note): markdown-codec's own readMarkdown/writeMarkdown operate on document-schema.js's ContentDocument shape directly, a nominally different type from this package's own local ContentDocument above, so exposing both would invite a caller to reach for the wrong one. decodeMarkdownText/encodeMarkdownText are the byte<->text boundary markdown-codec itself has no opinion on (it operates on strings, not bytes) -- exported for a caller composing readMarkdownContent/buildMarkdownText directly, matching every other independently-exported pipeline stage in this section.
export { decodeMarkdownText, encodeMarkdownText } from './markdown/text';
export { readMarkdownContent } from './markdown/read';
export { buildMarkdownText } from './markdown/write';
// A formula travels inside a ContentDocument now (document-schema.js's own 'formula' variant), not alongside one -- these are the small helpers for building and reading that shape: the 'formula'-kind envelope, the embedded-object block an odt/odp reader produces for an inline formula, the narrowing back out of such a block, and the plain-text stand-in for a consumer with no MathML rendering of its own.
export { buildFormulaBlock, formulaDocument, formulaOfBlock, formulaPlaceholderText } from './model/formula';
// The drawing counterpart to the formula helpers above: reconstructWordprocessing/reconstructPresentation carry a page's recovered vector primitives in an embedded-object block, since neither ContentSection nor ContentSlide has a vectors array of its own. buildDrawingBlock is what builds one; drawingOfBlock narrows back out of it, and is what a consumer distinguishing a recovered drawing from a recovered formula calls.
export { buildDrawingBlock, drawingOfBlock } from './model/embedded-drawing';
export type { PositionedFormula } from 'pdf-codec';
export type { EngineLayoutOptions, WordprocessingLayoutResult } from './layout/engine';
export { convertWordprocessingToLayout } from './layout/engine';
export type { PresentationLayoutResult, SlidesLayoutOptions } from './layout/slides';
export { convertPresentationToLayout } from './layout/slides';
export type { SheetsLayoutOptions } from './layout/sheets';
export { convertSpreadsheetToLayout } from './layout/sheets';
export type { DrawingLayoutOptions } from './layout/drawing';
export { convertDrawingToLayout } from './layout/drawing';
export type { ReconstructOptions } from './layout/reconstruct';
export { reconstructDrawing, reconstructPresentation, reconstructSpreadsheet, reconstructWordprocessing } from './layout/reconstruct';
// The heuristic re-typing reconstructSpreadsheet applies to every recovered cell, exported standalone so a caller can run it over their own text, replay the same decision, or interpret what the ReconstructOptions.onCellTypeInference sink reports. Read cell-typing.ts's own module doc before relying on a re-typed value: this is explicitly probabilistic recovery from a rendered string, not a fidelity guarantee.
export type { CellTypeDeclineReason, CellTypeInference, CellTypeInferenceResult, CellTypeInferenceSink, CellTypeRule } from './layout/cell-typing';
export { inferCellValue } from './layout/cell-typing';
// Gridline-lattice detection: the shared gate reconstructSpreadsheet uses for cell boundaries and reconstructWordprocessing/reconstructPresentation use as the ONLY evidence permitted to synthesize a table. Exported so a caller can ask the same question of a LayoutDocument directly.
export type { GridLattice } from './layout/lattice';
export { detectGridLattice } from './layout/lattice';

// --- Fourteen ergonomic conversions (docx/pptx/odt/odp/ods/odg/xlsx/markdown <-> PDF, all round-trip both ways). xlsx<->pdf (xlsxToPdf/pdfToXlsx) composes the ods<->xlsx bridge with the ods<->pdf layout pair internally -- xlsx has no layout engine of its own -- but is a real, direct, single-call conversion pair from a caller's own point of view, matching the other thirteen's own options shape exactly. markdown<->pdf (markdownToPdf/pdfToMarkdown) DOES lay markdown out directly, reusing convertWordprocessingToLayout/reconstructWordprocessing completely unmodified -- but pdfToMarkdown is the single lossiest conversion in the whole package (see convert.ts's own top-of-file comment and the README's Fidelity section). ---
export type { DocumentToPdfOptions, PdfToDocumentOptions } from './convert/convert';
export { docxToPdf, markdownToPdf, odgToPdf, odpToPdf, odsToPdf, odtToPdf, pdfToDocx, pdfToMarkdown, pdfToOdg, pdfToOdp, pdfToOds, pdfToOdt, pdfToPptx, pdfToXlsx, pptxToPdf, xlsxToPdf } from './convert/convert';

// --- odf (a standalone ODF formula document) -> PDF: not one of the thirteen round-trip conversions above (there is no pdfToOdf -- see convert.ts's own module comment on odfToPdf for why: recovering structured MathML from rendered glyphs is a categorically different, OCR-adjacent problem, not a geometry-reconstruction one). Renders via src/mathml's layoutFormula and the embedded STIX Two Math font, the same pipeline the odt/odp embedded-formula paths use. ---
export { odfToPdf } from './convert/convert';

// Schema-validated z.codec() pairs over the conversions above (docx/pptx/odt/odp/ods/odg/xlsx/markdown bytes <-> PDF bytes), the no-extra-options form -- use docxToPdf/pdfToDocx/pptxToPdf/pdfToPptx/odtToPdf/pdfToOdt/odpToPdf/pdfToOdp/odsToPdf/pdfToOds/odgToPdf/pdfToOdg/xlsxToPdf/pdfToXlsx/markdownToPdf/pdfToMarkdown directly for cancellation or diagnostics.
export { docxPdfCodec, markdownPdfCodec, odgPdfCodec, odpPdfCodec, odsPdfCodec, odtPdfCodec, pptxPdfCodec, xlsxPdfCodec } from './convert/codec';

// --- Ten cross-format bridges, five pairs (odt<->docx, odp<->pptx, ods<->xlsx, markdown<->docx, markdown<->odt), bypassing PDF entirely -- see convert.ts's own module comment on this section for why these carry substantially higher fidelity than the fourteen PDF-pivot conversions above. markdownToDocx/docxToMarkdown and markdownToOdt/odtToMarkdown are hand-written bridge functions, not something resolveConversionPath's (capability.ts) generic one-hop composition executes automatically -- see capability.ts's own module comment for why: local.ts's DocumentConverter only ever executes a 'direct' strategy, never a composed one, so wiring a pair into the port requires a real, callable, registered function regardless of whether the resolver could theoretically find that path itself. ---
export type { DocumentBridgeOptions } from './convert/convert';
export { docxToMarkdown, docxToOdt, markdownToDocx, markdownToOdt, odpToPptx, odsToXlsx, odtToDocx, odtToMarkdown, pptxToOdp, xlsxToOds } from './convert/convert';

// Schema-validated z.codec() pairs over the ten bridges above (odt bytes <-> docx bytes, odp bytes <-> pptx bytes, ods bytes <-> xlsx bytes, markdown bytes <-> docx bytes, markdown bytes <-> odt bytes), the no-extra-options form -- use odtToDocx/docxToOdt/odpToPptx/pptxToOdp/odsToXlsx/xlsxToOds/markdownToDocx/docxToMarkdown/markdownToOdt/odtToMarkdown directly for cancellation.
export { markdownDocxCodec, markdownOdtCodec, odpPptxCodec, odsXlsxCodec, odtDocxCodec } from './convert/codec';

// --- odm (ODF master document, multiple chapters) -> PDF, the one conversion in this package shaped differently from every other: a .odm's chapters are external references (odf.js's readOdm never inlines them -- see odmToPdf's own module comment), so producing a PDF needs a caller-supplied resolveSubDocument callback to hand back each chapter's own .odt bytes. Not part of the twelve-conversion or six-bridge groups above, and not wired into the DocumentConverter port below -- see odmToPdf's own module comment for why. ---
export type { OdmToPdfOptions } from './convert/convert';
export { odmToPdf, OdmUnresolvedSectionError } from './convert/convert';

// --- .odb (ODF database front-end): HSQLDB's TEXT script format (Tier 1, src/hsqldb/script.ts) plus its own binary CACHED-table row-store format (Tier 2, src/hsqldb/cache.ts, src/hsqldb/rowformat.ts), and Firebird's own gbak logical-backup format (Tier 3, src/firebird/backup.ts, database/firebird.fbk -- NOT raw ODS page format, see the README's .odb Tier 3 Gotchas entry for the empirical finding that corrected this) -- all wired transparently into readOdbTables/odbToXlsx/odbToCsv, so a caller never needs to know which storage shape or engine a given .odb used. HSQLDB's own whole-script BINARY/COMPRESSED serialisation remains detected and named, not implemented, and an external-only connection is permanently out of scope (see README's Fidelity/Gotchas). readOdbTables is independently usable (Package -> table data) and dispatches to whichever tier the package's own embedded engine matches, matching the "each pipeline stage independently exported" convention above; decodeHsqldbCachedTables is the equivalent Tier 2 stage, for a caller that already has Tier 1's own parsed tables plus database/data's and database/properties' raw text/bytes from somewhere other than a full .odb Package; readFirebirdBackup is the equivalent Tier 3 stage (raw database/firebird.fbk bytes -> HsqldbTable[], the identical pivot shape parseHsqldbScript produces) for a caller that has already extracted those bytes itself; odbToXlsx/odbToCsv are the ergonomic conversions, and -- like odmToPdf -- are not wired into the DocumentConverter port below. ---
export type { HsqldbColumn, HsqldbTable } from './hsqldb/script';
export { displayTextFor as hsqldbCellDisplayText, HsqldbScriptParseError, parseHsqldbScript } from './hsqldb/script';
export { decodeHsqldbCachedTables } from './hsqldb/cache';
export { HsqldbRowFormatError } from './hsqldb/rowformat';
export type { OdbUnsupportedFormat } from './odb/read';
export { OdbNoEmbeddedDataSourceError, OdbUnsupportedFormatError, readOdbTables } from './odb/read';
export { odbTablesToSpreadsheetDocument } from './odb/spreadsheet';
// A .odb's own Form/Report STRUCTURE (as opposed to readOdbTables' table DATA): odf.js 2.0.0's OdbInventory.forms/.reports are now OdbComponentInfo[] (name + href, a breaking change from 1.x's plain string[]), and its own readOdbForm/readOdbReport resolve one named component into its real static structure -- a form's bound controls (readOdt's own document plus form:form/form:control-implementation definitions) or a report's bands/groups/functions (rpt:report-header/rpt:group/rpt:detail, parsed directly from the report sub-document). Both are re-exported here unmodified, matching the "each pipeline stage independently usable" convention readOdbTables/decodeHsqldbCachedTables/readFirebirdBackup already follow; readOdbForms/readOdbReports (src/odb/components.ts) are this package's own "read every declared one at once" convenience, calling readOdbForm/readOdbReport once per name discovered via readOdbInventory -- the readOdbTables-shaped one-call ergonomic this data did not have until odf.js 2.0.0 made forms/reports real.
export type { OdbComponentInfo, OdbConnectionInfo, OdbForm, OdbFormControl, OdbFormDefinition, OdbInventory, OdbQueryInfo, OdbReport, OdbReportBand, OdbReportElement, OdbReportFunction, OdbReportGroup } from 'odf.js';
export { readOdbForm, readOdbInventory, readOdbReport, resolveOdbComponent } from 'odf.js';
export { readOdbForms, readOdbReports } from './odb/components';
export { OdbTableNotFoundError, OdbTableNotSpecifiedError } from './odb/csv';
export type { OdbToCsvOptions } from './convert/convert';
export { odbToCsv, odbToXlsx } from './convert/convert';
export type { FirebirdBackupSummary, ReadFirebirdBackupResult } from './firebird/backup';
export {
  FirebirdBackupFormatError,
  FirebirdCompositeRecordUnsupportedError,
  FirebirdSchemaParseError,
  readFirebirdBackup,
  SUPPORTED_BACKUP_FORMAT_VERSION as FIREBIRD_SUPPORTED_BACKUP_FORMAT_VERSION,
} from './firebird/backup';
export { FirebirdDataParseError } from './firebird/data';
export { FirebirdUnsupportedFieldTypeError } from './firebird/blr-types';
export { FirebirdBackupParseError } from './firebird/reader';

// --- The swappable conversion port, for a caller that wants to inject a different (e.g. remote) implementation later without changing call sites. ---
export type { ConversionRequest, ConversionResult, Diagnostic, DocumentConverter, DocumentFormat, DocumentPayload } from './convert/port';
export { createLocalDocumentConverter } from './convert/local';

// --- Ports a caller can inject: deterministic clocks (for reproducible PDF output in tests) and cancellation. ---
export type { ClockPort } from './ports/clock';
export { fixedClock, systemClock } from './ports/clock';
export { throwIfAborted } from './ports/abort';
