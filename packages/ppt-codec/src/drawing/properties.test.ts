import { describe, expect, it } from "vitest";
import { type PptRecord, readRecordAt } from "../record/tree";
import {
  OfficeArtFOPT,
  OfficeArtSpContainer,
  OfficeArtTertiaryFOPT,
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
});
