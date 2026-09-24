import { bytesToBase64 } from "byte-codec";
import type {
  Alignment,
  ContentDocument,
  ContentPageFurniture,
  DocumentTree,
  LayoutMetadata,
} from "document-schema.js";
import { assembleTree } from "document-schema.js";
import {
  NOOP_WPD_DIAGNOSTIC_SINK,
  WpdDiagnosticCodes,
  type WpdDiagnosticSink,
} from "./diagnostics";
import {
  openWpdDocument,
  type WpdDocumentContainer,
} from "./container/container";
import {
  PACKET_TYPE_EXTENDED_DOCUMENT_SUMMARY,
  readDocumentSummary,
} from "./container/summary";
import {
  ATTRIBUTE_OFF,
  ATTRIBUTE_ON,
  decodeAttributeByte,
  runAttributesFrom,
} from "./stream/attributes";
import {
  decodeSingleByteCharacter,
  decodeWpCharacter,
  UNMAPPED_CHARACTER,
} from "./stream/characters";
import { eolMappingForSubfunction, EOL_GROUP } from "./stream/eol";
import {
  COLUMN_GROUP,
  DEFAULT_MARGIN_PT,
  DEFAULT_PAGE_HEIGHT_PT,
  DEFAULT_PAGE_WIDTH_PT,
  PAGE_GROUP,
} from "./stream/page";
import { DISPLAY_NUMBER_GROUP, STYLE_GROUP } from "./stream/style";
import { tabEffectFor, TAB_GROUP } from "./stream/tab";
import { tokeniseDocumentArea, type WpdToken } from "./stream/tokenise";
import {
  appendText,
  assertDefined,
  flushParagraph,
  flushRun,
  reportOnce,
  sameAttributes,
  UNREACHABLE_CHARACTER_MAPPING_MESSAGE,
} from "./read-runs";
import type { FoldResult, PageState, ReaderState } from "./read-state";
import { closeRow, closeTable } from "./read-tables";
import { applyBoxGroup } from "./read-box-group";
import {
  applyHeaderFooterGroup,
  applyMergeGroup,
  applyNoteGroup,
} from "./read-furniture-groups";
import {
  applyCharacterGroup,
  applyColumnGroup,
  applyDisplayNumberGroup,
  applyEolMapping,
  applyPageGroup,
  applySingleByteFunction,
  applyStyleGroup,
} from "./read-formatting-groups";

// Document area to ContentDocument.
//
// The document area is a flat stream of characters and function codes, so building a document out of it is a fold: characters accumulate into the current run, an attribute or font change closes that run and opens another, and an end-of-line function closes the current paragraph. Nothing here is recursive and nothing looks ahead, which is what makes a hand-written reader tractable for this format at all.
//
// The fold has exactly one nesting concept, and it is not recursion: a table redirects where paragraphs land. While a table definition is open, a closed paragraph joins the cell currently being built rather than the section's own block list, and a table's cells hold blocks, which is as deep as this format's own grid model goes.
//
// What each function code means comes from the specification's own tables, not from inference, most importantly the "Conversion/Search mappings" column of the End-of-Line group (src/stream/eol.ts), which states outright which codes a converting application should turn into a space and which into a hard return.
//
// The reader's own state, continuation types (FoldTokensFn/ApplyTokenFn), and run/paragraph primitives live in read-state.ts and read-runs.ts, two leaf modules that import nothing back from here or from any of the group-handling modules below (read-tables.ts, read-box-group.ts, read-furniture-groups.ts, read-formatting-groups.ts). Those group modules call back into this file's own foldTokens/applyToken in exactly two places (an applier folding a nested WP text stream; applyStylePacketBegin replaying a style's begin block), and both take the continuation as a parameter this file passes in at the call site, rather than importing foldTokens/applyToken back, so none of them cycles back to read.ts.

// Variable-length groups and the subgroups this reader interprets. The groups it recognises without interpreting, boxes, notes, page furniture, cross-references, merge codes, are named here too, so each can be reported through the diagnostic sink rather than passed over in silence.
const CROSS_REFERENCE_GROUP = 0xd5;
const HEADER_FOOTER_GROUP = 0xd6;
const FOOTNOTE_ENDNOTE_GROUP = 0xd7;
const MERGE_GROUP = 0xde;
const BOX_GROUP = 0xdf;
const PARAGRAPH_GROUP = 0xd3;
const PARAGRAPH_SET_JUSTIFICATION = 0x05;
const CHARACTER_GROUP = 0xd4;

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

export interface ReadWpdOptions {
  readonly sink?: WpdDiagnosticSink;
  // The password for a document whose header's encryption word is non-zero. The standard ("original") WordPerfect encryption mode is decrypted with it (src/container/encryption.ts); a wrong password throws WpdWrongPasswordError, an encrypted document read without one still throws WpdEncryptedDocumentError, and a password supplied for an unencrypted document is ignored, the identical contract doc-codec's and xls-codec's own password options hold.
  readonly password?: string;
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
      applyStyleGroup(state, token, container, sink, applyToken);
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
      applyHeaderFooterGroup(state, token, container, sink, foldTokens);
      return;
    case FOOTNOTE_ENDNOTE_GROUP:
      applyNoteGroup(state, token, container, sink, foldTokens);
      return;
    case MERGE_GROUP:
      applyMergeGroup(state, token, sink);
      return;
    case BOX_GROUP:
      applyBoxGroup(state, token, container, sink, foldTokens);
      return;
    default:
    // This is the switch's own last case, so falling through here reaches this void function's end exactly as a `return` would.
  }
}

function applyFixedFunction(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "fixedFunction" }>,
  sink: WpdDiagnosticSink,
): void {
  if (token.code === EXTENDED_CHARACTER) {
    // "[WP character] = (<character> <WP character set number>)", a short whose low byte is the character number and whose high byte is the set.
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
    // An attribute the shared schema cannot express, shadow, small caps, redline, changed state. Nothing about the runs being built changes, so the current run keeps accumulating rather than being split at a boundary no reader could see.
    return;
  }
  flushRun(state);
  state.attributes = next;
}

// One token's own effect on the reader state, shared by the main document-area walk and any sub-stream folded through the identical function-code vocabulary, currently a style packet's own "beginning style text" block (read-formatting-groups.ts's applyStylePacketBegin), which carries the same font/attribute/colour-change functions the main stream does and means them identically.
function applyToken(
  state: ReaderState,
  token: WpdToken,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  switch (token.kind) {
    case "character": {
      const character = decodeSingleByteCharacter(token.byte);
      // decodeSingleByteCharacter's own domain (1..127) is exhaustively covered by its shorthand table (bytes 1..32) plus its literal ASCII range (33..127), proven by iterating every byte in 1..127 and confirming none decode to undefined (stream/characters.test.ts's own exhaustiveness check), and the tokeniser only ever mints a "character" token for a byte already restricted to exactly that domain (0 is skipped upstream, 0x80 and above becomes a function instead, per tokenise.ts's own FIRST_SINGLE_BYTE_FUNCTION cutoff). So this can never actually be undefined for a byte this reader hands it; assertDefined states that proven fact as a real, throwing check rather than a silent cast. The message is a fixed constant, not a per-byte template, specifically so it stays directly testable on its own terms (see read.test.ts) even though no real document byte can ever reach it.
      assertDefined(character, UNREACHABLE_CHARACTER_MAPPING_MESSAGE);
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

// The document's own metadata, from the Extended Document Summary prefix packet. A document that carries no summary packet gets an empty envelope, the honest answer, rather than fields invented from the file's structure.
function readMetadata(container: WpdDocumentContainer): LayoutMetadata {
  const packet = container.packets.find(
    (candidate) =>
      candidate.packetType === PACKET_TYPE_EXTENDED_DOCUMENT_SUMMARY,
  );
  return packet === undefined ? {} : readDocumentSummary(packet.bytes);
}

function pageSectionFields(page: Readonly<PageState>): {
  pageSize: { widthPt: number; heightPt: number };
  margins: {
    topPt: number;
    rightPt: number;
    bottomPt: number;
    leftPt: number;
  };
} {
  return {
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
  };
}

function furnitureFields(
  headers: ContentPageFurniture,
  footers: ContentPageFurniture,
  watermarks: ContentPageFurniture,
): {
  headers?: ContentPageFurniture;
  footers?: ContentPageFurniture;
  watermarks?: ContentPageFurniture;
} {
  return {
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(Object.keys(footers).length > 0 ? { footers } : {}),
    ...(Object.keys(watermarks).length > 0 ? { watermarks } : {}),
  };
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
  // The note bodies' real home is the tree form's definitions table, which the flat form cannot reach, readWpd carries them. Each still-borne body says so here rather than passing in silence; the anchor itself is in the blocks.
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
        ...pageSectionFields(page),
        ...furnitureFields(headers, footers, watermarks),
        blocks,
      },
    ],
  };
}

// The same read, one level up: the tree-form DocumentTree every other codec in the family also offers, assembled from the flat document by document-schema.js's own transform, plus the two facts only the tree can hold: every note body the flat form cannot carry rides as a definitions-table entry ({ kind: 'footnote' | 'endnote', marker, blocks }, the tenant vocabulary markdown-codec's own footnote definitions established), keyed by the definition id each anchor descriptor in the flat content already names (note-1, note-2, ... in document order), and every native OLE object's bytes ride as an attachments-table entry (see the splice below). The identical splice markdown-codec's own tree reader performs for its link table.
export function readWpd(
  bytes: Uint8Array,
  options: ReadWpdOptions = {},
): DocumentTree {
  // The flat read's per-note NoteDropped and per-object OleObjectDropped diagnostics would be lies at this level, the tree DOES carry the bodies and the bytes, so the internal read runs with a silent sink and both are collected straight from the fold, exactly the shapes readWpdContent reports instead.
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
        ...pageSectionFields(flatRest.page),
        ...furnitureFields(
          flatRest.headers,
          flatRest.footers,
          flatRest.watermarks,
        ),
        blocks: flatRest.blocks,
      },
    ],
  };
  const assembled = assembleTree(document);
  // The native OLE objects take the tree's other home the flat form cannot reach: an attachments-table entry per object, the identical tenant vocabulary documents.js stamps PDF embedded files with ({ kind: 'attachment', name, base64 }), an OLE server's own stream is a package attachment in exactly that sense, bytes the package carries beside its content. Keyed by the object's own name (the OLE 2 stream's name in the wrapper's objects storage, or the OLE 1 fallback stream/ole.ts derives), so two boxes naming the same object collapse to one entry rather than duplicating bytes.
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
  // No separate "neither table has anything to add" early return is needed: when both are empty, the spread below produces an object with exactly assembled's own keys and values, a shallow copy indistinguishable from assembled itself to any caller, since nothing here ever mutates assembled afterwards.
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
