import type {
  Alignment,
  Color,
  ContentBlock,
  ContentCellFill,
  ContentDocument,
  ContentEmbeddedObjectBlock,
  ContentPageFurniture,
  ContentParagraph,
  ContentRun,
  ContentTableCell,
  ContentTableRow,
  DocumentTree,
  LayoutMetadata,
  RunConstructExtent,
} from "document-schema.js";
import { assembleTree } from "document-schema.js";
import { bytesToBase64 } from "./bytes/base64";
import { uint16At } from "./bytes/view";
import { readFurnitureClaim } from "./stream/furniture";
import {
  openWpdDocument,
  type WpdDocumentContainer,
} from "./container/container";
import {
  PACKET_TYPE_DESIRED_FONT_DESCRIPTOR,
  PACKET_TYPE_GENERAL_WP_TEXT,
  packetByPrefixId,
  readGeneralWpTextBlocks,
  readTypefaceName,
} from "./container/prefix";
import {
  PACKET_TYPE_EXTENDED_DOCUMENT_SUMMARY,
  readDocumentSummary,
} from "./container/summary";
import {
  NOOP_WPD_DIAGNOSTIC_SINK,
  WpdDiagnosticCodes,
  type WpdDiagnosticSink,
} from "./diagnostics";
import {
  ATTRIBUTE_OFF,
  ATTRIBUTE_ON,
  decodeAttributeByte,
  runAttributesFrom,
  type WpdRunAttributes,
} from "./stream/attributes";
import {
  decodeSingleByteCharacter,
  decodeWpCharacter,
  UNMAPPED_CHARACTER,
} from "./stream/characters";
import {
  eolMappingForSubfunction,
  EOL_GROUP,
  isSingleByteEol,
  subfunctionForSingleByteEol,
  type WpdEolMapping,
} from "./stream/eol";
import {
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
import {
  DISPLAY_NUMBER_GROUP,
  isParagraphNumberDisplayOff,
  isParagraphNumberDisplayOn,
  isStyleScopeCloser,
  isStyleScopeOpener,
  PACKET_TYPE_NORMAL_STYLE,
  readDisplayNumberLevel,
  readStyleBeginBlock,
  readSystemStyleNumber,
  STYLE_GROUP,
  styleSemanticsFor,
  type WpdStyleSemantics,
} from "./stream/style";
import {
  CELL_FILL_COLORS_SUBFUNCTION,
  CELL_FORMULA_SUBFUNCTION,
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
import {
  BOX_CONTENT_TYPE_EQUATION,
  BOX_CONTENT_TYPE_IMAGE,
  BOX_CONTENT_TYPE_LINKED_TEXT,
  BOX_CONTENT_TYPE_TEXT,
  readBoxContent,
} from "./stream/box";
import { readTableFormula } from "./stream/formula";
import { scanImagePayload } from "./stream/image";
import {
  PACKET_TYPE_GRAPHICS_CACHED_FILE_DATA,
  PACKET_TYPE_GRAPHICS_FILENAME,
  readGraphicsChildIds,
  readOleObject,
  type WpdOleObject,
} from "./stream/ole";
import { tabEffectFor, TAB_GROUP } from "./stream/tab";
import { decodeWpgGraphic, type WpgDecode } from "./stream/wpg";
import { tokeniseDocumentArea, type WpdToken } from "./stream/tokenise";

// -- Document area to ContentDocument --
//
// The document area is a flat stream of characters and function codes, so building a document out of it is a fold: characters accumulate into the current run, an attribute or font change closes that run and opens another, and an end-of-line function closes the current paragraph. Nothing here is recursive and nothing looks ahead, which is what makes a hand-written reader tractable for this format at all.
//
// The fold has exactly one nesting concept, and it is not recursion: a table redirects where paragraphs land. While a table definition is open, a closed paragraph joins the cell currently being built rather than the section's own block list -- and a table's cells hold blocks, which is as deep as this format's own grid model goes.
//
// What each function code means comes from the specification's own tables, not from inference -- most importantly the "Conversion/Search mappings" column of the End-of-Line group (src/stream/eol.ts), which states outright which codes a converting application should turn into a space and which into a hard return.

// The single-byte functions this reader gives a meaning to, from WPFF "Single-Byte Functions". Everything else in 0x80-0xB3 is a formatting or bookkeeping code that contributes no characters and no structure -- a speller-clean marker, a joiner control, a math-column code -- and is passed over rather than listed.
const SOFT_SPACE = 0x80;
const HARD_SPACE = 0x81;
const SOFT_HYPHEN_IN_LINE = 0x82;
const SOFT_HYPHEN_AT_END_OF_LINE = 0x83;
const HARD_HYPHEN_IN_LINE = 0x84;
const AUTO_HYPHEN_AT_END_OF_LINE = 0x85;
const INVISIBLE_RETURN_IN_LINE = 0x86;
const DORMANT_HARD_RETURN = 0x87;
const SOFT_END_OF_CENTER_ALIGN = 0x88;
const HARD_END_OF_CENTER_ALIGN = 0x89;
const START_OF_TEXT_TO_SKIP = 0x8d;
const END_OF_TEXT_TO_SKIP = 0x8e;

// Variable-length groups and the subgroups this reader interprets. The groups it recognises without interpreting -- boxes, notes, page furniture, cross-references, merge codes -- are named here too, so each can be reported through the diagnostic sink rather than passed over in silence.
const CROSS_REFERENCE_GROUP = 0xd5;
const HEADER_FOOTER_GROUP = 0xd6;
const FOOTNOTE_ENDNOTE_GROUP = 0xd7;
const MERGE_GROUP = 0xde;
// "FIELD On (field)" / "FIELD Off", the one paired merge subfunction this reader lifts: a mail-merge field reference is always a short inline placeholder, never a wrapper around multi-paragraph content the way a control-flow code (IF, FOR, CALL) can be, so its own On/Off pair fits the run-scoped construct mechanism cleanly. "Each instance of a subfunction will consist of the On subfunction, a string of information, and the Off subfunction" -- and per the SDK's own byte layout for every paired merge subfunction, that string sits in the document stream itself, AFTER the On function's own gates, as ordinary characters this reader already decodes -- not inside the function's non-deletable data. Every other paired and non-paired merge subfunction (ASSIGN, CALL, IF, FOR, CASE, and the rest of WordPerfect's own merge scripting language) stays reported through the diagnostic sink: modelling a scripting language's control flow has no construct in the shared schema, and unlike FIELD it can legitimately wrap whole paragraphs of body text, which the run-scoped mechanism cannot express at all.
const MERGE_FIELD_ON = 0x4c;
const MERGE_FIELD_OFF = 0x4d;
const BOX_GROUP = 0xdf;
const PARAGRAPH_GROUP = 0xd3;
const PARAGRAPH_SET_JUSTIFICATION = 0x05;
const CHARACTER_GROUP = 0xd4;
const CHARACTER_COLOR = 0x18;
const CHARACTER_FONT_FACE_CHANGE = 0x1a;
const CHARACTER_FONT_SIZE_CHANGE = 0x1b;

// Fixed-length function codes this reader interprets.
const EXTENDED_CHARACTER = 0xf0;

// "0 = left, 1 = full, 2 = center, 3 = right, 4 = full all lines (kinto waritsuke), 5 = reserved (decimal aligned in tables)", per WPFF D3 Paragraph, Set Justification Mode. Members 4 and 5 have no counterpart in the shared schema's four-member Alignment: full-all-lines is a justification variant the schema does not distinguish from `justify`, and decimal alignment is a table-cell concern rather than a paragraph one, so it maps to the same `left` a cell's text defaults to.
const JUSTIFICATION: readonly Alignment[] = [
  "left",
  "justify",
  "center",
  "right",
  "justify",
  "left",
];

// "Font point sizes are given in 3600ths of an inch", per WPFF Document Structure's units glossary. A point is 1/72 inch, so 3600ths divide by 50 to give points.
const THREE_THOUSAND_SIX_HUNDREDTHS_PER_POINT = 50;

// The colour byte range the SDK states for RGB: "Each color takes one byte with a range from 0 to 255 (0xFF) where 255 is 100%." The shared schema's Color is 0..1, so each component divides by 255.
const COLOR_COMPONENT_MAX = 255;

// A span count of one covers only the cell stating it, which is what every unmerged cell says, so it carries no merge at all and the shared schema's colSpan/rowSpan stay absent.
const NO_SPAN = 1;

export interface ReadWpdOptions {
  readonly sink?: WpdDiagnosticSink;
  // The password for a document whose header's encryption word is non-zero. The standard ("original") WordPerfect encryption mode is decrypted with it (src/container/encryption.ts); a wrong password throws WpdWrongPasswordError, an encrypted document read without one still throws WpdEncryptedDocumentError, and a password supplied for an unencrypted document is ignored -- the identical contract doc-codec's and xls-codec's own password options hold.
  readonly password?: string;
}

// The page geometry the document states, one field per function that states it. Each stays undefined until its own function appears, so a document overriding only its top margin keeps the WordPerfect default for the other four rather than for none of them.
interface PageState {
  widthPt: number | undefined;
  heightPt: number | undefined;
  topPt: number | undefined;
  rightPt: number | undefined;
  bottomPt: number | undefined;
  leftPt: number | undefined;
  changeReported: boolean;
}

// The cell attributes an End-of-Line function's own embedded subfunctions state about the cell it closes.
interface CellAttributes {
  readonly alignment: Alignment | undefined;
  readonly background: ContentCellFill | undefined;
  readonly columnSpan: number;
  readonly rowSpan: number;
  readonly covered: boolean;
  readonly formula: string | undefined;
}

// A table under construction. `definingColumns` is true between Table Definition and Define Table End, the window in which Table Column functions state the grid's widths and no content can appear.
interface TableState {
  readonly columnWidthsPt: number[];
  readonly rows: ContentTableRow[];
  cells: ContentTableCell[];
  cellBlocks: ContentBlock[];
  definingColumns: boolean;
  rowHeightPt: number | undefined;
}

interface ReaderState {
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
  // Depth of style-packet resolution currently in progress, guarding against a corrupt or adversarial file whose style packets reference one another in a cycle -- resolving one style's own begin block can itself open a style scope, so without a bound a cyclic reference would recurse without limit over untrusted document bytes.
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
  // The run-scoped constructs (document-schema.js's RunConstructExtent) opened within the paragraph currently accumulating -- currently just a merge FIELD's own field-code text, tagged so a consumer can tell "this run's text is a mail-merge placeholder, not typed prose" without losing the placeholder's own displayed spelling. Attached to the paragraph when it flushes and cleared afterwards; a paragraph with none carries no `constructs` field at all, the overwhelmingly common case.
  pendingConstructs: RunConstructExtent[];
  // The run index (into `runs`) a FIELD On merge code opened, or undefined when no FIELD scope is currently open. Reset to undefined -- abandoning the in-progress field, rather than reused across paragraphs -- whenever a paragraph flushes with one still open: `runs` is spliced empty by flushParagraph, so an index into the paragraph that just closed means nothing in the one that follows.
  openMergeFieldStartRun: number | undefined;
  // The page furniture a D6 function has filled so far, per kind, keyed by the shared vocabulary's slots. A second function claiming a slot a first already filled is reported rather than overwritten -- WordPerfect's own A/B two-slot-per-kind mechanism is a shape the one-flow-per-slot vocabulary does not carry.
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
  // Every native OLE object an image box's Graphics Filename packet named, in document order, bytes recovered through stream/ole.ts. The flat ContentDocument has no field for opaque binary bytes (its real home is the tree's attachments table), so readWpdContent reports these and readWpd carries them -- the identical flat/tree split the note bodies above take.
  readonly oleObjects: WpdOleObject[];
}

// One lifted note, shaped exactly as the definitions-table note tenant the tree form carries ({ kind, marker, blocks } -- the tenant vocabulary markdown-codec's own footnote definitions established): the reference marker is the text the D7 On/Off pair encloses, the body the packet its prefix ID names.
export interface WpdNoteDefinition {
  readonly anchorType: "footnote" | "endnote";
  readonly marker: string;
  readonly blocks: readonly ContentBlock[];
}

// The direct-formatting state a style packet's own "beginning style text" block can change, snapshotted before applying that block so the style's own scope closer can restore exactly what it overrode -- the same fields a Font Face Change, Font Size Change, character-colour function, or Attribute On/Off can change directly in the main stream, because a style's begin block is folded through the identical applyToken dispatch those use.
interface FormattingSnapshot {
  readonly activeAttributes: ReadonlySet<number>;
  readonly fontFamily: string | undefined;
  readonly sizePt: number | undefined;
  readonly color: Color | undefined;
}

// One entry per currently-open style scope. `snapshot` is present only when this scope resolved its own packet (type 0x30) and applied a non-empty begin block -- a scope with no resolvable packet, or an empty one, changes nothing to restore.
interface StyleScopeEntry {
  readonly semantics: WpdStyleSemantics | undefined;
  readonly snapshot: FormattingSnapshot | undefined;
}

// A style-packet-resolution cycle -- corrupt or adversarial input, since a well-formed document's own styles never reference themselves -- is bounded rather than left to recurse without limit over untrusted bytes.
const MAX_STYLE_RESOLUTION_DEPTH = 16;

function sameAttributes(a: WpdRunAttributes, b: WpdRunAttributes): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike
  );
}

// Reports a diagnostic at most once per document. Every code below names a whole class of construct rather than one occurrence of it, so a document with two hundred boxes should say so once rather than two hundred times.
function reportOnce(
  state: ReaderState,
  sink: WpdDiagnosticSink,
  code: string,
  message: string,
): void {
  if (state.reported.has(code)) {
    return;
  }
  state.reported.add(code);
  sink({ code, message });
}

function buildRun(state: ReaderState): ContentRun {
  const run: ContentRun = { text: state.text };
  return {
    ...run,
    ...(state.attributes.bold ? { bold: true } : {}),
    ...(state.attributes.italic ? { italic: true } : {}),
    ...(state.attributes.underline ? { underline: true } : {}),
    ...(state.attributes.strike ? { strike: true } : {}),
    ...(state.fontFamily === undefined ? {} : { fontFamily: state.fontFamily }),
    ...(state.sizePt === undefined ? {} : { sizePt: state.sizePt }),
    ...(state.color === undefined ? {} : { color: state.color }),
  };
}

// Closes the run currently accumulating, if it has any text. A formatting change with no text between it and the previous one produces no run at all rather than an empty one.
function flushRun(state: ReaderState): void {
  if (state.text.length === 0) {
    return;
  }
  state.runs.push(buildRun(state));
  state.text = "";
}

// Where a closed block belongs: a table's current cell while one is open, the section's own list otherwise.
function targetBlocks(state: ReaderState): ContentBlock[] {
  return state.table === undefined ? state.blocks : state.table.cellBlocks;
}

// Closes the current paragraph. Called for every hard return, so a document with two consecutive hard returns genuinely produces an empty paragraph between them -- that blank line is content the author typed, not an artefact.
function flushParagraph(state: ReaderState, sink: WpdDiagnosticSink): void {
  flushRun(state);
  // A note's D7 On/Off pair encloses a reference site -- a run-scoped extent, the identical constraint a merge FIELD has: an On with no Off before this paragraph closed means `runs` is about to be emptied and the start index means nothing in the next paragraph. Abandoned rather than carried, with the diagnostic saying so.
  if (state.openNote !== undefined) {
    state.openNote = undefined;
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.NoteSpansParagraphs,
      "A footnote or endnote's own On/Off pair straddled a paragraph boundary, which the run-scoped note anchor cannot express; its reference text became ordinary paragraph text with no note anchor.",
    );
  }
  if (state.openMergeFieldStartRun !== undefined) {
    // A FIELD On with no matching FIELD Off before this paragraph closed: `runs` is about to be spliced empty, so the run index this field opened at means nothing in the paragraph that follows. Abandoned rather than carried forward -- the run-level extent mechanism cannot express a construct spanning two paragraphs, so no construct is emitted for this occurrence, and the diagnostic says so rather than the field silently vanishing with no trace.
    state.openMergeFieldStartRun = undefined;
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.MergeFieldSpansParagraphs,
      "A merge field's own On/Off pair straddled a paragraph boundary, which the run-scoped field construct cannot express; its text became ordinary paragraph text with no field tag.",
    );
  }
  // A line-scoped centring or flush-right code outranks the document-level justification: the Tab group code that begins one applies to the line it sits in, where Set Justification Mode applies from where it sits onwards.
  const alignment = state.pendingAlignment ?? state.alignment;
  const constructs = state.pendingConstructs.splice(
    0,
    state.pendingConstructs.length,
  );
  const paragraph: ContentParagraph = {
    kind: "paragraph",
    runs: state.runs.splice(0, state.runs.length),
    ...(alignment === undefined ? {} : { alignment }),
    ...(state.pendingHeadingLevel === undefined
      ? {}
      : { headingLevel: state.pendingHeadingLevel }),
    ...(state.pendingListLevel === undefined
      ? {}
      : { list: { level: state.pendingListLevel } }),
    ...(constructs.length === 0 ? {} : { constructs }),
  };
  state.pendingHeadingLevel = undefined;
  state.pendingListLevel = undefined;
  state.pendingAlignment = undefined;
  targetBlocks(state).push(paragraph);
}

// Closes the current paragraph only when it holds something. Used at every boundary that is a container edge rather than a line break -- a cell end, a row end, the end of the stream -- where an unconditional flush would fabricate a blank paragraph the author never typed.
function flushParagraphIfContent(
  state: ReaderState,
  sink: WpdDiagnosticSink,
): void {
  if (state.text.length === 0 && state.runs.length === 0) {
    return;
  }
  flushParagraph(state, sink);
}

// The innermost open style scope that says something structural. An enclosing Global On naming the document's Normal style does not override a heading style opened inside it, and a scope with no meaning at all is transparent. findLast walks the scope stack from its own last (innermost) entry backward toward the first (outermost), exactly the search order this needs, with no separate index arithmetic of its own to keep in step with the stack's own length.
function effectiveStyle(state: ReaderState): WpdStyleSemantics | undefined {
  return state.styleScopes.findLast((scope) => scope.semantics !== undefined)
    ?.semantics;
}

function appendText(state: ReaderState, text: string): void {
  if (state.skipDepth > 0 || state.numberDisplayDepth > 0) {
    return;
  }
  // The paragraph's structural facts are captured at its first character, not at its close -- see ReaderState.pendingHeadingLevel.
  if (
    state.pendingHeadingLevel === undefined &&
    state.pendingListLevel === undefined
  ) {
    const style = effectiveStyle(state);
    if (style !== undefined) {
      state.pendingHeadingLevel = style.headingLevel;
      state.pendingListLevel = style.listLevel;
    }
  }
  state.text += text;
}

// -- Tables --

// Reads the cell attributes an End-of-Line function carries for the cell it closes, out of its own embedded subfunction list.
function readCellAttributes(
  state: ReaderState,
  nonDeletable: Uint8Array,
  sink: WpdDiagnosticSink,
): { attributes: CellAttributes; rowHeightPt: number | undefined } {
  const { subfunctions, truncated } = readEmbeddedSubfunctions(nonDeletable);
  if (truncated) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.TableAttributesTruncated,
      "A cell's embedded attribute list held a record of undocumented length, so the attributes after it were not read.",
    );
  }

  const information = findEmbeddedSubfunction(
    subfunctions,
    CELL_INFORMATION_SUBFUNCTION,
  );
  const spanning = findEmbeddedSubfunction(
    subfunctions,
    CELL_SPANNING_SUBFUNCTION,
  );
  const fill = findEmbeddedSubfunction(
    subfunctions,
    CELL_FILL_COLORS_SUBFUNCTION,
  );
  const row = findEmbeddedSubfunction(
    subfunctions,
    ROW_INFORMATION_SUBFUNCTION,
  );
  const formulaData = findEmbeddedSubfunction(
    subfunctions,
    CELL_FORMULA_SUBFUNCTION,
  );
  const formula =
    formulaData === undefined ? undefined : readTableFormula(formulaData);
  if (formulaData !== undefined && formula === undefined) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.TableFormulaUnresolved,
      "A table cell carries a formula this reader could not decode with confidence, so the cell keeps its displayed text but not the formula that produced it.",
    );
  }

  const cellSpanning =
    spanning === undefined ? undefined : readCellSpanning(spanning);
  const cellFill = fill === undefined ? undefined : readCellFill(fill);
  if (cellFill?.blended === true) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.CellFillBlended,
      "A cell is filled with a shaded blend of two colours, resolved to a 'pattern' fill whose density is this reader's own best-effort derivation, not a value confirmed against a specification.",
    );
  }

  return {
    attributes: {
      alignment:
        information === undefined
          ? undefined
          : readCellInformation(information)?.alignment,
      background: cellFill?.fill,
      columnSpan: cellSpanning?.columnSpan ?? NO_SPAN,
      rowSpan: cellSpanning?.rowSpan ?? NO_SPAN,
      covered:
        cellSpanning?.coveredFromLeft === true ||
        cellSpanning?.coveredFromAbove === true,
      formula,
    },
    rowHeightPt:
      row === undefined ? undefined : readRowInformation(row)?.heightPt,
  };
}

// Closes the cell currently being built and appends it to the row under construction. A cell the spanning subfunction marks as covered by a neighbour's merge is dropped instead: the shared schema states a merged region as one entry carrying colSpan/rowSpan with no entry at all at the positions it covers, so emitting one would double-count the region.
function closeCell(
  state: ReaderState,
  table: TableState,
  attributes: CellAttributes,
  sink: WpdDiagnosticSink,
): void {
  flushParagraphIfContent(state, sink);
  const blocks = table.cellBlocks;
  table.cellBlocks = [];
  if (attributes.covered) {
    return;
  }
  // A cell states its own justification ("bit 1: 1 = use cell justification"), and the shared schema carries alignment on the paragraph rather than the cell -- so the cell's statement lands on the paragraphs it holds, overriding the document-level justification they were built with. A cell whose flag leaves justification inherited states nothing, and its paragraphs keep what they had.
  if (attributes.alignment !== undefined) {
    for (const block of blocks) {
      if (block.kind === "paragraph") {
        block.alignment = attributes.alignment;
      }
    }
  }
  const cell: ContentTableCell = {
    blocks,
    ...(attributes.columnSpan > NO_SPAN
      ? { colSpan: attributes.columnSpan }
      : {}),
    ...(attributes.rowSpan > NO_SPAN ? { rowSpan: attributes.rowSpan } : {}),
    // ContentTableCell.background is document-schema.js's discriminated ContentCellFill (ExaDev/documents.js#951); readCellFill (stream/table.ts) already resolves the real 'solid'/'pattern' shape, including a genuine two-colour blend (ExaDev/documents.js#1024), so this just passes it through.
    ...(attributes.background === undefined
      ? {}
      : { background: attributes.background }),
    ...(attributes.formula === undefined
      ? {}
      : { formula: attributes.formula }),
  };
  table.cells.push(cell);
}

function closeRow(table: TableState): void {
  if (table.cells.length === 0) {
    return;
  }
  const row: ContentTableRow = {
    cells: table.cells,
    ...(table.rowHeightPt === undefined ? {} : { heightPt: table.rowHeightPt }),
  };
  table.cells = [];
  table.rowHeightPt = undefined;
  table.rows.push(row);
}

// Closes the table and appends it to whatever block list encloses it. A table with no rows at all -- a definition the document never filled -- is dropped rather than emitted as an empty grid.
function closeTable(state: ReaderState): void {
  const table = state.table;
  if (table === undefined) {
    return;
  }
  state.table = undefined;
  if (table.rows.length === 0) {
    return;
  }
  targetBlocks(state).push({
    kind: "table",
    rows: table.rows,
    columnWidthsPt: table.columnWidthsPt,
  });
}

// Applies whatever the End-of-Line group's conversion table says this code means. The table is shared by the single-byte spelling (0xB4-0xCF) and the multi-byte one (group 0xD0), because the specification states the two are interchangeable. `nonDeletable` is the multi-byte spelling's own payload, which is where a table's per-cell attributes ride; the single-byte spelling carries none, so it passes an empty view.
function applyEolMapping(
  state: ReaderState,
  mapping: WpdEolMapping,
  nonDeletable: Uint8Array,
  sink: WpdDiagnosticSink,
): void {
  switch (mapping) {
    case "ignore":
      return;
    case "space":
      appendText(state, " ");
      return;
    case "hardReturn":
      flushParagraph(state, sink);
      return;
    case "hardEndOfColumn":
      // The shared content schema has no column-break block: ContentSection.breakType describes how a section begins, not a break inside one. Ending the paragraph keeps the text on either side apart, which is the part that matters for content, and the diagnostic records what was lost.
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.ColumnBreakFlattened,
        "A column break became a paragraph break.",
      );
      flushParagraph(state, sink);
      return;
    case "hardEndOfPage":
      flushParagraph(state, sink);
      targetBlocks(state).push({ kind: "pageBreak" });
      return;
    case "tableCell":
    case "tableRow":
    case "hardTableRow":
    case "tableOff": {
      const table = state.table;
      if (table === undefined) {
        // A cell or row boundary with no definition open has no grid to belong to. Ending the paragraph keeps the text on either side apart, so nothing is lost but the structure that was never stated.
        reportOnce(
          state,
          sink,
          WpdDiagnosticCodes.TableFlattened,
          "A table cell or row boundary appeared with no table definition open; its text became a paragraph.",
        );
        flushParagraph(state, sink);
        return;
      }
      const { attributes, rowHeightPt } = readCellAttributes(
        state,
        nonDeletable,
        sink,
      );
      if (rowHeightPt !== undefined) {
        table.rowHeightPt = rowHeightPt;
      }
      // A cell boundary always closes a cell, even an empty one -- a blank cell in the middle of a row is real content the grid has a position for. Table Off is the exception: a document that already ended its last row with a row code leaves nothing open, so closing a cell there would append a spurious empty one. Both spellings occur, and the difference is exactly whether anything is still accumulating.
      const cellIsOpen =
        state.text.length > 0 ||
        state.runs.length > 0 ||
        table.cellBlocks.length > 0;
      if (mapping !== "tableOff" || cellIsOpen) {
        closeCell(state, table, attributes, sink);
      }
      if (mapping === "tableCell") {
        return;
      }
      closeRow(table);
      if (mapping === "tableOff") {
        closeTable(state);
      }
      return;
    }
  }
}

function applySingleByteFunction(
  state: ReaderState,
  code: number,
  sink: WpdDiagnosticSink,
): void {
  if (isSingleByteEol(code)) {
    const mapping = eolMappingForSubfunction(subfunctionForSingleByteEol(code));
    if (mapping !== undefined) {
      applyEolMapping(state, mapping, new Uint8Array(0), sink);
    }
    return;
  }
  switch (code) {
    case SOFT_SPACE:
      appendText(state, " ");
      return;
    case HARD_SPACE:
      // "A hard space holds two words together on one line (names, dates, etc)" -- exactly what U+00A0 is for, so the distinction from a soft space survives into the shared schema rather than being flattened away. Written as an escape rather than the literal character, which is indistinguishable from a plain space in source.
      appendText(state, "\u00A0");
      return;
    case SOFT_HYPHEN_IN_LINE:
    case INVISIBLE_RETURN_IN_LINE:
      // Both mark a permitted break point that is not currently taken, and neither shows a character: "the soft hyphen code remains in the document, but has no effect", and the invisible return "indicates that a word can be broken at this point, but a hyphen won't be visible".
      return;
    case SOFT_HYPHEN_AT_END_OF_LINE:
    case HARD_HYPHEN_IN_LINE:
    case AUTO_HYPHEN_AT_END_OF_LINE:
      appendText(state, "-");
      return;
    case DORMANT_HARD_RETURN:
      // "Whenever a [HRt] code appears alone at the top of a page that starts with a soft page break, the formatter changes the Hard Return code into a Dormant Hard Return code." It is a hard return whose blank line the formatter suppresses at a page top; the paragraph boundary the author typed is still there, so it is kept.
      flushParagraph(state, sink);
      return;
    case SOFT_END_OF_CENTER_ALIGN:
      // "The formatter inserts a soft End of Line, which causes centering to end, but not the paragraph" -- a wrap, so the same space every other soft end of line converts to.
      appendText(state, " ");
      return;
    case HARD_END_OF_CENTER_ALIGN:
      // "The Enter key is pressed, ending the line, the centering, and the paragraph."
      flushParagraph(state, sink);
      return;
    case START_OF_TEXT_TO_SKIP:
      state.skipDepth += 1;
      return;
    case END_OF_TEXT_TO_SKIP:
      state.skipDepth = Math.max(0, state.skipDepth - 1);
      return;
    default:
      // Every remaining single-byte function is a formatting or bookkeeping marker that contributes neither characters nor structure.
      return;
  }
}

function applyFontFaceChange(
  state: ReaderState,
  prefixIds: readonly number[],
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  const prefixId = prefixIds[0];
  if (prefixId === undefined) {
    return;
  }
  const packet = packetByPrefixId(container.packets, prefixId);
  if (packet === undefined) {
    sink({
      code: WpdDiagnosticCodes.MissingPrefixPacket,
      message: `A font face change names prefix ID ${prefixId}, which this document's index does not carry.`,
    });
    return;
  }
  if (packet.packetType !== PACKET_TYPE_DESIRED_FONT_DESCRIPTOR) {
    return;
  }
  const typeface = readTypefaceName(packet.bytes);
  if (typeface === undefined) {
    return;
  }
  flushRun(state);
  state.fontFamily = typeface;
}

// Records one page-geometry statement. The first statement of each dimension wins: ContentSection carries one page geometry, so a document that changes its page size or a margin partway through has more geometry than the flat model has room for, and the document's own opening statement is the one every page shares until it changes.
function setPageDimension(
  state: ReaderState,
  field: keyof Omit<PageState, "changeReported">,
  value: number,
  sink: WpdDiagnosticSink,
): void {
  const current = state.page[field];
  if (current === undefined) {
    state.page[field] = value;
    return;
  }
  if (current !== value && !state.page.changeReported) {
    state.page.changeReported = true;
    sink({
      code: WpdDiagnosticCodes.PageGeometryChanged,
      message:
        "This document changes its page size or margins partway through; the section carries the geometry the document opens with.",
    });
  }
}

function applyPageGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  sink: WpdDiagnosticSink,
): void {
  if (token.subgroup === PAGE_FORM) {
    const form = readPageForm(token.nonDeletable);
    if (form === undefined) {
      return;
    }
    if (form.landscape) {
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.LandscapeOrientationUnmapped,
        "The document's form declares a landscape orientation; the form's own stated width and length are used as written, since a page size carries no orientation.",
      );
    }
    setPageDimension(state, "widthPt", form.widthPt, sink);
    setPageDimension(state, "heightPt", form.heightPt, sink);
    return;
  }
  const margin = readMarginPt(token.nonDeletable);
  if (margin === undefined) {
    return;
  }
  if (token.subgroup === PAGE_TOP_MARGIN_SET) {
    setPageDimension(state, "topPt", margin, sink);
  } else if (token.subgroup === PAGE_BOTTOM_MARGIN_SET) {
    setPageDimension(state, "bottomPt", margin, sink);
  }
}

function applyColumnGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  sink: WpdDiagnosticSink,
): void {
  const margin = readMarginPt(token.nonDeletable);
  if (margin === undefined) {
    return;
  }
  if (token.subgroup === COLUMN_LEFT_MARGIN_SET) {
    setPageDimension(state, "leftPt", margin, sink);
  } else if (token.subgroup === COLUMN_RIGHT_MARGIN_SET) {
    setPageDimension(state, "rightPt", margin, sink);
  }
}

// Captures the direct-formatting fields a style's own begin block can change, so its scope closer can restore exactly what it overrode.
function snapshotFormatting(state: ReaderState): FormattingSnapshot {
  return {
    activeAttributes: new Set(state.activeAttributes),
    fontFamily: state.fontFamily,
    sizePt: state.sizePt,
    color: state.color,
  };
}

function restoreFormattingSnapshot(
  state: ReaderState,
  snapshot: FormattingSnapshot,
): void {
  flushRun(state);
  state.activeAttributes.clear();
  for (const attribute of snapshot.activeAttributes) {
    state.activeAttributes.add(attribute);
  }
  state.attributes = runAttributesFrom(state.activeAttributes);
  state.fontFamily = snapshot.fontFamily;
  state.sizePt = snapshot.sizePt;
  state.color = snapshot.color;
}

// Resolves a style scope's own packet (type 0x30, named by the opening function's own prefix ID) and applies its "beginning style text" block's own function codes -- font face/size/colour changes, attribute on/off -- exactly as if the author had typed them at the point the scope opened. Returns the pre-application snapshot when it changed anything, so the scope's closer can restore it; returns undefined for a scope with no resolvable packet, an empty begin block, or a resolution depth this reader will not recurse past.
function applyStylePacketBegin(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): FormattingSnapshot | undefined {
  const prefixId = token.prefixIds[0];
  if (prefixId === undefined) {
    return undefined;
  }
  const packet = packetByPrefixId(container.packets, prefixId);
  if (packet?.packetType !== PACKET_TYPE_NORMAL_STYLE) {
    return undefined;
  }
  const beginBlock = readStyleBeginBlock(packet.bytes);
  if (beginBlock === undefined) {
    return undefined;
  }
  if (state.styleResolutionDepth >= MAX_STYLE_RESOLUTION_DEPTH) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.StyleResolutionDepthExceeded,
      "A chain of styles resolving one another's own packets ran deeper than this reader will follow, so the deepest style's own direct formatting was not applied.",
    );
    return undefined;
  }
  const snapshot = snapshotFormatting(state);
  const tokens = tokeniseDocumentArea(beginBlock, 0, beginBlock.length);
  state.styleResolutionDepth += 1;
  for (const beginToken of tokens) {
    applyToken(state, beginToken, container, sink);
  }
  state.styleResolutionDepth -= 1;
  return snapshot;
}

function applyStyleGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  if (isStyleScopeOpener(token.subgroup)) {
    const systemStyleNumber = readSystemStyleNumber(token.nonDeletable);
    const semantics =
      systemStyleNumber === undefined
        ? undefined
        : styleSemanticsFor(systemStyleNumber);
    const snapshot = applyStylePacketBegin(state, token, container, sink);
    state.styleScopes.push({ semantics, snapshot });
    return;
  }
  if (isStyleScopeCloser(token.subgroup)) {
    // A closer with nothing open is a stream whose style codes do not pair -- possible in a document edited by a third-party writer. Popping nothing is the harmless reading; the alternative, treating it as an error, would refuse a document whose text is entirely readable.
    const entry = state.styleScopes.pop();
    if (entry?.snapshot !== undefined) {
      restoreFormattingSnapshot(state, entry.snapshot);
    }
  }
}

function applyDisplayNumberGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  sink: WpdDiagnosticSink,
): void {
  if (isParagraphNumberDisplayOn(token.subgroup)) {
    const level = readDisplayNumberLevel(token.nonDeletable);
    // No separate `level !== undefined` guard is needed: pendingListLevel is only ever compared against undefined (never enumerated or spread conditionally on its own presence), so assigning it an undefined level when the level itself could not be read is indistinguishable from leaving it untouched.
    state.pendingListLevel ??= level;
    state.numberDisplayDepth += 1;
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.OutlineNumberRegenerated,
      "An outline number's rendered digits were replaced by the list membership that regenerates them.",
    );
    return;
  }
  if (isParagraphNumberDisplayOff(token.subgroup)) {
    state.numberDisplayDepth = Math.max(0, state.numberDisplayDepth - 1);
  }
}

function applyCharacterGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  switch (token.subgroup) {
    case CHARACTER_TABLE_DEFINITION:
      // A table inside a table has no spelling in this format -- the definition function is not recursive -- so an open table is closed before a new one opens rather than nesting one grid inside another cell.
      closeTable(state);
      flushParagraphIfContent(state, sink);
      state.table = {
        columnWidthsPt: [],
        rows: [],
        cells: [],
        cellBlocks: [],
        definingColumns: true,
        rowHeightPt: undefined,
      };
      return;
    case CHARACTER_TABLE_COLUMN: {
      const table = state.table;
      if (!table?.definingColumns) {
        return;
      }
      const widthPt = readTableColumnWidthPt(token.nonDeletable);
      if (widthPt !== undefined) {
        table.columnWidthsPt.push(widthPt);
      }
      return;
    }
    case CHARACTER_DEFINE_TABLE_END:
      if (state.table !== undefined) {
        state.table.definingColumns = false;
      }
      return;
    case CHARACTER_FONT_FACE_CHANGE:
      applyFontFaceChange(state, token.prefixIds, container, sink);
      return;
    case CHARACTER_FONT_SIZE_CHANGE: {
      // "[desired point size (3600ths)]" is the first field of this function's non-deletable data. Its prefix ID names the OLD typeface descriptor, so it says nothing about the face and is deliberately not read here.
      if (token.nonDeletable.length < 2) {
        return;
      }
      const sizePt =
        uint16At(token.nonDeletable, 0) /
        THREE_THOUSAND_SIX_HUNDREDTHS_PER_POINT;
      if (sizePt <= 0) {
        return;
      }
      flushRun(state);
      state.sizePt = sizePt;
      return;
    }
    case CHARACTER_COLOR: {
      const [r, g, b] = token.nonDeletable;
      if (r === undefined || g === undefined || b === undefined) {
        return;
      }
      flushRun(state);
      state.color = {
        r: r / COLOR_COMPONENT_MAX,
        g: g / COLOR_COMPONENT_MAX,
        b: b / COLOR_COMPONENT_MAX,
      };
      return;
    }
    default:
      return;
  }
}

// FIELD On opens a run-scoped extent at the run boundary it sits at; FIELD Off closes it and tags the runs in between as a FieldDescriptor construct, `instruction` being exactly the field-code text that flowed through as ordinary characters between the two -- so a merge field's own displayed spelling is both kept as real run content (a template genuinely shows its own field codes, not a merged result) and tagged as a placeholder rather than typed prose. Every other merge subfunction still reports through the diagnostic sink, unchanged.
// Lifts a D6 header, footer, or watermark function's body into the section's page furniture: the claim (which kind, which slot) comes from stream/furniture.ts's own subgroup + occurrence-byte reading, the body from the General WP Text packet the function's first prefix ID names -- folded through the identical tokeniser and fold the main document area uses, exactly as a box's own text content is. A watermark is page furniture with a parity like the other two (its occurrence bits narrow onto the same slots) and lands in ContentSection.watermarks, its own field beside the headers/footers pair -- it is painted behind the body on every page it occurs on, not banded at a page edge. A function whose claim narrows onto nothing (suppressed on both parities in its own file), an unresolvable packet, or a second function claiming a slot a first already filled stays reported rather than guessed at.
function applyHeaderFooterGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  const claim = readFurnitureClaim(token.subgroup, token.nonDeletable);
  if (claim === "none") {
    return;
  }
  const slotKey = `${claim.kind}:${claim.slot}`;
  if (state.furnitureFilled.has(slotKey)) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.HeaderFooterDropped,
      `This document declares a second ${claim.kind} for the ${claim.slot} slot -- WordPerfect's own A/B two-slot-per-kind mechanism, which the shared one-flow-per-slot page-furniture vocabulary does not carry; the first ${claim.kind} to claim the slot is the one lifted.`,
    );
    return;
  }
  const blocks = furnitureBodyBlocks(state, token, container, sink);
  if (blocks === undefined) {
    return;
  }
  state.furnitureFilled.add(slotKey);
  const furniture =
    claim.kind === "header"
      ? state.headers
      : claim.kind === "footer"
        ? state.footers
        : state.watermarks;
  furniture[claim.slot] = blocks;
}

// A D6 function's own body: the General WP Text packet its first prefix ID names, folded to blocks through the identical machinery the main stream uses. Reports and answers undefined when the packet cannot be resolved or read -- the honest-or-nothing contract every other body resolution here holds.
function furnitureBodyBlocks(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): ContentBlock[] | undefined {
  const prefixId = token.prefixIds[0];
  const packet =
    prefixId === undefined
      ? undefined
      : packetByPrefixId(container.packets, prefixId);
  if (packet?.packetType !== PACKET_TYPE_GENERAL_WP_TEXT) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.HeaderFooterDropped,
      "This document declares a header, footer, or watermark whose body packet this reader could not resolve; it was not lifted.",
    );
    return undefined;
  }
  const textBlocks = readGeneralWpTextBlocks(packet.bytes);
  if (textBlocks === undefined) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.HeaderFooterDropped,
      "This document declares a header, footer, or watermark whose body packet this reader could not read; it was not lifted.",
    );
    return undefined;
  }
  const nested = tokeniseDocumentArea(textBlocks, 0, textBlocks.length);
  return foldTokens(nested, container, sink).blocks;
}

// The note subfunctions, per WPFF "D7 Footnote/Endnote Functions": even-numbered codes are the On functions (0 Footnote On, 2 Endnote On, each naming its body packet through its first prefix ID), odd-numbered the Off (1 Footnote Off, 3 Endnote Off). Each On's body is encased between its own On and Off.
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D7-FootnoteEndNote.htm
const FOOTNOTE_ON = 0x00;
const FOOTNOTE_OFF = 0x01;
const ENDNOTE_ON = 0x02;
const ENDNOTE_OFF = 0x03;

// Lifts a D7 note pair as the shared model's note-anchor construct plus a definitions-ready body: the On opens a run-scoped anchor extent at the reference site (the encased text is the reference marker -- typically the note's own rendered number), the Off closes it and resolves the body from the packet the On's first prefix ID named. The anchor descriptor's definition key is the position it will hold in the tree form's definitions table (note-1, note-2, ... in document order), which readWpd splices in; the flat readWpdContent emits the anchor and reports the body, whose real home is exactly that table.
function applyNoteGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  if (token.subgroup === FOOTNOTE_ON || token.subgroup === ENDNOTE_ON) {
    flushRun(state);
    const prefixId = token.prefixIds[0];
    if (prefixId === undefined) {
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.NoteDropped,
        "This document contains a footnote or endnote whose body packet this reader could not resolve; only its reference text survived.",
      );
      return;
    }
    state.openNote = {
      anchorType: token.subgroup === FOOTNOTE_ON ? "footnote" : "endnote",
      startRun: state.runs.length,
      prefixId,
    };
    return;
  }
  const closing =
    token.subgroup === FOOTNOTE_OFF
      ? "footnote"
      : token.subgroup === ENDNOTE_OFF
        ? "endnote"
        : undefined;
  if (closing === undefined) {
    return;
  }
  const open = state.openNote;
  state.openNote = undefined;
  if (open?.anchorType !== closing) {
    // An Off with no matching On -- a stream whose note pairs do not pair, or an On this reader already abandoned at a paragraph boundary (flushParagraph). Nothing to anchor.
    return;
  }
  flushRun(state);
  const endRun = state.runs.length;
  const marker =
    state.runs
      .slice(open.startRun, endRun)
      .map((run) => run.text)
      .join("") || String(state.notes.length + 1);
  const definition = `note-${state.notes.length + 1}`;
  state.pendingConstructs.push({
    descriptor: {
      kind: "anchor",
      anchorType: open.anchorType,
      name: marker,
      definition,
    },
    startRun: open.startRun,
    endRun,
  });
  const packet = packetByPrefixId(container.packets, open.prefixId);
  const textBlocks =
    packet?.packetType === PACKET_TYPE_GENERAL_WP_TEXT
      ? readGeneralWpTextBlocks(packet.bytes)
      : undefined;
  const nested =
    textBlocks === undefined
      ? undefined
      : tokeniseDocumentArea(textBlocks, 0, textBlocks.length);
  const blocks =
    nested === undefined
      ? undefined
      : foldTokens(nested, container, sink).blocks;
  if (blocks === undefined) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.NoteDropped,
      "This document contains a footnote or endnote whose body packet this reader could not read; its reference anchor survives and its body does not.",
    );
    return;
  }
  state.notes.push({ anchorType: open.anchorType, marker, blocks });
}

function applyMergeGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  sink: WpdDiagnosticSink,
): void {
  if (token.subgroup === MERGE_FIELD_ON) {
    flushRun(state);
    state.openMergeFieldStartRun = state.runs.length;
    return;
  }
  if (token.subgroup === MERGE_FIELD_OFF) {
    const startRun = state.openMergeFieldStartRun;
    state.openMergeFieldStartRun = undefined;
    if (startRun === undefined) {
      // An Off with no matching On -- a stream whose merge codes do not pair, or an On this reader already abandoned at a paragraph boundary (flushParagraph). Nothing to tag.
      return;
    }
    flushRun(state);
    const endRun = state.runs.length;
    const instruction = state.runs
      .slice(startRun, endRun)
      .map((run) => run.text)
      .join("");
    state.pendingConstructs.push({
      descriptor: { kind: "field", instruction },
      startRun,
      endRun,
    });
    return;
  }
  reportOnce(
    state,
    sink,
    WpdDiagnosticCodes.MergeCodeDropped,
    "This document contains merge codes, which are a form-letter template's placeholders rather than text.",
  );
}

// The plain text a box's own equation content contributes to its residue: every paragraph's runs, joined, with paragraphs themselves joined by a newline. Deliberately not real MathML -- WordPerfect's own equation notation is neither MathML nor LaTeX, and this reader has no grammar for it, so the raw notation is carried verbatim through ContentFormula's own residue channel (source.ts) rather than mislabelled as either.
function plainTextOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is ContentParagraph => block.kind === "paragraph")
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
    .join("\n");
}

// Lifts a box's own text, linked-text, or equation content, per stream/box.ts's own function-level override walk: a box's real content is ALWAYS named there (never its template), as the prefix ID of a General WP Text packet (type 0x08) whose own text blocks are this format's ordinary function-code stream -- readable through the identical tokeniser and fold the main document area uses. A box the override walk cannot resolve real content or a trustworthy frame for, or whose content type is image/OLE/presentation/other (this reader has no decoder for any of those payload shapes), stays reported through the diagnostic sink rather than guessed at.
//
// A box's WPG vector graphic: the Graphics Filename packet's 0x6F (Graphics Cached File Data) children each carry a whole graphics file's bytes ("Contains WPG cached file contents"), and the first child whose bytes decode as a WPG graphic wins. The graphic's own Text Data records are WP document streams, folded here through the identical tokeniser and fold the main document area uses -- the same fold a box's WP-text content and a header body take.
function decodeBoxWpg(
  container: WpdDocumentContainer,
  graphicsPacket: Parameters<typeof readGraphicsChildIds>[0],
  sink: WpdDiagnosticSink,
): WpgDecode | undefined {
  const childIds = readGraphicsChildIds(graphicsPacket);
  if (childIds === undefined) {
    return undefined;
  }
  for (const childId of childIds) {
    const child = packetByPrefixId(container.packets, childId);
    if (child?.packetType !== PACKET_TYPE_GRAPHICS_CACHED_FILE_DATA) {
      continue;
    }
    const decoded = decodeWpgGraphic(child.bytes, {
      foldTextData: (documentArea) =>
        foldTokens(
          tokeniseDocumentArea(documentArea, 0, documentArea.length),
          container,
          sink,
        ).blocks,
    });
    if (decoded !== undefined) {
      return decoded;
    }
  }
  return undefined;
}
function applyBoxGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  const boxContent = readBoxContent(token.nonDeletable, token.prefixIds);
  if (boxContent === undefined) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.BoxDropped,
      "This document contains a box -- a figure, text box, equation, or graphic -- whose function-level override names no content this reader can resolve.",
    );
    return;
  }

  // IMAGE content: the content prefix names a packet whose container spelling this reader has no specification for, so the lift is magic-driven -- scan the packet's raw bytes for a whole, structurally delimited PNG or JPEG payload (stream/image.ts) and carry exactly that span as a ContentImageBlock, never a guess at a container header. The box's own frame supplies the rendered size, and its absolute-from-page-edge position (the one case stream/box.ts can resolve) becomes the image's floatPosition -- the same anchored-position field a docx floating image carries. A packet that carries no raster is next tested for the two child-packet spellings a Graphics Filename packet (type 0x40) can name: a native OLE object (stream/ole.ts) and a WPG vector graphic (stream/wpg.ts).
  if (boxContent.contentType === BOX_CONTENT_TYPE_IMAGE) {
    const imagePacket = packetByPrefixId(
      container.packets,
      boxContent.contentPrefixId,
    );
    const payload =
      imagePacket === undefined
        ? undefined
        : scanImagePayload(imagePacket.bytes);
    if (payload === undefined) {
      const ole =
        imagePacket?.packetType === PACKET_TYPE_GRAPHICS_FILENAME
          ? readOleObject(
              container.packets,
              imagePacket,
              container.oleObjectStreams,
            )
          : undefined;
      if (ole !== undefined) {
        // The bytes are recovered but the flat ContentDocument has nowhere to put them -- the same split a note body takes. The frame is deliberately not required here: an attachment entry names bytes, it places nothing.
        state.oleObjects.push(ole);
        return;
      }
      const wpg =
        imagePacket?.packetType === PACKET_TYPE_GRAPHICS_FILENAME
          ? decodeBoxWpg(container, imagePacket, sink)
          : undefined;
      if (wpg !== undefined) {
        if (wpg.status === "refused") {
          sink({
            code: WpdDiagnosticCodes.WpgRecordsUndecoded,
            message:
              wpg.reason === "wpg1"
                ? "This document embeds a WPG 1.0 vector graphic, whose type-and-length record vocabulary predates the framed WPG 2.x stream this reader decodes, so it was not lifted."
                : wpg.reason === "encrypted"
                  ? "This document embeds an encrypted WPG vector graphic, which this reader does not decrypt, so it was not lifted."
                  : "This document embeds a WPG graphic whose record stream this reader could not walk (no well-formed Start WPG record), so it was not lifted.",
          });
          return;
        }
        if (boxContent.frame === undefined) {
          reportOnce(
            state,
            sink,
            WpdDiagnosticCodes.BoxFrameUnresolved,
            "This document contains a box whose content this reader could read, but whose function-level override states no width and height this reader can trust, so its content was not lifted.",
          );
          return;
        }
        if (wpg.skippedRecords.length > 0) {
          sink({
            code: WpdDiagnosticCodes.WpgRecordsUndecoded,
            message: `This document embeds a WPG vector graphic that partially decoded; the following record types were skipped: ${wpg.skippedRecords.join(", ")}.`,
          });
        }
        // The decoded graphic rides as a nested one-page drawing document -- ContentEmbeddedObject's own 'drawing' objectKind, the shape this schema defines for exactly "a document of one kind nested at a frame inside a document of another", with the box's own frame placing it in the flow.
        flushParagraphIfContent(state, sink);
        targetBlocks(state).push({
          kind: "embeddedObject",
          objectKind: "drawing",
          frame: {
            xPt: boxContent.frame.xPt,
            yPt: boxContent.frame.yPt,
            widthPt: boxContent.frame.widthPt,
            heightPt: boxContent.frame.heightPt,
          },
          document: {
            kind: "drawing",
            metadata: {},
            pages: [
              {
                size: wpg.sizePt,
                shapes: [...wpg.shapes],
                vectors: [...wpg.vectors],
              },
            ],
          },
        });
        return;
      }
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.BoxContentUnresolved,
        "This document contains an image box whose content packet carries no decodable PNG or JPEG payload -- a WPG graphic or other image spelling this reader does not decode.",
      );
      return;
    }
    if (boxContent.frame === undefined) {
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.BoxFrameUnresolved,
        "This document contains a box whose content this reader could read, but whose function-level override states no width and height this reader can trust, so its content was not lifted.",
      );
      return;
    }
    flushParagraphIfContent(state, sink);
    targetBlocks(state).push({
      kind: "image",
      format: payload.format,
      base64: bytesToBase64(payload.bytes),
      widthPt: boxContent.frame.widthPt,
      heightPt: boxContent.frame.heightPt,
      ...(boxContent.frame.positionResolved
        ? {
            floatPosition: {
              horizontal: {
                relativeTo: "page",
                offsetPt: boxContent.frame.xPt,
              },
              vertical: {
                relativeTo: "page",
                offsetPt: boxContent.frame.yPt,
              },
            },
          }
        : {}),
    });
    return;
  }

  const isTextLike =
    boxContent.contentType === BOX_CONTENT_TYPE_TEXT ||
    boxContent.contentType === BOX_CONTENT_TYPE_LINKED_TEXT ||
    boxContent.contentType === BOX_CONTENT_TYPE_EQUATION;
  const packet = isTextLike
    ? packetByPrefixId(container.packets, boxContent.contentPrefixId)
    : undefined;
  const textBlocks =
    packet?.packetType !== PACKET_TYPE_GENERAL_WP_TEXT
      ? undefined
      : readGeneralWpTextBlocks(packet.bytes);
  if (textBlocks === undefined) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.BoxContentUnresolved,
      "This document contains a box whose content this reader could not read -- an image, OLE object, or other content type this reader does not yet decode into the shared schema.",
    );
    return;
  }
  if (boxContent.frame === undefined) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.BoxFrameUnresolved,
      "This document contains a box whose content this reader could read, but whose function-level override states no width and height this reader can trust, so its content was not lifted.",
    );
    return;
  }

  flushParagraphIfContent(state, sink);
  const nestedTokens = tokeniseDocumentArea(textBlocks, 0, textBlocks.length);
  const frame = {
    xPt: boxContent.frame.xPt,
    yPt: boxContent.frame.yPt,
    widthPt: boxContent.frame.widthPt,
    heightPt: boxContent.frame.heightPt,
  };

  if (boxContent.contentType === BOX_CONTENT_TYPE_EQUATION) {
    const { blocks } = foldTokens(nestedTokens, container, sink);
    const embed: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "formula",
      frame,
      document: {
        kind: "formula",
        metadata: {},
        formula: {
          mathml: [],
          source: { format: "wpd", xml: plainTextOf(blocks) },
        },
      },
    };
    targetBlocks(state).push(embed);
    return;
  }

  const { blocks, page } = foldTokens(nestedTokens, container, sink);
  const embed: ContentEmbeddedObjectBlock = {
    kind: "embeddedObject",
    objectKind: "wordprocessing",
    frame,
    document: {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: {
            widthPt: page.widthPt ?? DEFAULT_PAGE_WIDTH_PT,
            heightPt: page.heightPt ?? DEFAULT_PAGE_HEIGHT_PT,
          },
          margins: {
            topPt: page.topPt ?? DEFAULT_MARGIN_PT,
            rightPt: page.rightPt ?? DEFAULT_MARGIN_PT,
            bottomPt: page.bottomPt ?? DEFAULT_MARGIN_PT,
            leftPt: page.leftPt ?? DEFAULT_MARGIN_PT,
          },
          blocks,
        },
      ],
    },
  };
  targetBlocks(state).push(embed);
}

function applyVariableFunction(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  switch (token.group) {
    case EOL_GROUP: {
      const mapping = eolMappingForSubfunction(token.subgroup);
      if (mapping !== undefined) {
        applyEolMapping(state, mapping, token.nonDeletable, sink);
      }
      return;
    }
    case PAGE_GROUP:
      applyPageGroup(state, token, sink);
      return;
    case COLUMN_GROUP:
      applyColumnGroup(state, token, sink);
      return;
    case PARAGRAPH_GROUP: {
      if (token.subgroup !== PARAGRAPH_SET_JUSTIFICATION) {
        return;
      }
      const mode = token.nonDeletable[0];
      if (mode !== undefined) {
        // A justification change applies from here on, so it lands on the paragraph currently being built and every later one until the next change.
        state.alignment = JUSTIFICATION[mode];
      }
      return;
    }
    case CHARACTER_GROUP:
      applyCharacterGroup(state, token, container, sink);
      return;
    case TAB_GROUP: {
      // This group has no subfunction catalogue: the byte in the subfunction position IS the tab definition (see src/stream/tab.ts).
      const effect = tabEffectFor(token.subgroup);
      if (effect === undefined) {
        return;
      }
      if (effect.kind === "tab") {
        appendText(state, "\t");
      } else {
        state.pendingAlignment = effect.alignment;
      }
      return;
    }
    case STYLE_GROUP:
      applyStyleGroup(state, token, container, sink);
      return;
    case DISPLAY_NUMBER_GROUP:
      applyDisplayNumberGroup(state, token, sink);
      return;
    case CROSS_REFERENCE_GROUP:
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.CrossReferenceFlattened,
        "This document contains a cross-reference; its displayed text survives as ordinary text, and the reference's own target binding does not.",
      );
      return;
    case HEADER_FOOTER_GROUP:
      applyHeaderFooterGroup(state, token, container, sink);
      return;
    case FOOTNOTE_ENDNOTE_GROUP:
      applyNoteGroup(state, token, container, sink);
      return;
    case MERGE_GROUP:
      applyMergeGroup(state, token, sink);
      return;
    case BOX_GROUP:
      applyBoxGroup(state, token, container, sink);
      return;
    default:
      return;
  }
}

function applyFixedFunction(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "fixedFunction" }>,
  sink: WpdDiagnosticSink,
): void {
  if (token.code === EXTENDED_CHARACTER) {
    // "[WP character] = (<character> <WP character set number>)" -- a short whose low byte is the character number and whose high byte is the set.
    const characterNumber = token.data[0];
    const characterSet = token.data[1];
    if (characterNumber === undefined || characterSet === undefined) {
      return;
    }
    const decoded = decodeWpCharacter(characterSet, characterNumber);
    if (decoded === undefined) {
      sink({
        code: WpdDiagnosticCodes.UnmappedCharacter,
        message: `Character ${characterNumber} of WordPerfect character set ${characterSet} has no mapping in this package and was rendered as U+FFFD.`,
      });
      appendText(state, UNMAPPED_CHARACTER);
      return;
    }
    appendText(state, decoded);
    return;
  }
  if (token.code !== ATTRIBUTE_ON && token.code !== ATTRIBUTE_OFF) {
    return;
  }
  const payload = token.data[0];
  if (payload === undefined) {
    return;
  }
  const { attribute, ignore } = decodeAttributeByte(payload);
  if (ignore) {
    return;
  }
  if (token.code === ATTRIBUTE_ON) {
    state.activeAttributes.add(attribute);
  } else {
    state.activeAttributes.delete(attribute);
  }
  const next = runAttributesFrom(state.activeAttributes);
  if (sameAttributes(next, state.attributes)) {
    // An attribute the shared schema cannot express -- shadow, small caps, redline -- changed state. Nothing about the runs being built changes, so the current run keeps accumulating rather than being split at a boundary no reader could see.
    return;
  }
  flushRun(state);
  state.attributes = next;
}

interface FoldResult {
  readonly blocks: ContentBlock[];
  readonly page: PageState;
  readonly headers: ContentPageFurniture;
  readonly footers: ContentPageFurniture;
  readonly watermarks: ContentPageFurniture;
  readonly notes: readonly WpdNoteDefinition[];
  readonly oleObjects: readonly WpdOleObject[];
}

// One token's own effect on the reader state, shared by the main document-area walk and any sub-stream folded through the identical function-code vocabulary -- currently a style packet's own "beginning style text" block (applyStylePacketBegin above), which carries the same font/attribute/colour-change functions the main stream does and means them identically.
function applyToken(
  state: ReaderState,
  token: WpdToken,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  switch (token.kind) {
    case "character": {
      const character = decodeSingleByteCharacter(token.byte);
      if (character === undefined) {
        sink({
          code: WpdDiagnosticCodes.UnmappedCharacter,
          message: `Byte ${token.byte} in the document area has no character mapping and was rendered as U+FFFD.`,
        });
        appendText(state, UNMAPPED_CHARACTER);
        return;
      }
      appendText(state, character);
      return;
    }
    case "singleByteFunction":
      applySingleByteFunction(state, token.code, sink);
      return;
    case "variableFunction":
      applyVariableFunction(state, token, container, sink);
      return;
    case "fixedFunction":
      applyFixedFunction(state, token, sink);
      return;
  }
}

function foldTokens(
  tokens: readonly WpdToken[],
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): FoldResult {
  const state: ReaderState = {
    blocks: [],
    runs: [],
    text: "",
    activeAttributes: new Set<number>(),
    attributes: runAttributesFrom(new Set<number>()),
    fontFamily: undefined,
    sizePt: undefined,
    color: undefined,
    alignment: undefined,
    skipDepth: 0,
    styleScopes: [],
    styleResolutionDepth: 0,
    pendingHeadingLevel: undefined,
    pendingListLevel: undefined,
    pendingAlignment: undefined,
    numberDisplayDepth: 0,
    page: {
      widthPt: undefined,
      heightPt: undefined,
      topPt: undefined,
      rightPt: undefined,
      bottomPt: undefined,
      leftPt: undefined,
      changeReported: false,
    },
    table: undefined,
    reported: new Set<string>(),
    pendingConstructs: [],
    openMergeFieldStartRun: undefined,
    headers: {},
    footers: {},
    watermarks: {},
    furnitureFilled: new Set(),
    openNote: undefined,
    notes: [],
    oleObjects: [],
  };

  for (const token of tokens) {
    applyToken(state, token, container, sink);
  }

  // Whatever is still accumulating when the stream ends is a final paragraph only if it actually holds text. A document ending in a hard return has already had its last paragraph closed, and fabricating an empty one after it would invent a blank line the author never typed.
  flushRun(state);
  if (state.runs.length > 0) {
    flushParagraph(state, sink);
  }
  // A table the stream ends inside was never closed by a Table Off code. Its rows are real content, so it is closed here rather than discarded.
  if (state.table !== undefined) {
    closeRow(state.table);
    closeTable(state);
  }
  return {
    blocks: state.blocks,
    page: state.page,
    headers: state.headers,
    footers: state.footers,
    watermarks: state.watermarks,
    notes: state.notes,
    oleObjects: state.oleObjects,
  };
}

// The document's own metadata, from the Extended Document Summary prefix packet. A document that carries no summary packet gets an empty envelope -- the honest answer, rather than fields invented from the file's structure.
function readMetadata(container: WpdDocumentContainer): LayoutMetadata {
  const packet = container.packets.find(
    (candidate) =>
      candidate.packetType === PACKET_TYPE_EXTENDED_DOCUMENT_SUMMARY,
  );
  return packet === undefined ? {} : readDocumentSummary(packet.bytes);
}

// Reads a WordPerfect 6.x-X6 document into the shared flat ContentDocument. Accepts both containers: a bare WordPerfect file and one wrapped in an OLE compound file's PerfectOffice_MAIN stream.
export function readWpdContent(
  bytes: Uint8Array,
  options: ReadWpdOptions = {},
): ContentDocument {
  const sink = options.sink ?? NOOP_WPD_DIAGNOSTIC_SINK;
  const container = openWpdDocument(bytes, { password: options.password });
  const tokens = tokeniseDocumentArea(
    container.bytes,
    container.documentAreaOffset,
    container.documentAreaEnd,
  );
  const { blocks, page, headers, footers, watermarks, notes, oleObjects } =
    foldTokens(tokens, container, sink);
  // The note bodies' real home is the tree form's definitions table, which the flat form cannot reach -- readWpd carries them. Each still-borne body says so here rather than passing in silence; the anchor itself is in the blocks.
  for (const note of notes) {
    sink({
      code: WpdDiagnosticCodes.NoteDropped,
      message: `This document contains a ${note.anchorType} whose body the flat ContentDocument has no home for; its reference anchor survives and readWpd lifts the body into the tree form's definitions table.`,
    });
  }
  // A native OLE object's bytes have the same flat/tree split: the flat ContentDocument has no field for opaque binary bytes, and readWpd carries each as an attachments-table entry.
  for (const oleObject of oleObjects) {
    sink({
      code: WpdDiagnosticCodes.OleObjectDropped,
      message: `This document embeds a native OLE object ('${oleObject.name}') whose bytes the flat ContentDocument has no home for; readWpd lifts them into the tree form's attachments table.`,
    });
  }
  return {
    kind: "wordprocessing",
    metadata: readMetadata(container),
    sections: [
      {
        pageSize: {
          widthPt: page.widthPt ?? DEFAULT_PAGE_WIDTH_PT,
          heightPt: page.heightPt ?? DEFAULT_PAGE_HEIGHT_PT,
        },
        margins: {
          topPt: page.topPt ?? DEFAULT_MARGIN_PT,
          rightPt: page.rightPt ?? DEFAULT_MARGIN_PT,
          bottomPt: page.bottomPt ?? DEFAULT_MARGIN_PT,
          leftPt: page.leftPt ?? DEFAULT_MARGIN_PT,
        },
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(Object.keys(footers).length > 0 ? { footers } : {}),
        ...(Object.keys(watermarks).length > 0 ? { watermarks } : {}),
        blocks,
      },
    ],
  };
}

// The same read, one level up: the tree-form DocumentTree every other codec in the family also offers, assembled from the flat document by document-schema.js's own transform -- plus the two facts only the tree can hold: every note body the flat form cannot carry rides as a definitions-table entry ({ kind: 'footnote' | 'endnote', marker, blocks } -- the tenant vocabulary markdown-codec's own footnote definitions established), keyed by the definition id each anchor descriptor in the flat content already names (note-1, note-2, ... in document order), and every native OLE object's bytes ride as an attachments-table entry (see the splice below). The identical splice markdown-codec's own tree reader performs for its link table.
export function readWpd(
  bytes: Uint8Array,
  options: ReadWpdOptions = {},
): DocumentTree {
  // The flat read's per-note NoteDropped and per-object OleObjectDropped diagnostics would be lies at this level -- the tree DOES carry the bodies and the bytes -- so the internal read runs with a silent sink and both are collected straight from the fold, exactly the shapes readWpdContent reports instead.
  const container = openWpdDocument(bytes, { password: options.password });
  const tokens = tokeniseDocumentArea(
    container.bytes,
    container.documentAreaOffset,
    container.documentAreaEnd,
  );
  const sink = options.sink ?? NOOP_WPD_DIAGNOSTIC_SINK;
  const { notes, oleObjects, ...flatRest } = foldTokens(
    tokens,
    container,
    sink,
  );
  const document: ContentDocument = {
    kind: "wordprocessing",
    metadata: readMetadata(container),
    sections: [
      {
        pageSize: {
          widthPt: flatRest.page.widthPt ?? DEFAULT_PAGE_WIDTH_PT,
          heightPt: flatRest.page.heightPt ?? DEFAULT_PAGE_HEIGHT_PT,
        },
        margins: {
          topPt: flatRest.page.topPt ?? DEFAULT_MARGIN_PT,
          rightPt: flatRest.page.rightPt ?? DEFAULT_MARGIN_PT,
          bottomPt: flatRest.page.bottomPt ?? DEFAULT_MARGIN_PT,
          leftPt: flatRest.page.leftPt ?? DEFAULT_MARGIN_PT,
        },
        ...(Object.keys(flatRest.headers).length > 0
          ? { headers: flatRest.headers }
          : {}),
        ...(Object.keys(flatRest.footers).length > 0
          ? { footers: flatRest.footers }
          : {}),
        ...(Object.keys(flatRest.watermarks).length > 0
          ? { watermarks: flatRest.watermarks }
          : {}),
        blocks: flatRest.blocks,
      },
    ],
  };
  const assembled = assembleTree(document);
  // The native OLE objects take the tree's other home the flat form cannot reach: an attachments-table entry per object, the identical tenant vocabulary documents.js stamps PDF embedded files with ({ kind: 'attachment', name, base64 }) -- an OLE server's own stream is a package attachment in exactly that sense, bytes the package carries beside its content. Keyed by the object's own name (the OLE 2 stream's name in the wrapper's objects storage, or the OLE 1 fallback stream/ole.ts derives), so two boxes naming the same object collapse to one entry rather than duplicating bytes.
  const attachments = Object.fromEntries(
    oleObjects.map((oleObject) => [
      oleObject.name,
      {
        kind: "attachment",
        name: oleObject.name,
        base64: bytesToBase64(oleObject.bytes),
      },
    ]),
  );
  const definitions = Object.fromEntries(
    notes.map((note, index) => [
      `note-${index + 1}`,
      { kind: note.anchorType, marker: note.marker, blocks: note.blocks },
    ]),
  );
  if (Object.keys(attachments).length === 0 && notes.length === 0) {
    return assembled;
  }
  return {
    ...assembled,
    ...(Object.keys(attachments).length > 0
      ? { attachments: { ...assembled.attachments, ...attachments } }
      : {}),
    ...(notes.length > 0
      ? { definitions: { ...assembled.definitions, ...definitions } }
      : {}),
  };
}
