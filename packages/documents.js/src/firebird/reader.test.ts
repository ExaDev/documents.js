import { describe, expect, it } from "vitest";
import { FirebirdBackupReader, XdrReader } from "./reader";

// Isolated, synthetic-byte-sequence tests for the two primitive readers -- FirebirdBackupReader's attribute framing and XdrReader's per-type XDR decoding -- independent of the real-fixture end-to-end proof in backup.test.ts. Byte sequences here are hand-constructed against the documented wire shapes (this module's own top-of-file note), not lifted from a real file, since the point is to pin down each primitive's own isolated behaviour (including edge cases a real fixture may not happen to exercise, like RLE runs and int16 truncation).

describe("FirebirdBackupReader: attribute framing", () => {
  it("reads a tag, a length-prefixed int32 attribute (little-endian), and detects end-of-stream", () => {
    // tag=5, len=4, value=300 (little-endian: 0x2C 0x01 0x00 0x00)
    const reader = new FirebirdBackupReader(
      new Uint8Array([5, 4, 0x2c, 0x01, 0x00, 0x00]),
    );
    expect(reader.readTag()).toBe(5);
    expect(reader.readInt32Attribute()).toBe(300);
    expect(reader.atEnd()).toBe(true);
  });

  it("reads a negative int32 value correctly", () => {
    // -1 as little-endian 4 bytes: 0xFF 0xFF 0xFF 0xFF
    const reader = new FirebirdBackupReader(
      new Uint8Array([9, 4, 0xff, 0xff, 0xff, 0xff]),
    );
    reader.readTag();
    expect(reader.readInt32Attribute()).toBe(-1);
  });

  it("reads a length-prefixed text attribute", () => {
    const text = "CUSTOMERS";
    const bytes = new TextEncoder().encode(text);
    const reader = new FirebirdBackupReader(
      new Uint8Array([1, bytes.length, ...bytes]),
    );
    reader.readTag();
    expect(reader.readTextAttribute()).toBe(text);
  });

  it("skipFlatRecordAttributes consumes every attribute up to and including att_end, discarding values", () => {
    const bytes = new TextEncoder().encode("X");
    const reader = new FirebirdBackupReader(
      new Uint8Array([
        1,
        bytes.length,
        ...bytes, // one text attribute
        2,
        4,
        1,
        0,
        0,
        0, // one int32 attribute
        0, // att_end
        7, // the next record's own tag, proving the cursor stopped exactly at att_end
      ]),
    );
    reader.skipFlatRecordAttributes();
    expect(reader.readTag()).toBe(7);
  });

  it("readBlobSegmentLength reads a 2-byte little-endian length with no length-of-length prefix", () => {
    const reader = new FirebirdBackupReader(new Uint8Array([0x34, 0x12]));
    expect(reader.readBlobSegmentLength()).toBe(0x1234);
  });

  it("readCompressedPayload decodes a literal run (positive control byte)", () => {
    // control=3 (copy 3 literal bytes), then the 3 bytes
    const reader = new FirebirdBackupReader(
      new Uint8Array([3, 0x41, 0x42, 0x43]),
    );
    expect(Array.from(reader.readCompressedPayload(3))).toEqual([
      0x41, 0x42, 0x43,
    ]);
  });

  it("readCompressedPayload decodes a repeat run (negative control byte)", () => {
    // control=-4 (as a signed byte: 0xFC), then one fill byte repeated 4 times
    const reader = new FirebirdBackupReader(new Uint8Array([0xfc, 0x5a]));
    expect(Array.from(reader.readCompressedPayload(4))).toEqual([
      0x5a, 0x5a, 0x5a, 0x5a,
    ]);
  });

  it("readCompressedPayload decodes a mix of literal and repeat runs across multiple control bytes", () => {
    // literal run of 2 (0x01,0x02), then repeat run of 3x 0x09
    const reader = new FirebirdBackupReader(
      new Uint8Array([2, 0x01, 0x02, 0xfd, 0x09]),
    );
    expect(Array.from(reader.readCompressedPayload(5))).toEqual([
      0x01, 0x02, 0x09, 0x09, 0x09,
    ]);
  });
});

describe("XdrReader: per-type big-endian decoding", () => {
  it("readInt32 decodes a big-endian signed 32-bit value", () => {
    const xdr = new XdrReader(new Uint8Array([0x00, 0x00, 0x01, 0x2c])); // 300
    expect(xdr.readInt32()).toBe(300);
  });

  it("readInt32 decodes a negative value", () => {
    const xdr = new XdrReader(new Uint8Array([0xff, 0xff, 0xff, 0xff])); // -1
    expect(xdr.readInt32()).toBe(-1);
  });

  it("readInt16 truncates a 4-byte XDR long to a signed 16-bit value (Firebird has no native 16-bit XDR type)", () => {
    // 4-byte value 0x00000000_0064 (100) widened -- still just 4 bytes on the wire.
    const xdr = new XdrReader(new Uint8Array([0x00, 0x00, 0x00, 0x64]));
    expect(xdr.readInt16()).toBe(100);
  });

  it("readInt16 preserves sign when truncating a negative 4-byte value", () => {
    const xdr = new XdrReader(new Uint8Array([0xff, 0xff, 0xff, 0xff])); // -1
    expect(xdr.readInt16()).toBe(-1);
  });

  it("readInt64 decodes a big-endian signed 64-bit value from two 32-bit words, high word first", () => {
    // 0x0000000100000000 = 4294967296n
    const xdr = new XdrReader(
      new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]),
    );
    expect(xdr.readInt64()).toBe(4294967296n);
  });

  it("readInt64 decodes a negative 64-bit value correctly", () => {
    // -1 as 64-bit: all bits set
    const xdr = new XdrReader(
      new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    );
    expect(xdr.readInt64()).toBe(-1n);
  });

  it("readDouble decodes a big-endian IEEE-754 double", () => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, 75000.5, false);
    const xdr = new XdrReader(new Uint8Array(buffer));
    expect(xdr.readDouble()).toBe(75000.5);
  });

  it("readOpaque reads len bytes then pads to the next 4-byte boundary", () => {
    // 3 data bytes + 1 padding byte = 4 total
    const xdr = new XdrReader(new Uint8Array([0x41, 0x42, 0x43, 0x00, 0x99]));
    expect(Array.from(xdr.readOpaque(3))).toEqual([0x41, 0x42, 0x43]);
    // Cursor should now be at the 5th byte (0x99), having consumed the 1 padding byte.
    expect(xdr.offset).toBe(4);
  });

  it("readOpaque with a length already a multiple of 4 adds no padding", () => {
    const xdr = new XdrReader(new Uint8Array([0x41, 0x42, 0x43, 0x44, 0x99]));
    expect(Array.from(xdr.readOpaque(4))).toEqual([0x41, 0x42, 0x43, 0x44]);
    expect(xdr.offset).toBe(4);
  });
});
