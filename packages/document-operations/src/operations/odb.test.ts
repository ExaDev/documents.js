import { bytesToBase64 } from "documents.js";
import { describe, expect, it } from "vitest";
import { loadFormAndReportOdbBytes } from "../test-support/odb-fixture";
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

describe("odbTablesOperation", () => {
  it("lists the fixture's own SALES table", async () => {
    const tables = await odbTablesOperation.run({ source });
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
});

describe("odbToXlsxOperation", () => {
  it("exports every table into one xlsx workbook", async () => {
    const result = await odbToXlsxOperation.run({ source });
    expect("bytesBase64" in result).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
  });
});
