import { describe, expect, it } from "vitest";
import { ByteWriter, concatBytes } from "./writer";

describe("ByteWriter", () => {
  it("reports a zero length and an empty buffer before anything is written", () => {
    const writer = new ByteWriter();
    expect(writer.length).toBe(0);
    expect(Array.from(writer.toBytes())).toEqual([]);
  });

  it("accumulates each write's length into the running total", () => {
    const writer = new ByteWriter();
    writer.writeBytes(new Uint8Array([1, 2, 3]));
    expect(writer.length).toBe(3);
    writer.writeBytes(new Uint8Array([4, 5]));
    expect(writer.length).toBe(5);
  });

  it("concatenates chunks in write order, at the correct offsets", () => {
    const writer = new ByteWriter();
    writer.writeBytes(new Uint8Array([1, 2, 3]));
    writer.writeBytes(new Uint8Array([4]));
    writer.writeBytes(new Uint8Array([5, 6]));
    expect(Array.from(writer.toBytes())).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("leaves the accumulated length and output unchanged when an empty chunk is written", () => {
    const writer = new ByteWriter();
    writer.writeBytes(new Uint8Array([7, 8]));
    writer.writeBytes(new Uint8Array(0));
    writer.writeBytes(new Uint8Array([9]));
    expect(writer.length).toBe(3);
    expect(Array.from(writer.toBytes())).toEqual([7, 8, 9]);
  });

  it("writes a single byte as one one-byte chunk", () => {
    const writer = new ByteWriter();
    writer.writeByte(0x41);
    writer.writeByte(0xff);
    expect(writer.length).toBe(2);
    expect(Array.from(writer.toBytes())).toEqual([0x41, 0xff]);
  });

  it("encodes ASCII text as its UTF-8 bytes", () => {
    const writer = new ByteWriter();
    writer.writeAscii("IHDR");
    expect(Array.from(writer.toBytes())).toEqual([0x49, 0x48, 0x44, 0x52]);
  });

  it("encodes non-ASCII text as multi-byte UTF-8 rather than truncating to one byte per character", () => {
    const writer = new ByteWriter();
    writer.writeAscii("é");
    expect(Array.from(writer.toBytes())).toEqual([0xc3, 0xa9]);
    expect(writer.length).toBe(2);
  });

  it("appends an empty string without changing the output", () => {
    const writer = new ByteWriter();
    writer.writeAscii("ab");
    writer.writeAscii("");
    expect(Array.from(writer.toBytes())).toEqual([0x61, 0x62]);
  });

  it("produces an independent copy each time, so mutating the result never affects a later toBytes()", () => {
    const writer = new ByteWriter();
    writer.writeBytes(new Uint8Array([1, 2]));
    const first = writer.toBytes();
    first[0] = 99;
    expect(Array.from(writer.toBytes())).toEqual([1, 2]);
  });

  it("keeps accepting writes after toBytes() has been called", () => {
    const writer = new ByteWriter();
    writer.writeBytes(new Uint8Array([1]));
    expect(Array.from(writer.toBytes())).toEqual([1]);
    writer.writeBytes(new Uint8Array([2]));
    expect(Array.from(writer.toBytes())).toEqual([1, 2]);
  });
});

describe("concatBytes", () => {
  it("joins chunks in order", () => {
    expect(
      Array.from(
        concatBytes([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]),
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns an empty array for no chunks at all", () => {
    expect(Array.from(concatBytes([]))).toEqual([]);
  });

  it("skips over empty chunks without disturbing the surrounding offsets", () => {
    expect(
      Array.from(
        concatBytes([
          new Uint8Array(0),
          new Uint8Array([1]),
          new Uint8Array(0),
          new Uint8Array([2, 3]),
        ]),
      ),
    ).toEqual([1, 2, 3]);
  });
});
