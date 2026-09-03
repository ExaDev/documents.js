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
  // A cell or row boundary appeared with no table definition open, so there is no grid to place it in. Its text still becomes a paragraph, in reading order.
  TableFlattened: "wpd/table-flattened",
  // The document contains a column break, which the shared content schema has no block for. It becomes a paragraph break.
  ColumnBreakFlattened: "wpd/column-break-flattened",
  // A cell's or row's embedded subfunction list ran into a record whose size the specification does not state, so the walk stopped. Everything before it was read; the attributes after it (spanning, fill, justification) are not available for that cell.
  TableAttributesTruncated: "wpd/table-attributes-truncated",
  // A cell's fill is a two-colour pattern at a partial shading percentage, which a single flat background colour cannot express. The background half is used and the blend is not reproduced.
  CellFillBlended: "wpd/cell-fill-blended",
  // The form names a landscape orientation. PageSize carries no orientation of its own, so the form's stated width and length are used exactly as written rather than rotated.
  LandscapeOrientationUnmapped: "wpd/landscape-orientation-unmapped",
  // The document changes its page size or a margin partway through. ContentSection carries one page geometry, so the document's first statement of that dimension is the one used.
  PageGeometryChanged: "wpd/page-geometry-changed",
  // An outline number's rendered digits were dropped in favour of the list membership that regenerates them, so a converted document numbers the item itself rather than carrying a frozen number as text.
  OutlineNumberRegenerated: "wpd/outline-number-regenerated",
  // The document contains a box: a figure, text box, equation, or graphic. Its contents are not read; see the README's Remaining scope.
  BoxDropped: "wpd/box-dropped",
  // The document contains a footnote or endnote. Its reference site is where this fires; the note's own text lives in a prefix packet the flat content model has nowhere to put.
  NoteDropped: "wpd/note-dropped",
  // The document declares a header, footer, or watermark. The flat content model has no page-furniture position for one.
  HeaderFooterDropped: "wpd/header-footer-dropped",
  // The document contains a cross-reference. Its displayed text survives as ordinary text; the reference's own target binding does not.
  CrossReferenceFlattened: "wpd/cross-reference-flattened",
  // The document contains merge codes -- a form-letter template's field placeholders. They contribute no text and are passed over.
  MergeCodeDropped: "wpd/merge-code-dropped",
} as const;

export const NOOP_WPD_DIAGNOSTIC_SINK: WpdDiagnosticSink = () => {
  // Reporting nothing is the default: a caller that wants the diagnostics passes a sink.
};
