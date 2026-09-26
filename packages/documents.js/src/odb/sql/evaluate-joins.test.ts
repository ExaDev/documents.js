import type { ContentCellValue } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { HsqldbTable } from "../../hsqldb/script";
import { HsqldbSqlEvaluationError } from "./errors";
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
function names(sql: string): readonly string[] {
  return run(`SELECT NAME FROM EMPLOYEES ${sql}`).rows.map((row) => {
    const value = row[0];
    return value?.kind === "string" ? value.value : "(not a string)";
  });
}

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

const JOIN_TABLES: readonly HsqldbTable[] = [EMPLOYEES, DEPARTMENTS];

function runJoin(sql: string) {
  return run(sql, JOIN_TABLES);
}

describe("evaluateSelect: JOIN", () => {
  it("pairs matching rows and drops rows with no match on either side", () => {
    const result = runJoin(
      "SELECT EMPLOYEES.NAME, DEPARTMENTS.NAME FROM EMPLOYEES JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME ORDER BY EMPLOYEES.NAME",
    );
    // Erin and Frank (DEPT is NULL) never match anything — NULL = anything is UNKNOWN, never TRUE, exactly as in WHERE — and Marketing (no employee in it) never appears either: this is INNER JOIN, not an outer join padding the unmatched side with NULLs.
    expect(result.rows).toEqual([
      [text("Alice"), text("Sales")],
      [text("Bob"), text("Sales")],
      [text("Carol"), text("Eng")],
      [text("Dave"), text("Eng")],
    ]);
  });

  it("lays SELECT * out as the base table's own columns followed by each JOIN's, in the order written", () => {
    const result = runJoin(
      "SELECT * FROM EMPLOYEES JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME WHERE EMPLOYEES.NAME = 'Alice'",
    );
    expect(result.columns).toEqual([
      "NAME",
      "DEPT",
      "SALARY",
      "ACTIVE",
      "HIRED",
      "NAME",
      "BUDGET",
    ]);
    expect(result.rows).toEqual([
      [
        text("Alice"),
        text("Sales"),
        num(1000),
        bool(true),
        date("2024-01-15"),
        text("Sales"),
        num(50000),
      ],
    ]);
  });

  it("throws rather than guessing when an unqualified column name is genuinely ambiguous across joined tables", () => {
    expect(() =>
      runJoin(
        "SELECT NAME FROM EMPLOYEES JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME",
      ),
    ).toThrow(/column "NAME" is ambiguous/);
  });

  it("filters the joined row set with WHERE, after the join has already run", () => {
    expect(
      runJoin(
        "SELECT EMPLOYEES.NAME FROM EMPLOYEES JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME WHERE DEPARTMENTS.BUDGET > 60000",
      ).rows,
    ).toEqual([[text("Carol")], [text("Dave")]]);
  });

  it("groups and aggregates over a joined row set", () => {
    expect(
      runJoin(
        "SELECT DEPARTMENTS.NAME, COUNT(*) FROM EMPLOYEES JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME GROUP BY DEPARTMENTS.NAME ORDER BY DEPARTMENTS.NAME",
      ).rows,
    ).toEqual([
      [text("Eng"), num(2)],
      [text("Sales"), num(2)],
    ]);
  });

  it("folds several JOIN clauses left to right, each seeing every table joined so far", () => {
    const highBudget: HsqldbTable = {
      tableName: "HIGH_BUDGET",
      columns: [{ name: "DEPT_NAME", type: "VARCHAR(20)" }],
      rows: [[text("Eng")]],
    };
    const result = run(
      "SELECT EMPLOYEES.NAME FROM EMPLOYEES JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME JOIN HIGH_BUDGET ON DEPARTMENTS.NAME = HIGH_BUDGET.DEPT_NAME ORDER BY EMPLOYEES.NAME",
      [EMPLOYEES, DEPARTMENTS, highBudget],
    );
    expect(result.rows).toEqual([[text("Carol")], [text("Dave")]]);
  });

  it("refuses an ON predicate whose own table qualifier names a table this statement never joined", () => {
    expect(() =>
      runJoin(
        "SELECT EMPLOYEES.NAME FROM EMPLOYEES JOIN DEPARTMENTS ON EMPLOYEES.DEPT = NONEXISTENT.NAME",
      ),
    ).toThrow(HsqldbSqlEvaluationError);
  });

  it("refuses an unqualified column reference in ON that is ambiguous across the tables joined so far, on the identical rule an ordinary select-list column already follows", () => {
    expect(() =>
      runJoin(
        "SELECT EMPLOYEES.NAME FROM EMPLOYEES JOIN DEPARTMENTS ON DEPT = NAME",
      ),
    ).toThrow(/column "DEPT" not found|column "NAME" is ambiguous/);
  });

  it("makes a self-join's own unqualified table name ambiguous rather than silently picking one occurrence — there is no alias to tell the two apart", () => {
    expect(() =>
      run(
        "SELECT EMPLOYEES.NAME FROM EMPLOYEES JOIN EMPLOYEES ON EMPLOYEES.DEPT = EMPLOYEES.DEPT",
        [EMPLOYEES],
      ),
    ).toThrow(/is ambiguous/);
  });

  it("keeps every LEFT row under LEFT JOIN, padding an unmatched one with NULL for the right side's own columns", () => {
    const result = runJoin(
      "SELECT EMPLOYEES.NAME, DEPARTMENTS.NAME FROM EMPLOYEES LEFT JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME ORDER BY EMPLOYEES.NAME",
    );
    // Erin and Frank (DEPT NULL) now survive, padded with NULL rather than dropped — and Marketing still never appears, since a LEFT JOIN never keeps an unmatched row from the RIGHT side.
    expect(result.rows).toEqual([
      [text("Alice"), text("Sales")],
      [text("Bob"), text("Sales")],
      [text("Carol"), text("Eng")],
      [text("Dave"), text("Eng")],
      [text("Erin"), NULL_VALUE],
      [text("Frank"), NULL_VALUE],
    ]);
  });

  it("mirrors LEFT JOIN for RIGHT JOIN, keeping an unmatched right row padded with NULL for the left side", () => {
    const result = runJoin(
      "SELECT EMPLOYEES.NAME, DEPARTMENTS.NAME FROM EMPLOYEES RIGHT JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME ORDER BY DEPARTMENTS.NAME",
    );
    // Marketing (no employee) now survives, padded with NULL — and Erin/Frank never appear, since a RIGHT JOIN never keeps an unmatched row from the LEFT side.
    expect(result.rows).toEqual([
      [text("Carol"), text("Eng")],
      [text("Dave"), text("Eng")],
      [NULL_VALUE, text("Marketing")],
      [text("Alice"), text("Sales")],
      [text("Bob"), text("Sales")],
    ]);
  });

  it("keeps every unmatched row from both sides under FULL JOIN", () => {
    const result = runJoin(
      "SELECT EMPLOYEES.NAME, DEPARTMENTS.NAME FROM EMPLOYEES FULL JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME ORDER BY EMPLOYEES.NAME, DEPARTMENTS.NAME",
    );
    // ORDER BY sorts NULLs last, so Marketing (EMPLOYEES.NAME is NULL) sorts after every named employee.
    expect(result.rows).toEqual([
      [text("Alice"), text("Sales")],
      [text("Bob"), text("Sales")],
      [text("Carol"), text("Eng")],
      [text("Dave"), text("Eng")],
      [text("Erin"), NULL_VALUE],
      [text("Frank"), NULL_VALUE],
      [NULL_VALUE, text("Marketing")],
    ]);
  });

  it("accepts OUTER as a no-op after LEFT/RIGHT/FULL, identically to omitting it", () => {
    expect(
      runJoin(
        "SELECT EMPLOYEES.NAME FROM EMPLOYEES LEFT OUTER JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME ORDER BY EMPLOYEES.NAME",
      ),
    ).toEqual(
      runJoin(
        "SELECT EMPLOYEES.NAME FROM EMPLOYEES LEFT JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME ORDER BY EMPLOYEES.NAME",
      ),
    );
  });
});

describe("evaluateSelect: table aliases", () => {
  it("resolves a column by its alias instead of the table's own name", () => {
    const result = run(
      "SELECT e.NAME, d.NAME FROM EMPLOYEES e JOIN DEPARTMENTS d ON e.DEPT = d.NAME ORDER BY e.NAME",
      JOIN_TABLES,
    );
    expect(result.rows).toEqual([
      [text("Alice"), text("Sales")],
      [text("Bob"), text("Sales")],
      [text("Carol"), text("Eng")],
      [text("Dave"), text("Eng")],
    ]);
  });

  it("makes the alias the ONLY name that resolves a table, not an addition to its real name", () => {
    expect(() =>
      run(
        "SELECT EMPLOYEES.NAME FROM EMPLOYEES e JOIN DEPARTMENTS d ON e.DEPT = d.NAME",
        JOIN_TABLES,
      ),
    ).toThrow('table qualifier "EMPLOYEES" not found');
  });

  it("resolves a genuine self-join once aliases tell the two occurrences of the same table apart", () => {
    const result = run(
      "SELECT e1.NAME, e2.NAME FROM EMPLOYEES e1 JOIN EMPLOYEES e2 ON e1.DEPT = e2.DEPT AND e1.NAME <> e2.NAME ORDER BY e1.NAME, e2.NAME",
      [EMPLOYEES],
    );
    // Erin and Frank never appear on either side: DEPT is NULL for both, and NULL = NULL is UNKNOWN under three-valued logic, never TRUE.
    expect(result.rows).toEqual([
      [text("Alice"), text("Bob")],
      [text("Bob"), text("Alice")],
      [text("Carol"), text("Dave")],
      [text("Dave"), text("Carol")],
    ]);
  });
});

// A pair of tables purpose-built for NATURAL/USING: CUSTOMERS and ORDERS share exactly one column, CUSTOMER_ID, which is what both join forms match on. Initech has no order at all (an unmatched LEFT row); order 102's own CUSTOMER_ID is NULL (an orphan that never matches anything, on the identical three-valued-logic rule an ON clause already follows) — between them these give every outer-join padding case something real to prove.
const CUSTOMERS: HsqldbTable = {
  tableName: "CUSTOMERS",
  columns: [
    { name: "CUSTOMER_ID", type: "INTEGER" },
    { name: "CUSTOMER_NAME", type: "VARCHAR(20)" },
  ],
  rows: [
    [num(1), text("Acme")],
    [num(2), text("Globex")],
    [num(3), text("Initech")],
  ],
};

const ORDERS: HsqldbTable = {
  tableName: "ORDERS",
  columns: [
    { name: "ORDER_ID", type: "INTEGER" },
    { name: "CUSTOMER_ID", type: "INTEGER" },
  ],
  rows: [
    [num(100), num(1)],
    [num(101), num(2)],
    [num(102), NULL_VALUE],
  ],
};

const NATURAL_TABLES: readonly HsqldbTable[] = [CUSTOMERS, ORDERS];

describe("evaluateSelect: NATURAL JOIN and JOIN ... USING", () => {
  it("merges the shared column into one, laid out before each side's own remaining columns", () => {
    const result = run(
      "SELECT * FROM CUSTOMERS NATURAL JOIN ORDERS ORDER BY ORDER_ID",
      NATURAL_TABLES,
    );
    expect(result.columns).toEqual([
      "CUSTOMER_ID",
      "CUSTOMER_NAME",
      "ORDER_ID",
    ]);
    expect(result.rows).toEqual([
      [num(1), text("Acme"), num(100)],
      [num(2), text("Globex"), num(101)],
    ]);
  });

  it("parses JOIN ... USING identically to NATURAL JOIN when the two sides share exactly one column", () => {
    expect(
      run(
        "SELECT * FROM CUSTOMERS JOIN ORDERS USING (CUSTOMER_ID) ORDER BY ORDER_ID",
        NATURAL_TABLES,
      ),
    ).toEqual(
      run(
        "SELECT * FROM CUSTOMERS NATURAL JOIN ORDERS ORDER BY ORDER_ID",
        NATURAL_TABLES,
      ),
    );
  });

  it("keeps a merged column's own value from whichever side is not NULL under LEFT JOIN", () => {
    const result = run(
      "SELECT * FROM CUSTOMERS LEFT JOIN ORDERS USING (CUSTOMER_ID) ORDER BY CUSTOMER_ID",
      NATURAL_TABLES,
    );
    expect(result.rows).toEqual([
      [num(1), text("Acme"), num(100)],
      [num(2), text("Globex"), num(101)],
      // Initech has no order: ORDER_ID is padded NULL, and the merged CUSTOMER_ID keeps the LEFT side's own real value (3) rather than the padded-NULL right side.
      [num(3), text("Initech"), NULL_VALUE],
    ]);
  });

  it("pads the LEFT side with NULL under RIGHT JOIN, leaving a merged column NULL when both sides are", () => {
    const result = run(
      "SELECT * FROM CUSTOMERS RIGHT JOIN ORDERS USING (CUSTOMER_ID) ORDER BY ORDER_ID",
      NATURAL_TABLES,
    );
    expect(result.rows).toEqual([
      [num(1), text("Acme"), num(100)],
      [num(2), text("Globex"), num(101)],
      // Order 102's own CUSTOMER_ID is NULL, and CUSTOMERS never matches it (an orphan order): both sides are NULL, so the merged column stays NULL rather than picking either.
      [NULL_VALUE, NULL_VALUE, num(102)],
    ]);
  });

  it("keeps every unmatched row from both sides under FULL JOIN", () => {
    const result = run(
      "SELECT * FROM CUSTOMERS FULL JOIN ORDERS USING (CUSTOMER_ID) ORDER BY CUSTOMER_ID, ORDER_ID",
      NATURAL_TABLES,
    );
    // ORDER BY sorts NULLs last, so order 102 (a merged CUSTOMER_ID of NULL) sorts after every real customer ID.
    expect(result.rows).toEqual([
      [num(1), text("Acme"), num(100)],
      [num(2), text("Globex"), num(101)],
      [num(3), text("Initech"), NULL_VALUE],
      [NULL_VALUE, NULL_VALUE, num(102)],
    ]);
  });

  it("still lets a merged column be qualified by either side's own name", () => {
    const result = run(
      "SELECT CUSTOMERS.CUSTOMER_ID, ORDERS.CUSTOMER_ID FROM CUSTOMERS NATURAL JOIN ORDERS WHERE ORDER_ID = 100",
      NATURAL_TABLES,
    );
    expect(result.rows).toEqual([[num(1), num(1)]]);
  });

  it("merges every shared column under NATURAL JOIN, laid out left-to-right in the left side's own column order", () => {
    const leftTable: HsqldbTable = {
      tableName: "LEFT_T",
      columns: [
        { name: "B", type: "VARCHAR(5)" },
        { name: "A", type: "VARCHAR(5)" },
        { name: "ONLY_LEFT", type: "VARCHAR(5)" },
      ],
      rows: [[text("b1"), text("a1"), text("l1")]],
    };
    const rightTable: HsqldbTable = {
      tableName: "RIGHT_T",
      columns: [
        { name: "A", type: "VARCHAR(5)" },
        { name: "ONLY_RIGHT", type: "VARCHAR(5)" },
        { name: "B", type: "VARCHAR(5)" },
      ],
      rows: [[text("a1"), text("r1"), text("b1")]],
    };
    const result = run("SELECT * FROM LEFT_T NATURAL JOIN RIGHT_T", [
      leftTable,
      rightTable,
    ]);
    // Shared columns B and A come first, in LEFT_T's own column order (B before A, since LEFT_T declares B before A) rather than RIGHT_T's own order (which declares A before B) or alphabetical order, and each side's own remaining column follows.
    expect(result.columns).toEqual(["B", "A", "ONLY_LEFT", "ONLY_RIGHT"]);
    expect(result.rows).toEqual([
      [text("b1"), text("a1"), text("l1"), text("r1")],
    ]);
  });

  it("produces the unrestricted cartesian product for CROSS JOIN, with no condition and no merging", () => {
    const result = run(
      "SELECT * FROM CUSTOMERS CROSS JOIN ORDERS",
      NATURAL_TABLES,
    );
    expect(result.columns).toEqual([
      "CUSTOMER_ID",
      "CUSTOMER_NAME",
      "ORDER_ID",
      "CUSTOMER_ID",
    ]);
    expect(result.rows).toHaveLength(9);
  });

  it("refuses to guess which of two identically-named already-joined columns NATURAL JOIN should match", () => {
    const regions: HsqldbTable = {
      tableName: "REGIONS",
      columns: [
        { name: "NAME", type: "VARCHAR(20)" },
        { name: "CODE", type: "VARCHAR(5)" },
      ],
      rows: [[text("Sales"), text("S1")]],
    };
    expect(() =>
      run(
        "SELECT * FROM EMPLOYEES JOIN DEPARTMENTS ON EMPLOYEES.DEPT = DEPARTMENTS.NAME NATURAL JOIN REGIONS",
        [EMPLOYEES, DEPARTMENTS, regions],
      ),
    ).toThrow(/NATURAL JOIN cannot determine a unique match/);
  });

  it("refuses a NATURAL JOIN between tables that share no column at all", () => {
    const highBudget: HsqldbTable = {
      tableName: "HIGH_BUDGET",
      columns: [{ name: "DEPT_NAME", type: "VARCHAR(20)" }],
      rows: [[text("Eng")]],
    };
    expect(() =>
      run("SELECT * FROM EMPLOYEES NATURAL JOIN HIGH_BUDGET", [
        EMPLOYEES,
        highBudget,
      ]),
    ).toThrow("NATURAL JOIN found no columns shared between the joined tables");
  });
});

describe("evaluateSelect: a derived table in FROM", () => {
  it("evaluates the inner query and treats its result as an ordinary table under its own alias", () => {
    expect(
      run(
        "SELECT NAME FROM (SELECT NAME, SALARY FROM EMPLOYEES WHERE SALARY > 1000) high_earners ORDER BY NAME",
      ).rows,
    ).toEqual([[text("Carol")], [text("Dave")]]);
  });

  it("lets the inner query itself JOIN, filter, group, and order, exactly as a top-level statement can", () => {
    const result = run(
      'SELECT DEPT, "SUM(SALARY)" FROM (SELECT DEPT, SUM(SALARY) FROM EMPLOYEES GROUP BY DEPT) dept_totals ORDER BY DEPT',
    );
    expect(result.columns).toEqual(["DEPT", "SUM(SALARY)"]);
    expect(result.rows).toEqual([
      [text("Eng"), num(3500)],
      [text("Sales"), num(1000)],
      [NULL_VALUE, num(1250)],
    ]);
  });

  it("qualifies a column reference by the derived table's own alias, exactly as it would a real table's name", () => {
    const result = runJoin(
      "SELECT high.NAME, DEPARTMENTS.BUDGET FROM (SELECT NAME, DEPT FROM EMPLOYEES WHERE SALARY > 1000) high JOIN DEPARTMENTS ON high.DEPT = DEPARTMENTS.NAME ORDER BY high.NAME",
    );
    expect(result.rows).toEqual([
      [text("Carol"), num(80000)],
      [text("Dave"), num(80000)],
    ]);
  });

  it("nests a derived table inside a derived table's own FROM", () => {
    expect(
      run(
        "SELECT NAME FROM (SELECT NAME FROM (SELECT NAME FROM EMPLOYEES WHERE SALARY > 1000) inner1) outer1 ORDER BY NAME",
      ).rows,
    ).toEqual([[text("Carol")], [text("Dave")]]);
  });

  it("never correlates with an enclosing query, even a correlated one — a plain derived table always evaluates standalone, regardless of what it is nested inside", () => {
    // The EXISTS wrapping this derived table is itself perfectly capable of correlation (see the "evaluateSelect: EXISTS" tests below) — but the derived table nested inside it does not inherit that: its own inner SELECT references EMPLOYEES.DEPT, and EMPLOYEES is not a table this derived table's own FROM ever named, so it must fail exactly as it would with no enclosing EXISTS at all.
    expect(() =>
      runJoin(
        "SELECT NAME FROM EMPLOYEES WHERE EXISTS (SELECT NAME FROM (SELECT NAME FROM DEPARTMENTS WHERE DEPARTMENTS.NAME = EMPLOYEES.DEPT) inner1)",
      ),
    ).toThrow('table qualifier "EMPLOYEES" not found');
  });
});
