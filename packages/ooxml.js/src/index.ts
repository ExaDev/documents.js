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

// --- The shared content model: one block model (paragraphs, tables, images, page breaks) underlying both readDocxContent's sections and readPptxContent's slides, plus the geometry/colour/unit primitives it's expressed in. Sourced from document-schema.js, the sibling package that also backs documents.js's own PDF-side pivot -- these re-exports keep ooxml.js's own public API surface unchanged even though the definitions no longer live in this package. ---
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

// --- The fidelity construct vocabulary: the descriptor kinds a construct carries, and the flat form's constructStart/constructEnd marker pair that brackets the blocks one spans. readDocxContent produces these markers for every block-scoped docx construct (see typed/docx/constructs.ts) and buildDocxPackageFromContent writes them back, so they belong on this package's own surface alongside the block model they sit in. findConstructMarkerImbalance is document-schema.js's single shared definition of the bracket-matching contract, re-exported so a consumer validates a block list against the same check both halves of this package do. ---
export {
  ConstructDescriptorSchema,
  ContentControlDescriptorSchema,
  ContentControlTypeSchema,
  ContentControlLockSchema,
  FieldDescriptorSchema,
  AnchorDescriptorSchema,
  AnchorTypeSchema,
  LinkDescriptorSchema,
  LinkTargetSchema,
  ProvenanceDescriptorSchema,
  ProvenanceChangeSchema,
  DivisionDescriptorSchema,
  ContentConstructStartSchema,
  ContentConstructEndSchema,
  isContentConstructStart,
  isContentConstructEnd,
  findConstructMarkerImbalance,
} from 'document-schema.js';
export type {
  ConstructDescriptor,
  ContentControlDescriptor,
  ContentControlType,
  ContentControlLock,
  FieldDescriptor,
  AnchorDescriptor,
  AnchorType,
  LinkDescriptor,
  LinkTarget,
  ProvenanceDescriptor,
  ProvenanceChange,
  DivisionDescriptor,
  ContentConstructStart,
  ContentConstructEnd,
  ConstructMarkerImbalance,
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

// --- The DocumentPackage tree: the shape readDocx/readPptx/readXlsx return and buildDocxPackage/buildXlsxPackage accept, plus the node vocabulary a caller walks it with (one group per top-level container, headings and lists nested, constructs promoted to the region they span) and the four transforms between it and the flat ContentDocument. Sourced from document-schema.js and re-exported here for the same reason the content model above is: a caller of this package's own readers should be able to name, validate, and traverse what those readers hand back without taking a second dependency to do it. assemblePackage is what every reader here calls (decompose then the styles-minting pass); flattenPackage is what every writer here calls; decompose and factorStyles are for a caller composing its own boundary. ---
export {
  DocumentPackageSchema,
  SectionGroupSchema,
  SlideGroupSchema,
  SheetGroupSchema,
  DrawPageGroupSchema,
  ShapeGroupSchema,
  HeadingGroupSchema,
  ListGroupSchema,
  SectionConstructGroupSchema,
  ShapeConstructGroupSchema,
  PackageGroupSchema,
  PackageLeafSchema,
  PackageNodeSchema,
  PackageBlockLeafSchema,
  isSectionGroupNode,
  isSlideGroupNode,
  isSheetGroupNode,
  isDrawPageGroupNode,
  isShapeGroupNode,
  isHeadingGroupNode,
  isListGroupNode,
  isSectionConstructGroupNode,
  isShapeConstructGroupNode,
  isPackageGroup,
  isPackageLeaf,
  isPackageNode,
  isPackageBlockLeaf,
  assemblePackage,
  factorStyles,
  decompose,
  flattenPackage,
  ConstructMarkerImbalanceError,
} from 'document-schema.js';
export type {
  DocumentPackage,
  PackageChildren,
  SectionGroupNode,
  SlideGroupNode,
  SheetGroupNode,
  DrawPageGroupNode,
  ShapeGroupNode,
  HeadingGroupNode,
  ListGroupNode,
  SectionConstructGroupNode,
  ShapeConstructGroupNode,
  PackageGroup,
  PackageLeaf,
  PackageNode,
  PackageBlockLeaf,
  SectionChild,
  ShapeChild,
  ListChild,
  SheetChild,
  DrawPageChild,
  SectionDescriptor,
  SlideDescriptor,
  SheetDescriptor,
  DrawPageDescriptor,
  ShapeDescriptor,
  HeadingParagraph,
  ListParagraph,
} from 'document-schema.js';

// --- Style resolution: the pure helpers that turn a group's `style` ref plus a leaf's own direct properties into the properties that actually render, and the styles-table shapes those refs and the styles-minting pass above name. A tree reader's paragraphs and runs are NOT self-describing -- readDocx/readPptx/readXlsx factor repeated formatting into `styles` entries and leave only a `style: 's1'` ref on the enclosing group, stripping the matching keys off every paragraph/run that ref covers (see typed/document-package.ts's own module comment for why every reader mints rather than calling bare decompose). Reading a run or paragraph's real formatting out of a tree therefore means walking its ancestor groups' `style` refs and resolving them, which is exactly what these four functions do: resolveStyleChain collects the chain of entries from root to a given node, overlayStyleEntries merges that chain outermost-first (nearest wins), and applyParagraphStyleProperties/applyRunStyleProperties gap-fill a resolved entry onto a paragraph/run that already carries some direct properties of its own (a key the node already has always wins over the entry, never the reverse). Re-exported here for the same reason the tree vocabulary above is: a caller holding what readDocx/readPptx/readXlsx return should not need a second dependency just to read a run's own bold/colour back out of it. ---
export {
  StylesTableSchema,
  StyleEntrySchema,
  StyleParagraphPropertiesSchema,
  StyleRunPropertiesSchema,
  resolveStyleChain,
  overlayStyleEntries,
  applyParagraphStyleProperties,
  applyRunStyleProperties,
} from 'document-schema.js';
export type { StylesTable, StyleEntry, StyleParagraphProperties, StyleRunProperties } from 'document-schema.js';

export { applyColorTransforms } from './typed/shared/color';
export type { ColorTransform } from './typed/shared/color';

export { DocumentMetadataSchema } from './typed/shared/metadata';
export type { DocumentMetadata } from './typed/shared/metadata';

export { sniffImageFormat } from './image/sniff';
export type { ImageFormat } from './image/sniff';

// --- The DocumentPackage-native surface: one reader per format producing document-schema.js's tree-form DocumentPackage, one writer per format consuming it. These carry the primary names because the tree is what a caller holding a whole document wants; each wraps the flat, content-level function of the same format (readDocxContent/readPptxContent/readXlsxContent, buildDocxPackageFromContent/buildXlsxPackageFromContent, all still exported below) through assemblePackage on the way out and flattenPackage on the way in. See typed/document-package.ts for why every reader mints styles rather than calling bare decompose, and for what a docx's comments/footnotes/headers/footers/numbering do instead of riding the tree. ---
export { readDocx, buildDocxPackage, readPptx, readXlsx, buildXlsxPackage } from './typed/document-package';

// --- docx: a WordprocessingML reader resolving the full style cascade (docDefaults -> named-style basedOn chains -> paragraph-mark run properties -> character styles -> direct formatting) and DrawingML theme references (including w:themeColor run colours) into ordered sections of paragraphs/tables/page-breaks, with every block-scoped fidelity construct (structured document tags, fields, bookmarks, tracked changes) bracketed by construct-boundary markers -- paired with buildDocxPackageFromContent, its write-side inverse over those same sections. This is the flat pair readDocx/buildDocxPackage above wrap, exported in its own right: DocxDocument's comments, footnotes, headers, footers, and numbering definitions have no ContentDocument spelling and therefore no tree spelling, so readDocxContent is the only reader in this package that returns them at all. ---
export { readDocxContent, CommentSchema, DocxDocumentSchema, FootnoteSchema } from './typed/docx/read';
export type { Comment, DocxDocument, Footnote } from './typed/docx/read';
export { buildDocxPackageFromContent } from './typed/docx/write';
export type { DocxContent } from './typed/docx/write';

// word/numbering.xml's own abstractNum/num level definitions (glyph format, start-at value, restart rule) -- a companion to, not a replacement for, ContentListMembership's existing per-paragraph numId/level tracking. See numbering.ts's own doc comment for why this is a separate keyed structure rather than a ContentListMembership field.
export { NumberingDefinitionSchema, NumberingLevelSchema, readNumberingDefinitions } from './typed/docx/numbering';
export type { NumberingDefinition, NumberingDefinitions, NumberingLevel } from './typed/docx/numbering';

// --- pptx: a PresentationML reader resolving the placeholder -> layout -> master -> theme inheritance cascade and DrawingML geometry into slides of positioned, styled shapes. The flat half of readPptx above; read-only either way, since this package has no PresentationML writer. ---
export { readPptxContent, PptxDocumentSchema } from './typed/pptx/read';
export type { PptxDocument } from './typed/pptx/read';

// The lossy, cell-values-only xlsx reading view (sheet names, cell references, resolved values, formulas, merged ranges, defined names -- no formats, styles, geometry, or charts), with no write side and no ContentDocument shape. It held the name readXlsx until that name went to the package-native reader above; readXlsxWorkbook says what it returns, exactly as readXlsxContent beside it does.
export { readXlsxWorkbook, XlsxWorkbookSchema, XlsxSheetSchema, XlsxCellSchema, DefinedNameSchema } from './typed/xlsx';
export type { XlsxWorkbook, XlsxSheet, XlsxCell, DefinedName } from './typed/xlsx';

// --- xlsx (rich): a geometry- and print-settings-rich SpreadsheetML reader/writer pair around ContentDocument (kind: 'spreadsheet') -- column widths, row heights, hidden rows/columns, merged ranges, every cell value kind xlsx itself distinguishes, cell comments (legacy notes and [MS-XLSX] threads), and print settings (page size/margins/scale/fit-to-page/repeat rows-columns/gridlines/headers/page order/manual breaks). readXlsxContent matches readOds's own established bar in the sibling odf.js package; buildXlsxPackageFromContent is this package's first writer of genuinely new xlsx content, the read side's honest inverse (comments excepted: the reader reads them, the writer emits no comment part, so they do not survive this pair). Distinct from readXlsxWorkbook above (XlsxWorkbook, a lossy one-way cell-values-only projection with no write side) -- both stay exported since they serve different callers. ---
export { readXlsxContent } from './typed/xlsx/content';
export { buildXlsxPackageFromContent } from './typed/xlsx/build';

