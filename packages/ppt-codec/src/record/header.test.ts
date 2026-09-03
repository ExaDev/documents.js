import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import {
  RECORD_HEADER_SIZE,
  isContainerRecord,
  readRecordHeader,
} from "./header";

// Every byte sequence below is hand-built from [MS-PPT] 2.3.1's own field layout: a 16-bit little-endian word packing recVer in its low 4 bits and recInstance in its high 12, then recType as a little-endian uint16, then recLen as a little-endian uint32. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/df201194-0cd0-4dfb-bf10-eea353d8eabc
function header(
  recVer: number,
  recInstance: number,
  recType: number,
  recLen: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(RECORD_HEADER_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, (recVer & 0xf) | ((recInstance & 0xfff) << 4), true);
  view.setUint16(2, recType, true);
  view.setUint32(4, recLen, true);
  return bytes;
}

describe("readRecordHeader", () => {
  it("splits the leading word into recVer (low 4 bits) and recInstance (high 12 bits)", () => {
    // The DocumentAtom's own required header: recVer 0x1, recInstance 0x000, recType RT_DocumentAtom (0x03E9), recLen 0x28.
    expect(readRecordHeader(header(0x1, 0x000, 0x03e9, 0x28), 0)).toEqual({
      recVer: 0x1,
      recInstance: 0x000,
      recType: 0x03e9,
      recLen: 0x28,
    });
  });

  it("reads a 12-bit recInstance that occupies every one of its bits", () => {
    expect(readRecordHeader(header(0x0, 0xfff, 0x0f9f, 0x04), 0)).toEqual({
      recVer: 0x0,
      recInstance: 0xfff,
      recType: 0x0f9f,
      recLen: 0x04,
    });
  });

  it("reads recType and recLen as little-endian, not big-endian", () => {
    // Raw bytes chosen so a big-endian misread would produce visibly different numbers: recType bytes 0xEE 0x03 are 0x03EE little-endian, and recLen bytes 01 02 03 04 are 0x04030201.
    const bytes = new Uint8Array([
      0x0f, 0x00, 0xee, 0x03, 0x01, 0x02, 0x03, 0x04,
    ]);
    expect(readRecordHeader(bytes, 0)).toEqual({
      recVer: 0xf,
      recInstance: 0x000,
      recType: 0x03ee,
      recLen: 0x04030201,
    });
  });

  it("reads a header sitting at a non-zero offset", () => {
    const bytes = new Uint8Array(RECORD_HEADER_SIZE + 3);
    bytes.set(header(0xf, 0x001, 0x1772, 0x10), 3);
    expect(readRecordHeader(bytes, 3).recType).toBe(0x1772);
  });

  it("rejects a read that would run past the end of the buffer", () => {
    expect(() => readRecordHeader(new Uint8Array(7), 0)).toThrow(
      PptFormatError,
    );
  });

  it("rejects a negative offset rather than reading backwards", () => {
    expect(() => readRecordHeader(new Uint8Array(16), -1)).toThrow(
      PptFormatError,
    );
  });
});

describe("isContainerRecord", () => {
  it("treats recVer 0xF as the container marker", () => {
    expect(
      isContainerRecord(readRecordHeader(header(0xf, 0x000, 0x03e8, 0x10), 0)),
    ).toBe(true);
  });

  it("treats every other recVer as an atom", () => {
    for (const recVer of [0x0, 0x1, 0x2, 0xe]) {
      expect(
        isContainerRecord(
          readRecordHeader(header(recVer, 0x000, 0x03e9, 0x28), 0),
        ),
      ).toBe(false);
    }
  });
});
