export { packageCodec, xmlCodec, decodePackage, encodePackage } from "./codec";
export { parsePackage } from "./package-io/read";
export {
  serializePackage,
  MANIFEST_PART,
  MIMETYPE_PART,
} from "./package-io/write";
export { parseXml } from "./xml/parse";
export { buildXml } from "./xml/build";
export { unzipPackage, zipPackage } from "./zip";
export type { ZipEntry } from "./zip";
export { bytesToBase64, base64ToBytes } from "./util/base64";

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
} from "./model/node";
export type {
  XmlNode,
  XmlElement,
  Attribute,
  XmlText,
  XmlCdata,
  XmlComment,
  XmlDeclaration,
  XmlPi,
} from "./model/node";

export {
  XmlPartSchema,
  BinaryPartSchema,
  PartSchema,
  PackageSchema,
} from "./model/package";
export type { XmlPart, BinaryPart, Part, Package } from "./model/package";

export { ODF_NAMESPACES, xmlnsAttributes } from "./ns";
export type { OdfNamespacePrefix } from "./ns";

export { ODF_MEDIA_TYPES, mediaTypeForExtension } from "./media-type";
export type { OdfExtension } from "./media-type";

export { sniffImageFormat } from "./image/sniff";
export type { ImageFormat } from "./image/sniff";

export { readMimetype, writeMimetype } from "./mimetype";

export { el, txt } from "./xml/fragment";
export { encodeXmlText } from "./xml/entities";

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
} from "./manifest";
export type {
  ManifestEntry,
  Manifest,
  ManifestProblem,
  BuildManifestOptions,
} from "./manifest";

export {
  StylePropertiesSchema,
  parseTextProperties,
  parseParagraphProperties,
  parseStyleElementProperties,
  textPropertiesToAttributes,
  paragraphPropertiesToAttributes,
  formatPt,
  formatPercentageMultiplier,
} from "./styles/properties";
export type { StyleProperties, ParsedProperties } from "./styles/properties";

export {
  buildStylePropertyElements,
  canonicalPropertiesString,
} from "./styles/serialize";

export {
  StyleRegistry,
  STYLE_FAMILIES,
  isStyleFamily,
} from "./styles/registry";
export type {
  StyleFamily,
  InternRequest,
  OtherPartRef,
  StyleRegistryOptions,
} from "./styles/registry";

export { ensureSpan } from "./styles/span";

export {
  rootElement,
  findChildElement,
  childrenWithTag,
  elementsWithTag,
  attrValue,
} from "./xml/query";
export { decodeXmlText } from "./xml/entities";

export {
  parseOdfLength,
  parseOdfLength as parseLength,
  formatOdfLength,
} from "./typed/shared/units";
export type { LengthUnit } from "./typed/shared/units";

export {
  columnIndexToLetters,
  cellReference,
  columnLettersToIndex,
  parseCellReference,
  TableCursor,
} from "./typed/shared/a1";

export { parseOdfColor, formatOdfColor } from "./typed/shared/color";

export {
  parsePageSize,
  parseMargins,
  parseBox,
  parseLinePoints,
} from "./typed/shared/geometry";

export { type Alignment, AlignmentSchema } from "document-schema.js";

// The type every primary reader below returns, re-exported so a consumer can name it without reaching past odf.js for a second dependency -- the same reason AlignmentSchema is re-exported above. The value-level surface it belongs to (DocumentTreeSchema, assembleTree, flattenTree, decompose, factorStyles) deliberately stays where it is defined: this package constructs packages, it does not own the vocabulary, and re-exporting the transform would put a second import path on functions whose home is document-schema.js.
export type { DocumentTree } from "document-schema.js";

export {
  getOdfSpaceCount,
  measureOdfNodeLength,
  sumOdfNodeLength,
  decodeOdfText,
  segmentOdfText,
  buildOdfInlineNodes,
} from "./typed/shared/text";
export type { OdfTextSegment, OdfTextSegmentKind } from "./typed/shared/text";

export {
  resolveStyle,
  resolveStyleElementChain,
  findStyleElement,
} from "./typed/shared/cascade";
export type {
  CascadeDiagnostic,
  StyleCascadeResult,
  StyleElementChainResult,
} from "./typed/shared/cascade";

export {
  readOdfMetadata,
  writeOdfMetadata,
  buildOdfMetaNodes,
  META_PART,
} from "./typed/shared/metadata";

export {
  readOdfParagraph,
  writeOdfParagraph,
  segmentOdfParagraphRuns,
  odfRunProperties,
  odfParagraphProperties,
} from "./typed/shared/paragraph";
export type { OdfParagraphWriteOptions } from "./typed/shared/paragraph";

export {
  mintOdfListNumId,
  readOdfListParagraphs,
  resolveOdfListKind,
  writeOdfList,
  buildOdfListStyle,
} from "./typed/shared/list";
export type {
  OdfListIdState,
  OdfListParagraphReader,
  OdfListEntry,
} from "./typed/shared/list";

export { readOdfTable, writeOdfTable } from "./typed/shared/table";

// The empty-package scaffold every typed writer starts from -- the mimetype part plus the content.xml/styles.xml roots with their own containers already at the schema positions the format requires. Exported beside the lossless package-io pair above because a caller assembling a package by hand needs the same starting point writeOdt does.
export {
  createOdfPackage,
  odfPartContainer,
  DEFAULT_ODF_VERSION,
} from "./package-io/scaffold";

export {
  parseOdfTransform,
  applyOdfTransform,
  netRotationDeg,
  resolveOdfShapeGeometry,
  composeOdfGroupTransform,
} from "./typed/shared/transform";
export type {
  OdfTransformFunction,
  OdfPoint,
  OdfShapeGeometry,
} from "./typed/shared/transform";

export {
  resolveDrawPageSize,
  resolvePageLayoutProperties,
} from "./typed/shared/masterpage";

export {
  parseOdfViewBox,
  parseOdfPointsList,
  parseOdfPathData,
  scaleOdfRawPoint,
  buildOdfSubpaths,
  rawSubpathFromPoints,
} from "./typed/shared/path";
export type {
  OdfRawPoint,
  OdfRawSegment,
  OdfRawSubpath,
  OdfViewBox,
} from "./typed/shared/path";

export {
  readDrawFrame,
  walkDrawShapes,
  readDrawPageContent,
  readDrawImageBlock,
} from "./typed/draw/shapes";
export type { DrawPageContent } from "./typed/draw/shapes";

export { readDrawObjectReference } from "./typed/draw/embedded";
export type {
  EmbeddedDrawObject,
  EmbeddedDocumentKind,
} from "./typed/draw/embedded";

// --- The typed readers, each at two levels. readOdt/readOdp/readOdg/readOds/readOdfFormula are the PRIMARY entry points and return document-schema.js's DocumentTree -- the single hierarchical artefact (kind, metadata, tables, and a `children` tree of one group per top-level container), assembled via that package's own assembleTree so the styles table is minted exactly as it is at every other package construction site in this family. The *Content functions beneath them are the same readers' flat, ContentDocument-level output ({ metadata, sections|slides|pages|sheets }, or a whole ContentDocument for the formula case), unchanged in behaviour and still the right call for a consumer that works in the flat pivot -- documents.js's own conversion pipeline reads at this level today. Each pair is one read, not two: the package-native function calls its own *Content sibling and reshapes the result, so the two can never disagree about what the file says.
//
// The *Content names belong to the flat reader beneath each package-native function -- see the README's migration table for the full old-to-new name mapping. readOdfFormulaMathMl is the rawest reader in the formula ladder, the MathML-plus-StarMath reader with no pivot shaping at all, unchanged in behaviour: a caller typing "readOdfFormula" wants the format's primary reader, not its rawest one, which is why the bare name belongs to the package-native function instead. ---
export { readOdp, readOdpContent } from "./typed/odp/read";
export type { OdpDocument } from "./typed/odp/read";

export { readOdt, readOdtContent } from "./typed/odt/read";
export type {
  OdtDocument,
  OdtReadOptions,
  OdtHeaderFooterPart,
  OdtHeaderFooterVariant,
} from "./typed/odt/read";

// The odt WRITER, the inverse of the two readers above and this package's first content writer: writeOdt takes the DocumentTree readOdt returns, writeOdtContent the flat ContentDocument readOdtContent returns, and both produce a real .odt Package (encodePackage turns it into bytes). normaliseOdtContent states the one canonical form a written-and-reread document equals -- what ODF's own content model can carry -- and is the shape the round-trip law is stated against.
export {
  writeOdt,
  writeOdtContent,
  normaliseOdtContent,
} from "./typed/odt/write";
export type { OdtWriteOptions } from "./typed/odt/write";

export { readOdg, readOdgContent } from "./typed/odg/read";
export type { OdgDocument } from "./typed/odg/read";

export { readOds, readOdsContent } from "./typed/ods/read";
export type { OdsDocument } from "./typed/ods/read";

// The ods WRITER, the inverse of the two readers above and this package's second content writer (typed/odt/write.ts's own top-of-file note states the shared design philosophy): writeOds takes the DocumentTree readOds returns, writeOdsContent the flat ContentDocument readOdsContent returns, and both produce a real .ods Package. normaliseOdsContent states the one canonical form a written-and-reread document equals -- including the forced normalisations readOdsContent's own established behaviour (not this writer's own choices) imposes: a value-less, formula-less, text-less cell vanishes entirely, columns/rows densify to one entry per position, and a 'time' cell's ISO clock value becomes the raw xsd:duration string the reader has not yet been updated to convert back.
export {
  writeOds,
  writeOdsContent,
  normaliseOdsContent,
} from "./typed/ods/write";
export type { OdsWriteOptions } from "./typed/ods/write";

export {
  readOdfFormula,
  readOdfFormulaContent,
  readOdfFormulaMathMl,
} from "./typed/formula/read";
export type { OdfFormulaDocument } from "./typed/formula/read";

export { readOdm } from "./typed/odm/read";
export type { OdmDocument, OdmSection } from "./typed/odm/read";

export { readOdbInventory, resolveOdbComponent } from "./typed/odb/read";
export type {
  OdbInventory,
  OdbConnectionInfo,
  OdbQueryInfo,
  OdbComponentInfo,
} from "./typed/odb/read";

export { subDocumentPackage } from "./typed/odb/subdocument";
export type { SubDocumentPackageOptions } from "./typed/odb/subdocument";

export { readOdbForm } from "./typed/odb/form";
export type { OdbForm } from "./typed/odb/form";
export {
  readOdfFormDefinitions,
  readOdfFormControlConstructs,
} from "./typed/shared/forms";
export type { OdbFormDefinition, OdbFormControl } from "./typed/shared/forms";

// --- OpenOffice.org 1.x / StarOffice 6-7, the pre-OASIS ancestor ODF 1.0 was based on. Read through the ODF readers above rather than beside them: transformOoo1Package rewrites a .sxw/.sxc/.sxi/.sxd package into the ODF shape those readers already understand, so every construct they know how to read works on an OpenOffice.org 1.x document too. .sxw and .sxc also write, the same way: transformToOoo1Package rewrites a real ODF Package (writeOdt's/writeOds's own output) into genuine OpenOffice.org 1.x XML; .sxi/.sxd remain read-only, since this package's typed layer has no writeOdp/writeOdg yet. See src/ooo1/transform.ts for what actually differs between the two vocabularies. ---
export {
  OOO1_NAMESPACES,
  OOO1_MEDIA_TYPES,
  isOoo1Package,
  isOoo1NamespacePrefix,
  ooo1MediaTypeForExtension,
  odfMediaTypeForOoo1MediaType,
  ooo1MediaTypeForOdfMediaType,
} from "./ooo1/ns";
export type { Ooo1NamespacePrefix, Ooo1Extension } from "./ooo1/ns";

export { transformOoo1Package, transformToOoo1Package } from "./ooo1/transform";

export {
  readSxw,
  readSxwContent,
  readSxc,
  readSxcContent,
  readSxi,
  readSxiContent,
  readSxd,
  readSxdContent,
} from "./ooo1/read";

// The .sxw and .sxc writers -- the OpenOffice.org 1.x / StarOffice 6-7 counterparts to writeOdt/writeOdtContent and writeOds/writeOdsContent above, built on them: those produce a real ODF Package, and transformToOoo1Package (this format's own inverse of transformOoo1Package, the same module the readers above run) rewrites it into genuine OpenOffice.org 1.x XML. See src/ooo1/write.ts for the full scope statement -- .sxi/.sxd have no writer yet, since this package's typed layer has no writeOdp/writeOdg for one to be built on.
export {
  writeSxw,
  writeSxwContent,
  writeSxc,
  writeSxcContent,
} from "./ooo1/write";

export { readOdbReport } from "./typed/odb/report";
export type {
  OdbReport,
  OdbReportBand,
  OdbReportElement,
  OdbReportGroup,
  OdbReportFunction,
} from "./typed/odb/report";
