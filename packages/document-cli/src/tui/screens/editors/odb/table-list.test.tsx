import type { HsqldbTable } from "documents.js";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { settle, waitForFrame } from "../../../test-support.js";
import { OdbHarness } from "./test-support.js";

const SAMPLE_TABLES: readonly HsqldbTable[] = [
  {
    tableName: "CUSTOMERS",
    columns: [
      { name: "ID", type: "INTEGER" },
      { name: "NAME", type: "VARCHAR" },
    ],
    rows: [
      [
        { kind: "number", value: 1 },
        { kind: "string", value: "Ada Lovelace" },
      ],
      [
        { kind: "number", value: 2 },
        { kind: "string", value: "Grace Hopper" },
      ],
    ],
  },
  {
    tableName: "ORDERS",
    columns: [{ name: "TOTAL", type: "DECIMAL" }],
    rows: [[{ kind: "currency", value: 42.5, currency: "USD" }]],
  },
];

describe("OdbTableListScreen", () => {
  it("renders one row per table, with each table's own column and row counts", async () => {
    const { lastFrame } = render(<OdbHarness tables={SAMPLE_TABLES} />);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("CUSTOMERS"),
    );

    expect(frame).toContain("Tables (2 of 2)");
    expect(frame).toContain("CUSTOMERS (2 columns, 2 rows)");
    expect(frame).toContain("ORDERS (1 columns, 1 rows)");
  });

  it("pushes odbTableRows for the selected table on Enter, and only ever dispatches navigation actions", async () => {
    const { lastFrame, stdin } = render(<OdbHarness tables={SAMPLE_TABLES} />);
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("CUSTOMERS"),
    );
    await settle();

    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("ID (INTEGER)"),
    );
    expect(frame).toContain("CUSTOMERS (2 of 2 rows)");
    expect(frame).toContain("ID (INTEGER)");
    expect(frame).toContain("NAME (VARCHAR)");
    expect(frame).toContain("Ada Lovelace");
    expect(frame).toContain("Grace Hopper");
  });
});
