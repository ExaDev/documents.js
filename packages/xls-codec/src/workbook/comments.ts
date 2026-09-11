import type { ContentSheetCellComment } from "document-schema.js";
import { BlockCursor } from "../biff/cursor";
import { RECORD_NOTE, RECORD_OBJ, RECORD_TXO } from "../biff/record-types";
import { readXLUnicodeString, readXLUnicodeStringNoCch } from "../biff/strings";
import type { RecordGroup } from "../biff/substreams";

// BIFF8 splits a cell comment across three record kinds, unlike xlsx's own single self-contained <comment> element (ooxml.js/src/typed/xlsx/comments.ts) -- a Note record ([MS-XLS] 2.4.179, wrapping a NoteSh structure) anchors the comment to a cell and names its author, but carries no text of its own; the text lives in a TxO record ([MS-XLS] 2.4.329, its characters and formatting runs trailing across Continue records already merged into one RecordGroup by groupRecords -- see biff/substreams.ts); the two are joined through an Obj record ([MS-XLS] 2.4.181) whose FtCmo names an object id and type, the Note's own idObj field naming that same id, and a TxO always immediately following the Obj record whose shape it belongs to.
//
// This reads the worksheet substream's records in one independent pass, entirely separate from workbook/sheet.ts's own CELLTABLE walk: comments are not part of that grammar, and by the time a Note record's idObj can be resolved to real text, the TxO that carries it has not necessarily been reached yet relative to reading order within one linear pass -- an Obj+TxO pair for a comment is not guaranteed to sit before or after the Note records naming it, only that both exist somewhere in the same substream. Building the id -> text map first, over the whole record list, and only then resolving every Note against it sidesteps that ordering question entirely.
//
// Legacy BIFF8 comments have no threading and no per-comment timestamp: NoteSh carries no reply structure and no date field at all (unlike xlsx's own [MS-XLSX] extension), so ContentSheetCellComment.replies and .createdAt are never populated from an .xls source -- both stay correctly absent, exactly the schema's own "present only when the source recorded one" contract.

/** [MS-XLS] 2.5.213 ObjId: which drawing-object type this package needs to recognise -- Note, so its own text can be told apart from any other shape's (a text box, a button) sharing the same TxO mechanism. */
const OBJECT_TYPE_NOTE = 0x0019;

/** One comment, resolved to the cell position it is anchored to. */
export interface SheetCellComment {
  readonly row: number;
  readonly column: number;
  readonly comment: ContentSheetCellComment;
}

interface NoteAnchor {
  readonly row: number;
  readonly column: number;
  readonly idObj: number;
  readonly author?: string;
}

/** [MS-XLS] 2.5.163 NoteSh, this package's own field-by-field reading of a Note record's payload: row, col, a flags word this reader has no use for (fShow/fRwHidden/fColHidden govern on-screen display, not content), idObj (the Obj record naming this comment's text), and stAuthor -- the comment's author, carried on the anchor itself rather than on the text object. */
function readNoteAnchor(group: RecordGroup): NoteAnchor {
  const cursor = new BlockCursor(group.blocks);
  const row = cursor.u16();
  const column = cursor.u16();
  cursor.skip(2); // flags: fShow/fRwHidden/fColHidden, none of which this reader models
  const idObj = cursor.u16();
  const author = readXLUnicodeString(cursor);
  return author.length > 0
    ? { row, column, idObj, author }
    : { row, column, idObj };
}

/** [MS-XLS] 2.5.92 FtCmo, read only far enough to answer "what kind of drawing object is this, and what id does a following TxO/other per-object record cross-reference": ft/cb are fixed reserved values this reader does not validate, ot is the object type, id is what a Note record's idObj (here) and workbook/drawing.ts's own shape pairing (there) both key on. Exported for workbook/drawing.ts, which pairs each MsoDrawing shape with the Obj record immediately naming it -- the identical FtCmo structure every Obj record carries, comment-anchored or not. */
export function readObjTypeAndId(group: RecordGroup): {
  readonly ot: number;
  readonly id: number;
} {
  const cursor = new BlockCursor(group.blocks);
  cursor.skip(4); // ft (2, reserved 0x15), cb (2, reserved 0x12)
  const ot = cursor.u16();
  const id = cursor.u16();
  return { ot, id };
}

/** [MS-XLS] 2.5.92 FtCmo's own fixed 22-byte length (ft/cb, ot, id, grbit, three unused dwords -- workbook/drawing-writer.ts's own writeFtCmo names the identical fields, in the identical order). */
const FT_CMO_SIZE = 22;

/** [MS-XLS] 2.5.150 FtPictFmla's own ft value: the one sub-record naming the Embedding Storage an OLE-embedded picture's data actually lives in, as opposed to the workbook-wide Blip Store a plain image references through its Escher shape's own pib property instead. */
const FT_PICT_FMLA = 0x0009;

/**
 * The Embedding Storage id an Obj record's own FtPictFmla names, for a Picture-type object hosting an embedded OLE object rather than a plain image -- workbook/drawing-writer.ts's own writeFtPictFmla is this function's exact inverse. Undefined for a plain picture (whose Obj record carries no FtPictFmla at all, since its data lives in the workbook's Blip Store instead) or for any other object kind.
 *
 * Walks every sub-record after FtCmo -- FtCf, FtPioGrbit, and whichever others a real producer's own Obj record carries -- by its own generic ft/cb framing ([MS-XLS] 2.4.181's own "OBJECTPARSEDFORMULA = ft cb NAME" - shaped `1*ft` production), stopping the moment FtPictFmla itself is found; a zero ft value is the record's own trailing reserved marker (four zero bytes, [MS-XLS] 2.4.181's own "reserved" field) rather than a genuine sub-record, so it ends the walk with no storage id found.
 */
export function readObjPictFmlaStorageId(
  group: RecordGroup,
): number | undefined {
  const cursor = new BlockCursor(group.blocks);
  cursor.skip(FT_CMO_SIZE);
  while (cursor.hasMore()) {
    const ft = cursor.u16();
    if (ft === 0) {
      return undefined; // the record's own trailing reserved bytes, not a sub-record
    }
    const cb = cursor.u16();
    if (ft !== FT_PICT_FMLA) {
      cursor.skip(cb);
      continue;
    }
    const cbFmla = cursor.u16();
    cursor.skip(cbFmla); // ObjectParsedFormula + PictFmlaEmbedInfo -- this reader has no use for either half, only the storage id that follows
    return cursor.u32(); // lPosInCtlStm
  }
  return undefined;
}

/** [MS-XLS] 2.4.329 TxO: the fixed fields up to and including ObjFmla are read in full (even the ones this reader discards) purely to advance the cursor correctly onto the Continue-carried text that follows -- reserved4+reserved5 and controlInfo are mutually exclusive per cmo.ot but identical in total size (6 bytes), so which one applies never needs deciding here. Only the plain text is kept: rich per-character formatting runs (cbRuns bytes, TxORuns) are skipped rather than modelled, the same scope limit readRichExtendedString already applies to the SST's own rich strings, for the same reason -- ContentSheetCellComment.text is a plain string with nowhere to carry them. */
function readTxoText(group: RecordGroup): string {
  const cursor = new BlockCursor(group.blocks);
  cursor.skip(4); // grbit (2), rot (2)
  cursor.skip(6); // reserved4+reserved5 (2+4) or controlInfo (6) -- same total size either way
  const cchText = cursor.u16();
  const cbRuns = cursor.u16();
  cursor.skip(2); // ifntEmpty
  const cbFmla = cursor.u16();
  cursor.skip(cbFmla); // ObjFmla's own payload -- empty (cbFmla 0) for a comment's plain text box
  if (cchText === 0) {
    return "";
  }
  const text = readXLUnicodeStringNoCch(cursor, cchText);
  cursor.skip(cbRuns);
  return text;
}

/** Every cell comment a worksheet substream's records carry, keyed `${row}:${column}` to match ooxml.js's own readSheetCellComments convention. A Note record whose idObj resolves to no Obj+TxO pair (a malformed or unusually ordered file) is skipped rather than materialised with fabricated or missing text -- this reader is tolerant of unusual record ordering elsewhere in the substream (see workbook/sheet.ts's own top comment) but a comment with no recoverable text is not real content worth keeping. */
export function readSheetComments(
  records: readonly RecordGroup[],
): ReadonlyMap<string, SheetCellComment> {
  const textByObjId = new Map<number, string>();
  const noteAnchors: NoteAnchor[] = [];
  let pendingNoteObjId: number | undefined;
  for (const group of records) {
    switch (group.type) {
      case RECORD_OBJ: {
        const { ot, id } = readObjTypeAndId(group);
        pendingNoteObjId = ot === OBJECT_TYPE_NOTE ? id : undefined;
        break;
      }
      case RECORD_TXO: {
        if (pendingNoteObjId !== undefined) {
          textByObjId.set(pendingNoteObjId, readTxoText(group));
          pendingNoteObjId = undefined;
        }
        break;
      }
      case RECORD_NOTE: {
        noteAnchors.push(readNoteAnchor(group));
        break;
      }
      default:
        break;
    }
  }
  const comments = new Map<string, SheetCellComment>();
  for (const anchor of noteAnchors) {
    const text = textByObjId.get(anchor.idObj);
    if (text === undefined) {
      continue;
    }
    const comment: ContentSheetCellComment = { text };
    if (anchor.author !== undefined) {
      comment.author = anchor.author;
    }
    comments.set(`${anchor.row}:${anchor.column}`, {
      row: anchor.row,
      column: anchor.column,
      comment,
    });
  }
  return comments;
}
