import type { ContentCellValue } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { HsqldbTable } from "../../hsqldb/script";
import { evaluateSelect } from "./evaluate";
import { parseSelect } from "./parser";
const DEPARTMENTS: HsqldbTable = {
  tableName: "DEPARTMENTS",
  columns: [
    { name: "NAME", type: "VARCHAR(20)" },
    { name: "BUDGET", type: "DECIMAL(10,2)" },
  ],
  rows: [
    [text("Sales"), num(50000)],
    [text("Eng"), num(80000)],
    [text("Marketing"), num(30000)],
  ],
};

// One hand-built table covering every value shape this engine has to reason about: text, numeric, boolean, and date columns, with a deliberate NULL in each nullable one — SALARY on Bob, ACTIVE on Dave, HIRED on Carol and Frank, DEPT on Erin and Frank (two rows, so GROUP BY's own "all NULLs are one group" rule has something to prove). The real-fixture end-to-end test lives in src/odb/sql/query.test.ts; this file is the semantics suite.
const NULL_VALUE: ContentCellValue = { kind: "empty" };

function text(value: string): ContentCellValue {
  return { kind: "string", value };
}

function num(value: number): ContentCellValue {
  return { kind: "number", value };
}

function bool(value: boolean): ContentCellValue {
  return { kind: "boolean", value };
}

function date(value: string): ContentCellValue {
  return { kind: "date", value };
}

const EMPLOYEES: HsqldbTable = {
  tableName: "EMPLOYEES",
  columns: [
    { name: "NAME", type: "VARCHAR(20)" },
    { name: "DEPT", type: "VARCHAR(20)" },
    { name: "SALARY", type: "DECIMAL(10,2)" },
    { name: "ACTIVE", type: "BOOLEAN" },
    { name: "HIRED", type: "DATE" },
  ],
  rows: [
    [text("Alice"), text("Sales"), num(1000), bool(true), date("2024-01-15")],
    [text("Bob"), text("Sales"), NULL_VALUE, bool(false), date("2024-03-01")],
    [text("Carol"), text("Eng"), num(2000), bool(true), NULL_VALUE],
    [text("Dave"), text("Eng"), num(1500), NULL_VALUE, date("2023-07-04")],
    [text("Erin"), NULL_VALUE, num(500), bool(true), date("2022-12-31")],
    [text("Frank"), NULL_VALUE, num(750), bool(false), NULL_VALUE],
  ],
};

const TABLES: readonly HsqldbTable[] = [EMPLOYEES];

function run(
  sql: string,
  tables: readonly HsqldbTable[] = TABLES,
): {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly ContentCellValue[])[];
} {
  return evaluateSelect(parseSelect(sql), tables);
}

// Every WHERE/ORDER BY test below asserts on the NAME column alone: which rows survived, in what order, is the whole question, and spelling out five other columns per row would bury it.

describe("evaluateSelect: projection", () => {
  it("expands SELECT * to every column in declaration order", () => {
    const result = run("SELECT * FROM EMPLOYEES WHERE NAME = 'Alice'");
    expect(result.columns).toEqual([
      "NAME",
      "DEPT",
      "SALARY",
      "ACTIVE",
      "HIRED",
    ]);
    expect(result.rows).toEqual([
      [text("Alice"), text("Sales"), num(1000), bool(true), date("2024-01-15")],
    ]);
  });

  it("projects a named column list in the order written, labelling each with the real column name", () => {
    const result = run(
      "SELECT SALARY, NAME FROM EMPLOYEES WHERE NAME = 'Carol'",
    );
    expect(result.columns).toEqual(["SALARY", "NAME"]);
    expect(result.rows).toEqual([[num(2000), text("Carol")]]);
  });

  it("resolves an unquoted column name case-insensitively and a quoted one only exactly", () => {
    expect(run("SELECT name FROM employees").columns).toEqual(["NAME"]);
    expect(() => run('SELECT "name" FROM EMPLOYEES')).toThrow(
      'column "name" not found',
    );
  });

  it("resolves a table-qualified column against the table in FROM, and rejects any other qualifier", () => {
    expect(run('SELECT "EMPLOYEES"."NAME" FROM "EMPLOYEES"').columns).toEqual([
      "NAME",
    ]);
    expect(() => run('SELECT "OTHER"."NAME" FROM "EMPLOYEES"')).toThrow(
      'table qualifier "OTHER" not found',
    );
  });

  it("refuses to guess when an unquoted name matches two real columns case-insensitively", () => {
    const mixed: HsqldbTable = {
      tableName: "MIXED",
      columns: [
        { name: "Value", type: "VARCHAR(10)" },
        { name: "value", type: "VARCHAR(10)" },
      ],
      rows: [[text("a"), text("b")]],
    };
    expect(() => run("SELECT VALUE FROM MIXED", [mixed])).toThrow(
      "is ambiguous",
    );
    expect(run('SELECT "value" FROM MIXED', [mixed]).rows).toEqual([
      [text("b")],
    ]);
  });

  it("resolves a genuinely unambiguous case-insensitive table-qualifier match, not just an exact one", () => {
    // Every column name in EMPLOYEES is already upper-case, so an unquoted reference to it (upper-cased by the lexer) matches exactly and never exercises the case-insensitive fold path at all. A table whose real name is mixed-case is the only way to reach it, since the table qualifier itself is what tryResolveName is resolving here.
    const mixedCase: HsqldbTable = {
      tableName: "MixedCase",
      columns: [{ name: "COL", type: "VARCHAR(10)" }],
      rows: [[text("hi")]],
    };
    expect(
      run("SELECT MixedCase.COL FROM MixedCase", [mixedCase]).rows,
    ).toEqual([[text("hi")]]);
  });

  it("never folds a quoted, exact-only reference case-insensitively, even when an unquoted one would", () => {
    const mixedCase: HsqldbTable = {
      tableName: "MixedCase",
      columns: [{ name: "COL", type: "VARCHAR(10)" }],
      rows: [[text("hi")]],
    };
    // "MIXEDCASE" is what MixedCase.toUpperCase() produces, so a real fold match exists for it. Quoted, it must still be refused: only an unquoted reference is allowed to fold.
    expect(() => run('SELECT * FROM "MIXEDCASE"', [mixedCase])).toThrow(
      'table "MIXEDCASE" not found',
    );
  });

  it("lists every candidate table name, comma-separated, when none resolves", () => {
    expect(() => run("SELECT * FROM NOPE", [EMPLOYEES, DEPARTMENTS])).toThrow(
      "available: EMPLOYEES, DEPARTMENTS",
    );
  });

  it("says '(none)' rather than an empty list when there is nothing at all to resolve against", () => {
    expect(() => run("SELECT * FROM NOPE", [])).toThrow("available: (none)");
  });

  it("resolves a genuinely unambiguous case-insensitive column match after a JOIN, not just an exact one", () => {
    // Mirrors the table-qualifier fold test above, but for tryResolveColumnIndex's own separate implementation of the identical rule, over the joined column list rather than a single table's own columns.
    const left: HsqldbTable = {
      tableName: "L",
      columns: [{ name: "Id", type: "INTEGER" }],
      rows: [[num(1)]],
    };
    const right: HsqldbTable = {
      tableName: "R",
      columns: [{ name: "VAL", type: "INTEGER" }],
      rows: [[num(2)]],
    };
    expect(run("SELECT ID FROM L CROSS JOIN R", [left, right]).rows).toEqual([
      [num(1)],
    ]);
  });

  it("refuses to guess an unqualified column name that matches two joined columns case-insensitively, naming both", () => {
    const left: HsqldbTable = {
      tableName: "L",
      columns: [{ name: "Val", type: "INTEGER" }],
      rows: [[num(1)]],
    };
    const right: HsqldbTable = {
      tableName: "R",
      columns: [{ name: "val", type: "INTEGER" }],
      rows: [[num(2)]],
    };
    expect(() => run("SELECT VAL FROM L CROSS JOIN R", [left, right])).toThrow(
      'column "VAL" is ambiguous',
    );
    expect(() => run("SELECT VAL FROM L CROSS JOIN R", [left, right])).toThrow(
      "matches Val, val case-insensitively",
    );
  });

  it("refuses to guess a table name that matches two real tables case-insensitively, naming both in the error", () => {
    const fooUpper: HsqldbTable = {
      tableName: "Foo",
      columns: [{ name: "A", type: "INTEGER" }],
      rows: [],
    };
    const fooLower: HsqldbTable = {
      tableName: "foo",
      columns: [{ name: "A", type: "INTEGER" }],
      rows: [],
    };
    expect(() => run("SELECT * FROM FOO", [fooUpper, fooLower])).toThrow(
      'table "FOO" is ambiguous',
    );
    expect(() => run("SELECT * FROM FOO", [fooUpper, fooLower])).toThrow(
      "matches Foo, foo case-insensitively",
    );
  });
});
