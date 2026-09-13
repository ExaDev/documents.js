import { describe, expect, it } from "vitest";
import { ByteReader, isAsciiWhitespace } from "./reader";

describe("isAsciiWhitespace", () => {
  it.each([
    ["NUL", 0x00],
    ["horizontal tab", 0x09],
    ["line feed", 0x0a],
    ["form feed", 0x0c],
    ["carriage return", 0x0d],
    ["space", 0x20],
  ])("treats %s as whitespace", (_label, byte) => {
    expect(isAsciiWhitespace(byte)).toBe(true);
  });

  it.each([
    ["vertical tab, which PDF does not count as whitespace", 0x0b],
    ["'A'", 0x41],
    ["'0'", 0x30],
    ["a byte just past space", 0x21],
    ["a high byte", 0xff],
  ])("does not treat %s as whitespace", (_label, byte) => {
    expect(isAsciiWhitespace(byte)).toBe(false);
  });

  it("treats an absent byte (past the end of a buffer) as not whitespace", () => {
    expect(isAsciiWhitespace(undefined)).toBe(false);
  });
});

describe("ByteReader position and bounds", () => {
  it("starts at offset zero and reports the buffer's length", () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3]));
    expect(reader.offset).toBe(0);
    expect(reader.length).toBe(3);
  });

  it("is not at the end while any byte remains", () => {
    const reader = new ByteReader(new Uint8Array([1, 2]));
    expect(reader.atEnd()).toBe(false);
    reader.next();
    expect(reader.atEnd()).toBe(false);
  });

  it("is at the end exactly once the position reaches the buffer length", () => {
    const reader = new ByteReader(new Uint8Array([1, 2]));
    reader.seek(2);
    expect(reader.atEnd()).toBe(true);
  });

  it("is at the end when the position has been seeked past the buffer length", () => {
    const reader = new ByteReader(new Uint8Array([1, 2]));
    reader.seek(5);
    expect(reader.atEnd()).toBe(true);
  });

  it("is immediately at the end for an empty buffer", () => {
    expect(new ByteReader(new Uint8Array(0)).atEnd()).toBe(true);
  });
});

describe("ByteReader.peek", () => {
  it("returns the byte at the current position without advancing", () => {
    const reader = new ByteReader(new Uint8Array([10, 20, 30]));
    expect(reader.peek()).toBe(10);
    expect(reader.offset).toBe(0);
    expect(reader.peek()).toBe(10);
  });

  it("looks ahead by a positive offset rather than behind", () => {
    const reader = new ByteReader(new Uint8Array([10, 20, 30]));
    reader.seek(1);
    expect(reader.peek(1)).toBe(30);
    expect(reader.peek(0)).toBe(20);
  });

  it("returns undefined past the end of the buffer", () => {
    const reader = new ByteReader(new Uint8Array([10]));
    expect(reader.peek(1)).toBeUndefined();
  });
});

describe("ByteReader.next", () => {
  it("returns each byte in turn and advances one position per call", () => {
    const reader = new ByteReader(new Uint8Array([10, 20]));
    expect(reader.next()).toBe(10);
    expect(reader.offset).toBe(1);
    expect(reader.next()).toBe(20);
    expect(reader.offset).toBe(2);
  });

  it("returns undefined at the end without advancing the position any further", () => {
    const reader = new ByteReader(new Uint8Array([10]));
    reader.next();
    expect(reader.next()).toBeUndefined();
    expect(reader.offset).toBe(1);
    expect(reader.next()).toBeUndefined();
    expect(reader.offset).toBe(1);
  });

  it("returns a zero byte and still advances, since zero is a real byte and not an absent one", () => {
    const reader = new ByteReader(new Uint8Array([0, 7]));
    expect(reader.next()).toBe(0);
    expect(reader.offset).toBe(1);
    expect(reader.next()).toBe(7);
  });
});

describe("ByteReader mark, reset and seek", () => {
  it("marks the current position without moving it, and rewinds to it later", () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3, 4]));
    reader.next();
    const mark = reader.mark();
    expect(mark).toBe(1);
    expect(reader.offset).toBe(1);
    reader.next();
    reader.next();
    expect(reader.offset).toBe(3);
    reader.reset(mark);
    expect(reader.offset).toBe(1);
    expect(reader.next()).toBe(2);
  });

  it("seeks to an absolute offset, both forwards and backwards", () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3, 4]));
    reader.seek(3);
    expect(reader.next()).toBe(4);
    reader.seek(0);
    expect(reader.next()).toBe(1);
  });
});

describe("ByteReader.slice", () => {
  it("returns the half-open range [start, end), independent of the cursor position", () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3, 4, 5]));
    reader.seek(4);
    expect(Array.from(reader.slice(1, 3))).toEqual([2, 3]);
    expect(reader.offset).toBe(4);
  });

  it("returns an empty range when start equals end", () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3]));
    expect(Array.from(reader.slice(2, 2))).toEqual([]);
  });

  it("returns a view onto the same buffer rather than a copy", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const view = new ByteReader(bytes).slice(0, 2);
    bytes[0] = 9;
    expect(Array.from(view)).toEqual([9, 2]);
  });
});

describe("ByteReader.skipWhitespace", () => {
  it("advances past every leading whitespace byte and stops on the first non-whitespace one", () => {
    const reader = new ByteReader(
      new Uint8Array([0x20, 0x0a, 0x09, 0x41, 0x20]),
    );
    reader.skipWhitespace();
    expect(reader.offset).toBe(3);
    expect(reader.peek()).toBe(0x41);
  });

  it("leaves the position alone when the current byte is not whitespace", () => {
    const reader = new ByteReader(new Uint8Array([0x41, 0x20]));
    reader.skipWhitespace();
    expect(reader.offset).toBe(0);
  });

  it("stops at the end of the buffer rather than running past it", () => {
    const reader = new ByteReader(new Uint8Array([0x20, 0x20]));
    reader.skipWhitespace();
    expect(reader.offset).toBe(2);
    expect(reader.atEnd()).toBe(true);
  });
});

describe("ByteReader.matchKeyword", () => {
  it("consumes a matching keyword and advances exactly its length", () => {
    const reader = new ByteReader(new TextEncoder().encode("obj 42"));
    expect(reader.matchKeyword("obj")).toBe(true);
    expect(reader.offset).toBe(3);
    expect(reader.peek()).toBe(0x20);
  });

  it("matches at a non-zero starting position", () => {
    const reader = new ByteReader(new TextEncoder().encode("12 obj"));
    reader.seek(3);
    expect(reader.matchKeyword("obj")).toBe(true);
    expect(reader.offset).toBe(6);
  });

  it("leaves the position untouched when the very first byte differs", () => {
    const reader = new ByteReader(new TextEncoder().encode("Rbj"));
    expect(reader.matchKeyword("obj")).toBe(false);
    expect(reader.offset).toBe(0);
  });

  it("leaves the position untouched when only a later byte differs", () => {
    const reader = new ByteReader(new TextEncoder().encode("obX"));
    expect(reader.matchKeyword("obj")).toBe(false);
    expect(reader.offset).toBe(0);
  });

  it("does not match a keyword the buffer is too short to hold, even when what remains is a prefix of it", () => {
    const reader = new ByteReader(new TextEncoder().encode("ob"));
    expect(reader.matchKeyword("obj")).toBe(false);
    expect(reader.offset).toBe(0);
  });

  it("matches a keyword that ends exactly at the end of the buffer", () => {
    const reader = new ByteReader(new TextEncoder().encode("obj"));
    expect(reader.matchKeyword("obj")).toBe(true);
    expect(reader.offset).toBe(3);
    expect(reader.atEnd()).toBe(true);
  });

  it("matches an empty keyword without moving, since every position trivially starts with it", () => {
    const reader = new ByteReader(new TextEncoder().encode("obj"));
    expect(reader.matchKeyword("")).toBe(true);
    expect(reader.offset).toBe(0);
  });
});
