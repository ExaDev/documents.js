import type { ContentSheetCell } from "document-schema.js";

import { RecordBuilder } from "../biff/builder";
import {
  RECORD_CONTINUE,
  RECORD_NOTE,
  RECORD_OBJ,
  RECORD_TXO,
} from "../biff/record-types";
import { writeRecord } from "../biff/record-writer";
import {
  writeXLUnicodeString,
  writeXLUnicodeStringNoCch,
} from "../biff/string-writer";
import { BiffWriteError } from "../biff/write-errors";

// The write-side counterpart of workbook/comments.ts: a cell's own ContentSheetCellComment written back out as the same Note/Obj/TxO triple BIFF8 splits a legacy comment across ([MS-XLS] 2.4.179/2.4.181/2.4.329) -- see that module's own top comment for the full citation of how the three join. Legacy BIFF8 comments carry no threading and no per-comment timestamp at all, so ContentSheetCellComment.replies and .createdAt have nowhere to land here: only .text and .author round-trip through an .xls, exactly the read side's own documented scope.
//
// Written as two groups, matching how a real producer (and this reader's own ordering-tolerant pass) lays a worksheet's comments out: every Note record first, then, for each comment in the same order, its own Obj record immediately followed by a TxO record and the one Continue record carrying that TxO's own text and minimal formatting-run trailer.

/** [MS-XLS] 2.5.213 ObjId: the drawing-object type a comment's Obj record names -- workbook/comments.ts's own OBJECT_TYPE_NOTE, restated here since the two modules read/write the identical constant independently rather than sharing an import across the read/write boundary (matching this package's existing convention of one module per direction). */
const OBJECT_TYPE_NOTE = 0x0019;

const FTCMO_FT = 0x0015;
const FTCMO_CB = 0x0012;
const FTNTS_FT = 0x000d;
const FTNTS_CB = 0x0016;

/** FtCmo ([MS-XLS] 2.5.92, 22 bytes): the common properties every Obj record opens with. Every flag bit beyond ot/id is either a UI concern (locked, default size, printed) this writer has no data for, or explicitly reserved -- so grbit and the three trailing "unused" fields are all written zero. */
function writeFtCmo(objId: number): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u16(FTCMO_FT)
    .u16(FTCMO_CB)
    .u16(OBJECT_TYPE_NOTE)
    .u16(objId)
    .u16(0) // grbit: fLocked/fDefaultSize/fPublished/fPrint and reserved bits, none of which this writer has data for
    .u32(0) // unused8
    .u32(0) // unused9
    .u32(0) // unused10
    .build();
}

/** A pseudo-random 16-byte GUID for FtNts's own comment identifier -- [MS-XLS] requires the field to be present and does not require it to be globally unique across files, only present, so a fresh random value per comment (rather than a fixed or zero one) is what a real producer's own GUID allocation looks like without this package needing a GUID-formatting dependency. Worker-isomorphic: globalThis.crypto is available in both Node and a Cloudflare Workers isolate, unlike Node's own node:crypto module. */
function randomGuidBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** FtNts ([MS-XLS] 2.5.163... 2.5.b0991167, 26 bytes): the note-specific properties following FtCmo in a comment's own Obj record. fSharedNote is always written clear -- this writer has no shared-comment concept to express. */
function writeFtNts(): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u16(FTNTS_FT)
    .u16(FTNTS_CB)
    .bytes(randomGuidBytes())
    .u16(0) // fSharedNote: not shared
    .u32(0) // unused
    .build();
}

/** Obj ([MS-XLS] 2.4.181) for a Note-type object: FtCmo, then FtNts (present if and only if cmo.ot is 0x19, which this writer's OBJECT_TYPE_NOTE always is), then the mandatory trailing 4-byte reserved field every Obj not naming a list-box/dropdown object (ot 0x12/0x14) carries. */
function writeObjRecordForNote(objId: number): Uint8Array<ArrayBuffer> {
  const data = new RecordBuilder()
    .bytes(writeFtCmo(objId))
    .bytes(writeFtNts())
    .u32(0) // reserved: MUST be 0
    .build();
  return writeRecord(RECORD_OBJ, data);
}

/** TxORuns' own minimal shape for plain, unformatted text ([MS-XLS] 2.5.31cd7d1e/d738ffef/6fb4c0e3): one Run (an all-default FormatRun -- ich 0, ifnt 0 -- plus its own six reserved bytes) followed by the mandatory TxOLastRun sentinel naming cchText again. 16 bytes total, the minimum [MS-XLS]'s own "cbRuns MUST be >= 16 and a multiple of 8" rule allows -- this writer never carries real per-character formatting for a comment's text (workbook/comments.ts's own read side does not model TxORuns either, for the identical reason). */
function writeMinimalTxoRuns(cchText: number): Uint8Array<ArrayBuffer> {
  return new RecordBuilder()
    .u16(0) // Run.formatRun.ich
    .u16(0) // Run.formatRun.ifnt
    .u16(0) // Run.unused1
    .u16(0) // Run.unused2
    .u16(cchText) // TxOLastRun.cchText
    .u16(0) // TxOLastRun.unused1
    .u32(0) // TxOLastRun.unused2
    .build();
}

const TXO_HALIGN_LEFT = 1;
const TXO_VALIGN_TOP = 1;

/** TxO ([MS-XLS] 2.4.329) plus the one Continue record carrying its text and formatting-run trailer -- see this module's own top comment for why both text and runs can share a single Continue rather than needing one each. cchText is 0 for an empty comment, in which case [MS-XLS] itself requires cbRuns to be 0 too and no Continue record follows at all. */
function writeTxoRecords(text: string): Uint8Array<ArrayBuffer>[] {
  const cchText = text.length;
  const cbRuns = cchText === 0 ? 0 : 16;
  const grbit = (TXO_HALIGN_LEFT << 1) | (TXO_VALIGN_TOP << 4);
  const txoData = new RecordBuilder()
    .u16(grbit)
    .u16(0) // rot: no rotation
    .u16(0) // reserved4: present because cmo.ot (Note, 0x19) is not one of the ControlInfo-carrying object types
    .u32(0) // reserved5
    .u16(cchText)
    .u16(cbRuns)
    .u16(0) // ifntEmpty: meaningful only when cchText is 0, in which case there is no font to name either
    .u16(0) // cbFmla: a comment's text box carries no linked formula
    .build();
  const txo = writeRecord(RECORD_TXO, txoData);
  if (cchText === 0) {
    return [txo];
  }
  const continueData = new RecordBuilder()
    .bytes(writeXLUnicodeStringNoCch(text))
    .bytes(writeMinimalTxoRuns(cchText))
    .build();
  return [txo, writeRecord(RECORD_CONTINUE, continueData)];
}

/**
 * Note ([MS-XLS] 2.4.179, wrapping a NoteSh structure): the comment's own cell anchor and author, naming the Obj record that carries its text through idObj. fShow/fRwHidden/fColHidden are always written clear -- this writer tracks none of the on-screen display state they carry.
 *
 * A comment with no recorded author writes stAuthor as an empty string, rather than a non-empty placeholder -- [MS-XLS] 2.5.163 itself documents stAuthor's own length as "MUST be greater than or equal to 1", but this reader (workbook/comments.ts's own readNoteAnchor) only ever promotes a NON-empty stAuthor to ContentSheetCellComment.author, meaning a placeholder would round-trip back as a fabricated author nobody wrote. An empty string is the one spelling that round-trips through this reader as "no author", matching every other lossless-round-trip choice this writer makes in favour of what its own reader reads back over strict textual conformance to a field length rule real producers routinely leave unenforced anyway.
 */
function writeNoteRecord(
  cell: ContentSheetCell,
  objId: number,
): Uint8Array<ArrayBuffer> {
  const data = new RecordBuilder()
    .u16(cell.row)
    .u16(cell.column)
    .u16(0) // flags: fShow/fRwHidden/fColHidden, none of which this writer has data for
    .u16(objId)
    .bytes(writeXLUnicodeString(cell.comment?.author ?? ""))
    .u8(0) // unused2
    .build();
  return writeRecord(RECORD_NOTE, data);
}

const MAX_OBJECT_ID = 0xffff;

/**
 * Every Note/Obj/TxO record a sheet's own commented cells need, in the order described above -- for `cells` already filtered to exactly those carrying a `comment` (workbook/sheet-writer.ts's own caller does the filtering, since only it knows the sheet's full cell list).
 *
 * Object ids are assigned sequentially from 1: [MS-XLS] 2.5.92's own FtCmo.id must be unique "among all Obj records within ... Worksheet Substream ABNF", and this writer never emits any other kind of Obj record (no shapes, charts, or form controls yet -- see this package's README), so a per-sheet counter starting at 1 is already unique on its own.
 */
export function writeSheetComments(
  commentedCells: readonly ContentSheetCell[],
): Uint8Array<ArrayBuffer>[] {
  if (commentedCells.length > MAX_OBJECT_ID) {
    throw new BiffWriteError(
      `sheet carries ${commentedCells.length} cell comments, more than the ${MAX_OBJECT_ID} distinct object ids [MS-XLS] 2.5.92's own 16-bit FtCmo.id field can hold`,
    );
  }
  const ordered = [...commentedCells].sort((a, b) =>
    a.row !== b.row ? a.row - b.row : a.column - b.column,
  );
  const pieces: Uint8Array<ArrayBuffer>[] = ordered.map((cell, index) =>
    writeNoteRecord(cell, index + 1),
  );
  ordered.forEach((cell, index) => {
    const objId = index + 1;
    const comment = cell.comment;
    if (comment === undefined) {
      throw new BiffWriteError(
        `internal error: writeSheetComments was called with a cell at row ${cell.row}, column ${cell.column} carrying no comment`,
      );
    }
    pieces.push(writeObjRecordForNote(objId), ...writeTxoRecords(comment.text));
  });
  return pieces;
}
