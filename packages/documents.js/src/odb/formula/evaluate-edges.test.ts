import { describe, expect, it } from "vitest";
import type { ContentCellValue } from "document-schema.js";
import type { SqlResultSet } from "../sql/evaluate";
import {
  evaluateRptBandOutsideData,
  runRptReport,
  type RptBandDefinition,
  type RptReportDefinition,
} from "./evaluate";

// The resolution and refusal edges of the report-formula engine: a name that matches both a declared function and a column is ambiguous and says so naming both spellings; an unknown name lists what WAS declared, with an explicit none when nothing was; a function may not refer to itself; name matching falls back case-insensitively but exact wins without ambiguity; and a per-row formula evaluated outside any row names the construct that needed one.

function text(value: string): ContentCellValue {
  return { kind: "string", value };
}

function amount(value: number): ContentCellValue {
  return { kind: "number", value };
}

function resultSet(
  columns: readonly string[],
  rows: readonly (readonly ContentCellValue[])[],
): SqlResultSet {
  return { columns, rows };
}

function band(...formulas: readonly (string | undefined)[]): RptBandDefinition {
  return { formulas };
}

function report(definition: Partial<RptReportDefinition>): RptReportDefinition {
  return {
    functions: definition.functions ?? [],
    reportHeader: definition.reportHeader,
    groups: definition.groups ?? [],
    detail: definition.detail,
    reportFooter: definition.reportFooter,
  };
}

describe("reference resolution", () => {
  it("a name matching both a declared function and a column is ambiguous, naming both", () => {
    expect(() =>
      runRptReport(
        report({
          functions: [{ name: "X", formula: "rpt:SUM([V])" }],
          detail: band("field:[X]"),
        }),
        resultSet(["X", "V"], [[text("a"), amount(1)]]),
      ),
    ).toThrow('reference "X" is ambiguous');
    expect(() =>
      runRptReport(
        report({
          functions: [{ name: "X", formula: "rpt:SUM([V])" }],
          detail: band("field:[X]"),
        }),
        resultSet(["X", "V"], [[text("a"), amount(1)]]),
      ),
    ).toThrow("rpt:function X");
    expect(() =>
      runRptReport(
        report({
          functions: [{ name: "X", formula: "rpt:SUM([V])" }],
          detail: band("field:[X]"),
        }),
        resultSet(["X", "V"], [[text("a"), amount(1)]]),
      ),
    ).toThrow("column X");
  });

  it("an unknown name lists the declared functions and columns", () => {
    expect(() =>
      runRptReport(
        report({
          functions: [{ name: "F1", formula: "rpt:SUM([C1])" }],
          detail: band("field:[Z]"),
        }),
        resultSet(["C1"], [[amount(1)]]),
      ),
    ).toThrow("functions: F1");
    expect(() =>
      runRptReport(
        report({
          functions: [{ name: "F1", formula: "rpt:SUM([C1])" }],
          detail: band("field:[Z]"),
        }),
        resultSet(["C1"], [[amount(1)]]),
      ),
    ).toThrow("columns: C1");
  });

  it("an unknown name with nothing declared says none for both sides", () => {
    expect(() =>
      evaluateRptBandOutsideData(
        report({}),
        band("rpt:SUM([Z])"),
        resultSet([], [[]]),
      ),
    ).toThrow("functions: (none)");
    expect(() =>
      evaluateRptBandOutsideData(
        report({}),
        band("rpt:SUM([Z])"),
        resultSet([], [[]]),
      ),
    ).toThrow("columns: (none)");
  });

  it("a function may not refer to itself, directly or through another", () => {
    expect(() =>
      runRptReport(
        report({
          functions: [{ name: "S", formula: "field:[S]" }],
          detail: band("field:[S]"),
        }),
        resultSet(["V"], [[amount(1)]]),
      ),
    ).toThrow('rpt:function "S" refers to itself');
  });

  it("name matching falls back case-insensitively, and an exact match wins without ambiguity", () => {
    const rows = resultSet(["V"], [[amount(1)], [amount(2)]]);
    const lowered = runRptReport(
      report({
        functions: [{ name: "Total", formula: "rpt:SUM([V])" }],
        detail: band("field:[total]"),
      }),
      rows,
    );
    expect(
      lowered.bands
        .filter((instance) => instance.kind === "detail")
        .map((instance) => instance.values[0]),
    ).toEqual([
      { kind: "number", value: 3 },
      { kind: "number", value: 3 },
    ]);

    const columnLowered = runRptReport(
      report({ detail: band("field:[v]") }),
      rows,
    );
    expect(
      columnLowered.bands
        .filter((instance) => instance.kind === "detail")
        .map((instance) => instance.values[0]),
    ).toEqual([
      { kind: "number", value: 1 },
      { kind: "number", value: 2 },
    ]);

    // Two functions differing only in case are not ambiguous for an exact reference: the exact match alone is used.
    const exact = runRptReport(
      report({
        functions: [
          { name: "T", formula: "rpt:SUM([V])" },
          { name: "t", formula: "rpt:COUNT([V])" },
        ],
        detail: band("field:[T]"),
      }),
      rows,
    );
    expect(
      exact.bands
        .filter((instance) => instance.kind === "detail")
        .map((instance) => instance.values[0]),
    ).toEqual([
      { kind: "number", value: 3 },
      { kind: "number", value: 3 },
    ]);
  });
});

describe("per-row formulas outside any row", () => {
  it("a field reference names what it was", () => {
    expect(() =>
      evaluateRptBandOutsideData(
        report({}),
        band("field:[V]"),
        resultSet(["V"], [[amount(1)]]),
      ),
    ).toThrow("a field: reference");
  });

  it("rpt:HASCHANGED names itself", () => {
    expect(() =>
      evaluateRptBandOutsideData(
        report({}),
        band('rpt:HASCHANGED("V")'),
        resultSet(["V"], [[amount(1)]]),
      ),
    ).toThrow("rpt:HASCHANGED");
  });

  it("rpt:LEFT names itself", () => {
    expect(() =>
      evaluateRptBandOutsideData(
        report({}),
        band("rpt:LEFT([V];2)"),
        resultSet(["V"], [[text("abcd")]]),
      ),
    ).toThrow("rpt:LEFT");
  });
});
