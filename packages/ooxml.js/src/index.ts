export { packageCodec, xmlCodec, decodePackage, encodePackage } from './codec';
export { parsePackage } from './package-io/read';
export { serializePackage } from './package-io/write';
export { parseXml } from './xml/parse';
export { buildXml } from './xml/build';
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

export {
  readDocx,
  DocxDocumentSchema,
  ParagraphSchema,
  RunSchema,
  ListMembershipSchema,
  TableSchema,
  TableRowSchema,
  TableCellSchema,
  HyperlinkSchema,
  CommentSchema,
  FootnoteSchema,
} from './typed/docx';
export type {
  DocxDocument,
  Paragraph,
  Run,
  ListMembership,
  Table,
  TableRow,
  TableCell,
  Hyperlink,
  Comment,
  Footnote,
} from './typed/docx';

export {
  readPptx,
  PptxPresentationSchema,
  SlideSchema,
  ShapeSchema,
  PptxTableSchema,
  PptxTableRowSchema,
  PptxTableCellSchema,
} from './typed/pptx';
export type { PptxPresentation, Slide, Shape, PptxTable, PptxTableRow, PptxTableCell } from './typed/pptx';

export { readXlsx, XlsxWorkbookSchema, XlsxSheetSchema, XlsxCellSchema, DefinedNameSchema } from './typed/xlsx';
export type { XlsxWorkbook, XlsxSheet, XlsxCell, DefinedName } from './typed/xlsx';

