import type { ContentCellValue } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { HsqldbTable } from "../../hsqldb/script";
import { HsqldbSqlEvaluationError } from "./errors";
import { evaluateSelect } from "./evaluate";
import { parseSelect } from "./parser";

// One hand-built table covering every value shape this engine has to reason about: text, numeric, boolean, and date columns, with a deliberate NULL in each nullable one -- SALARY on Bob, ACTIVE on Dave, HIRED on Carol and Frank, DEPT on Erin and Frank (two rows, so GROUP BY's own "all NULLs are one group" rule has something to prove). The real-fixture end-to-end test lives in src/odb/sql/query.test.ts; this file is the semantics suite.
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
function names(sql: string): readonly string[] {
  return run(`SELECT NAME FROM EMPLOYEES ${sql}`).rows.map((row) => {
    const value = row[0];
    return value?.kind === "string" ? value.value : "(not a string)";
  });
}

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
});

describe("evaluateSelect: three-valued NULL logic in WHERE", () => {
  it("excludes a row whose comparison is UNKNOWN because an operand is NULL", () => {
    expect(names("WHERE SALARY > 100")).toEqual([
      "Alice",
      "Carol",
      "Dave",
      "Erin",
      "Frank",
    ]);
    expect(names("WHERE SALARY <> 1000")).toEqual([
      "Carol",
      "Dave",
      "Erin",
      "Frank",
    ]);
  });

  it("keeps NOT UNKNOWN as UNKNOWN, so negating a NULL comparison still excludes the row", () => {
    expect(names("WHERE NOT (SALARY > 100)")).toEqual([]);
    expect(names("WHERE NOT (SALARY > 5000)")).toEqual([
      "Alice",
      "Carol",
      "Dave",
      "Erin",
      "Frank",
    ]);
  });

  it("resolves UNKNOWN OR TRUE to TRUE and UNKNOWN AND TRUE to UNKNOWN", () => {
    expect(names("WHERE SALARY > 100 OR NAME = 'Bob'")).toEqual([
      "Alice",
      "Bob",
      "Carol",
      "Dave",
      "Erin",
      "Frank",
    ]);
    expect(names("WHERE SALARY > 100 AND NAME <> 'Alice'")).toEqual([
      "Carol",
      "Dave",
      "Erin",
      "Frank",
    ]);
  });

  it("resolves UNKNOWN AND FALSE to FALSE, which is what stops NULL from short-circuiting the wrong way", () => {
    expect(names("WHERE SALARY > 100 AND NAME = 'nobody'")).toEqual([]);
  });

  it("answers IS NULL and IS NOT NULL definitively -- the only predicates here that can never be UNKNOWN", () => {
    expect(names("WHERE SALARY IS NULL")).toEqual(["Bob"]);
    expect(names("WHERE SALARY IS NOT NULL")).toEqual([
      "Alice",
      "Carol",
      "Dave",
      "Erin",
      "Frank",
    ]);
  });

  it("applies the same rule to a boolean column", () => {
    expect(names("WHERE ACTIVE = TRUE")).toEqual(["Alice", "Carol", "Erin"]);
    expect(names("WHERE ACTIVE <> TRUE")).toEqual(["Bob", "Frank"]);
  });
});

describe("evaluateSelect: LIKE", () => {
  it("matches % against any run of characters and _ against exactly one", () => {
    expect(names("WHERE NAME LIKE 'A%'")).toEqual(["Alice"]);
    expect(names("WHERE NAME LIKE '_ob'")).toEqual(["Bob"]);
    expect(names("WHERE NAME LIKE '%r%'")).toEqual(["Carol", "Erin", "Frank"]);
  });

  it("negates with NOT LIKE, and leaves a NULL operand UNKNOWN under both forms", () => {
    expect(names("WHERE NAME NOT LIKE '%r%'")).toEqual([
      "Alice",
      "Bob",
      "Dave",
    ]);
    expect(names("WHERE DEPT LIKE 'S%'")).toEqual(["Alice", "Bob"]);
    expect(names("WHERE DEPT NOT LIKE 'S%'")).toEqual(["Carol", "Dave"]);
  });

  it("is case-sensitive, matching HSQLDB and Firebird defaults", () => {
    expect(names("WHERE NAME LIKE 'a%'")).toEqual([]);
  });

  it("matches a regular-expression metacharacter in the pattern literally", () => {
    const patterns: HsqldbTable = {
      tableName: "PATTERNS",
      columns: [{ name: "VALUE", type: "VARCHAR(10)" }],
      rows: [[text("a.c")], [text("abc")], [text("a+c")]],
    };
    expect(
      run("SELECT VALUE FROM PATTERNS WHERE VALUE LIKE 'a.c'", [patterns]).rows,
    ).toEqual([[text("a.c")]]);
    expect(
      run("SELECT VALUE FROM PATTERNS WHERE VALUE LIKE 'a_c'", [patterns]).rows,
    ).toEqual([[text("a.c")], [text("abc")], [text("a+c")]]);
  });
});

describe("evaluateSelect: IN", () => {
  it("matches any literal in the list, and leaves a NULL operand UNKNOWN", () => {
    expect(names("WHERE DEPT IN ('Sales', 'Eng')")).toEqual([
      "Alice",
      "Bob",
      "Carol",
      "Dave",
    ]);
    expect(names("WHERE SALARY IN (1000, 2000)")).toEqual(["Alice", "Carol"]);
  });

  it("negates with NOT IN", () => {
    expect(names("WHERE NAME NOT IN ('Alice', 'Bob')")).toEqual([
      "Carol",
      "Dave",
      "Erin",
      "Frank",
    ]);
  });

  it("treats a non-match against a list containing NULL as UNKNOWN, so NOT IN with a NULL in the list keeps nothing", () => {
    expect(names("WHERE SALARY IN (2000, NULL)")).toEqual(["Carol"]);
    expect(names("WHERE SALARY NOT IN (1000, NULL)")).toEqual([]);
  });
});

describe("evaluateSelect: BETWEEN", () => {
  it("is inclusive at both ends", () => {
    expect(names("WHERE SALARY BETWEEN 1000 AND 2000")).toEqual([
      "Alice",
      "Carol",
      "Dave",
    ]);
    expect(names("WHERE SALARY BETWEEN 500 AND 750")).toEqual([
      "Erin",
      "Frank",
    ]);
  });

  it("negates with NOT BETWEEN, still excluding a NULL operand", () => {
    expect(names("WHERE SALARY NOT BETWEEN 1000 AND 2000")).toEqual([
      "Erin",
      "Frank",
    ]);
  });

  it("compares date columns as their own ISO-8601 text, which is order-correct", () => {
    expect(names("WHERE HIRED BETWEEN '2023-01-01' AND '2024-12-31'")).toEqual([
      "Alice",
      "Bob",
      "Dave",
    ]);
  });
});

describe("evaluateSelect: ORDER BY", () => {
  it("sorts NULLs last under ASC and first under DESC", () => {
    expect(names("ORDER BY SALARY ASC")).toEqual([
      "Erin",
      "Frank",
      "Alice",
      "Dave",
      "Carol",
      "Bob",
    ]);
    expect(names("ORDER BY SALARY DESC")).toEqual([
      "Bob",
      "Carol",
      "Dave",
      "Alice",
      "Frank",
      "Erin",
    ]);
  });

  it("resolves ties left to right across a multi-column ORDER BY, honouring each term own direction", () => {
    expect(names("ORDER BY DEPT ASC, SALARY DESC")).toEqual([
      "Carol",
      "Dave",
      "Bob",
      "Alice",
      "Frank",
      "Erin",
    ]);
  });

  it("is stable: rows tied on every term keep their original relative order", () => {
    expect(names("ORDER BY DEPT ASC")).toEqual([
      "Carol",
      "Dave",
      "Alice",
      "Bob",
      "Erin",
      "Frank",
    ]);
  });

  it("sorts by a column that is not itself selected", () => {
    expect(names("WHERE SALARY IS NOT NULL ORDER BY SALARY DESC")).toEqual([
      "Carol",
      "Dave",
      "Alice",
      "Frank",
      "Erin",
    ]);
  });
});

describe("evaluateSelect: GROUP BY and aggregates", () => {
  it("computes all five aggregates per group, with all NULLs forming one group in first-appearance order", () => {
    const result = run(
      "SELECT DEPT, COUNT(*), COUNT(SALARY), SUM(SALARY), AVG(SALARY), MIN(SALARY), MAX(SALARY) FROM EMPLOYEES GROUP BY DEPT",
    );
    expect(result.columns).toEqual([
      "DEPT",
      "COUNT(*)",
      "COUNT(SALARY)",
      "SUM(SALARY)",
      "AVG(SALARY)",
      "MIN(SALARY)",
      "MAX(SALARY)",
    ]);
    expect(result.rows).toEqual([
      [
        text("Sales"),
        num(2),
        num(1),
        num(1000),
        num(1000),
        num(1000),
        num(1000),
      ],
      [text("Eng"), num(2), num(2), num(3500), num(1750), num(1500), num(2000)],
      [NULL_VALUE, num(2), num(2), num(1250), num(625), num(500), num(750)],
    ]);
  });

  it("counts rows with COUNT(*) but only non-NULL values with COUNT(column)", () => {
    expect(
      run("SELECT COUNT(*), COUNT(SALARY), COUNT(DEPT) FROM EMPLOYEES").rows,
    ).toEqual([[num(6), num(5), num(4)]]);
  });

  it("ignores NULLs in SUM/AVG/MIN/MAX, and returns NULL for a group with no non-NULL value at all", () => {
    expect(
      run(
        "SELECT COUNT(*), COUNT(SALARY), SUM(SALARY), AVG(SALARY), MIN(SALARY), MAX(SALARY) FROM EMPLOYEES WHERE NAME = 'Bob'",
      ).rows,
    ).toEqual([
      [num(1), num(0), NULL_VALUE, NULL_VALUE, NULL_VALUE, NULL_VALUE],
    ]);
  });

  it("treats the whole row set as one group when there is no GROUP BY, and still returns one row when that set is empty", () => {
    expect(
      run(
        "SELECT COUNT(*), SUM(SALARY), AVG(SALARY), MIN(SALARY), MAX(SALARY) FROM EMPLOYEES",
      ).rows,
    ).toEqual([[num(6), num(5750), num(1150), num(500), num(2000)]]);
    expect(
      run("SELECT COUNT(*), SUM(SALARY) FROM EMPLOYEES WHERE NAME = 'nobody'")
        .rows,
    ).toEqual([[num(0), NULL_VALUE]]);
  });

  it("applies MIN/MAX to text columns too, returning the original value rather than a coerced one", () => {
    expect(
      run("SELECT MIN(NAME), MAX(NAME), MIN(HIRED), MAX(HIRED) FROM EMPLOYEES")
        .rows,
    ).toEqual([
      [text("Alice"), text("Frank"), date("2022-12-31"), date("2024-03-01")],
    ]);
  });

  it("groups by several columns at once", () => {
    const result = run(
      "SELECT DEPT, ACTIVE, COUNT(*) FROM EMPLOYEES GROUP BY DEPT, ACTIVE",
    );
    expect(result.rows).toEqual([
      [text("Sales"), bool(true), num(1)],
      [text("Sales"), bool(false), num(1)],
      [text("Eng"), bool(true), num(1)],
      [text("Eng"), NULL_VALUE, num(1)],
      [NULL_VALUE, bool(true), num(1)],
      [NULL_VALUE, bool(false), num(1)],
    ]);
  });

  it("applies WHERE before grouping", () => {
    expect(
      run(
        "SELECT DEPT, COUNT(*) FROM EMPLOYEES WHERE SALARY > 900 GROUP BY DEPT",
      ).rows,
    ).toEqual([
      [text("Sales"), num(1)],
      [text("Eng"), num(2)],
    ]);
  });

  it("orders groups by a grouped column, with the NULL group placed by the same NULLs-last rule", () => {
    expect(
      run(
        "SELECT DEPT, COUNT(*) FROM EMPLOYEES GROUP BY DEPT ORDER BY DEPT ASC",
      ).rows.map((row) => row[0]),
    ).toEqual([text("Eng"), text("Sales"), NULL_VALUE]);
    expect(
      run(
        "SELECT DEPT, COUNT(*) FROM EMPLOYEES GROUP BY DEPT ORDER BY DEPT DESC",
      ).rows.map((row) => row[0]),
    ).toEqual([NULL_VALUE, text("Sales"), text("Eng")]);
  });
});

describe("evaluateSelect: failures that must never become a wrong answer", () => {
  it.each([
    ["SELECT * FROM NOPE", 'table "NOPE" not found'],
    ["SELECT NOPE FROM EMPLOYEES", 'column "NOPE" not found'],
    [
      "SELECT * FROM EMPLOYEES WHERE SALARY = 'x'",
      "cannot compare a numeric value with a text value",
    ],
    [
      "SELECT * FROM EMPLOYEES WHERE NAME > 1",
      "cannot compare a text value with a numeric value",
    ],
    [
      "SELECT * FROM EMPLOYEES WHERE SALARY LIKE '1%'",
      "LIKE requires a text value",
    ],
    ["SELECT SUM(NAME) FROM EMPLOYEES", "SUM requires numeric values"],
    ["SELECT AVG(ACTIVE) FROM EMPLOYEES", "AVG requires numeric values"],
    [
      "SELECT NAME, COUNT(*) FROM EMPLOYEES GROUP BY DEPT",
      "neither grouped nor aggregated",
    ],
    ["SELECT NAME, COUNT(*) FROM EMPLOYEES", "neither grouped nor aggregated"],
    [
      "SELECT * FROM EMPLOYEES GROUP BY DEPT",
      "SELECT * is not valid with GROUP BY",
    ],
    [
      "SELECT DEPT, COUNT(*) FROM EMPLOYEES GROUP BY DEPT ORDER BY NAME",
      "is not a GROUP BY column",
    ],
  ])("throws HsqldbSqlEvaluationError for %s", (sql, message) => {
    expect(() => run(sql)).toThrow(HsqldbSqlEvaluationError);
    expect(() => run(sql)).toThrow(message);
  });

  it("carries the offending SQL on the error itself", () => {
    const sql = "SELECT NOPE FROM EMPLOYEES";
    expect.assertions(2);
    try {
      run(sql);
    } catch (error) {
      expect(error).toBeInstanceOf(HsqldbSqlEvaluationError);
      if (error instanceof HsqldbSqlEvaluationError) {
        expect(error.sql).toBe(sql);
      }
    }
  });

  it("names every available table or column rather than failing blankly", () => {
    expect(() => run("SELECT * FROM NOPE")).toThrow("available: EMPLOYEES");
    expect(() => run("SELECT NOPE FROM EMPLOYEES")).toThrow(
      "available: NAME, DEPT, SALARY, ACTIVE, HIRED",
    );
  });

  it("reports a row that carries fewer values than the table declares columns rather than reading past its end", () => {
    const malformed: HsqldbTable = {
      tableName: "MALFORMED",
      columns: [
        { name: "A", type: "INTEGER" },
        { name: "B", type: "INTEGER" },
      ],
      rows: [[num(1)]],
    };
    expect(() => run("SELECT B FROM MALFORMED", [malformed])).toThrow(
      'malformed table "MALFORMED"',
    );
  });
});
