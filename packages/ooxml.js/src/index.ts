export { packageCodec, xmlCodec, decodePackage, encodePackage } from './codec';
export { parsePackage } from './package-io/read';
export { serializePackage } from './package-io/write';
export { parseXml } from './xml/parse';
export { buildXml } from './xml/build';
export { el, txt } from './xml/fragment';
export { encodeXmlText } from './xml/entities';
export { unzipPackage, zipPackage } from './zip';
export { bytesToBase64, base64ToBytes } from './util/base64';

export {
  walk,
  elementsWithTag,
  childrenWithTag,
  attr,
  rootElement,
  decodeEntities,
  textContent,
  resolveRelationships,
} from './typed/util';
export type { Relationship } from './typed/util';

export {
  XmlNodeSchema,
  XmlElementSchema,
  AttributeSchema,
  XmlTextSchema,
  XmlCdataSchema,
  XmlCommentSchema,
  XmlDeclarationSchema,
  XmlPiSchema,
  isXmlNode,
} from './model/node';
export type {
  XmlNode,
  XmlElement,
  Attribute,
  XmlText,
  XmlCdata,
  XmlComment,
  XmlDeclaration,
  XmlPi,
} from './model/node';

export { XmlPartSchema, BinaryPartSchema, PartSchema, PackageSchema } from './model/package';
export type { XmlPart, BinaryPart, Part, Package } from './model/package';

export {
  compactCodec,
  toCompact,
  fromCompact,
  compactPackageCodec,
  decodeCompactPackage,
  encodeCompactPackage,
  CompactPackageSchema,
  CompactPartSchema,
  CompactXmlNodeSchema,
  isCompactXmlNode,
} from './compact';
export type { CompactPackage, CompactPart, CompactXmlNode, CompactAttrPairs } from './compact';

// --- The shared content model: one block model (paragraphs, tables, images, page breaks) underlying both readDocx's sections and readPptx's slides, plus the geometry/colour/unit primitives it's expressed in. Sourced from document-schema.js, the sibling package that also backs documents.js's own PDF-side pivot -- these re-exports keep ooxml.js's own public API surface unchanged even though the definitions no longer live in this package. ---
export {
  BoxSchema,
  MarginsSchema,
  PageSizeSchema,
  PAGE_SIZE_A4,
  PAGE_SIZE_LETTER,
  SLIDE_SIZE_STANDARD,
  SLIDE_SIZE_WIDESCREEN,
  COLOR_BLACK,
  ColorSchema,
  colorToRgbHex,
  rgbHexToColor,
  AlignmentSchema,
  ContentBlockSchema,
  ContentBorderSchema,
  ContentCellBordersSchema,
  ContentImageBlockSchema,
  ContentListMembershipSchema,
  ContentPageBreakSchema,
  ContentParagraphSchema,
  ContentRunSchema,
  ContentSectionSchema,
  ContentShapeSchema,
  ContentSlideSchema,
  ContentStrokeStyleSchema,
  ContentTableCellSchema,
  ContentTableRowSchema,
  ContentTableSchema,
  isContentBlock,
  ContentDocumentSchema,
  ContentCellValueSchema,
  ContentSheetSchema,
  ContentSheetCellSchema,
  ContentSheetColumnSchema,
  ContentSheetRowSchema,
  ContentSheetImageSchema,
  ContentSheetPrintRangeSchema,
  ContentSheetRepeatRangeSchema,
  ContentSheetPrintSettingsSchema,
} from 'document-schema.js';
export type {
  Box,
  Margins,
  PageSize,
  Color,
  Alignment,
  ContentBlock,
  ContentBorder,
  ContentCellBorders,
  ContentImageBlock,
  ContentListMembership,
  ContentPageBreak,
  ContentParagraph,
  ContentRun,
  ContentSection,
  ContentShape,
  ContentSlide,
  ContentStrokeStyle,
  ContentTable,
  ContentTableCell,
  ContentTableRow,
  ContentDocument,
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetRow,
  ContentSheetImage,
  ContentSheetPrintRange,
  ContentSheetRepeatRange,
  ContentSheetPrintSettings,
} from 'document-schema.js';

export { applyColorTransforms } from './typed/shared/color';
export type { ColorTransform } from './typed/shared/color';

export { DocumentMetadataSchema } from './typed/shared/metadata';
export type { DocumentMetadata } from './typed/shared/metadata';

export { sniffImageFormat } from './image/sniff';
export type { ImageFormat } from './image/sniff';

// --- docx: a WordprocessingML reader resolving the full style cascade (docDefaults -> named-style basedOn chains -> paragraph-mark run properties -> character styles -> direct formatting) and DrawingML theme references (including w:themeColor run colours) into ordered sections of paragraphs/tables/page-breaks. ---
export { readDocx, CommentSchema, DocxDocumentSchema, FootnoteSchema } from './typed/docx/read';
export type { Comment, DocxDocument, Footnote } from './typed/docx/read';

// word/numbering.xml's own abstractNum/num level definitions (glyph format, start-at value, restart rule) -- a companion to, not a replacement for, ContentListMembership's existing per-paragraph numId/level tracking. See numbering.ts's own doc comment for why this is a separate keyed structure rather than a ContentListMembership field.
export { NumberingDefinitionSchema, NumberingLevelSchema, readNumberingDefinitions } from './typed/docx/numbering';
export type { NumberingDefinition, NumberingDefinitions, NumberingLevel } from './typed/docx/numbering';

// --- pptx: a PresentationML reader resolving the placeholder -> layout -> master -> theme inheritance cascade and DrawingML geometry into slides of positioned, styled shapes. ---
export { readPptx, PptxDocumentSchema } from './typed/pptx/read';
export type { PptxDocument } from './typed/pptx/read';

export { readXlsx, XlsxWorkbookSchema, XlsxSheetSchema, XlsxCellSchema, DefinedNameSchema } from './typed/xlsx';
export type { XlsxWorkbook, XlsxSheet, XlsxCell, DefinedName } from './typed/xlsx';

// --- xlsx (rich): a geometry- and print-settings-rich SpreadsheetML reader/writer pair around ContentDocument (kind: 'spreadsheet') -- column widths, row heights, hidden rows/columns, merged ranges, every cell value kind xlsx itself distinguishes, cell comments (legacy notes and [MS-XLSX] threads), and print settings (page size/margins/scale/fit-to-page/repeat rows-columns/gridlines/headers/page order/manual breaks). readXlsxContent matches readOds's own established bar in the sibling odf.js package; buildXlsxPackage is this package's first writer of genuinely new xlsx content, the read side's honest inverse (comments excepted: the reader reads them, the writer emits no comment part, so they do not survive this pair). Distinct from readXlsx above (XlsxWorkbook, a lossy one-way cell-values-only projection with no write side) -- both stay exported since they serve different callers. ---
export { readXlsxContent } from './typed/xlsx/content';
export { buildXlsxPackage } from './typed/xlsx/build';

