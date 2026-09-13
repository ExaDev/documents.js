import { readInt32LE, slice } from "./bytes";
import { DocFormatError } from "./errors";
import {
  readParagraphs,
  splitEntriesByBoundaries,
  type ParagraphEntry,
  type ReadContext,
} from "./text/paragraphs";
import { readTextRange } from "./text/characters";
import type { PieceTable } from "./text/piece-table";

// The document-stream range every non-main-document story (a footnote, an endnote, a comment, a header/footer slot) is read through: [MS-DOC] 2.4.1's own subdocument model has the main document, the footnote document, the header document, the comment (annotation) document, the endnote document, and the textbox documents concatenated one after another in a single logical CP space, each subdocument itself divided into individual stories by a boundary plex of its own -- PlcffndTxt for footnotes, PlcfandTxt for comments, PlcfendTxt for endnotes, Plcfhdd for headers/footers. Every one of those four plexes shares the identical shape ([MS-DOC]'s own words, repeated on each of their own pages): "Each CP except the last two specifies the beginning of a story ... The second-to-last CP only ends the last story ... The last CP is undefined and MUST be ignored." That is what lets one function read all four: `boundaryFc`/`boundaryLcb` locate the plex, `subdocStartCp`/`subdocLength` locate the subdocument's own slice of the WordDocument stream's logical text, and the trailing "ignored" slot every one of these plexes carries is dropped here once, rather than by each of notes.ts/headers-footers.ts separately. A story's own trailing guard mark is dropped here too when the story ends in a bare empty paragraph -- see endsWithGuardParagraph below for the two real spellings that rule has to hold.

// Reads one story plex's own aCP array, leniently where a genuine Word 97 producer is lenient. [MS-DOC]'s own pages for PlcffndTxt/PlcfandTxt/PlcfendTxt/Plcfhdd state each CP "MUST be greater than or equal to 0 and less than" the subdocument's own length, and the shared PLC container (plc.ts) enforces ascending keys for every PLC in the format -- but a genuine Word 97-authored file writes placeholder CPs that break both rules in its Plcfhdd when a document carries (mostly) no headers at all: -1 entries mid-array and a CP past the subdocument's own end, with ccpHdd itself just 1. Word's own writers predate the published specification's tightening, and a real, independent [MS-DOC] implementation (LibreOffice 26.8.0.3) opens the identical bytes with no header content and no error. Rather than refuse such a document outright, an out-of-range key snaps to its predecessor -- stating an empty story through the same "beginning CP has the same value as the next CP" semantics the specification itself defines, without moving any later key, so one placeholder cannot swallow the stories after it. A key that merely descends below its in-range predecessor is raised to it, the identical empty-story spelling. An ascending, in-range plex passes through value-for-value unchanged, so a conformant file reads exactly as before.
function readStoryPlexKeys(
  bytes: Uint8Array,
  subdocLength: number,
  what: string,
): readonly number[] {
  if (bytes.length < 4 || !Number.isInteger((bytes.length - 4) / 4)) {
    throw new DocFormatError(
      `${what} is ${bytes.length} bytes, which does not yield a whole number of 4-byte keys`,
    );
  }
  const keys: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const raw = readInt32LE(bytes, offset);
    const previous = keys[keys.length - 1] ?? 0;
    // A negative raw never needs its own clause: previous is never itself negative (0 to start, or a prior iteration's own previous/Math.max result, both non-negative), so Math.max(raw, previous) already picks previous whenever raw < 0 -- checking it explicitly would only ever restate what the fallback below already does.
    keys.push(raw > subdocLength ? previous : Math.max(raw, previous));
  }
  return keys;
}

export function readSubdocumentStories(
  wordDocument: Uint8Array,
  table: Uint8Array,
  pieceTable: PieceTable,
  context: ReadContext,
  subdocStartCp: number,
  subdocLength: number,
  boundaryFc: number,
  boundaryLcb: number,
  what: string,
): readonly ParagraphEntry[][] {
  if (subdocLength <= 0 || boundaryLcb <= 0) return [];
  const range = readTextRange(
    wordDocument,
    pieceTable,
    subdocStartCp,
    subdocStartCp + subdocLength,
  );
  const entries = readParagraphs(range.text, range.fcs, context);
  // A boundary plex of this shape carries only CPs, no per-element data, so its whole body is the aCP array -- read through readStoryPlexKeys rather than the shared PLC parser, whose ascending-keys invariant a genuine Word 97 file's placeholder CPs do not honour (see that function's own note).
  const keys = readStoryPlexKeys(
    slice(table, boundaryFc, boundaryLcb, `${what} in the Table stream`),
    subdocLength,
    what,
  );
  const groups = splitEntriesByBoundaries(entries, keys);
  // Drop the trailing "ignored" slot every one of PlcffndTxt/PlcfandTxt/PlcfendTxt/Plcfhdd carries -- splitEntriesByBoundaries produces one group per gap between consecutive keys, the last of which brackets that undefined sentinel rather than real story content.
  const stories = groups.slice(0, -1);
  // Each non-empty story's own final entry is dropped when it is a bare empty paragraph -- the guard paragraph mark [MS-DOC]'s Headers page requires between stories ("If a story is non-empty, it MUST end with a paragraph mark that serves as a guard between stories. This paragraph mark is not considered part of the story contents"), which a real producer spells as an empty paragraph of its own. A story whose final entry carries content is NOT dropped even though the earlier unconditional `story.slice(0, -1)` removed it: a real producer's footnote/endnote/comment stories genuinely end with their own last content paragraph's mark and no separate guard (confirmed against a LibreOffice-authored .doc, whose single-paragraph footnote story is `<footnote self-reference><tab>text<0x0D>` with the subdocument's one extra trailing mark sitting beyond the story -- PlcffndTxt's own "The range of text MUST end in character 0x0D immediately before the next CP" is satisfied by that content mark itself), so dropping the final entry unconditionally read every such note as empty and every multi-paragraph one as missing its last paragraph. A story whose last paragraph genuinely is empty is indistinguishable from a guard at the byte level in that spelling, which is the format's own ambiguity, not a choice: the guard reading wins, exactly as [MS-DOC]'s "not considered part of the story contents" says it must. An empty story's group is already `[]`, and dropping nothing from it stays `[]`, so this needs no separate case for one.
  // The empty-story case (last === undefined) is resolved here rather than inside endsWithGuardParagraph itself: an empty story's own story.slice(0, -1) is already [] either way, so a guard returning false for it from inside the function can never be told apart from one that didn't bother -- narrowing `last` to defined before the call, instead, means a mutant that skipped this check entirely would call endsWithGuardParagraph(undefined) and fail to typecheck rather than survive unnoticed.
  return stories.map((story) => {
    const last = story[story.length - 1];
    return last !== undefined && endsWithGuardParagraph(last)
      ? story.slice(0, -1)
      : story;
  });
}

// Whether a story's own final entry is a bare paragraph mark and nothing else -- the guard spelling: one paragraph, no runs. Resolved through the entry's whole `blocks` rather than its text so an inline picture split out of the last paragraph (whose blocks end in the image, not a paragraph) is never mistaken for one.
function endsWithGuardParagraph(last: ParagraphEntry): boolean {
  if (last.blocks.length !== 1) return false;
  const only = last.blocks[0];
  return only?.kind === "paragraph" && only.runs.length === 0;
}

/** Joins a story's own paragraphs into plain text -- one line per paragraph, matching how ooxml.js's own Footnote/Comment reading concatenates a footnote or comment body's `w:t` runs rather than preserving paragraph/run structure. A footnote, endnote, or comment in this family is carried as text alone; only a header or footer keeps real block flow (headers-footers.ts). Non-paragraph blocks a story's own entries produced (an inline picture split out of one of its paragraphs) contribute no text of their own here, the same way an image has no plain-text spelling in ooxml.js's own footnote/comment reading either. */
export function storyText(entries: readonly ParagraphEntry[]): string {
  return entries
    .map((entry) =>
      entry.blocks
        .flatMap((block) => (block.kind === "paragraph" ? block.runs : []))
        .map((run) => run.text)
        .join(""),
    )
    .join("\n");
}
