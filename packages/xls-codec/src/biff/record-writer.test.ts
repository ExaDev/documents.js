import { describe, expect, it } from "vitest";

import { MAX_RECORD_DATA_SIZE, RECORD_BOF, RECORD_EOF } from "./record-types";
import { readRecords } from "./records";
import { concatRecords, writeRecord } from "./record-writer";
import { BiffWriteError } from "./write-errors";

describe("writeRecord", () => {
  it("frames a record so this package's own reader reads its type and data back", () => {
    const data = new Uint8Array([0x00, 0x06, 0x05, 0x00]);
    const framed = writeRecord(RECORD_BOF, data);

    expect(readRecords(framed)).toEqual([
      { type: RECORD_BOF, data, offset: 0 },
    ]);
  });

  it("frames a zero-length record", () => {
    const framed = writeRecord(RECORD_EOF, new Uint8Array(0));

    expect(readRecords(framed)).toEqual([
      { type: RECORD_EOF, data: new Uint8Array(0), offset: 0 },
    ]);
  });

  it("writes the header as a little-endian type then a little-endian size", () => {
    const framed = writeRecord(0x0809, new Uint8Array(3));
    expect(Array.from(framed.slice(0, 4))).toEqual([0x09, 0x08, 0x03, 0x00]);
  });

  it("accepts data exactly at the maximum record size", () => {
    const data = new Uint8Array(MAX_RECORD_DATA_SIZE);
    expect(() => writeRecord(RECORD_BOF, data)).not.toThrow();
  });

  it("refuses data past the maximum single-record size rather than splitting it", () => {
    const data = new Uint8Array(MAX_RECORD_DATA_SIZE + 1);
    expect(() => writeRecord(RECORD_BOF, data)).toThrow(BiffWriteError);
  });
});

describe("concatRecords", () => {
  it("concatenates already-framed records so this package's own reader reads both back in order", () => {
    const first = writeRecord(RECORD_BOF, new Uint8Array([1, 2]));
    const second = writeRecord(RECORD_EOF, new Uint8Array(0));

    const stream = concatRecords(first, second);

    expect(readRecords(stream)).toEqual([
      { type: RECORD_BOF, data: new Uint8Array([1, 2]), offset: 0 },
      { type: RECORD_EOF, data: new Uint8Array(0), offset: 6 },
    ]);
  });

  it("concatenates zero parts into an empty stream", () => {
    expect(concatRecords().length).toBe(0);
  });
});
