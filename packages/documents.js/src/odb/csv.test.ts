import type { HsqldbTable } from "../hsqldb/script";
import { describe, expect, it } from "vitest";
import {
  buildOdbTableCsv,
  OdbTableNotFoundError,
  OdbTableNotSpecifiedError,
} from "./csv";

const CUSTOMERS: HsqldbTable = {
  tableName: "CUSTOMERS",
  columns: [
    { name: "ID", type: "INTEGER" },
    { name: "NAME", type: "VARCHAR(50)" },
    { name: "NOTES", type: "VARCHAR(100)" },
  ],
  rows: [
    [
      { kind: "number", value: 1 },
      { kind: "string", value: "Alice" },
      { kind: "string", value: 'says "hi", often' },
    ],
    [
      { kind: "number", value: 2 },
      { kind: "string", value: "Bob" },
      { kind: "empty" },
    ],
  ],
};

const ORDERS: HsqldbTable = {
  tableName: "ORDERS",
  columns: [{ name: "ID", type: "INTEGER" }],
  rows: [[{ kind: "number", value: 1 }]],
};

describe("buildOdbTableCsv", () => {
  it("writes a header row of column names, then one CSV row per table row, CRLF-terminated", () => {
    const bytes = buildOdbTableCsv([CUSTOMERS], undefined);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(
      'ID,NAME,NOTES\r\n1,Alice,"says ""hi"", often"\r\n2,Bob,\r\n',
    );
  });

  it("quotes a field containing a comma and doubles an embedded double quote", () => {
    const bytes = buildOdbTableCsv([CUSTOMERS], "CUSTOMERS");
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('"says ""hi"", often"');
  });

  it("selects the sole table when table is omitted and exactly one table exists", () => {
    const bytes = buildOdbTableCsv([ORDERS], undefined);
    expect(new TextDecoder().decode(bytes)).toBe("ID\r\n1\r\n");
  });

  it("throws OdbTableNotSpecifiedError, naming every available table, when table is omitted and more than one exists", () => {
    expect(() => buildOdbTableCsv([CUSTOMERS, ORDERS], undefined)).toThrow(
      OdbTableNotSpecifiedError,
    );
    expect(() => buildOdbTableCsv([CUSTOMERS, ORDERS], undefined)).toThrow(
      /CUSTOMERS, ORDERS/,
    );
  });

  it("throws OdbTableNotFoundError for a table name that does not exist", () => {
    expect(() => buildOdbTableCsv([CUSTOMERS], "NOPE")).toThrow(
      OdbTableNotFoundError,
    );
    expect(() => buildOdbTableCsv([CUSTOMERS], "NOPE")).toThrow(
      /table "NOPE" not found/,
    );
  });
});
