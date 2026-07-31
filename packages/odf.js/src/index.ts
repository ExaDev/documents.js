export { packageCodec, xmlCodec, decodePackage, encodePackage } from './codec';
export { parsePackage } from './package-io/read';
export { serializePackage } from './package-io/write';
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

export { readMimetype, writeMimetype, MIMETYPE_PART } from './mimetype';

export { el, txt } from './xml/fragment';
export { encodeXmlText } from './xml/entities';

export {
  readManifest,
  buildManifest,
  writeManifest,
  syncManifest,
  validateManifest,
  setDocumentMediaType,
  MANIFEST_PART,
  ManifestEntrySchema,
  ManifestSchema,
  ManifestProblemSchema,
} from './manifest';
export type { ManifestEntry, Manifest, ManifestProblem, BuildManifestOptions } from './manifest';
