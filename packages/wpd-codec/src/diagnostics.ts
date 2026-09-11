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
  // A cell's fill is a two-colour pattern at a partial shading percentage: both colours are resolved into a real 'pattern' ContentCellFill (ExaDev/documents.js#1024), but the WordPerfect SDK reference this reader is built against (see stream/table.ts's own top-of-file citation) does not document the shading byte's exact compositing formula, so the pattern's own density is a best-effort derivation (the background colour's own shade byte read as its opacity, snapped to the nearest percentN step) rather than a value confirmed against a specification.
  CellFillBlended: "wpd/cell-fill-blended",
  // The form names a landscape orientation. PageSize carries no orientation of its own, so the form's stated width and length are used exactly as written rather than rotated.
  LandscapeOrientationUnmapped: "wpd/landscape-orientation-unmapped",
  // The document changes its page size or a margin partway through. ContentSection carries one page geometry, so the document's first statement of that dimension is the one used.
  PageGeometryChanged: "wpd/page-geometry-changed",
  // An outline number's rendered digits were dropped in favour of the list membership that regenerates them, so a converted document numbers the item itself rather than carrying a frozen number as text.
  OutlineNumberRegenerated: "wpd/outline-number-regenerated",
  // The document contains a box: a figure, text box, equation, or graphic. Its contents are not read; see the README's Remaining scope.
  BoxDropped: "wpd/box-dropped",
  // The document contains a footnote or endnote whose body the flat ContentDocument has no home for. Its reference anchor IS emitted (a footnote/endnote anchor construct around the reference site); the body is lifted into the tree form's definitions table by readWpd, so this fires only on the flat readWpdContent.
  NoteDropped: "wpd/note-dropped",
  // A note's On/Off reference pair straddled a paragraph boundary, which the run-scoped anchor cannot express.
  NoteSpansParagraphs: "wpd/note-spans-paragraphs",
  // A second header, footer, or watermark function claims a slot a first already filled (WordPerfect's own A/B two-slot-per-kind mechanism, a shape the shared one-flow-per-slot vocabulary does not carry), or a function's body packet could not be resolved or read. A header, footer, or watermark with a resolvable body is NOT dropped -- it lands in ContentSection.headers/footers/watermarks.
  HeaderFooterDropped: "wpd/header-footer-dropped",
  // The document embeds a native OLE object -- an OLE server's own stream rather than a nested document package, the identical boundary ooxml.js draws for a classic OLE1 payload. Its bytes ARE recovered (from the compound wrapper's PerfectOffice_OBJECTS storage for an OLE 2 object, or the descriptor packet's own trailing bytes for an OLE 1 one), but the flat ContentDocument has no field for opaque binary bytes, so readWpd is the read that carries them (an attachments-table entry, the same split note bodies take); readWpdContent reports the object here.
  OleObjectDropped: "wpd/ole-object-dropped",
  // The document contains a cross-reference. Its displayed text survives as ordinary text; the reference's own target binding does not.
  CrossReferenceFlattened: "wpd/cross-reference-flattened",
  // The document contains merge codes -- a form-letter template's field placeholders. They contribute no text and are passed over.
  MergeCodeDropped: "wpd/merge-code-dropped",
  // A table cell carries a New Cell Formula embedded subfunction whose tokenised formula this reader could not decode with confidence -- an undocumented "+" shortcut, a code the SDK itself only assumes the meaning of, or a temp-function reference this reader cannot confirm the shape of without a real file. The cell's displayed text is unaffected; only its formula is unavailable.
  TableFormulaUnresolved: "wpd/table-formula-unresolved",
  // A chain of styles resolving one another's own packets (type 0x30) ran deeper than this reader will follow -- a bound against a corrupt or adversarial file, since a well-formed document's own styles never reference themselves in a cycle.
  StyleResolutionDepthExceeded: "wpd/style-resolution-depth-exceeded",
  // A FIELD merge code's own On/Off pair straddled a paragraph boundary, which the run-scoped field construct (confined to one paragraph's own runs) cannot express. The field's own text still reads as ordinary paragraph text; only the field tag is unavailable.
  MergeFieldSpansParagraphs: "wpd/merge-field-spans-paragraphs",
  // A box's own function-level override names real content, but this reader could not read it -- the content prefix ID resolves to a packet type this reader does not decode (an image's Graphics Filename packet, an OLE object, a content type this reader has no text-block reader for), or resolves to no packet at all.
  BoxContentUnresolved: "wpd/box-content-unresolved",
  // A WPG vector graphic this reader did not fully decode: either a partial decode (the message names the record types the walk skipped -- see src/stream/wpg.ts's own scope statement for the layered subset that does decode) or a graphic recognised and refused whole (a WPG 1.0-major file whose record vocabulary predates the framed WPG 2.x stream, an encrypted graphic, or a record stream with no walkable Start WPG record).
  WpgRecordsUndecoded: "wpd/wpg-records-undecoded",
  // A box's own content resolved to real, readable text, but its function-level override states no width and height this reader can trust -- a box relying on its template's own inherited geometry, which this reader does not resolve. The box's content is not lifted without a frame to place it in.
  BoxFrameUnresolved: "wpd/box-frame-unresolved",
} as const;

export const NOOP_WPD_DIAGNOSTIC_SINK: WpdDiagnosticSink = () => {
  // Reporting nothing is the default: a caller that wants the diagnostics passes a sink.
};
