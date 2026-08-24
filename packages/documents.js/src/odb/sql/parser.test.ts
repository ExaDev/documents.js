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
      name: "SALES",
      quoted: false,
    });
  });
});

describe("parseSelect: deliberately unsupported constructs", () => {
  it.each([
    ["SELECT A FROM T1 JOIN T2 ON T1.A = T2.A", "a JOIN"],
    ["SELECT A FROM T1 INNER JOIN T2 ON T1.A = T2.A", "a JOIN"],
    ["SELECT A FROM T1 LEFT OUTER JOIN T2 ON T1.A = T2.A", "a JOIN"],
    ["SELECT A FROM T1, T2", "a JOIN"],
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
    ["SELECT A AS ALIAS FROM T", "a column or table alias (AS)"],
    ["SELECT A FROM T ALIAS", "a table alias"],
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
    ["SELECT * FROM T T2", "a table alias"],
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
