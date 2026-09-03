// Public barrel. May contain only re-export statements (enforced by the shared barrel policy in eslint.shared.ts) -- nothing here can have a side effect at import time.
//
// src/tokenize.ts, src/group.ts, src/header.ts and src/codepage.ts are deliberately NOT re-exported: each is a stage of the pipeline rather than a thing a caller reaches for, and exposing a token stream or a half-resolved header table would invite a consumer to build on an internal shape instead of on ContentDocument. Every module is still individually importable through package.json's "./*" export for a consumer that genuinely wants one, exactly as document-schema.js's own per-module exports work.

// The primary read/write pair, over document-schema.js's tree-form DocumentTree -- what a caller reaching for "read an RTF file" or "write one" should use. The *Content pair below is the same conversion one level down, over the flat ContentDocument the reader itself builds; see src/read.ts's own top-of-file comment for why both exist and which to reach for.
export type { ReadRtfResult } from "./read";
export { readRtf } from "./read";
export { writeRtf } from "./write";
export { rtfCodec } from "./codec";

export type { ReadRtfContentResult } from "./read";
export { readRtfContent } from "./read";
export { writeRtfContent } from "./write";
export { rtfContentCodec, RtfBytesSchema } from "./codec";

export type {
  RtfDiagnostic,
  RtfDiagnosticSeverity,
  RtfDiagnosticSink,
} from "./diagnostics";
export {
  NOOP_RTF_DIAGNOSTIC_SINK,
  RtfDiagnosticCodes,
  RtfInputTooLargeError,
  RtfNestingLimitExceededError,
  RtfNotAnRtfDocumentError,
  RtfParseError,
  RtfUnsupportedDocumentKindError,
  RtfWriteError,
} from "./diagnostics";

export type { ReadRtfOptions, RtfLineEnding, WriteRtfOptions } from "./options";
export { DEFAULT_MAX_GROUP_DEPTH, DEFAULT_MAX_INPUT_BYTES } from "./options";

// The string-to-bytes conversion a caller holding RTF as a latin-1/binary-read string uses, exported rather than kept private because every entry point here takes bytes and a caller needs the one lossless way to get them from such a string -- see src/bytes.ts for why a UTF-8-decoded string is refused instead.
export { rtfBytesFromLatin1 } from "./bytes";

// This package's own opaque numId grammar for list membership, exported for the same reason markdown-codec exports its own: a sibling package composing over a ContentDocument this reader produced needs to parse the string rather than re-derive its grammar, and a producer building a ContentDocument for this writer needs to mint one.
export type { RtfListNumIdInfo, RtfListType } from "./list-id";
export { mintRtfListNumId, parseRtfListNumId } from "./list-id";
