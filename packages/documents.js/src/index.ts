// documents.js's public surface: bidirectional docx/pptx/odt/odp/ods/odg <-> PDF conversion, a read+write live-view editor for docx/pptx/odt/odp/ods/odg, and a hand-written PDF codec, built on ooxml.js's lossless OOXML core and odf.js's lossless ODF core.

// --- ooxml.js's lossless OOXML core, re-exported so consumers need only this one dependency. Its own typed readers readDocx/readPptx, and the separate lossy cell-values-only readXlsx, are deliberately NOT re-exported here: readDocxContent/readPptxContent (below) already wrap readDocx/readPptx into ContentDocument, so exposing both the wrapper and the thing it wraps would be a trap -- two overlapping entry points to the same underlying read. readXlsxContent/buildXlsxPackage are the one exception -- re-exported directly further below, in the Format <-> ContentDocument readers section, rather than from here or behind a documents.js-local wrapper: unlike readDocx/readPptx, readXlsxContent already reads (and buildXlsxPackage already builds) a real spreadsheet ContentDocument on its own, so there is no wrapper to write and no second, overlapping entry point to trap a caller into picking the wrong one. readDocx's own comments/footnotes/headers/footers/numbering, which ContentDocument doesn't model at all, are not lost, though -- see readDocxExtras below, which exposes that data as its own real return type rather than by re-exporting readDocx itself. Comment/Footnote/NumberingDefinitions (ooxml.js's own types, reused by readDocxExtras' own return shape) are re-exported here since they're genuinely just data types, not a second entry point to the same read. ---
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
  type Footnote,
  FootnoteSchema,
  type NumberingDefinition,
  NumberingDefinitionSchema,
  type NumberingDefinitions,
  type NumberingLevel,
  NumberingLevelSchema,
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
export { flipY } from './model/geometry';
export type { Box, Margins, PageSize } from 'document-schema.js';
export { PAGE_SIZE_A4, PAGE_SIZE_LETTER, SLIDE_SIZE_STANDARD, SLIDE_SIZE_WIDESCREEN } from 'document-schema.js';
export type { Color as LayoutColor } from 'document-schema.js';
export { COLOR_BLACK, rgbHexToColor } from 'document-schema.js';
export type { Alignment, LayoutFont } from 'document-schema.js';
export { DEFAULT_LAYOUT_FONT } from 'document-schema.js';
// Magic-byte-validated Uint8Array schemas, so a caller passing the wrong format -- to these functions directly, or as the input/output schema half of a z.codec() below -- gets a clear Zod validation error instead of a confusing failure three layers down. The Odt/Ods/Odp/Odg schemas check the package's actual declared media type (see src/model/bytes.ts), a stronger check than Docx/PptxBytesSchema's generic ZIP-signature check. MarkdownBytesSchema is architecturally different from every other schema here -- it checks only well-formed UTF-8, since markdown has no magic bytes or format-level header of its own to check (see src/model/bytes.ts's own comment).
export { DocxBytesSchema, MarkdownBytesSchema, OdgBytesSchema, OdpBytesSchema, OdsBytesSchema, OdtBytesSchema, PdfBytesSchema, PptxBytesSchema, XlsxBytesSchema } from './model/bytes';

// --- The live-view read+write editors: a real manipulation API for docx/pptx content, since ooxml.js's own typed readers explicitly forbid write-back. ---
export type { CreateEmptyDocxPackageOptions } from './edit/docx/scaffold';
export type { DocxBody } from './edit/docx/editor';
export type { CreateDocxOptions } from './edit/docx/editor';
export { createDocx, DocxEditor, openDocx } from './edit/docx/editor';
export { DocxParagraph } from './edit/docx/paragraph';
export { DocxRun } from './edit/docx/run';
export type { DocxVerticalMerge } from './edit/docx/table';
export { DocxTable, DocxTableCell, DocxTableRow } from './edit/docx/table';
export type { BuildDocxPackageOptions } from './edit/docx/content';
export { buildDocxPackage } from './edit/docx/content';

export type { CreateEmptyPptxPackageOptions } from './edit/pptx/scaffold';
export type { SlideImageInit, SlideTableInit, TextBoxInit } from './edit/pptx/slide';
export type { CreatePptxOptions } from './edit/pptx/editor';
export { createPptx, openPptx, PptxEditor } from './edit/pptx/editor';
export { PptxSlide } from './edit/pptx/slide';
export type { DrawingParagraphInit, DrawingRunInit } from './edit/pptx/shape';
export { PptxShape } from './edit/pptx/shape';
export type { PptxTableInit } from './edit/pptx/table';
export { PptxTable, PptxTableCell, PptxTableRow } from './edit/pptx/table';
export type { BuildPptxPackageOptions } from './edit/pptx/content';
export { buildPptxPackage } from './edit/pptx/content';

export type { CreateEmptyOdtPackageOptions } from './edit/odt/scaffold';
export type { OdtBody } from './edit/odt/editor';
export type { CreateOdtOptions } from './edit/odt/editor';
export { createOdt, OdtEditor, openOdt } from './edit/odt/editor';
export type { ParagraphInit as OdtParagraphInit } from './edit/odt/paragraph';
export { OdtParagraph } from './edit/odt/paragraph';
export type { RunInit as OdtRunInit } from './edit/odt/run';
export { OdtRun } from './edit/odt/run';
export { OdtList, OdtListItem } from './edit/odt/list';
export type { TableInit as OdtTableInit } from './edit/odt/table';
export { OdtTable, OdtTableCell, OdtTableRow } from './edit/odt/table';
export type { BuildOdtPackageOptions } from './edit/odt/content';
export { buildOdtPackage } from './edit/odt/content';

export type { CreateEmptyOdpPackageOptions } from './edit/odp/scaffold';
export type { SlideImageInit as OdpSlideImageInit, SlideTableInit as OdpSlideTableInit, TextBoxInit as OdpTextBoxInit } from './edit/odp/slide';
export type { CreateOdpOptions } from './edit/odp/editor';
export { createOdp, OdpEditor, openOdp } from './edit/odp/editor';
export { OdpSlide } from './edit/odp/slide';
export { OdpShape } from './edit/odp/shape';
export type { BuildOdpPackageOptions } from './edit/odp/content';
export { buildOdpPackage } from './edit/odp/content';

export type { CreateEmptyOdsPackageOptions } from './edit/ods/scaffold';
export type { CreateOdsOptions } from './edit/ods/editor';
export { createOds, OdsEditor, openOds } from './edit/ods/editor';
export { OdsSheet } from './edit/ods/sheet';
export { OdsCell } from './edit/ods/cell';
export type { BuildOdsPackageOptions } from './edit/ods/content';
export { buildOdsPackage } from './edit/ods/content';

export type { CreateEmptyOdgPackageOptions } from './edit/odg/scaffold';
export type { PageImageInit as OdgPageImageInit, TextBoxInit as OdgTextBoxInit } from './edit/odg/page';
export type { CreateOdgOptions } from './edit/odg/editor';
export { createOdg, OdgEditor, openOdg } from './edit/odg/editor';
export { OdgPage } from './edit/odg/page';
// draw:frame content (text boxes/images) reuses OdpShape wholesale -- see edit/odg/page.ts's own top-of-file note; there is no separate OdgShape class.
export type { BoxVectorInit as OdgBoxVectorInit, LineVectorInit as OdgLineVectorInit, OdgVector, OdgVectorKind, PathVectorInit as OdgPathVectorInit } from './edit/odg/vector';
export { OdgBoxVector, OdgLineVector, OdgPathVector } from './edit/odg/vector';
export type { BuildOdgPackageOptions } from './edit/odg/content';
export { buildOdgPackage } from './edit/odg/content';

// A genuine live-view editor over a mutable in-memory ContentDocument -- markdown has no XmlElement tree the way docx/pptx/odt/odp/ods/odg each do, so MarkdownEditor holds the plain ContentDocument object directly and every MarkdownParagraph/MarkdownRun/MarkdownTable/MarkdownTableCell it produces holds a direct reference into that object, exactly mirroring how OdtParagraph/OdtRun hold a reference into a real XmlElement (see src/edit/markdown/editor.ts's own module doc comment). MarkdownList is the flat, docx-style list handle this editor uses (see src/edit/markdown/list.ts) -- markdown has no structural list container the way ODF's text:list is.
export type { CreateMarkdownEditorOptions, MarkdownBody } from './edit/markdown/editor';
export { createMarkdownEditor, MarkdownEditor, openMarkdown } from './edit/markdown/editor';
export type { ParagraphInit as MarkdownParagraphInit } from './edit/markdown/paragraph';
export { MarkdownParagraph } from './edit/markdown/paragraph';
export type { RunInit as MarkdownRunInit } from './edit/markdown/run';
export { MarkdownRun } from './edit/markdown/run';
export type { TableInit as MarkdownTableInit } from './edit/markdown/table';
export { MarkdownTable, MarkdownTableCell, MarkdownTableRow } from './edit/markdown/table';
export type { MarkdownListInit } from './edit/markdown/list';
export { MarkdownList } from './edit/markdown/list';

// A live-view editor over pdf-codec's own positioned-item model (LayoutDocument) -- NOT a content-stream/byte-level editor, see src/edit/pdf/editor.ts's own module doc comment for the rationale. PageInit is defined in page.ts (mirroring ParagraphInit living in paragraph.ts rather than editor.ts) since it's PdfPage's own initial shape, even though appendPage/insertPageAt (which consume it) live on PdfEditor.
export type { PageInit } from './edit/pdf/page';
export { PdfPage } from './edit/pdf/page';
export type { CreatePdfOptions } from './edit/pdf/editor';
export { createPdf, openPdf, PdfEditor } from './edit/pdf/editor';
export type {
  PdfEllipseInit,
  PdfImageInit,
  PdfItem,
  PdfLineInit,
  PdfLinkInit,
  PdfPathInit,
  PdfRectInit,
  PdfTextInit,
} from './edit/pdf/item';
export { PdfEllipseItem, PdfImageItem, PdfLineItem, PdfLinkItem, PdfPathItem, PdfRectItem, PdfTextItem } from './edit/pdf/item';

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

// --- Real font resolution: which typeface a conversion actually renders through, rather than the standard 14 alone. Every X-to-PDF conversion below builds a FontRegistry whose precedence is source-embedded faces, then the caller's own `fonts`, then pdf-codec's vendored Carlito/Caladea substitutes (metric-compatible with Calibri/Cambria), then the standard 14 -- so a document that embeds its fonts renders in its real typeface at its real metrics without the caller doing anything. The pdf-codec primitives are re-exported because DocumentToPdfOptions.fonts/onFontSubstitution are typed in terms of them; the extractors and createDocumentFontRegistry are exported for a caller composing readXContent/convertXToLayout/writePdf themselves rather than through an ergonomic conversion. ---
export type { FontRegistry, FontRegistryOptions, FontSubstitution, ProvidedFont, ResolvedFace } from 'pdf-codec';
export { createFontMeasurer, createFontRegistry, createStandardFontMeasurer } from 'pdf-codec';
export type { DocumentFontRegistryOptions, FontSourcePackage } from './fonts/registry';
export { createDocumentFontRegistry, extractSourceFonts } from './fonts/registry';
// The two format-specific extractors behind extractSourceFonts, plus each one's own error class -- a package declaring a font part it cannot resolve throws rather than quietly downgrading to a substitute, so a caller catching these is catching a structurally broken source document, not a missing optional feature.
export { extractOoxmlEmbeddedFonts, OoxmlEmbeddedFontError } from './fonts/ooxml';
export { extractOdfEmbeddedFonts, OdfEmbeddedFontError } from './fonts/odf';
// ECMA-376 Part 4, 2.8.1's own font obfuscation, sniff-first over both formats (see src/fonts/obfuscation.ts) -- exported for a caller holding a raw .odttf/.fntdata part of their own rather than a whole package.
export { deobfuscateEmbeddedFont, deriveFontKey, FontDeobfuscationError, looksLikeSfnt } from './fonts/obfuscation';
export { readFontFace as describeFontFace, FontFaceParseError } from 'pdf-codec';
export type { FontFace } from 'document-schema.js';
export { columnIndexToLetters, columnLettersToIndex, cellReference, parseCellReference, parseRangeReference, rangeReference } from 'document-schema.js';
export type { CellPosition, CellRange } from 'document-schema.js';

// --- MathML presentation-layer typesetting: a pure box-model layout engine (no PDF or ODF knowledge of its own -- see src/mathml/'s own module comments), consuming odf.js's readOdfFormula's own raw MathML tree via a locally-defined, structurally-compatible node type. odfToPdf (below) and the odt/odp embedded-formula layout paths (src/layout/engine.ts, src/layout/slides.ts) are its two real callers; exported directly too, for a caller that wants to lay out a formula (e.g. onto a custom page layout) without going through either. ---
export type { LayoutFormulaOptions } from './mathml/layout';
export { layoutFormula } from './mathml/layout';
export type { MathDiagnostic, MathDiagnosticKind, MathLayoutResult } from './mathml/layout-types';
export type { MathAssembledGlyphs, MathBox, MathColor, MathFontMetrics, MathGlyphMetrics, MathGlyphPlacement, MathGlyphRun, MathLayoutItem, MathRule, MathStretchAxis, MathStretchGlyph, MathStretchResult, MathStroke } from 'document-schema.js';
export type { MathMlAttribute, MathMlElement, MathMlNode, MathMlText } from './mathml/nodes';
export { elementChildren, elementLocalName, firstChildByLocalName, isMathMlElement, localName, textContent as mathMlTextContent } from './mathml/nodes';
export type { OperatorProperties } from './mathml/operators';
export { operatorProperties } from './mathml/operators';
export type { MathVariant } from './mathml/variant';
export { applyMathVariant, isMathVariant, mapMathVariant } from './mathml/variant';

// --- MathML <-> OMML (ECMA-376 Part 1's own Office Math Markup Language) structural translation, both directions. buildOfficeMath/buildOfficeMathParagraph are the WRITE side, the counterpart to layoutFormula above: they cover the identical construct set, so a formula rendered to PDF and the same formula written into a docx degrade in exactly the same places (buildDocxPackage is their real caller -- an embedded formula becomes genuine, editable Word math rather than a plain-text stand-in). readOfficeMath/collectOfficeMathElements are the READ side, the structural inverse: they recover a Word-authored equation as real MathML, which is what makes readDocxContent carry a formula through at all (ooxml.js's own readDocx has no m:oMath handling whatsoever). Both are exported directly for a caller assembling or mining OOXML math itself, e.g. in a docx opened through openDocx. ---
export type { OmmlDiagnostic, OmmlDiagnosticKind } from './omml/shared';
export type { OmmlWriteResult } from './omml/write';
export { buildOfficeMath, buildOfficeMathParagraph } from './omml/write';
export type { OmmlReadResult } from './omml/read';
export { collectOfficeMathElements, readOfficeMath } from './omml/read';

// --- Format <-> ContentDocument readers and layout algorithms, each independently usable rather than only reachable through the ergonomic conversions below. ---
export type { ReadDocxContentOptions } from './ooxml/docx/read';
export { readDocxContent } from './ooxml/docx/read';
// The docx-specific data readDocxContent above genuinely cannot carry through ContentDocument -- comments, footnotes, headers/footers, and numbering (abstractNum/num) definitions -- exposed as its own real return type rather than forced into a shape that doesn't model it.
export type { DocxExtras } from './ooxml/docx/extras';
export { readDocxExtras } from './ooxml/docx/extras';
export { readPptxContent } from './ooxml/pptx/read';
// xlsx has no documents.js-local wrapper the way docx/pptx do above: ooxml.js's own readXlsxContent already produces a real spreadsheet ContentDocument directly (not the separate, lossy, cell-values-only readXlsx view, which stays unexported per this module's own top-of-file note), so it's re-exported as-is here, alongside its write-side counterpart buildXlsxPackage -- the same read/build pair the ods<->xlsx bridge (src/convert/composition.ts) and every xlsx metadata-rebuild path (src/codecs/registry.ts) already use internally, now reachable without going through either. Comparatively newer than the ODF/DrawingML readers below: see src/convert/bridges.test.ts's own ods<->xlsx section for the exact, currently-tested fidelity gaps (an ODS-style time-only value has no xlsx serial to write into and degrades to a plain string cell; a written column width survives a read back within about a point of its original value, an algebraic-inverse rounding artifact in the character-width unit conversion, not a dropped value).
export { buildXlsxPackage, readXlsxContent } from 'ooxml.js';
export { readOdtContent } from './odf/odt/read';
export { readOdpContent } from './odf/odp/read';
export { readOdsContent } from './odf/ods/read';
export { readOdgContent } from './odf/odg/read';
export { readOdfEmbeddedFormula, readOdfFormulaContent } from './odf/formula/read';
// markdown <-> ContentDocument -- readMarkdownContent/buildMarkdownText are thin adapters over markdown-codec's own readMarkdown/writeMarkdown (see src/markdown/read.ts's own module comment), never re-exported here directly for the same reason readDocx/readPptx aren't (see this section's own top-of-file note): markdown-codec's own readMarkdown/writeMarkdown operate on document-schema.js's ContentDocument shape directly, a nominally different type from this package's own local ContentDocument above, so exposing both would invite a caller to reach for the wrong one. decodeMarkdownText/encodeMarkdownText are the byte<->text boundary markdown-codec itself has no opinion on (it operates on strings, not bytes) -- exported for a caller composing readMarkdownContent/buildMarkdownText directly, matching every other independently-exported pipeline stage in this section.
export { decodeMarkdownText, encodeMarkdownText } from './markdown/text';
export { readMarkdownContent } from './markdown/read';
export { buildMarkdownText } from './markdown/write';
// The one-way ContentDocument -> Markdown text renderer covering all five ContentDocument kinds, not just 'wordprocessing' -- buildMarkdownText/writeMarkdown above throw MarkdownUnsupportedDocumentKindError for the other four. renderContentDocumentToMarkdown delegates straight to buildMarkdownText for 'wordprocessing' and otherwise flattens slides/sheets/drawing pages/a bare formula into the same ContentBlock vocabulary first, reporting every degrade decision through its own onDiagnostic option (see src/markdown/render.ts's own module comment).
export type {
  MarkdownRenderDiagnostic,
  MarkdownRenderDiagnosticCode,
  MarkdownRenderDiagnosticSeverity,
  MarkdownRenderDiagnosticSink,
  RenderMarkdownOptions,
} from './markdown/render';
export { MarkdownRenderDiagnosticCodes, renderContentDocumentToMarkdown } from './markdown/render';
// A formula travels inside a ContentDocument now (document-schema.js's own 'formula' variant), not alongside one -- these are the small helpers for building and reading that shape: the 'formula'-kind envelope, the embedded-object block an odt/odp reader produces for an inline formula, the narrowing back out of such a block, and the plain-text stand-in for a consumer with no MathML rendering of its own.
export { buildFormulaBlock, formulaDocument, formulaOfBlock, formulaPlaceholderText } from './model/formula';
// The drawing counterpart to the formula helpers above: reconstructWordprocessing/reconstructPresentation carry a page's recovered vector primitives in an embedded-object block, since neither ContentSection nor ContentSlide has a vectors array of its own. buildDrawingBlock is what builds one; drawingOfBlock narrows back out of it, and is what a consumer distinguishing a recovered drawing from a recovered formula calls.
export { buildDrawingBlock, drawingOfBlock } from './model/embedded-drawing';
// The single write-side precedence rule every create*/build*Package entry point uses to stamp real docProps/core.xml (OOXML)/office:meta (ODF) creation/modification timestamps via an injected ClockPort -- exported directly for a caller composing their own package-building step the same way.
export { resolveMetadataTimestamps } from './model/metadata';
export type { PositionedFormula } from 'document-schema.js';
export type { EngineLayoutOptions, WordprocessingLayoutResult } from './layout/engine';
export { convertWordprocessingToLayout } from './layout/engine';
export type { PresentationLayoutResult, SlidesLayoutOptions } from './layout/slides';
export { convertPresentationToLayout } from './layout/slides';
export type { SheetsLayoutOptions, SpreadsheetLayoutResult } from './layout/sheets';
export { convertSpreadsheetToLayout } from './layout/sheets';
export type { DrawingLayoutOptions, DrawingLayoutResult } from './layout/drawing';
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

// --- Ten cross-format bridges, five pairs (odt<->docx, odp<->pptx, ods<->xlsx, markdown<->docx, markdown<->odt), bypassing PDF entirely -- see convert.ts's own module comment on this section for why these carry substantially higher fidelity than the fourteen PDF-pivot conversions above. markdownToDocx/docxToMarkdown and markdownToOdt/odtToMarkdown are hand-written bridge functions -- the composition engine's pathfinder routes them as same-variant bridge hops, and convertDocument's bridge executor runs the identical decode/read/build/encode sequence these functions already hard-code. ---
export type { DocumentBridgeOptions } from './convert/convert';
export { docxToMarkdown, docxToOdt, markdownToDocx, markdownToOdt, odpToPptx, odsToXlsx, odtToDocx, odtToMarkdown, pptxToOdp, xlsxToOds, docxToPptx, pptxToDocx, odtToOdp, odpToOdt, xlsxToMarkdown, markdownToXlsx } from './convert/convert';

// Schema-validated z.codec() pairs over the ten bridges above (odt bytes <-> docx bytes, odp bytes <-> pptx bytes, ods bytes <-> xlsx bytes, markdown bytes <-> docx bytes, markdown bytes <-> odt bytes), the no-extra-options form -- use odtToDocx/docxToOdt/odpToPptx/pptxToOdp/odsToXlsx/xlsxToOds/markdownToDocx/docxToMarkdown/markdownToOdt/odtToMarkdown directly for cancellation.
export { markdownDocxCodec, markdownOdtCodec, odpPptxCodec, odsXlsxCodec, odtDocxCodec, xlsxMarkdownCodec } from './convert/codec';

// --- odm (ODF master document, multiple chapters) -> PDF, the one conversion in this package shaped differently from every other: a .odm's chapters are external references (odf.js's readOdm never inlines them -- see odmToPdf's own module comment), so producing a PDF needs a caller-supplied resolveSubDocument callback to hand back each chapter's own .odt bytes. Not part of the twelve-conversion or six-bridge groups above, and not wired into the DocumentConverter port below -- see odmToPdf's own module comment for why. ---
export type { OdmToPdfOptions } from './convert/convert';
export { odmToPdf, OdmUnresolvedSectionError } from './convert/convert';

// --- .odb (ODF database front-end): HSQLDB's TEXT script format (Tier 1, src/hsqldb/script.ts) plus its own binary CACHED-table row-store format (Tier 2, src/hsqldb/cache.ts, src/hsqldb/rowformat.ts), Firebird's own gbak logical-backup format (Tier 3, src/firebird/backup.ts, database/firebird.fbk -- NOT raw ODS page format, see the README's .odb Tier 3 Gotchas entry for the empirical finding that corrected this), and HSQLDB's own whole-script BINARY/COMPRESSED serialisations (Tier 4, src/hsqldb/binary-script.ts, hsqldb.script_format=1 and =3) -- all wired transparently into readOdbTables/odbToXlsx/odbToCsv, so a caller never needs to know which storage shape or engine a given .odb used. An external-only connection is permanently out of scope (see README's Fidelity/Gotchas). readOdbTables is independently usable (Package -> table data) and dispatches to whichever tier the package's own embedded engine matches, matching the "each pipeline stage independently exported" convention above; decodeHsqldbCachedTables is the equivalent Tier 2 stage, for a caller that already has Tier 1's own parsed tables plus database/data's and database/properties' raw text/bytes from somewhere other than a full .odb Package; readFirebirdBackup is the equivalent Tier 3 stage (raw database/firebird.fbk bytes -> HsqldbTable[], the identical pivot shape parseHsqldbScript produces) for a caller that has already extracted those bytes itself; odbToXlsx/odbToCsv are the ergonomic conversions, and -- like odmToPdf -- are not wired into the DocumentConverter port below. ---
export type { HsqldbColumn, HsqldbTable } from './hsqldb/script';
export { displayTextFor as hsqldbCellDisplayText, HsqldbScriptParseError, parseHsqldbScript } from './hsqldb/script';
export { decodeHsqldbCachedTables } from './hsqldb/cache';
export type { HsqldbBinaryScript } from './hsqldb/binary-script';
export { HsqldbBinaryScriptParseError, inflateHsqldbCompressedScript, parseHsqldbBinaryScript } from './hsqldb/binary-script';
export type { HsqldbDecodeOptions } from './hsqldb/rowformat';
export { HsqldbRowFormatError } from './hsqldb/rowformat';
export type { OdbUnsupportedFormat } from './odb/read';
export { OdbNoEmbeddedDataSourceError, OdbUnsupportedFormatError, readOdbTables } from './odb/read';
export { odbTablesToSpreadsheetDocument } from './odb/spreadsheet';
// A .odb's own Form/Report STRUCTURE (as opposed to readOdbTables' table DATA): odf.js 2.0.0's OdbInventory.forms/.reports are now OdbComponentInfo[] (name + href, a breaking change from 1.x's plain string[]), and its own readOdbForm/readOdbReport resolve one named component into its real static structure -- a form's bound controls (readOdt's own document plus form:form/form:control-implementation definitions) or a report's bands/groups/functions (rpt:report-header/rpt:group/rpt:detail, parsed directly from the report sub-document). Both are re-exported here unmodified, matching the "each pipeline stage independently usable" convention readOdbTables/decodeHsqldbCachedTables/readFirebirdBackup already follow; readOdbForms/readOdbReports (src/odb/components.ts) are this package's own "read every declared one at once" convenience, calling readOdbForm/readOdbReport once per name discovered via readOdbInventory -- the readOdbTables-shaped one-call ergonomic this data did not have until odf.js 2.0.0 made forms/reports real.
export type { OdbComponentInfo, OdbConnectionInfo, OdbForm, OdbFormControl, OdbFormDefinition, OdbInventory, OdbQueryInfo, OdbReport, OdbReportBand, OdbReportElement, OdbReportFunction, OdbReportGroup } from 'odf.js';
export { readOdbForm, readOdbInventory, readOdbReport, resolveOdbComponent } from 'odf.js';
export { readOdbForms, readOdbReports } from './odb/components';
export { OdbTableNotFoundError, OdbTableNotSpecifiedError } from './odb/csv';
// A bounded single-table SQL SELECT engine (src/odb/sql/) over the HsqldbTable[] readOdbTables produces, so a .odb's own saved query (OdbQueryInfo.command, above) can actually be RUN against the data this package extracts -- the one thing an inventory of query text alone cannot do. Exported as the same independently-usable pipeline stages the rest of the .odb surface follows: parseSelect (SQL text -> a validated AST) and evaluateSelect (AST + tables -> a result set). Its grammar is a closed allowlist -- SELECT column-list-or-star FROM one table, optional WHERE (comparisons, AND/OR/NOT with parentheses, IS [NOT] NULL, [NOT] LIKE, [NOT] IN, [NOT] BETWEEN), GROUP BY with COUNT/SUM/AVG/MIN/MAX, and ORDER BY -- and everything outside it (JOINs, subqueries, UNION, DISTINCT, HAVING, row limits, aliases, scalar functions, arithmetic) throws HsqldbSqlUnsupportedError naming the construct rather than being silently ignored, the same policy src/hsqldb/script.ts's own statement parser follows. There is no reverse direction: this engine reads SQL, it never writes it.
export type { SqlResultSet } from './odb/sql/evaluate';
export { evaluateSelect } from './odb/sql/evaluate';
export type { SqlAggregateArgument, SqlAggregateFunction, SqlColumnRef, SqlLiteral, SqlNameRef, SqlOperand, SqlOrderByTerm, SqlPredicate, SqlSelectItem, SqlSelectStatement, SqlSortDirection } from './odb/sql/parser';
export { parseSelect } from './odb/sql/parser';
export type { SqlComparisonOperator, SqlPunctuation, SqlToken } from './odb/sql/lexer';
export { tokenizeSql } from './odb/sql/lexer';
export { HsqldbSqlEvaluationError, HsqldbSqlParseError, HsqldbSqlUnsupportedError } from './odb/sql/errors';
// A Report Builder rpt formula engine (src/odb/formula/) over the result set src/odb/sql/ produces, so a .odb's own saved REPORT -- its groups, its named rpt:function definitions, and the totals in its footers -- can actually be evaluated against real data rather than only having its structure listed by readOdbReport. Exported as the same independently-usable pipeline stages the rest of the .odb surface follows: parseRptFormula (one rpt:formula attribute -> a validated AST), rptDefinitionFromReport (odf.js's own OdbReport -> the definition below), and runRptReport (definition + result set -> the band instances a renderer lays out, each carrying its own evaluated values). Three narrower stages come with it, each existing because src/odb/report/ needs it and a caller writing its own renderer would need the same: odbReportGroupChain (a report's nested rpt:group tree -> the outermost-first chain an RptBandInstance's own groupLevel indexes), rptBandDefinition (one OdbReportBand -> the positional formula list its values line up with), and evaluateRptBandOutsideData (one band evaluated at report scope, belonging to no row -- what a page band needs once a renderer has decided its own page boundaries). The function allowlist is closed -- rpt:HASCHANGED, rpt:LEFT, and rpt:SUM/COUNT/AVG/MIN/MAX, plus the separate field:[COLUMN] bound-field form -- and every other rpt function throws RptFormulaUnsupportedError naming it, the same policy src/odb/sql/ and src/hsqldb/script.ts follow. It evaluates formulas and resolves group breaks; it lays nothing out, so it emits no page headers or footers of its own and there is no reverse direction.
export type { RptBandDefinition, RptBandInstance, RptBandKind, RptGroupDefinition, RptNamedFunctionDefinition, RptReportDefinition, RptReportRun, RptScope } from './odb/formula/evaluate';
export { evaluateRptBandOutsideData, runRptReport } from './odb/formula/evaluate';
export type { RptAggregateFunction, RptFormula, RptReference } from './odb/formula/parser';
export { parseRptFormula } from './odb/formula/parser';
export { odbReportGroupChain, rptBandDefinition, rptDefinitionFromReport } from './odb/formula/definition';
export { RptFormulaEvaluationError, RptFormulaParseError, RptFormulaUnsupportedError, RptReportStructureError } from './odb/formula/errors';
// The renderer that turns all of the above into a real document (src/odb/report/): readOdbReportContent(pkg) resolves the report's own rpt:command/rpt:command-type binding to real rows -- a table name becomes a SELECT-all, a query name is looked up in the .odb's own db:queries and run, a literal command runs as written -- then walks the band and group structure through runRptReport and renders each printed band as one single-row ContentTable, one cell per control, in the wordprocessing ContentDocument variant. Its stages are independently usable like every other .odb stage: odbReportCommandSql (report -> the SQL it issues), resolveOdbReportRows (package + report -> those rows), and renderOdbReportContent (report + any equivalently-shaped rows -> the document). There is no reverse direction: a ContentDocument holds a report's OUTPUT, not the band/group/formula design that produced it.
export type { OdbReportContentOptions } from './odb/report/content';
export { OdbReportNotSpecifiedError, readOdbReportContent } from './odb/report/content';
export { renderOdbReportContent } from './odb/report/render';
export { OdbReportDataSourceError, odbReportCommandSql, resolveOdbReportRows } from './odb/report/source';
export type { OdbConversionOptions, OdbToCsvOptions } from './convert/convert';
export { odbToCsv, odbToXlsx } from './convert/convert';
// readOdbReportContent's own last step: dispatching the rendered report's ContentDocument to real docx/odt/pdf bytes, the same "render -> encode" shape every other ergonomic conversion in this package has. odbReportToPdf's options are DocumentToPdfOptions verbatim (the same type docxToPdf/odtToPdf/markdownToPdf already use).
export type { OdbReportToDocxOptions, OdbReportToOdtOptions } from './convert/convert';
export { odbReportToDocx, odbReportToOdt, odbReportToPdf } from './convert/convert';
export type { FirebirdBackupSummary, ReadFirebirdBackupResult } from './firebird/backup';
export {
  FirebirdBackupFormatError,
  readFirebirdBackup,
  SUPPORTED_BACKUP_FORMAT_VERSION as FIREBIRD_SUPPORTED_BACKUP_FORMAT_VERSION,
} from './firebird/backup';
export { FirebirdSchemaParseError } from './firebird/schema';
export { FirebirdCompositeRecordUnsupportedError, FirebirdDataParseError } from './firebird/data';
export { FirebirdUnsupportedFieldTypeError } from './firebird/blr-types';
export { FirebirdBackupParseError } from './firebird/reader';

// --- The swappable conversion port, for a caller that wants to inject a different (e.g. remote) implementation later without changing call sites. ---
export type { ConversionOptions, ConversionRequest, ConversionResult, Diagnostic, DocumentConverter, DocumentFormat, DocumentPayload } from './convert/port';
// DocumentFormat's own Zod schema, and every member as a plain runtime array derived from it -- for a caller that wants to enumerate or validate against the full format set (a CLI's own usage-error text, an MCP tool's JSON-schema `enum` input) without hand-writing a second copy of the ten format literals that could drift out of sync with DocumentFormat itself.
export { DocumentFormatSchema, DOCUMENT_FORMATS } from './convert/port';
export { createLocalDocumentConverter } from './convert/local';

// --- The composition engine's first-class entry point and supporting types -- resolveCompositionPlan exposes the pathfinder directly (the minimum-cost hop plan between any two DocumentFormats, or undefined), and convertDocument runs that plan end to end through the real executors. UnifiedConversionOptions is the union of every option field any conversion hop accepts, threaded to whichever hop consumes each field. ConversionPlan/CompositionHop describe a resolved route's shape. See src/convert/composition.ts for the full architecture. ---
export { convertDocument, resolveCompositionPlan } from './convert/composition';
export type { UnifiedConversionOptions, ConversionPlan, CompositionHop } from './convert/composition';

// --- A DocumentPackage (content + its fused positions) -> any DocumentFormat's own bytes -- the reverse of what every ergonomic X-to-PDF/PDF-to-X conversion's own onDocument callback hands back -- plus the frames-to-layout inverse the pdf target rebuilds through (exported for a caller wanting the pdf-codec view of a package's positions without writing bytes). ---
export { buildDocumentBytes, layoutDocumentFromPackage } from './convert/from-package';

// --- Raw package decode/encode, dispatched by DocumentFormat -- the format-aware counterpart to ooxml.js's/odf.js's own decodePackage/encodePackage, for a caller holding a format + bytes rather than already knowing which of the two underlying codecs applies. Covers docx/pptx/xlsx (ooxml.js's OPC container) and odt/odp/ods/odg/odf (odf.js's ODF container); markdown and pdf have no raw-package concept at all and throw UnsupportedPackageFormatError. decodeOdbPackage is the .odb-specific sibling: 'odb' is deliberately not a DocumentFormat member (see src/odb/'s own Architecture/Gotchas entries), but its bytes are an ordinary ODF package decoded by the identical odf.js decodePackage every readOdb*/odbTo* function in this package already starts from -- there is no encodeOdbPackage, since nothing here ever writes a new .odb file. ---
export { decodeDocumentPackage, decodeOdbPackage, encodeDocumentPackage, UnsupportedPackageFormatError } from './package-codec';

// --- Every DocumentFormat's own source-embedded font faces, dispatched by format -- the DocumentFormat-aware counterpart to extractSourceFonts/FontSourcePackage above, for a caller holding a format + bytes rather than an already-decoded Package. ---
export { extractSourceFontsForFormat, UnsupportedFontSourceFormatError } from './convert/document-fonts';

// --- Cross-format metadata read/write: a document's own title/author/subject/keywords/creator/producer/created/modified, resolved (and, for setDocumentMetadata, patched) by DocumentFormat across all ten formats this package supports. ---
export type { ReadDocumentMetadataOptions } from './metadata/read';
export { readDocumentMetadata } from './metadata/read';
export type { MetadataOverrides, SetDocumentMetadataOptions } from './metadata/write';
export { setDocumentMetadata } from './metadata/write';

// --- Ports a caller can inject: deterministic clocks (for reproducible PDF output in tests) and cancellation. ---
export type { ClockPort } from './ports/clock';
export { fixedClock, systemClock } from './ports/clock';
export { throwIfAborted } from './ports/abort';
