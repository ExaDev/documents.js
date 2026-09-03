import { describe, expect, it } from "vitest";

import { BlockCursor } from "./cursor";
import { BiffFormatError } from "./records";

function bytes(...values: readonly number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

describe("BlockCursor", () => {
  it("reads little-endian integers in field order", () => {
    // [MS-XLS] 1.3.1 fixes the whole format as little-endian: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/bc969080-8cb9-4dfe-afc0-059dfc43cd56
    const cursor = new BlockCursor([
      bytes(0x01, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12),
    ]);

    expect(cursor.u8()).toBe(0x01);
    expect(cursor.u16()).toBe(0x1234);
    expect(cursor.u32()).toBe(0x12345678);
  });

  it("reads a signed 32-bit integer", () => {
    const cursor = new BlockCursor([bytes(0xff, 0xff, 0xff, 0xff)]);

    expect(cursor.i32()).toBe(-1);
  });

  it("reads an Xnum as an IEEE 754 double", () => {
    // [MS-XLS] 2.5.342: Xnum is a 64-bit binary floating-point number. 1.5 is 0x3FF8000000000000, little-endian on the wire.
    const cursor = new BlockCursor([
      bytes(0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f),
    ]);

    expect(cursor.f64()).toBe(1.5);
  });

  it("continues an integer read into the next block", () => {
    // A record's fields do not stop at a Continue boundary in the general case, so the cursor spans the blocks rather than treating each as its own buffer.
    const cursor = new BlockCursor([bytes(0x34), bytes(0x12)]);

    expect(cursor.u16()).toBe(0x1234);
  });

  it("reports how many bytes remain in the current block", () => {
    const cursor = new BlockCursor([bytes(0x01, 0x02), bytes(0x03)]);

    expect(cursor.remainingInBlock()).toBe(2);
    cursor.u8();
    expect(cursor.remainingInBlock()).toBe(1);
    cursor.u8();
    // Exhausting a block moves to the next one, so the count reported is the new block's.
    expect(cursor.remainingInBlock()).toBe(1);
  });

  it("reports whether any bytes remain at all", () => {
    const cursor = new BlockCursor([bytes(0x01)]);

    expect(cursor.hasMore()).toBe(true);
    cursor.u8();
    expect(cursor.hasMore()).toBe(false);
  });

  it("reads a run of raw bytes", () => {
    const cursor = new BlockCursor([bytes(0x01, 0x02, 0x03, 0x04)]);

    expect(cursor.take(3)).toEqual(bytes(0x01, 0x02, 0x03));
  });

  it("skips forward without returning the bytes", () => {
    const cursor = new BlockCursor([bytes(0x01, 0x02, 0x03)]);

    cursor.skip(2);
    expect(cursor.u8()).toBe(0x03);
  });

  it("skips across a block boundary", () => {
    const cursor = new BlockCursor([bytes(0x01, 0x02), bytes(0x03, 0x04)]);

    cursor.skip(3);
    expect(cursor.u8()).toBe(0x04);
  });

  it("rejects a read running past the end of the last block", () => {
    const cursor = new BlockCursor([bytes(0x01)]);

    expect(() => cursor.u16()).toThrow(BiffFormatError);
  });

  it("rejects a skip running past the end of the last block", () => {
    const cursor = new BlockCursor([bytes(0x01, 0x02)]);

    expect(() => {
      cursor.skip(3);
    }).toThrow(BiffFormatError);
  });

  it("treats a zero-length block as empty rather than as the end of the data", () => {
    // A Continue record is permitted to carry no data; skipping over it must not truncate the record it continues.
    const cursor = new BlockCursor([bytes(0x01), bytes(), bytes(0x02)]);

    expect(cursor.u8()).toBe(0x01);
    expect(cursor.u8()).toBe(0x02);
  });
});
