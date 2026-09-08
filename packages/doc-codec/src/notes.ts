import type { Fib } from "./fib/fib";
import { readSubdocumentStories, storyText } from "./subdocument";
import type { ReadContext } from "./text/paragraphs";
import type { PieceTable } from "./text/piece-table";

// Footnotes, endnotes, and comments, read as plain text -- ooxml.js's own DocxDocument.footnotes/endnotes/comments shape (typed/docx/read.ts's Footnote/Comment: `{id?, text}` and `{id?, author?, text}`), which this reader mirrors rather than the richer block-flow HeaderFooterPart headers-footers.ts produces, since that is the identical simplification a genuine sibling codec in this family already made for the same three constructs. `id` here is always present, a synthetic one-based ordinal (this reader's own footnote/endnote/comment reference plexes -- PlcffndRef/PlcfendRef/PlcfandRef -- carry no other stable identifier a real producer's own numbering would survive a re-read by), which is enough for a caller matching a note body back to its own reference mark by document order, the same order [MS-DOC] itself defines between a reference plex and its own text plex.

export interface Footnote {
  readonly id: string;
  readonly text: string;
}

export interface Comment {
  readonly id: string;
  readonly text: string;
}

export interface NoteBodies {
  readonly footnotes: readonly Footnote[];
  readonly endnotes: readonly Footnote[];
  readonly comments: readonly Comment[];
}

export function readNoteBodies(
  wordDocument: Uint8Array,
  table: Uint8Array,
  pieceTable: PieceTable,
  context: ReadContext,
  fib: Fib,
): NoteBodies {
  // Subdocument order, [MS-DOC] 2.4.1: main, footnote, header, comment (annotation), endnote, textbox, header-textbox -- each subdocument's own starting CP is the running total of every one before it.
  const footnoteStartCp = fib.ccpText;
  const headerStartCp = footnoteStartCp + fib.ccpFtn;
  const commentStartCp = headerStartCp + fib.ccpHdd;
  const endnoteStartCp = commentStartCp + fib.ccpAtn;

  const footnotes = readSubdocumentStories(
    wordDocument,
    table,
    pieceTable,
    context,
    footnoteStartCp,
    fib.ccpFtn,
    fib.fcPlcffndTxt,
    fib.lcbPlcffndTxt,
    "PlcffndTxt",
  ).map((entries, index) => ({
    id: String(index + 1),
    text: storyText(entries),
  }));

  const comments = readSubdocumentStories(
    wordDocument,
    table,
    pieceTable,
    context,
    commentStartCp,
    fib.ccpAtn,
    fib.fcPlcfandTxt,
    fib.lcbPlcfandTxt,
    "PlcfandTxt",
  ).map((entries, index) => ({
    id: String(index + 1),
    text: storyText(entries),
  }));

  const endnotes = readSubdocumentStories(
    wordDocument,
    table,
    pieceTable,
    context,
    endnoteStartCp,
    fib.ccpEdn,
    fib.fcPlcfendTxt,
    fib.lcbPlcfendTxt,
    "PlcfendTxt",
  ).map((entries, index) => ({
    id: String(index + 1),
    text: storyText(entries),
  }));

  return { footnotes, endnotes, comments };
}
