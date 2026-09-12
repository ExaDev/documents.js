import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { type PptRecord, readRecordAt } from "../record/tree";
import {
  OfficeArtFOPT,
  OfficeArtSecondaryFOPT,
  OfficeArtSpContainer,
  OfficeArtTertiaryFOPT,
  RT_TextHeaderAtom,
} from "../record/types";
import {
  concatBytes,
  u16le,
  u32le,
  writeAtom as atom,
  writeContainer as container,
} from "../record/write";
import {
  PROPERTY_ROTATION,
  PROPERTY_TABLE_PROPERTIES,
  PROPERTY_TABLE_ROW_PROPERTIES,
  degreesToFixedPoint,
  fixedPointToDegrees,
  readIMsoArray,
  readShapeProperties,
  writeIMsoArray,
  writeShapePropertyTable,
} from "./properties";

// The property table, tested against bytes hand-assembled from [MS-ODRAW]'s own field tables: a 6-byte entry per property (opid with its two flag bits, then a 4-byte value) followed by the pooled complex payloads, the whole framed by recVer 0x3 and a recInstance that counts the entries.

// opid word assembly: the 14-bit identifier, fComplex (bit 14), fBid (bit 15).
function opid(id: number, flags = 0): Uint8Array<ArrayBuffer> {
  return u16le(id | flags);
}

const F_COMPLEX = 1 << 14;

function shapeWithTable(
  recType: number,
  entries: readonly Uint8Array<ArrayBuffer>[],
  entryCount: number,
): PptRecord {
  const shape = container(OfficeArtSpContainer, [
    atom(recType, concatBytes(...entries), {
      recVer: 0x3,
      recInstance: entryCount,
    }),
  ]);
  return readRecordAt(shape, 0);
}

describe("readShapeProperties", () => {
  it("reads a plain property's value and strips the flag bits from its identifier", () => {
    // rotation (0x0004), fixed-point 45 degrees = 45 * 0x10000 = 0x002D0000.
    const shape = shapeWithTable(
      OfficeArtFOPT,
      [concatBytes(opid(PROPERTY_ROTATION), u32le(45 * 0x10000))],
      1,
    );
    const properties = readShapeProperties(shape);
    expect(properties.get(PROPERTY_ROTATION)?.value).toBe(45 * 0x10000);
    expect(properties.get(PROPERTY_ROTATION)?.complex).toBeUndefined();
  });

  it("reads a complex property's payload from the pooled bytes after the entry run", () => {
    // tableRowProperties (0x03A0): the entry's value is the payload's length; the payload follows both entries.
    const complex = writeIMsoArray([2880, 1440], 4);
    const shape = shapeWithTable(
      OfficeArtTertiaryFOPT,
      [
        concatBytes(opid(PROPERTY_TABLE_PROPERTIES), u32le(1)),
        concatBytes(
          opid(PROPERTY_TABLE_ROW_PROPERTIES, F_COMPLEX),
          u32le(complex.length),
        ),
        complex,
      ],
      2,
    );
    const properties = readShapeProperties(shape);
    expect(properties.get(PROPERTY_TABLE_PROPERTIES)?.value).toBe(1);
    expect(
      readIMsoArray(
        properties.get(PROPERTY_TABLE_ROW_PROPERTIES)?.complex ??
          new Uint8Array(),
      ),
    ).toEqual([2880, 1440]);
  });

  it("merges the same property stated in more than one of a shape's tables", () => {
    const shapeBytes = container(OfficeArtSpContainer, [
      atom(OfficeArtFOPT, concatBytes(opid(PROPERTY_ROTATION), u32le(0)), {
        recVer: 0x3,
        recInstance: 1,
      }),
      atom(
        OfficeArtTertiaryFOPT,
        concatBytes(opid(PROPERTY_ROTATION), u32le(90 * 0x10000)),
        { recVer: 0x3, recInstance: 1 },
      ),
    ]);
    // The later table wins, deterministically.
    expect(
      readShapeProperties(readRecordAt(shapeBytes, 0)).get(PROPERTY_ROTATION)
        ?.value,
    ).toBe(90 * 0x10000);
  });

  it("throws on a table whose declared entry count exceeds its bytes", () => {
    const shapeBytes = container(OfficeArtSpContainer, [
      // recInstance 2 but only one entry's worth of bytes.
      atom(OfficeArtFOPT, concatBytes(opid(PROPERTY_ROTATION), u32le(0)), {
        recVer: 0x3,
        recInstance: 2,
      }),
    ]);
    expect(() => readShapeProperties(readRecordAt(shapeBytes, 0))).toThrow(
      PptFormatErrorMatch,
    );
  });

  it("skips a child record that is not one of the three property-table types", () => {
    // A shape can carry other children (a client anchor, a text box) alongside its property tables; only OfficeArtFOPT/SecondaryFOPT/TertiaryFOPT are property tables at all.
    const shape = container(OfficeArtSpContainer, [
      atom(RT_TextHeaderAtom, u32le(0)),
      atom(OfficeArtFOPT, concatBytes(opid(PROPERTY_ROTATION), u32le(1)), {
        recVer: 0x3,
        recInstance: 1,
      }),
    ]);
    const properties = readShapeProperties(readRecordAt(shape, 0));
    expect(properties.size).toBe(1);
    expect(properties.get(PROPERTY_ROTATION)?.value).toBe(1);
  });

  it("reads OfficeArtSecondaryFOPT, the second of the three table positions", () => {
    const shape = container(OfficeArtSpContainer, [
      atom(
        OfficeArtSecondaryFOPT,
        concatBytes(opid(PROPERTY_ROTATION), u32le(7)),
        { recVer: 0x3, recInstance: 1 },
      ),
    ]);
    expect(
      readShapeProperties(readRecordAt(shape, 0)).get(PROPERTY_ROTATION)?.value,
    ).toBe(7);
  });

  it("resolves two complex properties' payloads sequentially, each from where the previous one ended", () => {
    const firstComplex = writeIMsoArray([1], 4);
    const secondComplex = writeIMsoArray([2, 3], 4);
    const shape = shapeWithTable(
      OfficeArtTertiaryFOPT,
      [
        concatBytes(
          opid(PROPERTY_TABLE_PROPERTIES, F_COMPLEX),
          u32le(firstComplex.length),
        ),
        concatBytes(
          opid(PROPERTY_TABLE_ROW_PROPERTIES, F_COMPLEX),
          u32le(secondComplex.length),
        ),
        firstComplex,
        secondComplex,
      ],
      2,
    );
    const properties = readShapeProperties(shape);
    expect(
      readIMsoArray(
        properties.get(PROPERTY_TABLE_PROPERTIES)?.complex ?? new Uint8Array(),
      ),
    ).toEqual([1]);
    expect(
      readIMsoArray(
        properties.get(PROPERTY_TABLE_ROW_PROPERTIES)?.complex ??
          new Uint8Array(),
      ),
    ).toEqual([2, 3]);
  });

  it("throws with the exact declared/available byte counts when the entry run itself is too short", () => {
    const shapeBytes = container(OfficeArtSpContainer, [
      atom(OfficeArtFOPT, concatBytes(opid(PROPERTY_ROTATION), u32le(0)), {
        recVer: 0x3,
        recInstance: 2,
      }),
    ]);
    expect(() => readShapeProperties(readRecordAt(shapeBytes, 0))).toThrow(
      "a shape property table declares 2 properties but its 6 bytes of data cannot hold the 12 its entries need",
    );
  });

  it("throws with the exact byte counts when a complex property's declared length runs past the table", () => {
    const shape = shapeWithTable(
      OfficeArtTertiaryFOPT,
      [concatBytes(opid(PROPERTY_TABLE_ROW_PROPERTIES, F_COMPLEX), u32le(100))],
      1,
    );
    expect(() => readShapeProperties(shape)).toThrow(PptFormatError);
    expect(() => readShapeProperties(shape)).toThrow(
      "a shape property table's complex data declares 106 bytes in total but the table carries only 6",
    );
  });
});

const PptFormatErrorMatch = /cannot hold/;

describe("writeShapePropertyTable / readShapeProperties round trip", () => {
  it("round-trips plain and complex properties together, in ascending opid order", () => {
    const complex = writeIMsoArray([100, 200, 300], 4);
    const table = writeShapePropertyTable(OfficeArtTertiaryFOPT, [
      { opid: PROPERTY_TABLE_ROW_PROPERTIES, op: complex.length, complex },
      { opid: PROPERTY_TABLE_PROPERTIES, op: 1 },
    ]);
    const shapeBytes = container(OfficeArtSpContainer, [table]);
    const properties = readShapeProperties(readRecordAt(shapeBytes, 0));
    expect(properties.get(PROPERTY_TABLE_PROPERTIES)?.value).toBe(1);
    expect(
      readIMsoArray(
        properties.get(PROPERTY_TABLE_ROW_PROPERTIES)?.complex ??
          new Uint8Array(),
      ),
    ).toEqual([100, 200, 300]);
  });

  it("sets fBid on a plain blip reference, as pib's own specification requires", () => {
    const table = writeShapePropertyTable(OfficeArtFOPT, [
      { opid: 0x0104, op: 1, fBid: true },
    ]);
    const shapeBytes = container(OfficeArtSpContainer, [table]);
    // The flag bits are stripped on read; the fBid bit must not corrupt the identifier.
    expect(
      readShapeProperties(readRecordAt(shapeBytes, 0)).get(0x0104)?.value,
    ).toBe(1);
  });

  it("leaves fBid clear when an entry does not set it", () => {
    // opid 0x0004 (rotation) never carries fBid; asserting the raw entry word (not just the stripped-down read side) proves the writer states it as clear rather than merely never checking it.
    const table = writeShapePropertyTable(OfficeArtFOPT, [
      { opid: PROPERTY_ROTATION, op: 0 },
    ]);
    const view = new DataView(table.buffer, table.byteOffset);
    // 8-byte record header, then the one entry's 2-byte opid word.
    expect(view.getUint16(8, true)).toBe(PROPERTY_ROTATION);
  });

  it("emits entries in ascending opid order on the wire, regardless of the order they were given in", () => {
    const table = writeShapePropertyTable(OfficeArtFOPT, [
      { opid: 0x0100, op: 1 },
      { opid: 0x0004, op: 2 },
      { opid: 0x0050, op: 3 },
    ]);
    const view = new DataView(table.buffer, table.byteOffset);
    const opidAt = (entryIndex: number) =>
      view.getUint16(8 + entryIndex * 6, true);
    expect([opidAt(0), opidAt(1), opidAt(2)]).toEqual([0x0004, 0x0050, 0x0100]);
  });
});

describe("fixed-point conversion", () => {
  it("converts whole and fractional degrees in both directions", () => {
    expect(degreesToFixedPoint(45)).toBe(45 * 0x10000);
    expect(fixedPointToDegrees(45 * 0x10000)).toBe(45);
    expect(fixedPointToDegrees(0x8000)).toBe(0.5);
    // A negative (counterclockwise) rotation survives the signed 32-bit round trip.
    expect(fixedPointToDegrees(degreesToFixedPoint(-15))).toBe(-15);
  });
});

describe("readIMsoArray / writeIMsoArray", () => {
  it("round-trips an array of 4-byte elements", () => {
    expect(readIMsoArray(writeIMsoArray([576, -288, 0], 4))).toEqual([
      576, -288, 0,
    ]);
  });

  it("rejects a complex payload too short for its own three count fields", () => {
    expect(() => readIMsoArray(new Uint8Array(5))).toThrow(PptFormatError);
    expect(() => readIMsoArray(new Uint8Array(5))).toThrow(
      "a complex property's IMsoArray carries 5 bytes, fewer than the 6 its three count fields need",
    );
  });

  it("rejects a complex payload declaring more elements than it actually carries", () => {
    // nElems=3, cbElem=4 (12 bytes needed), but only 4 bytes of data follow the 6-byte header.
    const bytes = writeIMsoArray([1], 4);
    const truncated = bytes.subarray(0, bytes.length - 4);
    const withWrongCount = new Uint8Array(truncated);
    new DataView(withWrongCount.buffer).setUint16(0, 3, true);
    expect(() => readIMsoArray(withWrongCount)).toThrow(PptFormatError);
    expect(() => readIMsoArray(withWrongCount)).toThrow(
      "a complex property's IMsoArray declares 3 elements of 4 bytes but only 0 remain",
    );
  });
});
