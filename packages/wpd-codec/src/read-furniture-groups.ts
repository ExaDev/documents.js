import type { ContentBlock } from "document-schema.js";
import { WpdDiagnosticCodes, type WpdDiagnosticSink } from "./diagnostics";
import { flushRun, reportOnce } from "./read-runs";
import type { FoldTokensFn, ReaderState } from "./read-state";
import type { WpdDocumentContainer } from "./container/container";
import {
  PACKET_TYPE_GENERAL_WP_TEXT,
  packetByPrefixId,
  readGeneralWpTextBlocks,
} from "./container/prefix";
import { readFurnitureClaim } from "./stream/furniture";
import { tokeniseDocumentArea, type WpdToken } from "./stream/tokenise";

// Page-furniture (header/footer/watermark), footnote/endnote, and merge-field handling split out of read.ts, given the fold continuation read.ts wires in (each function-body packet these lift is folded through the identical machinery the main document area uses).

// A D6 function's own body: the General WP Text packet its first prefix ID names, folded to blocks through the identical machinery the main stream uses. Reports and answers undefined when the packet cannot be resolved or read, the honest-or-nothing contract every other body resolution here holds.
function furnitureBodyBlocks(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
  foldTokens: FoldTokensFn,
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

// Lifts a D6 header, footer, or watermark function's body into the section's page furniture: the claim (which kind, which slot) comes from stream/furniture.ts's own subgroup + occurrence-byte reading, the body from the General WP Text packet the function's first prefix ID names, folded through the identical tokeniser and fold the main document area uses, exactly as a box's own text content is. A watermark is page furniture with a parity like the other two (its occurrence bits narrow onto the same slots) and lands in ContentSection.watermarks, its own field beside the headers/footers pair, it is painted behind the body on every page it occurs on, not banded at a page edge. A function whose claim narrows onto nothing (suppressed on both parities in its own file), an unresolvable packet, or a second function claiming a slot a first already filled stays reported rather than guessed at.
export function applyHeaderFooterGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
  foldTokens: FoldTokensFn,
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
      `This document declares a second ${claim.kind} for the ${claim.slot} slot — WordPerfect's own A/B two-slot-per-kind mechanism, which the shared one-flow-per-slot page-furniture vocabulary does not carry; the first ${claim.kind} to claim the slot is the one lifted.`,
    );
    return;
  }
  const blocks = furnitureBodyBlocks(state, token, container, sink, foldTokens);
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

// The note subfunctions, per WPFF "D7 Footnote/Endnote Functions": even-numbered codes are the On functions (0 Footnote On, 2 Endnote On, each naming its body packet through its first prefix ID), odd-numbered the Off (1 Footnote Off, 3 Endnote Off). Each On's body is encased between its own On and Off. https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D7-FootnoteEndNote.htm
const FOOTNOTE_ON = 0x00;
const FOOTNOTE_OFF = 0x01;
const ENDNOTE_ON = 0x02;
const ENDNOTE_OFF = 0x03;

// Lifts a D7 note pair as the shared model's note-anchor construct plus a definitions-ready body: the On opens a run-scoped anchor extent at the reference site (the encased text is the reference marker, typically the note's own rendered number), the Off closes it and resolves the body from the packet the On's first prefix ID named. The anchor descriptor's definition key is the position it will hold in the tree form's definitions table (note-1, note-2, ... in document order), which readWpd splices in; the flat readWpdContent emits the anchor and reports the body, whose real home is exactly that table.
export function applyNoteGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
  foldTokens: FoldTokensFn,
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
    // An Off with no matching On, a stream whose note pairs do not pair, or an On this reader already abandoned at a paragraph boundary (flushParagraph). Nothing to anchor.
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

const MERGE_FIELD_ON = 0x4c;
const MERGE_FIELD_OFF = 0x4d;

// FIELD On opens a run-scoped extent at the run boundary it sits at; FIELD Off closes it and tags the runs in between as a FieldDescriptor construct, `instruction` being exactly the field-code text that flowed through as ordinary characters between the two, so a merge field's own displayed spelling is both kept as real run content (a template genuinely shows its own field codes, not a merged result) and tagged as a placeholder rather than typed prose. Every other merge subfunction still reports through the diagnostic sink, unchanged.
//
// This doc comment sat above applyHeaderFooterGroup before read.ts was split by group (it always described this function, not that one); it moves here with applyMergeGroup rather than staying an orphan.
export function applyMergeGroup(
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
      // An Off with no matching On, a stream whose merge codes do not pair, or an On this reader already abandoned at a paragraph boundary (flushParagraph). Nothing to tag.
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
