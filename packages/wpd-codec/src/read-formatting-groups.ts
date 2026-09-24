import { WpdDiagnosticCodes, type WpdDiagnosticSink } from "./diagnostics";
import {
  appendText,
  flushParagraph,
  flushParagraphIfContent,
  flushRun,
  reportOnce,
  targetBlocks,
} from "./read-runs";
import type {
  ApplyTokenFn,
  FormattingSnapshot,
  PageState,
  ReaderState,
} from "./read-state";
import {
  closeCell,
  closeRow,
  closeTable,
  readCellAttributes,
} from "./read-tables";
import type { WpdDocumentContainer } from "./container/container";
import {
  PACKET_TYPE_DESIRED_FONT_DESCRIPTOR,
  packetByPrefixId,
  readTypefaceName,
} from "./container/prefix";
import { runAttributesFrom } from "./stream/attributes";
import {
  eolMappingForSubfunction,
  isSingleByteEol,
  subfunctionForSingleByteEol,
  type WpdEolMapping,
} from "./stream/eol";
import {
  COLUMN_LEFT_MARGIN_SET,
  COLUMN_RIGHT_MARGIN_SET,
  PAGE_BOTTOM_MARGIN_SET,
  PAGE_FORM,
  PAGE_TOP_MARGIN_SET,
  readMarginPt,
  readPageForm,
} from "./stream/page";
import {
  isParagraphNumberDisplayOff,
  isParagraphNumberDisplayOn,
  isStyleScopeCloser,
  isStyleScopeOpener,
  PACKET_TYPE_NORMAL_STYLE,
  readDisplayNumberLevel,
  readStyleBeginBlock,
  readSystemStyleNumber,
  styleSemanticsFor,
} from "./stream/style";
import {
  CHARACTER_DEFINE_TABLE_END,
  CHARACTER_TABLE_COLUMN,
  CHARACTER_TABLE_DEFINITION,
  readTableColumnWidthPt,
} from "./stream/table";
import { tokeniseDocumentArea, type WpdToken } from "./stream/tokenise";
import { uint16At } from "./bytes/view";

// EOL, single-byte function, font/size/colour, page/column margin, style-scope, display-number, and table-definition-character group handling split out of read.ts. applyStylePacketBegin's own recursion (replaying a style's begin block's function codes) takes the applyToken continuation read.ts wires in, rather than importing it back.

const CHARACTER_COLOR = 0x18;
const CHARACTER_FONT_FACE_CHANGE = 0x1a;
const CHARACTER_FONT_SIZE_CHANGE = 0x1b;

// "Font point sizes are given in 3600ths of an inch", per WPFF Document Structure's units glossary. A point is 1/72 inch, so 3600ths divide by 50 to give points.
const THREE_THOUSAND_SIX_HUNDREDTHS_PER_POINT = 50;

// The colour byte range the SDK states for RGB: "Each color takes one byte with a range from 0 to 255 (0xFF) where 255 is 100%." The shared schema's Color is 0..1, so each component divides by 255.
const COLOR_COMPONENT_MAX = 255;

// A style-packet-resolution cycle, corrupt or adversarial input, since a well-formed document's own styles never reference themselves, is bounded rather than left to recurse without limit over untrusted bytes.
const MAX_STYLE_RESOLUTION_DEPTH = 16;

// The single-byte functions this reader gives a meaning to, from WPFF "Single-Byte Functions". Everything else in 0x80-0xB3 is a formatting or bookkeeping code that contributes no characters and no structure, a speller-clean marker, a joiner control, a math-column code, and is passed over rather than listed.
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

export function applyEolMapping(
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
      const { attributes, rowHeightPt, rowIsHeader } = readCellAttributes(
        state,
        nonDeletable,
        sink,
      );
      if (rowHeightPt !== undefined) {
        table.rowHeightPt = rowHeightPt;
      }
      // Every End-of-Line function in a header row carries the row's own flag, so the first one that states it settles the row: a later cell of the same row cannot unstate it, and closeRow clears it again for the row after.
      if (rowIsHeader) {
        table.rowIsHeader = true;
      }
      // A cell boundary always closes a cell, even an empty one, a blank cell in the middle of a row is real content the grid has a position for. Table Off is the exception: a document that already ended its last row with a row code leaves nothing open, so closing a cell there would append a spurious empty one. Both spellings occur, and the difference is exactly whether anything is still accumulating.
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

export function applySingleByteFunction(
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
      // "A hard space holds two words together on one line (names, dates, etc)", exactly what U+00A0 is for, so the distinction from a soft space survives into the shared schema rather than being flattened away. Written as an escape rather than the literal character, which is indistinguishable from a plain space in source.
      appendText(state, " ");
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
      // "The formatter inserts a soft End of Line, which causes centering to end, but not the paragraph", a wrap, so the same space every other soft end of line converts to.
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
    // Every remaining single-byte function is a formatting or bookkeeping marker that contributes neither characters nor structure. No separate `return` is needed: this is the switch's own last case, so falling through here reaches this void function's end exactly as a `return` would.
  }
}

export function applyFontFaceChange(
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
export function setPageDimension(
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

export function applyPageGroup(
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

export function applyColumnGroup(
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

// Resolves a style scope's own packet (type 0x30, named by the opening function's own prefix ID) and applies its "beginning style text" block's own function codes, font face/size/colour changes, attribute on/off, exactly as if the author had typed them at the point the scope opened. Returns the pre-application snapshot when it changed anything, so the scope's closer can restore it; returns undefined for a scope with no resolvable packet, an empty begin block, or a resolution depth this reader will not recurse past.
function applyStylePacketBegin(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
  applyToken: ApplyTokenFn,
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

export function applyStyleGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
  applyToken: ApplyTokenFn,
): void {
  if (isStyleScopeOpener(token.subgroup)) {
    const systemStyleNumber = readSystemStyleNumber(token.nonDeletable);
    const semantics =
      systemStyleNumber === undefined
        ? undefined
        : styleSemanticsFor(systemStyleNumber);
    const snapshot = applyStylePacketBegin(
      state,
      token,
      container,
      sink,
      applyToken,
    );
    state.styleScopes.push({ semantics, snapshot });
    return;
  }
  if (isStyleScopeCloser(token.subgroup)) {
    // A closer with nothing open is a stream whose style codes do not pair, possible in a document edited by a third-party writer. Popping nothing is the harmless reading; the alternative, treating it as an error, would refuse a document whose text is entirely readable.
    const entry = state.styleScopes.pop();
    if (entry?.snapshot !== undefined) {
      restoreFormattingSnapshot(state, entry.snapshot);
    }
  }
}

export function applyDisplayNumberGroup(
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

export function applyCharacterGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  switch (token.subgroup) {
    case CHARACTER_TABLE_DEFINITION:
      // A table inside a table has no spelling in this format, the definition function is not recursive, so an open table is closed before a new one opens rather than nesting one grid inside another cell.
      closeTable(state);
      flushParagraphIfContent(state, sink);
      state.table = {
        columnWidthsPt: [],
        rows: [],
        cells: [],
        cellBlocks: [],
        definingColumns: true,
        rowHeightPt: undefined,
        rowIsHeader: false,
      };
      return;
    case CHARACTER_TABLE_COLUMN: {
      const table = state.table;
      if (table?.definingColumns !== true) {
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
    // This is the switch's own last case, so falling through here reaches this void function's end exactly as a `return` would.
  }
}
