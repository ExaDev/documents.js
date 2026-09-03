import { describe, expect, it } from "vitest";

import { BlockCursor } from "./cursor";
import {
  RECORD_FONT,
  RECORD_FORMAT,
  RECORD_STYLE,
  RECORD_XF,
} from "./record-types";
import { readRecords } from "./records";
import { readShortXLUnicodeString, readXLUnicodeString } from "./strings";
import {
  writeCellXfRecord,
  writeFontRecord,
  writeFormatRecord,
  writeStyleRecord,
  writeStyleXfRecord,
} from "./xf-writer";

function u16At(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint16(offset, true);
}

describe("writeCellXfRecord", () => {
  it("writes a genuine XF record: type 0x00E0, twenty bytes of data ([MS-XLS] 2.4.353)", () => {
    const record = writeCellXfRecord({ fontIndex: 0, formatId: 5 });
    const [parsed] = readRecords(record);
    expect(parsed?.type).toBe(RECORD_XF);
    expect(parsed?.data.length).toBe(20);
  });

  it("carries the given font and format indices in the fixed prefix workbook/globals.ts's readCellFormat reads", () => {
    const record = writeCellXfRecord({ fontIndex: 3, formatId: 164 });
    const [parsed] = readRecords(record);
    const cursor = new BlockCursor([parsed?.data ?? new Uint8Array(0)]);
    expect(cursor.u16()).toBe(3); // ifnt
    expect(cursor.u16()).toBe(164); // ifmt
    const flags = cursor.u16();
    expect(flags & 0x0004).toBe(0); // fStyle clear: this is a cell XF, not a cell style XF
  });

  it("points ixfParent at the Normal cell-style XF (index 0)", () => {
    const record = writeCellXfRecord({ fontIndex: 0, formatId: 0 });
    const [parsed] = readRecords(record);
    const data = parsed?.data ?? new Uint8Array(0);
    const flags = u16At(data, 4);
    const ixfParent = flags >>> 4;
    expect(ixfParent).toBe(0);
  });

  it("writes a fill with no pattern, at the 'Automatic' colour indices a real undecorated XF carries", () => {
    const record = writeCellXfRecord({ fontIndex: 0, formatId: 0 });
    const [parsed] = readRecords(record);
    const data = parsed?.data ?? new Uint8Array(0);
    // CellXF's own trailing 2-byte word: icvFore (bits 0-6), icvBack (bits 7-13).
    const fillWord = u16At(data, 18);
    expect(fillWord & 0x7f).toBe(0x40);
    expect((fillWord >>> 7) & 0x7f).toBe(0x41);
  });
});

describe("writeStyleXfRecord", () => {
  it("sets fStyle and ixfParent = 0xFFF ('no inheritance')", () => {
    const record = writeStyleXfRecord({ fontIndex: 0, formatId: 0 });
    const [parsed] = readRecords(record);
    const data = parsed?.data ?? new Uint8Array(0);
    const flags = u16At(data, 4);
    expect((flags >>> 2) & 0x1).toBe(1); // fStyle set
    expect(flags >>> 4).toBe(0xfff);
  });
});

describe("writeStyleRecord", () => {
  it("writes a genuine Style record: type 0x0293", () => {
    const record = writeStyleRecord({
      xfIndex: 0,
      istyBuiltIn: 0x00,
      iLevel: 0xff,
    });
    const [parsed] = readRecords(record);
    expect(parsed?.type).toBe(RECORD_STYLE);
  });

  it("packs ixfe and the fBuiltIn bit, then the builtInData pair", () => {
    const record = writeStyleRecord({
      xfIndex: 7,
      istyBuiltIn: 0x01,
      iLevel: 0x03,
    });
    const [parsed] = readRecords(record);
    const data = parsed?.data ?? new Uint8Array(0);
    const ixfeWord = u16At(data, 0);
    expect(ixfeWord & 0x0fff).toBe(7);
    expect((ixfeWord >>> 15) & 0x1).toBe(1); // fBuiltIn
    expect(data[2]).toBe(0x01); // istyBuiltIn
    expect(data[3]).toBe(0x03); // iLevel
  });
});

describe("writeFontRecord", () => {
  it("writes a genuine Font record whose name round-trips through this package's own reader", () => {
    const record = writeFontRecord("Arial", 200);
    const [parsed] = readRecords(record);
    expect(parsed?.type).toBe(RECORD_FONT);
    const data = parsed?.data ?? new Uint8Array(0);
    expect(u16At(data, 0)).toBe(200); // dyHeight
    const cursor = new BlockCursor([data]);
    cursor.skip(14); // dyHeight(2) grbit(2) icv(2) bls(2) sss(2) uls(1) bFamily(1) bCharSet(1) unused3(1)
    expect(readShortXLUnicodeString(cursor)).toBe("Arial");
  });

  it("always writes fHighByte=1 for the font name, per [MS-XLS] 2.4.122's own unconditional requirement", () => {
    const record = writeFontRecord("Arial", 200);
    const [parsed] = readRecords(record);
    const data = parsed?.data ?? new Uint8Array(0);
    // The name field starts at offset 9 (dyHeight 2 + grbit 2 + icv 2 + bls 2 + sss 2 -- wait, recompute: dyHeight(2) grbit(2) icv(2) bls(2) sss(2) uls(1) bFamily(1) bCharSet(1) unused3(1) = 14 bytes prefix, then cch(1) flags(1).
    const flagsOffset = 14 + 1;
    expect(data[flagsOffset]).toBe(0x01);
  });
});

describe("writeFormatRecord", () => {
  it("writes a genuine Format record whose id and code round-trip", () => {
    const record = writeFormatRecord(164, "yyyy-mm-dd");
    const [parsed] = readRecords(record);
    expect(parsed?.type).toBe(RECORD_FORMAT);
    const data = parsed?.data ?? new Uint8Array(0);
    expect(u16At(data, 0)).toBe(164);
    const cursor = new BlockCursor([data]);
    cursor.skip(2);
    expect(readXLUnicodeString(cursor)).toBe("yyyy-mm-dd");
  });
});
