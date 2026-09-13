import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { buildFontTable, parseFontTable } from "./fonts";

describe("buildFontTable / parseFontTable round trip", () => {
  it("round-trips a single font name", () => {
    const table = buildFontTable(["Calibri"]);
    expect(parseFontTable(table)).toEqual(["Calibri"]);
  });

  it("round-trips several font names, in order", () => {
    const table = buildFontTable(["Calibri", "Arial", "Times New Roman"]);
    expect(parseFontTable(table)).toEqual([
      "Calibri",
      "Arial",
      "Times New Roman",
    ]);
  });

  it("round-trips an empty font table", () => {
    expect(parseFontTable(buildFontTable([]))).toEqual([]);
  });
});

// Builds a minimal SttbfFfn by hand -- cData(2) + cbExtra(2), then one entry of a 1-byte cch followed by `record` verbatim -- so a malformed FFN record's own read-side rejection (too short, no terminator) can be tested independently of buildFontTable, which only ever produces well-formed ones.
function sttbfFfnWithRecord(record: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(4 + 1 + record.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true); // cData.
  view.setUint16(2, 0, true); // cbExtra.
  bytes[4] = record.length;
  bytes.set(record, 5);
  return bytes;
}

describe("parseFontTable", () => {
  it("names 'SttbfFfn entry 0' when a declared cch runs past the STTB's own end", () => {
    const bytes = new Uint8Array(4 + 1 + 3);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1, true); // cData.
    view.setUint16(2, 0, true); // cbExtra.
    bytes[4] = 50; // cch declares 50 bytes, but only 3 remain.
    expect(() => parseFontTable(bytes)).toThrow(/SttbfFfn entry 0/);
  });

  it("rejects an FFN record too short to hold even its own fixed head plus xszFfn's null terminator", () => {
    const table = sttbfFfnWithRecord(new Array<number>(10).fill(0));
    expect(() => parseFontTable(table)).toThrow(DocFormatError);
    expect(() => parseFontTable(table)).toThrow(
      /FFN record 0 is 10 bytes, shorter than the fixed 39-byte head/,
    );
  });

  it("rejects an FFN record whose xszFfn runs to the end with no null terminator", () => {
    // Fixed head (39 zero bytes) then a name with every code unit non-zero, all the way to the record's own end -- no terminating zero pair anywhere.
    const record = [...new Array<number>(39).fill(0), 0x41, 0x00, 0x42, 0x00];
    const table = sttbfFfnWithRecord(record);
    expect(() => parseFontTable(table)).toThrow(
      /FFN record 0's xszFfn runs to the end of the record with no null terminator/,
    );
  });

  it("accepts an FFN record of exactly the fixed 39-byte head plus a 2-byte null terminator, the smallest valid record", () => {
    const record = new Array<number>(41).fill(0);
    const table = sttbfFfnWithRecord(record);
    expect(parseFontTable(table)).toEqual([""]);
  });

  it("rejects an FFN record one byte short of the fixed head plus its own null terminator", () => {
    const record = new Array<number>(40).fill(0);
    const table = sttbfFfnWithRecord(record);
    expect(() => parseFontTable(table)).toThrow(
      /FFN record 0 is 40 bytes, shorter than the fixed 39-byte head/,
    );
  });

  it("rejects a non-zero cbExtra", () => {
    const table = buildFontTable(["A"]);
    const view = new DataView(table.buffer);
    view.setUint16(2, 1, true); // cbExtra, which MUST be 0.
    expect(() => parseFontTable(table)).toThrow(DocFormatError);
    expect(() => parseFontTable(table)).toThrow(
      /SttbfFfn.cbExtra is 1, but \[MS-DOC\] 2.9.253 requires it to be 0/,
    );
  });
});

describe("buildFontTable", () => {
  it("rejects a font name whose FFN record would exceed the 255-byte non-extended STTB limit", () => {
    // Fixed head (38) + name (2 * n) + terminator (2) > 255 when n >= 108.
    const longName = "A".repeat(110);
    expect(() => buildFontTable([longName])).toThrow(DocFormatError);
    expect(() => buildFontTable([longName])).toThrow(
      /produces a 261-byte FFN record, past the 255-byte limit/,
    );
  });

  it("accepts a font name whose record lands at exactly the 255-byte limit", () => {
    // 38 (fixed) + 2*n + 2 (terminator) === 255 has no integer solution, so pick n such that the record is <= 255 and as close as possible, confirming the boundary is inclusive rather than off-by-one.
    const name = "A".repeat(107); // 38 + 214 + 2 = 254 bytes.
    expect(() => buildFontTable([name])).not.toThrow();
  });
});
