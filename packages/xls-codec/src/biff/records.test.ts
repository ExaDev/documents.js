import { describe, expect, it } from "vitest";

import {
  MAX_RECORD_DATA_SIZE,
  RECORD_BOF,
  RECORD_CONTINUE,
  RECORD_EOF,
  RECORD_SST,
} from "./record-types";
import { BiffFormatError, readRecords } from "./records";

// Byte sequences here are hand-built from [MS-XLS] 2.1.4's own three-component framing -- a two-byte little-endian record type, a two-byte little-endian record size, then exactly that many bytes of record data (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/170e90ce-87d7-4758-9331-dcf14cd72388) -- rather than captured from a real file, so a test failure points at this package's reading of the spec rather than at some producer's quirk.

function record(type: number, data: readonly number[]): number[] {
  return [
    type & 0xff,
    (type >> 8) & 0xff,
    data.length & 0xff,
    (data.length >> 8) & 0xff,
    ...data,
  ];
}

function bytes(...values: readonly number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

describe("readRecords", () => {
  it("reads a record's type and data from the framing", () => {
    const stream = bytes(...record(RECORD_BOF, [0x00, 0x06, 0x05, 0x00]));

    expect(readRecords(stream)).toEqual([
      { type: RECORD_BOF, data: bytes(0x00, 0x06, 0x05, 0x00), offset: 0 },
    ]);
  });

  it("reads consecutive records in stream order", () => {
    const stream = bytes(
      ...record(RECORD_BOF, [0x00, 0x06]),
      ...record(RECORD_EOF, []),
    );

    expect(readRecords(stream).map((entry) => entry.type)).toEqual([
      RECORD_BOF,
      RECORD_EOF,
    ]);
  });

  it("reads a zero-length record, which the framing explicitly permits", () => {
    // [MS-XLS] 2.1.4: "The record size MUST be greater than or equal to 0". EOF is exactly this case in every real file.
    expect(readRecords(bytes(...record(RECORD_EOF, [])))).toEqual([
      { type: RECORD_EOF, data: bytes(), offset: 0 },
    ]);
  });

  it("reports each record's own start offset in the stream", () => {
    // BoundSheet8's lbPlyPos addresses a sheet's substream by the byte offset of its BOF, so a reader has to know where each record began.
    const stream = bytes(
      ...record(RECORD_BOF, [0x00, 0x06]),
      ...record(RECORD_EOF, []),
    );

    expect(readRecords(stream).map((entry) => entry.offset)).toEqual([0, 6]);
  });

  it("keeps a Continue record as its own entry rather than merging it", () => {
    // Merging is not a property of the framing: whether a Continue's bytes simply append, or re-state a leading flag byte first, is decided by the record being continued (compare SST in [MS-XLS] 2.5.293). So this layer reports the records as written and leaves the decision to each record's own reader.
    const stream = bytes(
      ...record(RECORD_SST, [0x01]),
      ...record(RECORD_CONTINUE, [0x02]),
    );

    expect(readRecords(stream)).toEqual([
      { type: RECORD_SST, data: bytes(0x01), offset: 0 },
      { type: RECORD_CONTINUE, data: bytes(0x02), offset: 5 },
    ]);
  });

  it("stops cleanly at the end of the stream", () => {
    expect(readRecords(bytes())).toEqual([]);
  });

  it("rejects a truncated record header", () => {
    // Three bytes cannot carry a four-byte header, so the size field is unreadable. Failing loudly beats reporting a record whose length was guessed.
    expect(() => readRecords(bytes(0x09, 0x08, 0x04))).toThrow(BiffFormatError);
  });

  it("rejects a record whose declared size runs past the end of the stream", () => {
    const stream = bytes(0x09, 0x08, 0x10, 0x00, 0x01, 0x02);

    expect(() => readRecords(stream)).toThrow(BiffFormatError);
  });

  it("rejects a record declaring more data than the framing permits", () => {
    // [MS-XLS] 2.1.4 caps record data at 8224 bytes; a larger declared size means the stream is not BIFF, and reading on would walk the rest of it out of alignment.
    const size = MAX_RECORD_DATA_SIZE + 1;
    const stream = new Uint8Array(4 + size);
    const view = new DataView(stream.buffer);
    view.setUint16(0, RECORD_BOF, true);
    view.setUint16(2, size, true);

    expect(() => readRecords(stream)).toThrow(BiffFormatError);
  });
});
