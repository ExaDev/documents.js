// The read side of this package's public surface, in both encodings document-schema.js states for one document: readRtf produces the tree-form DocumentTree (the primary entry point), readRtfContent produces the flat ContentDocument the state machine in read-parse.ts/read-builder.ts actually builds.
//
// Why two, and why assembleTree rather than bare decompose, are both settled precedent in this family rather than decisions taken here — see markdown-codec's own src/read.ts header for the full reasoning. In short: document-schema.js owns both encodings and calls assembleTree "the one helper a construction site calls"; a codec is a construction site; and the unsuffixed name is the one a caller should reach for, with the `Content` suffix naming the flat constituent underneath it (ooxml.js's readXlsx/readXlsxContent set that convention). There is no `pages` argument because RTF has no layout stage in this package at all.
//
// THE STATE MACHINE, split across five modules. RTF's reader model is stated directly by the specification ("Conventions of an RTF Reader") and is what this module's siblings implement literally: an opening brace stores the current state on a stack, a closing brace retrieves it, a backslash collects a control word or symbol and dispatches on it, and anything else is text written "to the current destination using the current formatting properties". Four kinds of state ride that stack, exactly as the spec enumerates them — the destination, character-formatting properties, paragraph-formatting properties, and table-formatting properties — with one addition of this reader's own, the \ucN skip count, which the spec separately requires be stacked ("values are scoped like character properties ... On exiting the group, the previous \ucN value is restored"). read-state.ts holds the state shapes themselves; read-builder.ts holds ContentBuilder, which accumulates that state into a ContentDocument; read-build.ts holds the "finished state to final document-schema.js shape" conversions; read-control-words.ts holds the per-control-word dispatch; read-parse.ts holds readRtfDetail, the token loop that ties all four together.
//
// WHAT THE DESTINATION DOES. A destination is not merely a label: it decides what happens to text. Body text becomes runs; a \pict destination's text is hex picture payload; an \objdata destination's text is the identical hex-or-binary payload for a whole embedded object; a \fldinst destination's text is a field instruction to be parsed rather than shown; a \listtext destination's text is the flat rendering of a list number that "should be ignored by any reader that understands Word 97 through Word 2007 numbering"; an unrecognised {\* destination's text is discarded whole. read-state.ts's own DESTINATION_KINDS is that mapping, and it is the reason this reader can be a single pass with no lookahead beyond a group's own head.
//
// TABLES ARE PARAGRAPH PROPERTIES, NOT A GROUP. "There is no RTF table group; instead, tables are specified as paragraph properties." A row is a run of \intbl paragraphs terminated by \cell marks and closed by \row, with the row's own <tbldef> (\trowd ... \cellxN) sitting before it, after it, or — for Word 2002 onward — both. So the table builder here is driven by the \cell/\row marks in the text stream rather than by nesting, and a table closes when a non-table paragraph arrives or the section ends.
//
// UNICODE. \uN carries the character and is followed by an ANSI approximation that a Unicode-aware reader must skip: "the reader should ignore the next N' characters, where N' corresponds to the last \ucN' value encountered", where "any RTF control word or symbol is considered a single character" and a brace ends the skippable run early. read-state.ts's own skipUnicodeFallback implements exactly that, including the partial consumption of a text run, which is why the main loop in read-parse.ts carries a byte offset alongside its token index.

import { assembleTree } from "document-schema.js";
import { rtfBytesFromLatin1 } from "./bytes";
import type { ReadRtfOptions } from "./options";
import { readRtfDetail } from "./read-parse";
import type { ReadRtfContentResult, ReadRtfResult } from "./read-state";

export function readRtfContent(
  input: Uint8Array | string,
  options: ReadRtfOptions = {},
): ReadRtfContentResult {
  return readRtfDetail(
    typeof input === "string" ? rtfBytesFromLatin1(input) : input,
    options,
  );
}

export function readRtf(
  input: Uint8Array | string,
  options: ReadRtfOptions = {},
): ReadRtfResult {
  const { document, diagnostics } = readRtfContent(input, options);
  return { documentPackage: assembleTree(document), diagnostics };
}
