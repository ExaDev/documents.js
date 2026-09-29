import { describe, expect, it } from "vitest";

import {
  assertNeverPhysical,
  BLR_BLOB,
  BLR_BOOL,
  BLR_CSTRING,
  BLR_CSTRING2,
  BLR_D_FLOAT,
  BLR_DEC128,
  BLR_DEC64,
  BLR_DOUBLE,
  BLR_EX_TIMESTAMP_TZ,
  BLR_EX_TIME_TZ,
  BLR_INT128,
  BLR_INT64,
  BLR_LONG,
  BLR_QUAD,
  BLR_SHORT,
  BLR_SQL_DATE,
  BLR_SQL_TIME,
  BLR_SQL_TIME_TZ,
  BLR_TIMESTAMP,
  BLR_TIMESTAMP_TZ,
  BLR_VARYING,
  BLR_VARYING2,
  decodeBlrType,
  describeFieldType,
  FirebirdUnsupportedFieldTypeError,
} from "./blr-types";

describe("decodeBlrType: the BLR opcode table, entry for entry", () => {
  it("maps every opcode this package names onto its physical storage type", () => {
    const table: readonly [number, string][] = [
      [BLR_SHORT, "short"],
      [BLR_LONG, "long"],
      [BLR_QUAD, "quad"],
      [BLR_D_FLOAT, "double"],
      [BLR_SQL_DATE, "sql_date"],
      [BLR_SQL_TIME, "sql_time"],
      [BLR_INT64, "int64"],
      [BLR_BOOL, "boolean"],
      [BLR_DEC64, "dec64"],
      [BLR_DEC128, "dec128"],
      [BLR_INT128, "int128"],
      [BLR_DOUBLE, "double"],
      [BLR_SQL_TIME_TZ, "unsupported-tz"],
      [BLR_TIMESTAMP_TZ, "unsupported-tz"],
      [BLR_EX_TIME_TZ, "unsupported-tz"],
      [BLR_EX_TIMESTAMP_TZ, "unsupported-tz"],
      [BLR_TIMESTAMP, "timestamp"],
      [BLR_VARYING, "varying"],
      [BLR_VARYING2, "varying"],
      [BLR_CSTRING, "cstring"],
      [BLR_CSTRING2, "cstring"],
      [BLR_BLOB, "blob"],
    ];
    for (const [opcode, expected] of table) {
      expect(decodeBlrType(opcode), String(opcode)).toBe(expected);
    }
  });

  it("throws naming the opcode for a slot the real table leaves unmapped", () => {
    expect(() => decodeBlrType(0)).toThrow(FirebirdUnsupportedFieldTypeError);
    expect(() => decodeBlrType(0)).toThrow(/BLR type 0/);
    try {
      decodeBlrType(1);
    } catch (error) {
      expect(
        error instanceof FirebirdUnsupportedFieldTypeError && error.blrType,
      ).toBe(1);
    }
  });
});

describe("describeFieldType: the SQL-shaped label for every physical", () => {
  it("gives each integer physical its scale-dependent spelling", () => {
    expect(describeFieldType("short", 2, 0, undefined, 0)).toBe("SMALLINT");
    expect(describeFieldType("short", 2, -1, undefined, 0)).toBe(
      "NUMERIC(4,1)",
    );
    expect(describeFieldType("long", 4, 0, undefined, 0)).toBe("INTEGER");
    expect(describeFieldType("long", 4, -2, undefined, 0)).toBe("NUMERIC(9,2)");
    expect(describeFieldType("int64", 8, 0, undefined, 0)).toBe("BIGINT");
    expect(describeFieldType("int64", 8, -4, undefined, 0)).toBe(
      "NUMERIC(18,4)",
    );
    expect(describeFieldType("int128", 16, -10, undefined, 0)).toBe(
      "NUMERIC(38,10)",
    );
  });

  it("prefers the character length over the byte length for the text family, falling back when absent", () => {
    expect(describeFieldType("text", 10, 0, 7, 1)).toBe("CHAR(7)");
    expect(describeFieldType("text", 10, 0, undefined, 1)).toBe("CHAR(10)");
    expect(describeFieldType("varying", 20, 0, 15, 1)).toBe("VARCHAR(15)");
    expect(describeFieldType("varying", 20, 0, undefined, 1)).toBe(
      "VARCHAR(20)",
    );
    expect(describeFieldType("cstring", 30, 0, undefined, 1)).toBe(
      "CSTRING(30)",
    );
  });

  it("labels each fixed-shape physical and the blob's own sub-type", () => {
    expect(describeFieldType("real", 4, 0, undefined, 0)).toBe("FLOAT");
    expect(describeFieldType("double", 8, 0, undefined, 0)).toBe(
      "DOUBLE PRECISION",
    );
    expect(describeFieldType("sql_date", 4, 0, undefined, 0)).toBe("DATE");
    expect(describeFieldType("sql_time", 4, 0, undefined, 0)).toBe("TIME");
    expect(describeFieldType("timestamp", 8, 0, undefined, 0)).toBe(
      "TIMESTAMP",
    );
    expect(describeFieldType("boolean", 1, 0, undefined, 0)).toBe("BOOLEAN");
    expect(describeFieldType("blob", 8, 0, undefined, 1)).toBe(
      "BLOB SUB_TYPE 1",
    );
    expect(describeFieldType("blob", 8, 0, undefined, 0)).toBe(
      "BLOB SUB_TYPE 0",
    );
    expect(describeFieldType("quad", 8, 0, undefined, 0)).toBe("ARRAY");
    expect(describeFieldType("dec64", 8, 0, undefined, 0)).toBe("DECFLOAT(16)");
    expect(describeFieldType("dec128", 16, 0, undefined, 0)).toBe(
      "DECFLOAT(34)",
    );
    expect(describeFieldType("unsupported-tz", 4, 0, undefined, 0)).toBe(
      "TIMESTAMP/TIME WITH TIME ZONE",
    );
  });
});

describe("assertNeverPhysical", () => {
  it("throws naming the unhandled physical, proving the switch's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverPhysical("bogus" as never);
    }).toThrow('documents.js: unhandled physical "bogus"');
  });
});
