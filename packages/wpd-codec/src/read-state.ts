import type {
  Alignment,
  Color,
  ContentBlock,
  ContentPageFurniture,
  ContentRun,
  ContentTableCell,
  ContentTableRow,
  RunConstructExtent,
} from "document-schema.js";
import type { WpdDocumentContainer } from "./container/container";
import type { WpdDiagnosticSink } from "./diagnostics";
import type { WpdRunAttributes } from "./stream/attributes";
import type { WpdStyleSemantics } from "./stream/style";
import type { WpdOleObject } from "./stream/ole";
import type { WpdToken } from "./stream/tokenise";

// The shared reader state and continuation types read.ts and its split appliers (read-tables.ts, read-box-group.ts, read-furniture-groups.ts, read-formatting-groups.ts) all thread. A leaf module deliberately: it imports nothing from any of those, so none of them ever import back into it, and the one genuine recursion in the reader (an applier folding a nested token stream, or replaying a style's own begin-block tokens) is expressed as a function passed in at the call site (FoldTokensFn/ApplyTokenFn below) rather than as an import cycle back to read.ts.

// The page geometry the document states, one field per function that states it. Each stays undefined until its own function appears, so a document overriding only its top margin keeps the WordPerfect default for the other four rather than for none of them.
export interface PageState {
  widthPt: number | undefined;
  heightPt: number | undefined;
  topPt: number | undefined;
  rightPt: number | undefined;
  bottomPt: number | undefined;
  leftPt: number | undefined;
  changeReported: boolean;
}

// A table under construction. `definingColumns` is true between Table Definition and Define Table End, the window in which Table Column functions state the grid's widths and no content can appear.
export interface TableState {
  readonly columnWidthsPt: number[];
  readonly rows: ContentTableRow[];
  cells: ContentTableCell[];
  cellBlocks: ContentBlock[];
  definingColumns: boolean;
  rowHeightPt: number | undefined;
  rowIsHeader: boolean;
}

// The direct-formatting state a style packet's own "beginning style text" block can change, snapshotted before applying that block so the style's own scope closer can restore exactly what it overrode, the same fields a Font Face Change, Font Size Change, character-colour function, or Attribute On/Off can change directly in the main stream, because a style's begin block is folded through the identical applyToken dispatch those use.
export interface FormattingSnapshot {
  readonly activeAttributes: ReadonlySet<number>;
  readonly fontFamily: string | undefined;
  readonly sizePt: number | undefined;
  readonly color: Color | undefined;
}

// One entry per currently-open style scope. `snapshot` is present only when this scope resolved its own packet (type 0x30) and applied a non-empty begin block, a scope with no resolvable packet, or an empty one, changes nothing to restore.
export interface StyleScopeEntry {
  readonly semantics: WpdStyleSemantics | undefined;
  readonly snapshot: FormattingSnapshot | undefined;
}

export interface ReaderState {
  readonly blocks: ContentBlock[];
  readonly runs: ContentRun[];
  text: string;
  readonly activeAttributes: Set<number>;
  attributes: WpdRunAttributes;
  fontFamily: string | undefined;
  sizePt: number | undefined;
  color: Color | undefined;
  alignment: Alignment | undefined;
  // "The surrounded text is passed over by the formatter and is not displayed", per the Start/End of Text to Skip pair. Nested pairs are possible, so this is a depth rather than a flag.
  skipDepth: number;
  // The style scopes currently open, innermost last. A scope with no structural meaning is still pushed, so its own closing code pops it rather than the one enclosing it.
  readonly styleScopes: StyleScopeEntry[];
  // Depth of style-packet resolution currently in progress, guarding against a corrupt or adversarial file whose style packets reference one another in a cycle, resolving one style's own begin block can itself open a style scope, so without a bound a cyclic reference would recurse without limit over untrusted document bytes.
  styleResolutionDepth: number;
  // The structural facts of the paragraph currently accumulating, captured when its first character arrives rather than when it closes: a heading's style region ends at the style's own End Off code, which in a real document sits BEFORE the hard return that ends the paragraph, so reading the scope stack at flush time would find it already popped.
  pendingHeadingLevel: number | undefined;
  pendingListLevel: number | undefined;
  // A line-scoped alignment a Tab group centring or flush-right code began, which outranks the document-level justification for the paragraph it sits in and clears when that paragraph closes.
  pendingAlignment: Alignment | undefined;
  // Depth of open Paragraph Number Display pairs, whose rendered digits are suppressed in favour of the list membership that regenerates them.
  numberDisplayDepth: number;
  page: PageState;
  table: TableState | undefined;
  readonly reported: Set<string>;
  // The run-scoped constructs (document-schema.js's RunConstructExtent) opened within the paragraph currently accumulating, currently just a merge FIELD's own field-code text, tagged so a consumer can tell "this run's text is a mail-merge placeholder, not typed prose" without losing the placeholder's own displayed spelling. Attached to the paragraph when it flushes and cleared afterwards; a paragraph with none carries no `constructs` field at all, the overwhelmingly common case.
  pendingConstructs: RunConstructExtent[];
  // The run index (into `runs`) a FIELD On merge code opened, or undefined when no FIELD scope is currently open. Reset to undefined, abandoning the in-progress field, rather than reused across paragraphs, whenever a paragraph flushes with one still open: `runs` is spliced empty by flushParagraph, so an index into the paragraph that just closed means nothing in the one that follows.
  openMergeFieldStartRun: number | undefined;
  // The page furniture a D6 function has filled so far, per kind, keyed by the shared vocabulary's slots. A second function claiming a slot a first already filled is reported rather than overwritten, WordPerfect's own A/B two-slot-per-kind mechanism is a shape the one-flow-per-slot vocabulary does not carry.
  readonly headers: ContentPageFurniture;
  readonly footers: ContentPageFurniture;
  readonly watermarks: ContentPageFurniture;
  readonly furnitureFilled: Set<string>;
  // The note reference a D7 On function opened, or undefined when none is currently open. Abandoned at a paragraph boundary exactly like a merge FIELD, for the identical run-index reason.
  openNote:
    | { anchorType: "footnote" | "endnote"; startRun: number; prefixId: number }
    | undefined;
  // Every note whose body a D7 On/Off pair named, in document order, bodies folded from each function's own General WP Text packet. The flat ContentDocument has no home for a note body (its real home is the tree's definitions table), so readWpdContent reports these and readWpd carries them.
  readonly notes: WpdNoteDefinition[];
  // Every native OLE object an image box's Graphics Filename packet named, in document order, bytes recovered through stream/ole.ts. The flat ContentDocument has no field for opaque binary bytes (its real home is the tree's attachments table), so readWpdContent reports these and readWpd carries them, the identical flat/tree split the note bodies above take.
  readonly oleObjects: WpdOleObject[];
}

// One lifted note, shaped exactly as the definitions-table note tenant the tree form carries ({ kind, marker, blocks }, the tenant vocabulary markdown-codec's own footnote definitions established): the reference marker is the text the D7 On/Off pair encloses, the body the packet its prefix ID names.
export interface WpdNoteDefinition {
  readonly anchorType: "footnote" | "endnote";
  readonly marker: string;
  readonly blocks: readonly ContentBlock[];
}

// The result foldTokens hands back to whichever caller (readWpdContent, an applier folding a nested stream) started the fold: the section-level fields a flat ContentDocument or a nested embedded document both need.
export interface FoldResult {
  readonly blocks: ContentBlock[];
  readonly page: PageState;
  readonly headers: ContentPageFurniture;
  readonly footers: ContentPageFurniture;
  readonly watermarks: ContentPageFurniture;
  readonly notes: readonly WpdNoteDefinition[];
  readonly oleObjects: readonly WpdOleObject[];
}

// The two continuations a handful of split-out appliers need back into the core fold engine: an applier lifting a nested WP text stream (a header/footer/note body, a box's text or equation content, a WPG graphic's own Text Data) calls FoldTokensFn to fold it exactly as the main document area is folded; applyStylePacketBegin calls ApplyTokenFn to replay a style's own begin-block function codes as if the author had typed them. Passed in by read.ts at the call site rather than imported back, so none of the split modules depends on read.ts itself.
export type FoldTokensFn = (
  tokens: readonly WpdToken[],
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
) => FoldResult;

export type ApplyTokenFn = (
  state: ReaderState,
  token: WpdToken,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
) => void;
