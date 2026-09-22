import { describe, expect, it } from "vitest";

import { BlockCursor } from "./cursor";

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

  it("reads a signed 16-bit integer", () => {
    const cursor = new BlockCursor([bytes(0xff, 0xff, 0x02, 0x00)]);

    expect(cursor.i16()).toBe(-1);
    expect(cursor.i16()).toBe(2);
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

    expect(cursor.take(3)).toStrictEqual(bytes(0x01, 0x02, 0x03));
  });

  it("reads a run of raw bytes spanning a block boundary", () => {
    const cursor = new BlockCursor([bytes(0x01, 0x02), bytes(0x03, 0x04)]);

    expect(cursor.take(3)).toStrictEqual(bytes(0x01, 0x02, 0x03));
  });

  it("rejects a length-prefixed take() before allocating, rather than after reading runs out", () => {
    // A length field taken straight from untrusted BIFF8 input (e.g. CFEx's own cbDxf, [MS-XLS] 2.4.64) can name up to 4 GiB from a record only a few real bytes long. take() must reject a count larger than the data actually remaining before it allocates, not merely fail partway through copying bytes — an allocate-then-fail sequence still pays the allocation cost the check exists to avoid. Asserting the up-front check's OWN wording, not just that some BiffFormatError was thrown, is what actually proves this: the later per-byte read inside the copy loop throws a BiffFormatError too, with different wording, so a generic class-only assertion cannot tell the two apart.
    const cursor = new BlockCursor([bytes(0x01, 0x02, 0x03)]);

    expect(() => cursor.take(0xffffffff)).toThrow(
      /requests more data than remains/,
    );
  });

  it("computes remaining bytes correctly when the cursor sits exactly on an exhausted block, not just at construction", () => {
    // A block exhausted by a prior read (offset === that block's own length) is a different unsettled moment than a freshly constructed cursor — remainingTotal() must still settle from here before totalling, or it would count the already-exhausted block's own length a second time on top of the real remaining block's.
    const cursor = new BlockCursor([
      bytes(0x01, 0x02),
      bytes(0x03, 0x04, 0x05),
    ]);
    cursor.u8();
    cursor.u8(); // exactly exhausts the first block, without yet triggering another settle()

    expect(() => cursor.take(4)).toThrow(/requests more data than remains/);
    expect(cursor.take(3)).toStrictEqual(bytes(0x03, 0x04, 0x05));
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

  it("rejects a u8 read running past the end of the last block, naming which field was being read", () => {
    const cursor = new BlockCursor([bytes()]);

    expect(() => cursor.u8()).toThrow(/^u8 runs past the end/);
  });

  it("rejects a u16 read running past the end of the last block on its very first byte, not just its second", () => {
    // An empty cursor, not a one-byte one: u16() calls nextByte("u16") twice, once for its low byte and once for its high, and a fixture with exactly one byte available only ever exercises the SECOND call's own failure — the first would have succeeded. Only a cursor with no bytes at all forces the first call itself to fail.
    const cursor = new BlockCursor([bytes()]);

    expect(() => cursor.u16()).toThrow(/^u16 runs past the end/);
  });

  it("rejects a u16 read that runs out after its low byte but before its high one", () => {
    const cursor = new BlockCursor([bytes(0x01)]);

    expect(() => cursor.u16()).toThrow(/^u16 runs past the end/);
  });

  it("rejects a skip running past the end of the last block, naming the byte count it was skipping", () => {
    const cursor = new BlockCursor([bytes(0x01, 0x02)]);

    expect(() => {
      cursor.skip(3);
    }).toThrow(/^3-byte skip runs past the end/);
  });

  it("reports the current block index, correctly settled even once every block is fully consumed", () => {
    const cursor = new BlockCursor([bytes(0x01)]);

    cursor.u8();

    // A cursor with no unread bytes anywhere still rests at a specific, well-defined block index — one past the single block just consumed, not two past it or further, however many times settle() re-runs afterwards.
    expect(cursor.blockPosition()).toBe(1);
    expect(cursor.blockPosition()).toBe(1);
  });

  it("treats a zero-length block as empty rather than as the end of the data", () => {
    // A Continue record is permitted to carry no data; skipping over it must not truncate the record it continues.
    const cursor = new BlockCursor([bytes(0x01), bytes(), bytes(0x02)]);

    expect(cursor.u8()).toBe(0x01);
    expect(cursor.u8()).toBe(0x02);
  });
});
