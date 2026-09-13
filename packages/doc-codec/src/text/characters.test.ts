import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { COMPRESSED_CHARACTER_MAP, readTextRange } from "./characters";
import { parseClx } from "./piece-table";

function pcdBytes(fc: number, compressed: boolean): number[] {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(2, (fc >>> 0) | (compressed ? 0x40000000 : 0), true);
  return Array.from(bytes);
}

function clx(cps: number[], pcds: number[][]): Uint8Array {
  const plc: number[] = [];
  for (const cp of cps) {
    plc.push(
      cp & 0xff,
      (cp >> 8) & 0xff,
      (cp >> 16) & 0xff,
      (cp >>> 24) & 0xff,
    );
  }
  for (const element of pcds) plc.push(...element);
  return new Uint8Array([
    0x02,
    plc.length & 0xff,
    (plc.length >> 8) & 0xff,
    0,
    0,
    ...plc,
  ]);
}

// Reproduces [MS-DOC] 2.9.6's own example document end to end: an uncompressed piece at byte offset 0x0C22 carrying "Hello " as UTF-16, a compressed piece at 0x0400 carrying "World.\r" as single bytes, and a compressed piece at 0x0407 carrying one further "\r" -- assembling, as the example states, to "Hello World." followed by two paragraph marks.
function specExampleStream(): Uint8Array {
  const stream = new Uint8Array(0x1000);
  const view = new DataView(stream.buffer);
  "Hello ".split("").forEach((character, index) => {
    view.setUint16(0x0c22 + index * 2, character.charCodeAt(0), true);
  });
  "World.\r".split("").forEach((character, index) => {
    stream[0x0400 + index] = character.charCodeAt(0);
  });
  stream[0x0407] = 0x0d;
  return stream;
}

const SPEC_EXAMPLE_TABLE = parseClx(
  clx(
    [0, 6, 13, 14],
    [pcdBytes(0x0c22, false), pcdBytes(0x0800, true), pcdBytes(0x080e, true)],
  ),
);

describe("readTextRange", () => {
  it("assembles [MS-DOC] 2.9.6's example into the text the example itself states", () => {
    const range = readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, 0, 14);
    expect(range.text).toBe("Hello World.\r\r");
  });

  it("gives every character the byte offset the piece table maps it to", () => {
    const range = readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, 0, 14);
    // The uncompressed piece advances two bytes per character from 0x0C22; the compressed one advances one byte from 0x0400.
    expect(range.fcs.slice(0, 6)).toEqual([
      0x0c22, 0x0c24, 0x0c26, 0x0c28, 0x0c2a, 0x0c2c,
    ]);
    expect(range.fcs.slice(6, 13)).toEqual([
      0x0400, 0x0401, 0x0402, 0x0403, 0x0404, 0x0405, 0x0406,
    ]);
    expect(range.fcs[13]).toBe(0x0407);
  });

  it("reads a sub-range that starts and ends inside different pieces", () => {
    const range = readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, 4, 11);
    expect(range.text).toBe("o World");
    expect(range.cpStart).toBe(4);
  });

  it("returns an empty range for an empty character-position span", () => {
    const range = readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, 3, 3);
    expect(range.text).toBe("");
    expect(range.fcs).toEqual([]);
  });

  it("rejects a range extending past the last character position the piece table defines", () => {
    expect(() =>
      readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, 0, 15),
    ).toThrow(DocFormatError);
  });

  it("rejects an inverted range rather than silently reading nothing", () => {
    expect(() =>
      readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, 8, 3),
    ).toThrow(/ends before it begins/);
  });

  it("names the exact out-of-range span when a range extends past the piece table's last CP", () => {
    expect(() =>
      readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, 0, 15),
    ).toThrow(
      /extends past character position 14, the last the piece table defines/,
    );
  });

  it("rejects a non-integer cpStart", () => {
    expect(() =>
      readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, 1.5, 3),
    ).toThrow(/not a pair of non-negative integer character positions/);
  });

  it("rejects a non-integer cpEnd", () => {
    expect(() =>
      readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, 0, 3.5),
    ).toThrow(DocFormatError);
  });

  it("rejects a negative cpStart", () => {
    expect(() =>
      readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, -1, 3),
    ).toThrow(/not a pair of non-negative integer character positions/);
  });

  it("accepts cpEnd exactly at the piece table's own last CP", () => {
    expect(() =>
      readTextRange(specExampleStream(), SPEC_EXAMPLE_TABLE, 0, 14),
    ).not.toThrow();
  });

  it("rejects a character position that falls before the piece table's own first key", () => {
    // A piece table whose own first key is not 0 (structurally unusual, but not something this function's own type enforces) leaves an earlier CP outside every piece.
    const table = parseClx(clx([5, 10], [pcdBytes(0x400, false)]));
    expect(() => readTextRange(new Uint8Array(0x600), table, 0, 3)).toThrow(
      /character position 0 falls outside every piece in the piece table/,
    );
  });

  it("rejects a piece table whose own pieces array does not match its cpKeys, rather than reading past its end", () => {
    // PieceTable is a plain data shape, not something only parseClx can construct -- a caller assembling one with mismatched arrays (pieces shorter than cpKeys implies) is a real, if unusual, way to reach this guard.
    const mismatched = {
      pieces: [],
      cpKeys: [0, 5],
      lastCp: 5,
    };
    expect(() => readTextRange(new Uint8Array(0x10), mismatched, 0, 3)).toThrow(
      /piece 0 is absent from a piece table of 0 pieces/,
    );
  });

  it("reads text long enough to span String.fromCharCode's own chunking boundary", () => {
    // A single uncompressed piece of 5000 characters -- comfortably past the 4096-character chunk size fromCodeUnits splits on, so this exercises more than one chunk and the exact boundary between them.
    const length = 5000;
    const stream = new Uint8Array(0x400 + length * 2);
    const view = new DataView(stream.buffer);
    for (let index = 0; index < length; index += 1) {
      view.setUint16(0x400 + index * 2, 0x41 + (index % 26), true);
    }
    const table = parseClx(clx([0, length], [pcdBytes(0x400, false)]));
    const range = readTextRange(stream, table, 0, length);
    expect(range.text).toHaveLength(length);
    expect(range.text[0]).toBe("A");
    expect(range.text[4095]).toBe(String.fromCharCode(0x41 + (4095 % 26)));
    expect(range.text[4096]).toBe(String.fromCharCode(0x41 + (4096 % 26)));
    expect(range.text[length - 1]).toBe(
      String.fromCharCode(0x41 + ((length - 1) % 26)),
    );
  });
});

describe("the compressed-piece byte mapping", () => {
  it("maps each byte [MS-DOC] 2.8.25 singles out to the code point it names", () => {
    // The table's own entries, restated from the specification rather than derived from a codec.
    expect(COMPRESSED_CHARACTER_MAP.get(0x82)).toBe(0x201a);
    expect(COMPRESSED_CHARACTER_MAP.get(0x83)).toBe(0x0192);
    expect(COMPRESSED_CHARACTER_MAP.get(0x84)).toBe(0x201e);
    expect(COMPRESSED_CHARACTER_MAP.get(0x85)).toBe(0x2026);
    expect(COMPRESSED_CHARACTER_MAP.get(0x86)).toBe(0x2020);
    expect(COMPRESSED_CHARACTER_MAP.get(0x87)).toBe(0x2021);
    expect(COMPRESSED_CHARACTER_MAP.get(0x88)).toBe(0x02c6);
    expect(COMPRESSED_CHARACTER_MAP.get(0x89)).toBe(0x2030);
    expect(COMPRESSED_CHARACTER_MAP.get(0x8a)).toBe(0x0160);
    expect(COMPRESSED_CHARACTER_MAP.get(0x8b)).toBe(0x2039);
    expect(COMPRESSED_CHARACTER_MAP.get(0x8c)).toBe(0x0152);
    expect(COMPRESSED_CHARACTER_MAP.get(0x91)).toBe(0x2018);
    expect(COMPRESSED_CHARACTER_MAP.get(0x92)).toBe(0x2019);
    expect(COMPRESSED_CHARACTER_MAP.get(0x93)).toBe(0x201c);
    expect(COMPRESSED_CHARACTER_MAP.get(0x94)).toBe(0x201d);
    expect(COMPRESSED_CHARACTER_MAP.get(0x95)).toBe(0x2022);
    expect(COMPRESSED_CHARACTER_MAP.get(0x96)).toBe(0x2013);
    expect(COMPRESSED_CHARACTER_MAP.get(0x97)).toBe(0x2014);
    expect(COMPRESSED_CHARACTER_MAP.get(0x98)).toBe(0x02dc);
    expect(COMPRESSED_CHARACTER_MAP.get(0x99)).toBe(0x2122);
    expect(COMPRESSED_CHARACTER_MAP.get(0x9a)).toBe(0x0161);
    expect(COMPRESSED_CHARACTER_MAP.get(0x9b)).toBe(0x203a);
    expect(COMPRESSED_CHARACTER_MAP.get(0x9c)).toBe(0x0153);
    expect(COMPRESSED_CHARACTER_MAP.get(0x9f)).toBe(0x0178);
  });

  it("carries exactly the entries the specification lists and no more", () => {
    expect(COMPRESSED_CHARACTER_MAP.size).toBe(24);
    // 0x80, 0x8E, 0x9E and 0x9D are the Windows-1252 assignments [MS-DOC]'s own table deliberately omits, so this reader leaves them mapping to themselves rather than substituting a codec's answer for the spec's.
    expect(COMPRESSED_CHARACTER_MAP.has(0x80)).toBe(false);
    expect(COMPRESSED_CHARACTER_MAP.has(0x8e)).toBe(false);
    expect(COMPRESSED_CHARACTER_MAP.has(0x9e)).toBe(false);
    expect(COMPRESSED_CHARACTER_MAP.has(0x9d)).toBe(false);
  });

  it("applies the mapping when reading a compressed piece", () => {
    const stream = new Uint8Array(0x600);
    stream[0x400] = 0x92; // The right single quotation mark, U+2019.
    stream[0x401] = 0x41; // 'A', a byte outside the table, which maps to itself.
    const table = parseClx(clx([0, 2], [pcdBytes(0x800, true)]));
    expect(readTextRange(stream, table, 0, 2).text).toBe(
      `${String.fromCharCode(0x2019)}A`,
    );
  });

  it("leaves an uncompressed piece's 16-bit characters untouched by the mapping", () => {
    const stream = new Uint8Array(0x600);
    new DataView(stream.buffer).setUint16(0x400, 0x0092, true);
    const table = parseClx(clx([0, 1], [pcdBytes(0x400, false)]));
    expect(readTextRange(stream, table, 0, 1).text).toBe(
      String.fromCharCode(0x0092),
    );
  });
});
