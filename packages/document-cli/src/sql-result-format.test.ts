import type { ContentCellValue } from "documents.js";
import { describe, expect, it } from "vitest";
import { formatSqlResultSetTable } from "./sql-result-format";

function str(value: string): ContentCellValue {
  return { kind: "string", value };
}

function num(value: number): ContentCellValue {
  return { kind: "number", value };
}

describe("formatSqlResultSetTable", () => {
  it("renders a header, a rule line, one line per row, and a plural row-count summary", () => {
    const lines = formatSqlResultSetTable({
      columns: ["NAME", "AGE"],
      rows: [
        [str("Alice"), num(30)],
        [str("Bob"), num(25)],
      ],
    });
    expect(lines).toEqual([
      "NAME   AGE",
      "-----  ---",
      "Alice  30",
      "Bob    25",
      "2 rows",
    ]);
  });

  it("uses the singular 'row' for exactly one row", () => {
    const lines = formatSqlResultSetTable({
      columns: ["NAME"],
      rows: [[str("Alice")]],
    });
    expect(lines.at(-1)).toBe("1 row");
  });

  it("uses the plural 'rows' for zero rows", () => {
    const lines = formatSqlResultSetTable({ columns: ["NAME"], rows: [] });
    expect(lines.at(-1)).toBe("0 rows");
  });

  it("widens a column to fit its longest cell, not just the header", () => {
    const lines = formatSqlResultSetTable({
      columns: ["N"],
      rows: [[str("Alexandria")]],
    });
    expect(lines[0]).toBe("N");
    expect(lines[1]).toBe("-".repeat("Alexandria".length));
    expect(lines[2]).toBe("Alexandria");
  });

  it("widens a column to fit the header when it is longer than every cell", () => {
    const lines = formatSqlResultSetTable({
      columns: ["VERY_LONG_HEADER"],
      rows: [[str("x")]],
    });
    expect(lines[0]).toBe("VERY_LONG_HEADER");
    expect(lines[1]).toBe("-".repeat("VERY_LONG_HEADER".length));
    expect(lines[2]).toBe("x");
  });

  it("separates columns with exactly two spaces and trims trailing padding", () => {
    const lines = formatSqlResultSetTable({
      columns: ["A", "B"],
      rows: [[str("1"), str("22")]],
    });
    // 'A' padded to width 1, then two literal spaces, then 'B' padded to width 2 -- but the last column is never padded, since formatRow trims trailing whitespace.
    expect(lines[0]).toBe("A  B");
    expect(lines[2]).toBe("1  22");
  });

  it("renders every ContentCellValue kind through hsqldbCellDisplayText", () => {
    const lines = formatSqlResultSetTable({
      columns: ["V"],
      rows: [
        [{ kind: "boolean", value: true }],
        [{ kind: "boolean", value: false }],
        [{ kind: "empty" }],
        [{ kind: "currency", value: 5, currency: "USD" }],
        [{ kind: "percentage", value: 0.5 }],
      ],
    });
    expect(lines.slice(2, -1)).toEqual(["TRUE", "FALSE", "", "5 USD", "50%"]);
  });
});
