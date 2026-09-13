import { describe, expect, it } from "vitest";

import { readRecords } from "../biff/records";
import {
  RECORD_CONTINUE,
  RECORD_NOTE,
  RECORD_OBJ,
  RECORD_TXO,
} from "../biff/record-types";
import { groupRecords } from "../biff/substreams";
import { concat } from "../test-support/biff";
import { BiffWriteError } from "../biff/write-errors";
import { readSheetComments } from "./comments";
import { writeSheetComments, type CommentedCell } from "./comment-writer";

function commentedCell(
  row: number,
  column: number,
  text: string,
  author?: string,
): CommentedCell {
  return {
    row,
    column,
    value: { kind: "empty" },
    displayText: "",
    comment: author === undefined ? { text } : { text, author },
  };
}

function readBack(pieces: readonly Uint8Array<ArrayBuffer>[]) {
  return readSheetComments(groupRecords(readRecords(concat(...pieces))));
}

describe("writeSheetComments", () => {
  it("returns nothing for a sheet with no commented cells", () => {
    expect(writeSheetComments([])).toStrictEqual([]);
  });

  it("round-trips one comment's cell position, text, and author", () => {
    const pieces = writeSheetComments([commentedCell(2, 3, "Hello", "Alice")]);

    expect(readBack(pieces).get("2:3")).toStrictEqual({
      row: 2,
      column: 3,
      comment: { text: "Hello", author: "Alice" },
    });
  });

  it("round-trips a comment with no author as an absent author, not an empty-string placeholder", () => {
    const pieces = writeSheetComments([commentedCell(0, 0, "No author")]);

    expect(readBack(pieces).get("0:0")).toStrictEqual({
      row: 0,
      column: 0,
      comment: { text: "No author" },
    });
  });

  it("round-trips an empty-text comment, writing no Continue record for it", () => {
    const pieces = writeSheetComments([commentedCell(1, 1, "")]);
    const records = readRecords(concat(...pieces));

    expect(records.some((r) => r.type === 0x003c /* CONTINUE */)).toBe(false);
    expect(readBack(pieces).get("1:1")).toStrictEqual({
      row: 1,
      column: 1,
      comment: { text: "" },
    });
  });

  it("round-trips every comment of a multi-comment sheet", () => {
    const pieces = writeSheetComments([
      commentedCell(5, 5, "Fifth", "E"),
      commentedCell(0, 9, "First-by-row", "A"),
      commentedCell(0, 2, "First-by-column", "B"),
    ]);
    const comments = readBack(pieces);

    expect(comments.get("5:5")?.comment).toStrictEqual({
      text: "Fifth",
      author: "E",
    });
    expect(comments.get("0:9")?.comment).toStrictEqual({
      text: "First-by-row",
      author: "A",
    });
    expect(comments.get("0:2")?.comment).toStrictEqual({
      text: "First-by-column",
      author: "B",
    });
  });

  it("emits Note records in row-then-column order regardless of input order", () => {
    const pieces = writeSheetComments([
      commentedCell(2, 0, "third"),
      commentedCell(0, 5, "second"),
      commentedCell(0, 1, "first"),
    ]);
    const records = readRecords(concat(...pieces));
    const notePositions = records
      .filter((r) => r.type === RECORD_NOTE)
      .map((r) => [r.data[0], r.data[2]]); // row, column: each a little-endian u16 whose low byte alone is enough here

    expect(notePositions).toStrictEqual([
      [0, 1],
      [0, 5],
      [2, 0],
    ]);
  });

  it("emits every Note first, then each comment's own Obj/TxO pair, in the same order", () => {
    const pieces = writeSheetComments([
      commentedCell(0, 1, "first"),
      commentedCell(0, 5, "second"),
    ]);
    const records = readRecords(concat(...pieces));
    const types = records.map((r) => r.type);

    expect(types).toStrictEqual([
      RECORD_NOTE,
      RECORD_NOTE,
      RECORD_OBJ,
      RECORD_TXO,
      RECORD_CONTINUE,
      RECORD_OBJ,
      RECORD_TXO,
      RECORD_CONTINUE,
    ]);
  });

  it("assigns sequential object ids starting from 1, matching each Note's own idObj", () => {
    const pieces = writeSheetComments([
      commentedCell(0, 0, "a"),
      commentedCell(0, 1, "b"),
    ]);
    const records = readRecords(concat(...pieces));
    const notes = records.filter((r) => r.type === RECORD_NOTE);
    // idObj sits at byte offset 6 of a Note record's own data (row u16, column u16, flags u16, idObj u16).
    const idObjs = notes.map((r) => r.data[6]);

    expect(idObjs).toStrictEqual([1, 2]);
  });

  it("refuses more comments than a 16-bit FtCmo.id can distinguish", () => {
    const cells = Array.from({ length: 0x10000 }, (_, index) =>
      commentedCell(0, index, "x"),
    );

    expect(() => writeSheetComments(cells)).toThrow(BiffWriteError);
    expect(() => writeSheetComments(cells)).toThrow(/65535/);
  });

  it("accepts exactly as many comments as a 16-bit FtCmo.id can distinguish, not one fewer", () => {
    // 0xffff (65535) is the largest object id FtCmo.id's own 16-bit field can hold, so a sheet with exactly that many comments is still writable -- only one more should be refused.
    const cells = Array.from({ length: 0xffff }, (_, index) =>
      commentedCell(0, index, "x"),
    );

    expect(() => writeSheetComments(cells)).not.toThrow();
  });

  it("gives each comment's own FtNts a genuinely random GUID, not a fixed all-zero one", () => {
    const pieces = writeSheetComments([
      commentedCell(0, 0, "a"),
      commentedCell(0, 1, "b"),
    ]);
    const objRecords = readRecords(concat(...pieces)).filter(
      (r) => r.type === RECORD_OBJ,
    );
    // FtNts's own 16-byte GUID sits right after FtCmo (22 bytes) plus FtNts's own ft/cb header (4 bytes), at byte offset 26 of the Obj record's data.
    const guidOf = (data: Uint8Array<ArrayBuffer>) => data.slice(26, 42);
    const firstGuid = objRecords[0] ? guidOf(objRecords[0].data) : undefined;
    const secondGuid = objRecords[1] ? guidOf(objRecords[1].data) : undefined;

    expect(firstGuid).not.toStrictEqual(new Uint8Array(16));
    expect(secondGuid).not.toStrictEqual(new Uint8Array(16));
    expect(firstGuid).not.toStrictEqual(secondGuid);
  });

  it("writes a nonzero cbRuns for non-empty text and zero cbRuns for empty text", () => {
    // cbRuns sits at byte offset 12 of a TxO record's own data (grbit u16, rot u16, reserved4 u16, reserved5 u32, cchText u16, cbRuns u16).
    const nonEmpty = readRecords(
      concat(...writeSheetComments([commentedCell(0, 0, "hi")])),
    ).find((r) => r.type === RECORD_TXO);
    if (nonEmpty === undefined) throw new Error("expected a TXO record");
    expect(nonEmpty.data[12]).toBe(16);

    const empty = readRecords(
      concat(...writeSheetComments([commentedCell(0, 0, "")])),
    ).find((r) => r.type === RECORD_TXO);
    if (empty === undefined) throw new Error("expected a TXO record");
    expect(empty.data[12]).toBe(0);
  });
});
