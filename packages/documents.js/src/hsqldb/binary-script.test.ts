import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hsqldbBinaryScriptBytes,
  hsqldbCompressedScriptBytes,
} from "../test-support/odb";
import {
  HsqldbBinaryScriptParseError,
  inflateHsqldbCompressedScript,
  parseHsqldbBinaryScript,
} from "./binary-script";

// The fixtures' own DATE/TIME/TIMESTAMP values were written by a JVM in Europe/London, and -- per src/hsqldb/rowformat.ts's own documented, inherent format limitation -- an epoch-millisecond value only decodes back to its original calendar fields when read in the zone it was written in. Pinned here, not globally, so this file's own TZ mutation never leaks into a sibling test file sharing the same vitest worker process.
let previousTz: string | undefined;
beforeAll(() => {
  previousTz = process.env.TZ;
  process.env.TZ = "Europe/London";
});
afterAll(() => {
  if (previousTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = previousTz;
  }
});

// Exactly what HSQLDB 1.8.0.10 itself reported when it re-opened each generated database and ran SELECT * over every table through its own JDBC driver -- see src/hsqldb/binary-script.ts's own module comment for the generation/oracle account.
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
      parseHsqldbBinaryScript(hsqldbBinaryScriptBytes()).tables.map((table) => [
        table.tableName,
        table,
      ]),
    );
    expect(byName.get("EMPLOYEES")?.rows).toEqual(ORACLE_EMPLOYEES);
    expect(byName.get("TYPE_TEST")?.rows).toEqual(ORACLE_TYPE_TEST);
    // A table with no rows still writes a full init/terminator pair of its own -- the section is present and carries zero rows, not absent.
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
