import { bytesToBase64 } from "documents.js";
import { el, encodePackage } from "odf.js";
import { describe, expect, it } from "vitest";
import { charSubstitutionOdbBytes } from "../test-support/odb-char-substitution-fixture";
import {
  FORM_AND_REPORT_ODB_PATH,
  loadFormAndReportOdbBytes,
} from "../test-support/odb-fixture";
import {
  odbFormsOperation,
  odbQueryOperation,
  odbReportsOperation,
  odbTablesOperation,
  odbToCsvOperation,
  odbToXlsxOperation,
} from "./odb";

const source = {
  bytesBase64: bytesToBase64(loadFormAndReportOdbBytes()),
  format: "docx" as const,
};

// A minimal, hand-authored .odb declaring two saved queries and nothing else -- resolveSavedQuerySql's own "not found" message throws before ever reading table data, so no table/report/manifest is needed here at all. Exists to prove the "Available: ..." suffix genuinely joins every declared query name with ", " rather than concatenating them bare, which a single-query fixture (this file's own `source` above) cannot distinguish.
function twoSavedQueriesOdbBytes(): Uint8Array<ArrayBuffer> {
  return encodePackage({
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: [
          el("office:document-content", {}, [
            el("office:body", {}, [
              el("office:database", {}, [
                el("db:queries", {}, [
                  el("db:query", {
                    "db:name": "QueryOne",
                    "db:command": "SELECT * FROM T",
                  }),
                  el("db:query", {
                    "db:name": "QueryTwo",
                    "db:command": "SELECT * FROM T",
                  }),
                ]),
              ]),
            ]),
          ]),
        ],
      },
    },
  });
}

describe("odbTablesOperation", () => {
  it("lists the fixture's own SALES table", async () => {
    const tables = await odbTablesOperation.run({ source });
    expect(tables.some((table) => table.tableName === "SALES")).toBe(true);
  });

  it("reads the identical tables from a real filesystem path", async () => {
    const tables = await odbTablesOperation.run({
      source: { path: FORM_AND_REPORT_ODB_PATH },
    });
    expect(tables.some((table) => table.tableName === "SALES")).toBe(true);
  });
});

describe("odbFormsOperation", () => {
  it("lists the fixture's own SalesForm", async () => {
    const forms = await odbFormsOperation.run({ source });
    expect(forms.some((form) => form.name === "SalesForm")).toBe(true);
  });
});

describe("odbReportsOperation", () => {
  it("lists the fixture's own SalesByRegion report", async () => {
    const reports = await odbReportsOperation.run({ source });
    expect(reports.some((report) => report.name === "SalesByRegion")).toBe(
      true,
    );
  });
});

describe("odbQueryOperation", () => {
  it("runs a literal SELECT over the SALES table", async () => {
    const result = await odbQueryOperation.run({
      source,
      sql: "SELECT * FROM SALES",
    });
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("runs a saved query by name, resolving it against the .odb's own declared queries", async () => {
    const result = await odbQueryOperation.run({
      source,
      query: "HighValueSales",
    });
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("rejects a saved query name the .odb declares no such query for, naming every available one", async () => {
    await expect(
      odbQueryOperation.run({ source, query: "NoSuchSavedQuery" }),
    ).rejects.toThrow(
      'This .odb declares no saved query named "NoSuchSavedQuery". Available: HighValueSales.',
    );
  });

  it("joins several available saved query names with a comma", async () => {
    const twoQuerySource = {
      bytesBase64: bytesToBase64(twoSavedQueriesOdbBytes()),
      format: "docx" as const,
    };

    await expect(
      odbQueryOperation.run({ source: twoQuerySource, query: "NoSuchQuery" }),
    ).rejects.toThrow(
      'This .odb declares no saved query named "NoSuchQuery". Available: QueryOne, QueryTwo.',
    );
  });

  it("omits the 'Available' suffix entirely when the .odb declares no saved queries at all", async () => {
    const noQuerySource = {
      bytesBase64: bytesToBase64(charSubstitutionOdbBytes()),
      format: "docx" as const,
    };

    // Anchored top to bottom, not a substring match: the message this test guards against is a mutant that always computes the "Available: ..." suffix (dropping the available.length === 0 check, or replacing its own "" branch with non-empty text) while an empty query list still joins to "" -- a plain substring check on the sentence's own leading clause would pass either way, since that clause is an unchanged prefix of the corrupted message too.
    await expect(
      odbQueryOperation.run({ source: noQuerySource, query: "AnyName" }),
    ).rejects.toThrow(/^This \.odb declares no saved query named "AnyName"\.$/);
  });

  it("rejects supplying both sql and query", async () => {
    await expect(
      odbQueryOperation.run({
        source,
        sql: "SELECT * FROM SALES",
        query: "HighValueSales",
      }),
    ).rejects.toThrow(/not both/);
  });

  it("rejects supplying neither sql nor query", async () => {
    await expect(odbQueryOperation.run({ source })).rejects.toThrow(
      /Provide either/,
    );
  });
});

describe("odbToCsvOperation", () => {
  it("exports the SALES table as CSV bytes", async () => {
    const result = await odbToCsvOperation.run({ source, table: "SALES" });
    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("propagates an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      odbToCsvOperation.run(
        { source, table: "SALES" },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });
});

describe("odbToXlsxOperation", () => {
  it("exports every table into one xlsx workbook", async () => {
    const result = await odbToXlsxOperation.run({ source });
    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("propagates an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      odbToXlsxOperation.run({ source }, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
