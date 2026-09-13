import { describe, expect, it } from "vitest";

import { BiffFormatError, readRecords } from "../biff/records";
import { groupRecords, type RecordGroup } from "../biff/substreams";
import { RECORD_OBJ, RECORD_TXO } from "../biff/record-types";
import {
  concat,
  ftCmo,
  noteObjRecord,
  noteRecord,
  noteTxoRecords,
  otherObjRecord,
  record,
  u16,
  u32,
} from "../test-support/biff";
import { readObjPictFmlaStorageId, readSheetComments } from "./comments";

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
    expect(comments.get("2:3")).toStrictEqual({
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
    expect(comments.get("0:0")).toStrictEqual({
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
    expect(comments.get("5:5")).toStrictEqual({
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
    expect(comments.get("0:0")).toStrictEqual({
      row: 0,
      column: 0,
      comment: { text: "First comment", author: "Alice" },
    });
    expect(comments.get("4:4")).toStrictEqual({
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

  it("throws rather than silently absorbing a TxO whose own cbFmla overruns the record data", () => {
    // cchText 0 so the function returns right after skipping cbFmla -- isolating that one skip from cbRuns' own, tested separately below. cbFmla names 50 bytes to skip but none follow.
    const txoData = [
      ...u16(0), // grbit
      ...u16(0), // rot
      ...new Array<number>(6).fill(0), // reserved4 + reserved5
      ...u16(0), // cchText
      ...u16(0), // cbRuns
      ...u16(0), // ifntEmpty
      ...u16(50), // cbFmla -- claims 50 bytes that are never written
    ];
    expect(() =>
      readComments(noteObjRecord(1), record(RECORD_TXO, txoData)),
    ).toThrow(BiffFormatError);
  });

  it("throws rather than silently absorbing a TxO whose own cbRuns overruns the record data", () => {
    const text = "hi";
    const txoData = [
      ...u16(0), // grbit
      ...u16(0), // rot
      ...new Array<number>(6).fill(0), // reserved4 + reserved5
      ...u16(text.length), // cchText
      ...u16(50), // cbRuns -- claims 50 bytes that are never written
      ...u16(0), // ifntEmpty
      ...u16(0), // cbFmla
      0x00, // XLUnicodeStringNoCch's own flags byte -- compressed (fHighByte clear)
      ...Array.from(text, (char) => char.codePointAt(0) ?? 0),
    ];
    expect(() =>
      readComments(noteObjRecord(1), record(RECORD_TXO, txoData)),
    ).toThrow(BiffFormatError);
  });
});

describe("readObjPictFmlaStorageId", () => {
  function objGroup(...ftRecords: readonly number[][]): RecordGroup {
    const bytes = record(RECORD_OBJ, [
      ...ftCmo(0x0008, 1),
      ...ftRecords.flat(),
    ]);
    const group = groupRecords(readRecords(bytes))[0];
    if (group === undefined) throw new Error("expected an Obj record group");
    return group;
  }

  /** A minimal FtPictFmla sub-record naming `storageId`, with `cbFmla` bytes of arbitrary formula payload before it (0 unless the test needs to prove that payload is actually skipped). */
  function ftPictFmla(
    storageId: number,
    fmlaBytes: readonly number[] = [],
  ): number[] {
    const data = [...u16(fmlaBytes.length), ...fmlaBytes, ...u32(storageId)];
    return [...u16(0x0009), ...u16(data.length), ...data];
  }

  it("finds FtPictFmla's own storage id, walking past FtCmo and an unrelated sub-record first", () => {
    const unrelated = [...u16(0x1234), ...u16(4), 0xaa, 0xaa, 0xaa, 0xaa];
    const group = objGroup(unrelated, ftPictFmla(42));

    expect(readObjPictFmlaStorageId(group)).toBe(42);
  });

  it("skips a nonzero cbFmla's own formula bytes before reading the storage id that follows", () => {
    const group = objGroup(ftPictFmla(42, [1, 2, 3, 4]));

    expect(readObjPictFmlaStorageId(group)).toBe(42);
  });

  it("stops at the reserved trailing zero ft marker rather than reading past it as a sub-record", () => {
    // A zero ft, cb 0, then a fully well-formed FtPictFmla right after: a reader that treated the zero as a genuine sub-record (walking past it via its own cb) would reach this real FtPictFmla and wrongly return its storage id, instead of stopping at the marker.
    const reservedThenPictFmla = [...u16(0), ...u16(0), ...ftPictFmla(42)];
    const group = objGroup(reservedThenPictFmla);

    expect(readObjPictFmlaStorageId(group)).toBeUndefined();
  });

  it("returns undefined for an Obj record carrying no FtPictFmla at all", () => {
    const group = objGroup();

    expect(readObjPictFmlaStorageId(group)).toBeUndefined();
  });
});
