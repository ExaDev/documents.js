// The reader's non-fatal channel, mirroring markdown-codec's and epub-codec's own diagnostic sinks. Anything that would make the reader silently lose information is reported here rather than swallowed: a character this package holds no mapping for, a prefix ID naming a packet the file does not carry, a table whose structure is flattened into paragraphs. Structural nonconformance is not a diagnostic -- that throws (src/errors.ts).

export interface WpdDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type WpdDiagnosticSink = (diagnostic: WpdDiagnostic) => void;

export const WpdDiagnosticCodes = {
  // A (character set, character number) pair outside the tables this package can state from a primary source. The character is rendered as U+FFFD so it stays visible in the output rather than vanishing.
  UnmappedCharacter: "wpd/unmapped-character",
  // A function named a prefix ID no index in this file carries -- legitimate after an edit deleted the packet, and it costs formatting rather than content.
  MissingPrefixPacket: "wpd/missing-prefix-packet",
  // The document contains a table. Its cell and row boundaries become paragraph breaks, so no text is lost, but the table's own structure is not reconstructed; see the README's Remaining scope.
  TableFlattened: "wpd/table-flattened",
  // The document contains a column break, which the shared content schema has no block for. It becomes a paragraph break.
  ColumnBreakFlattened: "wpd/column-break-flattened",
} as const;

export const NOOP_WPD_DIAGNOSTIC_SINK: WpdDiagnosticSink = () => {
  // Reporting nothing is the default: a caller that wants the diagnostics passes a sink.
};
