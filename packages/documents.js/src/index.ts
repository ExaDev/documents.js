// documents.js's public surface: bidirectional conversion among docx/pptx/xlsx/odt/odp/ods/odg/markdown/csv/svg and PDF (every content format's own PDF round trip plus the cross-format bridges), a read+write live-view editor for docx/pptx/odt/odp/ods/odg, and a hand-written PDF codec, built on ooxml.js's lossless OOXML core, odf.js's lossless ODF core, and markdown-codec.

// --- ooxml.js's lossless OOXML core, re-exported so consumers need only this one dependency. Its own tree-form typed readers readDocx/readPptx/readXlsx (DocumentTree readers since ooxml.js 4.0.0) and the separate lossy cell-values-only readXlsxWorkbook are deliberately NOT re-exported here: readDocxContent/readPptxContent (below) already wrap the flat readers into ContentDocument, so exposing both the wrapper and the thing it wraps would be a trap -- two overlapping entry points to the same underlying read. readXlsxContent/buildXlsxPackage are the one exception -- re-exported directly further below, in the Format <-> ContentDocument readers section, rather than from here or behind a documents.js-local wrapper: unlike the docx/pptx pair, readXlsxContent already reads (and the aliased buildXlsxPackage already builds) a real spreadsheet ContentDocument on its own, so there is no wrapper to write and no second, overlapping entry point to trap a caller into picking the wrong one. The flat reader's own comments/footnotes/headers/footers/numbering, which ContentDocument doesn't model at all, are not lost, though -- see readDocxExtras below, which exposes that data as its own real return type rather than by re-exporting the reader itself. Comment/Footnote/NumberingDefinitions/HeaderFooterPart/SectionHeaderFooterReferences (ooxml.js's own types, reused by readDocxExtras' own return shape) are re-exported here since they're genuinely just data types, not a second entry point to the same read. ---
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
  type HeaderFooterPart,
  HeaderFooterPartSchema,
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
  type SectionHeaderFooterReferences,
  SectionHeaderFooterReferencesSchema,
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

// --- The PDF-side pivot model. The Layout* item family moved to pdf-codec at document-schema.js 4.0.0 (the demotion: a LayoutDocument is the pdf codec's own read/write artefact, not a shared pivot), so the item types and LAYOUT_FORMAT_VERSION re-export from pdf-codec here, while LayoutMetadata/LayoutFont/LayoutFrame -- the members the content model itself references -- stay re-exported from the schema with the shared primitives below. ---
export type { LayoutDocument, LayoutEllipse, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLine, LayoutLink, LayoutPage, LayoutPath, LayoutPathSegment, LayoutRect, LayoutSubpath, LayoutText } from 'pdf-codec';
export { LAYOUT_FORMAT_VERSION, LayoutDocumentSchema } from 'pdf-codec';
export type { LayoutMetadata } from 'document-schema.js';

// --- document-schema.js's own tree-form DocumentTree (structure, layout, and content fused in one tree since 4.0.0) and its self-describing-JSON helpers. contentDocumentWithSchema / documentSchemaKindOf / documentFromJson's ContentDocument branch / ContentDocumentJson all operate on the identical ContentDocument type exported above. The package's own layoutDocumentWithSchema/LayoutDocumentJson exports retired with the demotion: a LayoutDocument has no schema-stamped JSON envelope any more, it is a pdf-codec value. ---
export type {
  ContentDocumentJson,
  DocumentJsonResult,
  DocumentSchemaKind,
  DocumentTree,
  DocumentTreeJson,
} from 'document-schema.js';
export {
  contentDocumentWithSchema,
  documentFromJson,
  documentSchemaKindOf,
  DocumentTreeSchema,
  documentTreeWithSchema,
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
// Magic-byte-validated Uint8Array schemas, so a caller passing the wrong format -- to these functions directly, or as the input/output schema half of a z.codec() below -- gets a clear Zod validation error instead of a confusing failure three layers down. The Odt/Ods/Odp/Odg schemas check the package's actual declared media type (see src/model/bytes.ts), a stronger check than Docx/PptxBytesSchema's generic ZIP-signature check. MarkdownBytesSchema and CsvBytesSchema are architecturally different from every other schema here -- each checks only well-formed UTF-8, since markdown and csv are plain text with no magic bytes or format-level header of their own to check (see src/model/bytes.ts's own comment). SvgBytesSchema sits in between: svg is plain text too, but it has a recognisable root element, so its schema additionally requires the decoded text to contain an <svg tag.
export { CsvBytesSchema, DocxBytesSchema, MarkdownBytesSchema, OdgBytesSchema, OdpBytesSchema, OdsBytesSchema, OdtBytesSchema, PdfBytesSchema, PptxBytesSchema, SvgBytesSchema, XlsxBytesSchema } from './model/bytes';

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
export { buildPptxPackage, embeddedPresentationSerialiser } from './edit/pptx/content';

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
export { PdfEllipseItem, PdfImageItem, PdfInternalLinkItem, PdfLineItem, PdfLinkItem, PdfPathItem, PdfRectItem, PdfTextItem } from './edit/pdf/item';

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

// --- MathML presentation-layer typesetting: a pure box-model layout engine (no PDF or ODF knowledge of its own -- see src/mathml/'s own module comments), consuming odf.js's readOdfFormulaMathMl's own raw MathML tree via a locally-defined, structurally-compatible node type. odfToPdf (below) and the odt/odp embedded-formula layout paths (src/layout/engine.ts, src/layout/slides.ts) are its two real callers; exported directly too, for a caller that wants to lay out a formula (e.g. onto a custom page layout) without going through either. ---
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

// --- MathML <-> OMML (ECMA-376 Part 1's own Office Math Markup Language) structural translation, both directions. buildOfficeMath/buildOfficeMathParagraph are the WRITE side, the counterpart to layoutFormula above: they cover the identical construct set, so a formula rendered to PDF and the same formula written into a docx degrade in exactly the same places (buildDocxPackage is their real caller -- an embedded formula becomes genuine, editable Word math rather than a plain-text stand-in). readOfficeMath/collectOfficeMathElements are the READ side, the structural inverse: they recover a Word-authored equation as real MathML, which is what makes readDocxContent carry a formula through at all (ooxml.js's own readDocxContent has no m:oMath handling whatsoever). Both are exported directly for a caller assembling or mining OOXML math itself, e.g. in a docx opened through openDocx. ---
export type { OmmlDiagnostic, OmmlDiagnosticKind } from './omml/shared';
export type { OmmlWriteResult } from './omml/write';
export { buildOfficeMath, buildOfficeMathParagraph } from './omml/write';
export type { OmmlReadResult } from './omml/read';
export { collectOfficeMathElements, readOfficeMath } from './omml/read';

// --- LaTeX presentation -> the MathExpression semantic core (src/latex/): the string-to-tree half of document-schema.js's two-layer math model, over a pinned temml parser. lowerLatex is the direct entry point for a caller holding a LaTeX string; latexToFormula wraps it into a whole ContentFormula (verbatim presentation + presentation-MathML + lowered content + provenance) ready to embed the way every other formula in this package travels. The lowering is mechanical where notation is unambiguous (\frac -> math:divide, radicals -> math:sqrt/n-th root, scripted Sigma/Product -> sum/prod binders, numeric literals -> exact rationals, subscripts -> distinct symbol identities) and degrades everything context-starved to visible `unparsed` nodes carrying the verbatim source plus a named diagnostic -- never a parse failure, never a silent guess. The markdown read path runs this lowering automatically over markdown-codec's preserved $$ display blocks and \( \) inline spans (readMarkdownContent's third parameter surfaces the diagnostics). lintMathCoherence is the model's read-only audit: it re-parses and re-lowers every stored presentation string and reports divergence from the stored content layer as a warning carrying provenance -- a deliberate layer edit, never something this package re-derives. ---
export type { LatexDiagnostic, LatexDiagnosticCode, LatexDiagnosticSink } from './latex/diagnostics';
export { LATEX_DIAGNOSTIC_CODES, MATH_LINT_CODES } from './latex/diagnostics';
export type { MathLintDiagnostic, MathLintCode } from './latex/diagnostics';
export type { LatexFormulaOptions, LatexFormulaResult, LatexLoweringResult, LowerLatexOptions } from './latex/lower';
export { latexToFormula, lowerLatex } from './latex/lower';
export { lintMathCoherence } from './latex/lint';
export type { MarkdownMathLoweringOptions } from './markdown/math';
export { lowerMarkdownMath } from './markdown/math';


// --- Format <-> ContentDocument readers and layout algorithms, each independently usable rather than only reachable through the ergonomic conversions below. ---
export type { ReadDocxContentOptions } from './ooxml/docx/read';
export { readDocxContent } from './ooxml/docx/read';
// The docx-specific data readDocxContent above genuinely cannot carry through ContentDocument -- comments, footnotes, headers/footers, and numbering (abstractNum/num) definitions -- exposed as its own real return type rather than forced into a shape that doesn't model it.
export type { DocxExtras } from './ooxml/docx/extras';
export { readDocxExtras } from './ooxml/docx/extras';
export { readPptxContent } from './ooxml/pptx/read';
// xlsx has no documents.js-local wrapper the way docx/pptx do above: ooxml.js's own readXlsxContent already produces a real spreadsheet ContentDocument directly (not the separate, lossy, cell-values-only readXlsxWorkbook view, which stays unexported per this module's own top-of-file note), so it's re-exported as-is here, alongside its write-side counterpart -- the same read/build pair the ods<->xlsx bridge (src/convert/composition.ts) and every xlsx metadata-rebuild path (src/codecs/registry.ts) already use internally, now reachable without going through either. Since ooxml.js 4.0.0 the upstream flat builder is named buildXlsxPackageFromContent (the bare buildXlsxPackage name moved to that package's tree-form DocumentTree builder); this package's own public name stays buildXlsxPackage, aliased to the flat builder, so this export's ContentDocument-in/Package-out contract is unchanged for consumers. Comparatively newer than the ODF/DrawingML readers below: see src/convert/bridges.test.ts's own ods<->xlsx section for the exact, currently-tested fidelity gaps (an ODS-style time-only value has no xlsx serial to write into and degrades to a plain string cell; a written column width survives a read back within about a point of its original value, an algebraic-inverse rounding artifact in the character-width unit conversion, not a dropped value).
export { buildXlsxPackageFromContent as buildXlsxPackage, readXlsxContent } from 'ooxml.js';
export { readOdtContent } from './odf/odt/read';
export { readOdpContent } from './odf/odp/read';
export { readOdsContent } from './odf/ods/read';
export { readOdgContent } from './odf/odg/read';
export { readOdfEmbeddedFormula, readOdfFormulaContent } from './odf/formula/read';
// markdown <-> ContentDocument -- readMarkdownContent/buildMarkdownText are thin adapters over markdown-codec's own readMarkdownContent/writeMarkdownContent (see src/markdown/read.ts's own module comment), never re-exported here directly for the same reason ooxml.js's flat docx/pptx readers aren't (see this section's own top-of-file note): markdown-codec's own readMarkdownContent/writeMarkdownContent operate on document-schema.js's ContentDocument shape directly, a nominally different type from this package's own local ContentDocument above, so exposing both would invite a caller to reach for the wrong one. decodeMarkdownText/encodeMarkdownText are the byte<->text boundary markdown-codec itself has no opinion on (it operates on strings, not bytes) -- exported for a caller composing readMarkdownContent/buildMarkdownText directly, matching every other independently-exported pipeline stage in this section. Construct markers pass straight through to markdown-codec's own writer, which resolves them as balanced brackets and renders each construct it has a markdown spelling for (a footnote, a blockquote division, a titled image) and renders the rest transparently.
export { decodeMarkdownText, encodeMarkdownText } from './markdown/text';
export { readMarkdownContent } from './markdown/read';
export { buildMarkdownText } from './markdown/write';
// csv <-> ContentDocument -- the same independently-usable pipeline stages the other adapter families above expose: decodeCsvText/encodeCsvText are the byte<->text boundary, readCsvContent parses RFC 4180 text into a one-sheet spreadsheet ContentDocument (first record as the header row, data cells heuristically re-typed by inferCellValue -- the identical heuristic pdfToOds applies, exported standalone further above), buildCsvText writes a sheet back out emitting each cell's displayText. TSV is a delimiter option on these same stages ({ delimiter: '\t' }), not a separate format. The errors are exported beside them so a caller composing the stages directly can branch on them by class: CsvInvalidUtf8Error (malformed bytes at the decode boundary), CsvParseError (RFC 4180 violations -- an unterminated quoted field, a multi-character delimiter), CsvUnsupportedDocumentKindError (a non-spreadsheet ContentDocument), and the multi-sheet selection pair CsvSheetNotSpecifiedError/CsvSheetNotFoundError -- the identical contract odbToCsv's own table selection follows.
export { decodeCsvText, encodeCsvText } from './csv/text';
export { CsvInvalidUtf8Error } from './csv/text';
export { readCsvContent } from './csv/read';
export type { ReadCsvContentOptions } from './csv/read';
export { buildCsvText } from './csv/write';
export type { BuildCsvTextOptions } from './csv/write';
export { CsvSheetNotFoundError, CsvSheetNotSpecifiedError, CsvUnsupportedDocumentKindError } from './csv/write';
export { CsvParseError } from './csv/records';
// svg <-> ContentDocument -- the fifth adapter family, sharing the drawing variant with odg: decodeSvgText/encodeSvgText are the byte<->text boundary (rejecting malformed UTF-8 exactly as the csv/markdown boundaries do), readSvgContent maps the six SVG shape primitives (rect/circle/ellipse/line/polyline/polygon/path) onto a one-page drawing ContentDocument, and buildSvgText writes them back out. The errors are exported beside them so a caller composing the stages directly can branch on them by class: SvgInvalidUtf8Error (malformed bytes at the decode boundary), SvgMissingRootElementError (text with no <svg root), SvgUnsupportedDocumentKindError (a non-drawing ContentDocument), and the multi-page selection pair SvgMultiPageNotSpecifiedError/SvgPageNotFoundError -- the identical contract buildCsvText holds for sheets, carried by page index because drawing pages are anonymous. SVG_DIAGNOSTIC_CODES is the full vocabulary of scope limits and bounded approximations both directions report through onSvgDiagnostic (text, gradients, images, CSS, and <use> degrade under a diagnostic, never silently).
export { decodeSvgText, encodeSvgText, SvgInvalidUtf8Error } from './svg/text';
export { readSvgContent } from './svg/read';
export type { ReadSvgContentOptions } from './svg/read';
export { SvgMissingRootElementError } from './svg/read';
export { buildSvgText } from './svg/write';
export type { BuildSvgTextOptions } from './svg/write';
export { SvgMultiPageNotSpecifiedError, SvgPageNotFoundError, SvgUnsupportedDocumentKindError } from './svg/write';
export { SVG_DIAGNOSTIC_CODES } from './svg/diagnostics';
export type { SvgDiagnostic, SvgDiagnosticCode, SvgDiagnosticSink } from './svg/diagnostics';
// The one-way ContentDocument -> Markdown text renderer covering all five ContentDocument kinds, not just 'wordprocessing' -- buildMarkdownText/markdown-codec's writeMarkdownContent above throw MarkdownUnsupportedDocumentKindError for the other four. renderContentDocumentToMarkdown delegates straight to buildMarkdownText for 'wordprocessing' and otherwise flattens slides/sheets/drawing pages/a bare formula into the same ContentBlock vocabulary first, reporting every degrade decision through its own onDiagnostic option (see src/markdown/render.ts's own module comment).
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

// --- The ergonomic X <-> PDF conversions (docx/pptx/odt/odp/ods/odg/xlsx/markdown/csv/svg <-> PDF, all round-trip both ways). xlsx<->pdf and csv<->pdf each compose their same-variant ods bridge with the ods<->pdf layout pair internally -- neither xlsx nor csv has a layout engine of its own -- but both are real, direct, single-call conversion pairs from a caller's own point of view. The csv pairs intersect convert.ts's own CsvReadOptions (delimiter, onCellTypeInference) / CsvWriteOptions (delimiter, sheet) into the shared options type each already uses -- the two option groups every csv-sourced/csv-targeted conversion consumes -- and the svg pairs intersect SvgReadOptions (onSvgDiagnostic) / SvgWriteOptions (page, onSvgDiagnostic) the same way. markdown<->pdf (markdownToPdf/pdfToMarkdown) DOES lay markdown out directly, reusing convertWordprocessingToLayout/reconstructWordprocessing completely unmodified -- but pdfToMarkdown is the single lossiest conversion in the whole package (see convert.ts's own top-of-file comment and the README's Fidelity section). svg<->pdf lays out directly too (the same convertDrawingToLayout/reconstructDrawing pair odg feeds), with the reader's scope limits as its only lossiness. ---
export type { CsvReadOptions, CsvWriteOptions, DocumentToPdfOptions, SvgReadOptions, SvgWriteOptions } from './convert/convert';
export type { PdfToDocumentOptions } from './convert/from-pdf';
export { csvToPdf, docxToPdf, markdownToPdf, odgToPdf, odpToPdf, odsToPdf, odtToPdf, pptxToPdf, svgToPdf, xlsxToPdf } from './convert/convert';
export { pdfToCsv, pdfToDocx, pdfToMarkdown, pdfToOdg, pdfToOdp, pdfToOds, pdfToOdt, pdfToPptx, pdfToSvg, pdfToXlsx } from './convert/from-pdf';

// --- odf (a standalone ODF formula document) -> PDF: not one of the round-trip conversions above (there is no pdfToOdf -- see convert.ts's own module comment on odfToPdf for why: recovering structured MathML from rendered glyphs is a categorically different, OCR-adjacent problem, not a geometry-reconstruction one). Renders via src/mathml's layoutFormula and the embedded STIX Two Math font, the same pipeline the odt/odp embedded-formula paths use. ---
export { odfToPdf } from './convert/convert';

// Schema-validated z.codec() pairs over the conversions above (docx/pptx/odt/odp/ods/odg/xlsx/markdown/csv/svg bytes <-> PDF bytes), the no-extra-options form -- use the named conversion functions directly for cancellation, diagnostics, the csv delimiter/sheet options, or the svg page/onSvgDiagnostic options.
export { csvPdfCodec, docxPdfCodec, markdownPdfCodec, odgPdfCodec, odpPdfCodec, odsPdfCodec, odtPdfCodec, pptxPdfCodec, svgPdfCodec, xlsxPdfCodec } from './convert/codec';

// --- The cross-format bridges: same-variant direct copies (odt<->docx, odp<->pptx, ods<->xlsx, csv<->ods, csv<->xlsx, svg<->odg, markdown<->docx, markdown<->odt) and cross-variant semantic transforms (docx<->pptx, odt<->odp) bypass PDF entirely -- see convert.ts's own module comment on this section for why those carry substantially higher fidelity than the PDF-pivot conversions above. The remaining two pairs (xlsx<->markdown, csv<->markdown) are PDF-composed internally, the last-resort routes the pathfinder picks when no shorter path exists. ---
export type { DocumentBridgeOptions } from './convert/convert';
export { csvToMarkdown, csvToOds, csvToXlsx, docxToMarkdown, docxToOdt, markdownToCsv, markdownToDocx, markdownToOdt, odgToSvg, odpToPptx, odsToCsv, odsToXlsx, odtToDocx, odtToMarkdown, pptxToOdp, svgToOdg, xlsxToCsv, xlsxToOds, docxToPptx, pptxToDocx, odtToOdp, odpToOdt, xlsxToMarkdown, markdownToXlsx } from './convert/convert';

// Schema-validated z.codec() pairs over the bridges above (odt bytes <-> docx bytes, odp bytes <-> pptx bytes, ods bytes <-> xlsx bytes, ods/xlsx bytes <-> csv bytes, odg bytes <-> svg bytes, markdown bytes <-> docx/odt bytes, csv bytes <-> markdown bytes), the no-extra-options form -- use the named bridge functions directly for cancellation, the csv delimiter/sheet options, or the svg page/onSvgDiagnostic options.
export { csvMarkdownCodec, markdownDocxCodec, markdownOdtCodec, odgSvgCodec, odsCsvCodec, odpPptxCodec, odsXlsxCodec, odtDocxCodec, xlsxCsvCodec, xlsxMarkdownCodec } from './convert/codec';

// --- odm (ODF master document, multiple chapters) -> PDF, the one conversion in this package shaped differently from every other: a .odm's chapters are external references (odf.js's readOdm never inlines them -- see odmToPdf's own module comment), so producing a PDF needs a caller-supplied resolveSubDocument callback to hand back each chapter's own .odt bytes. Not part of the conversion or bridge groups above, and not wired into the DocumentConverter port below -- see odmToPdf's own module comment for why. ---
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
// A .odb's own Form/Report STRUCTURE (as opposed to readOdbTables' table DATA): odf.js 2.0.0's OdbInventory.forms/.reports are now OdbComponentInfo[] (name + href, a breaking change from 1.x's plain string[]), and its own readOdbForm/readOdbReport resolve one named component into its real static structure -- a form's bound controls (readOdtContent's own document plus form:form/form:control-implementation definitions) or a report's bands/groups/functions (rpt:report-header/rpt:group/rpt:detail, parsed directly from the report sub-document). Both are re-exported here unmodified, matching the "each pipeline stage independently usable" convention readOdbTables/decodeHsqldbCachedTables/readFirebirdBackup already follow; readOdbForms/readOdbReports (src/odb/components.ts) are this package's own "read every declared one at once" convenience, calling readOdbForm/readOdbReport once per name discovered via readOdbInventory -- the readOdbTables-shaped one-call ergonomic this data did not have until odf.js 2.0.0 made forms/reports real.
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
// DocumentFormat's own Zod schema, and every member as a plain runtime array derived from it -- for a caller that wants to enumerate or validate against the full format set (a CLI's own usage-error text, an MCP tool's JSON-schema `enum` input) without hand-writing a second copy of the format literals that could drift out of sync with DocumentFormat itself.
export { DocumentFormatSchema, DOCUMENT_FORMATS } from './convert/port';
export { createLocalDocumentConverter } from './convert/local';

// --- The composition engine's first-class entry point and supporting types -- resolveCompositionPlan exposes the pathfinder directly (the minimum-cost hop plan between any two DocumentFormats, or undefined), and convertDocument runs that plan end to end through the real executors. UnifiedConversionOptions is the union of every option field any conversion hop accepts, threaded to whichever hop consumes each field. ConversionPlan/CompositionHop describe a resolved route's shape. The engine is split read/write by module: composition.ts holds the registry, pathfinder, and bridge/fromPdf executors, composition-to-pdf.ts the toPdf executor and the full convertDocument binding -- see those modules' own headers. ---
export { resolveCompositionPlan } from './convert/composition';
export { convertDocument } from './convert/composition-to-pdf';
export type { UnifiedConversionOptions, ConversionPlan, CompositionHop } from './convert/composition';

// --- A DocumentTree (content + its fused positions) -> any DocumentFormat's own bytes -- the reverse of what every ergonomic X-to-PDF/PDF-to-X conversion's own onDocument callback hands back -- plus the frames-to-layout inverse the pdf target rebuilds through (exported for a caller wanting the pdf-codec view of a package's positions without writing bytes). ---
export { buildDocumentBytes, layoutDocumentFromPackage } from './convert/from-package';

// --- Raw package decode/encode, dispatched by DocumentFormat -- the format-aware counterpart to ooxml.js's/odf.js's own decodePackage/encodePackage, for a caller holding a format + bytes rather than already knowing which of the two underlying codecs applies. Covers docx/pptx/xlsx (ooxml.js's OPC container) and odt/odp/ods/odg/odf (odf.js's ODF container); markdown, csv, svg, and pdf have no raw-package concept at all and throw UnsupportedPackageFormatError. decodeOdbPackage is the .odb-specific sibling: 'odb' is deliberately not a DocumentFormat member (see src/odb/'s own Architecture/Gotchas entries), but its bytes are an ordinary ODF package decoded by the identical odf.js decodePackage every readOdb*/odbTo* function in this package already starts from -- there is no encodeOdbPackage, since nothing here ever writes a new .odb file. ---
export { decodeDocumentPackage, decodeOdbPackage, encodeDocumentPackage, UnsupportedPackageFormatError } from './package-codec';

// --- Every DocumentFormat's own source-embedded font faces, dispatched by format -- the DocumentFormat-aware counterpart to extractSourceFonts/FontSourcePackage above, for a caller holding a format + bytes rather than an already-decoded Package. ---
export { extractSourceFontsForFormat, UnsupportedFontSourceFormatError } from './convert/document-fonts';

// --- Cross-format metadata read/write: a document's own title/author/subject/keywords/creator/producer/created/modified, resolved (and, for setDocumentMetadata, patched) by DocumentFormat across every format this package supports -- csv reads honestly empty (RFC 4180 text has no metadata container) and is rejected as a setDocumentMetadata source/target for exactly that reason; svg reads its root <title> and is rejected on the write side because <title> is its whole metadata surface, so any other override would be silently dropped. ---
export type { ReadDocumentMetadataOptions } from './convert/from-pdf';
export { readDocumentMetadata } from './convert/from-pdf';
export type { MetadataOverrides, SetDocumentMetadataOptions } from './metadata/write';
export { setDocumentMetadata } from './metadata/write';

// --- Ports a caller can inject: deterministic clocks (for reproducible PDF output in tests) and cancellation. ---
export type { ClockPort } from './ports/clock';
export { fixedClock, systemClock } from './ports/clock';
export { throwIfAborted } from './ports/abort';
