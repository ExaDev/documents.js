import { describe, expect, it } from "vitest";
import { HsqldbSqlParseError, HsqldbSqlUnsupportedError } from "./errors";
import { parseSelect } from "./parser";

describe("parseSelect: select list", () => {
  it("parses SELECT *", () => {
    expect(parseSelect("SELECT * FROM SALES").items).toEqual([
      { kind: "star" },
    ]);
  });

  it("parses a plain column list, folding unquoted names and keeping quoted ones", () => {
    const statement = parseSelect('SELECT region, "Quarter" FROM SALES');
    expect(statement.items).toEqual([
      {
        kind: "column",
        column: {
          qualifier: undefined,
          column: { name: "REGION", quoted: false },
          text: "region",
        },
      },
      {
        kind: "column",
        column: {
          qualifier: undefined,
          column: { name: "Quarter", quoted: true },
          text: '"Quarter"',
        },
      },
    ]);
  });

  it("parses a table-qualified column reference", () => {
    expect(parseSelect('SELECT "SALES"."REGION" FROM "SALES"').items).toEqual([
      {
        kind: "column",
        column: {
          qualifier: { name: "SALES", quoted: true },
          column: { name: "REGION", quoted: true },
          text: '"SALES"."REGION"',
        },
      },
    ]);
  });

  it("parses each of the five aggregates, labelling its own output column", () => {
    const statement = parseSelect(
      "SELECT COUNT(*), COUNT(AMOUNT), SUM(AMOUNT), AVG(AMOUNT), MIN(AMOUNT), MAX(AMOUNT) FROM SALES",
    );
    expect(
      statement.items.map((item) =>
        item.kind === "aggregate" ? item.outputName : item.kind,
      ),
    ).toEqual([
      "COUNT(*)",
      "COUNT(AMOUNT)",
      "SUM(AMOUNT)",
      "AVG(AMOUNT)",
      "MIN(AMOUNT)",
      "MAX(AMOUNT)",
    ]);
  });

  it("rejects SUM(*), which is not valid SQL -- only COUNT takes a star", () => {
    expect(() => parseSelect("SELECT SUM(*) FROM SALES")).toThrow(
      HsqldbSqlParseError,
    );
    expect(() => parseSelect("SELECT SUM(*) FROM SALES")).toThrow(
      "only COUNT(*) is",
    );
  });

  it('rejects a select list mixing "*" with named columns', () => {
    expect(() => parseSelect("SELECT *, REGION FROM SALES")).toThrow(
      HsqldbSqlUnsupportedError,
    );
    expect(() => parseSelect("SELECT REGION, * FROM SALES")).toThrow(
      HsqldbSqlUnsupportedError,
    );
  });
});

describe("parseSelect: predicates", () => {
  it("parses every comparison operator against a literal or another column", () => {
    expect(parseSelect("SELECT * FROM T WHERE A >= 100").where).toEqual({
      kind: "comparison",
      operator: ">=",
      left: {
        kind: "column",
        column: {
          qualifier: undefined,
          column: { name: "A", quoted: false },
          text: "A",
        },
      },
      right: { kind: "literal", literal: { kind: "number", value: 100 } },
    });
    expect(parseSelect("SELECT * FROM T WHERE A <> B").where).toMatchObject({
      operator: "<>",
      right: { kind: "column" },
    });
  });

  it('reads a leading "-" as a numeric literal sign, not as arithmetic', () => {
    expect(parseSelect("SELECT * FROM T WHERE A > -100").where).toMatchObject({
      right: { kind: "literal", literal: { kind: "number", value: -100 } },
    });
  });

  it("parses IS NULL and IS NOT NULL", () => {
    expect(parseSelect("SELECT * FROM T WHERE A IS NULL").where).toMatchObject({
      kind: "isNull",
      negated: false,
    });
    expect(
      parseSelect("SELECT * FROM T WHERE A IS NOT NULL").where,
    ).toMatchObject({ kind: "isNull", negated: true });
  });

  it("parses LIKE and NOT LIKE with a string-literal pattern", () => {
    expect(
      parseSelect("SELECT * FROM T WHERE A LIKE 'a%'").where,
    ).toMatchObject({ kind: "like", pattern: "a%", negated: false });
    expect(
      parseSelect("SELECT * FROM T WHERE A NOT LIKE '_b'").where,
    ).toMatchObject({ kind: "like", pattern: "_b", negated: true });
  });

  it("parses IN and NOT IN over a literal list", () => {
    expect(
      parseSelect("SELECT * FROM T WHERE A IN (1, 'two', TRUE, NULL)").where,
    ).toMatchObject({
      kind: "in",
      negated: false,
      values: [
        { kind: "number", value: 1 },
        { kind: "string", value: "two" },
        { kind: "boolean", value: true },
        { kind: "null" },
      ],
    });
    expect(
      parseSelect("SELECT * FROM T WHERE A NOT IN (1)").where,
    ).toMatchObject({ kind: "in", negated: true });
  });

  it("parses BETWEEN and NOT BETWEEN", () => {
    expect(
      parseSelect("SELECT * FROM T WHERE A BETWEEN 1 AND 2").where,
    ).toMatchObject({
      kind: "between",
      negated: false,
      lower: { kind: "literal", literal: { kind: "number", value: 1 } },
      upper: { kind: "literal", literal: { kind: "number", value: 2 } },
    });
    expect(
      parseSelect("SELECT * FROM T WHERE A NOT BETWEEN 1 AND 2").where,
    ).toMatchObject({ kind: "between", negated: true });
  });

  it("binds NOT tighter than AND, and AND tighter than OR", () => {
    expect(
      parseSelect("SELECT * FROM T WHERE NOT A = 1 AND B = 2 OR C = 3").where,
    ).toMatchObject({
      kind: "or",
      left: {
        kind: "and",
        left: { kind: "not", predicate: { kind: "comparison" } },
        right: { kind: "comparison" },
      },
      right: { kind: "comparison" },
    });
  });

  it("honours parentheses over that default precedence", () => {
    expect(
      parseSelect("SELECT * FROM T WHERE A = 1 AND (B = 2 OR C = 3)").where,
    ).toMatchObject({ kind: "and", right: { kind: "or" } });
  });
});

describe("parseSelect: GROUP BY and ORDER BY", () => {
  it("parses a multi-column GROUP BY", () => {
    expect(
      parseSelect(
        "SELECT REGION, QUARTER, COUNT(*) FROM SALES GROUP BY REGION, QUARTER",
      ).groupBy.map((ref) => ref.column.name),
    ).toEqual(["REGION", "QUARTER"]);
  });

  it("parses a multi-column ORDER BY, defaulting an unmarked term to ASC", () => {
    expect(
      parseSelect(
        "SELECT * FROM SALES ORDER BY REGION ASC, QUARTER, AMOUNT DESC",
      ).orderBy.map((term) => [term.column.column.name, term.direction]),
    ).toEqual([
      ["REGION", "asc"],
      ["QUARTER", "asc"],
      ["AMOUNT", "desc"],
    ]);
  });

  it("accepts one trailing semicolon", () => {
    expect(parseSelect("SELECT * FROM SALES;").from).toEqual({
      table: { name: "SALES", quoted: false },
      alias: undefined,
      joins: [],
    });
  });
});

describe("parseSelect: JOIN", () => {
  it("parses a bare JOIN as an inner join, requiring ON", () => {
    expect(parseSelect("SELECT A FROM T1 JOIN T2 ON T1.A = T2.A").from).toEqual(
      {
        table: { name: "T1", quoted: false },
        alias: undefined,
        joins: [
          {
            joinKind: "inner",
            table: { name: "T2", quoted: false },
            alias: undefined,
            condition: {
              kind: "on",
              predicate: {
                kind: "comparison",
                operator: "=",
                left: {
                  kind: "column",
                  column: {
                    qualifier: { name: "T1", quoted: false },
                    column: { name: "A", quoted: false },
                    text: "T1.A",
                  },
                },
                right: {
                  kind: "column",
                  column: {
                    qualifier: { name: "T2", quoted: false },
                    column: { name: "A", quoted: false },
                    text: "T2.A",
                  },
                },
              },
            },
          },
        ],
      },
    );
  });

  it("parses an explicit INNER JOIN identically to a bare JOIN", () => {
    expect(
      parseSelect("SELECT A FROM T1 INNER JOIN T2 ON T1.A = T2.A").from,
    ).toEqual(parseSelect("SELECT A FROM T1 JOIN T2 ON T1.A = T2.A").from);
  });

  it("parses several JOIN clauses in the order written", () => {
    const from = parseSelect(
      "SELECT A FROM T1 JOIN T2 ON T1.A = T2.A JOIN T3 ON T2.B = T3.B",
    ).from;
    expect(from.joins.map((join) => join.table.name)).toEqual(["T2", "T3"]);
  });

  it("accepts an ON predicate using the identical grammar WHERE does -- AND, comparisons, IS NULL", () => {
    const from = parseSelect(
      "SELECT A FROM T1 JOIN T2 ON T1.A = T2.A AND T2.B IS NOT NULL",
    ).from;
    const condition = from.joins[0]?.condition;
    expect(condition?.kind).toBe("on");
    expect(
      condition?.kind === "on" ? condition.predicate.kind : undefined,
    ).toBe("and");
  });

  it("rejects a schema-qualified table name on a JOIN clause's own table", () => {
    expect(() =>
      parseSelect("SELECT A FROM T1 JOIN PUBLIC.T2 ON T1.A = T2.A"),
    ).toThrow("a schema-qualified table name");
  });

  it("requires ON or USING after a plain/INNER/LEFT/RIGHT/FULL JOIN's own table", () => {
    expect(() =>
      parseSelect("SELECT A FROM T1 JOIN T2 WHERE T1.A = 1"),
    ).toThrow(HsqldbSqlParseError);
  });

  it.each([
    ["SELECT A FROM T1 LEFT JOIN T2 ON T1.A = T2.A", "left"],
    ["SELECT A FROM T1 LEFT OUTER JOIN T2 ON T1.A = T2.A", "left"],
    ["SELECT A FROM T1 RIGHT JOIN T2 ON T1.A = T2.A", "right"],
    ["SELECT A FROM T1 RIGHT OUTER JOIN T2 ON T1.A = T2.A", "right"],
    ["SELECT A FROM T1 FULL JOIN T2 ON T1.A = T2.A", "full"],
    ["SELECT A FROM T1 FULL OUTER JOIN T2 ON T1.A = T2.A", "full"],
  ])("parses %s as joinKind %s, still requiring ON", (sql, joinKind) => {
    const from = parseSelect(sql).from;
    expect(from.joins[0]?.joinKind).toBe(joinKind);
    expect(from.joins[0]?.condition.kind).toBe("on");
  });

  it("parses CROSS JOIN with no condition at all -- no ON, no USING, no NATURAL", () => {
    const from = parseSelect("SELECT A FROM T1 CROSS JOIN T2").from;
    expect(from.joins[0]).toEqual({
      joinKind: "cross",
      table: { name: "T2", quoted: false },
      alias: undefined,
      condition: { kind: "none" },
    });
  });

  it("rejects ON or USING after a CROSS JOIN's own table", () => {
    expect(() =>
      parseSelect("SELECT A FROM T1 CROSS JOIN T2 ON T1.A = T2.A"),
    ).toThrow(HsqldbSqlParseError);
    expect(() =>
      parseSelect("SELECT A FROM T1 CROSS JOIN T2 USING (A)"),
    ).toThrow(HsqldbSqlParseError);
  });

  it("parses NATURAL JOIN with an implicit condition, defaulting its own join kind to inner", () => {
    const from = parseSelect("SELECT A FROM T1 NATURAL JOIN T2").from;
    expect(from.joins[0]).toEqual({
      joinKind: "inner",
      table: { name: "T2", quoted: false },
      alias: undefined,
      condition: { kind: "natural" },
    });
  });

  it("parses NATURAL LEFT/RIGHT/FULL JOIN, combining NATURAL with a join kind", () => {
    expect(
      parseSelect("SELECT A FROM T1 NATURAL LEFT JOIN T2").from.joins[0]
        ?.joinKind,
    ).toBe("left");
    expect(
      parseSelect("SELECT A FROM T1 NATURAL RIGHT OUTER JOIN T2").from.joins[0]
        ?.joinKind,
    ).toBe("right");
  });

  it("rejects NATURAL CROSS JOIN, which is not valid SQL", () => {
    expect(() => parseSelect("SELECT A FROM T1 NATURAL CROSS JOIN T2")).toThrow(
      HsqldbSqlParseError,
    );
  });

  it("parses JOIN ... USING with one or more columns", () => {
    expect(
      parseSelect("SELECT A FROM T1 JOIN T2 USING (A)").from.joins[0]
        ?.condition,
    ).toEqual({
      kind: "using",
      columns: [{ name: "A", quoted: false }],
    });
    expect(
      parseSelect('SELECT A FROM T1 JOIN T2 USING (A, "B")').from.joins[0]
        ?.condition,
    ).toEqual({
      kind: "using",
      columns: [
        { name: "A", quoted: false },
        { name: "B", quoted: true },
      ],
    });
  });

  it("parses LEFT/RIGHT/FULL JOIN ... USING, combining an outer join kind with USING", () => {
    expect(
      parseSelect("SELECT A FROM T1 LEFT JOIN T2 USING (A)").from.joins[0],
    ).toEqual({
      joinKind: "left",
      table: { name: "T2", quoted: false },
      alias: undefined,
      condition: { kind: "using", columns: [{ name: "A", quoted: false }] },
    });
  });

  it("parses a table alias with and without AS, on both the base FROM table and a JOIN's own table", () => {
    expect(parseSelect("SELECT A FROM T1 AS t1").from.alias).toEqual({
      name: "T1",
      quoted: false,
    });
    expect(parseSelect("SELECT A FROM T1 t1").from.alias).toEqual({
      name: "T1",
      quoted: false,
    });
    const from = parseSelect(
      "SELECT A FROM T1 AS one JOIN T2 two ON one.X = two.X",
    ).from;
    expect(from.alias).toEqual({ name: "ONE", quoted: false });
    expect(from.joins[0]?.alias).toEqual({ name: "TWO", quoted: false });
  });

  it("parses a genuine self-join, distinguishing the two occurrences of the same table by alias alone", () => {
    const from = parseSelect(
      "SELECT t1.A FROM T t1 JOIN T t2 ON t1.A = t2.A",
    ).from;
    expect(from.table.name).toBe("T");
    expect(from.alias).toEqual({ name: "T1", quoted: false });
    expect(from.joins[0]?.table.name).toBe("T");
    expect(from.joins[0]?.alias).toEqual({ name: "T2", quoted: false });
  });
});

describe("parseSelect: deliberately unsupported constructs", () => {
  it.each([
    [
      "SELECT A FROM T1, T2",
      "a comma-separated FROM list (write an explicit JOIN instead)",
    ],
    ["SELECT A FROM T WHERE A IN (SELECT B FROM U)", "a subquery"],
    ["SELECT A FROM (SELECT B FROM U)", "a subquery"],
    ["SELECT A FROM T WHERE EXISTS (SELECT 1 FROM U)", "an EXISTS subquery"],
    ["SELECT DISTINCT A FROM T", "DISTINCT"],
    ["SELECT COUNT(DISTINCT A) FROM T", "DISTINCT"],
    ["SELECT A FROM T UNION SELECT A FROM U", "UNION"],
    ["SELECT A FROM T INTERSECT SELECT A FROM U", "INTERSECT"],
    ["SELECT A FROM T EXCEPT SELECT A FROM U", "EXCEPT"],
    ["SELECT A, COUNT(*) FROM T GROUP BY A HAVING COUNT(*) > 1", "HAVING"],
    ["SELECT A FROM T LIMIT 10", "a row-limit clause (LIMIT)"],
    ["SELECT A FROM T ORDER BY A OFFSET 5", "a row-limit clause (OFFSET)"],
    ["SELECT A AS ALIAS FROM T", "a column alias (AS)"],
    ["SELECT COUNT(*) AS TOTAL FROM T", "a column alias (AS)"],
    ["SELECT UPPER(A) FROM T", "a scalar function (UPPER)"],
    ["SELECT COALESCE(A, 0) FROM T", "a scalar function (COALESCE)"],
    ["SELECT CASE WHEN A = 1 THEN 2 ELSE 3 END FROM T", "a CASE expression"],
    ["SELECT A FROM T WHERE A + 1 > 2", "an arithmetic expression"],
    ["SELECT A FROM T WHERE A * 2 > 2", "an arithmetic expression"],
    ["SELECT A FROM T WHERE A > (B)", "a parenthesised value expression"],
    [
      "SELECT A FROM T WHERE A LIKE 'a%' ESCAPE '\\'",
      "a LIKE ... ESCAPE clause",
    ],
    [
      "SELECT A FROM T ORDER BY A NULLS FIRST",
      "an ORDER BY NULLS FIRST/LAST clause",
    ],
    ["SELECT A FROM T ORDER BY 1", "an ordinal column reference in ORDER BY"],
    [
      "SELECT A, COUNT(*) FROM T GROUP BY A ORDER BY COUNT(*)",
      "an aggregate function in ORDER BY",
    ],
    ["SELECT A FROM PUBLIC.T", "a schema-qualified table name"],
    ["SELECT A FROM T WHERE A IN (B)", "a column reference inside an IN list"],
    ["SELECT A FROM T WHERE A LIKE B", "a non-literal LIKE pattern"],
    ["INSERT INTO T VALUES (1)", "a non-SELECT statement (INSERT)"],
    ["UPDATE T SET A = 1", "a non-SELECT statement (UPDATE)"],
    ["DELETE FROM T", "a non-SELECT statement (DELETE)"],
    [
      "WITH X AS (SELECT 1) SELECT * FROM X",
      "a common table expression (WITH)",
    ],
  ])(
    "throws HsqldbSqlUnsupportedError naming the construct for %s",
    (sql, construct) => {
      expect(() => parseSelect(sql)).toThrow(HsqldbSqlUnsupportedError);
      expect(() => parseSelect(sql)).toThrow(construct);
    },
  );

  it("carries the offending SQL and construct on the error itself, not only in its message", () => {
    const sql = "SELECT DISTINCT A FROM T";
    expect.assertions(3);
    try {
      parseSelect(sql);
    } catch (error) {
      expect(error).toBeInstanceOf(HsqldbSqlUnsupportedError);
      if (error instanceof HsqldbSqlUnsupportedError) {
        expect(error.construct).toBe("DISTINCT");
        expect(error.sql).toBe(sql);
      }
    }
  });
});

describe("parseSelect: malformed input", () => {
  it.each([
    ["SELECT A", "expected keyword FROM"],
    ["SELECT FROM T", "expected a column name"],
    ["SELECT * FROM", "expected a table name"],
    ["SELECT * FROM T WHERE", "expected a literal value"],
    ["SELECT * FROM T WHERE A", "expected a comparison operator"],
    ["SELECT * FROM T WHERE A = ", "expected a literal value"],
    ["SELECT * FROM T WHERE A IS 1", "expected keyword NULL"],
    [
      "SELECT * FROM T WHERE A NOT = 1",
      "expected keyword LIKE, IN or BETWEEN after NOT",
    ],
    [
      "SELECT * FROM T GROUP BY COUNT(A)",
      "an aggregate function is not valid in GROUP BY",
    ],
    ["SELECT * FROM T ORDER", "expected keyword BY"],
    ["SELECT * FROM T WHERE A BETWEEN 1 2", "expected keyword AND"],
    ["SELECT * FROM T; SELECT * FROM U", "a subquery"],
  ])("throws for %s", (sql, message) => {
    expect(() => parseSelect(sql)).toThrow(message);
  });

  it("reports the source offset a parse failure was detected at", () => {
    expect.assertions(2);
    try {
      parseSelect("SELECT * FROM T WHERE A IS 1");
    } catch (error) {
      expect(error).toBeInstanceOf(HsqldbSqlParseError);
      if (error instanceof HsqldbSqlParseError) {
        expect(error.offset).toBe("SELECT * FROM T WHERE A IS ".length);
      }
    }
  });
});
