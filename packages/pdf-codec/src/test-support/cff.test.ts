import { describe, expect, it } from "vitest";
import { buildSfnt } from "./sfnt";
import { cffIndex, cffTableFromSfnt } from "./cff";

// cffIndex's own offSize selection (CFF spec Table 2): the smallest of 1/2/3/4 bytes that holds the INDEX's final cumulative offset. A single entry of length N gives a final offset of exactly 1 + N (the INDEX's offsets are 1-based), so choosing N pins the exact boundary between two offSize widths without needing a real font-sized fixture.
function indexWithOneEntryOfLength(length: number): readonly number[] {
  return cffIndex([new Array<number>(length).fill(0)]);
}

describe("cffIndex offSize selection", () => {
  it("stays at offSize 1 for a final offset of exactly 0xff", () => {
    const result = indexWithOneEntryOfLength(0xff - 1);
    expect(result[2]).toBe(1);
  });

  it("steps up to offSize 2 the moment the final offset exceeds 0xff", () => {
    const result = indexWithOneEntryOfLength(0xff);
    expect(result[2]).toBe(2);
  });

  it("stays at offSize 2 for a final offset of exactly 0xffff", () => {
    const result = indexWithOneEntryOfLength(0xffff - 1);
    expect(result[2]).toBe(2);
  });

  it("steps up to offSize 3 the moment the final offset exceeds 0xffff", () => {
    const result = indexWithOneEntryOfLength(0xffff);
    expect(result[2]).toBe(3);
  });

  it("stays at offSize 3 for a final offset of exactly 0xffffff", () => {
    const result = indexWithOneEntryOfLength(0xffffff - 1);
    expect(result[2]).toBe(3);
  });

  it("steps up to offSize 4 the moment the final offset exceeds 0xffffff", () => {
    const result = indexWithOneEntryOfLength(0xffffff);
    expect(result[2]).toBe(4);
  });

  it("returns the fixed 2-byte {count: 0} form for an empty INDEX", () => {
    expect(cffIndex([])).toEqual([0, 0]);
  });
});

describe("cffTableFromSfnt", () => {
  it("throws naming the source when the bytes given don't parse as an sfnt container at all", () => {
    expect(() =>
      cffTableFromSfnt(new Uint8Array([1, 2, 3, 4]), "a made-up test font"),
    ).toThrow("a made-up test font failed to parse as an sfnt container");
  });

  it("throws naming the source when the sfnt parses but carries no 'CFF ' table", () => {
    const sfnt = buildSfnt(new Map([["head", new Uint8Array(4)]]));
    expect(() => cffTableFromSfnt(sfnt, "a made-up test font")).toThrow(
      "a made-up test font has no CFF table",
    );
  });

  it("returns the real table bytes when the sfnt does carry a 'CFF ' table", () => {
    const cffBytes = new Uint8Array([9, 9, 9]);
    const sfnt = buildSfnt(new Map([["CFF ", cffBytes]]));
    expect(cffTableFromSfnt(sfnt, "a made-up test font")).toEqual(cffBytes);
  });
});
