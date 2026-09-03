// Public barrel. May contain only re-export statements (enforced by local/no-side-effects-in-index, eslint.config.ts) -- nothing here can have a side effect at import time.
//
// src/test-support/* is deliberately not re-exported and is excluded from the build: the fixture builders there exist for this package's own unit suite.

// The read pair, over document-schema.js's two encodings of one document: readWpd produces the tree-form DocumentTree, readWpdContent the flat ContentDocument every codec in the family exchanges. There is no write half -- see the README's Scope.
export type { ReadWpdOptions } from "./read";
export { readWpd, readWpdContent } from "./read";
export { wpdContentCodec, WpdBytesSchema } from "./codec";

export { WPD_FILE_EXTENSION, WPD_MEDIA_TYPE } from "./format";

export type { WpdDiagnostic, WpdDiagnosticSink } from "./diagnostics";
export { NOOP_WPD_DIAGNOSTIC_SINK, WpdDiagnosticCodes } from "./diagnostics";

export {
  WpdEncryptedDocumentError,
  WpdFormatError,
  WpdNotAWordPerfectFileError,
  WpdUnsupportedVersionError,
} from "./errors";

// The container and stream layers, exported because a consumer inspecting a WordPerfect file -- a forensic tool, a migration audit, a reader for a construct this package does not yet lift into the shared schema -- needs the parsed prefix and the raw function stream, not only the document they fold into.
export type { WpdDocumentContainer } from "./container/container";
export {
  openWpdDocument,
  PERFECT_OFFICE_MAIN_STREAM,
  PERFECT_OFFICE_OBJECTS_STORAGE,
} from "./container/container";
export type { WpdFileHeader } from "./container/header";
export {
  hasWordPerfectFileId,
  readFileHeader,
  WPD_FILE_ID,
  WPD_PREFIX_HEADER_SIZE,
} from "./container/header";
export type { WpdPrefixPacket } from "./container/prefix";
export {
  PACKET_TYPE_DESIRED_FONT_DESCRIPTOR,
  packetByPrefixId,
  readPrefixPackets,
  readTypefaceName,
  WPD_INDEX_RECORD_SIZE,
} from "./container/prefix";

export type {
  WpdCharacterToken,
  WpdFixedFunctionToken,
  WpdSingleByteFunctionToken,
  WpdToken,
  WpdVariableFunctionToken,
} from "./stream/tokenise";
export {
  FIRST_FIXED_FUNCTION,
  FIRST_SINGLE_BYTE_FUNCTION,
  FIRST_VARIABLE_FUNCTION,
  tokeniseDocumentArea,
} from "./stream/tokenise";
export type { WpdEolMapping } from "./stream/eol";
export {
  EOL_GROUP,
  eolMappingForSubfunction,
  FIRST_SINGLE_BYTE_EOL,
  isSingleByteEol,
  LAST_SINGLE_BYTE_EOL,
  subfunctionForSingleByteEol,
} from "./stream/eol";
export type { WpdAttributeCode, WpdRunAttributes } from "./stream/attributes";
export {
  ATTRIBUTE_OFF,
  ATTRIBUTE_ON,
  decodeAttributeByte,
  runAttributesFrom,
  WpdAttribute,
} from "./stream/attributes";
export {
  decodeSingleByteCharacter,
  decodeWordString,
  decodeWpCharacter,
  FIRST_ASCII_CHARACTER,
  LAST_CHARACTER,
  UNMAPPED_CHARACTER,
} from "./stream/characters";
