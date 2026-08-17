export { packageCodec, xmlCodec, decodePackage, encodePackage } from './codec';
export { parsePackage } from './package-io/read';
export { serializePackage, MANIFEST_PART, MIMETYPE_PART } from './package-io/write';
export { parseXml } from './xml/parse';
export { buildXml } from './xml/build';
export { unzipPackage, zipPackage } from './zip';
export type { ZipEntry } from './zip';
export { bytesToBase64, base64ToBytes } from './util/base64';

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

export { ODF_NAMESPACES, xmlnsAttributes } from './ns';
export type { OdfNamespacePrefix } from './ns';

export { ODF_MEDIA_TYPES, mediaTypeForExtension } from './media-type';
export type { OdfExtension } from './media-type';

export { sniffImageFormat } from './image/sniff';
export type { ImageFormat } from './image/sniff';

export { readMimetype, writeMimetype } from './mimetype';

export { el, txt } from './xml/fragment';
export { encodeXmlText } from './xml/entities';

export {
  readManifest,
  buildManifest,
  writeManifest,
  syncManifest,
  validateManifest,
  setDocumentMediaType,
  ManifestEntrySchema,
  ManifestSchema,
  ManifestProblemSchema,
} from './manifest';
export type { ManifestEntry, Manifest, ManifestProblem, BuildManifestOptions } from './manifest';

export {
  StylePropertiesSchema,
  parseTextProperties,
  parseParagraphProperties,
  parseStyleElementProperties,
  textPropertiesToAttributes,
  paragraphPropertiesToAttributes,
  formatPt,
  formatPercentageMultiplier,
} from './styles/properties';
export type { StyleProperties, ParsedProperties } from './styles/properties';

export { buildStylePropertyElements, canonicalPropertiesString } from './styles/serialize';

export { StyleRegistry, STYLE_FAMILIES, isStyleFamily } from './styles/registry';
export type { StyleFamily, InternRequest, OtherPartRef, StyleRegistryOptions } from './styles/registry';

export { ensureSpan } from './styles/span';

export { rootElement, findChildElement, childrenWithTag, elementsWithTag, attrValue } from './xml/query';
export { decodeXmlText } from './xml/entities';

export { parseOdfLength, parseOdfLength as parseLength, formatOdfLength } from './typed/shared/units';
export type { LengthUnit } from './typed/shared/units';

export { columnIndexToLetters, cellReference, columnLettersToIndex, parseCellReference, TableCursor } from './typed/shared/a1';

export { parseOdfColor, formatOdfColor } from './typed/shared/color';

export { parsePageSize, parseMargins, parseBox, parseLinePoints } from './typed/shared/geometry';

export { type Alignment, AlignmentSchema } from 'document-schema.js';

export { getOdfSpaceCount, measureOdfNodeLength, sumOdfNodeLength, decodeOdfText } from './typed/shared/text';

export { resolveStyle, resolveStyleElementChain, findStyleElement } from './typed/shared/cascade';
export type { CascadeDiagnostic, StyleCascadeResult, StyleElementChainResult } from './typed/shared/cascade';

export { readOdfMetadata, META_PART } from './typed/shared/metadata';

export { readOdfParagraph } from './typed/shared/paragraph';

export { mintOdfListNumId, readOdfListParagraphs, resolveOdfListKind } from './typed/shared/list';
export type { OdfListIdState, OdfListParagraphReader } from './typed/shared/list';

export { readOdfTable } from './typed/shared/table';

export { parseOdfTransform, applyOdfTransform, netRotationDeg, resolveOdfShapeGeometry, composeOdfGroupTransform } from './typed/shared/transform';
export type { OdfTransformFunction, OdfPoint, OdfShapeGeometry } from './typed/shared/transform';

export { resolveDrawPageSize, resolvePageLayoutProperties } from './typed/shared/masterpage';

export {
  parseOdfViewBox,
  parseOdfPointsList,
  parseOdfPathData,
  scaleOdfRawPoint,
  buildOdfSubpaths,
  rawSubpathFromPoints,
} from './typed/shared/path';
export type { OdfRawPoint, OdfRawSegment, OdfRawSubpath, OdfViewBox } from './typed/shared/path';

export { readDrawFrame, walkDrawShapes, readDrawPageContent, readDrawImageBlock } from './typed/draw/shapes';
export type { DrawPageContent } from './typed/draw/shapes';

export { readDrawObjectReference } from './typed/draw/embedded';
export type { EmbeddedDrawObject, EmbeddedDocumentKind } from './typed/draw/embedded';

export { readOdp } from './typed/odp/read';
export type { OdpDocument } from './typed/odp/read';

export { readOdt } from './typed/odt/read';
export type { OdtDocument } from './typed/odt/read';

export { readOdg } from './typed/odg/read';
export type { OdgDocument } from './typed/odg/read';

export { readOds } from './typed/ods/read';
export type { OdsDocument } from './typed/ods/read';

export { readOdfFormula, readOdfFormulaDocument } from './typed/formula/read';
export type { OdfFormulaDocument } from './typed/formula/read';

export { readOdm } from './typed/odm/read';
export type { OdmDocument, OdmSection } from './typed/odm/read';

export { readOdbInventory, resolveOdbComponent } from './typed/odb/read';
export type { OdbInventory, OdbConnectionInfo, OdbQueryInfo, OdbComponentInfo } from './typed/odb/read';

export { subDocumentPackage } from './typed/odb/subdocument';
export type { SubDocumentPackageOptions } from './typed/odb/subdocument';

export { readOdbForm } from './typed/odb/form';
export type { OdbForm, OdbFormDefinition, OdbFormControl } from './typed/odb/form';

export { readOdbReport } from './typed/odb/report';
export type { OdbReport, OdbReportBand, OdbReportElement, OdbReportGroup, OdbReportFunction } from './typed/odb/report';
