import {
  assertNeverLiteralKind,
  assertNeverOperator,
  assertNeverPredicateKind,
  assertNeverValueKind,
} from "./evaluate";
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

// A dedicated table for the IN (SELECT ...)/EXISTS (SELECT ...) tests below — several rows per DEPT, and target values chosen to overlap only some employees' own SALARY, so a correlated subquery's per-row re-evaluation and an uncorrelated one's single shared result set are both genuinely exercised rather than trivially matching everything or nothing.
const REGIONAL_TARGETS: HsqldbTable = {
  tableName: "REGIONAL_TARGETS",
  columns: [
    { name: "DEPT", type: "VARCHAR(20)" },
    { name: "TARGET_SALARY", type: "DECIMAL(10,2)" },
  ],
  rows: [
    [text("Sales"), num(1000)],
    [text("Sales"), num(1500)],
    [text("Eng"), num(2000)],
  ],
};

const SUBQUERY_TABLES: readonly HsqldbTable[] = [
  EMPLOYEES,
  DEPARTMENTS,
  REGIONAL_TARGETS,
];

function runSub(sql: string) {
  return run(sql, SUBQUERY_TABLES);
}

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

  it("answers IS NULL and IS NOT NULL definitively — the only predicates here that can never be UNKNOWN", () => {
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

  it("excludes a row on a strict '<' comparison of two equal values, distinguishing it from '<='", () => {
    expect(names("WHERE SALARY < 1000")).toEqual(["Erin", "Frank"]);
  });

  it("distinguishes NOT TRUE (FALSE) from NOT UNKNOWN (UNKNOWN) through a double negation, since a bare WHERE cannot tell FALSE and UNKNOWN apart by inclusion alone", () => {
    // NOT (NOT (SALARY > 100)): the inner NOT of a definitely-true predicate must be definitely FALSE, not UNKNOWN. Otherwise the outer NOT would leave it UNKNOWN and wrongly exclude the row, so this must equal the un-negated predicate exactly.
    expect(names("WHERE NOT (NOT (SALARY > 100))")).toEqual(
      names("WHERE SALARY > 100"),
    );
  });

  it("resolves AND's early FALSE branch off the RIGHT operand alone, not only the left", () => {
    // For every row but Alice, NAME = 'Alice' is already FALSE, so AND short-circuits FALSE regardless of DEPT. Alice is the one row where the right operand (DEPT = 'Eng', false: her own dept is Sales) has to carry the early FALSE result on its own.
    expect(names("WHERE NOT (NAME = 'Alice' AND DEPT = 'Eng')")).toEqual([
      "Alice",
      "Bob",
      "Carol",
      "Dave",
      "Erin",
      "Frank",
    ]);
  });

  it("resolves TRUE AND UNKNOWN to UNKNOWN, not TRUE, when the left operand alone is definitely true", () => {
    // Bob is the only NAME = 'Bob' row, and his own SALARY is NULL, so the right operand is UNKNOWN. The AND must stay UNKNOWN, not collapse to TRUE just because the left operand did.
    expect(names("WHERE NAME = 'Bob' AND SALARY > 100")).toEqual([]);
  });

  it("resolves OR's FALSE/UNKNOWN fallthrough correctly once neither operand is TRUE", () => {
    // Neither operand is ever TRUE for Bob (both FALSE) or for Erin/Frank (FALSE and UNKNOWN, their own DEPT is NULL), so all three exercise OR's fallthrough past its TRUE/TRUE early return. That is the one path a plain, unnested OR test never reaches, since a top-level WHERE cannot distinguish a FALSE fallthrough result from an UNKNOWN one by inclusion alone.
    expect(names("WHERE NOT (NAME = 'Alice' OR DEPT = 'Eng')")).toEqual([
      "Bob",
    ]);
  });

  it("resolves UNKNOWN OR FALSE to UNKNOWN, not FALSE, when the left operand alone is definitely unknown", () => {
    // Bob is the only row where SALARY > 100 is UNKNOWN (his own SALARY is NULL) while DEPT = 'Eng' is definitely FALSE (his dept is Sales). The OR must stay UNKNOWN, not collapse to FALSE just because the right operand did.
    expect(names("WHERE NOT (SALARY > 100 OR DEPT = 'Eng')")).toEqual([]);
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

  it("treats a NULL lower or upper bound as UNKNOWN, not just a NULL operand", () => {
    // Bob's own SALARY is NULL, used here as one of the BOUNDS rather than as the operand being tested.
    expect(names("WHERE 1000 BETWEEN SALARY AND 2000")).toEqual([
      "Alice",
      "Erin",
      "Frank",
    ]);
    expect(names("WHERE 1000 BETWEEN 500 AND SALARY")).toEqual([
      "Alice",
      "Carol",
      "Dave",
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

describe("evaluateSelect: IN (SELECT ...)", () => {
  it("matches against every value the uncorrelated subquery produces, re-evaluated identically for every outer row", () => {
    expect(
      runSub(
        "SELECT NAME FROM EMPLOYEES WHERE SALARY IN (SELECT TARGET_SALARY FROM REGIONAL_TARGETS) ORDER BY NAME",
      ).rows,
    ).toEqual([[text("Alice")], [text("Carol")], [text("Dave")]]);
  });

  it("negates with NOT IN, still leaving a NULL left operand UNKNOWN rather than TRUE", () => {
    // Bob's own SALARY is NULL: SALARY IN (...) is UNKNOWN for him under both IN and NOT IN, so he is excluded from BOTH this and the test above, not included in exactly one of them.
    expect(
      runSub(
        "SELECT NAME FROM EMPLOYEES WHERE SALARY NOT IN (SELECT TARGET_SALARY FROM REGIONAL_TARGETS) ORDER BY NAME",
      ).rows,
    ).toEqual([[text("Erin")], [text("Frank")]]);
  });

  it("re-evaluates a correlated subquery per outer row, using that row's own values", () => {
    // Erin and Frank have DEPT = NULL: REGIONAL_TARGETS.DEPT = NULL is UNKNOWN for every REGIONAL_TARGETS row, so their own correlated subquery produces zero rows and IN is FALSE (not UNKNOWN — there is no NULL in an empty result set to make it UNKNOWN instead).
    expect(
      runSub(
        "SELECT NAME FROM EMPLOYEES WHERE SALARY IN (SELECT TARGET_SALARY FROM REGIONAL_TARGETS WHERE REGIONAL_TARGETS.DEPT = EMPLOYEES.DEPT) ORDER BY NAME",
      ).rows,
    ).toEqual([[text("Alice")], [text("Carol")]]);
  });

  it("throws when the subquery produces more than one column", () => {
    expect(() =>
      runSub(
        "SELECT NAME FROM EMPLOYEES WHERE SALARY IN (SELECT DEPT, TARGET_SALARY FROM REGIONAL_TARGETS)",
      ),
    ).toThrow(
      "IN (SELECT ...) requires the subquery to produce exactly one column, but it produced 2",
    );
  });
});

describe("evaluateSelect: EXISTS (SELECT ...)", () => {
  it("is true precisely when a correlated subquery produces at least one row", () => {
    // The identical row set runJoin's own INNER JOIN test already proves matches — EXISTS over a correlated subquery is the row-existence half of exactly the same join condition.
    expect(
      runSub(
        "SELECT NAME FROM EMPLOYEES WHERE EXISTS (SELECT NAME FROM DEPARTMENTS WHERE DEPARTMENTS.NAME = EMPLOYEES.DEPT) ORDER BY NAME",
      ).rows,
    ).toEqual([
      [text("Alice")],
      [text("Bob")],
      [text("Carol")],
      [text("Dave")],
    ]);
  });

  it("negates with NOT EXISTS, parsed as an ordinary NOT wrapping the exists predicate — never UNKNOWN even for a NULL-correlated row", () => {
    expect(
      runSub(
        "SELECT NAME FROM EMPLOYEES WHERE NOT EXISTS (SELECT NAME FROM DEPARTMENTS WHERE DEPARTMENTS.NAME = EMPLOYEES.DEPT) ORDER BY NAME",
      ).rows,
    ).toEqual([[text("Erin")], [text("Frank")]]);
  });

  it("ignores the subquery's own select list entirely — only row existence matters", () => {
    expect(
      runSub(
        "SELECT NAME FROM EMPLOYEES WHERE EXISTS (SELECT BUDGET FROM DEPARTMENTS WHERE DEPARTMENTS.NAME = EMPLOYEES.DEPT) ORDER BY NAME",
      ).rows,
    ).toEqual([
      [text("Alice")],
      [text("Bob")],
      [text("Carol")],
      [text("Dave")],
    ]);
  });

  it("resolves a correlated reference through two nested subquery scopes, skipping an intermediate scope that does not itself declare the referenced table", () => {
    // The middle EXISTS (over DEPARTMENTS) has nothing to do with DEPARTMENTS at all — its own inner EXISTS references EMPLOYEES.DEPT, two scopes up, which the middle scope must pass through rather than resolve itself (DEPARTMENTS declares no DEPT column).
    expect(
      runSub(
        "SELECT NAME FROM EMPLOYEES WHERE EXISTS (SELECT NAME FROM DEPARTMENTS WHERE EXISTS (SELECT DEPT FROM REGIONAL_TARGETS WHERE REGIONAL_TARGETS.DEPT = EMPLOYEES.DEPT)) ORDER BY NAME",
      ).rows,
    ).toEqual([
      [text("Alice")],
      [text("Bob")],
      [text("Carol")],
      [text("Dave")],
    ]);
  });

  it("resolves a correlated reference from a JOIN's own ON clause inside a subquery, not only from the subquery's WHERE", () => {
    // The subquery's own JOIN already matches DEPARTMENTS to REGIONAL_TARGETS on department name alone, which finds at least one row for every outer row regardless of DEPT. The ON clause's second, correlated term (REGIONAL_TARGETS.DEPT = EMPLOYEES.DEPT) is therefore the only thing that can make Erin/Frank (DEPT NULL) differ from Alice/Bob/Carol/Dave: without it, or with `outer` not threaded into the JOIN's own resolver, a NULL-comparison-derived UNKNOWN could never turn EXISTS false, and every row would match.
    expect(
      runSub(
        "SELECT NAME FROM EMPLOYEES WHERE EXISTS (SELECT REGIONAL_TARGETS.TARGET_SALARY FROM DEPARTMENTS JOIN REGIONAL_TARGETS ON REGIONAL_TARGETS.DEPT = DEPARTMENTS.NAME AND REGIONAL_TARGETS.DEPT = EMPLOYEES.DEPT) ORDER BY NAME",
      ).rows,
    ).toEqual([
      [text("Alice")],
      [text("Bob")],
      [text("Carol")],
      [text("Dave")],
    ]);
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
      "malformed joined row",
    );
  });
});

describe("assertNeverOperator", () => {
  it("throws naming the unhandled operator, proving the switch's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverOperator("bogus" as never);
    }).toThrow('documents.js: unhandled operator "bogus"');
  });
});

describe("assertNeverLiteralKind", () => {
  it("throws naming the unhandled literal, proving the switch's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverLiteralKind({ kind: "bogus" } as never);
    }).toThrow('documents.js: unhandled literal {"kind":"bogus"}');
  });
});

describe("assertNeverPredicateKind", () => {
  it("throws naming the unhandled predicate, proving the switch's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverPredicateKind({ kind: "bogus" } as never);
    }).toThrow('documents.js: unhandled predicate {"kind":"bogus"}');
  });
});

describe("assertNeverValueKind", () => {
  it("throws naming the unhandled value, proving the switch's own exhaustiveness guard fires at runtime", () => {
    expect(() => {
      assertNeverValueKind({ kind: "bogus" } as never);
    }).toThrow('documents.js: unhandled value {"kind":"bogus"}');
  });
});
