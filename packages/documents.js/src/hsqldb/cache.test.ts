import { base64ToBytes, decodePackage } from "odf.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  embeddedHsqldbCachedOdbBytes,
  embeddedHsqldbMultiIndexOdbBytes,
  HSQLDB_CACHED_PROPERTIES_TEXT,
  HSQLDB_CACHED_SCRIPT_TEXT,
  HSQLDB_MULTI_INDEX_PROPERTIES_TEXT,
  HSQLDB_MULTI_INDEX_SCRIPT_TEXT,
} from "../test-support/odb";
import {
  decodeHsqldbCachedTables,
  parseHsqldbIndexRoots,
  parseHsqldbProperties,
  readHsqldbCachedTableRows,
} from "./cache";
import { HsqldbRowFormatError } from "./rowformat";
import { parseHsqldbScript } from "./script";

// This suite decodes DATE/TIME/TIMESTAMP columns, which -- per src/hsqldb/rowformat.ts's own documented, inherent format limitation -- are only recoverable correctly when read in the same timezone the fixture was written in (Europe/London, spanning both its GMT and BST halves of the year -- see src/test-support/odb.ts's own module comment on why). Pinned here, not globally, so this file's own TZ mutation never leaks into a sibling test file sharing the same vitest worker process.
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

function decodedFixture() {
  const pkg = decodePackage(embeddedHsqldbCachedOdbBytes());
  const dataPart = pkg.parts["database/data"];
  if (dataPart?.kind !== "binary") {
    throw new Error("fixture missing database/data");
  }
  return { pkg, dataBase64: dataPart.base64 };
}

describe("parseHsqldbProperties", () => {
  it("reads the real fixture properties: cacheFileScale 1, a supported compatible_version", () => {
    expect(parseHsqldbProperties(HSQLDB_CACHED_PROPERTIES_TEXT)).toEqual({
      cacheFileScale: 1,
      compatibleVersion: "1.8.0",
    });
  });

  it("mirrors DataFileCache.initParams: any non-1 hsqldb.cache_file_scale value becomes 8, not its own number", () => {
    expect(
      parseHsqldbProperties(
        "hsqldb.cache_file_scale=4\nhsqldb.compatible_version=1.8.0\n",
      ).cacheFileScale,
    ).toBe(8);
  });

  it("defaults cacheFileScale to 1 when the property is absent entirely", () => {
    expect(
      parseHsqldbProperties("hsqldb.compatible_version=1.8.0\n").cacheFileScale,
    ).toBe(1);
  });

  it("throws for a compatible_version outside the supported 1.7.x/1.8.x family", () => {
    expect(() =>
      parseHsqldbProperties("hsqldb.compatible_version=2.0.0\n"),
    ).toThrow(HsqldbRowFormatError);
    expect(() =>
      parseHsqldbProperties("hsqldb.compatible_version=2.0.0\n"),
    ).toThrow(/1\.7\.x\/1\.8\.x/);
  });

  it("ignores banner/timestamp comment lines and blank lines", () => {
    expect(
      parseHsqldbProperties(
        "#HSQL Database Engine 1.8.0.10\n#Sat Aug 01 10:55:02 BST 2026\n\nhsqldb.cache_file_scale=1\n",
      ).cacheFileScale,
    ).toBe(1);
  });
});

describe("parseHsqldbIndexRoots", () => {
  it("reads every SET TABLE...INDEX line from the real fixture script, keyed by uppercased table name", () => {
    const roots = parseHsqldbIndexRoots(HSQLDB_CACHED_SCRIPT_TEXT);
    expect(roots.get("EMPLOYEES")).toEqual({
      rootPosition: 232,
      indexCount: 1,
    });
    expect(roots.get("DEPARTMENTS")).toEqual({
      rootPosition: 512,
      indexCount: 1,
    });
    expect(roots.get("TYPE_TEST")).toEqual({
      rootPosition: 664,
      indexCount: 1,
    });
    expect(roots.has("EMPTY_TABLE")).toBe(false);
  });

  it("unquotes a double-quoted table name and folds it to uppercase, un-doubling an embedded quote", () => {
    const roots = parseHsqldbIndexRoots(
      'SET TABLE "My ""Odd"" Table" INDEX\'42 7\'',
    );
    expect(roots.get('MY "ODD" TABLE')).toEqual({
      rootPosition: 42,
      indexCount: 1,
    });
  });

  it("recovers the index count of a multi-index table from its own root-token count, per the real HSQLDB 1.8.0.10 multi-index fixture", () => {
    const roots = parseHsqldbIndexRoots(HSQLDB_MULTI_INDEX_SCRIPT_TEXT);
    // PRIMARY KEY + UNIQUE(CODE)'s own auto-generated index + an explicit CREATE INDEX.
    expect(roots.get("ORDERS")).toEqual({ rootPosition: 136, indexCount: 3 });
    // No PRIMARY KEY at all: index 0 is HSQLDB's own internal row-position index, index 1 the explicit CREATE INDEX.
    expect(roots.get("NO_PK")).toEqual({ rootPosition: 664, indexCount: 2 });
    expect(roots.get("SINGLE_IDX")).toEqual({
      rootPosition: 528,
      indexCount: 1,
    });
  });

  it("throws for a line carrying no root position at all (only the trailing identity value)", () => {
    expect(() => parseHsqldbIndexRoots("SET TABLE T INDEX'7'")).toThrow(
      HsqldbRowFormatError,
    );
    expect(() => parseHsqldbIndexRoots("SET TABLE T INDEX'7'")).toThrow(
      /at least one index root position/,
    );
  });

  it("throws for a non-integer root position", () => {
    expect(() => parseHsqldbIndexRoots("SET TABLE T INDEX'abc 7'")).toThrow(
      /non-integer root position/,
    );
  });

  it("ignores every other statement kind (case-insensitively) and blank lines", () => {
    const roots = parseHsqldbIndexRoots(
      "CREATE CACHED TABLE T(A INTEGER)\n\nset table t index'5 0'\nGRANT DBA TO SA",
    );
    expect(roots.get("T")).toEqual({ rootPosition: 5, indexCount: 1 });
  });
});

describe("readHsqldbCachedTableRows: byte-level decode against the real fixture", () => {
  it("walks EMPLOYEES from its real root position and recovers every field exactly as HSQLDB 1.8.0.10 itself reported via JDBC (see the module comment in cache.ts for the oracle account)", () => {
    const { dataBase64 } = decodedFixture();
    const dataBytes = base64ToBytes(dataBase64);
    const tables = parseHsqldbScript(
      new TextEncoder().encode(HSQLDB_CACHED_SCRIPT_TEXT),
    );
    const employees = tables.find((table) => table.tableName === "EMPLOYEES");
    if (employees === undefined) {
      throw new Error("fixture script has no EMPLOYEES table");
    }
    const rows = readHsqldbCachedTableRows(
      dataBytes,
      { rootPosition: 232, indexCount: 1 },
      1,
      employees.columns,
    );
    expect(rows).toEqual([
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
      [
        { kind: "number", value: 5 },
        { kind: "string", value: "Dave Lee" },
        { kind: "number", value: 48000 },
        { kind: "date", value: "2022-03-22" },
        { kind: "boolean", value: false },
        { kind: "number", value: 0 },
      ],
      [
        { kind: "number", value: 6 },
        { kind: "string", value: "Erin Wu" },
        { kind: "number", value: 105000.25 },
        { kind: "date", value: "2018-09-09" },
        { kind: "boolean", value: true },
        { kind: "number", value: 5000 },
      ],
      [
        { kind: "number", value: 7 },
        { kind: "string", value: "Frank Zed" },
        { kind: "empty" },
        { kind: "date", value: "2023-07-04" },
        { kind: "empty" },
        { kind: "empty" },
      ],
    ]);
  });

  it("returns an empty array for root position -1 without touching the data bytes", () => {
    expect(
      readHsqldbCachedTableRows(
        new Uint8Array(0),
        { rootPosition: -1, indexCount: 1 },
        1,
        [{ name: "ID", type: "INTEGER" }],
      ),
    ).toEqual([]);
  });

  it("throws for a row position outside the data bytes", () => {
    expect(() =>
      readHsqldbCachedTableRows(
        new Uint8Array(8),
        { rootPosition: 100, indexCount: 1 },
        1,
        [{ name: "ID", type: "INTEGER" }],
      ),
    ).toThrow(HsqldbRowFormatError);
  });
});

describe("readHsqldbCachedTableRows: caller-supplied timeZone override", () => {
  // The fixture was written by a JVM in Europe/London (see this file's own beforeAll), so its DATE values only decode to their original calendar day when read in that zone. Reading the same bytes in a materially different zone is exactly the "moved to another host" case the default local-timezone behaviour cannot serve, and is what the option exists for.
  function employeeColumns() {
    const employees = parseHsqldbScript(
      new TextEncoder().encode(HSQLDB_CACHED_SCRIPT_TEXT),
    ).find((table) => table.tableName === "EMPLOYEES");
    if (employees === undefined) {
      throw new Error("fixture script has no EMPLOYEES table");
    }
    return employees.columns;
  }

  it("reinterprets DATE values in an explicitly supplied zone, leaving the default (local) behaviour unchanged", () => {
    const dataBytes = base64ToBytes(decodedFixture().dataBase64);
    const columns = employeeColumns();
    const local = readHsqldbCachedTableRows(
      dataBytes,
      { rootPosition: 232, indexCount: 1 },
      1,
      columns,
    );
    const newYork = readHsqldbCachedTableRows(
      dataBytes,
      { rootPosition: 232, indexCount: 1 },
      1,
      columns,
      { timeZone: "America/New_York" },
    );

    // Row 0's HIRE_DATE is midnight Europe/London on 2020-01-15 -- 19:00 the previous day in New York.
    expect(local[0]?.[3]).toEqual({ kind: "date", value: "2020-01-15" });
    expect(newYork[0]?.[3]).toEqual({ kind: "date", value: "2020-01-14" });
    // Explicitly naming the zone the fixture was written in reproduces the default result exactly.
    expect(
      readHsqldbCachedTableRows(
        dataBytes,
        { rootPosition: 232, indexCount: 1 },
        1,
        columns,
        { timeZone: "Europe/London" },
      ),
    ).toEqual(local);
  });

  it("reinterprets TIME and TIMESTAMP values in the supplied zone too, keeping a TIMESTAMP's own nanosecond component intact", () => {
    const dataBytes = base64ToBytes(decodedFixture().dataBase64);
    const typeTest = parseHsqldbScript(
      new TextEncoder().encode(HSQLDB_CACHED_SCRIPT_TEXT),
    ).find((table) => table.tableName === "TYPE_TEST");
    if (typeTest === undefined) {
      throw new Error("fixture script has no TYPE_TEST table");
    }
    const rows = readHsqldbCachedTableRows(
      dataBytes,
      { rootPosition: 664, indexCount: 1 },
      1,
      typeTest.columns,
      { timeZone: "UTC" },
    );
    // 14:30 London wall clock on 1970-01-01, the epoch day HSQLDB normalises a bare TIME onto -- which reads back as 13:30 UTC, not 14:30, because the UK was on permanent UTC+1 ("British Standard Time") from October 1968 to October 1971. A real, checkable offset difference rather than a coincidental match, and one the local-timezone default cannot express at all.
    expect(rows[0]?.[1]).toEqual({ kind: "time", value: "13:30:00" });
    // 09:45:30.123456789 London on 2024-03-15 (GMT that day) -- the same wall clock in UTC, nanoseconds untouched.
    expect(rows[0]?.[2]).toEqual({
      kind: "date",
      value: "2024-03-15 09:45:30.123456789",
    });
  });

  it("throws a RangeError naming the value for an unrecognised time-zone name", () => {
    const dataBytes = base64ToBytes(decodedFixture().dataBase64);
    expect(() =>
      readHsqldbCachedTableRows(
        dataBytes,
        { rootPosition: 232, indexCount: 1 },
        1,
        employeeColumns(),
        { timeZone: "Mars/Olympus_Mons" },
      ),
    ).toThrow(RangeError);
  });
});

describe("decodeHsqldbCachedTables: multi-index CACHED tables, against the real multi-index fixture", () => {
  it("recovers every row of a three-index, a two-index, and a single-index table, matching what HSQLDB 1.8.0.10 itself reported via JDBC", () => {
    const pkg = decodePackage(embeddedHsqldbMultiIndexOdbBytes());
    const dataPart = pkg.parts["database/data"];
    if (dataPart?.kind !== "binary") {
      throw new Error("multi-index fixture missing database/data");
    }
    const tier1Tables = parseHsqldbScript(
      new TextEncoder().encode(HSQLDB_MULTI_INDEX_SCRIPT_TEXT),
    );
    const decoded = decodeHsqldbCachedTables(
      tier1Tables,
      HSQLDB_MULTI_INDEX_SCRIPT_TEXT,
      base64ToBytes(dataPart.base64),
      HSQLDB_MULTI_INDEX_PROPERTIES_TEXT,
    );
    const byName = new Map(decoded.map((table) => [table.tableName, table]));

    expect(byName.get("ORDERS")?.rows).toEqual([
      [
        { kind: "number", value: 1 },
        { kind: "string", value: "A-001" },
        { kind: "string", value: "North" },
        { kind: "number", value: 125.5 },
        { kind: "date", value: "2024-02-11" },
        { kind: "boolean", value: true },
      ],
      [
        { kind: "number", value: 2 },
        { kind: "string", value: "A-002" },
        { kind: "string", value: "South" },
        { kind: "number", value: 99.99 },
        { kind: "date", value: "2024-06-30" },
        { kind: "boolean", value: false },
      ],
      [
        { kind: "number", value: 3 },
        { kind: "empty" },
        { kind: "string", value: "North" },
        { kind: "empty" },
        { kind: "empty" },
        { kind: "empty" },
      ],
      [
        { kind: "number", value: 4 },
        { kind: "string", value: "A-004" },
        { kind: "string", value: "O'Connor Region" },
        { kind: "number", value: 0 },
        { kind: "date", value: "2023-12-25" },
        { kind: "boolean", value: true },
      ],
      [
        { kind: "number", value: 5 },
        { kind: "string", value: "A-005" },
        { kind: "string", value: "West" },
        { kind: "number", value: 7500.75 },
        { kind: "date", value: "2022-07-19" },
        { kind: "boolean", value: false },
      ],
    ]);

    expect(byName.get("NO_PK")?.rows).toEqual([
      [
        { kind: "number", value: 10 },
        { kind: "string", value: "ten" },
      ],
      [
        { kind: "number", value: 20 },
        { kind: "string", value: "twenty" },
      ],
      [{ kind: "number", value: 30 }, { kind: "empty" }],
    ]);

    expect(byName.get("SINGLE_IDX")?.rows).toEqual([
      [
        { kind: "number", value: 1 },
        { kind: "string", value: "single index table" },
      ],
      [{ kind: "number", value: 2 }, { kind: "empty" }],
    ]);
  });
});

describe("decodeHsqldbCachedTables: the Tier 2 orchestration, against the real fixture", () => {
  it("splices real CACHED-table rows into every table that has a SET TABLE...INDEX line, leaving EMPTY_TABLE (no such line) as Tier 1 already produced it", () => {
    const { dataBase64 } = decodedFixture();
    const dataBytes = base64ToBytes(dataBase64);
    const tier1Tables = parseHsqldbScript(
      new TextEncoder().encode(HSQLDB_CACHED_SCRIPT_TEXT),
    );
    const decoded = decodeHsqldbCachedTables(
      tier1Tables,
      HSQLDB_CACHED_SCRIPT_TEXT,
      dataBytes,
      HSQLDB_CACHED_PROPERTIES_TEXT,
    );

    const byName = new Map(decoded.map((table) => [table.tableName, table]));
    expect(byName.get("EMPLOYEES")?.rows).toHaveLength(7);
    expect(byName.get("DEPARTMENTS")?.rows).toEqual([
      [
        { kind: "number", value: 1 },
        { kind: "string", value: "Engineering" },
      ],
      [
        { kind: "number", value: 2 },
        { kind: "string", value: "Sales" },
      ],
    ]);
    expect(byName.get("EMPTY_TABLE")?.rows).toEqual([]);

    const typeTest = byName.get("TYPE_TEST");
    expect(typeTest?.rows).toEqual([
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
    ]);
  });
});
