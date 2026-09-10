import { slice } from "./bytes";
import { parsePlc } from "./plc";
import {
  readParagraphs,
  splitEntriesByBoundaries,
  type ParagraphEntry,
  type ReadContext,
} from "./text/paragraphs";
import { readTextRange } from "./text/characters";
import type { PieceTable } from "./text/piece-table";

// The document-stream range every non-main-document story (a footnote, an endnote, a comment, a header/footer slot) is read through: [MS-DOC] 2.4.1's own subdocument model has the main document, the footnote document, the header document, the comment (annotation) document, the endnote document, and the textbox documents concatenated one after another in a single logical CP space, each subdocument itself divided into individual stories by a boundary plex of its own -- PlcffndTxt for footnotes, PlcfandTxt for comments, PlcfendTxt for endnotes, Plcfhdd for headers/footers. Every one of those four plexes shares the identical shape ([MS-DOC]'s own words, repeated on each of their own pages): "Each CP except the last two specifies the beginning of a story ... The second-to-last CP only ends the last story ... The last CP is undefined and MUST be ignored." That is what lets one function read all four: `boundaryFc`/`boundaryLcb` locate the plex, `subdocStartCp`/`subdocLength` locate the subdocument's own slice of the WordDocument stream's logical text, and the trailing "ignored" slot every one of these plexes carries is dropped here once, rather than by each of notes.ts/headers-footers.ts separately. A story's own trailing guard mark is dropped here too when the story ends in a bare empty paragraph -- see endsWithGuardParagraph below for the two real spellings that rule has to hold.
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
  // A boundary plex of this shape carries only CPs, no per-element data -- parsePlc's own generic element-size-0 case, which still yields the plex's whole aCP array as `keys`.
  const plc = parsePlc(
    slice(table, boundaryFc, boundaryLcb, `${what} in the Table stream`),
    0,
    what,
  );
  const groups = splitEntriesByBoundaries(entries, plc.keys);
  // Drop the trailing "ignored" slot every one of PlcffndTxt/PlcfandTxt/PlcfendTxt/Plcfhdd carries -- splitEntriesByBoundaries produces one group per gap between consecutive keys, the last of which brackets that undefined sentinel rather than real story content.
  const stories = groups.slice(0, -1);
  // Each non-empty story's own final entry is dropped when it is a bare empty paragraph -- the guard paragraph mark [MS-DOC]'s Headers page requires between stories ("If a story is non-empty, it MUST end with a paragraph mark that serves as a guard between stories. This paragraph mark is not considered part of the story contents"), which a real producer spells as an empty paragraph of its own. A story whose final entry carries content is NOT dropped even though the earlier unconditional `story.slice(0, -1)` removed it: a real producer's footnote/endnote/comment stories genuinely end with their own last content paragraph's mark and no separate guard (confirmed against a LibreOffice-authored .doc, whose single-paragraph footnote story is `<footnote self-reference><tab>text<0x0D>` with the subdocument's one extra trailing mark sitting beyond the story -- PlcffndTxt's own "The range of text MUST end in character 0x0D immediately before the next CP" is satisfied by that content mark itself), so dropping the final entry unconditionally read every such note as empty and every multi-paragraph one as missing its last paragraph. A story whose last paragraph genuinely is empty is indistinguishable from a guard at the byte level in that spelling, which is the format's own ambiguity, not a choice: the guard reading wins, exactly as [MS-DOC]'s "not considered part of the story contents" says it must. An empty story's group is already `[]`, and dropping nothing from it stays `[]`, so this needs no separate case for one.
  return stories.map((story) =>
    endsWithGuardParagraph(story) ? story.slice(0, -1) : story,
  );
}

// Whether a story's own final entry is a bare paragraph mark and nothing else -- the guard spelling: one paragraph, no runs. Resolved through the entry's whole `blocks` rather than its text so an inline picture split out of the last paragraph (whose blocks end in the image, not a paragraph) is never mistaken for one.
function endsWithGuardParagraph(story: readonly ParagraphEntry[]): boolean {
  const last = story[story.length - 1];
  if (last === undefined) return false;
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
