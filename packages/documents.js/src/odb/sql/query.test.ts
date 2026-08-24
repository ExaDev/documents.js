import { describe, expect, it } from "vitest";
import { readOdbInventory } from "odf.js";
import { formAndReportOdbPackage } from "../../test-support/odb-fixture";
import { readOdbTables } from "../read";
import { evaluateSelect } from "./evaluate";
import { parseSelect } from "./parser";

// The end-to-end proof for src/odb/sql/: a real saved query, read out of a real .odb, run against that same .odb's own real table data. Nothing here is hand-authored -- the SQL text comes from the package's own db:command via readOdbInventory, and the rows come from readOdbTables' Tier 3 Firebird decoder, so a regression in the parser, the evaluator, the fixture, or the decoder all surface here rather than being papered over by a transcribed expectation.
//
// The fixture is ExaDev/odf.js's own form-and-report.odb (see src/test-support/odb-fixture.ts for its provenance): an embedded-Firebird database whose SALES table holds six rows, and whose saved HighValueSales query filters on AMOUNT and sorts on three columns at once, in mixed directions -- exactly the shape that would expose a broken comparison, an unstable sort, or a mis-ordered ORDER BY term.

const EXPECTED_SAVED_QUERY =
  'SELECT "SALES"."REGION", "SALES"."QUARTER", "SALES"."CUSTOMER", "SALES"."AMOUNT" FROM "SALES" WHERE "SALES"."AMOUNT" >= 100 ORDER BY "SALES"."REGION" ASC, "SALES"."QUARTER" ASC, "SALES"."AMOUNT" DESC';

function savedQuery(): string {
  const query = readOdbInventory(formAndReportOdbPackage()).queries.find(
    (candidate) => candidate.name === "HighValueSales",
  );
  if (query?.command === undefined) {
    throw new Error(
      "fixture regression: form-and-report.odb no longer declares a HighValueSales query with a db:command",
    );
  }
  return query.command;
}

describe("src/odb/sql against the real form-and-report.odb saved query", () => {
  it("reads the saved query text straight out of the package rather than restating it", () => {
    expect(savedQuery()).toBe(EXPECTED_SAVED_QUERY);
  });

  it("reads the real six-row SALES table the query runs against", () => {
    const tables = readOdbTables(formAndReportOdbPackage());
    expect(tables.map((table) => table.tableName)).toEqual(["SALES"]);
    expect(tables[0]?.columns.map((column) => column.name)).toEqual([
      "AMOUNT",
      "ID",
      "REGION",
      "QUARTER",
      "CUSTOMER",
    ]);
    expect(tables[0]?.rows).toHaveLength(6);
  });

  it("executes it to exactly the four rows that pass AMOUNT >= 100, in REGION/QUARTER ascending then AMOUNT descending order", () => {
    const result = evaluateSelect(
      parseSelect(savedQuery()),
      readOdbTables(formAndReportOdbPackage()),
    );

    // The select list reorders and narrows relative to the table's own storage order (AMOUNT, ID, REGION, QUARTER, CUSTOMER) -- ID is dropped entirely and AMOUNT moves last.
    expect(result.columns).toEqual(["REGION", "QUARTER", "CUSTOMER", "AMOUNT"]);

    expect(result.rows).toEqual([
      [
        { kind: "string", value: "North" },
        { kind: "string", value: "Q1" },
        { kind: "string", value: "Acme Ltd" },
        { kind: "number", value: 1200.5 },
      ],
      [
        { kind: "string", value: "North" },
        { kind: "string", value: "Q1" },
        { kind: "string", value: "Bolt Supplies" },
        { kind: "number", value: 340 },
      ],
      [
        { kind: "string", value: "North" },
        { kind: "string", value: "Q2" },
        { kind: "string", value: "Crown Foods" },
        { kind: "number", value: 2750.25 },
      ],
      [
        { kind: "string", value: "South" },
        { kind: "string", value: "Q2" },
        { kind: "string", value: "Everest Tools" },
        { kind: "number", value: 1810 },
      ],
    ]);
  });

  it("drops exactly the two rows below the AMOUNT threshold, and nothing else", () => {
    const tables = readOdbTables(formAndReportOdbPackage());
    const everyCustomer = evaluateSelect(
      parseSelect("SELECT CUSTOMER FROM SALES"),
      tables,
    ).rows.flatMap((row) => (row[0]?.kind === "string" ? [row[0].value] : []));
    const passingCustomers = evaluateSelect(
      parseSelect(savedQuery()),
      tables,
    ).rows.flatMap((row) => (row[2]?.kind === "string" ? [row[2].value] : []));

    expect(everyCustomer).toEqual([
      "Acme Ltd",
      "Bolt Supplies",
      "Crown Foods",
      "Delta Print",
      "Everest Tools",
      "Foxglove Design",
    ]);
    expect(
      everyCustomer.filter((customer) => !passingCustomers.includes(customer)),
    ).toEqual(["Delta Print", "Foxglove Design"]);
  });

  it("aggregates the same real table by region, the query shape the fixture own Report Builder report renders", () => {
    const result = evaluateSelect(
      parseSelect(
        "SELECT REGION, COUNT(*), SUM(AMOUNT), MIN(AMOUNT), MAX(AMOUNT) FROM SALES GROUP BY REGION ORDER BY REGION ASC",
      ),
      readOdbTables(formAndReportOdbPackage()),
    );

    expect(result.columns).toEqual([
      "REGION",
      "COUNT(*)",
      "SUM(AMOUNT)",
      "MIN(AMOUNT)",
      "MAX(AMOUNT)",
    ]);
    expect(result.rows).toEqual([
      [
        { kind: "string", value: "North" },
        { kind: "number", value: 3 },
        { kind: "number", value: 4290.75 },
        { kind: "number", value: 340 },
        { kind: "number", value: 2750.25 },
      ],
      [
        { kind: "string", value: "South" },
        { kind: "number", value: 2 },
        { kind: "number", value: 1905.75 },
        { kind: "number", value: 95.75 },
        { kind: "number", value: 1810 },
      ],
      [
        { kind: "string", value: "West" },
        { kind: "number", value: 1 },
        { kind: "number", value: 60 },
        { kind: "number", value: 60 },
        { kind: "number", value: 60 },
      ],
    ]);
  });
});
