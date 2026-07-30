// documents.js's public surface: bidirectional docx/pptx <-> PDF conversion, a read+write live-view editor for docx/pptx, and a hand-written PDF codec, built on ooxml.js's lossless OOXML core.

// --- ooxml.js's lossless OOXML core, re-exported so consumers need only this one dependency. Its own typed readers (readDocx/readPptx/readXlsx) and their result types are deliberately NOT re-exported here: ContentDocument (below) supersedes them for this package's purposes, and exposing both would be a trap -- two competing, differently-lossy document models under one API surface. ---
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

// --- The semantic content model: one read+write-capable model for both docx and pptx, instead of ooxml.js's two one-way, lossy, format-specific typed readers. ---
export type {
  ContentBlock,
  ContentDocument,
  ContentImageBlock,
  ContentListMembership,
  ContentPageBreak,
  ContentParagraph,
  ContentRun,
  ContentSection,
  ContentShape,
  ContentSlide,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
} from './model/content';
export {
  CONTENT_FORMAT_VERSION,
  ContentBlockSchema,
  ContentDocumentSchema,
  ContentImageBlockSchema,
  ContentPageBreakSchema,
  ContentParagraphSchema,
  ContentRunSchema,
  ContentSectionSchema,
  ContentShapeSchema,
  ContentSlideSchema,
  ContentTableCellSchema,
  ContentTableRowSchema,
  ContentTableSchema,
  isContentBlock,
} from './model/content';

// --- The PDF-side pivot model. ---
export type { LayoutDocument, LayoutEllipse, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLine, LayoutLink, LayoutMetadata, LayoutPage, LayoutRect, LayoutText } from './model/layout';
export { LAYOUT_FORMAT_VERSION } from './model/layout';

// --- Shared model primitives used by both pivot models. ---
export type { Box, Margins, PageSize } from './model/geometry';
export { flipY, PAGE_SIZE_A4, PAGE_SIZE_LETTER, SLIDE_SIZE_STANDARD, SLIDE_SIZE_WIDESCREEN } from './model/geometry';
export type { LayoutColor } from './model/color';
export { COLOR_BLACK, rgbHexToColor } from './model/color';
export type { Alignment, LayoutFont } from './model/style';
export { DEFAULT_LAYOUT_FONT } from './model/style';

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

// --- The hand-written PDF codec. ---
export type { ReadPdfOptions } from './pdf/read';
export { readPdf } from './pdf/read';
export type { WritePdfOptions } from './pdf/write';
export { writePdf } from './pdf/write';
export type { PdfDiagnostic, PdfDiagnosticSeverity, PdfDiagnosticSink } from './pdf/diagnostics';
export { NOOP_DIAGNOSTIC_SINK, PdfEncryptedError, PdfParseError } from './pdf/diagnostics';
export type { WinAnsiSubstitution } from './pdf/winansi';

// --- Format <-> ContentDocument readers and layout algorithms, each independently usable rather than only reachable through the ergonomic conversions below. ---
export { readDocxContent } from './ooxml/docx/read';
export { readPptxContent } from './ooxml/pptx/read';
export type { EngineLayoutOptions } from './layout/engine';
export { convertWordprocessingToLayout } from './layout/engine';
export type { SlidesLayoutOptions } from './layout/slides';
export { convertPresentationToLayout } from './layout/slides';
export type { ReconstructOptions } from './layout/reconstruct';
export { reconstructPresentation, reconstructWordprocessing } from './layout/reconstruct';

// --- The four ergonomic top-level conversions. ---
export type { DocumentToPdfOptions, PdfToDocumentOptions } from './convert/convert';
export { docxToPdf, pdfToDocx, pdfToPptx, pptxToPdf } from './convert/convert';

// --- The swappable conversion port, for a caller that wants to inject a different (e.g. remote) implementation later without changing call sites. ---
export type { ConversionRequest, ConversionResult, Diagnostic, DocumentConverter, DocumentFormat, DocumentPayload } from './convert/port';
export { createLocalDocumentConverter } from './convert/local';

// --- Ports a caller can inject: deterministic clocks (for reproducible PDF output in tests) and cancellation. ---
export type { ClockPort } from './ports/clock';
export { fixedClock, systemClock } from './ports/clock';
export { throwIfAborted } from './ports/abort';
