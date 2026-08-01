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

// --- The semantic content model: one read+write-capable model for both docx and pptx, instead of ooxml.js's two one-way, lossy, format-specific typed readers. The full vocabulary (ContentBlock and everything beneath it) is sourced from document-content-model, the sibling schema package shared with ooxml.js; only the ContentDocument envelope itself (and its own CONTENT_FORMAT_VERSION) stays local to this package -- see src/model/content.ts. ---
export type {
  ContentBlock,
  ContentCellValue,
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
} from 'document-content-model';
export {
  ContentBlockSchema,
  ContentCellValueSchema,
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
} from 'document-content-model';
export type { ContentDocument } from './model/content';
export { CONTENT_FORMAT_VERSION, ContentDocumentSchema } from './model/content';

// --- The PDF-side pivot model, also sourced from document-content-model. ---
export type { LayoutDocument, LayoutEllipse, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLine, LayoutLink, LayoutMetadata, LayoutPage, LayoutPath, LayoutPathSegment, LayoutRect, LayoutSubpath, LayoutText } from 'document-content-model';
export { LAYOUT_FORMAT_VERSION } from 'document-content-model';

// --- Shared model primitives used by both pivot models. ---
export type { Box, Margins, PageSize } from './model/geometry';
export { flipY, PAGE_SIZE_A4, PAGE_SIZE_LETTER, SLIDE_SIZE_STANDARD, SLIDE_SIZE_WIDESCREEN } from './model/geometry';
export type { LayoutColor } from './model/color';
export { COLOR_BLACK, rgbHexToColor } from './model/color';
export type { Alignment, LayoutFont } from './model/style';
export { DEFAULT_LAYOUT_FONT } from './model/style';
// Magic-byte-validated Uint8Array schemas, so a caller passing the wrong format -- to these functions directly, or as the input/output schema half of a z.codec() below -- gets a clear Zod validation error instead of a confusing failure three layers down. The Odt/Ods/Odp/Odg schemas check the package's actual declared media type (see src/model/bytes.ts), a stronger check than Docx/PptxBytesSchema's generic ZIP-signature check.
export { DocxBytesSchema, OdgBytesSchema, OdpBytesSchema, OdsBytesSchema, OdtBytesSchema, PdfBytesSchema, PptxBytesSchema, XlsxBytesSchema } from './model/bytes';

// --- The live-view read+write editors: a real manipulation API for docx/pptx content, since ooxml.js's own typed readers explicitly forbid write-back. ---
export type { DocxBody } from './edit/docx/editor';
export { createDocx, DocxEditor, openDocx } from './edit/docx/editor';
export { DocxParagraph } from './edit/docx/paragraph';
export { DocxRun } from './edit/docx/run';
export { DocxTable, DocxTableCell, DocxTableRow } from './edit/docx/table';
export { buildDocxPackage } from './edit/docx/content';

export type { SlideImageInit, TextBoxInit } from './edit/pptx/slide';
export { createPptx, openPptx, PptxEditor } from './edit/pptx/editor';
export { PptxSlide } from './edit/pptx/slide';
export type { DrawingParagraphInit, DrawingRunInit } from './edit/pptx/shape';
export { PptxShape } from './edit/pptx/shape';
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

export type { SlideImageInit as OdpSlideImageInit, TextBoxInit as OdpTextBoxInit } from './edit/odp/slide';
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

// --- The hand-written PDF codec. ---
export type { ReadPdfOptions } from './pdf/read';
export { readPdf } from './pdf/read';
export type { WritePdfOptions } from './pdf/write';
export { writePdf } from './pdf/write';
export type { PdfDiagnostic, PdfDiagnosticSeverity, PdfDiagnosticSink } from './pdf/diagnostics';
export { NOOP_DIAGNOSTIC_SINK, PdfEncryptedError, PdfParseError } from './pdf/diagnostics';
export type { WinAnsiSubstitution } from './pdf/winansi';
// A schema-validated z.codec() pair over readPdf/writePdf (PDF bytes <-> LayoutDocument), mirroring ooxml.js's own packageCodec -- the no-extra-options form; use readPdf/writePdf directly for cancellation, diagnostics, a custom clock, or WinAnsi-substitution reporting.
export { pdfCodec } from './pdf/codec';
// The embedded math font (STIX Two Math, OFL-1.1 -- see assets/fonts/NOTICE.md), parsed once and cached: loadMathFont().font exposes glyphId/glyphSpaceWidth/cffBytes/descriptor directly, and .metricsAt(sizePt) is the MathFontMetrics factory src/mathml's own layoutFormula consumes. Exported for a caller that wants to lay out a formula (via layoutFormula below) without going through odfToPdf's own fixed pipeline.
export type { LoadedMathFont, MathFont, MathFontDescriptorMetrics } from './pdf/math-font';
export { loadMathFont } from './pdf/math-font';

// --- MathML presentation-layer typesetting: a pure box-model layout engine (no PDF or ODF knowledge of its own -- see src/mathml/'s own module comments), consuming odf.js's readOdfFormula's own raw MathML tree via a locally-defined, structurally-compatible node type. odfToPdf (below) and the odt/odp embedded-formula layout paths (src/layout/engine.ts, src/layout/slides.ts) are its two real callers; exported directly too, for a caller that wants to lay out a formula (e.g. onto a custom page layout) without going through either. ---
export type {
  LayoutFormulaOptions,
  MathBox,
  MathColor,
  MathDiagnostic,
  MathDiagnosticKind,
  MathFontMetrics,
  MathGlyphMetrics,
  MathGlyphRun,
  MathLayoutItem,
  MathLayoutResult,
  MathMlAttribute,
  MathMlElement,
  MathMlNode,
  MathMlText,
  MathRule,
  MathStroke,
  MathVariant,
  OperatorProperties,
} from './mathml';
export { applyMathVariant, elementChildren, elementLocalName, firstChildByLocalName, isMathMlElement, isMathVariant, layoutFormula, localName, mapMathVariant, operatorProperties, textContent as mathMlTextContent } from './mathml';

// --- Format <-> ContentDocument readers and layout algorithms, each independently usable rather than only reachable through the ergonomic conversions below. ---
export { readDocxContent } from './ooxml/docx/read';
export { readPptxContent } from './ooxml/pptx/read';
export type { OdtContentResult } from './odf/odt/read';
export { readOdtContent } from './odf/odt/read';
export type { OdpContentResult } from './odf/odp/read';
export { readOdpContent } from './odf/odp/read';
export { readOdsContent } from './odf/ods/read';
export { readOdgContent } from './odf/odg/read';
export type { StandaloneFormulaContent } from './odf/formula/read';
export { readOdfEmbeddedFormula, readOdfFormulaContent } from './odf/formula/read';
export type { EmbeddedFormula, PositionedFormula } from './model/formula';
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

// --- Twelve ergonomic conversions (docx/pptx/odt/odp/ods/odg <-> PDF, all round-trip both ways). ---
export type { DocumentToPdfOptions, PdfToDocumentOptions } from './convert/convert';
export { docxToPdf, odgToPdf, odpToPdf, odsToPdf, odtToPdf, pdfToDocx, pdfToOdg, pdfToOdp, pdfToOds, pdfToOdt, pdfToPptx, pptxToPdf } from './convert/convert';

// --- odf (a standalone ODF formula document) -> PDF: not one of the twelve round-trip conversions above (there is no pdfToOdf -- see convert.ts's own module comment on odfToPdf for why: recovering structured MathML from rendered glyphs is a categorically different, OCR-adjacent problem, not a geometry-reconstruction one). Renders via src/mathml's layoutFormula and the embedded STIX Two Math font, the same pipeline the odt/odp embedded-formula paths use. ---
export { odfToPdf } from './convert/convert';

// Schema-validated z.codec() pairs over the conversions above (docx/pptx/odt/odp/ods/odg bytes <-> PDF bytes), the no-extra-options form -- use docxToPdf/pdfToDocx/pptxToPdf/pdfToPptx/odtToPdf/pdfToOdt/odpToPdf/pdfToOdp/odsToPdf/pdfToOds/odgToPdf/pdfToOdg directly for cancellation or diagnostics.
export { docxPdfCodec, odgPdfCodec, odpPdfCodec, odsPdfCodec, odtPdfCodec, pptxPdfCodec } from './convert/codec';

// --- Six cross-format bridges (odt<->docx, odp<->pptx, ods<->xlsx), bypassing PDF entirely -- see convert.ts's own module comment on this section for why these carry substantially higher fidelity than the twelve PDF-pivot conversions above. ---
export type { DocumentBridgeOptions } from './convert/convert';
export { docxToOdt, odpToPptx, odsToXlsx, odtToDocx, pptxToOdp, xlsxToOds } from './convert/convert';

// Schema-validated z.codec() pairs over the six bridges above (odt bytes <-> docx bytes, odp bytes <-> pptx bytes, ods bytes <-> xlsx bytes), the no-extra-options form -- use odtToDocx/docxToOdt/odpToPptx/pptxToOdp/odsToXlsx/xlsxToOds directly for cancellation.
export { odpPptxCodec, odsXlsxCodec, odtDocxCodec } from './convert/codec';

// --- odm (ODF master document, multiple chapters) -> PDF, the one conversion in this package shaped differently from every other: a .odm's chapters are external references (odf.js's readOdm never inlines them -- see odmToPdf's own module comment), so producing a PDF needs a caller-supplied resolveSubDocument callback to hand back each chapter's own .odt bytes. Not part of the twelve-conversion or six-bridge groups above, and not wired into the DocumentConverter port below -- see odmToPdf's own module comment for why. ---
export type { OdmToPdfOptions } from './convert/convert';
export { odmToPdf, OdmUnresolvedSectionError } from './convert/convert';

// --- .odb (ODF database front-end) Tier 1 support: HSQLDB's TEXT script format only -- binary/compressed HSQLDB and Firebird-backed .odb are detected and named, not implemented, and an external-only connection is permanently out of scope (see README's Fidelity/Gotchas). readOdbTables is independently usable (Package -> table data), matching the "each pipeline stage independently exported" convention above; odbToXlsx/odbToCsv are the ergonomic conversions, and -- like odmToPdf -- are not wired into the DocumentConverter port below. ---
export type { HsqldbColumn, HsqldbTable } from './hsqldb/script';
export { displayTextFor as hsqldbCellDisplayText, HsqldbScriptParseError, parseHsqldbScript } from './hsqldb/script';
export type { OdbUnsupportedFormat } from './odb/read';
export { OdbNoEmbeddedDataSourceError, OdbUnsupportedFormatError, readOdbTables } from './odb/read';
export { odbTablesToSpreadsheetDocument } from './odb/spreadsheet';
export { OdbTableNotFoundError, OdbTableNotSpecifiedError } from './odb/csv';
export type { OdbToCsvOptions } from './convert/convert';
export { odbToCsv, odbToXlsx } from './convert/convert';

// --- The swappable conversion port, for a caller that wants to inject a different (e.g. remote) implementation later without changing call sites. ---
export type { ConversionRequest, ConversionResult, Diagnostic, DocumentConverter, DocumentFormat, DocumentPayload } from './convert/port';
export { createLocalDocumentConverter } from './convert/local';

// --- Ports a caller can inject: deterministic clocks (for reproducible PDF output in tests) and cancellation. ---
export type { ClockPort } from './ports/clock';
export { fixedClock, systemClock } from './ports/clock';
export { throwIfAborted } from './ports/abort';
