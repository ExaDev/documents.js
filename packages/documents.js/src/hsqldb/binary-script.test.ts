import { describe, expect, it } from "vitest";
import {
  hsqldbBinaryScriptBytes,
  hsqldbCompressedScriptBytes,
} from "../test-support/odb";
import {
  HsqldbBinaryScriptParseError,
  inflateHsqldbCompressedScript,
  parseHsqldbBinaryScript,
} from "./binary-script";

// The fixtures' own DATE/TIME/TIMESTAMP values were written by a JVM in Europe/London, and — per src/hsqldb/rowformat.ts's own documented, inherent format limitation — an epoch-millisecond value only decodes back to its original calendar fields when read in the zone it was written in. Passed explicitly as { timeZone: "Europe/London" } below rather than by mutating process.env.TZ: a runtime TZ mutation is not observed by Date's local getters inside a worker_threads worker (the pool Stryker's vitest-runner forces), so relying on the implicit-local-timezone default here decoded arbitrarily wrong dates under mutation testing.

// Exactly what HSQLDB 1.8.0.10 itself reported when it re-opened each generated database and ran SELECT * over every table through its own JDBC driver — see src/hsqldb/binary-script.ts's own module comment for the generation/oracle account.
const ORACLE_EMPLOYEES = [
  [
    { kind: "number", value: 1 },
    { kind: "string", value: "Alice Smith" },
    { kind: "number", value: 75000.5 },
    { kind: "date", value: "2020-01-15" },
    { kind: "boolean", value: true },
    { kind: "number", value: 1500.25 },
  ],
  [
    { kind: "number", value: 2 },
    { kind: "string", value: "Bob Jones" },
    { kind: "number", value: 62000 },
    { kind: "date", value: "2019-06-01" },
    { kind: "boolean", value: false },
    { kind: "empty" },
  ],
  [
    { kind: "number", value: 3 },
    { kind: "empty" },
    { kind: "number", value: 58000.75 },
    { kind: "empty" },
    { kind: "boolean", value: true },
    { kind: "number", value: 250 },
  ],
  [
    { kind: "number", value: 4 },
    { kind: "string", value: "Carol O'Brien" },
    { kind: "number", value: 91000.1 },
    { kind: "date", value: "2021-11-30" },
    { kind: "boolean", value: true },
    { kind: "number", value: 3000.75 },
  ],
];

const ORACLE_TYPE_TEST = [
  [
    { kind: "number", value: 1 },
    { kind: "time", value: "14:30:00" },
    { kind: "date", value: "2024-03-15 09:45:30.123456789" },
    { kind: "number", value: 123456789012345 },
    { kind: "number", value: 32000 },
    { kind: "number", value: 120 },
  ],
  [
    { kind: "number", value: 2 },
    { kind: "time", value: "23:59:59" },
    { kind: "date", value: "1999-12-31 23:59:59" },
    { kind: "number", value: -123456789012345 },
    { kind: "number", value: -32000 },
    { kind: "number", value: -120 },
  ],
  [
    { kind: "number", value: 3 },
    { kind: "empty" },
    { kind: "empty" },
    { kind: "empty" },
    { kind: "empty" },
    { kind: "empty" },
  ],
];

describe("parseHsqldbBinaryScript: the real hsqldb.script_format=1 fixture", () => {
  it("recovers the DDL as ordinary TEXT-format script text", () => {
    const { scriptText } = parseHsqldbBinaryScript(hsqldbBinaryScriptBytes());
    expect(scriptText.split("\n")).toEqual([
      "CREATE SCHEMA PUBLIC AUTHORIZATION DBA",
      "CREATE MEMORY TABLE EMPLOYEES(ID INTEGER NOT NULL PRIMARY KEY,NAME VARCHAR(50),SALARY DOUBLE,HIRE_DATE DATE,ACTIVE BOOLEAN,BONUS DECIMAL(10,2))",
      "CREATE MEMORY TABLE TYPE_TEST(ID INTEGER NOT NULL PRIMARY KEY,T TIME,TS TIMESTAMP,BIG BIGINT,SMALL SMALLINT,TINY TINYINT)",
      "CREATE MEMORY TABLE EMPTY_TABLE(ID INTEGER NOT NULL PRIMARY KEY,NOTE VARCHAR(20))",
      'CREATE USER SA PASSWORD ""',
      "GRANT DBA TO SA",
      "SET WRITE_DELAY 10",
    ]);
  });

  it("recovers every column of every table from that same DDL", () => {
    const { tables } = parseHsqldbBinaryScript(hsqldbBinaryScriptBytes());
    expect(tables.map((table) => table.tableName)).toEqual([
      "EMPLOYEES",
      "TYPE_TEST",
      "EMPTY_TABLE",
    ]);
    expect(tables[1]?.columns).toEqual([
      { name: "ID", type: "INTEGER NOT NULL PRIMARY KEY" },
      { name: "T", type: "TIME" },
      { name: "TS", type: "TIMESTAMP" },
      { name: "BIG", type: "BIGINT" },
      { name: "SMALL", type: "SMALLINT" },
      { name: "TINY", type: "TINYINT" },
    ]);
  });

  it("recovers every row of every table exactly as HSQLDB 1.8.0.10 itself reported via JDBC", () => {
    const byName = new Map(
      parseHsqldbBinaryScript(hsqldbBinaryScriptBytes(), {
        timeZone: "Europe/London",
      }).tables.map((table) => [table.tableName, table]),
    );
    expect(byName.get("EMPLOYEES")?.rows).toEqual(ORACLE_EMPLOYEES);
    expect(byName.get("TYPE_TEST")?.rows).toEqual(ORACLE_TYPE_TEST);
    // A table with no rows still writes a full init/terminator pair of its own — the section is present and carries zero rows, not absent.
    expect(byName.get("EMPTY_TABLE")?.rows).toEqual([]);
  });

  it("honours a caller-supplied timeZone for the date/time values it decodes", () => {
    const byName = new Map(
      parseHsqldbBinaryScript(hsqldbBinaryScriptBytes(), {
        timeZone: "America/New_York",
      }).tables.map((table) => [table.tableName, table]),
    );
    // Midnight Europe/London on 2020-01-15 is 19:00 the previous day in New York.
    expect(byName.get("EMPLOYEES")?.rows[0]?.[3]).toEqual({
      kind: "date",
      value: "2020-01-14",
    });
  });
});

describe("inflateHsqldbCompressedScript: the real hsqldb.script_format=3 fixture", () => {
  it("inflates to a byte-identical copy of the BINARY-format script the same database wrote", () => {
    expect(
      inflateHsqldbCompressedScript(hsqldbCompressedScriptBytes()),
    ).toEqual(hsqldbBinaryScriptBytes());
  });

  it("decodes, once inflated, to the identical tables and rows", () => {
    const compressed = parseHsqldbBinaryScript(
      inflateHsqldbCompressedScript(hsqldbCompressedScriptBytes()),
    );
    expect(compressed).toEqual(
      parseHsqldbBinaryScript(hsqldbBinaryScriptBytes()),
    );
  });
});

describe("parseHsqldbBinaryScript: malformed input fails loudly and specifically", () => {
  it("throws for a leading record that is not a Result at all", () => {
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setInt32(0, 16, false); // a plausible record length...
    new DataView(bytes.buffer).setInt32(4, 1, false); // ...but Result mode UPDATECOUNT, never a script's own DDL result.
    expect(() => parseHsqldbBinaryScript(bytes)).toThrow(
      HsqldbBinaryScriptParseError,
    );
    expect(() => parseHsqldbBinaryScript(bytes)).toThrow(/Result mode 1/);
  });

  it("throws for an implausible leading record length rather than reading past the buffer", () => {
    const bytes = new Uint8Array(8);
    expect(() => parseHsqldbBinaryScript(bytes)).toThrow(
      /implausible length 0/,
    );
  });

  it("throws when the stream ends mid-record", () => {
    const truncated = hsqldbBinaryScriptBytes().subarray(0, 300);
    expect(() => parseHsqldbBinaryScript(new Uint8Array(truncated))).toThrow(
      HsqldbBinaryScriptParseError,
    );
  });
});

// --- Mutation-gap coverage: precise byte offsets into the real hsqldb.script_format=1 fixture ------
//
// Offsets below were derived by walking hsqldbBinaryScriptBytes() with the identical field layout this module's own readers expect (recordLength, mode, dbId, sessionId, columnCount at byte 16, column 0's type at byte 20, rowCount at byte 85, table 0's own init length at byte 566, its schema flag at byte 583, its first row length at byte 597, its trailing row count at byte 794). Patching a single fixed-width int16/int32 field in place, without touching any length-prefixed string's own declared length, keeps every byte offset after it valid.

function int32At(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  new DataView(copy.buffer).setInt32(offset, value, false);
  return copy;
}
function int16At(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  new DataView(copy.buffer).setInt16(offset, value, false);
  return copy;
}
function byteAt(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[offset] = value;
  return copy;
}

describe("parseHsqldbBinaryScript: malformed input (mutation gap: each validation branch in isolation)", () => {
  it("accepts a genuinely zero-length stream boundary but rejects one byte short of it", () => {
    // hasRecordLength() must permit reading a 4-byte length field when EXACTLY 4 bytes remain, not only when strictly more than 4 remain.
    const fits = hsqldbBinaryScriptBytes().subarray(0, 570); // ends exactly at table 0's own 4-byte init-length field
    expect(() => parseHsqldbBinaryScript(new Uint8Array(fits))).toThrow(
      /stream ends after 570 bytes/,
    );
    // One byte short: hasRecordLength() must correctly report false, ending the table-section loop gracefully rather than attempting to read a field the stream can't supply.
    const short = hsqldbBinaryScriptBytes().subarray(0, 569);
    const { tables } = parseHsqldbBinaryScript(new Uint8Array(short));
    expect(tables.every((table) => table.rows.length === 0)).toBe(true);
  });

  it("throws with the exact byte count when the stream cannot even supply the leading record's own length field", () => {
    expect(() => parseHsqldbBinaryScript(new Uint8Array(3))).toThrow(
      HsqldbBinaryScriptParseError,
    );
    expect(() => parseHsqldbBinaryScript(new Uint8Array(3))).toThrow(
      /stream ends after 3 bytes/,
    );
  });

  it("accepts a zero column count as zero columns, not as a negative-count error", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 16, 0);
    // A zero-column DDL result is never valid HSQLDB output (it always carries the single VARCHAR COMMAND column), so this must fail the "exactly 1 VARCHAR column" check, not the earlier negative-count one.
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /has 0 column\(s\)/,
    );
  });

  it("accepts a zero row count as zero rows, not as a negative-count error", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 85, 0);
    // With no DDL rows at all, scriptText is empty and no table gets declared. The data section's own EMPLOYEES rows then have nowhere to attach, a later, different error than a negative row count would produce.
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /never declared/,
    );
  });

  it("rejects a DDL result whose single column is not VARCHAR, even though the column count is exactly right", () => {
    const patched = int16At(hsqldbBinaryScriptBytes(), 20, 4); // SQL_TYPE_INTEGER, not VARCHAR (12)
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /type \[4\]/,
    );
  });

  it("throws when the data section names a table the DDL never declared", () => {
    const bytes = hsqldbBinaryScriptBytes();
    // table 0's own name starts at byte 574 ('EMPLOYEES'); flipping its first character breaks the case-insensitive match against every DDL table name without disturbing the string's own declared length.
    const patched = byteAt(bytes, 574, "Z".charCodeAt(0));
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /table "ZMPLOYEES", which the script's own DDL never declared/,
    );
  });

  it("rejects a table init record whose schema flag is neither the with-schema nor the without-schema constant", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 583, 2);
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /schema flag 2, which is neither 0 nor 1/,
    );
  });

  it("throws for a row that declares a negative length", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 597, -1);
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /declares a negative length -1/,
    );
  });

  it("throws when a row's own field data overruns its declared length", () => {
    // Table 0's first row genuinely needs 57 bytes; declaring only 20 lets the real field-value read (unaware of the artificially shrunk declaration) run past the row's own boundary.
    const patched = int32At(hsqldbBinaryScriptBytes(), 597, 20);
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /overran its own declared length/,
    );
  });

  it("throws when a table's own trailing row count disagrees with how many rows the section actually carried", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 794, 5); // the section genuinely carries 4
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /declares 5 row\(s\) in its own terminator but the section carried 4/,
    );
  });
});

describe("parseHsqldbBinaryScript: malformed input (mutation gap: the existing error assertions now check message text too)", () => {
  it("names the actual, wrong Result mode in the thrown message", () => {
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setInt32(0, 16, false);
    new DataView(bytes.buffer).setInt32(4, 1, false);
    expect(() => parseHsqldbBinaryScript(bytes)).toThrow(
      /Result mode 1, not the DATA mode \(3\)/,
    );
  });

  it("names the actual, implausible declared length in the thrown message", () => {
    const bytes = new Uint8Array(8);
    expect(() => parseHsqldbBinaryScript(bytes)).toThrow(
      /declares an implausible length 0/,
    );
  });
});

function removeBytes(
  bytes: Uint8Array,
  start: number,
  count: number,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(new ArrayBuffer(bytes.length - count));
  result.set(bytes.subarray(0, start), 0);
  result.set(bytes.subarray(start + count), start);
  return result;
}

describe("parseHsqldbBinaryScript: malformed input (mutation gap round 2: require() call sites and negative-length branches)", () => {
  it("prefixes the thrown message with the exact byte offset it failed at", () => {
    const bytes = new Uint8Array(3);
    expect(() => parseHsqldbBinaryScript(bytes)).toThrow(
      /HSQLDB binary script parse error at byte offset 0: /,
    );
  });

  it("throws (rather than reading past the buffer) when only one of a column type's own two length bytes remain", () => {
    const truncated = hsqldbBinaryScriptBytes().subarray(0, 21); // column 0's own SQL type field starts at byte 20 and needs 2 bytes
    expect(() => parseHsqldbBinaryScript(new Uint8Array(truncated))).toThrow(
      HsqldbBinaryScriptParseError,
    );
    expect(() => parseHsqldbBinaryScript(new Uint8Array(truncated))).toThrow(
      /stream ends after 21 bytes while reading column 0's own SQL type/,
    );
  });

  it("throws for a string whose own declared length is negative", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 30, -1); // column 0's own label length prefix
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /column 0's own label declares a negative length -1/,
    );
  });

  it("throws (rather than reading past the buffer) when a string's own declared length exceeds what the stream can supply", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 30, 999_999); // column 0's own label length prefix
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      HsqldbBinaryScriptParseError,
    );
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /while reading column 0's own label/,
    );
  });

  it("throws for a genuinely negative column count, distinct from the zero-column case", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 16, -1);
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /the DDL result declares a negative column count -1/,
    );
  });

  it("throws for a genuinely negative row count, distinct from the zero-row case", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 85, -1);
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /the DDL result declares a negative row count -1/,
    );
  });

  it("throws (rather than reading past the buffer) when a DDL statement's own value byte is missing", () => {
    const truncated = hsqldbBinaryScriptBytes().subarray(0, 89); // row 0's own null-indicator byte starts at byte 89
    expect(() => parseHsqldbBinaryScript(new Uint8Array(truncated))).toThrow(
      /while reading DDL statement 0/,
    );
  });

  it("throws when the leading DDL result record consumes more bytes than its own declared length promised", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 0, 20); // the real record genuinely needs 566 bytes
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /overran its own declared length \(consumed 566 bytes, declared 20\)/,
    );
  });

  it("accepts a table init record whose schema-presence flag is genuinely 0 (no schema name follows), and still recovers its rows", () => {
    const bytes = hsqldbBinaryScriptBytes();
    const flagged = int32At(bytes, 583, 0);
    // The schema name string that would have followed a flag of 1 ('PUBLIC', a 4-byte length prefix plus 6 bytes) is never read when the flag is genuinely 0, so it must be spliced out for the rest of the section to stay aligned.
    const spliced = removeBytes(flagged, 587, 10);
    const byName = new Map(
      parseHsqldbBinaryScript(spliced, {
        timeZone: "Europe/London",
      }).tables.map((table) => [table.tableName, table]),
    );
    expect(byName.get("EMPLOYEES")?.rows).toEqual(ORACLE_EMPLOYEES);
  });

  it("throws for a row whose own field data overruns its declared length, naming the exact bytes consumed", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 597, 20);
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /overran its own declared length \(consumed 57 bytes, declared 20\)/,
    );
  });
});

describe("parseHsqldbBinaryScript: malformed input (mutation gap round 3: error identity, field-boundary truncation, and an empty table/column name)", () => {
  it("names the error by its own class, not merely by instanceof", () => {
    let caught: unknown;
    try {
      parseHsqldbBinaryScript(new Uint8Array(3));
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe("HsqldbBinaryScriptParseError");
  });

  it("decodes a genuinely NULL DDL statement value as an error naming its actual kind", () => {
    const patched = byteAt(hsqldbBinaryScriptBytes(), 89, 0); // row 0's own null-indicator byte
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /DDL statement 0 decoded as a empty value rather than a string/,
    );
  });

  it("throws (rather than reading past the buffer) when a string's own length prefix is itself truncated", () => {
    const truncated = hsqldbBinaryScriptBytes().subarray(0, 33); // column 0's own label length prefix starts at byte 30 and needs 4 bytes
    expect(() => parseHsqldbBinaryScript(new Uint8Array(truncated))).toThrow(
      /while reading column 0's own label's own length prefix/,
    );
  });

  it("throws (rather than reading past the buffer) when the column count field is itself truncated", () => {
    const truncated = hsqldbBinaryScriptBytes().subarray(0, 19); // the column count field starts at byte 16 and needs 4 bytes
    expect(() => parseHsqldbBinaryScript(new Uint8Array(truncated))).toThrow(
      /while reading the DDL result's own column count/,
    );
  });

  it("throws (rather than reading past the buffer) when a column's own declared size field is itself truncated", () => {
    const truncated = hsqldbBinaryScriptBytes().subarray(0, 25); // column 0's own declared size starts at byte 22 and needs 4 bytes
    expect(() => parseHsqldbBinaryScript(new Uint8Array(truncated))).toThrow(
      /while reading column 0's own declared size/,
    );
  });

  it("throws (rather than reading past the buffer) when a column's own declared scale field is itself truncated", () => {
    const truncated = hsqldbBinaryScriptBytes().subarray(0, 29); // column 0's own declared scale starts at byte 26 and needs 4 bytes
    expect(() => parseHsqldbBinaryScript(new Uint8Array(truncated))).toThrow(
      /while reading column 0's own declared scale/,
    );
  });

  it("throws (rather than reading past the buffer) when a column's own table name content overruns the stream", () => {
    const patched = int32At(hsqldbBinaryScriptBytes(), 41, 999_999); // column 0's own table name length prefix
    expect(() => parseHsqldbBinaryScript(new Uint8Array(patched))).toThrow(
      /while reading column 0's own table name/,
    );
  });

  it("treats a record length of exactly 4 (no room for anything beyond the length field itself) as implausible, not merely one below it", () => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setInt32(0, 4, false);
    expect(() => parseHsqldbBinaryScript(bytes)).toThrow(
      /declares an implausible length 4/,
    );
  });
});
