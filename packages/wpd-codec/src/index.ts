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
export {
  PACKET_TYPE_EXTENDED_DOCUMENT_SUMMARY,
  readDocumentSummary,
} from "./container/summary";

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

// The construct layers a consumer needs to read a WordPerfect file's own structure rather than only the document it folds into: the units every dimension is stated in, the page-geometry and style groups, and the table grid with the per-cell attributes that ride inside its End-of-Line boundaries.
export { POINTS_PER_INCH, pointsFromWpu, WPU_PER_INCH } from "./stream/units";
export type { WpdPageForm } from "./stream/page";
export {
  COLUMN_GROUP,
  COLUMN_LEFT_MARGIN_SET,
  COLUMN_RIGHT_MARGIN_SET,
  DEFAULT_MARGIN_PT,
  DEFAULT_PAGE_HEIGHT_PT,
  DEFAULT_PAGE_WIDTH_PT,
  PAGE_BOTTOM_MARGIN_SET,
  PAGE_FORM,
  PAGE_GROUP,
  PAGE_TOP_MARGIN_SET,
  readMarginPt,
  readPageForm,
} from "./stream/page";
export type { WpdStyleSemantics } from "./stream/style";
export {
  DISPLAY_NUMBER_GROUP,
  isParagraphNumberDisplayOff,
  isParagraphNumberDisplayOn,
  isStyleScopeCloser,
  isStyleScopeOpener,
  readDisplayNumberLevel,
  readSystemStyleNumber,
  STYLE_GROUP,
  styleSemanticsFor,
} from "./stream/style";
export type {
  WpdCellFill,
  WpdCellInformation,
  WpdCellSpanning,
  WpdEmbeddedSubfunction,
  WpdEmbeddedSubfunctions,
  WpdRowInformation,
} from "./stream/table";
export {
  CELL_FILL_COLORS_SUBFUNCTION,
  CELL_INFORMATION_SUBFUNCTION,
  CELL_SPANNING_SUBFUNCTION,
  CHARACTER_DEFINE_TABLE_END,
  CHARACTER_TABLE_COLUMN,
  CHARACTER_TABLE_DEFINITION,
  findEmbeddedSubfunction,
  readCellFill,
  readCellInformation,
  readCellSpanning,
  readEmbeddedSubfunctions,
  readRowInformation,
  readTableColumnWidthPt,
  ROW_INFORMATION_SUBFUNCTION,
} from "./stream/table";
