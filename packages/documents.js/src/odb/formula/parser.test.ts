import { describe, expect, it } from "vitest";
import { RptFormulaParseError, RptFormulaUnsupportedError } from "./errors";
import { parseRptFormula } from "./parser";

describe("parseRptFormula over the four formula shapes the real fixture uses", () => {
  it("parses a field: binding", () => {
    expect(parseRptFormula("field:[CUSTOMER]")).toEqual({
      kind: "field",
      reference: { name: "CUSTOMER", spelling: "bracket" },
      text: "field:[CUSTOMER]",
    });
  });

  it("parses rpt:HASCHANGED with a double-quoted name argument", () => {
    expect(parseRptFormula('rpt:HASCHANGED("REGION")')).toEqual({
      kind: "hasChanged",
      reference: { name: "REGION", spelling: "quote" },
      text: 'rpt:HASCHANGED("REGION")',
    });
  });

  it("parses rpt:LEFT with a SEMICOLON argument separator, not a comma", () => {
    expect(parseRptFormula("rpt:LEFT([QUARTER];2)")).toEqual({
      kind: "left",
      reference: { name: "QUARTER", spelling: "bracket" },
      length: 2,
      text: "rpt:LEFT([QUARTER];2)",
    });
  });

  it("rejects a comma-separated argument list outright rather than accepting either convention", () => {
    expect(() => parseRptFormula("rpt:LEFT([QUARTER],2)")).toThrow(
      RptFormulaParseError,
    );
  });

  it("parses rpt:SUM with a bracketed column argument", () => {
    expect(parseRptFormula("rpt:SUM([AMOUNT])")).toEqual({
      kind: "aggregate",
      aggregate: "SUM",
      reference: { name: "AMOUNT", spelling: "bracket" },
      text: "rpt:SUM([AMOUNT])",
    });
  });
});

describe("parseRptFormula over the rest of the implemented set", () => {
  it("parses each of the five aggregates the SQL engine also implements", () => {
    for (const aggregate of ["SUM", "COUNT", "AVG", "MIN", "MAX"] as const) {
      expect(parseRptFormula(`rpt:${aggregate}([AMOUNT])`)).toMatchObject({
        kind: "aggregate",
        aggregate,
      });
    }
  });

  it("treats the two reference spellings as one concept, differing only in what it records for an error message", () => {
    expect(parseRptFormula('rpt:SUM("AMOUNT")')).toMatchObject({
      kind: "aggregate",
      reference: { name: "AMOUNT", spelling: "quote" },
    });
    expect(parseRptFormula("rpt:HASCHANGED([REGION])")).toMatchObject({
      kind: "hasChanged",
      reference: { name: "REGION", spelling: "bracket" },
    });
  });

  it("folds a function name for the allowlist lookup while reporting it as written", () => {
    expect(parseRptFormula("rpt:sum([AMOUNT])")).toMatchObject({
      kind: "aggregate",
      aggregate: "SUM",
    });
    expect(() => parseRptFormula("rpt:Right([X];2)")).toThrow(
      /rpt:Right is not supported/,
    );
  });

  it("reads a doubled double quote inside a quoted reference as one literal quote", () => {
    expect(parseRptFormula('rpt:HASCHANGED("ODD""NAME")')).toMatchObject({
      reference: { name: 'ODD"NAME' },
    });
  });

  it("tolerates whitespace around the punctuation real output never emits it around", () => {
    expect(parseRptFormula("rpt:LEFT( [QUARTER] ; 2 )")).toMatchObject({
      kind: "left",
      length: 2,
    });
  });
});

describe("parseRptFormula closed allowlist", () => {
  it("throws RptFormulaUnsupportedError naming the function and carrying the formula", () => {
    let thrown: unknown;
    try {
      parseRptFormula("rpt:NOW()");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RptFormulaUnsupportedError);
    if (!(thrown instanceof RptFormulaUnsupportedError)) {
      throw new Error("expected an RptFormulaUnsupportedError");
    }
    expect(thrown.functionName).toBe("NOW");
    expect(thrown.formula).toBe("rpt:NOW()");
    expect(thrown.message).toContain(
      "HASCHANGED, LEFT, SUM, COUNT, AVG, MIN, MAX",
    );
  });

  it("refuses every other Report Builder function by name rather than evaluating it to something plausible", () => {
    for (const formula of [
      "rpt:RIGHT([X];2)",
      "rpt:MID([X];1;2)",
      "rpt:PAGENUMBER()",
      "rpt:TODAY()",
      "rpt:UPPER([X])",
      "rpt:CONCAT([X];[Y])",
      "rpt:IF([X];1;2)",
    ]) {
      expect(() => parseRptFormula(formula)).toThrow(
        RptFormulaUnsupportedError,
      );
    }
  });

  it("names an unsupported function even when its arguments would be wrong for every supported one", () => {
    expect(() => parseRptFormula("rpt:ROUND([A];[B];[C])")).toThrow(
      RptFormulaUnsupportedError,
    );
  });
});

describe("parseRptFormula grammar failures", () => {
  it("rejects an unrecognised prefix", () => {
    expect(() => parseRptFormula("[CUSTOMER]")).toThrow(
      /expected a formula beginning "field:" or "rpt:"/,
    );
    expect(() => parseRptFormula("=SUM(A1)")).toThrow(RptFormulaParseError);
    expect(() => parseRptFormula("")).toThrow(RptFormulaParseError);
  });

  it("rejects an unterminated reference", () => {
    expect(() => parseRptFormula("field:[CUSTOMER")).toThrow(
      /unterminated column reference/,
    );
    expect(() => parseRptFormula('rpt:HASCHANGED("REGION)')).toThrow(
      /unterminated name reference/,
    );
  });

  it("rejects a missing parenthesis", () => {
    expect(() => parseRptFormula("rpt:SUM[AMOUNT]")).toThrow(
      RptFormulaParseError,
    );
    expect(() => parseRptFormula("rpt:SUM([AMOUNT]")).toThrow(
      RptFormulaParseError,
    );
  });

  it("rejects trailing text after an otherwise complete formula", () => {
    expect(() => parseRptFormula("field:[A] + field:[B]")).toThrow(
      /unexpected trailing text after a field: reference/,
    );
    expect(() => parseRptFormula("rpt:SUM([A]) extra")).toThrow(
      /unexpected trailing text after a function call/,
    );
  });

  it("rejects a supported function called with the wrong number of arguments", () => {
    expect(() => parseRptFormula("rpt:SUM([A];[B])")).toThrow(
      /rpt:SUM takes exactly 1 argument, but 2 were given/,
    );
    expect(() => parseRptFormula("rpt:LEFT([A])")).toThrow(
      /rpt:LEFT takes exactly 2 arguments, but 1 was given/,
    );
    expect(() => parseRptFormula("rpt:HASCHANGED()")).toThrow(
      /rpt:HASCHANGED takes exactly 1 argument, but 0 were given/,
    );
  });

  it("rejects a supported function called with the wrong kind of argument", () => {
    expect(() => parseRptFormula("rpt:SUM(2)")).toThrow(
      /must be a column or function reference/,
    );
    expect(() => parseRptFormula("rpt:LEFT([A];[B])")).toThrow(
      /second argument must be a number of characters/,
    );
    expect(() => parseRptFormula("rpt:LEFT([A];2.5)")).toThrow(
      /must be a non-negative whole number of characters/,
    );
    expect(() => parseRptFormula("rpt:LEFT([A];-1)")).toThrow(
      /must be a non-negative whole number of characters/,
    );
  });

  it("carries the offending formula and a source offset on every parse failure", () => {
    let thrown: unknown;
    try {
      parseRptFormula("field:[CUSTOMER");
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof RptFormulaParseError)) {
      throw new Error("expected an RptFormulaParseError");
    }
    expect(thrown.formula).toBe("field:[CUSTOMER");
    expect(thrown.offset).toBe("field:[CUSTOMER".length);
  });
});
