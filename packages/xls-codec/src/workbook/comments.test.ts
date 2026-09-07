import { describe, expect, it } from "vitest";

import { readRecords } from "../biff/records";
import { groupRecords } from "../biff/substreams";
import {
  concat,
  noteObjRecord,
  noteRecord,
  noteTxoRecords,
  otherObjRecord,
  record,
} from "../test-support/biff";
import { readSheetComments } from "./comments";

function readComments(...records: readonly Uint8Array<ArrayBuffer>[]) {
  return readSheetComments(groupRecords(readRecords(concat(...records))));
}

describe("readSheetComments", () => {
  it("joins a Note's anchor to its Obj+TxO pair's text via idObj -> cmo.id", () => {
    const comments = readComments(
      noteObjRecord(1),
      ...noteTxoRecords("Hello there"),
      noteRecord(2, 3, 1, "Alice"),
    );
    expect(comments.get("2:3")).toEqual({
      row: 2,
      column: 3,
      comment: { text: "Hello there", author: "Alice" },
    });
  });

  it("reads a comment with no author as text alone, never a fabricated empty-string author", () => {
    const comments = readComments(
      noteObjRecord(1),
      ...noteTxoRecords("No author here"),
      noteRecord(0, 0, 1),
    );
    expect(comments.get("0:0")).toEqual({
      row: 0,
      column: 0,
      comment: { text: "No author here" },
    });
  });

  it("resolves a Note record that appears BEFORE its own Obj+TxO pair in the stream, not just after", () => {
    const comments = readComments(
      noteRecord(5, 5, 7, "Bob"),
      noteObjRecord(7),
      ...noteTxoRecords("Written first, read last"),
    );
    expect(comments.get("5:5")).toEqual({
      row: 5,
      column: 5,
      comment: { text: "Written first, read last", author: "Bob" },
    });
  });

  it("never associates a TxO following a non-Note Obj record with any comment", () => {
    // ot 0x06 is Text -- an ordinary text box, not a comment. Its own TxO must not poison textByObjId under id 9, and no Note names id 9 anyway.
    const comments = readComments(
      otherObjRecord(0x06, 9),
      ...noteTxoRecords("Just a text box"),
      noteRecord(1, 1, 9, "Carol"),
    );
    expect(comments.has("1:1")).toBe(false);
  });

  it("keeps two comments on the same worksheet distinct by their own idObj, never cross-wiring the second's text onto the first", () => {
    const comments = readComments(
      noteObjRecord(1),
      ...noteTxoRecords("First comment"),
      noteObjRecord(2),
      ...noteTxoRecords("Second comment"),
      noteRecord(0, 0, 1, "Alice"),
      noteRecord(4, 4, 2, "Bob"),
    );
    expect(comments.get("0:0")).toEqual({
      row: 0,
      column: 0,
      comment: { text: "First comment", author: "Alice" },
    });
    expect(comments.get("4:4")).toEqual({
      row: 4,
      column: 4,
      comment: { text: "Second comment", author: "Bob" },
    });
  });

  it("skips a Note record whose idObj resolves to no Obj+TxO pair at all, rather than materialising empty or fabricated text", () => {
    const comments = readComments(noteRecord(0, 0, 99, "Nobody"));
    expect(comments.size).toBe(0);
  });

  it("reads comment text long enough to span a Continue boundary mid-string", () => {
    const longText = "x".repeat(200) + "y".repeat(200);
    const comments = readComments(
      noteObjRecord(1),
      ...noteTxoRecords(longText),
      noteRecord(0, 0, 1),
    );
    expect(comments.get("0:0")?.comment.text).toBe(longText);
  });

  it("returns an empty map for a worksheet with no comment records at all", () => {
    const ROW_RECORD_TYPE = 0x0208; // [MS-XLS] 2.4.221 -- an unrelated record type, never a Note/Obj/TxO
    const comments = readComments(record(ROW_RECORD_TYPE, []));
    expect(comments.size).toBe(0);
  });
});
