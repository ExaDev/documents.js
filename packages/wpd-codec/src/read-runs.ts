import type {
  ContentBlock,
  ContentParagraph,
  ContentRun,
} from "document-schema.js";
import { WpdDiagnosticCodes, type WpdDiagnosticSink } from "./diagnostics";
import { WpdFormatError } from "./errors";
import type { WpdRunAttributes } from "./stream/attributes";
import type { WpdStyleSemantics } from "./stream/style";
import type { ReaderState } from "./read-state";

// The run/paragraph-level state primitives every applier in read.ts and its split modules (read-tables.ts, read-box-group.ts, read-furniture-groups.ts, read-formatting-groups.ts) shares. A leaf module alongside read-state.ts: every function here only ever reads or mutates a ReaderState it is handed, and reports through the sink it is handed, so it depends on nothing above it and nothing here ever needs to import back into read.ts.

export function sameAttributes(
  a: WpdRunAttributes,
  b: WpdRunAttributes,
): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike
  );
}

// Reports a diagnostic at most once per document. Every code below names a whole class of construct rather than one occurrence of it, so a document with two hundred boxes should say so once rather than two hundred times.
export function reportOnce(
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
export function flushRun(state: ReaderState): void {
  if (state.text.length === 0) {
    return;
  }
  state.runs.push(buildRun(state));
  state.text = "";
}

// assertDefined's own message for its one real call site (applyToken's "character" case). A fixed constant rather than a per-byte template, exported alongside assertDefined for this package's own tests only, so its exact text stays directly testable even though no real document byte can ever trigger it.
export const UNREACHABLE_CHARACTER_MAPPING_MESSAGE =
  "A single-byte document-area character had no character mapping, which the tokeniser's own byte range should make unreachable.";

// Narrows a value this reader has already proven cannot genuinely be undefined at its one call site, throwing loudly rather than silently substituting a sentinel if that proof is ever wrong. Exported for this package's own tests only: a real caller reaches it through applyToken's "character" case, never directly.
export function assertDefined<T>(
  value: T | undefined,
  message: string,
): asserts value is T {
  if (value === undefined) {
    throw new WpdFormatError(message);
  }
}

// Where a closed block belongs: a table's current cell while one is open, the section's own list otherwise.
export function targetBlocks(state: ReaderState): ContentBlock[] {
  return state.table === undefined ? state.blocks : state.table.cellBlocks;
}

// Closes the current paragraph. Called for every hard return, so a document with two consecutive hard returns genuinely produces an empty paragraph between them, that blank line is content the author typed, not an artefact.
export function flushParagraph(
  state: ReaderState,
  sink: WpdDiagnosticSink,
): void {
  flushRun(state);
  // A note's D7 On/Off pair encloses a reference site, a run-scoped extent, the identical constraint a merge FIELD has: an On with no Off before this paragraph closed means `runs` is about to be emptied and the start index means nothing in the next paragraph. Abandoned rather than carried, with the diagnostic saying so.
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
    // A FIELD On with no matching FIELD Off before this paragraph closed: `runs` is about to be spliced empty, so the run index this field opened at means nothing in the paragraph that follows. Abandoned rather than carried forward, the run-level extent mechanism cannot express a construct spanning two paragraphs, so no construct is emitted for this occurrence, and the diagnostic says so rather than the field silently vanishing with no trace.
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

// Closes the current paragraph only when it holds something. Used at every boundary that is a container edge rather than a line break, a cell end, a row end, the end of the stream, where an unconditional flush would fabricate a blank paragraph the author never typed.
export function flushParagraphIfContent(
  state: ReaderState,
  sink: WpdDiagnosticSink,
): void {
  if (state.text.length === 0 && state.runs.length === 0) {
    return;
  }
  flushParagraph(state, sink);
}

// The innermost open style scope that says something structural. An enclosing Global On naming the document's Normal style does not override a heading style opened inside it, and a scope with no meaning at all is transparent. findLast walks the scope stack from its own last (innermost) entry backward toward the first (outermost), exactly the search order this needs, with no separate index arithmetic of its own to keep in step with the stack's own length.
export function effectiveStyle(
  state: ReaderState,
): WpdStyleSemantics | undefined {
  return state.styleScopes.findLast((scope) => scope.semantics !== undefined)
    ?.semantics;
}

export function appendText(state: ReaderState, text: string): void {
  if (state.skipDepth > 0 || state.numberDisplayDepth > 0) {
    return;
  }
  // The paragraph's structural facts are captured at its first character, not at its close, see ReaderState.pendingHeadingLevel.
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
