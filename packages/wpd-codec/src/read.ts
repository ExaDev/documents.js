import type {
  Alignment,
  Color,
  ContentBlock,
  ContentDocument,
  ContentParagraph,
  ContentRun,
  ContentTableCell,
  ContentTableRow,
  DocumentTree,
  LayoutMetadata,
} from "document-schema.js";
import { assembleTree } from "document-schema.js";
import { uint16At } from "./bytes/view";
import {
  openWpdDocument,
  type WpdDocumentContainer,
} from "./container/container";
import {
  PACKET_TYPE_DESIRED_FONT_DESCRIPTOR,
  packetByPrefixId,
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
  readDisplayNumberLevel,
  readSystemStyleNumber,
  STYLE_GROUP,
  styleSemanticsFor,
  type WpdStyleSemantics,
} from "./stream/style";
import {
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
import { tabEffectFor, TAB_GROUP } from "./stream/tab";
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
  readonly background: Color | undefined;
  readonly columnSpan: number;
  readonly rowSpan: number;
  readonly covered: boolean;
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
  readonly styleScopes: (WpdStyleSemantics | undefined)[];
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
}

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
function flushParagraph(state: ReaderState): void {
  flushRun(state);
  // A line-scoped centring or flush-right code outranks the document-level justification: the Tab group code that begins one applies to the line it sits in, where Set Justification Mode applies from where it sits onwards.
  const alignment = state.pendingAlignment ?? state.alignment;
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
  };
  state.pendingHeadingLevel = undefined;
  state.pendingListLevel = undefined;
  state.pendingAlignment = undefined;
  targetBlocks(state).push(paragraph);
}

// Closes the current paragraph only when it holds something. Used at every boundary that is a container edge rather than a line break -- a cell end, a row end, the end of the stream -- where an unconditional flush would fabricate a blank paragraph the author never typed.
function flushParagraphIfContent(state: ReaderState): void {
  if (state.text.length === 0 && state.runs.length === 0) {
    return;
  }
  flushParagraph(state);
}

// The innermost open style scope that says something structural. An enclosing Global On naming the document's Normal style does not override a heading style opened inside it, and a scope with no meaning at all is transparent.
function effectiveStyle(state: ReaderState): WpdStyleSemantics | undefined {
  for (let index = state.styleScopes.length - 1; index >= 0; index -= 1) {
    const scope = state.styleScopes[index];
    if (scope !== undefined) {
      return scope;
    }
  }
  return undefined;
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

  const cellSpanning =
    spanning === undefined ? undefined : readCellSpanning(spanning);
  const cellFill = fill === undefined ? undefined : readCellFill(fill);
  if (cellFill?.blended === true) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.CellFillBlended,
      "A cell is filled with a shaded blend of two colours; its background colour is used and the blend is not reproduced.",
    );
  }

  return {
    attributes: {
      alignment:
        information === undefined
          ? undefined
          : readCellInformation(information)?.alignment,
      background: cellFill?.background,
      columnSpan: cellSpanning?.columnSpan ?? NO_SPAN,
      rowSpan: cellSpanning?.rowSpan ?? NO_SPAN,
      covered:
        cellSpanning?.coveredFromLeft === true ||
        cellSpanning?.coveredFromAbove === true,
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
): void {
  flushParagraphIfContent(state);
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
    // ContentTableCell.background is document-schema.js's discriminated ContentCellFill (ExaDev/documents.js#951); this reader's own background is always the flat colour readCellFill resolves (see that function's own top-of-file note on why the blend itself is not reproduced), so it always wraps as a 'solid' fill, never a 'pattern' one.
    ...(attributes.background === undefined
      ? {}
      : { background: { kind: "solid", color: attributes.background } }),
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
      flushParagraph(state);
      return;
    case "hardEndOfColumn":
      // The shared content schema has no column-break block: ContentSection.breakType describes how a section begins, not a break inside one. Ending the paragraph keeps the text on either side apart, which is the part that matters for content, and the diagnostic records what was lost.
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.ColumnBreakFlattened,
        "A column break became a paragraph break.",
      );
      flushParagraph(state);
      return;
    case "hardEndOfPage":
      flushParagraph(state);
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
        flushParagraph(state);
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
        closeCell(state, table, attributes);
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
      flushParagraph(state);
      return;
    case SOFT_END_OF_CENTER_ALIGN:
      // "The formatter inserts a soft End of Line, which causes centering to end, but not the paragraph" -- a wrap, so the same space every other soft end of line converts to.
      appendText(state, " ");
      return;
    case HARD_END_OF_CENTER_ALIGN:
      // "The Enter key is pressed, ending the line, the centering, and the paragraph."
      flushParagraph(state);
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

function applyStyleGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
): void {
  if (isStyleScopeOpener(token.subgroup)) {
    const systemStyleNumber = readSystemStyleNumber(token.nonDeletable);
    state.styleScopes.push(
      systemStyleNumber === undefined
        ? undefined
        : styleSemanticsFor(systemStyleNumber),
    );
    return;
  }
  if (isStyleScopeCloser(token.subgroup)) {
    // A closer with nothing open is a stream whose style codes do not pair -- possible in a document edited by a third-party writer. Popping nothing is the harmless reading; the alternative, treating it as an error, would refuse a document whose text is entirely readable.
    state.styleScopes.pop();
  }
}

function applyDisplayNumberGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  sink: WpdDiagnosticSink,
): void {
  if (isParagraphNumberDisplayOn(token.subgroup)) {
    const level = readDisplayNumberLevel(token.nonDeletable);
    if (level !== undefined && state.pendingListLevel === undefined) {
      state.pendingListLevel = level;
    }
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
      flushParagraphIfContent(state);
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
      applyStyleGroup(state, token);
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
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.HeaderFooterDropped,
        "This document declares a header, footer, or watermark, which the flat content model has no page-furniture position for.",
      );
      return;
    case FOOTNOTE_ENDNOTE_GROUP:
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.NoteDropped,
        "This document contains a footnote or endnote; its text lives in a prefix packet the flat content model has nowhere to put.",
      );
      return;
    case MERGE_GROUP:
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.MergeCodeDropped,
        "This document contains merge codes, which are a form-letter template's placeholders rather than text.",
      );
      return;
    case BOX_GROUP:
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.BoxDropped,
        "This document contains a box -- a figure, text box, equation, or graphic -- whose contents were not read.",
      );
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
  };

  for (const token of tokens) {
    switch (token.kind) {
      case "character": {
        const character = decodeSingleByteCharacter(token.byte);
        if (character === undefined) {
          sink({
            code: WpdDiagnosticCodes.UnmappedCharacter,
            message: `Byte ${token.byte} in the document area has no character mapping and was rendered as U+FFFD.`,
          });
          appendText(state, UNMAPPED_CHARACTER);
          break;
        }
        appendText(state, character);
        break;
      }
      case "singleByteFunction":
        applySingleByteFunction(state, token.code, sink);
        break;
      case "variableFunction":
        applyVariableFunction(state, token, container, sink);
        break;
      case "fixedFunction":
        applyFixedFunction(state, token, sink);
        break;
    }
  }

  // Whatever is still accumulating when the stream ends is a final paragraph only if it actually holds text. A document ending in a hard return has already had its last paragraph closed, and fabricating an empty one after it would invent a blank line the author never typed.
  flushRun(state);
  if (state.runs.length > 0) {
    flushParagraph(state);
  }
  // A table the stream ends inside was never closed by a Table Off code. Its rows are real content, so it is closed here rather than discarded.
  if (state.table !== undefined) {
    closeRow(state.table);
    closeTable(state);
  }
  return { blocks: state.blocks, page: state.page };
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
  const container = openWpdDocument(bytes);
  const tokens = tokeniseDocumentArea(
    container.bytes,
    container.documentAreaOffset,
    container.documentAreaEnd,
  );
  const { blocks, page } = foldTokens(tokens, container, sink);
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
        blocks,
      },
    ],
  };
}

// The same read, one level up: the tree-form DocumentTree every other codec in the family also offers, assembled from the flat document by document-schema.js's own transform.
export function readWpd(
  bytes: Uint8Array,
  options: ReadWpdOptions = {},
): DocumentTree {
  return assembleTree(readWpdContent(bytes, options));
}
